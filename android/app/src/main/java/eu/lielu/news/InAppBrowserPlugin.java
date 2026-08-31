package eu.lielu.news;

import android.Manifest;
import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.os.Build;
import android.os.PowerManager;
import android.provider.Settings;

import androidx.activity.result.ActivityResult;

import java.io.File;
import java.io.IOException;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

/**
 * Pont JS → natif du navigateur intégré — et, depuis {@link #syncBackgroundFeeds}
 * et {@link #setBackgroundNotifications}, de la vérification en arrière-plan
 * (voir {@link NewsCheckWorker}). Même plugin, pas un second : les deux
 * partagent déjà le même point d'entrée côté web ({@code Capacitor.Plugins.InAppBrowser}),
 * ouvrir un second plugin pour deux méthodes n'aurait rien apporté.
 *
 * <p>Côté web, {@code index.html} appelle
 * {@code Capacitor.Plugins.InAppBrowser.open({url, title})} : c'est le seul
 * point d'entrée. Hors app packagée le plugin n'existe pas, et le lien garde
 * son comportement de navigateur (target=_blank) — voir {@code openArticle}.
 */
@CapacitorPlugin(name = "InAppBrowser", permissions = {
    @Permission(strings = { Manifest.permission.POST_NOTIFICATIONS }, alias = "notifications")
})
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

    /**
     * Instantané des sources actives que {@link NewsCheckWorker} relira à son
     * prochain réveil : chaque entrée porte l'URL RÉELLEMENT interrogée (déjà
     * résolue côté web par {@code urlDuFlux}, jamais recalculée ici) et le
     * lien de son article le plus récent tel qu'affiché dans le fil — voir
     * {@code backgroundFeedSnapshot()} dans index.html. Appelé après chaque
     * fil renouvelé, et pas seulement à l'activation du réglage : sinon le
     * repère natif resterait celui du jour d'activation pour toujours.
     *
     * <p>Simple écriture, aucun aller-retour attendu par le web au-delà de la
     * confirmation : {@code feeds} est déjà un JSON valide dans la forme que
     * le worker attend, il n'y a rien à transformer.
     */
    @PluginMethod
    public void syncBackgroundFeeds(PluginCall call) {
        JSArray feeds = call.getArray("feeds");
        if (feeds == null) { call.resolve(); return; }
        getContext().getSharedPreferences(NewsCheckWorker.PREFS_NAME, Context.MODE_PRIVATE)
            .edit().putString(NewsCheckWorker.KEY_FEEDS, feeds.toString()).apply();
        call.resolve();
    }

    /**
     * Active ou désactive la vérification en arrière-plan (voir
     * {@code setNotifPref} dans index.html). L'activation seule peut demander
     * la permission système POST_NOTIFICATIONS (Android 13+) — d'où l'aller-
     * retour par {@link #requestPermissionForAlias}, contrairement au reste
     * des réglages du lecteur qui n'écrivent jamais que du localStorage.
     */
    @PluginMethod
    public void setBackgroundNotifications(PluginCall call) {
        boolean enabled = Boolean.TRUE.equals(call.getBoolean("enabled", Boolean.FALSE));
        if (enabled && Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU
            && getPermissionState("notifications") != PermissionState.GRANTED) {
            requestPermissionForAlias("notifications", call, "notificationPermCallback");
            return;
        }
        applyBackgroundNotifications(enabled);
        call.resolve();
    }

    /** Suite de {@link #setBackgroundNotifications} après la réponse au dialogue
     *  système. Un refus n'est PAS une erreur du point de vue du plugin — c'est
     *  un choix légitime — donc jamais {@code call.reject} : le web redescend
     *  sa case à cocher sur "enabled":false dans la réponse résolue. */
    @PermissionCallback
    private void notificationPermCallback(PluginCall call) {
        boolean granted = getPermissionState("notifications") == PermissionState.GRANTED;
        applyBackgroundNotifications(granted);
        JSObject res = new JSObject();
        res.put("enabled", granted);
        call.resolve(res);
    }

    private void applyBackgroundNotifications(boolean enabled) {
        SharedPreferences prefs = getContext()
            .getSharedPreferences(NewsCheckWorker.PREFS_NAME, Context.MODE_PRIVATE);
        prefs.edit().putBoolean(NewsCheckWorker.KEY_ENABLED, enabled).apply();
        if (enabled) NewsCheckWorker.schedule(getContext());
        else NewsCheckWorker.cancel(getContext());
    }

    /** État actuel de l'exemption d'optimisation batterie — interrogé à
     *  l'ouverture des réglages pour savoir si {@link #requestIgnoreBatteryOptimizations}
     *  a encore un sens à proposer (voir batteryHTML côté web). */
    @PluginMethod
    public void isIgnoringBatteryOptimizations(PluginCall call) {
        JSObject res = new JSObject();
        res.put("ignoring", isIgnoringBatteryOptimizationsNow());
        call.resolve(res);
    }

    private boolean isIgnoringBatteryOptimizationsNow() {
        PowerManager pm = (PowerManager) getContext().getSystemService(Context.POWER_SERVICE);
        return pm != null && pm.isIgnoringBatteryOptimizations(getContext().getPackageName());
    }

    /**
     * Demande au système d'exclure SwiperNews de l'optimisation de batterie —
     * seul levier qui améliore VRAIMENT la fiabilité de {@link NewsCheckWorker} :
     * Doze et les économiseurs constructeur retardent (parfois indéfiniment) un
     * réveil {@code WorkManager} périodique tant que cette exemption n'est pas
     * posée, quelle que soit la cadence choisie côté code.
     *
     * <p>Proposé comme un choix explicite dans les réglages, jamais un aller-
     * retour automatique à l'activation des notifs : le dialogue système
     * (« Autoriser [app] à ignorer l'optimisation de la batterie ? ») est
     * intrusif, il ne doit apparaître qu'à une action volontaire.
     *
     * <p>Déjà exempté : on ne redemande rien, {@code call.resolve} tout de
     * suite. Intent absent (certains OEM le retirent) : repli sur l'écran de
     * liste générique ({@code ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS}),
     * qui existe partout — un tour de plus pour l'utilisateur (il doit
     * retrouver SwiperNews dans la liste), jamais un échec sec. Ce repli ne
     * peut pas suivre le choix de l'utilisateur (pas de résultat exploitable
     * pour un écran de LISTE) : la réponse reflète l'état au moment de l'appel,
     * un second appui après coup corrige l'affichage.
     */
    @PluginMethod
    public void requestIgnoreBatteryOptimizations(PluginCall call) {
        if (isIgnoringBatteryOptimizationsNow()) {
            JSObject res = new JSObject();
            res.put("ignoring", true);
            call.resolve(res);
            return;
        }
        Activity activity = getActivity();
        if (activity == null) {
            call.reject("activité indisponible");
            return;
        }
        Intent intent = new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS,
            Uri.parse("package:" + getContext().getPackageName()));
        try {
            startActivityForResult(call, intent, "handleBatteryResult");
        } catch (ActivityNotFoundException e) {
            try {
                activity.startActivity(new Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS));
            } catch (ActivityNotFoundException e2) {
                call.reject("réglages indisponibles");
                return;
            }
            JSObject res = new JSObject();
            res.put("ignoring", isIgnoringBatteryOptimizationsNow());
            call.resolve(res);
        }
    }

    /** Callback de {@link #requestIgnoreBatteryOptimizations} : le code de
     *  retour du dialogue système n'est pas fiable (varie selon les versions),
     *  donc on se fie uniquement à l'état RÉEL relu après coup. */
    @ActivityCallback
    private void handleBatteryResult(PluginCall call, ActivityResult result) {
        if (call == null) return;
        JSObject res = new JSObject();
        res.put("ignoring", isIgnoringBatteryOptimizationsNow());
        call.resolve(res);
    }
}
