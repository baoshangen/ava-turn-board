// Service worker — lets the board open when the salon Wi-Fi drops.
//
// Design notes (read before changing):
//  * HTML is NETWORK-FIRST. Getting this wrong is how a PWA gets stuck serving a
//    stale build forever, which is unfixable from the salon's side. With
//    network-first, a push to `main` reaches every tablet on the next online load.
//  * /api/* is never touched. Board data is private, must be fresh, and app.js
//    already keeps its own localStorage copy for offline viewing.
//  * /login and /api/auth/* are never cached — no session material on disk.
//  * skipWaiting + clients.claim so a new build takes over immediately instead of
//    waiting for every tab to close.
//
// Bump CACHE_VERSION whenever a shell asset changes shape; old caches are dropped
// on activate anyway, but the bump makes the swap immediate.

const CACHE_VERSION = 'ava-shell-v1';

// Everything needed to paint the board with no connection.
const SHELL = [
  '/',
  '/app.js',
  '/merge.js',
  '/sortable.min.js',
  '/styles.css',
  '/manifest.webmanifest',
  '/icon-192.png',
  '/icon-512.png',
  '/apple-touch-icon.png',
];

const isHTML = request =>
  request.mode === 'navigate' ||
  (request.headers.get('Accept') || '').includes('text/html');

// Only same-origin GETs are cacheable, and never the API or auth surfaces.
function cacheable(url, request) {
  if (request.method !== 'GET') return false;
  if (url.origin !== self.location.origin) return false;
  if (url.pathname.startsWith('/api/')) return false;
  if (url.pathname === '/login' || url.pathname === '/auth-ui.js') return false;
  return true;
}

// A redirect or error must never be stored: caching the /login redirect would
// pin every tablet to the sign-in page.
const storable = response => response && response.ok && response.type === 'basic';

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_VERSION);
    // Settle individually: a signed-out install would fail addAll() outright and
    // leave no cache at all.
    await Promise.allSettled(SHELL.map(async path => {
      const response = await fetch(path, { cache: 'reload' });
      if (storable(response)) await cache.put(path, response);
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter(n => n !== CACHE_VERSION).map(n => caches.delete(n)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);
  if (!cacheable(url, request)) return; // straight to the network, untouched

  if (isHTML(request)) {
    // Network-first: always prefer a fresh build, fall back to the saved shell.
    event.respondWith((async () => {
      try {
        const fresh = await fetch(request);
        if (storable(fresh)) {
          const cache = await caches.open(CACHE_VERSION);
          cache.put('/', fresh.clone());
        }
        return fresh;
      } catch (_) {
        const cached = await caches.match('/', { ignoreSearch: true });
        return cached || new Response(
          '<!doctype html><meta charset="utf-8"><title>Offline</title>' +
          '<body style="font:16px -apple-system,Segoe UI,sans-serif;padding:32px;text-align:center">' +
          '<h1 style="font-size:20px">Offline</h1>' +
          '<p>Open the board once while connected, then it will work without Wi-Fi.</p>',
          { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
        );
      }
    })());
    return;
  }

  // Static assets: serve from cache at once, refresh in the background.
  event.respondWith((async () => {
    const cached = await caches.match(request);
    const network = fetch(request).then(async response => {
      if (storable(response)) {
        const cache = await caches.open(CACHE_VERSION);
        cache.put(request, response.clone());
      }
      return response;
    }).catch(() => null);
    return cached || (await network) || Response.error();
  })());
});
