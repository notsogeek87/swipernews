# Notes pour Claude Code

Ce fichier complète le README (qui, lui, explique le *pourquoi* de chaque choix
en détail). Ici : ce qu'il faut savoir avant de toucher au dépôt, et ce qui ne
se devine pas en lisant le code.

**Tout est en français** — commentaires, messages de commit, textes d'interface,
documentation. S'y tenir.

---

## Ce qu'est ce dépôt

Une PWA de lecture en swipe vertical (flux RSS + Wikipédia), **sans build ni
dépendance à l'exécution** : `index.html` s'ouvre tel quel dans un navigateur.
Autour, quatre choses seulement :

| Dossier | Rôle |
| --- | --- |
| `index.html` | L'app entière : CSS et JS en ligne, ~2 100 lignes |
| `src/*.js` | Fonctions **pures** partagées avec les tests Node et `api/` |
| `api/*.js` | Fonctions serverless Vercel (proxy RSS, Wikipédia, image OG) |
| `android/` | Projet natif Capacitor (APK autonome, sans backend) |

L'outillage (lint, tests, CI) est optionnel et ne change rien au déploiement.

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
npm test            # node --test — 35 tests, aucune dépendance à installer
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
*pull request*.

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
  dans **deux** points de montage `[data-readmount]` (panneau Sources *et*
  panneau Centres d'intérêt) : ils ne sont jamais atteignables en même temps,
  ⚙ Sources n'existant qu'en mode Actus et ✎ Modifier qu'en mode Apprendre.
- `feedSnap` — état du fil mémorisé par mode ; une bascule ne recharge rien.

### Natif (`android/app/src/main/java/eu/lielu/news/`)

| Fichier | Rôle |
| --- | --- |
| `MainActivity` | `registerPlugin(InAppBrowserPlugin)` **avant** `super.onCreate` |
| `InAppBrowserPlugin` | Pont JS→natif : `open`, `syncBlocklist`, `clearBlocklist` |
| `InAppBrowserActivity` | Le lecteur : barre escamotable, insets, injections |
| `ReaderWebView` | Sous-classe minimale, seulement pour exposer `onScrollChanged` |
| `BlocklistStore` | Liste de blocage : parsing, téléchargement, cache, fusion |

Scripts injectés, dans `res/raw/` : `reader_cmp.js` (bandeaux de consentement),
`reader_ads.js` (emplacements publicitaires), `reader_read.js` (mode lecture),
`reader_blocklist.txt` (178 domaines intégrés).

**Les préférences vivent côté web** (localStorage) et sont transmises **à
chaque ouverture** (`hideCmp`, `blockAds`, `reader`). Le natif ne garde aucun
état de préférence — seul le cache de liste de blocage est persistant.

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
  le sélecteur qu'on vient de toucher. Faire parler l'interface à la place.
- **Le mode lecture ne peut pas s'appliquer avant `onPageFinished`** (DOM
  incomplet ⇒ article tronqué). D'où le voile : on masque la WebView, on
  transforme, on révèle en fondu.
