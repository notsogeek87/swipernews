// Fonction serverless Vercel : agrège les catégories du mode Apprendre
// (catégories Wikipédia : membres de la catégorie, puis extrait/image/lien)
// CÔTÉ SERVEUR.
//
// Intérêt : mutualiser le cache CDN entre tous les utilisateurs, masquer les
// futures clés d'API, et ne dépendre d'aucun proxy CORS public. Le front
// l'utilise en priorité et se rabat sur son agrégation client si l'endpoint
// n'est pas disponible (hébergement statique).
//
// Les catégories, constructeurs d'URL et normaliseurs vivent dans
// src/learn-core.js, partagés avec le navigateur (une seule implémentation).
//
// Hôte appelé fixe et public (Wikipédia) → pas d'exposition SSRF ici.
"use strict";

const core = require("../src/learn-core.js");

const FETCH_TIMEOUT_MS = 7000;

function fetchWithTimeout(url) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), FETCH_TIMEOUT_MS);
  return fetch(url, { signal: ctl.signal })
    .then((r) => {
      if (!r.ok) throw new Error("http " + r.status);
      return r;
    })
    .finally(() => clearTimeout(t));
}
const fetchJson = (url) => fetchWithTimeout(url).then((r) => r.json());

function parseList(v, fallback) {
  if (!v || typeof v !== "string") return fallback;
  const arr = v
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return arr.length ? arr : fallback;
}

// Le front est same-origin : aucun CORS n'est nécessaire pour lui. On n'ouvre
// que ce qui est explicitement configuré (ALLOWED_ORIGIN), pour ne pas offrir
// l'endpoint comme service gratuit à n'importe quel site tiers.
function applyCors(res) {
  const origin = process.env.ALLOWED_ORIGIN;
  if (origin) res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
}

module.exports = async function handler(req, res) {
  applyCors(res);
  res.setHeader("X-Content-Type-Options", "nosniff");
  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }
  if (req.method !== "GET") {
    res.status(405).json({ error: "Méthode non autorisée" });
    return;
  }

  const q = req.query || {};
  const known = new Set(core.CATEGORIES.map((c) => c.key));
  const cats = parseList(q.cats, ["random"]).filter((c) => known.has(c));
  const count = Math.min(Math.max(parseInt(q.count, 10) || 20, 1), 40);
  const catList = cats.length ? cats : ["random"];

  const tag = (p, catKey) => p.then((list) => list.map((it) => ({ ...it, cat: catKey })));
  const tasks = catList.map((catKey) =>
    tag(core.fetchCategoryItems(catKey, fetchJson), catKey)
  );

  const results = await Promise.allSettled(tasks);
  const lists = results.filter((r) => r.status === "fulfilled").map((r) => r.value);
  const items = core.dedupAndRank(lists, count);

  if (!items.length) {
    res.setHeader("Cache-Control", "no-store");
    res.status(502).json({ error: "Aucun contenu récupéré" });
    return;
  }

  // Le contenu est aléatoire, mais l'URL porte un « seau » (paramètre b) tiré
  // au sort par le client parmi un petit nombre de valeurs : chaque variante
  // est donc cacheable par le CDN, tout en restant variée à l'échelle d'une
  // session. C'est ce qui rend le backend réellement plus rapide que
  // l'agrégation client, au lieu de payer l'aller-retour à chaque lot.
  res.setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate=3600");
  res.status(200).json({ items });
};

// Exports pour les tests unitaires (les normaliseurs vivent dans learn-core).
module.exports.normalizeWiki = core.normalizeWiki;
module.exports.dedupAndRank = core.dedupAndRank;
