#!/usr/bin/env node
/* Banc de QA de SwiperNews : joue des scénarios RÉELS dans Chromium, avec un
 * réseau entièrement simulé (aucune requête ne part vers une vraie source).
 *
 * Ce que `npm test` ne peut pas voir : il ne couvre que `src/` et `api/`, jamais
 * le JS en ligne d'`index.html` — c'est-à-dire tout le fil, tout l'état, tout le
 * stockage local. Ces scénarios-là sont ceux qui ont trouvé les deux pannes
 * critiques de AUDIT-ROBUSTESSE-2026-08.md (§2.1, §2.2), invisibles en lecture
 * de code parce qu'elles supposent une donnée locale abîmée.
 *
 * Volontairement hors de `package.json` (playwright-core n'est pas une
 * dépendance du projet, qui n'en a aucune à l'exécution) :
 *
 *   npm i playwright-core --prefix /tmp/qa
 *   python3 -m http.server 8124            # servir le dépôt
 *   NODE_PATH=/tmp/qa/node_modules node tools/qa-scenarios.js <scénario>
 *
 * Sans argument, la liste des scénarios s'affiche.
 */
const { chromium } = require("playwright-core");
const URL_APP = "http://localhost:8124/index.html";

const RSS_OK = `<?xml version="1.0"?><rss version="2.0"><channel><title>T</title>
${Array.from({ length: 12 }, (_, i) => `<item><title>Actu ${i}</title><link>https://ex.test/a${i}</link><description>Resume ${i} un peu de texte</description><pubDate>${new Date(Date.now() - i * 3600e3).toUTCString()}</pubDate></item>`).join("\n")}
</channel></rss>`;

const WIKI_OK = JSON.stringify({
  query: {
    pages: Array.from({ length: 20 }, (_, i) => ({
      title: "Wiki " + i,
      extract: "x".repeat(200) + " article " + i,
      canonicalurl: "https://fr.wikipedia.org/wiki/W" + i,
      thumbnail: { source: "https://img.test/w" + i + ".jpg" },
    })),
  },
});

async function boot(opts = {}) {
  const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
  const ctx = await browser.newContext({ viewport: { width: 412, height: 900 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push("PAGEERROR: " + e.message));
  page.on("console", (m) => {
    if (m.type() === "warning" && /SwiperNews/.test(m.text()))
      errors.push("WARN: " + m.text());
    if (m.type() === "error") errors.push("CONSOLE: " + m.text());
  });
  // Réseau : tout ce qui sort est simulé, rien ne part vers de vraies sources.
  await page.route("**/*", async (route) => {
    const u = route.request().url();
    const api = /\/api\/(feed|learn|og)/.test(u);
    if (u.startsWith("http://localhost:8124") && !api) return route.continue();
    if (opts.offline) return route.abort("internetdisconnected");
    if (/api\/feed|allorigins|corsproxy|codetabs|thingproxy/.test(u))
      return route.fulfill({
        status: 200,
        contentType: "application/xml",
        body: opts.rss ?? RSS_OK,
      });
    if (/wikipedia\.org|api\/learn/.test(u))
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: opts.wiki ?? WIKI_OK,
      });
    if (/api\/og/.test(u))
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: '{"image":"","paywalled":false,"sponsored":false}',
      });
    // ytimg : les vignettes YouTube. Sans cette ligne elles tomberaient sur le
    // fourre-tout ci-dessous (corps vide), donc `probeWidth` rendrait 0 et le
    // scénario `video` ne mesurerait pas ce qu'il croit mesurer.
    if (/img\.test|images\.unsplash|ytimg\.com/.test(u))
      return route.fulfill({
        status: 200,
        contentType: "image/gif",
        body: Buffer.from("R0lGODlhAQABAAAAACw=", "base64"),
      });
    // Lecteur YouTube : une page inerte servie sous la même URL. RIEN ne doit
    // partir vers Google depuis le banc — on vérifie qu'une iframe est montée,
    // pas que YouTube fonctionne.
    if (/youtube-nocookie\.com|youtube\.com\/embed/.test(u))
      return route.fulfill({
        status: 200,
        contentType: "text/html",
        body: "<!doctype html><title>lecteur simulé</title><body>lecteur",
      });
    return route.fulfill({ status: 200, body: "" });
  });
  if (opts.storage) {
    await page.addInitScript((kv) => {
      for (const [k, v] of Object.entries(kv)) localStorage.setItem(k, v);
    }, opts.storage);
  }
  await page.addInitScript(() => {
    window.__rejections = [];
    addEventListener("unhandledrejection", (e) => {
      window.__rejections.push(String((e.reason && e.reason.message) || e.reason));
    });
  });
  if (opts.init) await page.addInitScript(opts.init);
  return { browser, ctx, page, errors };
}

const READY = {
  "fluxswipe.interests.v1": JSON.stringify(["sciences", "histoire"]),
  "fluxswipe.lang.v1": "fr",
};

/* Identifiant de chaîne dans sa forme réelle (UC + 22 caractères) : c'est LUI
   qui permet de dériver la playlist « Shorts » (UUSH + les 22 caractères). Un
   identifiant fantaisiste ne serait pas réécrit, et le scénario `video`
   mesurerait alors le flux de la chaîne entière — exactement ce qu'on ne veut
   plus servir. */
const YT_CHAN = "sT0YIqwnpJCM-mx7-gSA4Q";
/* Flux d'une chaîne YouTube, dans la forme RÉELLE que sert
   youtube.com/feeds/videos.xml?playlist_id=UUSH… : de l'Atom, où le lien est un
   attribut `href` (et non du texte), la vignette vit dans un <media:group>, et
   le <media:content> est une pièce jointe vidéo qu'il ne faut PAS prendre pour
   une image. Les identifiants font 11 caractères, comme les vrais.
   Le <title> du flux est celui de la PLAYLIST auto-générée, pas celui de la
   chaîne : le nom de la chaîne n'est porté que par l'auteur des entrées, d'où
   les deux ici — servir « YT · Shorts » à toutes les chaînes ramènerait le
   défaut que youtubeFeedName corrige. */
const RSS_YT = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns:yt="http://www.youtube.com/xml/schemas/2015"
      xmlns:media="http://search.yahoo.com/mrss/" xmlns="http://www.w3.org/2005/Atom">
<title>Shorts</title>
${Array.from({ length: 8 }, (_, i) => {
  const id = "vIdeO00000" + i; // 11 caractères
  return `<entry><id>yt:video:${id}</id><yt:videoId>${id}</yt:videoId>
  <title>Vidéo ${i}</title>
  <link rel="alternate" href="https://www.youtube.com/watch?v=${id}"/>
  <author><name>Une chaîne</name><uri>https://www.youtube.com/channel/UC${YT_CHAN}</uri></author>
  <published>${new Date(Date.now() - i * 3600e3).toISOString()}</published>
  <media:group>
    <media:title>Vidéo ${i}</media:title>
    <media:content url="https://www.youtube.com/v/${id}?version=3" type="application/x-shockwave-flash" width="640" height="390"/>
    <media:thumbnail url="https://i.ytimg.com/vi/${id}/hqdefault.jpg" width="480" height="360"/>
    <media:description>Description de la vidéo ${i}, un peu de texte pour remplir la carte.</media:description>
  </media:group>
</entry>`;
}).join("\n")}
</feed>`;

