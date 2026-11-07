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

## Styles (Tailwind build)

Pages use a prebuilt Tailwind stylesheet, `/css/app.css` (no Tailwind CDN script). It is generated from every page and script and **committed to git**, so Render serves it as-is — no build step runs on deploy.

```bash
npm run build:css   # one-off build -> css/app.css (minified)
npm run watch:css   # rebuild while you edit
```

- Run `npm run build:css` after adding or changing Tailwind classes anywhere (HTML, or HTML strings in `/js`), and commit `css/app.css` together with the change. A class that is missing from the build simply has no style.
- The scanner reads files as plain text: write class names whole. Never assemble one from pieces (`'bg-' + color`); pick between complete names instead (`ok ? 'bg-green-600' : 'bg-red-600'`).
- Theme extensions (Inter / Nunito fonts, `navy` colours) live in `tailwind.config.js`; target browsers (incl. iOS 14+) in the `browserslist` field of `package.json`.
- New pages: add `<link rel="stylesheet" href="/css/app.css" />` as the last tag in `<head>` (after other stylesheets, so utilities win ties as before).
- Alternative: set Render's build command to `npm install && npm run build:css` if you prefer building on deploy (the committed file is then overwritten by a fresh build).
