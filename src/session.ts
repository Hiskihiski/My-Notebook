import {
  getRedirectResult, onAuthStateChanged,
  isSignInWithEmailLink, signInWithEmailLink,
} from "firebase/auth";
import { auth } from "./firebase";
import { renderLanding } from "./landing";
import { renderLogin, EMAIL_FOR_SIGN_IN_KEY } from "./login";
import { renderApp, teardownApp } from "./app";
import { SIGNED_IN_KEY, PENDING_REDIRECT_KEY, setFlag, type SignedOutScreen } from "./boot";

// Only ever loaded via import() from main.ts, so it gets its own chunk:
// importing it starts Firebase (App Check first, see firebase.ts).

function showLoginError(msg: string): void {
  const show = (): void => {
    const el = document.getElementById("login-err");
    if (el) { el.textContent = msg; el.style.display = "block"; }
    else setTimeout(show, 100);
  };
  show();
}

// Completes passwordless sign-in when the page is opened from an emailed link.
async function completeEmailLinkSignIn(): Promise<void> {
  let email = localStorage.getItem(EMAIL_FOR_SIGN_IN_KEY);
  if (!email) {
    // Link was opened on a different device/browser than the one that requested it.
    email = window.prompt("Confirm your email to finish signing in:");
  }
  try {
    if (!email) throw new Error("Email confirmation cancelled.");
    await signInWithEmailLink(auth, email, window.location.href);
    localStorage.removeItem(EMAIL_FOR_SIGN_IN_KEY);
  } catch (err: unknown) {
    showLoginError(`Sign-in link failed: ${(err as Error).message ?? "unknown"}. Request a new link.`);
  } finally {
    // Strip the oobCode etc. from the address bar either way.
    window.history.replaceState(null, "", window.location.pathname);
  }
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
      showLoginError("Sign-in was interrupted — please try again.");
    })
    .finally(() => setFlag(() => sessionStorage, PENDING_REDIRECT_KEY, false));

  onAuthStateChanged(auth, (user) => {
    teardownApp();
    // Lets main.ts start Firebase right away on the next visit (and not at all
    // once signed out).
    setFlag(() => localStorage, SIGNED_IN_KEY, user !== null);
    const firstLoad = isFirstAuthLoad;
    isFirstAuthLoad = false;
    if (user) {
      renderApp(root, user);
    } else if (firstLoad) {
      renderLanding(root, () => renderLogin(root));
    } else {
      renderLogin(root);
    }
  });
}
