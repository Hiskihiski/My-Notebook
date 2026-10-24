import { describe, it, expect, vi } from "vitest";
import {
  shouldBootFirebase, isEmailSignInLink, setFlag, hasPersistedAuthUser,
  SIGNED_IN_KEY, PENDING_REDIRECT_KEY, SIGNED_OUT_KEY, SIGN_OUT_AT_KEY, firstScreen, recentSignOut,
} from "./boot";

const store = (items: Record<string, string> = {}) => () => ({
  getItem: (k: string) => items[k] ?? null,
});
const blocked = () => { throw new DOMException("The operation is insecure.", "SecurityError"); };
const throwingGetItem = () => ({ getItem: blocked });

const SIGN_IN = "https://my-notebook-web.firebaseapp.com/__/auth/action?apiKey=k&mode=signIn&oobCode=c&lang=en";
const q = (params: Record<string, string>) => "?" + new URLSearchParams(params).toString();

describe("shouldBootFirebase", () => {
  it("stays off for a first-time visitor", () => {
    expect(shouldBootFirebase("", store(), store())).toBe(false);
    expect(shouldBootFirebase("?utm_source=x", store(), store())).toBe(false);
  });

  it("boots when the signed-in flag is set", () => {
    expect(shouldBootFirebase("", store({ [SIGNED_IN_KEY]: "1" }), store())).toBe(true);
    expect(shouldBootFirebase("", store({ [SIGNED_IN_KEY]: "0" }), store())).toBe(false);
  });

  it("boots while a Google redirect sign-in is pending", () => {
    expect(shouldBootFirebase("", store(), store({ [PENDING_REDIRECT_KEY]: "1" }))).toBe(true);
    // Only sessionStorage counts: a stale flag must not survive the tab.
    expect(shouldBootFirebase("", store({ [PENDING_REDIRECT_KEY]: "1" }), store())).toBe(false);
  });

  it("boots for an emailed sign-in link", () => {
    expect(shouldBootFirebase("?apiKey=k&oobCode=c&mode=signIn&lang=en", store(), store())).toBe(true);
  });

  it("treats blocked storage as absent instead of throwing", () => {
    expect(shouldBootFirebase("", blocked, blocked)).toBe(false);
    expect(shouldBootFirebase("", throwingGetItem, throwingGetItem)).toBe(false);
    expect(shouldBootFirebase("?mode=signIn&oobCode=c", blocked, blocked)).toBe(true);
  });
});

describe("isEmailSignInLink", () => {
  it("detects a direct link", () => {
    expect(isEmailSignInLink("?apiKey=k&oobCode=c&mode=signIn&lang=en")).toBe(true);
    expect(isEmailSignInLink("mode=signIn&oobCode=c")).toBe(true);
  });

  it("detects links wrapped in link / deep_link_id", () => {
    expect(isEmailSignInLink(q({ link: SIGN_IN }))).toBe(true);
    expect(isEmailSignInLink(q({ deep_link_id: SIGN_IN }))).toBe(true);
    // Double wrapping (automatic redirect / iOS custom scheme).
    expect(isEmailSignInLink(q({ link: "https://x.page.link/?" + new URLSearchParams({ deep_link_id: SIGN_IN }) }))).toBe(true);
    expect(isEmailSignInLink(q({ deep_link_id: "app://open?" + new URLSearchParams({ link: SIGN_IN }) }))).toBe(true);
  });

  it("ignores other URLs", () => {
    expect(isEmailSignInLink("")).toBe(false);
    expect(isEmailSignInLink("?mode=resetPassword&oobCode=c")).toBe(false);
    expect(isEmailSignInLink("?mode=verifyEmail&oobCode=c")).toBe(false);
    expect(isEmailSignInLink("?mode=signIn")).toBe(false);
    expect(isEmailSignInLink("?mode=signIn&oobCode=")).toBe(false);
    expect(isEmailSignInLink("?mode=signin&oobCode=c")).toBe(false);
    expect(isEmailSignInLink(q({ link: "https://example.com/?foo=bar" }))).toBe(false);
    expect(isEmailSignInLink(q({ link: "https://example.com/no-query" }))).toBe(false);
  });

  it("stops at a sane nesting depth", () => {
    let s = SIGN_IN;
    for (let i = 0; i < 10; i++) s = "https://x/?" + new URLSearchParams({ link: s });
    expect(isEmailSignInLink(new URL(s).search)).toBe(false);
  });
});

