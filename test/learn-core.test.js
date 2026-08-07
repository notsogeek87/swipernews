"use strict";
// Tests du noyau Apprendre partagé entre index.html et api/learn.js.
// Objectif principal : garantir que les deux côtés ne peuvent plus diverger,
// et verrouiller le choix du thumbnail plutôt que de l'original Wikipédia.
const test = require("node:test");
const assert = require("node:assert");
const core = require("../src/learn-core.js");

test("chaque catégorie a des identifiants Wikidata valides, sauf l'aléatoire", () => {
  const random = core.CATEGORIES.find((c) => c.key === "random");
  assert.equal(random.qids, null);
  for (const c of core.CATEGORIES.filter((c) => c.key !== "random")) {
    assert.ok(Array.isArray(c.qids) && c.qids.length, `qids manquants pour ${c.key}`);
    for (const q of c.qids) {
      assert.ok(/^Q\d+$/.test(q), `qid invalide (${q}) pour ${c.key}`);
    }
    assert.ok(c.label, `label manquant pour ${c.key}`);
  }
});

test("les 15 catégories demandées sont là, avec leur qid principal en tête", () => {
  // L'ordre des qids compte : le premier est celui explicitement demandé, les
  // suivants ne sont là que pour rattraper les articles qui ne le portent pas.
  const attendu = {
    jeuxvideo: "Q7889",
    films: "Q11424",
    series: "Q5398426",
    litterature: "Q7725634",
    animaux: "Q729",
    sport: "Q349",
    musique: "Q638",
    histoire: "Q309",
    sciences: "Q336",
    tech: "Q11019",
    art: "Q735",
    geo: "Q1071",
    mythologie: "Q9134",
    inventions: "Q450",
    personnalites: "Q5",
  };
  for (const [key, qid] of Object.entries(attendu)) {
    const c = core.CATEGORIES.find((x) => x.key === key);
    assert.ok(c, `catégorie manquante : ${key}`);
    assert.equal(c.qids[0], qid, `qid principal inattendu pour ${key}`);
  }
  // random + les 15 demandées, rien de plus
  assert.equal(core.CATEGORIES.length, Object.keys(attendu).length + 1);
});

test("wikidataUrl interroge Wikidata (pas Wikipédia) et OR-combine les qids", () => {
  // haswbstatement: n'existe que sur le dépôt Wikidata, pas sur les wikis
  // clients — l'envoyer à fr.wikipedia.org avait tout cassé d'un coup.
  const url = core.wikidataUrl("animaux");
  assert.ok(url.startsWith("https://www.wikidata.org/w/api.php?"));
  const params = new URL(url).searchParams;
  assert.equal(
    params.get("gsrsearch"),
    "haswbstatement:P31=Q729 OR haswbstatement:P31=Q16521"
  );
  assert.equal(params.get("gsrsort"), "random");
  assert.equal(params.get("sitefilter"), "frwiki");
  assert.equal(params.get("prop"), "sitelinks");
});

test("wikidataUrl échantillonne assez large pour les classes peu wikipédisées", () => {
  // 40 laissait ~40 % de chances de ne rien trouver pour Q5 (~2 % des humains
  // de Wikidata ont un article français) : c'est le bug qui vidait la catégorie.
  assert.ok(core.WIKIDATA_SAMPLE >= 500, "échantillon trop petit, voir WIKIDATA_SAMPLE");
  const params = new URL(core.wikidataUrl("personnalites")).searchParams;
  assert.equal(params.get("gsrlimit"), String(core.WIKIDATA_SAMPLE));
});

test("wikidataUrl renvoie null pour la catégorie aléatoire (pas de qids)", () => {
  assert.equal(core.wikidataUrl("random"), null);
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
        { sitelinks: [{ site: "dewiki", title: "Ohne frwiki" }] }, // pas d'article français : ignoré
        {}, // aucun sitelink : ignoré
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

test("wikiUrl sans titre demande un thumbnail borné et un tirage aléatoire", () => {
  const url = core.wikiUrl();
  assert.ok(url.includes("fr.wikipedia.org/w/api.php"));
  assert.ok(url.includes("piprop=thumbnail"));
  assert.ok(!url.includes("original"), "l'original Commons pèse plusieurs Mo");
  assert.ok(url.includes(`pithumbsize=${core.WIKI_THUMB_PX}`));
  assert.ok(url.includes("generator=random"));
});

test("wikiUrl avec titres interroge ces titres précis, sans recherche", () => {
  const url = core.wikiUrl(["Effet tunnel", "Tardigrade"]);
  assert.ok(url.includes("fr.wikipedia.org/w/api.php"));
  assert.ok(!url.includes("generator="));
  const params = new URL(url).searchParams;
  assert.equal(params.get("titles"), "Effet tunnel|Tardigrade");
});

test("wikiUrl tronque à la limite de l'API Wikipédia (50 titres)", () => {
  const many = Array.from({ length: 120 }, (_, i) => `T${i}`);
  const params = new URL(core.wikiUrl(many)).searchParams;
  assert.equal(params.get("titles").split("|").length, core.MAX_TITLES);
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

test("fetchCategoryItems (aléatoire) fait un seul aller Wikipédia", async () => {
  const calls = [];
  const fetchJson = async (url) => {
    calls.push(url);
    return { query: { pages: [{ title: "T", extract: "y".repeat(130) }] } };
  };
  const out = await core.fetchCategoryItems("random", fetchJson);
  assert.equal(calls.length, 1);
  assert.ok(calls[0].includes("generator=random"));
  assert.equal(out.length, 1);
});

test("fetchCategoryItems (catégorie) enchaîne Wikidata puis Wikipédia", async () => {
  const calls = [];
  const fetchJson = async (url) => {
    calls.push(url);
    if (url.includes("www.wikidata.org")) {
      return {
        query: { pages: [{ sitelinks: [{ site: "frwiki", title: "Tardigrade" }] }] },
      };
    }
    return { query: { pages: [{ title: "Tardigrade", extract: "z".repeat(130) }] } };
  };
  const out = await core.fetchCategoryItems("sciences", fetchJson);
  assert.equal(calls.length, 2);
  assert.ok(calls[0].includes("www.wikidata.org"));
  assert.ok(calls[1].includes("fr.wikipedia.org"));
  assert.equal(new URL(calls[1]).searchParams.get("titles"), "Tardigrade");
  assert.equal(out.length, 1);
  assert.equal(out[0].title, "Tardigrade");
});

test("fetchCategoryItems distingue « aucun item » de « aucun article français »", async () => {
  // Deux pannes opposées, deux correctifs opposés (mauvais qids vs échantillon
  // trop petit) : elles ne doivent jamais se ressembler dans le diagnostic.
  const vide = async () => ({ query: { pages: [] } });
  await assert.rejects(core.fetchCategoryItems("sciences", vide), /0 item\(s\) trouvé/);

  const sansFr = async () => ({
    query: { pages: [{ sitelinks: [{ site: "dewiki", title: "Ohne frwiki" }] }] },
  });
  await assert.rejects(
    core.fetchCategoryItems("sciences", sansFr),
    /1 item\(s\) trouvé\(s\), aucun avec sitelink frwiki/
  );
});

test("fetchCategoryItems remonte l'erreur Wikidata plutôt que de l'avaler", async () => {
  const fetchJson = async () => ({
    error: { code: "badvalue", info: "paramètre invalide" },
  });
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
