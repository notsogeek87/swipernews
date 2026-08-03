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
  `v1.1.0`, à coller dans `metadata/eu.lielu.news.yml` sur `fdroiddata`.
- **Captures d'écran** dans
  `fastlane/metadata/android/fr-FR/images/phoneScreenshots/` : les deux modes,
  Actus et Apprendre. F-Droid en demande au moins une.
- **Le tag `v1.1.0`**, posé sur le `main` publié.
- Licence MIT, permission Android unique (`INTERNET`), aucune dépendance
  Google Play Services / Firebase / SDK propriétaire — l'app remplit déjà les
  critères de base d'inclusion (logiciel libre, buildable sans service tiers
  non libre pour la compilation elle-même).

## À refaire à chaque version publiée

F-Droid compile depuis un tag, avec un Gradle nu — pas de `-PversionCode` comme
en CI — puis **vérifie que l'APK obtenu porte bien la version annoncée par la
recette**. Trois endroits doivent donc dire la même chose, sans quoi le build
est rejeté :

1. `android/app/build.gradle` : les valeurs de repli `appVersionCode` /
   `appVersionName` (c'est ce que produit le Gradle nu de F-Droid) ;
2. `fdroid/eu.lielu.news.yml` : `versionName`, `versionCode`, `commit`,
   `CurrentVersion`, `CurrentVersionCode` ;
3. le tag git lui-même, `vX.Y.Z`, posé sur le commit publié.

L'ordre compte : le tag se pose **après** le commit qui aligne les deux
premiers, puisque F-Droid ne voit du dépôt que ce que contient le commit tagué.
Un tag posé trop tôt embarque l'ancien repli de `build.gradle` et fait échouer
la vérification de version — il faut alors le déplacer (`git tag -f`) plutôt
que de retoucher la recette.

Le `versionCode` se déduit de la version — majeur × 10000 + mineur × 100 +
correctif, soit `10100` pour 1.1.0 — donc il croît tout seul, sans compteur à
tenir. `package.json` suit aussi la version, mais seulement pour nommer les
APK produits par la CI.

## Ce qui reste à faire, à la main

**Ouvrir la demande d'inclusion**, sur GitLab : forker `fdroid/fdroiddata`,
ajouter `metadata/eu.lielu.news.yml` (le fichier ci-contre, tel quel) et ouvrir
une merge request — ou, plus simple pour un premier envoi, passer par leur
"Request For Packaging" : <https://gitlab.com/fdroid/rfp/-/issues>. Cette étape
ne peut pas être faite depuis ce dépôt GitHub.

Deux points à confirmer sur place, leur documentation étant inaccessible depuis
l'environnement de développement de ce dépôt (`f-droid.org` bloqué) :
`init:` s'exécute bien à la racine du dépôt cloné et non dans `subdir:`, et
`UpdateCheckMode: Tags` accepte bien une expression régulière en argument.

## Anti-fonctionnalités à déclarer

Aucune identifiée : les polices (Inter, Source Serif 4, licence OFL) sont
auto-hébergées dans `fonts/` depuis [le remplacement de Google Fonts](../fonts/),
donc plus de dépendance réseau à un service non-libre. Pas de pub, pas de
tracking, pas de dépendance propriétaire dans le code embarqué sur Android.
