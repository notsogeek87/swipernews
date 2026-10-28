package eu.lielu.news;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.Charset;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Le texte d'un article de presse, tiré de sa page HTML, et le découpage d'un
 * résumé en phrases à lire. Aucune dépendance Android : le code se teste tel quel
 * sur de vraies pages, sur une machine de développement.
 *
 * <p>Pourquoi : le flux RSS ne porte souvent qu'un extrait de deux phrases, trop
 * court pour être résumé (voir {@link FlashSummarizer}). La page de l'article, elle,
 * est chez l'éditeur dont l'utilisateur a LUI-MÊME choisi le flux : la lire n'est
 * pas un appel à un tiers non choisi.
 *
 * <p>L'extraction est volontairement simple (les paragraphes de l'article) et ne
 * vise pas l'exactitude du mode lecture : elle n'a qu'à fournir assez de texte au
 * modèle. Tout ce qu'elle ne sait pas faire (page rendue par script, mur
 * d'abonnement, bandeau de consentement) rend le texte VIDE, et l'appelant retombe
 * sur l'extrait du flux — jamais sur un texte à moitié faux.
 */
final class ArticleText {

    private ArticleText() {}

    /** Au-delà, la page est ignorée : un article de presse pèse bien moins. */
    static final int MAX_DOWNLOAD_BYTES = 1_500_000;
    /** En dessous, ce n'est pas un article (page d'erreur, mur, squelette). */
    static final int MIN_TEXT_CHARS = 400;
    /** Un paragraphe plus court est une légende, un bouton, un intitulé. */
    private static final int MIN_PARAGRAPH_CHARS = 60;

    private static final String UA = "Mozilla/5.0 (Linux; Android 14) SwiperNews";

    /** Télécharge une page web (http ou https seulement) ; chaîne vide en cas d'échec. */
    static String fetch(String url, int timeoutMs) {
        if (url == null || !(url.startsWith("https://") || url.startsWith("http://"))) return "";
        HttpURLConnection c = null;
        try {
            c = (HttpURLConnection) new URL(url).openConnection();
            c.setConnectTimeout(timeoutMs);
            c.setReadTimeout(timeoutMs);
            c.setInstanceFollowRedirects(true);
            c.setRequestProperty("User-Agent", UA);
            c.setRequestProperty("Accept", "text/html,application/xhtml+xml");
            c.setRequestProperty("Accept-Language", "fr,en;q=0.7");
            if (c.getResponseCode() != 200) return "";
            final String type = c.getContentType();
            if (type != null && !type.toLowerCase().contains("html")) return "";
            final byte[] body = readLimited(c.getInputStream(), MAX_DOWNLOAD_BYTES);
            return new String(body, charsetOf(type, body));
        } catch (IOException | RuntimeException e) {
            return "";
        } finally {
            if (c != null) c.disconnect();
        }
    }

    private static byte[] readLimited(InputStream in, int max) throws IOException {
        try (InputStream is = in) {
            final ByteArrayOutputStream out = new ByteArrayOutputStream(64 * 1024);
            final byte[] buf = new byte[16 * 1024];
            int n;
            while ((n = is.read(buf)) >= 0) {
                if (out.size() + n > max) throw new IOException("page trop grosse");
                out.write(buf, 0, n);
            }
            return out.toByteArray();
        }
    }

    private static final Pattern CHARSET = Pattern.compile("charset\\s*=\\s*[\"']?([A-Za-z0-9_\\-]+)");

    /** Jeu de caractères annoncé par l'en-tête HTTP, sinon par la balise meta, sinon UTF-8. */
    static Charset charsetOf(String contentType, byte[] body) {
        String name = null;
        if (contentType != null) {
            final Matcher m = CHARSET.matcher(contentType);
            if (m.find()) name = m.group(1);
        }
        if (name == null) {
            final int head = Math.min(body.length, 4096);
            final Matcher m = CHARSET.matcher(new String(body, 0, head, StandardCharsets.ISO_8859_1));
            if (m.find()) name = m.group(1);
        }
        if (name != null) {
            try {
                return Charset.forName(name);
            } catch (RuntimeException e) {
                // nom inconnu : UTF-8 ci-dessous
            }
        }
        return StandardCharsets.UTF_8;
    }

    private static final Pattern DROP = Pattern.compile(
        "(?is)<(script|style|noscript|svg|nav|header|footer|aside|form|iframe|template|button|select|figure|figcaption)\\b[^>]*>.*?</\\1\\s*>");
    private static final Pattern COMMENT = Pattern.compile("(?s)<!--.*?-->");
    private static final Pattern ARTICLE = Pattern.compile("(?is)<article\\b[^>]*>(.*?)</article\\s*>");
    private static final Pattern PARAGRAPH = Pattern.compile("(?is)<p\\b[^>]*>(.*?)</p\\s*>");
    private static final Pattern TAG = Pattern.compile("(?s)<[^>]*>");
    private static final Pattern SPACES = Pattern.compile("[\\s\\u00a0\\u202f]+");
    private static final Pattern NOISE = Pattern.compile(
        "(?i)cookies?|abonn[ée]|lire aussi|à lire aussi|newsletter|tous droits réservés|©|"
            + "partager cet article|se connecter|créer un compte|javascript|"
            // Pages que l'éditeur sert à un client qu'il prend pour un robot : du texte
            // assez long pour passer le seuil, mais qui n'a rien d'un article.
            + "bot activity|automated|captcha|access denied|not a robot|human|"
            + "activité automatis|trafic automatis|pas un robot|accès refusé");

