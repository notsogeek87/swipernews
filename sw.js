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
const CACHE = "flux-v275";

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

// ---------- Notifications de nouveaux articles (Periodic Background Sync) ----------
// Pendant WEB de NewsCheckWorker.java (natif, voir android/…/NewsCheckWorker.java) :
// même principe minimal — un GET direct par source, on ne regarde que le
// PREMIER <item>/<entry> (le plus récent par convention RSS/Atom), on compare
// son lien à celui mémorisé au dernier repère (posé par index.html après
// chaque fil renouvelé, voir syncBackgroundFeeds) — un lien différent veut
// dire « du neuf », le SEUL signal comparé, pas de quoi reconstruire le fil.
// Contrairement au natif (CapacitorHttp, aucun CORS), un service worker reste
// un contexte web ordinaire : on repasse donc par /api/feed, le même relais
// que fetchText() côté page.
//
// localStorage n'existe pas ici : tout l'état partagé avec la page vit dans
// IndexedDB (voir BG_DB/idbSetBg côté index.html) — même base, même magasin,
// lus et écrits des deux côtés.
const BG_DB = "swipernews-bg",
  BG_STORE = "state",
  BG_KEY = "bg";
const BG_MAX_FEEDS = 40; // même plafond que MAX_FEEDS (natif) et MAX_FEEDS_PER_LOAD (web)
const BG_FETCH_TIMEOUT_MS = 8000;

function idbOpenBg() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(BG_DB, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(BG_STORE))
        req.result.createObjectStore(BG_STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
function idbGetBg() {
  return idbOpenBg().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(BG_STORE, "readonly");
        const req = tx.objectStore(BG_STORE).get(BG_KEY);
        req.onsuccess = () => {
          db.close();
          resolve(req.result || null);
        };
        req.onerror = () => {
          db.close();
          reject(req.error);
        };
      })
  );
}
// Ne réécrit QUE `feeds` (repères mis à jour) : `enabled`/`lang` restent ceux
// que la page a posés en dernier, jamais recalculés ici.
function idbSetBgFeeds(feeds) {
  return idbOpenBg().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(BG_STORE, "readwrite");
        const store = tx.objectStore(BG_STORE);
        const getReq = store.get(BG_KEY);
        getReq.onsuccess = () => {
          const cur = getReq.result || { enabled: false, feeds: [] };
          store.put({ ...cur, feeds }, BG_KEY);
        };
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onerror = () => {
          db.close();
          reject(tx.error);
        };
      })
  );
}

// Lien ET titre du premier <item>/<entry> — pas de DOMParser dans un service
// worker (API liée à un document, absente de ce contexte global), d'où
// l'extraction par expression régulière plutôt que le XmlPullParser du natif.
// RSS : <link>texte</link>. Atom : <link href="…"/>. Les deux formes sont
// essayées, la première qui rend quelque chose gagne.
function firstHeadFromXml(text) {
  const block = /<(item|entry)\b[\s\S]*?<\/\1>/i.exec(text);
  if (!block) return null;
  const seg = block[0];
  let link = "";
  const linkAttr = /<link\b[^>]*\bhref=["']([^"']+)["'][^>]*\/?>/i.exec(seg);
  if (linkAttr) link = linkAttr[1];
  else {
    const linkText = /<link\b[^>]*>([^<]*)<\/link>/i.exec(seg);
    if (linkText) link = linkText[1];
  }
  const titleM = /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(seg);
  const unwrap = (s) =>
    (s || "")
      .trim()
      .replace(/^<!\[CDATA\[([\s\S]*)\]\]>$/, "$1")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#0?39;/g, "'")
      .trim();
  link = unwrap(link);
  const title = unwrap(titleM ? titleM[1] : "");
  return link ? { link, title } : null;
}

