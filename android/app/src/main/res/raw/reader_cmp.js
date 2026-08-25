/* Masquage des bandeaux de consentement dans le navigateur intégré.
 *
 * IMPORTANT — ce script MASQUE, il n'ACCEPTE JAMAIS. Aucun bouton n'est cliqué,
 * aucun cookie n'est posé, aucun consentement n'est donné au nom de
 * l'utilisateur : ne rien répondre à une demande de consentement équivaut à un
 * refus, c'est le comportement le plus protecteur. Un script qui cliquerait
 * « Tout accepter » pour faire disparaître le bandeau ferait exactement
 * l'inverse, et c'est pour cela qu'on s'y refuse.
 *
 * Injecté depuis InAppBrowserActivity à plusieurs moments du chargement ; il
 * doit donc être idempotent et ne jamais lever d'exception — une erreur ici ne
 * doit pas casser la page lue.
 *
 * Deux passes complémentaires :
 *   1. une feuille de style avec les sélecteurs des CMP connus (identifiants
 *      stables, très peu de risque de faux positif) ;
 *   2. une heuristique courte pour les bandeaux maison : uniquement les
 *      éléments FIXES près de la racine, dont le texte parle de cookies ET qui
 *      portent un bouton d'acceptation. Les trois conditions ensemble évitent
 *      de faire disparaître un article qui parlerait de cookies.
 * Plus le déverrouillage du défilement, que beaucoup de bandeaux bloquent.
 */
