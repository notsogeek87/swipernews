// Fonction serverless Vercel : extrait, côté serveur, l'image de partage
// (og:image) et DEUX indicateurs — accès payant et auteur « maison » qui
// signale un partenariat commercial — d'un article, les TROIS depuis LA
// MÊME lecture, pour ne jamais payer plusieurs requêtes vers l'éditeur pour
// une seule page. La profondeur de lecture diffère selon ce qui est demandé
// (voir `deep`, paramètre `deep=1`) : og:image seul reste tête-seule
// (rapide), payant/sponsorisé ont besoin de lire plus loin (voir
// MAX_BYTES_DEEP ci-dessous).
//
// Image — pourquoi : certains éditeurs ne publient dans leur flux RSS qu'une
// vignette très réduite. Franceinfo, par exemple, sert des URL Thumbor
// SIGNÉES du type
//   /pictures/<signature>/0x0:1024x576/432x243/filters:quality(50)/…
// La signature couvre la taille demandée : impossible de réclamer un plus grand
// format en modifiant l'URL, le serveur rejette. Le recadrage annoncé
// (0x0:1024x576) montre pourtant qu'une source bien plus grande existe.
// La page de l'article, elle, référence cette source via <meta og:image> — une
// URL déjà signée, en grand format. On va donc la chercher là.
//
// Payant — pourquoi : voir isPaywalledHtml (src/lib.js). Appelé uniquement
// pour les domaines d'une liste de candidats (voir isPaywallCandidateDomain,
// index.html) — pas systématiquement, un article gratuit sur un domaine hors
// liste ne déclenche jamais cet appel.
//
// Sponsorisé — pourquoi : voir isSponsoredHtml (src/lib.js). Même principe,
// pour les domaines d'une liste de candidats séparée (isSponsorCandidateDomain) —
// certains partenariats commerciaux ne se déclarent QUE via le lien de byline
// vers la fiche de l'auteur, jamais dans le flux RSS.
//
// Coût maîtrisé : le front n'appelle ce point d'accès QUE pour les articles
// dont l'image de flux est réellement petite OU dont le domaine fait partie
// des candidats payants/sponsorisés (voir index.html) — jamais pour tout le
// fil. La réponse est minuscule et mise en cache longuement par le CDN, donc
// mutualisée entre tous les utilisateurs.
"use strict";

const { assertSafeUrl, safeFetch } = require("./feed.js");
const { metaContent, isPaywalledHtml, isSponsoredHtml } = require("../src/lib.js");

const FETCH_TIMEOUT_MS = 6000;
// Les balises Open Graph vivent dans le <head> : inutile de lire l'article
// entier, on s'arrête bien avant.
const MAX_BYTES = 256 * 1024;
// L'indicateur payant (isAccessibleForFree), lui, vit dans un bloc JSON-LD qui
// n'est PAS garanti dans le <head> — beaucoup de sites en rendu serveur
// (Next.js et consorts) l'injectent juste avant </body>, une fois tout
// l'article déjà rendu. S'arrêter à </head> comme pour og:image manquerait
// donc systématiquement le signal sur ces sites. Lecture plus large, mais
// seulement quand elle sert (voir `deep` plus bas) — pas pour chaque appel.
const MAX_BYTES_DEEP = 768 * 1024;

// Lit jusqu'à `cap` octets. `stopAtHead` s'arrête dès la fin du <head> (assez
// pour og:image, jamais assez pour un JSON-LD en fin de page) ; sans lui, lit
// jusqu'au cap quel que soit l'endroit où </head> apparaît.
async function readHead(upstream, cap, stopAtHead) {
  const reader = upstream.body && upstream.body.getReader && upstream.body.getReader();
  if (!reader) return (await upstream.text()).slice(0, cap);
  const dec = new TextDecoder("utf-8");
  let html = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    html += dec.decode(value, { stream: true });
    if (html.length >= cap || (stopAtHead && /<\/head>/i.test(html))) {
      try {
        await reader.cancel();
      } catch {
        /* ignore */
      }
      break;
    }
  }
  return html;
}

