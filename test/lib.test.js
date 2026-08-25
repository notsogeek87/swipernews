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

test("dayKey/quarterIndex : format zéro-rempli, heure locale", () => {
  const d = new Date(2026, 0, 5, 9, 7, 0); // 5 janvier 2026, 9h07 — mois/heure à un chiffre
  assert.equal(lib.dayKey(d), "2026-01-05");
  assert.equal(lib.quarterIndex(d), 9 * 4 + 0); // 9h07 : 1er quart de l'heure
  assert.equal(lib.quarterIndex(new Date(2026, 0, 5, 9, 44, 0)), 9 * 4 + 2); // 9h44 : 3e quart
});

test("mondayOf : lundi de la semaine, y compris pour un lundi ou un dimanche", () => {
  assert.equal(lib.dayKey(lib.mondayOf(new Date(2026, 0, 15))), "2026-01-12"); // jeudi
  assert.equal(lib.dayKey(lib.mondayOf(new Date(2026, 0, 12))), "2026-01-12"); // déjà lundi
  assert.equal(lib.dayKey(lib.mondayOf(new Date(2026, 0, 18))), "2026-01-12"); // dimanche
});

test("sumDaysRange : somme bornée, clés malformées ignorées", () => {
  const days = { "2026-01-10": 3, "2026-01-15": 5, "2026-01-20": 7, "pas-une-date": 999 };
  assert.equal(lib.sumDaysRange(days, "2026-01-10", "2026-01-15"), 8);
  assert.equal(lib.sumDaysRange(days, "2026-01-01", "2026-01-31"), 15);
  assert.equal(lib.sumDaysRange(null, "2026-01-01", "2026-01-31"), 0);
});

test("hourlyFromSlots : agrège les quarts en 24 totaux horaires, ignore un autre jour", () => {
  const todaySlots = { day: "2026-01-15", slots: { 52: 5, 54: 2, 55: 1, 56: 2, 59: 3 } };
  const hourly = lib.hourlyFromSlots(todaySlots, "2026-01-15");
  assert.equal(hourly.length, 24);
  assert.equal(hourly[13], 8); // quarts 52,54,55 (53 absent = 0)
  assert.equal(hourly[14], 5); // quarts 56,59 (57,58 absents)
  assert.equal(hourly[0], 0);
  // todaySlots d'un jour PÉRIMÉ (réouverture après minuit, rien défilé depuis) : zéros partout
  assert.deepEqual(lib.hourlyFromSlots(todaySlots, "2026-01-16"), new Array(24).fill(0));
});

test("statsBuckets(hour) : 4 quarts de l'heure en cours, comparaison à l'heure précédente", () => {
  const now = Date.parse("2026-01-15T14:30:00Z"); // 14h30 : 3e quart de l'heure
  const todaySlots = {
    day: "2026-01-15",
    slots: { 52: 5, 54: 2, 55: 1, 56: 2, 57: 1, 59: 3 }, // hour13={52..55}, hour14={56..59}
  };
  const s = lib.statsBuckets("hour", {}, todaySlots, now);
  assert.deepEqual(
    s.buckets.map((b) => b.value),
    [2, 1, 0, 3]
  ); // quarts 56,57,58(absent),59
  assert.equal(s.total, 6); // 2+1+0+3
  assert.equal(s.prevTotal, 8); // heure 13 : 5+0+2+1
});

test("statsBuckets(hour) : à minuit, l'heure précédente (hier) n'est jamais dans todaySlots", () => {
  const now = Date.parse("2026-01-15T00:10:00Z");
  const s = lib.statsBuckets("hour", {}, { day: "2026-01-15", slots: { 0: 4 } }, now);
  assert.equal(s.total, 4);
  assert.equal(s.prevTotal, 0);
});

test("statsBuckets(day) : 24 buckets horaires, total/prevTotal viennent de `days`", () => {
  const now = Date.parse("2026-01-15T18:00:00Z");
  const days = { "2026-01-15": 12, "2026-01-14": 9 };
  const todaySlots = { day: "2026-01-15", slots: { 36: 4, 56: 8 } }; // hour9=4, hour14=8
  const s = lib.statsBuckets("day", days, todaySlots, now);
  assert.equal(s.buckets.length, 24);
  assert.equal(s.buckets[9].value, 4);
  assert.equal(s.buckets[14].value, 8);
  assert.equal(s.total, 12); // days[aujourd'hui], PAS la somme des quarts
  assert.equal(s.prevTotal, 9); // days[hier]
});

test("statsBuckets(week) : 7 buckets lundi→dimanche, comparaison à la semaine dernière", () => {
  // Jeudi 1er janvier 2026 : le lundi de sa semaine (29 décembre 2025) est
  // dans le mois ET l'année précédents — la semaine doit quand même le
  // compter (comportement hérité de l'ancien cardScrollStats).
  const now = Date.parse("2026-01-01T12:00:00Z");
  const days = {
    "2026-01-01": 2, // jeudi (aujourd'hui)
    "2025-12-29": 4, // lundi de la même semaine
    "2025-12-22": 10, // lundi de la semaine PRÉCÉDENTE
    "2025-12-15": 30, // plus ancien, hors des deux semaines
  };
  const s = lib.statsBuckets("week", days, {}, now);
  assert.equal(s.buckets.length, 7);
  assert.equal(s.buckets[0].value, 4); // lundi 29/12
  assert.equal(s.buckets[3].value, 2); // jeudi 01/01
  assert.equal(s.total, 6);
  assert.equal(s.prevTotal, 10); // 22/12 → 28/12
});