(function () {
  try {
    if (window.__snCmp) {
      window.__snCmp();
      return;
    }

    /* 1) CMP identifiés : conteneurs racines des solutions les plus répandues
       (dont Didomi, Axeptio, Tarteaucitron et AppConsent, omniprésents sur les
       sites d'actualité français). */
    var SELECTORS = [
      "#onetrust-consent-sdk", "#onetrust-banner-sdk", "#ot-sdk-container", ".onetrust-pc-dark-filter",
      "#didomi-host", "#didomi-notice", "#didomi-popup", ".didomi-popup-backdrop",
      "#sd-cmp",
      ".qc-cmp2-container", ".qc-cmp-ui-container", "#qc-cmp2-container",
      "div[id^='sp_message_container']", "iframe[id^='sp_message_iframe']",
      "#CybotCookiebotDialog", "#CybotCookiebotDialogBodyUnderlay", "#CookiebotWidget",
      "#axeptio_overlay", ".axeptio_mount", "#axeptio_main_button",
      "#tarteaucitronRoot", "#tarteaucitronAlertBig", "#tarteaucitronBack",
      ".appconsent", "#appconsent", "iframe[id*='appconsent']",
      "#usercentrics-root", "#uc-banner", "div[data-testid='uc-container']",
      "#cookie-law-info-bar", "#cky-consent", ".cky-consent-container", ".cky-overlay",
      "#cmplz-cookiebanner-container", ".cmplz-cookiebanner",
      ".osano-cm-window", ".osano-cm-dialog",
      "#klaro", ".klaro .cookie-modal", ".klaro .cookie-notice",
      "#iubenda-cs-banner", ".iubenda-cs-container",
      ".fc-consent-root", ".fc-dialog-container", ".fc-dialog-overlay",
      "#termly-code-snippet-support",
      "#BorlabsCookieBox", "#BorlabsCookieWidget",
      "#truste-consent-track", ".truste_overlay", ".truste_box_overlay", "#consent_blackbar",
      "#_evidon_banner", "#_evidon-barrier-wrapper",
      "#cookiescript_injected", "#cookiescript_wrapper",
      "#moove_gdpr_cookie_info_bar",
      ".cc-window", ".cc-banner", ".cc-overlay",
      "#cookie-banner", "#cookie-consent", "#cookieConsent", "#cookie-notice",
      "#cookieNotice", "#gdpr-banner", "#gdpr-consent", "#consent-banner"
    ].join(",");

    var CSS =
      SELECTORS +
      "{display:none!important;visibility:hidden!important;opacity:0!important;pointer-events:none!important}" +
      /* Beaucoup de bandeaux figent la page derrière eux ; on la rend au lecteur. */
      "html,body{overflow:visible!important;overflow-y:auto!important;position:static!important;" +
      "height:auto!important;max-height:none!important;filter:none!important;-webkit-filter:none!important}";

    function styleTag() {
      if (document.getElementById("__sn_cmp_css")) return;
      var s = document.createElement("style");
      s.id = "__sn_cmp_css";
      s.textContent = CSS;
      (document.head || document.documentElement).appendChild(s);
    }

    /* Défilement bloqué : classes (modal-open, no-scroll…) et styles en dur. */
    var LOCK = /(cookie|consent|cmp|gdpr|rgpd|modal-open|no-?scroll|scroll-?lock|overflow-?hidden|noscroll)/i;
    function unlock() {
      [document.documentElement, document.body].forEach(function (el) {
        if (!el) return;
        if (el.classList) {
          Array.prototype.slice.call(el.classList).forEach(function (c) {
            if (LOCK.test(c)) el.classList.remove(c);
          });
        }
        if (el.style) {
          if (el.style.overflow === "hidden" || el.style.overflowY === "hidden") {
            el.style.overflow = "";
            el.style.overflowY = "";
          }
          if (el.style.position === "fixed") el.style.position = "";
        }
      });
    }

    /* 2) Bandeaux maison. Trois conditions cumulatives, volontairement
       étroites : élément fixe/collant, texte de consentement, et un bouton qui
       propose d'accepter. On ne descend qu'à trois niveaux sous <body> — les
       bandeaux se greffent toujours près de la racine, et cela borne le coût. */
    var TXT = /(cookie|consentement|consent|traceur|rgpd|gdpr|vie privée|données personnelles)/i;
    var BTN = /(tout accepter|j'accepte|j.accepte|accepter|accept all|accept cookies|i agree|continuer sans accepter|refuser|paramétrer|gérer mes choix)/i;

    function heuristic() {
      if (!document.body) return;
      var queue = [], depth = new Map(), i, el;
      for (i = 0; i < document.body.children.length; i++) {
        queue.push(document.body.children[i]);
        depth.set(document.body.children[i], 1);
      }
      for (i = 0; i < queue.length && i < 400; i++) {
        el = queue[i];
        var d = depth.get(el) || 1;
        if (d < 3 && el.children) {
          for (var j = 0; j < el.children.length && queue.length < 400; j++) {
            queue.push(el.children[j]);
            depth.set(el.children[j], d + 1);
          }
        }
        // Pas de marqueur « déjà vu » : un bandeau inséré vide puis rempli
        // passerait au travers. La passe est bornée, on peut la refaire.
        var st;
        try {
          st = window.getComputedStyle(el);
        } catch (e) {
          continue;
        }
        if (!st || (st.position !== "fixed" && st.position !== "sticky")) continue;
        if (st.display === "none" || st.visibility === "hidden") continue;
        var txt = (el.textContent || "").slice(0, 4000);
        // Un bandeau reste court : au-delà, c'est du contenu, on n'y touche pas.
        if (txt.length < 25 || txt.length > 2500) continue;
        if (!TXT.test(txt) || !BTN.test(txt)) continue;
        el.style.setProperty("display", "none", "important");
      }
    }

    function sweep() {
      styleTag();
      unlock();
      heuristic();
    }
    window.__snCmp = sweep;
    sweep();

    /* Les CMP se chargent souvent après la page : on repasse quelques fois,
       puis on surveille les verrous de défilement 15 s avant de tout couper —
       un observateur permanent coûterait cher sur une longue lecture. */
    [80, 300, 900, 2000, 4000].forEach(function (t) {
      setTimeout(sweep, t);
    });
    var mo = new MutationObserver(function () {
      unlock();
    });
    mo.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class", "style"],
      childList: true,
      subtree: false
    });
    setTimeout(function () {
      mo.disconnect();
    }, 15000);
  } catch (e) {
    /* Une page hostile ne doit jamais empêcher la lecture. */
  }
})();
