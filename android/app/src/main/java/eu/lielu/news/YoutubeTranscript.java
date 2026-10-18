package eu.lielu.news;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Transcription (sous-titres) d'une vidéo YouTube, pour la résumer sur l'appareil.
 *
 * <p>YouTube n'a aucune API publique pour ça : on interroge le point d'accès interne
 * de ses applications (client ANDROID), qui rend la liste des pistes de sous-titres,
 * puis on lit la piste choisie. Rien n'est garanti dans la durée ; tout échec est
 * simplement « pas de transcription » et l'appelant le dit à l'utilisateur.
 *
 * <p>Appelé hors du fil principal, uniquement sur demande explicite (le bouton de
 * résumé de la carte) : une carte vidéo croisée ne contacte jamais YouTube.
 */
final class YoutubeTranscript {
    private static final String CLIENT_VERSION = "20.10.38";
    private static final int TIMEOUT_MS = 10000;
    private static final int MAX_BYTES = 2 * 1024 * 1024;
    private static final Pattern ID = Pattern.compile("^[A-Za-z0-9_-]{11}$");
    private static final Pattern CUE = Pattern.compile("<(?:text|p)\\b[^>]*>(.*?)</(?:text|p)>", Pattern.DOTALL);
    private static final Pattern TAG = Pattern.compile("<[^>]+>");
    private static final Pattern ENTITY = Pattern.compile("&(#x?[0-9a-fA-F]+|amp|lt|gt|quot|apos|nbsp);");

    private YoutubeTranscript() {}

    static boolean isVideoId(String id) {
        return id != null && ID.matcher(id).matches();
    }

    /** Texte de la transcription, ou null s'il n'y en a pas (ou si YouTube a refusé). */
    static String fetch(String videoId, String lang) {
        if (!isVideoId(videoId)) return null;
        try {
            final JSONObject body = new JSONObject()
                .put("videoId", videoId)
                .put("context", new JSONObject().put("client", new JSONObject()
                    .put("clientName", "ANDROID")
                    .put("clientVersion", CLIENT_VERSION)
                    .put("androidSdkVersion", 34)
                    .put("hl", lang)));
            final String player = request("https://www.youtube.com/youtubei/v1/player?prettyPrint=false",
                body.toString());
            final JSONObject captions = new JSONObject(player).optJSONObject("captions");
            if (captions == null) return null;
            final JSONObject list = captions.optJSONObject("playerCaptionsTracklistRenderer");
            final JSONArray tracks = list == null ? null : list.optJSONArray("captionTracks");
            final String url = pickTrack(tracks, lang);
            if (url == null || !url.startsWith("https://")) return null;
            final String text = parse(request(url, null));
            return text.isEmpty() ? null : condense(text, 3600);
        } catch (Exception e) {
            return null;
        }
    }

    /** Piste manuelle dans la langue, puis automatique dans la langue, puis anglais, puis la première. */
    private static String pickTrack(JSONArray tracks, String lang) {
        if (tracks == null || tracks.length() == 0) return null;
        String best = null;
        int bestScore = -1;
        for (int i = 0; i < tracks.length(); i++) {
            final JSONObject t = tracks.optJSONObject(i);
            if (t == null) continue;
            final String url = t.optString("baseUrl", "");
            if (url.isEmpty()) continue;
            final String code = t.optString("languageCode", "");
            final boolean auto = "asr".equals(t.optString("kind", ""));
            final boolean same = code.equals(lang) || code.startsWith(lang + "-");
            final int score = (same ? 4 : code.startsWith("en") ? 2 : 0) + (auto ? 0 : 1);
            if (score > bestScore) {
                bestScore = score;
                best = url;
            }
        }
        return best;
    }

    /**
     * Réduit une longue transcription à {@code max} caractères en gardant {@code SLICES} extraits
     * répartis sur toute la durée (début, milieu, fin) : le résumé couvre la vidéo entière en une
     * seule passe, au lieu de se limiter à ses premières minutes.
     */
    static String condense(String text, int max) {
        if (text.length() <= max) return text;
        final int slices = 4;
        final int size = max / slices;
        final StringBuilder sb = new StringBuilder();
        for (int i = 0; i < slices; i++) {
            int from = (int) ((long) (text.length() - size) * i / (slices - 1));
            int to = from + size;
            // Coupes sur des espaces, pour ne pas finir ni commencer au milieu d'un mot.
            if (i > 0) {
                final int sp = text.indexOf(' ', from);
                if (sp > 0 && sp < to) from = sp + 1;
            }
            if (i < slices - 1 && to < text.length()) {
                final int sp = text.lastIndexOf(' ', to);
                if (sp > from) to = sp;
            }
            if (sb.length() > 0) sb.append(" [...] ");
            sb.append(text, from, to);
        }
        return sb.toString();
    }

    /** Fusionne les répliques en un texte continu : XML « text » ou « p » selon le format rendu. */
    static String parse(String xml) {
        if (xml == null) return "";
        final StringBuilder out = new StringBuilder();
        final Matcher m = CUE.matcher(xml);
        while (m.find()) {
            final String line = unescape(unescape(TAG.matcher(m.group(1)).replaceAll(""))).trim();
            if (line.isEmpty()) continue;
            if (out.length() > 0) out.append(' ');
            out.append(line.replace('\n', ' '));
        }
        return out.toString().replaceAll("\\s+", " ").trim();
    }

    /** Appelé deux fois : YouTube échappe deux fois ses apostrophes (&amp;#39;). */
    private static String unescape(String s) {
        final Matcher m = ENTITY.matcher(s);
        final StringBuffer sb = new StringBuffer();
        while (m.find()) {
            final String e = m.group(1);
            String r;
            switch (e) {
                case "amp": r = "&"; break;
                case "lt": r = "<"; break;
                case "gt": r = ">"; break;
                case "quot": r = "\""; break;
                case "apos": r = "'"; break;
                case "nbsp": r = " "; break;
                default:
                    try {
                        final int cp = e.charAt(1) == 'x' || e.charAt(1) == 'X'
                            ? Integer.parseInt(e.substring(2), 16) : Integer.parseInt(e.substring(1));
                        r = new String(Character.toChars(cp));
                    } catch (RuntimeException ex) {
                        r = "";
                    }
            }
            m.appendReplacement(sb, Matcher.quoteReplacement(r));
        }
        m.appendTail(sb);
        return sb.toString();
    }

    private static String request(String url, String jsonBody) throws IOException {
        final HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
        try {
            c.setConnectTimeout(TIMEOUT_MS);
            c.setReadTimeout(TIMEOUT_MS);
            c.setRequestProperty("User-Agent",
                "com.google.android.youtube/" + CLIENT_VERSION + " (Linux; U; Android 14) gzip");
            if (jsonBody != null) {
                c.setRequestMethod("POST");
                c.setDoOutput(true);
                c.setRequestProperty("Content-Type", "application/json");
                try (OutputStream o = c.getOutputStream()) {
                    o.write(jsonBody.getBytes(StandardCharsets.UTF_8));
                }
            }
            if (c.getResponseCode() != 200) throw new IOException("HTTP " + c.getResponseCode());
            try (InputStream in = c.getInputStream()) {
                final ByteArrayOutputStream buf = new ByteArrayOutputStream();
                final byte[] chunk = new byte[8192];
                int n;
                while ((n = in.read(chunk)) > 0) {
                    buf.write(chunk, 0, n);
                    if (buf.size() > MAX_BYTES) throw new IOException("trop gros");
                }
                return buf.toString("UTF-8");
            }
        } finally {
            c.disconnect();
        }
    }
}
