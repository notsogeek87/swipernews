# Pull Request - SwiperNews

## Type de changement

- [ ] 🐛 **Correction de bug** (fixe un problème existant)
- [ ] ✨ **Nouvelle fonctionnalité** (ajoute une fonctionnalité)
- [ ] 🔧 **Refactorisation** (changement de code sans modification fonctionnelle)
- [ ] 📝 **Documentation** (mise à jour de la documentation)
- [ ] 🎨 **UI/UX** (amélioration de l'interface ou de l'expérience utilisateur)
- [ ] ⚙️ **Configuration** (modification de configuration, CI/CD, etc.)
- [ ] 🔒 **Sécurité** (correction de vulnérabilité ou amélioration sécurité)
- [ ] 🗑️ **Nettoyage** (suppression de code mort, dépendances, etc.)

## Description

**Contexte** : Expliquez brièvement le contexte et la motivation de ce changement.

**Modifications** : Décrivez les changements effectués.

**Impact** : Quel est l'impact sur l'application ? (performance, comportement, compatibilité, etc.)

## Vérifications effectuées

- [ ] ✅ Code compilé et testé localement
- [ ] ✅ `npm run lint` passe sans erreur
- [ ] ✅ `npm run format:check` passe sans erreur
- [ ] ✅ `npm test` passe sans erreur
- [ ] ✅ Testé sur **Web (PWA)**
- [ ] ✅ Testé sur **Android (APK)**
- [ ] ✅ Vérifié le bump de version si `index.html` ou `src/*.js` modifié
- [ ] ✅ Documentation mise à jour si nécessaire

## 📋 Checklist spécifique SwiperNews

### ⚠️ RÈGLES ABSOLUES (à cocher si applicable)

- [ ] ❌ **J'ai modifié `index.html` ou `src/*.js`** → J'ai bumpé :
  - [ ] `APP_VERSION` dans `index.html`
  - [ ] `?v=` dans les balises `<script src="src/...">`
  - [ ] `CACHE` dans `sw.js` (`flux-vN`)

- [ ] ✅ **Je n'ai PAS activé `CapacitorHttp` globalement** (utilisé `nativeGet()` explicitement pour RSS seulement)

- [ ] ✅ **Je n'ai PAS accepté les bandeaux de consentement** (masquage seulement, jamais cliqué)

- [ ] ✅ **Je n'ai PAS bloqué le fil de se charger** (toutes les données locales sont validées)

### 🔍 Tests recommandés

- [ ] Banc de QA : `node tools/qa-scenarios.js` (si modification du fil, cache, ou état)
- [ ] Scénario `forcetop` : vérifie la remontée en tête
- [ ] Scénario `teteouverture` : vérifie l'ouverture à froid
- [ ] Scénario `lentnews` : vérifie les sources lentes
- [ ] Scénario `video` : vérifie les vidéos YouTube

## 🔗 Liens utiles

- **Issue** : Closes #
- **Documentation** : [README.md](README.md) | [AGENTS.md](AGENTS.md) | [.vibe/instructions.md](.vibe/instructions.md)
- **CI** : [![CI](https://github.com/notsogeek87/swipernews/actions/workflows/ci.yml/badge.svg)](https://github.com/notsogeek87/swipernews/actions/workflows/ci.yml)

## 📝 Notes supplémentaires

Ajoutez ici toute information complémentaire :
- Captures d'écran (si UI/UX)
- Benchmarks (si performance)
- Comportements attendus vs observés
- Questions pour les reviewers

---

*Merci pour votre contribution ! 🙏*
*Rappel : Tout est en français - commentaires, messages de commit, interface.*
