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

test("isPromotionalItem détecte les libellés éditoriaux standard (sponsorisé)", () => {
  assert.ok(lib.isPromotionalItem({ title: "[Sponsorisé] Une offre incroyable" }));
  assert.ok(lib.isPromotionalItem({ title: "Sponsorisé : ce produit change tout" }));
  assert.ok(
    lib.isPromotionalItem({ title: "X", desc: "Contenu sponsorisé par la marque Y." })
  );
  assert.ok(lib.isPromotionalItem({ title: "Un publi-reportage pour découvrir Z" }));
  assert.ok(lib.isPromotionalItem({ title: "Publireportage : la nouvelle gamme" }));
  assert.ok(lib.isPromotionalItem({ title: "This is Sponsored Content" }));
  assert.ok(lib.isPromotionalItem({ title: "An advertorial about widgets" }));
  // Cas réel manqué en production : « Dossier sponsorisé » (Les Numériques),
  // ni « contenu » ni « article » sponsorisé, aucune ponctuation à suivre.
  assert.ok(
    lib.isPromotionalItem({
      title: "Shark StainStriker HairPro Pet : la shampouineuse efficace pour tous",
      desc: "Dossier sponsorisé",
    })
  );
  // Le même libellé posé en catégorie RSS plutôt que dans le titre/résumé —
  // c'est là que certains éditeurs le mettent, voir fetchFeed (index.html).
  assert.ok(
    lib.isPromotionalItem({
      title: "Un test produit tout à fait normal",
      tags: "Sponsorisé",
    })
  );
  assert.ok(
    lib.isPromotionalItem({
      title: "Un communiqué banal",
      tags: "Actualité, Publi-reportage",
    })
  );
  // Cas réel manqué en production : Frandroid abrège en « [Sponso] » plutôt
  // que d'écrire « sponsorisé » en toutes lettres, en fin de titre.
  assert.ok(
    lib.isPromotionalItem({
      title:
        "L'offre Pure Fibre avec WiFi 7 est à 24,99 euros sans engagement, pile à temps pour la rentrée [Sponso]",
    })
  );
  assert.ok(lib.isPromotionalItem({ title: "Sponso : cette offre est limitée" }));
});

test("isPromotionalItem ne filtre pas un titre qui contient juste « sponsor » en prose", () => {
  // Sans bordure ([ ] : - en fin de mot), « sponso »/« sponsor » reste un mot
  // de prose ordinaire — la même règle de bordure que pour « sponsorisé ».
  assert.ok(
    !lib.isPromotionalItem({
      title: "Le sponsoring sportif attire de nouveaux investisseurs",
    })
  );
});

test("isPromotionalItem ne filtre pas du contenu éditorial qui parle juste de sponsoring", () => {
  // Un article DE FOND sur le sponsoring sportif, pas un article sponsorisé.
  assert.ok(
    !lib.isPromotionalItem({
      title: "Le sponsoring sportif en question",
      desc: "Enquête sur les contrats entre marques et clubs.",
    })
  );
  // « partenaire » seul, sans marqueur explicite : trop générique pour un vrai
  // article de partenariat éditorial (ex: co-organisation d'un événement).
  assert.ok(
    !lib.isPromotionalItem({
      title: "Notre partenaire local ouvre une nouvelle salle",
    })
  );
  // « communiqué de presse » n'est pas forcément un contenu sponsorisé.
  assert.ok(
    !lib.isPromotionalItem({
      title: "Communiqué de presse : résultats du 2e trimestre",
    })
  );
  assert.ok(!lib.isPromotionalItem({ title: "Titre normal", desc: "Rien à signaler." }));
  assert.ok(!lib.isPromotionalItem({}));
  // Catégories RSS ordinaires, sans rapport avec le sponsoring.
  assert.ok(
    !lib.isPromotionalItem({ title: "Un article normal", tags: "Économie, France" })
  );
});

