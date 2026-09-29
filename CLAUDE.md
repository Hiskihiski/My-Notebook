# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Workflow

**Always analyze the codebase and present an execution plan before making code edits.** For anything beyond a trivial one-liner, read the relevant files first, then lay out the plan (files to touch, approach, edge cases) and get user confirmation before editing.

## Commands

- `npm run dev` — Vite dev server (HMR)
- `npm run build` — `tsc` type-check then `vite build` into `dist/` (type errors fail the build)
- `npm run preview` — serve the built `dist/` locally
- `npm run lint` — ESLint (flat config, `typescript-eslint` recommended)

There is no test runner configured.

Firebase Hosting is wired up (`firebase.json` → `dist/`, project `my-notebook-web` in `.firebaserc`); deploy with `firebase deploy` when needed.

## Environment

`VITE_FIREBASE_API_KEY` must be set in `.env` (copy `.env.example`). The key must be the one Firebase associates with the web app ("Browser key (auto-created by Firebase)" in Cloud Console → Credentials), restricted to the hosting domains + localhost and to Firestore / Identity Toolkit / Token Service APIs. Google sign-in's popup (`<authDomain>/__/auth/handler`) reads the key from Firebase's `/__/firebase/init.json`, not from our bundle — so deleting that key breaks Google sign-in even if `.env` holds a valid one. The rest of the Firebase config is hard-coded in `src/firebase.ts` — it's public by design; security is enforced by `firestore.rules` and Firebase Auth, not by hiding identifiers.

## Architecture

Single-page app, no framework. Everything is vanilla TS talking to Firebase directly. Rendering is `innerHTML` template strings; there is no virtual DOM. All source is in `src/`; all CSS is in `src/style.css`.

**Entry & routing (`src/main.ts`)** — mounts to `#app` and listens on `onAuthStateChanged`. Three top-level screens, chosen by auth state:
- `renderLanding` (first-load, signed-out) → marketing screen
- `renderLogin` (subsequent signed-out) → Google / email+password / email-link flows
- `renderApp` (signed-in) → the notebook UI

The `isFirstAuthLoad` flag exists so a failed email-link sign-in surfaces on the login screen rather than the landing page. `main.ts` also handles the email-link completion path (`isSignInWithEmailLink` → `signInWithEmailLink`), stripping the `oobCode` from the URL either way.

**App shell (`src/app.ts`)** — holds all app state as module-level `let`s (`notes`, `filter`, `searchQuery`, `sortOrder`, `editingId`, `viewId`, `unsubNotes`, timers, keyboard handler). **`teardownApp()` must be called on every auth change** (including sign-out) — it unsubscribes the Firestore listener, clears timers, removes the global keydown handler, and resets state. Adding new listeners/timers means adding matching cleanup in `teardownApp`.

Notes are read via a live `onSnapshot` on `collection("notes") where uid == user.uid`. Sorting is client-side: pinned notes always float to the top, then newest/oldest/A–Z. Deletes are optimistic-with-undo via a toast (see `deleteNote`) — the doc is deleted immediately and re-`addDoc`'d if Undo is pressed (this generates a *new* doc id).

Writes (`saveNote`, `deleteNote`) are **not awaited**: Firestore applies them to the local cache immediately (so `onSnapshot` updates the list) but only settles the promise once the server confirms, which never happens offline. The UI closes/confirms right away and only a `.catch` reports failures; keep new writes on that pattern or offline saves hang.

Unsaved new-note state is persisted to `localStorage["noteDraft:<uid>"]` on every input so a reload or accidental dismiss doesn't lose work. Drafts are per user (the key is set in `renderApp`, reset in `teardownApp`), only saved for **new** notes, cleared when a save is issued and on explicit sign-out, and written back if a save is later rejected.

**Login (`src/login.ts`)** — one file with all three auth methods and a client-side brute-force guard (`bfMap`, 3 attempts → 60s lockout). The guard is UX only; Firebase enforces the real rate limit. The email-link flow writes `emailForSignIn` to `localStorage` so `main.ts` can complete the sign-in without re-prompting on the same device. Phone/SMS sign-in was removed: it needs the paid Blaze plan (`BILLING_NOT_ENABLED` on Spark).

**Data model (`src/types.ts`)** — `Note { id, uid, title, body, tag: "work"|"ideas"|"personal", pinned, createdAt, updatedAt? }`. `TC`/`TL`/`FL`/`SORT_LABELS` are the display maps; keep them in sync if tags change. `firestore.rules` restricts every op to the note's owner and also validates the schema: creates must have exactly these fields (`updatedAt` optional) with `uid == request.auth.uid`, title ≤ 200 / body ≤ 20000 chars, a known tag, and a Firestore auto-ID; updates may only touch `title/body/tag/pinned/updatedAt`, so `uid` is immutable. Adding a field to `Note` means updating the rules too, or writes get rejected. `createdAt` is only checked to be a timestamp because Undo re-creates notes with their original timestamps.

**Markdown (`src/markdown.ts`)** — `renderMd` uses `marked` (`breaks: true, gfm: true`) and pipes through `DOMPurify.sanitize`. Never render note content without sanitizing. `previewMd` is a cheaper regex-only preview used in the card list; it escapes HTML manually and only surfaces bold/italic.

**Utilities (`src/ui.ts`)** — `$()` is a typed `getElementById`; `esc()` is HTML-escape. Theme is stored in `localStorage["theme"]` and toggled via a floating `#theme-toggle` button injected into `<body>`.

## PWA

`firebase.json` sets a Content-Security-Policy plus X-Frame-Options/nosniff/Referrer-Policy/Permissions-Policy on `/` and `/index.html` only — never on `/**`, because Firebase serves the Google sign-in handler from `/__/auth/*` on our own domain and those headers would break it. Loading anything from a new external host (script, API, iframe, image host is already `https:`) means extending the CSP. Don't add `Cross-Origin-Opener-Policy` (breaks `signInWithPopup`) or `Referrer-Policy: no-referrer` (the API key's website restriction checks the referrer). `/assets/**` is cached for a year (hashed names); `index.html`, `sw.js`, `registerSW.js` and the manifest are `no-cache`.

`vite-plugin-pwa` with `registerType: "autoUpdate"` generates a service worker. `navigateFallbackDenylist: [/^\/__/]` keeps Firebase Auth/Firestore endpoints out of the SW cache — don't broaden the precache glob to include those paths. Firestore itself uses `persistentLocalCache` + `persistentMultipleTabManager` in `src/firebase.ts` for offline reads.

## Conventions

- Any user-supplied string interpolated into a template literal must go through `esc()`; note bodies must go through `renderMd`/`previewMd`, never raw interpolation.
- TS is strict-ish: `noUnusedLocals`, `noUnusedParameters`, `verbatimModuleSyntax`, `erasableSyntaxOnly`. Prefix intentionally-unused params with `_` (ESLint `argsIgnorePattern: "^_"`).
- Theme variables are `--text-s/--text-m/--pin/--err` etc.; prefer them over hard-coded colors.
- `@emailjs/browser` is listed in dependencies but currently unused in `src/`.
- `firebase` is pinned to exactly `12.14.0`: from 12.15 on, Firestore bundles `re2js` (~56 kB gzip, unused here), growing the main chunk ~37%. Compare bundle size before raising the pin.
- `.claude/skills/emil-design-eng/` is a vendored skill tracked by `skills-lock.json`; don't edit it by hand.
