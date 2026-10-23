package eu.lielu.news;

import android.content.Context;
import android.net.Uri;
import android.text.format.Formatter;
import android.view.View;
import android.webkit.ValueCallback;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.ProgressBar;
import android.widget.TextView;
import android.widget.Toast;

import java.io.File;

/**
 * Le résumé d'un article dans le lecteur : un bouton rond en BAS à droite (là où
 * tombe le pouce) et une feuille qui monte du bas.
 *
 * Le bouton n'existe que quand le mode lecture a abouti : c'est lui qui isole
 * l'article du reste de la page (menus, commentaires, publicités), donc c'est
 * son texte, et lui seul, que le modèle lit.
 *
 * La feuille a six états. Le modèle manque (on propose de le télécharger ou de
 * l'importer), un transfert est en cours, le résumé s'écrit, il est fini, ou
 * quelque chose a échoué. Le texte arrive au fil de l'eau.
 *
 * Tout se passe sur l'appareil. Le seul appel réseau est le téléchargement du
 * modèle, que l'utilisateur déclenche lui-même (voir SummaryModelStore).
 */
final class ReaderSummary {

    interface Host {
        /** Texte de l'article simplifié actuellement affiché ("" si indisponible). */
        void readArticle(ValueCallback<String> callback);

        /** Ouvre le sélecteur de fichiers pour importer un GGUF. */
        void pickModelFile();

        String articleTitle();

        /** « Lire l'article » : la page, jusque-là voilée, devient visible. */
        void revealArticle();

        /** La feuille d'un résumé lancé depuis la carte vient d'être fermée. */
        void onSheetClosed();
    }

    private enum State { IDLE, NEED_MODEL, TRANSFER, WORKING, DONE, ERROR }

    /** Au-delà de cette part de l'écran, le résumé défile plutôt que d'agrandir la feuille. */
    private static final float MAX_TEXT_SCREEN_SHARE = 0.5f;
    /** Un article plus court n'a rien à résumer. */
    private static final int MIN_ARTICLE_CHARS = 200;

    private final Context ctx;
    private final Host host;
    private final View fab;
    private final View panel;
    private final View scrim;
    private final MaxHeightScrollView scroll;
    private final TextView note;
    private final TextView text;
    private final ProgressBar progress;
    private final Button btn1;
    private final Button btn2;
    private final Button btn3;
    private final android.widget.ImageButton listenBtn;
    private final SummarySpeaker speaker;
    private final SummaryModelStore store;
    private SummaryTheme theme;
    /** Suppression du modèle « armée » par un premier appui : le second, dans les 3 s, confirme. */
    private boolean deleteArmed;
    private final Runnable disarmDelete = () -> {
        deleteArmed = false;
        if (this.state == State.DONE || this.state == State.ERROR) refreshDeleteLabel();
    };
    private Summarizer summarizer;   // créé à la première demande : qui ne résume pas ne paie rien

    private State state = State.IDLE;
    private boolean articleReady;
    private boolean destroyed;
    /** Résumé lancé depuis la carte : la feuille s'ouvre seule, et sa fermeture ferme le lecteur. */
    private boolean fromCard;
    private boolean waitingArticle;
    /** Faux pour une vidéo : la transcription est le seul texte, il n'y a pas de page à révéler. */
    private boolean hasPage = true;
    /** Incrémenté à chaque nouvelle demande : le rappel d'une demande dépassée est ignoré. */
    private int session;
    private final int basePanelBottom;
    private final int baseFabBottom;

    ReaderSummary(Context ctx, View root, Host host, String themeSpec) {
        this.ctx = ctx;
        this.host = host;
        fab = root.findViewById(R.id.reader_summary_fab);
        panel = root.findViewById(R.id.reader_summary_panel);
        scrim = root.findViewById(R.id.reader_summary_scrim);
        scroll = root.findViewById(R.id.reader_summary_scroll);
        note = root.findViewById(R.id.reader_summary_note);
        text = root.findViewById(R.id.reader_summary_text);
        progress = root.findViewById(R.id.reader_summary_progress);
        btn1 = root.findViewById(R.id.reader_summary_btn1);
        btn2 = root.findViewById(R.id.reader_summary_btn2);
        btn3 = root.findViewById(R.id.reader_summary_btn3);
        listenBtn = root.findViewById(R.id.reader_summary_listen);
        speaker = new SummarySpeaker(ctx, new SummarySpeaker.Listener() {
            @Override
            public void onFinished() {
                if (!destroyed) refreshListen();
            }

            @Override
            public void onError() {
                if (destroyed) return;
                refreshListen();
                Toast.makeText(ctx, R.string.summary_listen_err, Toast.LENGTH_SHORT).show();
            }
        });
        listenBtn.setOnClickListener(v -> toggleListen());
        store = new SummaryModelStore(ctx);

        basePanelBottom = panel.getPaddingBottom();
        baseFabBottom = ((FrameLayout.LayoutParams) fab.getLayoutParams()).bottomMargin;
        scroll.setMaxHeightPx(Math.round(
            ctx.getResources().getDisplayMetrics().heightPixels * MAX_TEXT_SCREEN_SHARE));

        theme = SummaryTheme.parse(themeSpec, ctx.getResources().getDisplayMetrics().density);
        applyTheme(root, theme);

        fab.setOnClickListener(v -> open());
        scrim.setOnClickListener(v -> close());   // comme les feuilles du fil : toucher à côté referme
        updateFab();
    }

