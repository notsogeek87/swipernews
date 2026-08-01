# Flux — actus RSS en swipe

Une application web (PWA) qui affiche des flux RSS en mode swipe vertical, à la TikTok.
Un seul fichier, aucune dépendance, aucun build.

## Fonctionnalités

- Navigation par swipe vertical plein écran (flèches ↑↓ / espace au clavier aussi)
- Titre, résumé, image, source et date tirés directement des flux RSS
- Gestion des sources : ajout, suppression, activation/désactivation
- Import / export des sources aux formats **OPML** (standard) et **JSON**
- Partage d'un article (feuille de partage native, ou menu WhatsApp / Telegram / mail / X / copie du lien)
- Favoris et bouton de partage sur chaque carte
- Installable comme application (PWA) avec fonctionnement hors-ligne
- Mode démo automatique si les flux ne sont pas joignables

## Lancer en local

Ouvrir `index.html` dans un navigateur suffit pour tester le swipe.

Pour que l'**installation PWA** et le service worker fonctionnent, il faut servir la page
en HTTP local plutôt qu'en `file://` :

```bash
python3 -m http.server 8000
# puis ouvrir http://localhost:8000
```

## Mise en ligne

N'importe quel hébergement statique convient (le fichier est autonome) :

- **GitHub Pages** : Settings → Pages → Branch `main` / dossier `/root`
- **Netlify / Vercel** : glisser-déposer le dossier, ou connecter le dépôt

## Limites connues

- Un navigateur ne peut pas lire un flux RSS directement (CORS). L'app passe par des
  proxys publics de secours. Pour une version fiable, prévoir un petit backend qui
  récupère et parse le RSS côté serveur.
- Les favoris ne sont pas encore persistants entre sessions.

## Licence

MIT
