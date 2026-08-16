# Notes pour Claude Code

Ce fichier complète le README (qui, lui, explique le *pourquoi* de chaque choix
en détail). Ici : ce qu'il faut savoir avant de toucher au dépôt, et ce qui ne
se devine pas en lisant le code.

**Tout est en français** — commentaires, messages de commit, textes d'interface,
documentation. S'y tenir.

---

## À quoi sert ce projet

**SwiperNews** (`news.lielu.eu`) fait lire des articles au **swipe vertical
plein écran**, comme un fil de réseau social — une carte par article, un geste
pour passer à la suivante. **Un seul fil**, où deux natures d'articles alternent
à une cadence réglable (`MIX_LEVELS`, six crans de « Actus seules » à
« Wikipédia seul », défaut : trois actus pour un article) :

- **📰 les actus** — les flux RSS que l'utilisateur choisit lui-même. Pas
  d'algorithme, pas de recommandation, pas de compte : le fil est exactement la
  liste de sources cochées, et elle s'importe/s'exporte en OPML. Fini par nature
  (un RSS ne garde que ses N derniers items).
- **🎓 Wikipédia** — des articles tirés au hasard, filtrables par centres
  d'intérêt (sciences, histoire, espace…). Sans fin : c'est cette moitié qui
  rend le fil infini, y compris une fois les actus épuisées.

