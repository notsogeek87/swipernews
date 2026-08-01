// Fonction serverless Vercel : récupère un flux RSS/Atom côté serveur.
// Le navigateur ne peut pas lire un flux distant (CORS) ; ce point d'accès
// same-origin (/api/feed?url=...) le fait pour lui, de façon fiable.
module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");

  const url = req.query && req.query.url;
  if (!url || !/^https?:\/\//i.test(url)) {
    res.status(400).json({ error: "Paramètre 'url' manquant ou invalide" });
    return;
  }

  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 12000);
    const upstream = await fetch(url, {
      signal: ctl.signal,
      redirect: "follow",
      headers: {
        "user-agent":
          "Mozilla/5.0 (compatible; FluxRSS/1.0; +https://swipernews.vercel.app)",
        "accept":
          "application/rss+xml, application/atom+xml, application/xml, text/xml, */*",
      },
    });
    clearTimeout(t);

    const text = await upstream.text();
    res.setHeader(
      "Content-Type",
      upstream.headers.get("content-type") || "text/xml; charset=utf-8"
    );
    // cache CDN 5 min, sert l'ancienne version pendant la revalidation
    res.setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate=600");
    res.status(upstream.status).send(text);
  } catch (e) {
    res.status(502).json({ error: "Récupération du flux impossible" });
  }
};