    /**
     * Le texte de l'article : ses paragraphes, assemblés jusqu'à {@code maxChars}.
     * Chaîne vide quand il y en a trop peu pour être un article.
     */
    static String extract(String html, int maxChars) {
        if (html == null || html.isEmpty()) return "";
        String h = COMMENT.matcher(html).replaceAll(" ");
        h = DROP.matcher(h).replaceAll(" ");
        // Le premier <article> assez fourni, sinon la page entière.
        Matcher a = ARTICLE.matcher(h);
        String zone = h;
        while (a.find()) {
            if (a.group(1).length() > 1500) {
                zone = a.group(1);
                break;
            }
        }
        final StringBuilder out = new StringBuilder();
        final Matcher p = PARAGRAPH.matcher(zone);
        while (p.find() && out.length() < maxChars) {
            final String t = clean(p.group(1));
            if (t.length() < MIN_PARAGRAPH_CHARS || NOISE.matcher(t).find()) continue;
            if (out.length() > 0) out.append(' ');
            out.append(t);
        }
        if (out.length() < MIN_TEXT_CHARS) return "";
        return out.length() > maxChars ? cut(out.toString(), maxChars) : out.toString();
    }

    private static String cut(String s, int max) {
        int end = max;
        if (end > 0 && Character.isHighSurrogate(s.charAt(end - 1))) end--;
        final String head = s.substring(0, end);
        final int dot = Math.max(head.lastIndexOf(". "), Math.max(head.lastIndexOf("! "), head.lastIndexOf("? ")));
        return dot > max / 2 ? head.substring(0, dot + 1) : head;
    }

    private static String clean(String fragment) {
        String t = TAG.matcher(fragment).replaceAll(" ");
        t = decodeEntities(t);
        return SPACES.matcher(t).replaceAll(" ").trim();
    }

    private static final Pattern ENTITY = Pattern.compile("&(#x[0-9a-fA-F]+|#[0-9]+|[A-Za-z]+);");

    static String decodeEntities(String s) {
        if (s.indexOf('&') < 0) return s;
        final Matcher m = ENTITY.matcher(s);
        final StringBuffer sb = new StringBuffer();
        while (m.find()) {
            m.appendReplacement(sb, Matcher.quoteReplacement(entity(m.group(1))));
        }
        m.appendTail(sb);
        return sb.toString();
    }

    private static String entity(String e) {
        try {
            if (e.startsWith("#x") || e.startsWith("#X")) return new String(Character.toChars(Integer.parseInt(e.substring(2), 16)));
            if (e.startsWith("#")) return new String(Character.toChars(Integer.parseInt(e.substring(1))));
        } catch (RuntimeException ex) {
            return " ";
        }
        switch (e) {
            case "amp": return "&";
            case "lt": return "<";
            case "gt": return ">";
            case "quot": return "\"";
            case "apos": return "'";
            case "nbsp": return " ";
            case "laquo": return "«";
            case "raquo": return "»";
            case "hellip": return "…";
            case "rsquo": case "lsquo": return "'";
            case "ldquo": case "rdquo": return "\"";
            case "ndash": case "mdash": return "-";
            case "euro": return "€";
            case "eacute": return "é";
            case "egrave": return "è";
            case "agrave": return "à";
            case "ecirc": return "ê";
            case "ccedil": return "ç";
            default: return " ";
        }
    }

    // ---------- Le résumé, en phrases à lire ----------

    private static final Pattern SENTENCE = Pattern.compile("[^.!?…]+[.!?…]*\\s*");

    /**
     * Découpe un résumé généré en morceaux de {@code max} caractères au plus, à la
     * phrase, pour la synthèse vocale (même principe que ttsChunks dans src/lib.js :
     * un moteur abandonne parfois un long texte lu d'un bloc). Retire ce qu'un modèle
     * ajoute volontiers et qu'une voix prononcerait : puces, étoiles, dièses, retours à
     * la ligne.
     */
    static List<String> speechChunks(String summary, int max) {
        final List<String> out = new ArrayList<>();
        if (summary == null) return out;
        String t = summary.replaceAll("[*#_`>]+", " ").replaceAll("(?m)^\\s*[-•]\\s+", "");
        t = SPACES.matcher(t).replaceAll(" ").trim();
        if (t.isEmpty()) return out;
        String cur = "";
        final Matcher m = SENTENCE.matcher(t);
        while (m.find()) {
            String ph = m.group().trim();
            if (ph.isEmpty()) continue;
            while (ph.length() > max) {
                final int space = ph.substring(0, max).lastIndexOf(' ');
                final int n = space > max / 2 ? space : max;
                if (!cur.isEmpty()) {
                    out.add(cur);
                    cur = "";
                }
                out.add(ph.substring(0, n).trim());
                ph = ph.substring(n).trim();
            }
            if (!cur.isEmpty() && cur.length() + 1 + ph.length() > max) {
                out.add(cur);
                cur = ph;
            } else {
                cur = cur.isEmpty() ? ph : cur + " " + ph;
            }
        }
        if (!cur.isEmpty()) out.add(cur);
        return out;
    }
}
