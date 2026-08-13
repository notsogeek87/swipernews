# Audit de robustesse — SwiperNews

Revue de production du dépôt à l'état `35c209e` (v1.4.0, `APP_VERSION` 108), sous
l'angle **stabilité, pannes et états bloqués** — pas la sécurité ni
l'optimisation, déjà traitées par `AUDIT-2026-08.md`, dont ce document prend la
suite sans le remplacer.

Périmètre : `index.html` (3 752 l.), `src/*.js`, `api/*.js`, `sw.js`, le projet
natif `android/`, et le comportement observé **dans un vrai navigateur**.

> **Méthode.** Rien n'est signalé ici sur la seule lecture du code. Un banc de QA
> (Chromium piloté par Playwright, réseau entièrement simulé) a joué 18 scénarios
> — première installation, hors-ligne, réseau lent, coupure en cours de requête,
> API en 500, RSS vide/tronqué/HTML, article sans image ni description, contenu
> démesuré, doublons, 120 sources, stockage local abîmé, cache abîmé, quota
> saturé, actions enchaînées, retour arrière, mise en arrière-plan, relancement à
> froid. Chaque défaut ci-dessous a été **reproduit avant correction et
> revérifié après**. Les scénarios sont décrits au §5.

---

## 1. Synthèse

Le cœur de l'app est plus solide que la moyenne de ce qu'on voit dans une PWA de
cette taille : les deux moitiés du fil se chargent sans s'attendre et sans se
bloquer, les chargements périmés s'annulent par compteur de génération
(`loadSeq`), un fil déjà affiché n'est jamais vidé par un rafraîchissement qui
échoue, et le repli hors-ligne (articles de démo + badge) fonctionne exactement
comme annoncé. Les scénarios réseau les plus durs — coupure au milieu des
requêtes, tout en 500, RSS malformé, flux entièrement vide — se terminent tous
sur un fil utilisable, sans exception non gérée et sans écran de chargement
figé.

Les défauts trouvés se rangent en trois familles :

| Famille | Ce qui a été trouvé |
| --- | --- |
| **États bloqués définitifs** | Deux valeurs de stockage local abîmées suffisent à tuer l'app **pour toujours**, sans aucune sortie depuis l'interface. C'est de loin le plus grave (§2.1, §2.2). |
| **Fonctions désarmées en silence** | Trois fonctions annoncées cessent de marcher sans que rien ne le dise : la reprise de lecture à presque toutes les ouvertures (§2.3), l'application des sources ajoutées (§2.4), le filtre sponsorisé et la pastille « payant » sur un article donné (§2.5). |
| **Croissance non bornée** | Texte de flux, cache disque, instantanés en mémoire, cibles d'observateurs : quatre choses grandissaient sans plafond (§3). |

**Tout ce qui est listé aux §2 et §3 est corrigé dans ce commit** (le §4 liste ce
qui reste à surveiller, non corrigé à dessein).

Verdict global : **robuste avec deux trous critiques**, désormais bouchés. Rien
de ce qui reste ne justifie de retenir une publication.

---

## 2. Correctifs fonctionnels

### 2.1 — CRITIQUE · Une liste de sources abîmée tuait l'app à vie

`index.html`, `load()` (avant : une seule ligne, `JSON.parse` sans validation).

`feeds` est parcouru **dès le démarrage du script** (`sanitizeNewsSrc()`,
`renderMixUI()` → `renderFilters()`), donc avant le premier chargement et avant
la pose des écouteurs. Toute valeur qui n'est pas un tableau d'objets y lève une
exception **au premier niveau du script** : plus une seule ligne de JS ne
s'exécute ensuite. Écran noir, aucun bouton, aucun message — et comme la valeur
est sur disque, à chaque lancement suivant aussi. Dans l'APK, la seule sortie est
« effacer les données de l'application » ; sur le web, vider le stockage du site.

Reproduit au navigateur :

| `fluxswipe.feeds.v1` | Symptôme |
| --- | --- |
| `{"a":1}`, `42`, `"texte"` | `PAGEERROR: feeds.filter is not a function` — 0 carte |
| `[null]` | `PAGEERROR: Cannot read properties of null (reading 'on')` — 0 carte |

Comment y arrive-t-on sans malveillance : une version au schéma différent (un
retour arrière F-Droid suffit), une extension de navigateur, ou un stockage de
WebView réellement abîmé après un arrêt brutal — le cas que le README appelle
déjà « l'app tuée depuis l'écran des tâches récentes ».

