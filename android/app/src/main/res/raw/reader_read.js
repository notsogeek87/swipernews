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
 *
 * La mise en page se règle depuis l'app : window.__snRead = {size, theme, top}
 * est posé par InAppBrowserActivity juste avant l'injection (le natif ne stocke
 * rien, il relaie le localStorage du web à chaque ouverture). Valeurs inconnues
 * ou objet absent : on retombe sur « m » et « dark ».
 *
 * « top » est la hauteur de la barre du lecteur, en pixels CSS : l'article la
 * réserve lui-même en marge haute, sinon le titre commence DERRIÈRE la barre et
 * ses premières lignes sont invisibles. C'est la page qui porte cette marge, et
 * plus la WebView (voir applyWebPadding côté activité) : une seule marge, posée
 * là où le texte est mis en page.
 */
(function () {
  try {
    if (document.documentElement.dataset.snRead) return;

    /* Pages de connexion : on ne touche à RIEN.
     *
     * Le mode lecture supprime form/input/button et remplace la page : sur un
     * écran de connexion il ne resterait pas un champ à remplir, et le
     * gestionnaire de mots de passe n'aurait plus rien à autoremplir — l'Autofill
     * d'Android a besoin des vrais champs dans le DOM. C'est le cas des sites
     * sur abonnement (Le Monde, Courrier International…), où l'on passe par une
     * connexion avant de lire.
     *
     * Deux détections, l'une sûre, l'autre en filet : un champ de mot de passe
     * présent dans la page, ou une URL qui annonce la couleur. On sort en
     * marquant « auth » pour que le lecteur sache que ce n'est pas un échec
     * d'extraction et garde le mode actif pour l'article suivant. */
    var AUTH_URL = /(^|\/)(login|log-in|signin|sign-in|connexion|se-connecter|auth|sso|oauth|account|compte|abonnement|subscribe|s-abonner|register|inscription|password|mot-de-passe)(\/|$|\?|#)/i;
    if (document.querySelector('input[type="password"]') || AUTH_URL.test(location.pathname)) {
      document.documentElement.dataset.snRead = "auth";
      return;
    }

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

    /* 1. Tout ce qui n'est ni texte ni image s'en va.
       « source » compte : dans un <picture>, il l'emporte sur le src qu'on vient
       de rétablir plus bas, et ramènerait l'image différée d'origine. */
    var DROP = "script,style,noscript,iframe,form,button,input,select,textarea,svg,canvas," +
               "nav,aside,footer,header,video,audio,object,embed,link,meta,dialog,source,track";
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

    /* 3. Étiquettes d'habillage que le site écrit en toutes lettres. Un vrai
       paragraphe n'est jamais ces trois mots-là et rien d'autre : la comparaison
       porte sur le texte ENTIER du bloc, pas sur une occurrence. */
    var LABELS = /^(publicité|pub|sponsorisé|contenu sponsorisé|partager|partagez|partager l'article|à lire aussi|lire aussi|voir aussi|sur le même sujet|à voir également|commentaires|voir les commentaires|newsletter|abonnez-vous|s'abonner|suivez-nous|temps de lecture|article réservé aux abonnés|réservé aux abonnés|mis à jour|sommaire)\s*[:.]?$/i;
    var labelled = art.querySelectorAll("p,h2,h3,h4,div,span,strong");
    for (k = 0; k < labelled.length; k++) {
      var lb = labelled[k];
      if (!lb.parentNode) continue;
      var txt = (lb.textContent || "").replace(/\s+/g, " ").trim();
      if (txt.length <= 40 && LABELS.test(txt) && !lb.querySelector("img")) {
        lb.parentNode.removeChild(lb);
      }
    }

    /* 4. Images : rétablir les sources différées, écarter pixels et vignettes. */
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

    /* 5. Aucun attribut de style ne survit : la feuille du site étant jetée,
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

    /* 6. Les trous laissés par tout ce qui précède. Un conteneur vidé de son
       encart garde sa boîte : à l'écran, ce sont des blancs de plusieurs lignes
       au milieu du texte — le défaut le plus visible d'une extraction. Deux
       passes, parce qu'un parent ne devient vide qu'une fois ses enfants partis.
       Les <br> en rafale, eux, servaient d'interlignes dans la feuille du site.
       On en garde DEUX au plus : beaucoup de sites séparent leurs paragraphes
       ainsi, et tout raboter recollerait le texte en un seul pavé. */
    function prune() {
      var blocks = art.querySelectorAll("p,div,section,figure,ul,ol,li,blockquote,span,h1,h2,h3,h4,h5,h6");
      for (var b = blocks.length - 1; b >= 0; b--) {
        var n = blocks[b];
        if (!n.parentNode) continue;
        if (!len(n) && !n.querySelector("img")) n.parentNode.removeChild(n);
      }
    }
    prune(); prune();
    var brs = art.querySelectorAll("br");
    for (k = brs.length - 1; k >= 0; k--) {
      var run = 0, prev = brs[k].previousSibling;
      while (prev) {
        if (prev.nodeType === 3 && !prev.nodeValue.trim()) { prev = prev.previousSibling; continue; }
        if (prev.nodeName !== "BR") break;
        run++;
        prev = prev.previousSibling;
      }
      if (run >= 2 && brs[k].parentNode) brs[k].parentNode.removeChild(brs[k]);
    }

    function meta(sel) {
      var m = document.querySelector(sel);
      return (m && m.getAttribute("content")) || "";
    }
    var title = (meta('meta[property="og:title"]') || document.title || "").trim();
    var host = location.hostname.replace(/^www\./, "");
    var published = meta('meta[property="article:published_time"]') || meta('meta[name="date"]');
    var when = "";
    if (published) {
      var d = new Date(published);
      if (!isNaN(d)) when = d.toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });
    }

    /* 7. Le titre : celui de la page d'abord, celui de l'article s'il dit mieux.
       Beaucoup de sites servent en og:title une version RACCOURCIE, écrite pour
       les réseaux : « Zelensky limoge l'ambassadrice… » là où l'article titre
       « Guerre en Ukraine : le président Volodymyr Zelensky limoge… ». Le début
       manquait donc, alors que le <h1> de la page l'avait. Quand ce <h1> contient
       le titre retenu et le dépasse, c'est lui le titre complet.
       Dans l'autre sens, un <title> se termine souvent par « — Le Monde » : le
       <h1> en donne alors la même chose sans l'enseigne.
       Puis le doublon : la plupart des sites répètent le titre dans le corps de
       l'article ; affiché sous le nôtre, il donne deux fois la même ligne. */
    function norm(t) {
      return (t || "").replace(/\s+/g, " ").trim().toLowerCase().replace(/[«»"'’.,:;!?—–-]/g, "");
    }
    var firstHead = art.querySelector("h1,h2,h3");
    var headText = firstHead ? (firstHead.textContent || "").replace(/\s+/g, " ").trim() : "";
    // 200 caractères : au-delà ce n'est plus un titre mais un paragraphe balisé.
    if (headText && headText.length <= 200) {
      var nh = norm(headText), nt = norm(title);
      if (!nt                                                        // aucun titre de page
          || (nh.indexOf(nt) >= 0 && headText.length > title.length) // le <h1> englobe et complète
          || (nt.indexOf(nh) === 0 && headText.length >= 20)) {      // la page ajoute l'enseigne
        title = headText;
      }
    }
    if (firstHead && title && norm(headText) === norm(title) && firstHead.parentNode) {
      firstHead.parentNode.removeChild(firstHead);
    }

    /* 8. Le chapô : premier vrai paragraphe de l'article, souvent écrit pour
       être lu en gras dans la page d'origine. Le distinguer un peu redonne
       l'attaque que la remise à plat lui avait ôtée. */
    var firstP = art.querySelector("p");
    if (firstP && len(firstP) > 90 && len(firstP) < 500) firstP.className = "sn-lead";

    /* Temps de lecture : 220 mots/minute, la moyenne admise en lecture d'écran.
       Il ne sert pas à mesurer mais à décider — « j'ai le temps, ou pas ». */
    var words = (art.textContent || "").trim().split(/\s+/).length;
    var minutes = Math.max(1, Math.round(words / 220));

    /* ---------- Habillage ----------
       Trois fonds et quatre tailles, choisis dans les réglages de l'app et
       transmis à l'ouverture. « color-scheme: only … » est là pour interdire à
       la WebView d'assombrir elle-même par-dessus : sans le mot-clé « only »,
       elle repeindrait le fond sépia en gris foncé. */
    var THEMES = {
      dark:  { scheme: "only dark",  bg: "#0f0f14", ink: "#dcd9d2", strong: "#f5f3ef", mute: "#8f8f9e",
               rule: "rgba(255,255,255,.11)", link: "#93d7ee", quote: "#ff3b6b", code: "#17171f",
               sel: "rgba(74,217,255,.28)", shade: "rgba(255,255,255,.05)" },
      sepia: { scheme: "only light", bg: "#f3ebdc", ink: "#3b332a", strong: "#241d16", mute: "#8a7e6d",
               rule: "rgba(59,51,42,.18)", link: "#9a5620", quote: "#c0563a", code: "#e9ddc7",
               sel: "rgba(192,86,58,.22)", shade: "rgba(59,51,42,.05)" },
      light: { scheme: "only light", bg: "#fcfbf9", ink: "#26262c", strong: "#0e0e13", mute: "#70707c",
               rule: "rgba(0,0,0,.13)", link: "#0d6b8f", quote: "#ff3b6b", code: "#f0eee9",
               sel: "rgba(13,107,143,.20)", shade: "rgba(0,0,0,.04)" },
    };
    var SIZES = { s: 16.5, m: 18.5, l: 20.5, xl: 23 };
    var opt = window.__snRead || {};
    var T = THEMES[opt.theme] || THEMES.dark;
    var FS = SIZES[opt.size] || SIZES.m;
    // Barre du lecteur : bornée, elle vient du natif mais rien n'oblige à la
    // croire. 0 hors app packagée, où la page n'a pas de barre au-dessus d'elle.
    var TOP = Math.max(0, Math.min(300, Number(opt.top) || 0));

    /* Typographie de liseuse : une colonne, du serif, des marges franches.
       Deux réglages font l'essentiel du confort et manquaient :
       — la césure (hyphens), sans quoi le français, avec ses mots longs, laisse
         sur une colonne étroite un bord droit en dents de scie et des lignes à
         moitié vides ;
       — un interlignage un peu resserré (1.6 et non 1.72) : sur une mesure
         courte, trop d'air disperse le regard au lieu de le guider.
       La mesure est plafonnée à 33em, au-delà de quoi l'œil perd le début de la
       ligne suivante — sans effet sur un téléphone, décisif sur une tablette. */
    var CSS = ':root{color-scheme:' + T.scheme + '}' +
      'html{-webkit-text-size-adjust:100%}' +
      'html,body{margin:0;padding:0;background:' + T.bg + ';color:' + T.ink + '}' +
      '::selection{background:' + T.sel + '}' +
      /* La marge haute réserve la place de la barre du lecteur : elle passe par
         une variable pour que l'activité puisse la corriger sans réinjecter
         (rotation, encoche — la barre n'a pas toujours la même hauteur). */
      '.sn-read{max-width:33em;margin:0 auto;padding:calc(22px + var(--sn-top,0px)) 20px 92px;' +
        'font:' + FS + 'px/1.6 Georgia,"Noto Serif","Times New Roman",serif;' +
        'hyphens:auto;-webkit-hyphens:auto;overflow-wrap:break-word;word-break:normal}' +
      '.sn-read h1{font-size:1.62em;line-height:1.18;margin:0 0 12px;color:' + T.strong + ';' +
        'letter-spacing:-.012em;hyphens:none;-webkit-hyphens:none;text-wrap:balance}' +
      '.sn-read .sn-src{font:13px/1.45 system-ui,sans-serif;color:' + T.mute + ';margin:0 0 28px;' +
        'padding-bottom:16px;border-bottom:1px solid ' + T.rule + ';hyphens:none;-webkit-hyphens:none}' +
      '.sn-read p{margin:0 0 1.05em}' +
      '.sn-read .sn-lead{font-size:1.06em;line-height:1.55;color:' + T.strong + ';margin-bottom:1.3em}' +
      '.sn-read h2,.sn-read h3,.sn-read h4,.sn-read h5,.sn-read h6{color:' + T.strong + ';line-height:1.25;' +
        'margin:1.9em 0 .45em;hyphens:none;-webkit-hyphens:none;text-wrap:balance;letter-spacing:-.005em}' +
      '.sn-read h2{font-size:1.28em}' +
      '.sn-read h3{font-size:1.12em}' +
      '.sn-read h4,.sn-read h5,.sn-read h6{font-size:1em}' +
      /* Liens discrets : dans un article, ils se suivent rarement du doigt et une
         couleur vive à chaque ligne hache la lecture. Le soulignement suffit à
         les désigner, décalé sous la ligne de base pour ne pas couper les jambages. */
      '.sn-read a{color:' + T.link + ';text-decoration:underline;text-decoration-thickness:1px;' +
        'text-underline-offset:.16em;text-decoration-color:' + T.link + '80}' +
      '.sn-read img{display:block;max-width:100%;height:auto;margin:1.8em auto;border-radius:12px}' +
      '.sn-read figure{margin:1.8em 0}' +
      '.sn-read figure img{margin:0 auto}' +
      '.sn-read figcaption{font:13px/1.5 system-ui,sans-serif;color:' + T.mute + ';text-align:center;' +
        'margin:.7em 4px 0;hyphens:none;-webkit-hyphens:none}' +
      '.sn-read blockquote{margin:1.6em 0;padding:.1em 0 .1em 16px;border-left:3px solid ' + T.quote + ';' +
        'color:' + T.mute + ';font-style:italic}' +
      '.sn-read ul,.sn-read ol{margin:0 0 1.05em;padding-left:1.25em}' +
      '.sn-read li{margin:.35em 0}' +
      '.sn-read pre{overflow-x:auto;background:' + T.code + ';padding:12px 14px;border-radius:10px;' +
        'font-size:.82em;line-height:1.5;hyphens:none;-webkit-hyphens:none}' +
      '.sn-read code{background:' + T.shade + ';padding:.1em .3em;border-radius:4px;font-size:.86em}' +
      '.sn-read pre code{background:none;padding:0;font-size:1em}' +
      /* Un tableau plus large que l'écran ne doit pas élargir la PAGE : il défile
         dans sa propre boîte, sinon tout l'article se lit de biais. */
      '.sn-read table{display:block;overflow-x:auto;width:100%;border-collapse:collapse;' +
        'font:14px/1.45 system-ui,sans-serif;margin:0 0 1.4em}' +
      '.sn-read th,.sn-read td{border:1px solid ' + T.rule + ';padding:6px 9px;text-align:left}' +
      '.sn-read hr{border:none;border-top:1px solid ' + T.rule + ';margin:2.2em 0}' +
      /* Jauge de lecture, en bas : la barre du haut s'escamote pendant la lecture,
         et c'est justement là qu'on veut savoir où l'on en est. 2 px, la couleur
         de l'app, aucune pastille — on la lit du coin de l'œil ou pas du tout. */
      '.sn-bar{position:fixed;left:0;bottom:0;height:2px;width:0;background:' + T.quote + ';' +
        'z-index:2147483647;pointer-events:none}';

    document.documentElement.dataset.snRead = "1";
    // Posée sur <html> et non dans la feuille : c'est la seule déclaration que
    // l'activité sait remplacer d'un setProperty quand la barre change de taille.
    document.documentElement.style.setProperty("--sn-top", TOP + "px");
    document.head.innerHTML =
      '<meta name="viewport" content="width=device-width,initial-scale=1">';
    // Le titre repart avec le <head> : sans lui, la WebView rapporte l'URL comme
    // titre de page, et c'est l'URL brute qui s'affiche dans la barre du lecteur.
    if (title) document.title = title;
    var style = document.createElement("style");
    style.textContent = CSS;
    document.head.appendChild(style);

    var wrap = document.createElement("main");
    wrap.className = "sn-read";
    var h1 = document.createElement("h1");
    h1.textContent = title;
    var src = document.createElement("p");
    src.className = "sn-src";
    var bits = [];
    if (host) bits.push(host);
    if (when) bits.push(when);
    bits.push(minutes + " min de lecture");
    src.textContent = bits.join(" · ");
    wrap.appendChild(h1);
    wrap.appendChild(src);
    wrap.appendChild(art);

    document.body.innerHTML = "";
    document.body.appendChild(wrap);

    var bar = document.createElement("div");
    bar.className = "sn-bar";
    document.body.appendChild(bar);
    var ticking = false;
    function drawBar() {
      ticking = false;
      var h = document.documentElement.scrollHeight - window.innerHeight;
      var p = h > 40 ? Math.min(1, Math.max(0, window.pageYOffset / h)) : 0;
      bar.style.width = (p * 100).toFixed(2) + "%";
    }
    window.addEventListener("scroll", function () {
      if (ticking) return;
      ticking = true;
      window.requestAnimationFrame(drawBar);
    }, { passive: true });
    drawBar();

    window.scrollTo(0, 0);
  } catch (e) {
    /* Extraction ratée : la page d'origine reste affichée, ce qui est toujours
       préférable à un écran vide. */
  }
})();
