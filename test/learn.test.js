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
          original: { source: "https://img/effet.jpg" },
        },
        2: { title: "Trop court", extract: "court" }, // < 120 → écarté
      },
    },
  };
  const out = learn.normalizeWiki(data);
  assert.equal(out.length, 1);
  assert.equal(out[0].source, "Wikipédia");
  assert.equal(out[0].title, "Effet tunnel");
  assert.equal(out[0].img, "https://img/effet.jpg");
});

test("normalizeGbif ne garde que les occurrences avec titre et image", () => {
  const data = {
    results: [
      {
        scientificName: "Vulpes vulpes",
        vernacularName: "Renard roux",
        media: [{ identifier: "https://img/renard.jpg" }],
        kingdom: "Animalia",
        key: 42,
      },
      { scientificName: "Sans image", media: [] }, // pas d'image → écarté
    ],
  };
  const out = learn.normalizeGbif(data);
  assert.equal(out.length, 1);
  assert.equal(out[0].title, "Renard roux");
  assert.match(out[0].link, /gbif\.org\/occurrence\/42/);
});

test("normalizeGallica lit les enregistrements SRU et construit l'image IIIF", () => {
  const xml = `<srw:searchRetrieveResponse xmlns:srw="x" xmlns:dc="y">
    <srw:records><srw:record><srw:recordData>
      <dc:title>Carte ancienne</dc:title>
      <dc:creator>Anonyme</dc:creator>
      <dc:date>1700</dc:date>
      <dc:description>Une carte</dc:description>
      <dc:identifier>https://gallica.bnf.fr/ark:/12148/btv1b530000</dc:identifier>
    </srw:recordData></srw:record></srw:records>
  </srw:searchRetrieveResponse>`;
  const out = learn.normalizeGallica(xml);
  assert.equal(out.length, 1);
  assert.equal(out[0].title, "Carte ancienne");
  assert.match(out[0].img, /iiif\/ark:\/12148\/btv1b530000\/f1\/full/);
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