**Correction.** `sanitizeFeeds()` valide entrée par entrée : tableau, objets,
URL `http(s)` (via `isFeedUrl`, nouvelle fonction partagée), doublons d'URL
retirés. Une liste illisible retombe sur les sources par défaut ; une liste
**vide** reste respectée (tout supprimer à la main est un choix légitime).
`isFeedUrl` et `clampText` ont été ajoutées à la liste de `guardModules`, pour
qu'un `src/lib.js` périmé en cache déclenche l'auto-réparation existante plutôt
que ce même plantage.

### 2.2 — CRITIQUE · Un cache abîmé bloquait le chargement, définitivement

`index.html`, `cacheEntry()` / `loadFeeds()`.

`cacheEntry` vérifiait `Array.isArray(items)` et `length>=3`, jamais la forme des
éléments. Or `loadFeeds` peint le cache **avant** de lancer ses deux moitiés :

```js
if(cached){adoptItems(cached);render();…}   // ← exception ici
loadLearnPart(…); loadNewsPart(…);          // ← jamais atteints
```

Une exception dans `adoptItems` (qui lit `i.kind`) empêche donc **toute requête
réseau**. Résultat : écran de chargement pour toujours, et à chaque lancement,
puisque le cache fautif est sur disque. Aucune erreur visible non plus — c'est
une promesse rejetée, pas une exception de page.

Reproduit : `items:[null,null,null]` → « Cannot read properties of null (reading
'kind') » ; `items:["a","b","c"]` → « (url || "").trim is not a function ».

**Correction, en deux couches.** (1) `usableItem` filtre les éléments repris :
un objet portant un titre, sinon écarté ; en dessous de trois survivants l'entrée
est ignorée, comme un cache trop maigre. (2) La peinture du cache est enveloppée
dans un `try/catch` : **quoi qu'il arrive** dans le cache, le chargement réseau
suit. C'est la couche qui compte : elle rend la classe de panne impossible, pas
seulement ses deux formes connues.

### 2.3 — Élevée · La reprise de lecture était annulée à presque chaque ouverture

`index.html`, `flushRender()` / `paint()`.

Deux intentions du projet se contredisaient, et c'était la mauvaise qui gagnait :

- `posMap` + `resolveResume()` (lien exact → date → index) restaurent l'article
  quitté à l'ouverture — la « reprise de lecture » annoncée dans le README ;
- `forceTop` remonte en tête après un rafraîchissement des actus, pour qu'une
  longue session de lecture ne cache pas indéfiniment le haut du fil.

Or dès que le cache dépasse `AUTO_RELOAD_MS` (30 min), le lancement **est** un
rafraîchissement. Séquence mesurée au navigateur, échantillonnée toutes les
300 ms : l'article quitté est bien restauré (`scrollTop=5400`, `idx=6`), puis la
repeinture finale le jette en tête (`scrollTop=0`, `idx=0`) quelques centaines de
millisecondes plus tard. À l'écran : on revoit son article, puis le fil saute.

La reprise ne fonctionnait donc que dans la fenêtre de 30 minutes où l'on se
souvient encore de soi-même où l'on en était — c'est-à-dire là où elle sert le
moins.

**Correction.** `paint()` prenait un seul drapeau pour deux choses distinctes ;
il en prend deux : `final` (rendre le jeton de chargement, enregistrer le cache)
et `top` (remonter en tête). Le **tout premier** chargement de la session
(`premier`, lu avant que `feedLoadStarted` ne bascule) conclut sans remonter en
tête ; tous les suivants gardent le comportement d'avant. Vérifié : ↻ explicite
→ tête du fil ; rafraîchissement automatique en cours de session → tête du fil ;
lancement à froid → article retrouvé.

Le contenu neuf n'est pas perdu : ce rendu gèle la tête du fil (`remix(true)`,
comme toute repeinture progressive) et retrie le reste par date, donc les
articles frais se rangent juste **après** la carte reprise.

### 2.4 — Élevée · Les sources ajoutées n'étaient pas appliquées

`index.html`, `loadFeeds()` / `loadNewsPart()`.

`feedsDirty` dit « les sources ont bougé depuis le dernier chargement » et décide
si « Appliquer » recharge le fil. Il était remis à faux **au début** de
`loadFeeds`, alors que l'appel repart aussitôt par le seuil de fraîcheur sans
rien recharger. Et `loadFeeds()` est appelé en permanence : filet périodique
(`setInterval`, 60 s), retour au premier plan, `onResume()` natif.

