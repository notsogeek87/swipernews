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

test("wikidataUrl cherche les items typés par le qid de la catégorie, triés au hasard", () => {
  const url = core.wikidataUrl("sciences");
  assert.ok(url.startsWith("https://www.wikidata.org/w/api.php?"));
  const params = new URL(url).searchParams;
  assert.equal(params.get("generator"), "search");
  assert.equal(params.get("gsrsearch"), "haswbstatement:P31=Q336");
  assert.equal(params.get("gsrsort"), "random");
  assert.equal(params.get("sitefilter"), "frwiki");
  assert.equal(params.get("prop"), "sitelinks");
});

test("wikidataUrl renvoie null pour la catégorie random (pas de qid)", () => {
  assert.equal(core.wikidataUrl("random"), null);
});

test("wikidataUrl OR-combine qid et extraQids quand la catégorie en a", () => {
  const url = core.wikidataUrl("animaux");
  const params = new URL(url).searchParams;
  assert.equal(
    params.get("gsrsearch"),
    "haswbstatement:P31=Q729 OR haswbstatement:P31=Q16521"
  );
});

test("normalizeWikidataTitles extrait le sitelink frwiki et dédoublonne", () => {
  const data = {
    query: {
      pages: [
        {
          sitelinks: [
            { site: "frwiki", title: "Effet tunnel" },
            { site: "dewiki", title: "Tunneleffekt" },
          ],
        },
        { sitelinks: [{ site: "frwiki", title: "Tardigrade" }] },
        { sitelinks: [{ site: "frwiki", title: "Effet tunnel" }] }, // doublon
        { sitelinks: [{ site: "dewiki", title: "Ohne frwiki" }] }, // pas de sitelink frwiki : ignoré
        {}, // pas de sitelinks du tout : ignoré
      ],
    },
  };
  assert.deepEqual(core.normalizeWikidataTitles(data), ["Effet tunnel", "Tardigrade"]);
});

test("normalizeWikidataTitles accepte l'ancien format sitelinks indexé par site", () => {
  const data = { query: { pages: [{ sitelinks: { frwiki: { title: "Tardigrade" } } }] } };
  assert.deepEqual(core.normalizeWikidataTitles(data), ["Tardigrade"]);
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
    if (url.includes("www.wikidata.org")) {
      return {
        query: { pages: [{ sitelinks: [{ site: "frwiki", title: "Tardigrade" }] }] },
      };
    }
    return {
      query: { pages: [{ title: "Tardigrade", extract: "z".repeat(130) }] },
    };
  };
  const out = await core.fetchCategoryItems("sciences", fetchJson);
  assert.equal(calls.length, 2);
  assert.ok(calls[0].includes("www.wikidata.org"));
  assert.ok(calls[1].includes("fr.wikipedia.org"));
  assert.ok(decodeURIComponent(calls[1]).includes("titles=Tardigrade"));
  assert.equal(out.length, 1);
  assert.equal(out[0].title, "Tardigrade");
});

test("fetchCategoryItems échoue explicitement si Wikidata ne trouve aucun item (pas une liste vide silencieuse)", async () => {
  const fetchJson = async (url) => {
    if (url.includes("www.wikidata.org")) return { query: { pages: [] } };
    throw new Error("ne devrait pas être appelé sans titre");
  };
  await assert.rejects(
    core.fetchCategoryItems("sciences", fetchJson),
    /0 item\(s\) trouvé/
  );
});

test("fetchCategoryItems distingue des items trouvés sans sitelink exploitable", async () => {
  const fetchJson = async (url) => {
    if (url.includes("www.wikidata.org")) {
      return {
        query: { pages: [{ sitelinks: [{ site: "dewiki", title: "Ohne frwiki" }] }] },
      };
    }
    throw new Error("ne devrait pas être appelé sans titre");
  };
  await assert.rejects(
    core.fetchCategoryItems("sciences", fetchJson),
    /1 item\(s\) trouvé\(s\), aucun avec sitelink frwiki/
  );
});

test("fetchCategoryItems remonte l'erreur Wikidata plutôt que de l'avaler", async () => {
  const fetchJson = async (url) => {
    if (url.includes("www.wikidata.org")) {
      return { error: { code: "badvalue", info: "paramètre invalide" } };
    }
    throw new Error("ne devrait pas être appelé sans titre");
  };
  await assert.rejects(core.fetchCategoryItems("sciences", fetchJson), /badvalue/);
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
