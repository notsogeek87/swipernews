/* Mode lecture : ne garder que le titre, le texte et les images.
 *
 * Principe repris de Readability (Firefox, Safari) mais réécrit court : on note
 * chaque bloc de la page selon la quantité de texte qu'il porte, on retient le
 * meilleur, on l'élague, puis on REMPLACE la page par une version propre — la
 * feuille de style du site est jetée avec le reste, ce qui supprime d'un coup
 * habillage, colonnes, encarts et bandeaux, sans avoir à les nommer un par un.
 *
 * Ne s'applique jamais de force : si aucun bloc ne réunit assez de texte
 * (galerie, page d'accueil, application web), la page est laissée intacte.
 * Mieux vaut une page normale qu'un article vide.
 */
(function () {
  try {
    if (document.documentElement.dataset.snRead === "1") return;

    /* Signatures de blocs : ce qui entoure l'article, et ce qui le porte. */
    var UNLIKELY = /(comment|sidebar|side-bar|footer|nav|menu|masthead|share|social|promo|related|recommend|newsletter|banner|cookie|consent|advert|sponsor|breadcrumb|pagination|modal|popup|widget|teaser|abonn|paywall|subscri)/i;
    var LIKELY = /(article|content|post|story|entry|main|body|text|prose|chapo|contenu)/i;

    function len(el) {
      return (el.textContent || "").replace(/\s+/g, " ").trim().length;
    }
    function signature(el) {
      var c = el.className;
      if (typeof c !== "string") c = "";   // SVG : className est un objet
      return c + " " + (el.id || "");
    }
    /* Part du texte qui est dans des liens : un sommaire ou un menu tend vers 1,
       un article vers 0. C'est ce qui distingue le mieux les deux. */
    function linkDensity(el) {
      var total = len(el);
      if (!total) return 1;
      var links = el.getElementsByTagName("a"), l = 0;
      for (var i = 0; i < links.length; i++) l += len(links[i]);
      return Math.min(l / total, 1);
    }
    function score(el) {
      var blocks = el.querySelectorAll("p,li,blockquote,pre");
      var s = 0;
      for (var i = 0; i < blocks.length; i++) {
        var n = len(blocks[i]);
        if (n > 25) s += Math.min(n, 1200);   // plafond : un pavé unique ne doit pas tout emporter
      }
      if (!s) return 0;
      var sig = signature(el);
      if (UNLIKELY.test(sig)) s *= 0.2;
      if (LIKELY.test(sig)) s *= 1.5;
      if (el.tagName === "ARTICLE") s *= 1.5;
      return s * (1 - linkDensity(el) * 0.9);
    }

    var candidates = document.querySelectorAll("article,main,section,div,td");
    var best = null, bestScore = 0;
    for (var i = 0; i < candidates.length && i < 4000; i++) {
      var s = score(candidates[i]);
      if (s > bestScore) { bestScore = s; best = candidates[i]; }
    }
    // Seuil : en dessous, ce n'est pas un article. On préfère ne rien faire.
    if (!best || bestScore < 400) return;

    var art = best.cloneNode(true);

    /* 1. Tout ce qui n'est ni texte ni image s'en va. */
    var DROP = "script,style,noscript,iframe,form,button,input,select,textarea,svg,canvas," +
               "nav,aside,footer,header,video,audio,object,embed,link,meta,dialog";
    var junk = art.querySelectorAll(DROP), k;
    for (k = 0; k < junk.length; k++) if (junk[k].parentNode) junk[k].parentNode.removeChild(junk[k]);

    /* 2. Blocs périphériques restés à l'intérieur (« À lire aussi », partage…). */
    var inner = art.querySelectorAll("div,section,ul,ol,figure,aside,p");
    for (k = 0; k < inner.length; k++) {
      var el = inner[k];
      if (!el.parentNode) continue;
      if (UNLIKELY.test(signature(el))) { el.parentNode.removeChild(el); continue; }
      // Liste de liens sans texte propre : un sommaire, pas du contenu.
      if ((el.tagName === "UL" || el.tagName === "OL") && linkDensity(el) > 0.8) {
        el.parentNode.removeChild(el);
      }
    }

    /* 3. Images : rétablir les sources différées, écarter pixels et vignettes. */
    var imgs = art.getElementsByTagName("img");
    for (k = imgs.length - 1; k >= 0; k--) {
      var img = imgs[k];
      var src = img.getAttribute("src") || img.getAttribute("data-src")
             || img.getAttribute("data-original") || img.getAttribute("data-lazy-src") || "";
      if (!src) {
        var ss = img.getAttribute("srcset") || img.getAttribute("data-srcset") || "";
        if (ss) src = ss.split(",")[0].trim().split(/\s+/)[0];
      }
      var w = parseInt(img.getAttribute("width") || "0", 10);
      var h = parseInt(img.getAttribute("height") || "0", 10);
      // Traceurs 1×1 et puces décoratives : rien à lire là-dedans.
      if (!src || src.indexOf("data:") === 0 || (w && w < 120) || (h && h < 120)) {
        if (img.parentNode) img.parentNode.removeChild(img);
        continue;
      }
      try { src = new URL(src, document.baseURI).href; } catch (e) {}
      img.setAttribute("src", src);
    }

    /* 4. Aucun attribut de style ne survit : la feuille du site étant jetée,
       une classe résiduelle ne servirait qu'à réintroduire du hasard. */
    function strip(node) {
      var keep = node.tagName === "A" ? "href" : (node.tagName === "IMG" ? "src" : null);
      var attrs = node.attributes;
      for (var a = attrs.length - 1; a >= 0; a--) {
        var name = attrs[a].name;
        if (name === keep || name === "alt") continue;
        node.removeAttribute(name);
      }
    }
    strip(art);   // la racine aussi : getElementsByTagName ne rend que les descendants
    var all = art.getElementsByTagName("*");
    for (k = 0; k < all.length; k++) strip(all[k]);

    function meta(sel) {
      var m = document.querySelector(sel);
      return (m && m.getAttribute("content")) || "";
    }
    var title = meta('meta[property="og:title"]') || document.title || "";
    var host = location.hostname.replace(/^www\./, "");
    var published = meta('meta[property="article:published_time"]') || meta('meta[name="date"]');
    var when = "";
    if (published) {
      var d = new Date(published);
      if (!isNaN(d)) when = d.toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });
    }

    /* Typographie de liseuse : une colonne, du serif, des marges franches. Les
       couleurs sont celles de l'app ; color-scheme évite que la WebView
       assombrisse par-dessus une page déjà sombre. */
    var CSS = ':root{color-scheme:dark}' +
      'html,body{margin:0;padding:0;background:#0a0a0f;color:#e8e6e1}' +
      '.sn-read{max-width:40em;margin:0 auto;padding:26px 22px 64px;' +
        'font:19px/1.72 Georgia,"Times New Roman",serif;-webkit-text-size-adjust:100%}' +
      '.sn-read h1{font-size:1.55em;line-height:1.22;margin:0 0 10px;color:#f5f3ef;letter-spacing:-.01em}' +
      '.sn-read .sn-src{font:13px/1.4 system-ui,sans-serif;color:#8a8a99;margin:0 0 26px;' +
        'padding-bottom:18px;border-bottom:1px solid rgba(255,255,255,.1)}' +
      '.sn-read p{margin:0 0 1.15em}' +
      '.sn-read h2,.sn-read h3,.sn-read h4{color:#f5f3ef;line-height:1.3;margin:1.7em 0 .5em;font-size:1.15em}' +
      '.sn-read a{color:#7fe3ff;text-decoration:none;border-bottom:1px solid rgba(127,227,255,.35)}' +
      '.sn-read img{display:block;max-width:100%;height:auto;margin:1.6em auto;border-radius:10px}' +
      '.sn-read figcaption{font:13px/1.5 system-ui,sans-serif;color:#8a8a99;text-align:center;margin:-1em 0 1.6em}' +
      '.sn-read blockquote{margin:1.5em 0;padding-left:16px;border-left:3px solid #ff3b6b;color:#cfcdc8;font-style:italic}' +
      '.sn-read ul,.sn-read ol{margin:0 0 1.15em;padding-left:1.3em}' +
      '.sn-read li{margin:.35em 0}' +
      '.sn-read pre{overflow-x:auto;background:#141420;padding:12px;border-radius:10px;font-size:.85em}' +
      '.sn-read hr{border:none;border-top:1px solid rgba(255,255,255,.12);margin:2em 0}';

    document.documentElement.dataset.snRead = "1";
    document.head.innerHTML =
      '<meta name="viewport" content="width=device-width,initial-scale=1">';
    var style = document.createElement("style");
    style.textContent = CSS;
    document.head.appendChild(style);

    var wrap = document.createElement("main");
    wrap.className = "sn-read";
    var h1 = document.createElement("h1");
    h1.textContent = title;
    var src = document.createElement("p");
    src.className = "sn-src";
    src.textContent = host + (when ? " · " + when : "");
    wrap.appendChild(h1);
    wrap.appendChild(src);
    wrap.appendChild(art);

    document.body.innerHTML = "";
    document.body.appendChild(wrap);
    window.scrollTo(0, 0);
  } catch (e) {
    /* Extraction ratée : la page d'origine reste affichée, ce qui est toujours
       préférable à un écran vide. */
  }
})();