test("statsBuckets(month) : un bucket par semaine civile tronquée au mois", () => {
  // Janvier 2026 commence un jeudi : 5 buckets (29/12→04/01, 05→11, 12→18,
  // 19→25, 26→31), le premier et le dernier tronqués aux bornes du mois.
  const now = Date.parse("2026-01-20T12:00:00Z");
  const days = {
    "2026-01-02": 3, // bucket 0 (01→04, 29-31/12 hors mois)
    "2026-01-10": 5, // bucket 1 (05→11)
    "2026-01-15": 5, // bucket 2 (12→18)
    "2026-01-20": 2, // bucket 3 (19→25)
    "2026-01-30": 6, // bucket 4 (26→31)
    "2025-12-30": 100, // décembre : exclu du total, compte pour prevTotal
  };
  const s = lib.statsBuckets("month", days, {}, now);
  assert.deepEqual(
    s.buckets.map((b) => b.value),
    [3, 5, 5, 2, 6]
  );
  assert.equal(s.total, 21);
  assert.equal(s.prevTotal, 100); // décembre 2025 entier
});

test("statsBuckets(year) : 12 buckets mensuels, comparaison à l'année précédente", () => {
  const now = Date.parse("2026-06-20T12:00:00Z");
  const days = {
    "2026-02-01": 5,
    "2026-06-15": 10,
    "2025-11-01": 50, // année précédente
    "2025-03-01": 25, // année précédente
  };
  const s = lib.statsBuckets("year", days, {}, now);
  assert.equal(s.buckets.length, 12);
  assert.equal(s.buckets[1].value, 5); // février, index 1
  assert.equal(s.buckets[5].value, 10); // juin, index 5
  assert.equal(s.total, 15);
  assert.equal(s.prevTotal, 75); // 50 + 25, année 2025 entière
});

