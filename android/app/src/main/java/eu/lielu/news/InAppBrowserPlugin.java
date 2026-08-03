package eu.lielu.news;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.os.Build;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
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
}
