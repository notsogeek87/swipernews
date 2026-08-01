"use strict";
// Tests des fonctions pures partagées entre le navigateur et Node (src/lib.js).
// Elles portent l'assainissement des contenus de flux : c'est le périmètre qui
// n'était pas couvert jusqu'ici alors qu'il traite des données non fiables.
const test = require("node:test");
const assert = require("node:assert");
const lib = require("../src/lib.js");

test("stripHtml retire les balises sans jamais activer le contenu", () => {
  // Le point clé : la sortie est du texte, et rien de ce qui pourrait s'exécuter
  // ne subsiste. L'ancienne implémentation (div détaché + innerHTML) déclenchait
  // les handlers onerror dans Chrome et Firefox.
  const hostile =
    '<img src=x onerror="alert(1)"><p>Bonjour</p><script>alert(2)<\/script>';
  const out = lib.stripHtml(hostile);
  assert.equal(out, "Bonjour");
  assert.ok(!out.includes("onerror"));
  assert.ok(!out.includes("alert"));
});

test("stripHtml décode les entités et normalise les blancs", () => {
  assert.equal(lib.stripHtml("A &amp; B\n\n  C&nbsp;D"), "A & B C D");
  assert.equal(lib.stripHtml("&#233;t&#xE9;"), "été");
  assert.equal(lib.stripHtml(""), "");
  assert.equal(lib.stripHtml(null), "");
});

test("stripHtml ignore le contenu des balises style", () => {
  assert.equal(lib.stripHtml("<style>p{color:red}</style>Texte"), "Texte");
});

test("safeLink n'accepte que http(s)", () => {
  assert.equal(lib.safeLink("https://ok.fr/a"), "https://ok.fr/a");
  assert.equal(lib.safeLink("javascript:alert(1)"), "");
  assert.equal(lib.safeLink("data:text/html,<script>x</script>"), "");
  assert.equal(lib.safeLink("#"), "");
  assert.equal(lib.safeLink(""), "");
  assert.equal(lib.safeLink("pas une url"), "");
});

test("safeImg accepte http(s) et data:image, rien d'autre", () => {
  assert.equal(lib.safeImg("https://x/i.png"), "https://x/i.png");
  assert.equal(lib.safeImg("data:image/png;base64,AAA"), "data:image/png;base64,AAA");
  assert.equal(lib.safeImg("data:text/html,<script>x</script>"), "");
  assert.equal(lib.safeImg("javascript:alert(1)"), "");
});

test("cssUrl neutralise une évasion de url() — l'échappement HTML ne suffit pas", () => {
  // Une valeur d'attribut style est décodée en HTML AVANT le parsing CSS : un
  // &#39; y redevient une apostrophe. cssUrl pour-encode donc réellement.
  const hostile = "https://ok.fr/a');position:fixed;inset:0;background:url('//evil/x.png";
  const out = lib.cssUrl(hostile);
  assert.ok(!out.includes("'"), "aucune apostrophe ne doit subsister");
  assert.ok(!out.includes('"'));
  assert.ok(!out.includes("("), "aucune parenthèse ne doit subsister");
  assert.ok(!out.includes(" "));
});

test("escAttr et esc échappent les caractères structurants", () => {
  assert.equal(lib.esc('<b>&"'), '&lt;b&gt;&amp;"');
  assert.equal(lib.escAttr("a\"b'c&d"), "a&quot;b&#39;c&amp;d");
  assert.equal(lib.esc(null), "");
});

test("relTime rend une durée compacte, vide si non parsable", () => {
  const now = Date.parse("2026-01-10T12:00:00Z");
  assert.equal(lib.relTime("2026-01-10T11:30:00Z", now), "30 min");
  assert.equal(lib.relTime("2026-01-10T06:00:00Z", now), "6 h");
  assert.equal(lib.relTime("2026-01-07T12:00:00Z", now), "3 j");
  assert.equal(lib.relTime("pas une date", now), "");
});

test("dropSeen écarte le déjà-vu mais ne tarit jamais le fil", () => {
  const seen = new Set(["l1|A"]);
  const list = [
    { link: "l1", title: "A" },
    { link: "l2", title: "B" },
  ];
  assert.deepEqual(
    lib.dropSeen(list, seen).map((i) => i.title),
    ["B"]
  );
  // tout vu → on renvoie la liste telle quelle plutôt qu'un fil vide
  const allSeen = new Set(["l1|A", "l2|B"]);
  assert.equal(lib.dropSeen(list, allSeen).length, 2);
});

test("parseJsonFeeds lit les deux formes d'export et ignore les entrées sans url", () => {
  const asArray = lib.parseJsonFeeds(
    '[{"name":"X","url":"https://x/f"},{"name":"sans url"}]'
  );
  assert.equal(asArray.length, 1);
  assert.equal(asArray[0].on, true);

  const asObject = lib.parseJsonFeeds('{"feeds":[{"url":"https://y/f","on":false}]}');
  assert.equal(asObject.length, 1);
  assert.equal(asObject[0].name, "y"); // nom déduit de l'hôte
  assert.equal(asObject[0].on, false);
});

test("parseOpmlFeeds lit un OPML (repli sans DOMParser)", () => {
  const opml = `<?xml version="1.0"?><opml version="2.0"><body>
    <outline type="rss" text="Le Monde" xmlUrl="https://lemonde.fr/rss"/>
    <outline text="Dossier"><outline title="F24" xmlUrl="https://f24/rss"/></outline>
    <outline text="sans flux"/>
  </body></opml>`;
  const out = lib.parseOpmlFeeds(opml);
  assert.equal(out.length, 2);
  assert.equal(out[0].name, "Le Monde");
  assert.equal(out[1].url, "https://f24/rss");
});

test("hostOf retire le www et tolère une url invalide", () => {
  assert.equal(lib.hostOf("https://www.lemonde.fr/rss/une.xml"), "lemonde.fr");
  assert.equal(lib.hostOf("n'importe quoi"), "n'importe quoi");
});
