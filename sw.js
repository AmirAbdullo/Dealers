/*
 * CarFox service worker.
 *
 * The server serves this file with __CACHE_VERSION__ replaced by the deploy's git commit (or the
 * server start time), so every deploy installs a fresh worker with a fresh cache and the old one is
 * removed on activation. Strategy:
 *   - pages (navigations): network first; the /offline.html fallback only when the network fails
 *   - /api/*: never intercepted (always live)
 *   - static shell (/css, /js, /icons, manifest): cached, served immediately and refreshed in the
 *     background (stale-while-revalidate) so loads are fast and never permanently stale
 */
const VERSION = '__CACHE_VERSION__';
const SHELL_CACHE = 'carfox-shell-' + VERSION;
const SHELL = [
  '/offline.html',
  '/manifest.webmanifest',
  '/css/app.css',
  '/css/carfox-brand.css',
  '/js/carfox-auth.js',
  '/js/carfox-buyer-nav.js',
  '/js/carfox-card.js',
  '/js/carfox-trust.js',
  '/js/carfox-value.js',
  '/js/carfox-track.js',
  '/js/carfox-suggest.js',
  '/js/carfox-scroll-row.js',
  '/js/carfox-quick-search.js',
  '/js/carfox-pwa.js',
  '/js/i18n/i18n.js',
  '/js/i18n/en.json',
  '/js/i18n/ar.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/apple-touch-icon.png'
];

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(SHELL_CACHE).then(function (cache) {
      // One missing asset must not block the install: add each file on its own.
      return Promise.all(SHELL.map(function (url) {
        return cache.add(new Request(url, { cache: 'reload' })).catch(function () {});
      }));
    }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k.indexOf('carfox-shell-') === 0 && k !== SHELL_CACHE; }).map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

function isShellAsset(url) {
  return /^\/(css|js|icons)\//.test(url.pathname) || url.pathname === '/manifest.webmanifest' || url.pathname === '/offline.html';
}

self.addEventListener('fetch', function (event) {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req).catch(function () {
        return caches.match('/offline.html').then(function (res) { return res || Response.error(); });
      })
    );
    return;
  }

  if (url.pathname.indexOf('/api/') === 0 || url.pathname === '/sw.js') return;
  if (!isShellAsset(url)) return;

  event.respondWith(
    caches.open(SHELL_CACHE).then(function (cache) {
      return cache.match(req).then(function (cached) {
        const network = fetch(req).then(function (res) {
          if (res && res.ok) cache.put(req, res.clone());
          return res;
        }).catch(function () { return null; });
        if (cached) {
          event.waitUntil(network);
          return cached;
        }
        return network.then(function (res) { return res || Response.error(); });
      });
    })
  );
});

self.addEventListener('message', function (event) {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});
