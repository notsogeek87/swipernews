# Instructions pour Vibe Code - SwiperNews

## Contexte du Projet

**SwiperNews** (`news.lielu.eu`) est une application **PWA + APK Android** qui permet de lire des articles au **swipe vertical plein écran**, comme un fil de réseau social. L'application combine deux types de contenu :

- **📰 Les actus** - Flux RSS choisis par l'utilisateur (pas d'algorithme, pas de compte)
- **🎓 Wikipédia** - Articles tirés au hasard, filtrables par centres d'intérêt

**Philosophie technique** : Reprendre le geste des réseaux sociaux **sans** ce qui va avec (pas de compte, pas de télémétrie, pas de dépendance à un service tiers).

## Architecture Technique

### Stack

- **Frontend** : HTML/CSS/JS natif, **un seul fichier** (`index.html`) - zéro build, zéro dépendance à l'exécution
- **Backend** : Fonctions serverless Vercel (`api/feed.js`, `api/learn.js`, `api/og.js`)
- **Mobile** : Capacitor 8 + Android natif (WebView avec pont JS↔Java)
- **CI/CD** : GitHub Actions (lint, tests, build APK, release)

### Structure des fichiers

```
.
├── index.html          # Application complète (CSS + JS en ligne)
├── src/                # Fonctions pures partagées (lib.js, i18n.js, learn-core.js)
├── api/                # Endpoints serverless (feed, learn, og)
├── android/            # Projet Capacitor natif
├── sw.js              # Service Worker (cache, hors-ligne)
├── .github/workflows/  # CI/CD (ci.yml, android.yml, release.yml)
└── package.json        # Scripts de dev (lint, format, test, cap:sync)
```

## Instructions pour Vibe Code

### 1. Règles Absolues (à NE JAMAIS enfreindre)

❌ **NE PAS TOUCHER à `index.html` sans bump de version**

- `index.html` et `src/*.js` forment un ensemble **indivisible**
- Toute modification de ces fichiers DOIT être accompagnée d'un bump de :
  - `APP_VERSION` dans `index.html`
  - `?v=` dans les balises `<script src="src/...">`
  - `CACHE` dans `sw.js` (`flux-vN`)
- **Conséquence** : Un `index.html` neuf avec un `src/lib.js` périmé casse l'app

❌ **NE PAS ACTIVER `CapacitorHttp` globalement**

- Utiliser `nativeGet()` **explicitement** pour les flux RSS seulement
- L'activation globale ralentit Wikipédia (mesuré : ~3,2s vs direct)

❌ **NE PAS ACCEPTER les bandeaux de consentement**

- Les bandeaux cookies **doivent être MASQUÉS**, jamais cliqués
- Ne pas répondre à une demande de consentement = refus (option la plus protectrice)

❌ **NE PAS CHANGER la licence**

- Le projet est **GPL-3.0-or-later**
- Les listes de blocage (EasyList) sont **téléchargées**, jamais embarquées (pour rester compatible GPL)

❌ **NE PAS BLOQUER le fil de se charger**

- Aucune donnée locale (`localStorage`) ne doit empêcher le chargement
- Toujours valider les données locales (`sanitizeFeeds`, `usableItem`, `readObject`)
- La peinture du cache doit être enveloppée de `try/catch`

### 2. Conventions de Code

#### JavaScript

