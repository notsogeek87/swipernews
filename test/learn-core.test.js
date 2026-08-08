"use strict";
// Tests du noyau Apprendre partagé entre index.html et api/learn.js.
// Objectif principal : garantir que les deux côtés ne peuvent plus diverger,
// et verrouiller le choix du thumbnail plutôt que de l'original Wikipédia.
const test = require("node:test");
const assert = require("node:assert");
const core = require("../src/learn-core.js");

test("chaque catégorie pointe une catégorie Wikipédia, sauf l'aléatoire", () => {
  const random = core.CATEGORIES.find((c) => c.key === "random");
  assert.equal(random.category, null);
  for (const c of core.CATEGORIES.filter((c) => c.key !== "random")) {
    assert.ok(c.category, `catégorie Wikipédia manquante pour ${c.key}`);
    assert.ok(
      !/^Cat[ée]gorie:/.test(c.category),
      `le préfixe « Catégorie: » est ajouté par categoryMembersUrl, pas ici (${c.key})`
    );
    assert.ok(c.label, `label manquant pour ${c.key}`);
  }
});

test("les 15 catégories demandées sont là, avec le bon titre Wikipédia", () => {
  const attendu = {
    jeuxvideo: "Jeu vidéo",
    films: "Film",
    series: "Série télévisée",
    musique: "Musique",
    romans: "Roman",
    batailles: "Bataille",
    monuments: "Monument historique",
    pays: "Pays",
    planetes: "Planète",
    exoplanetes: "Exoplanète",
    inventions: "Invention",
    animaux: "Animal",
    plats: "Plat",
    art: "Art",
    sport: "Sport",
  };
  for (const [key, category] of Object.entries(attendu)) {
    const c = core.CATEGORIES.find((x) => x.key === key);
    assert.ok(c, `catégorie manquante : ${key}`);
    assert.equal(c.category, category);
  }
  // random + les 15 demandées, rien de plus
  assert.equal(core.CATEGORIES.length, Object.keys(attendu).length + 1);
});

test("categoryMembersUrl demande articles ET sous-catégories, préfixe compris", () => {
  const url = core.categoryMembersUrl("Jeu vidéo");
  assert.ok(url.startsWith("https://fr.wikipedia.org/w/api.php?"));
  const params = new URL(url).searchParams;
  assert.equal(params.get("list"), "categorymembers");
  assert.equal(params.get("cmtitle"), "Catégorie:Jeu vidéo");
  // subcat en plus de page : sans les sous-catégories, impossible de descendre,
  // or une catégorie de tête contient surtout ça.
  assert.equal(params.get("cmtype"), "subcat|page");
  assert.equal(params.get("cmlimit"), String(core.CM_LIMIT));
  assert.ok(core.CM_LIMIT < 500, "le vivier n'a pas à être au maximum de l'API");
});

test("normalizeCategoryMembers sépare articles et sous-catégories", () => {
  const data = {
    query: {
      categorymembers: [
        { ns: 0, title: "Tetris" },
        { ns: 14, title: "Catégorie:Jeu de plateforme" },
        { ns: 0, title: "Pong" },
        { ns: 10, title: "Modèle:Palette" }, // ni l'un ni l'autre : ignoré
        {},
      ],
    },
  };
  const out = core.normalizeCategoryMembers(data);
  assert.deepEqual(out.pages, ["Tetris", "Pong"]);
  // le préfixe est retiré : la sous-catégorie doit pouvoir être ré-interrogée
  assert.deepEqual(out.subcats, ["Jeu de plateforme"]);
});

test("normalizeCategoryMembers tolère une réponse vide ou mal formée", () => {
  assert.deepEqual(core.normalizeCategoryMembers({}), { pages: [], subcats: [] });
  assert.deepEqual(core.normalizeCategoryMembers(null), { pages: [], subcats: [] });
});

test("collectTitles descend dans les sous-catégories quand la catégorie de tête est pauvre", async () => {
  // Cas réel : « Film » ne contient presque que des sous-catégories.
  const vus = [];
  const fetchJson = async (url) => {
    const titre = new URL(url).searchParams.get("cmtitle");
    vus.push(titre);
    if (titre === "Catégorie:Film") {
      return {
        query: {
          categorymembers: [
            { ns: 0, title: "Cinéma" },
            { ns: 14, title: "Catégorie:Film français" },
          ],
        },
      };
    }
    return {
      query: {
        categorymembers: Array.from({ length: 25 }, (_, i) => ({
          ns: 0,
          title: `F${i}`,
        })),
      },
    };
  };
  const titles = await core.collectTitles("Film", fetchJson, [], 20);
  assert.deepEqual(vus, ["Catégorie:Film", "Catégorie:Film français"]);
  assert.ok(titles.includes("Cinéma"), "les articles de la tête sont gardés");
  assert.ok(titles.length > 20, "complétés par ceux de la sous-catégorie");
});

test("collectTitles s'arrête dès qu'il a de quoi remplir un lot", async () => {
  let appels = 0;
  const fetchJson = async () => {
    appels++;
    return {
      query: {
        categorymembers: [
          ...Array.from({ length: 30 }, (_, i) => ({ ns: 0, title: `A${i}` })),
          { ns: 14, title: "Catégorie:Sous" },
        ],
      },
    };
  };
  await core.collectTitles("Pays", fetchJson, [], 20);
  assert.equal(appels, 1, "inutile de descendre quand la tête suffit");
});

