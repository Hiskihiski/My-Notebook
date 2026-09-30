/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_FIREBASE_API_KEY: string;
  readonly VITE_APPCHECK_DEBUG_TOKEN?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

// Read by the App Check SDK in dev builds (see src/firebase.ts).
// eslint-disable-next-line no-var -- only `var` extends globalThis
declare var FIREBASE_APPCHECK_DEBUG_TOKEN: boolean | string | undefined;
