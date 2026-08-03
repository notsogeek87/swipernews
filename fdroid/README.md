# Publication sur F-Droid

F-Droid ne fonctionne pas comme GitHub Releases ou le Play Store : il n'existe
aucun moyen de « pousser » un APK vers F-Droid. Le projet compile lui-même
chaque application depuis ses sources, à partir d'une recette de build
déclarée dans son propre dépôt, **gitlab.com/fdroid/fdroiddata** (sur GitLab,
hors de portée de cette session — aucun accès n'y est configuré ici).

Ce dossier prépare tout ce qui dépend du dépôt source, pour qu'une soumission
soit ensuite rapide à faire manuellement.

## Ce qui est prêt

- **`fastlane/metadata/android/fr-FR/`** : titre, description courte, description
  longue et icône (512×512) au format `fastlane`, que F-Droid (et d'autres
  stores) peuvent reprendre automatiquement pour la fiche de l'application.
- **`fdroid/eu.lielu.news.yml`** : recette de build, épinglée sur le tag
  `v1.2.0`, à coller dans `metadata/eu.lielu.news.yml` sur `fdroiddata`.
- **Captures d'écran** dans
  `fastlane/metadata/android/fr-FR/images/phoneScreenshots/` : les deux modes,
  Actus et Apprendre. F-Droid en demande au moins une.
- **Le tag `v1.2.0`**, posé sur le `main` publié.
- Licence MIT, permission Android unique (`INTERNET`), aucune dépendance
  Google Play Services / Firebase / SDK propriétaire — l'app remplit déjà les
  critères de base d'inclusion (logiciel libre, buildable sans service tiers
  non libre pour la compilation elle-même).

## À refaire à chaque version publiée

F-Droid compile depuis un tag, avec un Gradle nu — pas de `-PversionCode` comme
en CI — puis **vérifie que l'APK obtenu porte bien la version annoncée par la
recette**. Trois endroits doivent donc dire la même chose, sans quoi le build
est rejeté :

1. `android/app/build.gradle` : `versionCode` et `versionName` dans
   `defaultConfig`, **écrits en clair** (c'est ce que produit le Gradle nu de
   F-Droid, et la seule forme que sait lire leur analyseur) ;
2. `fdroid/eu.lielu.news.yml` : `versionName`, `versionCode`, `commit`,
   `CurrentVersion`, `CurrentVersionCode` ;
3. le tag git lui-même, `vX.Y.Z`, posé sur le commit publié.

L'ordre compte : le tag se pose **après** le commit qui aligne les deux
premiers, puisque F-Droid ne voit du dépôt que ce que contient le commit tagué.
Un tag posé trop tôt embarque l'ancienne version de `build.gradle` et fait échouer
la vérification de version — il faut alors le déplacer (`git tag -f`) plutôt
que de retoucher la recette.

Le `versionCode` se déduit de la version — majeur × 10000 + mineur × 100 +
correctif, soit `10200` pour 1.2.0 — donc il croît tout seul, sans compteur à
tenir. `package.json` suit aussi la version, mais seulement pour nommer les
APK produits par la CI.

## Ce qui reste à faire, à la main

**Ouvrir la demande d'inclusion**, sur GitLab : forker `fdroid/fdroiddata`,
ajouter `metadata/eu.lielu.news.yml` (le fichier ci-contre, tel quel) et ouvrir
une merge request — ou, plus simple pour un premier envoi, passer par leur
"Request For Packaging" : <https://gitlab.com/fdroid/rfp/-/issues>. Cette étape
ne peut pas être faite depuis ce dépôt GitHub.

## Ce que le premier build F-Droid a appris

`f-droid.org` est bloqué depuis l'environnement de développement de ce dépôt,
mais les sources de `fdroidserver` sont lisibles sur GitLab — c'est la référence
à consulter en cas de doute sur un champ de recette.

- **`init:` s'exécute dans `subdir:`**, donc dans `android/`, et non à la racine
  du dépôt (`INFO: Running 'init' commands in build/eu.lielu.news/android`).
  `npm ci` fonctionne quand même, npm remontant jusqu'au `package.json` le plus
  proche ; ne pas « corriger » par un `cd ..`, qui ne marcherait plus si leur
  outil changeait de répertoire de travail.
- **Le scanner refuse tout binaire pré-compilé dans l'arbre des sources**, et
  `npm ci` en dépose quatorze dans `node_modules` (sharp, `tsc`, les JAR de
  `@trapezedev/gradle-parse`, les gabarits `.tar.gz` de la CLI Capacitor). D'où
  le `scanignore:` de la recette, qui les désigne un par un. Attention, il est
  strict dans les deux sens : un chemin qui n'existe pas **et** un chemin qui ne
  masque aucune erreur sont tous deux signalés comme des erreurs.
- **`UpdateCheckMode: Tags` accepte une expression régulière** en argument
  (`checkupdates.py` : `pattern = mode[5:]`).
- **Le fichier de recette est validé par un schéma JSON**, `schemas/metadata.json`
  dans `fdroiddata` — la référence à consulter avant d'inventer une valeur. Il
  donne la liste exacte des catégories (108 aujourd'hui, `News` comprise) et
  n'accepte plus `AutoUpdateMode: Version v%v`, seulement `Version` : le motif
  du tag se déduit désormais d'`UpdateCheckMode`. Se valider soi-même évite un
  aller-retour de pipeline :

  ```bash
  curl -sO https://gitlab.com/fdroid/fdroiddata/-/raw/master/schemas/metadata.json
  check-jsonschema --schemafile metadata.json metadata/eu.lielu.news.yml
  ```
- **La version doit être un littéral dans `build.gradle`.** Leur analyseur
  (`common.py`, `vcsearch_g` / `vnsearch_g`) ne lit que `versionCode 10200` et
  `versionName "1.2.0"` ; toute expression Groovy — une variable, un
  `project.findProperty(…) ?: …` — lui fait rendre un charabia et
  `fdroid checkupdates` s'arrête sur « Couldn't find any version information ».
  D'où l'écrasement par la CI écrit **après** le bloc `android`, et non dedans.
  C'est aussi ce qui rend `AutoUpdateMode: Version` possible : une fois la
  version lisible, F-Droid ajoute lui-même l'entrée `Builds` de chaque nouveau
  tag, et une version publiée ne demande plus de merge request.

## Anti-fonctionnalités à déclarer

Aucune identifiée : les polices (Inter, Source Serif 4, licence OFL) sont
auto-hébergées dans `fonts/` depuis [le remplacement de Google Fonts](../fonts/),
donc plus de dépendance réseau à un service non-libre. Pas de pub, pas de
tracking, pas de dépendance propriétaire dans le code embarqué sur Android.
