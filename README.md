# Flux — actus RSS en swipe

Une application web (PWA) qui affiche des flux RSS en mode swipe vertical, à la TikTok.
Côté **exécution**, tout tient dans `index.html` : aucune dépendance, aucun build, ouvrable tel quel.
L'outillage de **développement** (lint, tests, CI) est optionnel et ne change rien au déploiement.

## Fonctionnalités

- Navigation par swipe vertical plein écran (flèches ↑↓ / espace au clavier aussi)
- La barre du haut se masque pendant le swipe et ne revient **que sur un appui à
  l'écran** (aucune réapparition automatique)
- Bascule **Actus / Apprendre au balayage horizontal**, mais uniquement quand la
  barre du haut est visible : pendant la lecture elle est masquée, et le geste
  est alors ignoré pour éviter tout changement de mode accidentel. Balayer vers
  la gauche amène l'onglet de droite, comme un carrousel. La bascule est
  accompagnée d'un glissement court avec fondu, dans le sens du geste — et vaut
  aussi pour un appui sur un onglet
- Reprise de lecture : l'app rouvre sur l'article quitté, **pour chaque mode
  indépendamment**. Si l'article a disparu du flux entre-temps (un RSS ne garde
  que ses N derniers items), la reprise se rabat sur le repère temporel puis sur
  l'index, au lieu de retomber en tête du fil
- Lisibilité sur photo : l'image n'est **jamais assombrie**, mais elle est floutée
  localement derrière le bloc de texte, et les textes portent un halo discret. Un flou
  supprime le détail sans changer la luminance — c'est le halo qui rend lisible sur un
  fond clair (ciel, neige)
- Titre, résumé, image, source et date tirés directement des flux RSS. Quand un
  article propose plusieurs tailles d'image, la **plus grande** est retenue (les
  flux listent la vignette en premier ; la prendre donnait des fonds flous)
- Gestion des sources : ajout, suppression, activation/désactivation
- Import / export des sources aux formats **OPML** (standard) et **JSON** — importe tes sources et lis-les directement
- Partage d'un article (feuille de partage native, ou menu WhatsApp / Telegram / mail / X / copie du lien),
  depuis un rail unique qui agit sur la carte affichée
