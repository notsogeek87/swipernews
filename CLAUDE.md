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
à cadence fixe (`CONFIG.MIX_EVERY` : trois actus, un article Wikipédia) :

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
> panneau** (⚙), et les deux barres de puces (sources / centres d'intérêt) sont
> visibles ensemble.

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
npm test            # node --test — 37 tests, aucune dépendance à installer
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
  `interleave(newsItems, learnItems, MIX_EVERY)` (fonction pure de `src/lib.js`,
  testée). Chaque moitié se charge et se rend de son côté (`loadLearnPart`,
  `loadNewsPart`), `remix()` recompose, `render()` réconcilie par lien — donc
  glisser un article entre deux cartes n'en recrée aucune.
- `feedKey()` — identité du fil : les deux filtres (source d'actu, thème
  Wikipédia). Cache local, `feedSnap` et test « même fil » en dépendent.
- `feedSnap` — état du fil mémorisé par filtre ; revenir à un filtre déjà vu ne
  recharge rien.

### Natif (`android/app/src/main/java/eu/lielu/news/`)

| Fichier | Rôle |
| --- | --- |
| `MainActivity` | `registerPlugin(InAppBrowserPlugin)` **avant** `super.onCreate` |
| `InAppBrowserPlugin` | Pont JS→natif : `open`, `share`, `saveFile`, `syncBlocklist`, `clearBlocklist` |
| `InAppBrowserActivity` | Le lecteur : barre escamotable, insets, injections |
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

---

## Pièges rencontrés (ne pas les refaire)

- **Commentaires XML** : `--` y est interdit. Écrire `« accent »` plutôt que
  `--accent` en citant une variable CSS.
- **`setPadding()` écrase le padding du XML**, insets compris : ajouter la
  marge d'origine dans le code, pas seulement l'inset.
- **Insets et barre escamotable** : utiliser `getInsetsIgnoringVisibility`, pas
  `getInsets`. Masquer la barre d'état changerait sinon les marges, donc la
  zone de rendu, donc la mise en page du site — à chaque geste.
- **Ne jamais redimensionner la WebView pour animer la barre** : elle coulisse
  en `translationY` au-dessus, dans un `FrameLayout`.
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
  transforme, on révèle en fondu.
