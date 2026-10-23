# Notebook

A calm, focused place for your thoughts: a markdown notes web app with tags, pinning and instant search, synced across devices and usable offline.

Live: <https://my-notebook-web.web.app>

## Features

- Markdown notes (rendered with `marked`, sanitized with DOMPurify)
- Tags (work, ideas, personal), pinned notes, sorting, instant search
- Sign in with Google, email + password, or a passwordless email link
- Offline support: installable PWA, Firestore offline cache
- Light and dark theme

## Stack

Vanilla TypeScript and Vite, no framework. Firebase 12 (Auth, Cloud Firestore, App Check with reCAPTCHA Enterprise) on Firebase Hosting. See [`CLAUDE.md`](CLAUDE.md) for the architecture and conventions.

Privacy by design: a first-time visitor's landing page loads no third-party code. Firebase (and with it App Check/reCAPTCHA) only starts after "Get started" or for a visitor who is already signed in.

## Setup

Requirements: Node.js 22 and npm.

```sh
npm ci
cp .env.example .env   # then set VITE_FIREBASE_API_KEY
npm run dev
```

`npm run dev` uses an App Check debug token; see `CLAUDE.md` → Environment for registering it.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Vite dev server |
| `npm run build` | Type-check and build into `dist/` |
| `npm run preview` | Serve the built `dist/` |
| `npm run lint` | ESLint |
| `npm test` | Unit tests (Vitest, jsdom) |
| `npm run test:rules` | Firestore rules tests against the emulator (needs the Firebase CLI and Java 21+) |

CI (`.github/workflows/ci.yml`) runs lint, unit tests, the build, a bundle-size budget (`scripts/check-bundle.mjs`) and the rules tests on every push to `main` and every pull request.

## Deploy

```sh
npm run build
firebase deploy        # hosting + firestore rules, project my-notebook-web
```

Security headers, caching and the 404 page are configured in `firebase.json`.

## Legal

The static pages `public/impressum.html` and `public/datenschutz.html` are templates: fill in the `[PLACEHOLDERS]` and have them reviewed before publishing.

## Security

See [SECURITY.md](SECURITY.md) for how to report a vulnerability.
