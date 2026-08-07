// Noyau du mode Apprendre, PARTAGÉ entre le navigateur et la fonction serverless.
//
// Avant, `index.html` et `api/learn.js` embarquaient chacun leur copie des
// catégories, des constructeurs d'URL et des normaliseurs — et les deux avaient
// déjà divergé (12 catégories côté front, 11 côté serveur ; deux parseurs
// Gallica différents). Tout est ici, en un seul exemplaire.
//
// Le fil défilable est choisi par **Wikidata** : chaque catégorie est un
// identifiant Q, et seuls les articles Wikipédia dont l'item Wikidata déclare
// ce type (`P31`) apparaissent — les catégories Wikipédia (« deepcategory »)
// dérivaient trop facilement hors sujet. Contenu affiché (extrait, image,
// lien — celui qu'ouvre « Découvrir ») et filtrage Wikidata viennent d'UN SEUL
// appel à l'API Wikipédia (voir wikiUrl) : la recherche plein texte de
// Wikipédia comprend le mot-clé `haswbstatement`, qui interroge directement le
// P31 de l'item Wikidata associé à chaque page. Pas d'appel séparé à
// wikidata.org.
//
// Cette conception est la 4e essayée, les trois précédentes ayant chacune
// cassé différemment en usage réel (voir le détail dans wikiUrl) :
//  1. SPARQL + SERVICE bd:sample (query.wikidata.org) — jamais vérifiable en
//     direct depuis l'environnement de développement (réseau sortant bloqué),
//     échec total.
//  2. SPARQL + wdt:P31/wdt:P279* + ORDER BY RAND() — syntaxe correcte, mais
//     bien trop lent (>10s, timeouts) sur les classes larges.
//  3. Recherche Wikidata (haswbstatement) PUIS sitelinks vers Wikipédia, en
//     deux appels — rapide, mais échantillonne 40 items AVANT de savoir
//     lesquels ont un article Wikipédia. Sur une classe énorme comme Q5
//     (humain, ~30M d'items sur Wikidata, dont l'immense majorité sans le
//     moindre article — imports d'autorité, bases généalogiques…), un
//     échantillon de 40 tombe couramment sur zéro item ayant un sitelink
//     frwiki. Confirmé en usage réel : "40 item(s) trouvé(s), aucun avec
//     sitelink frwiki".
// Chercher directement SUR Wikipédia avec le même mot-clé élimine le
// problème plutôt que de le contourner : un résultat de recherche Wikipédia
// EST déjà un article Wikipédia, la question ne se pose plus.
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
   * qid : identifiant Wikidata (Q…) — seuls les articles dont l'item associé
   *       déclare ce type (P31) apparaissent (voir wikiUrl). null = tirage
   *       purement aléatoire, sans filtre.
   * extraQids : identifiants supplémentaires acceptés en P31, OR-combinés au
   *       principal. `haswbstatement:P31=…` ne filtre QUE les items
   *       directement typés ainsi, sans remonter les sous-classes : pour
   *       certaines catégories, la plupart des articles concernés ne sont PAS
   *       P31 direct du concept général — ex. la plupart des livres sont P31
   *       "roman", pas P31 "œuvre littéraire" ; la plupart des articles
   *       animaliers sont P31 "taxon" (espèce), pas P31 "animal". Constaté en
   *       usage réel (catégorie vide malgré une recherche qui répond), pas
   *       deviné à l'avance — si une autre catégorie s'avère trop
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
  // Marge au-dessus des ~20 articles voulus par lot : normalizeWiki écarte les
  // extraits trop courts (< 120 caractères), et pas tous les résultats n'en
  // ont un assez long.
  const WIKI_CATEGORY_LIMIT = 30;

  /** URL Wikipédia : extrait d'intro + image + lien, pour un tirage aléatoire
   *  (catégorie "random", `generator=random`) ou filtré par catégorie
   *  (`generator=search`, mot-clé `haswbstatement:P31=…` — le P31 de l'item
   *  Wikidata associé à chaque page, voir CATEGORIES). Un seul appel dans les
   *  deux cas : voir l'en-tête du fichier pour l'historique des 3 approches
   *  précédentes, cassées chacune différemment. */
  function wikiUrl(catKey) {
    const c = catByKey(catKey);
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
    if (c.qid) {
      // OR-combine qid + extraQids (voir leur doc sur CATEGORIES).
      const gsrsearch = [c.qid, ...(c.extraQids || [])]
        .map((q) => `haswbstatement:P31=${q}`)
        .join(" OR ");
      params.set("generator", "search");
      params.set("gsrsearch", gsrsearch);
      params.set("gsrnamespace", "0");
      params.set("gsrsort", "random");
      params.set("gsrlimit", String(WIKI_CATEGORY_LIMIT));
    } else {
      params.set("generator", "random");
      params.set("grnnamespace", "0");
      params.set("grnlimit", "20");
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

  /** Articles d'une catégorie, prêts pour dedupAndRank. `fetchJson` est fourni
   *  par l'appelant (navigateur : direct + repli proxy ; serveur : fetch avec
   *  délai) — c'est la SEULE différence entre les deux côtés, tout le reste
   *  (construction de l'URL, normalisation) est ici, en un seul exemplaire. */
  async function fetchCategoryItems(catKey, fetchJson) {
    return normalizeWiki(await fetchJson(wikiUrl(catKey)));
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
    normalizeWiki,
    fetchCategoryItems,
    dedupAndRank: lib.dedupAndRank,
    shuffle: lib.shuffle,
    BUCKETS,
    randomBucket,
  };
});
