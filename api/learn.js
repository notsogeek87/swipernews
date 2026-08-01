// Fonction serverless Vercel : agrège les sources du mode Apprendre
// (Wikipédia, GBIF/INPN, Gallica/BnF) CÔTÉ SERVEUR.
//
// Intérêt (audit, scalabilité) : mutualiser le cache CDN entre tous les
// utilisateurs, masquer les futures clés d'API, et ne dépendre d'aucun proxy
// CORS public. Le front l'utilise en priorité et se rabat sur son agrégation
// client si l'endpoint n'est pas disponible (hébergement statique).
//
// Hôtes appelés fixes et publics → pas d'exposition SSRF ici.

const WIKI_LANG = "fr";
const FETCH_TIMEOUT_MS = 7000;

// Requête de recherche Wikipédia par catégorie (deepcategory cible la catégorie
// et ses sous-catégories). null = tirage purement aléatoire.
const CAT_Q = {
  sciences: 'deepcategory:"Sciences"',
  histoire: 'deepcategory:"Histoire"',
  art: 'deepcategory:"Arts"',
  geo: 'deepcategory:"Géographie"',
  nature: 'deepcategory:"Nature"',
  espace: 'deepcategory:"Astronomie"',
  tech: 'deepcategory:"Technologie"',
  sport: 'deepcategory:"Sport"',
  cinema: 'deepcategory:"Cinéma"',
  musique: 'deepcategory:"Musique"',
  philo: 'deepcategory:"Philosophie"',
};
// Terme FR par catégorie pour les sources autres que Wikipédia
const CAT_TERM = {
  sciences: "science",
  histoire: "histoire",
  art: "art",
  geo: "géographie",
  nature: "nature",
  espace: "astronomie",
  tech: "technologie",
  sport: "sport",
  cinema: "cinéma",
  musique: "musique",
  philo: "philosophie",
};

function fetchJson(url) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), FETCH_TIMEOUT_MS);
  return fetch(url, { signal: ctl.signal })
    .then((r) => {
      if (!r.ok) throw new Error("http " + r.status);
      return r.json();
    })
    .finally(() => clearTimeout(t));
}
function fetchText(url) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), FETCH_TIMEOUT_MS);
  return fetch(url, { signal: ctl.signal })
    .then((r) => {
      if (!r.ok) throw new Error("http " + r.status);
      return r.text();
    })
    .finally(() => clearTimeout(t));
}

// --- Normalisation (pures, testables sans réseau) ---
function normalizeWiki(data) {
  const pages =
    data && data.query && data.query.pages ? Object.values(data.query.pages) : [];
  return pages
    .map((p) => ({
      source: "Wikipédia",
      title: p.title || "",
      desc: (p.extract || "").replace(/\s+/g, " ").trim(),
      link: p.canonicalurl || p.fullurl || "",
      img: (p.original && p.original.source) || (p.thumbnail && p.thumbnail.source) || "",
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
        link: o.key ? `https://www.gbif.org/occurrence/${o.key}` : "https://www.gbif.org",
      };
    })
    .filter(Boolean);
}
// Extraction minimale des enregistrements SRU Gallica (Node n'a pas de DOMParser).
function normalizeGallica(xml) {
  const out = [];
  const records = xml.match(/<(?:\w+:)?record\b[\s\S]*?<\/(?:\w+:)?record>/gi) || [];
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

function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
// Dédoublonne, met les cartes avec image d'abord, mélange, tronque.
function dedupAndRank(lists, count) {
  const seen = new Set();
  const out = [];
  for (const list of lists) {
    for (const it of list) {
      const k = (it.link || "") + "|" + it.title;
      if (it.title && !seen.has(k)) {
        seen.add(k);
        out.push(it);
      }
    }
  }
  const withImg = shuffle(out.filter((i) => i.img));
  const noImg = shuffle(out.filter((i) => !i.img));
  return withImg.concat(noImg).slice(0, count);
}

// --- Récupération par source ---
async function srcWikipedia(catKey) {
  const params = new URLSearchParams({
    action: "query",
    format: "json",
    prop: "extracts|pageimages|info",
    explaintext: "1",
    exintro: "1",
    exlimit: "20",
    piprop: "thumbnail|original",
    pithumbsize: "1200",
    pilimit: "20",
    inprop: "url",
  });
  const q = CAT_Q[catKey];
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
  const data = await fetchJson(`https://${WIKI_LANG}.wikipedia.org/w/api.php?${params}`);
  return normalizeWiki(data);
}
async function srcGbif() {
  const off = Math.floor(Math.random() * 300);
  const data = await fetchJson(
    `https://api.gbif.org/v1/occurrence/search?mediaType=StillImage&limit=20&offset=${off}&country=FR`
  );
  return normalizeGbif(data);
}
async function srcGallica(catKey) {
  const term = CAT_TERM[catKey];
  if (!term) return [];
  const query = `(gallica all "${term}") and (dc.type all "image")`;
  const xml = await fetchText(
    `https://gallica.bnf.fr/SRU?operation=searchRetrieve&version=1.2&maximumRecords=20&query=${encodeURIComponent(query)}`
  );
  return normalizeGallica(xml);
}

const SOURCES = {
  wikipedia: { fn: srcWikipedia, cats: "*" },
  gbif: { fn: srcGbif, cats: ["nature", "sciences"] },
  gallica: { fn: srcGallica, cats: "*" },
};

function parseList(v, fallback) {
  if (!v || typeof v !== "string") return fallback;
  const arr = v
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return arr.length ? arr : fallback;
}

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }
  const q = req.query || {};
  const cats = parseList(q.cats, ["random"]);
  const wanted = parseList(q.sources, ["wikipedia"]);
  const count = Math.min(Math.max(parseInt(q.count, 10) || 20, 1), 40);

  const tag = (p, catKey) => p.then((list) => list.map((it) => ({ ...it, cat: catKey }))); // marque la catégorie
  const tasks = [];
  for (const catKey of cats) {
    for (const key of wanted) {
      const s = SOURCES[key];
      if (!s) continue;
      if (s.cats === "*" || s.cats.includes(catKey))
        tasks.push(tag(s.fn(catKey), catKey));
    }
  }
  if (!tasks.length)
    tasks.push(tag(srcWikipedia(cats[0] || "random"), cats[0] || "random")); // garde-fou

  const results = await Promise.allSettled(tasks);
  const lists = results.filter((r) => r.status === "fulfilled").map((r) => r.value);
  const items = dedupAndRank(lists, count);

  if (!items.length) {
    res.status(502).json({ error: "Aucun contenu récupéré" });
    return;
  }
  // Contenu ALÉATOIRE : pas de cache CDN, sinon le scroll infini rappelle la même
  // URL et reçoit le même lot → plus rien de neuf à ajouter. Chaque appel est frais.
  res.setHeader("Cache-Control", "no-store");
  res.status(200).json({ items });
};

// Exports pour les tests unitaires
module.exports.normalizeWiki = normalizeWiki;
module.exports.normalizeGbif = normalizeGbif;
module.exports.normalizeGallica = normalizeGallica;
module.exports.dedupAndRank = dedupAndRank;
