# SwiperNews — apprendre & suivre l'actu en swipe

Une application (PWA + APK Android) qui fait lire des articles au **swipe
vertical plein écran**, comme un fil de réseau social. Deux fils, entre lesquels
on bascule au balayage horizontal :

- **📰 Actus** — les flux RSS que **vous** choisissez. Pas d'algorithme, pas de
  recommandation, pas de compte : le fil est exactement la liste de sources
  cochées, importable et exportable en OPML.
- **🎓 Apprendre** — des articles Wikipédia tirés au hasard, filtrables par
  centres d'intérêt, en défilement infini.

L'idée : reprendre le geste des réseaux sociaux **sans** ce qui va avec. Aucun
compte, aucune télémétrie, aucun appel à un service que vous n'avez pas choisi.

Côté **exécution**, tout tient dans `index.html` : aucune dépendance, aucun build, ouvrable tel quel.
L'outillage de **développement** (lint, tests, CI) est optionnel et ne change rien au déploiement.
Sur Android, l'app est empaquetée avec Capacitor et embarque son propre
**navigateur intégré** pour lire les articles sans quitter l'app — voir
[Navigateur intégré](#navigateur-intégré-app-android).

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
- **App Android uniquement — navigateur intégré** : « Lire l'article » et
  « Découvrir » ouvrent l'article *dans* l'app (fond sombre du fil, barre fine
  sans URL, jauge bicolore), au lieu de basculer vers Chrome — et un réglage
  **Ouvrir les articles : dans l'app / navigateur** permet de revenir au
  comportement d'avant. La barre s'efface pendant la lecture (barre d'état
  comprise) et les **bandeaux cookies sont masqués — jamais acceptés**. Un
  **mode lecture** façon liseuse (titre, texte et images seulement) est
  disponible en troisième option, et basculable depuis la barre du lecteur. Un
  **blocage des publicités et des traceurs** est disponible, désactivé par
  défaut. Voir [Navigateur intégré](#navigateur-intégré-app-android).
  Sur le web, le lien s'ouvre dans un nouvel onglet comme avant
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
Artistes, Géographie, Nature, Espace, Technologie, Sport, Cinéma, Films, Musique,
Jeux vidéo, Cuisine, Philosophie. Chaque
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

### Contribuer

Quatre choses à savoir avant une première contribution :

1. **Versionner la coquille.** Toute modification d'`index.html` ou de
   `src/*.js` impose d'incrémenter `APP_VERSION`, le `?v=` des deux `<script>`
   **et** `CACHE` dans `sw.js`, ensemble. C'est la règle la plus facile à
   oublier et la plus visible quand on l'oublie ; le pourquoi est détaillé plus
   bas, section « Versionner la coquille à chaque modification ». Une
   modification purement native (`android/`) n'en demande pas.
2. **`index.html` est hors lint et hors formatage** (voir `.prettierignore`) :
   son JS/CSS en ligne est dense à dessein, s'aligner sur le style existant
   plutôt que sur celui de `src/`.
3. **Les workflows ne se déclenchent que sur `main`, `staging` ou une _pull
   request_.** Pousser une branche seule ne lance ni les tests ni la
   compilation de l'APK : ouvrez une PR pour faire compiler du code natif.
4. **Le dépôt est en français** — commentaires, messages de commit, textes
   d'interface. Les commentaires y expliquent le *pourquoi*, pas le *quoi*.

[`CLAUDE.md`](CLAUDE.md) rassemble en un seul endroit la carte du code, les
décisions à ne pas défaire et les pièges déjà payés. Écrit pour un assistant de
code, il se lit très bien pour prendre le dépôt en main.

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

**Builder en ligne de commande**, sans Android Studio (il faut le SDK Android
et un JDK 21) :

```bash
npm ci
npm run cap:sync                      # ⚠ indispensable : sans lui, le projet
                                      #   natif garde la version précédente
                                      #   d'index.html et on débogue un fichier
                                      #   qui n'est pas celui qu'on a modifié
cd android && ./gradlew assembleDebug
# → android/app/build/outputs/apk/debug/app-debug.apk
```

Sans les variables d'environnement de signature (`ANDROID_KEYSTORE_FILE`,
`ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`),
Gradle retombe sur la clé debug : l'APK s'installe pour tester, mais ne pourra
pas être mis à jour par-dessus, la clé debug étant régénérée à chaque machine.
`assembleRelease` avec ces variables produit le paquet signé, comme en CI. Le
numéro de version se passe en propriétés Gradle
(`-PversionCode=N -PversionName=X`) ; sans elles, `1` / `1.0`.

Contrairement à la TWA, la coquille embarquée ne se met **pas** à jour
automatiquement avec le site : republier l'APK (nouvelle build signée avec la
même clé) est nécessaire après toute modification de `index.html` ou de
`src/*.js`.