describe("setFlag", () => {
  it("sets and clears a flag", () => {
    const s = window.sessionStorage;
    expect(setFlag(() => s, PENDING_REDIRECT_KEY, true)).toBe(true);
    expect(s.getItem(PENDING_REDIRECT_KEY)).toBe("1");
    expect(setFlag(() => s, PENDING_REDIRECT_KEY, false)).toBe(true);
    expect(s.getItem(PENDING_REDIRECT_KEY)).toBeNull();
  });

  it("reports blocked storage instead of throwing", () => {
    expect(setFlag(blocked, SIGNED_IN_KEY, true)).toBe(false);
    const full = { setItem: blocked, removeItem: blocked } as unknown as Storage;
    expect(setFlag(() => full, SIGNED_IN_KEY, true)).toBe(false);
    expect(setFlag(() => full, SIGNED_IN_KEY, false)).toBe(false);
  });
});

// ── hasPersistedAuthUser ─────────────────────────────────────────────────────
// Minimal async IDBFactory stand-in: open() either succeeds with a DB whose
// store holds `keys`, or (upgrade) behaves like opening a DB that doesn't exist.
type Handler = (() => void) | null;
function fakeIdb(names: string[], opts: { keys?: IDBValidKey[]; upgrade?: boolean; noStore?: boolean } = {}) {
  const abort = vi.fn();
  const close = vi.fn();
  const db = {
    close,
    transaction: () => {
      if (opts.noStore) throw new DOMException("not found", "NotFoundError");
      return { objectStore: () => ({ getAllKeys: () => {
        const r = { result: opts.keys ?? [], onsuccess: null as Handler, onerror: null as Handler };
        setTimeout(() => r.onsuccess?.());
        return r;
      } }) };
    },
  };
  const open = vi.fn(() => {
    const req = {
      result: db, transaction: { abort },
      onsuccess: null as Handler, onerror: null as Handler, onupgradeneeded: null as Handler,
    };
    setTimeout(() => {
      if (opts.upgrade) { req.onupgradeneeded?.(); req.onerror?.(); }
      else req.onsuccess?.();
    });
    return req;
  });
  const databases = vi.fn(async () => names.map((name) => ({ name, version: 1 })));
  return { idb: { open, databases } as unknown as IDBFactory, open, abort, close };
}

const API_KEY  = "AIzaTestKey";
const USER_KEY = `firebase:authUser:${API_KEY}:[DEFAULT]`;

