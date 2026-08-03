package eu.lielu.news;

import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.graphics.Bitmap;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.text.TextUtils;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.CookieManager;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.ImageButton;
import android.widget.ProgressBar;
import android.widget.TextView;
import android.widget.Toast;

import androidx.activity.OnBackPressedCallback;
import androidx.appcompat.app.AppCompatActivity;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import androidx.webkit.WebSettingsCompat;
import androidx.webkit.WebViewFeature;

import java.io.BufferedReader;
import java.io.ByteArrayInputStream;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.util.Collections;
import java.util.Set;

/**
 * Navigateur intégré de l'app packagée.
 *
 * <p>Sans lui, « Lire l'article » / « Découvrir » quittait SwiperNews pour
 * Chrome : l'utilisateur sortait du fil, et revenir demandait un aller-retour
 * par le multitâche. Ici l'article s'ouvre dans une activité maison — même fond
 * que le fil, même barre de progression bicolore — et le retour ramène
 * exactement à la carte quittée, sans recharger la WebView principale.
 *
 * <p>Volontairement une WebView maison plutôt qu'un <i>Custom Tab</i> : ce
 * dernier impose l'habillage de Chrome (barre d'URL claire, menu du navigateur)
 * et ajoute une dépendance {@code androidx.browser}. Ici tout l'habillage est
 * celui de l'app, et rien n'est ajouté au paquet que du code de ce dépôt.
 *
 * <p>Lecture immersive : la barre s'efface dès qu'on descend dans l'article et
 * revient au premier geste vers le haut — comme la barre du fil, qui se masque
 * pendant le swipe. La barre d'état d'Android suit le même sort, il ne reste
 * alors que le texte à l'écran.
 */
public class InAppBrowserActivity extends AppCompatActivity {

    public static final String EXTRA_URL = "eu.lielu.news.reader.URL";
    public static final String EXTRA_TITLE = "eu.lielu.news.reader.TITLE";
    public static final String EXTRA_HIDE_CMP = "eu.lielu.news.reader.HIDE_CMP";
    public static final String EXTRA_BLOCK_ADS = "eu.lielu.news.reader.BLOCK_ADS";
    public static final String EXTRA_READER = "eu.lielu.news.reader.READER_MODE";
    public static final String EXTRA_READER_SIZE = "eu.lielu.news.reader.READER_SIZE";
    public static final String EXTRA_READER_THEME = "eu.lielu.news.reader.READER_THEME";

    /** Réponse vide renvoyée aux requêtes bloquées (null = « charge normalement »). */
    private static final String BLOCKED_MIME = "text/plain";

    private ReaderWebView web;
    private ProgressBar progress;
    private TextView titleView;
    private TextView hostView;
    private View errorView;
    private View barWrap;
    private WindowInsetsControllerCompat insetsController;

    /** Dernière URL affichée : sert au partage et au repli « navigateur système ». */
    private String currentUrl = "";

    /** Titre fourni par la carte : évite une barre vide le temps du chargement. */
    private String cardTitle = "";

    /** Masquer les bandeaux de consentement (choix de l'utilisateur, voir res/raw/reader_cmp.js). */
    private boolean hideCmp = true;

    /** Bloquer publicités et traceurs (choix de l'utilisateur). */
    private boolean blockAds = true;

    /** Mode lecture : ne garder que le titre, le texte et les images. */
    private boolean readerOn;
    private ImageButton readerBtn;

    /**
     * Habillage du mode lecture, choisi côté web et transmis à l'ouverture :
     * taille du texte (s/m/l/xl) et fond (dark/sepia/light). Comme le reste des
     * préférences, rien n'est conservé ici — ces deux champs ne vivent que le
     * temps de l'activité, et repartent du localStorage à la prochaine ouverture.
     */
    private String readerSize = "m";
    private String readerTheme = "dark";

    /**
     * Voile posé sur la WebView le temps que le mode lecture s'applique.
     *
     * <p>L'extraction ne peut avoir lieu qu'une fois le DOM complet (plus tôt,
     * l'article serait tronqué) : la page du site est donc forcément peinte
     * avant. Sans ce voile, on voyait le site en clair pendant une fraction de
     * seconde puis la bascule — l'effet le plus visible du mode lecture était
     * son propre retard. On masque, on transforme, on révèle.
     */
    private final Handler revealHandler = new Handler(Looper.getMainLooper());

