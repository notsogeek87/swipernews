// Fonction serverless Vercel : extrait l'image de partage (og:image) d'un
// article, côté serveur.
//
// Pourquoi : certains éditeurs ne publient dans leur flux RSS qu'une vignette
// très réduite. Franceinfo, par exemple, sert des URL Thumbor SIGNÉES du type
//   /pictures/<signature>/0x0:1024x576/432x243/filters:quality(50)/…
// La signature couvre la taille demandée : impossible de réclamer un plus grand
// format en modifiant l'URL, le serveur rejette. Le recadrage annoncé
// (0x0:1024x576) montre pourtant qu'une source bien plus grande existe.
//
// La page de l'article, elle, référence cette source via <meta og:image> — une
// URL déjà signée, en grand format. On va donc la chercher là.
//
// Coût maîtrisé : le front n'appelle ce point d'accès que pour les articles dont
// l'image de flux est réellement petite, la réponse est minuscule (une URL) et
// mise en cache longuement par le CDN, donc mutualisée entre tous les
// utilisateurs.
"use strict";

const { assertSafeUrl } = require("./feed.js");

const FETCH_TIMEOUT_MS = 6000;
// Les balises Open Graph vivent dans le <head> : inutile de lire l'article
// entier, on s'arrête bien avant.
const MAX_BYTES = 256 * 1024;

// Lit au plus MAX_BYTES, et s'arrête dès la fin du <head>.
async function readHead(upstream) {
  const reader = upstream.body && upstream.body.getReader && upstream.body.getReader();
  if (!reader) return (await upstream.text()).slice(0, MAX_BYTES);
  const dec = new TextDecoder("utf-8");
  let html = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    html += dec.decode(value, { stream: true });
    if (html.length >= MAX_BYTES || /<\/head>/i.test(html)) {
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

// Extrait le contenu d'une balise meta, quel que soit l'ordre des attributs.
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
    const upstream = await fetch(url, {
      signal: ctl.signal,
      redirect: "follow",
      headers: {
        "user-agent": "Mozilla/5.0 (compatible; SwiperNews/1.0; +https://news.lielu.eu)",
        accept: "text/html,application/xhtml+xml",
      },
    });
    const type = upstream.headers.get("content-type") || "";
    if (!upstream.ok || !/html/i.test(type)) throw new Error("pas une page HTML");

    const html = await readHead(upstream);
    const raw = metaContent(html, [
      "og:image:secure_url",
      "og:image:url",
      "og:image",
      "twitter:image",
      "twitter:image:src",
    ]);
    if (!raw) throw new Error("aucune og:image");

    // Résolution en absolu, et refus de tout ce qui n'est pas http(s).
    const abs = new URL(decodeEntities(raw), upstream.url || url);
    if (abs.protocol !== "http:" && abs.protocol !== "https:") {
      throw new Error("schéma d'image non autorisé");
    }

    const width = parseInt(metaContent(html, ["og:image:width"]) || "0", 10) || 0;
    // L'image d'un article ne change pratiquement jamais : cache CDN long,
    // mutualisé entre tous les utilisateurs.
    res.setHeader("Cache-Control", "s-maxage=86400, stale-while-revalidate=604800");
    res.status(200).json({ image: abs.href, width });
  } catch (e) {
    // Pas d'og:image : réponse explicite et cacheable, pour ne pas réinterroger
    // la même page à chaque affichage.
    res.setHeader("Cache-Control", "s-maxage=3600");
    res.status(200).json({ image: "", error: (e && e.message) || "indisponible" });
  } finally {
    clearTimeout(t);
  }
}

module.exports = handler;
module.exports.metaContent = metaContent;
module.exports.decodeEntities = decodeEntities;
