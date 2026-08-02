"use strict";
// Tests de l'extraction og:image (api/og.js) : lecture des balises, sans réseau.
const test = require("node:test");
const assert = require("node:assert");
const og = require("../api/og.js");

test("metaContent lit og:image quel que soit l'ordre des attributs", () => {
  const a = `<meta property="og:image" content="https://f.fr/big.jpg">`;
  const b = `<meta content="https://f.fr/big.jpg" property="og:image">`;
  const c = `<meta name="og:image" content='https://f.fr/big.jpg'>`;
  for (const html of [a, b, c]) {
    assert.equal(og.metaContent(html, ["og:image"]), "https://f.fr/big.jpg");
  }
});

test("metaContent respecte l'ordre de préférence et retombe sur twitter:image", () => {
  const html = `<meta property="og:image" content="https://f.fr/og.jpg">
                <meta name="twitter:image" content="https://f.fr/tw.jpg">`;
  assert.equal(
    og.metaContent(html, ["og:image", "twitter:image"]),
    "https://f.fr/og.jpg"
  );
  assert.equal(og.metaContent(html, ["twitter:image"]), "https://f.fr/tw.jpg");
  assert.equal(og.metaContent(html, ["og:video"]), "");
});

test("metaContent ne confond pas une balise voisine", () => {
  // og:image:width ne doit pas être pris pour og:image
  const html = `<meta property="og:image:width" content="1200">
                <meta property="og:image" content="https://f.fr/ok.jpg">`;
  assert.equal(og.metaContent(html, ["og:image"]), "https://f.fr/ok.jpg");
  assert.equal(og.metaContent(html, ["og:image:width"]), "1200");
});

test("decodeEntities rétablit les esperluettes des URL", () => {
  assert.equal(
    og.decodeEntities("https://f.fr/i.jpg?a=1&amp;b=2&#38;c=3"),
    "https://f.fr/i.jpg?a=1&b=2&c=3"
  );
});
