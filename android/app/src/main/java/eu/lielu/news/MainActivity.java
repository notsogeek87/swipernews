package eu.lielu.news;

import android.os.Bundle;

import androidx.activity.OnBackPressedCallback;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    /**
     * Relance la vérification de fraîcheur du fil (voir AUTO_RELOAD_MS dans
     * index.html) ET rappelle la barre du haut, directement depuis le cycle de
     * vie natif de l'Activity — pas depuis un événement du plugin
     * @capacitor/app ni depuis visibilitychange, tous deux relayés par la
     * WebView et documentés côté web comme « parfois défaillants » selon
     * l'OEM/la gestion batterie du téléphone. onResume() de l'Activity
     * Android, lui, est garanti par le système à chaque retour au premier
     * plan, backgrounded ou non — c'est le signal le plus fiable disponible.
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
     * <p>reprendreBarre() AVANT refreshIfStale() (voir son commentaire côté
     * web) : la minuterie qui efface la barre du haut au bout de 3 s
     * (armerRetraitBarre) continue de compter en arrière-plan pendant que
     * l'app est masquée, et Android suspend souvent l'exécution JS d'une
     * WebView non visible — son échéance se retrouve donc largement dépassée
     * au retour, et hideTop() part dans la foulée si rien ne la réarme. Sans
     * cet appel, l'app rouvrait directement sur une carte SANS aucune barre
     * visible (ni marque, ni filtres, ni bouton menu), comme si elle n'avait
     * jamais existé — constaté par un utilisateur.
     *
     * <p>reprendreBarre() plutôt que showTop() tout court : elle remet en plus
     * le compte à rebours en attente d'un premier geste, sans quoi la barre
     * repartait 3 s après la reprise, pendant que l'utilisateur se repère
     * encore (« j'ouvre, la barre se ferme directement »). Repli sur showTop()
     * si la WebView sert encore une version antérieure d'index.html : le natif
     * et le web se mettent à jour séparément (APK vs Vercel), et un APK neuf
     * ne doit pas perdre le rappel de barre sur un index.html plus ancien.
     *
     * <p>try/catch côté JS : le tout premier onResume() peut survenir avant
     * que la WebView n'ait fini de charger index.html, où refreshIfStale et
     * reprendreBarre n'existent pas encore. La fonction vérifie elle-même
     * feedLoadStarted ; reprendreBarre(), lui, est sans effet indésirable à
     * répéter.
     */
    private static final String RESUME_JS =
        "(function(){try{"
            + "if(typeof reprendreBarre===\"function\")reprendreBarre();"
            + "else if(typeof showTop===\"function\")showTop();"
            + "if(typeof refreshIfStale===\"function\")refreshIfStale();"
            + "}catch(e){}})();";

    /**
     * Message affiché au 1er retour sans panneau ouvert (voir le callback plus
     * bas) — le VRAI toast JS de l'app (voir toast()/T() dans index.html), pas
     * un Toast Android natif : rester cohérent avec le reste de l'interface
     * (style, langue) plutôt qu'ajouter un second système d'avertissement.
     * typeof-guardé comme RESUME_JS : peut s'exécuter avant que ces fonctions
     * n'existent (chargement pas fini) ou après leur destruction (onDestroy en
     * vol) — un appui perdu dans ce cas précis est sans conséquence.
     */
    private static final String BACK_TOAST_JS =
        "(function(){try{"
            + "if(typeof toast===\"function\"&&typeof T===\"function\")toast(T(\"toast.backExit\"));"
            + "}catch(e){}})();";

    /**
     * Fenêtre pendant laquelle un 2e retour confirme la sortie — même ordre de
     * grandeur que le double-appui de resetStats()/delFeed() côté web (voir
     * CLAUDE.md), pour rester cohérent avec les autres confirmations à 2 appuis
     * de l'app.
     */
    private static final long EXIT_CONFIRM_WINDOW_MS = 2000;
    private long backArmedAt = 0;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Avant super.onCreate : c'est lui qui construit le pont et fige la liste
        // des plugins exposés à la WebView.
        registerPlugin(InAppBrowserPlugin.class);
        super.onCreate(savedInstanceState);

        // Cartes vidéo : l'iframe du lecteur est créée PAR SCRIPT au moment de
        // l'appui sur ▶, et l'URL porte autoplay=1. Le « geste utilisateur »
        // d'Android est rattaché au document qui l'a reçu, et ne se propage pas
        // toujours jusqu'à un cadre inséré dans la foulée : la vidéo resterait
        // alors figée sur son poster, sans rien pour la relancer puisque le
        // lecteur occupe toute la carte.
        //
        // Ce n'est PAS une autorisation de lecture automatique : rien dans
        // index.html ne crée d'iframe hors d'un appui explicite — la carte reste
        // une simple miniature tant qu'on ne l'a pas touchée (voir startVideo).
        if (getBridge() != null && getBridge().getWebView() != null) {
            getBridge().getWebView().getSettings().setMediaPlaybackRequiresUserGesture(false);
        }

        // Retour système sans AUCUNE gestion explicite : compter sur le
        // comportement par défaut de Capacitor (aucun écouteur "backButton" côté
        // JS, voir index.html) laissait le retour ne RIEN faire quand aucun
        // panneau n'était ouvert — signalé par un utilisateur (bouton ET geste de
        // retour, aucun panneau ouvert). Repris ici avec le même callback
        // moderne (OnBackPressedCallback) que InAppBrowserActivity, qui lui
        // fonctionnait déjà : c'est ce qui manque au retour prédictif
        // d'Android 13+ pour être délivré à une Activity qui ne l'écoute pas
        // explicitement.
        //
        // Panneau ouvert (réglages, filtre, Articles en mémoire…) : ce sont ses
        // propres history.pushState()/popstate côté JS (pushDialogState, voir
        // index.html) qui gèrent la fermeture — webView.canGoBack() devient vrai
        // tant qu'une de ces entrées est en attente, donc goBack() suffit à la
        // consommer sans rien connaître du panneau lui-même côté natif.
        //
        // Aucun panneau ouvert : double retour pour quitter, comme la plupart
        // des apps Android — le 1er arme une fenêtre de EXIT_CONFIRM_WINDOW_MS
        // et affiche un toast.
        //
        // Le 2e appui appelait initialement setEnabled(false) puis relayait à
        // getOnBackPressedDispatcher().onBackPressed(), en calquant le motif
        // d'InAppBrowserActivity plus haut — MAIS BridgeActivity (Capacitor)
        // surcharge très probablement onBackPressed() avec SA propre logique
        // par défaut (qui ne finish() rien en l'absence d'écouteur "backButton"
        // JS, cf. plus haut) : le relais retombait donc dans le même no-op que
        // le bug d'origine. InAppBrowserActivity, elle, n'a jamais ce problème
        // : elle étend AppCompatActivity, pas BridgeActivity, donc son propre
        // relais retombe sur le vrai finish() par défaut d'une Activity
        // normale. Constaté par un utilisateur : le toast ne s'affichait
        // qu'une fois (setEnabled(false) désactivait le callback pour de bon,
        // aucun 2e cycle possible) et l'app ne quittait JAMAIS, même à 2
        // appuis. On quitte donc nous-mêmes, sans passer par un quelconque
        // relais : moveTaskToBack(true) plutôt que finish(), pour laisser le
        // PROCESSUS vivant (l'app revient donc instantanément au premier plan
        // suivant — cohérent avec la reprise de lecture déjà quasi instantanée
        // du reste de l'app) au lieu de tout détruire et devoir tout
        // recharger.
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                if (getBridge() != null && getBridge().getWebView() != null
                    && getBridge().getWebView().canGoBack()) {
                    getBridge().getWebView().goBack();
                    return;
                }
                long now = System.currentTimeMillis();
                if (now - backArmedAt < EXIT_CONFIRM_WINDOW_MS) {
                    moveTaskToBack(true);
                    return;
                }
                backArmedAt = now;
                if (getBridge() != null && getBridge().getWebView() != null) {
                    getBridge().getWebView().evaluateJavascript(BACK_TOAST_JS, null);
                }
            }
        });
    }

    @Override
    public void onResume() {
        super.onResume();
        if (getBridge() != null && getBridge().getWebView() != null) {
            getBridge().getWebView().evaluateJavascript(RESUME_JS, null);
        }
    }
}
