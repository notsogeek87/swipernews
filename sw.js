// Service worker de SwiperNews.
// Stratégie : on ne met en cache que l'app-shell same-origin (network-first avec
// repli hors-ligne). Les données et images tierces passent en direct pour éviter
// un cache non borné. Les anciens caches versionnés sont purgés à l'activation.
const CACHE = "flux-v2";

self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (e) =>
  e.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
      await self.clients.claim();
    })()
  )
);

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // pas de cache des origines tierces
  e.respondWith(
    fetch(req)
      .then((r) => {
        const copy = r.clone();
        caches
          .open(CACHE)
          .then((c) => c.put(req, copy))
          .catch(() => {});
        return r;
      })
      .catch(() => caches.open(CACHE).then((c) => c.match(req)))
  );
});