    /**
     * Pose les couleurs de l'habillage actif de l'app sur toute la feuille et son
     * bouton. Aucune n'est dans les ressources : voir SummaryTheme.
     */
    private void applyTheme(View root, SummaryTheme t) {
        panel.setBackground(t.panel());
        root.findViewById(R.id.reader_summary_grip).setBackground(t.grip());
        ((TextView) root.findViewById(R.id.reader_summary_title)).setTextColor(t.ink);
        note.setTextColor(t.ash);
        text.setTextColor(t.ink);
        // La teinte s'applique à l'icône entière : le vecteur est tracé en blanc.
        ((android.widget.ImageButton) fab).setColorFilter(t.ink);
        fab.setBackground(t.fab());
        progress.setProgressDrawable(t.progress());
        progress.setIndeterminateTintList(android.content.res.ColorStateList.valueOf(t.flare));
        btn1.setBackground(t.primaryButton());
        btn2.setBackground(t.secondaryButton());
        btn3.setBackground(t.secondaryButton());
        listenBtn.setColorFilter(t.ink);
        listenBtn.setBackground(t.fab());
        for (Button b : new Button[] { btn1, btn2, btn3 }) b.setTextColor(t.ink);
    }

    /* ---------- Appels de l'activité ---------- */

    /** Le mode lecture a abouti (ou la page a changé) : le bouton apparaît ou disparaît. */
    void setArticleReady(boolean ready) {
        if (articleReady == ready) return;
        articleReady = ready;
        if (ready) warmUp();
        if (ready && fromCard && waitingArticle) {
            waitingArticle = false;
            open();
        }
        if (!ready) {
            // Autre page : le résumé affiché n'est plus celui de ce qu'on lit.
            if (state == State.WORKING) cancelSummary();
            if (state != State.TRANSFER) reset();
            showPanel(false);
        }
        updateFab();
    }

    /**
     * Charge le modèle dès que le résumé devient possible, pour que l'appui n'ait
     * plus à le faire. Seulement si un modèle est déjà installé : qui n'en a pas
     * (ou n'utilise pas le résumé) ne paie ni mémoire ni processeur.
     */
    private void warmUp() {
        if (destroyed || !Summarizer.isAvailable()) return;
        final File model = store.activeFile();
        if (model == null) return;
        if (summarizer == null) summarizer = new Summarizer();
        summarizer.warmUp(model);
    }

    /** La feuille et son voile vont ensemble. */
    private void showPanel(boolean show) {
        final int v = show ? View.VISIBLE : View.GONE;
        if (!show) stopListening();
        scrim.setVisibility(v);
        panel.setVisibility(v);
    }

    boolean isOpen() {
        return panel.getVisibility() == View.VISIBLE;
    }

    void close() {
        if (state == State.WORKING) cancelSummary();   // pas de calcul pour personne
        if (state == State.DONE || state == State.ERROR) reset();
        showPanel(false);
        updateFab();
        if (fromCard) host.onSheetClosed();
    }

    /**
     * Résumé demandé depuis la carte, sans avoir ouvert l'article : la feuille est
     * déjà là pendant que la page se charge en coulisses, et le résumé démarre
     * dès que le mode lecture a isolé le texte (voir setArticleReady).
     */
    void startFromCard(boolean hasPage) {
        fromCard = true;
        this.hasPage = hasPage;
        waitingArticle = true;
        text.setText(R.string.summary_loading_article);
        setNote(ctx.getString(R.string.summary_note_local));
        showProgress(true, 0);
        setButtons(ctx.getString(R.string.summary_close_btn), v -> close(), null, null, null, null);
        showPanel(true);
        updateFab();
    }