describe("hasPersistedAuthUser", () => {
  it("is false without IndexedDB or databases()", async () => {
    expect(await hasPersistedAuthUser(API_KEY)).toBe(false); // jsdom has no indexedDB
    const open = vi.fn();
    expect(await hasPersistedAuthUser(API_KEY, { open } as unknown as IDBFactory)).toBe(false);
    expect(open).not.toHaveBeenCalled();
  });

  it("never opens (and so never creates) a DB that isn't listed", async () => {
    const f = fakeIdb(["firebase-heartbeat-database"]);
    expect(await hasPersistedAuthUser(API_KEY, f.idb)).toBe(false);
    expect(f.open).not.toHaveBeenCalled();
  });

  it("finds a stored Firebase Auth user", async () => {
    const f = fakeIdb(["firebaseLocalStorageDb"], { keys: ["firebase:redirectUser:x", USER_KEY] });
    expect(await hasPersistedAuthUser(API_KEY, f.idb)).toBe(true);
    expect(f.open).toHaveBeenCalledWith("firebaseLocalStorageDb");
    expect(f.close).toHaveBeenCalled();
  });

  it("is false when the DB holds no user", async () => {
    expect(await hasPersistedAuthUser(API_KEY, fakeIdb(["firebaseLocalStorageDb"], { keys: ["firebase:pendingRedirect:x"] }).idb)).toBe(false);
    const noStore = fakeIdb(["firebaseLocalStorageDb"], { noStore: true });
    expect(await hasPersistedAuthUser(API_KEY, noStore.idb)).toBe(false);
    expect(noStore.close).toHaveBeenCalled();
  });

  it("aborts instead of creating the DB if it vanished meanwhile", async () => {
    const f = fakeIdb(["firebaseLocalStorageDb"], { upgrade: true });
    expect(await hasPersistedAuthUser(API_KEY, f.idb)).toBe(false);
    expect(f.abort).toHaveBeenCalled();
  });

  it("is false when IndexedDB fails or hangs", async () => {
    const rejecting = { databases: () => Promise.reject(new DOMException("denied", "SecurityError")) };
    expect(await hasPersistedAuthUser(API_KEY, rejecting as unknown as IDBFactory)).toBe(false);
    const hanging = {
      databases: async () => [{ name: "firebaseLocalStorageDb", version: 1 }],
      open: () => ({}),
    };
    expect(await hasPersistedAuthUser(API_KEY, hanging as unknown as IDBFactory, 20)).toBe(false);
  });

  it("ignores a user stored under another (rotated) API key", async () => {
    const f = fakeIdb(["firebaseLocalStorageDb"], { keys: ["firebase:authUser:AIzaOldKey:[DEFAULT]"] });
    expect(await hasPersistedAuthUser(API_KEY, f.idb)).toBe(false);
  });

  it("gives up when databases() itself hangs", async () => {
    const stuck = { databases: () => new Promise(() => {}) };
    expect(await hasPersistedAuthUser(API_KEY, stuck as unknown as IDBFactory, 20)).toBe(false);
  });
});

// The landing page must not pull in Firebase: walk main.ts's static imports.
describe("entry chunk", () => {
  const sources = import.meta.glob("./*.ts", { query: "?raw", import: "default", eager: true }) as Record<string, string>;
  it("never imports Firebase or the session module statically", () => {
    const seen = new Set<string>();
    const visit = (file: string): void => {
      if (seen.has(file)) return;
      seen.add(file);
      const src = sources[file] ?? "";
      for (const m of src.matchAll(/^import\s+(?!type\b)(?:[^"';]*?\s+from\s+)?["']([^"']+)["']/gm)) {
        const spec = m[1];
        expect(spec.startsWith("firebase"), `${file} imports ${spec}`).toBe(false);
        if (spec.startsWith("./") && spec.endsWith(".css") === false) visit(`${spec}.ts`);
      }
    };
    visit("./main.ts");
    expect(seen.has("./main.ts") && seen.has("./landing.ts")).toBe(true);
    expect(seen.has("./session.ts") || seen.has("./firebase.ts")).toBe(false);
  });
});


describe("sign-out and redirect start screens", () => {
  it("boots straight into the login screen after a sign-out or during a redirect sign-in", () => {
    expect(shouldBootFirebase("", store(), store({ [SIGNED_OUT_KEY]: "1" }))).toBe(true);
    expect(firstScreen(store({ [SIGNED_OUT_KEY]: "1" }))).toBe("login");
    expect(firstScreen(store({ [PENDING_REDIRECT_KEY]: "1" }))).toBe("login");
    expect(firstScreen(store())).toBe("landing");
    expect(firstScreen(blocked)).toBe("landing");
  });
});

describe("recentSignOut", () => {
  const NOW = 1_800_000_000_000;
  it("is true only for a Sign out within the last minute", () => {
    expect(recentSignOut(store({ [SIGN_OUT_AT_KEY]: String(NOW - 5_000) }), NOW)).toBe(true);
    expect(recentSignOut(store({ [SIGN_OUT_AT_KEY]: String(NOW - 61_000) }), NOW)).toBe(false);
    expect(recentSignOut(store({ [SIGN_OUT_AT_KEY]: String(NOW + 5_000) }), NOW)).toBe(false);
    expect(recentSignOut(store({ [SIGN_OUT_AT_KEY]: "x" }), NOW)).toBe(false);
    expect(recentSignOut(store(), NOW)).toBe(false);
    expect(recentSignOut(blocked, NOW)).toBe(false);
  });
});
