/* Nettoyage cosmétique des emplacements publicitaires, dans le navigateur
 * intégré. Complément du blocage réseau (res/raw/reader_blocklist.txt), qui
 * empêche la pub de se charger mais laisse parfois un trou : un conteneur vide
 * réservé par le site, ou un bandeau collant devenu blanc.
 *
 * Même contrat que reader_cmp.js : injecté plusieurs fois, donc idempotent, et
 * jamais d'exception — une erreur ici ne doit pas casser la page lue.
 *
 * Prudence assumée sur les sélecteurs : `.ad` seul est ambigu (« ad » veut
 * aussi dire « additional » dans certains cadriciels), donc on ne prend que des
 * marqueurs sans équivoque — emplacements Google Publisher Tag, `ins.adsbygoogle`,
 * attributs `data-ad-*`, et les recommandations sponsorisées (Taboola, Outbrain)
 * qui sont de la publicité déguisée en articles.
 */
(function () {
  try {
    if (window.__snAds) {
      window.__snAds();
      return;
    }

    var SELECTORS = [
      /* Google Publisher Tag / AdSense */
      "ins.adsbygoogle", "[data-ad-slot]", "[data-ad-client]", "[data-adsbygoogle-status]",
      "div[id^='div-gpt-ad']", "div[id^='google_ads']", "iframe[id^='google_ads']",
      "iframe[src*='doubleclick.net']", "iframe[src*='googlesyndication.com']",
      "iframe[src*='safeframe.googlesyndication']",
      /* Recommandations sponsorisées */
      "[id^='taboola']", "[id*='taboola-below']", ".trc_rbox", ".trc_related_container",
      ".OUTBRAIN", "[data-widget-id^='AR_']", ".ob-widget", ".ob-smartfeed-wrapper",
      "[id^='outbrain_widget']", ".mgbox", ".mgline",
      /* Emplacements nommés sans ambiguïté */
      ".advertisement", ".advertising", ".advert", ".ad-container", ".ad-wrapper",
      ".ad-banner", ".ad-slot", ".ad-unit", ".ad-placeholder", ".ads-container",
      ".sticky-ad", ".ad-sticky", ".ad-fixed", "#sticky-ad", "#ad-footer",
      "[class^='adunit']", "[id^='adunit']", "[id^='ad-slot']", "[id^='banner-ad']",
      "[aria-label='Publicité']", "[aria-label='Advertisement']"
    ].join(",");

    var CSS =
      SELECTORS +
      "{display:none!important;height:0!important;min-height:0!important}";

    function styleTag() {
      if (document.getElementById("__sn_ads_css")) return;
      var s = document.createElement("style");
      s.id = "__sn_ads_css";
      s.textContent = CSS;
      (document.head || document.documentElement).appendChild(s);
    }

    /* Les emplacements réservent souvent leur hauteur AVANT de charger : le
       blocage réseau laisse alors une bande vide au milieu du texte. On replie
       ces conteneurs — uniquement s'ils sont vides et hauts, jamais s'ils
       portent du contenu. */
    function collapse() {
      var slots = document.querySelectorAll(
        "[id*='ad-'],[id*='_ad'],[class*='ad-slot'],[class*='adslot'],[class*='publicite']"
      );
      for (var i = 0; i < slots.length && i < 200; i++) {
        var el = slots[i];
        if ((el.textContent || "").trim().length > 0) continue;   // il y a du contenu : on n'y touche pas
        if (el.querySelector("img,video,picture,svg")) continue;
        if (el.offsetHeight < 40) continue;                        // rien à replier
        el.style.setProperty("display", "none", "important");
      }
    }

    function sweep() {
      styleTag();
      collapse();
    }
    window.__snAds = sweep;
    sweep();
    [200, 800, 2000].forEach(function (t) {
      setTimeout(sweep, t);
    });
  } catch (e) {
    /* Une page hostile ne doit jamais empêcher la lecture. */
  }
})();