### Navigateur intégré (app Android)

Dans l'APK, « Lire l'article » (Actus) et « Découvrir » (Apprendre) n'envoient
plus vers Chrome : l'article s'ouvre **dans l'app**, dans une activité maison
(`android/app/src/main/java/eu/lielu/news/InAppBrowserActivity.java`). On ne
quitte donc plus SwiperNews pour lire, et le retour ramène exactement à la carte
quittée sans recharger le fil.

L'habillage est délibérément minimal, aux couleurs du fil (`:root` d'`index.html`
recopié dans `res/values/colors_reader.xml`) : une barre fine avec le titre de la
page et le nom de domaine — **jamais de barre d'URL** — un bouton fermer, un
bouton partager, un bouton « ouvrir dans le navigateur » pour la sortie de
secours, et la jauge de chargement rose → cyan de l'app. L'article monte depuis
le bas comme les feuilles du fil, et le bouton retour remonte d'abord
l'historique de la page avant de refermer le lecteur.

**Lecture immersive.** La barre s'efface dès qu'on descend dans l'article et
revient au premier geste vers le haut — même règle que la barre du fil, qui se
masque pendant le swipe. La barre d'état d'Android part avec elle : il ne reste
alors que le texte, et un glissement depuis le haut la ramène sans quitter sa
place dans l'article. Deux détails rendent la chose fluide :

- la barre **coulisse** (`translationY`) au lieu d'être retirée de la mise en
  page — un changement de hauteur de vue relancerait la mise en page du site à
  chaque geste. D'où le `FrameLayout` : la barre flotte au-dessus de la WebView,
  qui ne bouge jamais ;
- les marges viennent de `getInsetsIgnoringVisibility` et non de `getInsets` :
  escamoter la barre d'état changerait sinon les marges, donc la zone de rendu,
  donc… la mise en page du site, à nouveau. La WebView reçoit une marge haute
  égale à la hauteur de la barre, avec `clipToPadding=false` pour que le texte
  passe *sous* la barre en défilant au lieu d'être coupé.

Détails d'implémentation qui comptent :

- **WebView maison plutôt qu'un _Custom Tab_** : un Custom Tab impose
  l'habillage de Chrome (barre d'URL claire, menu du navigateur) et ajoute une
  dépendance `androidx.browser` — l'inverse de « sobre et intégré ». Ici, rien
  n'entre dans le paquet que du code de ce dépôt.
- **Pages sombres** : `setAlgorithmicDarkeningAllowed` (androidx.webkit, version
  déjà déclarée par Capacitor dans `variables.gradle`) laisse le site choisir son
  thème sombre s'il en a un (`prefers-color-scheme`), et assombrit sinon. Le fond
  de la WebView est déjà à la couleur de l'app, ce qui supprime l'éclair blanc
  avant le premier rendu.
- **Agent utilisateur** : le `; wv` qui signale une WebView est retiré, sinon
  certains sites servent une page dégradée ou refusent la lecture.
- **Ce qui sort du lecteur** : les schémas non-web (`mailto:`, `tel:`,
  `intent:`…) et les téléchargements sont confiés à l'appareil ; une page
  injoignable affiche un écran d'erreur avec « Réessayer » et « Ouvrir dans le
  navigateur » plutôt qu'un écran noir.
- **Bord à bord** géré à la main (`setDecorFitsSystemWindows(false)` + insets),
  pour un rendu identique sur toutes les versions d'Android plutôt qu'un
  comportement par défaut qui change avec `targetSdk`.

Le pont est un plugin Capacitor local (`InAppBrowserPlugin`, enregistré dans
`MainActivity`) : côté web, `index.html` appelle `openArticle()`, qui délègue à
`Capacitor.Plugins.InAppBrowser` **si et seulement si** l'app est packagée. Hors
APK le plugin n'existe pas, la fonction rend `false` et le lien garde son
comportement de navigateur (`target="_blank"`) — c'est aussi le repli si le pont
natif échouait.

