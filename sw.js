/* ==========================================================================
   Service worker.

   Network first for everything, with the cache as a pure offline fallback, so a
   deploy lands the moment there is a connection and the app still opens with no
   connection at all. Every network request carries a per-deploy build tag,
   because on GitHub Pages that is the only way past the HTTP cache — see
   `tagged()` below.
   ========================================================================== */

/* Stamped with the commit SHA by .github/workflows/pages.yml at deploy time.
   Leave it as 'dev' here; nothing local depends on it being unique. */
const BUILD = 'dev';

const VERSION = `munch-${BUILD}`;

/**
 * The same URL carrying the build tag.
 *
 * GitHub Pages serves assets with `Cache-Control: max-age=600` and those headers
 * cannot be configured. A worker cannot get around them either: `fetch(url,
 * { cache: 'reload' })` is silently ignored inside a service worker in Chromium,
 * so for ten minutes after a deploy "go to the network" hands back the previous
 * file and an installed app keeps booting the old version.
 *
 * Asking for a URL the HTTP cache has never seen is the way through. The tag
 * changes every deploy, so the first request for each asset is guaranteed to miss
 * the cache and hit the origin; Pages ignores the unknown query and serves the
 * file. The response is then stored under the *original* request, so the page and
 * the offline fallback never see the tag.
 */
function tagged(url) {
  const u = new URL(url, self.location.href);
  u.searchParams.set('b', BUILD);
  return u.toString();
}
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
  './js/charts.js',
  './js/config.js',
  './js/cloud.js',
  './js/sync.js',
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
    // Individually, so one missing file cannot fail the whole install.
    await Promise.all(SHELL.map(async url => {
      try {
        const res = await fetch(tagged(url), { credentials: 'same-origin' });
        if (res.ok) await cache.put(url, res);
      } catch { /* offline at install time; the fetch handler will fill it in */ }
    }));
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
        // A navigate-mode Request cannot be re-created, so rebuild it from the
        // URL to be able to set the cache mode. See the note below on why.
        const fresh = await fetch(tagged(request.url), {
          credentials: 'same-origin',
          redirect: 'follow',
        });
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

  // Network first, cache as the offline fallback.
  //
  // Not cache-first. The usual advice is to serve assets from the cache and
  // revalidate behind it, but then a fresh index.html loads alongside the
  // previous stylesheet and modules, and the app renders the old version until
  // some later visit. These files are tens of kB behind HTTP/2, so going to the
  // network costs little, and the cache still covers being offline completely.
  event.respondWith((async () => {
    const cache = await caches.open(VERSION);
    try {
      const fresh = await fetch(tagged(request.url), { credentials: 'same-origin' });
      if (fresh && fresh.ok) cache.put(request, fresh.clone());
      return fresh;
    } catch {
      const hit = await cache.match(request);
      return hit || new Response('Offline', { status: 503, statusText: 'Offline' });
    }
  })());
});

self.addEventListener('message', event => {
  if (event.data === 'skipWaiting') self.skipWaiting();
});