const scenarios = {
  // 1. Premier lancement, réseau nominal
  async firstrun() {
    const { browser, page, errors } = await boot();
    await page.goto(URL_APP);
    await page.waitForTimeout(1500);
    const sheetOpen = await page.$eval("#sheet", (e) => e.classList.contains("open"));
    console.log("panneau d'accueil ouvert :", sheetOpen);
    await page.click("#applySettings");
    await page.waitForTimeout(2500);
    console.log("cartes :", await page.$$eval("#feed .card", (e) => e.length));
    console.log("erreurs :", errors);
    await browser.close();
  },

  // 2. Stockage local corrompu : feeds n'est pas un tableau
  async corruptfeeds() {
    for (const bad of ['{"a":1}', "[null]", '["https://x.test/rss"]', "42", '"texte"']) {
      const { browser, page, errors } = await boot({
        storage: {
          ...READY,
          "fluxswipe.feeds.v1": bad,
          "fluxswipe.newssrc.v1": '["https://www.lemonde.fr/rss/une.xml"]',
        },
      });
      await page.goto(URL_APP);
      await page.waitForTimeout(1200);
      const cards = await page.$$eval("#feed .card", (e) => e.length).catch(() => -1);
      console.log(
        `feeds=${bad.padEnd(26)} cartes=${cards} err=${errors.length ? errors[0].slice(0, 90) : "aucune"}`
      );
      await browser.close();
    }
  },

  // 3. Cache disque corrompu
  async corruptcache() {
    const key = "mix|fr|all|all:sciences,histoire|s";
    for (const bad of [
      JSON.stringify({ [key]: { t: Date.now(), items: [null, null, null] } }),
      JSON.stringify({ [key]: { t: Date.now(), items: ["a", "b", "c"] } }),
      JSON.stringify({ [key]: { t: Date.now(), items: [{}, {}, {}] } }),
      "pas du json",
    ]) {
      const { browser, page, errors } = await boot({
        storage: { ...READY, "fluxswipe.cache.v1": bad },
      });
      await page.goto(URL_APP);
      await page.waitForTimeout(2000);
      const cards = await page.$$eval("#feed .card", (e) => e.length).catch(() => -1);
      const rej = await page.evaluate(() => window.__rejections);
      console.log("  rejets:", rej);
      console.log(
        `cache=${bad.slice(0, 40).padEnd(42)} cartes=${cards} err=${errors.length ? errors[0].slice(0, 80) : "aucune"}`
      );
      await browser.close();
    }
  },

  // 4. Hors ligne total au 1er lancement
  async offline() {
    const { browser, page, errors } = await boot({ offline: true, storage: READY });
    await page.goto(URL_APP);
    await page.waitForTimeout(14000);
    console.log("cartes :", await page.$$eval("#feed .card", (e) => e.length));
    console.log(
      "badge démo :",
      await page.$eval("#demobadge", (e) => !e.classList.contains("hidden"))
    );
    console.log(
      "état vide :",
      await page.$eval("#empty", (e) => !e.classList.contains("hidden"))
    );
    console.log(
      "chargement visible :",
      await page.$eval("#loading", (e) => !e.classList.contains("hidden"))
    );
    console.log(
      "barre sync :",
      await page.$eval("#syncbar", (e) => e.classList.contains("on"))
    );
    console.log("erreurs :", errors.slice(0, 3));
    await browser.close();
  },

  // 5. RSS vide / malformé / items sans rien
  async badrss() {
    const cases = {
      vide: "",
      "xml tronqué": '<?xml version="1.0"?><rss><channel><item><title>A',
      "html au lieu de xml":
        "<html><body><h1>404 not found</h1></body></html>" + "x".repeat(300),
      "items sans titre":
        '<?xml version="1.0"?><rss><channel><item><link>https://x.test/1</link></item></channel></rss>',
      "sans lien ni image":
        '<?xml version="1.0"?><rss><channel>' +
        Array.from(
          { length: 5 },
          (_, i) => `<item><title>Sans lien ${i}</title></item>`
        ).join("") +
        "</channel></rss>",
      "desc énorme":
        '<?xml version="1.0"?><rss><channel>' +
        Array.from(
          { length: 5 },
          (_, i) =>
            `<item><title>Long ${i}</title><link>https://x.test/l${i}</link><description>${"mot ".repeat(20000)}</description></item>`
        ).join("") +
        "</channel></rss>",
      doublons:
        '<?xml version="1.0"?><rss><channel>' +
        Array.from(
          { length: 8 },
          () =>
            `<item><title>Même titre</title><link>https://x.test/same</link><description>Texte assez long pour compter</description></item>`
        ).join("") +
        "</channel></rss>",
    };
    for (const [nom, rss] of Object.entries(cases)) {
      const { browser, page, errors } = await boot({ rss, storage: READY });
      await page.goto(URL_APP);
      await page.waitForTimeout(3000);
      const n = await page.$$eval("#feed .card", (e) => e.length);
      const bytes = await page.evaluate(
        () => (localStorage.getItem("fluxswipe.cache.v1") || "").length
      );
      console.log(
        `${nom.padEnd(22)} cartes=${String(n).padEnd(4)} cacheOctets=${String(bytes).padEnd(9)} err=${errors.length ? errors[0].slice(0, 70) : "aucune"}`
      );
      await browser.close();
    }
  },

  // 6. Le rafraîchissement périodique efface feedsDirty pendant qu'on règle
  async dirty() {
    const { browser, page } = await boot({ storage: READY });
    await page.goto(URL_APP);
    await page.waitForTimeout(2500);
    const avant = await page.$$eval("#feed .card", (e) => e.length);
    await page.click("#openSheet");
    await page.waitForTimeout(300);
    // On ajoute une source (comme un tap sur une suggestion)
    await page.evaluate(() => {
      feeds.push({ name: "Neuf", url: "https://neuf.test/rss", on: true });
      save();
    });
    console.log("feedsDirty après ajout :", await page.evaluate(() => feedsDirty));
    // ... puis le filet périodique se déclenche (setInterval 60 s / retour au 1er plan)
    await page.evaluate(() => loadFeeds());
    await page.waitForTimeout(200);
    console.log(
      "feedsDirty après le filet périodique :",
      await page.evaluate(() => feedsDirty)
    );
    // Validation : recharge-t-elle vraiment ?
    const seqAvant = await page.evaluate(() => loadSeq);
    await page.click("#applySettings");
    await page.waitForTimeout(1500);
    const seqApres = await page.evaluate(() => loadSeq);
    console.log(
      "loadSeq avant/après validation :",
      seqAvant,
      seqApres,
      seqApres > seqAvant ? "→ rechargé" : "→ AUCUN rechargement"
    );
    console.log(
      "la source ajoutée est-elle dans le fil ? ",
      await page.evaluate(() => newsItems.some((i) => i.source === "Neuf"))
    );
    console.log(
      "cartes avant/après :",
      avant,
      await page.$$eval("#feed .card", (e) => e.length)
    );
    await browser.close();
  },

  // 7. Doigt posé sur le fil : la file whenFeedIdle se vide-t-elle toujours ?
  async pointer() {
    const { browser, page } = await boot({ storage: READY });
    await page.goto(URL_APP);
    await page.waitForTimeout(2500);
    // Doigt posé sur une carte, puis relâché AILLEURS (rail fixe hors du fil)
    await page.mouse.move(200, 500);
    await page.mouse.down();
    await page.evaluate(() => loadMore());
    await page.waitForTimeout(800);
    console.log(
      "en attente pendant le contact :",
      await page.evaluate(() => pendingFeedUpdates.length)
    );
    // L'app passe en arrière-plan pendant le contact (cas réel : appel entrant)
    await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
    await page.mouse.up();
    await page.waitForTimeout(500);
    console.log("pointeurs restants :", await page.evaluate(() => feedPointers.size));
    console.log(
      "file après relâche :",
      await page.evaluate(() => pendingFeedUpdates.length)
    );
    await browser.close();
  },

  // 8. Instantanés : mémoire retenue par les allers-retours de filtre
  async snapmem() {
    const { browser, page } = await boot({ storage: READY });
    await page.goto(URL_APP);
    await page.waitForTimeout(2500);
    for (let i = 0; i < 12; i++) {
      await page.evaluate((n) => setCat(n % 2 ? "sciences" : "histoire"), i);
      await page.waitForTimeout(700);
    }
    const info = await page.evaluate(() => ({
      snaps: Object.keys(feedSnap).length,
      octets: Object.values(feedSnap).reduce((n, s) => n + s.html.length, 0),
      caches: Object.keys(JSON.parse(localStorage.getItem("fluxswipe.cache.v1") || "{}"))
        .length,
      cacheOctets: (localStorage.getItem("fluxswipe.cache.v1") || "").length,
    }));
    console.log("instantanés :", info.snaps, "octets HTML retenus :", info.octets);
    console.log("entrées de cache disque :", info.caches, "octets :", info.cacheOctets);
    await browser.close();
  },

  // 9. Enchaînement rapide d'actions (swipes, filtres, dose)
  async rapid() {
    const { browser, page, errors } = await boot({ storage: READY });
    await page.goto(URL_APP);
    await page.waitForTimeout(2500);
    for (let i = 0; i < 25; i++) {
      await page.evaluate((n) => {
        if (n % 3 === 0) setMixScore(n % 6);
        if (n % 3 === 1) setCat(n % 2 ? "sciences" : "all");
        if (n % 3 === 2) feedEl.scrollBy({ top: 900 });
        if (n % 7 === 0) loadFeeds(true);
      }, i);
      await page.waitForTimeout(60);
    }
    await page.waitForTimeout(4000);
    const st = await page.evaluate(() => ({
      cartes: feedEl.querySelectorAll(".card").length,
      items: items.length,
      sync: syncCount,
      barre: document.getElementById("syncbar").classList.contains("on"),
      loading: !document.getElementById("loading").classList.contains("hidden"),
      vide: !document.getElementById("empty").classList.contains("hidden"),
      rejets: window.__rejections,
    }));
    console.log(st);
    console.log("erreurs :", errors.filter((e) => !/404/.test(e)).slice(0, 4));
    await browser.close();
  },

  // 10. Quota localStorage saturé par le cache : le reste tient-il encore ?
  async quota() {
    const { browser, page, errors } = await boot({ storage: READY });
    await page.goto(URL_APP);
    await page.waitForTimeout(2500);
    // On sature comme le ferait le cache disque au fil des filtres et des langues
    const rempli = await page.evaluate(() => {
      const bloc = "x".repeat(512 * 1024);
      let n = 0;
      try {
        for (; n < 40; n++) localStorage.setItem("bourrage." + n, bloc);
      } catch (e) {
        return n;
      }
      return n;
    });
    console.log("blocs de 512 Ko écrits avant saturation :", rempli);
    // Position de lecture : écriture immédiate à chaque swipe (rememberPos)
    const ok = await page.evaluate(() => {
      localStorage.removeItem("fluxswipe.pos.v1");
      feedEl.scrollTop = feedEl.children[3].offsetTop;
      onCardChange();
      return localStorage.getItem("fluxswipe.pos.v1");
    });
    console.log("position mémorisée :", ok);
    const seen = await page.evaluate(async () => {
      localStorage.removeItem("fluxswipe.seen.v1");
      seenDirty = true;
      persistSeen();
      return localStorage.getItem("fluxswipe.seen.v1");
    });
    console.log("« déjà vu » mémorisé :", seen ? "oui" : "NON");
    console.log("erreurs :", errors.filter((e) => /SwiperNews/.test(e)).slice(0, 3));
    await browser.close();
  },

  // 11. /api/og répond 200 avec une erreur : verdict figé à vie ?
  async ogerror() {
    const { browser, page } = await boot({
      storage: READY,
      rss: '<?xml version="1.0"?><rss><channel><item><title>Article payant</title><link>https://www.lemonde.fr/politique/article/2026/08/x.html</link><description>Un resume de taille normale pour la carte</description></item></channel></rss>',
    });
    // /api/og en panne côté éditeur : la fonction répond 200 + error
    await page.route(/\/api\/og/, (r) =>
      r.fulfill({
        status: 200,
        contentType: "application/json",
        body: '{"image":"","paywalled":false,"sponsored":false,"error":"fetch failed"}',
      })
    );
    await page.goto(URL_APP);
    await page.waitForTimeout(3000);
    const cache = await page.evaluate(() =>
      JSON.parse(localStorage.getItem("fluxswipe.artmeta.v1") || "{}")
    );
    console.log("cache artmeta persisté :", JSON.stringify(cache).slice(0, 200));
    console.log(
      "→ un échec amont est-il mémorisé comme verdict ?",
      Object.keys(cache).length > 0 ? "OUI" : "non"
    );
    await browser.close();
  },

  // 12. Bornes : instantanés et cache disque sur beaucoup de fils différents
  async bounds() {
    const { browser, page } = await boot({
      storage: {
        "fluxswipe.interests.v1": JSON.stringify([
          "sciences",
          "histoire",
          "espace",
          "nature",
          "tech",
          "films",
          "musique",
          "philo",
        ]),
        "fluxswipe.lang.v1": "fr",
      },
    });
    await page.goto(URL_APP);
    await page.waitForTimeout(2500);
    for (const k of [
      "sciences",
      "histoire",
      "espace",
      "nature",
      "tech",
      "films",
      "musique",
      "philo",
      "all",
    ]) {
      await page.evaluate((c) => setCat(c), k);
      await page.waitForTimeout(600);
    }
    const info = await page.evaluate(() => ({
      snaps: Object.keys(feedSnap).length,
      caches: Object.keys(JSON.parse(localStorage.getItem("fluxswipe.cache.v1") || "{}"))
        .length,
      octets: (localStorage.getItem("fluxswipe.cache.v1") || "").length,
      cartes: feedEl.querySelectorAll(".card").length,
    }));
    console.log("après 9 changements de thème :", info);
    await browser.close();
  },

  // 13. Retour arrière : referme le panneau, ne quitte pas l'app
  async back() {
    const { browser, page, errors } = await boot({ storage: READY });
    await page.goto(URL_APP);
    await page.waitForTimeout(2500);
    const urlAvant = page.url();
    // Panneau de réglages
    await page.click("#openSheet");
    await page.waitForTimeout(300);
    console.log(
      "panneau ouvert :",
      await page.$eval("#sheet", (e) => e.classList.contains("open"))
    );
    await page.goBack();
    await page.waitForTimeout(400);
    console.log(
      "après retour → panneau ouvert :",
      await page.$eval("#sheet", (e) => e.classList.contains("open")),
      "| même page :",
      page.url() === urlAvant,
      "| fil intact :",
      (await page.$$eval("#feed .card", (e) => e.length)) > 0
    );
    // Fermeture normale : l'entrée d'historique doit être consommée
    await page.click("#openSheet");
    await page.waitForTimeout(200);
    await page.click("#applySettings");
    await page.waitForTimeout(1500);
    console.log(
      "panneau fermé au bouton :",
      !(await page.$eval("#sheet", (e) => e.classList.contains("open")))
    );
    // ... donc un retour maintenant doit VRAIMENT quitter la page
    await page.goBack().catch(() => {});
    await page.waitForTimeout(600);
    console.log(
      "retour hors panneau → a quitté la page :",
      page.url() !== urlAvant,
      "(url:",
      page.url(),
      ")"
    );
    // Feuille de filtre : la sélection doit s'appliquer même en sortant par retour
    await page.goto(URL_APP);
    await page.waitForTimeout(2500);
    const visible = await page.$eval("#srcBtn", (e) => !e.classList.contains("hidden"));
    console.log("pastille sources visible :", visible);
    if (visible) {
      await page.click("#srcBtn");
      await page.waitForTimeout(300);
      await page.evaluate(() =>
        document.querySelector('#pickGrid [data-k]:not([data-k="all"])').click()
      );
      await page.waitForTimeout(200);
      await page.goBack();
      await page.waitForTimeout(1200);
      console.log(
        "feuille fermée :",
        !(await page.$eval("#pickSheet", (e) => e.classList.contains("open"))),
        "| sélection appliquée :",
        await page.evaluate(() => newsSrc.length)
      );
    }
    console.log(
      "erreurs :",
      errors.filter((e) => !/404/.test(e))
    );
    await browser.close();
  },

  // 14. Réseau très lent, puis coupure au milieu des requêtes
  async slow() {
    const { browser, page, ctx, errors } = await boot({ storage: READY });
    let coupe = false;
    await page.route(/allorigins|corsproxy|codetabs|thingproxy|api\/feed/, async (r) => {
      await new Promise((res) => setTimeout(res, 4000)); // au-delà du timeout de 7 s ? non : juste très lent
      if (coupe) return r.abort("internetdisconnected");
      return r.fulfill({ status: 200, contentType: "application/xml", body: RSS_OK });
    });
    await page.goto(URL_APP);
    await page.waitForTimeout(1500);
    console.log(
      "pendant l'attente → chargement visible :",
      await page.$eval("#loading", (e) => !e.classList.contains("hidden")),
      "| barre sync :",
      await page.$eval("#syncbar", (e) => e.classList.contains("on"))
    );
    coupe = true;
    await page.evaluate(() => loadFeeds(true)); // coupure pendant la requête
    await page.waitForTimeout(16000);
    console.log(
      "après coupure → cartes :",
      await page.$$eval("#feed .card", (e) => e.length),
      "| barre sync :",
      await page.$eval("#syncbar", (e) => e.classList.contains("on")),
      "| écran vide :",
      await page.$eval("#empty", (e) => !e.classList.contains("hidden")),
      "| chargement :",
      await page.$eval("#loading", (e) => !e.classList.contains("hidden"))
    );
    console.log(
      "erreurs inattendues :",
      errors.filter((e) => /PAGEERROR/.test(e))
    );
    await browser.close();
  },

  // 15. Backend et proxys tous en 500
  async http500() {
    const { browser, page, errors } = await boot({ storage: READY });
    await page.route(
      /allorigins|corsproxy|codetabs|thingproxy|api\/feed|rss2json|wikipedia|api\/learn/,
      (r) => r.fulfill({ status: 500, body: "erreur serveur" })
    );
    await page.goto(URL_APP);
    await page.waitForTimeout(16000);
    console.log(
      "cartes :",
      await page.$$eval("#feed .card", (e) => e.length),
      "| démo :",
      await page.$eval("#demobadge", (e) => !e.classList.contains("hidden")),
      "| vide :",
      await page.$eval("#empty", (e) => !e.classList.contains("hidden")),
      "| chargement :",
      await page.$eval("#loading", (e) => !e.classList.contains("hidden")),
      "| sync :",
      await page.$eval("#syncbar", (e) => e.classList.contains("on"))
    );
    console.log(
      "bouton réessayer utilisable :",
      (await page.$eval("#emptyRetry", (e) => !!e.offsetParent)) ||
        "écran vide non affiché"
    );
    console.log(
      "erreurs :",
      errors.filter((e) => /PAGEERROR/.test(e))
    );
    await browser.close();
  },

  // 16. Beaucoup de sources (OPML de 120 flux) et beaucoup d'articles
  async manyfeeds() {
    const feeds = Array.from({ length: 120 }, (_, i) => ({
      name: "Source " + i,
      url: "https://s" + i + ".test/rss",
      on: true,
    }));
    const { browser, page, errors } = await boot({
      storage: { ...READY, "fluxswipe.feeds.v1": JSON.stringify(feeds) },
      rss: null,
    });
    let n = 0;
    await page.route(/allorigins|corsproxy|codetabs|thingproxy|api\/feed/, (r) => {
      const id = n++;
      r.fulfill({
        status: 200,
        contentType: "application/xml",
        body:
          '<?xml version="1.0"?><rss><channel>' +
          Array.from(
            { length: 30 },
            (_, i) =>
              `<item><title>S${id} art ${i}</title><link>https://s${id}.test/a${i}</link><description>Un resume de longueur normale pour cet article</description><pubDate>${new Date(Date.now() - i * 6e5).toUTCString()}</pubDate></item>`
          ).join("") +
          "</channel></rss>",
      });
    });
    const t0 = Date.now();
    await page.goto(URL_APP);
    await page.waitForTimeout(20000);
    const st = await page.evaluate(() => ({
      cartes: feedEl.querySelectorAll(".card").length,
      items: items.length,
      news: newsItems.length,
      wiki: learnItems.length,
      cacheKo: Math.round(
        (localStorage.getItem("fluxswipe.cache.v1") || "").length / 1024
      ),
      sync: document.getElementById("syncbar").classList.contains("on"),
    }));
    console.log("requêtes flux émises :", n, "| en", Date.now() - t0, "ms");
    console.log(st);
    // Défilement long : le fil doit rester borné
    for (let i = 0; i < 40; i++) {
      await page.evaluate(() => feedEl.scrollBy({ top: 2000 }));
      await page.waitForTimeout(120);
    }
    await page.waitForTimeout(2500);
    console.log(
      "après 40 défilements :",
      await page.evaluate(() => ({
        cartes: feedEl.querySelectorAll(".card").length,
        items: items.length,
        registre: cardReg.size,
        vus: seen.size,
      }))
    );
    console.log(
      "erreurs :",
      errors.filter((e) => /PAGEERROR/.test(e))
    );
    await browser.close();
  },

  /* 17. Les DEUX fenêtres de la règle produit :
       — rouvrir AVANT 30 min : aucun appel réseau, on reprend où on en était ;
       — rouvrir APRÈS 30 min : tout est rafraîchi et la première carte sous les
         yeux est l'article publié le plus récemment, la reprise est abandonnée.
     Les deux fonctions ont chacune leur fenêtre : elles ne se disputent plus le
     même rendu (voir `perime` / resumePending, index.html). */
  async resume() {
    const { browser, page, errors } = await boot({ storage: READY });
    let requetes = 0;
    await page.route(/allorigins|corsproxy|codetabs|thingproxy|api\/feed/, (r) => {
      requetes++;
      return r.fulfill({ status: 200, contentType: "application/xml", body: RSS_OK });
    });
    await page.goto(URL_APP);
    await page.waitForTimeout(2500);
    const lu = await page.evaluate(() => {
      feedEl.scrollTop = feedEl.children[6].offsetTop;
      onCardChange();
      persistAll();
      return { idx: currentIndex(), carte: (currentItem() || {}).title };
    });
    console.log(`quitté sur : ${lu.carte} (index ${lu.idx})`);

    // 1) réouverture DANS la fenêtre : le cache est servi tel quel
    const avant = requetes;
    await page.reload();
    await page.waitForTimeout(3000);
    const dans = await page.evaluate(() => ({
      idx: currentIndex(),
      carte: (currentItem() || {}).title,
    }));
    console.log(
      `avant 30 min → ${dans.carte} (index ${dans.idx}), ${requetes - avant} requête(s) réseau`,
      dans.carte === lu.carte && requetes === avant
        ? "→ REPRISE, sans réseau"
        : "→ inattendu"
    );

    // 2) réouverture AU-DELÀ : le fil est neuf, le plus récent NON LU en tête
    // On capture les actus déjà vues AVANT de recharger : après, la carte
    // qu'on nous propose est elle-même marquée vue dans la seconde, et le
    // contrôle se mordrait la queue.
    const vuesAvant = await page.evaluate(() => [...seenNews]);
    await page.evaluate(() => {
      const c = JSON.parse(localStorage.getItem("fluxswipe.cache.v1") || "{}");
      for (const k in c) c[k].t = Date.now() - 45 * 60 * 1000;
      localStorage.setItem("fluxswipe.cache.v1", JSON.stringify(c));
    });
    await page.reload();
    await page.waitForTimeout(3500);
    /* La règle de tête est « l'article le plus récent qu'on n'a pas DÉJÀ EU
       sous les yeux », et non le plus récent dans l'absolu : rouvrir l'app sur
       la carte qu'on vient de lire n'apprend rien (voir seenNews et le tri des
       files dans rebuild). Ici la session précédente a affiché la carte de
       lancement puis celle où l'on s'est arrêté — le plus récent absolu est
       donc déjà lu, et la bonne réponse est le suivant. */
    const apres = await page.evaluate((vuesAvant) => {
      const avant = new Set(vuesAvant);
      const frais = newsItems.filter((i) => !avant.has(newsKey(i)));
      const vivier = frais.length ? frais : newsItems;
      const cible = vivier.reduce(
        (a, b) => (Date.parse(a.date) >= Date.parse(b.date) ? a : b),
        vivier[0] || { date: "" }
      );
      return {
        idx: currentIndex(),
        carte: (currentItem() || {}).title,
        haut: Math.round(feedEl.scrollTop),
        attendu: cible && cible.title,
        plusRecentAbsolu: newsItems.length
          ? newsItems.reduce((a, b) => (Date.parse(a.date) >= Date.parse(b.date) ? a : b))
              .title
          : null,
      };
    }, vuesAvant);
    console.log(
      `après 30 min → ${apres.carte} (index ${apres.idx}, scrollTop ${apres.haut})`,
      apres.idx === 0 && apres.carte === apres.attendu
        ? `→ EN TÊTE, sur l'article le plus récent NON LU` +
            (apres.attendu === apres.plusRecentAbsolu
              ? ""
              : ` (${apres.plusRecentAbsolu} est plus récent mais déjà vu)`)
        : `→ inattendu (attendu : ${apres.attendu})`
    );
    console.log(
      "erreurs :",
      errors.filter((e) => /PAGEERROR/.test(e))
    );
    await browser.close();
  },

  // 18. Le saut en tête doit rester pour ↻ et pour un rafraîchissement en session
  async forcetop() {
    const { browser, page, errors } = await boot({ storage: READY });
    await page.goto(URL_APP);
    await page.waitForTimeout(3000);
    await page.evaluate(() => {
      feedEl.scrollTop = feedEl.children[6].offsetTop;
      onCardChange();
    });
    await page.waitForTimeout(200);
    console.log("position de lecture :", await page.evaluate(() => currentIndex()));
    // ↻ explicite
    await page.evaluate(() => document.getElementById("reloadBtn").click()); // la barre se masque au swipe : clic programmatique
    await page.waitForTimeout(3000);
    console.log(
      "après ↻ → en tête :",
      await page.evaluate(() => feedEl.scrollTop < 5),
      "idx =",
      await page.evaluate(() => currentIndex())
    );
    // rafraîchissement AUTOMATIQUE en cours de session (cache vieilli)
    await page.evaluate(() => {
      feedEl.scrollTop = feedEl.children[6].offsetTop;
      onCardChange();
    });
    await page.evaluate(() => {
      const c = JSON.parse(localStorage.getItem("fluxswipe.cache.v1"));
      for (const k in c) c[k].t = Date.now() - 45 * 60 * 1000;
      localStorage.setItem("fluxswipe.cache.v1", JSON.stringify(c));
      lastNewsLoad = Date.now() - 45 * 60 * 1000;
    });
    await page.evaluate(() => loadFeeds());
    await page.waitForTimeout(3000);
    console.log(
      "après rafraîchissement auto en session → en tête :",
      await page.evaluate(() => feedEl.scrollTop < 5),
      "idx =",
      await page.evaluate(() => currentIndex())
    );

    /* Et l'envers de la même règle : on remonte en tête UNE fois, pas deux.
       Les deux moitiés du fil se rendent chacune de leur côté ; quand elles ne
       répondent pas en même temps — ici Wikipédia délibérément plus lent que
       l'échéance des actus — chacune remontait en tête pour son compte. Vécu
       par l'utilisateur : le fil se rafraîchit, on remonte en tête, on glisse
       quelques cartes, puis le fil remonte tout seul une seconde fois sur la
       MÊME carte au moment où la barre de chargement s'éteint. */
    let numLot = 0;
    await page.route(/api\/learn|wikipedia\.org\/w\/api\.php/, async (r) => {
      const n = ++numLot;
      await new Promise((z) => setTimeout(z, 6000)); // > NEWS_DEADLINE_MS
      // Un lot RECONNAISSABLE : sans quoi on ne saurait pas si le rendu de
      // cette moitié a seulement eu lieu.
      return r.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          items: Array.from({ length: 20 }, (_, i) => ({
            source: "Wikipédia",
            title: `Wiki lot${n}-${i}`,
            desc: "x".repeat(200),
            link: `https://fr.wikipedia.org/wiki/L${n}_${i}`,
            img: "https://img.test/w.jpg",
          })),
        }),
      });
    });
    // La réserve d'avance court-circuiterait le réseau, donc le RETARD qu'on
    // veut simuler (voir learnSpare) : on la vide juste avant l'appui.
    await page.evaluate(() => {
      learnSpare = null;
      document.getElementById("reloadBtn").click();
    });
    // On attend l'échéance des actus (remontée n°1), puis on glisse.
    await page.waitForTimeout(3200);
    const apresEcheance = await page.evaluate(() => currentIndex());
    await page.evaluate(() => {
      feedEl.scrollTop = feedEl.children[5].offsetTop;
      onCardChange();
    });
    await page.waitForTimeout(200);
    const lu = await page.evaluate(() => (currentItem() || {}).title || "—");
    // Puis le lot Wikipédia arrive, bien après.
    await page.waitForTimeout(3500);
    const apresWiki = await page.evaluate(() => ({
      idx: currentIndex(),
      titre: (currentItem() || {}).title || "—",
      enTete: feedEl.scrollTop < 5,
      lotRendu: items.some((i) => /^Wiki lot/.test(i.title || "")),
    }));
    console.log(
      `Wikipédia en retard → remontée n°1 idx=${apresEcheance}, lu « ${lu} »,` +
        ` après le lot : idx=${apresWiki.idx} « ${apresWiki.titre} »` +
        (!apresWiki.lotRendu
          ? "  ← le lot tardif n'a pas été rendu, le scénario ne prouve RIEN"
          : apresWiki.enTete
            ? "  ← REMONTÉE une 2e fois (régression)"
            : "  → position conservée ✓")
    );
    console.log(
      "erreurs :",
      errors.filter((e) => /PAGEERROR/.test(e))
    );
    await browser.close();
  },

  /* 19. Le rafraîchissement des 30 minutes se déclenche-t-il tout seul ?
     Horloge SIMULÉE : Date.now(), setInterval et setTimeout suivent le temps
     qu'on avance à la main, donc le filet périodique et le seuil de fraîcheur
     jouent leur vraie partition, sans attendre une demi-heure. */
  async autorefresh() {
    const lot = (prefixe, n, ageMin) =>
      '<?xml version="1.0"?><rss><channel>' +
      Array.from(
        { length: n },
        (_, i) =>
          `<item><title>${prefixe} ${i}</title><link>https://ex.test/${prefixe}${i}</link>` +
          `<description>Un resume de longueur ordinaire</description>` +
          `<pubDate>${new Date(Date.now() - (ageMin + i) * 60000).toUTCString()}</pubDate></item>`
      ).join("") +
      "</channel></rss>";

    const browser = await chromium.launch({
      executablePath: "/opt/pw-browsers/chromium",
    });
    const page = await (
      await browser.newContext({ viewport: { width: 412, height: 900 } })
    ).newPage();
    await page.clock.install(); // AVANT tout chargement
    let rss = lot("Vieux", 10, 120);
    let requetes = 0;
    await page.addInitScript((kv) => {
      for (const [k, v] of Object.entries(kv)) localStorage.setItem(k, v);
    }, READY);
    await page.route("**/*", (r) => {
      const u = r.request().url();
      if (/wikipedia|api\/learn/.test(u))
        return r.fulfill({ status: 200, contentType: "application/json", body: WIKI_OK });
      if (/allorigins|corsproxy|codetabs|thingproxy|api\/feed/.test(u)) {
        requetes++;
        return r.fulfill({ status: 200, contentType: "application/xml", body: rss });
      }
      if (u.startsWith("http://localhost:8124")) return r.continue();
      return r.fulfill({ status: 200, body: "" });
    });
    const etat = async () =>
      page.evaluate(() => (newsItems.slice(0, 3).map((i) => i.title) || []).join(", "));

    await page.goto(URL_APP);
    await page.clock.runFor(3000);
    await page.waitForTimeout(1500);
    console.log(`t+0      ${requetes} requêtes  ${await etat()}`);
    rss = lot("Frais", 6, 0); // les sources publient du neuf
    await page.clock.runFor(25 * 60 * 1000);
    await page.waitForTimeout(1500);
    console.log(`t+25min  ${requetes} requêtes  ${await etat()}   ← doit être INCHANGÉ`);
    await page.clock.runFor(6 * 60 * 1000);
    await page.waitForTimeout(2500);
    console.log(
      `t+31min  ${requetes} requêtes  ${await etat()}   ← doit s'être RAFRAÎCHI`
    );
    await browser.close();
  },

  /* 20. Chargement plus long que le filet périodique (réseau lent) : les tours
     suivants doivent RESPECTER le chargement en cours, pas tout relancer — et la
     garde doit se relever une fois les délais d'expiration écoulés, sinon plus
     aucun rafraîchissement ne serait possible de la session. */
  async relance() {
    const { browser, page } = await boot({ storage: READY });
    let requetes = 0;
    let lent = false;
    const gele = [];
    // Le chargement initial se passe NORMALEMENT ; c'est ensuite que le réseau
    // devient trop lent pour répondre avant le tour suivant du filet.
    await page.route(/allorigins|corsproxy|codetabs|thingproxy|api\/feed/, (r) => {
      requetes++;
      if (lent) {
        gele.push(r);
        return;
      }
      return r.fulfill({ status: 200, contentType: "application/xml", body: RSS_OK });
    });
    await page.goto(URL_APP);
    await page.waitForTimeout(2500);
    console.log(`chargement initial : ${requetes} requêtes`);
    lent = true;
    const vieillir = () =>
      page.evaluate(() => {
        const c = JSON.parse(localStorage.getItem("fluxswipe.cache.v1") || "{}");
        for (const k in c) c[k].t = Date.now() - 45 * 60 * 1000;
        localStorage.setItem("fluxswipe.cache.v1", JSON.stringify(c));
        lastNewsLoad = Date.now() - 45 * 60 * 1000;
      });
    await vieillir();
    const tours = [];
    for (let i = 0; i < 3; i++) {
      const avant = requetes;
      await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
      await page.waitForTimeout(800);
      tours.push(requetes - avant);
    }
    console.log(
      `requêtes par tour du filet : ${tours.join(", ")}`,
      tours[1] + tours[2] === 0
        ? "→ le chargement en cours est respecté"
        : "→ CHAQUE tour relance tout"
    );
    // La garde doit se relever une fois les délais d'expiration écoulés, sinon
    // plus aucun rafraîchissement ne serait possible de toute la session.
    const avant = requetes;
    await page.waitForTimeout(30000);
    console.log(
      "encore en vol après 30 s :",
      await page.evaluate(() => newsLoadingSeq === loadSeq)
    );
    await vieillir();
    await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
    await page.waitForTimeout(1000);
    console.log(
      requetes - avant > 0
        ? "→ la garde s'est relevée, un nouveau tour repart"
        : "→ BLOQUÉ : plus aucun rafraîchissement possible"
    );
    await browser.close();
  },

  /* 21. Le fil est-il VRAIMENT infini ? La moitié Wikipédia doit se
     réapprovisionner d'elle-même en descendant, sans fin et sans redite.
     Temps réel : le défilement passe par requestAnimationFrame, qu'une horloge
     simulée fausserait. */
  async infini() {
    let wiki = 0,
      lot = 0;
    const WIKI = () =>
      JSON.stringify({
        query: {
          pages: Array.from({ length: 20 }, (_, i) => ({
            title: `Wiki L${lot}-${i}`, // des articles NEUFS à chaque lot
            extract: "x".repeat(200),
            canonicalurl: `https://fr.wikipedia.org/wiki/W${lot}_${i}`,
            thumbnail: { source: "https://img.test/w.jpg" },
          })),
        },
      });
    const { browser, page, errors } = await boot({ storage: READY });
    await page.route(/wikipedia\.org\/w\/api\.php|\/api\/learn/, (r) => {
      wiki++;
      lot++;
      return r.fulfill({ status: 200, contentType: "application/json", body: WIKI() });
    });
    await page.goto(URL_APP);
    await page.waitForTimeout(2500);
    const etat = async (l) =>
      console.log(
        l.padEnd(20),
        JSON.stringify(
          await page.evaluate(() => ({
            reserve: learnItems.length,
            cartes: feedEl.querySelectorAll(".card").length,
            vus: seen.size,
            toursVides: learnMoreVide,
            doublons: items.length - new Set(items.map((i) => i.title)).size,
          }))
        )
      );
    await etat("au lancement");
    for (let i = 0; i < 60; i++) {
      await page.evaluate(() => feedEl.scrollBy({ top: feedEl.clientHeight }));
      await page.waitForTimeout(180);
      if (i === 39) await etat("après 40 écrans");
    }
    await page.waitForTimeout(1500);
    await etat("après 60 écrans");
    console.log("lots Wikipédia demandés :", wiki);
    console.log(
      "erreurs :",
      errors.filter((e) => /PAGEERROR/.test(e))
    );
    await browser.close();
  },

  /* 22. Même règle, vue depuis une carte Wikipédia : on quitte l'app dessus, le
     cache vieillit au-delà de 30 min, on rouvre. La moitié Wikipédia est
     renouvelée (voir `perime`) et le fil repart en tête — la reprise ne vaut que
     dans la fenêtre de fraîcheur. */
  async reprisewiki() {
    let lot = 0;
    const WIKI = () =>
      JSON.stringify({
        query: {
          pages: Array.from({ length: 20 }, (_, i) => ({
            title: `Wiki L${lot}-${i}`,
            extract: "x".repeat(200),
            canonicalurl: `https://fr.wikipedia.org/wiki/W${lot}_${i}`,
            thumbnail: { source: "https://img.test/w.jpg" },
          })),
        },
      });
    const { browser, page } = await boot({ storage: READY });
    await page.route(/wikipedia\.org\/w\/api\.php|\/api\/learn/, (r) => {
      lot++;
      return r.fulfill({ status: 200, contentType: "application/json", body: WIKI() });
    });
    await page.goto(URL_APP);
    await page.waitForTimeout(2500);
    const quitte = await page.evaluate(() => {
      const i = items.findIndex((it, n) => n > 2 && it.kind === "learn");
      feedEl.scrollTop = feedEl.children[i].offsetTop;
      onCardChange();
      persistAll();
      return { i, lien: items[i].link, titre: items[i].title };
    });
    console.log("quitté sur la carte Wikipédia :", quitte.titre, `(index ${quitte.i})`);
    await page.evaluate(() => {
      const c = JSON.parse(localStorage.getItem("fluxswipe.cache.v1") || "{}");
      for (const k in c) c[k].t = Date.now() - 45 * 60 * 1000;
      localStorage.setItem("fluxswipe.cache.v1", JSON.stringify(c));
    });
    await page.reload();
    await page.waitForTimeout(3000);
    const s = await page.evaluate(() => ({
      idx: currentIndex(),
      haut: Math.round(feedEl.scrollTop),
      surLaCarte: (currentItem() || {}).title,
    }));
    console.log(
      `retrouvé sur : ${s.surLaCarte} (index ${s.idx}, scrollTop ${s.haut})`,
      s.idx === 0
        ? "→ EN TÊTE, comme attendu au-delà du seuil"
        : "→ inattendu : pas en tête"
    );
    await browser.close();
  },

  // 23. Articles en mémoire : retrouver une carte dépassée d'un swipe de trop
  async memoire() {
    const { browser, page, errors } = await boot({ storage: READY });
    await page.goto(URL_APP);
    await page.waitForTimeout(2500);
    // La barre du haut se masque à chaque défilement (hideTop) : comme
    // l'utilisateur, on la ramène d'un tap AVANT de viser son bouton — et
    // toujours après que le défilement en cours a fini de la faire fuir.
    const ouvrirMemoire = async () => {
      await page.waitForTimeout(400);
      await page.evaluate(() => showTop());
      await page.waitForTimeout(250);
      await page.click("#histBtn");
      await page.waitForTimeout(350);
    };
    // On swipe loin
    await page.evaluate(() => {
      feedEl.scrollTop = feedEl.children[8].offsetTop;
      onCardChange();
    });
    const depasse = await page.evaluate(() => items[3].title);
    await ouvrirMemoire();
    const vue = await page.evaluate(() => {
      const p = document.querySelector("#histSheet .sheet__panel");
      const now = document.querySelector(".histrow--now");
      const r = now.getBoundingClientRect(),
        pr = p.getBoundingClientRect();
      return {
        rangees: document.querySelectorAll(".histrow").length,
        articles: items.length,
        surLaCarte: now.querySelector(".histrow__ttl").textContent.trim(),
        memeQueLeFil:
          now.querySelector(".histrow__ttl").textContent.trim() === currentItem().title,
        passees: document.querySelectorAll(".histrow--past").length,
        idx: currentIndex(),
        // La liste doit s'ouvrir SUR la position courante, pas en haut
        couranteVisible: r.top >= pr.top - 2 && r.bottom <= pr.bottom + 2,
      };
    });
    console.log(
      `${vue.rangees} rangées pour ${vue.articles} articles | repère « ici » sur ${vue.surLaCarte}`,
      `(carte du fil : ${vue.memeQueLeFil}) | ${vue.passees} dépassées pour un index de ${vue.idx}`
    );
    console.log("liste ouverte sur la position courante :", vue.couranteVisible);
    // Retour sur un article déjà dépassé
    await page.$$eval(".histrow", (rows) => rows[3].click());
    await page.waitForTimeout(700);
    const apres = await page.evaluate(() => ({
      idx: currentIndex(),
      titre: (currentItem() || {}).title,
      fermee: !document.getElementById("histSheet").classList.contains("open"),
      inert: !!feedEl.inert,
    }));
    console.log(
      `retour sur : ${apres.titre} (index ${apres.idx}) — visé : ${depasse}`,
      apres.titre === depasse ? "→ OK" : "→ inattendu"
    );
    console.log(
      "feuille refermée :",
      apres.fermee,
      "| fond rendu au fil :",
      !apres.inert
    );
    // Retour arrière système : la feuille se ferme sans quitter l'app
    const url = page.url();
    await ouvrirMemoire();
    await page.goBack();
    await page.waitForTimeout(400);
    console.log(
      "retour arrière → feuille fermée :",
      !(await page.$eval("#histSheet", (e) => e.classList.contains("open"))),
      "| même page :",
      page.url() === url,
      "| toujours sur l'index",
      await page.evaluate(() => currentIndex())
    );
    // Article jeté du fil entre l'ouverture de la feuille et le toucher
    await ouvrirMemoire();
    await page.evaluate(() => {
      items = items.slice(10);
      render(true);
    });
    await page.$$eval(".histrow", (rows) => rows[0].click());
    await page.waitForTimeout(400);
    console.log(
      "article disparu → prévenu :",
      await page.$eval("#toast", (e) => e.classList.contains("show") && e.textContent)
    );
    // Fil vide : aucune rangée, un message, aucune erreur
    await page.evaluate(() => {
      items = [];
      render(true);
    });
    await ouvrirMemoire();
    console.log(
      "fil vide →",
      await page.$eval(".histempty", (e) => e.textContent),
      "|",
      await page.$$eval(".histrow", (e) => e.length),
      "rangée(s)"
    );
    console.log("erreurs :", errors);
    await browser.close();
  },

  // 24. ↻ : la moitié Wikipédia doit VRAIMENT changer
  //
  // Le faux /api/learn imite les deux caches du chemin réel : une URL à
  // « seau » (b=…) rend toujours le MÊME lot pour ce seau (CDN s-maxage, et
  // surtout la copie disque du navigateur, que la réponse laisse resservir une
  // heure durant) ; une URL à nonce (n=…) rend un tirage neuf. Un ↻ qui repart
  // sur un seau se voit donc resservir ce qu'on vient de lire — c'était le
  // symptôme : les actus se renouvelaient, la moitié Wikipédia non.
  async forcewiki() {
    const lots = new Map(); // seau → lot figé, comme le ferait un cache
    let neufs = 0;
    const url = (u) => new URL(u, "http://x/");
    const lot = (n) =>
      JSON.stringify({
        items: Array.from({ length: 20 }, (_, i) => ({
          source: "Wikipédia",
          title: `Wiki L${n}-${i}`,
          desc: "x".repeat(200),
          link: `https://fr.wikipedia.org/wiki/W${n}_${i}`,
          img: "https://img.test/w.jpg",
        })),
      });
    const { browser, page, errors } = await boot({ storage: READY });
    const vus = [];
    await page.route(/\/api\/learn/, (r) => {
      const q = url(r.request().url()).searchParams;
      vus.push(q.get("n") ? "nonce" : "seau " + q.get("b"));
      let corps;
      if (q.get("n")) corps = lot("N" + ++neufs);
      else {
        const b = q.get("b");
        if (!lots.has(b)) lots.set(b, lot("B" + b));
        corps = lots.get(b);
      }
      return r.fulfill({ status: 200, contentType: "application/json", body: corps });
    });
    await page.goto(URL_APP);
    await page.waitForTimeout(2500);
    const wikis = () =>
      page.evaluate(() =>
        items
          .filter((i) => i.kind === "learn")
          .slice(0, 4)
          .map((i) => i.title)
      );
    // On compare à TOUS les lots déjà servis, pas seulement au précédent : le
    // symptôme n'est pas « deux ↻ de suite identiques » mais « ↻ repioche dans
    // les quelques lots du vivier », donc rend au bout de trois appuis un lot
    // déjà lu.
    const dejaVus = [];
    const rendreCompte = async (quoi) => {
      const l = await wikis();
      const cle = l.join("|");
      const redite = dejaVus.includes(cle);
      dejaVus.push(cle);
      console.log(
        `${quoi} :`,
        l.join(", "),
        redite ? "→ DÉJÀ SERVI (régression)" : "→ neuf"
      );
    };
    await rendreCompte("au lancement");
    for (let k = 1; k <= 5; k++) {
      await page.click("#reloadBtn");
      await page.waitForTimeout(2500);
      await rendreCompte(`↻ n°${k}`);
    }
    console.log("appels /api/learn :", vus.join(", "));
    console.log("erreurs :", errors);
    await browser.close();
  },

  // 25. La TÊTE du fil doit se renouveler aussi. `forcewiki` (ci-dessus) ne
  // regardait que le contenu du lot : il ne pouvait pas voir que les deux
  // premières cartes, elles, ne bougeaient jamais. Le rendu de la moitié
  // Wikipédia gelait la tête (la carte affichée et son aperçu) à CHAQUE fois,
  // y compris sur un renouvellement — les deux premiers articles de l'ancien
  // fil étaient donc reportés en tête du neuf, ↻ après ↻.
  // Dose « Wikipédia seul » exprès : c'est là que rien ne rattrapait le défaut,
  // les actus (dont la repeinture finale, elle, ne gèle pas) n'étant jamais
  // chargées.
  async tetewiki() {
    let n = 0;
    const lot = () => {
      const k = ++n;
      return JSON.stringify({
        items: Array.from({ length: 20 }, (_, i) => ({
          source: "Wikipédia",
          title: `Wiki L${k}-${i}`,
          desc: "x".repeat(200),
          link: `https://fr.wikipedia.org/wiki/W${k}_${i}`,
          img: "https://img.test/w.jpg",
        })),
      });
    };
    const { browser, page, errors } = await boot({
      storage: { ...READY, "fluxswipe.mix.v1": "5" }, // 5 = Wikipédia seul
    });
    await page.route(/wikipedia\.org|\/api\/learn/, (r) =>
      r.fulfill({ status: 200, contentType: "application/json", body: lot() })
    );
    await page.goto(URL_APP);
    await page.waitForTimeout(2500);
    const tetes = () => page.evaluate(() => items.slice(0, 3).map((i) => i.title));
    let avant = await tetes();
    console.log("au lancement :", avant.join(" | "));
    for (let k = 1; k <= 3; k++) {
      await page.click("#reloadBtn");
      await page.waitForTimeout(2500);
      const apres = await tetes();
      const revenues = apres.filter((t) => avant.includes(t));
      console.log(
        `↻ n°${k} :`,
        apres.join(" | "),
        revenues.length
          ? `→ ${revenues.length} carte(s) REVENUE(S) : ${revenues.join(", ")} (régression)`
          : "→ tête neuve"
      );
      avant = apres;
    }
    console.log("erreurs :", errors);
    await browser.close();
  },

  // 26. Le lot Wikipédia d'AVANCE. Un ↻ ne peut pas être rapide en allant
  // chercher son lot au moment de l'appui : il court-circuite les deux caches
  // HTTP par construction, donc il paie le chemin complet à chaque fois. La
  // réserve le rend instantané sans rien céder — le lot est réclamé d'avance,
  // avec le même nonce, simplement plus tôt.
  // Ce qu'on vérifie, et qui ne se lit pas dans le code : que le 2e ↻ ne
  // produise AUCUNE requête au moment de l'appui, et que le contenu soit tout
  // de même neuf à chaque tour (une réserve servie deux fois, ou servie après
  // un changement de fil, se verrait ici).
  async avancewiki() {
    let n = 0;
    const lot = () => {
      const k = ++n;
      return JSON.stringify({
        items: Array.from({ length: 20 }, (_, i) => ({
          source: "Wikipédia",
          title: `Wiki L${k}-${i}`,
          desc: "x".repeat(200),
          link: `https://fr.wikipedia.org/wiki/W${k}_${i}`,
          img: "https://img.test/w.jpg",
        })),
      });
    };
    const LAT = 900; // latence simulée : sans elle, « instantané » ne veut rien dire
    const { browser, page, errors } = await boot({
      storage: { ...READY, "fluxswipe.mix.v1": "5" }, // 5 = Wikipédia seul
    });
    let appels = [];
    await page.route(/wikipedia\.org\/w\/api\.php|\/api\/learn/, async (r) => {
      appels.push(Date.now());
      await new Promise((z) => setTimeout(z, LAT));
      r.fulfill({ status: 200, contentType: "application/json", body: lot() });
    });
    await page.goto(URL_APP);
    await page.waitForTimeout(2500 + LAT);
    const tete = () => page.evaluate(() => (items[0] || {}).title || "—");
    let avant = await tete();
    for (let k = 1; k <= 3; k++) {
      // On laisse le temps à la réserve de se constituer (LEARN_SPARE_DELAY_MS
      // + la latence), comme le ferait quelqu'un qui lit entre deux appuis.
      await page.waitForTimeout(2500 + LAT + 600);
      appels = [];
      const t0 = Date.now();
      await page.click("#reloadBtn");
      let vu = -1;
      for (let i = 0; i < 100; i++) {
        await page.waitForTimeout(40);
        if ((await tete()) !== avant) {
          vu = Date.now() - t0;
          break;
        }
      }
      // Requêtes parties dans les 300 ms suivant l'appui : c'est ce que la
      // réserve doit éviter. Celle qui la RECHARGE part bien plus tard.
      const pendant = appels.filter((t) => t - t0 < 300).length;
      const apres = await tete();
      console.log(
        `↻ n°${k} : tête ${apres} après ${vu < 0 ? "JAMAIS" : vu + " ms"}` +
          `  — requêtes à l'appui : ${pendant}` +
          (k === 1
            ? "  (le 1er arme la réserve, il paie le réseau : normal)"
            : pendant === 0
              ? "  → servi par la réserve ✓"
              : "  → RÉSEAU au lieu de la réserve (régression)") +
          (apres === avant ? "  ← tête INCHANGÉE (régression)" : "")
      );
      avant = apres;
    }

    /* La réserve est constituée AVANT que l'utilisateur ne lise, et servie
       plusieurs minutes plus tard : entre les deux, il a rendu « déjà vus » des
       articles qu'elle contient. `fetchLearn` ne peut pas le prévoir (son
       dropSeen est appliqué à la constitution), et le filet « tout est déjà
       vu » de loadLearnPart ne se déclenche que si le lot est INTÉGRALEMENT vu
       — jamais dans le cas ordinaire, qui est partiel. Mesuré avant correctif :
       5 cartes déjà lues sur 20 resservies au ↻ suivant.
       On reproduit exactement ça : on marque comme vus quelques articles que la
       réserve contient, puis on appuie. */
    await page.waitForTimeout(2500 + LAT + 600);
    const marques = await page.evaluate(() => {
      if (!learnSpare) return null;
      const lus = learnSpare.items.slice(0, 5);
      lus.forEach(addSeen);
      return { titres: lus.map((i) => i.title), taille: learnSpare.items.length };
    });
    if (!marques) console.log("réserve absente : impossible de tester le refiltrage");
    else {
      await page.click("#reloadBtn");
      await page.waitForTimeout(1200);
      const revenus = await page.evaluate(
        (t) => items.filter((i) => t.includes(i.title)).map((i) => i.title),
        marques.titres
      );
      console.log(
        `réserve de ${marques.taille} articles dont 5 lus entre-temps →` +
          ` ${revenus.length} resservi(s)` +
          (revenus.length
            ? `  ← DÉJÀ VUS reservis (${revenus.slice(0, 3).join(", ")})`
            : "  → refiltrée à l'usage ✓")
      );
    }

    // Le garde-fou qui coûterait le plus cher s'il lâchait : une réserve
    // constituée pour un fil ne doit JAMAIS être servie à un autre (langue,
    // source ou centre d'intérêt changés entre-temps), et une réserve
    // inspectée doit être consommée dans tous les cas — sinon elle reviendrait
    // servir le même lot deux fois.
    await page.waitForTimeout(2500 + LAT + 600);
    const garde = await page.evaluate(() => {
      const avait = !!learnSpare;
      const mauvais = takeLearnSpare("un|autre|fil");
      return { avait, servi: !!mauvais, videeQuandMeme: !learnSpare };
    });
    console.log(
      `réserve présente : ${garde.avait} | servie à un AUTRE fil : ${garde.servi}` +
        ` (doit être false) | vidée quand même : ${garde.videeQuandMeme} (doit être true)`
    );
    console.log("erreurs :", errors);
    await browser.close();
  },

  /* 30. REDITES : un rafraîchissement doit apporter du neuf, pas reposer les
     mêmes cartes. Le pendant indispensable du tour de rôle (voir `equite`) :
     celui-ci a rendu les sources lentes visibles, mais à l'intérieur d'une
     file l'ordre restait la date — donc l'article le plus récent d'une source
     horaire tenait la tête de sa file pendant une heure et revenait à CHAQUE
     ↻, à la même place. Mesuré avant correctif : un seul article distinct
     d'une source lente sur quatre lectures.
     On parcourt vraiment les cartes (c'est l'affichage qui marque « vu »,
     comme pour Wikipédia), puis on compte ce qui revient. */
  async redites() {
    const N = 15;
    const feeds = Array.from({ length: N }, (_, i) => ({
      url: `https://src${i}.test/rss`,
      name: i === 0 ? "Lente" : "Bavarde " + i,
      on: true,
    }));
    // La lente ne publie RIEN entre les rafraîchissements : c'est le cas dur.
    // Les bavardes, elles, publient cinq articles de plus à chaque tour.
    let tour = 0;
    const rss = (i) => {
      const pas = i === 0 ? 60 : 6;
      const neufs = i === 0 ? 0 : tour * 5;
      const nom = i === 0 ? "L" : "B" + i;
      return `<?xml version="1.0"?><rss version="2.0"><channel><title>S${i}</title>${Array.from(
        { length: 15 },
        (_, k) =>
          `<item><title>${nom} art ${neufs + k}</title>` +
          `<link>https://src${i}.test/n/${neufs + k}</link>` +
          `<description>${"texte ".repeat(20)}</description><pubDate>` +
          `${new Date(Date.now() - (k * pas + (i === 0 ? 37 : i)) * 60e3).toUTCString()}` +
          `</pubDate></item>`
      ).join("")}</channel></rss>`;
    };
    const { browser, page, errors } = await boot({
      storage: { ...READY, "fluxswipe.feeds.v1": JSON.stringify(feeds) },
    });
    await page.route(/src\d+\.test/, (r) => {
      const u = r.request().url();
      if (/\/api\/og/.test(u)) return r.fallback();
      const m = u.match(/src(\d+)\.test/);
      return r
        .fulfill({ status: 200, contentType: "application/xml", body: rss(+m[1]) })
        .catch(() => {});
    });
    await page.goto(URL_APP);
    await page.waitForTimeout(5000);
    // Parcourt réellement les 20 premières cartes, comme un doigt : chacune
    // devient la carte courante, donc chacune est marquée « vue ».
    const parcourir = () =>
      page.evaluate(() => {
        const vus = [];
        for (let i = 0; i < 20 && i < feedEl.children.length; i++) {
          feedEl.scrollTop = feedEl.children[i].offsetTop;
          onCardChange();
          if (items[i]) vus.push(items[i].title);
        }
        return vus;
      });
    const lus = new Set(await parcourir());
    const lente = new Set([...lus].filter((x) => /^L art /.test(x)));
    for (let t = 1; t <= 3; t++) {
      tour = t;
      await page.evaluate(() => document.getElementById("reloadBtn").click());
      await page.waitForTimeout(5000);
      const apres = await page.evaluate(() => items.slice(0, 20).map((i) => i.title));
      const actus = apres.filter((x) => !/^Wiki /.test(x));
      const red = actus.filter((x) => lus.has(x));
      console.log(
        `↻ n°${t} : ${red.length}/${actus.length} actus déjà lues` +
          (red.length
            ? `  ← REDITE (${red.slice(0, 2).join(", ")})`
            : "  → que du neuf ✓")
      );
      apres.filter((x) => /^L art /.test(x)).forEach((x) => lente.add(x));
      (await parcourir()).forEach((x) => lus.add(x));
    }
    console.log(
      `articles DISTINCTS de la source lente vus en 4 lectures : ${lente.size}` +
        (lente.size >= 3
          ? "  → elle puise dans son fond ✓"
          : "  ← TOUJOURS LE MÊME (régression)")
    );
    console.log("erreurs :", errors);
    await browser.close();
  },

  /* 29. ÉQUITÉ ENTRE SOURCES : une source lente ne doit pas être enterrée.
     Le fil était trié par date décroissante, et un tri par date enterre les
     sources lentes : une source à 1 article/h a ses dix plus récents étalés sur
     dix heures, une à 10 articles/h les a sur une heure. Classés ensemble par
     fraîcheur, les bavardes occupent tout le haut. Mesuré ici avec 15 sources
     dont une lente : elle obtenait UNE carte sur 120.
     On vérifie les deux moitiés de la règle : la lente revient régulièrement,
     ET la carte 1 reste l'actu la plus récente (c'est cette règle-là que
     forceTop et la reprise de lecture supposent). */
  async equite() {
    const LENTE = "Lente";
    const N = 15; // 1 lente (1 art./h) + 14 bavardes (1 art./6 min)
    const feeds = Array.from({ length: N }, (_, i) => ({
      url: `https://src${i}.test/rss`,
      name: i === 0 ? LENTE : "Bavarde " + i,
      on: true,
    }));
    // La lente n'est délibérément PAS la plus fraîche (37 min de retard) :
    // sinon elle tiendrait la tête du fil par hasard et le test ne prouverait
    // rien sur l'invariant « le plus récent d'abord ».
    const rss = (i) => {
      const pas = i === 0 ? 60 : 6;
      const nom = i === 0 ? "L" : "B" + i;
      return `<?xml version="1.0"?><rss version="2.0"><channel><title>S${i}</title>${Array.from(
        { length: 15 },
        (_, k) =>
          `<item><title>${nom} article ${k}</title><link>https://src${i}.test/n/${k}</link>` +
          `<description>${"texte ".repeat(20)}</description><pubDate>` +
          `${new Date(Date.now() - (k * pas + (i === 0 ? 37 : i)) * 60e3).toUTCString()}` +
          `</pubDate></item>`
      ).join("")}</channel></rss>`;
    };
    const { browser, page, errors } = await boot({
      storage: { ...READY, "fluxswipe.feeds.v1": JSON.stringify(feeds) },
    });
    await page.route(/src\d+\.test/, (r) => {
      const u = r.request().url();
      // /api/og?url=https://src0.test/… porte le nom d'une source dans SON
      // paramètre : c'est une sonde de métadonnées, pas un flux. On la rend au
      // gestionnaire général, qui sait y répondre.
      if (/\/api\/og/.test(u)) return r.fallback();
      const m = u.match(/src(\d+)\.test/);
      return r
        .fulfill({ status: 200, contentType: "application/xml", body: rss(+m[1]) })
        .catch(() => {});
    });
    await page.goto(URL_APP);
    await page.waitForTimeout(3500);
    const r = await page.evaluate((LENTE) => {
      const src = items.map((i) => i.source);
      const pos = [];
      src.forEach((s, i) => {
        if (s === LENTE) pos.push(i);
      });
      const dates = items
        .filter((i) => i.kind !== "learn")
        .map((i) => Date.parse(i.date) || 0);
      return {
        total: items.length,
        cartes: pos.length,
        premieres: pos.slice(0, 5),
        tete: (items[0] || {}).title,
        teteRecente: dates.length ? Math.max(...dates) === dates[0] : true,
        distinctes: new Set(src.slice(0, 30)).size,
      };
    }, LENTE);
    console.log(
      `fil : ${r.total} cartes | sources distinctes dans les 30 premières : ${r.distinctes}`
    );
    console.log(
      `« ${LENTE} » : ${r.cartes} cartes` +
        (r.cartes >= 5 ? "  → plus enterrée ✓" : "  ← ENTERRÉE (régression)") +
        ` | positions : ${r.premieres.join(", ")}`
    );
    console.log(
      `carte 1 : « ${r.tete} » — l'actu la plus récente est-elle en tête ? ` +
        (r.teteRecente ? "oui ✓" : "NON (régression)")
    );
    console.log("erreurs :", errors);
    await browser.close();
  },

  /* 28. OUVERTURE de l'app au-delà des 30 min, en glissant pendant que ça
     charge. Le pendant de `forcetop` (qui, lui, part d'une session déjà en
     cours) : ici le cache périmé est peint tout de suite, les DEUX moitiés
     repartent, et l'utilisateur glisse dès la première carte affichée.
     Une seule remontée en tête est due — celle de la repeinture qui renouvelle
     vraiment le fil. On en comptait deux : la moitié Wikipédia, plus rapide
     (une requête contre quarante), prenait la tête sur un fil dont les actus
     étaient encore celles du cache ; la repeinture des actus, dépossédée,
     tentait ensuite de garder l'ancre — un article du cache qu'elle venait de
     retirer —, ne le trouvait pas, et retombait sur un saut sec en haut. */
  async teteouverture() {
    const N = 40;
    const feeds = Array.from({ length: N }, (_, i) => ({
      url: `https://src${i}.test/rss`,
      name: "S" + i,
      on: true,
    }));
    const latence = (i) => (i >= 38 ? null : i >= 35 ? 5000 : i >= 25 ? 1200 : 250);
    const rss = (i) =>
      `<?xml version="1.0"?><rss version="2.0"><channel><title>S${i}</title>${Array.from(
        { length: 12 },
        (_, k) =>
          `<item><title>NEUF s${i} a${k}</title><link>https://src${i}.test/n/${k}</link>` +
          `<description>${"texte ".repeat(20)}</description>` +
          `<pubDate>${new Date(Date.now() - (i * 12 + k) * 60e3).toUTCString()}</pubDate></item>`
      ).join("")}</channel></rss>`;
    let nl = 0;
    const lot = () => {
      const n = ++nl;
      return JSON.stringify({
        items: Array.from({ length: 20 }, (_, i) => ({
          source: "Wikipédia",
          title: `Wiki L${n}-${i}`,
          desc: "x".repeat(200),
          link: `https://fr.wikipedia.org/wiki/L${n}_${i}`,
          img: "https://img.test/w.jpg",
        })),
      });
    };
    const KEY = "mix|fr|all|all:sciences,histoire|s";
    const vieux = Array.from({ length: 40 }, (_, i) => ({
      kind: "news",
      source: "S" + i,
      title: "VIEUX s" + i,
      desc: "ancien",
      link: `https://src${i}.test/v/${i}`,
      img: "",
      date: new Date(Date.now() - 40 * 60e3).toUTCString(),
    }));
    const { browser, page, errors } = await boot({
      storage: {
        ...READY,
        "fluxswipe.feeds.v1": JSON.stringify(feeds),
        "fluxswipe.cache.v1": JSON.stringify({
          [KEY]: { t: Date.now() - 35 * 60e3, items: vieux },
        }),
      },
    });
    await page.route(/src\d+\.test|rss2json|api\/learn|wikipedia\.org/, async (r) => {
      const u = r.request().url();
      if (/\/api\/og/.test(u)) return r.fallback();
      const m = u.match(/src(\d+)\.test/);
      if (m) {
        const l = latence(+m[1]);
        if (l === null) return; // morte : jamais de réponse
        await new Promise((z) => setTimeout(z, l));
        return r
          .fulfill({ status: 200, contentType: "application/xml", body: rss(+m[1]) })
          .catch(() => {});
      }
      if (/rss2json/.test(u)) {
        await new Promise((z) => setTimeout(z, 7000));
        return r.fulfill({ status: 502, body: "{}" }).catch(() => {});
      }
      // Wikipédia répond AVANT l'échéance des actus : c'est tout l'enjeu.
      await new Promise((z) => setTimeout(z, 1500));
      return r
        .fulfill({ status: 200, contentType: "application/json", body: lot() })
        .catch(() => {});
    });
    // Journal des rendus : on veut savoir non seulement COMBIEN de remontées,
    // mais laquelle les a provoquées.
    await page.addInitScript(() => {
      window.__J = [];
      const t0 = Date.now();
      addEventListener("DOMContentLoaded", () => {
        const r = window.render;
        window.render = function (top) {
          const anc = anchorLink();
          const av = feedEl.scrollTop;
          const out = r.apply(this, arguments);
          window.__J.push(
            `${Date.now() - t0}ms render(top=${!!top}) ancre=${(anc || "—").slice(-12)}` +
              ` i=${anc ? items.findIndex((x) => x.link === anc) : "n/a"}` +
              ` scroll ${Math.round(av)}→${Math.round(feedEl.scrollTop)}`
          );
          return out;
        };
      });
    });
    await page.goto(URL_APP);
    // L'utilisateur glisse d'une carte dès qu'il se retrouve en haut.
    const remontees = [];
    let precedent = 0;
    for (let i = 0; i < 200; i++) {
      const s = await page.evaluate(() => ({
        sc: Math.round(feedEl.scrollTop),
        n: feedEl.children.length,
        sync: document.getElementById("syncbar").classList.contains("on"),
      }));
      if (s.sc === 0 && precedent > 0) remontees.push(`${i * 100} ms : ${precedent} → 0`);
      if (s.sc === 0 && s.n > 2) {
        await page.evaluate(() => {
          feedEl.scrollTop = feedEl.children[1].offsetTop;
          onCardChange();
        });
        precedent = await page.evaluate(() => Math.round(feedEl.scrollTop));
      } else precedent = s.sc;
      if (!s.sync && i > 30) break;
      await page.waitForTimeout(100);
    }
    console.log(
      `remontées en tête SUBIES : ${remontees.length}` +
        (remontees.length === 1
          ? "  → une seule, comme prévu ✓"
          : "  ← il en faut UNE (régression)")
    );
    remontees.forEach((r) => console.log("   " + r));
    console.log("--- journal des rendus");
    console.log((await page.evaluate(() => window.__J)).join("\n"));
    console.log("erreurs :", errors);
    await browser.close();
  },

  // 27. VITESSE d'un rafraîchissement d'actus au-delà des 30 min, avec des
  // sources lentes et mortes dans le lot. Le scénario que l'utilisateur vit à
  // chaque réouverture : un cache périmé est peint tout de suite, mais le fil
  // NEUF n'apparaissait qu'une fois la DERNIÈRE source close — donc après le
  // délai d'expiration des sources mortes, replis compris.
  // Ce qu'on mesure, et qui n'est pas la même chose : quand le fil AFFICHÉ
  // devient neuf (échéance NEWS_DEADLINE_MS), et quand le chargement se termine
  // VRAIMENT (budget FEED_BUDGET_MS par source). Mesuré avant correctif :
  // 24,6 s pour les deux.
  async lentnews() {
    const N = 40;
    const feeds = Array.from({ length: N }, (_, i) => ({
      url: `https://src${i}.test/rss`,
      name: "Source " + i,
      on: true,
    }));
    // 25 rapides, 10 moyennes, 3 lentes, 2 MORTES (aucune réponse, jamais).
    const latence = (i) => (i >= 38 ? null : i >= 35 ? 5000 : i >= 25 ? 1200 : 250);
    const rss = (i) =>
      `<?xml version="1.0"?><rss version="2.0"><channel><title>S${i}</title>${Array.from(
        { length: 12 },
        (_, k) =>
          `<item><title>NEUF s${i} a${k}</title><link>https://src${i}.test/n/${k}</link>` +
          `<description>${"texte ".repeat(20)}</description>` +
          `<pubDate>${new Date(Date.now() - (i * 12 + k) * 60e3).toUTCString()}</pubDate></item>`
      ).join("")}</channel></rss>`;
    const lot = () =>
      JSON.stringify({
        items: Array.from({ length: 20 }, (_, i) => ({
          source: "Wikipédia",
          title: "NEUF Wiki " + i,
          desc: "x".repeat(200),
          link: "https://fr.wikipedia.org/wiki/N" + i,
          img: "https://img.test/w.jpg",
        })),
      });
    // Cache disque vieux de 35 min : au-delà d'AUTO_RELOAD_MS, donc les deux
    // moitiés repartent — mais il y a bien quelque chose à l'écran d'ici là.
    const KEY = "mix|fr|all|all:sciences,histoire|s";
    const vieux = Array.from({ length: 40 }, (_, i) => ({
      kind: "news",
      source: "Source " + i,
      title: "VIEUX s" + i,
      desc: "texte ancien",
      link: `https://src${i}.test/v/${i}`,
      img: "",
      date: new Date(Date.now() - 40 * 60e3).toUTCString(),
    }));
    const { browser, page, errors } = await boot({
      storage: {
        ...READY,
        "fluxswipe.feeds.v1": JSON.stringify(feeds),
        "fluxswipe.cache.v1": JSON.stringify({
          [KEY]: { t: Date.now() - 35 * 60e3, items: vieux },
        }),
      },
    });
    await page.route(/src\d+\.test|rss2json|api\/learn|wikipedia\.org/, async (r) => {
      const u = r.request().url();
      // /api/og?url=https://src0.test/… porte le nom d'une source dans SON
      // paramètre : c'est une sonde de métadonnées, pas un flux. On la rend au
      // gestionnaire général, qui sait y répondre.
      if (/\/api\/og/.test(u)) return r.fallback();
      const m = u.match(/src(\d+)\.test/);
      if (m) {
        const lat = latence(+m[1]);
        if (lat === null) return; // morte : on ne répond JAMAIS
        await new Promise((z) => setTimeout(z, lat));
        return r
          .fulfill({ status: 200, contentType: "application/xml", body: rss(+m[1]) })
          .catch(() => {});
      }
      if (/rss2json/.test(u)) {
        await new Promise((z) => setTimeout(z, 7000));
        return r.fulfill({ status: 502, body: "{}" }).catch(() => {});
      }
      await new Promise((z) => setTimeout(z, 1500)); // deepcategory : lent
      return r
        .fulfill({ status: 200, contentType: "application/json", body: lot() })
        .catch(() => {});
    });
    const t0 = Date.now();
    await page.goto(URL_APP);
    const jalons = {};
    const jalon = (k) => {
      if (!jalons[k]) jalons[k] = Date.now() - t0;
    };
    for (let i = 0; i < 500; i++) {
      const st = await page
        .evaluate(() => {
          const t = [...document.querySelectorAll("#feed .card h2")].map(
            (h) => h.textContent
          );
          return {
            n: t.length,
            neuves: t.filter((x) => /^NEUF s/.test(x)).length,
            wiki: t.some((x) => /^NEUF Wiki/.test(x)),
            teteNeuve: /^NEUF/.test(t[0] || ""),
            sync: document.getElementById("syncbar").classList.contains("on"),
          };
        })
        .catch(() => null);
      if (!st) break;
      if (st.n) jalon("cartes du cache");
      if (st.wiki) jalon("Wikipédia neuf");
      if (st.neuves) jalon("actus neuves À L'ÉCRAN");
      if (st.teteNeuve) jalon("carte du haut neuve");
      if (st.neuves && !st.sync) {
        jalon("chargement TERMINÉ");
        jalons.__n = st.neuves;
        break;
      }
      await page.waitForTimeout(60);
    }
    const total = jalons.__n;
    delete jalons.__n;
    for (const k of [
      "cartes du cache",
      "Wikipédia neuf",
      "actus neuves À L'ÉCRAN",
      "carte du haut neuve",
      "chargement TERMINÉ",
    ])
      console.log(
        "  " + k.padEnd(24) + (jalons[k] ? jalons[k] + " ms" : "JAMAIS (>30 s)")
      );
    // Le budget ne doit RIEN coûter en contenu : les 38 sources vivantes
    // rapportent de quoi remplir MAX_NEWS, comme avant.
    // MAX_NEWS vaut 120. Le GEL de la tête (remix(true)) peut reporter jusqu'à
    // deux cartes qui ne sont plus dans le classement — c'est son rôle, il
    // protège ce qui est sous le doigt — d'où la tolérance.
    console.log("  actus neuves retenues   " + total + " (attendu : 120 à 122)");
    console.log("erreurs :", errors);
    await browser.close();
  },

  // 28. Cartes vidéo : lecture SUR la carte, sans ouvrir le lecteur d'articles.
  // Quatre choses qui ne se lisent pas dans le code :
  //   a) le flux YouTube est de l'Atom avec <media:group> — il faut vérifier que
  //      le lien et la vignette en sortent vraiment, pas le croire ;
  //   b) une carte vidéo doit être écartée des sondes /api/og, comme Wikipédia.
  //      C'est le défaut mesuré là-bas : une invocation serverless PAR CARTE ;
  //   c) il ne doit JAMAIS y avoir deux lecteurs vivants, quoi qu'on fasse ;
  //   d) déplacer une carte qui joue recharge son iframe (autoplay=1 ⇒ la vidéo
  //      repartirait de zéro toute seule) — render() doit donc l'arrêter avant ;
  //   e) une chaîne est interrogée sur sa playlist « Shorts » (UUSH…), jamais
  //      sur channel_id : c'est la SEULE façon de n'avoir que des Shorts, rien
  //      dans l'Atom ne distinguant un Short d'une vidéo classique. L'URL
  //      ENREGISTRÉE, elle, ne doit pas bouger.
  async video() {
    const feeds = [
      {
        // Nom d'hôte, comme après un ajout manuel : le vrai nom doit être
        // appris DANS le flux (ici sur l'auteur des entrées, le <title> étant
        // celui de la playlist auto-générée).
        name: "youtube.com",
        url: "https://www.youtube.com/feeds/videos.xml?channel_id=UC" + YT_CHAN,
        on: true,
      },
    ];
    const { browser, page, errors } = await boot({
      storage: {
        ...READY,
        "fluxswipe.feeds.v1": JSON.stringify(feeds),
        "fluxswipe.mix.v1": "0", // 0 = actus seules : que des cartes vidéo dans le fil
      },
      rss: RSS_YT,
    });
    // Ce que le banc doit compter lui-même : les requêtes réellement parties.
    const calls = { og: 0, player: 0, flux: [] };
    page.on("request", (r) => {
      const u = r.url();
      if (/api\/og/.test(u)) calls.og++;
      if (/youtube-nocookie\.com|youtube\.com\/embed/.test(u)) calls.player++;
      // Le flux passe par le proxy : la vraie cible est dans son paramètre.
      const m = /api\/feed\?url=([^&]+)/.exec(u);
      if (m) calls.flux.push(decodeURIComponent(m[1]));
    });
    await page.goto(URL_APP);
    await page.waitForTimeout(2500);

    const carte = await page.evaluate(() => {
      const c = document.querySelector(".card");
      const it = c && cardReg.get(+c.dataset.id);
      return {
        cartes: document.querySelectorAll(".card[data-vid]").length,
        total: document.querySelectorAll(".card").length,
        vid: c && c.dataset.vid,
        lien: it && it.link,
        img: it && it.img,
        // Les trois marqueurs de sonde doivent être absents.
        pw: !!(c && c.hasAttribute("data-pw")),
        sponsor: !!(c && c.hasAttribute("data-sponsor")),
        noimg: !!document.querySelector(".card[data-vid] [data-noimg-link]"),
        // Le titre lance la vidéo au lieu d'ouvrir un lien.
        titreJoue: !!(c && c.querySelector(".card__title [data-play]")),
        pastille: c && c.querySelector(".card__open span")?.textContent,
        // Le nom de la source : « youtube.com » (le nom d'hôte, seul nom que
        // l'URL permet) doit avoir cédé la place au nom annoncé par le flux —
        // sur la carte, dans le panneau Sources ET dans la puce de filtre.
        surCarte: c && c.querySelector(".card__source .txt")?.textContent,
        enregistre: feeds[0] && feeds[0].name,
        pucesFiltre: filterChips("src").map((x) => x.label),
      };
    });
    console.log("cartes vidéo :", carte.cartes, "/", carte.total, "cartes");
    console.log("identifiant  :", carte.vid, "  lien :", carte.lien);
    console.log("vignette     :", carte.img);
    console.log(
      "marqueurs de sonde (tous doivent être false) :",
      "pw=" + carte.pw,
      "sponsor=" + carte.sponsor,
      "noimg=" + carte.noimg
    );
    console.log(
      "titre jouable:",
      carte.titreJoue,
      "  pastille :",
      JSON.stringify(carte.pastille)
    );
    console.log(
      "nom de la source — carte :",
      JSON.stringify(carte.surCarte),
      " enregistré :",
      JSON.stringify(carte.enregistre),
      " puces :",
      JSON.stringify(carte.pucesFiltre)
    );
    console.log(
      "flux interrogés (attendu : playlist_id=UUSH…, jamais channel_id) :",
      JSON.stringify(calls.flux)
    );
    console.log(
      "URL ENREGISTRÉE inchangée (attendu : channel_id=UC…) :",
      await page.evaluate(() => feeds[0] && feeds[0].url)
    );
    console.log("/api/og partis (attendu : 0) :", calls.og);
    console.log("lecteurs chargés AVANT tout appui (attendu : 0) :", calls.player);

    /* « Vu » ne veut PAS dire la même chose pour une vidéo que pour un article.
       Une carte d'article porte titre, résumé et image : l'avoir eue sous les
       yeux suffit. D'une vidéo, la carte ne montre qu'une miniature — défiler
       devant ne l'a pas regardée, et elle doit garder sa place dans la file de
       sa chaîne. On parcourt donc quatre cartes SANS rien lancer.
       (Le pendant côté actus, lui, est vérifié par `redites`.) */
    await page.evaluate(() =>
      feedEl.scrollTo({ top: feedEl.clientHeight * 3, behavior: "instant" })
    );
    await page.waitForTimeout(500);
    const vuSansLancer = await page.evaluate(() => seenNews.size);
    await page.evaluate(() => feedEl.scrollTo({ top: 0, behavior: "instant" }));
    await page.waitForTimeout(400);
    console.log(
      "cartes vidéo défilées SANS lancer — mémorisées vues (attendu : 0) :",
      vuSansLancer
    );

    // Appui sur ▶ : le lecteur se monte, et lui seul.
    await page.click(".card[data-vid] .card__play");
    await page.waitForTimeout(600);
    console.log(
      "après ▶ — vidéos mémorisées vues (attendu : 1) :",
      await page.evaluate(() => seenNews.size)
    );
    console.log(
      "après ▶ — iframes :",
      await page.evaluate(() => document.querySelectorAll(".card__video").length),
      " lecteurs chargés :",
      calls.player
    );
    console.log(
      "après ▶ — barre du haut masquée (attendu : true) :",
      await page.evaluate(
        () => document.querySelector(".top")?.classList.contains("top--away") ?? "n/a"
      )
    );

    // On glisse d'une carte : la lecture doit s'arrêter, et la suivante repartir
    // de zéro sans laisser la première vivante.
    await page.evaluate(() =>
      feedEl.scrollTo({ top: feedEl.clientHeight, behavior: "instant" })
    );
    await page.waitForTimeout(400);
    console.log(
      "après swipe — iframes (attendu : 0) :",
      await page.evaluate(() => document.querySelectorAll(".card__video").length)
    );

    await page.click(".card[data-vid]:nth-child(2) .card__play");
    await page.waitForTimeout(400);
    // Un lot arrive en arrière-plan et s'INSÈRE devant la carte qui joue. Insérer
    // un frère ne touche pas au nœud de la carte : la lecture doit continuer —
    // c'est le cas courant, et l'interrompre serait un défaut à part entière.
    const insere = await page.evaluate(() => {
      const avant = document.querySelectorAll(".card__video").length;
      items.unshift({ ...items[0], link: "https://ex.test/intrus" });
      render();
      return { avant, apres: document.querySelectorAll(".card__video").length };
    });
    console.log(
      "lot inséré DEVANT la carte — iframes avant/après :",
      insere.avant,
      "→",
      insere.apres,
      "(attendu : 1 → 1, la lecture continue)"
    );
    // Le fil se RÉORDONNE et la carte qui joue change de place. Là, `render()`
    // la passe à insertBefore, ce qui détruit le contexte de navigation de son
    // iframe et la recharge — avec autoplay=1, la vidéo repartirait de zéro.
    // L'ancrage garde l'utilisateur sur la MÊME carte, donc seul le déplacement
    // peut expliquer l'arrêt (ce n'est pas le changement de carte courante).
    const dep = await page.evaluate(() => {
      const avant = document.querySelectorAll(".card__video").length;
      const lien = cardReg.get(+playingCard.dataset.id).link;
      const i = items.findIndex((it) => it.link === lien);
      items.splice(i, 1); // on la remonte de deux crans : sa carte DOIT bouger
      items.splice(Math.max(0, i - 2), 0, cardReg.get(+playingCard.dataset.id));
      render();
      return { avant, apres: document.querySelectorAll(".card__video").length };
    });
    console.log(
      "carte DÉPLACÉE par un render — iframes avant/après :",
      dep.avant,
      "→",
      dep.apres,
      "(attendu : 1 → 0, pas de redémarrage fantôme)"
    );
    console.log(
      "lecteurs chargés au total :",
      calls.player,
      "(attendu : 2, un par appui)"
    );
    console.log("erreurs :", errors);
    await browser.close();
  },

  // 29. Chaîne YouTube SANS aucun Short : servir les Shorts seuls rend son flux
  // légitimement vide, et un flux vide ressemble à une panne. Trois choses à
  // vérifier, aucune visible en lecture de code :
  //   a) elle n'est pas annoncée « injoignable » — ce serait désigner à la
  //      suppression une source qui répond parfaitement ;
  //   b) elle ne déclenche PAS le repli rss2json (une requête tierce par
  //      chargement et par chaîne, qui ne trouverait rien de plus) ;
  //   c) une source vraiment morte, elle, continue d'être signalée.
  // Les `CONSOLE: net::ERR_CONNECTION_REFUSED` sont le sujet du (c), pas une
  // régression — la source morte l'est pour de bon, comme dans `offline`.
  async shortsvide() {
    const feeds = [
      {
        name: "YT · Sans Shorts",
        url: "https://www.youtube.com/feeds/videos.xml?channel_id=UC" + YT_CHAN,
        on: true,
      },
      { name: "Actus", url: "https://src1.test/rss", on: true },
      { name: "Morte", url: "https://src9.test/rss", on: true },
    ];
    const { browser, page, errors } = await boot({
      storage: {
        ...READY,
        "fluxswipe.feeds.v1": JSON.stringify(feeds),
        "fluxswipe.mix.v1": "0", // actus seules : le fil ne tient qu'à elles
      },
    });
    const calls = { rss2json: 0, flux: [] };
    page.on("request", (r) => {
      const u = r.url();
      if (/rss2json/.test(u)) calls.rss2json++;
      const m = /api\/feed\?url=([^&]+)/.exec(u);
      if (m) calls.flux.push(decodeURIComponent(m[1]));
    });
    /* Sur le web, un flux part par le proxy : sa vraie cible est un paramètre
       ENCODÉ de l'URL demandée (`/api/feed?url=…`). Filtrer sur l'URL brute
       laisserait donc passer tout ce qui contient un `/` encodé — d'où le
       fourre-tout, qui décode la cible et rend la main (`fallback`) pour tout
       ce qui ne le concerne pas. */
    await page.route("**/*", async (r) => {
      const brute = r.request().url();
      const m = /api\/feed\?url=([^&]+)/.exec(brute);
      const u = m ? decodeURIComponent(m[1]) : brute;
      // Playlist « Shorts » d'une chaîne qui n'en publie aucun : YouTube répond
      // 200 avec un Atom parfaitement valide, simplement sans <entry>. L'en-tête
      // est repris de la vraie réponse — un corps riquiqui serait tenu pour vide
      // par le proxy (voir fetchViaProxy et son plancher de 200 caractères), et
      // le scénario mesurerait un échec de transport au lieu d'un flux vide.
      if (/UUSH/.test(u))
        return r
          .fulfill({
            status: 200,
            contentType: "application/xml",
            body: `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns:yt="http://www.youtube.com/xml/schemas/2015"
      xmlns:media="http://search.yahoo.com/mrss/" xmlns="http://www.w3.org/2005/Atom">
 <link rel="self" href="http://www.youtube.com/feeds/videos.xml?playlist_id=UUSH${YT_CHAN}"/>
 <id>yt:playlist:UUSH${YT_CHAN}</id>
 <yt:playlistId>UUSH${YT_CHAN}</yt:playlistId>
 <title>Shorts</title>
 <link rel="alternate" href="https://www.youtube.com/playlist?list=UUSH${YT_CHAN}"/>
 <author><name>Sans Shorts</name><uri>https://www.youtube.com/channel/UC${YT_CHAN}</uri></author>
 <published>${new Date(Date.now() - 300 * 24 * 3600e3).toISOString()}</published>
</feed>`,
          })
          .catch(() => {});
      if (/src9\.test/.test(u)) return r.abort("connectionrefused").catch(() => {});
      if (/rss2json/.test(u))
        return r.fulfill({ status: 502, body: "{}" }).catch(() => {});
      return r.fallback();
    });
    await page.goto(URL_APP);
    await page.waitForTimeout(3500);

    console.log("flux interrogés :", JSON.stringify(calls.flux));
    console.log(
      "cartes :",
      await page.evaluate(() => document.querySelectorAll(".card").length),
      "— d'où (attendu : les actus seules) :",
      JSON.stringify(
        await page.evaluate(() => [
          ...new Set(items.map((it) => it.kind + ":" + it.source)),
        ])
      )
    );
    console.log(
      "appels rss2json (attendu : 1, la source morte — jamais la chaîne) :",
      calls.rss2json
    );
    console.log(
      "sources marquées injoignables (attendu : la morte seule) :",
      await page.evaluate(() => [...unreachable])
    );
    console.log(
      "toast :",
      await page.$eval("#toast", (e) => e.classList.contains("show") && e.textContent)
    );
    console.log("erreurs :", errors);
    await browser.close();
  },
};

const which = process.argv[2];
if (!scenarios[which]) {
  console.log("scénarios :", Object.keys(scenarios).join(", "));
  process.exit(1);
}
scenarios[which]().catch((e) => {
  console.error(e);
  process.exit(1);
});