**Bandeaux de consentement.** Le lecteur masque à l'ouverture les bandeaux
cookies (`res/raw/reader_cmp.js`, injecté au début, en cours et en fin de
chargement — les CMP arrivent souvent après la page, le script est donc
idempotent et rejoué).

> **Il masque, il n'accepte jamais.** Aucun bouton n'est cliqué, aucun
> consentement n'est donné au nom de l'utilisateur : ne pas répondre à une
> demande de consentement vaut refus, c'est l'option la plus protectrice. Un
> script qui cliquerait « Tout accepter » pour faire disparaître le bandeau
> ferait exactement l'inverse — c'est pour cela qu'on s'y refuse.

Deux passes complémentaires, plus un déverrouillage du défilement (beaucoup de
bandeaux figent la page derrière eux) :

1. une feuille de style listant les conteneurs racines des CMP connus
   (OneTrust, Didomi, Quantcast, Sourcepoint, Cookiebot, Axeptio,
   Tarteaucitron, AppConsent, Usercentrics, Osano, Klaro, Iubenda…) : des
   identifiants stables, donc quasiment aucun risque de faux positif ;
2. une heuristique courte pour les bandeaux maison, à **trois** conditions
   cumulatives — élément fixe ou collant à trois niveaux au plus sous `<body>`,
   texte parlant de cookies/consentement, et présence d'un bouton d'acceptation.
   Les trois ensemble évitent de faire disparaître un article qui *parlerait* de
   cookies. Le parcours est borné (400 éléments) pour rester gratuit sur une
   longue page.

Vérifié sur une page piégée (`test` manuel en Chromium) : bandeau OneTrust,
bandeau Didomi et bandeau maison masqués ; barre de navigation fixe, article
traitant des cookies et encart newsletter **préservés** ; défilement rendu.

### Mode lecture

Troisième façon de lire, à côté de « Dans l'app » et « Navigateur » : le lecteur
ne garde que **le titre, le texte et les images**, dans une colonne de liseuse
(serif, 19 px, interligne large) sur le fond sombre de l'app. Un bouton dans la
barre du lecteur bascule à tout moment entre l'article simplifié et la page
complète.

Le principe (`res/raw/reader_read.js`) est celui de Readability — le moteur
derrière les vues lecteur de Firefox et Safari — mais réécrit court : chaque
bloc de la page est noté selon la quantité de texte qu'il porte, pondérée par
sa **densité de liens** (un menu ou un sommaire tend vers 1, un article vers 0)
et par sa signature de classe/id. Le meilleur bloc est élagué, puis la page est
**remplacée** par une version propre. Jeter la feuille de style du site fait
disparaître d'un coup habillage, colonnes, encarts et bandeaux, sans avoir à les
nommer un par un.

Trois choix qui comptent :

- **jamais de force** : sous un certain seuil de texte (galerie, page d'accueil,
  application web), la page est laissée intacte et le bouton le dit, plutôt que
  d'afficher un article vide ;
- **on ne défait pas une transformation** : revenir à la page complète recharge
  l'URL, ce qui réaffiche exactement ce que le site sert — plutôt que de tenter
  de reconstruire une page déjà jetée ;
- **on masque, on transforme, on révèle** : l'extraction exige un DOM complet
  (plus tôt, l'article serait tronqué), donc la page du site est forcément
  peinte avant. La WebView est rendue transparente dès le départ du chargement
  et réapparaît en fondu une fois le verdict connu — sans quoi on voyait le site
  en clair une fraction de seconde puis la bascule, et l'effet le plus visible
  du mode lecture était son propre retard. La jauge de chargement, elle, reste
  visible : l'attente se lit comme un chargement, pas comme un écran figé. Un
  filet de 6 s révèle la page quoi qu'il arrive, pour qu'un site qui ne finit
  jamais de charger ne laisse pas un écran noir ;
- **aucun attribut ne survit** à l'élagage (classes, id, styles en ligne) : la
  feuille du site étant supprimée, une classe résiduelle ne servirait qu'à
  réintroduire du hasard.

**Sites sur abonnement.** Le mode lecture ne touche **à rien** sur une page de
connexion. C'est un cas qui casserait tout sans précaution : le script supprime
`form`, `input` et `button` et remplace la page — il ne resterait pas un champ à
remplir, et le gestionnaire de mots de passe n'aurait plus rien à autoremplir,
l'Autofill d'Android ayant besoin des vrais champs dans le DOM. Deux
détections, l'une sûre et l'autre en filet : présence d'un
`input[type="password"]`, ou chemin d'URL évocateur (`/connexion`, `/login`,
`/sso`, `/abonnement`…). La page est alors laissée intacte et marquée `auth`,
pour que le lecteur sache qu'il ne s'agit pas d'un échec d'extraction : le mode
reste actif pour l'article qui suit la connexion, et un message discret explique
pourquoi cet écran-là n'est pas simplifié.

