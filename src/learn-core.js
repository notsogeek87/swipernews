// Noyau du mode Apprendre, PARTAGÉ entre le navigateur et la fonction serverless.
//
// Avant, `index.html` et `api/learn.js` embarquaient chacun leur copie des
// catégories, des constructeurs d'URL et des normaliseurs — et les deux avaient
// déjà divergé (12 catégories côté front, 11 côté serveur ; deux parseurs
// Gallica différents). Tout est ici, en un seul exemplaire.
//
// Le fil défilable vient de **Wikidata** (items déclarant `P31` = l'identifiant
// Q de la catégorie), pas de la recherche plein texte de Wikipédia : les
// catégories Wikipédia (« deepcategory ») dérivaient trop facilement hors
// sujet. Wikidata ne sert que la LISTE des titres ; l'extrait, l'image et le
// lien affichés (et ouverts par « Découvrir ») restent ceux de Wikipédia —
// deux appels enchaînés, voir fetchCategoryItems. Voir wikidataUrl() pour
// l'historique des deux approches SPARQL essayées avant celle-ci (cassées).
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
   * qid : identifiant Wikidata (Q…) — les items déclarant ce type (P31) sont
   *       la source du tirage (voir wikidataUrl). null = tirage purement
   *       aléatoire, sans filtre Wikidata (voir wikiUrl).
   * extraQids : identifiants supplémentaires acceptés en P31, OR-combinés au
   *       principal. `haswbstatement:P31=…` ne filtre QUE les items
   *       directement typés ainsi (voir wikidataUrl) : pour certaines
   *       catégories, la plupart des articles Wikipédia concernés ne sont PAS
   *       P31 direct du concept général — ex. la plupart des livres sont P31
   *       "roman", pas P31 "œuvre littéraire" ; la plupart des articles
   *       animaliers sont P31 "taxon" (espèce), pas P31 "animal". Constaté en
   *       usage réel (catégorie vide malgré une recherche qui répond), pas
   *       deviné à l'avance — SI une autre catégorie s'avère trop
   *       étroite/répétitive, c'est le même correctif : trouver le(s) P31 le
   *       plus fréquent des articles concernés et l'ajouter ici.
   */
  const CATEGORIES = [
    { key: "random", label: "🎲 Aléatoire", qid: null },
    { key: "jeuxvideo", label: "🎮 Jeux vidéo", qid: "Q7889" },
    { key: "films", label: "🎥 Films", qid: "Q11424" },
    { key: "series", label: "📺 Séries télévisées", qid: "Q5398426" },
    // + "roman" (Q8261) : la plupart des livres ne sont pas P31 direct "œuvre littéraire".
    {
      key: "litterature",
      label: "📚 Œuvres littéraires",
      qid: "Q7725634",
      extraQids: ["Q8261"],
    },
    // + "taxon" (Q16521) : la plupart des articles animaliers sont des espèces, pas P31 direct
    // "animal" — contrepartie assumée, quelques plantes/champignons peuvent s'inviter aussi.
    { key: "animaux", label: "🐾 Animaux", qid: "Q729", extraQids: ["Q16521"] },
    { key: "sport", label: "⚽ Sport", qid: "Q349" },
    { key: "musique", label: "🎵 Musique", qid: "Q638", extraQids: ["Q7366"] }, // + "chanson" (Q7366)
    { key: "histoire", label: "📜 Histoire", qid: "Q309" },
    { key: "sciences", label: "🔬 Sciences", qid: "Q336" },
    { key: "tech", label: "💻 Technologie", qid: "Q11019" },
    { key: "art", label: "🎨 Art", qid: "Q735" },
    { key: "geo", label: "🌍 Géographie", qid: "Q1071" },
    { key: "mythologie", label: "🔱 Mythologie", qid: "Q9134", extraQids: ["Q178885"] }, // + "déité" (Q178885)
    { key: "inventions", label: "💡 Inventions", qid: "Q450" },
    {
      key: "personnalites",
      label: "👤 Personnes historiques et personnalités",
      qid: "Q5",
    },
  ];
  const catByKey = (key) => CATEGORIES.find((c) => c.key === key) || CATEGORIES[0];
  const catLabel = (key) => {
    const c = CATEGORIES.find((x) => x.key === key);
    return c ? c.label : "";
  };

  /* ---------- Construction des URL ---------- */

  const WIKI_THUMB_PX = 1000; // suffisant pour un fond plein écran, même en DPR 3

  // Tirage purement aléatoire (catégorie "random", pas de filtre Wikidata) :
  // on reste sur le générateur natif de Wikipédia, inchangé.
  function wikiUrl() {
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
      generator: "random",
      grnnamespace: "0",
      grnlimit: "20",
    });
    return `https://${WIKI_LANG}.wikipedia.org/w/api.php?${params}`;
  }

  // Marge au-dessus des ~20 articles voulus par lot : normalizeWiki écarte les
  // extraits trop courts (< 120 caractères), et pas tous les titres tirés n'en
  // ont un assez long.
  const WIKIDATA_SAMPLE = 40;

  /** URL de recherche Wikidata : items tirés au sort déclarant `P31` (nature
   *  de l'élément) = le qid de la catégorie, restreints à ceux ayant un
   *  article Wikipédia dans WIKI_LANG (`sitefilter`).
   *
   *  DEUX approches ont été essayées avant celle-ci, chacune cassée d'une
   *  façon différente une fois en usage réel — SPARQL (`query.wikidata.org`)
   *  n'a jamais pu être vérifié en direct depuis l'environnement de
   *  développement (réseau sortant bloqué) :
   *   1. `SERVICE bd:sample` (échantillonnage par réservoir, Blazegraph) :
   *      syntaxe jamais vérifiable, échec total en usage réel (probablement
   *      une requête malformée, indiscernable d'un simple timeout depuis les
   *      messages d'erreur obtenus).
   *   2. `wdt:P31/wdt:P279* + ORDER BY RAND()` (SPARQL 1.1 standard,
   *      transitif sur les sous-classes) : syntaxe correcte, mais bien trop
   *      lent en usage réel (>10s, y compris timeout sur certaines
   *      catégories) — le chemin de propriété transitif, combiné au tri
   *      complet avant LIMIT, n'a pas la performance qu'on lui prêtait pour
   *      des classes larges.
   *  Cette 3e version utilise le MÊME mécanisme déjà éprouvé pour Wikipédia
   *  (`generator=search`, `gsrsort=random` — CirrusSearch, la même extension
   *  MediaWiki, déployée à l'identique sur tous les wikis Wikimedia), avec le
   *  mot-clé `haswbstatement` plutôt qu'une requête SPARQL : rapide (moteur de
   *  recherche indexé, pas de graphe à parcourir), et syntaxiquement certain
   *  puisqu'il s'agit du chemin déjà utilisé en production pour Wikipédia.
   *
   *  Contrepartie ASSUMÉE : `haswbstatement:P31=…` ne filtre que les items
   *  DIRECTEMENT typés ainsi, sans remonter les sous-classes (SPARQL le
   *  permettait, en théorie). Pour des catégories concrètes (Jeux vidéo,
   *  Films, Personnes historiques… confirmé en usage réel pour Sport, qui
   *  répond vite et correctement) ça correspond déjà à l'essentiel des
   *  articles. Pour d'autres, un seul P31 direct s'est avéré quasi VIDE en
   *  usage réel (Animaux : "empty", zéro article malgré une recherche qui
   *  répondait) — `extraQids` (voir CATEGORIES) ajoute alors le(s) P31 le
   *  plus fréquent des articles réellement concernés, constaté plutôt que
   *  deviné à l'avance. Les catégories qui n'en ont pas encore mais
   *  s'avéreraient trop étroites/répétitives (Histoire, Sciences, Art,
   *  Géographie…) suivent le même correctif le jour où c'est observé.
   *
   *  Renvoie `null` pour "random", qui n'a pas de qid (voir wikiUrl). */
  function wikidataUrl(catKey) {
    const c = catByKey(catKey);
    if (!c.qid) return null;
    // OR-combine qid + extraQids (voir leur doc sur CATEGORIES) : CirrusSearch,
    // comme sur Wikipédia, accepte "OR" entre mots-clés de recherche.
    const gsrsearch = [c.qid, ...(c.extraQids || [])]
      .map((q) => `haswbstatement:P31=${q}`)
      .join(" OR ");
    const params = new URLSearchParams({
      action: "query",
      format: "json",
      formatversion: "2",
      origin: "*",
      generator: "search",
      gsrsearch,
      gsrnamespace: "0",
      gsrsort: "random",
      gsrlimit: String(WIKIDATA_SAMPLE),
      prop: "sitelinks",
      sitefilter: `${WIKI_LANG}wiki`,
    });
    return `https://www.wikidata.org/w/api.php?${params}`;
  }

  /** Titres (dédoublonnés) extraits d'une réponse de wikidataUrl() : le
   *  sitelink WIKI_LANG de chaque item trouvé, quand il existe. */
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

  /** URL Wikipédia pour récupérer extrait + image + lien d'une LISTE de titres
   *  précise (pas une recherche) : c'est l'étape 2, après wikidataUrl(). */
  function wikipediaTitlesUrl(titles) {
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
      redirects: "1",
      titles: titles.join("|"),
    });
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

  /** Articles d'une catégorie, prêts pour dedupAndRank. `fetchJson` est fourni
   *  par l'appelant (navigateur : direct + repli proxy ; serveur : fetch avec
   *  délai) — c'est la SEULE différence entre les deux côtés, tout le reste
   *  (construction des URL, normalisation) est ici, en un seul exemplaire.
   *  - "random" : un aller simple vers le tirage aléatoire de Wikipédia.
   *  - toute autre catégorie : Wikidata pour les titres (items typés par le
   *    qid de la catégorie), puis Wikipédia pour l'extrait/l'image/le lien de
   *    ces titres précis. C'est ce lien Wikipédia qu'ouvre « Découvrir ». */
  async function fetchCategoryItems(catKey, fetchJson) {
    const c = catByKey(catKey);
    if (!c.qid) return normalizeWiki(await fetchJson(wikiUrl()));
    const titles = normalizeWikidataTitles(await fetchJson(wikidataUrl(catKey)));
    if (!titles.length) return [];
    return normalizeWiki(await fetchJson(wikipediaTitlesUrl(titles)));
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
    CATEGORIES,
    catByKey,
    catLabel,
    wikiUrl,
    wikidataUrl,
    normalizeWikidataTitles,
    wikipediaTitlesUrl,
    normalizeWiki,
    fetchCategoryItems,
    dedupAndRank: lib.dedupAndRank,
    shuffle: lib.shuffle,
    BUCKETS,
    randomBucket,
  };
});
