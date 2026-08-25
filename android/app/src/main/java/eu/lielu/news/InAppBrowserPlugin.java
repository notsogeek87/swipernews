package eu.lielu.news;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.os.Build;

import androidx.activity.result.ActivityResult;

import java.io.File;
import java.io.IOException;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Pont JS → natif du navigateur intégré.
 *
 * <p>Côté web, {@code index.html} appelle
 * {@code Capacitor.Plugins.InAppBrowser.open({url, title})} : c'est le seul
 * point d'entrée. Hors app packagée le plugin n'existe pas, et le lien garde
 * son comportement de navigateur (target=_blank) — voir {@code openArticle}.
 */
@CapacitorPlugin(name = "InAppBrowser")
public class InAppBrowserPlugin extends Plugin {

    @PluginMethod
    public void open(PluginCall call) {
        String url = call.getString("url");
        if (!InAppBrowserActivity.isWebUrl(url)) {
            call.reject("URL invalide");
            return;
        }
        Activity activity = getActivity();
        Intent intent = new Intent(activity, InAppBrowserActivity.class);
        intent.putExtra(InAppBrowserActivity.EXTRA_URL, url);
        intent.putExtra(InAppBrowserActivity.EXTRA_TITLE, call.getString("title", ""));
        // Réglage porté par le web (localStorage) et transmis à chaque ouverture :
        // le natif ne garde aucun état de préférence de son côté.
        intent.putExtra(InAppBrowserActivity.EXTRA_HIDE_CMP,
            Boolean.TRUE.equals(call.getBoolean("hideCmp", Boolean.TRUE)));
        // Blocage des pubs : FALSE par défaut, contrairement aux bandeaux — il
        // s'active sciemment (voir adsPref dans index.html).
        intent.putExtra(InAppBrowserActivity.EXTRA_BLOCK_ADS,
            Boolean.TRUE.equals(call.getBoolean("blockAds", Boolean.FALSE)));
        intent.putExtra(InAppBrowserActivity.EXTRA_READER,
            Boolean.TRUE.equals(call.getBoolean("reader", Boolean.FALSE)));
        // Habillage du mode lecture (taille du texte, fond). Deux chaînes courtes,
        // validées côté activité : le natif ne fait que les relayer au script.
        intent.putExtra(InAppBrowserActivity.EXTRA_READER_SIZE, call.getString("readerSize", "m"));
        intent.putExtra(InAppBrowserActivity.EXTRA_READER_THEME, call.getString("readerTheme", "dark"));
        activity.startActivity(intent);
        // API 34+ : l'animation est déclarée par l'activité entrante elle-même.
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            activity.overridePendingTransition(R.anim.reader_in, R.anim.reader_hold);
        }
        call.resolve();
    }

    /**
     * Feuille de partage du système : celle du téléphone, avec ses applications.
     *
     * <p>La WebView d'Android n'implémente pas {@code navigator.share} — dans
     * l'APK, le partage retombait donc sur le menu de repli d'{@code index.html},
     * une grille de cinq services web codés en dur. C'est pourtant la seule
     * plateforme où l'appareil sait faire mieux : {@code ACTION_SEND} propose
     * tout ce qui est installé, dans l'ordre des habitudes de l'utilisateur.
     */
    @PluginMethod
    public void share(PluginCall call) {
        String text = call.getString("text", "");
        String title = call.getString("title", "");
        if (text == null || text.trim().isEmpty()) {
            call.reject("rien à partager");
            return;
        }
        Activity activity = getActivity();
        if (activity == null) {
            call.reject("activité indisponible");
            return;
        }
        Intent send = new Intent(Intent.ACTION_SEND);
        send.setType("text/plain");
        // EXTRA_SUBJECT : l'objet du courriel, ignoré par les messageries.
        if (title != null && !title.isEmpty()) send.putExtra(Intent.EXTRA_SUBJECT, title);
        send.putExtra(Intent.EXTRA_TEXT, text);
        try {
            activity.startActivity(
                Intent.createChooser(send, activity.getString(R.string.share_chooser)));
        } catch (ActivityNotFoundException e) {
            call.reject("aucune application de partage");   // le web reprend la main
            return;
        }
        call.resolve();
    }

    /**
     * Enregistre un fichier via le sélecteur système (Storage Access Framework).
     *
     * <p>L'export des sources (OPML, JSON) reposait sur un {@code <a download>}
     * et une URL {@code blob:}. Ça marche dans un navigateur ; pas ici. La
     * WebView d'Android n'implémente pas l'attribut {@code download}, ne sait
     * pas naviguer vers une URL {@code blob:}, et Capacitor s'en lave
     * explicitement les mains ({@code Bridge.launchIntent} rend {@code false}
     * pour les schémas {@code data} et {@code blob}). Sans {@code DownloadListener}
     * sur la WebView du pont — il n'y en a que sur celle du lecteur d'articles —
     * le clic ne produisait donc rien du tout, et le toast « Sources exportées »
     * mentait.
     *
     * <p>{@code ACTION_CREATE_DOCUMENT} — pas {@code ACTION_SEND} : la première
     * version passait par une feuille de PARTAGE (fichier écrit dans le cache de
     * l'app, exposé via {@code FileProvider}), qui propose des applications à qui
     * ENVOYER le fichier mais n'enregistre nulle part par elle-même — exactement
     * le symptôme remonté (« impossible de vraiment l'enregistrer », selon les
     * apps installées, jamais un simple choix de dossier). Le sélecteur SAF est le
     * vrai dialogue « Enregistrer » du système : Téléchargements, stockage de
     * l'appareil, Drive…, et l'écriture se fait par flux directement dans l'URI
     * choisie, sans rien laisser sur le disque de l'app.
     */
    @PluginMethod
    public void saveFile(PluginCall call) {
        String name = call.getString("name");
        String data = call.getString("data");
        String mime = call.getString("mime", "application/octet-stream");
        if (name == null || data == null || name.trim().isEmpty()) {
            call.reject("fichier vide");
            return;
        }
        // Le nom vient du web : n'en garder que la dernière composante, pour
        // qu'un « ../ » ne puisse pas désigner un fichier hors du dossier.
        name = new File(name).getName();
        Activity activity = getActivity();
        if (activity == null) {
            call.reject("activité indisponible");
            return;
        }
        Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType(mime);
        intent.putExtra(Intent.EXTRA_TITLE, name);
        try {
            startActivityForResult(call, intent, "handleSaveFileResult");
        } catch (ActivityNotFoundException e) {
            call.reject("aucune application pour enregistrer le fichier");
        }
    }

    /** Callback de {@link #saveFile}, une fois l'emplacement choisi (ou l'annulation). */
    @ActivityCallback
    private void handleSaveFileResult(PluginCall call, ActivityResult result) {
        if (call == null) return;
        if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null
            || result.getData().getData() == null) {
            call.reject("annulé");
            return;
        }
        String data = call.getString("data");
        try (OutputStream os = getContext().getContentResolver()
                .openOutputStream(result.getData().getData())) {
            if (os == null) {
                call.reject("écriture impossible");
                return;
            }
            os.write(data.getBytes(StandardCharsets.UTF_8));
            call.resolve();
        } catch (IOException e) {
            String msg = e.getMessage();
            call.reject(msg == null ? "écriture impossible" : msg);
        }
    }

    /**
     * Télécharge une liste de blocage et remplace le cache local.
     *
     * <p>Sur un fil séparé : la liste pèse plus d'un mégaoctet et le pont
     * Capacitor s'exécute sur le fil principal — la télécharger là gèlerait le
     * fil pendant tout le transfert.
     */
    @PluginMethod
    public void syncBlocklist(PluginCall call) {
        String url = call.getString("url");
        new Thread(() -> {
            try {
                int count = BlocklistStore.sync(getContext(), url);
                JSObject res = new JSObject();
                res.put("count", count);
                call.resolve(res);
            } catch (Exception e) {
                String msg = e.getMessage();
                call.reject(msg == null ? "téléchargement impossible" : msg);
            }
        }, "blocklist-sync").start();
    }

    /** Revient à la seule liste intégrée. */
    @PluginMethod
    public void clearBlocklist(PluginCall call) {
        if (BlocklistStore.clear(getContext())) call.resolve();
        else call.reject("cache non supprimable");
    }

    /**
     * Hauteur, en px CSS, de ce que le système dessine PAR-DESSUS le haut de la
     * WebView : barre d'état et poinçon/encoche de caméra.
     *
     * <p>Pourquoi le natif et pas {@code env(safe-area-inset-top)} : sur une
     * WebView Android qui s'étend sous les barres système (bord à bord, imposé
     * depuis {@code targetSdk 35}), cet inset CSS ne décrit que la découpe
     * d'écran, et plusieurs versions de WebView le rapportent tout simplement à
     * zéro. Le haut de la barre d'outils se retrouve alors sous le poinçon —
     * qui, centré, tombe pile sur un bouton.
     *
     * <p>La valeur rendue est un CHEVAUCHEMENT, jamais l'inset brut : on
     * retranche la position à l'écran de la WebView. Si une couche quelconque
     * (Capacitor, un thème, une future version d'Android) a déjà décalé la
     * WebView sous la barre d'état, la réponse est 0 et le web ne réserve rien —
     * sans quoi on compterait la marge deux fois, et la barre descendrait d'une
     * hauteur de barre d'état pour rien.
     *
     * <p>Lu sur le fil principal (accès à une vue), et rendu en px CSS : avec
     * {@code width=device-width, initial-scale=1}, 1 px CSS = 1 dp.
     */
    @PluginMethod
    public void systemInsets(final PluginCall call) {
        final Activity activity = getActivity();
        if (activity == null) {
            call.reject("pas d'activité");
            return;
        }
        activity.runOnUiThread(() -> {
            JSObject res = new JSObject();
            res.put("top", topOverlapDp(activity));
            call.resolve(res);
        });
    }

    private int topOverlapDp(Activity activity) {
        try {
            android.view.View view = getBridge() != null ? getBridge().getWebView() : null;
            if (view == null) view = activity.getWindow().getDecorView();
            android.view.WindowInsets insets = view.getRootWindowInsets();
            if (insets == null) return 0;
            int top;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                top = insets.getInsets(
                    android.view.WindowInsets.Type.statusBars()
                        | android.view.WindowInsets.Type.displayCutout()).top;
            } else {
                top = insets.getSystemWindowInsetTop();
            }
            int[] pos = new int[2];
            view.getLocationOnScreen(pos);
            int overlap = Math.max(0, top - Math.max(0, pos[1]));
            float density = activity.getResources().getDisplayMetrics().density;
            if (density <= 0) return 0;
            return Math.round(overlap / density);
        } catch (Exception e) {
            return 0;   // aucune raison de faire échouer le fil pour une marge
        }
    }
}