    /** « Lire l'article » : on quitte le mode résumé seul, le lecteur ordinaire reprend. */
    private void readFullArticle() {
        fromCard = false;
        close();
        host.revealArticle();
    }

    /** Marge du bas = barre de navigation : ni le bouton ni la feuille ne passent dessous. */
    void setBottomInset(int px) {
        panel.setPadding(panel.getPaddingLeft(), panel.getPaddingTop(),
            panel.getPaddingRight(), basePanelBottom + px);
        FrameLayout.LayoutParams lp = (FrameLayout.LayoutParams) fab.getLayoutParams();
        lp.bottomMargin = baseFabBottom + px;
        fab.setLayoutParams(lp);
    }

    /** Résultat du sélecteur de fichiers (null si l'utilisateur a renoncé). */
    void onModelPicked(Uri uri) {
        if (uri == null || destroyed) return;
        state = State.TRANSFER;
        text.setText("");
        setNote(ctx.getString(R.string.summary_note_copy));
        showProgress(true, 0);
        setButtons(ctx.getString(R.string.summary_cancel_download), v -> store.cancel(), null, null, null, null);
        store.importFrom(ctx, uri, transferListener());
    }

    void destroy() {
        destroyed = true;
        session++;
        store.close();
        if (summarizer != null) summarizer.release();
        speaker.release();
    }

    /* ---------- Ouverture ---------- */

    private void open() {
        if (destroyed) return;
        showPanel(true);
        updateFab();
        if (state == State.TRANSFER || state == State.WORKING || state == State.DONE) return;
        File model = store.activeFile();
        if (model == null) showNeedModel();
        else start(model);
    }

    private void updateFab() {
        fab.setVisibility(articleReady && Summarizer.isAvailable() && !isOpen() && !destroyed && !fromCard
            ? View.VISIBLE : View.GONE);
    }

    /* ---------- Le modèle manque ---------- */

    private void showNeedModel() {
        state = State.NEED_MODEL;
        text.setText(R.string.summary_need_model);
        setNote(ctx.getString(R.string.summary_note_local));
        showProgress(false, 0);
        final SummaryModelStore.Model a = SummaryModelStore.MODELS[0];
        final SummaryModelStore.Model b = SummaryModelStore.MODELS[1];
        setButtons(downloadLabel(a), v -> download(a), downloadLabel(b), v -> download(b),
            ctx.getString(R.string.summary_import), v -> host.pickModelFile());
    }

    private String downloadLabel(SummaryModelStore.Model m) {
        final String size = Formatter.formatShortFileSize(ctx, m.size);
        final long part = store.partialBytes(m);
        if (part > 0) {
            return ctx.getString(R.string.summary_download_resume, m.label, size,
                (int) (part * 100 / m.size));
        }
        return ctx.getString(R.string.summary_download, m.label, size);
    }

    private void download(SummaryModelStore.Model m) {
        state = State.TRANSFER;
        text.setText(ctx.getString(R.string.summary_downloading, m.label));
        setNote(ctx.getString(R.string.summary_note_local));
        showProgress(false, (int) (store.partialBytes(m) * 1000 / m.size));
        setButtons(ctx.getString(R.string.summary_cancel_download), v -> store.cancel(), null, null, null, null);
        store.download(m, transferListener());
    }

    private SummaryModelStore.Listener transferListener() {
        return new SummaryModelStore.Listener() {
            @Override
            public void onProgress(long done, long total) {
                if (destroyed || state != State.TRANSFER) return;
                if (total > 0) {
                    final int permille = (int) (done * 1000 / total);
                    showProgress(false, permille);
                    setNote(ctx.getString(R.string.summary_progress, permille / 10));
                } else {
                    showProgress(true, 0);   // import : taille inconnue
                }
            }

            @Override
            public void onDone() {
                if (destroyed) return;
                final File model = store.activeFile();
                if (model == null) {
                    fail(ctx.getString(R.string.summary_err_invalid));
                } else if (isOpen()) {
                    start(model);
                } else {
                    // Feuille refermée pendant le transfert : on prévient, sans rien lancer.
                    state = State.IDLE;
                    Toast.makeText(ctx, R.string.summary_ready, Toast.LENGTH_LONG).show();
                    if (articleReady) warmUp();
                }
            }

            @Override
            public void onCancelled() {
                if (destroyed) return;
                if (isOpen()) showNeedModel();
                else state = State.IDLE;
            }

            @Override
            public void onError(int code) {
                if (destroyed) return;
                final int msg = code == SummaryModelStore.ERR_SPACE ? R.string.summary_err_space
                    : code == SummaryModelStore.ERR_INVALID ? R.string.summary_err_invalid
                    : R.string.summary_err_net;
                fail(ctx.getString(msg));
            }
        };
    }

