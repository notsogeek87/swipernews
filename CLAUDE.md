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
npm test            # node --test — 59 tests, aucune dépendance à installer
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
- `articleMetaFor()` / `checkPaywall()` / `checkMissingImage()` — deux filets
  asynchrones, tous deux gated par `IntersectionObserver` (jamais pour tout le
  fil) et partageant le MÊME cache par lien (`ogCache`), pour ne jamais
  interroger deux fois la page d'un même article. `checkPaywall` (candidats
  seulement, voir `isPaywallCandidateDomain`) pose la pastille `$` si
  `isPaywalledHtml` confirme sur la vraie page (pas le domaine, qui ne sert
  que de préfiltre). `checkMissingImage` comble une image totalement absente du
  flux (contrairement à `applyBg`, qui ne s'occupe que d'une image trop
  petite).
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
| `MainActivity` | `registerPlugin(InAppBrowserPlugin)` **avant** `super.onCreate` ; `onResume()` évalue directement `loadFeeds()` dans la WebView — signal de reprise le plus fiable, sans passer par le pont `@capacitor/app` |
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
  le rendu qui suit gèle la tête du fil (`remix(true)`), donc la carte affichée
  survit — vérifié par le scénario `reprisewiki`.
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
  un plancher (`--systop-min`, 34 px) réservé aux écrans TACTILES et étroits en
  `display-mode:standalone/fullscreen` — une PWA de bureau est aussi
  « standalone » et n'a pas de barre d'état. La mesure native est un
  CHEVAUCHEMENT avec la WebView, jamais l'inset brut : si une couche quelconque
  a déjà décalé la WebView, elle rend 0 et rien n'est réservé deux fois.
  Le pied du panneau de réglages (`renderAbout`) affiche la marge réellement
  appliquée, lue sur le style CALCULÉ de `.top` : sans elle, un « ça rogne
  encore » n'est pas débogable — ni l'APK ni une PWA installée n'ont de barre
  d'URL où ajouter `?debug=1`.
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
- **Le mode lecture ne peut pas s'appliquer avant `onPageFinished`** (DOM
  incomplet ⇒ article tronqué). D'où le voile : on masque la WebView, on
  transforme, on révèle en fondu. Et `onPageFinished` lui-même n'est qu'un
  DÉBUT : un gabarit de presse moderne pose son texte plusieurs secondes plus
  tard, d'où l'échelle de tentatives (`READ_RETRY_MS`). Le voile, lui, ne tient
  que les deux premières (`READ_VEILED_TRIES`) — au-delà, mieux vaut une
  bascule tardive qu'un écran noir de cinq secondes.
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
comble le trou en jouant 23 scénarios réels dans Chromium, réseau entièrement
simulé (rien ne part vers une vraie source) : hors-ligne, réseau lent, coupure en
cours de requête, API en 500, RSS vide/tronqué/HTML, contenu démesuré, doublons,
120 sources, stockage et cache abîmés, quota saturé, actions enchaînées, retour
arrière, arrière-plan, relancement à froid, articles en mémoire.

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
