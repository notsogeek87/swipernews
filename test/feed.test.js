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

test("assertSafeUrl refuse une URL malformée", async () => {
  await assert.rejects(() => feed.assertSafeUrl("pas une url"));
});
