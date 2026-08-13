package eu.lielu.news;

import android.content.Context;

import java.io.BufferedReader;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStreamReader;
import java.io.OutputStreamWriter;
import java.io.Writer;
import java.lang.ref.SoftReference;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.Collections;
import java.util.HashSet;
import java.util.Set;

/**
 * Liste de blocage : celle qui est intégrée à l'APK, et celle que l'utilisateur
 * choisit de télécharger.
 *
 * <p>La liste intégrée ({@code res/raw/reader_blocklist.txt}, écrite à la main)
 * ne bouge qu'au rythme des publications de l'app. Une liste distante corrige
 * ça : elle se met à jour sans republier l'APK, et donne accès aux listes de
 * référence, autrement plus complètes. Les deux sont FUSIONNÉES, jamais
 * substituées — sans réseau, ou si le téléchargement échoue, la liste intégrée
 * reste le plancher.
 *
 * <p>Le téléchargement à l'exécution n'est pas une redistribution : une liste
 * sous CC BY-SA ou GPL peut donc être utilisée sans changer la licence de ce
 * dépôt. Elle n'entre jamais dans le paquet, seulement dans le cache de
 * l'appareil, et la source est créditée dans l'app.
 */
final class BlocklistStore {

    private BlocklistStore() {}

    /** Cache local de la liste téléchargée, un domaine par ligne. */
    private static final String CACHE = "reader_blocklist_cache.txt";

    /** Garde-fous : une URL mal choisie ne doit pas saturer la mémoire. */
    private static final int MAX_BYTES = 12 * 1024 * 1024;
    private static final int MAX_DOMAINS = 300_000;
    private static final int TIMEOUT_MS = 15_000;

    static File cacheFile(Context ctx) {
        return new File(ctx.getFilesDir(), CACHE);
    }

    /**
     * Dernière liste construite, réutilisable tant que le système laisse la
     * mémoire tranquille.
     *
     * <p>{@code load()} est appelé depuis {@code onCreate} du lecteur, donc SUR
     * LE FIL PRINCIPAL, et à CHAQUE article ouvert. Avec une liste de référence
     * (StevenBlack : plus de 200 000 lignes), c'est à chaque fois tout le
     * fichier relu et réanalysé avant que la page ne commence à charger — des
     * centaines de millisecondes rendues à l'ouverture sur un téléphone modeste,
     * pour un résultat rigoureusement identique à celui de l'article précédent.
     *
     * <p>{@link SoftReference} et non un champ statique nu : les 200 000 chaînes
     * pèsent, et l'intérêt d'un cache ne va pas jusqu'à provoquer l'éviction de
     * l'app. Le ramasse-miettes la lâche sous pression mémoire, et on repaie
     * simplement une lecture — le comportement d'avant.
     */
    private static volatile SoftReference<Set<String>> cachedHosts;

    /** À appeler dès que le cache disque change (téléchargement, retrait). */
    static void invalidate() {
        cachedHosts = null;
    }

    /** Liste intégrée + liste téléchargée, prête pour les recherches du lecteur. */
    static Set<String> load(Context ctx) {
        SoftReference<Set<String>> ref = cachedHosts;
        Set<String> memo = ref != null ? ref.get() : null;
        if (memo != null) return memo;
        Set<String> hosts = new HashSet<>();
        readInto(hosts, () -> new BufferedReader(new InputStreamReader(
            ctx.getResources().openRawResource(R.raw.reader_blocklist), StandardCharsets.UTF_8)));
        File cache = cacheFile(ctx);
        if (cache.exists()) {
            readInto(hosts, () -> new BufferedReader(new InputStreamReader(
                new java.io.FileInputStream(cache), StandardCharsets.UTF_8)));
        }
        Set<String> out = Collections.unmodifiableSet(hosts);
        cachedHosts = new SoftReference<>(out);
        return out;
    }

    private interface ReaderFactory {
        BufferedReader open() throws Exception;
    }

    private static void readInto(Set<String> out, ReaderFactory factory) {
        try (BufferedReader r = factory.open()) {
            String line;
            while ((line = r.readLine()) != null && out.size() < MAX_DOMAINS) {
                String d = parseLine(line);
                if (d != null) out.add(d);
            }
        } catch (Exception e) {
            // Une liste illisible ne doit pas empêcher la lecture : on garde ce
            // qu'on a déjà.
        }
    }

