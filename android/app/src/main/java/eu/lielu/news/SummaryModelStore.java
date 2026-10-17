package eu.lielu.news;

import android.content.Context;
import android.net.Uri;
import android.os.Handler;
import android.os.Looper;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * Le modèle de résumé : lequel existe, lequel est installé, comment l'obtenir.
 *
 * Deux voies, toutes deux déclenchées par l'utilisateur et jamais en tâche de
 * fond :
 * <ul>
 *   <li>TÉLÉCHARGER un des modèles de {@link #MODELS} (reprenable, vérifié par
 *       taille et SHA-256, voir {@link ModelDownloader}) ;</li>
 *   <li>IMPORTER un fichier GGUF déjà sur l'appareil, par le sélecteur de
 *       fichiers du système — pour qui ne veut aucune connexion du tout.</li>
 * </ul>
 * Le téléchargement est le SEUL appel réseau lié au résumé : une fois le
 * fichier en place, tout se passe sur l'appareil.
 *
 * Les URL sont épinglées sur un COMMIT du dépôt du modèle (pas sur « main ») :
 * un fichier remplacé en amont ne peut pas changer ce que l'app installe, et la
 * somme de contrôle reste vraie.
 *
 * Les rappels reviennent sur le fil principal. Une seule opération à la fois.
 */
final class SummaryModelStore {

    static final class Model {
        final String id;
        final String label;
        final String fileName;
        final String url;
        final long size;
        final String sha256;

        Model(String id, String label, String fileName, String url, long size, String sha256) {
            this.id = id;
            this.label = label;
            this.fileName = fileName;
            this.url = url;
            this.size = size;
            this.sha256 = sha256;
        }
    }

    /**
     * Qwen2.5 Instruct, licence Apache-2.0 (utilisable et redistribuable, compatible
     * avec la GPL-3.0 du dépôt). Quantifié en Q4_K_M : le meilleur compromis
     * taille/qualité pour un téléphone. Tailles et sommes lues sur Hugging Face.
     */
    static final Model[] MODELS = {
        new Model("qwen25-1.5b", "Qwen2.5 1.5B (recommandé)",
            "qwen2.5-1.5b-instruct-q4_k_m.gguf",
            "https://huggingface.co/Qwen/Qwen2.5-1.5B-Instruct-GGUF/resolve/"
                + "91cad51170dc346986eccefdc2dd33a9da36ead9/qwen2.5-1.5b-instruct-q4_k_m.gguf",
            1_117_320_736L,
            "6a1a2eb6d15622bf3c96857206351ba97e1af16c30d7a74ee38970e434e9407e"),
        new Model("qwen25-0.5b", "Qwen2.5 0.5B (léger, moins précis)",
            "qwen2.5-0.5b-instruct-q4_k_m.gguf",
            "https://huggingface.co/Qwen/Qwen2.5-0.5B-Instruct-GGUF/resolve/"
                + "9217f5db79a29953eb74d5343926648285ec7e67/qwen2.5-0.5b-instruct-q4_k_m.gguf",
            491_400_032L,
            "74a4da8c9fdbcd15bd1f6d01d621410d31c6fc00986f5eb687824e7b93d7a9db"),
    };

    static final int ERR_SPACE = 1;    // pas assez de place sur l'appareil
    static final int ERR_NETWORK = 2;  // coupure, serveur injoignable
    static final int ERR_INVALID = 3;  // fichier tronqué, altéré, ou pas un GGUF
    static final int ERR_BUSY = 4;     // une autre opération est déjà en cours

    interface Listener {
        void onProgress(long done, long total);

        void onDone();

        void onCancelled();

        void onError(int code);
    }

    private static final String IMPORTED_NAME = "imported.gguf";
    /** Marge de place libre à garder au-delà du fichier lui-même. */
    private static final long SPACE_MARGIN = 64L * 1024 * 1024;
    /** Un fichier importé plus gros que ça n'est de toute façon pas pour un téléphone. */
    private static final long MAX_IMPORT_BYTES = 8L * 1024 * 1024 * 1024;

    private final File dir;
    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private final Handler main = new Handler(Looper.getMainLooper());
    private final AtomicBoolean cancel = new AtomicBoolean();
    private volatile boolean busy;

    SummaryModelStore(Context ctx) {
        dir = new File(ctx.getApplicationContext().getFilesDir(), "summary");
    }

