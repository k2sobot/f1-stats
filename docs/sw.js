const ASSETS_TO_CACHE = [
  '/',
  '/index.html',
  '/assets/css/style.css',
  '/assets/js/app.js',
  '/assets/favicon.svg',
  '/assets/icon-192.png',
  '/assets/icon-192.svg',
  '/assets/icon-512.png',
  '/manifest.json'
];

// Cache week starts Monday 01:00 SAST (UTC+2, no daylight saving).
const SAST_OFFSET_MS = 2 * 60 * 60 * 1000;

function cacheName(date = new Date()) {
  const sast = new Date(date.getTime() + SAST_OFFSET_MS);
  const day = sast.getUTCDay();
  let daysBack = (day + 6) % 7;
  if (day === 1 && sast.getUTCHours() < 1) daysBack = 7;
  const boundary = new Date(sast.getTime() - daysBack * 24 * 60 * 60 * 1000);
  const y = boundary.getUTCFullYear();
  const m = String(boundary.getUTCMonth() + 1).padStart(2, '0');
  const d = String(boundary.getUTCDate()).padStart(2, '0');
  return `f1-stats-${y}${m}${d}`;
}

function purgeOldCaches() {
  const current = cacheName();
  return caches.keys()
    .then((names) => Promise.all(
      names.filter((name) => name !== current).map((name) => caches.delete(name))
    ))
    .then(() => current);
}

function isShellRequest(request) {
  if (request.method !== 'GET') return false;
  if (request.mode === 'navigate') return true;
  const url = new URL(request.url);
  return /\.(?:html|css|js)$/.test(url.pathname);
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(cacheName())
      .then((cache) => cache.addAll(ASSETS_TO_CACHE))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    purgeOldCaches()
      .then((current) => self.clients.claim().then(() => current))
      .then((current) => self.clients.matchAll({ type: 'window' }))
      .then((clients) => {
        clients.forEach((client) => client.postMessage({ type: 'SW_UPDATED', cache: cacheName() }));
      })
  );
});

function isDataRequest(request) {
  const url = new URL(request.url);
  return url.pathname.startsWith('/data/');
}

function isAnalyticsRequest(request) {
  const url = new URL(request.url);
  return url.hostname === 'gc.zgo.at' || url.hostname.endsWith('goatcounter.com');
}

function store(request, response) {
  if (!response || response.status !== 200) return;
  const copy = response.clone();
  caches.open(cacheName()).then((cache) => cache.put(request, copy));
}

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  if (isAnalyticsRequest(event.request)) return;

  event.waitUntil(purgeOldCaches());

  if (isShellRequest(event.request) || isDataRequest(event.request)) {
    event.respondWith(
      fetch(event.request)
        .then((networkResponse) => {
          store(event.request, networkResponse);
          return networkResponse;
        })
        .catch(() => caches.match(event.request).then((cached) => cached || caches.match('/')))
    );
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cached) => {
      const networked = fetch(event.request)
        .then((networkResponse) => {
          store(event.request, networkResponse);
          return networkResponse;
        })
        .catch(() => cached);
      return cached || networked;
    })
  );
});