test("statsBuckets : `days`/`todaySlots` absents tolérés, jamais d'exception", () => {
  const now = Date.parse("2026-01-15T12:00:00Z");
  const s = lib.statsBuckets("day", null, null, now);
  assert.equal(s.buckets.length, 24);
  assert.equal(s.total, 0);
  assert.equal(s.prevTotal, 0);
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

test("roundRobin alterne entre les files et laisse les autres continuer", () => {
  // Une source bavarde et une source lente : la lente doit revenir à chaque
  // tour, pas être noyée. C'est tout l'objet de la fonction.
  const bavarde = ["b1", "b2", "b3", "b4", "b5"];
  const lente = ["l1"];
  assert.deepEqual(lib.roundRobin([bavarde, lente], [], 10), [
    "b1",
    "l1",
    "b2",
    "b3",
    "b4",
    "b5",
  ]);
  // `count` borne le résultat, et il est atteint au milieu d'un tour
  assert.deepEqual(lib.roundRobin([bavarde, lente], [], 3), ["b1", "l1", "b2"]);
  // Une file vide est sautée sans casser l'alternance des autres
  assert.deepEqual(lib.roundRobin([["a1", "a2"], [], ["c1"]], [], 10), [
    "a1",
    "c1",
    "a2",
  ]);
  // Rien à servir : ni exception, ni boucle infinie
  assert.deepEqual(lib.roundRobin([[], []], [], 5), []);
  assert.deepEqual(lib.roundRobin([], [], 5), []);
});

test("weightedRoundRobin reproduit roundRobin à poids égaux", () => {
  const bavarde = ["b1", "b2", "b3", "b4", "b5"];
  const lente = ["l1"];
  assert.deepEqual(
    lib.weightedRoundRobin([
      { items: bavarde, poids: 1 },
      { items: lente, poids: 1 },
    ]),
    lib.roundRobin([bavarde, lente], [], Infinity)
  );
});

test("weightedRoundRobin sert la file au poids le plus fort plus souvent, proportionnellement", () => {
  // Poids 3 contre 1 : la première file doit apparaître trois fois plus
  // souvent, répartie sur tout le résultat plutôt qu'en un seul bloc.
  const a = ["a1", "a2", "a3", "a4", "a5", "a6"];
  const b = ["b1", "b2"];
  assert.deepEqual(
    lib.weightedRoundRobin([
      { items: a, poids: 3 },
      { items: b, poids: 1 },
    ]),
    ["a1", "a2", "a3", "b1", "a4", "a5", "a6", "b2"]
  );
});

test("weightedRoundRobin : une file vide, absente ou de poids nul n'est jamais servie", () => {
  assert.deepEqual(
    lib.weightedRoundRobin([
      { items: ["x"], poids: 1 },
      { items: [], poids: 5 },
      { items: ["y"], poids: 0 },
    ]),
    ["x"]
  );
  assert.deepEqual(lib.weightedRoundRobin([]), []);
});

test("weightedRoundRobin fusionne trois flux en un seul passage", () => {
  const majoritaire = ["m1", "m2", "m3", "m4", "m5", "m6"];
  const minoritaire = ["n1", "n2"];
  const rare = ["r1"];
  const out = lib.weightedRoundRobin([
    { items: majoritaire, poids: 3 },
    { items: minoritaire, poids: 1 },
    { items: rare, poids: 1 },
  ]);
  assert.equal(out.length, 9);
  // Chaque flux garde son ordre interne, quelle que soit la position où il
  // est servi.
  assert.deepEqual(
    out.filter((x) => x[0] === "m"),
    majoritaire
  );
  assert.deepEqual(
    out.filter((x) => x[0] === "n"),
    minoritaire
  );
  assert.deepEqual(
    out.filter((x) => x[0] === "r"),
    rare
  );
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

const YT = "dQw4w9WgXcQ"; // 11 caractères, la forme exacte d'un identifiant

test("youtubeId reconnaît les formes d'URL qu'un flux YouTube publie", () => {
  // La forme servie par youtube.com/feeds/videos.xml (<link rel="alternate">).
  assert.equal(lib.youtubeId("https://www.youtube.com/watch?v=" + YT), YT);
  // Un Short apparaît dans le flux de la chaîne comme les autres vidéos, mais
  // le lien partagé, lui, prend cette forme.
  assert.equal(lib.youtubeId("https://www.youtube.com/shorts/" + YT), YT);
  assert.equal(lib.youtubeId("https://youtu.be/" + YT + "?t=42"), YT);
  assert.equal(lib.youtubeId("https://www.youtube.com/embed/" + YT), YT);
  assert.equal(lib.youtubeId("https://www.youtube.com/live/" + YT), YT);
  // Sans « www. », et sur les hôtes secondaires.
  assert.equal(lib.youtubeId("https://youtube.com/watch?v=" + YT), YT);
  assert.equal(lib.youtubeId("https://m.youtube.com/watch?v=" + YT + "&list=PL1"), YT);
  assert.equal(lib.youtubeId("https://music.youtube.com/watch?v=" + YT), YT);
});

test("youtubeId refuse tout ce qui n'est pas exactement un identifiant", () => {
  // C'est ce refus qui autorise l'appelant à concaténer le résultat dans un
  // attribut src sans échappement : rien d'autre que [A-Za-z0-9_-]{11} n'en sort.
  assert.equal(lib.youtubeId("https://www.youtube.com/watch?v=trop-court"), "");
  assert.equal(lib.youtubeId("https://www.youtube.com/watch?v=" + YT + "X"), "");
  assert.equal(lib.youtubeId("https://www.youtube.com/watch?v=abc/../etc"), "");
  assert.equal(lib.youtubeId("https://www.youtube.com/@unechaine"), "");
  assert.equal(lib.youtubeId("https://www.youtube.com/"), "");
  // Un hôte qui se contente de CONTENIR le nom ne suffit pas.
  assert.equal(lib.youtubeId("https://youtube.com.pirate.fr/watch?v=" + YT), "");
  assert.equal(lib.youtubeId("https://lemonde.fr/article"), "");
  // `new URL` accepte volontiers un schéma exécutable — pas nous.
  assert.equal(lib.youtubeId("javascript:alert(1)//youtube.com/watch?v=" + YT), "");
  assert.equal(lib.youtubeId(""), "");
  assert.equal(lib.youtubeId(null), "");
  assert.equal(lib.youtubeId("pas une url"), "");
});

test("isYoutubeFeedUrl reconnaît l'URL d'un flux de chaîne, pas une vidéo", () => {
  assert.ok(
    lib.isYoutubeFeedUrl("https://www.youtube.com/feeds/videos.xml?channel_id=UCabc")
  );
  assert.ok(lib.isYoutubeFeedUrl("https://youtube.com/feeds/videos.xml?playlist_id=PL1"));
  // Une vidéo n'est pas un flux, et un autre site non plus.
  assert.ok(!lib.isYoutubeFeedUrl("https://www.youtube.com/watch?v=" + YT));
  assert.ok(!lib.isYoutubeFeedUrl("https://lemonde.fr/rss/une.xml"));
  assert.ok(!lib.isYoutubeFeedUrl("https://youtube.com.pirate.fr/feeds/videos.xml"));
  assert.ok(!lib.isYoutubeFeedUrl(""));
});

test("youtubeShortsFeedUrl vise la playlist « Shorts » de la chaîne", () => {
  const CH = "sT0YIqwnpJCM-mx7-gSA4Q"; // 22 caractères, comme un vrai identifiant
  // Le cas ordinaire : un flux de chaîne devient le flux de ses Shorts seuls.
  assert.equal(
    lib.youtubeShortsFeedUrl(
      "https://www.youtube.com/feeds/videos.xml?channel_id=UC" + CH
    ),
    "https://www.youtube.com/feeds/videos.xml?playlist_id=UUSH" + CH
  );
  // Les autres playlists auto-générées de la MÊME chaîne mènent à la sienne.
  for (const p of ["UU", "UULF", "UULV", "UUSH"]) {
    assert.equal(
      lib.youtubeShortsFeedUrl(
        "https://www.youtube.com/feeds/videos.xml?playlist_id=" + p + CH
      ),
      "https://www.youtube.com/feeds/videos.xml?playlist_id=UUSH" + CH
    );
  }
  // Rendu tel quel : une playlist CHOISIE (aucune variante Shorts n'existe),
  // un identifiant qui n'a pas la forme d'un vrai, et tout ce qui n'est pas
  // un flux YouTube.
  const garder = [
    "https://www.youtube.com/feeds/videos.xml?playlist_id=PLabcdef",
    "https://www.youtube.com/feeds/videos.xml?channel_id=UC1",
    "https://www.youtube.com/feeds/videos.xml",
    "https://lemonde.fr/rss/une.xml",
    "https://www.youtube.com/watch?v=" + YT,
    "pas une url",
    "",
  ];
  for (const u of garder) assert.equal(lib.youtubeShortsFeedUrl(u), u);
  assert.equal(lib.youtubeShortsFeedUrl(null), "");
});

test("isYoutubeShortsFeedUrl reconnaît un flux de Shorts, et lui seul", () => {
  const CH = "sT0YIqwnpJCM-mx7-gSA4Q";
  assert.ok(
    lib.isYoutubeShortsFeedUrl(
      "https://www.youtube.com/feeds/videos.xml?playlist_id=UUSH" + CH
    )
  );
  assert.ok(
    !lib.isYoutubeShortsFeedUrl(
      "https://www.youtube.com/feeds/videos.xml?playlist_id=UULF" + CH
    )
  );
  assert.ok(
    !lib.isYoutubeShortsFeedUrl(
      "https://www.youtube.com/feeds/videos.xml?channel_id=UC" + CH
    )
  );
  assert.ok(!lib.isYoutubeShortsFeedUrl("https://lemonde.fr/rss/une.xml"));
  assert.ok(!lib.isYoutubeShortsFeedUrl(""));
  // Ce que la réécriture produit est toujours reconnu : les deux ne peuvent
  // pas diverger (nommage de la chaîne, lot vide toléré).
  assert.ok(
    lib.isYoutubeShortsFeedUrl(
      lib.youtubeShortsFeedUrl(
        "https://www.youtube.com/feeds/videos.xml?channel_id=UC" + CH
      )
    )
  );
});

test("youtubeFeedName préfixe la chaîne, et ne se préfixe jamais deux fois", () => {
  // Sans ça, toutes les chaînes s'appellent « youtube.com » : l'URL d'un flux
  // YouTube ne contient qu'un channel_id opaque.
  assert.equal(lib.youtubeFeedName("ScienceEtonnante"), "YT · ScienceEtonnante");
  assert.equal(lib.youtubeFeedName("  Arte\n Documentaires "), "YT · Arte Documentaires");
  // Nom relu depuis le disque, ou importé d'un OPML exporté par l'app.
  assert.equal(lib.youtubeFeedName("YT · ScienceEtonnante"), "YT · ScienceEtonnante");
  // Rien à annoncer : l'appelant gardera le nom qu'il avait.
  assert.equal(lib.youtubeFeedName(""), "");
  assert.equal(lib.youtubeFeedName("   "), "");
  assert.equal(lib.youtubeFeedName(null), "");
  // Un titre délirant ne doit pas déborder d'une puce de filtre.
  assert.ok(lib.youtubeFeedName("x".repeat(500)).length < 100);
});

test("isYoutubeChannelPageUrl reconnaît une page de chaîne, pas un flux ni une vidéo", () => {
  assert.ok(lib.isYoutubeChannelPageUrl("https://www.youtube.com/@ScienceEtonnante"));
  assert.ok(
    lib.isYoutubeChannelPageUrl("https://youtube.com/channel/UCabcdefghijklmnopqrstuv")
  );
  assert.ok(lib.isYoutubeChannelPageUrl("https://www.youtube.com/c/ArteDocumentaires"));
  assert.ok(lib.isYoutubeChannelPageUrl("https://www.youtube.com/user/unepersonne"));
  assert.ok(lib.isYoutubeChannelPageUrl("https://m.youtube.com/@ScienceEtonnante"));
  // Sous-page d'une chaîne : toujours la même chaîne à résoudre.
  assert.ok(
    lib.isYoutubeChannelPageUrl("https://www.youtube.com/@ScienceEtonnante/videos")
  );
  // Déjà un flux, ou une vidéo : pas une page de chaîne.
  assert.ok(
    !lib.isYoutubeChannelPageUrl(
      "https://www.youtube.com/feeds/videos.xml?channel_id=UCabc"
    )
  );
  assert.ok(!lib.isYoutubeChannelPageUrl("https://www.youtube.com/watch?v=" + YT));
  assert.ok(!lib.isYoutubeChannelPageUrl("https://www.youtube.com/shorts/" + YT));
  assert.ok(!lib.isYoutubeChannelPageUrl("https://lemonde.fr/@quelquun"));
  assert.ok(!lib.isYoutubeChannelPageUrl(""));
  assert.ok(!lib.isYoutubeChannelPageUrl(null));
});

test("youtubeChannelIdFromChannelUrl lit l'identifiant déjà présent dans /channel/UC…", () => {
  const id = "UCabcdefghijklmnopqrstuv";
  assert.equal(
    lib.youtubeChannelIdFromChannelUrl("https://www.youtube.com/channel/" + id),
    id
  );
  assert.equal(
    lib.youtubeChannelIdFromChannelUrl(
      "https://www.youtube.com/channel/" + id + "/videos"
    ),
    id
  );
  // Pas la bonne forme d'identifiant (pas UC + 22 caractères) : refusé plutôt
  // que renvoyé tel quel.
  assert.equal(
    lib.youtubeChannelIdFromChannelUrl("https://www.youtube.com/channel/x"),
    ""
  );
  // Toute autre forme de page de chaîne : rien à en tirer directement.
  assert.equal(lib.youtubeChannelIdFromChannelUrl("https://www.youtube.com/@nom"), "");
  assert.equal(lib.youtubeChannelIdFromChannelUrl(""), "");
  assert.equal(lib.youtubeChannelIdFromChannelUrl(null), "");
});

test("youtubeChannelHandleFromUrl tire le nom d'une page /@nom, /c/… ou /user/…", () => {
  assert.equal(
    lib.youtubeChannelHandleFromUrl("https://www.youtube.com/@ScienceEtonnante"),
    "ScienceEtonnante"
  );
  // Sous-page, et paramètre de partage : n'en font pas partie du nom.
  assert.equal(
    lib.youtubeChannelHandleFromUrl(
      "https://www.youtube.com/@ScienceEtonnante/videos?si=x"
    ),
    "ScienceEtonnante"
  );
  assert.equal(
    lib.youtubeChannelHandleFromUrl("https://www.youtube.com/c/ArteDocumentaires"),
    "ArteDocumentaires"
  );
  assert.equal(
    lib.youtubeChannelHandleFromUrl("https://www.youtube.com/user/unepersonne"),
    "unepersonne"
  );
  // /channel/UC… porte un identifiant, pas un nom : voir
  // youtubeChannelIdFromChannelUrl.
  assert.equal(
    lib.youtubeChannelHandleFromUrl("https://www.youtube.com/channel/UCabc"),
    ""
  );
  assert.equal(lib.youtubeChannelHandleFromUrl(""), "");
  assert.equal(lib.youtubeChannelHandleFromUrl(null), "");
});

test("feedLinkFromHtml lit le <link rel=alternate> annoncé par la page", () => {
  const url =
    "https://www.youtube.com/feeds/videos.xml?channel_id=UCabcdefghijklmnopqrstuv";
  assert.equal(
    lib.feedLinkFromHtml(
      `<html><head><link rel="alternate" type="application/rss+xml" title="RSS" href="${url}"></head></html>`
    ),
    url
  );
  // Ordre des attributs différent : ne doit rien changer.
  assert.equal(
    lib.feedLinkFromHtml(
      `<link href="${url}" type="application/rss+xml" rel="alternate">`
    ),
    url
  );
  // Entité HTML dans le href (le & d'une URL de flux est échappé en HTML).
  assert.equal(
    lib.feedLinkFromHtml(
      '<link rel="alternate" type="application/rss+xml" href="https://www.youtube.com/feeds/videos.xml?a=1&amp;channel_id=UCabc">'
    ),
    "https://www.youtube.com/feeds/videos.xml?a=1&channel_id=UCabc"
  );
  // Pas de balise de ce type : rien à en tirer.
  assert.equal(
    lib.feedLinkFromHtml("<html><head><title>Chaîne</title></head></html>"),
    ""
  );
  assert.equal(lib.feedLinkFromHtml(""), "");
});

test("commonFeedUrlCandidates propose les chemins conventionnels sur l'origine", () => {
  assert.deepEqual(lib.commonFeedUrlCandidates("https://exemple.fr/blog/article"), [
    "https://exemple.fr/feed",
    "https://exemple.fr/rss.xml",
    "https://exemple.fr/feed.xml",
    "https://exemple.fr/atom.xml",
    "https://exemple.fr/rss",
  ]);
  // Protocole ni http ni https : rien à essayer.
  assert.deepEqual(lib.commonFeedUrlCandidates("ftp://exemple.fr"), []);
  assert.deepEqual(lib.commonFeedUrlCandidates(""), []);
  assert.deepEqual(lib.commonFeedUrlCandidates(null), []);
});

test("youtubeChannelIdFromHtml cherche le channelId par ordre de confiance", () => {
  const id = "UCabcdefghijklmnopqrstuv";
  assert.equal(lib.youtubeChannelIdFromHtml(`{"channelId":"${id}"}`), id);
  // À défaut de channelId, externalId.
  assert.equal(lib.youtubeChannelIdFromHtml(`{"externalId":"${id}"}`), id);
  // À défaut des deux, un paramètre channel_id= dans le HTML (ex. un lien).
  assert.equal(
    lib.youtubeChannelIdFromHtml(`<a href="/feeds/videos.xml?channel_id=${id}">`),
    id
  );
  // En tout dernier recours, l'identifiant isolé n'importe où dans le texte.
  assert.equal(lib.youtubeChannelIdFromHtml(`vu ailleurs : ${id} sur la page`), id);
  assert.equal(lib.youtubeChannelIdFromHtml("<html>rien ici</html>"), "");
  assert.equal(lib.youtubeChannelIdFromHtml(""), "");
});

test("youtubeFeedUrlFromChannelHtml combine lien annoncé et channelId", () => {
  const id = "UCabcdefghijklmnopqrstuv";
  const rssUrl = "https://www.youtube.com/feeds/videos.xml?channel_id=" + id;
  // Le lien annoncé prime quand les deux sont présents.
  assert.equal(
    lib.youtubeFeedUrlFromChannelHtml(
      `<link rel="alternate" type="application/rss+xml" href="${rssUrl}">` +
        `<script>var d={"channelId":"UCzzzzzzzzzzzzzzzzzzzzzz"};</script>`
    ),
    rssUrl
  );
  // Pas de lien annoncé : construit depuis le channelId trouvé.
  assert.equal(
    lib.youtubeFeedUrlFromChannelHtml(`<script>var d={"channelId":"${id}"};</script>`),
    rssUrl
  );
  // Ni l'un ni l'autre : rien à résoudre.
  assert.equal(lib.youtubeFeedUrlFromChannelHtml("<html>rien ici</html>"), "");
});

test("youtubeApiChannelsByHandleUrl construit l'URL channels.list pour un handle", () => {
  const url = lib.youtubeApiChannelsByHandleUrl("ScienceEtonnante", "MACLE");
  assert.match(
    url,
    /^https:\/\/www\.googleapis\.com\/youtube\/v3\/channels\?part=id&forHandle=/
  );
  assert.match(url, /forHandle=%40ScienceEtonnante&/);
  assert.match(url, /key=MACLE$/);
  // Un handle déjà préfixé par @ ne devient pas "@@nom".
  assert.match(lib.youtubeApiChannelsByHandleUrl("@nom", "k"), /forHandle=%40nom&/);
});

test("youtubeApiChannelsByUsernameUrl construit l'URL channels.list pour un ancien identifiant", () => {
  const url = lib.youtubeApiChannelsByUsernameUrl("unepersonne", "MACLE");
  assert.match(url, /forUsername=unepersonne/);
  assert.match(url, /key=MACLE$/);
});

test("youtubeApiSearchChannelUrl construit l'URL search.list en dernier recours", () => {
  const url = lib.youtubeApiSearchChannelUrl("Arte Documentaires", "MACLE");
  assert.match(url, /type=channel/);
  assert.match(url, /q=Arte%20Documentaires/);
  assert.match(url, /key=MACLE$/);
});

test("youtubeApiChannelIdFromResponse lit l'identifiant selon la forme de la réponse", () => {
  const id = "UCabcdefghijklmnopqrstuv";
  // channels.list : id est directement la chaîne.
  assert.equal(lib.youtubeApiChannelIdFromResponse({ items: [{ id }] }), id);
  // search.list : id est un objet {channelId}.
  assert.equal(
    lib.youtubeApiChannelIdFromResponse({ items: [{ id: { channelId: id } }] }),
    id
  );
  // Liste vide, forme inattendue, ou identifiant mal formé : rien.
  assert.equal(lib.youtubeApiChannelIdFromResponse({ items: [] }), "");
  assert.equal(lib.youtubeApiChannelIdFromResponse({}), "");
  assert.equal(
    lib.youtubeApiChannelIdFromResponse({ items: [{ id: "pasUnIdentifiant" }] }),
    ""
  );
  assert.equal(lib.youtubeApiChannelIdFromResponse(null), "");
});

test("youtubeApiPlaylistItemsUrl construit l'URL playlistItems.list", () => {
  const url = lib.youtubeApiPlaylistItemsUrl("UUSHabcdefghijklmnopqrstuv", "MACLE");
  assert.match(
    url,
    /^https:\/\/www\.googleapis\.com\/youtube\/v3\/playlistItems\?part=snippet&maxResults=20&playlistId=/
  );
  assert.match(url, /playlistId=UUSHabcdefghijklmnopqrstuv&/);
  assert.match(url, /key=MACLE$/);
});

test("youtubeApiBestThumbnail choisit la vignette la plus large déclarée", () => {
  assert.equal(
    lib.youtubeApiBestThumbnail({
      default: { url: "https://i.ytimg.com/small.jpg", width: 120 },
      maxres: { url: "https://i.ytimg.com/big.jpg", width: 1280 },
      medium: { url: "https://i.ytimg.com/mid.jpg", width: 320 },
    }),
    "https://i.ytimg.com/big.jpg"
  );
  // Rien d'exploitable : "".
  assert.equal(lib.youtubeApiBestThumbnail({}), "");
  assert.equal(lib.youtubeApiBestThumbnail(null), "");
});

test("youtubeApiItemsFromPlaylistResponse ne garde que les items avec un vrai identifiant de vidéo", () => {
  const json = {
    items: [
      {
        snippet: {
          title: "Un Short",
          description: "Description",
          resourceId: { videoId: "dQw4w9WgXcQ" },
          thumbnails: { high: { url: "https://i.ytimg.com/hq.jpg", width: 480 } },
          publishedAt: "2026-01-01T00:00:00Z",
          channelTitle: "Une Chaîne",
        },
      },
      // Pas de resourceId.videoId exploitable : écarté.
      { snippet: { title: "Sans vidéo", resourceId: {} } },
      // Pas de titre : écarté (comme fetchFeed/fetchFeedRss2Json).
      { snippet: { title: "", resourceId: { videoId: "dQw4w9WgXcQ" } } },
    ],
  };
  const out = lib.youtubeApiItemsFromPlaylistResponse(json);
  assert.equal(out.length, 1);
  assert.equal(out[0].title, "Un Short");
  assert.equal(out[0].link, "https://www.youtube.com/watch?v=dQw4w9WgXcQ");
  assert.equal(out[0].img, "https://i.ytimg.com/hq.jpg");
  assert.equal(out[0].channelTitle, "Une Chaîne");
  assert.deepEqual(lib.youtubeApiItemsFromPlaylistResponse({}), []);
  assert.deepEqual(lib.youtubeApiItemsFromPlaylistResponse(null), []);
});

test("youtubeApiVideosDurationUrl construit l'URL videos.list, jusqu'à 50 identifiants", () => {
  const url = lib.youtubeApiVideosDurationUrl(["abc", "def"], "MACLE");
  assert.match(
    url,
    /^https:\/\/www\.googleapis\.com\/youtube\/v3\/videos\?part=contentDetails&id=/
  );
  assert.match(url, /id=abc%2Cdef&/);
  assert.match(url, /key=MACLE$/);
  // Plus de 50 identifiants : tronqué à 50, jamais une requête qui déborde.
  const beaucoup = Array.from({ length: 60 }, (_, i) => "id" + i);
  const many = lib.youtubeApiVideosDurationUrl(beaucoup, "K");
  const ids = decodeURIComponent(many.match(/id=([^&]*)/)[1]).split(",");
  assert.equal(ids.length, 50);
  assert.deepEqual(
    lib.youtubeApiVideosDurationUrl([null, "", "x"], "K").includes("id=x"),
    true
  );
});

test("youtubeIsoDurationSeconds parse une durée ISO 8601 YouTube", () => {
  assert.equal(lib.youtubeIsoDurationSeconds("PT14M8S"), 14 * 60 + 8);
  assert.equal(lib.youtubeIsoDurationSeconds("PT45S"), 45);
  assert.equal(lib.youtubeIsoDurationSeconds("PT1H2M3S"), 3600 + 120 + 3);
  assert.equal(lib.youtubeIsoDurationSeconds("P1DT1H"), 24 * 3600 + 3600);
  // Mal formée, absente ou vide : NaN, jamais une durée inventée.
  assert.ok(Number.isNaN(lib.youtubeIsoDurationSeconds("pas une durée")));
  assert.ok(Number.isNaN(lib.youtubeIsoDurationSeconds("")));
  assert.ok(Number.isNaN(lib.youtubeIsoDurationSeconds(null)));
  assert.ok(Number.isNaN(lib.youtubeIsoDurationSeconds("P")));
});

test("youtubeApiDurationsFromResponse ne garde que les durées CONFIRMÉES, par identifiant", () => {
  const json = {
    items: [
      { id: "short1", contentDetails: { duration: "PT45S" } },
      // Le documentaire de 14 min infiltré dans une playlist Shorts.
      { id: "long1", contentDetails: { duration: "PT14M8S" } },
      // Durée absente ou mal formée : n'apparaît pas dans le résultat.
      { id: "sansduree", contentDetails: {} },
      { id: "malformee", contentDetails: { duration: "n'importe quoi" } },
      // Pas d'identifiant exploitable : écarté.
      { contentDetails: { duration: "PT10S" } },
    ],
  };
  assert.deepEqual(lib.youtubeApiDurationsFromResponse(json), {
    short1: 45,
    long1: 14 * 60 + 8,
  });
  assert.deepEqual(lib.youtubeApiDurationsFromResponse({}), {});
  assert.deepEqual(lib.youtubeApiDurationsFromResponse(null), {});
});

test("les vignettes YouTube déclarent leur taille par leur nom de fichier", () => {
  // Sans ça, imageSizeFromUrl rend 0 sur une URL ytimg, et applyBg part sonder
  // /api/og pour CHAQUE carte vidéo défilée — le défaut déjà corrigé côté
  // Wikipédia (une invocation serverless par carte).
  const base = "https://i.ytimg.com/vi/" + YT + "/";
  assert.equal(lib.imageSizeFromUrl(base + "hqdefault.jpg"), 480);
  assert.equal(lib.imageSizeFromUrl(base + "mqdefault.jpg"), 320);
  assert.equal(lib.imageSizeFromUrl(base + "maxresdefault.jpg"), 1280);
  assert.equal(
    lib.imageSizeFromUrl("https://i9.ytimg.com/vi_webp/" + YT + "/sddefault.webp"),
    640
  );
  // Nom inconnu : on ne devine pas.
  assert.equal(lib.imageSizeFromUrl(base + "frame0.jpg"), 0);
});

test("upscaleImageUrl demande maxresdefault à YouTube, et rien de plus", () => {
  const base = "https://i.ytimg.com/vi/" + YT + "/";
  assert.equal(lib.upscaleImageUrl(base + "hqdefault.jpg"), base + "maxresdefault.jpg");
  // La variante WebP et la requête de signature sont conservées telles quelles.
  assert.equal(
    lib.upscaleImageUrl("https://i9.ytimg.com/vi_webp/" + YT + "/mqdefault.webp?sqp=abc"),
    "https://i9.ytimg.com/vi_webp/" + YT + "/maxresdefault.webp?sqp=abc"
  );
  // Déjà au maximum, ou nom inconnu : rien à tenter.
  assert.equal(lib.upscaleImageUrl(base + "maxresdefault.jpg"), "");
  assert.equal(lib.upscaleImageUrl(base + "hq720.jpg"), "");
  assert.equal(lib.upscaleImageUrl(base + "frame0.jpg"), "");
  // Le garde-fou du placeholder : YouTube répond 200 avec une image grise de
  // 120 px quand maxresdefault n'existe pas. C'est la largeur DÉCLARÉE de
  // l'originale (480) qui la fait rejeter par applyBg — d'où le test ci-dessus
  // sur imageSizeFromUrl, dont dépend tout le mécanisme.
  assert.ok(lib.imageSizeFromUrl(base + "hqdefault.jpg") > 120);
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

/* ---------- Distinguer des flux qui portent le même nom ---------- */

test("feedDiscriminator retient le dernier segment parlant du chemin", () => {
  const d = lib.feedDiscriminator;
  assert.equal(d("https://www.courrierinternational.com/feed/all/rss.xml"), "all");
  assert.equal(
    d("https://www.courrierinternational.com/feed/rubrique/politique/rss.xml"),
    "politique"
  );
  assert.equal(d("https://www.lemonde.fr/rss/une.xml"), "une");
  assert.equal(d("https://www.lemonde.fr/international/rss_full.xml"), "international");
  assert.equal(d("https://www.france24.com/fr/rss"), "fr");
  // Tirets et souligné se lisent mieux en mots.
  assert.equal(d("https://s.fr/feed/high-tech/rss.xml"), "high tech");
});

test("feedDiscriminator se rabat sur la requête puis le chemin", () => {
  const d = lib.feedDiscriminator;
  // Rien de parlant dans le chemin : la requête distingue quand même.
  assert.equal(d("https://s.fr/feed?cat=12"), "cat=12");
  // Ni l'un ni l'autre : mieux vaut le chemin brut que rien du tout.
  assert.equal(d("https://s.fr/feed/"), "feed");
  assert.equal(d("https://s.fr/"), "");
});

test("feedDiscriminator ne prend pas « rsspolitique » pour un mot générique", () => {
  // La liste des segments génériques est FERMÉE : seul « rss_full » et
  // consorts en sont, pas tout ce qui commence par rss.
  assert.equal(lib.feedDiscriminator("https://s.fr/rsspolitique"), "rsspolitique");
});

test("feedLabels ne précise QUE les noms en double", () => {
  const out = lib.feedLabels([
    { name: "Le Monde", url: "https://www.lemonde.fr/rss/une.xml" },
    {
      name: "Courrier international",
      url: "https://www.courrierinternational.com/feed/all/rss.xml",
    },
    {
      name: "Courrier international",
      url: "https://www.courrierinternational.com/feed/rubrique/asie/rss.xml",
    },
  ]);
  assert.deepEqual(out, [
    "Le Monde", // unique : nom nu
    "Courrier international · all",
    "Courrier international · asie",
  ]);
});

test("feedLabels encaisse les entrées dégradées", () => {
  assert.deepEqual(lib.feedLabels([]), []);
  assert.deepEqual(lib.feedLabels(null), []);
  // Nom absent : on retombe sur l'hôte plutôt que sur une ligne vide.
  assert.deepEqual(lib.feedLabels([{ url: "https://www.s.fr/rss" }]), ["s.fr"]);
  // Casse et espaces ne doivent pas faire croire à deux noms différents.
  const out = lib.feedLabels([
    { name: "Presse ", url: "https://s.fr/rss/une.xml" },
    { name: "presse", url: "https://s.fr/rss/monde.xml" },
  ]);
  assert.deepEqual(out, ["Presse · une", "presse · monde"]);
});

/* ---------- Bornes sur du contenu de flux ---------- */

test("clampText laisse un résumé normal intact et borne un article entier", () => {
  const court = "Un résumé de taille ordinaire.";
  assert.equal(lib.clampText(court), court);
  // Pile à la borne : rien à couper.
  const pile = "a".repeat(1000);
  assert.equal(lib.clampText(pile), pile);
  // Au-delà : coupé, avec un signe que le texte continue.
  const long = lib.clampText("mot ".repeat(20000));
  assert.ok(long.length <= 1001, "borné à 1000 caractères + …");
  assert.ok(long.endsWith("…"));
  // Coupe sur une frontière de mot, jamais au milieu.
  assert.ok(!/mo…$/.test(long));
  // Un mot unique plus long que la borne ne doit pas rendre une chaîne vide.
  assert.equal(lib.clampText("x".repeat(50), 10).length, 11);
  // Entrées dégradées.
  assert.equal(lib.clampText(null), "");
  assert.equal(lib.clampText(undefined), "");
});

test("isFeedUrl n'accepte que http(s)", () => {
  assert.equal(lib.isFeedUrl("https://ex.fr/rss.xml"), true);
  assert.equal(lib.isFeedUrl("http://ex.fr/rss.xml"), true);
  assert.equal(lib.isFeedUrl("file:///etc/passwd"), false);
  assert.equal(lib.isFeedUrl("javascript:alert(1)"), false);
  assert.equal(lib.isFeedUrl("content://media/external"), false);
  assert.equal(lib.isFeedUrl("//ex.fr/rss.xml"), false); // pas de base : non parsable
  assert.equal(lib.isFeedUrl(""), false);
  assert.equal(lib.isFeedUrl(null), false);
  assert.equal(lib.isFeedUrl(42), false);
});

test("les imports écartent les URL non http(s)", () => {
  const json = lib.parseJsonFeeds(
    '[{"name":"ok","url":"https://ok.fr/rss"},{"name":"local","url":"file:///etc/passwd"},' +
      '{"name":"js","url":"javascript:alert(1)"}]'
  );
  assert.deepEqual(
    json.map((f) => f.url),
    ["https://ok.fr/rss"]
  );
  const opml = lib.parseOpmlFeeds(`<?xml version="1.0"?><opml><body>
    <outline text="ok" xmlUrl="https://ok.fr/rss"/>
    <outline text="local" xmlUrl="file:///etc/passwd"/>
  </body></opml>`);
  assert.deepEqual(
    opml.map((f) => f.url),
    ["https://ok.fr/rss"]
  );
});
