package eu.lielu.news;

import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.provider.DocumentsContract;

import androidx.annotation.NonNull;
import androidx.work.Constraints;
import androidx.work.ExistingPeriodicWorkPolicy;
import androidx.work.PeriodicWorkRequest;
import androidx.work.WorkManager;
import androidx.work.Worker;
import androidx.work.WorkerParameters;

import java.io.IOException;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.TimeUnit;

/**
 * Export périodique, APP FERMÉE, de la sauvegarde complète (réglages ET sources, JSON)
 * dans le dossier choisi une fois par l'utilisateur (Storage Access Framework,
 * {@code ACTION_OPEN_DOCUMENT_TREE}) — le pendant automatique des boutons
 * « Exporter tous les réglages » du panneau.
 *
 * <p>Les données vivent dans le localStorage de la WebView, inaccessible d'ici :
 * le web POUSSE donc le contenu déjà sérialisé (voir
 * {@code InAppBrowserPlugin.syncAutoExport}, appelé depuis {@code persistAll}
 * dans index.html) et ce worker se contente de l'écrire. Même principe que
 * {@link NewsCheckWorker} : le natif ne recalcule rien.
 *
 * <p>Chaque passage ÉCRASE les mêmes fichiers (SAF créerait sinon
 * « xxx (1).json » à chaque fois). Un échec est mémorisé, pas rejoué : un
 * dossier perdu demande l'utilisateur, un backoff n'y changerait rien.
 */
public class AutoExportWorker extends Worker {

    static final String PREFS_NAME = "auto_export";
    static final String KEY_ENABLED = "enabled";
    static final String KEY_FOLDER = "folder";
    static final String KEY_DAYS = "days";
    static final String KEY_SETTINGS = "settings";
    static final String KEY_LAST_AT = "last_at";
    static final String KEY_LAST_OK = "last_ok";

    /** UN seul fichier : la sauvegarde complète (réglages ET sources), la même
     *  que « Exporter tous les réglages », réimportable telle quelle. */
    static final String BACKUP_NAME = "swipernews-sauvegarde.json";

    private static final String WORK_NAME = "auto-export";

    public AutoExportWorker(@NonNull Context context, @NonNull WorkerParameters params) {
        super(context, params);
    }

    /** (Re)programme la répétition ; une fréquence changée remplace la précédente. */
    public static void schedule(Context context, long days) {
        Constraints constraints = new Constraints.Builder().setRequiresBatteryNotLow(true).build();
        PeriodicWorkRequest request = new PeriodicWorkRequest.Builder(
                AutoExportWorker.class, Math.max(1, days), TimeUnit.DAYS)
            .setConstraints(constraints)
            .build();
        WorkManager.getInstance(context)
            .enqueueUniquePeriodicWork(WORK_NAME, ExistingPeriodicWorkPolicy.UPDATE, request);
    }

    public static void cancel(Context context) {
        WorkManager.getInstance(context).cancelUniqueWork(WORK_NAME);
    }

    /** Vrai tant que le système nous garde l'accès en lecture ET écriture au dossier. */
    static boolean hasPermission(Context context, Uri tree) {
        for (android.content.UriPermission p : context.getContentResolver().getPersistedUriPermissions()) {
            if (p.getUri().equals(tree) && p.isReadPermission() && p.isWritePermission()) return true;
        }
        return false;
    }

    static void takePermission(Context context, Uri tree) {
        context.getContentResolver().takePersistableUriPermission(tree,
            Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
    }

    static void releasePermission(Context context, Uri tree) {
        try {
            context.getContentResolver().releasePersistableUriPermission(tree,
                Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
        } catch (SecurityException e) {
            // Déjà révoquée : rien à libérer.
        }
    }

    /** Nom lisible du dossier, ou null s'il n'existe plus. */
    static String displayName(Context context, Uri tree) {
        try {
            Uri doc = DocumentsContract.buildDocumentUriUsingTree(tree, DocumentsContract.getTreeDocumentId(tree));
            try (android.database.Cursor c = context.getContentResolver().query(doc,
                    new String[] {DocumentsContract.Document.COLUMN_DISPLAY_NAME}, null, null, null)) {
                return c != null && c.moveToFirst() ? c.getString(0) : null;
            }
        } catch (Exception e) {
            return null;
        }
    }

    @NonNull
    @Override
    public Result doWork() {
        Context ctx = getApplicationContext();
        SharedPreferences prefs = ctx.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        if (!prefs.getBoolean(KEY_ENABLED, false)) return Result.success();
        String folder = prefs.getString(KEY_FOLDER, null);
        if (folder == null) return Result.success();

        boolean ok;
        try {
            Uri tree = Uri.parse(folder);
            if (!hasPermission(ctx, tree)) {
                ok = false;
            } else {
                String settings = prefs.getString(KEY_SETTINGS, null);
                // Rien poussé par le web (app jamais ouverte depuis l'activation) :
                // écrire un fichier vide écraserait une bonne sauvegarde.
                if (settings == null) return Result.success();
                write(ctx, tree, BACKUP_NAME, "application/json", settings);
                ok = true;
            }
        } catch (Exception e) {
            ok = false;
        }
        prefs.edit().putLong(KEY_LAST_AT, System.currentTimeMillis()).putBoolean(KEY_LAST_OK, ok).apply();
        return Result.success();
    }

    /** Écrit {@code name} dans le dossier, en réutilisant le fichier existant. */
    private static void write(Context ctx, Uri tree, String name, String mime, String content) throws IOException {
        android.content.ContentResolver resolver = ctx.getContentResolver();
        String treeDocId = DocumentsContract.getTreeDocumentId(tree);
        Uri children = DocumentsContract.buildChildDocumentsUriUsingTree(tree, treeDocId);
        Uri target = null;
        try (android.database.Cursor c = resolver.query(children, new String[] {
                DocumentsContract.Document.COLUMN_DOCUMENT_ID,
                DocumentsContract.Document.COLUMN_DISPLAY_NAME}, null, null, null)) {
            while (c != null && c.moveToNext()) {
                if (name.equals(c.getString(1))) {
                    target = DocumentsContract.buildDocumentUriUsingTree(tree, c.getString(0));
                    break;
                }
            }
        }
        if (target == null) {
            Uri parent = DocumentsContract.buildDocumentUriUsingTree(tree, treeDocId);
            target = DocumentsContract.createDocument(resolver, parent, mime, name);
        }
        if (target == null) throw new IOException("création impossible : " + name);
        // "wt" : tronquer, sinon un contenu plus court laisse la queue de l'ancien.
        try (OutputStream os = resolver.openOutputStream(target, "wt")) {
            if (os == null) throw new IOException("écriture impossible : " + name);
            os.write(content.getBytes(StandardCharsets.UTF_8));
        }
    }
}