> Les deux **modes** (onglets Actus / Apprendre, bascule au balayage horizontal)
> ont été fusionnés en un fil unique. Il n'y a plus de variable `mode`, plus
> d'onglets, plus de jauge de progression (le fil n'a plus de fin) et plus de
> carte de fin. Les réglages des deux anciens modes vivent dans **un seul
> panneau** (⚙), et les deux filtres (source / centre d'intérêt) tiennent dans
> DEUX PASTILLES d'une seule rangée, qui ouvrent leur liste au toucher — les
> barres de puces défilantes coûtaient une rangée de plus et cachaient tout ce
> qui dépassait à droite. Les deux anciens modes restent atteignables comme les deux
> EXTRÉMITÉS de la dose — et chaque extrémité coupe vraiment l'autre moitié,
> réseau compris (`loadLearnPart` / `loadNewsPart` sortent aussitôt).

L'intention produit, qui explique beaucoup de décisions techniques : reprendre
le geste des réseaux sociaux **sans** ce qui va avec. D'où l'absence de compte
et de télémétrie, la reprise de lecture, le lecteur intégré sans barre d'URL, et
le refus de tout appel à un tiers non choisi.

## Ce qu'est ce dépôt

Une PWA **sans build ni dépendance à l'exécution** : `index.html` s'ouvre tel
quel dans un navigateur, y compris en `file://`. Autour, quatre choses
seulement :

| Dossier | Rôle |
| --- | --- |
| `index.html` | L'app entière : CSS et JS en ligne, ~2 100 lignes |
| `src/*.js` | Fonctions **pures** partagées avec les tests Node et `api/` |
| `api/*.js` | Fonctions serverless Vercel (proxy RSS, Wikipédia, image OG) |
| `android/` | Projet natif Capacitor (APK autonome, sans backend) |

L'outillage (lint, tests, CI) est optionnel et ne change rien au déploiement.

---

## Sur quoi ça tourne

Le **même** `index.html` sert les deux cibles. Ce qui change, c'est uniquement
la façon d'aller chercher les données — tout est branché sur `isNativeApp`.

### Web (PWA)

Hébergé sur **Vercel** : fichiers statiques + les fonctions de `api/`. Un
service worker (`sw.js`) sert l'app hors-ligne — `index.html` en **réseau
d'abord** (le cache ne sert que hors-ligne), les icônes et polices en cache
d'abord. `vercel.json` pose les en-têtes : CSP stricte, `Cache-Control`
immuable pour les polices et logos, `must-revalidate` pour `index.html` et
`sw.js`.

Un navigateur ne peut pas lire un flux RSS tiers (pas de CORS chez la plupart
des sources) : d'où `api/feed.js`, avec repli sur des proxys publics si le
backend est absent (GitHub Pages, `file://`). Wikipédia, elle, autorise le CORS
et se lit en direct.

### Natif (Android, Capacitor)

**Capacitor** empaquette `index.html`, `src/*.js`, le manifeste et les icônes
**dans l'APK** : l'app s'ouvre sans réseau. Elle tourne dans une WebView
système, avec un pont JS↔Java pour ce que le web ne peut pas faire.

Deux différences de fond avec le web :

- **aucun appel à `news.lielu.eu`** : l'APK ne dépend d'aucun backend. Les flux
  RSS passent par `nativeGet()`, qui appelle explicitement le plugin
  `CapacitorHttp` — le réseau natif Android, où le CORS (une politique de
  navigateur) ne s'applique pas ;
- **un navigateur intégré maison** pour lire les articles sans quitter l'app,
  avec ses modes et réglages (voir plus bas).

`webDir` pointe sur `www/`, un miroir **régénéré et non versionné** des
fichiers racine : `npm run cap:prepare` le recopie avant chaque `cap sync`. Ne
jamais éditer `www/`.

Cibles : `minSdk 24`, `compile/targetSdk 36` (`android/variables.gradle`).

---

## Compiler et publier

### Web

Rien à compiler. `python3 -m http.server 8000` suffit pour tester en local (le
service worker et l'installation PWA exigent HTTP, pas `file://`). Vercel
déploie `main` automatiquement.

### APK Android

`npm run cap:sync` d'abord — **toujours** : sans lui, le projet natif contient
encore la version précédente d'`index.html`, et on débogue un fichier qui n'est
pas celui qu'on vient de modifier.

```bash
npm ci
npm run cap:sync                # www/ régénéré puis recopié dans android/
cd android && ./gradlew assembleDebug
# → android/app/build/outputs/apk/debug/app-debug.apk
```

Version : `-PversionCode=N -PversionName=X` sont injectés par la CI ; en local,
`android/app/build.gradle` retombe sur `1` / `1.0`. Sans variables
d'environnement de signature (`ANDROID_KEYSTORE_FILE`, `…_PASSWORD`,
`ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`), Gradle utilise la clé debug :
installable pour tester, mais impossible à mettre à jour par-dessus.

**Rien de tout cela n'est faisable dans l'environnement de développement de ce
dépôt** (`dl.google.com` bloqué, donc pas de SDK) — voir la section suivante
pour ce qui reste vérifiable, et faire compiler par la CI.

### Ce que fait la CI (`.github/workflows/android.yml`)

`npm ci` → `npm run cap:sync` → `./gradlew assembleRelease` avec un
`versionCode` calculé (voir plus bas), APK signé depuis les secrets du dépôt,
puis publication en **release** : une par build sur `main`, une préversion
roulante sur `staging`.

> **Le `versionCode` d'un build CI se calcule depuis le littéral des sources**,
> il n'est pas le numéro de run : `versionCode(build.gradle) − 10000 + numéro
> de run`. Un APK de `main` est ainsi une **préversion** de la version que
> `build.gradle` prépare, rangée entre le tag précédent et celui à venir.
>
> Ne pas revenir au numéro de run nu, et ne pas l'*ajouter* au palier :
> - numéro nu → il vit sur une échelle sans rapport avec celle des tags (76
>   face à 10301), donc rétrogradation, donc APK ininstallable sans
>   désinstaller — c'est précisément le bug corrigé ;
> - ajout au lieu de soustraction → les builds CI passent au-dessus du tag de
>   leur propre version, qui devient à son tour ininstallable.

### F-Droid

`fdroid/eu.lielu.news.yml` est la recette à recopier dans `fdroiddata` ; elle
doit rester équivalente à `android.yml`, sans dépendre de GitHub Actions.
Conséquence pratique : **tout ce qui est nécessaire au build doit venir des
sources**, ce qui interdit d'embarquer quoi que ce soit sous une licence
incompatible avec le MIT (voir « décisions à ne pas défaire »).

La demande d'inclusion (`fdroiddata!44729`) est **ouverte, en cours de revue** —
rien n'est encore publié chez eux. La recette vise `AutoUpdateMode: Version` :
F-Droid suit les tags `vX.Y.Z` du dépôt, lit la version **dans les sources** et
ajoute lui-même l'entrée de build. Plus aucune démarche chez eux à chaque
version — mais cela ne tient qu'à une chose :

> **Publier une version = bumper `versionCode` et `versionName` dans
> `android/app/build.gradle`, dans le commit qui précède le tag `vX.Y.Z`.**
>
> `versionCode` = majeur × 10⁸ + mineur × 10⁶ + correctif × 10⁴ (1.3.2 →
> 103020000). Les quatre chiffres de queue restent à **zéro** ici : ils sont le
> palier dans lequel `android.yml` loge le numéro de run (voir ci-dessus).
> L'ancien barème (majeur × 10000 + mineur × 100 + correctif, 1.3.0 → 10300)
> a été élargi en 1.3.2 ; l'inflation est irréversible, un `versionCode` ne
> redescend jamais.
> Les deux valeurs sont écrites **en clair** dans `defaultConfig` : c'est la
> seule forme que sait lire l'analyseur de F-Droid. Ne jamais les remplacer par
> une variable Groovy ni par un `project.findProperty(…) ?: …` — l'écrasement
> par la CI vit exprès *après* le bloc `android`, ne pas le remonter dedans.

Taguer sans avoir bumpé ne casse rien, mais ne publie rien non plus : F-Droid
relit la même version, conclut « up to date » et ignore le tag — un silence
qu'on met des semaines à remarquer.

Second point non négociable depuis leur revue : la recette déclare `Binaries:`
et `AllowedAPKSigningKeys:` (**build reproductible**). F-Droid recompile le tag,
télécharge notre APK et refuse de publier si les deux diffèrent. Le tag doit
donc avoir fait tourner `.github/workflows/release.yml` — le seul qui compile
avec un **Gradle nu** (`android.yml`, lui, injecte le numéro de run dans la
version) et qui publie sous le nom exact attendu :
`releases/download/vX.Y.Z/swipernews-X.Y.Z.apk`.

Le détail est dans `fdroid/README.md`, avec ce que les passages de leur CI et la
revue de la MR ont appris.

---

## Règle non négociable : la version

> À **chaque** modification de `index.html` ou de `src/*.js`, incrémenter les
> **trois** en même temps :
>
> - `APP_VERSION` dans `index.html`
> - le `?v=` des deux balises `<script src="src/…">`
> - `CACHE` dans `sw.js` (`flux-vN`)

`index.html` et `src/*.js` forment un ensemble indivisible : servir l'un sans
l'autre casse l'app entièrement. Le `?v=` fait partie de l'URL, donc un module
périmé en cache ne peut pas être servi à un `index.html` neuf.

**Une modification purement native (`android/`) ne demande aucun bump** — rien
ne change côté web.

---

## Commandes

```bash
npm test            # node --test — 95 tests, aucune dépendance à installer
npm run lint        # eslint api src test eslint.config.js  (PAS index.html)
npm run format:check
npm run cap:sync    # régénère www/ puis cap sync android
```

`.prettierignore` exclut `index.html`, `README.md`, `AUDIT.md`, `android/` et
`www/` : le JS/CSS en ligne d'`index.html` est dense **à dessein**, ne pas le
reformater. Le style y est compact (peu d'espaces, accolades sur la même ligne)
— s'y conformer plutôt que d'y appliquer les habitudes de `src/`.

---

## CI : ce qui se déclenche, et ce qui ne se déclenche pas

`.github/workflows/ci.yml` (lint + format + tests) et `android.yml` (APK signé
+ release) ne tournent **que** sur un push vers `main` ou `staging`, ou sur une
*pull request*. `release.yml`, lui, ne se déclenche que sur un **tag** `vX.Y.Z`
(ou à la main, en donnant le tag) : c'est le build de publication, celui que
F-Droid vérifie.

> **Pousser une branche de travail seule ne déclenche RIEN.** Aucune
> compilation du code natif, aucun APK. Pour faire compiler du Java, il faut
> `staging`, `main`, ou ouvrir une PR. Ne pas annoncer un build en attente
> après un simple push de branche — il n'y en aura pas.

`main` et `staging` sont habituellement fast-forward depuis la branche de
travail (pas de commit de merge). Vercel déploie `main` pour le web.

---

## Environnement de développement : ce qu'on ne peut pas faire, et le contournement

**Il n'y a pas de SDK Android** (`dl.google.com` est bloqué par la politique
réseau). Impossible de lancer Gradle, donc impossible de compiler `android/`
ici. Ce qui reste possible, et qu'il faut faire systématiquement avant de
pousser du natif :

```bash
# Syntaxe Java : toutes les erreurs « package android.* does not exist » et
# « cannot find symbol » sont NORMALES (pas d'android.jar). Ce qu'on cherche,
# c'est l'absence d'erreur de syntaxe.
javac -d /tmp/out android/app/src/main/java/eu/lielu/news/*.java 2>&1 \
  | grep -vE "package .* does not exist|cannot find symbol|^import |^ *\^|symbol:|location:"

# Ressources XML bien formées
python3 -c "
import xml.dom.minidom,glob,sys
for f in glob.glob('android/app/src/main/res/**/*.xml',recursive=True):
    xml.dom.minidom.parse(f)
print('XML OK')"

# Scripts injectés dans la WebView
node --check android/app/src/main/res/raw/reader_*.js
```

Le JS en ligne d'`index.html` n'est pas couvert par eslint : l'extraire pour le
vérifier.

```bash
node -e 'const fs=require("fs"),h=fs.readFileSync("index.html","utf8");
const re=/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g;let m,i=0;
while((m=re.exec(h)))fs.writeFileSync("/tmp/chk"+(++i)+".js",m[1]);' \
  && for f in /tmp/chk*.js; do node --check "$f"; done
```

### Vérifier pour de vrai, dans un navigateur

Chromium est préinstallé. `playwright-core` s'installe dans le scratchpad (ne
pas l'ajouter au `package.json`) :

```bash
npm i playwright-core --prefix "$SCRATCHPAD"
# chromium : executablePath: "/opt/pw-browsers/chromium"
python3 -m http.server 8124   # servir le dépôt, puis http://localhost:8124/index.html
```

Pour exercer les chemins **natifs** depuis le navigateur, simuler le pont
Capacitor avant chargement — c'est ainsi qu'ont été vérifiés les réglages du
lecteur :

```js
await page.addInitScript(() => {
  // sinon le panneau d'accueil s'ouvre tout seul et bloque les clics
  localStorage.setItem("fluxswipe.interests.v1", JSON.stringify(["sciences"]));
  window.__opened = [];
  window.Capacitor = {
    isNativePlatform: () => true,
    Plugins: { InAppBrowser: {
      open: (o) => { window.__opened.push(o); return Promise.resolve(); },
      syncBlocklist: () => Promise.resolve({ count: 50047 }),
      clearBlocklist: () => Promise.resolve(),
    } },
  };
});
```

Les scripts injectés (`reader_cmp.js`, `reader_ads.js`, `reader_read.js`) se
testent directement avec `page.evaluate(fs.readFileSync(...))` sur une page
piégée — **toujours inclure des faux positifs** (un article qui *parle* de
cookies, un conteneur nommé `ad-…` qui porte une vraie image) : c'est là que ce
genre de script dérape.

---

## Carte du code

### Web (`index.html`)

- `isNativeApp` — vrai dans l'APK ; commande tout le comportement natif.
- `nativeGet()` — appelle **explicitement** `CapacitorHttp` pour les flux RSS
  seulement (pas de CORS côté natif). Ne **pas** réactiver `CapacitorHttp`
  globalement dans `capacitor.config.json` : mesuré nettement plus lent.
- `openArticle(url, title)` — point d'entrée unique du lecteur. Rend `false`
  quand le lien doit garder son comportement normal (`target="_blank"`).
- `renderReadPref()` / `PREFS` / `setPref()` — les réglages du lecteur, rendus
  dans le point de montage `[data-readmount]` du panneau unique.
- `newsItems` / `learnItems` / `remix()` — les DEUX réserves du fil et leur
  entrelacement. `items` n'est jamais construit à la main : il est toujours
  `mixLists(newsItems, learnItems, mixLevel())`, qui s'appuie sur `interleave`
  (fonction pure de `src/lib.js`, testée). Chaque moitié se charge et se rend de
  son côté (`loadLearnPart`, `loadNewsPart`), `remix()` recompose, `render()`
  réconcilie par lien — donc glisser un article entre deux cartes n'en recrée
  aucune.
- `MIX_LEVELS` / `mixScore` / `applyMix()` — la dose d'apprentissage. Le curseur
  vit dans DEUX `[data-mixmount]` (feuille de la boussole, panneau de réglages),
  un seul `renderMix()` les remplit ; il s'applique au `change`, jamais à
  l'`input` (sinon le fil se reconstruirait à chaque pixel du glissement). Elle ne déclenche AUCUN réseau : seule
  l'entrelacement change. `adoptItems()` remélange donc toujours ce qu'il reprend
  (cache, instantané), sinon une dose changée entre deux sessions servirait
  l'ancien mélange ; et `feedSnap` mémorise la dose, pour re-rendre quand
  l'instantané ne lui correspond plus.
- `renderFilters()` / `openPicker()` — les deux pastilles de filtre et leur
  feuille. `filterChips()` fabrique les puces une seule fois pour les deux, qui
  ne peuvent donc pas diverger. La barre du haut tient en DEUX rangées, un
  métier chacune : marque + boutons d'action (`.topline`), puis les filtres
  seuls (`.toprow.filters`, une moitié de largeur par pastille). Ne pas
  remettre les boutons avec les pastilles : à quatre icônes, elles retombent à
  « T… ». `filtersEl` EST la rangée — la masquer ne doit pas laisser une rangée
  vide, donc l'écart de 11 px qui la précède.
- `openHistory()` / `histRowHTML()` — la feuille « Articles en mémoire »
  (bouton liste de la barre du haut) : une VUE de `items`, refaite à chaque
  ouverture, qui ramène sur une carte dépassée d'un swipe de trop. Rien n'est
  stocké ni chargé — ce que le fil a jeté (tête au-delà de `MAX_ITEMS`,
  changement de filtre) n'y est pas, d'où le nom. Le retour se fait par
  `seenKey()`, JAMAIS par l'index de la rangée : un lot arrivé en arrière-plan
  entre l'ouverture et le toucher a pu réentrelacer le fil.
- `filterSponsored` / `isPromotionalItem()` (`src/lib.js`) — filtre sponsorisé
  ET bons plans, un seul réglage (case dans le panneau Sources, activée par
  défaut). Appliqué dans `fetchFeedRobust()`, donc identique web/natif sans
  aucun appel réseau. Détection par texte (titre/résumé/catégorie RSS) pour le
  sponsorisé ; par chemin d'URL (`/bons-plans/`) pour les bons plans — un titre
  de bon plan est en général purement descriptif (prix, produit), sans jamais
  dire « bon plan ».
- `videoIdOf()` / `startVideo()` / `stopVideo()` — les cartes vidéo. `youtubeId`
  (`src/lib.js`, testée) reconnaît le lien ; `videoIdOf` est le SEUL point de
  décision, parce que CINQ endroits en dépendent (la classe et les trois
  marqueurs de sonde dans `cardHTML`, l'image de secours dans `applyBg`) et que
  les laisser tester chacun de leur côté garantit qu'ils divergeront. UN lecteur
  au plus dans tout le fil, comme le rail de partage — et QUATRE points d'arrêt,
  aucun facultatif : `onCardChange` (on a quitté la carte), `unobserveCard` (elle
  quitte le fil), `render()` avant `insertBefore` (voir ci-dessous),
  `visibilitychange`/`openDialog` (sinon le son continue derrière). L'identifiant
  est concaténé dans l'`src` sans échappement, ce qui n'est légitime QUE parce
  que `youtubeId` ne rend rien d'autre que `[A-Za-z0-9_-]{11}` — même rôle que
  `oneOf()` côté natif. Scénario `video`.
- `urlDuFlux()` / `fluxShorts()` — l'URL réellement INTERROGÉE pour une source.
  Elle ne diffère de l'URL enregistrée que pour une chaîne YouTube, dont on
  interroge la playlist « Shorts » (`youtubeShortsFeedUrl`, `src/lib.js`, testée).
  Point de substitution UNIQUE, au moment de la requête : `feed.url` reste ce que
  l'utilisateur a ajouté ou importé, donc rien à migrer et un OPML exporté reste
  celui qu'on a importé. `fluxShorts()` pose la question séparément, parce que
  DEUX endroits doivent tolérer un lot vide de la part d'une chaîne sans Short —
  `fetchFeedRobust` (ne pas payer le repli rss2json) et `pump` (ne pas l'annoncer
  « injoignable »). Scénarios `video` et `shortsvide`.
- `titreDuFlux()` / `nomDeSource()` / `adopteNomDeSource()` — le nom d'une chaîne
  YouTube. Son URL ne contient qu'un `channel_id` OPAQUE, donc `addFeed` ne
  savait la nommer que `hostOf()` — « youtube.com », pour toutes : trois lignes
  identiques dans le panneau Sources et trois puces identiques dans le filtre.
  Le vrai nom n'existe que DANS le flux, on l'apprend donc au premier
  chargement (`pump()`, seul endroit qui tient à la fois le flux et sa réponse)
  et, à l'ajout manuel, par une requête EN ARRIÈRE-PLAN (`nommerChaine`) pour ne
  pas laisser « youtube.com » à l'écran jusqu'au chargement suivant. Le
  sélecteur est `feed > title, channel > title` — ENFANT DIRECT, sinon on
  ramasse le titre du premier article (ou le `<media:title>` de son
  `<media:group>`). Depuis les Shorts seuls, ce n'est plus le flux d'une CHAÎNE
  qu'on interroge mais celui d'une PLAYLIST auto-générée, dont le `<title>` est
  celui de la playlist (« Shorts », le même pour toutes les chaînes) : d'où le
  second argument de `titreDuFlux`, qui prend alors `feed > entry > author >
  name` — le seul endroit du flux où vit le nom de la chaîne. Sans lui, toutes
  les chaînes s'appelleraient « YT · Shorts », soit exactement le défaut qu'on
  avait corrigé. Effet de bord voulu : le tour de rôle des actus regroupe par
  `it.source`, donc cinq chaînes suivies ont maintenant cinq parts au lieu
  d'une seule partagée sous « youtube.com ».
- `persistFeeds()` vs `save()` — `save()` pose `feedsDirty` et re-rend les
  filtres ; RENOMMER une source ne change pas la liste de ce qu'on interroge, et
  passer par `save()` ferait recharger tout le fil au prochain « Voir mon fil »
  pour un simple libellé. D'où la persistance nue.
- `articleMetaFor()` / `checkPaywall()` / `checkMissingImage()` — deux filets
  asynchrones, tous deux gated par `IntersectionObserver` (jamais pour tout le
  fil) et partageant le MÊME cache par lien (`ogCache`), pour ne jamais
  interroger deux fois la page d'un même article. `checkPaywall` (candidats
  seulement, voir `isPaywallCandidateDomain`) pose la pastille `$` si
  `isPaywalledHtml` confirme sur la vraie page (pas le domaine, qui ne sert
  que de préfiltre). `checkMissingImage` comble une image totalement absente du
  flux (contrairement à `applyBg`, qui ne s'occupe que d'une image trop
  petite).
  **AUCUNE de ces sondes ne vaut pour une carte Wikipédia** : jamais payante,
  jamais sponsorisée, et son image vient de l'API, pas d'une page HTML tierce.
  `cardHTML` l'écarte des trois marqueurs (`data-pw`, `data-sponsor`,
  `data-noimg-link`) ; `applyBg`, longtemps la dernière à l'oublier, le fait
  maintenant aussi — et son test « rien à interroger » passe AVANT la mesure de
  largeur, qui ne servait qu'à décider de cet appel. Le motif vaut d'être
  retenu, il n'est pas évident : MediaWiki n'AGRANDIT jamais un raster, donc une
  vignette rendue sous `pithumbsize` dit que le fichier source est lui-même plus
  petit — l'`og:image` de l'article, plafonné à cette même source, ne peut pas
  faire mieux. Mesuré avant correction : 20 appels `/api/og` pour 20 cartes
  parcourues, soit une invocation serverless par carte en dose « Wikipédia
  seul ».
- `learnSpare` / `prefetchLearnSpare()` / `takeLearnSpare()` — le lot Wikipédia
  d'AVANCE, seul moyen de rendre le ↻ rapide sans toucher à la règle de cache
  ci-dessous (le lot reste réclamé au nonce, il est simplement demandé plus
  tôt). Réserve d'UN lot, ARMÉE seulement par un premier ↻ (qui n'utilise pas le
  bouton ne paie aucune requête de plus), à USAGE UNIQUE — `takeLearnSpare` la
  vide même quand elle ne convient pas, sinon elle reviendrait servir deux fois
  le même lot — et liée au fil qui l'a demandée (`key` = `feedKey()`), sinon un
  changement de langue ou de filtre se verrait servir le lot du fil précédent.
  Elle est REFILTRÉE au moment de l'usage, et pas seulement à sa constitution :
  `fetchLearn` applique bien `dropSeen`, mais AVANT que l'utilisateur ne lise,
  et entre les deux il a précisément passé son temps à lire. Le filet « tout est
  déjà vu » de `loadLearnPart` ne rattrapait pas ce cas — il ne se déclenche que
  si le lot est INTÉGRALEMENT vu, alors que le défaut ordinaire est partiel
  (mesuré : 5 cartes déjà lues sur 20 resservies au ↻ suivant). Sous
  `LEARN_SPARE_MIN` articles encore neufs (la moitié du lot), la réserve est
  jetée plutôt que servie maigre : autant payer le réseau et servir un lot
  entier. Scénario `avancewiki`.
- `hideSeen` — mode « Cacher les articles déjà lus du fil », une case posée
  dans la feuille « Articles en mémoire » (`openHistory`) mais qui ne
  commande QUE la RÉCUPÉRATION (`fetchLearn`, `loadLearnPart`,
  `takeLearnSpare`, le tri des files d'actus dans `rebuild`) — jamais la VUE
  de cette feuille elle-même. Défaut ACTIVÉ : c'est le comportement
  historique de l'app (voir `seenNews` ci-dessous), personne ne le voit
  changer tant qu'il ne touche pas la case.
  Une première version la faisait AUSSI filtrer la vue — cohérent en
  apparence (la case vit dans cette feuille), mais deux défauts opposés s'y
  sont succédé : d'abord la vue seule filtrait, donc la case décochée
  laissait quand même `dropSeen` écarter les articles déjà lus AVANT qu'ils
  n'atteignent la feuille (« je perds ceux que j'avais déjà vus au refresh ») ;
  corrigé en la faisant jouer sur les deux, retour explicite de l'utilisateur
  ensuite : la feuille « Articles en mémoire » doit rester un INVENTAIRE
  complet en toute circonstance, cochée ou non — c'est justement à ça qu'elle
  sert, retrouver un article même déjà lu. Elle distingue donc les articles
  déjà lus par un badge (`itemSeen`, dans `histRowHTML`), calculé sur l'état
  réel et totalement INDÉPENDANT de `hideSeen`.
- `ICON_*` / `setIcons()` — UNE famille de tracés pour toute l'app (2 px,
  boîte de 24, `currentColor`), posée aussi dans la barre du haut. Ne pas y
  remettre d'emoji ni de glyphe de police : ils ne s'alignent pas entre eux.
  Les emoji restent là où ils sont une valeur (badge de thème, puces de listes).
- `scrollToCard()` / `scrollFix` — le filet de repositionnement s'exécute une
  frame plus tard : sans son compteur de génération, celui d'un rendu dépassé
  revient défaire la décision du rendu suivant (une repeinture progressive
  ancrée sur l'article lu annulait le `forceTop` du rendu final).
- `feedKey()` — identité du fil : LANG, les deux filtres (source d'actu, thème
  Wikipédia). Cache local, `feedSnap` et test « même fil » en dépendent.
- `feedSnap` — état du fil mémorisé par filtre ; revenir à un filtre déjà vu ne
  recharge rien.
- `LANG` / `T()` / `src/i18n.js` — la couche de traduction de l'interface.
  Le français (`STRINGS.fr`) est la langue COMPLÈTE, source de vérité ; les
  autres langues (aujourd'hui `en`) sont des couches par-dessus, `T()` y
  retombe sur le français si une clé manque — ajouter une langue est donc
  incrémental. Un seul réglage pilote deux choses : les textes de l'app ET la
  langue interrogée sur Wikipédia (`LEARN.wikiUrl(catKey, LANG)`, `qByLang`
  dans `src/learn-core.js`) — changer de langue change donc aussi `feedKey()`
  et relance un chargement. `applyI18n()` traduit le HTML statique via
  `data-i18n`/`data-i18n-attr` ; le contenu généré (toasts, panneaux
  reconstruits) appelle `T()` directement. `catLabelT()` fait le pont avec les
  centres d'intérêt : le français lit `CATEGORIES.label` (`src/learn-core.js`)
  directement, les autres langues passent par `T("cat.<clé>")`.
  **Non traduits, par choix documenté dans `src/i18n.js`** : le contenu des
  articles (RSS, Wikipédia — aucun appel de traduction n'est fait) et
  `relTime()` (dates relatives toujours en français, à reprendre séparément).

### Natif (`android/app/src/main/java/eu/lielu/news/`)

| Fichier | Rôle |
| --- | --- |
| `MainActivity` | `registerPlugin(InAppBrowserPlugin)` **avant** `super.onCreate` ; `onResume()` évalue `refreshIfStale()` dans la WebView — signal de reprise le plus fiable, sans passer par le pont `@capacitor/app`. **Jamais `loadFeeds()` en direct** : voir la garde ci-dessous |
| `InAppBrowserPlugin` | Pont JS→natif : `open`, `share`, `saveFile`, `syncBlocklist`, `clearBlocklist`, `systemInsets` |
| `InAppBrowserActivity` | Le lecteur : barre escamotable, insets, injections. `applyWebPadding()` pose une **marge de vue** (`topMargin`), jamais un padding, sur `reader_web` — un padding ne pousse jamais un élément `position:fixed`/`sticky` (l'en-tête de la plupart des sites de presse), qui resterait donc caché sous la barre |
| `ReaderWebView` | Sous-classe minimale, seulement pour exposer `onScrollChanged` |
| `BlocklistStore` | Liste de blocage : parsing, téléchargement, cache, fusion |

Scripts injectés, dans `res/raw/` : `reader_cmp.js` (bandeaux de consentement),
`reader_ads.js` (emplacements publicitaires), `reader_read.js` (mode lecture),
`reader_blocklist.txt` (178 domaines intégrés).

**Les préférences vivent côté web** (localStorage) et sont transmises **à
chaque ouverture** (`hideCmp`, `blockAds`, `reader`, `readerSize`,
`readerTheme`). Le natif ne garde aucun état de préférence — seul le cache de
liste de blocage est persistant. Les deux dernières sont validées par `oneOf()`
puis posées telles quelles dans `window.__snRead` juste avant l'injection de
`reader_read.js` : c'est ce qui autorise à les concaténer sans les échapper.

---

## Décisions à ne pas défaire sans en parler

Elles ont toutes une raison, expliquée dans le README et dans les commentaires :

- **Les bandeaux de consentement sont MASQUÉS, jamais ACCEPTÉS.** Aucun bouton
  n'est cliqué. Ne pas répondre vaut refus ; un « Tout accepter » automatique
  donnerait un consentement que personne n'a voulu.
- **Le blocage des pubs est désactivé par défaut.** Il prive de revenu les
  éditeurs dont on lit les flux, et un mur anti-adblock donnerait une app qui
  « ne marche pas » à qui n'a rien demandé.
- **Les listes de blocage sont téléchargées, jamais embarquées.** Télécharger à
  l'exécution n'est pas redistribuer : c'est ce qui permet d'utiliser EasyList
  (CC BY-SA / GPL) sans changer la licence MIT du dépôt. Rien n'est téléchargé
  tant que l'utilisateur n'a pas choisi une source.
- **Le mode lecture ne touche pas aux pages de connexion** (`input[type=
  password]` ou URL évocatrice) : sans ça, plus de champ à remplir et plus
  d'autoremplissage possible sur les sites sur abonnement.
- **Une WebView maison, pas un Custom Tab** : le Custom Tab impose l'habillage
  de Chrome et une dépendance `androidx.browser`.
- **L'APK n'appelle jamais `news.lielu.eu`** : il va chercher chaque source
  directement depuis l'appareil.
- **Aucune donnée locale ne doit pouvoir empêcher le fil de se charger.** Tout ce
  qui vient du `localStorage` est validé, pas seulement `JSON.parse`é
  (`sanitizeFeeds`, `usableItem`, `readObject`), et la peinture du cache dans
  `loadFeeds` est enveloppée d'un `try/catch` : le chargement réseau part
  **quoi qu'il arrive**. C'est la leçon des deux pannes critiques de
  `AUDIT-ROBUSTESSE-2026-08.md` — `feeds` et le cache disque étaient lus sans
  garde, et une valeur d'une autre forme laissait l'app noire ou en chargement
  perpétuel **à vie**, sans aucune sortie depuis l'interface.
- **La reprise de lecture ne vaut que DANS la fenêtre de fraîcheur.** Rouvrir
  avant `AUTO_RELOAD_MS` ne déclenche aucun appel réseau : le fil est celui qu'on
  a quitté, on y revient à sa place. Au-delà — réouverture, filet des 30 min, ↻ —
  le fil est neuf et l'article le plus récemment publié est la première carte
  sous les yeux. `resumePending` est donc désarmé dans `loadFeeds` dès que
  `perime` est vrai, AVANT la peinture du cache : le défaire après coup
  repositionnait sur l'ancien article pour le quitter d'un saut une seconde plus
  tard (voir §2.3 de `AUDIT-ROBUSTESSE-2026-08.md`).
- **Les DEUX moitiés du fil partagent une seule décision de fraîcheur**
  (`perime`, calculé dans `loadFeeds`) : passé `AUTO_RELOAD_MS`, actus ET
  Wikipédia repartent ensemble. Wikipédia avait sa règle à part (« jamais
  remplacé tant que la réserve n'est pas vide ») ; conséquence, la moitié
  Wikipédia restait celle du premier chargement, rejouée depuis le cache disque à
  chaque ouverture, et ramenait des articles déjà lus. Le motif de l'exception
  (« remplacer ferait disparaître la carte en cours de lecture ») ne tient pas :
  passé le seuil, le fil est NEUF et remonte en tête de toute façon — la carte
  qu'on lisait n'a plus à être préservée (vérifié par `reprisewiki`).
- **Le GEL de la tête (`remix(true)`) est réservé aux APPOINTS**, jamais à un
  renouvellement. Il protège la carte sous le doigt et son aperçu d'un lot qui
  arrive en arrière-plan (dose montée, réserve qui se tarit, une source d'actu
  qui répond en retard). Appliqué à un renouvellement, il fait l'inverse de ce
  qu'on demande : il REPORTE dans le fil neuf les deux premières cartes de
  l'ancien. Les actus le savaient déjà (`rebuild(top)`/`flushRender` dans
  `loadNewsPart` : la repeinture finale ne gèle pas et remonte en tête) ; la
  moitié Wikipédia, elle, gelait TOUJOURS — donc à chaque ↻ les deux mêmes
  articles Wikipédia en tête, pendant que la suite se renouvelait. En dose
  « Wikipédia seul » rien ne rattrapait le défaut, les actus n'étant jamais
  chargées. D'où `renouv` dans `loadLearnPart`, distinct de `perime` (une
  retentative doit passer la garde de rechargement sans pour autant devenir un
  renouvellement) — scénario `tetewiki`.
- **« Le fil est lisible » et « le chargement est fini » sont DEUX moments
  distincts, et l'affichage ne doit attendre que le premier.** La repeinture qui
  montre les articles neufs quand un cache est déjà à l'écran — le cas de TOUTE
  réouverture au-delà des 30 min, `scheduleRender` se taisant tant qu'un cache
  est affiché — était celle de `finish()`, donc celle d'après la DERNIÈRE
  source. Une source morte tenant son emplacement jusqu'au bout de son budget,
  le fil affiché restait vieux de trente minutes pendant 24 s alors que 38
  sources sur 40 avaient répondu en moins de deux (mesuré, scénario `lentnews`).
  D'où `armerEcheance()` dans `loadNewsPart` : à `NEWS_DEADLINE_MS`, on peint ce
  qu'on a, en tête, et les retardataires s'insèrent ensuite par les repeintures
  progressives ordinaires. L'indicateur de chargement, lui, reste ALLUMÉ — le
  jeton et le `cacheSave` restent attachés à la repeinture finale (`cloture`),
  seule vraie fin. Ne pas les rattacher à l'échéance : elle peut être suivie de
  plusieurs autres lots.
  Corollaire indissociable : **on ne remonte en tête qu'UNE fois par
  chargement**. La règle produit « l'article le plus récent sous les yeux » est
  tenue par la première repeinture ; les suivantes gardent l'ancrage — les
  refaire arracherait à sa lecture quelqu'un qui a déjà commencé à glisser dans
  le fil neuf. Vérifié par `forcetop`, qui doit continuer à trouver l'index 0
  après ↻ ET après un rafraîchissement automatique.
- **La remontée en tête est un jeton PARTAGÉ par les deux moitiés**
  (`teteAPrendre(my)`), jamais un compteur par moitié. Chacune se rend de son
  côté sans consulter l'autre : `loadNewsPart` comptait ses propres repeintures
  et `loadLearnPart` remontait en tête à CHAQUE renouvellement, donc DEUX
  remontées par rafraîchissement dès que les deux moitiés ne répondaient pas
  ensemble — cas ordinaire, `/api/learn` étant souvent plus lent que les
  premières sources RSS. Vécu par l'utilisateur : le fil se rafraîchit, on
  remonte en tête, on glisse quelques cartes, puis le fil remonte tout seul une
  seconde fois sur la MÊME carte au moment où la barre de chargement s'éteint.
  Le jeton est ESTAMPILLÉ par la génération de chargement, jamais un booléen —
  un `my` neuf à chaque `loadFeeds` donne un jeton neuf sans rien à
  réinitialiser, et une génération abandonnée ne peut pas bloquer la suivante.
  Il se prend au moment du rendu RÉEL (après `whenFeedIdle`), pas à la
  programmation. Ce qui reste strictement local, c'est le GEL (`remix`) : un
  renouvellement ne gèle pas, qu'il ait obtenu la tête ou non — les deux notions
  se ressemblent mais ne se recouvrent pas. Troisième acte de `forcetop`, avec
  Wikipédia délibérément plus lent que l'échéance.
  **« Premier arrivé, premier servi » ne suffit PAS** : quand les actus vont se
  charger, la tête leur appartient, et `loadNewsPart` la RÉSERVE
  (`teteReservee=my`) dès qu'il sait qu'il va interroger ses sources, avant tout
  aller-retour. Wikipédia répond souvent avant elles (une requête contre
  quarante) et remontait alors en tête sur un fil dont les actus étaient encore
  celles du cache — donc rien de neuf en haut. Pire, cela DÉPOSSÉDAIT la
  repeinture des actus, la seule qui renouvelle vraiment le fil : privée du
  jeton, elle tentait de garder l'ancre — un article du cache qu'elle venait de
  retirer —, ne le trouvait pas (`i<0`), et retombait sur le `setScrollTopInstant(0)`
  de fin de `render()`. D'où DEUX remontées à l'ouverture, la seconde sans raison
  visible (mesuré : 1732 ms puis 2754 ms). Scénario `teteouverture`.
  Contrepartie ASSUMÉE de la réservation : si les actus se la réservent puis
  échouent toutes, personne ne remonte en tête pour ce chargement — ce qui est
  le bon comportement, rien de neuf n'étant arrivé côté actus.
- **`onResume()` natif appelle `refreshIfStale()`, JAMAIS `loadFeeds()`.**
  Le point de passage unique porte la garde « un chargement d'actus est déjà en
  vol » (`newsLoadingSeq`) ; en la contournant, le tout premier `onResume` — qui
  survient à l'OUVERTURE de l'app, pendant que le chargement de lancement dure
  encore — repartait de zéro. Une seconde génération, donc un second jeton de
  tête, donc une seconde remontée quelques secondes après la première, sur un
  fil que l'utilisateur avait déjà commencé à parcourir. Voir `MainActivity`.
- **Une source a UN budget, pas un délai d'expiration par étape**
  (`FEED_BUDGET_MS`, voir `fetchFeedRobust`). Les trois transports — backend
  same-origin, proxys publics en parallèle, rss2json — avaient chacun leur 7 s,
  et ils s'ADDITIONNAIENT : 21 s d'emplacement de parallélisme immobilisé par
  source morte. `fetchText` reçoit donc une fonction rendant le temps restant, et
  le repli rss2json n'est plus tenté quand il ne reste rien. Ce n'est pas une
  perte : rss2json vise les flux qu'on n'arrive pas à PARSER (échec rapide,
  budget quasi intact), pas ceux qu'aucun des six transports précédents n'a su
  joindre. `MAX_PARALLEL` est passé de 6 à 10 dans le même mouvement — le danger
  d'origine était de tout lancer d'un coup, or `MAX_FEEDS_PER_LOAD` borne déjà le
  lot à 40.
- **Les trois déclencheurs automatiques de fraîcheur passent par
  `refreshIfStale()`**, qui refuse d'en lancer un quand un chargement d'actus est
  déjà en vol : le filet tourne toutes les 60 s, un chargement de 40 sources dure
  souvent plus longtemps, et sans cette garde chaque tour relançait tout sans
  qu'aucun n'aboutisse. La garde est une ESTAMPILLE de génération
  (`newsLoadingSeq`), jamais un booléen — un drapeau posé par une génération
  abandonnée sur `my!==loadSeq` resterait vrai à vie et bloquerait alors tout
  rafraîchissement. Une action explicite (↻, réglages) préempte par
  `loadFeeds(true)`.
- **Tout texte venu d'un flux est borné** (`clampText`) : un `<description>` n'a
  aucune obligation d'être un résumé, et beaucoup de flux y publient l'article
  entier — mesuré à 400 Ko de cache pour cinq articles, contre ~5 Mo de quota.
- **L'ordre des actus est un TOUR DE RÔLE entre sources, jamais un tri par
  date.** C'est le même correctif, avec le même outil (`roundRobin`,
  `src/lib.js`), que pour les catégories Wikipédia juste en dessous — et contre
  le même symptôme. Un tri par date ENTERRE les sources lentes : une source à
  1 article/h a ses dix plus récents étalés sur dix heures, une à 50/h les a sur
  douze minutes ; classés ensemble par fraîcheur, les bavardes occupent tout le
  haut du fil, et on ne descend jamais jusqu'aux autres. Le plafond par source
  (`perFeed`) n'y changeait rien — le problème n'est pas COMBIEN une source
  livre, c'est OÙ ses articles atterrissent. Mesuré (scénario `equite`) : une
  source lente parmi quatorze bavardes obtenait UNE carte sur 120, en position
  94. Elle en obtient huit, la première en position 18.
  Deux détails à ne pas défaire :
  - à l'intérieur d'une file, le tri est « NON LU d'abord, puis la date » (voir
    l'entrée suivante), et les files sont classées par la date de leur TÊTE —
    c'est ce qui garde la carte 1 sur l'actu la plus récente, règle dont
    dépendent `forceTop`, la reprise de lecture, `forcetop` et `resume` ;
  - une file par NOM de source (`it.source`), pas par URL. Cocher cinq
    rubriques du même journal ne doit pas donner cinq parts : ce serait
    recréer à la main le déséquilibre qu'on corrige.
  Contrepartie assumée : le fil n'est plus « le plus récent d'abord » de bout en
  bout — la carte 2 peut avoir six heures pendant que la 25 en a dix.
- **Les actus lues sont MÉMORISÉES, et repoussées en fin de file — jamais
  retirées.** La mémoire « déjà vu » ne valait que pour Wikipédia, au motif
  écrit dans `markVisibleSeen` qu'« une actu sort naturellement du fil quand
  elle vieillit ». C'était vrai du tri par date, où un flot d'articles neufs
  poussait les vieux hors de la fenêtre. Ça ne l'est plus du tour de rôle : la
  file d'une source, ce sont SES plus récents quel que soit leur âge, donc
  l'article de tête d'une source horaire y reste une heure entière et revenait
  à CHAQUE rafraîchissement, à la même place. Mesuré (scénario `redites`) :
  UN SEUL article distinct d'une source lente sur quatre lectures ; quatre
  après correctif, sans qu'elle ait rien publié de neuf.
  Trois choix à ne pas défaire :
  - **mémoire SÉPARÉE** (`seenNews`, `fluxswipe.seennews.v1`), pas les 2000
    places de `seen`. Les actus défilent bien plus vite et évinceraient la
    mémoire Wikipédia, celle qui garde le fil infini varié ;
  - **clé = `canonicalLink` seul**, sans le titre. Plus court (2000 entrées
    `lien|titre` pèseraient ~400 Ko sur ~5 Mo de quota, d'où aussi le plafond
    plus bas, `SEEN_NEWS_MAX` = 800) et surtout c'est la clé qui reconnaît le
    MÊME article servi par deux flux avec des paramètres de suivi différents ;
  - **repoussés, jamais supprimés**. Retirer les lus viderait la file d'une
    source lente entièrement lue, et lui ferait reperdre la part que le tour de
    rôle vient de lui rendre.
  Conséquence sur la règle de tête, assumée et choisie : la carte 1 est
  l'article le plus récent **qu'on n'a pas déjà eu sous les yeux**, et non le
  plus récent dans l'absolu — rouvrir l'app sur la carte qu'on vient de lire
  n'apprend rien. Au premier chargement d'une session neuve, les deux
  définitions coïncident. « Vu » veut dire AFFICHÉ, pas ouvert : c'est la
  question à laquelle on répond.
- **« Vu » ne veut pas dire la même chose pour une VIDÉO.** Une carte d'article
  porte le titre, le résumé et l'image : l'avoir eue sous les yeux, c'est en
  avoir tiré ce qu'il y avait à en tirer. Une carte vidéo ne montre qu'une
  miniature — défiler devant ne l'a pas regardée. Elle est donc marquée au
  LANCEMENT (`startVideo`, et aussi « Ouvrir sur YouTube » : on part la regarder
  ailleurs, mais on la regarde), jamais par `markVisibleSeen`, qui l'écarte
  explicitement. Au lancement et non à la fin : on ne sait pas, depuis
  l'extérieur de l'iframe, quand une vidéo est finie.
  Contrepartie assumée et voulue : une vidéo qu'on ne lance jamais garde sa
  place en tête de la file de sa chaîne et revient à chaque rafraîchissement —
  c'est précisément le sens de « pas encore regardée », et c'est l'inverse du
  défaut corrigé juste au-dessus pour les actus. Scénario `video`.
- **D'une chaîne YouTube, on ne sert QUE les Shorts** — et le tri est fait par
  YouTube, jamais par nous. Rien dans l'Atom d'une chaîne ne distingue un Short
  d'une vidéo classique : pas de durée, pas de catégorie, et la même vignette
  `hqdefault.jpg` en 480×360 (la vidéo verticale posée au milieu). Trier après
  coup demanderait donc d'interroger la page de CHAQUE vidéo — une requête par
  carte croisée, ce que « aucun appel à un tiers non choisi » interdit. Toute
  chaîne a heureusement des playlists AUTO-GÉNÉRÉES, une par nature de vidéo,
  dont l'identifiant est celui de la chaîne privé de son `UC` : `UUSH…` les
  Shorts, `UULF…` les vidéos classiques, `UULV…` les directs. Elles s'interrogent
  sur le MÊME point d'entrée (`videos.xml?playlist_id=…`), donc sans requête de
  plus ni clé d'API. Trois points à ne pas défaire :
  - la substitution vit dans `urlDuFlux()`, au moment de la REQUÊTE — jamais
    dans le stockage. Réécrire `feed.url` demanderait une migration, changerait
    l'OPML exporté, et rendrait le choix irréversible ;
  - une playlist CHOISIE (`PL…`) est laissée telle quelle : il n'en existe
    aucune variante Shorts, et l'utilisateur a désigné celle-là ;
  - ces préfixes ne sont pas documentés par YouTube. S'ils disparaissaient, la
    source ne rendrait plus rien — jamais un fil rempli de vidéos classiques,
    ce qui est le bon côté pour tomber. Un flux VIDE est donc un résultat
    normal ici (chaîne sans Short) : ni repli rss2json, ni « injoignable »,
    voir `fluxShorts()`.
  Limite connue et assumée : si YouTube répond 404 au lieu d'un flux vide pour
  une chaîne sans aucun Short, elle retombe sur le chemin ordinaire et sera
  annoncée « injoignable ». Distinguer les deux demanderait de faire remonter
  le code HTTP à travers les six transports de `fetchText`, ce qui ne vaut pas
  ce cas — et ne coûte qu'un message inexact sur une source qui, de toute
  façon, ne servira aucune carte.
- **Une carte vidéo est une FAÇADE tant qu'on n'a pas appuyé sur ▶.** Miniature du
  flux + bouton ; l'iframe n'est créée qu'au toucher, et rien n'est demandé à
  Google pour une carte simplement croisée. Passer en lecture automatique (à la
  TikTok) ferait charger ~1 Mo de lecteur et contacter un tiers à CHAQUE carte
  du fil, pour une vidéo que personne ne regarde — ni la charge du fil ni
  « aucun appel à un tiers non choisi » ne le supportent. Le domaine est
  `youtube-nocookie.com`, jamais `youtube.com`.
- **Une carte vidéo est écartée des QUATRE sondes**, exactement comme Wikipédia et
  pour la même raison : la miniature vient du flux, et la page `watch?v=…` n'a
  rien de mieux. Ce qui la remplace est GRATUIT et vit dans `src/lib.js` :
  `YT_THUMB_W` apprend à `imageSizeFromUrl` et `upscaleImageUrl` que le NOM DU
  FICHIER (`hqdefault`, `maxresdefault`…) EST la taille. Renseigner
  `imageSizeFromUrl` n'est pas accessoire, c'est le garde-fou — YouTube répond
  **200 avec une image grise de 120 px** quand `maxresdefault` n'existe pas, et
  seule la largeur déclarée de l'originale (480) la fait rejeter par `applyBg`.
  Sans elle, `hintW` vaut 0 et l'image grise passe pour un agrandissement réussi.
- **Déplacer une carte qui joue RECHARGE son iframe.** Réinsérer un nœud qui en
  contient une détruit son contexte de navigation ; comme l'URL porte
  `autoplay=1`, la vidéo repartirait de zéro toute seule, au milieu d'une
  lecture, au moment où un lot d'actus arrive et décale la carte. D'où l'arrêt
  explicite dans `render()` AVANT `insertBefore`. À ne pas confondre avec une
  simple INSERTION devant la carte, qui ne touche pas à son nœud : là, la lecture
  doit continuer — c'est le cas courant, et l'interrompre serait un défaut à part
  entière. Le scénario `video` vérifie les deux.
- **Le nom d'une source n'est JAMAIS écrasé par ce que le flux annonce — sauf
  pour une chaîne YouTube.** Ailleurs, le nom enregistré est celui que
  l'utilisateur a choisi, importé d'un OPML ou laissé au nom d'hôte : le
  remplacer renommerait ses sources dans son dos. La chaîne YouTube est
  l'exception parce que son nom d'hôte ne distingue RIEN (voir `nomDeSource`).
  Le préfixe « YT · » est gardé exprès : il dit d'un coup d'œil de quoi il
  s'agit dans une liste de sites de presse, et il survit à la troncature d'une
  puce de filtre, qui coupe par la droite.
- **Le mode lecture n'est JAMAIS tenté sur une vidéo** (`openArticle(…,{noReader:true})`).
  `read` est le réglage par DÉFAUT, `reader_read.js` jette précisément
  `video,iframe,embed`, et une page YouTube n'atteint de toute façon jamais
  `MIN_SCORE` : « Ouvrir sur YouTube » livrait une page complète PLUS un toast
  d'échec du lecteur.
- **Dans un lot Wikipédia, la catégorie prime sur l'image.** `dedupAndRank`
  (`src/lib.js`) sert les catégories À TOUR DE RÔLE, une carte chacune ; le tri
  « avec image d'abord » ne joue plus qu'À L'INTÉRIEUR d'une catégorie. Le
  mélange global d'avant produisait des paquets, et le tri par image les rendait
  systématiques : la proportion d'articles illustrés varie énormément d'une
  catégorie à l'autre (un plat est presque toujours photographié, un jeu vidéo
  presque jamais sur fr.wikipedia, où la jaquette n'est pas libre), donc on
  lisait tous les plats PUIS tous les jeux vidéo. Remettre l'image en priorité
  globale relèguerait de nouveau en bloc toute catégorie peu illustrée. Le tri
  par image garde son effet là où il compte : la troncature à `count` prend les
  articles illustrés de CHAQUE catégorie avant ses articles nus.
- **Les catégories interrogées tournent d'un lot à l'autre** (`catKeysForBatch`,
  `catUsage`) : le tirage se fait parmi les MOINS RÉCEMMENT interrogées, pas au
  hasard. Un lot dure ~80 cartes à la dose par défaut ; avec un tirage
  indépendant, la même catégorie sortait deux ou trois lots de suite pendant que
  d'autres n'étaient jamais interrogées. Le vivier garde UNE catégorie de marge
  (`CATS_PAR_LOT + 1` au minimum) exprès : exiger des lots consécutifs disjoints
  figerait, à six intérêts cochés, deux trios qui ne se croiseraient jamais.

---

## Pièges rencontrés (ne pas les refaire)

- **`env(safe-area-inset-top)` ne suffit pas à éviter le poinçon de caméra** :
  sur WebView Android il ne décrit que la découpe d'écran, et plusieurs moteurs
  mobiles le rapportent à zéro. Or dès que la page occupe tout l'écran (APK —
  bord à bord imposé depuis `targetSdk 35` —, PWA installée, plein écran), son
  haut se dessine dans la bande de la barre d'état : un poinçon CENTRÉ tombe
  pile sur un bouton de la barre d'outils. Le CSS prend donc `max()` de TROIS
  sources, jamais d'une seule : l'inset CSS, la mesure native
  (`InAppBrowserPlugin.systemInsets` → `--systop`, voir `applySystemInsets`) et
  un plancher (`--systop-min`, 34 px) réservé aux écrans TACTILES et étroits
  dont RIEN n'occupe le haut de l'écran devant la page (`majPleinEcran()` →
  `html.plein`). Deux critères plausibles ont été essayés et sont FAUX : le
  `display-mode` (un navigateur mobile bord à bord dessine sous la barre d'état
  en se déclarant `browser`) et la comparaison `innerHeight`/`screen.height`
  (elle ne voit rien quand l'interface du navigateur est en bas — cas réel :
  384×736 sur un écran de 832, les 96 px manquants tous en bas). Le critère qui
  marche est `window.screenY` : au-delà de 0, une interface occupe déjà le haut.
  Les moteurs qui ne le renseignent pas rendent 0, donc on réserve — seul côté
  sûr, et presque gratuit : la barre du haut est un CALQUE, la bande ne pousse
  aucun contenu. La mesure native est un
  CHEVAUCHEMENT avec la WebView, jamais l'inset brut : si une couche quelconque
  a déjà décalé la WebView, elle rend 0 et rien n'est réservé deux fois.
  Le pied du panneau de réglages (`renderAbout`) a affiché un temps la marge
  réellement appliquée et la géométrie de la fenêtre, faute de barre d'URL où
  ajouter `?debug=1` dans l'APK ou une PWA installée. **Il ne dit plus que la
  version** : ces chiffres ne parlaient qu'à qui connaît `majPleinEcran`, et ils
  occupaient le pied de panneau pour tout le monde. Déboguer un « ça rogne
  encore » demande donc maintenant la console
  (`getComputedStyle(document.querySelector(".top")).paddingTop`,
  `window.screenY`) — c'est le coût assumé, ne pas remettre ces valeurs à
  l'écran sans en reparler.
- **Commentaires XML** : `--` y est interdit. Écrire `« accent »` plutôt que
  `--accent` en citant une variable CSS.
- **`setPadding()` écrase le padding du XML**, insets compris : ajouter la
  marge d'origine dans le code, pas seulement l'inset.
- **Insets et barre escamotable** : utiliser `getInsetsIgnoringVisibility`, pas
  `getInsets`. Masquer la barre d'état changerait sinon les marges, donc la
  zone de rendu, donc la mise en page du site — à chaque geste.
- **Ne jamais redimensionner la WebView pour animer la barre** : elle coulisse
  en `translationY` au-dessus, dans un `FrameLayout`.
- **Un `padding` ne déplace jamais un élément `position:fixed`/`sticky`**
  (modèle de boîte CSS, vrai pour tout moteur de rendu, pas une bizarrerie
  WebView). Une barre flottante posée par-dessus une WebView continue donc de
  recouvrir l'en-tête `position:fixed` d'un site, quel que soit le padding
  réservé — seule une vraie **marge de vue** (`topMargin`) réduit les bornes
  RÉELLES de la WebView, empêchant tout rendu (fixe ou non) sous la barre.
  Contrepartie : la marge ne peut pas suivre l'animation de la barre (voir le
  point précédent), donc la zone qu'elle occupe reste vide quand la barre
  s'efface, plutôt que de laisser le site en profiter.
- **Un lot Wikipédia RÉCLAMÉ ne doit passer par aucun cache HTTP.** Le chemin
  ordinaire de `/api/learn` porte un « seau » (`b=`) exprès cacheable et
  mutualisé — mais il y a DEUX caches dessus, et le bouton ↻ les traversait tous
  les deux : le CDN (`s-maxage=300`) repiochait dans les douze variantes déjà
  servies, et le navigateur, lui, resservait sa copie disque une heure durant
  (la réponse ne porte que `s-maxage`, ignoré d'un cache privé, plus
  `stale-while-revalidate=3600`) — donc ↻ pouvait ne rien envoyer sur le réseau.
  Symptôme : les actus se renouvelaient, la moitié Wikipédia restait la même,
  plusieurs ↻ de suite. Une demande explicite passe donc `frais` à `fetchLearn`,
  qui remplace le seau par un nonce ET pose `cache:"no-store"` ; `api/learn.js`
  répond alors `no-store`. Tous les autres appels de l'app le faisaient déjà
  (flux RSS, Wikipédia en direct) — celui-là seul l'oubliait. Scénario de QA :
  `forcewiki`.
  **Corollaire, et la seule bonne façon d'accélérer le ↻ :** puisqu'il paie le
  chemin complet par construction, on ne le rend pas rapide en lui rendant un
  cache, mais en ayant le lot DÉJÀ EN MAIN quand le doigt se pose — voir
  `learnSpare` dans la carte du code. Mesuré : 1 000 ms au premier appui (qui
  arme la réserve), ~80 ms aux suivants, sans aucune requête à l'appui.
  Ce qui a été envisagé puis ÉCARTÉ, pour ne pas y revenir : faire tirer au ↻
  un « seau » que la session n'a pas encore utilisé, au lieu du nonce. Le gain
  serait nul là où le besoin est — `catKeysForBatch` change le trio de
  catégories à CHAQUE appui, donc l'URL change avec lui, et la rotation sans
  remise évite justement les variantes que la session a déjà réchauffées. Il ne
  resterait que la mutualisation entre utilisateurs, invérifiable à ce trafic,
  et la garantie de fraîcheur serait perdue au passage.
- **`\b` juste après une lettre accentuée échoue TOUJOURS en JS**, y compris
  en fin de chaîne : sans indicateur Unicode, `\w` ne couvre que
  `[A-Za-z0-9_]`, donc `é`/`è`/… ne comptent jamais comme un caractère de mot
  pour `\b`. `/sponsoris[ée]\b/i` ne matche donc jamais « Sponsorisé » seul.
- **Parsing d'une liste de blocage** : `lemonde.fr##.banniere` est une règle
  *cosmétique*, pas une ligne hosts avec commentaire. La couper au `#` donne
  `lemonde.fr` et fait **bloquer le site**. Un `#` n'est un commentaire que
  détaché d'un mot. Et une IP n'est pas un domaine (`0.0.0.0 0.0.0.0` existe
  dans les vrais fichiers).
- **`getElementsByTagName("*")` ne rend pas la racine** : nettoyer aussi le
  nœud lui-même.
- **Toasts** : ne pas en poser un juste après un réglage — il se place devant
  le sélecteur qu'on vient de toucher. Faire parler l'interface à la place. Ni
  avant de savoir : l'export annonçait « Sources exportées » sans attendre, et
  mentait donc dans l'APK pendant des mois.
- **Un `<a download>` sur une URL `blob:` ne télécharge RIEN dans l'APK.** La
  WebView d'Android n'implémente pas l'attribut `download`, ne sait pas naviguer
  vers `blob:`, et Capacitor s'en désintéresse explicitement
  (`Bridge.launchIntent` rend `false` pour les schémas `data` et `blob`). Seule
  la WebView du lecteur a un `DownloadListener` ; celle du pont n'en a pas.
  Écrire un fichier depuis l'app passe donc par `InAppBrowserPlugin.saveFile`,
  qui l'écrit dans le cache, l'expose via le `FileProvider` du manifeste et
  ouvre `ACTION_SEND`. Le chemin navigateur reste celui du web.
- **Le mode lecture s'applique dès que le DOM est PARSÉ, pas quand la page a
  fini de CHARGER.** Il ne peut pas s'appliquer plus tôt (analyseur en cours ⇒
  article tronqué), mais attendre `onPageFinished`, qui répond à l'événement
  `load`, c'est attendre en plus les scripts tiers, les images et les cadres
  publicitaires — une à trois secondes de plus, à regarder un écran voilé alors
  que l'article était déjà là. D'où le guet (`watchDomReady`), qui interroge la
  page toutes les 80 ms depuis `onPageCommitVisible` et lance l'extraction au
  premier oui ; `onPageFinished` reste le repli pour les pages qu'il ne
  reconnaît pas, et `readChainGen` empêche les deux de lancer chacun leur
  chaîne. Le départ du guet est `onPageCommitVisible`, JAMAIS `onPageStarted` :
  au démarrage d'une navigation le document affiché est encore le précédent, et
  un rechargement le sert sous la même URL — on simplifierait une page sur le
  point d'être jetée. Ce que la sonde exige (URL, `readyState`, quatre `<p>`,
  feuilles de style chargées) est écrit dans son commentaire ; retenir surtout
  que `document.body.textContent.length` a été essayé et ne mesure RIEN (il
  compte le JSON des `<script>`, donc un squelette le franchit).
  Le voile, lui, ne change pas : on masque la WebView, on transforme, on révèle
  en fondu. Et le DOM parsé n'est qu'un DÉBUT : un gabarit de presse moderne
  pose son texte plusieurs secondes plus tard, d'où l'échelle de tentatives
  (`READ_RETRY_MS`), qui a gagné un palier en reculant son point de départ. Le
  voile ne tient que les deux premières (`READ_VEILED_TRIES`) — au-delà, mieux
  vaut une bascule tardive qu'un écran noir de cinq secondes.
