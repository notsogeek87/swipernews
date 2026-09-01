# Paysage large : le volet de gauche

**Statut :** adopté (APP_VERSION 256, 2026-09-01)
**Concerne :** `index.html` (CSS « Les DEUX paysages » / « Paysage LARGE », JS
`majVolet` / `sauterVersHk`), `src/i18n.js` (`volet.count`).

## Pour qui, pourquoi

Pour qui lit SwiperNews sur un écran **large et couché** : pliant déplié
(Galaxy Z Fold : 1848×2448 pixels, soit ~1224×924 points CSS une fois couché),
tablette, ou simple fenêtre de navigateur sur ordinateur.

Jusqu'ici l'app ne connaissait qu'un seul paysage, celui du téléphone couché,
et y répondait par un verrou d'orientation (« Remets ton téléphone à la
verticale »). Deux comportements en découlaient, tous deux mauvais sur un
grand écran :

- un pliant déplié couché **tombait dans le verrou** (sa largeur, ~979 à
  ~1224 points selon la densité, passe sous ou près de la borne des 1024 px) :
  l'app refusait de s'afficher sur l'écran qui lui donne pourtant le plus de
  place ;
- au-dessus de 1024 px (fenêtre desktop), le fil s'affichait mais **une carte
  faisait toute la largeur** : image étirée, titre sur 100 caractères de long.

## La décision

Séparer les deux paysages **par la hauteur**, et donner au paysage large un
second volet.

### 1. Le critère : la géométrie, jamais l'appareil

|                                          | Largeur | Hauteur   | Comportement                    |
| ---------------------------------------- | ------- | --------- | ------------------------------- |
| Téléphone couché                         | ≤ 1024  | **< 560** | Verrou d'orientation (inchangé) |
| Pliant déplié, tablette, desktop couchés | ≥ 900   | **≥ 560** | Fil + volet                     |
| Tout le reste (portrait)                 | —       | —         | Fil plein écran (inchangé)      |

560 px de hauteur sépare les deux catégories sans ambiguïté possible : être
**haut** de 560 une fois couché, c'est être **large** de 560 debout, et aucun
téléphone ne l'est (les plus grands plafonnent vers 480 points CSS). Le seuil
ne peut donc jamais se tromper de catégorie, quel que soit l'appareil.

C'est la même règle que pour le poinçon de caméra (voir « Poinçon de caméra et
barre d'état » dans le README) : **on mesure la géométrie, on ne devine pas le
matériel**. Ni `display-mode`, ni les capacités d'entrée (`hover`/`pointer`,
rapportées de façon peu fiable par plusieurs navigateurs mobiles), ni un nom
d'appareil.

Conséquence voulue : un pliant déplié en **portrait** (~924×1224) reste en fil
plein écran. Il est large, mais c'est déjà l'orientation du geste.

### 2. Le volet : la liste existante, posée à demeure

Le volet n'invente aucune vue. C'est la feuille « Articles en mémoire »
(`histRowHTML`), aux **mêmes rangées** et avec le **même saut**
(`sauterVersHk`, extrait pour être partagé par les deux). Elle existait déjà
et se cherchait déjà en plein milieu d'une lecture ; sur un écran assez large,
elle n'a plus à recouvrir le fil pour se montrer.

Une seule différence : le volet est **vivant**. La feuille est refaite à chaque
ouverture puis ne bouge plus (une liste qui se recompose sous le doigt pendant
qu'on la parcourt serait pire qu'inutile) ; un volet toujours à l'écran doit
suivre le fil. D'où deux granularités de mise à jour, et pas une :

|                           | Quand                                                 | Coût                                   |
| ------------------------- | ----------------------------------------------------- | -------------------------------------- |
| **Refonte** (`voletSale`) | après un `render()`, le seul moment où `items` change | reconstruit les rangées                |
| **Repère** (`voletCle`)   | à chaque frame de défilement, via `onCardChange()`    | déplace les classes `--now` / `--past` |

Refaire l'`innerHTML` à chaque frame rechargerait les vignettes de tout le fil
et casserait le défilement du volet à chaque swipe.

### 3. L'invariant qui rend tout cela sûr

> **La géométrie VERTICALE du fil ne bouge pas d'un pixel.**

Les cartes font toujours `100dvh`, le `scroll-snap` est le même, `offsetTop`
mesure la même chose. Seule la **largeur** du fil est réduite :

```css
#feed {
  margin-left: var(--volet);
  width: calc(100% - var(--volet));
}
```

C'est ce qui permet à `currentIndex()`, `scrollToCard()`, `rememberPos()`, au
filet de `scrollFix` et à la reprise de lecture de continuer à marcher **sans
une ligne de changement**. Ne pas défaire : dès qu'une carte cesse de faire une
hauteur d'écran, c'est tout le suivi de position qui est à reprendre.

### 4. Ce qui suit le fil, et ce qui suit l'écran

Ce qui se pose **sur le fil** est décalé de la largeur du volet
(`.top`, `.state`), sinon le flou et le dégradé de la barre du haut
recouvrent les premières rangées de la liste. Ce qui se **centre** se centre
sur le fil et non sur l'écran (`.hint`, `.peek`, `.toast`, `.demobadge`) :
centré sur l'écran, un toast tomberait à cheval sur le volet.

