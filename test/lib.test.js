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

test("cssString préserve l'URL à l'identique — surtout ( ) et '", () => {
  // Régression : pour-encoder ces caractères cassait silencieusement les images
  // dont le nom de fichier en contient (RFC 3986 : ce sont des sub-delims, %28
  // n'est PAS équivalent à "(" — beaucoup de serveurs répondent 404).
  const legit =
    "https://www.francetvinfo.fr/pictures/photo(1)_l'usine,2026.jpg?w=1200&h=680";
  assert.equal(lib.cssString(legit), legit);
  for (const c of ["(", ")", "'", ",", "&", "?", "="]) {
    assert.ok(lib.cssString("https://x/a" + c + "b.jpg").includes(c), "perdu : " + c);
  }
});

test("cssString neutralise ce qui pourrait sortir de la chaîne CSS", () => {
  // La valeur est posée via CSSOM (aucun décodage HTML) : seuls les
  // délimiteurs de chaîne comptent.
  const hostile = 'https://ok.fr/a");position:fixed;inset:0;background:url("//evil/x.png';
  const out = lib.cssString(hostile);
  assert.ok(!/(^|[^\\])"/.test(out), "aucun guillemet non échappé ne doit subsister");
  assert.equal(lib.cssString('a\\b"c'), 'a\\\\b\\"c');
  assert.ok(
    !/[\n\r\f]/.test(lib.cssString("a\nb")),
    "pas de saut de ligne dans une chaîne CSS"
  );
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

test("upscaleImageUrl demande une variante plus grande quand la taille est dans l'URL", () => {
  // Motifs répandus chez les CDN de presse
  assert.equal(
    lib.upscaleImageUrl("https://f.fr/pictures/abc/640x360/photo.jpg"),
    "https://f.fr/pictures/abc/1200x675/photo.jpg"
  );
  assert.equal(
    lib.upscaleImageUrl("https://f.fr/img/photo_400x225.jpg"),
    "https://f.fr/img/photo_1200x675.jpg"
  );
  assert.equal(
    lib.upscaleImageUrl("https://f.fr/i.jpg?width=500&h=280"),
    "https://f.fr/i.jpg?width=1200&h=280"
  );
  assert.equal(
    lib.upscaleImageUrl("https://f.fr/w/300/photo.jpg"),
    "https://f.fr/w/1200/photo.jpg"
  );
});

test("upscaleImageUrl ne propose rien s'il n'y a rien à gagner", () => {
  // déjà assez grande
  assert.equal(lib.upscaleImageUrl("https://f.fr/a/1600x900/p.jpg"), "");
  // aucun motif de taille reconnu : on ne devine pas
  assert.equal(lib.upscaleImageUrl("https://f.fr/pictures/abcdef/photo.jpg"), "");
  assert.equal(lib.upscaleImageUrl(""), "");
  // ne doit pas confondre une date ou un identifiant avec une taille
  assert.equal(lib.upscaleImageUrl("https://f.fr/2026/08/01/photo.jpg"), "");
});

test("upscaleImageUrl ne fabrique jamais d'URL dégénérée", () => {
  // Une hauteur nulle donnerait /1200xNaN/ — une URL qui répond 404 et fait
  // perdre l'image d'origine si l'appelant n'a pas de repli.
  for (const u of [
    "https://f.fr/a/640x0/p.jpg",
    "https://f.fr/a/00x00/p.jpg",
    "https://f.fr/img/p_640x0.jpg",
  ]) {
    const out = lib.upscaleImageUrl(u);
    assert.ok(!/NaN|Infinity/.test(out), "URL dégénérée pour " + u + " : " + out);
  }
});

test("imageSizeFromUrl lit la taille demandée dans une URL Thumbor", () => {
  // Cas réel (franceinfo) : le recadrage précède la taille de sortie, c'est
  // cette dernière qui compte.
  const u =
    "https://www.franceinfo.fr/pictures/GkzbKoCOcG6ZX3WGIQXvbxI5iec/0x0:1024x576/432x243/filters:format(jpg):quality(50)/2026/08/02/6a6ef.jpg";
  assert.equal(lib.imageSizeFromUrl(u), 432);
  assert.equal(lib.imageSizeFromUrl("https://f.fr/a/1200x675/p.jpg"), 1200);
  assert.equal(lib.imageSizeFromUrl("https://f.fr/img/p_800x450.jpg"), 800);
  assert.equal(lib.imageSizeFromUrl("https://f.fr/i.jpg?width=640"), 640);
  assert.equal(lib.imageSizeFromUrl("https://f.fr/pictures/abcdef/photo.jpg"), 0);
  assert.equal(lib.imageSizeFromUrl(""), 0);
});
