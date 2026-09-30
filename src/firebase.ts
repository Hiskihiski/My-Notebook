import { initializeApp } from "firebase/app";
import { initializeAppCheck, ReCaptchaEnterpriseProvider } from "firebase/app-check";
import {
  initializeFirestore, persistentLocalCache, persistentMultipleTabManager,
} from "firebase/firestore";
import { getAuth, GoogleAuthProvider } from "firebase/auth";

// This config is public by design — security is enforced by Firestore rules
// and Firebase Auth, not by hiding these identifiers. The API key is read from
// an env var so the (rotated, restricted) key lives in a gitignored .env rather
// than in source control.
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: "my-notebook-web.firebaseapp.com",
  projectId: "my-notebook-web",
  storageBucket: "my-notebook-web.firebasestorage.app",
  messagingSenderId: "774734979683",
  appId: "1:774734979683:web:137ae2206e6b0f59560e56",
  measurementId: "G-B8HHF0C91C",
};

// reCAPTCHA Enterprise site key (public). Its allowed domains are the two
// production hosts only — never localhost.
const RECAPTCHA_SITE_KEY = "6LdQQNYtAAAAALWqxc2O8UrAVw55rUvGiTWTYJ8S";

const fbApp = initializeApp(firebaseConfig);

// App Check must start before any other Firebase service so every request
// carries a token. `npm run dev` uses a debug token instead of reCAPTCHA: the
// SDK prints one to the console on first run — register it in the Firebase
// console (App Check → Apps → Manage debug tokens), or pin one via
// VITE_APPCHECK_DEBUG_TOKEN. Production builds never set a debug token.
if (import.meta.env.DEV) {
  self.FIREBASE_APPCHECK_DEBUG_TOKEN = import.meta.env.VITE_APPCHECK_DEBUG_TOKEN || true;
}
initializeAppCheck(fbApp, {
  provider: new ReCaptchaEnterpriseProvider(RECAPTCHA_SITE_KEY),
  isTokenAutoRefreshEnabled: true,
});

export const db = initializeFirestore(fbApp, {
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
});
export const auth      = getAuth(fbApp);
export const gProvider = new GoogleAuthProvider();
