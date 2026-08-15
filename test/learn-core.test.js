"use strict";
// Tests du noyau Apprendre partagé entre index.html et api/learn.js.
// Objectif principal : garantir que les deux côtés ne peuvent plus diverger,
// et verrouiller le choix du thumbnail plutôt que de l'original Wikipédia.
const test = require("node:test");
const assert = require("node:assert");
const core = require("../src/learn-core.js");

test("chaque catégorie a une requête Wikipédia, sauf l'aléatoire", () => {
  const random = core.CATEGORIES.find((c) => c.key === "random");
  assert.equal(random.q, null);
  for (const c of core.CATEGORIES.filter((c) => c.key !== "random")) {
    assert.ok(c.q && c.q.startsWith("deepcategory:"), `q manquante pour ${c.key}`);
    assert.ok(c.label, `label manquant pour ${c.key}`);
  }
});

test("wikiUrl demande un thumbnail borné et jamais l'image originale", () => {
  const url = core.wikiUrl("sciences");
  assert.ok(url.includes("piprop=thumbnail"));
  assert.ok(!url.includes("original"), "l'original Commons pèse plusieurs Mo");
  assert.ok(url.includes(`pithumbsize=${core.WIKI_THUMB_PX}`));
  assert.ok(url.includes("generator=search"));
  assert.ok(url.includes("gsrsort=random"));
});

test("perCatLimit ne demande à chaque catégorie que ce que le lot consomme", () => {
  // Trois catégories pour un lot de 20 : ~7 par catégorie sont réellement
  // servies par le tour de rôle, on en demande le double de marge, pas le
  // plafond de l'API à chacune (ce qui faisait 60 extraits pour 20 gardés).
  assert.equal(core.perCatLimit(20, 3), 14);
  assert.ok(core.perCatLimit(20, 3) * 3 > 20, "la marge doit couvrir le besoin");
});

test("perCatLimit retombe sur le plafond quand la catégorie fournit tout le lot", () => {
  // Filtre précis (une seule catégorie) ou deux catégories : rien ne change,
  // chacune doit pouvoir remplir le lot à elle seule ou presque.
  assert.equal(core.perCatLimit(20, 1), core.PAGES_MAX);
  assert.equal(core.perCatLimit(20, 2), core.PAGES_MAX);
});

test("perCatLimit reste dans les bornes de l'API, quelles que soient les entrées", () => {
  for (const [count, n] of [
    [40, 1],
    [1, 1],
    [20, 12],
    [0, 0],
    [-5, -5],
    [NaN, NaN],
    ["20", "3"],
  ]) {
    const v = core.perCatLimit(count, n);
    assert.ok(Number.isInteger(v) && v >= 1 && v <= core.PAGES_MAX, `hors bornes : ${v}`);
  }
});

test("wikiUrl fait suivre la limite aux TROIS compteurs du générateur", () => {
  const url = core.wikiUrl("sciences", "fr", 14);
  assert.ok(url.includes("exlimit=14"), "les extraits sont la partie chère");
  assert.ok(url.includes("pilimit=14"));
  assert.ok(url.includes("gsrlimit=14"));
  // Tirage aléatoire : c'est grnlimit qui porte la limite du générateur.
  assert.ok(core.wikiUrl("random", "fr", 14).includes("grnlimit=14"));
});

test("wikiUrl sans limite garde le plafond de l'API (compat des appels isolés)", () => {
  const url = core.wikiUrl("sciences");
  assert.ok(url.includes(`exlimit=${core.PAGES_MAX}`));
  assert.ok(url.includes(`gsrlimit=${core.PAGES_MAX}`));
});

test("wikiUrl n'envoie jamais une limite hors bornes dans l'URL", () => {
  for (const bad of [0, -3, 999, NaN, "abc"]) {
    const url = core.wikiUrl("sciences", "fr", bad);
    const n = Number(/exlimit=(\d+)/.exec(url)[1]);
    assert.ok(n >= 1 && n <= core.PAGES_MAX, `exlimit=${n} pour ${bad}`);
  }
});

test("wikiUrl bascule en tirage aléatoire pour la catégorie random", () => {
  const url = core.wikiUrl("random");
  assert.ok(url.includes("generator=random"));
  assert.ok(!url.includes("gsrsearch"));
});

test("wikiUrl interroge le Wikipédia de la langue demandée", () => {
  const url = core.wikiUrl("sciences", "en");
  assert.ok(url.startsWith("https://en.wikipedia.org/"));
  assert.ok(decodeURIComponent(url).includes('deepcategory:"Science"'));
});

test("wikiUrl retombe sur le français pour une langue non reconnue", () => {
  const url = core.wikiUrl("sciences", "de");
  assert.ok(url.startsWith("https://fr.wikipedia.org/"));
});

test("wikiUrl sans langue reste le français par défaut (compat)", () => {
  const url = core.wikiUrl("sciences");
  assert.ok(url.startsWith("https://fr.wikipedia.org/"));
});

test("chaque catégorie autre qu'aléatoire a une traduction anglaise de sa requête", () => {
  for (const c of core.CATEGORIES.filter((c) => c.key !== "random")) {
    assert.ok(c.qByLang && c.qByLang.en, `qByLang.en manquant pour ${c.key}`);
  }
});

test("normalizeWiki préfère le thumbnail et écarte les extraits trop courts", () => {
  const out = core.normalizeWiki({
    query: {
      pages: [
        {
          title: "Effet tunnel",
          extract: "x".repeat(150),
          canonicalurl: "https://fr.wikipedia.org/wiki/Effet_tunnel",
          thumbnail: { source: "https://img/thumb.jpg" },
          original: { source: "https://img/ENORME.tif" },
        },
        { title: "Trop court", extract: "court" },
      ],
    },
  });
  assert.equal(out.length, 1);
  assert.equal(out[0].img, "https://img/thumb.jpg");
});

test("normalizeWiki accepte encore l'ancien format indexé par pageid", () => {
  const out = core.normalizeWiki({
    query: { pages: { 42: { title: "T", extract: "y".repeat(130) } } },
  });
  assert.equal(out.length, 1);
  assert.equal(out[0].title, "T");
});

test("randomBucket reste dans la plage cacheable", () => {
  for (let i = 0; i < 200; i++) {
    const b = core.randomBucket();
    assert.ok(Number.isInteger(b) && b >= 0 && b < core.BUCKETS);
  }
});

test("api/learn réexporte bien le noyau partagé (pas de seconde implémentation)", () => {
  const api = require("../api/learn.js");
  assert.equal(api.normalizeWiki, core.normalizeWiki);
  assert.equal(api.dedupAndRank, core.dedupAndRank);
});
