package eu.lielu.news;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.graphics.drawable.Icon;
import android.media.AudioAttributes;
import android.media.AudioFocusRequest;
import android.media.AudioManager;
import android.media.session.MediaSession;
import android.media.session.PlaybackState;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.PowerManager;
import android.speech.tts.TextToSpeech;
import android.speech.tts.UtteranceProgressListener;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

/**
 * « Mode radio » : lit le fil à voix haute TÉLÉPHONE POSÉ, écran éteint.
 *
 * <p>Pourquoi un service et pas la WebView : écran éteint, Android fige la
 * WebView, donc la boucle JS de « Écouter le fil » s'arrêtait net. Le JS remet
 * donc ici un INSTANTANÉ du fil (une file bornée d'articles, déjà découpée en
 * phrases par ttsChunks) et ne pilote plus rien : la lecture, la file et les
 * boutons de la notification vivent entièrement côté natif.
 *
 * <p>Service au premier plan de type mediaPlayback : c'est la notification
 * (lecture/pause, précédent, suivant, arrêt) qui remplace le bouton « Arrêter
 * l'écoute » de l'écran — la règle « pas de son sans moyen de l'arrêter » tient
 * toujours, elle a seulement changé de support. Le moteur de synthèse est celui
 * du système, créé ici (celui d'InAppBrowserPlugin sert au premier plan, et ses
 * demandes ne survivent pas à l'activité).
 *
 * <p>Tout se passe sur le fil principal (les rappels du moteur y sont reposés),
 * donc aucun verrou. {@code gen} invalide les rappels d'une phrase coupée exprès
 * (pause, saut) : sans lui, le onStop d'un tts.stop() ferait avancer la file.
 */
public class ListenService extends Service {
    static final String ACTION_START = "eu.lielu.news.listen.START";
    static final String ACTION_TOGGLE = "eu.lielu.news.listen.TOGGLE";
    static final String ACTION_NEXT = "eu.lielu.news.listen.NEXT";
    static final String ACTION_PREV = "eu.lielu.news.listen.PREV";
    static final String ACTION_STOP = "eu.lielu.news.listen.STOP";

    private static final String CHANNEL_ID = "listen";
    private static final int NOTIF_ID = 4711;
    /** Filet : un wake lock sans échéance resterait pris si le service mourait mal. */
    private static final long WAKE_MAX_MS = 3L * 60 * 60 * 1000;
    private static final long BREATH_MS = 450;

    /** Un article de la file : la clé est celle du fil (seenKey), rendue telle quelle au JS. */
    static final class Entry {
        final String key;
        final String source;
        final String title;
        final List<String> chunks;

        Entry(String key, String source, String title, List<String> chunks) {
            this.key = key;
            this.source = source;
            this.title = title;
            this.chunks = chunks;
        }
    }

    /** Prévient le plugin (donc le JS, s'il est vivant) : lecture en cours, ou finie. */
    interface Listener {
        void onState(boolean active, String key, String reason);
    }

    // Même processus que le plugin : la file passe par ces champs statiques plutôt
    // que par les extras d'un Intent (limités à ~1 Mo par le Binder).
    private static List<Entry> pendingQueue = new ArrayList<>();
    private static int pendingStart = 0;
    private static String pendingLang = "fr-FR";
    private static volatile boolean active = false;
    private static volatile String currentKey = "";
    private static volatile Listener listener = null;

    static void setListener(Listener l) { listener = l; }

    static boolean isActive() { return active; }

    static String currentKey() { return currentKey; }

    static void prepare(List<Entry> queue, int start, String lang) {
        pendingQueue = queue;
        pendingStart = start;
        pendingLang = lang == null || lang.isEmpty() ? "fr-FR" : lang;
    }

    private final Handler main = new Handler(Looper.getMainLooper());
    private List<Entry> queue = new ArrayList<>();
    private int index = 0;
    private int chunk = 0;
    private int gen = 0;
    private boolean paused = false;
    private boolean pausedByFocus = false;
    private String lang = "fr-FR";

    private TextToSpeech tts;
    private boolean ttsReady = false;
    private boolean ttsFailed = false;
    private Runnable afterReady = null;

    private MediaSession session;
    private AudioManager audio;
    private AudioFocusRequest focusRequest;
    private PowerManager.WakeLock wake;

