# Flux — actus RSS en swipe

Une application web (PWA) qui affiche des flux RSS en mode swipe vertical, à la TikTok.
Côté **exécution**, tout tient dans `index.html` : aucune dépendance, aucun build, ouvrable tel quel.
L'outillage de **développement** (lint, tests, CI) est optionnel et ne change rien au déploiement.

## Fonctionnalités

- Navigation par swipe vertical plein écran (flèches ↑↓ / espace au clavier aussi)
- La barre du haut se masque pendant le swipe et ne revient **que sur un appui à
  l'écran** (aucune réapparition automatique)
- Reprise de lecture : l'app rouvre sur l'article quitté, **pour chaque mode
  indépendamment**. Si l'article a disparu du flux entre-temps (un RSS ne garde
  que ses N derniers items), la reprise se rabat sur le repère temporel puis sur
  l'index, au lieu de retomber en tête du fil
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

### Sources du mode Apprendre

Le fil mélange plusieurs sources, et la **catégorie choisie s'applique à toutes** :

- **Wikipédia** (API `action`, `generator=search`/`random`, extrait d'intro + image) — toutes catégories.
- **GBIF / INPN** (`api.gbif.org`, occurrences avec photo) — biodiversité, catégories *Nature* / *Sciences*.
- **Gallica – BnF** (API SRU, documents patrimoniaux numérisés + image IIIF) — toutes catégories.

Chaque source est interrogée en parallèle ; les résultats sont dédoublonnés et mélangés
(les cartes avec image d'abord). Les sources qui échouent ne contribuent simplement rien —
le fil reste alimenté par les autres. Gallica passe par les proxys (SRU non-CORS) ;
Wikipédia et GBIF autorisent le CORS. La langue par défaut est le français.

*(Paris Musées nécessite une clé API — à ajouter ultérieurement.)*

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
- **Mode Apprendre** : `api/learn.js` agrège **côté serveur** Wikipédia + GBIF + Gallica
  (cache CDN mutualisé entre utilisateurs). Le front l'appelle en priorité et se rabat
  sur son agrégation client si l'endpoint n'est pas déployé (hébergement statique).
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
