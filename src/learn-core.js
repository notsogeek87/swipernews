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
// CE QUI A ÉTÉ ESSAYÉ, ET POURQUOI ON EST REVENU ICI
//
// Rien de tout ceci n'est vérifiable depuis l'environnement de développement
// (réseau sortant bloqué vers wikidata.org ET wikipedia.org) : chaque ligne
// ci-dessous vient de tests sur l'app déployée, pas d'une supposition.
//
//  1. SPARQL + `SERVICE bd:sample` (query.wikidata.org) — échec total, toutes
//     catégories, y compris via le proxy backend (donc pas un souci de CORS) :
//     requête vraisemblablement malformée, syntaxe jamais vérifiable.
//  2. SPARQL + `wdt:P31/wdt:P279*` + `ORDER BY RAND()` — syntaxiquement bon,
//     mais >10 s et dépassements de délai : le chemin de propriété transitif
//     combiné au tri complet avant LIMIT ne passe pas à l'échelle.
//  3. Recherche Wikidata + sitelinks (CE FICHIER), mais avec un échantillon de
//     40 items — Sport fonctionnait (rapide, contenu réel) ; Q5 renvoyait
//     « 40 item(s) trouvé(s), aucun avec sitelink frwiki ». Le MÉCANISME est
//     donc bon, c'est l'échantillon qui était trop petit (voir WIKIDATA_SAMPLE).
//  4. Recherche `haswbstatement:` directement sur fr.wikipedia.org, en un seul
//     appel — TOUTES les catégories cassées d'un coup, y compris Sport qui
//     marchait juste avant. `haswbstatement:` est un mot-clé de l'extension
//     WikibaseCirrusSearch, active sur le dépôt Wikidata, pas sur les wikis
//     clients : Wikipédia l'a pris pour du texte brut et n'a rien trouvé.
//
// D'où ce fichier : retour au mécanisme 3 (le seul dont on ait la preuve qu'il
// rend du contenu réel), avec les deux défauts mesurés corrigés — voir
// WIKIDATA_SAMPLE pour la taille d'échantillon, et CATEGORIES pour les qids.
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
    { key: "jeuxvideo", label: "🎮 Jeux vidéo", qids: ["Q7889"] },
    // 2. Films — Q11424
    { key: "films", label: "🎥 Films", qids: ["Q11424"] },
    // 3. Séries télévisées — Q5398426 (+ mini-série)
    { key: "series", label: "📺 Séries télévisées", qids: ["Q5398426", "Q1259759"] },
    // 4. Œuvres littéraires — Q7725634 (+ roman, pièce de théâtre, poème)
    {
      key: "litterature",
      label: "📚 Œuvres littéraires",
      qids: ["Q7725634", "Q8261", "Q25379", "Q5185279"],
    },
    // 5. Animaux — Q729 (+ taxon : la quasi-totalité des articles d'espèces ;
    //    contrepartie assumée, quelques plantes/champignons peuvent s'inviter)
    { key: "animaux", label: "🐾 Animaux", qids: ["Q729", "Q16521"] },
    // 6. Sport — Q349 (+ discipline sportive)
    { key: "sport", label: "⚽ Sport", qids: ["Q349", "Q31629"] },
    // 7. Musique — Q638 (+ chanson, album, genre musical)
    {
      key: "musique",
      label: "🎵 Musique",
      qids: ["Q638", "Q7366", "Q482994", "Q188451"],
    },
    // 8. Histoire — Q309 (+ événement historique, guerre, bataille, traité)
    {
      key: "histoire",
      label: "📜 Histoire",
      qids: ["Q309", "Q13418847", "Q198", "Q178561", "Q131569"],
    },
    // 9. Sciences — Q336 (+ discipline académique, branche de la science,
    //    théorie scientifique : « science » elle-même n'a presque aucune instance)
    {
      key: "sciences",
      label: "🔬 Sciences",
      qids: ["Q336", "Q11862829", "Q2465832", "Q17737"],
    },
    // 10. Technologie — Q11019 (+ appareil, outil, machine)
    {
      key: "tech",
      label: "💻 Technologie",
      qids: ["Q11019", "Q1183543", "Q39546", "Q11015"],
    },
    // 11. Art — Q735 (+ œuvre d'art, peinture, sculpture, mouvement artistique)
    {
      key: "art",
      label: "🎨 Art",
      qids: ["Q735", "Q838948", "Q3305213", "Q860861", "Q968159"],
    },
    // 12. Géographie — Q1071 (+ ville, pays, montagne, cours d'eau)
    {
      key: "geo",
      label: "🌍 Géographie",
      qids: ["Q1071", "Q515", "Q6256", "Q8502", "Q4022"],
    },
    // 13. Mythologie — Q9134 (+ divinité, créature légendaire, personnage mythologique)
    {
      key: "mythologie",
      label: "🔱 Mythologie",
      qids: ["Q9134", "Q178885", "Q2239243", "Q22988604"],
    },
    // 14. Inventions — Q450
    { key: "inventions", label: "💡 Inventions", qids: ["Q450"] },
    // 15. Personnes historiques et personnalités — Q5
    {
      key: "personnalites",
      label: "👤 Personnes historiques et personnalités",
      qids: ["Q5"],
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
   * Items Wikidata tirés au sort par requête. 500 = le maximum de l'API, et
   * c'est nécessaire, pas du confort : on ne peut pas demander à la recherche
   * « seulement ceux qui ont un article en français », donc on échantillonne
   * puis on filtre. Or la proportion d'items ayant un article français est
   * très basse dans les grandes classes — Wikidata compte ~30 millions
   * d'humains (Q5) pour ~700 000 biographies sur fr.wikipedia, soit ~2 %.
   *
   * Avec 40 (la valeur d'avant), la probabilité de ne tomber sur AUCUN item
   * exploitable était d'environ 40 % pour Q5 — exactement le « 40 item(s)
   * trouvé(s), aucun avec sitelink frwiki » observé. Avec 500, elle tombe
   * sous le millionième, et les classes denses (Sport, Films…) sont servies
   * bien au-delà du nécessaire.
   */
  const WIKIDATA_SAMPLE = 500;
  // L'API Wikipédia n'accepte que 50 titres par requête `titles=`.
  const MAX_TITLES = 50;

  /** URL de recherche Wikidata : items tirés au sort déclarant l'un des qids
   *  de la catégorie comme nature (`P31`), avec leur éventuel article
   *  Wikipédia dans WIKI_LANG (`prop=sitelinks` + `sitefilter`).
   *
   *  Sur www.wikidata.org et NON sur fr.wikipedia.org : `haswbstatement:` est
   *  un mot-clé de WikibaseCirrusSearch, active sur le dépôt Wikidata et pas
   *  sur les wikis clients (voir l'historique en tête de fichier, point 4).
   *
   *  Renvoie `null` pour « Aléatoire », qui n'a pas de qids (voir wikiUrl). */
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

  /** URL Wikipédia : extrait d'intro + image + lien. Sans titres, c'est le
   *  tirage purement aléatoire de la catégorie « Aléatoire » ; avec, ce sont
   *  exactement les titres que Wikidata vient de rendre. */
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

  /** Articles d'une catégorie, prêts pour dedupAndRank. `fetchJson` est fourni
   *  par l'appelant (navigateur : direct + repli proxy ; serveur : fetch avec
   *  délai) — c'est la SEULE différence entre les deux côtés, tout le reste
   *  (construction des URL, normalisation) est ici, en un seul exemplaire.
   *  - « Aléatoire » : un aller simple vers le tirage aléatoire de Wikipédia.
   *  - toute autre catégorie : Wikidata pour les titres, puis Wikipédia pour
   *    l'extrait/l'image/le lien. C'est ce lien qu'ouvre « Découvrir ». */
  async function fetchCategoryItems(catKey, fetchJson) {
    const url = wikidataUrl(catKey);
    if (!url) return normalizeWiki(await fetchJson(wikiUrl()));

    const wdData = await fetchJson(url);
    const titles = normalizeWikidataTitles(wdData);
    if (!titles.length) {
      // Sans ce détail, « Wikidata n'a rien trouvé pour ces P31 » (mauvais
      // qids) et « des items existent mais aucun n'a d'article français »
      // (échantillon trop petit) donnaient le même écran vide — or les deux
      // appellent des correctifs opposés. Voir lastLearnDetail (index.html).
      const pages =
        wdData && wdData.query && Array.isArray(wdData.query.pages)
          ? wdData.query.pages
          : null;
      const err = wdData && wdData.error;
      const detail = err
        ? `erreur wikidata : ${err.code || ""} ${err.info || JSON.stringify(err)}`.trim()
        : pages
          ? `${pages.length} item(s) trouvé(s), aucun avec sitelink ${WIKI_LANG}wiki`
          : "réponse wikidata inattendue (pas de query.pages)";
      throw new Error(`wikidata 0 titre — ${detail}`);
    }
    // Mélangé AVANT la troncature à MAX_TITLES : sans ça, une catégorie dense
    // rendrait toujours les 50 mêmes articles du même échantillon.
    return normalizeWiki(await fetchJson(wikiUrl(lib.shuffle(titles.slice()))));
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
    wikidataUrl,
    normalizeWikidataTitles,
    normalizeWiki,
    fetchCategoryItems,
    dedupAndRank: lib.dedupAndRank,
    shuffle: lib.shuffle,
    BUCKETS,
    randomBucket,
  };
});
