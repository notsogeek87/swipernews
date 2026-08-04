# Publication sur F-Droid

F-Droid ne fonctionne pas comme GitHub Releases ou le Play Store : il n'existe
aucun moyen de « pousser » un APK vers F-Droid. Le projet compile lui-même
chaque application depuis ses sources, à partir d'une recette de build
déclarée dans son propre dépôt, **gitlab.com/fdroid/fdroiddata** (sur GitLab,
hors de portée de cette session — aucun accès n'y est configuré ici).

Ce dossier prépare tout ce qui dépend du dépôt source, pour qu'une soumission
soit ensuite rapide à faire manuellement.

## Ce qui est prêt

- **`fastlane/metadata/android/en-US/` et `…/fr-FR/`** : titre, description
  courte, description longue, icône (512×512) et captures au format `fastlane`,
  que F-Droid (et d'autres stores) reprennent automatiquement pour la fiche de
  l'application. `en-US` est le dossier de repli : sans lui, un utilisateur dont
  la langue n'est pas le français voit une fiche vide — leur revue le réclame.
- **`fdroid/eu.lielu.news.yml`** : recette de build, épinglée sur le **hash
  complet** du commit de `v1.2.0`, à coller dans `metadata/eu.lielu.news.yml`
  sur `fdroiddata`.
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
2. `fdroid/eu.lielu.news.yml` : `versionName`, `versionCode`, `commit` (le
   **hash complet**, pas le tag : un tag se déplace, ils le refusent),
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

## Build reproductible : l'APK publié doit exister, et coïncider

Depuis la revue de leur MR, la recette déclare `Binaries:` et
`AllowedAPKSigningKeys:`. F-Droid recompile alors le tag, **télécharge notre
APK** et compare les deux (signature exclue) :

- s'ils coïncident, c'est **notre** binaire, signé de **notre** clé, qui est
  distribué — un paquet installé depuis GitHub se met à jour depuis F-Droid, et
  réciproquement ;
- s'ils diffèrent, ou si l'URL ne répond pas, **le build échoue** et la version
  n'est pas publiée.

D'où deux obligations nouvelles à chaque version :

1. **`.github/workflows/release.yml` doit avoir tourné pour le tag.** Il compile
   avec un **Gradle nu**, sans `-PversionCode`/`-PversionName` — contrairement à
   `android.yml`, dont l'APK porte le numéro de run (`1.2.0.52`) et ne peut donc
   pas servir ici. Il publie le fichier à l'adresse exacte qu'attend
   `Binaries:` :
   `releases/download/vX.Y.Z/swipernews-X.Y.Z.apk`. Renommer l'un ou l'autre
   casse la vérification.
2. **La clé de signature ne change pas.** `AllowedAPKSigningKeys` porte
   l'empreinte SHA-256 du certificat des secrets `ANDROID_*`
   (`cc849a79…6238`) ; un APK signé d'une autre clé est rejeté. Se relit sur un
   APK publié avec `apksigner verify --print-certs`.

Un tag posé avant que ce workflow n'existe ne l'a évidemment pas déclenché
(Actions lit le fichier dans le ref choisi) : lancer alors le workflow à la main
depuis `main`, en renseignant l'entrée `tag` — c'est ce qui a servi à publier
l'APK de `v1.2.0` après coup.

## Ce qui reste à faire, à la main

La demande d'inclusion est **ouverte et en cours de revue** :
[fdroiddata!44729](https://gitlab.com/fdroid/fdroiddata/-/merge_requests/44729).
GitLab est hors de portée de ce dépôt (aucun accès configuré ici) — ce qui suit
se fait donc à la main, sur `fdroiddata` :

1. **Recopier `fdroid/eu.lielu.news.yml`** (tel quel) dans
   `metadata/eu.lielu.news.yml` sur la branche de la MR, et pousser.
2. **Reprendre la description de la MR avec leur gabarit « App inclusion »** et
   cocher toutes les cases obligatoires — c'est le dernier point demandé en
   revue, et il ne concerne que GitLab, pas ce dépôt.

## Ce que la revue de la MR a demandé (et où c'est corrigé)

| Demande | Corrigé dans |
| --- | --- |
| `commit:` = hash complet, pas le tag `v1.2.0` | `eu.lielu.news.yml` |
| Supprimer `output:` | `eu.lielu.news.yml` |
| Ajouter `Binaries` et `AllowedAPKSigningKeys` (build reproductible) | `eu.lielu.news.yml` + `.github/workflows/release.yml` |
| Ajouter un dossier `en-US` dans `fastlane` | `fastlane/metadata/android/en-US/` |
| Utiliser le gabarit « App inclusion » et cocher les cases | à faire sur GitLab (voir ci-dessus) |

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
