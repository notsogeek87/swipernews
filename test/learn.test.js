"use strict";
// Tests des helpers d'agrégation du mode Apprendre (normalisation + classement),
// sans réseau : on injecte des réponses factices.
const test = require("node:test");
const assert = require("node:assert");
const learn = require("../api/learn.js");

test("normalizeWiki extrait titre/extrait/image et filtre les extraits trop courts", () => {
  const data = {
    query: {
      pages: {
        1: {
          title: "Effet tunnel",
          extract: "x".repeat(150),
          canonicalurl: "https://fr.wikipedia.org/wiki/Effet_tunnel",
          thumbnail: { source: "https://img/effet.jpg" },
        },
        2: { title: "Trop court", extract: "court" }, // < 120 → écarté
      },
    },
  };
  const out = learn.normalizeWiki(data);
  assert.equal(out.length, 1);
  assert.equal(out[0].source, "Wikipédia");
  assert.equal(out[0].title, "Effet tunnel");
  // le thumbnail borné, jamais `original` : voir test/learn-core.test.js
  assert.equal(out[0].img, "https://img/effet.jpg");
});

test("dedupAndRank déduplique et place les cartes avec image d'abord", () => {
  const a = [
    { title: "A", link: "l1", img: "i" },
    { title: "B", link: "l2", img: "" },
  ];
  const b = [
    { title: "A", link: "l1", img: "i" },
    { title: "C", link: "l3", img: "i" },
  ]; // A dupliqué
  const out = learn.dedupAndRank([a, b], 10);
  const titles = out.map((x) => x.title).sort();
  assert.deepEqual(titles, ["A", "B", "C"]); // A une seule fois
  assert.equal(out[out.length - 1].title, "B"); // sans image en dernier
});
