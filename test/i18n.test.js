"use strict";
// Tests de la couche de traduction (src/i18n.js), partagée avec index.html.
const test = require("node:test");
const assert = require("node:assert");
const i18n = require("../src/i18n.js");

test("t() rend la chaîne française pour lang=fr", () => {
  assert.equal(i18n.t("fr", "sheet.apply"), "Voir mon fil");
});

test("t() rend la traduction anglaise quand elle existe", () => {
  assert.equal(i18n.t("en", "sheet.apply"), "See my feed");
});

test("t() retombe sur le français si la clé manque en anglais", () => {
  // "cat.random" existe côté "en" mais pas "fr" (le français lit CATEGORIES
  // directement) — l'inverse : une clé UNIQUEMENT en français doit se voir en
  // anglais aussi, plutôt que de laisser un vide.
  assert.equal(i18n.t("en", "toast.copied"), "Copied");
  const frOnlyKey = "sheet.sources.placeholder";
  // Vérifie que le mécanisme de repli s'applique bien : si jamais une clé était
  // retirée d'un dictionnaire par erreur, elle resterait lisible en français
  // plutôt que de disparaître.
  assert.equal(i18n.t("fr", frOnlyKey), i18n.STRINGS.fr[frOnlyKey]);
});

test("t() retombe sur le français pour une langue inconnue", () => {
  assert.equal(i18n.t("de", "sheet.apply"), i18n.t("fr", "sheet.apply"));
});

test("t() substitue les variables {nom}", () => {
  assert.equal(i18n.t("fr", "toast.feedAdded", { name: "Le Monde" }), "Le Monde ajouté");
  assert.equal(i18n.t("en", "toast.feedAdded", { name: "Le Monde" }), "Le Monde added");
});

test("t() rend la clé elle-même si elle n'existe nulle part (jamais un vide)", () => {
  assert.equal(i18n.t("fr", "clef.inexistante"), "clef.inexistante");
});

test("chaque clé anglaise a un pendant français (le français est la source complète)", () => {
  const missing = Object.keys(i18n.STRINGS.en).filter((k) => !(k in i18n.STRINGS.fr));
  // Seules les clés "cat.*" sont volontairement absentes du français, qui lit
  // les libellés directement depuis src/learn-core.js (voir catLabelT).
  assert.deepEqual(
    missing.filter((k) => !k.startsWith("cat.")),
    []
  );
});

test("LANGS contient au moins le français et l'anglais", () => {
  assert.ok(i18n.LANGS.includes("fr"));
  assert.ok(i18n.LANGS.includes("en"));
});
