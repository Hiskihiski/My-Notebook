import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// login.ts only needs these handles; mocking them keeps Firebase from starting.
vi.mock("./firebase", () => ({ auth: {}, gProvider: {} }));
vi.mock("firebase/auth", () => ({
  signInWithPopup: vi.fn(), signInWithRedirect: vi.fn(),
  signInWithEmailAndPassword: vi.fn(), sendSignInLinkToEmail: vi.fn(),
}));

import { sendSignInLinkToEmail, signInWithEmailAndPassword, signInWithPopup } from "firebase/auth";
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

describe("Google sign-in", () => {
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