- **Jeter la feuille du site RÉVÈLE ce qu'elle masquait.** Un site cache par
  CSS (pas par balisage) des légendes d'icônes, des métadonnées de citation,
  des intitulés d'accessibilité, des onglets repliés, une variante mobile de
  l'article entier — tout cela réapparaît en mode lecture. Le seul critère qui
  tienne est le rendu RÉEL (`getClientRects().length`), mesuré sur la page
  d'origine AVANT le clone : `style.display` en ligne ne voit presque rien, une
  classe ne se devine pas. La correspondance clone/original se fait par INDICE
  dans `getElementsByTagName("*")` — marquer les nœuds vivants invaliderait le
  style à chaque écriture, et chaque mesure suivante repaierait une mise en
  page. Deux garde-fous obligatoires : si le bloc lui-même n'a aucun rectangle
  (page pas encore mise en page, conteneur en attente d'hydratation), ne rien
  supprimer — tout serait supprimé ; et ne retirer que les racines masquées de
  MOINS de 200 caractères. **Masqué ne veut pas dire absent** : l'habillage
  mobile de MediaWiki (Minerva) ouvre TOUTES ses sections repliées, donc en
  `display:none` — sans ce seuil, l'article Wikipédia lu sur téléphone se
  réduit à ses titres. Perdre une section coûte infiniment plus cher que
  laisser passer un doublon masqué.
- **`display:block` sur un `<table>` coûte la mise en page de tableau.** Les
  lignes passent alors dans une table ANONYME dimensionnée sur son contenu :
  colonnes serrées à gauche, moitié droite vide, quelle que soit la largeur
  disponible (symptôme vu sur une infobox Wikipédia). Pour faire défiler un
  tableau trop large sans élargir la page, c'est une vraie ENVELOPPE
  (`div.sn-scroll` posée à l'élagage) qui porte l'`overflow-x`, jamais le
  tableau lui-même.
- **Un bloc rejeté ne doit pas emporter l'extraction entière.** Les garde-fous
  d'après élagage (trop peu de texte survivant, bloc hors sujet) s'appliquent au
  bloc le MIEUX NOTÉ — qui n'est pas toujours l'article : un bandeau de
  consentement resté dans le DOM, un tiroir de commentaires ou un gabarit
  englobant rassemblent souvent plus de texte. `reader_read.js` classe donc les
  candidats et essaie les cinq premiers, chacun devant passer les MÊMES
  garde-fous. Symptôme quand ce filet manquait : l'article s'ouvrait en page
  complète, alors que le bouton du lecteur, actionné à la main, le simplifiait
  sans peine (le DOM ayant bougé entre-temps).
- **Un rappel de `evaluateJavascript` est POSTÉ sur le fil principal**, donc il
  peut s'exécuter après `onDestroy` — où `web` vaut `null`. Chaque rappel doit
  reverifier `web` (et la génération `readGen`), y compris quand il ne fait
  qu'appeler un second `evaluateJavascript` imbriqué : c'est le NPE qui plantait
  l'app quand on refermait le lecteur juste après l'avoir ouvert.
- **`onReceivedError` sur la trame principale n'est pas définitif.** Une
  redirection abandonnée ou un lien suivi en déclenche un alors que la page
  suivante se charge très bien : l'écran d'erreur doit être effacé au DÉBUT de
  chaque navigation (`onPageStarted`), sinon il reste en travers d'un lecteur qui
  fonctionne.
- **Un `IntersectionObserver` retient FORTEMENT ses cibles.** Une carte retirée
  du DOM sans avoir jamais croisé l'écran (tout ce qu'un changement de dose
  écarte au-delà de l'horizon de 150 %) reste vivante toute la session si on ne
  l'`unobserve` pas — d'où `unobserveCard()` dans la boucle de retrait de
  `render()`.
- **Le retour arrière d'Android n'est intercepté par rien par défaut.** Un
  panneau ouvert, il QUITTE l'app (la WebView n'a pas d'historique, Capacitor
  referme l'activité). Les panneaux posent donc une entrée d'historique
  (`pushDialogState`) que `popstate` consomme. Corollaire : ne jamais passer
  `closeDialog`/`closePicker` directement en gestionnaire d'événement — le
  premier argument serait l'ÉVÉNEMENT, donc un `fromHistory` toujours vrai, et
  l'entrée ne serait jamais consommée.

---

## Banc de QA (`tools/qa-scenarios.js`)

`npm test` ne voit que `src/` et `api/` : **tout le JS en ligne d'`index.html`
— le fil, l'état, le stockage local — n'est couvert par aucun test**. Ce banc
comble le trou en jouant 32 scénarios réels dans Chromium, réseau entièrement
simulé (rien ne part vers une vraie source) : hors-ligne, réseau lent, coupure en
cours de requête, API en 500, RSS vide/tronqué/HTML, contenu démesuré, doublons,
120 sources, stockage et cache abîmés, quota saturé, actions enchaînées, retour
arrière, arrière-plan, relancement à froid, articles en mémoire, ↻ sur la moitié
Wikipédia (`forcewiki` pour le contenu du lot, `tetewiki` pour la TÊTE du fil —
les deux, parce que le premier ne voyait pas que les deux premières cartes, elles,
ne bougeaient jamais — et `avancewiki` pour la VITESSE du ↻, qui compte les
requêtes parties à l'appui et doit en trouver zéro dès le second).

`lentnews` est le pendant côté ACTUS de ces trois-là : il mesure une réouverture
au-delà des 30 min avec 40 sources dont 3 lentes et 2 mortes, et distingue deux
jalons que rien ne séparait avant — le moment où le fil AFFICHÉ devient neuf
(échéance) et celui où le chargement se termine VRAIMENT (budget par source).
Il vérifie aussi que le budget ne coûte RIEN en contenu : 120 actus retenues,
comme sans lui. Repères actuels : 2,6 s / 13,8 s, contre 24,6 s pour les deux
avant l'échéance.

`equite` mesure la place laissée à une source LENTE parmi des sources bavardes :
15 sources dont une à 1 article/h, et il vérifie les deux moitiés de la règle —
la lente revient régulièrement ET la carte 1 reste l'actu la plus récente.
Repères : 1 carte sur 120 (en position 94) avant le tour de rôle, 8 après.
`redites` en est le pendant indispensable : il parcourt VRAIMENT les cartes
(c'est l'affichage qui marque « vu ») puis compte ce qui revient après trois ↻.
Repères : 1 article distinct d'une source lente sur quatre lectures sans la
mémoire des actus, 4 avec — et zéro redite d'actu.

`video` joue un flux Atom de chaîne YouTube (avec son `<media:group>`, et un
`media:content` en pièce jointe vidéo qu'il ne faut pas prendre pour une image) et
vérifie cinq choses qui ne se lisent pas dans le code : que le lien et la
vignette sortent vraiment du parsing, que ZÉRO `/api/og` part sur ces cartes, qu'il
n'y a jamais deux lecteurs vivants, que `render()` distingue une carte
DÉPLACÉE (arrêt) d'un lot simplement INSÉRÉ devant (la lecture continue), et que
l'URL RÉELLEMENT interrogée est la playlist `UUSH…` (Shorts seuls) pendant que
l'URL enregistrée garde son `channel_id`. Le banc route `youtube-nocookie.com`
vers une page inerte : rien ne part vers Google. Son identifiant de chaîne a la
forme d'un vrai (`UC` + 22 caractères) — un identifiant fantaisiste ne serait pas
réécrit, et le scénario mesurerait le flux de la chaîne entière.

`shortsvide` en est le pendant : une chaîne qui ne publie AUCUN Short. Son flux
répond parfaitement, mais vide — et un flux vide ressemble à une panne. Il
vérifie qu'elle n'est pas annoncée « injoignable », qu'elle ne déclenche pas le
repli rss2json (une requête tierce par chargement et par chaîne, pour rien),
pendant qu'une source vraiment morte, elle, continue d'être signalée. Ses
`net::ERR_CONNECTION_REFUSED` sont le sujet du troisième point, pas une
régression.

`teteouverture` est le pendant de `forcetop` pour l'OUVERTURE à froid : cache
périmé peint tout de suite, les deux moitiés qui repartent, et l'utilisateur qui
glisse dès la première carte. Il compte les remontées en tête SUBIES — il en faut
exactement UNE — et journalise chaque `render()` avec son ancre, pour dire
laquelle des deux moitiés a provoqué le saut.

Deux d'entre eux signalent des lignes qui ne sont PAS des régressions, et qu'il
ne faut pas partir corriger : `offline` fait remonter des
`net::ERR_INTERNET_DISCONNECTED` (c'est son sujet) et `back` un
`PAGEERROR: Failed to read the 'localStorage' property` (il navigue exprès vers
`about:blank`, qui n'y a pas accès). Les deux sont présents à l'identique sur
`main` — les comparer à un checkout propre avant d'y voir autre chose.

```bash
npm i playwright-core --prefix /tmp/qa       # hors package.json, à dessein
python3 -m http.server 8124                  # servir le dépôt
NODE_PATH=/tmp/qa/node_modules node tools/qa-scenarios.js          # liste
NODE_PATH=/tmp/qa/node_modules node tools/qa-scenarios.js corruptcache
```

C'est ce banc qui a trouvé les deux pannes critiques de
`AUDIT-ROBUSTESSE-2026-08.md` — invisibles en lecture de code, parce qu'elles
supposent une donnée locale abîmée. À rejouer après toute modification du
chargement du fil, du cache ou de l'état.