- **Mode Apprendre** 🎓 : un sélecteur à deux onglets en haut (**📰 Actus** / **🎓 Apprendre**, l'actif surligné) bascule le fil vers des articles Wikipédia aléatoires pour swiper en apprenant. Le fil est **sans fin** — de nouveaux articles se chargent automatiquement en approchant du bas — le bouton **↻** repart sur une nouvelle fournée, et le mode est mémorisé entre les sessions.
- Installable comme application (PWA) avec fonctionnement hors-ligne
- En mode actus, si un flux est injoignable, le message le **nomme** (et le panneau
  Sources marque la ligne d'un badge « injoignable »), pour savoir quelle source
  corriger ou supprimer. Si toutes échouent, un message invite à réessayer ou à
  revoir ses sources (plus de faux contenu de démo)

## Mode Apprendre

Un bouton **🎓 Apprendre** (barre du haut) fait passer l'app en mode découverte :
le fil n'affiche alors que des articles **Wikipédia** tirés au hasard (titre, extrait,
image, lien vers l'article). L'ambiance change (accent cyan + badge) pour bien distinguer
les deux univers, et un nouvel appui sur **📰 Actus** revient aux flux RSS.

Une **barre de centres d'intérêt** (chips défilables sous les onglets) permet de choisir
ce qu'on veut apprendre : **Aléatoire** (défaut), Sciences, Histoire, Art & Culture,
Géographie, Nature, Espace, Technologie, Sport, Cinéma, Musique, Philosophie. Chaque
catégorie utilise le moteur de recherche de Wikipédia (`generator=search`,
`gsrsort=random`, `deepcategory:"…"`) pour tirer des articles au hasard dans la catégorie
et ses sous-catégories. Le choix est mémorisé et chaque catégorie a son propre cache.

### Source du mode Apprendre

Le fil s'appuie sur **Wikipédia** (API `action`, `generator=search`/`random`, extrait
d'intro + image), en français par défaut, pour toutes les catégories. Quand plusieurs
catégories sont interrogées pour un même lot (mode « Tous »), les résultats sont
dédoublonnés et mélangés (les cartes avec image d'abord).

## Lancer en local

Ouvrir `index.html` dans un navigateur suffit pour tester le swipe.

Pour que l'**installation PWA** et le service worker fonctionnent, il faut servir la page
en HTTP local plutôt qu'en `file://` :

```bash
python3 -m http.server 8000
# puis ouvrir http://localhost:8000
```

## Mise en ligne

- **Vercel (recommandé)** : connecter le dépôt (ou `vercel` en CLI). Vercel sert
  `index.html` en statique **et** déploie automatiquement la fonction `api/feed.js`,
  qui récupère les flux RSS côté serveur — c'est le chemin le plus fiable, sans aucun
  proxy tiers.
- **GitHub Pages / autre hébergement statique** : fonctionne aussi, mais sans backend :
  l'app se rabat alors sur les proxys publics (moins fiables). Settings → Pages →
  Branch `main`.

## Récupération des flux (mode actus)

Un navigateur ne peut pas lire un flux RSS directement (CORS). Pour chaque source, l'app
essaie donc, dans l'ordre :

1. **Backend same-origin** `api/feed.js` (`/api/feed?url=…`) — présent si l'app est
   déployée sur Vercel (ou tout hébergeur avec fonctions). Aucun CORS, aucun tiers :
   c'est le plus fiable ;
2. une liste de **proxys CORS publics** (allorigins, corsproxy.io, codetabs, thingproxy)
   avec parsing XML dans le navigateur ;
3. **rss2json** (`api.rss2json.com`) en dernier repli.

### Beaucoup de sources (OPML importé)

Un export Feedly peut contenir plusieurs centaines de flux. Trois garde-fous :

- **au plus 40 sources interrogées par chargement**, en rotation d'un chargement
  à l'autre pour que toutes finissent par passer ;
- **6 flux récupérés à la fois** : sans cela, 300 sources lançaient 300 chaînes
  de requêtes simultanées (chacune essayant le backend puis cinq proxys) et la
  quasi-totalité échouait ;
- **part maximale par source** = `MAX_NEWS / nombre de sources`, avec un minimum
  de 10. Avec peu de sources il n'y a donc aucune limite pratique ; avec des
  centaines, aucune ne peut occuper tout le fil ;
- **repeinture groupée** : le fil n'est pas reconstruit à chaque source qui répond.
  Avec 40 sources cela faisait 40 reconstructions en quelques secondes, et comme
  le fil est trié par date, chaque source insérait ses articles au milieu — les
  cartes bougeaient sans arrêt. Les résultats sont accumulés et le fil repeint au
  plus une fois par fenêtre : 40 repeintures tombent à 5, sans rien perdre.
  La première fenêtre est courte (le contenu doit apparaître vite), les suivantes
  plus larges (le fil doit cesser de bouger).

Pendant qu'un chargement se poursuit en arrière-plan, une fine barre en haut de
l'écran l'indique. Elle ne bloque rien : le fil déjà affiché reste lisible.

Les articles datés **dans le futur** de plus de deux jours (agendas de concerts,
annonces de festivals) sont classés en fin de fil comme les articles sans date :
ce ne sont pas des actualités récentes, et ils monopolisaient sinon la tête du fil.

### Rapidité

- Les proxys de secours sont interrogés **en parallèle** (le premier qui répond gagne), au lieu d'un par un.
- Les derniers articles sont **mis en cache** (localStorage) : au lancement suivant, ils s'affichent instantanément pendant que le fil se rafraîchit en arrière-plan (et le cache est conservé si le réseau échoue).
- En mode Apprendre, un **seul lot** d'articles est chargé au démarrage ; le scroll infini complète le reste.
- Les cartes hors écran sont **ignorées par le moteur de rendu** (`content-visibility`) et
  leurs images ne sont chargées qu'à l'approche de l'écran : un fil de 120 cartes plein
  écran ne garde plus 120 images en mémoire.
- Le fil est **réconcilié par clé** (le lien de l'article) au lieu d'être réécrit : les
  cartes déjà affichées sont déplacées, jamais recréées. Sans cela, le rendu progressif
  du mode Actus (un rendu par flux qui répond) détruisait et recréait l'image visible à
  chaque réponse — elle clignotait.
- Au tout premier lancement, rien n'est chargé derrière l'écran des centres d'intérêt :
  le fil est chargé une seule fois, après le choix.
- `/api/learn` répond sur l'une de quelques variantes tirées au sort, donc **cacheables
  par le CDN** et mutualisées entre utilisateurs (un nonce par requête empêchait tout cache).

### Quand le fil Actus se recharge-t-il ?

- à l'ouverture de l'app (si vous étiez en Actus), au bouton **↻**, à la première
  bascule vers Actus dans la session, via « Voir mon fil », après un import de
  sources, ou depuis la carte de fin de fil ;
- **au retour d'arrière-plan**, si le dernier chargement réussi date de plus de
  **5 minutes**. Ce seuil s'aligne sur le cache CDN du proxy (`s-maxage=300`) :
  en deçà, la requête renverrait de toute façon le même contenu. La position de
  lecture est conservée (le fil se réancre sur l'article affiché), et le mode
  Apprendre est exclu — son fil est un tirage aléatoire sans fin, le recharger
  ferait perdre le lot en cours.

Un rafraîchissement ne vide jamais un fil déjà affiché : si le réseau échoue, le
contenu reste à l'écran avec un simple message.

Si toutes les sources échouent au tout premier chargement, l'app **n'affiche plus de contenu de démo** : elle montre
un message d'erreur avec les boutons *Réessayer* et *Ouvrir les sources*. Pour une fiabilité
maximale (et pour ne dépendre d'aucun tiers), prévoir un petit backend qui récupère et
parse le RSS côté serveur.

## Développement

Le cœur de l'app reste sans build. Un petit outillage est fourni pour la qualité :

```bash
npm ci            # eslint + prettier (dev uniquement)
npm run lint      # analyse statique de api/, src/ et des tests
npm run format    # formatage (index.html volontairement exclu)
npm test          # tests unitaires (assainissement, parsing, noyau Apprendre, anti-SSRF)
```

La CI GitHub Actions (`.github/workflows/ci.yml`) rejoue lint + format + tests sur chaque PR.

### Diagnostiquer une image floue

Ouvrir l'app avec `?debug=1` : un encadré affiche, pour la carte visible, la
provenance de l'image (`content` / `thumbnail` / `enclosure` / `description`), la
largeur **déclarée** par le flux, la largeur **réelle** du fichier chargé, et
l'URL utilisée. Si la taille réelle est très inférieure à l'écran, c'est le flux
qui ne publie qu'une petite image.

### Mise à jour d'une app installée (PWA)

Une PWA installée n'est qu'une **coquille qui ouvre cette URL** : mettre le site
à jour met l'app à jour. L'utilisateur n'a **jamais** à la réinstaller.

Trois mécanismes garantissent qu'il tourne sur la dernière version :

1. `index.html` et `src/*.js` sont servis **réseau d'abord** par le service
   worker, et les modules portent un `?v=` — un lancement avec du réseau donne
   donc déjà la dernière version ;
2. `sw.js`, `index.html` et le manifeste sont servis en `max-age=0,
   must-revalidate` (`vercel.json`), donc aucun intermédiaire ne peut épingler
   une ancienne version ;
3. une app **restée ouverte** plusieurs jours ne renavigue jamais : au retour
   d'arrière-plan, elle vérifie s'il existe une nouvelle version (au plus une
   fois par quart d'heure) et l'applique si l'absence a duré plus de 30 s — la
   position de lecture étant restaurée, le rechargement passe inaperçu.

### ⚠️ Versionner la coquille à chaque modification

`index.html` et `src/*.js` forment un **ensemble indivisible** : servir un `index.html`
neuf avec un `src/lib.js` périmé casse l'app entièrement (fil sans images ni
interactions). Le déploiement en a déjà fait les frais une fois.

Après **toute** modification de `index.html` ou de `src/*.js`, incrémenter le même
numéro aux **deux** endroits :

| Fichier | Ligne à changer |
|---|---|
| `index.html` | `<script src="src/lib.js?v=N">` et `src/learn-core.js?v=N` |
| `sw.js` | `const CACHE = "flux-vN"` |

Trois garde-fous rendent l'oubli non catastrophique, mais ils ne dispensent pas du geste :

1. `index.html` et `src/*.js` sont servis **réseau d'abord** par le service worker
   (le cache ne sert qu'hors-ligne) ;
2. le `?v=` fait partie de l'URL, donc un module d'une autre version n'est jamais
   servi depuis le cache à un `index.html` neuf ;
3. au chargement, `index.html` vérifie que les modules exposent bien ce qu'il attend ;
   sinon il purge caches et service worker et recharge une fois, puis affiche un
   message explicite plutôt qu'une interface à moitié morte.

## Générer un APK Android (facultatif)

L'app s'installe déjà en PWA depuis le navigateur. Un **APK** apporte deux choses :
l'installation par fichier (sans passer par le menu du navigateur) et, surtout, un
`targetSdkVersion` à jour — ce qui évite l'avertissement Play Protect « conçue pour
une version plus ancienne d'Android » que produisent certains navigateurs quand ils
fabriquent eux-mêmes le paquet.

Le format adapté est une **TWA** (Trusted Web Activity) : un APK minimal qui affiche
ce site en plein écran, sans barre d'URL. Le contenu reste celui du site, donc les
mises à jour continuent de se faire sans réinstaller.

### Le plus simple : PWABuilder

1. Aller sur <https://www.pwabuilder.com>, saisir `https://news.lielu.eu` ;
2. choisir **Android → Generate Package**. Laisser PWABuilder créer la clé de
   signature, et **télécharger le paquet complet** (il contient l'APK, le `.aab`,
   la clé `signing.keystore` et le fichier `assetlinks.json` déjà rempli) ;
3. copier le contenu de leur `assetlinks.json` dans `well-known/assetlinks.json`
   de ce dépôt, puis redéployer. Sans cette étape, l'app fonctionne mais affiche
   une barre d'URL en haut ;
4. transférer l'APK sur le téléphone et l'installer.

**Conserver la clé de signature** (`signing.keystore` et son mot de passe) : sans
elle, aucune mise à jour de l'APK ne pourra être installée par-dessus.

### En ligne de commande : Bubblewrap

```bash
npm install -g @bubblewrap/cli
bubblewrap init --manifest https://news.lielu.eu/manifest.webmanifest
bubblewrap build          # produit app-release-signed.apk
bubblewrap fingerprint    # empreinte SHA-256 à coller dans well-known/assetlinks.json
```

Bubblewrap télécharge lui-même le JDK et le SDK Android au premier lancement
(~1 Go). Cela **ne peut pas être fait depuis l'environnement de développement de
ce dépôt** : `dl.google.com`, seul hôte fournissant le SDK Android, le plugin
Gradle Android et `androidx.browser`, y est bloqué par la politique réseau.

### Alternative : app embarquée hors-ligne (Capacitor)

La TWA ci-dessus reste un rideau sur `https://news.lielu.eu` : sans réseau au
lancement, elle ne s'ouvre pas. [Capacitor](https://capacitorjs.com) embarque
au contraire `index.html`, `src/*.js`, le manifeste et les icônes **dans
l'APK** : l'app s'ouvre hors-ligne. Capacitor refuse que `webDir` pointe sur la
racine du dépôt ; `npm run cap:prepare` régénère donc un dossier `www/`
(ignoré par git, simple copie des fichiers racine) avant chaque `cap sync`, ce
qui reste sans étape de build JS — juste une copie.

Les données, elles, restent réseau (flux RSS, Wikipédia) — c'est inhérent à une
app d'actualités — mais l'app packagée n'appelle **jamais** `news.lielu.eu` :
elle va chercher chaque source directement depuis l'appareil, sans dépendance
au backend Vercel.

Un navigateur ne peut normalement pas lire un flux RSS tiers (pas de CORS chez
la plupart des sources) — d'où `api/feed.js` et son repli proxys publics côté
web. Wikipédia, elle, autorise déjà le CORS et se lit en direct dans n'importe
quel navigateur (voir `srcWikipedia` dans `index.html`). Dans l'APK, seuls les
flux RSS ont donc besoin d'un contournement : `nativeGet` (`index.html`)
appelle *explicitement* le plugin `Capacitor.Plugins.CapacitorHttp`, qui route
la requête par le réseau **natif** Android au lieu de la WebView — le CORS,
qui est une politique de navigateur, ne s'applique alors plus du tout, avec un
timeout natif fiable (`connectTimeout`/`readTimeout`).

Une première tentative activait `plugins.CapacitorHttp` **globalement**
(`capacitor.config.json`), ce qui patche `fetch()` pour absolument tout —
y compris Wikipédia, qui n'en avait pourtant pas besoin — et s'est révélée
nettement plus lente à l'usage. Mesuré sur l'émulateur Android local après
être passé à un appel ciblé (`nativeGet` uniquement pour RSS) : ~3,2 s pour
charger 4 flux RSS en parallèle — un lot Apprendre (Wikipédia seul, en CORS
direct) reste comparable à ce qu'on peut attendre sur le web.

```bash
npm install
npm run cap:prepare    # copie index.html/src/manifeste/icônes dans www/
npx cap add android    # génère le projet natif dans android/ (télécharge le SDK
                        # Android — même limitation réseau que Bubblewrap ci-dessus,
                        # à faire hors de cet environnement)
npm run android:open   # ouvre android/ dans Android Studio pour builder/signer
```

Après la première génération, `npm run cap:sync` (prepare + `cap sync
android`) suffit à répercuter une modification de `index.html`/`src/*.js` dans
le projet natif avant de rebuilder.

Contrairement à la TWA, la coquille embarquée ne se met **pas** à jour
automatiquement avec le site : republier l'APK (nouvelle build signée avec la
même clé) est nécessaire après toute modification de `index.html` ou de
`src/*.js`.

**Icône et écran de démarrage** : générés par [`@capacitor/assets`](https://github.com/ionic-team/capacitor-assets)
à partir de `resources/` (icône `icon.png` = `logo-512.png`, calque adaptatif
`icon-foreground.png` = `logo-maskable-512.png` déjà en zone de sécurité,
fond uni `icon-background.png`/écran de démarrage `splash*.png` à la couleur du
thème `#0a0a0f`). Après une mise à jour du logo à la racine, régénérer avec :

```bash
cp logo-512.png resources/icon.png
cp logo-maskable-512.png resources/icon-foreground.png
npm run android:assets
```

`/logo-*.png` est servi avec un `Cache-Control` **immutable** d'un an
(`vercel.json`) : à URL identique, un logo mis à jour resterait invisible en
cache CDN/navigateur pendant un an, même après un bump de `CACHE` (`sw.js`).
Après toute modification des `logo-*.png` à la racine, incrémenter le `?v=`
qui les accompagne partout où ils sont référencés (`index.html` : favicon,
apple-touch-icon, og:image/twitter:image, logo de l'en-tête ;
`manifest.webmanifest` ; `SHELL` dans `sw.js`) — même mécanisme que le `?v=`
des modules `src/*.js`.

### Build automatique de l'APK (GitHub Actions)

Ce que Vercel fait pour le web, `.github/workflows/android.yml` le fait pour
l'APK Capacitor : **chaque push sur `main` ou `staging`** (et chaque *pull
request*) synchronise `index.html`/`src/*.js` dans le projet natif et lance
Gradle. Aucun Android Studio n'est nécessaire — le SDK est installé sur le
*runner*.

Où récupérer le paquet :

| Déclencheur                  | Résultat                                                                           |
| ---------------------------- | ---------------------------------------------------------------------------------- |
| push sur `main`, clé en place | release `android-v<version>` marquée « latest », APK attaché                        |
| push sur `staging`, clé en place | préversion roulante `android-staging` — toujours la même adresse de téléchargement |
| push sans clé de signature   | préversion roulante `android-debug-<branche>`, APK debug                            |
| pull request                 | artefact du run seulement, aucune release                                           |

Passer par une **release** plutôt que par l'artefact du run n'est pas cosmétique :
GitHub sert tout artefact d'Actions dans un `.zip`, même quand il ne contient
qu'un fichier, alors qu'une release donne un `.apk` en téléchargement direct —
donc installable depuis le téléphone, sans détour par un ordinateur.

L'APK reste malgré tout joint aux **artefacts** de chaque run (90 jours), y
compris sur `main` et `staging`.

`versionCode` vaut le numéro de run et `versionName` la version de
`package.json` suffixée de ce numéro : deux builds ne se marchent jamais dessus,
et Android accepte d'installer la plus récente par-dessus l'ancienne.

**Signature.** Sans clé, le workflow produit un APK *debug* : installable pour
tester, mais signé d'une clé jetable régénérée à chaque run — il faut donc
désinstaller la version précédente avant de poser la suivante. Pour des paquets
signés durablement, installables par-dessus les précédents, créer une clé
**une fois** et la garder.
`keytool` est fourni par n'importe quel JDK — dont celui embarqué dans Android
Studio (`.../Android Studio/jbr/bin/keytool`) si aucun n'est installé par
ailleurs :

```bash
keytool -genkey -v -keystore release.keystore -alias swipernews \
  -keyalg RSA -keysize 2048 -validity 10000
# valeur du secret ANDROID_KEYSTORE_BASE64 (une seule ligne, macOS comme Linux)
base64 < release.keystore | tr -d '\n'
```

Puis, dans *Settings → Secrets and variables → Actions* du dépôt, ajouter
`ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`
(`swipernews` ci-dessus) et `ANDROID_KEY_PASSWORD`. Le workflow bascule seul sur
`assembleRelease` et publie la release. **Conserver `release.keystore` hors du
dépôt** : perdue, plus aucune mise à jour de l'app installée n'est possible.

### Ce que le dépôt fournit déjà

- `manifest.webmanifest` remplit les exigences d'une TWA : `id`, `name`,
  `short_name`, `start_url` et `scope` absolus, `display: standalone`, couleurs de
  thème, icônes 192 et 512, plus une icône **maskable** pour que le lanceur Android
  n'en rogne pas les bords ;
- `well-known/assetlinks.json` est en place, avec une empreinte à remplacer, et
  `vercel.json` le réécrit vers `/.well-known/assetlinks.json` — le chemin exact
  qu'Android va interroger.

## Sécurité

- Le proxy `api/feed.js` valide l'URL demandée et **refuse le réseau interne**
  (localhost, IP privées, métadonnées cloud) — protection anti-SSRF — en plus de
  plafonner la taille de réponse.
- `api/feed.js` **ne relaie jamais le `Content-Type` de l'amont** : la réponse est
  toujours servie en `application/xml` avec `nosniff` et `Content-Disposition:
  attachment`. Sans cela, `/api/feed?url=…` pouvait servir du HTML ou du JavaScript
  exécuté sur notre propre origine.
- Les points d'accès `/api/*` n'ouvrent le CORS qu'à l'origine configurée par la
  variable d'environnement `ALLOWED_ORIGIN` (rien par défaut) : le front est
  same-origin et n'en a pas besoin, et l'endpoint n'est pas offert comme proxy ouvert.
- Le HTML des flux est converti en texte via un **document inerte** (`DOMParser`), et
  non via `innerHTML` sur un élément détaché — qui, lui, déclenche bien les handlers
  `onerror` des flux.
- Les liens et images issus des flux sont **assainis** avant affichage (schémas
  `javascript:`/`data:` non exécutés), et les URL d'image sont posées en JavaScript
  plutôt que dans un attribut `style` (un attribut `style` est décodé en HTML avant
  d'être parsé en CSS, ce qui rend l'échappement HTML insuffisant).
- Le service worker ne met en cache que l'app-shell same-origin, jamais `/api/*`, et
  purge ses anciennes versions (pas de cache non borné).

## Architecture

- **Mode Actus** : `api/feed.js` (proxy RSS durci) ou, en repli, proxys CORS publics.
- **Images** : quand un flux ne publie qu'une vignette (Franceinfo sert des URL
  Thumbor **signées** en 432 px, où la taille fait partie de la signature — donc
  non modifiable), `api/og.js` va lire la balise `og:image` de l'article, qui
  pointe vers la version pleine taille. Appelé uniquement si l'image du flux est
  réellement petite, résultat mémorisé côté client et mis en cache 24 h par le CDN.
- **Mode Apprendre** : `api/learn.js` agrège **côté serveur** les catégories Wikipédia
  demandées (cache CDN mutualisé entre utilisateurs). Le front l'appelle en priorité et
  se rabat sur son agrégation client si l'endpoint n'est pas déployé (hébergement statique).
- **Code partagé** : `src/lib.js` (fonctions pures : assainissement, parsing OPML/JSON,
  dates) et `src/learn-core.js` (catégories, URL et normaliseurs du mode Apprendre) sont
  chargés par `index.html` **et** par les fonctions serverless — une seule implémentation,
  couverte par `npm test`. Ce sont des `<script>` classiques, pas des modules ESM :
  `index.html` reste ouvrable en `file://`.
- **PWA** : `manifest.webmanifest` et `sw.js` sont de vrais fichiers servis en statique.
  Le service worker ne met **jamais** `/api/*` en cache.
- **En-têtes** : `vercel.json` porte la CSP, les en-têtes de sécurité et le cache long
  des assets immuables.
- **Accessibilité** : zoom autorisé, panneaux en `role="dialog"` avec piège de focus et
  fermeture clavier (Échap), `prefers-reduced-motion` respecté ; titres de carte en `h2`.

## Limites connues

- La récupération RSS dépend de services tiers gratuits (rss2json / proxys publics), qui
  peuvent être limités en débit ou temporairement indisponibles.
- Pas de favoris : il n'y a pas encore de « garder pour plus tard ». La position de
  lecture, elle, est bien mémorisée entre les sessions.
- `index.html` reste volontairement hors du périmètre lint/format. La logique
  réutilisable en a été extraite vers `src/`, mais le rendu et les interactions y
  vivent encore.
- Les icônes PNG ne sont pas optimisées (`logo-512.png` pèse ~260 Ko).

## Licence

MIT
