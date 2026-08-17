// Couche de traduction de l'interface, PARTAGÉE entre le navigateur et les
// tests Node (même mécanique que src/learn-core.js : chargé en <script src>
// classique dans index.html, et en require() côté test).
//
// Le français est la langue SOURCE, complète par construction (voir CLAUDE.md :
// "Tout est en français"). Les autres langues sont des COUCHES PAR-DESSUS,
// partielles par nature : une clé absente d'une langue retombe sur le
// français plutôt que d'afficher un vide — ajouter une langue est donc
// incrémental, jamais bloquant.
//
// Ce que ce fichier NE traduit PAS, par choix documenté :
//   - le contenu des articles (RSS, Wikipédia) : ce n'est pas un texte
//     d'interface, et aucune traduction automatique n'est appelée (voir
//     CLAUDE.md, "aucun appel à un tiers non choisi") ;
//   - relTime() (src/lib.js) : les dates relatives restent en français quelle
//     que soit LANG, pour ne pas faire diverger une fonction pure déjà testée
//     et utilisée partout (cartes, liste de blocage). À reprendre séparément
//     si une vraie i18n des dates est voulue.
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.SwiperI18n = api;
})(typeof self !== "undefined" ? self : globalThis, function () {
  "use strict";

  const LANGS = ["fr", "en"];

  const STRINGS = {
    fr: {
      "meta.title": "SwiperNews — apprendre & actus en swipe",

      "orient.title": "SwiperNews est fait pour le portrait.",
      "orient.body": "Remets ton téléphone à la verticale pour swiper.",

      "app.h1": "SwiperNews — apprendre et suivre l'actualité en swipe",

      "top.reload.title": "Rafraîchir les articles",
      "top.reload.aria": "Rafraîchir",
      "top.settings.title": "Sources, centres d'intérêt et réglages",
      "top.settings.aria": "Réglages",
      "top.feed.aria": "Fil d'articles",
      "top.history.title": "Les articles que le fil garde en mémoire",
      "top.history.aria": "Articles en mémoire",

      "hist.title": "Articles en mémoire",
      "hist.sub": "{n} articles gardés sous la main. Touche-en un pour y revenir.",
      "hist.subEmpty": "Rien en mémoire pour l'instant.",
      "hist.empty": "Le fil n'a encore rien chargé.",
      "hist.here": "Ici",
      "hist.gone": "Cet article n'est plus dans le fil",
      "hist.hideSeen": "Cacher les articles déjà lus du fil",
      "hist.seenBadge": "Lu",

      "about.version": "Version {v}",

      "rail.share.aria": "Partager cet article",
      "rail.share.title": "Partager",

      "hint.swipe": "Swipe",

      "demobadge.text": "Wikipédia injoignable — articles de démo",

      "state.loading": "Chargement de ton fil…",
      "state.emptyDefault.title": "Aucun article",
      "state.retry": "↻ Réessayer",
      "state.openSettings": "Ouvrir les réglages",

      "feed.loadingMore": "Chargement de nouveaux articles…",

      "empty.noFeeds.title": "Aucune source active",
      "empty.noFeeds.msg":
        "Coche ou ajoute un flux RSS, importe tes sources (OPML / JSON), ou remets des articles Wikipédia dans le fil avec le bouton 🎓.",
      "empty.unavailable.title": "Fil indisponible",
      "empty.unavailable.msg":
        "Ni tes flux ni Wikipédia n'ont répondu (hors-ligne, ou proxy indisponible). Réessaie, ou vérifie tes sources.",

      "sheet.aria": "Réglages de ton fil",
      "sheet.intro":
        "✨ Le swipe qui rend plus malin. Un seul fil : tes actus, et entre elles des articles Wikipédia qui t'apprennent un truc que tu ne connaissais pas. Choisis ce qui allume ta curiosité 👇",
      "sheet.title": "Ton fil",
      "sheet.subtitle":
        "Tes actus et des articles Wikipédia, en alternance dans un seul fil.",

      "sheet.mix.title": "🎚️ Dose d'apprentissage",
      "dose.title": "Dose d'apprentissage",
      "dose.sub": "Combien d'articles Wikipédia se glissent entre tes actus.",
      "dose.titlePrefix": "Dose d'apprentissage : ",

      "mix.end.news": "Actus",
      "mix.end.learn": "Apprendre",
      "mix.level.0.label": "Actus seules",
      "mix.level.0.desc": "Que tes flux, sans rien d'autre.",
      "mix.level.1.label": "Une pincée",
      "mix.level.1.desc": "Un article toutes les six actus.",
      "mix.level.2.label": "Équilibré",
      "mix.level.2.desc": "Un article toutes les trois actus.",
      "mix.level.3.label": "Moitié-moitié",
      "mix.level.3.desc": "Une actu, un article, une actu…",
      "mix.level.4.label": "Surtout apprendre",
      "mix.level.4.desc": "Trois articles pour une actu.",
      "mix.level.5.label": "Wikipédia seul",
      "mix.level.5.desc": "Que des articles, sans tes flux.",

      "sheet.interests.title": "🎓 Centres d'intérêt",
      "sheet.interests.sub": "Les thèmes des articles Wikipédia glissés entre tes actus.",

      "sheet.sources.title": "📰 Sources d'actualité",
      "sheet.sources.sub": "Coche les flux à afficher, ajoute ceux que tu veux.",
      "sheet.sources.filterSponsored": "Filtrer les articles sponsorisés et bons plans",
      "sheet.sources.filterVideoOnly": "Afficher uniquement les vidéos",
      "sheet.sources.placeholder": "https://exemple.com/rss",
      "sheet.sources.add": "Ajouter",
      "sheet.sources.exportOpml": "↓ Exporter (OPML)",
      "sheet.sources.exportJson": "↓ Exporter (JSON)",
      "sheet.sources.importFile": "↑ Importer un fichier",
      "sheet.sources.suggestTitle": "Sources suggérées — un tap pour ajouter",
      "sheet.sources.deleteAria": "Supprimer {name}",
      "sheet.sources.unreachable": "injoignable",

      "sheet.apply": "Voir mon fil",

      "lang.title": "🌐 Langue",
      "lang.label": "Langue de l'app",
      "lang.desc": "La langue de l'interface. Wikipédia suit la même langue.",
      "lang.opt.fr": "Français",
      "lang.opt.en": "English",

      "filter.src.label": "Sources des actus",
      "filter.src.sub":
        "Coche les sources à garder dans le fil — plusieurs, si tu veux. Aucune cochée : elles y sont toutes. Pour en ajouter ou en retirer, c'est dans les réglages.",
      "filter.src.all": "Toutes",
      "filter.src.count": "{n} sources",
      "filter.cat.label": "Thème des articles",
      "filter.cat.sub": "Les articles Wikipédia seront tirés dans ce thème.",
      "filter.cat.allChip": "🎓 Tous",
      "filter.cat.allShort": "Tous",

      "read.label": "Ouvrir les articles",
      "read.desc.app":
        "Lecteur intégré : la page du site, en plein écran et sans barre d'URL.",
      "read.desc.read":
        "Mode lecture : rien que le titre, le texte et les images, comme une liseuse. Un bouton dans le lecteur permet de revenir à la page complète.",
      "read.desc.browser":
        "Dans ton navigateur habituel (Chrome, Firefox…), comme un lien normal.",
      "read.opt.app": "Dans l'app",
      "read.opt.read": "Lecture",
      "read.opt.browser": "Navigateur",

      "rsize.label": "Taille du texte",
      "rsize.desc.s": "Compact : plus de mots par ligne, moins de défilement.",
      "rsize.desc.m":
        "L'équilibre par défaut, pensé pour un téléphone tenu à bout de bras.",
      "rsize.desc.l": "Confortable : lignes plus courtes, lecture plus posée.",
      "rsize.desc.xl": "Très grand, pour lire sans lunettes ou de loin.",
      "rsize.aria.s": "Compact",
      "rsize.aria.m": "Normal",
      "rsize.aria.l": "Grand",
      "rsize.aria.xl": "Très grand",

      "rtheme.label": "Fond du lecteur",
      "rtheme.desc.dark": "Sombre, comme le fil. Reposant le soir et sur écran OLED.",
      "rtheme.desc.sepia":
        "Sépia, comme du papier : moins de bleu, moins d'éblouissement en journée.",
      "rtheme.desc.light": "Clair, pour lire en plein soleil.",
      "rtheme.opt.dark": "Sombre",
      "rtheme.opt.sepia": "Sépia",
      "rtheme.opt.light": "Clair",

      "cmp.label": "Bandeaux cookies",
      "cmp.desc.hide":
        "Masqués à l'ouverture. Masqués, jamais acceptés : aucun consentement n'est donné en ton nom.",
      "cmp.desc.show": "Affichés tels quels, comme dans un navigateur.",
      "cmp.opt.hide": "Masqués",
      "cmp.opt.show": "Affichés",

      "ads.label": "Publicités et traceurs",
      "ads.desc.block":
        "Bloqués avant même d'être chargés : page plus légère, pistage en moins. Certains sites le détectent et refusent de s'afficher.",
      "ads.desc.allow": "Chargés normalement, comme dans un navigateur.",
      "ads.opt.block": "Bloqués",
      "ads.opt.allow": "Affichés",

      "bl.builtin":
        "Liste intégrée à l'app : 178 domaines. Une liste publique en bloque bien davantage, et se met à jour sans réinstaller l'app.",
      "bl.active": "{name} — {n} domaines{whenPart}, plus les 178 intégrés.",
      "bl.whenPart": ", mis à jour il y a {when}",
      "bl.credit": "Source : {credit}",
      "bl.update": "↻ Mettre à jour",
      "bl.remove": "Retirer",
      "bl.source.easylist.sub":
        "La référence d'uBlock Origin — ~52 000 domaines publicitaires",
      "bl.source.stevenblack.sub":
        "Fichier hosts unifié — ~106 000 entrées, pub et traceurs",

      "share.title": "Partager",
      "share.copy": "Copier",

      "toast.bl.downloading": "Téléchargement de la liste…",
      "toast.bl.unavailablePrefix": "Liste indisponible — ",
      "toast.bl.retryLater": "réessaie plus tard",
      "toast.bl.reverted": "Retour à la liste intégrée",
      "toast.network.stale": "Réseau indisponible — le fil n'a pas été actualisé",
      "toast.feeds.unreachableOne": "Injoignable : {list}",
      "toast.feeds.unreachableMany": "Injoignables : {list}",
      "toast.copied": "Copié",
      "toast.copyFailed": "Copie impossible",
      "toast.refreshing": "Actualisation…",
      "toast.invalidUrl": "URL invalide",
      "toast.youtubeResolving": "Recherche du flux YouTube…",
      "toast.youtubeChannelNotFound":
        "Impossible de déterminer le flux RSS de cette chaîne.",
      "toast.noFeedsExport": "Aucune source à exporter",
      "toast.exportFailed": "Export impossible",
      "toast.feedsExported": "Sources exportées",
      "toast.noFeedsInFile": "Aucune source trouvée dans le fichier",
      "toast.unreadableFile": "Fichier illisible",
      "toast.feedsImportedOne": "{n} source importée",
      "toast.feedsImportedMany": "{n} sources importées",
      "toast.feedsAlreadyPresent": "Sources déjà présentes",
      "toast.feedAdded": "{name} ajouté",
      "toast.updateReady": "Nouvelle version prête",

      "installbar.title": "Installe SwiperNews",
      "installbar.sub": "Plein écran, hors-ligne, lancement en un tap.",
      "installbar.install": "Installer",
      "installbar.iosSub": "Appuie sur Partager, puis « Sur l'écran d'accueil ».",
      "installbar.gotIt": "Compris",
      "installbar.close.aria": "Fermer",

      "card.discover": "Découvrir",
      "card.readArticle": "Lire l'article",
      // Cartes vidéo : « Lire la vidéo » sert au ▶ (aria-label) ET au titre de
      // l'iframe ; « Ouvrir sur YouTube » remplace « Lire l'article » sur la
      // pastille, qui reste le chemin vers les commentaires et la chaîne.
      "card.playVideo": "Lire la vidéo",
      "card.openYoutube": "Ouvrir sur YouTube",
      "card.demo": "Article de démo",
      "card.paywall.title": "Accès payant probable",
    },
    en: {
      "meta.title": "SwiperNews — learn & news in a swipe",

      "orient.title": "SwiperNews is designed for portrait mode.",
      "orient.body": "Turn your phone back to vertical to swipe.",

      "app.h1": "SwiperNews — learn and follow the news in a swipe",

      "top.reload.title": "Refresh articles",
      "top.reload.aria": "Refresh",
      "top.settings.title": "Sources, interests and settings",
      "top.settings.aria": "Settings",
      "top.feed.aria": "Article feed",
      "top.history.title": "The articles the feed keeps in memory",
      "top.history.aria": "Articles in memory",

      "hist.title": "Articles in memory",
      "hist.sub": "{n} articles kept at hand. Tap one to go back to it.",
      "hist.subEmpty": "Nothing in memory yet.",
      "hist.empty": "The feed hasn't loaded anything yet.",
      "hist.here": "Here",
      "hist.gone": "This article is no longer in the feed",
      "hist.hideSeen": "Hide already-read articles from the feed",
      "hist.seenBadge": "Read",

      "about.version": "Version {v}",

      "rail.share.aria": "Share this article",
      "rail.share.title": "Share",

      "hint.swipe": "Swipe",

      "demobadge.text": "Wikipedia unreachable — demo articles",

      "state.loading": "Loading your feed…",
      "state.emptyDefault.title": "No articles",
      "state.retry": "↻ Retry",
      "state.openSettings": "Open settings",

      "feed.loadingMore": "Loading new articles…",

      "empty.noFeeds.title": "No active source",
      "empty.noFeeds.msg":
        "Check or add an RSS feed, import your sources (OPML / JSON), or bring Wikipedia articles back into the feed with the 🎓 button.",
      "empty.unavailable.title": "Feed unavailable",
      "empty.unavailable.msg":
        "Neither your feeds nor Wikipedia responded (offline, or the proxy is unavailable). Try again, or check your sources.",

      "sheet.aria": "Your feed's settings",
      "sheet.intro":
        "✨ The swipe that makes you smarter. One single feed: your news, with Wikipedia articles slipped in between that teach you something you didn't know. Pick what sparks your curiosity 👇",
      "sheet.title": "Your feed",
      "sheet.subtitle": "Your news and Wikipedia articles, alternating in a single feed.",

      "sheet.mix.title": "🎚️ Learning dose",
      "dose.title": "Learning dose",
      "dose.sub": "How many Wikipedia articles slip in between your news.",
      "dose.titlePrefix": "Learning dose: ",

      "mix.end.news": "News",
      "mix.end.learn": "Learn",
      "mix.level.0.label": "News only",
      "mix.level.0.desc": "Just your feeds, nothing else.",
      "mix.level.1.label": "A pinch",
      "mix.level.1.desc": "One article every six news items.",
      "mix.level.2.label": "Balanced",
      "mix.level.2.desc": "One article every three news items.",
      "mix.level.3.label": "Half and half",
      "mix.level.3.desc": "One news, one article, one news…",
      "mix.level.4.label": "Mostly learning",
      "mix.level.4.desc": "Three articles for one news item.",
      "mix.level.5.label": "Wikipedia only",
      "mix.level.5.desc": "Just articles, without your feeds.",

      "sheet.interests.title": "🎓 Interests",
      "sheet.interests.sub":
        "The topics of the Wikipedia articles slipped between your news.",

      "sheet.sources.title": "📰 News sources",
      "sheet.sources.sub": "Check the feeds to show, add whichever you like.",
      "sheet.sources.filterSponsored": "Filter out sponsored articles and deals",
      "sheet.sources.filterVideoOnly": "Show videos only",
      "sheet.sources.placeholder": "https://example.com/rss",
      "sheet.sources.add": "Add",
      "sheet.sources.exportOpml": "↓ Export (OPML)",
      "sheet.sources.exportJson": "↓ Export (JSON)",
      "sheet.sources.importFile": "↑ Import a file",
      "sheet.sources.suggestTitle": "Suggested sources — tap to add",
      "sheet.sources.deleteAria": "Delete {name}",
      "sheet.sources.unreachable": "unreachable",

      "sheet.apply": "See my feed",

      "lang.title": "🌐 Language",
      "lang.label": "App language",
      "lang.desc": "The interface language. Wikipedia follows the same language.",
      "lang.opt.fr": "Français",
      "lang.opt.en": "English",

      "filter.src.label": "News sources",
      "filter.src.sub":
        "Tick the sources to keep in the feed — as many as you like. None ticked: they are all in. To add or remove one, that's in settings.",
      "filter.src.all": "All",
      "filter.src.count": "{n} sources",
      "filter.cat.label": "Article topic",
      "filter.cat.sub": "Wikipedia articles will be drawn from this topic.",
      "filter.cat.allChip": "🎓 All",
      "filter.cat.allShort": "All",

      "read.label": "Open articles",
      "read.desc.app":
        "Built-in reader: the site's page, full screen and without an address bar.",
      "read.desc.read":
        "Reading mode: just the title, text and images, like an e-reader. A button in the reader lets you go back to the full page.",
      "read.desc.browser":
        "In your usual browser (Chrome, Firefox…), like a normal link.",
      "read.opt.app": "In the app",
      "read.opt.read": "Reading",
      "read.opt.browser": "Browser",

      "rsize.label": "Text size",
      "rsize.desc.s": "Compact: more words per line, less scrolling.",
      "rsize.desc.m": "The default balance, designed for a phone held at arm's length.",
      "rsize.desc.l": "Comfortable: shorter lines, calmer reading.",
      "rsize.desc.xl": "Extra large, to read without glasses or from a distance.",
      "rsize.aria.s": "Compact",
      "rsize.aria.m": "Normal",
      "rsize.aria.l": "Large",
      "rsize.aria.xl": "Extra large",

      "rtheme.label": "Reader background",
      "rtheme.desc.dark":
        "Dark, like the feed. Easy on the eyes at night and on OLED screens.",
      "rtheme.desc.sepia": "Sepia, like paper: less blue, less glare during the day.",
      "rtheme.desc.light": "Light, to read in bright sunlight.",
      "rtheme.opt.dark": "Dark",
      "rtheme.opt.sepia": "Sepia",
      "rtheme.opt.light": "Light",

      "cmp.label": "Cookie banners",
      "cmp.desc.hide":
        "Hidden on open. Hidden, never accepted: no consent is ever given on your behalf.",
      "cmp.desc.show": "Shown as-is, like in a browser.",
      "cmp.opt.hide": "Hidden",
      "cmp.opt.show": "Shown",

      "ads.label": "Ads and trackers",
      "ads.desc.block":
        "Blocked before they even load: lighter pages, less tracking. Some sites detect this and refuse to display.",
      "ads.desc.allow": "Loaded normally, like in a browser.",
      "ads.opt.block": "Blocked",
      "ads.opt.allow": "Shown",

      "bl.builtin":
        "Built into the app: 178 domains. A public list blocks far more, and updates without reinstalling the app.",
      "bl.active": "{name} — {n} domains{whenPart}, plus the 178 built in.",
      "bl.whenPart": ", updated {when}",
      "bl.credit": "Source: {credit}",
      "bl.update": "↻ Update",
      "bl.remove": "Remove",
      "bl.source.easylist.sub": "uBlock Origin's reference list — ~52,000 ad domains",
      "bl.source.stevenblack.sub":
        "Unified hosts file — ~106,000 entries, ads and trackers",

      "share.title": "Share",
      "share.copy": "Copy",

      "toast.bl.downloading": "Downloading the list…",
      "toast.bl.unavailablePrefix": "List unavailable — ",
      "toast.bl.retryLater": "try again later",
      "toast.bl.reverted": "Back to the built-in list",
      "toast.network.stale": "Network unavailable — the feed wasn't refreshed",
      "toast.feeds.unreachableOne": "Unreachable: {list}",
      "toast.feeds.unreachableMany": "Unreachable: {list}",
      "toast.copied": "Copied",
      "toast.copyFailed": "Copy failed",
      "toast.refreshing": "Refreshing…",
      "toast.invalidUrl": "Invalid URL",
      "toast.youtubeResolving": "Looking up the YouTube feed…",
      "toast.youtubeChannelNotFound": "Could not determine this channel's RSS feed.",
      "toast.noFeedsExport": "No source to export",
      "toast.exportFailed": "Export failed",
      "toast.feedsExported": "Sources exported",
      "toast.noFeedsInFile": "No source found in the file",
      "toast.unreadableFile": "Unreadable file",
      "toast.feedsImportedOne": "{n} feed imported",
      "toast.feedsImportedMany": "{n} feeds imported",
      "toast.feedsAlreadyPresent": "Sources already present",
      "toast.feedAdded": "{name} added",
      "toast.updateReady": "New version ready",

      "installbar.title": "Install SwiperNews",
      "installbar.sub": "Full screen, offline, launches in one tap.",
      "installbar.install": "Install",
      "installbar.iosSub": "Tap Share, then “Add to Home Screen”.",
      "installbar.gotIt": "Got it",
      "installbar.close.aria": "Close",

      "card.discover": "Discover",
      "card.readArticle": "Read article",
      "card.playVideo": "Play video",
      "card.openYoutube": "Open on YouTube",
      "card.demo": "Demo article",
      "card.paywall.title": "Likely paywalled",

      // Libellés des centres d'intérêt (clés définies dans src/learn-core.js) :
      // absents du français, qui lit directement CATEGORIES.label (voir
      // catLabelT dans index.html) — pas de duplication de la source de vérité.
      "cat.random": "🎲 Random",
      "cat.sciences": "🔬 Science",
      "cat.histoire": "📜 History",
      "cat.art": "🎨 Arts & Culture",
      "cat.artistes": "🎭 Artists",
      "cat.geo": "🌍 Geography",
      "cat.nature": "🐾 Species",
      "cat.espace": "🌌 Space",
      "cat.tech": "💻 Technology",
      "cat.sport": "⚽ Sports",
      "cat.films": "🎬 Films",
      "cat.series": "📺 TV series",
      "cat.musique": "🎵 Songs",
      "cat.jeuxvideo": "🎮 Video games",
      "cat.cuisine": "🍲 Dishes",
      "cat.philo": "🧠 Philosophy",
    },
  };

  /**
   * @param {string} lang  Langue demandée (repli sur "fr" si inconnue)
   * @param {string} key   Clé plate ("section.sous.clé")
   * @param {Object} [vars]  Substitutions "{nom}" → valeur
   * @returns {string}  Toujours une chaîne : repli sur le français, puis sur
   *   la clé elle-même (jamais un vide qui passerait inaperçu).
   */
  function t(lang, key, vars) {
    const dict = STRINGS[lang] || STRINGS.fr;
    let s = dict[key];
    if (s === undefined) s = STRINGS.fr[key];
    if (s === undefined) return key;
    if (vars) for (const k in vars) s = s.split("{" + k + "}").join(vars[k]);
    return s;
  }

  return { LANGS, STRINGS, t };
});
