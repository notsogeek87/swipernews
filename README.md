# SwiperNews — apprendre & suivre l'actu en swipe

Une application (PWA + APK Android) qui fait lire des articles au **swipe
vertical plein écran**, comme un fil de réseau social. **Un seul fil**, où deux
natures d'articles alternent — trois actus, un article Wikipédia, et ainsi de
suite :

- **📰 les actus** — les flux RSS que **vous** choisissez. Pas d'algorithme, pas
  de recommandation, pas de compte : le fil est exactement la liste de sources
  cochées, importable et exportable en OPML.
- **🎓 Wikipédia** — des articles tirés au hasard, filtrables par centres
  d'intérêt. Ce sont eux qui rendent le fil infini : quand les actus sont
  épuisées, ils prennent le relais.

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
  l'écran** (aucune réapparition automatique). Un chevron discret apparaît alors
  en haut, pour signaler ce geste que rien n'indiquait : il s'anime doucement
  tant que l'utilisateur n'a jamais fait revenir la barre, puis s'efface presque
  et reste comme simple repère. Il ne capte **aucun** geste — l'appui le
  traverse jusqu'au fil. En faire une cible tactile aurait avalé les swipes
  verticaux commencés en haut de l'écran, pour ne rien gagner.
- **Fil unique** : les deux natures d'articles se succèdent à une cadence que
  vous réglez (voir *Dose d'apprentissage*). Une carte se reconnaît
  d'un coup d'œil — badge de thème et bouton « Découvrir » côté Wikipédia,
  « Lire l'article » côté actus. Sous le titre, deux pastilles filtrent chacune
  leur moitié — un flux, un centre d'intérêt — et affichent le filtre en cours ;
  la liste complète s'ouvre au toucher
- Reprise de lecture : l'app rouvre sur l'article quitté. Si l'article a disparu
  du flux entre-temps (un RSS ne garde
  que ses N derniers items), la reprise se rabat sur le repère temporel puis sur
  l'index, au lieu de retomber en tête du fil
- **Articles en mémoire** : un bouton de la barre du haut liste toutes les cartes
  que le fil garde sous la main, dans l'ordre, avec un repère sur celle qu'on
  lit — pour revenir sur un article dépassé d'un swipe de trop, sans remonter à
  l'aveugle
- Lisibilité sur photo : l'image n'est **jamais assombrie**, mais elle est floutée
  localement derrière le bloc de texte, et les textes portent un halo discret. Un flou
  supprime le détail sans changer la luminance — c'est le halo qui rend lisible sur un
  fond clair (ciel, neige)
- Titre, résumé, image, source et date tirés directement des flux RSS. Quand un
  article propose plusieurs tailles d'image, la **plus grande** est retenue (les
  flux listent la vignette en premier ; la prendre donnait des fonds flous).
  Si le flux n'en publie aucune (fréquent chez les sites WordPress nus), l'app
  tente de son côté une image de partage (`og:image`) une fois la carte proche
  de l'écran
- **Flux homonymes distingués** : suivre plusieurs flux d'un même site est la
  norme dès qu'on en veut les rubriques (Courrier international en publie une
  par flux), mais ils arrivent tous sous le titre du site — trois lignes
  identiques dans le panneau Sources, trois puces identiques dans le filtre. Ce
  qui les sépare est déjà dans l'URL : le dernier segment parlant de son chemin
  (`/feed/rubrique/asie/rss.xml` → « asie ») est ajouté au nom, et **seulement
  quand plusieurs sources le partagent** — un flux unique garde son nom nu. Voir
  `feedLabels` (`src/lib.js`)
- **Filtre des sources à choix multiple** : la pastille 📰 retient autant de
  sources qu'on veut, pas une seule. Aucune cochée = toutes. Les puces se
  cochent sans refermer la feuille, et le fil ne se recompose qu'à la validation
  — cocher trois sources déclencherait sinon trois rechargements, dont deux
  jetés aussitôt. Cocher toutes les sources une par une revient à « Toutes » :
  même fil, donc même clé de cache. La pastille affiche le libellé quand il n'y
  a qu'une source, le compte au-delà (trois noms concaténés y seraient tronqués
  au milieu d'un mot). Le filtre des thèmes Wikipédia, lui, reste un choix
  unique : un article est tiré dans un thème, pas dans plusieurs
- **Dédoublonnage entre flux** : un même site publie couramment le même article
  dans son flux « à la une » ET dans celui de la rubrique. Cocher les deux
  donnait deux cartes pour le même papier. Deux articles sont fusionnés quand
  leur lien canonique coïncide (paramètres de campagne et fragment retirés :
  `?xtor=RSS-1` contre `?xtor=RSS-3208`), ou quand, **sur le même site**, leur
  titre normalisé est identique et leurs dates ne se contredisent pas. Ces deux
  garde-fous évitent les faux positifs qui coûteraient un vrai article : sans
  « même site », deux rédactions reprenant la même dépêche AFP au même titre
  n'en garderaient qu'une ; sans la proximité de date, une chronique au titre
  fixe (« Programme TV du jour ») s'effacerait d'un jour sur l'autre. Des deux
  copies, on garde la plus riche — celle qui a une image, puis le résumé le plus
  complet — plutôt que la première arrivée, dont l'ordre dépend du réseau. Voir
  `dedupNews` (`src/lib.js`)