    /* ---------- Le résumé ---------- */

    private void start(File model) {
        state = State.WORKING;
        scroll.setFixedHeight(true);   // la feuille ne bouge plus pendant l'écriture
        final int my = ++session;
        text.setText("");
        setNote(ctx.getString(R.string.summary_note_prepare));
        showProgress(true, 0);
        setButtons(ctx.getString(R.string.summary_stop), v -> cancelSummary(), null, null, null, null);
        reserveDoneLayout();
        host.readArticle(raw -> {
            if (my != session || destroyed) return;
            final String article = raw == null ? "" : raw.trim();
            if (article.length() < MIN_ARTICLE_CHARS) {
                fail(ctx.getString(R.string.summary_err_short));
                return;
            }
            if (summarizer == null) summarizer = new Summarizer();
            summarizer.summarize(model, host.articleTitle(), article, "fr", !hasPage, new Summarizer.Listener() {
                private boolean first = true;
                /** Résumé en plusieurs parties. */
                private boolean multi;

                @Override
                public void onPart(int index, int count) {
                    if (my != session || destroyed) return;
                    multi = count > 1;
                    // Tant que le texte n'a pas commencé, la note dit déjà « préparation ».
                    if (multi && index > 0) {
                        setNote(ctx.getString(R.string.summary_note_part, index + 1, count));
                    }
                }

                @Override
                public void onText(String piece) {
                    if (my != session || destroyed) return;
                    if (first) {
                        first = false;
                        setNote(ctx.getString(R.string.summary_note_local));
                    }
                    text.append(piece);
                    // Jamais de défilement automatique : le texte qui arrive s'écrit sous
                    // la fenêtre, et c'est l'utilisateur qui défile s'il le souhaite.
                }

                @Override
                public void onDone(boolean cancelled) {
                    if (my != session || destroyed) return;
                    done();
                }

                @Override
                public void onError(int code) {
                    if (my != session || destroyed) return;
                    final int msg = code == Summarizer.ERR_LOAD ? R.string.summary_err_load
                        : code == Summarizer.ERR_TOO_LONG ? R.string.summary_err_long
                        : code == Summarizer.ERR_UNAVAILABLE ? R.string.summary_err_unavailable
                        : R.string.summary_err_generic;
                    failWithModelOption(ctx.getString(msg), code == Summarizer.ERR_LOAD);
                }
            });
        });
    }

    private void cancelSummary() {
        session++;   // plus aucun rappel de cette demande
        if (summarizer != null) summarizer.cancel();
        if (state == State.WORKING) {
            // Arrêté en cours de route : on garde ce qui est déjà écrit.
            if (text.length() > 0) done();
            else {
                state = State.IDLE;
                scroll.setFixedHeight(false);
                showPanel(false);
                updateFab();
            }
        }
    }

    private void done() {
        state = State.DONE;
        setNote(ctx.getString(R.string.summary_note_local));
        showProgress(false, 0);
        setButtons(ctx.getString(R.string.summary_close_btn), v -> close(),
            fromCard && hasPage ? ctx.getString(R.string.summary_read_article) : null,
            fromCard && hasPage ? v -> readFullArticle() : null,
            ctx.getString(R.string.summary_delete_model), v -> askDeleteModel());
        styleDeleteButton(btn3);
        refreshListen();
        listenBtn.setVisibility(View.VISIBLE);
        // Même emprise que pendant l'écriture : la feuille ne change pas de hauteur à la fin.
        if (btn2.getVisibility() == View.GONE) {
            btn2.setText(" ");
            btn2.setVisibility(View.INVISIBLE);
        }
        progress.setVisibility(View.INVISIBLE);
    }

    /**
     * Pendant l'écriture, on réserve la place de ce qui apparaît à la fin (icône
     * d'écoute, « Lire l'article », « Supprimer le modèle », trait de progression)
     * sans l'afficher : la feuille garde la même hauteur du début à la fin, au lieu
     * de monter d'un coup quand le résumé s'achève.
     */
    private void reserveDoneLayout() {
        listenBtn.setVisibility(View.INVISIBLE);
        btn2.setText(" ");
        btn2.setVisibility(View.INVISIBLE);
        refreshDeleteLabel();
        styleDeleteButton(btn3);
        btn3.setVisibility(View.INVISIBLE);
    }

    /* ---------- Lecture à voix haute (facultative) ---------- */

