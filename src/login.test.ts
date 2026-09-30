import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// login.ts only needs these handles; mocking them keeps Firebase from starting.
vi.mock("./firebase", () => ({ auth: {}, gProvider: {} }));
vi.mock("firebase/auth", () => ({
  signInWithPopup: vi.fn(), signInWithRedirect: vi.fn(),
  signInWithEmailAndPassword: vi.fn(), sendSignInLinkToEmail: vi.fn(),
}));

import {
  sendSignInLinkToEmail, signInWithEmailAndPassword, signInWithPopup, signInWithRedirect,
} from "firebase/auth";
import { renderLogin, showLoginError, clearLoginError } from "./login";

const el = <T extends HTMLElement = HTMLInputElement>(id: string) => document.getElementById(id) as T;
// The click handlers are async; let their awaited (mocked) calls settle.
const flush = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };

let root: HTMLElement;
beforeEach(() => {
  vi.useFakeTimers();
  document.body.innerHTML = `<div id="app"></div>`;
  root = el("app");
  renderLogin(root);
  vi.mocked(signInWithEmailAndPassword).mockReset()
    .mockRejectedValue(Object.assign(new Error("wrong"), { code: "auth/wrong-password" }));
});
afterEach(() => {
  document.body.innerHTML = "";
  vi.clearAllTimers();
  vi.useRealTimers();
});

const key = (target: HTMLElement, k: string) => target.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true }));

function enterEmail(email: string): void {
  if (el("step-email").style.display === "none") el("back-from-password").click();
  el("email-input").value = email;
  el("continue-btn").click();
}

async function wrongPassword(): Promise<void> {
  el("pw-input").value = "hunter2";
  el("signin-btn").click();
  await flush();
}

async function lockOut(email: string): Promise<void> {
  for (let i = 0; i < 3; i++) { enterEmail(email); await wrongPassword(); }
}

