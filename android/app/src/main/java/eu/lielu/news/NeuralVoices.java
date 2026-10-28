package eu.lielu.news;

import android.content.Context;
import android.os.Handler;
import android.os.Looper;

import com.k2fsa.sherpa.onnx.OfflineTts;
import com.k2fsa.sherpa.onnx.OfflineTtsConfig;

import org.apache.commons.compress.compressors.bzip2.BZip2CompressorInputStream;

import java.io.BufferedInputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * Les voix neuronales hors ligne : lesquelles existent, lesquelles sont
 * installées, comment les obtenir — même esprit que {@link SummaryModelStore},
 * dont elle reprend le téléchargement ({@link ModelDownloader}).
 *
 * <p>Rien n'est embarqué dans l'APK (hormis le moteur) et rien ne se télécharge
 * sans que l'utilisateur l'ait demandé : c'est le SEUL appel réseau lié à la
 * voix. Une fois installée, la voix tourne entièrement sur l'appareil.
 *
 * <p>Modèles Piper convertis pour sherpa-onnx (publiés dans la version
 * « tts-models » de k2-fsa/sherpa-onnx). L'URL de cette version n'est pas
 * immuable, d'où la taille ET le SHA-256 épinglés ici : un fichier remplacé en
 * amont est refusé, jamais installé.
 *
 * <p>Licences, à garder en tête et à citer dans l'interface :
 * <ul>
 *   <li>Siwis : CC BY 4.0, University of Edinburgh (obligation d'attribution) ;</li>
 *   <li>UPMC (Jessica, Pierre) : CC BY-SA 4.0, voir marytts/upmc-pierre-data ;</li>
 *   <li>espeak-ng, livré avec chaque modèle : GPL-3.0, comme ce dépôt.</li>
 * </ul>
 * Les rappels reviennent sur le fil principal. Une seule opération à la fois.
 */
final class NeuralVoices {

    /** Un fichier à télécharger : le modèle d'une ou plusieurs voix. */
    static final class Archive {
        final String id;
        final String url;
        final long size;
        final String sha256;
        final String dirName;
        final String modelFile;

        Archive(String id, String url, long size, String sha256, String dirName, String modelFile) {
            this.id = id;
            this.url = url;
            this.size = size;
            this.sha256 = sha256;
            this.dirName = dirName;
            this.modelFile = modelFile;
        }
    }

    /** Un locuteur d'un modèle : {@code sid} est son numéro DANS le modèle. */
    static final class Voice {
        final String id;
        final Archive archive;
        final int sid;

        Voice(String id, Archive archive, int sid) {
            this.id = id;
            this.archive = archive;
            this.sid = sid;
        }
    }

    private static final String BASE =
        "https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/";

    static final Archive SIWIS = new Archive("siwis",
        BASE + "vits-piper-fr_FR-siwis-medium.tar.bz2", 67_207_459L,
        "375909aa30842b3a4efa10b1beb1d761af792960ae6873b4d53889f96c66195b",
        "vits-piper-fr_FR-siwis-medium", "fr_FR-siwis-medium.onnx");

    static final Archive UPMC = new Archive("upmc",
        BASE + "vits-piper-fr_FR-upmc-medium.tar.bz2", 80_422_639L,
        "e9830a331a16f6cc5ef3116a287065e015d3495c3f56b974889a266da7f89a7f",
        "vits-piper-fr_FR-upmc-medium", "fr_FR-upmc-medium.onnx");

    static final Archive[] ARCHIVES = {SIWIS, UPMC};

    /** Numéros de locuteur lus dans le fr_FR-upmc-medium.onnx.json : jessica 0, pierre 1. */
    static final Voice[] VOICES = {
        new Voice("siwis", SIWIS, 0),
        new Voice("jessica", UPMC, 0),
        new Voice("pierre", UPMC, 1),
    };

    static Voice voice(String id) {
        for (Voice v : VOICES) if (v.id.equals(id)) return v;
        return null;
    }

    static Archive archive(String id) {
        for (Archive a : ARCHIVES) if (a.id.equals(id)) return a;
        return null;
    }

    static final int ERR_SPACE = 1;
    static final int ERR_NETWORK = 2;
    static final int ERR_INVALID = 3;
    static final int ERR_BUSY = 4;

    interface Listener {
        void onProgress(long done, long total);

        void onDone();

        void onCancelled();

        void onError(int code);
    }

    private static final String OK_MARKER = ".ok";
    /** Place libre à garder en plus de l'archive et de son contenu. */
    private static final long SPACE_MARGIN = 64L * 1024 * 1024;

    private final File dir;
    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private final Handler main = new Handler(Looper.getMainLooper());
    private final AtomicBoolean cancel = new AtomicBoolean();
    private volatile boolean busy;

    NeuralVoices(Context ctx) {
        dir = new File(ctx.getApplicationContext().getFilesDir(), "voices");
    }

    File modelDir(Archive a) {
        return new File(dir, a.dirName);
    }

    /** Installée = extraite en entier ET marquée, jamais « à moitié ». */
    boolean isInstalled(Archive a) {
        final File d = modelDir(a);
        return new File(d, OK_MARKER).isFile() && new File(d, a.modelFile).isFile();
    }

    long partialBytes(Archive a) {
        final File p = part(a);
        return p.isFile() ? Math.min(p.length(), a.size) : 0;
    }

    boolean isBusy() {
        return busy;
    }

    void cancel() {
        cancel.set(true);
    }

    void remove(Archive a) {
        if (busy) return;
        deleteTree(modelDir(a));
        part(a).delete();
    }

    void download(final Archive a, final Listener l) {
        if (busy) {
            l.onError(ERR_BUSY);
            return;
        }
        busy = true;
        cancel.set(false);
        worker.execute(() -> {
            final File tar = new File(dir, a.dirName + ".tar.bz2");
            final File tmp = new File(dir, a.dirName + ".tmp");
            try {
                if (!dir.isDirectory() && !dir.mkdirs()) throw new IOException("dossier");
                // L'archive, puis son contenu : les deux coexistent un instant.
                final long need = (a.size - partialBytes(a)) + 2 * a.size + SPACE_MARGIN;
                if (dir.getUsableSpace() < need) {
                    fail(l, ERR_SPACE);
                    return;
                }
                ModelDownloader.download(a.url, part(a), tar, a.size, a.sha256,
                    (done, total) -> main.post(() -> l.onProgress(done, total)), cancel, false);
                deleteTree(tmp);
                try (InputStream raw = new BufferedInputStream(new FileInputStream(tar), 64 * 1024);
                     InputStream tarStream = new BZip2CompressorInputStream(raw)) {
                    VoiceArchive.extractTar(tarStream, tmp, cancel);
                }
                // L'archive contient UN dossier portant le nom du modèle.
                final File inner = new File(tmp, a.dirName);
                if (!new File(inner, a.modelFile).isFile()
                    || !new File(inner, "tokens.txt").isFile()
                    || !new File(inner, "espeak-ng-data").isDirectory()) {
                    throw new IOException("contenu incomplet");
                }
                if (!new File(inner, OK_MARKER).createNewFile()) throw new IOException("marqueur");
                final File dest = modelDir(a);
                deleteTree(dest);
                if (!inner.renameTo(dest)) throw new IOException("installation impossible");
                deleteTree(tmp);
                tar.delete();
                finish(l::onDone);
            } catch (ModelDownloader.CancelledException e) {
                deleteTree(tmp);
                finish(l::onCancelled);
            } catch (IOException e) {
                deleteTree(tmp);
                final String msg = String.valueOf(e.getMessage());
                // « somme », « contenu », « refusé »… : le fichier est mauvais, pas le réseau.
                final boolean bad = msg.contains("somme") || msg.contains("contenu")
                    || msg.contains("refusé") || msg.contains("tronquée") || msg.contains("trop");
                fail(l, bad ? ERR_INVALID : ERR_NETWORK);
            } catch (RuntimeException e) {
                deleteTree(tmp);
                fail(l, ERR_INVALID);  // bzip2 corrompu : l'archive était pourtant la bonne
            }
        });
    }

    /** Charge le moteur d'une voix installée. Lourd (~1 à 3 s) : jamais sur le fil principal. */
    OfflineTts load(Voice v) {
        final File d = modelDir(v.archive);
        final OfflineTtsConfig c = new OfflineTtsConfig();
        c.model.vits.model = new File(d, v.archive.modelFile).getAbsolutePath();
        c.model.vits.tokens = new File(d, "tokens.txt").getAbsolutePath();
        c.model.vits.dataDir = new File(d, "espeak-ng-data").getAbsolutePath();
        // Deux fils : au-delà, les gros cœurs d'un SoC hétérogène attendent les petits.
        c.model.numThreads = 2;
        return new OfflineTts(c);
    }

    private File part(Archive a) {
        return new File(dir, a.dirName + ".tar.bz2.part");
    }

    private void fail(Listener l, int code) {
        finish(() -> l.onError(code));
    }

    private void finish(Runnable r) {
        busy = false;
        main.post(r);
    }

    private static void deleteTree(File f) {
        if (!f.exists()) return;
        final File[] kids = f.isDirectory() ? f.listFiles() : null;
        if (kids != null) for (File k : kids) deleteTree(k);
        f.delete();
    }
}