Conséquence, reproduite au navigateur : ouvrir le panneau, ajouter une source,
**passer plus d'une minute** à cocher des centres d'intérêt (le temps ordinaire),
taper « Appliquer » → `loadSeq` inchangé, aucun rechargement, la source n'entre
jamais dans le fil. Rien ne le signale ; il faut trouver ↻ ou rouvrir le panneau.

**Correction.** `feedsDirty=false` déménage à l'endroit où les sources vont
**réellement** être interrogées, après le seuil de fraîcheur. Vérifié : le
drapeau survit au filet périodique, et « Appliquer » recharge (`loadSeq` 2 → 3).

### 2.5 — Moyenne · Un échec amont figeait un verdict à vie

`index.html`, `articleMetaFor()` ; `api/og.js` (contrat de réponse).

`api/og.js` répond **200** même quand la page de l'éditeur est injoignable, avec
un verdict neutre par défaut et un champ `error`. Le client ne regardait pas ce
champ : il mémorisait « pas de paywall, pas de sponsor » dans `localStorage`,
**définitivement**, sur un simple ralentissement de l'éditeur — exactement ce que
le `.catch` juste en dessous existe pour éviter (« Un échec n'est PAS un
verdict », commentaire d'origine). Le chemin le plus fréquent contournait donc la
précaution : pastille « payant » et filtre sponsorisé désarmés pour cet article,
sans retour possible.

**Correction.** Une réponse portant `error` est traitée comme un échec : verdict
neutre rendu, **rien de mémorisé**. Le cache CDN (`s-maxage=3600`) évite malgré
tout de harceler l'éditeur. Vérifié : `fluxswipe.artmeta.v1` reste vide.

### 2.6 — Moyenne · Trois autres pannes muettes

| Défaut | Fichier | Correction |
| --- | --- | --- |
| Une lecture de fichier qui échoue à l'import ne dit **rien** et laisse la valeur de l'`<input>` posée : rechoisir le même fichier n'émet plus d'événement, l'import semble mort jusqu'au rechargement de l'app. | `importFromFile()` | `reader.onerror` : message + remise à zéro de l'`<input>`. |
| `learnMoreVide` (compteur d'épuisement d'un thème) n'était jamais remis à zéro : un thème étroit éteignait le réapprovisionnement anticipé de la réserve Wikipédia **pour toute la session**, thème suivant compris. | `loadFeeds()`, `switchFeed()` | Remis à zéro à chaque nouveau fil. |
| La carte « chargement d'autres articles » fait partie du HTML mémorisé : restaurée depuis un instantané sans rendu qui suit, elle restait en queue **à jamais**. | `restoreFeed()` | `renderLoadMoreCard()` la remet d'accord avec `loadingMore`. |
| Deux fois la même URL de source n'était refusé nulle part dans « ajouter un flux » (la suggestion et l'import, eux, vérifient) : une requête par chargement pour rien, `collected` étant indexé par URL — la seconde ligne écrasait la première. | `addFeed()` | Refus explicite, message « Sources déjà présentes ». |

### 2.7 — Moyenne · Natif : un plantage, et un écran d'erreur qui restait

`android/app/src/main/java/eu/lielu/news/InAppBrowserActivity.java`

1. **NullPointerException à la fermeture rapide du lecteur.** Le premier rappel
   de `evaluateJavascript` (injection du mode lecture) appelait `web.…` sans
   vérifier `web`, contrairement au second. Or ces rappels sont **postés** sur le
   fil principal : ouvrir un article puis revenir aussitôt — geste très ordinaire
   — exécute `onDestroy` (qui met `web` à `null`) avant que le message ne soit
   dépilé. Plantage de l'app. Corrigé par la même garde que le rappel imbriqué.
