// Fonctions pures partagées entre le navigateur et les tests Node.
//
// Chargé en <script src> classique dans index.html (pas de module ESM : l'app
// doit rester ouvrable en file://) et en require() dans les tests. Aucune de ces
// fonctions ne touche au réseau ni à l'état global : elles sont testables telles
// quelles avec `node --test`.
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.SwiperLib = api;
})(typeof self !== "undefined" ? self : globalThis, function () {
  "use strict";

  const collapse = (s) => (s || "").replace(/\s+/g, " ").trim();

  // Entités les plus courantes dans les flux RSS (repli Node uniquement : le
  // navigateur passe par DOMParser qui les décode toutes).
  const ENTITIES = {
    amp: "&",
    lt: "<",
    gt: ">",
    quot: '"',
    apos: "'",
    nbsp: " ",
    laquo: "«",
    raquo: "»",
    hellip: "…",
    eacute: "é",
    egrave: "è",
    agrave: "à",
    ccedil: "ç",
  };
  function decodeEntities(s) {
    return String(s).replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, code) => {
      if (code[0] === "#") {
        const n =
          code[1] === "x" || code[1] === "X"
            ? parseInt(code.slice(2), 16)
            : parseInt(code.slice(1), 10);
        return Number.isFinite(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : m;
      }
      const k = code.toLowerCase();
      return Object.prototype.hasOwnProperty.call(ENTITIES, k) ? ENTITIES[k] : m;
    });
  }

  /**
   * Convertit du HTML de flux en texte brut, SANS jamais l'activer.
   *
   * Point de sécurité : on n'utilise PAS `div.innerHTML`. Un div détaché n'est
   * pas un document inerte — Chrome et Firefox y déclenchent le chargement des
   * ressources et les handlers onerror/onload, ce qui rend un
   * `<img src=x onerror=...>` venu d'un flux RSS exécutable sur notre origine.
   * `DOMParser` en "text/html" produit un document sans navigateur associé :
   * aucune requête, aucun script, aucun handler.
   */
  function stripHtml(html) {
    if (!html) return "";
    if (typeof DOMParser !== "undefined") {
      try {
        const doc = new DOMParser().parseFromString(String(html), "text/html");
        return collapse(doc.body ? doc.body.textContent : "");
      } catch (_) {
        /* repli ci-dessous */
      }
    }
    // Repli (Node / DOMParser indisponible) : retrait des balises puis décodage.
    // On retire d'abord le contenu des éléments qui ne sont pas du texte affiché.
    const withoutScripts = String(html).replace(
      /<(script|style)\b[\s\S]*?<\/\1\s*>/gi,
      " "
    );
    return collapse(decodeEntities(withoutScripts.replace(/<[^>]*>/g, " ")));
  }

  /**
   * Tronque un texte de flux à une longueur raisonnable, sur une frontière de
   * mot quand c'est possible.
   *
   * Un flux RSS est écrit par un tiers : rien n'oblige `<description>` à être un
   * résumé. Beaucoup de sites (WordPress nu, `content:encoded`) y publient
   * l'ARTICLE ENTIER, soit des dizaines de kilooctets par item. Non borné, ce
   * texte se retrouve trois fois : dans le DOM de la carte (où le CSS n'en
   * montre que dix lignes, le reste ne coûtant que de la mémoire), dans le
   * cache disque (mesuré : 400 Ko pour CINQ articles, contre un quota
   * localStorage de ~5 Mo — au-delà, `cacheSave` échoue en silence et l'app
   * repart du réseau à chaque lancement), et dans l'instantané de fil.
   *
   * La borne est très au-delà de ce qui est lisible sur une carte
   * (`-webkit-line-clamp:10` sur ~46ch, soit ~500 caractères) : elle ne coupe
   * donc jamais un résumé normal, seulement les articles complets.
   */
  function clampText(s, max) {
    const t = s == null ? "" : String(s);
    const n = max || 1000;
    if (t.length <= n) return t;
    const cut = t.slice(0, n);
    const space = cut.lastIndexOf(" ");
    return (space > n * 0.6 ? cut.slice(0, space) : cut).trimEnd() + "…";
  }

  /** Première image d'un fragment HTML (attribut src d'un <img>), ou "". */
  function imgFromHtml(html) {
    const g = html && String(html).match(/<img[^>]+src=["']([^"']+)["']/i);
    return g ? g[1] : "";
  }

  /** N'autorise que http(s) pour un href. Renvoie "" sinon (bloque javascript:, data:...). */
  function safeLink(link, base) {
    if (!link || link === "#") return "";
    try {
      const u = new URL(link, base || undefined);
      return u.protocol === "http:" || u.protocol === "https:" ? u.href : "";
    } catch (_) {
      return "";
    }
  }

  /** N'autorise que http(s) ou data:image pour une image. Renvoie l'URL normalisée ou "". */
  function safeImg(src, base) {
    if (!src) return "";
    try {
      const u = new URL(src, base || undefined);
      if (u.protocol === "http:" || u.protocol === "https:") return u.href;
      if (u.protocol === "data:" && /^data:image\//i.test(String(src)))
        return String(src);
      return "";
    } catch (_) {
      return "";
    }
  }

  /**
   * Échappe une URL pour l'insérer dans une chaîne CSS entre guillemets,
   * destinée à `element.style.backgroundImage = 'url("' + cssString(u) + '")'`.
   *
   * NE PAS pour-encoder ici. Dans un chemin d'URL, `(`, `)` et `'` sont des
   * sub-delims : `%28` n'est PAS équivalent à `(` (RFC 3986 §6.2.2.2), et
   * beaucoup de serveurs d'images répondent 404 sur la forme encodée. Les
   * pour-encoder cassait donc silencieusement toutes les images dont le nom de
   * fichier contient une parenthèse ou une apostrophe.
   *
   * Le seul échappement nécessaire est celui des délimiteurs de la chaîne CSS.
   * C'est suffisant parce que la valeur est posée via CSSOM : il n'y a aucune
   * étape de décodage HTML (contrairement à un attribut `style`, décodé en HTML
   * avant d'être parsé en CSS — c'est pour cela qu'`escAttr` n'y protège pas),
   * et une affectation à `style.backgroundImage` ne peut de toute façon pas
   * introduire une seconde déclaration.
   */
  function cssString(src) {
    return String(src || "")
      .replace(/[\\"]/g, "\\$&")
      .replace(/[\n\r\f]/g, " ");
  }

  const IMG_TARGET_W = 1200;

  /**
   * Vignettes YouTube : le NOM DU FICHIER est la taille.
   *
   * `https://i.ytimg.com/vi/<id>/hqdefault.jpg` ne contient aucun des motifs que
   * lisent les deux fonctions ci-dessous (`/640x360/`, `?width=`, `_640x360.jpg`)
   * — elles rendaient donc 0 et "". Conséquence mesurable : `hqdefault` fait
   * 480 px, sous MIN_GOOD_W, donc `applyBg` partait sonder /api/og sur la page
   * `watch?v=…` pour CHAQUE carte vidéo défilée. C'est exactement le défaut
   * corrigé côté Wikipédia (une invocation serverless par carte), et il se règle
   * ici sans un seul appel : le fichier `maxresdefault.jpg` existe presque
   * toujours, et il suffit de savoir le demander.
   *
   * Renseigner `imageSizeFromUrl` n'est PAS accessoire, c'est le garde-fou :
   * YouTube répond 200 avec une image grise de 120 px quand `maxresdefault`
   * n'existe pas, et c'est la largeur déclarée (480) qui la fait rejeter par
   * `applyBg` (`w > Math.max(hintW, 50)`). Sans elle, `hintW` vaudrait 0 et
   * l'image grise passerait pour un agrandissement réussi.
   */
  const YT_THUMB_W = {
    default: 120,
    mqdefault: 320,
    hqdefault: 480,
    sddefault: 640,
    hq720: 1280,
    maxresdefault: 1280,
  };
  // Hôtes réellement servis par YouTube : i.ytimg.com, i1..i9.ytimg.com, et
  // l'alias historique img.youtube.com. `vi_webp` est la variante WebP.
  const YT_THUMB_RE =
    /^(https?:\/\/(?:[a-z0-9-]+\.)?(?:ytimg\.com|youtube\.com)\/vi(?:_webp)?\/[A-Za-z0-9_-]{11}\/)([a-z0-9]+)(\.(?:jpe?g|webp))(\?.*)?$/i;

  /**
   * Propose une variante PLUS GRANDE d'une URL d'image, quand la taille est
   * inscrite dedans — cas très répandu chez les CDN de presse
   * (`/640x360/`, `?width=640`, `_640x360.jpg`).
   *
   * Utile quand un flux ne publie qu'une petite image : l'agrandissement se
   * demande alors au CDN plutôt que d'étirer 200 px en plein écran. Renvoie ""
   * si aucun motif reconnu ou si l'image est déjà assez grande — l'appelant ne
   * tente alors rien. La variante n'est utilisée que si elle se charge
   * réellement (voir applyBg), donc une URL inventée ne casse jamais l'affichage.
   */
  function upscaleImageUrl(src, targetW) {
    const url = String(src || "");
    const T = targetW || IMG_TARGET_W;
    if (!url) return "";

    // Vignette YouTube : on demande le plus grand format, pas un calcul de ratio.
    const yt = url.match(YT_THUMB_RE);
    if (yt) {
      const w = YT_THUMB_W[yt[2].toLowerCase()] || 0;
      if (!w || w >= Math.min(T, YT_THUMB_W.maxresdefault)) return "";
      return yt[1] + "maxresdefault" + yt[3] + (yt[4] || "");
    }
    // Garde : une largeur ou une hauteur nulle produirait une division par zéro
    // et une URL contenant "NaN", qui renverrait 404.
    const ok2 = (w, h) => Number(w) > 0 && Number(h) > 0;
    const ratio = (w, h) => Math.round((Number(h) * T) / Number(w));

    // /640x360/ dans le chemin
    let out = url.replace(/\/(\d{2,4})x(\d{2,4})\//g, (m, w, h) =>
      !ok2(w, h) || Number(w) >= T ? m : `/${T}x${ratio(w, h)}/`
    );
    if (out !== url) return out;

    // _640x360.jpg en fin de nom
    out = url.replace(
      /_(\d{2,4})x(\d{2,4})(\.(?:jpe?g|png|webp|avif))/i,
      (m, w, h, ext) => (!ok2(w, h) || Number(w) >= T ? m : `_${T}x${ratio(w, h)}${ext}`)
    );
    if (out !== url) return out;

    // ?width=640, &w=640, ?size=640
    out = url.replace(/([?&](?:width|w|size|maxwidth))=(\d{2,4})\b/gi, (m, k, v) =>
      Number(v) >= T ? m : `${k}=${T}`
    );
    if (out !== url) return out;

    // /w640/ ou /w/640/
    out = url.replace(/\/w\/?(\d{2,4})\//g, (m, w) =>
      Number(w) >= T ? m : m.replace(w, String(T))
    );
    // Filet : jamais d'URL contenant NaN/Infinity.
    if (out !== url && !/NaN|Infinity/.test(out)) return out;
    return "";
  }

  /**
   * Largeur demandée, lue directement dans l'URL quand elle y figure — évite de
   * télécharger une image pour découvrir qu'elle est trop petite.
   *
   * Gère notamment les URL Thumbor, où le recadrage précède la taille de sortie :
   *   /<signature>/0x0:1024x576/432x243/filters:.../photo.jpg  ->  432
   * On retient donc le DERNIER segment de la forme /LxH/.
   */
  function imageSizeFromUrl(src) {
    const url = String(src || "");
    if (!url) return 0;
    // Vignette YouTube : la taille est le nom du fichier (voir YT_THUMB_W).
    const yt = url.match(YT_THUMB_RE);
    if (yt) return YT_THUMB_W[yt[2].toLowerCase()] || 0;
    let w = 0;
    const seg = /\/(\d{2,4})x(\d{2,4})\//g;
    let m;
    while ((m = seg.exec(url))) w = Number(m[1]); // le dernier gagne
    if (w) return w;
    const suffix = url.match(/_(\d{2,4})x(\d{2,4})\.(?:jpe?g|png|webp|avif)/i);
    if (suffix) return Number(suffix[1]);
    const query = url.match(/[?&](?:width|w|maxwidth)=(\d{2,4})\b/i);
    return query ? Number(query[1]) : 0;
  }

  /** Échappement pour du contenu texte inséré en HTML. */
  function esc(s) {
    return (s == null ? "" : String(s)).replace(
      /[&<>]/g,
      (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]
    );
  }
  /** Échappement pour une valeur d'attribut HTML entre guillemets. */
  function escAttr(s) {
    return (s == null ? "" : String(s)).replace(
      /["'&<>]/g,
      (c) => ({ '"': "&quot;", "'": "&#39;", "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]
    );
  }

  /** "il y a X" compact à partir d'une date de flux. "" si non parsable. */
  function relTime(dateStr, now) {
    const t = Date.parse(dateStr);
    if (isNaN(t)) return "";
    const d = ((now == null ? Date.now() : now) - t) / 1000;
    if (d < 3600) return Math.max(1, Math.round(d / 60)) + " min";
    if (d < 86400) return Math.round(d / 3600) + " h";
    return Math.round(d / 86400) + " j";
  }

  /** Clé de jour civil LOCAL, "YYYY-MM-DD" — pas UTC : "aujourd'hui" doit
   *  correspondre au jour vécu par l'utilisateur. Sert de brique aux
   *  statistiques de cartes défilées (voir statsBuckets) et à la clé de
   *  bornage par jour du stockage correspondant. */
  function dayKey(d) {
    const p = (n) => String(n).padStart(2, "0");
    return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());
  }
  /** Index du quart d'heure dans la journée, 0..95, heure LOCALE — la
   *  granularité la plus fine conservée (voir bumpCardScroll), pour le détail
   *  « heure en cours » de statsBuckets. */
  function quarterIndex(d) {
    return d.getHours() * 4 + Math.floor(d.getMinutes() / 15);
  }
  /** Lundi (civil, heure locale) de la semaine contenant `d`. */
  function mondayOf(d) {
    const wd = (d.getDay() + 6) % 7; // 0=lundi..6=dimanche
    return new Date(d.getFullYear(), d.getMonth(), d.getDate() - wd);
  }
  /** Somme les entrées de `days` ({"YYYY-MM-DD": n}) dont la clé tombe entre
   *  `fromKey` et `toKey` inclus — comparaison de chaînes, valide puisque le
   *  format zéro-rempli trie lexicalement comme chronologiquement. */
  function sumDaysRange(days, fromKey, toKey) {
    const src = days && typeof days === "object" ? days : {};
    let n = 0;
    for (const k in src) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(k)) continue;
      if (k >= fromKey && k <= toKey) n += src[k] || 0;
    }
    return n;
  }
  /** Regroupe les quarts d'heure d'AUJOURD'HUI (`todaySlots`, voir
   *  bumpCardScroll — { day:"YYYY-MM-DD", slots:{quarterIndex: n} }, réservé
   *  au jour courant, jamais conservé au-delà) en 24 totaux horaires. Un
   *  `todaySlots` d'un autre jour (pas encore basculé par bumpCardScroll,
   *  cas d'une réouverture après minuit sans nouvelle carte défilée) rend 24
   *  zéros plutôt que les quarts de la veille. */
  function hourlyFromSlots(todaySlots, today) {
    const out = new Array(24).fill(0);
    if (!todaySlots || todaySlots.day !== today || !todaySlots.slots) return out;
    const src = todaySlots.slots;
    for (const q in src) {
      const qi = parseInt(q, 10);
      if (!Number.isInteger(qi) || qi < 0 || qi > 95) continue;
      out[Math.floor(qi / 4)] += src[q] || 0;
    }
    return out;
  }
  /**
   * Détail d'UNE fenêtre pour l'affichage (feuille « Mon activité ») : ses
   * buckets internes, son total, et le total de la période civile qui la
   * PRÉCÈDE immédiatement (pour « +2 par rapport à hier »-style). Jamais de
   * fenêtre glissante — mêmes bornes civiles que l'ancien cardScrollStats,
   * qu'elle remplace : semaine lundi→dimanche, mois et année civils.
   *   hour  (4 buckets)  : les quarts de l'HEURE en cours (todaySlots).
   *   day   (24 buckets) : chaque heure d'AUJOURD'HUI (todaySlots agrégés).
   *   week  (7 buckets)  : lundi→dimanche de la semaine en cours (days).
   *   month (≤6 buckets) : une semaine civile par bucket, tronquée aux bornes
   *     du mois (days) — le nombre de buckets dépend du jour de la semaine
   *     sur lequel tombe le 1er du mois.
   *   year  (12 buckets) : un mois de l'année en cours (days).
   * Une clé/quart absent de `days`/`todaySlots` vaut 0 — comme pour l'ancien
   * cardScrollStats, l'absence de donnée EST un zéro, jamais un état
   * « inconnu » à part : `prevTotal` à 0 peut donc dire aussi bien « rien ce
   * jour-là » que « pas encore assez d'historique », les deux se valant pour
   * l'utilisateur (rien à comparer).
   * Les BUCKETS ne portent pas de libellé : à l'appelant de le poser via `i`
   * (0-based) — statsBuckets reste sans dépendance à la langue, comme le
   * reste de ce module.
   */
  function statsBuckets(period, days, todaySlots, now) {
    now = now instanceof Date ? now : new Date(now || Date.now());
    const today = dayKey(now);
    if (period === "hour") {
      const hourly = hourlyFromSlots(todaySlots, today);
      const h = now.getHours();
      const quarters =
        todaySlots && todaySlots.day === today && todaySlots.slots
          ? todaySlots.slots
          : {};
      const buckets = [0, 1, 2, 3].map((i) => ({ i, value: quarters[h * 4 + i] || 0 }));
      // Minuit : l'heure précédente est hier, jamais conservée dans todaySlots.
      const prevTotal = h > 0 ? hourly[h - 1] : 0;
      return { buckets, total: hourly[h], prevTotal };
    }
    if (period === "day") {
      const hourly = hourlyFromSlots(todaySlots, today);
      const buckets = hourly.map((value, i) => ({ i, value }));
      const yesterday = dayKey(
        new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1)
      );
      return {
        buckets,
        total: (days && days[today]) || 0,
        prevTotal: (days && days[yesterday]) || 0,
      };
    }
    if (period === "week") {
      const monday = mondayOf(now);
      const buckets = [];
      let total = 0;
      for (let i = 0; i < 7; i++) {
        const d = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + i);
        const v = (days && days[dayKey(d)]) || 0;
        buckets.push({ i, value: v });
        total += v;
      }
      const prevMonday = new Date(
        monday.getFullYear(),
        monday.getMonth(),
        monday.getDate() - 7
      );
      const prevSunday = new Date(
        monday.getFullYear(),
        monday.getMonth(),
        monday.getDate() - 1
      );
      const prevTotal = sumDaysRange(days, dayKey(prevMonday), dayKey(prevSunday));
      return { buckets, total, prevTotal };
    }
    if (period === "month") {
      const y = now.getFullYear(),
        m = now.getMonth();
      const monthStartKey = dayKey(new Date(y, m, 1));
      const monthEndKey = dayKey(new Date(y, m + 1, 0));
      const buckets = [];
      let cursor = mondayOf(new Date(y, m, 1)),
        i = 0;
      while (dayKey(cursor) <= monthEndKey) {
        const weekEnd = new Date(
          cursor.getFullYear(),
          cursor.getMonth(),
          cursor.getDate() + 6
        );
        const from = dayKey(cursor) < monthStartKey ? monthStartKey : dayKey(cursor);
        const to = dayKey(weekEnd) > monthEndKey ? monthEndKey : dayKey(weekEnd);
        buckets.push({ i, value: sumDaysRange(days, from, to) });
        cursor = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() + 7);
        i++;
      }
      const total = sumDaysRange(days, monthStartKey, monthEndKey);
      const prevMonthEnd = new Date(y, m, 0);
      const prevMonthStart = new Date(
        prevMonthEnd.getFullYear(),
        prevMonthEnd.getMonth(),
        1
      );
      const prevTotal = sumDaysRange(days, dayKey(prevMonthStart), dayKey(prevMonthEnd));
      return { buckets, total, prevTotal };
    }
    // year
    const y = now.getFullYear();
    const buckets = [];
    let total = 0;
    for (let m = 0; m < 12; m++) {
      const from = dayKey(new Date(y, m, 1)),
        to = dayKey(new Date(y, m + 1, 0));
      const v = sumDaysRange(days, from, to);
      buckets.push({ i: m, value: v });
      total += v;
    }
    const prevTotal = sumDaysRange(
      days,
      dayKey(new Date(y - 1, 0, 1)),
      dayKey(new Date(y - 1, 11, 31))
    );
    return { buckets, total, prevTotal };
  }

  /** Mélange en place (Fisher-Yates) et renvoie le tableau. */
  function shuffle(a) {
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  /** Clé d'identité d'un article (lien + titre) pour dédoublonnage et « déjà vu ». */
  function seenKey(it) {
    return (it.link || "") + "|" + (it.title || "");
  }

  /** Retire les articles déjà vus ; si tout est vu, renvoie la liste telle quelle. */
  function dropSeen(list, seen) {
    const fresh = list.filter((it) => !seen.has(seenKey(it)));
    return fresh.length ? fresh : list;
  }

  /** Vide des files à TOUR DE RÔLE dans `out` : un élément de chacune, puis on
   *  recommence, jusqu'à `count` ou épuisement. Une file vide est simplement
   *  sautée — les autres continuent d'alterner entre elles.
   *
   *  DEUX usages, même symptôme corrigé : les catégories d'un lot Wikipédia
   *  (voir dedupAndRank) et les SOURCES de la moitié actus (voir rebuild dans
   *  index.html). Dans les deux cas, l'alternative — un classement global, par
   *  score d'image là-bas, par date ici — laissait une poignée de files
   *  occuper tout le début et enterrait les autres.
   *
   *  Déterministe : le résultat ne dépend que de l'ordre des files et de leur
   *  contenu. C'est ce qui permet de le recalculer à chaque arrivée de données
   *  sans rebattre l'ordre déjà lu, à condition de lui passer les files dans un
   *  ordre stable — les deux appelants s'en chargent. */
  function roundRobin(queues, out, count) {
    const pos = queues.map(() => 0);
    let servi = true;
    while (servi && out.length < count) {
      servi = false;
      for (let q = 0; q < queues.length && out.length < count; q++) {
        if (pos[q] >= queues[q].length) continue;
        out.push(queues[q][pos[q]++]);
        servi = true;
      }
    }
    return out;
  }

  /** Tour de rôle PONDÉRÉ : comme roundRobin, mais chaque file porte un poids —
   *  à chaque tour, on sert celle dont la part déjà servie est la plus en
   *  retard sur son poids (score = (déjà servi + 1) / poids, on prend le plus
   *  petit). Poids tous égaux à 1 reproduit exactement roundRobin. Une file
   *  vide, absente ou de poids nul n'est jamais servie.
   *
   *  Sert à fusionner en UN seul passage des flux dont la cadence n'obéit pas
   *  à la même règle — par exemple, dans index.html, vidéo/article/Wikipédia :
   *  Wikipédia doit garder la fréquence du curseur de dose (poids fixe, choisi
   *  par l'utilisateur) pendant que vidéo et article se partagent le reste au
   *  prorata de ce qu'ils ont chacun à offrir (poids proportionnel à leur
   *  compte). Les fusionner en deux temps (d'abord vidéo/article, puis
   *  Wikipédia par-dessus le résultat) laissait la vidéo tomber n'importe où
   *  dans chaque bloc d'actus consécutives — parfois collée à l'insertion
   *  Wikipédia, parfois loin d'elle, au hasard de l'endroit où le bloc
   *  commençait à se couper. */
  function weightedRoundRobin(streams) {
    const st = streams.filter((s) => s.items && s.items.length && s.poids > 0);
    const pos = st.map(() => 0);
    const servi = st.map(() => 0);
    const out = [];
    for (;;) {
      let bi = -1;
      let bscore = Infinity;
      for (let i = 0; i < st.length; i++) {
        if (pos[i] >= st[i].items.length) continue;
        const score = (servi[i] + 1) / st[i].poids;
        if (score < bscore) {
          bscore = score;
          bi = i;
        }
      }
      if (bi < 0) break;
      out.push(st[bi].items[pos[bi]++]);
      servi[bi]++;
    }
    return out;
  }

  /** Dédoublonne plusieurs listes (une par catégorie), mélange, et les sert à
   *  TOUR DE RÔLE — une carte par catégorie, puis on recommence — en plaçant les
   *  articles illustrés d'abord À L'INTÉRIEUR de chaque catégorie.
   *
   *  L'alternance est garantie, elle n'est plus laissée au hasard. Le mélange
   *  global d'avant en produisait bien une en moyenne, mais par paquets — et le
   *  tri « avec image d'abord », lui, les rendait carrément systématiques : la
   *  proportion d'articles illustrés varie énormément d'une catégorie à l'autre
   *  (un plat est presque toujours photographié ; un jeu vidéo presque jamais
   *  sur fr.wikipedia, où la jaquette n'est pas libre). Les plats occupaient
   *  donc tout le début du lot et les jeux vidéo toute la fin. C'est ce
   *  symptôme-là qu'on corrige.
   *
   *  Contrepartie ASSUMÉE : l'image ne prime plus sur la catégorie. Une carte
   *  sans image peut désormais passer avant une carte illustrée d'une autre
   *  catégorie — sinon toute catégorie peu illustrée se retrouverait reléguée en
   *  bloc à la fin, ce qui est précisément le bug. Le tri par image garde tout
   *  son effet là où il compte : la troncature à `count` prend les articles
   *  illustrés de CHAQUE catégorie avant ses articles nus.
   *
   *  L'ordre des catégories est lui aussi tiré au sort, sinon la première liste
   *  ouvrirait tous les lots. */
  function dedupAndRank(lists, count) {
    const seen = new Set();
    const files = [];
    for (const list of lists) {
      const avecImg = [];
      const sansImg = [];
      for (const it of list) {
        const k = seenKey(it);
        if (it && it.title && !seen.has(k)) {
          seen.add(k);
          (it.img ? avecImg : sansImg).push(it);
        }
      }
      const file = shuffle(avecImg).concat(shuffle(sansImg));
      if (file.length) files.push(file);
    }
    return roundRobin(shuffle(files), [], count);
  }

  /** Entrelace deux listes à cadence fixe : `every` éléments de `a`, puis un de
   *  `b`, et ainsi de suite. Dès que l'une est épuisée, l'autre continue seule —
   *  le fil mêlé ne s'arrête donc que quand les deux sont vides.
   *
   *  Déterministe et sans état : les N premiers éléments du résultat ne
   *  dépendent que des préfixes des deux entrées. C'est ce qui permet de
   *  recalculer le mélange à CHAQUE arrivée de données (un flux qui répond, un
   *  lot Wikipédia de plus) sans rebattre les cartes déjà lues. */
  function interleave(a, b, every) {
    const step = Math.max(1, every | 0);
    const out = [];
    let i = 0;
    let j = 0;
    while (i < a.length || j < b.length) {
      for (let k = 0; k < step && i < a.length; k++) out.push(a[i++]);
      if (j < b.length) out.push(b[j++]);
      else if (i >= a.length) break;
    }
    return out;
  }

  /** Extrait le contenu d'une balise <meta>, quel que soit l'ordre des attributs.
   *  Utilisé côté serveur (api/og.js) pour lire og:image sur la page d'un article,
   *  et côté app packagée (index.html) pour la même extraction faite en direct
   *  (voir nativeOgImage) — une seule implémentation, testée une fois. */
  function metaContent(html, names) {
    for (const name of names) {
      const escaped = name.replace(/[:.]/g, "\\$&");
      const patterns = [
        new RegExp(
          `<meta[^>]+(?:property|name)\\s*=\\s*["']${escaped}["'][^>]*?content\\s*=\\s*["']([^"']+)["']`,
          "i"
        ),
        new RegExp(
          `<meta[^>]+content\\s*=\\s*["']([^"']+)["'][^>]*?(?:property|name)\\s*=\\s*["']${escaped}["']`,
          "i"
        ),
      ];
      for (const re of patterns) {
        const m = html.match(re);
        if (m && m[1]) return m[1].trim();
      }
    }
    return "";
  }

  /** Nom d'hôte lisible d'une URL (sans "www."), ou l'URL brute si non parsable. */
  function hostOf(url) {
    try {
      return new URL(url).hostname.replace(/^www\./, "");
    } catch (_) {
      return url;
    }
  }

  /* ---------- Nommer des flux qui portent le même nom ----------
     Suivre plusieurs flux d'un même site est la norme dès qu'on veut ses
     rubriques (Courrier international en publie une par flux). Or ils arrivent
     tous sous le MÊME titre : celui du site. Le panneau Sources affichait donc
     trois lignes « Courrier international » identiques, et le filtre trois
     puces identiques — impossible de dire laquelle on cochait, ni laquelle
     était retenue. Ce qui les distingue est déjà dans l'URL : on va l'y
     chercher, et on ne l'affiche QUE là où il y a ambiguïté. */

  /** Segments d'URL qu'on retrouve chez tout le monde : ils ne disent rien de
   *  CE flux-là. La liste est fermée à dessein — « rsspolitique » n'est pas
   *  générique, seul l'est « rss_full » et consorts. */
  const GENERIC_FEED_SEG =
    /^(feeds?|rss|rss[-_](full|all|feed|index|2)|atom|xml|flux|index|default)$/i;
  /** Ce qui distingue un flux des autres du même site : le dernier segment
   *  PARLANT de son chemin, extension retirée.
   *    /feed/all/rss.xml            → « all »
   *    /rss/une.xml                 → « une »
   *    /international/rss_full.xml  → « international »
   *  Aucun segment parlant (« /feed/ ») : la requête, puis le chemin brut —
   *  moins lisible, mais toujours mieux que deux libellés identiques. */
  function feedDiscriminator(url) {
    let path = "";
    let query = "";
    try {
      const u = new URL(url);
      path = u.pathname;
      query = u.search.replace(/^\?/, "");
    } catch (_) {
      path = String(url || "");
    }
    const segs = path.split("/").filter(Boolean);
    for (let i = segs.length - 1; i >= 0; i--) {
      let base = segs[i];
      try {
        base = decodeURIComponent(base);
      } catch (_) {
        /* segment mal encodé : on le prend tel quel */
      }
      base = base.replace(/\.[a-z0-9]{1,5}$/i, "");
      if (base && !GENERIC_FEED_SEG.test(base)) return base.replace(/[-_]+/g, " ");
    }
    return query || segs.join("/");
  }
  /** Libellés d'affichage d'une liste de sources, dans le même ordre : le nom
   *  seul quand il est unique dans la liste, le nom SUIVI de ce qui le
   *  distingue quand plusieurs sources le partagent. La précision n'apparaît
   *  donc que là où elle sert — un fil unique garde son nom nu. */
  function feedLabels(list) {
    const arr = list || [];
    const compte = new Map();
    for (const f of arr) {
      const k = ((f && f.name) || "").trim().toLowerCase();
      compte.set(k, (compte.get(k) || 0) + 1);
    }
    return arr.map((f) => {
      const url = (f && f.url) || "";
      const nom = ((f && f.name) || "").trim() || hostOf(url);
      const k = ((f && f.name) || "").trim().toLowerCase();
      if ((compte.get(k) || 0) <= 1) return nom;
      const d = feedDiscriminator(url);
      return d ? nom + " · " + d : nom;
    });
  }

  /* ---------- Dédoublonnage des actus entre flux ----------
     Un même site publie couramment le MÊME article dans plusieurs de ses flux :
     le flux « à la une » et celui de la rubrique, ou deux rubriques qui se
     recoupent. Coché l'un et l'autre, on voyait donc l'article deux fois dans le
     fil — deux cartes à passer, et deux fois la même chose à lire.
     La moitié Wikipédia dédoublonne depuis toujours (dedupAndRank) ; la moitié
     actus, jamais : chaque flux était plafonné puis simplement concaténé. */

  /** Paramètres d'URL qui ne désignent PAS un contenu différent : campagnes,
   *  provenance, identifiants de partage. Deux flux d'un même site servent
   *  souvent le même article en s'y distinguant seulement par là
   *  (?xtor=RSS-1 sur le flux général, RSS-2 sur celui de la rubrique). */
  const TRACKING_PARAM =
    /^(utm_|xtor|ncid|cmpid|campaign|at_|at_medium|at_campaign|ref|referer|referrer|from|s_cid|sr_share|fbclid|gclid|mc_cid|mc_eid|igshid|spm|__twitter_impression)/i;
  /** Forme canonique d'un lien d'article : hôte sans « www. », chemin sans barre
   *  finale, requête débarrassée du pistage, fragment jeté. Une URL non parsable
   *  est rendue telle quelle, faute de mieux. */
  function canonicalLink(url) {
    try {
      const u = new URL(url);
      for (const k of [...u.searchParams.keys()]) {
        if (TRACKING_PARAM.test(k)) u.searchParams.delete(k);
      }
      const host = u.hostname.replace(/^www\./, "").toLowerCase();
      return host + u.pathname.replace(/\/+$/, "") + (u.search || "");
    } catch (_) {
      return (url || "").trim();
    }
  }
  /* ---------- Cartes vidéo ----------
     Un flux YouTube (`youtube.com/feeds/videos.xml?channel_id=…`) est un Atom
     ordinaire : il est parsé, affiché et entrelacé comme n'importe quelle actu.
     La seule chose qui le distingue, c'est que son lien désigne une vidéo qu'on
     sait intégrer — donc lire SUR la carte, sans ouvrir le lecteur d'articles
     (qui, en mode lecture, jette justement `video,iframe,embed`). */

  /** Hôtes YouTube reconnus. `youtu.be` est traité à part : l'identifiant y est
   *  le chemin, pas un paramètre. */
  const YT_HOSTS = [
    "youtube.com",
    "m.youtube.com",
    "music.youtube.com",
    "youtube-nocookie.com",
  ];
  /** Chemins qui portent l'identifiant directement : /shorts/ID, /embed/ID… */
  const YT_PATH_RE = /^\/(?:shorts|embed|live|v)\/([^/?#]+)/;

  /**
   * Identifiant de la vidéo YouTube désignée par un lien d'article, "" sinon.
   *
   * Le contrôle `[A-Za-z0-9_-]{11}` n'est pas décoratif : c'est LUI qui autorise
   * l'appelant à concaténer le résultat dans l'URL d'un `<iframe src>` sans
   * échappement — même principe que `oneOf()` côté natif pour les réglages du
   * lecteur. Tout ce qui n'a pas exactement cette forme est refusé, y compris
   * une URL bien formée dont le paramètre `v` serait fantaisiste.
   */
  function youtubeId(link) {
    let u;
    try {
      u = new URL(String(link || ""));
    } catch (_) {
      return "";
    }
    // Un lien de flux ne devrait jamais être autre chose, mais `new URL` accepte
    // volontiers `javascript:` — et ce résultat finit dans un attribut `src`.
    if (u.protocol !== "https:" && u.protocol !== "http:") return "";
    const host = u.hostname.replace(/^www\./, "").toLowerCase();
    const ok = (id) => (/^[A-Za-z0-9_-]{11}$/.test(id) ? id : "");
    if (host === "youtu.be") return ok(u.pathname.slice(1).split("/")[0]);
    if (!YT_HOSTS.includes(host)) return "";
    if (u.pathname === "/watch") return ok(u.searchParams.get("v") || "");
    const m = u.pathname.match(YT_PATH_RE);
    return m ? ok(m[1]) : "";
  }

  /** Vrai pour l'URL d'un flux de chaîne ou de playlist YouTube
   *  (`youtube.com/feeds/videos.xml?channel_id=…`). */
  function isYoutubeFeedUrl(url) {
    try {
      const u = new URL(String(url || ""));
      if (u.protocol !== "https:" && u.protocol !== "http:") return false;
      const host = u.hostname.replace(/^www\./, "").toLowerCase();
      return YT_HOSTS.includes(host) && u.pathname === "/feeds/videos.xml";
    } catch (_) {
      return false;
    }
  }

  /* ---------- Shorts seuls ----------
     Le flux d'une chaîne (`channel_id=UC…`) mélange Shorts, vidéos classiques
     et directs, et RIEN dans l'Atom ne dit ce qu'est une entrée : ni durée, ni
     catégorie, ni format de vignette (les Shorts ont le même `hqdefault.jpg`
     en 480×360, la vidéo verticale posée au milieu). Trier après coup
     demanderait donc d'interroger la page de CHAQUE vidéo — une requête par
     carte croisée, ce que l'app refuse par principe.
     YouTube expose heureusement le tri lui-même : toute chaîne a des playlists
     AUTO-GÉNÉRÉES, une par nature de vidéo, dont l'identifiant est celui de la
     chaîne privé de son préfixe `UC` — `UU…` tout, `UULF…` les vidéos
     classiques, `UULV…` les directs, `UUSH…` les Shorts. Elles s'interrogent
     comme n'importe quelle playlist, sur le même point d'entrée
     (`videos.xml?playlist_id=…`), donc sans clé d'API ni requête de plus.
     Ces préfixes ne sont pas documentés par YouTube : s'ils disparaissaient, la
     source ne rendrait plus rien (flux vide ou 404) — jamais un fil rempli de
     vidéos classiques, ce qui est le bon côté pour tomber. */

  /** Identifiant de playlist auto-générée d'une chaîne : le préfixe, puis les
   *  22 caractères de l'identifiant de chaîne. */
  const YT_AUTO_PLAYLIST_RE = /^UU(?:LF|LV|SH|PS|MS|MF|LP)?([A-Za-z0-9_-]{22})$/;
  /** Identifiant de chaîne, dans sa forme canonique (`UC` + 22 caractères). */
  const YT_CHANNEL_RE = /^UC([A-Za-z0-9_-]{22})$/;

  /**
   * URL à interroger RÉELLEMENT pour une source YouTube : celle de sa playlist
   * « Shorts », dérivée de l'identifiant de chaîne (ou de n'importe quelle
   * autre playlist auto-générée de la même chaîne).
   *
   * Tout le reste est rendu tel quel — un flux qui n'est pas YouTube, et une
   * playlist CHOISIE (`PL…`, `OL…`), dont il n'existe aucune variante Shorts :
   * l'utilisateur a désigné cette playlist-là, on ne la remplace pas par une
   * autre. L'URL ENREGISTRÉE, elle, ne bouge jamais (voir `urlDuFlux` dans
   * index.html) : la substitution a lieu au moment de la requête, donc rien à
   * migrer dans le stockage, et un OPML exporté reste celui qu'on a importé.
   */
  function youtubeShortsFeedUrl(url) {
    const s = String(url == null ? "" : url);
    if (!isYoutubeFeedUrl(s)) return s;
    let u;
    try {
      u = new URL(s);
    } catch (_) {
      return s;
    }
    const ch = u.searchParams.get("channel_id") || "";
    const pl = u.searchParams.get("playlist_id") || "";
    const m = ch ? ch.match(YT_CHANNEL_RE) : pl.match(YT_AUTO_PLAYLIST_RE);
    if (!m) return s;
    u.searchParams.delete("channel_id");
    u.searchParams.set("playlist_id", "UUSH" + m[1]);
    return u.toString();
  }

  /** Vrai pour l'URL d'un flux de playlist « Shorts » (voir
   *  `youtubeShortsFeedUrl`). Question posée SÉPARÉMENT de la réécriture : un
   *  lot vide y est un résultat normal (une chaîne peut n'avoir aucun Short),
   *  jamais une source injoignable. */
  function isYoutubeShortsFeedUrl(url) {
    const s = String(url == null ? "" : url);
    if (!isYoutubeFeedUrl(s)) return false;
    try {
      const pl = new URL(s).searchParams.get("playlist_id") || "";
      return /^UUSH[A-Za-z0-9_-]{22}$/.test(pl);
    } catch (_) {
      return false;
    }
  }

  /**
   * Étiquette d'une source YouTube : « YT · <nom de la chaîne> ».
   *
   * Sans elle, TOUTES les chaînes s'appellent « youtube.com » — c'est le nom
   * d'hôte, et l'URL d'un flux YouTube ne contient qu'un identifiant opaque
   * (`channel_id=UC…`), donc rien de lisible à en tirer. Trois chaînes suivies
   * donnaient trois lignes identiques dans le panneau Sources et trois puces
   * identiques dans le filtre, impossibles à distinguer.
   *
   * Le vrai nom n'existe que DANS le flux (`<feed><title>`), d'où l'adoption au
   * premier chargement plutôt qu'un calcul sur l'URL.
   *
   * Le préfixe « YT · » est gardé volontairement : dans une liste où toutes les
   * autres lignes sont des sites de presse, il dit d'un coup d'œil qu'on est
   * devant une chaîne — et il survit à la troncature d'une puce de filtre, qui
   * coupe par la droite.
   */
  function youtubeFeedName(title) {
    const t = String(title == null ? "" : title)
      .replace(/\s+/g, " ")
      .trim();
    // Un nom déjà préfixé (source relue, import d'un OPML exporté par l'app) ne
    // doit pas devenir « YT · YT · … ».
    if (!t || /^YT · /.test(t)) return t;
    return "YT · " + clampText(t, 80);
  }

  /* ---------- Résoudre une page de chaîne en flux RSS ----------
     La plupart des gens ont sous la main l'URL de la page de la chaîne
     (`/@nom`, `/channel/UC…`, `/c/…`, `/user/…`), pas celle du flux. Ajoutée
     telle quelle, elle n'est ni RSS ni Atom : la source ne charge jamais rien.

     Trois fonctions ici, du moins coûteux/fragile au plus (voir
     `resolveYoutubeChannelFeed`, index.html, qui les enchaîne et vérifie
     chaque résultat par une vraie requête — ce qui ne peut donc pas vivre
     ici) : `youtubeChannelIdFromChannelUrl` lit l'identifiant déjà présent
     dans une URL `/channel/UC…` (zéro requête) ; `youtubeChannelHandleFromUrl`
     tire le nom d'une URL `/@nom`, `/c/…` ou `/user/…`, que le flux accepte
     tel quel en paramètre `user=` pour toute chaîne dont le nom actuel
     correspond à un ancien identifiant « utilisateur » (une requête vers le
     flux XML lui-même, jamais la page HTML) ; en dernier recours seulement,
     `youtubeFeedUrlFromChannelHtml` cherche dans le HTML de la page — le
     chemin le plus fragile, puisque Google peut servir à une requête sans
     navigateur une page réduite plutôt que la vraie. */

  /** Chemins qui désignent une page de CHAÎNE, pas déjà un flux ni une vidéo. */
  const YT_CHANNEL_PAGE_RE = /^\/(@[^/]+|channel\/[^/]+|c\/[^/]+|user\/[^/]+)\/?/;

  /** Vrai pour l'URL d'une page de chaîne YouTube encore à résoudre. Faux pour
   *  un flux déjà construit (`isYoutubeFeedUrl`) et pour un lien vidéo. */
  function isYoutubeChannelPageUrl(url) {
    try {
      const u = new URL(String(url || ""));
      if (u.protocol !== "https:" && u.protocol !== "http:") return false;
      const host = u.hostname.replace(/^www\./, "").toLowerCase();
      return YT_HOSTS.includes(host) && YT_CHANNEL_PAGE_RE.test(u.pathname);
    } catch (_) {
      return false;
    }
  }

  /** Identifiant DÉJÀ porté par une URL `/channel/UC…` — aucune requête réseau
   *  nécessaire, contrairement aux autres formes de page de chaîne. "" pour
   *  toute autre forme, ou un segment qui n'a pas la forme d'un identifiant. */
  function youtubeChannelIdFromChannelUrl(url) {
    try {
      const m = new URL(String(url || "")).pathname.match(/^\/channel\/([^/]+)/);
      return m && YT_CHANNEL_RE.test(m[1]) ? m[1] : "";
    } catch (_) {
      return "";
    }
  }

  /** Nom porté par une URL `/@nom`, `/c/nom` ou `/user/nom` (décodé, sans le
   *  `@`). "" pour `/channel/…` (qui porte un identifiant, pas un nom) ou
   *  toute autre forme. Beaucoup de chaînes gardent, sous ce nom, leur ancien
   *  identifiant « utilisateur » — le flux l'accepte directement
   *  (`?user=`, voir resolveYoutubeChannelFeed dans index.html), sans jamais
   *  charger la page HTML de la chaîne : une chaîne sur deux se résout donc
   *  sans jamais dépendre de ce que Google sert à une requête sans navigateur. */
  function youtubeChannelHandleFromUrl(url) {
    try {
      const m = new URL(String(url || "")).pathname.match(
        /^\/(?:@([^/]+)|c\/([^/]+)|user\/([^/]+))/
      );
      if (!m) return "";
      return decodeURIComponent(m[1] || m[2] || m[3] || "");
    } catch (_) {
      return "";
    }
  }

  /** `href` du `<link rel="alternate" type="application/rss+xml">` annoncé par
   *  la page, ou "". L'ordre des attributs sur la balise n'est pas garanti,
   *  d'où deux contrôles séparés plutôt qu'une seule regex rigide. */
  function youtubeRssLinkFromHtml(html) {
    const tags = String(html || "").match(/<link\b[^>]*>/gi) || [];
    for (const tag of tags) {
      if (!/rel=["']alternate["']/i.test(tag)) continue;
      if (!/type=["']application\/rss\+xml["']/i.test(tag)) continue;
      const m = tag.match(/href=["']([^"']+)["']/i);
      if (m) return decodeEntities(m[1]);
    }
    return "";
  }

  /** Identifiant de chaîne (`UC` + 22 caractères) trouvé dans le HTML/les
   *  métadonnées de la page, par ordre de confiance décroissant : les clés
   *  JSON que YouTube pose lui-même, puis un `channel_id=` d'URL, puis un
   *  `UC…` isolé en dernier recours. "" si rien ne correspond. */
  function youtubeChannelIdFromHtml(html) {
    const s = String(html || "");
    const patterns = [
      /"channelId":"(UC[A-Za-z0-9_-]{22})"/,
      /"externalId":"(UC[A-Za-z0-9_-]{22})"/,
      /channel_id=(UC[A-Za-z0-9_-]{22})/,
      /(UC[A-Za-z0-9_-]{22})/,
    ];
    for (const re of patterns) {
      const m = s.match(re);
      if (m) return m[1];
    }
    return "";
  }

  /** URL du flux RSS d'une chaîne, déterminée depuis le HTML de sa page :
   *  le lien RSS qu'elle annonce s'il est exploitable, sinon celle construite
   *  depuis son channelId, sinon "". */
  function youtubeFeedUrlFromChannelHtml(html) {
    const link = youtubeRssLinkFromHtml(html);
    if (link && isYoutubeFeedUrl(link)) return link;
    const id = youtubeChannelIdFromHtml(html);
    return id ? "https://www.youtube.com/feeds/videos.xml?channel_id=" + id : "";
  }

  /* ---------- Clé API YouTube Data v3 (secours optionnel) ----------
     RSS/HTML (ci-dessus) restent le chemin par défaut, sans rien à configurer.
     Une chaîne dont le handle actuel n'est ni un ancien identifiant
     "utilisateur" ni retrouvable dans le HTML (mur de consentement, page
     réduite servie à une requête sans navigateur) ne se résout alors JAMAIS —
     d'où ce dernier recours, qui n'existe que si l'utilisateur a lui-même
     renseigné SA PROPRE clé dans les réglages avancés : jamais de clé
     embarquée dans l'app (quota partagé par tous les utilisateurs, épuisable
     quel que soit le soin apporté à la restreindre — voir CLAUDE.md). Trois
     formes, du moins coûteux en quota au plus (channels.list : 1 unité ;
     search.list : 100) — resolveYoutubeChannelFeed (index.html) les enchaîne
     et vérifie chaque résultat par une vraie requête, ce qui ne peut donc pas
     vivre ici. */

  /** URL `channels.list` pour un handle actuel (`/@nom`). Un handle déjà
   *  préfixé par `@` ne devient pas `@@nom`. */
  function youtubeApiChannelsByHandleUrl(handle, key) {
    return (
      "https://www.googleapis.com/youtube/v3/channels?part=id&forHandle=" +
      encodeURIComponent("@" + String(handle || "").replace(/^@/, "")) +
      "&key=" +
      encodeURIComponent(key || "")
    );
  }

  /** URL `channels.list` pour un ancien identifiant "utilisateur"
   *  (`/user/…`, ou `/c/…` quand ce nom en est un). */
  function youtubeApiChannelsByUsernameUrl(username, key) {
    return (
      "https://www.googleapis.com/youtube/v3/channels?part=id&forUsername=" +
      encodeURIComponent(username || "") +
      "&key=" +
      encodeURIComponent(key || "")
    );
  }

  /** URL `search.list` : dernier recours, pour un `/c/…` qui n'est ni un
   *  handle ni un ancien nom d'utilisateur. */
  function youtubeApiSearchChannelUrl(query, key) {
    return (
      "https://www.googleapis.com/youtube/v3/search?part=snippet&type=channel&maxResults=1&q=" +
      encodeURIComponent(query || "") +
      "&key=" +
      encodeURIComponent(key || "")
    );
  }

  /** Identifiant de chaîne extrait d'une réponse `channels.list`
   *  (`items[0].id`, une chaîne) ou `search.list` (`items[0].id.channelId`).
   *  "" si absent ou mal formé — jamais fait confiance à une forme qui ne
   *  ressemble pas à un vrai identifiant (voir YT_CHANNEL_RE). */
  function youtubeApiChannelIdFromResponse(json) {
    try {
      const item = json && Array.isArray(json.items) ? json.items[0] : null;
      if (!item) return "";
      const id = typeof item.id === "string" ? item.id : item.id && item.id.channelId;
      return id && YT_CHANNEL_RE.test(id) ? id : "";
    } catch (_) {
      return "";
    }
  }

  /** URL `playlistItems.list` : jusqu'à 20 vidéos d'une playlist (Shorts,
   *  ou toute autre — l'API n'a pas besoin, contrairement au flux RSS, de
   *  distinguer une playlist CHOISIE d'une playlist auto-générée : les deux
   *  s'interrogent de la même façon). Un secours de fetchFeedRobust
   *  (index.html) n'a pas vocation à remplacer durablement un flux RSS
   *  revenu au chargement suivant — pas la peine d'en demander plus qu'une
   *  page. */
  function youtubeApiPlaylistItemsUrl(playlistId, key) {
    return (
      "https://www.googleapis.com/youtube/v3/playlistItems?part=snippet&maxResults=20&playlistId=" +
      encodeURIComponent(playlistId || "") +
      "&key=" +
      encodeURIComponent(key || "")
    );
  }

  /** Meilleure vignette d'un objet `snippet.thumbnails` de playlistItems.list
   *  (la plus large déclarée). Contrairement au flux RSS, chaque taille
   *  annonce sa largeur exacte : pas de nom de fichier à interpréter (voir
   *  YT_THUMB_W, plus haut, qui existe pour cette raison côté RSS). */
  function youtubeApiBestThumbnail(thumbnails) {
    const list =
      thumbnails && typeof thumbnails === "object" ? Object.values(thumbnails) : [];
    let best = "",
      bestW = -1;
    for (const t of list) {
      if (t && t.url && (t.width || 0) > bestW) {
        best = t.url;
        bestW = t.width || 0;
      }
    }
    return best;
  }

  /** Items exploitables d'une réponse `playlistItems.list`, dans une forme
   *  proche de celle de fetchFeed/fetchFeedRss2Json (index.html) — mais SANS
   *  `source` : seul l'appelant sait, pour cette chaîne, ce que doit porter
   *  ce champ (voir nomDeSource), et `channelTitle` (une propriété de
   *  chaque item, pas de la réponse) est fourni tel quel pour le déterminer.
   *  Un item sans identifiant de vidéo VALIDE (voir youtubeId, YT_HOSTS) est
   *  écarté plutôt que de produire un lien inerte. */
  function youtubeApiItemsFromPlaylistResponse(json) {
    const items = json && Array.isArray(json.items) ? json.items : [];
    return items
      .map((it) => {
        const sn = it && it.snippet;
        const vid = sn && sn.resourceId && sn.resourceId.videoId;
        if (!vid || !/^[A-Za-z0-9_-]{11}$/.test(vid)) return null;
        return {
          title: String((sn && sn.title) || "").trim(),
          link: "https://www.youtube.com/watch?v=" + vid,
          desc: String((sn && sn.description) || "").trim(),
          img: youtubeApiBestThumbnail(sn && sn.thumbnails),
          date: (sn && sn.publishedAt) || "",
          channelTitle: (sn && sn.channelTitle) || "",
        };
      })
      .filter((it) => it && it.title);
  }

  /* ---------- Actualité juridique Légifrance (API PISTE, secours réservé) ----------
     Fonctionnalité optionnelle, DÉSACTIVÉE par défaut et réservée aux
     utilisateurs qui en ont l'usage (avocats, juristes) : contrairement aux
     actus RSS et à Wikipédia, l'API Légifrance (plateforme PISTE, DILA) exige
     un compte développeur PERSONNEL (client_id + client_secret, obtenus par
     inscription gratuite sur piste.gouv.fr) et un échange OAuth2
     client_credentials avant tout appel de contenu — jamais de clé d'app
     partagée (même principe que la clé YouTube ci-dessus). Le client_secret
     ne devant jamais être exposé dans un navigateur, cette source n'existe
     que côté natif Android (CapacitorHttp, index.html), jamais sur le web. */

  const LEGIFRANCE_TOKEN_URL = "https://oauth.piste.gouv.fr/api/oauth/token";
  const LEGIFRANCE_API_BASE = "https://api.piste.gouv.fr/dila/legifrance/lf-engine-app";

  /** Corps form-encodé de l'échange OAuth2 client_credentials. */
  function legifranceTokenBody(clientId, secret) {
    return (
      "grant_type=client_credentials&client_id=" +
      encodeURIComponent(clientId || "") +
      "&client_secret=" +
      encodeURIComponent(secret || "") +
      "&scope=openid"
    );
  }

  /** Jeton exploitable d'une réponse d'échange OAuth2 : `{token, expiresAt}`,
   *  ou null si `access_token` est absent ou mal formé. `expiresAt` retient
   *  une marge de 30 s sur `expires_in` (annoncé en secondes) pour ne jamais
   *  présenter un jeton expiré au moment précis de son usage. */
  function legifranceAccessTokenFromResponse(json) {
    const token = json && typeof json.access_token === "string" ? json.access_token : "";
    if (!token) return null;
    const ttl = Number(json.expires_in);
    const ttlMs = (Number.isFinite(ttl) && ttl > 30 ? ttl - 30 : 60) * 1000;
    return { token, expiresAt: Date.now() + ttlMs };
  }

  /** URL de l'endpoint "derniers journaux officiels" — POST, sans paramètre
   *  de requête (le nombre d'éléments va dans le CORPS, voir
   *  legifranceLastNJoBody : tous les endpoints de contenu PISTE sont en
   *  POST, schéma confirmé sur le Swagger). */
  function legifranceLastTextsUrl() {
    return LEGIFRANCE_API_BASE + "/consult/lastNJo";
  }

  /** Corps JSON de la requête `/consult/lastNJo` : `{nbElement: N}`, "nombre
   *  de JOs à remonter" (doc PISTE). À passer tel quel (objet JS, pas une
   *  chaîne) à legifranceRequest, qui le sérialise. */
  function legifranceLastNJoBody(limit) {
    return { nbElement: limit || 20 };
  }

  /** Items exploitables d'une réponse `/consult/lastNJo` : chaque entrée de
   *  `containers` est une ÉDITION du Journal officiel (un jour donné), PAS un
   *  texte individuel — `/consult/lastNJo` ne descend pas à ce niveau de
   *  détail (voir CLAUDE.md pour la décision de granularité). `titre` est
   *  gardé tel quel s'il est exploitable, sinon reconstruit depuis `numero`
   *  ("Journal officiel n°…") : le schéma ne garantit pas sa présence.
   *  `datePubli` est un epoch en MILLISECONDES sous forme de chaîne. Un
   *  conteneur sans identifiant est écarté plutôt que de produire une carte
   *  inerte. */
  function legifranceItemsFromResponse(json) {
    const list = json && Array.isArray(json.containers) ? json.containers : [];
    return list
      .map((it) => {
        const id = (it && it.id) || "";
        const numero = (it && it.numero) || "";
        const titreBrut = collapse((it && it.titre) || "");
        const titre = titreBrut || (numero ? "Journal officiel n°" + numero : "");
        const ts = Number(it && it.datePubli);
        const date = Number.isFinite(ts) && ts > 0 ? new Date(ts).toISOString() : "";
        const idEli = (it && typeof it.idEli === "string" && it.idEli) || "";
        return { id, titre, date, idEli };
      })
      .filter((it) => it.id && it.titre);
  }

  /** URL publique legifrance.fr d'une édition du Journal officiel. Priorité
   *  au chemin ELI renvoyé par l'API (`idEli`, ex. "/eli/jo/2019/1/25/0021") —
   *  canonique et déjà exact ; repli sur un identifiant `/jorf/id/{id}`
   *  seulement quand `idEli` est absent (le schéma ne le marque pas
   *  obligatoire). */
  function legifranceArticleUrl(item) {
    const idEli = (item && item.idEli) || "";
    if (idEli) return "https://www.legifrance.gouv.fr" + idEli;
    const id = (item && item.id) || "";
    return id ? "https://www.legifrance.gouv.fr/jorf/id/" + encodeURIComponent(id) : "";
  }

  /* ---------- L'Équipe ----------
     Les flux RSS de L'Équipe (dwh.lequipe.fr) n'ont pas de titre pertinent :
     ils sont tous généré par une même API avec le même titre de base. La
     rubrique réelle se trouve dans le paramètre `path` de l'URL. */

  /**
   * Détecte si une URL est un flux RSS de L'Équipe.
   */
  function isLequipeFeedUrl(url) {
    try {
      const u = new URL(String(url || ""));
      if (u.protocol !== "https:" && u.protocol !== "http:") return false;
      const host = u.hostname.replace(/^www\./, "").toLowerCase();
      return host === "dwh.lequipe.fr" && u.pathname === "/api/edito/rss";
    } catch (_) {
      return false;
    }
  }

  /**
   * Extrait la rubrique du paramètre `path` d'une URL de L'Équipe.
   * Exemples: "/Football/" → "Football", "/" → "".
   */
  function lequipeRubrique(url) {
    try {
      const u = new URL(String(url || ""));
      const path = u.searchParams.get("path") || "/";
      // Nettoyer les slashes et formater : "/Football/" → "Football"
      return path
        .replace(/^\/+|\/+$/g, "") // Retirer les slashes en début/fin
        .split("/")[0]; // Prendre le premier segment
    } catch (_) {
      return "";
    }
  }

  /**
   * Étiquette d'une source L'Équipe : « L'Équipe — Rubrique » ou « L'Équipe ».
   * Exemple: "Football" → "L'Équipe — Football".
   */
  function lequipeFeedName(rubrique) {
    const r = String(rubrique == null ? "" : rubrique)
      .replace(/\s+/g, " ")
      .trim();
    // Déjà préfixé (source relue, OPML réimporté) ne doit pas doubler le préfixe.
    if (/^L'Équipe/.test(r)) return r;
    if (!r) return "L'Équipe";
    return "L'Équipe — " + clampText(r, 50);
  }

  /** Titre réduit à ce qui le distingue : sans accents, sans casse, sans
   *  ponctuation. « Guerre en Ukraine : le point » et « Guerre en Ukraine - Le
   *  point » sont le même titre, écrit par deux gabarits de flux différents. */
  function titleKey(t) {
    return (t || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  }
  /* Six heures, et non vingt-quatre : une chronique au titre fixe (« Programme
     TV du jour ») reparaît à exactement 24 h d'écart, qu'une fenêtre d'un jour
     laisserait donc passer — pile le faux positif à éviter. Deux flux d'un même
     site servant le même article, eux, en publient la date depuis le même champ
     du CMS : elle est identique, ou séparée de quelques minutes quand l'un
     donne la date de mise à jour et l'autre celle de publication. */
  const PROCHE_MS = 6 * 60 * 60 * 1000;
  /** Deux dates assez proches pour parler du même article. Une date absente ou
   *  illisible ne DISQUALIFIE pas (beaucoup de flux n'en publient pas) : elle
   *  laisse simplement le titre trancher seul. */
  function sameDayish(a, b) {
    const ta = Date.parse(a || "");
    const tb = Date.parse(b || "");
    if (isNaN(ta) || isNaN(tb)) return true;
    return Math.abs(ta - tb) <= PROCHE_MS;
  }
  /** Des deux copies d'un même article, celle qui apporte le plus : une image
   *  d'abord (un flux de rubrique en publie souvent une là où le flux général
   *  n'en met pas), puis le résumé le plus complet. Départage DÉTERMINISTE :
   *  l'ordre d'arrivée des flux, lui, dépend du réseau. */
  function richerItem(a, b) {
    const ia = a && a.img ? 1 : 0;
    const ib = b && b.img ? 1 : 0;
    if (ia !== ib) return ia > ib;
    return ((a && a.desc) || "").length > ((b && b.desc) || "").length;
  }
  /**
   * Dédoublonne une liste d'actus venues de PLUSIEURS flux. Deux articles sont
   * le même si :
   *   — leur lien canonique est identique (cas de loin le plus fréquent) ;
   *   — OU, sur le MÊME site, leur titre normalisé est identique et leurs dates
   *     ne se contredisent pas (voir PROCHE_MS).
   *
   * Les deux garde-fous du second critère comptent. Sans le même hôte, deux
   * rédactions qui titrent pareil sur la même dépêche AFP — cas courant —
   * perdraient l'une des deux versions, alors que ce sont bien deux articles.
   * Sans la proximité de date, une chronique au titre fixe (« Le point sur la
   * situation », « Programme TV du jour ») s'effacerait elle-même d'un jour sur
   * l'autre.
   */
  function dedupNews(list) {
    const parLien = new Map();
    const parTitre = new Map();
    const out = [];
    for (const it of list || []) {
      const lien = canonicalLink((it && it.link) || "");
      const tk = titleKey(it && it.title);
      const titre = tk ? hostOf((it && it.link) || "").toLowerCase() + "|" + tk : "";
      let i = -1;
      if (lien && parLien.has(lien)) i = parLien.get(lien);
      else if (titre && parTitre.has(titre)) {
        const j = parTitre.get(titre);
        if (sameDayish(it && it.date, out[j] && out[j].date)) i = j;
      }
      if (i < 0) {
        i = out.length;
        out.push(it);
      } else if (richerItem(it, out[i])) {
        out[i] = it;
      }
      if (lien) parLien.set(lien, i);
      if (titre) parTitre.set(titre, i);
    }
    return out;
  }

  /** Libellés éditoriaux standard du contenu sponsorisé (fr + en), pas de mot
   *  générique comme « partenaire » ou « communiqué de presse » : trop de
   *  faux positifs sur du contenu éditorial légitime. */
  const SPONSORED_PATTERNS = [
    // « Contenu/Article/Dossier/Billet sponsorisé » — les noms qui précèdent
    // le mot varient selon l'éditeur (Les Numériques dit « Dossier
    // sponsorisé »), un seul motif pour tous plutôt qu'une entrée par nom.
    /\b(contenu|article|dossier|billet)\s+sponsoris[ée]/i,
    /\bsponsoris[ée]e?s?\s*[\]:\-–]/i, // « [Sponsorisé] », « Sponsorisé : »
    /^\s*\[?\s*sponsoris[ée]/i,
    // « [Sponso] » : abréviation utilisée par Frandroid en fin de titre,
    // jamais un mot de prose ordinaire — même logique de bordure que
    // « sponsorisé » ci-dessus, sur la forme tronquée.
    /\bsponso\s*[\]:\-–]/i,
    /^\s*\[?\s*sponso\b/i,
    /\bpubli[-\s]?repor?tage/i,
    /\bpubli[-\s]?communiqu[ée]/i,
    /\badvertorial\b/i,
    /\bsponsored\s+(content|post|article)\b/i,
    /\bpaid\s+content\b/i,
    /\bpromoted\s+content\b/i,
  ];
  /** Motif plus large, réservé au champ `tags` (catégories RSS) : un
   *  <category> n'est jamais de la prose, c'est une étiquette délibérée — un
   *  simple « Sponsorisé » comme valeur suffit à trancher, sans le contexte
   *  qu'exige SPONSORED_PATTERNS pour éviter les faux positifs dans un texte
   *  libre (titre/résumé, où « sponsorisé » peut aussi être le SUJET d'un
   *  article, pas son statut).
   *  PAS de `\b` final après [ée] : accentué, `é` n'est pas un caractère de
   *  mot pour `\b` en JS (qui ne connaît que [A-Za-z0-9_] sans indicateur
   *  Unicode) — un `\b` juste après lui échoue TOUJOURS, y compris en toute
   *  fin de chaîne. Piège rencontré en écrivant ce motif : « Sponsorisé »
   *  seul ne matchait pas. */
  const SPONSORED_TAG_PATTERN =
    /\bsponsoris[ée]e?s?|\bpubli[-\s]?repor?tage\b|\bpubli[-\s]?communiqu[ée]|\badvertorial\b|\bsponsored\b/i;

  /** Articles « bons plans » (sélections de promos, souvent affiliées) : PAS
   *  de motif de titre/résumé — un titre de bon plan est en général purement
   *  descriptif du produit et de son prix (« 50 Go à 7,99 € sur le réseau
   *  d'Orange… »), sans jamais dire « bon plan ». Le chemin d'URL, lui, est
   *  une convention répandue chez les sites tech français (Frandroid, Les
   *  Numériques, Numerama…) : /bons-plans/ y désigne toujours cette rubrique,
   *  jamais un article éditorial classique — bien plus fiable qu'un mot-clé.
   *  Complété par la catégorie RSS quand le flux la publie. */
  const DEAL_PATH_PATTERN = /\/bons?-plans?\//i;
  const DEAL_TAG_PATTERN = /\bbons?[\s-]?plans?\b/i;

  /** Vrai si l'item est un contenu commercial que l'utilisateur a choisi de
   *  filtrer : sponsorisé (titre/résumé/catégories) OU bon plan (chemin de
   *  l'URL/catégories) — un seul réglage couvre les deux, tous deux étant du
   *  contenu promotionnel plutôt qu'éditorial. `tags` (catégories RSS, voir
   *  fetchFeed dans index.html) est optionnel — un flux qui n'en publie pas
   *  n'y perd rien. */
  function isPromotionalItem(item) {
    const text = `${(item && item.title) || ""} ${(item && item.desc) || ""}`;
    if (SPONSORED_PATTERNS.some((re) => re.test(text))) return true;
    const tags = (item && item.tags) || "";
    if (SPONSORED_TAG_PATTERN.test(tags) || DEAL_TAG_PATTERN.test(tags)) return true;
    return DEAL_PATH_PATTERN.test((item && item.link) || "");
  }

  /** Sites où au moins UNE PARTIE du contenu est réservée aux abonnés — quasi
   *  aucun site de presse n'est payant à 100 %, même ceux au paywall le plus
   *  strict publient des dépêches ou de l'actu chaude en accès libre. Cette
   *  liste ne sert donc PAS de verdict (voir isPaywalledHtml pour ça) : juste
   *  à décider quels domaines valent la peine d'une vérification article par
   *  article, pour ne pas l'interroger sur des sites qui ne sont jamais
   *  payants. Un faux « candidat » ne coûte qu'une vérification de plus, pas
   *  un mauvais badge — la liste peut donc rester large.
   *  Liste au mérite, non exhaustive, à compléter au fil de l'eau. */
  const PAYWALL_CANDIDATE_DOMAINS = [
    // Presse française (nationale, régionale, magazines)
    "lemonde.fr",
    "lefigaro.fr",
    "lesechos.fr",
    "liberation.fr",
    "mediapart.fr",
    "la-croix.com",
    "lopinion.fr",
    "challenges.fr",
    "courrierinternational.com",
    "telerama.fr",
    "alternatives-economiques.fr",
    "usinenouvelle.com",
    "latribune.fr",
    "lequipe.fr",
    "midilibre.fr",
    "ouest-france.fr",
    "sudouest.fr",
    "leparisien.fr",
    "lepoint.fr",
    "lexpress.fr",
    "nouvelobs.com",
    "laprovence.com",
    "ladepeche.fr",
    "republicain-lorrain.fr",
    "nicematin.com",
    "dna.fr",
    "leprogres.fr",
    "parismatch.com",
    "capital.fr",
    "marianne.net",
    "letemps.ch",
    "lesoir.be",
    // Presse internationale
    "nytimes.com",
    "wsj.com",
    "ft.com",
    "economist.com",
    "washingtonpost.com",
    "theathletic.com",
    "newyorker.com",
    "bloomberg.com",
    "theinformation.com",
    "thetimes.co.uk",
    "telegraph.co.uk",
    "latimes.com",
    "bostonglobe.com",
    "foreignpolicy.com",
    "hbr.org",
    "technologyreview.com",
    "seekingalpha.com",
    "barrons.com",
  ];
  /** Vrai si le lien pointe vers un domaine où une vérification par article a
   *  du sens (voir le commentaire de PAYWALL_CANDIDATE_DOMAINS) — sous-domaines
   *  compris (abonnes.lemonde.fr, etc.). */
  function isPaywallCandidateDomain(url) {
    const host = hostOf(url).toLowerCase();
    return PAYWALL_CANDIDATE_DOMAINS.some((d) => host === d || host.endsWith("." + d));
  }

  /** Deuxième signal, texte visible plutôt que balisage structuré : la
   *  quasi-totalité des sites de presse français à paywall affichent
   *  explicitement « Réservé aux abonnés » sur la page — complète
   *  isAccessibleForFree pour les sites qui ne le déclarent pas (ou dont le
   *  balisage diffère selon la rubrique, cas réel rencontré : Le Monde/Idées).
   *  Risque assumé, non mesurable sans voir les pages concernées : la même
   *  formule peut apparaître dans un encart promotionnel générique en bas
   *  d'un article GRATUIT (« découvrez les avantages réservés aux abonnés »),
   *  ce qui donnerait un faux positif indiscernable par simple recherche de
   *  texte. Accepté sciemment : mieux vaut ce risque ponctuel que rater un
   *  paywall réel faute de balisage fiable. */
  const PAYWALL_TEXT_PATTERN = /r[ée]serv[ée]s?\s+aux\s+abonn[ée]s/i;
  /** Vrai si LA PAGE elle-même déclare l'article payant : soit via le signal
   *  standard utilisé par Google Actualités pour ses propres indicateurs
   *  « abonnés » (`isAccessibleForFree: false` dans un bloc JSON-LD
   *  schema.org NewsArticle), soit via PAYWALL_TEXT_PATTERN ci-dessus.
   *  Recherche texte plutôt que JSON.parse strict pour le premier : les blocs
   *  JSON-LD réels contiennent parfois des caractères ou une syntaxe qui
   *  feraient échouer un vrai parseur, alors que ce signal précis se
   *  reconnaît sans ambiguïté par simple motif. Absence de tout signal →
   *  considéré gratuit (un faux négatif silencieux est préférable à un badge
   *  affiché à tort sur un article réellement libre). */
  function isPaywalledHtml(html) {
    if (!html) return false;
    const s = String(html);
    return (
      /"isAccessibleForFree"\s*:\s*"?false"?/i.test(s) || PAYWALL_TEXT_PATTERN.test(s)
    );
  }

  /** Auteurs « maison » dont les articles sont en réalité des partenariats
   *  commerciaux, sans jamais le dire dans le flux RSS (ni titre, ni résumé,
   *  ni catégorie) — seule LA PAGE de l'article porte le signal, via le lien
   *  de byline vers la fiche de l'auteur. Contrairement à SPONSORED_PATTERNS,
   *  aucun mot-clé de texte libre : « promo » seul donnerait bien trop de
   *  faux positifs (un forfait mobile « en promo » n'est pas du contenu
   *  sponsorisé). Liste au mérite, un seul cas connu pour l'instant : Les
   *  Numériques et son « équipe Promo » (fiche auteur /auteur/682/l-equipe-promo). */
  const SPONSOR_AUTHOR_LINK_PATTERNS = [/\/auteur\/\d+\/l-equipe-promo\b/i];
  /** Vrai si LA PAGE de l'article (pas le flux RSS) contient un lien de
   *  byline vers un de ces auteurs. */
  function isSponsoredHtml(html) {
    if (!html) return false;
    const s = String(html);
    return SPONSOR_AUTHOR_LINK_PATTERNS.some((re) => re.test(s));
  }
  /** Domaines où ce signal existe et vaut la peine d'une lecture profonde de
   *  la page d'article — même principe que PAYWALL_CANDIDATE_DOMAINS, pour ne
   *  pas imposer cette requête supplémentaire à tous les sites. */
  const SPONSOR_CANDIDATE_DOMAINS = ["lesnumeriques.com"];
  /** Vrai si le lien pointe vers un domaine candidat, sous-domaines compris. */
  function isSponsorCandidateDomain(url) {
    const host = hostOf(url).toLowerCase();
    return SPONSOR_CANDIDATE_DOMAINS.some((d) => host === d || host.endsWith("." + d));
  }

  /**
   * Une URL de flux utilisable, et rien d'autre : http(s) seulement.
   *
   * Le champ « ajouter un flux » l'exige déjà (voir addFeed, index.html) ; les
   * IMPORTS, eux, ne le vérifiaient nulle part. Un OPML récupéré n'importe où
   * pouvait donc glisser un `file:///…` ou un `content://…` dans la liste des
   * sources, que l'app va ensuite chercher elle-même — côté natif par le réseau
   * d'Android (CapacitorHttp), pas par un navigateur. Une source injoignable
   * n'est qu'une ligne morte dans le panneau ; autant ne jamais l'y écrire.
   */
  function isFeedUrl(url) {
    if (!url || typeof url !== "string") return false;
    try {
      const p = new URL(url).protocol;
      return p === "http:" || p === "https:";
    } catch (_) {
      return false;
    }
  }

  /** Sources depuis un export JSON (tableau, ou objet {feeds:[...]}) . */
  function parseJsonFeeds(text) {
    const data = JSON.parse(text);
    const arr = Array.isArray(data) ? data : data && data.feeds ? data.feeds : [];
    return arr
      .filter((f) => f && isFeedUrl(f.url))
      .map((f) => ({
        name: clampText(typeof f.name === "string" ? f.name : "", 120) || hostOf(f.url),
        url: String(f.url),
        on: f.on !== false,
      }));
  }

  /** Sources depuis un OPML. Utilise DOMParser si présent, sinon une lecture par regex. */
  function parseOpmlFeeds(text) {
    if (typeof DOMParser !== "undefined") {
      try {
        const doc = new DOMParser().parseFromString(String(text), "text/xml");
        return [...doc.querySelectorAll("outline[xmlUrl]")]
          .map((o) => {
            const url = o.getAttribute("xmlUrl");
            const name = o.getAttribute("text") || o.getAttribute("title") || hostOf(url);
            return { name: clampText(name, 120), url, on: true };
          })
          .filter((f) => isFeedUrl(f.url));
      } catch (_) {
        /* repli ci-dessous */
      }
    }
    const out = [];
    const re = /<outline\b([^>]*)\/?>/gi;
    let m;
    while ((m = re.exec(String(text)))) {
      const attrs = m[1];
      const url = (attrs.match(/xmlUrl\s*=\s*"([^"]*)"/i) ||
        attrs.match(/xmlUrl\s*=\s*'([^']*)'/i) ||
        [])[1];
      if (!url) continue;
      const name =
        (attrs.match(/\btext\s*=\s*"([^"]*)"/i) || [])[1] ||
        (attrs.match(/\btitle\s*=\s*"([^"]*)"/i) || [])[1] ||
        hostOf(url);
      const href = decodeEntities(url);
      if (!isFeedUrl(href)) continue;
      out.push({ name: clampText(decodeEntities(name), 120), url: href, on: true });
    }
    return out;
  }

  return {
    stripHtml,
    clampText,
    isFeedUrl,
    imgFromHtml,
    safeLink,
    safeImg,
    cssString,
    upscaleImageUrl,
    imageSizeFromUrl,
    IMG_TARGET_W,
    esc,
    escAttr,
    relTime,
    dayKey,
    quarterIndex,
    mondayOf,
    sumDaysRange,
    hourlyFromSlots,
    statsBuckets,
    shuffle,
    seenKey,
    dropSeen,
    roundRobin,
    weightedRoundRobin,
    dedupAndRank,
    dedupNews,
    canonicalLink,
    youtubeId,
    isYoutubeFeedUrl,
    youtubeShortsFeedUrl,
    isYoutubeShortsFeedUrl,
    youtubeFeedName,
    isYoutubeChannelPageUrl,
    youtubeChannelIdFromChannelUrl,
    youtubeChannelHandleFromUrl,
    youtubeRssLinkFromHtml,
    youtubeChannelIdFromHtml,
    youtubeFeedUrlFromChannelHtml,
    youtubeApiChannelsByHandleUrl,
    youtubeApiChannelsByUsernameUrl,
    youtubeApiSearchChannelUrl,
    youtubeApiChannelIdFromResponse,
    youtubeApiPlaylistItemsUrl,
    youtubeApiBestThumbnail,
    youtubeApiItemsFromPlaylistResponse,
    LEGIFRANCE_TOKEN_URL,
    LEGIFRANCE_API_BASE,
    legifranceTokenBody,
    legifranceAccessTokenFromResponse,
    legifranceLastTextsUrl,
    legifranceLastNJoBody,
    legifranceItemsFromResponse,
    legifranceArticleUrl,
    isLequipeFeedUrl,
    lequipeRubrique,
    lequipeFeedName,
    feedDiscriminator,
    feedLabels,
    interleave,
    isPromotionalItem,
    isPaywallCandidateDomain,
    isPaywalledHtml,
    isSponsoredHtml,
    isSponsorCandidateDomain,
    hostOf,
    parseJsonFeeds,
    parseOpmlFeeds,
    decodeEntities,
    metaContent,
  };
});
