// Service worker de SwiperNews.
//
// Stratégie : app-shell same-origin en *stale-while-revalidate* — on peint
// immédiatement depuis le cache puis on rafraîchit en arrière-plan. L'ancienne
// stratégie network-first faisait attendre le réseau à chaque lancement, ce qui
// annulait l'argument « lancement en un tap » de l'app installée.
//
// Les réponses d'API ne sont JAMAIS mises en cache : /api/learn porte un
// paramètre différent à chaque lot, donc chaque appel créait une entrée neuve
// et le CacheStorage grandissait sans borne jusqu'à saturer le quota (ce qui
// finissait par faire évincer l'app-shell elle-même).
const CACHE = "flux-v3";
const SHELL = [
  "./",
  "./index.html",
  "./src/lib.js",
  "./src/learn-core.js",
  "./manifest.webmanifest",
  "./logo-192.png",
  "./logo-512.png",
];

self.addEventListener("install", (e) =>
  e.waitUntil(
    (async () => {
      const c = await caches.open(CACHE);
      // addAll échoue en bloc si une seule requête échoue : on tolère les manques.
      await Promise.all(SHELL.map((u) => c.add(u).catch(() => {})));
      await self.skipWaiting();
    })()
  )
);

self.addEventListener("activate", (e) =>
  e.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
      await self.clients.claim();
    })()
  )
);

// Permet à la page de déclencher la bascule de version sans rechargement forcé.
self.addEventListener("message", (e) => {
  if (e.data === "skip-waiting") self.skipWaiting();
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // pas de cache des origines tierces
  if (url.pathname.startsWith("/api/")) return; // données : toujours le réseau, jamais le cache

  e.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      const cached = await cache.match(req, { ignoreSearch: false });
      const network = fetch(req)
        .then((r) => {
          if (r && r.ok && r.type === "basic") cache.put(req, r.clone()).catch(() => {});
          return r;
        })
        .catch(() => null);

      // Cache d'abord (peinture immédiate), revalidation en arrière-plan.
      if (cached) return cached;
      const fresh = await network;
      if (fresh) return fresh;
      // Hors-ligne et pas en cache : on retombe sur la coquille pour une navigation.
      if (req.mode === "navigate") {
        const shell = await cache.match("./index.html");
        if (shell) return shell;
      }
      return Response.error();
    })()
  );
});