    private void toggleListen() {
        if (speaker.isSpeaking()) {
            speaker.stop();
        } else {
            speaker.speak(text.getText().toString());
        }
        refreshListen();
    }

    private void stopListening() {
        speaker.stop();
        refreshListen();
    }

    private void refreshListen() {
        final boolean on = speaker.isSpeaking();
        listenBtn.setImageResource(on ? R.drawable.ic_summary_stop : R.drawable.ic_summary_speaker);
        listenBtn.setContentDescription(ctx.getString(on ? R.string.summary_listen_stop : R.string.summary_listen));
    }

    private void fail(String message) {
        failWithModelOption(message, false);
    }

    private void failWithModelOption(String message, boolean offerDelete) {
        state = State.ERROR;
        scroll.setFixedHeight(false);
        text.setText(message);
        setNote(ctx.getString(R.string.summary_note_local));
        showProgress(false, 0);
        setButtons(ctx.getString(R.string.summary_retry), v -> {
                if (store.activeFile() != null) start(store.activeFile());
                else showNeedModel();
            },
            ctx.getString(R.string.summary_close_btn), v -> close(),
            offerDelete ? ctx.getString(R.string.summary_delete_model) : null,
            offerDelete ? v -> askDeleteModel() : null);
        if (offerDelete) styleDeleteButton(btn3);
    }

    /**
     * « Supprimer le modèle » est destructif (plusieurs centaines de Mo à retélécharger) :
     * il ne ressemble donc pas aux autres actions et demande un second appui.
     */
    private void askDeleteModel() {
        if (deleteArmed) {
            btn3.removeCallbacks(disarmDelete);
            deleteArmed = false;
            deleteModel();
            return;
        }
        deleteArmed = true;
        refreshDeleteLabel();
        btn3.postDelayed(disarmDelete, 3000);
    }

    private void refreshDeleteLabel() {
        btn3.setText(ctx.getString(deleteArmed ? R.string.summary_delete_confirm
            : R.string.summary_delete_model));
    }

    /** Lien de texte discret, petit, loin du pouce : ni fond, ni même taille que « Fermer ». */
    private void styleDeleteButton(Button b) {
        b.setBackground(null);
        b.setTextSize(12);
        b.setTextColor(theme.ash);
        b.setMinHeight(0);
        b.setMinimumHeight(0);
        final float d = ctx.getResources().getDisplayMetrics().density;
        ((android.widget.LinearLayout.LayoutParams) b.getLayoutParams()).topMargin = Math.round(28 * d);
    }

    private void deleteModel() {
        if (summarizer != null) summarizer.cancel();
        store.deleteAll();
        showNeedModel();
    }

    /* ---------- Vue ---------- */

    private void reset() {
        state = State.IDLE;
        scroll.setFixedHeight(false);
        session++;
        stopListening();
        text.setText("");
        showProgress(false, 0);
    }

    private void setNote(String s) {
        note.setText(s);
    }

    /** Trait de progression : indéterminé (attente) ou en millièmes, ou caché. */
    private void showProgress(boolean indeterminate, int permille) {
        final boolean visible = indeterminate || permille > 0 || state == State.TRANSFER;
        progress.setVisibility(visible && state != State.DONE && state != State.ERROR && state != State.NEED_MODEL
            ? View.VISIBLE : View.GONE);
        progress.setIndeterminate(indeterminate);
        if (!indeterminate) progress.setProgress(permille);
    }

    private void setButtons(String l1, View.OnClickListener c1, String l2, View.OnClickListener c2,
                            String l3, View.OnClickListener c3) {
        deleteArmed = false;
        btn3.removeCallbacks(disarmDelete);
        stopListening();
        listenBtn.setVisibility(View.GONE);
        // Le 3e bouton a pu servir de lien discret : retour au style d'origine.
        btn3.setBackground(theme.secondaryButton());
        btn3.setTextColor(theme.ink);
        btn3.setTextSize(13);
        final float d = ctx.getResources().getDisplayMetrics().density;
        btn3.setMinHeight(Math.round(46 * d));
        btn3.setMinimumHeight(Math.round(46 * d));
        ((android.widget.LinearLayout.LayoutParams) btn3.getLayoutParams()).topMargin = Math.round(10 * d);
        bind(btn1, l1, c1);
        bind(btn2, l2, c2);
        bind(btn3, l3, c3);
    }

    private static void bind(Button b, String label, View.OnClickListener click) {
        if (label == null) {
            b.setVisibility(View.GONE);
            return;
        }
        b.setText(label);
        b.setOnClickListener(click);
        b.setVisibility(View.VISIBLE);
    }
}