test("isPromotionalItem détecte les bons plans via le chemin de l'URL", () => {
  // Cas réel : le titre est purement descriptif (produit + prix), aucun mot-clé
  // à chercher — seul le chemin /bons-plans/ trahit la rubrique.
  assert.ok(
    lib.isPromotionalItem({
      title:
        "50 Go à 7,99 euros sur le réseau d'Orange : le forfait qui suffit sans se ruiner",
      link: "https://www.frandroid.com/bons-plans/3209229_50-go-a-799-euros-sur-le-reseau-dorange-le-forfait-qui-suffit-sans-se-ruiner",
    })
  );
  // Variantes de graphie plausibles chez d'autres éditeurs.
  assert.ok(
    lib.isPromotionalItem({ title: "X", link: "https://www.exemple.fr/bon-plan/y" })
  );
  assert.ok(
    lib.isPromotionalItem({ title: "X", link: "https://www.exemple.fr/bons-plan/y" })
  );
  // Catégorie RSS "Bons plans" plutôt que le chemin.
  assert.ok(
    lib.isPromotionalItem({
      title: "Un article sans rapport dans son titre",
      link: "https://www.exemple.fr/actu/z",
      tags: "High-Tech, Bons plans",
    })
  );
});

test("isPromotionalItem ne filtre pas un article normal dont l'URL contient juste des mots proches", () => {
  assert.ok(
    !lib.isPromotionalItem({
      title: "Un article éditorial classique",
      link: "https://www.exemple.fr/actu/bonjour-plans-de-relance.html",
    })
  );
  assert.ok(
    !lib.isPromotionalItem({
      title: "Un article normal",
      link: "https://www.exemple.fr/actu/x",
    })
  );
});

test("isPaywallCandidateDomain repère les domaines à vérifier, sous-domaines compris", () => {
  assert.ok(
    lib.isPaywallCandidateDomain("https://www.lemonde.fr/politique/article/x.html")
  );
  assert.ok(lib.isPaywallCandidateDomain("https://abonnes.lemonde.fr/article/x.html"));
  assert.ok(
    lib.isPaywallCandidateDomain("https://www.nytimes.com/2026/08/11/world/y.html")
  );
  // Sites à contenu MIXTE (certains articles gratuits, d'autres non) : candidats
  // à une vérification par article, pas un verdict en soi.
  assert.ok(lib.isPaywallCandidateDomain("https://www.lequipe.fr/Football/Article/x"));
  assert.ok(
    lib.isPaywallCandidateDomain("https://www.midilibre.fr/2026/08/11/article,1234.php")
  );
  assert.ok(!lib.isPaywallCandidateDomain("https://www.france24.com/fr/article"));
  assert.ok(!lib.isPaywallCandidateDomain(""));
  // ne doit pas confondre un domaine qui CONTIENT la chaîne avec le domaine lui-même
  assert.ok(!lib.isPaywallCandidateDomain("https://notlemonde.fr/x"));
});

test("isPaywalledHtml lit le signal isAccessibleForFree (JSON-LD schema.org)", () => {
  const paidBool = `<script type="application/ld+json">
    {"@type":"NewsArticle","isAccessibleForFree":false}
  </script>`;
  const paidString = `<script type="application/ld+json">
    {"@type":"NewsArticle","isPartOf":{"isAccessibleForFree":"False"}}
  </script>`;
  const free = `<script type="application/ld+json">
    {"@type":"NewsArticle","isAccessibleForFree":true}
  </script>`;
  assert.ok(lib.isPaywalledHtml(paidBool));
  assert.ok(lib.isPaywalledHtml(paidString));
  assert.ok(!lib.isPaywalledHtml(free));
  // Absence totale de signal : un article normal, sans marqueur du tout.
  assert.ok(!lib.isPaywalledHtml("<html><body>Un article ordinaire.</body></html>"));
  assert.ok(!lib.isPaywalledHtml(""));
  assert.ok(!lib.isPaywalledHtml(null));
});

test("isPaywalledHtml lit aussi le texte visible « Réservé aux abonnés »", () => {
  // Second signal, indépendant du JSON-LD : cas réel rencontré, un site dont
  // le balisage structuré ne déclare pas isAccessibleForFree partout.
  assert.ok(
    lib.isPaywalledHtml('<div class="paywall">Article réservé aux abonnés</div>')
  );
  assert.ok(lib.isPaywalledHtml("<p>Contenu RÉSERVÉ AUX ABONNÉS Le Monde</p>"));
  assert.ok(!lib.isPaywalledHtml("<p>Article accessible à tous, sans restriction.</p>"));
});

