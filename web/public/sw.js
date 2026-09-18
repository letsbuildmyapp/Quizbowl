// QuizQuest service worker: cache-first for art and built assets (fast world
// loads on school Wi-Fi), network-first for the app shell, never cache Firebase.
const VERSION = 'qq-v1';
const ART = /\/(art|icons|assets)\//;

self.addEventListener('install', (e) => {
  self.skipWaiting();
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(['/', '/art/owl.png', '/art/island-map.webp'])).catch(() => {}));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== self.location.origin) return;
  if (ART.test(url.pathname)) {
    e.respondWith(
      caches.match(e.request).then(
        (hit) =>
          hit ||
          fetch(e.request).then((res) => {
            if (res.ok) caches.open(VERSION).then((c) => c.put(e.request, res.clone()));
            return res;
          })
      )
    );
    return;
  }
  if (e.request.mode === 'navigate') {
    e.respondWith(fetch(e.request).catch(() => caches.match('/')));
  }
});
