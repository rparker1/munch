/* ==========================================================================
   Service worker.
   Navigations: network first, cached shell as the fallback, so a new deploy
   is picked up as soon as there is a connection but the app still opens
   offline. Assets: stale-while-revalidate.
   ========================================================================== */

const VERSION = 'munch-v1';
const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/app.css',
  './js/app.js',
  './js/store.js',
  './js/ui.js',
  './js/util.js',
  './js/icons.js',
  './js/views/today.js',
  './js/views/plan.js',
  './js/views/inventory.js',
  './js/views/shop.js',
  './js/editors/meal.js',
  './js/editors/item.js',
  './js/editors/shop.js',
  './icons/favicon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
];

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(VERSION);
    // Individually, so one 404 cannot fail the whole install.
    await Promise.all(SHELL.map(url => cache.add(url).catch(() => {})));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter(n => n !== VERSION).map(n => caches.delete(n)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const fresh = await fetch(request);
        const cache = await caches.open(VERSION);
        cache.put('./index.html', fresh.clone());
        return fresh;
      } catch {
        const cache = await caches.open(VERSION);
        return (await cache.match('./index.html'))
          || (await cache.match('./'))
          || Response.error();
      }
    })());
    return;
  }

  event.respondWith((async () => {
    const cache = await caches.open(VERSION);
    const hit = await cache.match(request);

    const network = fetch(request)
      .then(res => {
        if (res && res.ok) cache.put(request, res.clone());
        return res;
      })
      .catch(() => null);

    if (hit) return hit;
    const res = await network;
    return res || new Response('Offline', { status: 503, statusText: 'Offline' });
  })());
});

self.addEventListener('message', event => {
  if (event.data === 'skipWaiting') self.skipWaiting();
});
