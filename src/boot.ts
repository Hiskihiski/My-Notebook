// Decides at startup whether Firebase has to load before the visitor does
// anything. Keep this module free of Firebase imports: main.ts loads it on
// every visit, and a first-time visitor's landing page must not start App
// Check / reCAPTCHA or create Firebase storage until they click "Get started".

// localStorage: "1" while Firebase reports a signed-in user (see session.ts).
export const SIGNED_IN_KEY = "signedIn";
// sessionStorage: "1" from signInWithRedirect until getRedirectResult settles.
export const PENDING_REDIRECT_KEY = "pendingGoogleRedirect";
// sessionStorage: "1" from a sign-out until the page has reloaded (session.ts
// clears the offline notes, then reloads straight into the login screen).
export const SIGNED_OUT_KEY = "justSignedOut";
// localStorage: time of a sign-out the user started with the Sign out button.
// Other tabs see the same sign-out a moment later; a recent value tells them
// the user chose to remove the offline notes (see session.ts).
export const SIGN_OUT_AT_KEY = "signOutAt";
const SIGN_OUT_WINDOW_MS = 60_000;

// True if a Sign out button was used in any tab within the last minute.
export function recentSignOut(local: StorageGetter, now: number): boolean {
  try {
    const at = Number(local().getItem(SIGN_OUT_AT_KEY));
    return at > 0 && at <= now && now - at <= SIGN_OUT_WINDOW_MS;
  } catch { return false; } // site data blocked
}

// Screen shown when the first auth state is "signed out".
export type SignedOutScreen = "landing" | "login";

// Storage is passed as a getter because merely touching `localStorage` can
// throw when the browser blocks site data.
type StorageGetter = () => Pick<Storage, "getItem">;

function hasFlag(store: StorageGetter, key: string): boolean {
  try { return store().getItem(key) === "1"; }
  catch { return false; } // site data blocked: treat the flag as absent
}

// Sets or clears a "1" flag. Returns false if storage is unavailable.
export function setFlag(store: () => Storage, key: string, on: boolean): boolean {
  try {
    if (on) store().setItem(key, "1");
    else store().removeItem(key);
    return true;
  } catch { return false; } // site data blocked: the flag is only a startup hint
}

function queryOf(url: string): string {
  const start = url.indexOf("?");
  if (start < 0) return "";
  const end = url.indexOf("#", start);
  return url.slice(start + 1, end < 0 ? undefined : end);
}

// True for a passwordless sign-in link (mode=signIn + oobCode), also when it
// is wrapped in a `link` / `deep_link_id` parameter like the URL shapes
// firebase/auth's isSignInWithEmailLink accepts — without importing it.
export function isEmailSignInLink(search: string, depth = 0): boolean {
  const params = new URLSearchParams(search);
  if (params.get("mode") === "signIn" && params.get("oobCode")) return true;
  if (depth >= 3) return false;
  return ["link", "deep_link_id"].some((name) => {
    const nested = params.get(name);
    return !!nested && isEmailSignInLink(queryOf(nested), depth + 1);
  });
}

// Cheap, synchronous checks: signed in last time, an emailed sign-in link,
// or returning from the Google sign-in redirect.
export function shouldBootFirebase(search: string, local: StorageGetter, session: StorageGetter): boolean {
  return hasFlag(local, SIGNED_IN_KEY)
    || isEmailSignInLink(search)
    || hasFlag(session, PENDING_REDIRECT_KEY)
    || hasFlag(session, SIGNED_OUT_KEY);
}

// Signed-out screen to start on: the login screen when the visitor is in the
// middle of signing in or out (its errors show there), else the landing page.
export function firstScreen(session: StorageGetter): SignedOutScreen {
  return hasFlag(session, PENDING_REDIRECT_KEY) || hasFlag(session, SIGNED_OUT_KEY) ? "login" : "landing";
}

// Firebase Auth's own IndexedDB persistence (names from the SDK).
const AUTH_DB          = "firebaseLocalStorageDb";
const AUTH_STORE       = "firebaseLocalStorage";
const AUTH_USER_PREFIX = "firebase:authUser:";

// Finds sessions from before the signedIn flag existed: a Firebase Auth user
// stored under this app's current API key (entries left by a rotated key are
// ignored – Firebase wouldn't restore them either). Only reads: the DB is
// opened only if databases() lists it, and an open that would create it is
// aborted. Browsers without databases() (Firefox < 126) see the landing page
// once; "Get started" then restores the session. The whole check races a
// timeout, since IndexedDB calls can hang and leave the visitor on the spinner.
export async function hasPersistedAuthUser(apiKey: string, idb?: IDBFactory, timeoutMs = 3000): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<boolean>((resolve) => { timer = setTimeout(() => resolve(false), timeoutMs); });
  try {
    return await Promise.race([findAuthUser(`${AUTH_USER_PREFIX}${apiKey}:[DEFAULT]`, idb), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

async function findAuthUser(userKey: string, idb?: IDBFactory): Promise<boolean> {
  try {
    const factory = idb ?? globalThis.indexedDB;
    if (typeof factory?.databases !== "function") return false;
    const dbs = await factory.databases();
    if (!dbs.some((d) => d.name === AUTH_DB)) return false;

    return await new Promise<boolean>((resolve) => {
      const req = factory.open(AUTH_DB); // no version: never upgrades an existing DB
      req.onupgradeneeded = () => { req.transaction?.abort(); resolve(false); }; // DB vanished meanwhile: don't create it
      req.onerror = () => resolve(false);
      req.onsuccess = () => {
        const db = req.result;
        try {
          const keys = db.transaction(AUTH_STORE, "readonly").objectStore(AUTH_STORE).getAllKeys();
          keys.onsuccess = () => { db.close(); resolve(keys.result.includes(userKey)); };
          keys.onerror = () => { db.close(); resolve(false); };
        } catch {
          db.close(); // store missing: nothing persisted
          resolve(false);
        }
      };
    });
  } catch { return false; } // IndexedDB blocked or unavailable
}
