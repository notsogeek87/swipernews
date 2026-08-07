// Noyau du mode Apprendre, PARTAGÉ entre le navigateur et la fonction serverless.
//
// Avant, `index.html` et `api/learn.js` embarquaient chacun leur copie des
// catégories, des constructeurs d'URL et des normaliseurs — et les deux avaient
// déjà divergé (12 catégories côté front, 11 côté serveur ; deux parseurs
// Gallica différents). Tout est ici, en un seul exemplaire.
//
// Le fil défilable vient de **Wikidata** (arbre instance-of/subclass-of d'un
// identifiant Q précis), pas de la recherche plein texte de Wikipédia : les
// catégories Wikipédia (« deepcategory ») dérivaient trop facilement hors
// sujet. Wikidata ne sert que la LISTE des titres ; l'extrait, l'image et le
// lien affichés (et ouverts par « Découvrir ») restent ceux de Wikipédia —
// deux appels enchaînés, voir fetchCategoryItems.
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
   * qid : identifiant Wikidata (Q…) racine de l'arbre instance-of/subclass-of.
   *       null = tirage purement aléatoire (pas d'arbre Wikidata).
   */
  const CATEGORIES = [
    { key: "random", label: "🎲 Aléatoire", qid: null },
    { key: "jeuxvideo", label: "🎮 Jeux vidéo", qid: "Q7889" },
    { key: "films", label: "🎥 Films", qid: "Q11424" },
    { key: "series", label: "📺 Séries télévisées", qid: "Q5398426" },
    { key: "litterature", label: "📚 Œuvres littéraires", qid: "Q7725634" },
    { key: "animaux", label: "🐾 Animaux", qid: "Q729" },
    { key: "sport", label: "⚽ Sport", qid: "Q349" },
    { key: "musique", label: "🎵 Musique", qid: "Q638" },
    { key: "histoire", label: "📜 Histoire", qid: "Q309" },
    { key: "sciences", label: "🔬 Sciences", qid: "Q336" },
    { key: "tech", label: "💻 Technologie", qid: "Q11019" },
    { key: "art", label: "🎨 Art", qid: "Q735" },
    { key: "geo", label: "🌍 Géographie", qid: "Q1071" },
    { key: "mythologie", label: "🔱 Mythologie", qid: "Q9134" },
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

  // Tirage purement aléatoire (catégorie "random", sans arbre Wikidata) : on
  // reste sur le générateur natif de Wikipédia, inchangé.
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

  const WIKIDATA_ENDPOINT = "https://query.wikidata.org/sparql";
  // Marge au-dessus des ~20 articles voulus par lot : normalizeWiki écarte les
  // extraits trop courts (< 120 caractères), et pas tous les titres tirés n'en
  // ont un assez long.
  const WIKIDATA_SAMPLE = 40;

  /** URL de la requête SPARQL Wikidata : titres tirés au sort dans l'arbre
   *  instance-of/subclass-of de la catégorie, restreints aux items ayant un
   *  article Wikipédia dans WIKI_LANG. `SERVICE bd:sample` (échantillonnage
   *  par réservoir, propre à Blazegraph/WDQS) évite l'`ORDER BY RAND()`, qui
   *  matérialiserait et trierait TOUT l'arbre avant de piocher dedans — sur
   *  une classe comme Q5 (humain, des millions d'items), c'est le seul moyen
   *  de rester sous le délai du service. Renvoie `null` pour "random", qui n'a
   *  pas d'arbre Wikidata (voir wikiUrl). */
  function wikidataUrl(catKey) {
    const c = catByKey(catKey);
    if (!c.qid) return null;
    const wiki = `https://${WIKI_LANG}.wikipedia.org/`;
    const query = `SELECT ?title WHERE {
  SERVICE bd:sample {
    ?item bd:sample.sampleSize ${WIKIDATA_SAMPLE} ;
          bd:sample.sampleType "RANDOM" .
    {
      SELECT ?item WHERE {
        ?item wdt:P31/wdt:P279* wd:${c.qid} .
        ?a0 schema:about ?item ; schema:isPartOf <${wiki}> .
      }
    }
  }
  ?article schema:about ?item ; schema:isPartOf <${wiki}> ; schema:name ?title .
}`;
    return `${WIKIDATA_ENDPOINT}?format=json&query=${encodeURIComponent(query)}`;
  }

  /** Titres (dédoublonnés) extraits d'une réponse SPARQL JSON de wikidataUrl(). */
  function normalizeWikidataTitles(data) {
    const bindings = (data && data.results && data.results.bindings) || [];
    const titles = bindings.map((b) => b.title && b.title.value).filter(Boolean);
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
   *  - toute autre catégorie : Wikidata pour les titres (arbre de la
   *    catégorie), puis Wikipédia pour l'extrait/l'image/le lien de ces
   *    titres précis. C'est ce lien Wikipédia qu'ouvre « Découvrir ». */
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