- **Filtre sponsorisé et bons plans** (activé par défaut, réglage dans le
  panneau Sources) : écarte du fil les articles marqués comme contenu
  sponsorisé (titre, résumé ou catégorie RSS) et les articles de la rubrique
  « bons plans » (détectés au chemin de l'URL, `/bons-plans/` — répandu chez
  les sites tech français — plutôt qu'à des mots-clés, souvent absents d'un
  titre de bon plan purement descriptif). Voir `isPromotionalItem` (`src/lib.js`)
- **Indicateur d'article payant** : une pastille `$` discrète, à côté du
  bouton « Lire l'article », signale un article réservé aux abonnés — vérifié
  **par article**, pas par domaine (la quasi-totalité des sites de presse ont
  aussi du contenu gratuit). Le signal vient de la page elle-même
  (`isAccessibleForFree` en JSON-LD, ou à défaut le texte « Réservé aux
  abonnés »), lue uniquement pour les articles d'une liste de domaines
  candidats, une fois la carte proche de l'écran — jamais pour tout le fil.
  Voir `isPaywallCandidateDomain`/`isPaywalledHtml` (`src/lib.js`) et
  `articleMetaFor` (`index.html`)
- **Sponsoring d'auteur** (fait partie du même filtre « sponsorisé et bons
  plans ») : certains partenariats commerciaux ne se déclarent que sur la page
  de l'article elle-même, via le lien de byline vers la fiche de l'auteur —
  invisible dans le flux RSS. Même mécanique que l'indicateur payant (lecture
  par article, une fois la carte proche de l'écran), mais la carte est retirée
  du fil une fois confirmée plutôt que simplement marquée. Voir
  `isSponsorCandidateDomain`/`isSponsoredHtml` (`src/lib.js`) et
  `checkSponsor` (`index.html`)
- Gestion des sources : ajout, suppression, activation/désactivation
- Import / export des sources aux formats **OPML** (standard) et **JSON** — importe tes sources et lis-les directement
- Partage d'un article (feuille de partage du système — celle de l'appareil, avec ses applications — ou, à défaut, menu WhatsApp / Telegram / mail / X / copie du lien),
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
- Fil **sans fin** : de nouveaux articles Wikipédia se chargent automatiquement en
  approchant du bas, y compris une fois toutes les actus parcourues. Le bouton **↻**
  repart sur une fournée fraîche.
- **Dose d'apprentissage** : un curseur, dans les réglages, décide de la
  proportion des deux — de *Actus seules* à *Wikipédia seul*, en passant par
  *Équilibré* (défaut, un article toutes les trois actus). Le bouton **boussole**
  de la barre du haut ouvre ce même curseur en un tap.
- **Un seul panneau de réglages** (⚙) : dose, centres d'intérêt, sources RSS et
  réglages du lecteur au même endroit, validés d'un seul bouton. Rouvert puis validé
  sans rien changer, il ne recharge rien — la position de lecture tient.
- **Langue de l'interface** (français / anglais pour l'instant) : un réglage
  qui traduit l'app ET change la langue de Wikipédia interrogée — les deux
  n'en font qu'un, pour ne pas se retrouver avec des articles en anglais dans
  une interface française. Ajouter une langue est incrémental : le français
  reste la source complète, les autres langues n'ont besoin que des clés
  qu'elles traduisent (voir `src/i18n.js`).
- Installable comme application (PWA) avec fonctionnement hors-ligne
- Si un flux est injoignable, le message le **nomme** (et la liste des sources
  marque la ligne d'un badge « injoignable »), pour savoir quelle source
  corriger ou supprimer. Si toutes échouent, un message invite à réessayer ou à
  revoir ses sources (plus de faux contenu de démo)

## La barre du haut

Trois rangées — marque, sources, centres d'intérêt — mangeaient **19 % de la
hauteur** de l'écran (152 px sur 780). Pire : les deux barres de puces
défilaient horizontalement, si bien qu'avec cinq sources et six thèmes, **trois
de chacun** seulement tenaient à l'écran — le filtre actif pouvait être hors
champ, hors de portée du regard comme de la main.

Les deux barres sont devenues **deux pastilles** (*Toutes ▾* / *Tous ▾*) : la
barre tombe à 113 px (14 %). Chaque pastille affiche le filtre en cours et
s'allume quand il n'est plus « tout » ; un tap ouvre une feuille où la liste
complète tient d'un coup, sans rien couper. Une pastille disparaît quand elle
n'a pas de choix à offrir (une seule source cochée, aucun centre d'intérêt) ou
quand la dose a retiré sa moitié du fil — les deux muettes, la rangée entière
s'efface.

Restent **deux rangées, et chacune a un seul métier** : la marque et les quatre
boutons d'action en haut, les deux filtres en dessous. Les pastilles ont d'abord
partagé la rangée des boutons, ce qui tenait tant qu'ils étaient trois ; au
quatrième, elles tombaient à 68 px — soit « T… », un filtre qui ne dit plus quel
filtre il est — pendant que la rangée de la marque restait à moitié vide. Les
boutons sont donc remontés là où la place était.

Les pastilles prennent alors **une moitié de rangée chacune**, chevron calé à
droite comme un sélecteur : de 40 px de texte utile à 125 px sur un écran de
412, et plus rien de tronqué jusqu'à 320 px. C'est exactement là qu'il fallait
mettre la place : une pastille affiche un **titre de flux**, texte quelconque et
souvent long (« Courrier international - Actualités France et Monde »), quand un
bouton n'a jamais qu'une icône de 20 px à montrer. Sur un écran très étroit,
c'est désormais la **marque** qui se coupe la première : « SwiperNe… » se devine
encore, « T… » ne dit plus rien.

