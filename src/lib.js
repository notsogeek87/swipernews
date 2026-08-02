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
  const IMG_TARGET_W = 1200;
  function upscaleImageUrl(src, targetW) {
    const url = String(src || "");
    const T = targetW || IMG_TARGET_W;
    if (!url) return "";
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

  /** Dédoublonne plusieurs listes, met les cartes avec image d'abord, mélange, tronque. */
  function dedupAndRank(lists, count) {
    const seen = new Set();
    const out = [];
    for (const list of lists) {
      for (const it of list) {
        const k = seenKey(it);
        if (it.title && !seen.has(k)) {
          seen.add(k);
          out.push(it);
        }
      }
    }
    const withImg = shuffle(out.filter((i) => i.img));
    const noImg = shuffle(out.filter((i) => !i.img));
    return withImg.concat(noImg).slice(0, count);
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

  /** Sources depuis un export JSON (tableau, ou objet {feeds:[...]}) . */
  function parseJsonFeeds(text) {
    const data = JSON.parse(text);
    const arr = Array.isArray(data) ? data : data && data.feeds ? data.feeds : [];
    return arr
      .filter((f) => f && f.url && typeof f.url === "string")
      .map((f) => ({
        name: f.name || hostOf(f.url),
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
            return { name, url, on: true };
          })
          .filter((f) => f.url);
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
      out.push({ name: decodeEntities(name), url: decodeEntities(url), on: true });
    }
    return out;
  }

  return {
    stripHtml,
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
    shuffle,
    seenKey,
    dropSeen,
    dedupAndRank,
    hostOf,
    parseJsonFeeds,
    parseOpmlFeeds,
    decodeEntities,
    metaContent,
  };
});