    /**
     * Télécharge et normalise une liste. Rend le nombre de domaines retenus, ou
     * lève une exception dont le message est montré à l'utilisateur.
     *
     * <p>À appeler hors du fil principal.
     */
    static int sync(Context ctx, String url) throws Exception {
        if (url == null || !url.startsWith("https://")) throw new Exception("URL invalide (https requis)");
        HttpURLConnection cnx = (HttpURLConnection) new URL(url).openConnection();
        cnx.setConnectTimeout(TIMEOUT_MS);
        cnx.setReadTimeout(TIMEOUT_MS);
        cnx.setInstanceFollowRedirects(true);
        // Pas d'Accept-Encoding posé à la main : HttpURLConnection négocie et
        // décompresse gzip tout seul, le poser désactiverait cette décompression.
        File tmp = new File(ctx.getFilesDir(), CACHE + ".tmp");
        int count = 0;
        long read = 0;
        try {
            int code = cnx.getResponseCode();
            if (code < 200 || code >= 300) throw new Exception("réponse " + code);
            Set<String> seen = new HashSet<>();
            try (BufferedReader r = new BufferedReader(
                     new InputStreamReader(cnx.getInputStream(), StandardCharsets.UTF_8));
                 Writer w = new OutputStreamWriter(new FileOutputStream(tmp), StandardCharsets.UTF_8)) {
                String line;
                while ((line = r.readLine()) != null) {
                    read += line.length() + 1;
                    if (read > MAX_BYTES) throw new Exception("liste trop volumineuse");
                    String d = parseLine(line);
                    if (d == null || !seen.add(d)) continue;
                    w.write(d);
                    w.write('\n');
                    if (++count >= MAX_DOMAINS) break;
                }
            }
            if (count == 0) throw new Exception("aucun domaine reconnu dans ce fichier");
            File cache = cacheFile(ctx);
            // Remplacement en une fois : un téléchargement interrompu ne laisse
            // jamais une liste à moitié écrite en service.
            if (cache.exists() && !cache.delete()) throw new Exception("cache non remplaçable");
            if (!tmp.renameTo(cache)) throw new Exception("cache non remplaçable");
            invalidate();   // la liste en mémoire ne correspond plus au disque
        } finally {
            cnx.disconnect();
            if (tmp.exists()) tmp.delete();
        }
        return count;
    }

    static boolean clear(Context ctx) {
        File cache = cacheFile(ctx);
        invalidate();   // sinon la liste retirée resterait en service jusqu'au prochain démarrage
        return !cache.exists() || cache.delete();
    }

    /**
     * Reconnaît les trois formats répandus et rend le domaine, ou {@code null}
     * si la ligne n'est pas une règle de domaine simple :
     *
     * <ul>
     *   <li>{@code ||exemple.com^} — syntaxe Adblock (EasyList) ;</li>
     *   <li>{@code 0.0.0.0 exemple.com} — fichier hosts (StevenBlack) ;</li>
     *   <li>{@code exemple.com} — domaine brut.</li>
     * </ul>
     *
     * <p>Tout le reste est ignoré à dessein : les règles Adblock avec chemin,
     * joker ou options ({@code $third-party}) ne se ramènent pas à un domaine,
     * et les exceptions ({@code @@}) bloqueraient l'inverse de ce qu'elles
     * disent si on les prenait pour des règles.
     */
    static String parseLine(String raw) {
        if (raw == null) return null;
        String s = raw.trim();
        if (s.isEmpty()) return null;
        char c0 = s.charAt(0);
        if (c0 == '#' || c0 == '!' || c0 == '[' || c0 == ';') return null;   // commentaires et en-têtes
        if (s.startsWith("@@")) return null;                                  // exception : surtout pas

        if (s.startsWith("||")) {
            s = s.substring(2);
            int end = s.indexOf('^');
            if (end < 0) return null;                 // ancrage incomplet : on ne devine pas
            if (end + 1 < s.length()) return null;    // options ou chemin après le ^ : trop spécifique
            s = s.substring(0, end);
        } else {
            // Format hosts : « 0.0.0.0 domaine », avec commentaire de fin éventuel.
            // Le « # » n'est un commentaire que détaché d'un mot : collé, c'est une
            // règle cosmétique Adblock (« lemonde.fr##.banniere ») — la couper
            // donnerait « lemonde.fr » et ferait BLOQUER LE SITE LUI-MÊME.
            int hash = commentAt(s);
            if (hash >= 0) s = s.substring(0, hash).trim();
            if (s.indexOf('#') >= 0) return null;   // règle cosmétique : pas pour nous
            String[] parts = s.split("\\s+");
            if (parts.length == 2) {
                String ip = parts[0];
                if (!ip.equals("0.0.0.0") && !ip.equals("127.0.0.1") && !ip.equals("::1")) return null;
                s = parts[1];
                // « localhost » et compagnie ne sont pas des domaines à bloquer
                if (s.equals("localhost") || s.equals("localhost.localdomain")
                    || s.equals("local") || s.equals("broadcasthost")) return null;
            } else if (parts.length != 1) {
                return null;
            } else {
                s = parts[0];
            }
        }
        return isDomain(s) ? s.toLowerCase() : null;
    }

    /** Position d'un « # » de commentaire : détaché d'un mot, donc précédé d'un blanc. */
    private static int commentAt(String s) {
        for (int i = 1; i < s.length(); i++) {
            if (s.charAt(i) == '#' && Character.isWhitespace(s.charAt(i - 1))) return i;
        }
        return -1;
    }

    /** Un domaine, et rien d'autre : pas de chemin, pas de joker, au moins un point. */
    private static boolean isDomain(String s) {
        if (s.length() < 4 || s.length() > 253) return false;
        boolean dot = false;
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            if (c == '.') {
                dot = true;
            } else if (!((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z')
                         || (c >= '0' && c <= '9') || c == '-' || c == '_')) {
                return false;
            }
        }
        if (!dot || s.charAt(0) == '.' || s.charAt(s.length() - 1) == '.') return false;
        // Une adresse IP n'est pas un domaine : les fichiers hosts en contiennent
        // (« 0.0.0.0 0.0.0.0 »), et la retenir bloquerait un hôte fantôme. Un vrai
        // TLD fait au moins deux caractères et n'est jamais entièrement numérique
        // — « xn--p1ai » et consorts restent acceptés.
        String tld = s.substring(s.lastIndexOf('.') + 1);
        if (tld.length() < 2) return false;
        for (int i = 0; i < tld.length(); i++) {
            if (tld.charAt(i) < '0' || tld.charAt(i) > '9') return true;
        }
        return false;
    }
}