Le compromis assumé : un tap de plus pour filtrer. C'est un geste rare (la
plupart restent sur « Toutes »), et il devient en échange complet et lisible.

### Une seule famille d'icônes

La barre mélangeait trois langages : des emoji en couleur (🎓, 📰), des glyphes
de police (↻, ⚙, ▾) dont le dessin et la position dépendent du système, et le
logo. À quatre ou cinq voisins, cela se voyait comme un empilement d'icônes
disparates — et un emoji ne s'aligne pas comme un tracé : il suit la ligne de
base du texte et porte sa propre marge, d'où des icônes qui « flottent » dans
leur bouton.

Tout est passé en **tracés** (2 px, extrémités rondes, boîte de 24, couleur
héritée), tirés des mêmes constantes que les icônes des cartes : boussole
(la moitié Wikipédia), flèche circulaire (rafraîchir), roue crantée (réglages),
onde RSS (la source), étiquette (le thème), chevron. Même boîte pour toutes,
donc même centre optique — mesuré à 0 px d'écart, ce qu'aucun glyphe de police
ne garantit. Le seul élément coloré restant en haut est le logo, qui est une
marque et non une icône.

Les emoji restent là où ils sont une **valeur** et non une décoration : le badge
de thème sur les cartes, et les puces des listes (chaque centre d'intérêt a le
sien). Chaque liste garde d'ailleurs son langage — les sources sont des noms
nus, les thèmes portent tous leur emoji.

### Retrouver un article dépassé

Le fil n'a pas de marche arrière fine : un swipe de trop et l'article est passé,
on le cherche alors à l'aveugle en remontant carte par carte — le retour arrière
d'Android, lui, ferme les panneaux, il ne remonte pas les cartes.

Un quatrième bouton (une liste) ouvre donc **ce que le fil garde en mémoire** :
toutes ses cartes, dans l'ordre, en rangées — vignette, source (ou thème, côté
Wikipédia), date, titre sur trois lignes au plus. Celles déjà dépassées reculent
d'un cran, celle qu'on lit porte un repère *ICI*, et la liste **s'ouvre sur
elle** : ce qu'on vient y chercher est presque toujours juste au-dessus. Un tap
y ramène.

Ce n'est **pas** un historique de lecture, et le nom le dit : rien n'est stocké,
rien n'est téléchargé, c'est une vue de la liste en cours. Ce que le fil a déjà
jeté — sa tête au-delà de 180 cartes, ou tout le fil quand un filtre change —
n'y est pas. Et c'est une feuille, non une vraie page : une page déchargerait le
fil derrière elle, donc le rechargerait, et ferait perdre la position qu'on
venait justement retrouver.

C'est ce quatrième bouton qui a fait déborder la rangée d'outils, et donc
déclenché le rééquilibrage des deux rangées décrit plus haut.

### Poinçon de caméra et barre d'état

Dès que la page occupe **tout l'écran** — APK, PWA installée, plein écran — son
haut se dessine dans la bande de la barre d'état. Un **poinçon de caméra
centré** tombe alors pile sur un bouton de la barre d'outils, qu'il rogne. Tant
que cette rangée ne portait que la marque, alignée à gauche, le centre était
vide et personne ne le voyait ; les boutons y sont montés, le problème est
apparu. (Dans un onglet ordinaire, rien à faire : c'est l'interface du
navigateur qui occupe cette bande.)

`env(safe-area-inset-top)`, qui devrait le dire, ne le dit pas toujours : sur
WebView Android il ne décrit que la découpe d'écran, et plusieurs moteurs
mobiles le rapportent à zéro face à un poinçon. Trois sources se relaient donc,
et le CSS retient **la plus grande** — aucune n'a besoin d'être fiable seule :

