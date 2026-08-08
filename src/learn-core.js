// Noyau du mode Apprendre, PARTAGÉ entre le navigateur et la fonction serverless.
//
// Avant, `index.html` et `api/learn.js` embarquaient chacun leur copie des
// catégories, des constructeurs d'URL et des normaliseurs — et les deux avaient
// déjà divergé (12 catégories côté front, 11 côté serveur ; deux parseurs
// Gallica différents). Tout est ici, en un seul exemplaire.
//
// Le fil défilable est choisi par **Wikidata** : chaque catégorie est une liste
// d'identifiants Q, et on tire au sort des items Wikidata déclarant l'un d'eux
// comme nature (`P31`), en ne gardant que ceux qui ont un article Wikipédia
// dans WIKI_LANG. Wikidata ne sert QUE la liste des titres ; l'extrait,
// l'image et le lien affichés (celui qu'ouvre « Découvrir ») viennent de
// Wikipédia — deux appels enchaînés, voir fetchCategoryItems.
//
// ---------------------------------------------------------------------------
// POURQUOI PLUSIEURS SOURCES ESSAYÉES EN CASCADE
//
// Rien de tout ceci n'est vérifiable depuis l'environnement de développement :
// le réseau sortant y est bloqué vers wikidata.org ET wikipedia.org. Cinq
// tentatives successives, chacune misant sur UN seul mécanisme, ont donc été
// livrées puis invalidées par un test réel, une à la fois :
//
//  1. SPARQL + `SERVICE bd:sample` — échec total, toutes catégories, y compris
//     via le proxy backend (donc pas un souci de CORS) : requête
//     vraisemblablement malformée, syntaxe jamais vérifiable d'ici.
//  2. SPARQL + `wdt:P31/wdt:P279*` + `ORDER BY RAND()` — syntaxe correcte,
//     mais >10 s et dépassements de délai : le chemin transitif combiné au tri
//     complet avant LIMIT ne passe pas à l'échelle.
//  3. Recherche Wikidata + `prop=sitelinks`, échantillon de 40 — Sport rendait
//     du contenu réel, mais Q5 renvoyait « 40 item(s) trouvé(s), aucun avec
//     sitelink frwiki ».
//  4. `haswbstatement:` envoyé à fr.wikipedia.org en un seul appel — TOUTES
//     les catégories cassées d'un coup, Sport compris : c'est un mot-clé de
//     WikibaseCirrusSearch, active sur le dépôt Wikidata et pas sur les wikis
//     clients, donc pris pour du texte brut.
//  5. Même chose qu'en 3 avec un échantillon de 500 et des qids élargis —
//     toujours rien.
//
// Chaque itération ne testait qu'une hypothèse et coûtait un aller-retour
// complet. D'où ce fichier : au lieu de parier, on ESSAIE LES SOURCES DANS
// L'ORDRE et on garde la première qui rend des articles (voir SOURCES et
// fetchCategoryItems). Ce qu'aucune n'a rendu est rapporté source par source
// dans le panneau ?debug=1 — un seul test suffit désormais à savoir laquelle
// marche et pourquoi les autres échouent, au lieu d'une hypothèse par test.
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
   * qids : identifiants Wikidata OR-combinés — un article apparaît si son item
   *        Wikidata déclare l'un d'eux comme nature (`P31`). `null` = tirage
   *        purement aléatoire, sans filtre (catégorie « Aléatoire »).
   *
   * Pourquoi PLUSIEURS qids et pas un seul (celui demandé) : `haswbstatement:
   * P31=…` ne retient que les items DIRECTEMENT typés ainsi, sans remonter les
   * sous-classes. Deux échecs mesurés en découlent, de natures opposées :
   *
   *  - Classes énormes mais peu « wikipédisées » : la plupart des articles
   *    concernés ne portent pas le type général. Presque tous les articles
   *    animaliers sont P31 « taxon », pas P31 « animal » ; la plupart des
   *    livres sont P31 « roman », pas P31 « œuvre littéraire ».
   *  - Concepts abstraits : quasiment RIEN n'est « instance de » art, science
   *    ou technologie — ce sont des sous-classes, pas des instances. Ces
   *    catégories ne renvoyaient donc rien du tout. On liste alors les types
   *    dont les articles sont réellement des instances (discipline, œuvre
   *    d'art, appareil…).
   *
   * OR-combiner est sans risque : un qid sans instance ne contribue rien. Le
   * risque, c'est l'inverse — un qid trop large qui ramène du hors-sujet. Les
   * listes ci-dessous restent donc volontairement resserrées, et le panneau
   * ?debug=1 affiche le nombre d'articles obtenus par catégorie pour les
   * affiner d'après l'usage réel plutôt qu'à l'aveugle.
   */
  const CATEGORIES = [
    { key: "random", label: "🎲 Aléatoire", qids: null },
    // 1. Jeux vidéo — Q7889
    {
      key: "jeuxvideo",
      label: "🎮 Jeux vidéo",
      qids: ["Q7889"],
      deepcategory: "Jeu vidéo",
    },
    // 2. Films — Q11424
    { key: "films", label: "🎥 Films", qids: ["Q11424"], deepcategory: "Film" },
    // 3. Séries télévisées — Q5398426 (+ mini-série)
    {
      key: "series",
      label: "📺 Séries télévisées",
      qids: ["Q5398426", "Q1259759"],
      deepcategory: "Série télévisée",
    },
    // 4. Œuvres littéraires — Q7725634 (+ roman, pièce de théâtre, poème)
    {
      key: "litterature",
      label: "📚 Œuvres littéraires",
      qids: ["Q7725634", "Q8261", "Q25379", "Q5185279"],
      deepcategory: "Œuvre littéraire",
    },
    // 5. Animaux — Q729 (+ taxon : la quasi-totalité des articles d'espèces ;
    //    contrepartie assumée, quelques plantes/champignons peuvent s'inviter)
    {
      key: "animaux",
      label: "🐾 Animaux",
      qids: ["Q729", "Q16521"],
      deepcategory: "Animal",
    },
    // 6. Sport — Q349 (+ discipline sportive)
    { key: "sport", label: "⚽ Sport", qids: ["Q349", "Q31629"], deepcategory: "Sport" },
    // 7. Musique — Q638 (+ chanson, album, genre musical)
    {
      key: "musique",
      label: "🎵 Musique",
      qids: ["Q638", "Q7366", "Q482994", "Q188451"],
      deepcategory: "Musique",
    },
    // 8. Histoire — Q309 (+ événement historique, guerre, bataille, traité)
    {
      key: "histoire",
      label: "📜 Histoire",
      qids: ["Q309", "Q13418847", "Q198", "Q178561", "Q131569"],
      deepcategory: "Histoire",
    },
    // 9. Sciences — Q336 (+ discipline académique, branche de la science,
    //    théorie scientifique : « science » elle-même n'a presque aucune instance)
    {
      key: "sciences",
      label: "🔬 Sciences",
      qids: ["Q336", "Q11862829", "Q2465832", "Q17737"],
      deepcategory: "Sciences",
    },
    // 10. Technologie — Q11019 (+ appareil, outil, machine)
    {
      key: "tech",
      label: "💻 Technologie",
      qids: ["Q11019", "Q1183543", "Q39546", "Q11015"],
      deepcategory: "Technologie",
    },
    // 11. Art — Q735 (+ œuvre d'art, peinture, sculpture, mouvement artistique)
    {
      key: "art",
      label: "🎨 Art",
      qids: ["Q735", "Q838948", "Q3305213", "Q860861", "Q968159"],
      deepcategory: "Arts",
    },
    // 12. Géographie — Q1071 (+ ville, pays, montagne, cours d'eau)
    {
      key: "geo",
      label: "🌍 Géographie",
      qids: ["Q1071", "Q515", "Q6256", "Q8502", "Q4022"],
      deepcategory: "Géographie",
    },
    // 13. Mythologie — Q9134 (+ divinité, créature légendaire, personnage mythologique)
    {
      key: "mythologie",
      label: "🔱 Mythologie",
      qids: ["Q9134", "Q178885", "Q2239243", "Q22988604"],
      deepcategory: "Mythologie",
    },
    // 14. Inventions — Q450
    {
      key: "inventions",
      label: "💡 Inventions",
      qids: ["Q450"],
      deepcategory: "Invention",
    },
    // 15. Personnes historiques et personnalités — Q5
    {
      key: "personnalites",
      label: "👤 Personnes historiques et personnalités",
      qids: ["Q5"],
      deepcategory: "Personnalité",
    },
  ];
  const catByKey = (key) => CATEGORIES.find((c) => c.key === key) || CATEGORIES[0];
  const catLabel = (key) => {
    const c = CATEGORIES.find((x) => x.key === key);
    return c ? c.label : "";
  };

  /* ---------- Construction des URL ---------- */

  const WIKI_THUMB_PX = 1000; // suffisant pour un fond plein écran, même en DPR 3

  /**
   * Items Wikidata tirés au sort par requête de recherche. 50 est la limite
   * documentée sûre pour un compte anonyme ; l'échantillon de 500 essayé
   * ensuite n'a rien donné de mieux, et un plafond dépassé se traduit chez
   * MediaWiki par un avertissement silencieux plutôt que par une erreur nette.
   */
  const WIKIDATA_SAMPLE = 50;
  // L'API Wikipédia n'accepte que 50 titres par requête `titles=`.
  const MAX_TITLES = 50;
  // Fenêtre dans laquelle on tire le décalage SPARQL. Assez large pour varier
  // d'un lot à l'autre, assez étroite pour ne pas tomber au-delà du nombre de
  // résultats des petites catégories (ce qui rendrait une liste vide).
  const SPARQL_OFFSET_MAX = 800;
  const SPARQL_ENDPOINT = "https://query.wikidata.org/sparql";

  /** SOURCE 1 — SPARQL (query.wikidata.org).
   *
   *  La seule qui applique la contrainte « a un article en français » CÔTÉ
   *  SERVEUR, par une jointure : elle ne peut donc jamais rendre des items
   *  inexploitables, contrairement à la recherche qui échantillonne d'abord et
   *  filtre après coup. Volontairement dépouillée par rapport aux deux
   *  tentatives SPARQL précédentes, dont on connaît les défauts (voir en-tête) :
   *  `wdt:P31` direct sans chemin transitif, et un décalage aléatoire au lieu
   *  d'un `ORDER BY RAND()` qui trie tout avant de tronquer. */
  function sparqlUrl(catKey) {
    const c = catByKey(catKey);
    if (!c.qids || !c.qids.length) return null;
    const wiki = `https://${WIKI_LANG}.wikipedia.org/`;
    const offset = Math.floor(Math.random() * SPARQL_OFFSET_MAX);
    const query = `PREFIX wd: <http://www.wikidata.org/entity/>
PREFIX wdt: <http://www.wikidata.org/prop/direct/>
PREFIX schema: <http://schema.org/>
SELECT ?title WHERE {
  VALUES ?type { ${c.qids.map((q) => `wd:${q}`).join(" ")} }
  ?item wdt:P31 ?type .
  ?article schema:about ?item ;
           schema:isPartOf <${wiki}> ;
           schema:name ?title .
}
LIMIT ${MAX_TITLES}
OFFSET ${offset}`;
    return `${SPARQL_ENDPOINT}?format=json&query=${encodeURIComponent(query)}`;
  }

  /** Titres (dédoublonnés) d'une réponse SPARQL JSON. */
  function normalizeSparqlTitles(data) {
    const bindings = (data && data.results && data.results.bindings) || [];
    return Array.from(
      new Set(bindings.map((b) => b.title && b.title.value).filter(Boolean))
    );
  }

  /** SOURCE 2 — recherche Wikidata (www.wikidata.org).
   *
   *  Sur www.wikidata.org et NON sur fr.wikipedia.org : `haswbstatement:` est
   *  un mot-clé de WikibaseCirrusSearch, active sur le dépôt Wikidata et pas
   *  sur les wikis clients (voir l'en-tête, point 4). Rapide, mais elle tire
   *  au sort AVANT de savoir lesquels ont un article français, d'où des lots
   *  parfois vides sur les classes peu wikipédisées — c'est pourquoi elle
   *  passe après SPARQL. */
  function wikidataUrl(catKey) {
    const c = catByKey(catKey);
    if (!c.qids || !c.qids.length) return null;
    const params = new URLSearchParams({
      action: "query",
      format: "json",
      formatversion: "2",
      origin: "*",
      generator: "search",
      gsrsearch: c.qids.map((q) => `haswbstatement:P31=${q}`).join(" OR "),
      gsrnamespace: "0",
      gsrsort: "random",
      gsrlimit: String(WIKIDATA_SAMPLE),
      prop: "sitelinks",
      sitefilter: `${WIKI_LANG}wiki`,
    });
    return `https://www.wikidata.org/w/api.php?${params}`;
  }

  /** Titres (dédoublonnés) extraits d'une réponse de wikidataUrl() : le
   *  sitelink WIKI_LANG de chaque item qui en a un. */
  function normalizeWikidataTitles(data) {
    const raw = data && data.query && data.query.pages ? data.query.pages : [];
    const pages = Array.isArray(raw) ? raw : Object.values(raw);
    const site = `${WIKI_LANG}wiki`;
    const titles = pages
      .map((p) => {
        const links = p.sitelinks;
        if (!links) return null;
        // formatversion=2 renvoie un tableau ; l'ancien format, un objet indexé par site.
        const link = Array.isArray(links)
          ? links.find((s) => s.site === site)
          : links[site];
        return link && link.title;
      })
      .filter(Boolean);
    return Array.from(new Set(titles));
  }

  /** SOURCE 3 — catégories Wikipédia (fr.wikipedia.org), dernier recours.
   *
   *  N'utilise pas Wikidata du tout : c'est le mécanisme d'avant ce chantier,
   *  gardé en filet. Il ratisse plus large et dérive parfois hors sujet (c'est
   *  précisément ce qui a motivé le passage à Wikidata), mais il a toujours
   *  rendu des articles — mieux vaut un fil imparfait qu'un mode démo. */
  function wikiCategoryUrl(catKey) {
    const c = catByKey(catKey);
    if (!c.deepcategory) return null;
    const params = new URLSearchParams({
      action: "query",
      format: "json",
      formatversion: "2",
      origin: "*",
      prop: "extracts|pageimages|info",
      explaintext: "1",
      exintro: "1",
      exlimit: "20",
      piprop: "thumbnail",
      pithumbsize: String(WIKI_THUMB_PX),
      pilimit: "20",
      inprop: "url",
      generator: "search",
      // `-hastemplate:"Infobox Biographie2"` : l'arbre de catégories Wikipédia
      // range les personnes sous les œuvres auxquelles elles ont participé —
      // d'où un acteur servi sous « Séries télévisées ». Presque toutes les
      // biographies de fr.wikipedia portent ce modèle, l'exclure retire donc
      // l'essentiel de la dérive. Sans objet pour « personnalités », dont ce
      // sont justement les articles voulus ; et inoffensif si le modèle change
      // de nom, l'exclusion ne portant alors sur rien.
      gsrsearch:
        `deepcategory:"${c.deepcategory}"` +
        (c.key === "personnalites" ? "" : ' -hastemplate:"Infobox Biographie2"'),
      gsrnamespace: "0",
      gsrsort: "random",
      gsrlimit: "20",
    });
    return `https://${WIKI_LANG}.wikipedia.org/w/api.php?${params}`;
  }

  /** URL Wikipédia : extrait d'intro + image + lien. Sans titres, c'est le
   *  tirage purement aléatoire de la catégorie « Aléatoire » ; avec, ce sont
   *  exactement les titres qu'une des sources vient de rendre. */
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

  /* ---------- Cascade de sources ---------- */

  /** Les sources, dans l'ordre d'essai. `titles` en rend une liste, qu'on va
   *  ensuite chercher sur Wikipédia ; `direct` en rend déjà des articles
   *  complets, sans second appel. */
  const SOURCES = [
    { name: "sparql", url: sparqlUrl, titles: normalizeSparqlTitles },
    { name: "wdsearch", url: wikidataUrl, titles: normalizeWikidataTitles },
    { name: "wpcat", url: wikiCategoryUrl, direct: true },
  ];

  /** Marque les articles de la source qui les a produits. Sans ça, impossible
   *  de savoir laquelle des trois a servi un lot : quand la cascade réussit,
   *  le panneau d'erreur s'efface et on ne voit plus que le résultat. C'est
   *  ainsi qu'un acteur est passé sous « Séries télévisées » sans qu'on sache
   *  d'où il venait (le filet deepcategory, qui ratisse les sous-catégories). */
  const stamp = (items, src) => items.map((it) => ({ ...it, src }));

  /** Résume ce qu'une source a répondu quand elle ne rend aucun titre. Les
   *  causes possibles appellent des correctifs opposés — mauvais identifiants,
   *  échantillon trop petit, erreur d'API — et se ressemblaient toutes à
   *  l'écran (« mode démo ») tant qu'on ne les distinguait pas ici. */
  function describeEmpty(data) {
    const err = data && data.error;
    if (err) return `erreur ${err.code || ""} ${err.info || JSON.stringify(err)}`.trim();
    const warn = data && data.warnings;
    if (warn) return `avertissement API : ${JSON.stringify(warn).slice(0, 160)}`;
    const raw = data && data.query && data.query.pages;
    if (Array.isArray(raw))
      return `${raw.length} item(s), aucun avec article ${WIKI_LANG}`;
    if (data && data.results) return "0 résultat";
    return "réponse inattendue";
  }

  /** Articles d'une catégorie, prêts pour dedupAndRank. `fetchJson` est fourni
   *  par l'appelant (navigateur : direct + repli proxy ; serveur : fetch avec
   *  délai) — c'est la SEULE différence entre les deux côtés, tout le reste
   *  (construction des URL, normalisation) est ici, en un seul exemplaire.
   *
   *  « Aléatoire » part directement sur le tirage aléatoire de Wikipédia. Les
   *  autres essaient SOURCES dans l'ordre et gardent la PREMIÈRE qui rend des
   *  articles ; si aucune n'y arrive, l'erreur levée détaille ce que chacune a
   *  répondu (voir lastLearnDetail, index.html, et le panneau ?debug=1). */
  async function fetchCategoryItems(catKey, fetchJson) {
    const c = catByKey(catKey);
    if (!c.qids || !c.qids.length) return normalizeWiki(await fetchJson(wikiUrl()));

    const notes = [];
    for (const src of SOURCES) {
      const url = src.url(catKey);
      if (!url) continue;
      try {
        const data = await fetchJson(url);
        if (src.direct) {
          const items = stamp(normalizeWiki(data), src.name);
          if (items.length) return items;
          notes.push(`${src.name}: ${describeEmpty(data)}`);
          continue;
        }
        const titles = src.titles(data);
        if (!titles.length) {
          notes.push(`${src.name}: ${describeEmpty(data)}`);
          continue;
        }
        // Mélangé AVANT la troncature à MAX_TITLES : sans ça, une catégorie
        // dense rendrait toujours les mêmes articles du même échantillon.
        const items = stamp(
          normalizeWiki(await fetchJson(wikiUrl(lib.shuffle(titles.slice())))),
          src.name
        );
        if (items.length) return items;
        notes.push(`${src.name}: ${titles.length} titre(s), 0 article exploitable`);
      } catch (e) {
        notes.push(`${src.name}: ${(e && e.message) || e}`);
      }
    }
    throw new Error(notes.join(" | ") || "aucune source disponible");
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
    WIKIDATA_SAMPLE,
    MAX_TITLES,
    CATEGORIES,
    catByKey,
    catLabel,
    wikiUrl,
    sparqlUrl,
    normalizeSparqlTitles,
    wikidataUrl,
    normalizeWikidataTitles,
    wikiCategoryUrl,
    SOURCES,
    normalizeWiki,
    fetchCategoryItems,
    dedupAndRank: lib.dedupAndRank,
    shuffle: lib.shuffle,
    BUCKETS,
    randomBucket,
  };
});
