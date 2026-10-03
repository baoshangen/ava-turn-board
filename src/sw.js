// Service worker — lets the board open when the salon Wi-Fi drops.
//
// NETWORK-FIRST for everything. An earlier version served code (app.js/styles.css)
// cache-first, which froze tablets on an old build: every deploy needed several
// reopens to take effect. Now, when online, the page always fetches the latest build
// and only falls back to the cache when the network actually fails (offline). The app
// also reloads once when a new worker takes over (see app.js) so fixes apply promptly.
//
// Never touched: /api/* (private, must be fresh — app.js keeps its own localStorage
// copy for offline viewing), /login and /auth-ui.js (no session material on disk).
//
// Bump CACHE_VERSION on any shell change so activate() purges the previous cache.

const CACHE_VERSION = 'ava-shell-v2';

// Pre-cached so the board still opens with no connection on the very first offline hit.
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

const OFFLINE_HTML =
  '<!doctype html><meta charset="utf-8"><title>Offline</title>' +
  '<body style="font:16px -apple-system,Segoe UI,sans-serif;padding:32px;text-align:center">' +
  '<h1 style="font-size:20px">Offline</h1>' +
  '<p>Open the board once while connected, then it will work without Wi-Fi.</p>';

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

// A redirect or error must never be stored: caching the /login redirect would pin
// every tablet to the sign-in page.
const storable = response => response && response.ok && response.type === 'basic';

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_VERSION);
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

  const html = isHTML(request);
  // Navigations resolve to the cached '/' shell; ignore the query string when matching.
  const key = html ? '/' : request;

  event.respondWith((async () => {
    try {
      const fresh = await fetch(request);
      if (storable(fresh)) {
        const cache = await caches.open(CACHE_VERSION);
        cache.put(key, fresh.clone());
      }
      return fresh;
    } catch (_) {
      const cached = await caches.match(key, { ignoreSearch: html });
      if (cached) return cached;
      if (html) return new Response(OFFLINE_HTML, { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
      return Response.error();
    }
  })());
});
