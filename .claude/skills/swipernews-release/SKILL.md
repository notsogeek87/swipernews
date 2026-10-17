---
name: swipernews-release
description: Publier une version de SwiperNews (APK, tag vX.Y.Z). À utiliser quand on dit « publie », « sors la 1.x.y », « release », « tag », « bump le versionCode » ou qu'on touche à versionCode/versionName de android/app/build.gradle. Calcule le versionCode, vérifie l'alignement avant le tag.
---

# Publier une version SwiperNews

Le tag `vX.Y.Z` lance `release.yml`, qui lit la version **dans les sources** : taguer sans avoir bumpé publie donc l'ancienne version sous le nouveau nom.

## Marche à suivre

1. Choisir `X.Y.Z`.
2. Calculer le code : `bash .claude/skills/swipernews-release/scripts/versioncode.sh X.Y.Z`
   (majeur × 10⁸ + mineur × 10⁶ + correctif × 10⁴ ; 1.3.2 → 103020000).
   Les quatre chiffres de queue restent à **zéro** : `android.yml` y loge le numéro de run (`versionCode − 10000 + run`), ce qui range les builds de `main` entre le tag précédent et le suivant.
3. Éditer `android/app/build.gradle`, dans `defaultConfig` : `versionCode N` et `versionName "X.Y.Z"` **en clair**. Ni variable Groovy, ni `project.findProperty(…) ?: …` : la forme littérale est celle que relit `android.yml` avec `sed`. Ne pas remonter l'écrasement par la CI (il est volontairement après le bloc `android`).
4. Vérifier : `bash .claude/skills/swipernews-release/scripts/versioncode.sh X.Y.Z --check`.
5. Commit du bump (un `versionCode` ne redescend jamais, donc relire avant de pousser). `package.json` suit la version mais ne sert qu'à nommer les APK de la CI.
6. **Poser le tag après ce commit**, jamais avant : le build ne voit que le contenu du commit tagué. Tag posé trop tôt → `git tag -f`.
7. Le tag doit avoir fait tourner `.github/workflows/release.yml` (Gradle nu, sans `-PversionCode`), qui publie `releases/download/vX.Y.Z/swipernews-X.Y.Z.apk`. `android.yml` ne convient pas : il injecte le numéro de run dans la version.

## À confirmer avec l'utilisateur avant d'agir

Créer ou déplacer un tag, pousser vers `main`/`staging` et déclencher une release sont des actions visibles de l'extérieur : demander avant, ne pas déduire l'autorisation d'un « go » général.

## Voir aussi

Une modification purement native ne demande aucun bump web (voir `swipernews-bump`).