test("isSponsoredHtml repère le lien de byline vers un auteur sponsor connu", () => {
  assert.ok(
    lib.isSponsoredHtml('<a href="/auteur/682/l-equipe-promo">L\'équipe Promo</a>')
  );
  // sous-domaine/URL absolue de la même fiche auteur
  assert.ok(
    lib.isSponsoredHtml(
      '<a href="https://www.lesnumeriques.com/auteur/682/l-equipe-promo">L\'équipe Promo</a>'
    )
  );
  // un ID d'auteur différent ne doit PAS déclencher : seul ce slug précis est connu
  assert.ok(!lib.isSponsoredHtml('<a href="/auteur/12/jean-dupont">Jean Dupont</a>'));
  // le mot « promo » seul, hors lien d'auteur, est un faux positif qu'on refuse
  // sciemment (voir SPONSORED_PATTERNS : pas de mot-clé de texte libre pour ça)
  assert.ok(!lib.isSponsoredHtml("<p>Ce forfait est en promo ce mois-ci.</p>"));
  assert.ok(!lib.isSponsoredHtml("<html><body>Un article ordinaire.</body></html>"));
  assert.ok(!lib.isSponsoredHtml(""));
  assert.ok(!lib.isSponsoredHtml(null));
});

test("isSponsorCandidateDomain ne cible que les domaines connus pour ce signal", () => {
  assert.ok(
    lib.isSponsorCandidateDomain(
      "https://www.lesnumeriques.com/forfait-mobile/x-n259660.html"
    )
  );
  assert.ok(lib.isSponsorCandidateDomain("https://sub.lesnumeriques.com/x"));
  assert.ok(!lib.isSponsorCandidateDomain("https://www.lemonde.fr/x"));
  assert.ok(!lib.isSponsorCandidateDomain(""));
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

test("interleave tient la cadence puis laisse la liste restante continuer seule", () => {
  const n = ["n1", "n2", "n3", "n4", "n5", "n6", "n7"];
  const w = ["w1", "w2"];
  assert.deepEqual(lib.interleave(n, w, 3), [
    "n1",
    "n2",
    "n3",
    "w1",
    "n4",
    "n5",
    "n6",
    "w2",
    "n7",
  ]);
  // Actus épuisées : les articles Wikipédia prennent le relais un à un, ce qui
  // rend le fil infini même quand le RSS est à sec.
  assert.deepEqual(lib.interleave(["n1"], ["w1", "w2", "w3"], 3), [
    "n1",
    "w1",
    "w2",
    "w3",
  ]);
  // Une seule des deux listes : elle sort telle quelle, sans trou.
  assert.deepEqual(lib.interleave([], ["w1", "w2"], 3), ["w1", "w2"]);
  assert.deepEqual(lib.interleave(["n1", "n2"], [], 3), ["n1", "n2"]);
  assert.deepEqual(lib.interleave([], [], 3), []);
});

test("interleave est stable sur les préfixes (le fil déjà lu ne bouge pas)", () => {
  // Propriété dont dépend le remélange à chaque arrivée de données : allonger
  // les DEUX listes par la fin ne réordonne pas le début du résultat.
  const n = ["n1", "n2", "n3", "n4", "n5", "n6"];
  const w = ["w1", "w2"];
  const avant = lib.interleave(n, w, 3);
  const apres = lib.interleave(n.concat(["n7", "n8", "n9"]), w.concat(["w3"]), 3);
  assert.deepEqual(apres.slice(0, avant.length), avant);
  // Cadence dégénérée : jamais de boucle infinie, jamais de division par zéro.
  assert.deepEqual(lib.interleave(["n1"], ["w1"], 0), ["n1", "w1"]);
});

/* ---------- Dédoublonnage des actus entre flux ---------- */

const art = (o) =>
  Object.assign({ source: "S", title: "", desc: "", link: "", img: "", date: "" }, o);

test("dedupNews fusionne le même article servi par deux flux d'un même site", () => {
  // Cas réel : le flux « à la une » et celui de la rubrique servent le même
  // article, en s'y distinguant par un paramètre de campagne.
  const out = lib.dedupNews([
    art({ title: "Un titre", link: "https://lemonde.fr/a/x.html?xtor=RSS-1" }),
    art({ title: "Un titre", link: "https://www.lemonde.fr/a/x.html?xtor=RSS-3001" }),
  ]);
  assert.equal(out.length, 1);
});

test("dedupNews ignore la barre finale, le fragment et le www", () => {
  const out = lib.dedupNews([
    art({ title: "T", link: "https://lemonde.fr/a/x/" }),
    art({ title: "T", link: "https://www.lemonde.fr/a/x#intro" }),
  ]);
  assert.equal(out.length, 1);
});

test("dedupNews garde un paramètre qui désigne un contenu différent", () => {
  // ?page=2 n'est pas du pistage : c'est un autre contenu.
  const out = lib.dedupNews([
    art({ title: "A", link: "https://s.fr/a?page=1" }),
    art({ title: "B", link: "https://s.fr/a?page=2" }),
  ]);
  assert.equal(out.length, 2);
});

test("dedupNews rapproche par titre quand les liens diffèrent, sur le même site", () => {
  const out = lib.dedupNews([
    art({
      title: "Guerre en Ukraine : le point",
      link: "https://s.fr/monde/ukraine",
      date: "Wed, 12 Aug 2026 10:00:00 GMT",
    }),
    art({
      title: "Guerre en Ukraine - Le Point",
      link: "https://s.fr/a-la-une/ukraine",
      date: "Wed, 12 Aug 2026 10:05:00 GMT",
    }),
  ]);
  assert.equal(out.length, 1);
});

test("dedupNews ne fusionne PAS deux sites qui titrent pareil (même dépêche AFP)", () => {
  const out = lib.dedupNews([
    art({
      title: "Le même titre",
      link: "https://lemonde.fr/a",
      date: "Wed, 12 Aug 2026 10:00:00 GMT",
    }),
    art({
      title: "Le même titre",
      link: "https://lefigaro.fr/b",
      date: "Wed, 12 Aug 2026 10:00:00 GMT",
    }),
  ]);
  assert.equal(out.length, 2);
});

test("dedupNews ne fusionne PAS une chronique au titre fixe d'un jour à l'autre", () => {
  const out = lib.dedupNews([
    art({
      title: "Programme TV du jour",
      link: "https://s.fr/tv/lundi",
      date: "Mon, 10 Aug 2026 06:00:00 GMT",
    }),
    art({
      title: "Programme TV du jour",
      link: "https://s.fr/tv/mardi",
      date: "Tue, 11 Aug 2026 06:00:00 GMT",
    }),
  ]);
  assert.equal(out.length, 2);
});

test("dedupNews garde la copie la plus riche, pas la première venue", () => {
  // L'ordre d'arrivée des flux dépend du réseau : le départage doit être stable.
  const pauvre = art({ title: "T", link: "https://s.fr/a", desc: "court" });
  const riche = art({
    title: "T",
    link: "https://s.fr/a",
    desc: "un résumé bien plus complet",
    img: "https://s.fr/i.jpg",
  });
  assert.equal(lib.dedupNews([pauvre, riche])[0].img, "https://s.fr/i.jpg");
  assert.equal(lib.dedupNews([riche, pauvre])[0].img, "https://s.fr/i.jpg");
  // À image égale, le résumé le plus long l'emporte.
  const a = art({ title: "U", link: "https://s.fr/u", desc: "court" });
  const b = art({ title: "U", link: "https://s.fr/u", desc: "beaucoup plus long" });
  assert.equal(lib.dedupNews([a, b])[0].desc, "beaucoup plus long");
  assert.equal(lib.dedupNews([b, a])[0].desc, "beaucoup plus long");
});

test("dedupNews préserve l'ordre d'entrée et ne perd rien d'unique", () => {
  const out = lib.dedupNews([
    art({ title: "A", link: "https://s.fr/a" }),
    art({ title: "B", link: "https://s.fr/b" }),
    art({ title: "A", link: "https://s.fr/a" }),
    art({ title: "C", link: "https://s.fr/c" }),
  ]);
  assert.deepEqual(
    out.map((i) => i.title),
    ["A", "B", "C"]
  );
});

test("dedupNews encaisse les entrées dégradées", () => {
  assert.deepEqual(lib.dedupNews([]), []);
  assert.deepEqual(lib.dedupNews(null), []);
  // Lien non parsable : comparé tel quel, jamais fusionné à tort.
  const out = lib.dedupNews([
    art({ title: "T", link: "pas une url" }),
    art({ title: "T", link: "pas une url" }),
    art({ title: "", link: "" }),
    art({ title: "", link: "" }),
  ]);
  assert.equal(out.length, 3); // les deux sans titre NI lien restent distincts
});
