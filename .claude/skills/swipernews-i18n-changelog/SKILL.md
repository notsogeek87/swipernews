---
name: swipernews-i18n-changelog
description: Ajouter ou modifier un texte d'interface SwiperNews (clé i18n, fr/en) ou annoncer une nouveauté dans la feuille « Nouveautés » (CHANGELOG). À utiliser quand on ajoute un bouton, un toast, un libellé, une langue, ou qu'une modification est visible de l'utilisateur et vaut d'être annoncée.
---

# Textes d'interface et « Nouveautés »

Tout est en français (commentaires, commits, UI, docs). `src/i18n.js` est la source de vérité linguistique : `STRINGS.fr` est **complet**, `STRINGS.en` est une couche par-dessus (`T()` retombe sur le français si une clé manque).

## Ajouter un texte

1. Ajouter la clé dans `STRINGS.fr` (`src/i18n.js`), puis la même dans `STRINGS.en`. Une clé en moins côté `en` n'est pas bloquante, mais autant traduire tout de suite.
2. HTML statique : `data-i18n="clé"` (ou `data-i18n-attr`) ; contenu généré : `T("clé")`.
3. Ne pas traduire le contenu des articles ni `relTime()` — choix documenté en tête de `src/i18n.js`.
4. `src/i18n.js` est un fichier de `src/` : **bump** obligatoire (skill `swipernews-bump`), et le `?v=` de `i18n.js` doit suivre.
5. `npm test` (le test `test/i18n.test.js` vérifie la couche).

## Annoncer une nouveauté

La feuille « Nouveautés » s'ouvre toute seule quand `APP_VERSION` a changé. `CHANGELOG` (`index.html`) est une liste **manuelle**, plus récent en tête : `{v:N, date:"AAAA-MM-JJ", items:["changelog.vN.item1"]}`.

- Une entrée par mise à jour qui vaut d'être annoncée, **pas** une par bump (la plupart ne changent rien de visible).
- `v` = le nouvel `APP_VERSION`. Les items sont des **clés i18n** `changelog.vN.itemK`, à ajouter en fr ET en `en`.
- Texte pour l'utilisateur : ce qu'il voit, pas ce qu'on a refactoré.

## Nouvelle façon d'ajouter une source

Dès qu'on apprend à l'app une nouvelle forme de source (réseau social, type d'adresse, import…), l'aide « Que peut-on ajouter ? » du panneau Sources doit suivre : entrée dans `SOURCE_KINDS` (`src/lib.js`, avec un exemple), textes `src.<type>.title` et `src.<type>.desc` en fr ET en. `npm test` échoue sinon.

## Pièges

- Pas d'emoji ni de glyphe de police à la place d'une icône de la famille `ICON_*`.
- Les accords français : une préposition fait partie de la clé complète (« au mois dernier »), ne pas composer deux fragments.
- Pas de toast juste après un réglage (il se place devant le sélecteur touché).