test("collectTitles borne le nombre de requêtes même sans jamais trouver d'article", async () => {
  let appels = 0;
  const fetchJson = async () => {
    appels++;
    return { query: { categorymembers: [{ ns: 14, title: `Catégorie:Vide${appels}` }] } };
  };
  const titles = await core.collectTitles("Film", fetchJson, [], 20);
  assert.deepEqual(titles, []);
  assert.equal(appels, core.CM_MAX_LOOKUPS, "budget de requêtes respecté");
});

test("collectTitles signale une catégorie inexistante plutôt que de l'avaler", async () => {
  const notes = [];
  const fetchJson = async () => ({
    error: { code: "invalidcategory", info: "titre invalide" },
  });
  const titles = await core.collectTitles(
    "Catégorie mal orthographiée",
    fetchJson,
    notes,
    20
  );
  assert.deepEqual(titles, []);
  assert.match(notes.join(" "), /invalidcategory/);
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
  assert.ok(!url.includes("generator="));
  assert.equal(new URL(url).searchParams.get("titles"), "Effet tunnel|Tardigrade");
});

test("wikiUrl tronque au plafond de l'API Wikipédia (50 titres)", () => {
  const many = Array.from({ length: 120 }, (_, i) => `T${i}`);
  const params = new URL(core.wikiUrl(many)).searchParams;
  assert.equal(params.get("titles").split("|").length, core.MAX_TITLES);
});

test("wikiUrl ne demande d'extraits que pour les titres réellement listés", () => {
  // exlimit/pilimit calés sur le nombre de titres, pas sur le plafond : sinon
  // Wikipédia calcule des extraits qu'on ne lui demande pas.
  const params = new URL(core.wikiUrl(["A", "B", "C"])).searchParams;
  assert.equal(params.get("exlimit"), "3");
  assert.equal(params.get("pilimit"), "3");
});

test("wikiUrl (aléatoire) tire exactement le nombre d'articles demandé", () => {
  const params = new URL(core.wikiUrl(null, 8)).searchParams;
  assert.equal(params.get("grnlimit"), "8");
  assert.equal(params.get("exlimit"), "8");
});

test("fetchCategoryItems ne télécharge pas plus que le lot demandé", async () => {
  // Le reproche mesuré : 500 membres listés puis 50 extraits pour n'afficher
  // que 20 cartes. Les volumes suivent maintenant le nombre voulu.
  let titresDemandes = 0;
  const fetchJson = async (url) => {
    if (url.includes("categorymembers")) {
      return {
        query: {
          categorymembers: Array.from({ length: 200 }, (_, i) => ({
            ns: 0,
            title: `A${i}`,
          })),
        },
      };
    }
    titresDemandes = new URL(url).searchParams.get("titles").split("|").length;
    return {
      query: {
        pages: Array.from({ length: 10 }, (_, i) => ({
          title: `A${i}`,
          extract: "x".repeat(130),
        })),
      },
    };
  };
  await core.fetchCategoryItems("pays", fetchJson, 10);
  assert.equal(titresDemandes, Math.ceil(10 * core.TITLE_MARGIN));
  assert.ok(titresDemandes < core.MAX_TITLES, "on ne demande plus le plafond par défaut");
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

test("fetchCategoryItems (aléatoire) fait un seul aller, sans catégorie", async () => {
  const calls = [];
  const fetchJson = async (url) => {
    calls.push(url);
    return { query: { pages: [{ title: "T", extract: "y".repeat(130) }] } };
  };
  const out = await core.fetchCategoryItems("random", fetchJson);
  assert.equal(calls.length, 1);
  assert.ok(calls[0].includes("generator=random"));
  assert.ok(!calls[0].includes("categorymembers"));
  assert.equal(out.length, 1);
});

test("fetchCategoryItems liste la catégorie puis va chercher le contenu", async () => {
  const calls = [];
  const fetchJson = async (url) => {
    calls.push(url);
    if (url.includes("categorymembers")) {
      return {
        query: {
          categorymembers: Array.from({ length: 25 }, (_, i) => ({
            ns: 0,
            title: `Jeu ${i}`,
          })),
        },
      };
    }
    return { query: { pages: [{ title: "Tetris", extract: "z".repeat(130) }] } };
  };
  const out = await core.fetchCategoryItems("jeuxvideo", fetchJson);
  assert.equal(calls.length, 2);
  assert.equal(new URL(calls[0]).searchParams.get("cmtitle"), "Catégorie:Jeu vidéo");
  assert.ok(new URL(calls[1]).searchParams.get("titles").includes("Jeu "));
  assert.equal(out[0].title, "Tetris");
});

test("fetchCategoryItems nomme la catégorie fautive quand elle ne rend rien", async () => {
  // Le message remonte au panneau ?debug=1 : « catégorie introuvable » et
  // « catégorie trouvée mais sans article » appellent des correctifs opposés.
  const vide = async () => ({ query: { categorymembers: [] } });
  await assert.rejects(
    core.fetchCategoryItems("art", vide),
    /aucun article sous « Art »/
  );

  const sansExtrait = async (url) =>
    url.includes("categorymembers")
      ? {
          query: {
            categorymembers: Array.from({ length: 25 }, (_, i) => ({
              ns: 0,
              title: `P${i}`,
            })),
          },
        }
      : { query: { pages: [{ title: "P0", extract: "trop court" }] } };
  await assert.rejects(core.fetchCategoryItems("art", sansExtrait), /0 exploitable/);
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
