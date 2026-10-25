import "./style.css";
import { $, initTheme, logoMark } from "./ui";
import { renderLanding } from "./landing";
import { dropExpiredSignInEmail } from "./email-link";
import {
  shouldBootFirebase, hasPersistedAuthUser, firstScreen, setFlag, SIGNED_OUT_KEY, type SignedOutScreen,
} from "./boot";

// Same spinner as #app-loading in index.html, but on the active theme's
// background (index.html's only follows the OS colour scheme).
const LOADING_HTML = `<div id="app-loading" style="background:var(--bg)"><span></span></div>`;

function renderLoadError(root: HTMLElement): void {
  root.innerHTML = `
    <main class="login-wrap" id="load-error">
      <div class="login-box">
        <div class="login-icon" aria-hidden="true">${logoMark()}</div>
        <h1>Notebook</h1>
        <div class="login-err" role="alert">Couldn't load Notebook. Check your connection and try again.</div>
        <button class="g-btn email-btn" id="load-retry">Try again</button>
      </div>
    </main>
  `;
  // A reload also picks up a new deploy if the old chunk is gone.
  $<HTMLButtonElement>("load-retry").addEventListener("click", () => window.location.reload());
}

// Firebase (App Check, Auth, Firestore) lives in the session chunk; until it
// is imported the page makes no third-party requests and creates no Firebase
// storage (no App Check, no reCAPTCHA cookie, no IndexedDB).
async function bootFirebase(root: HTMLElement, firstSignedOutScreen: SignedOutScreen): Promise<void> {
  try {
    const { startSession } = await import("./session");
    startSession(root, firstSignedOutScreen);
  } catch (err: unknown) {
    console.error("Loading the app failed:", err);
    renderLoadError(root);
  }
}

async function startApp(): Promise<void> {
  const root = document.querySelector<HTMLElement>("#app");
  if (!root) { setTimeout(() => void startApp(), 10); return; }

  initTheme();
  dropExpiredSignInEmail(() => localStorage, Date.now());

  // Signed in last time, opening an emailed sign-in link or returning from the
  // Google redirect: start Firebase straight away (index.html's spinner stays
  // up). The IndexedDB check finds sessions from before the signedIn flag.
  if (shouldBootFirebase(window.location.search, () => localStorage, () => sessionStorage)
      || await hasPersistedAuthUser(import.meta.env.VITE_FIREBASE_API_KEY)) {
    const screen = firstScreen(() => sessionStorage);
    setFlag(() => sessionStorage, SIGNED_OUT_KEY, false); // one reload only
    await bootFirebase(root, screen);
    return;
  }

  renderLanding(root, () => {
    root.innerHTML = LOADING_HTML;
    void bootFirebase(root, "login");
  });
}

void startApp();