2. **Écran d'erreur persistant.** `onReceivedError` sur la trame principale
   masque la WebView, et rien ne le défaisait qu'un tap sur « réessayer ». Un
   échec transitoire (redirection abandonnée, chaîne de consentement, lien suivi
   dans l'article) laissait donc « réessayer » en travers d'un lecteur qui
   fonctionnait. `hideError()` est appelé au **début** de chaque navigation ;
   l'erreur du chargement en cours, elle, arrive toujours après ce point.

### 2.8 — Faible · Service worker : un module servi en HTML hors-ligne

`sw.js`

Le repli hors-ligne `cache.match(req) || cache.match("./")` s'appliquait à
**toutes** les requêtes de coquille, `/src/*.js` compris : une requête de module
absente du cache recevait `index.html`. Le navigateur refuse d'exécuter ça
(type MIME, `nosniff`), `guardModules` conclut « modules incomplets », purge tout
et recharge — hors ligne, donc en boucle jusqu'à l'écran « Mise à jour
incomplète ». Le repli est désormais réservé aux navigations ; une requête de
module échoue franchement, ce que la page sait déjà traiter.

### 2.9 — Faible · La barre de chargement s'éteignait pendant un chargement

`index.html`, retentatives de `loadLearnPart` / `loadNewsPart`.

Une retentative programmée rendait son jeton (`syncing(false)`) même quand un
chargement plus récent avait remis le compteur à zéro (`syncReset`) : elle
décrémentait alors le compte **du nouveau**, éteignant sa barre alors qu'il
travaillait encore. Le compteur est borné à zéro, donc rien ne cassait — mais
l'indicateur mentait. Le jeton n'est plus rendu que si le chargement est encore
le sien.

### 2.10 — Faible · Retour arrière : le panneau ouvert faisait quitter l'app

`index.html`, `openDialog()` / `closeDialog()` / `openShareMenu()`.

Rien n'interceptait le geste « retour » d'Android. Panneau de réglages ouvert,
un retour **quittait l'app** (la WebView n'a pas d'historique à remonter,
Capacitor referme donc l'activité) : panneau perdu, sélection en cours perdue,
fil perdu. Idem pour la PWA installée.

**Correction sans pont natif ni dépendance** : chaque panneau ouvert pose une
entrée d'historique, que le retour système consomme ; `popstate` referme le
panneau et l'app reste où elle était. Panneau fermé, l'entrée n'existe pas et le
retour retrouve son sens (quitter). Vérifié dans Chromium : retour → panneau
fermé, même page, fil intact ; fermeture au bouton → l'entrée est consommée,
donc le retour suivant quitte bien la page (aucun retour « avalé ») ; feuille de
filtre fermée par retour → **la sélection est appliquée**, pas perdue.

---

## 3. Bornes ajoutées (mémoire et stockage)

Quatre croissances sans plafond. Aucune ne casse l'app d'un coup ; toutes la
dégradent lentement, ce qui est plus difficile à diagnostiquer.

### 3.1 — Le texte d'un flux n'était pas borné

Un flux RSS est écrit par un tiers, et beaucoup publient l'**article entier** en
`<description>`/`<content:encoded>` — des dizaines de kilooctets par item. Ce
texte se retrouvait trois fois : dans le DOM (le CSS n'en montre que dix lignes,
le reste ne coûte que de la mémoire), dans le cache disque et dans l'instantané.

Mesuré : cinq articles à contenu complet → **408 343 octets** de cache, contre un
quota `localStorage` d'environ 5 Mo. À l'échelle de `MAX_NEWS` (120 articles),
l'écriture échoue — silencieusement (`warn`), donc plus jamais de peinture
instantanée au lancement et un aller-retour réseau complet à chaque ouverture.

`clampText` (nouveau, `src/lib.js`, testé) borne le résumé à 1 000 caractères,
le double de ce qu'une carte affiche : un résumé normal n'est jamais touché.
Titre borné à 300, `tags` à 600 — large à dessein, ce champ étant **lu** par
`isPromotionalItem` (une étiquette « Sponsorisé » en fin de liste ne doit pas se
faire couper). Même mesure après correction : **13 348 octets**, cartes
identiques.

### 3.2 — Cache disque : clés combinatoires, aucune éviction

La clé porte langue × sélection de sources × thème × filtre sponsorisé
(`feedKey`). Chaque combinaison jamais revue gardait ses 140 articles pour
toujours. Plafond : **5 fils**, les plus anciennement écrits partent. Vérifié :
9 changements de thème → 5 entrées, ~50 Ko (avant : 9 entrées, sans limite).

### 3.3 — Instantanés en mémoire : même absence de borne

Chaque `feedSnap` retient le HTML complet du fil, sa liste d'articles et une
copie du registre — de l'ordre du mégaoctet par fil sur des sources réelles. Une
session passée à explorer thèmes et langues les accumulait tous. Plafond :
**3 instantanés** (le plus anciennement rangé part), ce qui couvre l'usage qu'ils
servent — l'aller-retour entre deux ou trois filtres. Un fil sans instantané
n'est pas perdu, il se repeint depuis le cache disque.

### 3.4 — Cartes retirées, toujours observées

Un `IntersectionObserver` garde une référence **forte** sur ses cibles, et
`unobserve` n'avait lieu qu'à l'intersection. Une carte retirée du DOM sans avoir
jamais croisé l'écran — tout ce qu'un changement de dose ou de filtre écarte
au-delà de l'horizon de 150 % — restait donc vivante, avec son article et son
image, pour toute la session. `unobserveCard()` la retire des quatre
observateurs au moment où `render()` la sort du fil.

### 3.5 — Liste de blocage relue à chaque article (natif)

`BlocklistStore.load()` est appelé depuis `onCreate` du lecteur, donc **sur le
fil principal**, et à chaque article ouvert. Avec une liste de référence
(StevenBlack : plus de 200 000 lignes), c'est tout le fichier relu et réanalysé
avant que la page ne commence à charger, pour un résultat identique à celui de
l'article précédent. Mémorisé dans une `SoftReference` : la première ouverture
paie, les suivantes non, et le ramasse-miettes la lâche sous pression mémoire
(le comportement d'avant). Invalidée au téléchargement et au retrait d'une liste.

---

## 4. Ce qui reste à surveiller (non corrigé, à dessein)

1. **Le proxy `/api/feed` reste ouvert** et **le repli interroge cinq proxys
   tiers d'un coup** : voir `AUDIT-2026-08.md` §2.2 et §2.5. Toujours valable,
   toujours non corrigé — c'est un arbitrage de fond (vie privée), pas un défaut
   de robustesse.
2. **`whenFeedIdle` dépend d'un `pointerup`/`pointercancel`.** Si un pointeur ne
   se relâchait jamais côté moteur, la file d'attente ne se viderait plus et le
   fil se figerait en silence. Les deux événements sont écoutés sur `window` en
   capture, ce qui couvre les cas connus (relâchement au-dessus d'une barre
   fixe, geste annulé par le système), et l'ensemble de pointeurs gère le
   multi-touch. Aucun chemin de fuite n'a été trouvé ; noté comme risque
   résiduel plutôt que corrigé à l'aveugle.
3. **Mise à jour du service worker : le rechargement n'est pas différé.**
   `install` appelle `skipWaiting()`, donc un nouveau worker prend la main dès
   qu'il est installé et `controllerchange` recharge la page — le mécanisme
   `swUpdateReady`/`AWAY_BEFORE_RELOAD_MS`, écrit pour ne recharger qu'au retour
   d'une absence, ne sert donc jamais. En pratique la vérification n'a lieu qu'au
   retour au premier plan, donc le rechargement tombe juste après, et la position
   de lecture est restaurée. Le code dit une chose et fait une autre : à
   clarifier, mais y toucher demande de revalider tout le chemin de mise à jour.
4. **`relTime()` reste en français** quelle que soit la langue (limitation déjà
   documentée dans `src/i18n.js`), y compris dans le bloc « liste de blocage ».
5. **La rotation des sources (`pickFeedBatch`) n'est pas alignée sur le cache.**
   Avec plus de 40 sources cochées, chaque chargement en interroge 40 en
   tournant : le fil d'un lancement donné ne contient donc jamais toutes les
   sources, et le cache enregistre ce sous-ensemble. Comportement voulu, mais un
   utilisateur avec 300 sources importées peut trouver qu'une source « ne
   remonte jamais ». Rien de cassé, à garder en tête si la question revient.
6. **Le filtre « payant » repose sur une recherche de texte** (« réservé aux
   abonnés ») dont le risque de faux positif est déjà documenté et assumé dans
   `src/lib.js`.

---

## 5. Tests

### Réalisés

Banc de QA (Chromium + Playwright, réseau simulé de bout en bout), **18
scénarios**, tous rejoués après correction :

| Scénario | Ce qui est vérifié | Résultat |
| --- | --- | --- |
| Première installation / première ouverture | Panneau d'accueil, validation, fil peuplé | ✅ 32 cartes, aucune erreur console |
| Hors-ligne total | Repli démo, badge, pas d'écran figé | ✅ 5 cartes, badge, barre éteinte |
| Réseau très lent (4 s) | Chargement visible, barre de sync | ✅ |
| Coupure **pendant** les requêtes | Fil déjà affiché préservé | ✅ 20 cartes, ni vide ni figé |
| Backend + proxys + Wikipédia en **500** | Repli démo | ✅ |
| RSS vide / XML tronqué / HTML à la place | Repli, pas d'exception | ✅ (20 cartes Wikipédia) |
| Items sans titre / sans lien / sans image | Filtrage, carte « démo » | ✅ |
| Contenu démesuré (80 Ko par item) | Bornes DOM et cache | ✅ 408 Ko → 13 Ko |
| Doublons dans un flux et entre flux | `dedupNews` | ✅ 8 items identiques → 1 |
| 120 sources, 30 articles chacune | Rotation, plafonds, temps | ✅ 40 requêtes, 140 cartes, registre 140 |
| Sources / cache / position / métadonnées **abîmés** | Aucun plantage, aucun blocage | ✅ (§2.1, §2.2) |
| Quota `localStorage` saturé | Position et « déjà vu » écrits quand même | ✅ |
| Actions enchaînées très vite (25 en 1,5 s) | Cohérence d'état, pas de barre figée | ✅ `syncCount` 0, aucune promesse rejetée |
| 40 défilements rapides | Bornes du fil, fuite de registre | ✅ 140 cartes / 140 entrées |
| Retour arrière (3 cas) | Panneaux, sélection appliquée, sortie franche | ✅ (§2.10) |
| Arrière-plan long puis reprise | Rafraîchissement, barre éteinte | ✅ |
| Relancement à froid, cache vieilli | Reprise de lecture | ✅ après correction (§2.3) |
| ↻ et rafraîchissement en session | Saut en tête conservé | ✅ (non-régression de §2.3) |

Côté code : `npm test` **79 tests** (76 + 3 ajoutés), `npm run lint` et
`npm run format:check` propres, syntaxe des trois blocs JS en ligne d'`index.html`
vérifiée, `javac` sur le natif — **100 erreurs avant, 100 après**, toutes dues à
l'absence d'`android.jar` (aucune erreur de syntaxe introduite), XML bien formé,
`node --check` sur les scripts injectés et `sw.js`.

### À ajouter

1. ~~Un banc de QA versionné~~ — **fait** : `tools/qa-scenarios.js` (mode
   d'emploi dans `CLAUDE.md`). Les 18 scénarios sont rejouables à chaque
   modification d'`index.html`, que `npm test` ne voit pas. Il reste à décider
   s'il entre dans la CI : il demande Chromium et une trentaine de secondes,
   `ci.yml` étant aujourd'hui instantané.
2. **Tests unitaires sur les nouvelles gardes.** `sanitizeFeeds` et `usableItem`
   vivent dans `index.html`, donc hors de portée de `node --test`. Les déplacer
   dans `src/lib.js` (elles sont pures) les rendrait testables ; c'est le seul
   refactoring que je recommande, et je ne l'ai pas fait pour ne pas mêler
   déplacement de code et correction de bogues dans le même commit.
3. **Le chemin `DOMParser` de `parseOpmlFeeds`.** Les tests Node exercent le
   repli par expressions régulières (pas de `DOMParser` dans Node) ; le chemin
   navigateur, celui qui sert réellement, n'est testé par rien.
4. **Un test de non-régression sur la reprise de lecture** (§2.3) : c'est
   exactement le genre de comportement qu'une correction future peut défaire sans
   qu'on s'en aperçoive.
5. **Natif, non testable ici** (pas de SDK Android) : le plantage du §2.7.1 et
   l'écran d'erreur du §2.7.2 sont corrigés par lecture et vérifiés
   syntaxiquement, **pas exécutés**. À confirmer sur appareil : ouvrir un article
   en mode lecture puis revenir immédiatement, plusieurs fois de suite.

---

## 6. À faire avant publication

1. **Faire compiler un APK par la CI** (`staging` ou une PR) : les corrections
   natives du §2.7 n'ont pas pu être compilées ici (`dl.google.com` bloqué, pas
   de SDK). Pousser une branche de travail seule ne déclenche **rien**.
2. **Vérifier sur appareil** les deux corrections natives (§5, point 5) et le
   retour arrière du §2.10, qui change un comportement système.
3. **Publier une version** demande le bump `versionCode`/`versionName` dans
   `android/app/build.gradle` **dans le commit qui précède le tag** — non fait
   ici, ce commit ne prépare pas une version.

Le triple bump web est fait : `APP_VERSION` **109**, `?v=109` sur les trois
modules, `CACHE = "flux-v109"` dans `sw.js`.
