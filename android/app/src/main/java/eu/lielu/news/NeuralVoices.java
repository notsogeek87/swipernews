package eu.lielu.news;

import android.content.Context;
import android.os.Handler;
import android.os.Looper;

import com.k2fsa.sherpa.onnx.OfflineTts;
import com.k2fsa.sherpa.onnx.OfflineTtsConfig;
import com.k2fsa.sherpa.onnx.OfflineTtsModelConfig;
import com.k2fsa.sherpa.onnx.OfflineTtsVitsModelConfig;

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
 *   <li>Siwis (Piper) : CC BY 4.0, University of Edinburgh (obligation d'attribution) ;</li>
 *   <li>Tom (Piper) : AGPL-3.0, voir git.bksp.space/Tjiho/French-tts-model-piper ;</li>
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

        /** Ce qu'une archive complète contient : un dossier n'est « installé » qu'avec tout. */
        boolean complete(File dir) {
            return new File(dir, modelFile).isFile()
                && new File(dir, "tokens.txt").isFile()
                && new File(dir, "espeak-ng-data").isDirectory();
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

    /** Piper, 44,1 kHz (les autres voix sont à 22,05 kHz). */
    static final Archive TOM = new Archive("tom",
        BASE + "vits-piper-fr_FR-tom-medium.tar.bz2", 67_202_955L,
        "3d8258ef8466b5d5f2cc46c06e1415d3d01c9cbaeed8b6d5b3d152073672472c",
        "vits-piper-fr_FR-tom-medium", "fr_FR-tom-medium.onnx");

    static final Archive[] ARCHIVES = {SIWIS, TOM};

    static final Voice[] VOICES = {
        new Voice("siwis", SIWIS, 0),
        new Voice("tom", TOM, 0),
    };

    /** Dossiers d'une voix retirée du catalogue (UPMC : Jessica et Pierre ; Kokoro ; Supertonic ; Tjiho 1 à 3) : à libérer, 80 à 180 Mo. */
    private static final String[] LEGACY_DIRS = {"vits-piper-fr_FR-upmc-medium", "kokoro-int8-multi-lang-v1_0",
        "sherpa-onnx-supertonic-3-tts-int8-2026-05-11", "vits-piper-fr_FR-tjiho-model1",
        "vits-piper-fr_FR-tjiho-model2", "vits-piper-fr_FR-tjiho-model3"};

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

    /** Identifie l'installation de l'APK : un repère écrit par une AUTRE version ne compte plus. */
    private final String build;

    NeuralVoices(Context ctx) {
        String b = "";
        try {
            Context c = ctx.getApplicationContext();
            b = String.valueOf(c.getPackageManager().getPackageInfo(c.getPackageName(), 0).lastUpdateTime);
        } catch (Exception ignore) { }
        build = b;
        dir = new File(ctx.getApplicationContext().getFilesDir(), "voices");
    }

    File modelDir(Archive a) {
        return new File(dir, a.dirName);
    }

    /** Installée = extraite en entier ET marquée, jamais « à moitié ». */
    boolean isInstalled(Archive a) {
        final File d = modelDir(a);
        return new File(d, OK_MARKER).isFile() && a.complete(d);
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
        for (Voice v : VOICES) if (v.archive == a) leverRepere(v);   // retirer puis réinstaller = nouvelle chance
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
                if (!a.complete(inner)) throw new IOException("contenu incomplet");
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
        final OfflineTtsModelConfig.Builder m = OfflineTtsModelConfig.builder();
        m.setVits(OfflineTtsVitsModelConfig.builder()
            .setModel(new File(d, v.archive.modelFile).getAbsolutePath())
            .setTokens(new File(d, "tokens.txt").getAbsolutePath())
            .setDataDir(new File(d, "espeak-ng-data").getAbsolutePath())
            .build());
        // Deux fils : au-delà, les gros cœurs d'un SoC hétérogène attendent les petits.
        m.setNumThreads(2);
        return new OfflineTts(OfflineTtsConfig.builder().setModel(m.build()).build());
    }

    /**
     * Garde anti-boucle de plantage : un abandon NATIF (exit, SIGSEGV) ne s'attrape pas en Java. Le
     * repère est posé avant le chargement et levé à la première phrase réussie ; s'il survit, la voix a
     * tué le processus et n'est plus proposée tant qu'on ne l'a pas retirée puis réinstallée.
     */
    private File repere(Voice v) { return new File(dir, v.id + ".crash"); }

    boolean aPlante(Voice v) {
        final File f = repere(v);
        if (!f.exists()) return false;
        try (java.io.FileInputStream in = new java.io.FileInputStream(f)) {
            final byte[] buf = new byte[64];
            final int n = in.read(buf);
            if (n > 0 && new String(buf, 0, n, java.nio.charset.StandardCharsets.UTF_8).equals(build)) return true;
        } catch (Exception ignore) { }
        f.delete();   // posé par une autre version de l'APK (ou illisible) : correctif possible, on réessaie
        return false;
    }

    void poserRepere(Voice v) {
        try (java.io.FileOutputStream out = new java.io.FileOutputStream(repere(v))) {
            out.write(build.getBytes(java.nio.charset.StandardCharsets.UTF_8));
        } catch (Exception ignore) { }
    }

    void leverRepere(Voice v) { repere(v).delete(); }

    /** Libère l'espace d'une voix retirée du catalogue (voir {@link #LEGACY_DIRS}). Sans effet pendant une opération. */
    void purgeLegacy() {
        if (busy) return;
        for (String name : LEGACY_DIRS) {
            deleteTree(new File(dir, name));
            deleteTree(new File(dir, name + ".tmp"));
            new File(dir, name + ".tar.bz2").delete();
            new File(dir, name + ".tar.bz2.part").delete();
        }
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
