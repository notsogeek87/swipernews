package eu.lielu.news;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * Extraction d'une archive TAR (déjà décompressée) dans un dossier. Aucune
 * dépendance Android ni bibliothèque : le code se teste tel quel sur une machine
 * de développement. La décompression bzip2 qui précède est faite ailleurs
 * (NeuralVoices), ce qui laisse cette partie — la seule à écrire des fichiers
 * d'après des noms venus d'ailleurs — entièrement lisible ici.
 *
 * <p>L'archive est vérifiée par SHA-256 avant d'arriver ici, mais on ne s'y fie pas
 * pour autant : un nom de chemin qui sort du dossier ({@code ../}), un chemin
 * absolu, une taille démesurée sont refusés, jamais « corrigés ». Seuls les
 * fichiers et les dossiers sont écrits ; liens et fichiers spéciaux sont ignorés.
 */
final class VoiceArchive {

    /** Plafond de ce qu'une archive de voix peut écrire (la plus grosse : ~80 Mo). */
    static final long MAX_TOTAL_BYTES = 400L * 1024 * 1024;
    private static final int BLOCK = 512;

    private VoiceArchive() {}

    static void extractTar(InputStream in, File destDir, AtomicBoolean cancel) throws IOException {
        if (!destDir.isDirectory() && !destDir.mkdirs()) throw new IOException("dossier");
        final String root = destDir.getCanonicalPath();
        final byte[] h = new byte[BLOCK];
        String longName = null;   // en-tête GNU « L » : le nom du fichier suivant
        String paxPath = null;    // en-tête pax « x » : idem
        long total = 0;
        while (true) {
            if (cancel.get()) throw new ModelDownloader.CancelledException();
            if (!readBlock(in, h)) break;
            if (isZero(h)) break;  // fin d'archive
            final long size = parseSize(h);
            if (size < 0) throw new IOException("taille illisible");
            final char type = h[156] == 0 ? '0' : (char) h[156];
            if (type == 'L') {
                longName = cString(readData(in, size), 0, (int) size);
                skipPadding(in, size);
                continue;
            }
            if (type == 'x') {
                paxPath = paxPath(readData(in, size), (int) size);
                skipPadding(in, size);
                continue;
            }
            if (type == 'g' || type == 'K') {  // en-têtes globaux / lien long : sans objet
                skipFully(in, size);
                skipPadding(in, size);
                continue;
            }
            String name = cString(h, 0, 100);
            final String prefix = cString(h, 345, 155);
            if (!prefix.isEmpty() && isUstar(h)) name = prefix + "/" + name;
            if (longName != null) {
                name = longName;
                longName = null;
            }
            if (paxPath != null) {
                name = paxPath;
                paxPath = null;
            }
            if (type == '5' || name.endsWith("/")) {
                resolve(root, name).mkdirs();
                continue;
            }
            if (type != '0') {  // lien, périphérique, fifo : jamais écrits
                skipFully(in, size);
                skipPadding(in, size);
                continue;
            }
            total += size;
            if (total > MAX_TOTAL_BYTES) throw new IOException("archive trop volumineuse");
            final File out = resolve(root, name);
            final File parent = out.getParentFile();
            if (parent != null && !parent.isDirectory() && !parent.mkdirs()) throw new IOException("dossier");
            copy(in, out, size, cancel);
            skipPadding(in, size);
        }
    }

    /** Un nom d'archive devient un fichier DANS le dossier, ou une erreur. */
    static File resolve(String canonicalRoot, String name) throws IOException {
        String n = name;
        while (n.startsWith("./")) n = n.substring(2);
        if (n.isEmpty() || n.startsWith("/") || n.indexOf('\0') >= 0) throw new IOException("chemin refusé : " + name);
        for (String part : n.split("/")) {
            if (part.equals("..")) throw new IOException("chemin refusé : " + name);
        }
        final File f = new File(canonicalRoot, n);
        final String cp = f.getCanonicalPath();
        if (!cp.equals(canonicalRoot) && !cp.startsWith(canonicalRoot + File.separator)) {
            throw new IOException("chemin refusé : " + name);
        }
        return f;
    }

