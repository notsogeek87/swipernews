package eu.lielu.news;

import android.media.AudioAttributes;
import android.media.AudioFormat;
import android.media.AudioTrack;

import com.k2fsa.sherpa.onnx.GeneratedAudio;
import com.k2fsa.sherpa.onnx.OfflineTts;

import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;

/**
 * Lit à voix haute avec la voix neuronale hors ligne (sherpa-onnx + Piper).
 *
 * <p>Le moteur système rend la main phrase par phrase ; celui-ci doit d'abord
 * SYNTHÉTISER la phrase, ce qui prend du temps de calcul. Pour ne pas laisser un
 * blanc entre deux phrases, {@link #speak} reçoit aussi le texte de la SUIVANTE et
 * la prépare pendant que la première se joue.
 *
 * <p>Une phrase = un {@link AudioTrack} en mode statique, créé pour elle : un
 * arrêt (pause, saut) coupe net, sans tampon à vider ni position à remettre à zéro.
 * Le jeton {@code token} rend muette toute phrase dépassée, comme {@code gen} dans
 * ListenService.
 *
 * <p>Les synthèses sont SÉRIALISÉES ({@code synthLock}) : le phonémiseur espeak-ng
 * du code natif n'est pas sûr en concurrence.
 */
final class NeuralSpeaker {

    /** ok faux : la synthèse ou la lecture a échoué (l'appelant bascule sur la voix système). */
    interface Done {
        void onDone(String id, boolean ok);
    }

    private final OfflineTts tts;
    private final int sid;
    private final AudioAttributes attrs;
    private final Done done;
    private volatile float speed;

    private final ExecutorService play = Executors.newSingleThreadExecutor();
    private final ExecutorService ahead = Executors.newSingleThreadExecutor();
    private final Object synthLock = new Object();
    private final Object trackLock = new Object();
    private final Object cacheLock = new Object();
    private volatile int token = 0;
    private volatile boolean closed = false;
    private AudioTrack track;
    private String cachedText;
    private Future<short[]> cached;
    private int sampleRate = 22050;

    NeuralSpeaker(OfflineTts tts, int sid, float speed, AudioAttributes attrs, Done done) {
        this.tts = tts;
        this.sid = sid;
        this.speed = speed;
        this.attrs = attrs;
        this.done = done;
        this.sampleRate = tts.sampleRate();
    }

    void setSpeed(float speed) {
        if (speed != this.speed) {
            this.speed = speed;
            synchronized (cacheLock) {  // une phrase préparée l'a été à l'ancienne vitesse
                cachedText = null;
                cached = null;
            }
        }
    }

    /** À appeler depuis un seul fil (le principal) : le jeton s'incrémente sans verrou. */
    void speak(final String id, final String text, final String nextText) {
        if (closed) return;
        final int my = ++token;
        play.execute(() -> {
            try {
                final short[] pcm = take(text);
                if (my != token) return;
                if (nextText != null) prefetch(nextText);
                playPcm(pcm, my);
                if (my == token) done.onDone(id, true);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
            } catch (Throwable t) {
                if (my == token) done.onDone(id, false);
            }
        });
    }

    /** Coupe la phrase en cours (et invalide tout ce qui était en attente). */
    void stop() {
        token++;
        final AudioTrack t;
        synchronized (trackLock) {
            t = track;
        }
        if (t != null) {
            try {
                t.pause();
                t.flush();
            } catch (IllegalStateException ignored) {
                // déjà libérée par le fil de lecture : rien à couper
            }
        }
    }

    /** Libère le moteur natif — à l'abri d'une synthèse en cours, donc hors du fil appelant. */
    void shutdown() {
        closed = true;
        stop();
        play.shutdownNow();
        ahead.shutdownNow();
        new Thread(() -> {
            synchronized (synthLock) {
                tts.release();
            }
        }, "neural-release").start();
    }

    private short[] take(String text) throws Exception {
        Future<short[]> f = null;
        synchronized (cacheLock) {
            if (cached != null && text.equals(cachedText)) {
                f = cached;
                cached = null;
                cachedText = null;
            }
        }
        return f != null ? f.get() : synth(text);
    }

    private void prefetch(final String text) {
        synchronized (cacheLock) {
            if (text.equals(cachedText)) return;
            cachedText = text;
            cached = ahead.submit(() -> synth(text));
        }
    }

    private short[] synth(String text) {
        synchronized (synthLock) {
            if (closed) throw new IllegalStateException("fermé");
            final GeneratedAudio g = tts.generate(text, sid, speed);
            sampleRate = g.sampleRate;
            final float[] f = g.samples;
            final short[] s = new short[f.length];
            for (int i = 0; i < f.length; i++) {
                final float v = Math.max(-1f, Math.min(1f, f[i]));
                s[i] = (short) (v * 32767f);
            }
            return s;
        }
    }

    private void playPcm(short[] pcm, int my) throws InterruptedException {
        if (pcm.length == 0) return;
        final int sr = sampleRate;
        final int bytes = Math.max(pcm.length * 2,
            AudioTrack.getMinBufferSize(sr, AudioFormat.CHANNEL_OUT_MONO, AudioFormat.ENCODING_PCM_16BIT));
        final AudioTrack t = new AudioTrack.Builder()
            .setAudioAttributes(attrs)
            .setAudioFormat(new AudioFormat.Builder()
                .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
                .setSampleRate(sr)
                .setChannelMask(AudioFormat.CHANNEL_OUT_MONO)
                .build())
            .setBufferSizeInBytes(bytes)
            .setTransferMode(AudioTrack.MODE_STATIC)
            .build();
        try {
            synchronized (trackLock) {
                if (my != token) return;
                track = t;
            }
            t.write(pcm, 0, pcm.length);
            t.play();
            // Durée prévue + marge : si la position de lecture ne progresse plus
            // (focus perdu, périphérique parti), on ne reste pas bloqué.
            final long deadline = System.currentTimeMillis() + pcm.length * 1000L / sr + 3000L;
            while (my == token && t.getPlaybackHeadPosition() < pcm.length
                && System.currentTimeMillis() < deadline) {
                Thread.sleep(20);
            }
        } finally {
            synchronized (trackLock) {
                if (track == t) track = null;
            }
            try {
                t.stop();
            } catch (IllegalStateException ignored) {
                // jamais démarrée ou déjà arrêtée
            }
            t.release();
        }
    }
}
