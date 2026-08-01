# Flux — actus RSS en swipe

Une application web (PWA) qui affiche des flux RSS en mode swipe vertical, à la TikTok.
Un seul fichier, aucune dépendance, aucun build.

## Fonctionnalités

- Navigation par swipe vertical plein écran (flèches ↑↓ / espace au clavier aussi)
- Titre, résumé, image, source et date tirés directement des flux RSS
- Gestion des sources : ajout, suppression, activation/désactivation
- Import / export des sources aux formats **OPML** (standard) et **JSON** — importe tes sources et lis-les directement
- Partage d'un article (feuille de partage native, ou menu WhatsApp / Telegram / mail / X / copie du lien)
- Favoris et bouton de partage sur chaque carte
- **Mode Apprendre** 🎓 : un sélecteur à deux onglets en haut (**📰 Actus** / **🎓 Apprendre**, l'actif surligné) bascule le fil vers des articles Wikipédia aléatoires pour swiper en apprenant. Le fil est **sans fin** — de nouveaux articles se chargent automatiquement en approchant du bas — le bouton **↻** repart sur une nouvelle fournée, et le mode est mémorisé entre les sessions.
- Installable comme application (PWA) avec fonctionnement hors-ligne
- En mode actus, si un flux est injoignable, un message clair invite à réessayer ou à revoir ses sources (plus de faux contenu de démo)

## Mode Apprendre

Un bouton **🎓 Apprendre** (barre du haut) fait passer l'app en mode découverte :
le fil n'affiche alors que des articles **Wikipédia** tirés au hasard (titre, extrait,
image, lien vers l'article). L'ambiance change (accent cyan + badge) pour bien distinguer
les deux univers, et un nouvel appui sur **📰 Actus** revient aux flux RSS.

Les articles viennent de l'API REST de Wikimedia
(`/api/rest_v1/page/random/summary`), qui autorise le CORS : aucun proxy n'est
nécessaire côté navigateur. Un repli démo s'affiche si l'API n'est pas joignable.
La langue par défaut est le français (`WIKI_LANG="fr"` dans `index.html`).

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

Si toutes les sources échouent, l'app **n'affiche plus de contenu de démo** : elle montre
un message d'erreur avec les boutons *Réessayer* et *Ouvrir les sources*. Pour une fiabilité
maximale (et pour ne dépendre d'aucun tiers), prévoir un petit backend qui récupère et
parse le RSS côté serveur.

## Limites connues

- La récupération RSS dépend de services tiers gratuits (rss2json / proxys publics), qui
  peuvent être limités en débit ou temporairement indisponibles.
- Les favoris ne sont pas encore persistants entre sessions.

## Licence

MIT