// Titre/corps tirés au sort à chaque envoi — purement cosmétique, comme les
// string-arrays notif_titles/notif_bodies_* côté natif (strings.xml) : aucune
// variante ne change ce qui est annoncé, juste la lassitude d'un message
// identique pendant des mois.
const BG_TITLES = {
  fr: ["📰 Ça vient de tomber", "👀 Y'a du neuf sur ton fil", "🗞️ Fraîchement publié"],
  en: ["📰 Just in", "👀 New stuff in your feed", "🗞️ Freshly published"],
};
const BG_BODIES_ONE = {
  fr: [
    "%s vient de publier — de quoi faire une pause",
    "Nouvel article chez %s, juste pour toi",
  ],
  en: ["%s just published something new", "New article from %s, just for you"],
};
const BG_BODIES_ONE_TITLED = {
  fr: ["%s : « %s »", "Nouvel article de %s — « %s »"],
  en: ["%s: “%s”", "New article from %s — “%s”"],
};
const BG_BODIES_MANY = {
  fr: ["%d sources ont publié du nouveau contenu", "%d nouveaux articles à swiper"],
  en: ["%d sources have new content", "%d new articles to swipe through"],
};
const BG_BODIES_MANY_TITLED = {
  fr: ["%d nouveautés, dont « %s »", "%d nouveautés — la dernière : « %s »"],
  en: ["%d new items, including “%s”", "%d new items — latest: “%s”"],
};
function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}
// Un <title> RSS n'a aucune limite de taille garantie : un pavé de texte dans
// une notification repliée masquerait tout le reste (même seuil que
// NewsCheckWorker.clampTitle, natif).
function clampTitle(t) {
  const MAX = 80;
  const s = (t || "").trim();
  return s.length <= MAX ? s : s.slice(0, MAX).trim() + "…";
}
async function postBgNotification(count, name, title, lang) {
  const l = lang === "en" ? "en" : "fr";
  const hasTitle = !!(title && title.trim());
  const one = count === 1 && name;
  let body;
  if (one) {
    body = hasTitle
      ? pick(BG_BODIES_ONE_TITLED[l]).replace("%s", name).replace("%s", clampTitle(title))
      : pick(BG_BODIES_ONE[l]).replace("%s", name);
  } else {
    body = hasTitle
      ? pick(BG_BODIES_MANY_TITLED[l])
          .replace("%d", String(count))
          .replace("%s", clampTitle(title))
      : pick(BG_BODIES_MANY[l]).replace("%d", String(count));
  }
  try {
    await self.registration.showNotification(pick(BG_TITLES[l]), {
      body,
      tag: "swipernews-bg-news",
      icon: "./logo-192.png?v=42",
      badge: "./logo-192.png?v=42",
      data: { url: "./" },
    });
  } catch (e) {
    /* Notification refusée entre-temps (révoquée dans les réglages système) : rien à faire de plus. */
  }
}

async function checkFeedsAndNotify() {
  let state;
  try {
    state = await idbGetBg();
  } catch (e) {
    return;
  }
  // Double garde avec setWebBgNotif/setNotifPref (page) : un réglage désactivé
  // entre la programmation du réveil et ce réveil ne doit rien envoyer — même
  // principe que KEY_ENABLED côté NewsCheckWorker.
  if (!state || !state.enabled) return;
  const feeds = Array.isArray(state.feeds) ? state.feeds : [];
  if (!feeds.length) return;
  // Plafond de sources vérifiées par réveil : celles au-delà gardent leur
  // dernier repère connu jusqu'au réveil suivant, jamais interrogées ici.
  const checked = feeds.slice(0, BG_MAX_FEEDS);
  const rest = feeds.slice(BG_MAX_FEEDS);
  let newCount = 0,
    firstName = null,
    firstTitle = null;
  const updated = [];
  for (const f of checked) {
    if (!f || !f.url) {
      updated.push(f);
      continue;
    }
    let head = null;
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), BG_FETCH_TIMEOUT_MS);
      const res = await fetch("/api/feed?url=" + encodeURIComponent(f.url), {
        signal: ctrl.signal,
        cache: "no-store",
      });
      clearTimeout(t);
      if (res.ok) head = firstHeadFromXml(await res.text());
    } catch (e) {
      /* échec ponctuel : on retentera au prochain réveil, repère inchangé plus bas */
    }
    if (!head || !head.link) {
      updated.push(f);
      continue;
    }
    // f.link vide : pas encore de repère (tout juste synchronisé depuis la
    // page) — on POSE le repère sans jamais notifier sur cette première
    // mesure, sinon ce serait annoncer comme neuf un article déjà sous les
    // yeux dans le fil affiché (même raison que côté natif).
    if (f.link && f.link !== head.link) {
      newCount++;
      if (!firstName) {
        firstName = f.name || "";
        firstTitle = head.title || "";
      }
    }
    updated.push({ url: f.url, name: f.name || "", link: head.link });
  }
  try {
    await idbSetBgFeeds(updated.concat(rest));
  } catch (e) {
    /* la prochaine synchronisation depuis la page réécrira un état propre */
  }
  if (newCount > 0) await postBgNotification(newCount, firstName, firstTitle, state.lang);
}

self.addEventListener("periodicsync", (e) => {
  if (e.tag === "check-news") e.waitUntil(checkFeedsAndNotify());
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || "./";
  e.waitUntil(
    (async () => {
      const all = await clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const c of all) {
        if ("focus" in c) return c.focus();
      }
      if (clients.openWindow) return clients.openWindow(url);
    })()
  );
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
          // Le repli sur le document ne vaut QUE pour une navigation. Servir
          // `./` (du HTML) en réponse à `/src/lib.js?v=N` absent du cache
          // donnait un « script » que le navigateur refuse d'exécuter
          // (Content-Type, nosniff) : les modules manquaient, guardModules
          // purgeait tout et rechargeait — hors ligne, donc en boucle jusqu'à
          // l'écran « Mise à jour incomplète ». Sans ce repli, la requête échoue
          // franchement, ce que la page sait déjà traiter.
          const cached =
            (await cache.match(req)) ||
            (req.mode === "navigate" ? await cache.match("./") : null);
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
