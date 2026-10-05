---
name: swipernews-natif-sans-sdk
description: Vérifier le code natif Android de SwiperNews (android/, Java, XML, scripts reader_*.js) quand le SDK Android est indisponible, ce qui est le cas dans l'environnement cloud. À utiliser après toute modification de android/ ou avant de pousser du natif, et pour savoir si un push déclenchera un build.
---

# Natif Android sans SDK

`dl.google.com` est bloqué : pas de SDK, donc pas de Gradle. On ne peut pas compiler `android/`, mais on peut attraper les erreurs de syntaxe, les XML mal formés et les scripts injectés cassés. Le reste se fait compiler par la CI.

## Vérifications

```bash
# Syntaxe Java : les erreurs « package android.* does not exist » et
# « cannot find symbol » sont NORMALES (pas d'android.jar). On cherche
# l'absence d'autre chose.
javac -d /tmp/out android/app/src/main/java/eu/lielu/news/*.java 2>&1 \
  | grep -vE "package .* does not exist|cannot find symbol|^import |^ *\^|symbol:|location:"

# XML bien formés
python3 -c "
import xml.dom.minidom,glob
for f in glob.glob('android/app/src/main/res/**/*.xml',recursive=True):
    xml.dom.minidom.parse(f)
print('XML OK')"

# Scripts injectés dans la WebView
node --check android/app/src/main/res/raw/reader_*.js
```

Sortie vide du `grep -v` = pas d'erreur de syntaxe. `/tmp/out` : préférer le scratchpad.

## Scripts injectés

`reader_cmp.js`, `reader_ads.js`, `reader_read.js` se testent avec `page.evaluate(fs.readFileSync(...))` dans Chromium (playwright-core, voir `swipernews-verifier`) sur une page piégée. Toujours inclure des **faux positifs** : un article qui parle de cookies, un conteneur `ad-…` portant une vraie image. C'est là que ces scripts dérapent.

## Pièges à relire avant de toucher au natif

- Commentaires XML : `--` interdit (écrire « accent », pas `--accent`).
- `setPadding()` écrase le padding du XML, insets compris.
- Insets : `getInsetsIgnoringVisibility`, pas `getInsets`.
- Ne jamais redimensionner la WebView pour animer la barre.
- Un rappel de `evaluateJavascript` peut s'exécuter après `onDestroy` : revérifier `web` et `readGen`.
- `MainActivity.onResume()` appelle `refreshIfStale()`, jamais `loadFeeds()`.

## Bump et CI

- Modification purement native : **aucun** bump de version web.
- Pousser une branche de travail seule ne déclenche **aucune** CI : ni compilation ni APK. Il faut `staging`, `main` ou une PR. Ne pas annoncer un build en attente après un simple push.
- Avant de compter sur la CI, penser à `npm run cap:sync` (en local) : sans lui, le projet natif contient l'ancien `index.html`.
