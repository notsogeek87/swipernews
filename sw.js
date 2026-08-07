// Service worker de SwiperNews.
//
// RÈGLE CENTRALE : `index.html` et les modules `src/*.js` forment un ENSEMBLE
// INDIVISIBLE. Servir un index.html neuf avec un src/lib.js périmé (ou
// l'inverse) casse l'app entièrement. Deux garde-fous, redondants à dessein :
//
//   1. index.html est servi RÉSEAU D'ABORD (le cache ne sert que hors-ligne).
//      Un cache-first sur la coquille gagnait quelques centaines de
//      millisecondes au lancement au prix d'un risque de version mélangée :
//      mauvais échange.
//   2. index.html demande ses modules avec `?v=<VERSION>` (voir APP_VERSION
//      dans index.html). Une version différente est une URL différente, donc
//      une entrée de cache différente : un module périmé ne peut pas être
//      servi à un index.html neuf, même si le cache n'a pas été purgé.
//
// Les assets réellement immuables (icônes, manifeste) restent en cache d'abord.
// Les réponses d'API ne sont jamais mises en cache : /api/learn porte un
// paramètre variable, donc chaque appel créerait une entrée neuve.
//
// À CHAQUE modification de index.html ou de src/*.js : incrémenter APP_VERSION
// dans index.html ET CACHE ci-dessous (garder les deux numéros alignés).
const CACHE = "flux-v58";

// Mis en cache à l'installation : uniquement ce qui ne dépend pas de la version.
// Les logos portent `?v=` comme les modules `src/*.js` : `/logo-*.png` est
// servi en Cache-Control immutable un an (vercel.json), donc un changement de
// contenu à URL identique resterait invisible en cache HTTP jusqu'à expiration
// — même après un bump de CACHE ci-dessus, qui ne purge que le cache du SW.
// Plus de polices ici : l'app est passée aux polices système (v52), donc
// plus aucun fichier fonts/*.woff2 n'est chargé.
const SHELL = [
  "./logo-192.png?v=42",
  "./logo-512.png?v=42",
  "./logo-maskable-512.png?v=42",
  "./manifest.webmanifest",
];

// Ressources dont la fraîcheur prime sur la vitesse (voir règle centrale).
function isShellDocument(url) {
  return (
    url.pathname.endsWith("/") ||
    url.pathname.endsWith("/index.html") ||
    url.pathname.startsWith("/src/")
  );
}

self.addEventListener("install", (e) =>
  e.waitUntil(
    (async () => {
      const c = await caches.open(CACHE);
      // add() individuel : addAll échoue en bloc si une seule requête échoue.
      await Promise.all(SHELL.map((u) => c.add(u).catch(() => {})));
      // On pré-charge aussi le document courant pour le mode hors-ligne.
      await c.add("./").catch(() => {});
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

// Permet à la page de forcer une purge complète (filet de sécurité côté client).
self.addEventListener("message", async (e) => {
  if (e.data === "skip-waiting") self.skipWaiting();
  if (e.data === "purge") {
    const keys = await caches.keys();
    await Promise.all(keys.map((k) => caches.delete(k)));
  }
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // pas de cache des origines tierces
  if (url.pathname.startsWith("/api/")) return; // données : toujours le réseau

  // Coquille (document + modules) : réseau d'abord, cache en repli hors-ligne.
  if (req.mode === "navigate" || isShellDocument(url)) {
    e.respondWith(
      (async () => {
        try {
          const fresh = await fetch(req);
          if (fresh && fresh.ok && fresh.type === "basic") {
            const cache = await caches.open(CACHE);
            cache.put(req, fresh.clone()).catch(() => {});
          }
          return fresh;
        } catch (_) {
          const cache = await caches.open(CACHE);
          const cached = (await cache.match(req)) || (await cache.match("./"));
          if (cached) return cached;
          throw _;
        }
      })()
    );
    return;
  }

  // Assets immuables : cache d'abord, revalidation en arrière-plan.
  e.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      const cached = await cache.match(req);
      const network = fetch(req)
        .then((r) => {
          if (r && r.ok && r.type === "basic") cache.put(req, r.clone()).catch(() => {});
          return r;
        })
        .catch(() => null);
      // waitUntil : sans cela la revalidation peut être tuée avec le worker,
      // et le cache ne se met jamais à jour.
      e.waitUntil(network);
      if (cached) return cached;
      const fresh = await network;
      if (fresh) return fresh;
      return Response.error();
    })()
  );
});