describe("login lockout", () => {
  it("locks an address after 3 wrong passwords, whatever its case", async () => {
    enterEmail("Ada@Example.com"); await wrongPassword();
    enterEmail("ada@example.com"); await wrongPassword();
    enterEmail("ADA@example.com"); await wrongPassword();
    expect(el("lockout-msg").style.display).toBe("");
    expect(el("lockout-msg").textContent).toBe("Too many attempts. Try again in 60s.");

    await wrongPassword();
    expect(signInWithEmailAndPassword).toHaveBeenCalledTimes(3);
    expect(el("login-err").textContent).toMatch(/^Locked out/);
  });

  it("shows every attempt used while locked", async () => {
    await lockOut("used@example.com");
    const used = [1, 2, 3].map((i) => el(`dot-${i}`).classList.contains("used"));
    expect(used).toEqual([true, true, true]);
    vi.advanceTimersByTime(60_000);
    expect(el("dot-1").classList.contains("used")).toBe(false);
  });

  it("counts down and stops its timer once unlocked", async () => {
    await lockOut("grace@example.com");
    vi.advanceTimersByTime(30_000);
    expect(el("lockout-msg").textContent).toBe("Too many attempts. Try again in 30s.");
    vi.advanceTimersByTime(30_000);
    expect(el("lockout-msg").style.display).toBe("none");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("follows the address on screen and leaves no timer behind when two are locked", async () => {
    await lockOut("one@example.com");
    vi.advanceTimersByTime(20_000);
    await lockOut("two@example.com");
    vi.advanceTimersByTime(45_000); // one@ unlocked, two@ still locked
    expect(el("lockout-msg").textContent).toBe("Too many attempts. Try again in 15s.");
    vi.advanceTimersByTime(15_000);
    expect(el("lockout-msg").style.display).toBe("none");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("stops the countdown when the login screen goes away", async () => {
    await lockOut("linus@example.com");
    root.innerHTML = "<div>notebook</div>"; // e.g. signed in with Google meanwhile
    expect(() => vi.advanceTimersByTime(2000)).not.toThrow();
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("email sign-in link", () => {
  it("sends one link however fast Resend is clicked", async () => {
    vi.mocked(sendSignInLinkToEmail).mockReset().mockResolvedValue();
    enterEmail("new@example.com");
    el("send-link-btn").click();
    await flush();
    expect(el("step-link-sent").style.display).toBe("");
    expect(localStorage.getItem("emailForSignIn")).toBe("new@example.com");

    el("resend-link").click();
    el("resend-link").click();
    await flush();
    expect(sendSignInLinkToEmail).toHaveBeenCalledTimes(2); // first send + one resend
    expect(el("resend-link").textContent).toBe("Sent!");
    vi.advanceTimersByTime(2500);
    expect(el("resend-link").textContent).toBe("Resend link");
    el("resend-link").click();
    await flush();
    expect(sendSignInLinkToEmail).toHaveBeenCalledTimes(3);
  });
});

describe("showLoginError", () => {
  const errText = () => el("login-err").style.display === "block" ? el("login-err").textContent : null;

  it("shows the error straight away when the login screen is up", () => {
    showLoginError("Link expired");
    expect(errText()).toBe("Link expired");
  });

  it("keeps an error raised before the screen exists for the next one, once", () => {
    root.innerHTML = "<div>landing</div>";
    showLoginError("Sign-in was interrupted");
    expect(vi.getTimerCount()).toBe(0); // no polling for the element
    renderLogin(root);
    expect(errText()).toBe("Sign-in was interrupted");
    renderLogin(root);
    expect(errText()).toBeNull();
  });

  it("drops a pending error once the user is signed in", () => {
    root.innerHTML = "<div>notebook</div>";
    showLoginError("Link expired");
    clearLoginError();
    renderLogin(root);
    expect(errText()).toBeNull();
  });
});

describe("email and password", () => {
  const err = (code: string, message = code) => Object.assign(new Error(message), { code });
  const shown = () => el("login-err").style.display === "block" ? el("login-err").textContent : null;

  it("asks for a valid address before moving on, and Enter continues", () => {
    el("email-input").value = "not-an-email";
    key(el("email-input"), "Enter");
    expect(shown()).toBe("Enter a valid email address.");
    expect(el("step-email").style.display).toBe("");

    el("email-input").value = "  ada@example.com ";
    key(el("email-input"), "Enter");
    expect(el("step-password").style.display).toBe("");
    expect(el("badge-password").textContent).toBe("ada@example.com");
    expect(shown()).toBeNull();
  });

  it("asks for a password before trying, and Enter signs in", async () => {
    enterEmail("pw@example.com"); // the guard is module-wide: use an address no other test locked
    el("signin-btn").click();
    expect(shown()).toBe("Enter your password.");
    expect(signInWithEmailAndPassword).not.toHaveBeenCalled();

    vi.mocked(signInWithEmailAndPassword).mockResolvedValueOnce({} as never);
    el("pw-input").value = "correct horse";
    key(el("pw-input"), "Enter");
    await flush();
    expect(signInWithEmailAndPassword).toHaveBeenCalledWith({}, "pw@example.com", "correct horse");
    expect(shown()).toBeNull();
  });

  it("forgets earlier failures after a successful sign-in", async () => {
    enterEmail("reset@example.com");
    await wrongPassword();
    await wrongPassword();
    vi.mocked(signInWithEmailAndPassword).mockResolvedValueOnce({} as never);
    await wrongPassword(); // succeeds this time
    enterEmail("reset@example.com");
    expect(el("dot-1").classList.contains("used")).toBe(false);
  });

  it("reports other errors without counting them as wrong passwords", async () => {
    vi.mocked(signInWithEmailAndPassword).mockRejectedValue(err("auth/network-request-failed", "offline"));
    enterEmail("net@example.com");
    for (let i = 0; i < 3; i++) await wrongPassword();
    expect(shown()).toBe("Sign-in failed: offline");
    expect(el("lockout-msg").style.display).toBe("none");
    expect(el<HTMLButtonElement>("signin-btn").disabled).toBe(false);
  });

  it("clears the password when going back to change the address", () => {
    enterEmail("ada@example.com");
    el("pw-input").value = "secret";
    el("back-from-password").click();
    expect(el("step-email").style.display).toBe("");
    expect(el("pw-input").value).toBe("");
  });
});

describe("email sign-in link errors", () => {
  it("reports a failed send and restores the button", async () => {
    vi.mocked(sendSignInLinkToEmail).mockReset().mockRejectedValueOnce(new Error("quota exceeded"));
    enterEmail("ada@example.com");
    el("send-link-btn").click();
    await flush();
    expect(el("login-err").textContent).toBe("Could not send link: quota exceeded");
    expect(el("step-password").style.display).toBe("");
    expect(el<HTMLButtonElement>("send-link-btn").disabled).toBe(false);
    expect(el("send-link-btn").textContent).toContain("Email me a sign-in link");
  });

  it("reports a failed resend and lets the user try again or go back", async () => {
    vi.mocked(sendSignInLinkToEmail).mockReset().mockResolvedValueOnce().mockRejectedValueOnce(new Error("offline"));
    enterEmail("ada@example.com");
    el("send-link-btn").click();
    await flush();
    el("resend-link").click();
    await flush();
    expect(el("login-err").textContent).toBe("Could not send link: offline");
    expect(el<HTMLButtonElement>("resend-link").disabled).toBe(false);
    expect(el("resend-link").textContent).toBe("Resend link");
    el("back-from-link-sent").click();
    expect(el("step-email").style.display).toBe("");
  });
});

describe("Google sign-in", () => {
  it("falls back to a redirect when the popup is blocked", async () => {
    vi.mocked(signInWithPopup).mockRejectedValueOnce(Object.assign(new Error("blocked"), { code: "auth/popup-blocked" }));
    vi.mocked(signInWithRedirect).mockReset().mockRejectedValueOnce(new Error("redirect failed"));
    el("google-signin").click();
    await flush();
    expect(signInWithRedirect).toHaveBeenCalledOnce();
    expect(el("login-err").textContent).toBe("redirect failed");
    expect(el("google-signin").querySelector("svg")).not.toBeNull();
  });

  it("reports other failures", async () => {
    vi.mocked(signInWithPopup).mockRejectedValueOnce(Object.assign(new Error("boom"), { code: "auth/internal-error" }));
    el("google-signin").click();
    await flush();
    expect(el("login-err").textContent).toBe("Sign-in failed: boom");
    expect(el<HTMLButtonElement>("google-signin").disabled).toBe(false);
  });

  it("keeps the button's logo when the popup is closed", async () => {
    vi.mocked(signInWithPopup).mockRejectedValueOnce(Object.assign(new Error("closed"), { code: "auth/popup-closed-by-user" }));
    const btn = el<HTMLButtonElement>("google-signin");
    btn.click();
    await flush();
    expect(btn.disabled).toBe(false);
    expect(btn.querySelector("svg")).not.toBeNull();
    expect(btn.textContent?.trim()).toBe("Continue with Google");
  });
});
