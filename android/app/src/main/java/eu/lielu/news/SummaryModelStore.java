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
     * LFM2 de Liquid AI, quantifié en Q4_K_M. Choisis après comparaison sur un
     * même article français (tests faits avec llama.cpp, 4 cœurs x86, 800 jetons
     * de prompt) : LFM2-700M lit le prompt à 560 jetons/s et écrit à 38 jetons/s,
     * soit plus vite que Qwen2.5-0.5B (350 / 36) et près de deux fois plus vite que
     * Qwen2.5-1.5B (250 / 20), pour un résumé plus complet et fidèle que les deux.
     * LFM2-350M est le plus rapide (950 / 71) mais invente un détail : c'est
     * l'option « ultra léger », pas la recommandée. Qwen3 raisonne à voix haute
     * (balises think) et Granite 4.0 350M boucle : écartés.
     *
     * Licence « LFM Open License v1.0 » : libre, y compris en redistribution, tant
     * qu'on n'en fait pas un usage COMMERCIAL au-delà de 10 M$ de chiffre
     * d'affaires annuel. Rien n'est embarqué dans l'APK : le fichier est téléchargé
     * à la demande de l'utilisateur. Tailles et sommes lues sur Hugging Face.
     */
    static final Model[] MODELS = {
        new Model("lfm2-700m", "LFM2 700M (recommandé)",
            "LFM2-700M-Q4_K_M.gguf",
            "https://huggingface.co/LiquidAI/LFM2-700M-GGUF/resolve/"
                + "fd39e80d7a5ac61494ffff577e61bbbfddbd0d02/LFM2-700M-Q4_K_M.gguf",
            468_624_320L,
            "684e8406dc13321452b3f6aeca432776e2a6a7e1ad6c23f7887b8fe3efbe2efa"),
        new Model("lfm2-350m", "LFM2 350M (ultra léger)",
            "LFM2-350M-Q4_K_M.gguf",
            "https://huggingface.co/LiquidAI/LFM2-350M-GGUF/resolve/"
                + "8fdc9d526b7ed346b19257551b05816c7912ecc2/LFM2-350M-Q4_K_M.gguf",
            229_309_376L,
            "a4d000c7064bd3b2e42c6845836286a899a4e79cf1791da1a6797b58d575957d"),
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

    /** Supprime tous les modèles installés et les téléchargements entamés. */
    void deleteAll() {
        if (busy) return;
        for (Model m : MODELS) delete(m);
        deleteImported();
    }

    /** Libère le fil de travail ; l'opération en cours, annulée, finit seule. */
    void close() {
        cancel();
        worker.shutdown();
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
