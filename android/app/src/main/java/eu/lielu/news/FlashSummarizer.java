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

    private static final int FETCH_TIMEOUT_MS = 5000;
    /** Au-delà, on lit l'extrait sans résumé et on passe à l'article suivant. */
    static final long JOB_TIMEOUT_MS = 45_000;
    private static final int ARTICLE_CHARS = 3500;
    /** Un extrait plus court tient déjà dans le flash tel quel : le résumer n'ajouterait rien. */
    private static final int MIN_EXCERPT_CHARS = 200;
    private static final int MIN_SUMMARY_CHARS = 30;
    private static final int MAX_SUMMARY_CHARS = 700;

    private static final class Job {
        final int index;
        final String title;
        final String link;
        final String excerpt;

        Job(int index, String title, String link, String excerpt) {
            this.index = index;
            this.title = title;
            this.link = link;
            this.excerpt = excerpt;
        }
    }

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

    FlashSummarizer(Context ctx, String lang, Result callback) {
        this.model = new SummaryModelStore(ctx).activeFile();
        this.lang = "en".equals(lang) ? "en" : "fr";
        this.callback = callback;
    }

    /** Vrai si un résumé est possible ici : moteur natif utilisable ET modèle installé. */
    boolean ready() {
        return model != null && Summarizer.isAvailable();
    }

    void request(int index, String title, String link, String excerpt) {
        if (released) return;
        queue.add(new Job(index, title, link, excerpt));
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
        try {
            fetcher.execute(() -> {
                String text = "";
                if (j.link != null && !j.link.isEmpty()) {
                    text = ArticleText.extract(ArticleText.fetch(j.link, FETCH_TIMEOUT_MS), ARTICLE_CHARS);
                }
                if (text.isEmpty() && j.excerpt != null && j.excerpt.length() >= MIN_EXCERPT_CHARS) {
                    text = j.excerpt;
                }
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
        summarizer.summarizeFlash(model, j.title, text, lang, new Summarizer.Listener() {
            @Override
            public void onText(String piece) {
                acc.append(piece);
            }

            @Override
            public void onDone(boolean cancelled) {
                if (cancelled) {
                    finish(j, null, my);
                    return;
                }
                String s = acc.toString().trim();
                if (s.length() > MAX_SUMMARY_CHARS) s = s.substring(0, MAX_SUMMARY_CHARS);
                final List<String> chunks = s.length() < MIN_SUMMARY_CHARS
                    ? null : ArticleText.speechChunks(s, 200);
                finish(j, chunks == null || chunks.isEmpty() ? null : chunks, my);
            }

            @Override
            public void onError(int code) {
                finish(j, null, my);
            }
        });
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
        callback.onResult(j.index, chunks);
        pump();
    }
}