    private static void copy(InputStream in, File out, long size, AtomicBoolean cancel) throws IOException {
        final byte[] buf = new byte[64 * 1024];
        long left = size;
        try (FileOutputStream os = new FileOutputStream(out)) {
            while (left > 0) {
                if (cancel.get()) throw new ModelDownloader.CancelledException();
                final int n = in.read(buf, 0, (int) Math.min(buf.length, left));
                if (n < 0) throw new IOException("archive tronquée");
                os.write(buf, 0, n);
                left -= n;
            }
        }
    }

    private static boolean readBlock(InputStream in, byte[] b) throws IOException {
        int off = 0;
        while (off < b.length) {
            final int n = in.read(b, off, b.length - off);
            if (n < 0) {
                if (off == 0) return false;
                throw new IOException("archive tronquée");
            }
            off += n;
        }
        return true;
    }

    private static byte[] readData(InputStream in, long size) throws IOException {
        if (size > 1024 * 1024) throw new IOException("en-tête démesuré");
        final byte[] b = new byte[(int) size];
        int off = 0;
        while (off < b.length) {
            final int n = in.read(b, off, b.length - off);
            if (n < 0) throw new IOException("archive tronquée");
            off += n;
        }
        return b;
    }

    private static void skipFully(InputStream in, long n) throws IOException {
        long left = n;
        final byte[] buf = new byte[8192];
        while (left > 0) {
            final int r = in.read(buf, 0, (int) Math.min(buf.length, left));
            if (r < 0) throw new IOException("archive tronquée");
            left -= r;
        }
    }

    private static void skipPadding(InputStream in, long size) throws IOException {
        final long rest = size % BLOCK;
        if (rest != 0) skipFully(in, BLOCK - rest);
    }

    private static boolean isZero(byte[] b) {
        for (byte x : b) if (x != 0) return false;
        return true;
    }

    private static boolean isUstar(byte[] h) {
        return h[257] == 'u' && h[258] == 's' && h[259] == 't' && h[260] == 'a' && h[261] == 'r';
    }

    private static String cString(byte[] b, int off, int len) {
        int end = off;
        while (end < off + len && end < b.length && b[end] != 0) end++;
        return new String(b, off, end - off, StandardCharsets.UTF_8);
    }

    /** Taille en octal ASCII, ou en base 256 (bit de poids fort levé) pour les très gros fichiers. */
    private static long parseSize(byte[] h) {
        if ((h[124] & 0x80) != 0) {
            long v = h[124] & 0x7f;
            for (int i = 125; i < 136; i++) v = (v << 8) | (h[i] & 0xff);
            return v;
        }
        long v = 0;
        for (int i = 124; i < 136; i++) {
            final byte c = h[i];
            if (c == 0 || c == ' ') {
                if (v == 0 && c == ' ') continue;
                break;
            }
            if (c < '0' || c > '7') return -1;
            v = (v << 3) | (c - '0');
        }
        return v;
    }

    /** Dans un en-tête pax, des lignes « longueur clé=valeur\n » : on ne garde que « path ». */
    private static String paxPath(byte[] data, int len) {
        int i = 0;
        while (i < len) {
            int sp = i;
            while (sp < len && data[sp] != ' ') sp++;
            if (sp >= len) break;
            int recLen;
            try {
                recLen = Integer.parseInt(new String(data, i, sp - i, StandardCharsets.US_ASCII));
            } catch (NumberFormatException e) {
                break;
            }
            if (recLen <= 0 || i + recLen > len) break;
            final String rec = new String(data, sp + 1, i + recLen - sp - 2, StandardCharsets.UTF_8);
            if (rec.startsWith("path=")) return rec.substring(5);
            i += recLen;
        }
        return null;
    }
}
