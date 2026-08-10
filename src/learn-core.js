// Noyau du mode Apprendre, PARTAGÉ entre le navigateur et la fonction serverless.
//
// Avant, `index.html` et `api/learn.js` embarquaient chacun leur copie des
// catégories, des constructeurs d'URL et des normaliseurs — et les deux avaient
// déjà divergé (12 catégories côté front, 11 côté serveur ; deux parseurs
// Gallica différents). Tout est ici, en un seul exemplaire.
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
  // Langues pour lesquelles on sait interroger Wikipédia dans SA langue (voir
  // wikiUrl ci-dessous) — même liste que SwiperI18n.LANGS (src/i18n.js), non
  // importée ici pour ne pas coupler les deux modules : le noyau reste
  // utilisable seul côté serveur (api/learn.js).
  const LANGS = ["fr", "en"];

  /**
   * Source unique de vérité des centres d'intérêt.
   *
   * q : requête de recherche Wikipédia (français). `null` = tirage purement
   * aléatoire. qByLang : mêmes requêtes traduites pour les langues de LANGS
   * autres que le français — voir wikiUrl.
   *
   *   - `deepcategory:"…"` parcourt la catégorie ET ses sous-catégories. Large,
   *     mais l'arbre range sous un sujet bien plus que le sujet lui-même : sous
   *     « Jeu vidéo » viennent aussi studios, consoles et personnalités.
   *   - `insource:"…"` cherche dans le WIKITEXTE de l'article (pas dans le texte
   *     rendu) et se cumule en ET avec le reste. Il ne garde donc que les
   *     articles qui SONT la chose voulue.
   *
   * Contrepartie assumée là où insource est présent : la tournure doit être
   * exacte. Un article ouvrant sur « est un jeu de plateforme » ou « est une
   * série de jeux vidéo » sort du lot — catégorie plus juste, mais moins
   * fournie. Les catégories sans insource sont celles où aucune tournure ne
   * s'impose (Sciences, Histoire, Arts, Géographie, Astronomie, Philosophie).
   * Les traductions anglaises (qByLang.en) portent la même fragilité, avec
   * l'arbre de catégories propre à en.wikipedia.org — à vérifier/affiner si
   * une catégorie s'avère trop pauvre dans cette langue.
   */
  const CATEGORIES = [
    { key: "random", label: "🎲 Aléatoire", q: null },
    {
      key: "sciences",
      label: "🔬 Sciences",
      q: 'deepcategory:"Sciences"',
      qByLang: { en: 'deepcategory:"Science"' },
    },
    {
      key: "histoire",
      label: "📜 Histoire",
      q: 'deepcategory:"Histoire"',
      qByLang: { en: 'deepcategory:"History"' },
    },
    {
      key: "art",
      label: "🎨 Art & Culture",
      q: 'deepcategory:"Arts"',
      qByLang: { en: 'deepcategory:"The arts"' },
    },
    {
      key: "artistes",
      label: "🎭 Artistes",
      q: 'deepcategory:"Artiste" insource:"est un artiste"',
      qByLang: { en: 'deepcategory:"Artists" insource:"is an artist"' },
    },
    {
      key: "geo",
      label: "🌍 Géographie",
      q: 'deepcategory:"Géographie"',
      qByLang: { en: 'deepcategory:"Geography"' },
    },
    {
      key: "nature",
      label: "🐾 Espèces",
      q: 'deepcategory:"Nature" insource:"est une espèce"',
      qByLang: { en: 'deepcategory:"Nature" insource:"is a species"' },
    },
    {
      key: "espace",
      label: "🌌 Espace",
      q: 'deepcategory:"Astronomie"',
      qByLang: { en: 'deepcategory:"Astronomy"' },
    },
    {
      key: "tech",
      label: "💻 Technologie",
      q: 'deepcategory:"Technologie" insource:"est un protocole"',
      qByLang: { en: 'deepcategory:"Technology" insource:"is a protocol"' },
    },
    {
      key: "sport",
      label: "⚽ Disciplines sportives",
      q: 'deepcategory:"Sport" insource:"est une discipline sportive"',
      qByLang: { en: 'deepcategory:"Sports" insource:"is a sport"' },
    },
    // Fusion de « Cinéma » et « Films » : depuis qu'ils partagent la même
    // tournure, ils rendaient le même contenu sous deux puces — l'arbre
    // « Cinéma » englobant « Film », le second n'en était qu'un sous-ensemble.
    // On garde donc le plus large. L'ancienne clé "cinema" est rebasculée sur
    // celle-ci au chargement (voir CAT_RENAMED dans index.html).
    {
      key: "films",
      label: "🎬 Films",
      q: 'deepcategory:"Cinéma" insource:"est un film"',
      qByLang: { en: 'deepcategory:"Film" insource:"is a film"' },
    },
    {
      key: "series",
      label: "📺 Séries télévisées",
      q: 'deepcategory:"Série télévisée" insource:"est une série télévisée"',
      qByLang: {
        en: 'deepcategory:"Television series" insource:"is a television series"',
      },
    },
    {
      key: "musique",
      label: "🎵 Chansons",
      q: 'deepcategory:"Musique" insource:"est une chanson"',
      qByLang: { en: 'deepcategory:"Songs" insource:"is a song"' },
    },
    {
      key: "jeuxvideo",
      label: "🎮 Jeux vidéo",
      q: 'deepcategory:"Jeu vidéo" insource:"est un jeu vidéo"',
      qByLang: { en: 'deepcategory:"Video games" insource:"is a video game"' },
    },
    // Wikipédia n'est pas un livre de recettes (règle de fond du projet) : ce sont
    // des articles SUR les plats — origine, histoire, variantes — pas des marches
    // à suivre. Les vraies recettes sont sur Wikilivres, autre hôte, autre
    // extraction. `insource:"est un plat"` fait ici le tri que la sous-catégorie
    // "Spécialité culinaire" faisait autrement : exit les chefs et les ustensiles.
    {
      key: "cuisine",
      label: "🍲 Plats",
      q: 'deepcategory:"Cuisine" insource:"est un plat"',
      qByLang: { en: 'deepcategory:"Food" insource:"is a dish"' },
    },
    {
      key: "philo",
      label: "🧠 Philosophie",
      q: 'deepcategory:"Philosophie"',
      qByLang: { en: 'deepcategory:"Philosophy"' },
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
   * @param {string} catKey
   * @param {string} [lang]  Langue de Wikipédia à interroger (LANGS). Repli
   *   silencieux sur WIKI_LANG (français) si absente ou non reconnue — c'est
   *   la langue par défaut de l'app, jamais un cas d'erreur.
   *   Pour une langue de LANGS sans traduction encore écrite pour CETTE
   *   catégorie (qByLang incomplet), on bascule sur le tirage aléatoire de
   *   cette langue plutôt que d'envoyer une requête française à un Wikipédia
   *   qui ne la comprendra pas — dégradé, mais jamais silencieusement faux.
   */
  function wikiUrl(catKey, lang) {
    const c = catByKey(catKey);
    const l = LANGS.includes(lang) ? lang : WIKI_LANG;
    const q = l === WIKI_LANG ? c.q : c.qByLang && c.qByLang[l];
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
    });
    if (q) {
      params.set("generator", "search");
      params.set("gsrsearch", q);
      params.set("gsrsort", "random");
      params.set("gsrnamespace", "0");
      params.set("gsrlimit", "20");
    } else {
      params.set("generator", "random");
      params.set("grnnamespace", "0");
      params.set("grnlimit", "20");
    }
    return `https://${l}.wikipedia.org/w/api.php?${params}`;
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
    LANGS,
    WIKI_THUMB_PX,
    CATEGORIES,
    catByKey,
    catLabel,
    wikiUrl,
    normalizeWiki,
    dedupAndRank: lib.dedupAndRank,
    shuffle: lib.shuffle,
    BUCKETS,
    randomBucket,
  };
});
