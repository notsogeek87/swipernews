package eu.lielu.news;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    /**
     * Relance la vérification de fraîcheur du fil (voir AUTO_RELOAD_MS dans
     * index.html) directement depuis le cycle de vie natif de l'Activity —
     * pas depuis un événement du plugin @capacitor/app ni depuis
     * visibilitychange, tous deux relayés par la WebView et documentés côté
     * web comme « parfois défaillants » selon l'OEM/la gestion batterie du
     * téléphone. onResume() de l'Activity Android, lui, est garanti par le
     * système à chaque retour au premier plan, backgrounded ou non — c'est
     * le signal le plus fiable disponible.
     *
     * <p>On appelle refreshIfStale(), JAMAIS loadFeeds() directement : c'est le
     * point de passage unique des trois déclencheurs automatiques, et lui seul
     * porte la garde « un chargement d'actus est déjà en vol » (voir
     * newsLoadingSeq dans index.html). Sans elle, le tout premier onResume()
     * — qui survient à l'ouverture de l'app, pendant que le chargement de
     * lancement dure encore — repartait de zéro : une seconde génération, donc
     * un second « remonter en tête » quelques secondes après le premier, sur
     * un fil que l'utilisateur avait déjà commencé à parcourir.
     *
     * <p>Aucun coût réseau ajouté : refreshIfStale() ne relaie à loadFeeds()
     * que hors chargement, et loadFeeds() revérifie lui-même l'âge du dernier
     * lot — l'appeler à chaque retour au premier plan est donc sans effet la
     * plupart du temps.
     *
     * <p>try/catch côté JS : le tout premier onResume() peut survenir avant
     * que la WebView n'ait fini de charger index.html, où refreshIfStale
     * n'existe pas encore. La fonction vérifie elle-même feedLoadStarted.
     */
    private static final String RESUME_JS =
        "(function(){try{"
            + "if(typeof refreshIfStale===\"function\")refreshIfStale();"
            + "}catch(e){}})();";

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Avant super.onCreate : c'est lui qui construit le pont et fige la liste
        // des plugins exposés à la WebView.
        registerPlugin(InAppBrowserPlugin.class);
        super.onCreate(savedInstanceState);
    }

    @Override
    public void onResume() {
        super.onResume();
        if (getBridge() != null && getBridge().getWebView() != null) {
            getBridge().getWebView().evaluateJavascript(RESUME_JS, null);
        }
    }
}
