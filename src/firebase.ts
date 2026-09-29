import { initializeApp } from "firebase/app";
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

const fbApp = initializeApp(firebaseConfig);

export const db = initializeFirestore(fbApp, {
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
});
export const auth      = getAuth(fbApp);
export const gProvider = new GoogleAuthProvider();