1. `env(safe-area-inset-top)`, quand le moteur le renseigne (encoche d'iPhone) ;
2. dans l'APK, une **mesure native** (`InAppBrowserPlugin.systemInsets`). C'est
   un **chevauchement** avec la WebView, jamais l'inset brut : si une couche
   quelconque — Capacitor, un thème, une future version d'Android — a déjà
   décalé la WebView, la réponse est 0 et rien n'est réservé deux fois ;
3. un **plancher de 34 px**, appliqué aux seuls écrans tactiles étroits dont la
   page occupe tout l'écran. Il couvre une barre d'état Android (24-30 dp) et la
   découpe qui s'y loge. Contrepartie assumée : là où rien ne recouvrait la page,
   ces 34 px sont perdus — une bande vide se voit et se corrige, un bouton à
   moitié mangé ne se rattrape pas.

La vraie question n'est pas « la page est-elle en plein écran » mais **« y a-t-il
quelque chose entre le haut de l'écran et le haut de la page »**. Deux réponses
plausibles se sont révélées fausses avant la bonne :

- `display-mode` répond `browser` sur un navigateur mobile qui dessine pourtant
  la page sous la barre d'état ;
- comparer la hauteur de la fenêtre à celle de l'écran ne marche que si
  l'interface du navigateur est **en haut**. Sur le téléphone qui posait
  problème : 384×736 pour un écran de 832 — les 96 px manquants étaient tous
  **en bas** (barre d'adresse en bas, barre d'état masquée), et la page touchait
  bel et bien le poinçon.

Reste `window.screenY` : la position du haut du contenu sur l'écran. Au-delà de
zéro, une interface de navigateur occupe déjà le haut. Les moteurs qui ne le
renseignent pas rendent 0 — et la bande est alors réservée, seul côté sûr. Le
tout est limité à `pointer:coarse` : un ordinateur, même en plein écran, n'a ni
barre d'état ni découpe.

Ce que la bande coûte quand elle ne sert à rien : **presque rien**. La barre du
haut est un calque (`position:fixed`, effacé pendant le swipe) — elle ne pousse
aucun contenu, la bande ne fait que descendre ce que la barre affiche.

La valeur est bornée à 120 px et rejouée à chaque redimensionnement (tourner
l'écran déplace la découpe). Le pied du panneau de réglages affiche la marge
**réellement appliquée**, lue sur le style calculé : ni l'APK ni une PWA
installée n'ont de barre d'URL où ajouter `?debug=1`, et « le poinçon rogne
encore » n'est pas débogable à distance sans ce chiffre.

## Dose d'apprentissage

La composition du fil tient à un seul réglage — un **curseur** à six crans, en
tête du panneau ⚙, qui donne la proportion entre les deux natures d'articles :

| Cran | Nom | Cadence |
| --- | --- | --- |
| 0 | Actus seules | que des actus — Wikipédia n'est **pas** interrogé |
| 1 | Une pincée | 1 article Wikipédia toutes les 6 actus |
| 2 | Équilibré *(défaut)* | 1 toutes les 3 actus |
| 3 | Moitié-moitié | 1 pour 1 |
| 4 | Surtout apprendre | 3 articles Wikipédia pour 1 actu |
| 5 | Wikipédia seul | que des articles — **aucun** flux n'est chargé |

Un curseur plutôt que six boutons : le réglage est un continuum entre deux
extrémités nommées, et le geste de glisser le dit mieux qu'une rangée
d'étiquettes. Sous le curseur, un **aperçu de la cadence** (une barre par carte,
les articles Wikipédia en corail) montre le rythme obtenu — il est calculé avec
la même fonction que le fil réel, pas dessiné à la main. L'aperçu suit le doigt
pendant le glissement ; le fil, lui, n'est recomposé qu'au **relâchement**,
sinon il serait reconstruit à chaque pixel.

Les deux extrémités remplacent les anciens onglets : *Actus seules* est l'ancien
mode Actus, *Wikipédia seul* l'ancien mode Apprendre. Chacune coupe vraiment
l'autre moitié — pas seulement à l'affichage, mais aussi côté réseau.

Le bouton **boussole** de la barre du haut ouvre ce curseur en un tap, sans
passer par les réglages — c'était auparavant un interrupteur tout ou rien, qui
n'atteignait que les deux extrémités d'une échelle qui en compte six. Le même
curseur vit donc à deux endroits (`[data-mixmount]`, comme les réglages du
lecteur) : un seul état, une seule fonction de rendu. Le bouton continue de
**dire** l'état : plein, tracé corail, quand Wikipédia est dans le fil ;
fantôme au cran *Actus seules*, où la pastille des centres d'intérêt disparaît
aussi (elle ne filtrerait plus rien) — c'est le signal le plus clair que le geste a porté. Changer de dose
**ne recharge rien** : les deux réserves sont déjà en mémoire, seul leur
entrelacement change, et l'utilisateur reste sur sa carte (ou sur la première
qui lui survit, quand la dose écarte celle qu'il lisait).

## La moitié Wikipédia du fil

Entre les actus se glissent des articles **Wikipédia** tirés au hasard (titre,
extrait, image, lien vers l'article). Ils se distinguent par un badge de thème,
une typographie un peu plus dense et le verbe « Découvrir » sur leur bouton.

La **pastille « thème »** de la barre du haut permet de choisir ce qu'on veut apprendre : **Aléatoire** (défaut), Sciences, Histoire, Art & Culture,
Artistes, Géographie, Nature, Espace, Technologie, Sport, Cinéma, Films, Musique,
Jeux vidéo, Cuisine, Philosophie. Chaque
catégorie utilise le moteur de recherche de Wikipédia (`generator=search`,
`gsrsort=random`, `deepcategory:"…"`) pour tirer des articles au hasard dans la catégorie
et ses sous-catégories. Le choix est mémorisé et chaque catégorie a son propre cache.

### D'où viennent ces articles

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
- Un **seul lot** d'articles Wikipédia est chargé au démarrage ; le scroll infini complète le reste.
- Les cartes hors écran sont **ignorées par le moteur de rendu** (`content-visibility`) et
  leurs images ne sont chargées qu'à l'approche de l'écran : un fil de 120 cartes plein
  écran ne garde plus 120 images en mémoire.
- Le fil est **réconcilié par clé** (le lien de l'article) au lieu d'être réécrit : les
  cartes déjà affichées sont déplacées, jamais recréées. Sans cela, le rendu progressif
  du fil (un rendu par flux qui répond, un par lot Wikipédia) détruisait et recréait
  l'image visible à chaque réponse — elle clignotait. C'est aussi ce qui rend le
  remélange gratuit : glisser un article Wikipédia entre deux actus ne recrée aucune carte.
- Au tout premier lancement, rien n'est chargé derrière le panneau de réglages :
  le fil est chargé une seule fois, après le choix des centres d'intérêt.
- Les deux moitiés se chargent **en parallèle** et se rendent chacune de leur côté :
  une source RSS lente ne retient pas les articles Wikipédia, et réciproquement.
- `/api/learn` répond sur l'une de quelques variantes tirées au sort, donc **cacheables
  par le CDN** et mutualisées entre utilisateurs (un nonce par requête empêchait tout cache).
  **Sauf quand l'utilisateur réclame du neuf** (bouton ↻, ou repli « tout ce lot est
  déjà vu ») : le lot part alors avec un nonce et en `no-store`, et la réponse n'est
  pas mise en cache. Sans cette exception, ↻ repiochait dans les quelques variantes
  déjà servies — souvent le lot qu'on venait de lire — et la copie disque du navigateur
  pouvait même le resservir *sans aucun appel réseau* pendant une heure : les actus se
  renouvelaient, la moitié Wikipédia non.

### Quand les actus se rechargent-elles ?

Une seule règle : **les sources ne sont interrogées qu'une fois toutes les
30 minutes**, sauf demande explicite.

- **Automatiquement** — à l'ouverture de l'app, au retour d'arrière-plan, ou
  toutes les 60 secondes pendant que l'app reste au premier plan — les sources ne
  sont réinterrogées que si le dernier lot **réellement
  récupéré** date de plus de **30 minutes**. En deçà, le cache local est servi
  tel quel, **sans le moindre appel réseau** : rouvrir l'app dix fois en dix
  minutes ne déclenche qu'un seul aller-retour vers les sources.
  Dans l'app native, DEUX signaux supplémentaires s'ajoutent, redondants à
  dessein plutôt qu'un choix entre eux (le doublon éventuel est ignoré par
  `loadFeeds` via son compteur de génération) :
  - l'événement `resume` de `@capacitor/app` (`index.html`), plus fiable que
    `visibilitychange` dans cette WebView, mais qui reste relayé par le pont
    JS du plugin ;
  - `onResume()` de l'Activity elle-même (`MainActivity.java`), qui évalue
    directement `loadFeeds()` dans la WebView — un cran plus bas que le
    plugin, donc encore plus fiable, puisqu'il ne dépend d'aucun relais JS
    pour être livré.
  La vérification périodique reste un filet de sécurité en dernier recours :
  sur Android, une app mise en arrière-plan est presque toujours
  **suspendue**, pas tuée — pas de rechargement à froid, et aucun des trois
  signaux n'est formellement garanti au retour (le code le documente déjà pour
  la sauvegarde de position). Sans ce filet, une actualisation qui rate ses
  trois déclencheurs ne se rattraperait jamais, même après des heures. La
  vérification elle-même ne coûte rien : `loadFeeds()` sans `force` ressort
  immédiatement si le seuil n'est pas atteint.
