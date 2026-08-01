"use strict";
// Tests du noyau Apprendre partagé entre index.html et api/learn.js.
// Objectif principal : garantir que les deux côtés ne peuvent plus diverger,
// et verrouiller le choix du thumbnail plutôt que de l'original Wikipédia.
const test = require("node:test");
const assert = require("node:assert");
const core = require("../src/learn-core.js");

test("chaque catégorie a une requête Wikipédia et un terme, sauf l'aléatoire", () => {
  const random = core.CATEGORIES.find((c) => c.key === "random");
  assert.equal(random.q, null);
  assert.equal(random.term, "");
  for (const c of core.CATEGORIES.filter((c) => c.key !== "random")) {
    assert.ok(c.q && c.q.startsWith("deepcategory:"), `q manquante pour ${c.key}`);
    assert.ok(c.term, `term manquant pour ${c.key}`);
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

test("wikiUrl bascule en tirage aléatoire pour la catégorie random", () => {
  const url = core.wikiUrl("random");
  assert.ok(url.includes("generator=random"));
  assert.ok(!url.includes("gsrsearch"));
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

test("gallicaUrl ne construit rien pour la catégorie aléatoire", () => {
  assert.equal(core.gallicaUrl("random"), "");
  assert.ok(core.gallicaUrl("histoire").includes("gallica.bnf.fr/SRU"));
});

test("sourcesForCat respecte la pertinence et la sélection de l'utilisateur", () => {
  const all = ["wikipedia", "gbif", "gallica"];
  // GBIF n'a de sens que sur nature/sciences
  assert.deepEqual(
    core.sourcesForCat("cinema", all).map((s) => s.key),
    ["wikipedia", "gallica"]
  );
  assert.deepEqual(
    core.sourcesForCat("nature", all).map((s) => s.key),
    ["wikipedia", "gbif", "gallica"]
  );
  // une source désactivée n'est jamais interrogée
  assert.deepEqual(
    core.sourcesForCat("nature", ["wikipedia"]).map((s) => s.key),
    ["wikipedia"]
  );
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
  assert.equal(api.normalizeGallica, core.normalizeGallica);
  assert.equal(api.dedupAndRank, core.dedupAndRank);
});
