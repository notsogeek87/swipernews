package eu.lielu.news;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.security.MessageDigest;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * Téléchargement d'UN gros fichier (un modèle GGUF, de 0,5 à plus d'1 Go),
 * REPRENABLE, vérifié, installé d'un coup. Aucune dépendance Android : le
 * code se teste tel quel sur une machine de développement.
 *
 * Trois garanties, parce qu'un modèle tronqué ou altéré fait planter le moteur
 * natif (ou pire, résume n'importe quoi) :
 * <ul>
 *   <li>on écrit dans un fichier {@code .part}, et le fichier final n'apparaît
 *       qu'une fois TOUT contrôlé — jamais de modèle à moitié écrit sous son
 *       vrai nom ;</li>
 *   <li>taille ET SHA-256 doivent coïncider avec ce qui est écrit dans le code ;</li>
 *   <li>une coupure réseau ne coûte pas le téléchargement : le {@code .part}
 *       est conservé et le suivant reprend avec {@code Range}.</li>
 * </ul>
 * Bloquant : à appeler depuis un fil de travail. Le HTTPS est exigé par l'appelant
 * (SummaryModelStore), pas ici, pour pouvoir tester contre un serveur local.
 */
final class ModelDownloader {

    interface Progress {
        void onProgress(long done, long total);
    }

    /** Annulé par l'utilisateur ; le {@code .part} est gardé pour reprendre. */
    static final class CancelledException extends IOException {
        CancelledException() {
            super("annulé");
        }
    }

    private static final int BUFFER = 64 * 1024;
    private static final long PROGRESS_STEP = 256L * 1024L;
    private static final int CONNECT_TIMEOUT_MS = 30_000;
    private static final int READ_TIMEOUT_MS = 60_000;

    private ModelDownloader() {}

    static void download(String url, File part, File dest, long expectedSize, String sha256,
                         Progress progress, AtomicBoolean cancel) throws IOException {
        long offset = part.exists() ? part.length() : 0;
        if (offset > expectedSize) {  // reste d'un autre fichier : repartir de zéro
            if (!part.delete()) throw new IOException("impossible de supprimer " + part);
            offset = 0;
        }

        if (offset < expectedSize) {
            try {
                fetch(url, part, offset, expectedSize, progress, cancel);
            } catch (RangeRefused e) {
                // 416 : le serveur ne reconnaît pas notre reprise. Un seul nouvel essai, de zéro.
                if (!part.delete() && part.exists()) throw new IOException("impossible de supprimer " + part);
                fetch(url, part, 0, expectedSize, progress, cancel);
            }
        }

        if (part.length() != expectedSize) {
            // Connexion coupée en cours de route : on garde le .part pour reprendre.
            throw new IOException("incomplet : " + part.length() + " / " + expectedSize);
        }
        if (cancel.get()) throw new CancelledException();
        if (!sha256(part, cancel).equalsIgnoreCase(sha256)) {
            part.delete();  // altéré : inutile de le reprendre
            throw new IOException("somme de contrôle incorrecte");
        }
        if (!isGguf(part)) {
            part.delete();
            throw new IOException("ce n'est pas un fichier GGUF");
        }
        if (dest.exists() && !dest.delete()) throw new IOException("impossible de remplacer " + dest);
        if (!part.renameTo(dest)) throw new IOException("installation impossible");
    }

    private static final class RangeRefused extends IOException {
        RangeRefused() {
            super("reprise refusée");
        }
    }

    private static void fetch(String url, File part, long offset, long total, Progress progress,
                              AtomicBoolean cancel) throws IOException {
        HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
        try {
            c.setConnectTimeout(CONNECT_TIMEOUT_MS);
            c.setReadTimeout(READ_TIMEOUT_MS);
            c.setInstanceFollowRedirects(true);
            // Sans ça, certains serveurs compressent à la volée et brouillent la reprise.
            c.setRequestProperty("Accept-Encoding", "identity");
            if (offset > 0) c.setRequestProperty("Range", "bytes=" + offset + "-");
            final int code = c.getResponseCode();
            if (code == 416) throw new RangeRefused();
            boolean append = offset > 0;
            if (code == 200) {
                append = false;  // le serveur a ignoré Range : il renvoie tout depuis le début
                offset = 0;
            } else if (code == 206) {
                final String range = c.getHeaderField("Content-Range");
                if (range == null || !range.startsWith("bytes " + offset + "-")) {
                    throw new IOException("reprise incohérente : " + range);
                }
            } else {
                throw new IOException("HTTP " + code);
            }

            long done = offset;
            long lastReported = done;
            try (InputStream in = c.getInputStream();
                 FileOutputStream out = new FileOutputStream(part, append)) {
                final byte[] buf = new byte[BUFFER];
                int n;
                progress.onProgress(done, total);
                while ((n = in.read(buf)) >= 0) {
                    if (cancel.get()) throw new CancelledException();
                    if (done + n > total) throw new IOException("plus long que prévu");
                    out.write(buf, 0, n);
                    done += n;
                    if (done - lastReported >= PROGRESS_STEP) {
                        progress.onProgress(done, total);
                        lastReported = done;
                    }
                }
                out.getFD().sync();
            }
            progress.onProgress(done, total);
        } finally {
            c.disconnect();
        }
    }

    static String sha256(File f, AtomicBoolean cancel) throws IOException {
        final MessageDigest md;
        try {
            md = MessageDigest.getInstance("SHA-256");
        } catch (java.security.NoSuchAlgorithmException e) {
            throw new IOException(e);
        }
        try (InputStream in = new FileInputStream(f)) {
            final byte[] buf = new byte[BUFFER];
            int n;
            while ((n = in.read(buf)) >= 0) {
                if (cancel.get()) throw new CancelledException();
                md.update(buf, 0, n);
            }
        }
        final StringBuilder sb = new StringBuilder();
        for (byte b : md.digest()) sb.append(String.format("%02x", b & 0xff));
        return sb.toString();
    }

    /** Un GGUF commence par les quatre octets « GGUF ». */
    static boolean isGguf(File f) {
        if (!f.isFile() || f.length() < 16) return false;
        try (InputStream in = new FileInputStream(f)) {
            final byte[] h = new byte[4];
            return in.read(h) == 4 && h[0] == 'G' && h[1] == 'G' && h[2] == 'U' && h[3] == 'F';
        } catch (IOException e) {
            return false;
        }
    }
}