Les feuilles, elles, restent des calques plein écran (elles recouvrent aussi le
volet) mais gagnent un plafond de largeur — sauf `#menuSheet`, le tiroir
latéral ancré à droite sous le bouton qui l'ouvre.

### 5. La carte, recomposée en hero paysage

Le volet seul ne suffisait pas, et le retour a été immédiat : « la partie de
droite est pas top niveau style, on dirait que ça prend pas tout l'écran ».
Une carte est dessinée pour le **portrait** — image plein cadre, texte ancré en
bas, dégradé qui monte du bas. Couchée, cette composition ne tient plus :

| Symptôme                                      | Mesure                                          |
| --------------------------------------------- | ----------------------------------------------- |
| Le bloc de texte reste collé en bas à gauche  | titre plafonné à 465 px dans un panneau de 1260 |
| La moitié droite est vide                     | ~700 px sans rien                               |
| Le dégradé vertical noircit la moitié basse   | réglé pour un texte en pied de carte haute      |
| De la photo, il ne reste qu'une bande délavée | le reste est sous le dégradé                    |

Trois gestes, un seul principe — **le texte devient une colonne à gauche, la
photo redevient une photo à droite** :

1. le bloc de texte est borné (`min(640px,60%)`) et **centré verticalement** ;
2. le dégradé passe à l'**horizontale** : opaque sous la colonne, il se lève
   vers la droite et rend l'image visible au lieu de l'écraser ;
3. le titre grandit — `clamp(30px,3.2vw,46px)`, contre un plafond de 38 px
   taillé pour une largeur de téléphone.

**L'image reste plein cadre**, jamais confinée à la moitié droite. Cette
variante a été essayée et rendue : un cadre de 700×1000 rogne 60 % de la
largeur d'une photo de presse en 16:9, qui n'est alors plus lisible. Plein
cadre sur 1260×1000, la même photo ne perd que 29 % — la carte large rogne donc
**moins** que la carte portrait d'un téléphone (74 %). Ce n'était jamais le
cadrage qu'il fallait corriger, c'était le dégradé qui cachait le résultat.

Trois effets de bord traités dans le même mouvement, aucun visible en lecture
de code :

- **le flou local** derrière le texte (`.card--img .card__body::before`) est
  solidaire du bloc : borné en largeur et en hauteur, il devenait un rectangle
  flou posé au milieu de l'image, avec une arête nette à droite et en bas (son
  masque ne fond que vers le haut). Il est retiré — le dégradé horizontal fait
  déjà tout le travail sous la colonne ;
- **le ▶ d'une carte vidéo** est centré sur la carte : avec le texte au milieu
  à gauche, il tombait dessus (icône à 453 px, colonne s'arrêtant à 547 px). Un
  `padding-left` le pousse dans la moitié restée à l'image, sans toucher à sa
  cible, qui reste la carte entière ;
- **la carte à parts égales** (`cardsPerSwipe>1`) n'a pas de `.card__body` et
  échappait donc à tout : ses lignes couraient sur 1 500 px, et surtout ses
  deux boutons (enregistrer, partager) se retrouvaient à l'autre bout de
  l'écran, loin du titre auquel ils se rapportent. Borner `.pvrow__body` les
  ramène contre lui.

`justify-content:safe center` n'est pas décoratif : un bloc plus haut que la
carte (titre long + description à 10 lignes sur une fenêtre juste au-dessus du
seuil de 560 px) déborderait des deux côtés avec un `center` nu, et c'est le
haut — le titre — qui serait rogné. Les moteurs qui ne connaissent pas `safe`
ignorent la déclaration et gardent le `center` de la ligne précédente :
dégradation acceptable, jamais une carte cassée.

## Coût sur téléphone

Nul, ou presque : `majVolet()` sort à sa première ligne sur un
`matchMedia().matches` faux, et le CSS masque le volet en `display:none` (donc
aussi pour les lecteurs d'écran). Le balisage du volet est posé **après** le
fil dans le document, pour qu'il reste lu en second — il n'est qu'un raccourci
vers lui.

## Vérifié

Chromium, réseau simulé, six formats : pliant couché (1224×924) et debout
(924×1224), téléphone couché (932×430) et debout (390×844), iPad mini couché
(1024×768), fenêtre desktop (1600×900). Le volet n'apparaît que dans les trois
formats larges couchés, le verrou que sur le téléphone couché ; le saut depuis
une rangée atterrit sur la bonne carte et le repère suit le défilement du fil.
Scénarios du banc de QA rejoués sans régression : `forcetop`, `teteouverture`,
`redites`, `memoire`, `video`, `corruptcache`, `back`.

La recomposition de la carte a été rendue sur les **cinq formes de carte** —
article avec image, article sans image, Wikipédia, vidéo (façade et en
lecture), parts égales à N=3 — et sur une fenêtre courte (1100×600) pour
vérifier qu'un bloc centré n'y est pas rogné. Le portrait et le téléphone
couché ont été remesurés après coup : `justify-content:flex-end`, pas de
`max-width`, padding 28/22 px, flou local présent, dégradé vertical — soit
exactement l'état d'avant, aucune règle ne fuit hors du paysage large.