    /** Filet : une page qui ne finit jamais de charger ne doit pas rester noire. */
    private static final long REVEAL_TIMEOUT_MS = 6000;
    private final Runnable revealTask = this::revealContent;

    /** Scripts d'habillage, lus une fois depuis res/raw. */
    private String cmpScript;
    private String adsScript;
    private String readScript;

    /**
     * Domaines bloqués, chargés une fois avant le premier chargement de page.
     * volatile : {@code shouldInterceptRequest} est appelé depuis un autre fil
     * que celui qui construit l'ensemble.
     */
    private volatile Set<String> blockedHosts = Collections.emptySet();

    /** Hauteur du bloc barre + jauge, connue seulement après la mise en page. */
    private int barHeight;

    private boolean barShown = true;

    /** Marges horizontales/basse dues aux barres système, à conserver sur la WebView. */
    private int insetLeft, insetRight, insetBottom;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        Intent intent = getIntent();
        String url = intent != null ? intent.getStringExtra(EXTRA_URL) : null;
        if (!isWebUrl(url)) {   // rien à afficher : on ne laisse pas une coquille vide
            finish();
            return;
        }
        currentUrl = url;
        cardTitle = intent.getStringExtra(EXTRA_TITLE);
        if (cardTitle == null) cardTitle = "";
        hideCmp = intent.getBooleanExtra(EXTRA_HIDE_CMP, true);
        // false par défaut : le blocage s'active sciemment côté réglages, il ne
        // doit pas s'appliquer parce qu'un appelant a oublié de le préciser.
        blockAds = intent.getBooleanExtra(EXTRA_BLOCK_ADS, false);
        readerOn = intent.getBooleanExtra(EXTRA_READER, false);
        readerSize = oneOf(intent.getStringExtra(EXTRA_READER_SIZE), "m", "s", "m", "l", "xl");
        readerTheme = oneOf(intent.getStringExtra(EXTRA_READER_THEME), "dark", "dark", "sepia", "light");
        // Liste intégrée + liste téléchargée si l'utilisateur en a choisi une.
        if (blockAds) blockedHosts = BlocklistStore.load(this);

