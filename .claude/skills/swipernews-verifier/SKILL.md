---
name: swipernews-verifier
description: Vérifications avant de pousser du code SwiperNews (web). À utiliser après toute modification d'index.html, src/*.js ou api/*.js, quand on dit « vérifie », « teste », « c'est bon pour pousser ? », ou avant un commit. Enchaîne tests, lint, format, syntaxe du JS en ligne d'index.html, cohérence de version et choix des scénarios du banc de QA Chromium.
---

# Vérifier SwiperNews avant de pousser

`npm test` ne voit que `src/` et `api/`. Le JS en ligne d'`index.html` (fil, état, stockage) n'est couvert ni par eslint ni par les tests : c'est le banc de QA qui le couvre, et c'est lui qui a trouvé les pannes critiques de `AUDIT-ROBUSTESSE-2026-08.md`.

## 1. Rapide (toujours)

```bash
bash .claude/skills/swipernews-verifier/scripts/fast.sh
```

Il lance : `npm test`, `npm run lint`, `npm run format:check`, `node --check` sur chaque `<script>` en ligne d'`index.html`, puis `swipernews-bump/scripts/check.sh`. Ne pas reformater `index.html` (exclu de prettier à dessein : style dense).

## 2. Banc de QA (si le fil, le cache, l'état ou le stockage ont bougé)

Mise en place, hors `package.json` à dessein :

```bash
[ -d /tmp/qa/node_modules/playwright-core ] || npm i playwright-core --prefix /tmp/qa
(python3 -m http.server 8124 >/dev/null 2>&1 &)
NODE_PATH=/tmp/qa/node_modules node tools/qa-scenarios.js            # liste
NODE_PATH=/tmp/qa/node_modules node tools/qa-scenarios.js <scénario>
```

Chromium : `/opt/pw-browsers/chromium`. Arrêter le serveur ensuite.

Choisir les scénarios selon la zone touchée :

| Zone modifiée                           | Scénarios                                                      |
| --------------------------------------- | -------------------------------------------------------------- |
| chargement du fil, cache, `loadFeeds`   | `corruptcache`, `offline`, `autorefresh`, `lentnews`, `resume` |
| tête du fil, remontée, rafraîchissement | `forcetop`, `teteouverture`, `coursetete`                      |
| Wikipédia, ↻                            | `forcewiki`, `tetewiki`, `avancewiki`, `reprisewiki`           |
| ordre/équité des actus, « vu »          | `equite`, `redites`, `quitte`                                  |
| vidéo / YouTube                         | `video`, `shortsvide`                                          |
| flux invalides                          | `badrss`                                                       |
| mots masqués, pause, écoute             | `motsmasques`, `pausedouce`, `ecoute`                          |

En cas de doute sur la zone, tout rejouer. Après un changement du chargement, du cache ou de l'état, rejouer le banc entier.

## 3. Lignes qui ne sont PAS des régressions

`offline` → `net::ERR_INTERNET_DISCONNECTED` ; `back` → `PAGEERROR: Failed to read the 'localStorage' property` ; `shortsvide` → `ERR_CONNECTION_REFUSED`. Pour un doute, comparer à un checkout propre de `main` avant d'y voir une régression.

## 4. Rendre compte

Dire clairement ce qui a tourné et ce qui a échoué (sortie à l'appui), et ce qui n'a pas été joué. Ne pas annoncer « vérifié » sur la seule base de `npm test`.

## Pour exercer le natif depuis le navigateur

Voir `references/pont-capacitor.md` (simulateur du pont Capacitor à injecter avant le chargement).
