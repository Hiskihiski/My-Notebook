# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Workflow

**Always analyze the codebase and present an execution plan before making code edits.** For anything beyond a trivial one-liner, read the relevant files first, then lay out the plan (files to touch, approach, edge cases) and get user confirmation before editing.

## Folder structure

```
webpage-v2/
├── src/
│   ├── main.ts          # Entry point: mounts #app, routes on onAuthStateChanged
│   ├── app.ts           # Signed-in notebook UI (cards, modals, Firestore sync, teardownApp)
│   ├── landing.ts       # First-load signed-out marketing screen
│   ├── login.ts         # Google / email+password / email-link / phone-OTP flows
│   ├── firebase.ts      # Firebase app, Firestore (persistent cache), Auth init
│   ├── markdown.ts      # renderMd (marked + DOMPurify), previewMd (regex)
│   ├── ui.ts            # $(), esc(), date formatters, toast, theme toggle
│   ├── types.ts         # Note / Tag / FilterType / SortOrder + display maps
│   ├── style.css        # All app styles + theme variables
│   ├── vite-env.d.ts
│   └── assets/          # Images referenced from CSS/TS
├── public/              # Static assets copied verbatim (favicon.svg, icons.svg)
├── index.html           # Vite entry HTML — loads /src/main.ts
├── firestore.rules      # Per-uid access rules for /notes/{noteId}
├── firebase.json        # Hosting → dist/, firestore rules pointer
├── .firebaserc          # Project id: my-notebook-web
├── vite.config.ts       # Vite + vite-plugin-pwa config
├── tsconfig.json        # Strict-ish TS, bundler resolution
└── eslint.config.js     # Flat config: js + typescript-eslint recommended
```

## Commands

- `npm run dev` — Vite dev server (HMR)
- `npm run build` — `tsc` type-check then `vite build` into `dist/`
- `npm run preview` — serve the built `dist/` locally
- `npm run lint` — ESLint (flat config, `typescript-eslint` recommended)

There is no test runner configured.

Firebase Hosting is wired up (`firebase.json` → `dist/`, project `my-notebook-web` in `.firebaserc`); deploy with `firebase deploy` when needed.

## Environment

`VITE_FIREBASE_API_KEY` must be set in `.env` (see `.env.example`). The rest of the Firebase config is hard-coded in `src/firebase.ts` — it's public by design; security is enforced by `firestore.rules` and Firebase Auth, not by hiding identifiers.

## Architecture

Single-page app, no framework. Everything is vanilla TS talking to Firebase directly. Rendering is `innerHTML` template strings; there is no virtual DOM.

**Entry & routing (`src/main.ts`)** — mounts to `#app` and listens on `onAuthStateChanged`. There are three top-level screens, chosen by auth state:
- `renderLanding` (first-load, signed-out) → marketing screen
- `renderLogin` (subsequent signed-out) → Google / email+password / email-link / phone-OTP flows
- `renderApp` (signed-in) → the notebook UI

The `isFirstAuthLoad` flag exists so a failed email-link sign-in surfaces on the login screen rather than the landing page. `main.ts` also handles the email-link completion path (`isSignInWithEmailLink` → `signInWithEmailLink`), stripping the `oobCode` from the URL either way.

**App shell (`src/app.ts`)** — holds all app state as module-level `let`s (`notes`, `filter`, `searchQuery`, `sortOrder`, `editingId`, `viewId`, `unsubNotes`, timers, keyboard handler). **`teardownApp()` must be called on every auth change** (including sign-out) — it unsubscribes the Firestore listener, clears timers, removes the global keydown handler, and resets state. Adding new listeners/timers means adding matching cleanup in `teardownApp`.

Notes are read via a live `onSnapshot` on `collection("notes") where uid == user.uid`. Sorting is client-side: pinned notes always float to the top, then newest/oldest/A–Z. Deletes are optimistic-with-undo via a toast (see `deleteNote`) — the doc is deleted immediately and re-`addDoc`'d if Undo is pressed (this generates a *new* doc id).

Unsaved new-note state is persisted to `localStorage["noteDraft"]` on every input so a reload or accidental dismiss doesn't lose work. Drafts are only saved for **new** notes (not edits) and cleared on successful save.

**Login (`src/login.ts`)** — one file with all five auth methods and a client-side brute-force guard (`bfMap`, 3 attempts → 60s lockout). The guard is UX only; Firebase enforces the real rate limit. The email-link flow writes `emailForSignIn` to `localStorage` so `main.ts` can complete the sign-in without re-prompting on the same device. Phone auth uses invisible `RecaptchaVerifier` bound to `#recaptcha-container`.

**Data model (`src/types.ts`)** — `Note { id, uid, title, body, tag: "work"|"ideas"|"personal", pinned, createdAt, updatedAt? }`. `TC`/`TL`/`FL`/`SORT_LABELS` are the display maps; keep them in sync if tags change. Firestore rules (`firestore.rules`) enforce `resource.data.uid == request.auth.uid` for every op — new documents must include `uid` or the write is rejected.

**Markdown (`src/markdown.ts`)** — `renderMd` uses `marked` (`breaks: true, gfm: true`) and pipes through `DOMPurify.sanitize`. Never render note content without sanitizing. `previewMd` is a cheaper regex-only preview used inside the card list; it escapes HTML manually and only surfaces bold/italic.

**Utilities (`src/ui.ts`)** — `$()` is a typed `getElementById`; `esc()` is HTML-escape (use it on every user-supplied string interpolated into template literals). Theme is stored in `localStorage["theme"]` and toggled via a floating `#theme-toggle` button injected into `<body>`.

## PWA

`vite-plugin-pwa` with `registerType: "autoUpdate"` generates a service worker. `navigateFallbackDenylist: [/^\/__/]` keeps Firebase Auth/Firestore endpoints out of the SW cache — don't broaden the precache glob to include those paths. Firestore itself is configured with `persistentLocalCache` + `persistentMultipleTabManager` in `src/firebase.ts` for offline reads.

## Conventions

- Templates are string-interpolated `innerHTML`. Any user-supplied string must go through `esc()` (and note bodies must go through `renderMd`/`previewMd`), not raw interpolation.
- TS is strict-ish: `noUnusedLocals`, `noUnusedParameters`, `verbatimModuleSyntax`, `erasableSyntaxOnly`. Prefix intentionally-unused params with `_` (ESLint `argsIgnorePattern: "^_"`).
- All CSS lives in `src/style.css`. Theme variables are `--text-s/--text-m/--pin/--err` etc.; prefer them over hard-coded colors.