    /** Le fichier à donner au moteur : le premier installé, l'importé en dernier. */
    File activeFile() {
        for (Model m : MODELS) {
            File f = file(m);
            if (ModelDownloader.isGguf(f)) return f;
        }
        File imported = new File(dir, IMPORTED_NAME);
        return ModelDownloader.isGguf(imported) ? imported : null;
    }

    boolean isInstalled(Model m) {
        return ModelDownloader.isGguf(file(m));
    }

    /** Octets déjà reçus d'un téléchargement interrompu (0 s'il n'y en a pas). */
    long partialBytes(Model m) {
        File p = part(m);
        return p.isFile() ? Math.min(p.length(), m.size) : 0;
    }

    boolean isBusy() {
        return busy;
    }

    /** Interrompt l'opération en cours ; un téléchargement garde son avancement. */
    void cancel() {
        cancel.set(true);
    }

    void download(Model m, Listener l) {
        if (!begin(l)) return;
        worker.execute(() -> {
            try {
                if (!dir.isDirectory() && !dir.mkdirs()) throw new IOException("dossier");
                final long remaining = m.size - partialBytes(m);
                if (dir.getUsableSpace() < remaining + SPACE_MARGIN) {
                    fail(l, ERR_SPACE);
                    return;
                }
                ModelDownloader.download(m.url, part(m), file(m), m.size, m.sha256,
                    (done, total) -> main.post(() -> l.onProgress(done, total)), cancel);
                finish(() -> l.onDone());
            } catch (ModelDownloader.CancelledException e) {
                finish(() -> l.onCancelled());
            } catch (IOException e) {
                final String msg = String.valueOf(e.getMessage());
                // « somme » / « GGUF » : le contenu est mauvais, pas le réseau.
                fail(l, msg.contains("somme") || msg.contains("GGUF") ? ERR_INVALID : ERR_NETWORK);
            }
        });
    }

    /** Copie un GGUF choisi par l'utilisateur (sélecteur de fichiers) dans l'espace de l'app. */
    void importFrom(Context ctx, Uri uri, Listener l) {
        if (!begin(l)) return;
        final Context app = ctx.getApplicationContext();
        worker.execute(() -> {
            File tmp = new File(dir, IMPORTED_NAME + ".part");
            try {
                if (!dir.isDirectory() && !dir.mkdirs()) throw new IOException("dossier");
                try (InputStream in = app.getContentResolver().openInputStream(uri);
                     FileOutputStream out = new FileOutputStream(tmp)) {
                    if (in == null) throw new IOException("illisible");
                    final byte[] buf = new byte[64 * 1024];
                    long total = 0;
                    int n;
                    while ((n = in.read(buf)) >= 0) {
                        if (cancel.get()) throw new ModelDownloader.CancelledException();
                        total += n;
                        if (total > MAX_IMPORT_BYTES) throw new IOException("GGUF trop gros");
                        if (dir.getUsableSpace() < SPACE_MARGIN) {
                            tmp.delete();
                            fail(l, ERR_SPACE);
                            return;
                        }
                        out.write(buf, 0, n);
                        final long done = total;
                        main.post(() -> l.onProgress(done, 0));
                    }
                    out.getFD().sync();
                }
                File dest = new File(dir, IMPORTED_NAME);
                if (!ModelDownloader.isGguf(tmp)) {
                    tmp.delete();
                    fail(l, ERR_INVALID);
                    return;
                }
                if (dest.exists() && !dest.delete()) throw new IOException("remplacement");
                if (!tmp.renameTo(dest)) throw new IOException("installation");
                finish(() -> l.onDone());
            } catch (ModelDownloader.CancelledException e) {
                tmp.delete();
                finish(() -> l.onCancelled());
            } catch (IOException | SecurityException e) {
                tmp.delete();
                fail(l, ERR_INVALID);
            }
        });
    }

    /** Supprime le modèle et tout téléchargement entamé. Ne touche pas pendant une opération. */
    void delete(Model m) {
        if (busy) return;
        file(m).delete();
        part(m).delete();
    }

    void deleteImported() {
        if (busy) return;
        new File(dir, IMPORTED_NAME).delete();
    }

    private boolean begin(Listener l) {
        synchronized (this) {
            if (busy) {
                main.post(() -> l.onError(ERR_BUSY));
                return false;
            }
            busy = true;
            cancel.set(false);
            return true;
        }
    }

    private void finish(Runnable r) {
        busy = false;
        main.post(r);
    }

    private void fail(Listener l, int code) {
        finish(() -> l.onError(code));
    }

    private File file(Model m) {
        return new File(dir, m.fileName);
    }

    private File part(Model m) {
        return new File(dir, m.fileName + ".part");
    }
}