Les cookies sont écrits sur disque à chaque mise en arrière-plan
(`CookieManager.flush()`). Sans ce vidage explicite, une session peut être
perdue quand le système récupère le processus — il faudrait alors se reconnecter
à chaque lecture.

Les images sont rétablies depuis leurs attributs de chargement différé
(`data-src`, `srcset`), résolues en URL absolue, et les vignettes de moins de
120 px comme les traceurs 1×1 sont écartés.

Vérifié en Chromium sur une page d'article complète (menu, bandeau cookies,
colonne latérale avec pub, boutons de partage, « À lire aussi », pied de page) :
titre, date, 3 paragraphes, sous-titre, citation, liste, image d'illustration et
sa légende conservés ; tout le reste supprimé ; zéro attribut résiduel, zéro
erreur JS.

**Publicités et traceurs.** Le blocage est **désactivé par défaut** : c'est une
option qu'on active sciemment. Deux raisons, et aucune n'est technique — bloquer
prive de revenu les éditeurs dont on lit justement les flux, et un site à mur
anti-adblock donnerait une app qui « ne marche pas » à quelqu'un qui n'a rien
demandé. Une fois activé, le blocage opère à deux étages complémentaires :

1. **le réseau**, dans `shouldInterceptRequest` : toute ressource dont l'hôte
   figure dans `res/raw/reader_blocklist.txt` reçoit une réponse vide. C'est le
   vrai gain — la pub n'est jamais téléchargée, et le pistage ne part pas. Un
   domaine couvre ses sous-domaines (`doubleclick.net` bloque
   `stats.g.doubleclick.net`), par remontée des domaines parents ; la remontée
   s'arrête avant le TLD, pour qu'une liste mal saisie ne puisse pas bloquer
   `.com`. Le document principal n'est **jamais** bloqué : l'article doit
   toujours s'afficher ;
2. **le cosmétique** (`res/raw/reader_ads.js`), qui referme les emplacements
   réservés restés vides après le blocage — et uniquement ceux-là : un
   conteneur nommé `ad-…` mais qui porte du texte ou une image est laissé
   tranquille.

La liste **intégrée** est écrite à la main (178 domaines) : elle sert de
plancher, disponible hors-ligne dès l'installation. Deux exclusions
volontaires, parce que les bloquer casse l'article lui-même :
`googletagmanager.com` (beaucoup de sites y font transiter le chargement du
contenu) et les CDN d'images.

### Liste de blocage distante (facultative)

Une liste intégrée ne bouge qu'au rythme des publications de l'app. Le réglage
Publicités propose donc de télécharger une **liste de référence**, mise à jour
sans republier l'APK (`BlocklistStore.java`, méthode `syncBlocklist` du plugin) :

| Liste | Format | Poids réel | Domaines retenus | Licence |
| --- | --- | --- | --- | --- |
| EasyList `easylist_adservers.txt` | `\|\|domaine^` | 1,16 Mo | 50 047 | GPL-3 / CC BY-SA 3.0 |
| StevenBlack `hosts` | `hosts` | 2,98 Mo | 99 275 | MIT |

Points de conception :

- **rien n'est téléchargé** tant qu'une source n'a pas été choisie : l'app ne
  contacte que ce que l'utilisateur a décidé, comme pour les flux RSS ;
- les deux listes sont **fusionnées**, jamais substituées — sans réseau ou en
  cas d'échec, l'intégrée reste en service, et un téléchargement raté ne
  dégrade rien (remplacement du cache en une fois, jamais à moitié écrit) ;
