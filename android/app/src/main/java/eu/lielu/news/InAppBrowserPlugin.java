package eu.lielu.news;

import android.app.Activity;
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
        intent.putExtra(InAppBrowserActivity.EXTRA_BLOCK_ADS,
            Boolean.TRUE.equals(call.getBoolean("blockAds", Boolean.TRUE)));
        activity.startActivity(intent);
        // API 34+ : l'animation est déclarée par l'activité entrante elle-même.
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            activity.overridePendingTransition(R.anim.reader_in, R.anim.reader_hold);
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
