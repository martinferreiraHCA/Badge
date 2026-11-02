/* Badge Studio service worker: offline shell, network-first for HTML, cache-first for assets. */
const CACHE = 'badge-studio-v3';
const ASSETS = ['./', './index.html', './manifest.webmanifest', './css/app.css', './assets/icon.svg', './assets/icon-192.png', './assets/icon-512.png',
  './js/core.js', './js/jl-auth.js', './js/jpeg.js', './js/avi.js', './js/gif.js', './js/rcsp.js', './js/badge-client.js', './js/qr.js', './js/patterns.js', './js/textfx.js', './js/clock.js', './js/scene.js', './js/pixel.js', './js/games.js', './js/db.js', './js/app.js'];
self.addEventListener('install', (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => { e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  /* Network first for everything: a new deploy is picked up on the next reload; the cache is only the offline fallback. */
  e.respondWith(fetch(e.request).then((r) => { if (r.ok) { const copy = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); } return r; }).catch(() => caches.match(e.request).then((r) => r || (e.request.mode === 'navigate' ? caches.match('./index.html') : undefined))));
});
