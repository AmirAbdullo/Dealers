# CarFox

CarFox is a mobile-first app concept where sellers list and sell cars online.

## Current project status

- `index.html` contains the new CarFox home page.
- `login.html` contains a clean CarFox sign-in starter page.
- Old property/backend code has been removed.

## Run locally

### Accounts saved on the server (recommended)

Sign up / sign in use **SQLite** (`carfox.db`) so the same email and password work from **any device** that opens your app through **this Node server** (for example your PC and phone on Wi‑Fi using `http://YOUR-PC-IP:3000`).

```bash
npm install
npm start
```

Then open **http://localhost:3000** (same port for every page).

### Static preview only (no shared database)

```bash
py -m http.server 5500
```

Accounts in the browser only (`localStorage`) are **not** shared between `file://`, `localhost`, and `127.0.0.1`, or between different ports.
