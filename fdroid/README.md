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
- **`fdroid/eu.lielu.news.yml`** : brouillon de la recette de build, à adapter
  puis coller dans `metadata/eu.lielu.news.yml` sur `fdroiddata`.
- Licence MIT, permission Android unique (`INTERNET`), aucune dépendance
  Google Play Services / Firebase / SDK propriétaire — l'app remplit déjà les
  critères de base d'inclusion (logiciel libre, buildable sans service tiers
  non libre pour la compilation elle-même).

## Ce qui reste à faire, à la main

1. **Poser un tag git par version publiée** (ex. `v1.0.0`), avec un
   `versionCode` qui n'augmente qu'à chaque tag. Le schéma actuel
   (`.github/workflows/android.yml`) dérive le `versionCode` du numéro de run
   GitHub Actions, ce qui n'existe pas côté F-Droid : leur bâtisseur reconstruit
   depuis un commit/tag précis, donc la recette doit épingler ce tag et son
   couple version explicitement (voir les commentaires dans le `.yml`).
2. **Ajouter des captures d'écran** dans
   `fastlane/metadata/android/fr-FR/images/phoneScreenshots/` — F-Droid en
   demande au moins une pour la fiche. Aucune n'existe encore dans le dépôt.
3. **Ouvrir la demande d'inclusion** : sur GitLab, forker
   `fdroid/fdroiddata`, ajouter `metadata/eu.lielu.news.yml` (à partir du
   brouillon ci-contre) et ouvrir une merge request — ou, plus simple pour un
   premier envoi, passer par leur "Request For Packaging" :
   <https://gitlab.com/fdroid/rfp/-/issues>. Cette étape ne peut pas être faite
   depuis ce dépôt GitHub.

## Anti-fonctionnalités à déclarer

Aucune identifiée : les polices (Inter, Source Serif 4, licence OFL) sont
auto-hébergées dans `fonts/` depuis [le remplacement de Google Fonts](../fonts/),
donc plus de dépendance réseau à un service non-libre. Pas de pub, pas de
tracking, pas de dépendance propriétaire dans le code embarqué sur Android.