- **Sur demande** — bouton **↻**, *Réessayer*, changement de sources ou de
  centres d'intérêt, import OPML — le seuil est ignoré et les sources sont
  interrogées immédiatement.

La date du dernier chargement est stockée **avec le cache** (localStorage), pas
en mémoire : fermer complètement l'app ne la remet pas à zéro. C'est ce qui rend
le seuil efficace sur mobile, où chaque réouverture était auparavant un
chargement complet.

Quand un rafraîchissement se termine avec de vraies données (automatique ou
↻), le fil remonte en tête : un rafraîchissement toutes les 30 minutes n'a de
sens que si on finit par voir les nouveaux articles, pas seulement les savoir
présents plus bas dans le fil. Cela l'emporte même sur la reprise de lecture au
lancement — rouvrir l'app après une pause ramène en haut dès que le
rafraîchissement (souvent déclenché par le cache périmé) se termine, plutôt que
de rester sur l'article laissé la fois précédente.
Seules les repeintures **progressives** pendant un chargement (un flux qui
répond après l'autre) gardent l'ancrage sur l'article affiché — sans ça, la
carte à l'écran changerait sous les yeux plusieurs fois par seconde.
La moitié Wikipédia est exclue de tout ceci — c'est un tirage aléatoire sans
fin, la recharger ferait perdre le lot en cours (et donc la carte en train
d'être lue, que le tirage suivant ne contient presque jamais). Elle n'est
redemandée que sur une action explicite, ou quand il n'en reste rien.

Le cache conserve le fil mêlé **presque entier** (140 cartes) et non un extrait :
puisqu'il est servi pendant 30 minutes, le tronquer reviendrait à perdre
l'essentiel des articles à chaque relancement.

Un rafraîchissement ne vide jamais un fil déjà affiché : si le réseau échoue, le
contenu reste à l'écran avec un simple message.

Si toutes les sources échouent au tout premier chargement, l'app **n'affiche plus de contenu de démo** : elle montre
un message d'erreur avec les boutons *Réessayer* et *Ouvrir les réglages* — et encore,
seulement si Wikipédia a échoué **aussi** : sans aucune source RSS joignable, la moitié
Wikipédia suffit à faire un fil. Pour une fiabilité
maximale (et pour ne dépendre d'aucun tiers), prévoir un petit backend qui récupère et
parse le RSS côté serveur.

## Développement

Le cœur de l'app reste sans build. Un petit outillage est fourni pour la qualité :

```bash
npm ci            # eslint + prettier (dev uniquement)
npm run lint      # analyse statique de api/, src/ et des tests
npm run format    # formatage (index.html volontairement exclu)
npm test          # tests unitaires (assainissement, parsing, fil mêlé, Wikipédia, anti-SSRF)
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
charger 4 flux RSS en parallèle — un lot Wikipédia (seul, en CORS
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

Dans l'APK, « Lire l'article » (actu) et « Découvrir » (Wikipédia) n'envoient
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

**Partage.** La WebView d'Android n'implémente pas `navigator.share` : dans
l'APK, le bouton partager du fil tombait donc sur le menu de repli
d'`index.html`, une grille de cinq services web codés en dur — alors que c'est
justement la plateforme où l'appareil sait faire beaucoup mieux. Le pont expose
une méthode `share` qui déclenche un `ACTION_SEND` : la feuille de partage du
système s'ouvre, avec **les applications installées**, dans l'ordre des
habitudes de l'utilisateur. Le web garde sa cascade inchangée —
`navigator.share` quand le navigateur l'a, la grille sinon.

**Lecture immersive.** La barre s'efface dès qu'on descend dans l'article et
revient au premier geste vers le haut — même règle que la barre du fil, qui se
masque pendant le swipe. La barre d'état d'Android part avec elle : il ne reste
alors que le texte, et un glissement depuis le haut la ramène sans quitter sa
place dans l'article. Deux détails rendent la chose fluide :

- la barre **coulisse** (`translationY`) au lieu d'être retirée de la mise en
  page — un changement de hauteur de vue relancerait la mise en page du site à
  chaque geste. D'où le `FrameLayout` : la barre flotte au-dessus de la WebView,
  qui ne bouge jamais ;
- les marges latérales/basses viennent de `getInsetsIgnoringVisibility` et non
  de `getInsets` : escamoter la barre d'état changerait sinon ces marges, donc
  la zone de rendu, donc… la mise en page du site, à nouveau. En haut, la
  WebView reçoit une vraie **marge de vue** (`topMargin`, pas un padding) égale
  à la hauteur de la barre. La nuance compte : un padding aurait laissé
  l'en-tête du site partiellement caché sous la barre dès qu'il est en
  `position:fixed`/`sticky` — la norme pour la presse — puisqu'un padding ne
  déplace jamais un élément fixe (modèle de boîte CSS, pas une bizarrerie de
  WebView), alors qu'il continue d'être dessiné dans la zone que la barre
  recouvre. Une marge, elle, réduit les bornes RÉELLES de la WebView : rien ne
  peut plus jamais y être dessiné, fixe ou non. Contrepartie assumée : quand la
  barre s'efface au scroll, la bande qu'elle occupait reste vide un instant au
  lieu de laisser le site en profiter — les deux ne sont pas conciliables sans
  redimensionner la WebView pendant l'animation, ce que le paragraphe
  précédent interdit justement.

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
ne garde que **le titre, le texte et les images**, dans une colonne de liseuse.
Un bouton dans la barre du lecteur bascule à tout moment entre l'article
simplifié et la page complète.

Le principe (`res/raw/reader_read.js`) est celui de Readability — le moteur
derrière les vues lecteur de Firefox et Safari — mais réécrit court : chaque
bloc de la page est noté selon la quantité de texte qu'il porte, pondérée par
sa **densité de liens** (un menu ou un sommaire tend vers 1, un article vers 0)
et par sa signature de classe/id. Le meilleur bloc est élagué, puis la page est
**remplacée** par une version propre. Jeter la feuille de style du site fait
disparaître d'un coup habillage, colonnes, encarts et bandeaux, sans avoir à les
nommer un par un.

Les choix qui comptent :

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
  réintroduire du hasard. Deux exceptions, `colspan` et `rowspan` : elles ne
  décrivent pas une apparence mais la structure d'une grille — sans elles,
  toute cellule fusionnée retombe dans la première colonne, et une infobox
  Wikipédia se lit en colonne étroite avec la moitié droite vide ;
- **ce que la page ne montre pas ne réapparaît pas** : les sites laissent dans
  leur HTML quantité de texte que seule leur feuille de style masque (légendes
  d'icônes, métadonnées de citation, intitulés d'accessibilité, onglets
  repliés, variante mobile de l'article). Cette feuille étant jetée, tout cela
  redeviendrait visible — d'où une mesure du rendu RÉEL de chaque élément,
  faite sur la page d'origine avant l'élagage. Sans elle, un article Wikipédia
  s'ouvrait sur « Si ce bandeau n'est plus pertinent, retirez-le… », légende
  d'une icône de 12 px que personne n'avait jamais vue.

#### La typographie, réglable

Une vue lecteur ne vaut que par le confort qu'elle apporte, et le confort ne se
décide pas à la place du lecteur : le corps du texte (**quatre tailles**) et le
fond (**sombre, sépia, clair**) se choisissent dans le panneau ⚙ Sources, sous
« Ouvrir les articles », et ne s'affichent qu'en mode Lecture — en page complète,
c'est la feuille du site qui décide et ces boutons n'auraient aucun effet. Comme
les autres réglages du lecteur, ils vivent dans le `localStorage` du web et sont
transmis au natif **à chaque ouverture** ; l'activité ne conserve rien.

Le reste de la mise en page vise la même chose, et tient à peu de décisions :

- **la césure** (`hyphens: auto`), sans quoi le français, avec ses mots longs sur
  une colonne étroite, laisse un bord droit en dents de scie et des lignes à
  moitié vides — c'était le défaut le plus visible du lecteur ;
- **un interlignage resserré** (1,6 et non 1,72) : sur une mesure courte, trop
  d'air disperse le regard au lieu de le guider ;
- **une mesure plafonnée** à 33 em, au-delà de quoi l'œil perd le début de la
  ligne suivante — sans effet sur un téléphone, décisif sur une tablette ;
- **des liens discrets** : dans un article on les suit rarement du doigt, et une
  couleur vive à chaque ligne hache la lecture. Le soulignement suffit à les
  désigner ;
- **une jauge de lecture en bas de l'écran**, 2 px : la barre du haut s'escamote
  pendant la lecture, et c'est justement là qu'on veut savoir où l'on en est ;
- **le temps de lecture** à côté de la source, sur la même ligne : il ne sert pas
  à mesurer mais à décider — « j'ai le temps, ou pas ».

Les fonds clairs demandent deux précautions côté natif : la WebView porte la
couleur de la page **avant le premier rendu** (sinon le fond sombre apparaît une
fraction de seconde), et son assombrissement automatique — celui qui rend
lisibles les sites sans thème sombre — est coupé, faute de quoi elle repeindrait
le sépia en gris.

Enfin, quelques défauts d'extraction que la remise à plat rendait voyants :

- **les blancs** laissés par un conteneur vidé de son encart, qui garde sa boîte
  et donne plusieurs lignes vides au milieu du texte : les blocs sans texte ni
  image sont supprimés, en deux passes, un parent ne devenant vide qu'une fois
  ses enfants partis ;
- **le titre écrit deux fois**, la plupart des sites le répétant dans le corps de
  l'article, juste sous celui que le lecteur affiche déjà ;
- **le titre raccourci**, quand la page sert en `og:title` une version écrite
  pour les réseaux — « Zelensky limoge l'ambassadrice… » là où l'article titre
  « Guerre en Ukraine : le président Volodymyr Zelensky limoge… » : le début
  manquait, alors que le `<h1>` de la page l'avait. Il est donc préféré dès
  qu'il contient le titre retenu et le dépasse ; et dans l'autre sens, quand le
  `<title>` n'ajoute qu'une enseigne (« — Le Monde »), c'est encore le `<h1>`
  qui donne la bonne version. Bornée à 200 caractères, pour qu'un paragraphe
  balisé en `<h1>` ne devienne pas un titre ;
- **les premières lignes du titre cachées derrière la barre** du lecteur : la
  place de la barre est désormais réservée par la page elle-même
  (`--sn-top`, transmis à l'injection et corrigeable à chaud pour la rotation),
  et non plus par la marge de la WebView — une seule marge, posée là où le
  texte est mis en page ;
- **les étiquettes d'habillage** (« Publicité », « Partager », « À lire aussi »)
  quand elles forment le texte **entier** d'un bloc — la comparaison ne porte
  jamais sur une occurrence, sans quoi un article traitant de publicité y
  passerait ;
- **le `<title>` de la page**, que le remplacement du `<head>` emportait : sans
  lui, la WebView rapporte l'URL comme titre, et c'est l'URL brute qui
  s'affichait dans la barre du lecteur ;
- **le `<source>` d'un `<picture>`**, qui l'emporte sur le `src` rétabli et
  ramenait l'image différée d'origine ;
- **un tableau plus large que l'écran**, qui élargissait la page entière : il
  défile désormais dans sa propre boîte.

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
*Dans l'app*, *Lecture* (défaut) ou *Navigateur*, mémorisé dans
`fluxswipe.readpref.v1`. Sur *Navigateur*, `openArticle()` rend `false` et le
lien repart au navigateur du téléphone, exactement comme avant l'ajout du
lecteur. Deux autres réglages, « Bandeaux cookies : Masqués / Affichés »
(`fluxswipe.cookiebanner.v1`, masqués par défaut) et « Publicités et traceurs :
Bloqués / Affichés » (`fluxswipe.ads.v1`, **affichés** par défaut),
n'apparaissent que quand le lecteur est actif — sans lui, la question ne se
pose plus. Les trois préférences vivent côté web et sont
transmises à chaque ouverture (`hideCmp`, `blockAds`) : le natif ne garde aucun
état. Le réglage figure en bas du panneau unique, sous les sources :
`renderReadPref()` remplit le point de montage `[data-readmount]` depuis un état
unique (il y en avait un par panneau tant qu'il y en avait deux). Il n'apparaît
pas sur le web, où un
lien s'ouvre forcément dans un onglet, ni pendant l'accueil du premier
lancement, où l'on ne demande qu'une chose à la fois. Le lecteur garde par
ailleurs son bouton « ouvrir dans le navigateur » pour les cas ponctuels.

**Icône et écran de démarrage** : générés par [`@capacitor/assets`](https://github.com/ionic-team/capacitor-assets)
à partir de `resources/`. Le logo est un carré à coins arrondis rempli d'un
dégradé vertical orange → rouge, portant une carte blanche et une ampoule ;
il en existe **trois formes**, et savoir laquelle va où est tout l'intérêt de
cette section :

| Forme | Où | Pourquoi |
| --- | --- | --- |
| **Coins arrondis** (coins transparents) | `logo-192/512.png`, écrans de démarrage, vignettes F-Droid | Personne ne masque ces images : elles doivent porter leur propre arrondi |
| **Plein bord** (dégradé prolongé jusqu'aux bords du carré) | `logo-maskable-512.png`, `resources/icon.png`, `resources/icon-background.png` | Tout ce qui **subit un masque**. Un masque circulaire mord au-delà des coins arrondis : sans plein bord, il découperait dans le vide et laisserait des encoches transparentes |
| **Contenu seul** (carte + ampoule sur fond transparent) | `resources/icon-foreground.png` | Calque avant de l'icône adaptative, posé sur le dégradé du calque arrière — c'est ce qui permet au lanceur de les animer séparément |

Le fond de l'icône adaptative n'est donc plus transparent : le logo **apporte
son propre fond**, et un aplat imposé par le lanceur n'est plus à craindre —
c'est le dégradé du logo qui remplit le masque, quelle que soit la forme
choisie par l'OEM.

Deux marges de sécurité, à ne pas confondre :

- **maskable (PWA)** — seul un cercle de 80 % de diamètre est garanti visible.
  Le contenu du logo source monte à 0,452 de la largeur, au-delà des 0,40
  admis : `logo-maskable-512.png` le réduit donc à **0,884** avant de le poser
  sur le dégradé plein bord ;
- **icône adaptative (Android)** — `mipmap-anydpi-v26/ic_launcher.xml` insère
  les deux calques à 16,7 %, ce qui ramène 0,452 sous la limite. Le contenu
  passe tel quel, sans réduction supplémentaire.

Écrans de démarrage `splash*.png` : logo centré à 16,3 % de la largeur sur la
couleur de thème `#0a0a0f` — `@capacitor/assets` les redimensionne en `cover`,
donc tout ce qui compte doit rester près du centre.

Après une mise à jour du logo à la racine, régénérer avec :

```bash
python3 tools/gen_logo.py tools/logo-source-1024.png   # dépend de Pillow
npm run android:assets
```

`tools/gen_logo.py` fabrique les trois formes depuis un unique PNG source
1024×1024 — `tools/logo-source-1024.png`, versionné pour que tout soit
regénérable : il reconstitue le dégradé ligne par ligne (il est purement
vertical) pour le prolonger jusqu'aux bords, et en déduit le contenu par
écart au dégradé. Il produit aussi les vignettes Fastlane et les écrans de
démarrage ; il ne touche ni au `?v=` ni à `android/`, d'où les deux rappels
qu'il affiche en terminant.

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

`versionName` vaut la version de `package.json` suffixée du numéro de run, et
`versionCode` place ce numéro **sous le palier** de la version que
`android/app/build.gradle` prépare : un APK de `main` est une préversion de
celle-ci, numérotée entre le tag précédent et celui à venir.

```
tag v1.3.1 ....... 10301        (ancienne échelle, avant élargissement)
main build 77 .... 103010077    = 103020000 − 10000 + 77
tag v1.3.2 ....... 103020000
main build 80 .... 103020080    (préversion de 1.3.3)
tag v1.3.3 ....... 103030000
```

Le numéro de run **seul** ne suffisait pas : il vit sur une échelle sans rapport
avec celle des versions publiées. Un APK de `main` portant « 76 » face au
« 10301 » du tag `v1.3.1` était une **rétrogradation** pour Android, donc
impossible à installer par-dessus sans désinstaller d'abord — le symptôme qui a
motivé l'élargissement. Ajouter au palier au lieu de soustraire aurait produit
l'erreur inverse : des builds CI au-dessus du tag de leur propre version, qui
serait devenu ininstallable par-dessus eux.

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

- **Actus** : `api/feed.js` (proxy RSS durci) ou, en repli, proxys CORS publics.
- **Images, statut payant et sponsoring d'auteur** : `api/og.js` lit la page
  d'un article pour TROIS signaux distincts, extraits d'une même requête —
  jamais deux appels pour une seule page. Image : quand un flux ne publie
  qu'une vignette (Franceinfo sert des URL Thumbor **signées** en 432 px, où
  la taille fait partie de la signature — donc non modifiable) ou n'en publie
  **aucune**, `api/og.js` va lire la balise `og:image` de l'article, qui
  pointe vers la version pleine taille ou comble l'absence. Statut payant : le
  signal `isAccessibleForFree` (JSON-LD schema.org, celui qu'utilise Google
  Actualités) est cherché dans la même page. Sponsoring d'auteur : certains
  partenariats commerciaux ne se déclarent QUE via le lien de byline vers la
  fiche de l'auteur (`isSponsoredHtml`, `src/lib.js` — cas connu : « L'équipe
  Promo » de Les Numériques), jamais dans le flux RSS ni le titre/résumé. Les
  deux derniers signaux sont lus plus profondément que la simple balise
  `og:image` (paramètre `deep=1`) quand le domaine appartient à une liste de
  candidats (`isPaywallCandidateDomain` / `isSponsorCandidateDomain`,
  `src/lib.js`), parce qu'ils vivent souvent après le `<head>` sur les sites en
  rendu serveur (Next.js et consorts), là où `og:image` seul n'a jamais besoin
  d'aller chercher aussi loin. Résultat mémorisé côté client (un seul cache
  pour les trois signaux) et mis en cache 24 h par le CDN. Un article confirmé
  sponsorisé par ce biais est retiré du fil (`checkSponsor`, index.html) —
  contrairement au paywall (simple badge), puisque `filterSponsored` dit que
  l'utilisateur ne veut voir aucun contenu promotionnel.
- **Wikipédia** : `api/learn.js` agrège **côté serveur** les catégories
  demandées (cache CDN mutualisé entre utilisateurs). Le front l'appelle en priorité et
  se rabat sur son agrégation client si l'endpoint n'est pas déployé (hébergement statique).
- **Code partagé** : `src/lib.js` (fonctions pures : assainissement, parsing OPML/JSON,
  dates, entrelacement du fil) et `src/learn-core.js` (catégories, URL et
  normaliseurs Wikipédia) sont
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
- Les icônes PNG restent en couleurs vraies (`logo-512.png` pèse ~38 Ko). La
  quantification par palette qui allégeait l'ancien logo fait border le dégradé
  du nouveau : le gain de poids ne vaut pas la dégradation visible.
- Le contenu des articles (RSS, Wikipédia) n'est pas traduit : seule
  l'interface l'est. Les dates relatives (« il y a 3 jours ») restent aussi en
  français quelle que soit la langue choisie — `relTime()` n'est pas encore
  internationalisée (voir `src/i18n.js`).

## Licence

MIT
