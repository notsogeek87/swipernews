---
name: swipernews-bump
description: Règle de version de SwiperNews. À utiliser dès qu'on modifie index.html ou src/*.js (même une ligne de CSS ou un texte), avant de commit ou de pousser — et aussi pour vérifier qu'un bump n'a pas été oublié. Incrémente APP_VERSION (index.html), le ?v= des balises script et CACHE (sw.js). Ne pas l'utiliser pour une modification purement native (android/).
---

# Bump de version SwiperNews

`index.html` et `src/*.js` forment un ensemble indivisible. Un module périmé en cache servi à un `index.html` neuf casse l'app entièrement : le `?v=` fait partie de l'URL, c'est ce qui l'empêche.

## Quand

- Modifié `index.html` ou un fichier de `src/` → bump obligatoire.
- Modifié seulement `android/`, `api/`, `test/`, `tools/`, docs → **aucun bump** (rien ne change côté web).

## Marche à suivre

1. Lire `APP_VERSION` dans `index.html` (`const APP_VERSION="N"`), calculer `N+1`.
2. Poser `N+1` à **trois** endroits :
   - `APP_VERSION` dans `index.html` ;
   - `CACHE = "flux-v<N+1>"` dans `sw.js` ;
   - le `?v=` de chaque balise `<script src="src/…">` dont le fichier a changé (les fichiers inchangés peuvent garder leur ancien `?v=`, c'est l'état normal du dépôt).
3. Lancer `bash .claude/skills/swipernews-bump/scripts/check.sh` : il échoue si `APP_VERSION` ≠ `CACHE`, si un `src/*.js` modifié (vs `HEAD`) n'a pas un `?v=` égal à `APP_VERSION`, ou si un `?v=` dépasse `APP_VERSION`.
4. Si le changement est visible de l'utilisateur, penser à l'entrée `CHANGELOG` (voir `CLAUDE.md`, entrée `CHANGELOG`).

## Pièges

- Un seul bump par lot de modifications, pas un par fichier.
- Ne jamais baisser un numéro.
- Un seul commit avec le bump et le changement qui le motive.
