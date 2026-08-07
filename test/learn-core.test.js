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
  const url = core.wikiUrl();
  assert.ok(url.includes("piprop=thumbnail"));
  assert.ok(!url.includes("original"), "l'original Commons pèse plusieurs Mo");
  assert.ok(url.includes(`pithumbsize=${core.WIKI_THUMB_PX}`));
  assert.ok(url.includes("generator=random"));
});

test("wikidataUrl construit une requête SPARQL sur l'identifiant Wikidata de la catégorie", () => {
  const url = core.wikidataUrl("sciences");
  assert.ok(url.startsWith("https://query.wikidata.org/sparql?"));
  const query = decodeURIComponent(url.split("query=")[1]);
  assert.ok(query.includes("wd:Q336"), "doit filtrer sur le qid de la catégorie");
  assert.ok(query.includes("wdt:P31/wdt:P279*"), "arbre instance-of/subclass-of");
  assert.ok(
    query.includes("bd:sample"),
    "échantillonnage aléatoire côté serveur, pas ORDER BY RAND()"
  );
  assert.ok(query.includes("fr.wikipedia.org"));
});

test("wikidataUrl renvoie null pour la catégorie random (pas d'arbre Wikidata)", () => {
  assert.equal(core.wikidataUrl("random"), null);
});

test("normalizeWikidataTitles extrait et dédoublonne les titres d'une réponse SPARQL", () => {
  const data = {
    results: {
      bindings: [
        { title: { value: "Effet tunnel" } },
        { title: { value: "Tardigrade" } },
        { title: { value: "Effet tunnel" } }, // doublon
        {}, // binding sans titre : ignoré
      ],
    },
  };
  assert.deepEqual(core.normalizeWikidataTitles(data), ["Effet tunnel", "Tardigrade"]);
});

test("normalizeWikidataTitles tolère une réponse vide ou mal formée", () => {
  assert.deepEqual(core.normalizeWikidataTitles({}), []);
  assert.deepEqual(core.normalizeWikidataTitles(null), []);
});

test("wikipediaTitlesUrl interroge des titres précis, pas une recherche", () => {
  const url = core.wikipediaTitlesUrl(["Effet tunnel", "Tardigrade"]);
  assert.ok(url.includes("fr.wikipedia.org/w/api.php"));
  assert.ok(url.includes("piprop=thumbnail"));
  assert.ok(!url.includes("generator="));
  assert.ok(!url.includes("gsrsearch"));
  const params = new URL(url).searchParams;
  assert.equal(params.get("titles"), "Effet tunnel|Tardigrade");
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

test("fetchCategoryItems (catégorie Wikidata) enchaîne Wikidata puis Wikipédia", async () => {
  const calls = [];
  const fetchJson = async (url) => {
    calls.push(url);
    if (url.includes("query.wikidata.org")) {
      return { results: { bindings: [{ title: { value: "Tardigrade" } }] } };
    }
    return {
      query: { pages: [{ title: "Tardigrade", extract: "z".repeat(130) }] },
    };
  };
  const out = await core.fetchCategoryItems("sciences", fetchJson);
  assert.equal(calls.length, 2);
  assert.ok(calls[0].includes("query.wikidata.org"));
  assert.ok(calls[1].includes("fr.wikipedia.org"));
  assert.ok(decodeURIComponent(calls[1]).includes("titles=Tardigrade"));
  assert.equal(out.length, 1);
  assert.equal(out[0].title, "Tardigrade");
});

test("fetchCategoryItems renvoie une liste vide si Wikidata ne trouve aucun titre", async () => {
  const fetchJson = async (url) => {
    if (url.includes("query.wikidata.org")) return { results: { bindings: [] } };
    throw new Error("ne devrait pas être appelé sans titre");
  };
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