- **Type** : `"type": "commonjs"` dans `package.json` (pour l'instant)
- **Style** : Compact dans `index.html` (peu d'espaces, accolades sur la même ligne) - **NE PAS reformater**
- **Style** : Normal dans `src/` et `api/` (ESLint + Prettier)
- **Tests** : `node --test test/*.test.js` (146 tests, aucune dépendance)

#### CSS

- Variables CSS dans `:root` pour les thèmes
- Chaque thème alternatif = `:root[data-apptheme="..."]` qui redéclare les variables
- Utiliser `--redline-rgb` et `--blush-rgb` (triplets R,G,B) pour les fonctions CSS avec opacité

#### Nommage

- **Français** : Tout est en français (commentaires, messages de commit, interface)
- **Préfixes** :
  - `sn-` pour les classes CSS de SwiperNews
  - `data-*` pour les attributs de montage (ex: `[data-readmount]`)

### 3. Workflows Importants

#### Versionnage

```bash
# Après toute modification de index.html ou src/*.js
# Bumper dans index.html:
APP_VERSION="1.5.1"
# Bumper dans les scripts:
<script src="src/lib.js?v=151">
# Bumper dans sw.js:
const CACHE = "flux-v151"
```

#### Version Android

- `versionCode` = majeur × 10⁸ + mineur × 10⁶ + correctif × 10⁴
- Exemple : v1.3.2 → 103020000
- **NE PAS** utiliser de variables Groovy dans `build.gradle`

#### Build APK

```bash
npm ci
npm run cap:sync    # Régénère www/ puis cap sync android
cd android && ./gradlew assembleDebug
# → android/app/build/outputs/apk/debug/app-debug.apk
```

### 4. Points d'Attention Spécifiques

#### Fil Unique

- Les deux moitiés (actus + Wikipédia) partagent **une seule décision de fraîcheur** (`perime`)
- L'entrelacement se fait via `remix()` = `interleave(newsItems, learnItems, mixLevel())`
- **NE PAS** geler le fil sur un renouvellement (seulement sur un appoint)

#### Reprise de Lecture

- L'app rouvre sur l'article quitté
- Si l'article a disparu du flux → repli sur le repère temporel puis sur l'index
- **NE PAS** laisser le fil périmé visible à l'écran pendant le remplacement

#### Lecteur Intégré (Android)

- `openArticle(url, title)` = point d'entrée unique
- Masquage des bandeaux cookies via `res/raw/reader_cmp.js`
- Mode lecture via `res/raw/reader_read.js`
- Blocage des pubs via `res/raw/reader_ads.js`

#### Service Worker

- `index.html` et `src/*.js` servis **réseau d'abord** (cache = hors-ligne seulement)
- `sw.js`, `index.html`, manifeste servis avec `max-age=0, must-revalidate`

### 5. Outils de Développement

#### Scripts Disponibles

```bash
npm run lint        # ESLint sur api/ src/ test/ eslint.config.js
npm run format      # Prettier --write .
npm run format:check # Prettier --check
npm run test        # node --test test/*.test.js
npm run cap:prepare # Prépare www/ pour Capacitor
npm run cap:sync    # cap:prepare + cap sync android
```

#### Test Local

```bash
# Web (PWA)
python3 -m http.server 8000

# Android (nécessite SDK Android)
npm run cap:sync
cd android && ./gradlew assembleDebug
```

### 6. CI/CD

#### Workflows GitHub

- `ci.yml` : Lint + Format check + Tests (sur push vers main/staging ou PR)
- `android.yml` : Build APK (sur push vers main/staging ou PR)
- `release.yml` : Build APK de publication (sur tag `vX.Y.Z`)
- `play-store-bundle.yml` : Build AAB + Publication Google Play (manuel)

#### Règles CI

- **Un push sur une branche de travail SEUL ne déclenche RIEN**
- Pour déclencher un build Android : pousser vers `main`, `staging`, ou ouvrir une PR
- Le `versionCode` des builds CI = `versionCode(build.gradle) - 10000 + numéro_de_run`

### 7. Documentation de Référence

- **README.md** : Le "pourquoi" de chaque choix technique
- **AGENTS.md** : La carte du code et les décisions à ne pas défaire
- **AUDIT-\*.md** : Audit de robustesse et corrections apportées
- **docs/architecture/** : Décisions architecturales détaillées

### 8. Bonnes Pratiques

✅ **Toujours** :

- Valider les entrées utilisateur
- Gérer les erreurs gracefully (ne jamais laisser l'app en état mort)
- Respecter la philosophie "zéro dépendance, zéro télémétrie"
- Tester sur mobile (le comportement peut différer du web)

❌ **Jamais** :

- Ajouter une dépendance sans justification forte
- Modifier le comportement natif sans tester sur Android
- Supprimer les garde-fous (try/catch, validations)
- Changer la structure sans mettre à jour la documentation

### 9. Contacts et Ressources

- **Site** : https://news.lielu.eu
- **Repository** : https://github.com/notsogeek87/swipernews
- **Licence** : GPL-3.0-or-later

---

_Ce fichier est spécifique à Vibe Code. Pour les instructions générales aux agents IA, voir `AGENTS.md`._