    private final AudioManager.OnAudioFocusChangeListener focusListener = change -> main.post(() -> {
        if (change == AudioManager.AUDIOFOCUS_LOSS || change == AudioManager.AUDIOFOCUS_LOSS_TRANSIENT) {
            // Appel, autre lecteur : on se tait, et on ne reprend tout seul que si
            // c'est la perte qui nous a coupés (pas une pause demandée).
            if (!paused) {
                pausedByFocus = true;
                pauseNow();
            }
        } else if (change == AudioManager.AUDIOFOCUS_GAIN && pausedByFocus) {
            pausedByFocus = false;
            resumeNow();
        }
    });

    @Override
    public IBinder onBind(Intent intent) { return null; }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String action = intent == null ? ACTION_STOP : intent.getAction();
        if (action == null) action = ACTION_STOP;
        switch (action) {
            case ACTION_START:
                start();
                break;
            case ACTION_TOGGLE:
                if (!active) { stopAll("stop"); break; }
                if (paused) { pausedByFocus = false; resumeNow(); } else pauseNow();
                break;
            case ACTION_NEXT:
                if (active) skipTo(index + 1);
                break;
            case ACTION_PREV:
                if (active) {
                    // Comme un lecteur audio : au-delà de quelques phrases, « précédent »
                    // recommence l'article en cours avant de reculer d'un.
                    skipTo(chunk > 1 ? index : index - 1);
                }
                break;
            default:
                stopAll("stop");
        }
        // NON_STICKY : tué par le système, la file (en mémoire) est perdue de toute
        // façon — un redémarrage sans file n'aurait rien à lire.
        return START_NOT_STICKY;
    }

    private void start() {
        queue = new ArrayList<>(pendingQueue);
        index = Math.max(0, Math.min(pendingStart, queue.size() - 1));
        lang = pendingLang;
        chunk = 0;
        paused = false;
        pausedByFocus = false;
        gen++;
        // startForeground AVANT tout le reste : Android donne ~5 s après
        // startForegroundService pour l'appeler.
        ensureSession();
        goForeground();
        if (queue.isEmpty()) { stopAll("end"); return; }
        acquireWake();
        requestFocus();
        active = true;
        publishState("playing");
        ensureTts(this::speakCurrent);
    }

    // ---------- Moteur de synthèse ----------

    private void ensureTts(Runnable then) {
        if (ttsReady) { then.run(); return; }
        if (ttsFailed) { stopAll("error"); return; }
        afterReady = then;
        if (tts != null) return;     // initialisation déjà en cours
        tts = new TextToSpeech(getApplicationContext(), status -> main.post(() -> {
            if (tts == null) return;     // service détruit entre-temps
            if (status != TextToSpeech.SUCCESS) {
                ttsFailed = true;
                stopAll("error");
                return;
            }
            AudioAttributes attrs = new AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_MEDIA)
                .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                .build();
            tts.setAudioAttributes(attrs);
            tts.setOnUtteranceProgressListener(new UtteranceProgressListener() {
                @Override
                public void onStart(String id) { }

                @Override
                public void onDone(String id) { main.post(() -> utteranceEnded(id)); }

                @Override
                @Deprecated
                public void onError(String id) { main.post(() -> utteranceEnded(id)); }

                @Override
                public void onError(String id, int errorCode) { main.post(() -> utteranceEnded(id)); }
            });
            ttsReady = true;
            Runnable r = afterReady;
            afterReady = null;
            if (r != null) r.run();
        }));
    }

    private void speakCurrent() {
        if (!active || paused || tts == null || !ttsReady) return;
        if (index < 0 || index >= queue.size()) { stopAll("end"); return; }
        Entry e = queue.get(index);
        if (chunk == 0) {
            currentKey = e.key;
            updateNotification();
            notifyListener("playing");
        }
        if (chunk >= e.chunks.size()) { advance(); return; }
        int support = tts.setLanguage(Locale.forLanguageTag(lang));
        if (support == TextToSpeech.LANG_MISSING_DATA || support == TextToSpeech.LANG_NOT_SUPPORTED) {
            stopAll("error");
            return;
        }
        String t = e.chunks.get(chunk);
        int max = TextToSpeech.getMaxSpeechInputLength();
        if (t.length() > max) t = t.substring(0, max);
        String id = gen + ":" + index + ":" + chunk;
        if (tts.speak(t, TextToSpeech.QUEUE_FLUSH, null, id) == TextToSpeech.ERROR) stopAll("error");
    }

    private void utteranceEnded(String id) {
        if (!active || paused) return;
        // Une phrase coupée exprès (pause, saut) a une génération dépassée.
        if (id == null || !id.equals(gen + ":" + index + ":" + chunk)) return;
        chunk++;
        speakCurrent();
    }

    private void advance() {
        final int myGen = gen;
        main.postDelayed(() -> {
            if (myGen != gen || !active || paused) return;
            if (index + 1 >= queue.size()) { stopAll("end"); return; }
            index++;
            chunk = 0;
            speakCurrent();
        }, BREATH_MS);
    }

    private void skipTo(int target) {
        if (target < 0) target = 0;
        if (target >= queue.size()) { stopAll("end"); return; }
        gen++;
        if (tts != null && ttsReady) tts.stop();
        index = target;
        chunk = 0;
        paused = false;
        pausedByFocus = false;
        requestFocus();
        updatePlaybackState();
        speakCurrent();
    }

    private void pauseNow() {
        if (!active || paused) return;
        paused = true;
        gen++;
        if (tts != null && ttsReady) tts.stop();
        updatePlaybackState();
        updateNotification();
        notifyListener("paused");
    }

    private void resumeNow() {
        if (!active || !paused) return;
        paused = false;
        gen++;
        requestFocus();
        updatePlaybackState();
        updateNotification();
        notifyListener("playing");
        speakCurrent();
    }

    private void stopAll(String reason) {
        boolean wasActive = active;
        active = false;
        gen++;
        main.removeCallbacksAndMessages(null);
        if (tts != null) {
            try { tts.stop(); tts.shutdown(); } catch (RuntimeException ignored) { }
            tts = null;
        }
        ttsReady = false;
        afterReady = null;
        abandonFocus();
        releaseWake();
        if (session != null) {
            session.setActive(false);
            session.release();
            session = null;
        }
        stopForeground(true);
        String key = currentKey;
        currentKey = "";
        Listener l = listener;
        if (l != null && (wasActive || "error".equals(reason))) l.onState(false, key, reason);
        stopSelf();
    }

    // ---------- Notification et session média ----------

    private void ensureSession() {
        if (session != null) return;
        session = new MediaSession(this, "SwiperNewsListen");
        session.setCallback(new MediaSession.Callback() {
            @Override
            public void onPlay() { main.post(() -> { pausedByFocus = false; resumeNow(); }); }

            @Override
            public void onPause() { main.post(() -> pauseNow()); }

            @Override
            public void onSkipToNext() { main.post(() -> { if (active) skipTo(index + 1); }); }

            @Override
            public void onSkipToPrevious() { main.post(() -> { if (active) skipTo(chunk > 1 ? index : index - 1); }); }

            @Override
            public void onStop() { main.post(() -> stopAll("stop")); }
        });
        session.setActive(true);
        updatePlaybackState();
    }

    private void updatePlaybackState() {
        if (session == null) return;
        long actions = PlaybackState.ACTION_PLAY | PlaybackState.ACTION_PAUSE | PlaybackState.ACTION_PLAY_PAUSE
            | PlaybackState.ACTION_SKIP_TO_NEXT | PlaybackState.ACTION_SKIP_TO_PREVIOUS | PlaybackState.ACTION_STOP;
        int state = paused ? PlaybackState.STATE_PAUSED : PlaybackState.STATE_PLAYING;
        session.setPlaybackState(new PlaybackState.Builder()
            .setActions(actions)
            .setState(state, PlaybackState.PLAYBACK_POSITION_UNKNOWN, paused ? 0f : 1f)
            .build());
    }

    private PendingIntent actionIntent(String action, int code) {
        Intent i = new Intent(this, ListenService.class).setAction(action);
        return PendingIntent.getService(this, code, i, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
    }

    private Notification buildNotification() {
        NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (Build.VERSION.SDK_INT >= 26 && nm != null && nm.getNotificationChannel(CHANNEL_ID) == null) {
            NotificationChannel c = new NotificationChannel(CHANNEL_ID,
                getString(R.string.listen_channel), NotificationManager.IMPORTANCE_LOW);
            c.setShowBadge(false);
            nm.createNotificationChannel(c);
        }
        Entry e = index >= 0 && index < queue.size() ? queue.get(index) : null;
        String title = e == null ? getString(R.string.listen_title) : e.title;
        String text = e == null ? "" : e.source;
        // Les contrôles utilisent les icônes du système : aucune ressource à tenir
        // en cohérence avec le thème de l'app.
        Notification.Action prev = new Notification.Action.Builder(
            Icon.createWithResource(this, android.R.drawable.ic_media_previous),
            getString(R.string.listen_prev), actionIntent(ACTION_PREV, 1)).build();
        Notification.Action toggle = new Notification.Action.Builder(
            Icon.createWithResource(this, paused ? android.R.drawable.ic_media_play : android.R.drawable.ic_media_pause),
            getString(paused ? R.string.listen_play : R.string.listen_pause), actionIntent(ACTION_TOGGLE, 2)).build();
        Notification.Action next = new Notification.Action.Builder(
            Icon.createWithResource(this, android.R.drawable.ic_media_next),
            getString(R.string.listen_next), actionIntent(ACTION_NEXT, 3)).build();
        Notification.Action stop = new Notification.Action.Builder(
            Icon.createWithResource(this, android.R.drawable.ic_menu_close_clear_cancel),
            getString(R.string.listen_stop), actionIntent(ACTION_STOP, 4)).build();

        Intent open = new Intent(this, MainActivity.class)
            .setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent content = PendingIntent.getActivity(this, 0, open, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);

        Notification.Builder b = Build.VERSION.SDK_INT >= 26
            ? new Notification.Builder(this, CHANNEL_ID)
            : new Notification.Builder(this);
        b.setSmallIcon(R.drawable.ic_notification)
            .setContentTitle(title)
            .setContentText(text)
            .setContentIntent(content)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setVisibility(Notification.VISIBILITY_PUBLIC)
            .addAction(prev)
            .addAction(toggle)
            .addAction(next)
            .addAction(stop);
        Notification.MediaStyle style = new Notification.MediaStyle().setShowActionsInCompactView(0, 1, 2);
        if (session != null) style.setMediaSession(session.getSessionToken());
        b.setStyle(style);
        return b.build();
    }

    private void goForeground() {
        Notification n = buildNotification();
        if (Build.VERSION.SDK_INT >= 29) {
            startForeground(NOTIF_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK);
        } else {
            startForeground(NOTIF_ID, n);
        }
    }

    private void updateNotification() {
        if (!active) return;
        NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm != null) nm.notify(NOTIF_ID, buildNotification());
    }

    // ---------- Audio, veille, état ----------

    private void requestFocus() {
        if (audio == null) audio = (AudioManager) getSystemService(Context.AUDIO_SERVICE);
        if (audio == null) return;
        AudioAttributes attrs = new AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_MEDIA)
            .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
            .build();
        if (Build.VERSION.SDK_INT >= 26) {
            focusRequest = new AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN)
                .setAudioAttributes(attrs)
                .setOnAudioFocusChangeListener(focusListener, main)
                .build();
            audio.requestAudioFocus(focusRequest);
        } else {
            audio.requestAudioFocus(focusListener, AudioManager.STREAM_MUSIC, AudioManager.AUDIOFOCUS_GAIN);
        }
    }

    private void abandonFocus() {
        if (audio == null) return;
        if (Build.VERSION.SDK_INT >= 26) {
            if (focusRequest != null) audio.abandonAudioFocusRequest(focusRequest);
            focusRequest = null;
        } else {
            audio.abandonAudioFocus(focusListener);
        }
    }

    private void acquireWake() {
        if (wake != null && wake.isHeld()) return;
        PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
        if (pm == null) return;
        wake = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "swipernews:listen");
        wake.setReferenceCounted(false);
        wake.acquire(WAKE_MAX_MS);
    }

    private void releaseWake() {
        if (wake != null && wake.isHeld()) wake.release();
        wake = null;
    }

    private void publishState(String reason) {
        notifyListener(reason);
    }

    private void notifyListener(String reason) {
        Listener l = listener;
        if (l != null) l.onState(true, currentKey, reason);
    }

    @Override
    public void onDestroy() {
        // Détruit sans être passé par stopAll (système) : ne rien laisser tenir.
        active = false;
        gen++;
        main.removeCallbacksAndMessages(null);
        if (tts != null) {
            try { tts.stop(); tts.shutdown(); } catch (RuntimeException ignored) { }
            tts = null;
        }
        abandonFocus();
        releaseWake();
        if (session != null) {
            session.release();
            session = null;
        }
        super.onDestroy();
    }
}
