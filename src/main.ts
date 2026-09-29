import "./style.css";
import {
  getRedirectResult, onAuthStateChanged,
  isSignInWithEmailLink, signInWithEmailLink,
} from "firebase/auth";
import { auth } from "./firebase";
import { initTheme } from "./ui";
import { renderLanding } from "./landing";
import { renderLogin, EMAIL_FOR_SIGN_IN_KEY } from "./login";
import { renderApp, teardownApp } from "./app";

let isFirstAuthLoad = true;

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

function startApp(): void {
  const root = document.querySelector<HTMLElement>("#app");
  if (!root) { setTimeout(startApp, 10); return; }

  initTheme();

  if (isSignInWithEmailLink(auth, window.location.href)) {
    // Route the signed-out state to the login screen (not the landing page)
    // so a failed link has somewhere to surface its error.
    isFirstAuthLoad = false;
    completeEmailLinkSignIn().catch(console.error);
  }

  getRedirectResult(auth).catch((err: unknown) => {
    console.error("getRedirectResult:", err);
    showLoginError("Sign-in was interrupted — please try again.");
  });

  onAuthStateChanged(auth, (user) => {
    teardownApp();
    const firstLoad = isFirstAuthLoad;
    isFirstAuthLoad = false;
    if (user) {
      renderApp(root, user);
    } else if (firstLoad) {
      renderLanding(root);
    } else {
      renderLogin(root);
    }
  });
}

startApp();
