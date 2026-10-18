package eu.lielu.news;

import android.content.Context;
import android.os.Handler;
import android.os.Looper;
import android.speech.tts.TextToSpeech;
import android.speech.tts.UtteranceProgressListener;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

/**
 * La lecture à voix haute du résumé : facultative, déclenchée par un bouton de la
 * feuille et jamais d'elle-même. Moteur du système (aucun tiers, aucun réseau de
 * notre part), créé à la PREMIÈRE demande seulement : qui n'écoute pas ne paie
 * aucune initialisation.
 *
 * Le texte est lu phrase par phrase (morceaux courts, mis en file) : d'un seul
 * bloc, certains moteurs abandonnent au bout de quelques secondes sans le dire.
 * Une GÉNÉRATION (`gen`) invalide tout rappel d'une lecture dépassée, comme
 * `session` dans ReaderSummary.
 */
final class SummarySpeaker {

    interface Listener {
        /** La lecture est allée au bout. */
        void onFinished();

        /** Impossible de lire (moteur ou langue absents, erreur du moteur). */
        void onError();
    }

    /** Un morceau ne dépasse pas cette taille : voir plus haut. */
    private static final int MAX_CHUNK = 200;

    private final Context ctx;
    private final Listener listener;
    private final Handler main = new Handler(Looper.getMainLooper());

    private TextToSpeech tts;
    /** 0 : jamais demandé, 1 : initialisation en cours, 2 : prêt, -1 : indisponible. */
    private int engine = 0;
    private List<String> pending;
    private int gen;
    private boolean speaking;
    private boolean released;

    SummarySpeaker(Context ctx, Listener listener) {
        this.ctx = ctx;
        this.listener = listener;
    }

    boolean isSpeaking() {
        return speaking;
    }

    void speak(String text) {
        if (released) return;
        final List<String> chunks = chunks(text);
        if (chunks.isEmpty()) return;
        gen++;
        speaking = true;
        if (engine == 2) {
            enqueue(chunks);
        } else if (engine == -1) {
            fail();
        } else {
            pending = chunks;
            if (engine == 0) {
                engine = 1;
                tts = new TextToSpeech(ctx.getApplicationContext(), this::onInit);
            }
        }
    }

    void stop() {
        gen++;
        speaking = false;
        pending = null;
        if (tts != null && engine == 2) tts.stop();
    }

    void release() {
        released = true;
        stop();
        if (tts != null) {
            tts.shutdown();
            tts = null;
        }
        engine = 0;
    }

    private void onInit(int status) {
        main.post(() -> {
            if (released || tts == null) return;
            if (status != TextToSpeech.SUCCESS) {
                engine = -1;
                if (speaking) fail();
                return;
            }
            final int support = tts.setLanguage(Locale.FRENCH);
            if (support == TextToSpeech.LANG_MISSING_DATA || support == TextToSpeech.LANG_NOT_SUPPORTED) {
                engine = -1;
                if (speaking) fail();
                return;
            }
            tts.setOnUtteranceProgressListener(new UtteranceProgressListener() {
                @Override
                public void onStart(String id) { }

                @Override
                public void onDone(String id) { end(id, false); }

                @Override
                @Deprecated
                public void onError(String id) { end(id, true); }

                @Override
                public void onError(String id, int errorCode) { end(id, true); }
            });
            engine = 2;
            final List<String> chunks = pending;
            pending = null;
            if (speaking && chunks != null) enqueue(chunks);
        });
    }

    private void enqueue(List<String> chunks) {
        final int my = gen;
        for (int i = 0; i < chunks.size(); i++) {
            final String id = my + ":" + i + ":" + (i == chunks.size() - 1 ? "last" : "more");
            if (tts.speak(chunks.get(i), TextToSpeech.QUEUE_ADD, null, id) == TextToSpeech.ERROR) {
                fail();
                return;
            }
        }
    }

    /** Fin d'un morceau (fil du moteur) : seul le dernier de la génération courante conclut. */
    private void end(String id, boolean error) {
        main.post(() -> {
            if (released || !speaking) return;
            final String[] p = id.split(":");
            if (p.length < 3 || !String.valueOf(gen).equals(p[0])) return;
            if (error) fail();
            else if ("last".equals(p[2])) {
                speaking = false;
                listener.onFinished();
            }
        });
    }

    private void fail() {
        stop();
        listener.onError();
    }

    /** Phrases d'abord, puis coupe aux espaces ce qui dépasse encore MAX_CHUNK. */
    static List<String> chunks(String text) {
        final List<String> out = new ArrayList<>();
        if (text == null) return out;
        // Les puces et marques de mise en forme ne se prononcent pas.
        final String clean = text.replaceAll("[*#_`]+", "").replaceAll("(?m)^\\s*[-•]\\s+", "");
        for (String sentence : clean.split("(?<=[.!?…])\\s+|\\n+")) {
            String s = sentence.trim();
            while (s.length() > MAX_CHUNK) {
                int cut = s.lastIndexOf(' ', MAX_CHUNK);
                if (cut <= 0) cut = MAX_CHUNK;
                out.add(s.substring(0, cut).trim());
                s = s.substring(cut).trim();
            }
            if (!s.isEmpty()) out.add(s);
        }
        return out;
    }
}
