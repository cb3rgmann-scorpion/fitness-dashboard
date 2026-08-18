/* ============================================================
   Service worker — Fitness Dashboard
   Added 2026-08-18 (task #11).

   Caching strategy, and the reasoning behind it:

   • index.html → NETWORK FIRST, cache as fallback.
     The app is one ~900KB HTML file that changes every session. Cache-first
     would mean shipping a fix and Craig still seeing the old build until the
     cache happened to expire — the classic "why isn't my change live" PWA trap.
     Network-first means an online launch is always current, and an offline
     launch still works from the last good copy.

   • CDN libraries → CACHE FIRST.
     supabase-js and jszip are versioned URLs that never change contents, so
     re-fetching them costs load time for nothing.

   • Icons / manifest → CACHE FIRST.

   • Everything else (Supabase API, Concept2) → NOT CACHED.
     Never cache API responses here. The app has its own localStorage buffer
     with sync logic; a second, dumber cache layer underneath it would serve
     stale rows and be very hard to debug.

   Bump CACHE_VERSION on any change to this file or the cached asset list.
   ============================================================ */

const CACHE_VERSION = 'fitness-v1-20260818';
const APP_SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icon-192.png',
  './icon-512.png',
  './icon-maskable-512.png',
  './apple-touch-icon.png',
  './favicon-32.png',
];

// Cache-first hosts: immutable, versioned library URLs.
const CDN_HOSTS = ['cdn.jsdelivr.net', 'cdnjs.cloudflare.com'];

// Never cache: live data.
const NEVER_CACHE = ['supabase.co', 'concept2.com', 'log.concept2.com'];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_VERSION)
      // addAll rejects the whole install if ANY file 404s, which would leave the
      // app permanently uninstallable. Individual puts degrade gracefully instead.
      .then(cache => Promise.allSettled(APP_SHELL.map(u => cache.add(u))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE_VERSION).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', event => {
  // Lets the page force an update without the user hunting through settings.
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;

  let url;
  try { url = new URL(req.url); } catch (e) { return; }

  // Live data — straight to the network, never touched by the cache.
  if (NEVER_CACHE.some(h => url.hostname.indexOf(h) !== -1)) return;

  // Versioned CDN libraries — cache first.
  if (CDN_HOSTS.indexOf(url.hostname) !== -1) {
    event.respondWith(
      caches.match(req).then(hit => hit || fetch(req).then(res => {
        if (res && res.status === 200) {
          const copy = res.clone();
          caches.open(CACHE_VERSION).then(c => c.put(req, copy));
        }
        return res;
      }).catch(() => hit))
    );
    return;
  }

  // Same-origin only beyond this point.
  if (url.origin !== self.location.origin) return;

  const isDoc = req.mode === 'navigate' || url.pathname.endsWith('.html') || url.pathname.endsWith('/');

  if (isDoc) {
    // Network first — a deploy must never be stuck behind a stale cache.
    event.respondWith(
      fetch(req).then(res => {
        if (res && res.status === 200) {
          const copy = res.clone();
          caches.open(CACHE_VERSION).then(c => c.put(req, copy));
        }
        return res;
      }).catch(() =>
        caches.match(req).then(hit => hit || caches.match('./index.html'))
      )
    );
    return;
  }

  // Static assets (icons, csv fallback) — cache first, refresh in background.
  event.respondWith(
    caches.match(req).then(hit => {
      const net = fetch(req).then(res => {
        if (res && res.status === 200) {
          const copy = res.clone();
          caches.open(CACHE_VERSION).then(c => c.put(req, copy));
        }
        return res;
      }).catch(() => hit);
      return hit || net;
    })
  );
});
