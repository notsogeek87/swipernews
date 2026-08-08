// Noyau du mode Apprendre, PARTAGÉ entre le navigateur et la fonction serverless.
//
// Avant, `index.html` et `api/learn.js` embarquaient chacun leur copie des
// catégories, des constructeurs d'URL et des normaliseurs — et les deux avaient
// déjà divergé (12 catégories côté front, 11 côté serveur ; deux parseurs
// Gallica différents). Tout est ici, en un seul exemplaire.
//
// Le fil vient des **catégories de Wikipédia**, lues avec `list=categorymembers`
// (l'API qui liste le contenu d'une catégorie : ses articles et ses
// sous-catégories). Une catégorie = un centre d'intérêt, voir CATEGORIES.
//
// ---------------------------------------------------------------------------
// POURQUOI PAS WIKIDATA, APRÈS L'AVOIR TENTÉ CINQ FOIS
//
// Choisir les articles par leur type Wikidata (`P31`) promettait des catégories
// exactes. Cinq mécanismes ont été livrés puis invalidés un à un par un test
// réel — aucun n'était vérifiable avant déploiement, le réseau sortant étant
// bloqué ici vers wikidata.org comme vers wikipedia.org :
//
//  1. SPARQL + `SERVICE bd:sample` — échec total, y compris via le proxy
//     backend (donc pas un souci de CORS) : requête vraisemblablement malformée.
//  2. SPARQL + `wdt:P31/wdt:P279*` + `ORDER BY RAND()` — syntaxe correcte, mais
//     >10 s et dépassements de délai sur les classes larges.
//  3. Recherche Wikidata + `prop=sitelinks` — Sport rendait du contenu réel,
//     mais « humain » (Q5) renvoyait « 40 item(s) trouvé(s), aucun avec
//     sitelink frwiki » : on échantillonne AVANT de savoir lesquels ont un
//     article français, et la proportion est très faible dans les grandes
//     classes.
//  4. `haswbstatement:` envoyé à fr.wikipedia.org — TOUTES les catégories
//     cassées d'un coup : c'est un mot-clé de WikibaseCirrusSearch, active sur
//     le dépôt Wikidata et pas sur les wikis clients, donc pris pour du texte.
//  5. Idem 3 avec un échantillon de 500 et des identifiants élargis — rien.
//
// Le fond du problème : `P31` ne remonte pas les sous-classes, et presque
// aucun article n'est « instance de » art, science ou technologie. L'arbre des
// catégories de Wikipédia, lui, est fait exactement pour ça. On l'utilise
// directement, avec les catégories choisies à la main (et vérifiées) plutôt
// qu'avec `deepcategory:`, dont l'ampleur de la descente n'est pas maîtrisable
// — c'est ce qui servait un ACTEUR sous « Séries télévisées », l'arbre rangeant
// les personnes sous les œuvres auxquelles elles ont participé.
// ---------------------------------------------------------------------------
//
// Chargé en <script src> classique dans index.html (l'app reste ouvrable en
// file://) et en require() côté Node.
(function (root, factory) {
  const api = factory(
    typeof module === "object" && module.exports ? require("./lib.js") : root.SwiperLib
  );
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.SwiperLearn = api;
})(typeof self !== "undefined" ? self : globalThis, function (lib) {
  "use strict";

  const WIKI_LANG = "fr";

  /**
   * Source unique de vérité des centres d'intérêt.
   *
   * category : titre de la catégorie Wikipédia, SANS le préfixe « Catégorie: »
   *            (ajouté par categoryMembersUrl). `null` = tirage purement
   *            aléatoire, sans catégorie.
   */
  const CATEGORIES = [
    { key: "random", label: "🎲 Aléatoire", category: null },
    { key: "jeuxvideo", label: "🎮 Jeux vidéo", category: "Jeu vidéo" },
    { key: "films", label: "🎥 Films", category: "Film" },
    { key: "series", label: "📺 Séries télévisées", category: "Série télévisée" },
    { key: "musique", label: "🎵 Musique", category: "Musique" },
    { key: "romans", label: "📚 Romans", category: "Roman" },
    { key: "batailles", label: "⚔️ Batailles", category: "Bataille" },
    {
      key: "monuments",
      label: "🏛️ Monuments historiques",
      category: "Monument historique",
    },
    { key: "pays", label: "🌍 Pays", category: "Pays" },
    { key: "planetes", label: "🪐 Planètes", category: "Planète" },
    { key: "exoplanetes", label: "🌌 Exoplanètes", category: "Exoplanète" },
    { key: "inventions", label: "💡 Inventions", category: "Invention" },
    { key: "animaux", label: "🐾 Animaux", category: "Animal" },
    { key: "plats", label: "🍲 Plats", category: "Plat" },
    { key: "art", label: "🎨 Art", category: "Art" },
    { key: "sport", label: "⚽ Sport", category: "Sport" },
  ];

  const catByKey = (key) => CATEGORIES.find((c) => c.key === key) || CATEGORIES[0];
  const catLabel = (key) => {
    const c = CATEGORIES.find((x) => x.key === key);
    return c ? c.label : "";
  };

  /* ---------- Construction des URL ---------- */

  const WIKI_THUMB_PX = 1000; // suffisant pour un fond plein écran, même en DPR 3
  // L'API Wikipédia n'accepte que 50 titres par requête `titles=`.
  const MAX_TITLES = 50;
  const CM_LIMIT = 500; // membres listés par catégorie (maximum de l'API)
  // Une catégorie de tête (« Film », « Roman »…) contient surtout des
  // SOUS-catégories et peu d'articles : il faut descendre. Chaque descente est
  // une requête de plus, d'où ce budget — au-delà, le chargement se ferait
  // sentir avant même la première carte.
  const CM_MAX_LOOKUPS = 4;
  // En deçà, on continue de descendre (s'il reste du budget) plutôt que de
  // servir un lot squelettique.
  const CM_MIN_TITLES = 20;

  /** URL listant les membres d'une catégorie : ses articles ET ses
   *  sous-catégories (`cmtype=subcat|page`), pour pouvoir descendre. */
  function categoryMembersUrl(category) {
    const params = new URLSearchParams({
      action: "query",
      format: "json",
      formatversion: "2",
      origin: "*",
      list: "categorymembers",
      cmtitle: `Catégorie:${category}`,
      cmtype: "subcat|page",
      cmlimit: String(CM_LIMIT),
    });
    return `https://${WIKI_LANG}.wikipedia.org/w/api.php?${params}`;
  }

  /** Sépare les membres d'une catégorie : articles (espace principal) d'un
   *  côté, sous-catégories de l'autre. Le titre d'une sous-catégorie garde son
   *  préfixe « Catégorie: », qu'on retire pour pouvoir la ré-interroger. */
  function normalizeCategoryMembers(data) {
    const members = (data && data.query && data.query.categorymembers) || [];
    const pages = [];
    const subcats = [];
    for (const m of members) {
      if (!m || !m.title) continue;
      if (m.ns === 0) pages.push(m.title);
      else if (m.ns === 14) subcats.push(m.title.replace(/^Cat[ée]gorie:/, ""));
    }
    return { pages, subcats };
  }

  /** URL Wikipédia : extrait d'intro + image + lien. Sans titres, c'est le
   *  tirage purement aléatoire de la catégorie « Aléatoire » ; avec, ce sont
   *  exactement les titres relevés dans la catégorie. */
  function wikiUrl(titles) {
    const params = new URLSearchParams({
      action: "query",
      format: "json",
      formatversion: "2",
      origin: "*",
      prop: "extracts|pageimages|info",
      explaintext: "1",
      exintro: "1",
      piprop: "thumbnail",
      pithumbsize: String(WIKI_THUMB_PX),
      inprop: "url",
    });
    if (titles && titles.length) {
      params.set("titles", titles.slice(0, MAX_TITLES).join("|"));
      params.set("redirects", "1");
      params.set("exlimit", String(MAX_TITLES));
      params.set("pilimit", String(MAX_TITLES));
    } else {
      params.set("generator", "random");
      params.set("grnnamespace", "0");
      params.set("grnlimit", "20");
      params.set("exlimit", "20");
      params.set("pilimit", "20");
    }
    return `https://${WIKI_LANG}.wikipedia.org/w/api.php?${params}`;
  }

  /* ---------- Normalisation vers la forme d'item commune ---------- */

  function normalizeWiki(data) {
    // formatversion=2 renvoie un tableau ; l'ancien format, un objet indexé.
    const raw = data && data.query && data.query.pages ? data.query.pages : [];
    const pages = Array.isArray(raw) ? raw : Object.values(raw);
    return pages
      .map((p) => ({
        source: "Wikipédia",
        title: p.title || "",
        desc: (p.extract || "").replace(/\s+/g, " ").trim(),
        link: p.canonicalurl || p.fullurl || "",
        // Le thumbnail (plafonné à WIKI_THUMB_PX) et JAMAIS `original` : le
        // fichier source de Commons pèse couramment plusieurs mégaoctets.
        img: (p.thumbnail && p.thumbnail.source) || "",
        date: "",
      }))
      .filter((i) => i.title && i.desc.length >= 120);
  }

  /* ---------- Parcours d'une catégorie ---------- */

  /** Titres d'articles relevés dans une catégorie, en descendant dans ses
   *  sous-catégories tant qu'il en manque et qu'il reste du budget de requêtes.
   *
   *  La descente est TIRÉE AU SORT à chaque niveau (deux sous-catégories au
   *  hasard), et c'est de là que vient la variété du fil : `categorymembers`
   *  rend toujours les mêmes membres dans le même ordre, un tri aléatoire
   *  n'existe pas pour cette API. Sans ce tirage, chaque lot d'une même
   *  catégorie serait identique au précédent. */
  async function collectTitles(category, fetchJson, notes) {
    const queue = [category];
    const visited = new Set(queue);
    const titles = new Set();
    let lookups = 0;
    while (queue.length && lookups < CM_MAX_LOOKUPS && titles.size < CM_MIN_TITLES) {
      const current = queue.shift();
      lookups++;
      let data;
      try {
        data = await fetchJson(categoryMembersUrl(current));
      } catch (e) {
        notes.push(`« ${current} » : ${(e && e.message) || e}`);
        continue;
      }
      if (data && data.error) {
        // Typiquement une catégorie qui n'existe pas (nom mal orthographié) :
        // à distinguer d'une catégorie réelle mais vide.
        notes.push(
          `« ${current} » : ${data.error.code || ""} ${data.error.info || ""}`.trim()
        );
        continue;
      }
      const { pages, subcats } = normalizeCategoryMembers(data);
      pages.forEach((t) => titles.add(t));
      lib
        .shuffle(subcats.filter((s) => !visited.has(s)))
        .slice(0, 2)
        .forEach((s) => {
          visited.add(s);
          queue.push(s);
        });
    }
    return Array.from(titles);
  }

  /** Articles d'une catégorie, prêts pour dedupAndRank. `fetchJson` est fourni
   *  par l'appelant (navigateur : direct + repli proxy ; serveur : fetch avec
   *  délai) — c'est la SEULE différence entre les deux côtés, tout le reste
   *  (construction des URL, normalisation) est ici, en un seul exemplaire.
   *
   *  Les erreurs sont explicites et distinguent les causes, qui appellent des
   *  correctifs opposés : catégorie introuvable (nom à corriger), catégorie
   *  trouvée mais sans article exploitable (descente à élargir), ou panne
   *  réseau. Elles remontent au panneau ?debug=1 (voir index.html). */
  async function fetchCategoryItems(catKey, fetchJson) {
    const c = catByKey(catKey);
    if (!c.category) return normalizeWiki(await fetchJson(wikiUrl()));

    const notes = [];
    const titles = await collectTitles(c.category, fetchJson, notes);
    const detail = notes.length ? ` — ${notes.join(" | ")}` : "";
    if (!titles.length) throw new Error(`aucun article sous « ${c.category} »${detail}`);

    // Mélangé AVANT la troncature à MAX_TITLES : sans ça, une catégorie fournie
    // rendrait toujours les mêmes articles, `categorymembers` répondant dans un
    // ordre fixe.
    const items = normalizeWiki(await fetchJson(wikiUrl(lib.shuffle(titles))));
    if (!items.length) {
      throw new Error(
        `${titles.length} titre(s) sous « ${c.category} », 0 exploitable${detail}`
      );
    }
    return items;
  }

  /**
   * Nombre de variantes cacheables de `/api/learn`.
   *
   * Le contenu est aléatoire : avec un nonce par requête, chaque appel manquait
   * le CDN et payait l'aller-retour vers Wikipédia. Avec un « seau » tiré au
   * sort parmi BUCKETS, chaque variante est cacheable et reste largement assez
   * variée à l'échelle d'une session.
   */
  const BUCKETS = 12;
  const randomBucket = () => Math.floor(Math.random() * BUCKETS);

  return {
    WIKI_LANG,
    WIKI_THUMB_PX,
    MAX_TITLES,
    CM_LIMIT,
    CM_MAX_LOOKUPS,
    CM_MIN_TITLES,
    CATEGORIES,
    catByKey,
    catLabel,
    categoryMembersUrl,
    normalizeCategoryMembers,
    wikiUrl,
    normalizeWiki,
    collectTitles,
    fetchCategoryItems,
    dedupAndRank: lib.dedupAndRank,
    shuffle: lib.shuffle,
    BUCKETS,
    randomBucket,
  };
});
