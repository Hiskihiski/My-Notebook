import {
  getRedirectResult, onAuthStateChanged,
  isSignInWithEmailLink, signInWithEmailLink,
} from "firebase/auth";
import { auth } from "./firebase";
import { renderLanding } from "./landing";
import { renderLogin, showLoginError, clearLoginError } from "./login";
import { EMAIL_FOR_SIGN_IN_KEY, parseSignInEmail } from "./email-link";
import { renderApp, teardownApp } from "./app";
import {
  SIGNED_IN_KEY, PENDING_REDIRECT_KEY, SIGNED_OUT_KEY, SIGN_OUT_AT_KEY, setFlag, recentSignOut, type SignedOutScreen,
} from "./boot";
import { clearOfflineNotes } from "./offline-cache";

// Only ever loaded via import() from main.ts, so it gets its own chunk:
// importing it starts Firebase (App Check first, see firebase.ts).

// The address a sign-in link was sent to (null if none, expired or blocked).
function rememberedEmail(): string | null {
  try { return parseSignInEmail(localStorage.getItem(EMAIL_FOR_SIGN_IN_KEY), Date.now()); }
  catch { return null; } // site data blocked
}

function forgetEmail(): void {
  setFlag(() => localStorage, EMAIL_FOR_SIGN_IN_KEY, false); // removes the key; tolerates blocked storage
}

// Completes passwordless sign-in when the page is opened from an emailed link.
async function completeEmailLinkSignIn(): Promise<void> {
  let email = rememberedEmail();
  if (!email) {
    // Link was opened on a different device/browser than the one that requested it.
    // Trimmed: mobile keyboards add a space after an autocompleted address.
    email = window.prompt("Confirm your email to finish signing in:")?.trim() || null;
  }
  try {
    if (!email) throw new Error("Email confirmation cancelled.");
    await signInWithEmailLink(auth, email, window.location.href);
    forgetEmail();
  } catch (err: unknown) {
    // Already signed in (an old link opened again): nothing to report.
    if (!auth.currentUser) showLoginError(`Sign-in link failed: ${(err as Error).message ?? "unknown"}. Request a new link.`);
  } finally {
    // Strip the oobCode etc. from the address bar either way.
    window.history.replaceState(null, "", window.location.pathname);
  }
}

// Signed out after having been signed in on this page. If the user chose to
// sign out (Sign out button in this or another tab, within the last minute),
// remove this account's offline copy of the notes from the device. A session
// that ended otherwise (revoked elsewhere) keeps it: once Auth has switched
// users, Firestore can no longer tell whether edits are still unsynced, and
// they would be lost. Then reload into the login screen.
async function leaveSession(root: HTMLElement): Promise<void> {
  root.innerHTML = `<div id="app-loading" style="background:var(--bg)"><span></span></div>`;
  if (recentSignOut(() => localStorage, Date.now()) && await clearOfflineNotes()) {
    try { localStorage.removeItem(SIGN_OUT_AT_KEY); }
    catch { console.warn("Sign-out marker not removed: site data is blocked"); }
  }
  setFlag(() => sessionStorage, SIGNED_OUT_KEY, true);
  window.location.reload();
}

let started = false;

// Routes auth state to the screens. While signed out, the first render shows
// `firstSignedOutScreen`; every later one shows the login screen.
export function startSession(root: HTMLElement, firstSignedOutScreen: SignedOutScreen): void {
  if (started) return; // a second onAuthStateChanged listener would render twice
  started = true;

  let isFirstAuthLoad = firstSignedOutScreen === "landing";

  if (isSignInWithEmailLink(auth, window.location.href)) {
    // Route the signed-out state to the login screen (not the landing page)
    // so a failed link has somewhere to surface its error.
    isFirstAuthLoad = false;
    completeEmailLinkSignIn().catch(console.error);
  }

  getRedirectResult(auth)
    .catch((err: unknown) => {
      console.error("getRedirectResult:", err);
      if (auth.currentUser) return;
      showLoginError("Sign-in was interrupted — please try again.");
      // The user was mid sign-in: show the error on the login screen rather
      // than behind the landing page's "Get started", like a failed email link.
      if (isFirstAuthLoad) isFirstAuthLoad = false;
      else if (root.querySelector(".landing")) renderLogin(root);
    })
    .finally(() => setFlag(() => sessionStorage, PENDING_REDIRECT_KEY, false));

  let signedInHere = false;
  onAuthStateChanged(auth, (user) => {
    teardownApp();
    const wasSignedIn = signedInHere;
    signedInHere = user !== null;
    // Lets main.ts start Firebase right away on the next visit (and not at all
    // once signed out).
    setFlag(() => localStorage, SIGNED_IN_KEY, user !== null);
    // Signed in by any method: a remembered link address is no longer needed;
    // expired ones are dropped too so the address doesn't stay on the device.
    if (user || rememberedEmail() === null) forgetEmail();
    const firstLoad = isFirstAuthLoad;
    isFirstAuthLoad = false;
    if (!user && wasSignedIn) {
      void leaveSession(root);
      return;
    }
    if (user) {
      clearLoginError();
      renderApp(root, user);
    } else if (firstLoad) {
      renderLanding(root, () => renderLogin(root));
    } else {
      renderLogin(root);
    }
  });
}
