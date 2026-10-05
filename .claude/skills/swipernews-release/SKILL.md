---
name: swipernews-release
description: Publier une version de SwiperNews (APK, F-Droid, tag vX.Y.Z). À utiliser quand on dit « publie », « sors la 1.x.y », « release », « tag », « bump le versionCode » ou qu'on touche à versionCode/versionName de android/app/build.gradle. Calcule le versionCode, vérifie l'alignement avant le tag et rappelle ce que F-Droid exige (build reproductible).
---

# Publier une version SwiperNews

F-Droid suit les tags `vX.Y.Z`, lit la version **dans les sources** et ajoute lui-même l'entrée de build (`AutoUpdateMode: Version`). Rien d'autre à faire chez eux — tant que les sources disent la vérité au moment du tag. Taguer sans avoir bumpé ne casse rien mais ne publie rien : F-Droid conclut « up to date », et on ne s'en aperçoit que des semaines plus tard.

## Marche à suivre

1. Choisir `X.Y.Z`.
2. Calculer le code : `bash .claude/skills/swipernews-release/scripts/versioncode.sh X.Y.Z`
   (majeur × 10⁸ + mineur × 10⁶ + correctif × 10⁴ ; 1.3.2 → 103020000).
   Les quatre chiffres de queue restent à **zéro** : `android.yml` y loge le numéro de run (`versionCode − 10000 + run`), ce qui range les builds de `main` entre le tag précédent et le suivant.
3. Éditer `android/app/build.gradle`, dans `defaultConfig` : `versionCode N` et `versionName "X.Y.Z"` **en clair**. Ni variable Groovy, ni `project.findProperty(…) ?: …` : seule la forme littérale est lisible par l'analyseur de F-Droid. Ne pas remonter l'écrasement par la CI (il est volontairement après le bloc `android`).
4. Vérifier : `bash .claude/skills/swipernews-release/scripts/versioncode.sh X.Y.Z --check`.
5. Commit du bump (un `versionCode` ne redescend jamais, donc relire avant de pousser). `package.json` suit la version mais ne sert qu'à nommer les APK de la CI.
6. **Poser le tag après ce commit**, jamais avant : F-Droid ne voit que le contenu du commit tagué. Tag posé trop tôt → `git tag -f` plutôt que retoucher la recette.
7. Le tag doit avoir fait tourner `.github/workflows/release.yml` (Gradle nu, sans `-PversionCode`), qui publie `releases/download/vX.Y.Z/swipernews-X.Y.Z.apk`. C'est ce nom exact que F-Droid télécharge pour comparer à son propre build (`Binaries:` + `AllowedAPKSigningKeys:`). `android.yml` ne convient pas : il injecte le numéro de run dans la version.

## À confirmer avec l'utilisateur avant d'agir

Créer ou déplacer un tag, pousser vers `main`/`staging` et déclencher une release sont des actions visibles de l'extérieur : demander avant, ne pas déduire l'autorisation d'un « go » général.

## Voir aussi

`fdroid/README.md` (revue de la MR, passages de leur CI) et `fdroid/eu.lielu.news.yml`. Une modification purement native ne demande aucun bump web (voir `swipernews-bump`).