        // API 34+ : l'animation d'ouverture/fermeture se déclare ici (côté activité
        // entrante). En dessous, c'est overridePendingTransition, appelé par
        // InAppBrowserPlugin à l'ouverture et par finish() à la fermeture.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            overrideActivityTransition(OVERRIDE_TRANSITION_OPEN, R.anim.reader_in, R.anim.reader_hold);
            overrideActivityTransition(OVERRIDE_TRANSITION_CLOSE, R.anim.reader_hold, R.anim.reader_out);
        }

        setContentView(R.layout.activity_reader);
        // Bord à bord sur toutes les versions (Android 15 l'impose de toute façon
        // avec targetSdk 35+) : les encoches sont gérées à la main juste après,
        // au lieu de dépendre du comportement par défaut, qui change selon l'API.
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);

        titleView = findViewById(R.id.reader_title);
        hostView = findViewById(R.id.reader_host);
        progress = findViewById(R.id.reader_progress);
        errorView = findViewById(R.id.reader_error);
        web = findViewById(R.id.reader_web);
        barWrap = findViewById(R.id.reader_barwrap);

        final View root = findViewById(R.id.reader_root);
        insetsController = WindowCompat.getInsetsController(getWindow(), root);
        // La barre d'état revient d'un glissement depuis le haut, sans forcer à
        // remonter dans l'article.
        insetsController.setSystemBarsBehavior(
            WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);

        ViewCompat.setOnApplyWindowInsetsListener(root, (v, insets) -> {
            // getInsetsIgnoringVisibility, et non getInsets : escamoter la barre
            // d'état change sinon les marges, donc la taille de la zone de rendu,
            // donc la mise en page du site — à chaque geste. Ici les marges
            // restent celles de « barres visibles », quoi qu'il arrive à l'écran.
            Insets s = insets.getInsetsIgnoringVisibility(WindowInsetsCompat.Type.systemBars());
            Insets cut = insets.getInsets(WindowInsetsCompat.Type.displayCutout());
            insetLeft = Math.max(s.left, cut.left);
            insetRight = Math.max(s.right, cut.right);
            insetBottom = s.bottom;
            barWrap.setPadding(insetLeft, Math.max(s.top, cut.top), insetRight, 0);
            applyWebPadding();
            return insets;
        });

        // La hauteur du bloc barre + jauge n'est connue qu'une fois mesuré ; elle
        // devient la marge haute de la WebView, pour que l'article commence sous
        // la barre et non derrière.
        barWrap.addOnLayoutChangeListener((v, l, t, r, b, ol, ot, or, ob) -> {
            int h = b - t;
            if (h > 0 && h != barHeight) {
                barHeight = h;
                applyWebPadding();
                if (!barShown) barWrap.setTranslationY(-barHeight);
            }
        });

        titleView.setText(cardTitle);
        hostView.setText(prettyHost(url));

        readerBtn = findViewById(R.id.reader_readmode);
        readerBtn.setOnClickListener(v -> toggleReader());
        updateReaderIcon();

        findViewById(R.id.reader_close).setOnClickListener(v -> finish());
        findViewById(R.id.reader_share).setOnClickListener(v -> share());
        findViewById(R.id.reader_external).setOnClickListener(v -> openExternally(Uri.parse(currentUrl)));
        findViewById(R.id.reader_retry).setOnClickListener(v -> {
            hideError();
            web.reload();
        });
        findViewById(R.id.reader_error_external)
            .setOnClickListener(v -> openExternally(Uri.parse(currentUrl)));

        setUpWebView();

        // Retour système : on remonte l'historique de la page avant de fermer —
        // c'est ce qu'attend quelqu'un qui a suivi un lien dans l'article.
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                if (web.canGoBack()) {
                    web.goBack();
                } else {
                    setEnabled(false);   // laisse le comportement par défaut fermer l'activité
                    getOnBackPressedDispatcher().onBackPressed();
                }
            }
        });

        // Avant même le premier octet : ouvrir en mode lecture ne doit jamais
        // laisser entrevoir la page du site.
        if (readerOn) coverContent();
        if (savedInstanceState != null) {
            web.restoreState(savedInstanceState);
        } else {
            web.loadUrl(url);
        }
    }

    /** Marges de la WebView : la barre en haut, les barres système sur les côtés. */
    private void applyWebPadding() {
        if (web == null) return;
        web.setPadding(insetLeft, barHeight, insetRight, insetBottom);
    }

    /* ---------- Barre escamotable ----------
       Même règle que le fil : on lit, la barre s'efface ; on revient vers le
       haut, elle réapparaît. Elle coulisse (translationY) sans changer la taille
       de la WebView, sinon le site referait sa mise en page à chaque geste. */

    private void onWebScroll(int y, int dy) {
        if (barHeight <= 0) return;
        if (y <= barHeight / 2) {   // en haut de l'article : barre toujours là
            showBar();
        } else if (dy > 6) {        // seuil : absorbe le tremblement et le rebond
            hideBar();
        } else if (dy < -6) {
            showBar();
        }
    }

    private void showBar() {
        if (barShown) return;
        barShown = true;
        barWrap.animate().translationY(0).setDuration(180).start();
        if (insetsController != null) insetsController.show(WindowInsetsCompat.Type.statusBars());
    }

    private void hideBar() {
        if (!barShown) return;
        barShown = false;
        barWrap.animate().translationY(-barHeight).setDuration(180).start();
        // L'heure et la batterie partent avec la barre : plus rien que l'article.
        if (insetsController != null) insetsController.hide(WindowInsetsCompat.Type.statusBars());
    }

    /* ---------- Bandeaux de consentement ----------
       Le script (res/raw/reader_cmp.js) MASQUE sans jamais accepter : ne pas
       répondre vaut refus, cliquer « Tout accepter » à la place de
       l'utilisateur serait l'inverse de ce qu'il demande en activant l'option.
       Injecté à plusieurs moments car les CMP arrivent souvent après la page ;
       le script est idempotent. */

    /* ---------- Mode lecture ----------
       Le script (res/raw/reader_read.js) remplace la page par le seul article :
       titre, texte, images. On ne peut pas « défaire » cette transformation —
       la page d'origine a été jetée — donc revenir à la page normale passe par
       un rechargement, ce qui est aussi le plus honnête : on réaffiche
       exactement ce que le site sert. */

    private void toggleReader() {
        readerOn = !readerOn;
        updateReaderIcon();
        applyReaderColors();
        // Pas de voile ici : la page est déjà affichée, la transformation est
        // immédiate. Le voile ne sert qu'au chargement, où elle vient après.
        if (readerOn) injectReadScript();
        else web.reload();
    }

    /**
     * Fond de la WebView et assombrissement automatique, selon le mode en cours.
     *
     * <p>Le fond évite l'éclair blanc avant le premier rendu : il doit donc être
     * celui de la page à venir — sombre par défaut, mais crème quand le mode
     * lecture est demandé en sépia ou en clair.
     *
     * <p>L'assombrissement algorithmique de la WebView est le pendant : il rend
     * lisibles les sites qui n'ont pas de thème sombre, mais repeindrait aussi le
     * fond sépia du mode lecture. On le coupe donc exactement dans ce cas — le
     * {@code color-scheme: only light} de la feuille injectée dit déjà la même
     * chose, mais toutes les versions de WebView n'honorent pas le mot-clé.
     */
    private void applyReaderColors() {
        if (web == null) return;
        boolean lightPage = readerOn && !"dark".equals(readerTheme);
        int bg = "sepia".equals(readerTheme) ? R.color.reader_page_sepia : R.color.reader_page_light;
        web.setBackgroundColor(getResources().getColor(lightPage ? bg : R.color.reader_bg, getTheme()));
        if (WebViewFeature.isFeatureSupported(WebViewFeature.ALGORITHMIC_DARKENING)) {
            WebSettingsCompat.setAlgorithmicDarkeningAllowed(web.getSettings(), !lightPage);
        }
    }

    /** Première valeur admise, sinon le repli : rien d'inconnu n'atteint le script. */
    private static String oneOf(String value, String fallback, String... allowed) {
        if (value != null) {
            for (String a : allowed) if (a.equals(value)) return a;
        }
        return fallback;
    }

    /** Masque la WebView (sans la démonter : elle continue de charger et de rendre). */
    private void coverContent() {
        if (web == null) return;
        web.setAlpha(0f);
        revealHandler.removeCallbacks(revealTask);
        revealHandler.postDelayed(revealTask, REVEAL_TIMEOUT_MS);
    }

    private void revealContent() {
        revealHandler.removeCallbacks(revealTask);
        if (web == null || web.getAlpha() >= 1f) return;
        // Court délai : le remplacement du DOM par le script est fait, mais son
        // rendu tient sur la ou les frames suivantes. Révéler dans la même
        // frame laisserait voir une page à moitié peinte.
        web.postDelayed(() -> {
            if (web != null) web.animate().alpha(1f).setDuration(140).start();
        }, 50);
    }

    private void updateReaderIcon() {
        if (readerBtn == null) return;
        readerBtn.setColorFilter(getResources().getColor(
            readerOn ? R.color.reader_accent2 : R.color.reader_ink, getTheme()));
        readerBtn.setSelected(readerOn);
    }

    private void injectReadScript() {
        if (!readerOn || web == null) { revealContent(); return; }
        if (readScript == null) readScript = readRaw(R.raw.reader_read);
        if (readScript == null) { revealContent(); return; }
        // Les deux réglages voyagent dans une variable posée juste avant le script,
        // qui la lit puis retombe sur ses valeurs par défaut si elle manque. Les
        // chaînes sont passées par oneOf() : rien d'autre que les valeurs connues
        // ne peut arriver ici, donc rien à échapper.
        String prelude = "window.__snRead={size:\"" + readerSize + "\",theme:\"" + readerTheme + "\"};\n";
        web.evaluateJavascript(prelude + readScript, value -> web.evaluateJavascript(
            "document.documentElement.dataset.snRead || ''", state -> {
                // Quel que soit le verdict, la page redevient visible ici : c'est
                // le seul endroit qui sait que la transformation est terminée.
                revealContent();
                // evaluateJavascript rend du JSON : la chaîne arrive entre guillemets.
                String s = state == null ? "" : state.replace("\"", "");
                if ("1".equals(s)) return;                       // article simplifié
                if ("auth".equals(s)) {
                    // Page de connexion laissée intacte : ce n'est pas un échec, le
                    // mode reste actif pour l'article qui suit. On le dit quand même,
                    // sinon l'écran non simplifié passe pour un bogue.
                    Toast.makeText(this, R.string.reader_read_auth, Toast.LENGTH_SHORT).show();
                    return;
                }
                // Pas assez de texte (galerie, page d'accueil, application web) :
                // le dire, plutôt que de laisser croire que le bouton n'a pas répondu.
                readerOn = false;
                updateReaderIcon();
                Toast.makeText(this, R.string.reader_read_ko, Toast.LENGTH_SHORT).show();
            }));
    }

    private void injectCmpScript() {
        if (web == null) return;
        if (hideCmp) {
            if (cmpScript == null) cmpScript = readRaw(R.raw.reader_cmp);
            if (cmpScript != null) web.evaluateJavascript(cmpScript, null);
        }
        if (blockAds) {
            if (adsScript == null) adsScript = readRaw(R.raw.reader_ads);
            if (adsScript != null) web.evaluateJavascript(adsScript, null);
        }
    }

    /* ---------- Blocage des publicités et des traceurs ----------
       Deux étages : le réseau (ici) empêche la pub de se charger — moins de
       données, moins de batterie, et le pistage ne part pas — et le cosmétique
       (res/raw/reader_ads.js) referme les trous que laisse un emplacement
       réservé mais resté vide. */

    /**
     * Bloqué si l'hôte, ou l'un de ses domaines parents, figure dans la liste :
     * « doubleclick.net » couvre ainsi « stats.g.doubleclick.net » sans avoir à
     * énumérer les sous-domaines.
     */
    private boolean isBlockedHost(String host) {
        if (host == null) return false;
        Set<String> list = blockedHosts;
        if (list.isEmpty()) return false;
        String h = host.toLowerCase();
        while (true) {
            if (list.contains(h)) return true;
            int dot = h.indexOf('.');
            if (dot < 0) return false;
            h = h.substring(dot + 1);
            if (h.indexOf('.') < 0) return false;   // « net », « com » : on s'arrête
        }
    }

    private String readRaw(int resId) {
        StringBuilder sb = new StringBuilder();
        try (BufferedReader r = new BufferedReader(
                new InputStreamReader(getResources().openRawResource(resId), StandardCharsets.UTF_8))) {
            String line;
            while ((line = r.readLine()) != null) sb.append(line).append('\n');
        } catch (Exception e) {
            return null;   // sans le script, la page reste lisible, bandeau compris
        }
        return sb.toString();
    }

    private void setUpWebView() {
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);          // sans JS, la moitié des sites d'actu est vide
        s.setDomStorageEnabled(true);
        s.setLoadWithOverviewMode(true);
        s.setUseWideViewPort(true);
        s.setSupportZoom(true);
        s.setBuiltInZoomControls(true);
        s.setDisplayZoomControls(false);       // pincer suffit, pas de boutons +/- d'un autre âge
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        s.setAllowFileAccess(false);           // rien à lire sur le disque de l'app
        s.setAllowContentAccess(false);
        // Le « ; wv » de l'agent utilisateur signale une WebView : certains sites
        // servent alors une page dégradée ou refusent la lecture. On l'enlève pour
        // être traité comme le Chrome mobile qu'est déjà le moteur de rendu.
        String ua = s.getUserAgentString();
        if (ua != null) s.setUserAgentString(ua.replace("; wv", ""));

        applyReaderColors();

        // clipToPadding=false : la marge haute n'est pas une zone morte, le texte
        // la traverse en défilant et passe sous la barre au lieu d'être coupé.
        web.setClipToPadding(false);
        web.setOnScrollListener(this::onWebScroll);

        web.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView v, WebResourceRequest request) {
                // Appelé sur un fil de fond, pour CHAQUE ressource : on reste sur
                // une poignée de recherches dans un HashSet, rien de plus.
                if (!blockAds || request.isForMainFrame()) return null;
                if (isBlockedHost(request.getUrl().getHost())) {
                    return new WebResourceResponse(BLOCKED_MIME, "utf-8",
                        new ByteArrayInputStream(new byte[0]));
                }
                return null;   // null = charge normalement
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest request) {
                Uri target = request.getUrl();
                if (isWebUrl(target.toString())) return false;   // on reste dans le lecteur
                openExternally(target);   // mailto:, tel:, intent:, market:… → à l'appareil de choisir
                return true;
            }

            @Override
            public void onPageStarted(WebView v, String url, Bitmap favicon) {
                currentUrl = url;
                hostView.setText(prettyHost(url));
                progress.setVisibility(View.VISIBLE);
                showBar();          // nouvelle page : on se resitue avant de replonger
                // En mode lecture, on masque dès le départ : la page du site ne
                // doit pas apparaître le temps que l'extraction ait lieu.
                if (readerOn) coverContent();
                injectCmpScript();  // au plus tôt : le bandeau ne doit pas clignoter
            }

            @Override
            public void onPageFinished(WebView v, String url) {
                currentUrl = url;
                hostView.setText(prettyHost(url));
                progress.setVisibility(View.GONE);
                injectCmpScript();
                // En dernier : le mode lecture remplace la page entière, il n'y
                // aurait plus rien à nettoyer après lui.
                injectReadScript();
            }

            @Override
            public void onReceivedError(WebView v, WebResourceRequest request, WebResourceError error) {
                // Une image ou un traceur qui échoue ne doit pas masquer l'article :
                // seul l'échec de la page elle-même déclenche l'écran d'erreur.
                if (request.isForMainFrame()) showError();
            }
        });

        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onProgressChanged(WebView v, int newProgress) {
                progress.setProgress(newProgress, true);
                progress.setVisibility(newProgress >= 100 ? View.GONE : View.VISIBLE);
                // Les CMP se greffent en cours de chargement : une passe au milieu
                // du parcours les attrape avant qu'ils ne s'affichent.
                if (newProgress >= 35 && newProgress < 100) injectCmpScript();
            }

            @Override
            public void onReceivedTitle(WebView v, String title) {
                if (!TextUtils.isEmpty(title)) titleView.setText(title);
            }
        });

        // Un PDF ou un fichier joint n'a rien à faire dans le lecteur : on passe la
        // main au gestionnaire de téléchargement de l'appareil.
        web.setDownloadListener((url, userAgent, contentDisposition, mimetype, contentLength)
            -> openExternally(Uri.parse(url)));
    }

    private void showError() {
        errorView.setVisibility(View.VISIBLE);
        web.setVisibility(View.GONE);
        progress.setVisibility(View.GONE);
        // Le voile du mode lecture n'a plus lieu d'être, et il ne doit pas rester
        // en travers d'un rechargement réussi plus tard.
        revealHandler.removeCallbacks(revealTask);
        web.setAlpha(1f);
        showBar();   // sans la barre, on serait coincé devant l'erreur
    }

    private void hideError() {
        errorView.setVisibility(View.GONE);
        web.setVisibility(View.VISIBLE);
    }

    private void share() {
        String title = titleView.getText() != null ? titleView.getText().toString() : "";
        Intent send = new Intent(Intent.ACTION_SEND);
        send.setType("text/plain");
        send.putExtra(Intent.EXTRA_SUBJECT, title);
        send.putExtra(Intent.EXTRA_TEXT,
            TextUtils.isEmpty(title) ? currentUrl : title + "\n\n" + currentUrl);
        startActivity(Intent.createChooser(send, getString(R.string.reader_share)));
    }

    /** Confie une URL au reste de l'appareil (navigateur système, appli mail…). */
    private void openExternally(Uri uri) {
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, uri));
        } catch (ActivityNotFoundException e) {
            Toast.makeText(this, R.string.reader_no_app, Toast.LENGTH_SHORT).show();
        }
    }

    /** Nom d'hôte sans le « www. » : c'est le repère de confiance affiché sous le titre. */
    private static String prettyHost(String url) {
        if (url == null) return "";
        String host = Uri.parse(url).getHost();
        if (host == null) return "";
        return host.startsWith("www.") ? host.substring(4) : host;
    }

    /** Seuls http(s) sont affichés dans le lecteur ; tout le reste part à l'appareil. */
    static boolean isWebUrl(String url) {
        return url != null && (url.startsWith("https://") || url.startsWith("http://"));
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        super.onSaveInstanceState(outState);
        if (web != null) web.saveState(outState);
    }

    @Override
    protected void onPause() {
        super.onPause();
        if (web != null) web.onPause();   // coupe le son et les minuteurs JS en arrière-plan
        // Écrit les cookies sur disque : sans ce vidage explicite, une connexion
        // à un site sur abonnement peut être perdue si le système récupère le
        // processus, et il faudrait se reconnecter à chaque lecture.
        CookieManager.getInstance().flush();
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (web != null) web.onResume();
    }

    @Override
    public void finish() {
        super.finish();
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            overridePendingTransition(R.anim.reader_hold, R.anim.reader_out);
        }
    }

    @Override
    protected void onDestroy() {
        revealHandler.removeCallbacks(revealTask);   // rien ne doit survivre à l'activité
        if (web != null) {
            web.stopLoading();
            // Détacher avant destroy() : une WebView détruite encore attachée à sa
            // hiérarchie fait planter le prochain dessin.
            ViewGroup parent = (ViewGroup) web.getParent();
            if (parent != null) parent.removeView(web);
            web.destroy();
            web = null;
        }
        super.onDestroy();
    }
}
