// Fonction serverless Vercel : récupère un flux RSS/Atom côté serveur.
// Le navigateur ne peut pas lire un flux distant (CORS) ; ce point d'accès
// same-origin (/api/feed?url=...) le fait pour lui, de façon fiable.
//
// Durcissement : on refuse tout ce qui n'est pas http(s) public (anti-SSRF :
// pas de localhost, d'IP privées, ni de métadonnées cloud) et on plafonne la
// taille lue pour ne pas saturer la fonction.
const dns = require("dns").promises;
const net = require("net");

const FETCH_TIMEOUT_MS = 8000;
const MAX_BYTES = 5 * 1024 * 1024; // 5 Mo : un flux RSS légitime tient largement dedans

// Plages IP à ne jamais atteindre depuis le serveur (réseau interne, loopback,
// link-local, métadonnées cloud 169.254.169.254, etc.).
function isPrivateIp(ip) {
  const v = net.isIP(ip);
  if (v === 4) {
    const p = ip.split(".").map(Number);
    if (p[0] === 10) return true;
    if (p[0] === 127) return true; // loopback
    if (p[0] === 0) return true;
    if (p[0] === 169 && p[1] === 254) return true; // link-local + métadonnées cloud
    if (p[0] === 172 && p[1] >= 16 && p[1] <= 31) return true;
    if (p[0] === 192 && p[1] === 168) return true;
    if (p[0] === 100 && p[1] >= 64 && p[1] <= 127) return true; // CGNAT
    return false;
  }
  if (v === 6) {
    const s = ip.toLowerCase();
    if (s === "::1" || s === "::") return true; // loopback / non spécifié
    if (s.startsWith("fe80")) return true; // link-local
    if (s.startsWith("fc") || s.startsWith("fd")) return true; // unique local
    // IPv4 mappée (::ffff:a.b.c.d) : on retombe sur le test IPv4
    const m = s.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (m) return isPrivateIp(m[1]);
    return false;
  }
  return false;
}

// Valide l'URL demandée et vérifie que TOUTES ses adresses résolues sont
// publiques (protège aussi contre le DNS qui pointerait vers l'interne).
async function assertSafeUrl(raw) {
  let u;
  try {
    u = new URL(raw);
  } catch {
    throw new Error("URL invalide");
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    throw new Error("Protocole non autorisé");
  }
  const host = u.hostname.replace(/^\[|\]$/g, ""); // retire les crochets IPv6 (ex. [::1])
  // Refus direct d'un littéral IP privé (ex. http://127.0.0.1)
  if (net.isIP(host) && isPrivateIp(host)) throw new Error("Hôte non autorisé");
  if (host === "localhost" || host.endsWith(".localhost")) {
    throw new Error("Hôte non autorisé");
  }
  // Résout le nom et vérifie chaque adresse
  let addrs;
  try {
    addrs = await dns.lookup(host, { all: true });
  } catch {
    throw new Error("Résolution DNS impossible");
  }
  if (!addrs.length || addrs.some((a) => isPrivateIp(a.address))) {
    throw new Error("Hôte non autorisé");
  }
  return u;
}

// Lit le corps de la réponse en s'arrêtant net au-delà de MAX_BYTES.
async function readCapped(upstream) {
  const reader = upstream.body && upstream.body.getReader && upstream.body.getReader();
  if (!reader) {
    // Pas de flux lisible : repli simple avec garde sur la taille finale
    const txt = await upstream.text();
    if (txt.length > MAX_BYTES) throw new Error("Réponse trop volumineuse");
    return txt;
  }
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > MAX_BYTES) {
      try {
        await reader.cancel();
      } catch {
        /* ignore */
      }
      throw new Error("Réponse trop volumineuse");
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks.map((c) => Buffer.from(c))).toString("utf-8");
}

// Le front est same-origin : il n'a besoin d'aucun CORS. Un "*" ferait de ce
// point d'accès un proxy ouvert utilisable par n'importe quel site, à nos frais
// d'exécution et sous notre réputation IP. On n'ouvre donc qu'une origine
// explicitement configurée (ALLOWED_ORIGIN), et rien par défaut.
function applyCors(res) {
  const origin = process.env.ALLOWED_ORIGIN;
  if (origin) res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
}

async function handler(req, res) {
  applyCors(res);
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
        "user-agent":
          "Mozilla/5.0 (compatible; FluxRSS/1.0; +https://swipernews.vercel.app)",
        accept:
          "application/rss+xml, application/atom+xml, application/xml, text/xml, */*",
      },
    });

    const text = await readCapped(upstream);
    // On NE relaie JAMAIS le Content-Type de l'amont. Le faire permettrait de
    // servir du text/html — donc du script exécuté sur NOTRE origine — ou du
    // application/javascript, qui deviendrait un script same-origin éligible à
    // navigator.serviceWorker.register(). Le front ne lit que du XML : on force
    // le type, on interdit le sniffing, et Content-Disposition empêche le rendu
    // en cas de navigation directe vers /api/feed?url=...
    res.setHeader("Content-Type", "application/xml; charset=utf-8");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Content-Disposition", "attachment");
    // cache CDN 5 min, sert l'ancienne version pendant la revalidation
    res.setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate=600");
    res.status(upstream.status).send(text);
  } catch (e) {
    const tooBig = e && e.message === "Réponse trop volumineuse";
    res.status(tooBig ? 413 : 502).json({
      error: tooBig ? "Flux trop volumineux" : "Récupération du flux impossible",
    });
  } finally {
    clearTimeout(t);
  }
}

module.exports = handler;
// Exports pour les tests unitaires (n'affectent pas le handler Vercel).
module.exports.assertSafeUrl = assertSafeUrl;
module.exports.isPrivateIp = isPrivateIp;
