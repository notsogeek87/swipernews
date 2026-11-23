package eu.lielu.news;

import android.content.Context;
import android.os.Handler;
import android.os.Looper;

import java.io.File;
import java.util.ArrayDeque;
import java.util.Deque;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Les résumés IA d'un FLASH INFO : un par article, préparés PENDANT que le précédent
 * est lu, pour qu'il soit prêt à temps.
 *
 * <p>Par article : on va chercher la page chez l'éditeur ({@link ArticleText}), on en
 * tire le texte, et le modèle local ({@link Summarizer#summarizeFlash}, le même LFM2
 * que le résumé du lecteur) en fait deux phrases à lire à voix haute. Si la page
 * n'est pas lisible (script, mur d'abonnement, robot refusé), on résume l'extrait
 * du flux, à condition qu'il soit assez long pour que ça serve à quelque chose.
 * Quand il n'y a rien à résumer, ou que quoi que ce soit échoue, le résultat est
 * {@code null} : l'appelant lit alors l'extrait tel quel. Un résumé raté ne coûte
 * jamais un article.
 *
 * <p>UN article à la fois, dans l'ordre des demandes : le modèle ne sait en faire
 * qu'un à la fois, et la mémoire d'un téléphone n'en supporterait pas deux. Tout
 * revient sur le fil principal. Un garde-fou ({@link #JOB_TIMEOUT_MS}) empêche un
 * article de bloquer ceux d'après.
 */
final class FlashSummarizer {

    interface Result {
        /** {@code chunks} : phrases à lire (≤ 200 caractères chacune), ou null si rien à résumer ou échec. */
        void onResult(int index, List<String> chunks);
    }

    /** Reçoit le résumé AU FIL DE L'ÉCRITURE (fil principal) : morceaux à ajouter bout à bout. */
    interface Piece {
        void onPiece(int index, String piece);
    }

    private static final int FETCH_TIMEOUT_MS = 5000;
    /** Au-delà, on lit l'extrait sans résumé et on passe à l'article suivant. */
    static final long JOB_TIMEOUT_MS = 45_000;
    private static final int ARTICLE_CHARS = 3500;
    /** Phrases au-delà desquelles on arrête le modèle : la consigne du flash en demande deux. */
    private static final int MAX_SENTENCES = 2;
    /** Idem pour une carte du fil, dont la consigne en demande trois ou quatre. */
    private static final int MAX_SENTENCES_CARD = 4;
    /** Un extrait plus court tient déjà dans le flash tel quel : le résumer n'ajouterait rien. */
    private static final int MIN_EXCERPT_CHARS = 200;
    private static final int MIN_SUMMARY_CHARS = 30;
    private static final int MAX_SUMMARY_CHARS = 700;
    /** Cartes : plafond de sécurité plus large, la vraie borne est {@link #budget}. */
    private static final int MAX_SUMMARY_CHARS_CARD = 1200;
    /** Longueur d'une phrase type : sous cette marge, on n'en commence pas une de plus. */
    private static final int SENTENCE_RESERVE = 130;
    /**
     * Cartes : caractères que la zone de texte de la carte peut afficher (calculé par la
     * page, 0 = inconnu). Le modèle s'arrête après une phrase COMPLÈTE quand il ne reste plus
     * la place d'en écrire une autre : sinon la dernière phrase débordait, et la page la
     * retirait sous les yeux (retour d'essai : « la dernière phrase s'enlève parfois »).
     */
    private volatile int budget = 0;

    void setBudget(int chars) {
        budget = Math.max(0, chars);
    }

    private static final class Job {
        final int index;
        final String title;
        final String link;
        final String excerpt;
        final long askedAt = android.os.SystemClock.elapsedRealtime();
        long startedAt, fetchedAt;
        /** D'où vient le texte résumé : "page", "extrait" ou "aucun". */
        String source = "aucun";
        /** Non nul : le résumé est demandé EN DIRECT (essai des cartes), morceau par morceau. */
        Piece piece;

        Job(int index, String title, String link, String excerpt) {
            this.index = index;
            this.title = title;
            this.link = link;
            this.excerpt = excerpt;
        }
    }

    /*
     * MESURES du dernier travail terminé, lues par l'appelant DANS son rappel onResult
     * (même fil, juste avant) : attente dans la file, lecture de la page, génération.
     * C'est ce qui manquait pour savoir si un résumé est prêt à temps sur un vrai
     * téléphone (voir l'essai « résumé IA sur les cartes », InAppBrowserPlugin).
     */
    long lastWaitMs, lastFetchMs, lastGenMs;
    String lastSource = "aucun";

    private final Handler main = new Handler(Looper.getMainLooper());
    private final ExecutorService fetcher = Executors.newSingleThreadExecutor();
    private final Deque<Job> queue = new ArrayDeque<>();
    private final File model;
    private final String lang;
    private final Result callback;

    private Summarizer summarizer;
    private Job current;
    private boolean busy;
    private boolean released;
    /** Change à chaque fin ou abandon de travail : un rappel d'un travail dépassé est ignoré. */
    private int token;
    private final Runnable watchdog = this::timedOut;

    /** Texte de l'article donné au modèle (caractères) : moins il en lit, plus il démarre vite. */
    private final int articleChars;

    FlashSummarizer(Context ctx, String lang, Result callback) {
        this(ctx, lang, callback, ARTICLE_CHARS);
    }

    /**
     * @param articleChars longueur lue sur la page. Les cartes du fil demandent moins
     *                     (le début d'un article de presse en dit l'essentiel) pour que
     *                     le résumé arrive plus vite ; l'écoute garde ARTICLE_CHARS.
     */
    FlashSummarizer(Context ctx, String lang, Result callback, int articleChars) {
        this(ctx, lang, callback, articleChars, false);
    }

    /** Vrai : résumés de CARTE (plus longs, lus à l'écran), sinon de flash info (parlés). */
    private final boolean card;

    FlashSummarizer(Context ctx, String lang, Result callback, int articleChars, boolean card) {
        this.card = card;
        this.articleChars = articleChars;
        this.model = new SummaryModelStore(ctx).activeFile();
        this.lang = "en".equals(lang) ? "en" : "fr";
        this.callback = callback;
    }

    /** Vrai si un résumé est possible ici : moteur natif utilisable ET modèle installé. */
    boolean ready() {
        return model != null && Summarizer.isAvailable();
    }

    void request(int index, String title, String link, String excerpt) {
        request(index, title, link, excerpt, null);
    }

    /** Demande ordinaire (dans l'ordre de la file), mais écrite au fil de l'eau si {@code piece}. */
    void request(int index, String title, String link, String excerpt, Piece piece) {
        if (released) return;
        final Job j = new Job(index, title, link, excerpt);
        j.piece = piece;
        queue.add(j);
        pump();
    }

    /** L'écoute est passée à l'article {@code index} : les résumés des précédents ne servent plus. */
    void dropBefore(int index) {
        if (released) return;
        final Deque<Job> keep = new ArrayDeque<>();
        for (Job j : queue) if (j.index >= index) keep.add(j);
        queue.clear();
        queue.addAll(keep);
        if (busy && current != null && current.index < index) {
            if (summarizer != null) summarizer.cancel();
            finish(current, null, token);
        }
    }

    /**
     * Demande PRIORITAIRE, écrite au fil de l'eau : passe devant la file et interrompt le
     * travail en cours (qui revient par le rappel avec un résultat nul). Sert au toucher sur
     * une carte du fil : quelqu'un attend, les résumés préparés d'avance passent après.
     */
    void requestNow(int index, String title, String link, String excerpt, Piece piece) {
        if (released) return;
        final Job j = new Job(index, title, link, excerpt);
        j.piece = piece;
        queue.addFirst(j);
        if (busy && current != null) {
            if (summarizer != null) summarizer.cancel();
            finish(current, null, token);
        } else {
            pump();
        }
    }

    /** Indice du travail en cours, ou -1. */
    int currentIndex() {
        return busy && current != null ? current.index : -1;
    }

    /** Garde seulement les demandes dont l'indice est dans {@code keep} ; abandonne les autres, en cours compris. */
    void dropExcept(java.util.Set<Integer> keep, Result dropped) {
        if (released) return;
        final java.util.Iterator<Job> it = queue.iterator();
        while (it.hasNext()) {
            final Job j = it.next();
            if (!keep.contains(j.index)) {
                it.remove();
                dropped.onResult(j.index, null);
            }
        }
        if (busy && current != null && !keep.contains(current.index)) {
            if (summarizer != null) summarizer.cancel();
            finish(current, null, token);
        }
    }

    void release() {
        released = true;
        queue.clear();
        token++;
        main.removeCallbacks(watchdog);
        fetcher.shutdownNow();
        if (summarizer != null) {
            summarizer.release();
            summarizer = null;
        }
    }

    private void pump() {
        if (released || busy || queue.isEmpty()) return;
        final Job j = queue.poll();
        busy = true;
        current = j;
        final int my = ++token;
        main.postDelayed(watchdog, JOB_TIMEOUT_MS);
        j.startedAt = android.os.SystemClock.elapsedRealtime();
        try {
            fetcher.execute(() -> {
                String text = "";
                if (j.link != null && !j.link.isEmpty()) {
                    text = ArticleText.extract(ArticleText.fetch(j.link, FETCH_TIMEOUT_MS), articleChars);
                }
                if (!text.isEmpty()) j.source = "page";
                if (text.isEmpty() && j.excerpt != null && j.excerpt.length() >= MIN_EXCERPT_CHARS) {
                    text = j.excerpt;
                    j.source = "extrait";
                }
                j.fetchedAt = android.os.SystemClock.elapsedRealtime();
                final String t = text;
                main.post(() -> summarize(j, t, my));
            });
        } catch (java.util.concurrent.RejectedExecutionException e) {
            finish(j, null, my);
        }
    }

    private void summarize(final Job j, String text, final int my) {
        if (my != token || released) return;
        if (text.isEmpty()) {
            finish(j, null, my);
            return;
        }
        if (summarizer == null) summarizer = new Summarizer();
        final StringBuilder acc = new StringBuilder();
        final int[] phrases = {0};
        final Summarizer.Listener ecoute = new Summarizer.Listener() {
            @Override
            public void onText(String piece) {
                if (my != token || released) return;
                acc.append(piece);
                if (j.piece != null) j.piece.onPiece(j.index, piece);
                // Deux phrases écrites : on arrête le modèle au lieu de le laisser
                // continuer pour rien (il en écrit souvent quatre, coupées ensuite) —
                // c'est autant de temps de génération gagné.
                final int n = countSentences(acc);
                final boolean nouvelle = n > phrases[0];
                phrases[0] = n;
                final int place = budget;
                // Carte : une phrase vient de se terminer et la suivante ne tiendrait plus.
                // acc contient déjà le début de la suivante (la fin d'une phrase ne se voit
                // qu'au morceau d'après) : on mesure jusqu'à la dernière fin de phrase.
                final boolean pleine = card && nouvelle && place > 0
                    && completeSentences(acc.toString().trim()).length() + SENTENCE_RESERVE > place;
                if (n >= (card ? MAX_SENTENCES_CARD : MAX_SENTENCES) || pleine) {
                    if (summarizer != null) summarizer.cancel();   // plus aucun rappel de cette génération
                    conclude(j, acc, my);
                }
            }

            @Override
            public void onDone(boolean cancelled) {
                if (cancelled) {
                    finish(j, null, my);
                    return;
                }
                conclude(j, acc, my);
            }

            @Override
            public void onError(int code) {
                finish(j, null, my);
            }
        };
        if (card) summarizer.summarizeCard(model, j.title, text, lang, ecoute);
        else summarizer.summarizeFlash(model, j.title, text, lang, ecoute);
    }

    private void conclude(Job j, StringBuilder acc, int my) {
        String s = acc.toString().trim();
        final int max = card ? MAX_SUMMARY_CHARS_CARD : MAX_SUMMARY_CHARS;
        if (s.length() > max) s = s.substring(0, max);
        s = completeSentences(s);
        final List<String> chunks = s.length() < MIN_SUMMARY_CHARS
            ? null : ArticleText.speechChunks(s, 200);
        finish(j, chunks == null || chunks.isEmpty() ? null : chunks, my);
    }

    /**
     * Phrases TERMINÉES dans {@code t} : une ponctuation finale suivie d'un blanc (la fin de
     * la phrase n'est donc sûre qu'au morceau suivant). Ne compte pas les abréviations et
     * initiales courtes à majuscule (« M. », « Mme. », « J. ») : couper le modèle sur
     * « le président M. » donnerait une phrase sans fin.
     */
    static int countSentences(CharSequence t) {
        int n = 0;
        for (int i = 0; i + 1 < t.length(); i++) {
            final char c = t.charAt(i);
            if ((c == '.' || c == '!' || c == '?' || c == '…') && Character.isWhitespace(t.charAt(i + 1))) {
                if (c == '.') {
                    int w = i;
                    while (w > 0 && !Character.isWhitespace(t.charAt(w - 1))) w--;
                    if (i - w <= 3 && i > w && Character.isUpperCase(t.charAt(w))) continue;
                }
                n++;
            }
        }
        return n;
    }

    /** Charge le modèle d'avance, sans rien générer (voir Summarizer.warmUp). */
    void warm() {
        if (released || model == null) return;
        if (summarizer == null) summarizer = new Summarizer();
        summarizer.warmUp(model);
    }

    /**
     * Coupe après la dernière phrase COMPLÈTE. Le modèle écrit souvent plus que les deux
     * phrases demandées et bute sur MAX_NEW_TOKENS_FLASH au milieu d'un mot (vu sur
     * téléphone : « … des ports USB4 g »). Si la coupe ne laisse presque rien, on garde
     * le texte tel quel : mieux vaut une fin abrupte qu'aucun résumé.
     */
    static String completeSentences(String s) {
        if (s.isEmpty() || ".!?…»\"".indexOf(s.charAt(s.length() - 1)) >= 0) return s;
        int cut = -1;
        for (int i = s.length() - 2; i >= 0; i--) {
            final char c = s.charAt(i);
            if ((c == '.' || c == '!' || c == '?' || c == '…') && Character.isWhitespace(s.charAt(i + 1))) {
                cut = i + 1;
                break;
            }
        }
        if (cut < MIN_SUMMARY_CHARS) return s;
        return s.substring(0, cut).trim();
    }

    private void timedOut() {
        if (!busy || current == null) return;
        if (summarizer != null) summarizer.cancel();
        finish(current, null, token);
    }

    private void finish(Job j, List<String> chunks, int my) {
        if (my != token || released) return;
        token++;
        main.removeCallbacks(watchdog);
        busy = false;
        current = null;
        final long now = android.os.SystemClock.elapsedRealtime();
        lastWaitMs = j.startedAt > 0 ? j.startedAt - j.askedAt : now - j.askedAt;
        lastFetchMs = j.fetchedAt > 0 ? j.fetchedAt - j.startedAt : 0;
        lastGenMs = j.fetchedAt > 0 ? now - j.fetchedAt : 0;
        lastSource = j.source;
        callback.onResult(j.index, chunks);
        pump();
    }
}