- **télécharger à l'exécution n'est pas redistribuer** : c'est ce qui permet
  d'utiliser une liste CC BY-SA ou GPL sans changer la licence MIT du dépôt.
  Elle n'entre jamais dans le paquet, seulement dans le cache de l'appareil, et
  la source est créditée dans les réglages. L'embarquer, elle, aurait imposé sa
  licence — c'est pourquoi la liste intégrée reste maison ;
- rafraîchissement hebdomadaire en silence, garde-fous à 12 Mo et
  300 000 domaines pour qu'une URL mal choisie ne sature pas la mémoire.

Le parseur (`BlocklistStore.parseLine`) reconnaît les trois formats répandus —
`||domaine^`, `0.0.0.0 domaine`, domaine brut — et **ignore délibérément** tout
le reste : règles à chemin, joker ou options (`$third-party`), qui ne se
ramènent pas à un domaine, et exceptions (`@@`), qui bloqueraient l'inverse de
ce qu'elles disent. Deux pièges vérifiés sur les vrais fichiers :

- une règle **cosmétique** `lemonde.fr##.banniere` ressemble à une ligne hosts
  suivie d'un commentaire. La couper naïvement au `#` donnerait `lemonde.fr` —
  et ferait bloquer le site lui-même. Le `#` n'est traité comme un commentaire
  que détaché d'un mot ;
- les fichiers hosts contiennent des lignes `0.0.0.0 0.0.0.0` : une adresse IP
  n'est pas un domaine, un TLD fait au moins deux caractères et n'est jamais
  entièrement numérique (`xn--p1ai` reste accepté).

**Le lecteur intégré se refuse** : un réglage « Ouvrir les articles » propose
*Dans l'app* (défaut), *Lecture* ou *Navigateur*, mémorisé dans
`fluxswipe.readpref.v1`. Sur *Navigateur*, `openArticle()` rend `false` et le
lien repart au navigateur du téléphone, exactement comme avant l'ajout du
lecteur. Deux autres réglages, « Bandeaux cookies : Masqués / Affichés »
(`fluxswipe.cookiebanner.v1`, masqués par défaut) et « Publicités et traceurs :
Bloqués / Affichés » (`fluxswipe.ads.v1`, **affichés** par défaut),
n'apparaissent que quand le lecteur est actif — sans lui, la question ne se
pose plus. Les trois préférences vivent côté web et sont
transmises à chaque ouverture (`hideCmp`, `blockAds`) : le natif ne garde aucun
état. Le réglage figure dans **les deux** panneaux — Sources et Centres
d'intérêt — parce qu'ils ne sont jamais atteignables en même temps (⚙ Sources
n'existe qu'en mode Actus, ✎ Modifier qu'en mode Apprendre) et que le choix vaut
pour les deux fils : `renderReadPref()` remplit les deux points de montage
`[data-readmount]` depuis un état unique. Il n'apparaît pas sur le web, où un
lien s'ouvre forcément dans un onglet, ni pendant l'accueil du premier
lancement, où l'on ne demande qu'une chose à la fois. Le lecteur garde par
ailleurs son bouton « ouvrir dans le navigateur » pour les cas ponctuels.

**Icône et écran de démarrage** : générés par [`@capacitor/assets`](https://github.com/ionic-team/capacitor-assets)
à partir de `resources/` (icône `icon.png` = `logo-512.png`, calque adaptatif
`icon-foreground.png` = `logo-maskable-512.png` déjà en zone de sécurité —
tous deux à fond **transparent** par choix produit, `icon-background.png`
transparent lui aussi — et écran de démarrage `splash*.png` à la couleur du
thème `#0a0a0f`). Un fond transparent sur l'icône adaptative n'est pas garanti
par la plateforme : le lanceur Android peut afficher le fond d'écran ou son
propre repli derrière le logo selon l'OEM — c'est le compromis accepté pour
éviter tout aplat de couleur imposé autour du logo. Après une mise à jour du
logo à la racine, régénérer avec :

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

### F-Droid

F-Droid compile lui-même chaque application depuis ses sources : il n'y a pas
de simple envoi d'APK, contrairement à GitHub Releases. Le dossier
[`fdroid/`](fdroid/README.md) prépare ce qui dépend de ce dépôt (fiche
`fastlane`, brouillon de recette de build) et détaille ce qu'il reste à faire
à la main — poser un tag par version, ajouter des captures d'écran, puis
ouvrir la demande d'inclusion sur `gitlab.com/fdroid/fdroiddata`.

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
