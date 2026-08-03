package eu.lielu.news;

import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.graphics.Bitmap;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.text.TextUtils;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.ProgressBar;
import android.widget.TextView;
import android.widget.Toast;

import androidx.activity.OnBackPressedCallback;
import androidx.appcompat.app.AppCompatActivity;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.webkit.WebSettingsCompat;
import androidx.webkit.WebViewFeature;

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
 */
public class InAppBrowserActivity extends AppCompatActivity {

    public static final String EXTRA_URL = "eu.lielu.news.reader.URL";
    public static final String EXTRA_TITLE = "eu.lielu.news.reader.TITLE";

    private WebView web;
    private ProgressBar progress;
    private TextView titleView;
    private TextView hostView;
    private View errorView;

    /** Dernière URL affichée : sert au partage et au repli « navigateur système ». */
    private String currentUrl = "";

    /** Titre fourni par la carte : évite une barre vide le temps du chargement. */
    private String cardTitle = "";

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

        final View root = findViewById(R.id.reader_root);
        final View bar = findViewById(R.id.reader_bar);
        final View content = findViewById(R.id.reader_content);
        final int barPad = Math.round(4 * getResources().getDisplayMetrics().density);
        ViewCompat.setOnApplyWindowInsetsListener(root, (v, insets) -> {
            Insets s = insets.getInsets(
                WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout());
            // La barre monte jusque sous l'heure/la batterie, le contenu s'arrête
            // au-dessus de la barre de navigation.
            bar.setPadding(s.left + barPad, s.top, s.right + barPad, 0);
            content.setPadding(s.left, 0, s.right, s.bottom);
            return insets;
        });

        titleView = findViewById(R.id.reader_title);
        hostView = findViewById(R.id.reader_host);
        progress = findViewById(R.id.reader_progress);
        errorView = findViewById(R.id.reader_error);
        web = findViewById(R.id.reader_web);

        titleView.setText(cardTitle);
        hostView.setText(prettyHost(url));

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

        if (savedInstanceState != null) {
            web.restoreState(savedInstanceState);
        } else {
            web.loadUrl(url);
        }
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

        // Le fil est sombre : une page blanche en plein écran pique les yeux. Quand
        // le site déclare un thème sombre (prefers-color-scheme), la WebView le
        // choisit ; sinon elle assombrit elle-même. Le fond de la WebView est déjà
        // à la couleur de l'app, pour éviter l'éclair blanc avant le premier rendu.
        web.setBackgroundColor(getResources().getColor(R.color.reader_bg, getTheme()));
        if (WebViewFeature.isFeatureSupported(WebViewFeature.ALGORITHMIC_DARKENING)) {
            WebSettingsCompat.setAlgorithmicDarkeningAllowed(s, true);
        }

        web.setWebViewClient(new WebViewClient() {
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
            }

            @Override
            public void onPageFinished(WebView v, String url) {
                currentUrl = url;
                hostView.setText(prettyHost(url));
                progress.setVisibility(View.GONE);
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
