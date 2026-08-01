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

  /**
   * Source unique de vérité des centres d'intérêt.
   * q    : requête de recherche Wikipédia (deepcategory = catégorie + sous-catégories).
   *        null = tirage purement aléatoire.
   * term : terme FR employé par les sources non-Wikipédia (Gallica).
   */
  const CATEGORIES = [
    { key: "random", label: "🎲 Aléatoire", q: null, term: "" },
    {
      key: "sciences",
      label: "🔬 Sciences",
      q: 'deepcategory:"Sciences"',
      term: "science",
    },
    {
      key: "histoire",
      label: "📜 Histoire",
      q: 'deepcategory:"Histoire"',
      term: "histoire",
    },
    { key: "art", label: "🎨 Art & Culture", q: 'deepcategory:"Arts"', term: "art" },
    {
      key: "geo",
      label: "🌍 Géographie",
      q: 'deepcategory:"Géographie"',
      term: "géographie",
    },
    { key: "nature", label: "🐾 Nature", q: 'deepcategory:"Nature"', term: "nature" },
    {
      key: "espace",
      label: "🌌 Espace",
      q: 'deepcategory:"Astronomie"',
      term: "astronomie",
    },
    {
      key: "tech",
      label: "💻 Technologie",
      q: 'deepcategory:"Technologie"',
      term: "technologie",
    },
    { key: "sport", label: "⚽ Sport", q: 'deepcategory:"Sport"', term: "sport" },
    { key: "cinema", label: "🎬 Cinéma", q: 'deepcategory:"Cinéma"', term: "cinéma" },
    { key: "musique", label: "🎵 Musique", q: 'deepcategory:"Musique"', term: "musique" },
    {
      key: "philo",
      label: "🧠 Philosophie",
      q: 'deepcategory:"Philosophie"',
      term: "philosophie",
    },
  ];
  const catByKey = (key) => CATEGORIES.find((c) => c.key === key) || CATEGORIES[0];
  const catLabel = (key) => {
    const c = CATEGORIES.find((x) => x.key === key);
    return c ? c.label : "";
  };

  /** Sources disponibles. cats "*" = pertinente pour toutes les catégories. */
  const SOURCE_META = [
    { key: "wikipedia", label: "Wikipédia", cats: "*" },
    { key: "gbif", label: "GBIF · INPN", cats: ["nature", "sciences"] },
    { key: "gallica", label: "Gallica · BnF", cats: "*" },
  ];
  function sourcesForCat(catKey, enabled) {
    return SOURCE_META.filter(
      (s) =>
        (!enabled || enabled.includes(s.key)) &&
        (s.cats === "*" || s.cats.includes(catKey))
    );
  }

  /* ---------- Construction des URL ---------- */

  const WIKI_THUMB_PX = 1000; // suffisant pour un fond plein écran, même en DPR 3

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
      exlimit: "20",
      piprop: "thumbnail",
      pithumbsize: String(WIKI_THUMB_PX),
      pilimit: "20",
      inprop: "url",
    });
    if (c.q) {
      params.set("generator", "search");
      params.set("gsrsearch", c.q);
      params.set("gsrsort", "random");
      params.set("gsrnamespace", "0");
      params.set("gsrlimit", "20");
    } else {
      params.set("generator", "random");
      params.set("grnnamespace", "0");
      params.set("grnlimit", "20");
    }
    return `https://${WIKI_LANG}.wikipedia.org/w/api.php?${params}`;
  }

  function gbifUrl() {
    const off = Math.floor(Math.random() * 300);
    return `https://api.gbif.org/v1/occurrence/search?mediaType=StillImage&limit=20&offset=${off}&country=FR`;
  }

  function gallicaUrl(catKey) {
    const term = catByKey(catKey).term;
    if (!term) return ""; // "Aléatoire" : pas de terme → on n'interroge pas Gallica
    const query = `(gallica all "${term}") and (dc.type all "image")`;
    return `https://gallica.bnf.fr/SRU?operation=searchRetrieve&version=1.2&maximumRecords=20&query=${encodeURIComponent(query)}`;
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

  function normalizeGbif(data) {
    const rows = (data && data.results) || [];
    return rows
      .map((o) => {
        const media = (o.media || []).find((m) => m && m.identifier);
        const img = media ? media.identifier : "";
        const name =
          o.scientificName || o.acceptedScientificName || o.verbatimScientificName || "";
        const vern = o.vernacularName || "";
        const title = vern || name;
        if (!title || !img) return null;
        const taxo = [o.kingdom, o.phylum, o.class, o.order, o.family]
          .filter(Boolean)
          .join(" › ");
        const where = [o.locality, o.stateProvince, o.country].filter(Boolean).join(", ");
        const desc = `${name}${vern ? ` — « ${vern} »` : ""}. Classification : ${taxo || "non précisée"}.${where ? ` Observé à ${where}.` : ""} Donnée de biodiversité (GBIF / INPN).`;
        return {
          source: "GBIF · INPN",
          title,
          desc,
          img,
          date: "",
          link: o.key
            ? `https://www.gbif.org/occurrence/${o.key}`
            : "https://www.gbif.org",
        };
      })
      .filter(Boolean);
  }

  // Lecture des enregistrements SRU Gallica par expressions régulières : une
  // seule implémentation pour Node (pas de DOMParser) et le navigateur.
  function normalizeGallica(xml) {
    const out = [];
    const records = String(xml || "").match(
      /<(?:\w+:)?record\b[\s\S]*?<\/(?:\w+:)?record>/gi
    );
    if (!records) return out;
    const pick = (block, local) => {
      const m = block.match(
        new RegExp(`<(?:\\w+:)?${local}\\b[^>]*>([\\s\\S]*?)</(?:\\w+:)?${local}>`, "i")
      );
      return m ? m[1].replace(/<[^>]+>/g, "").trim() : "";
    };
    const pickAll = (block, local) => {
      const re = new RegExp(
        `<(?:\\w+:)?${local}\\b[^>]*>([\\s\\S]*?)</(?:\\w+:)?${local}>`,
        "gi"
      );
      const arr = [];
      let m;
      while ((m = re.exec(block))) arr.push(m[1].replace(/<[^>]+>/g, "").trim());
      return arr;
    };
    for (const block of records) {
      const title = pick(block, "title");
      const creator = pick(block, "creator");
      const date = pick(block, "date");
      const descr = pick(block, "description");
      const ident = pickAll(block, "identifier").find((u) => u.includes("ark:/")) || "";
      const m = ident.match(/ark:\/([^\s"']+)/);
      if (!title || !m) continue;
      const img = `https://gallica.bnf.fr/iiif/ark:/${m[1]}/f1/full/,800/0/native.jpg`;
      const desc =
        [descr, [creator, date].filter(Boolean).join(", ")].filter(Boolean).join(" — ") ||
        title;
      out.push({ source: "Gallica · BnF", title, desc, img, date: "", link: ident });
    }
    return out;
  }

  /**
   * Nombre de variantes cacheables de `/api/learn`.
   *
   * Le contenu est aléatoire : avec un nonce par requête, chaque appel manquait
   * le CDN et payait l'aller-retour vers Wikipédia + GBIF + Gallica. Avec un
   * « seau » tiré au sort parmi BUCKETS, chaque variante est cacheable et reste
   * largement assez variée à l'échelle d'une session.
   */
  const BUCKETS = 12;
  const randomBucket = () => Math.floor(Math.random() * BUCKETS);

  return {
    WIKI_LANG,
    WIKI_THUMB_PX,
    CATEGORIES,
    catByKey,
    catLabel,
    SOURCE_META,
    sourcesForCat,
    wikiUrl,
    gbifUrl,
    gallicaUrl,
    normalizeWiki,
    normalizeGbif,
    normalizeGallica,
    dedupAndRank: lib.dedupAndRank,
    shuffle: lib.shuffle,
    BUCKETS,
    randomBucket,
  };
});