function decodeEntities(s) {
  return String(s)
    .replace(/&amp;/g, "&")
    .replace(/&#0?38;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'");
}

function applyCors(res) {
  const origin = process.env.ALLOWED_ORIGIN;
  if (origin) res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
}

async function handler(req, res) {
  applyCors(res);
  res.setHeader("X-Content-Type-Options", "nosniff");
  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }
  if (req.method !== "GET") {
    res.status(405).json({ error: "Méthode non autorisée" });
    return;
  }

  const url = req.query && req.query.url;
  if (!url || typeof url !== "string") {
    res.status(400).json({ error: "Paramètre 'url' manquant" });
    return;
  }
  // Posé par index.html uniquement pour les domaines candidats au paywall OU
  // au sponsoring d'auteur (voir isPaywallCandidateDomain,
  // isSponsorCandidateDomain) : un simple appel de secours pour og:image
  // reste en lecture courte, tête seule.
  const deep = req.query && req.query.deep === "1";
  // Même garde anti-SSRF que le proxy de flux : pas de réseau interne.
  try {
    await assertSafeUrl(url);
  } catch (e) {
    res.status(400).json({ error: e.message || "URL non autorisée" });
    return;
  }

  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), FETCH_TIMEOUT_MS);
  try {
    // safeFetch, jamais fetch : chaque redirection repasse par la garde
    // anti-SSRF (voir api/feed.js). `finalUrl` remplace `upstream.url`, que le
    // suivi manuel ne renseigne plus.
    const { res: upstream, url: finalUrl } = await safeFetch(url, {
      signal: ctl.signal,
      headers: {
        "user-agent": "Mozilla/5.0 (compatible; SwiperNews/1.0; +https://news.lielu.eu)",
        accept: "text/html,application/xhtml+xml",
      },
    });
    const type = upstream.headers.get("content-type") || "";
    if (!upstream.ok || !/html/i.test(type)) throw new Error("pas une page HTML");

    const html = await readHead(upstream, deep ? MAX_BYTES_DEEP : MAX_BYTES, !deep);
    // Payant/sponsorisé : calculés quel que soit le sort de l'image ci-dessous —
    // les trois signaux viennent de la même lecture, aucune requête de plus.
    const paywalled = isPaywalledHtml(html);
    const sponsored = isSponsoredHtml(html);

    let image = "";
    let width = 0;
    const raw = metaContent(html, [
      "og:image:secure_url",
      "og:image:url",
      "og:image",
      "twitter:image",
      "twitter:image:src",
    ]);
    if (raw) {
      // Résolution en absolu, et refus de tout ce qui n'est pas http(s).
      const abs = new URL(decodeEntities(raw), finalUrl || url);
      if (abs.protocol === "http:" || abs.protocol === "https:") {
        image = abs.href;
        width = parseInt(metaContent(html, ["og:image:width"]) || "0", 10) || 0;
      }
    }

    // Ni l'image ni l'indicateur payant ne changent en pratique une fois
    // l'article publié : cache CDN long, mutualisé entre tous les utilisateurs.
    res.setHeader("Cache-Control", "s-maxage=86400, stale-while-revalidate=604800");
    res.status(200).json({ image, width, paywalled, sponsored });
  } catch (e) {
    // Page injoignable ou pas HTML : réponse explicite et cacheable, pour ne
    // pas réinterroger la même page à chaque affichage.
    res.setHeader("Cache-Control", "s-maxage=3600");
    res.status(200).json({
      image: "",
      paywalled: false,
      sponsored: false,
      error: (e && e.message) || "indisponible",
    });
  } finally {
    clearTimeout(t);
  }
}

module.exports = handler;
module.exports.metaContent = metaContent;
module.exports.decodeEntities = decodeEntities;
