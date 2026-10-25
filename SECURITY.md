# Security policy

## Reporting a vulnerability

Please report security issues privately through GitHub: open the repository's **Security** tab and choose **Report a vulnerability** (or go to <https://github.com/Hiskihiski/My-Notebook/security/advisories/new>). Don't open a public issue for security problems.

Include what you found, how to reproduce it and the impact you expect. You'll get an answer as soon as possible; this is a small project without a bug bounty.

## Scope

- The web app at <https://my-notebook-web.web.app> (and the same app on `my-notebook-web.firebaseapp.com`)
- This repository, including `firestore.rules` and `firebase.json`

Firebase web config values (API key, project ID, App Check site key) are public by design; access is enforced by Firestore security rules and Firebase Auth. Please only test against your own account and data, and don't run load or brute-force tests.
