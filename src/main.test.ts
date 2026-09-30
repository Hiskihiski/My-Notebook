import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { User } from "firebase/auth";

// main.ts starts the app on import, so every dependency is mocked and the
// module is re-imported fresh for each test.
const m = vi.hoisted(() => ({
  auth: { currentUser: null as unknown },
  isSignInWithEmailLink: vi.fn(), signInWithEmailLink: vi.fn(),
  getRedirectResult: vi.fn(), onAuthStateChanged: vi.fn(),
  renderApp: vi.fn(), teardownApp: vi.fn(), renderLanding: vi.fn(),
  renderLogin: vi.fn(), showLoginError: vi.fn(), clearLoginError: vi.fn(),
}));
vi.mock("./firebase", () => ({ auth: m.auth }));
vi.mock("./ui", () => ({ initTheme: vi.fn() }));
vi.mock("./landing", () => ({ renderLanding: m.renderLanding }));
vi.mock("./app", () => ({ renderApp: m.renderApp, teardownApp: m.teardownApp }));
vi.mock("./login", () => ({
  renderLogin: m.renderLogin, showLoginError: m.showLoginError, clearLoginError: m.clearLoginError,
  EMAIL_FOR_SIGN_IN_KEY: "emailForSignIn",
}));
vi.mock("firebase/auth", () => ({
  isSignInWithEmailLink: m.isSignInWithEmailLink, signInWithEmailLink: m.signInWithEmailLink,
  getRedirectResult: m.getRedirectResult, onAuthStateChanged: m.onAuthStateChanged,
}));

const LINK = "/?apiKey=k&oobCode=abc&mode=signIn";
const flush = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };
let authChanged: (user: User | null) => void;

async function start(url = "/"): Promise<void> {
  history.replaceState(null, "", url);
  vi.resetModules();
  await import("./main");
  await flush();
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  m.auth.currentUser = null;
  document.body.innerHTML = `<div id="app"></div>`;
  m.isSignInWithEmailLink.mockImplementation((_a: unknown, href: string) => href.includes("oobCode="));
  m.signInWithEmailLink.mockResolvedValue({});
  m.getRedirectResult.mockResolvedValue(null);
  m.onAuthStateChanged.mockImplementation((_a: unknown, cb: typeof authChanged) => { authChanged = cb; });
});
afterEach(() => { vi.restoreAllMocks(); });

describe("screen routing", () => {
  it("shows the landing page first, then the login screen, then the app", async () => {
    await start();
    authChanged(null);
    expect(m.renderLanding).toHaveBeenCalledOnce();
    authChanged({ uid: "alice" } as User);
    expect(m.clearLoginError).toHaveBeenCalledOnce();
    expect(m.renderApp).toHaveBeenCalledOnce();
    authChanged(null);
    expect(m.renderLogin).toHaveBeenCalledOnce();
    expect(m.renderLanding).toHaveBeenCalledOnce();
    expect(m.teardownApp).toHaveBeenCalledTimes(3);
  });

  it("goes straight to the login screen when opened from a sign-in link", async () => {
    m.signInWithEmailLink.mockReturnValue(new Promise(() => {})); // still completing
    localStorage.setItem("emailForSignIn", "ada@example.com");
    await start(LINK);
    authChanged(null);
    expect(m.renderLogin).toHaveBeenCalledOnce();
    expect(m.renderLanding).not.toHaveBeenCalled();
  });

  it("shows a failed Google redirect on the login screen, not the landing page", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    m.getRedirectResult.mockRejectedValue(new Error("redirect failed"));
    await start();
    authChanged(null);
    expect(m.renderLogin).toHaveBeenCalledOnce();
    expect(m.renderLanding).not.toHaveBeenCalled();
  });

  it("switches from the landing page when the redirect fails after it's shown", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    let reject!: (e: Error) => void;
    m.getRedirectResult.mockReturnValue(new Promise((_r, rj) => { reject = rj; }));
    m.renderLanding.mockImplementation((root: HTMLElement) => { root.innerHTML = `<div class="landing"></div>`; });
    await start();
    authChanged(null);
    expect(m.renderLanding).toHaveBeenCalledOnce();
    reject(new Error("redirect failed"));
    await flush();
    expect(m.renderLogin).toHaveBeenCalledWith(document.getElementById("app"));
  });

  it("reports an interrupted redirect sign-in only to a signed-out user", async () => {
    m.getRedirectResult.mockRejectedValue(new Error("network"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    await start();
    expect(m.showLoginError).toHaveBeenCalledWith("Sign-in was interrupted — please try again.");

    m.showLoginError.mockClear();
    m.auth.currentUser = { uid: "alice" };
    await start();
    expect(m.showLoginError).not.toHaveBeenCalled();
  });
});

describe("email sign-in link", () => {
  it("completes with the address saved on this device, then forgets it and cleans the URL", async () => {
    localStorage.setItem("emailForSignIn", "ada@example.com");
    await start(LINK);
    expect(m.signInWithEmailLink).toHaveBeenCalledWith(m.auth, "ada@example.com", `${location.origin}${LINK}`);
    expect(localStorage.getItem("emailForSignIn")).toBeNull();
    expect(location.search).toBe("");
  });

  it("trims the address typed on another device", async () => {
    vi.spyOn(window, "prompt").mockReturnValue("  ada@example.com ");
    await start(LINK);
    expect(m.signInWithEmailLink).toHaveBeenCalledWith(m.auth, "ada@example.com", expect.any(String));
  });

  it("reports a cancelled or blank prompt without trying to sign in", async () => {
    vi.spyOn(window, "prompt").mockReturnValueOnce(null).mockReturnValueOnce("   ");
    await start(LINK);
    await start(LINK);
    expect(m.signInWithEmailLink).not.toHaveBeenCalled();
    expect(m.showLoginError).toHaveBeenCalledTimes(2);
    expect(m.showLoginError).toHaveBeenLastCalledWith(expect.stringMatching(/cancelled/));
  });

  it("reports a failed link and still cleans the URL", async () => {
    localStorage.setItem("emailForSignIn", "ada@example.com");
    m.signInWithEmailLink.mockRejectedValue(new Error("The action code is invalid."));
    await start(LINK);
    expect(m.showLoginError).toHaveBeenCalledWith("Sign-in link failed: The action code is invalid.. Request a new link.");
    expect(localStorage.getItem("emailForSignIn")).toBe("ada@example.com");
    expect(location.search).toBe("");
  });

  it("stays quiet about a failed link when someone is already signed in", async () => {
    localStorage.setItem("emailForSignIn", "ada@example.com");
    m.auth.currentUser = { uid: "alice" };
    m.signInWithEmailLink.mockRejectedValue(new Error("expired"));
    await start(LINK);
    expect(m.showLoginError).not.toHaveBeenCalled();
  });
});
