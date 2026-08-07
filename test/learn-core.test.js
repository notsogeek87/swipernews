"use strict";
// Tests du noyau Apprendre partagé entre index.html et api/learn.js.
// Objectif principal : garantir que les deux côtés ne peuvent plus diverger,
// et verrouiller le choix du thumbnail plutôt que de l'original Wikipédia.
const test = require("node:test");
const assert = require("node:assert");
const core = require("../src/learn-core.js");

test("chaque catégorie a un identifiant Wikidata, sauf l'aléatoire", () => {
  const random = core.CATEGORIES.find((c) => c.key === "random");
  assert.equal(random.qid, null);
  for (const c of core.CATEGORIES.filter((c) => c.key !== "random")) {
    assert.ok(c.qid && /^Q\d+$/.test(c.qid), `qid manquant/invalide pour ${c.key}`);
    assert.ok(c.label, `label manquant pour ${c.key}`);
  }
  // aucun doublon de qid entre catégories
  const qids = core.CATEGORIES.filter((c) => c.qid).map((c) => c.qid);
  assert.equal(new Set(qids).size, qids.length);
});

test("wikiUrl (catégorie random) demande un thumbnail borné et un tirage aléatoire", () => {
  const url = core.wikiUrl("random");
  assert.ok(url.includes("fr.wikipedia.org/w/api.php"));
  assert.ok(url.includes("piprop=thumbnail"));
  assert.ok(!url.includes("original"), "l'original Commons pèse plusieurs Mo");
  assert.ok(url.includes(`pithumbsize=${core.WIKI_THUMB_PX}`));
  assert.ok(url.includes("generator=random"));
  assert.ok(!url.includes("gsrsearch"));
});

test("wikiUrl (catégorie Wikidata) cherche par haswbstatement, triés au hasard", () => {
  const url = core.wikiUrl("sciences");
  assert.ok(url.includes("fr.wikipedia.org/w/api.php"));
  const params = new URL(url).searchParams;
  assert.equal(params.get("generator"), "search");
  assert.equal(params.get("gsrsearch"), "haswbstatement:P31=Q336");
  assert.equal(params.get("gsrsort"), "random");
  assert.ok(!url.includes("generator=random"));
});

test("wikiUrl OR-combine qid et extraQids quand la catégorie en a", () => {
  const url = core.wikiUrl("animaux");
  const params = new URL(url).searchParams;
  assert.equal(
    params.get("gsrsearch"),
    "haswbstatement:P31=Q729 OR haswbstatement:P31=Q16521"
  );
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

test("fetchCategoryItems (catégorie random) fait un seul aller Wikipédia", async () => {
  const calls = [];
  const fetchJson = async (url) => {
    calls.push(url);
    return {
      query: { pages: [{ title: "T", extract: "y".repeat(130) }] },
    };
  };
  const out = await core.fetchCategoryItems("random", fetchJson);
  assert.equal(calls.length, 1);
  assert.ok(calls[0].includes("generator=random"));
  assert.equal(out.length, 1);
});

test("fetchCategoryItems (catégorie Wikidata) fait aussi un seul aller Wikipédia, filtré", async () => {
  const calls = [];
  const fetchJson = async (url) => {
    calls.push(url);
    return {
      query: { pages: [{ title: "Tardigrade", extract: "z".repeat(130) }] },
    };
  };
  const out = await core.fetchCategoryItems("sciences", fetchJson);
  assert.equal(calls.length, 1);
  assert.ok(calls[0].includes("fr.wikipedia.org"));
  assert.ok(calls[0].includes("haswbstatement%3AP31%3DQ336"));
  assert.equal(out.length, 1);
  assert.equal(out[0].title, "Tardigrade");
});

test("fetchCategoryItems renvoie une liste vide si rien ne correspond (pas une erreur)", async () => {
  const fetchJson = async () => ({ query: { pages: [] } });
  const out = await core.fetchCategoryItems("sciences", fetchJson);
  assert.deepEqual(out, []);
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
