"use strict";
// Tests des gardes de sécurité du proxy RSS (anti-SSRF). Volontairement sans
// réseau : on vérifie la classification des IP et les refus qui interviennent
// avant toute résolution DNS.
const test = require("node:test");
const assert = require("node:assert");
const feed = require("../api/feed.js");

test("isPrivateIp classe correctement les IPv4", () => {
  const priv = [
    "10.0.0.1",
    "127.0.0.1",
    "172.16.0.1",
    "192.168.1.1",
    "169.254.169.254",
    "100.64.0.1",
  ];
  const pub = ["8.8.8.8", "1.1.1.1", "93.184.216.34"];
  for (const ip of priv)
    assert.equal(feed.isPrivateIp(ip), true, `${ip} devrait être privée`);
  for (const ip of pub)
    assert.equal(feed.isPrivateIp(ip), false, `${ip} devrait être publique`);
});

test("isPrivateIp classe correctement les IPv6", () => {
  assert.equal(feed.isPrivateIp("::1"), true);
  assert.equal(feed.isPrivateIp("fe80::1"), true);
  assert.equal(feed.isPrivateIp("fd00::1"), true);
  assert.equal(feed.isPrivateIp("::ffff:127.0.0.1"), true);
  assert.equal(feed.isPrivateIp("2001:4860:4860::8888"), false);
});

test("assertSafeUrl refuse les protocoles non http(s)", async () => {
  await assert.rejects(() => feed.assertSafeUrl("ftp://example.com/feed"));
  await assert.rejects(() => feed.assertSafeUrl("file:///etc/passwd"));
  await assert.rejects(() => feed.assertSafeUrl("javascript:alert(1)"));
});

test("assertSafeUrl refuse localhost et les IP privées littérales", async () => {
  await assert.rejects(() => feed.assertSafeUrl("http://localhost/feed"));
  await assert.rejects(() => feed.assertSafeUrl("http://127.0.0.1/feed"));
  await assert.rejects(() =>
    feed.assertSafeUrl("http://169.254.169.254/latest/meta-data/")
  );
  await assert.rejects(() => feed.assertSafeUrl("http://[::1]/feed"));
  await assert.rejects(() => feed.assertSafeUrl("http://192.168.0.10/feed"));
});

test("isYoutubeHost reconnaît les hôtes YouTube, avec ou sans www.", () => {
  assert.equal(feed.isYoutubeHost("https://www.youtube.com/@nom"), true);
  assert.equal(feed.isYoutubeHost("https://youtube.com/@nom"), true);
  assert.equal(feed.isYoutubeHost("https://m.youtube.com/@nom"), true);
  assert.equal(feed.isYoutubeHost("https://music.youtube.com/@nom"), true);
  assert.equal(feed.isYoutubeHost("https://youtube-nocookie.com/embed/x"), true);
  assert.equal(feed.isYoutubeHost("https://lemonde.fr/rss/une.xml"), false);
  assert.equal(feed.isYoutubeHost("https://youtube.com.pirate.fr/@nom"), false);
  assert.equal(feed.isYoutubeHost("pas une url"), false);
  assert.equal(feed.isYoutubeHost(""), false);
});

test("isYoutubeFeedPath ne reconnaît que le point d'accès XML des flux", () => {
  assert.equal(
    feed.isYoutubeFeedPath("https://www.youtube.com/feeds/videos.xml?channel_id=UCabc"),
    true
  );
  assert.equal(feed.isYoutubeFeedPath("https://youtube.com/feeds/videos.xml"), true);
  assert.equal(feed.isYoutubeFeedPath("https://www.youtube.com/@nom"), false);
  assert.equal(feed.isYoutubeFeedPath("https://www.youtube.com/channel/UCabc"), false);
  assert.equal(feed.isYoutubeFeedPath("pas une url"), false);
  assert.equal(feed.isYoutubeFeedPath(""), false);
});

test("assertSafeUrl refuse une URL malformée", async () => {
  await assert.rejects(() => feed.assertSafeUrl("pas une url"));
});

// --- Redirections -----------------------------------------------------------
// assertSafeUrl ne voit que l'URL de départ. Tant que le fetch suivait les
// redirections tout seul, une page publique répondant « 302 vers 127.0.0.1 »
// suffisait à traverser la garde : c'est ce que ces tests verrouillent.
const http = require("node:http");

// Petit serveur jetable : renvoie l'URL demandée à `route(chemin)`.
function serve(route) {
  const srv = http.createServer((q, r) => route(q, r));
  return new Promise((res) =>
    srv.listen(0, "127.0.0.1", () => res({ srv, port: srv.address().port }))
  );
}

test("safeFetch refuse une redirection vers le réseau interne", async () => {
  const secret = await serve((q, r) => r.end("SECRET-INTERNE"));
  const redir = await serve((q, r) => {
    r.writeHead(302, { Location: `http://127.0.0.1:${secret.port}/` });
    r.end();
  });
  try {
    await assert.rejects(
      () => feed.safeFetch(`http://127.0.0.1:${redir.port}/`),
      /Hôte non autorisé/,
      "la redirection vers une IP privée doit être refusée"
    );
  } finally {
    secret.srv.close();
    redir.srv.close();
  }
});

test("safeFetch refuse aussi une redirection RELATIVE vers l'interne", async () => {
  // `Location: /interne` est résolu sur l'hôte courant : la garde doit voir
  // l'URL réellement demandée, pas la chaîne brute de l'en-tête.
  const s = await serve((q, r) => {
    if (q.url === "/") {
      r.writeHead(302, { Location: "/interne" });
      r.end();
    } else r.end("SECRET-INTERNE");
  });
  try {
    await assert.rejects(() => feed.safeFetch(`http://127.0.0.1:${s.port}/`));
  } finally {
    s.srv.close();
  }
});

test("safeFetch s'arrête au-delà de la limite de redirections", async () => {
  // Boucle infinie sur un hôte public : sans plafond, la fonction tournerait
  // jusqu'au timeout de la lambda.
  const s = await serve((q, r) => {
    r.writeHead(302, { Location: "/encore" });
    r.end();
  });
  try {
    await assert.rejects(
      () => feed.safeFetch(`http://127.0.0.1:${s.port}/`, {}, 0),
      /Trop de redirections/
    );
  } finally {
    s.srv.close();
  }
});
