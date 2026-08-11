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
     * <p>Aucun coût réseau ajouté : loadFeeds() (index.html) revérifie
     * lui-même l'âge du dernier chargement et ne fait rien si le seuil n'est
     * pas atteint — l'appeler à chaque retour au premier plan est donc sans
     * effet la plupart du temps. Les appels concurrents avec les deux autres
     * déclencheurs JS sont sans risque : loadFeeds() s'auto-annule via
     * loadSeq (voir index.html).
     *
     * <p>try/catch côté JS : le tout premier onResume() peut survenir avant
     * que la WebView n'ait fini de charger index.html, où feedLoadStarted
     * n'existe pas encore.
     */
    private static final String RESUME_JS =
        "(function(){try{"
            + "if(typeof feedLoadStarted!==\"undefined\"&&feedLoadStarted"
            + "&&typeof loadFeeds===\"function\")loadFeeds();"
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
