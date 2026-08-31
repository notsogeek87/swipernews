package eu.lielu.news;

import android.Manifest;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.os.Build;
import android.util.Xml;

import androidx.annotation.NonNull;
import androidx.core.app.NotificationCompat;
import androidx.core.content.ContextCompat;
import androidx.work.Constraints;
import androidx.work.ExistingPeriodicWorkPolicy;
import androidx.work.NetworkType;
import androidx.work.PeriodicWorkRequest;
import androidx.work.Worker;
import androidx.work.WorkManager;
import androidx.work.WorkerParameters;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;
import org.xmlpull.v1.XmlPullParser;

import java.io.BufferedInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.Locale;
import java.util.Random;
import java.util.concurrent.TimeUnit;

/**
 * Vérification périodique, APP FERMÉE, des sources d'actus cochées — la seule
 * chose que la reprise de lecture (voir MainActivity, AUTO_RELOAD_MS dans
 * index.html) ne fait pas : elle n'agit qu'au retour au premier plan.
 *
 * <p>Aucune des piles JS existantes (fetchFeedRobust, seenNews…) n'est
 * réutilisable ici : elles vivent dans la WebView et dépendent de
 * localStorage, inaccessibles hors d'une page chargée. Ce worker refait donc
 * SA PROPRE vérification, volontairement minimale — pas de proxys de repli,
 * pas de filtre sponsorisé, pas de tour de rôle : un GET direct par source
 * (le natif n'a pas le problème de CORS du web, voir nativeGet), on ne
 * regarde que le premier {@code <item>}/{@code <entry>} (le plus récent, par
 * convention de tous les flux), et on compare son lien à celui mémorisé au
 * dernier vrai chargement de l'app (voir InAppBrowserPlugin.syncBackgroundFeeds,
 * appelé depuis index.html après chaque fil renouvelé). Un lien différent
 * veut dire « du neuf » ; c'est le SEUL signal comparé au repère mémorisé, et
 * ça reste tout ce qu'il faut pour déclencher une notification, pas pour
 * reconstruire le fil. Le TITRE du même item est aussi lu au passage — jamais
 * comparé ni persisté, seulement montré dans la notification (voir
 * postNotification) pour dire QUOI est neuf plutôt que juste COMBIEN.
 *
 * <p>Aucun accès à {@code seenNews} ou au cache du fil : ce que ce worker
 * mémorise (le lien le plus récent par source) est une bookkeeping purement
 * native, à l'usage exclusif du prochain réveil — la vraie source de vérité
 * reste côté web, reconstruite au prochain vrai chargement.
 */
public class NewsCheckWorker extends Worker {

    static final String PREFS_NAME = "background_news";
    static final String KEY_ENABLED = "enabled";
    static final String KEY_FEEDS = "feeds";

    private static final String WORK_NAME = "news-check";
    private static final String CHANNEL_ID = "news-check";
    private static final int NOTIF_ID = 1001;

    /** Cadence volontairement large : un réveil trop fréquent coûte batterie et
     *  données pour un signal qui n'a pas besoin d'être instantané — la reprise
     *  de lecture au premier plan reste le chemin rapide. */
    private static final long INTERVAL_HOURS = 3;

    /** Plafond de sources vérifiées par réveil, même raison que MAX_FEEDS_PER_LOAD
     *  côté web (voir CONFIG dans index.html) : un OPML de centaines de sources
     *  ne doit pas transformer un réveil en minutes de réseau. Les sources
     *  au-delà gardent simplement leur dernier lien connu jusqu'au réveil suivant. */
    private static final int MAX_FEEDS = 40;

    private static final int CONNECT_TIMEOUT_MS = 8000;
    private static final int READ_TIMEOUT_MS = 8000;
    /** Budget total de lecture/analyse PAR source : une réponse lente qui ne
     *  timeout jamais franchement (flux qui égoutte ses octets) ne doit pas
     *  immobiliser tout le réveil. */
    private static final long PARSE_BUDGET_MS = 6000;

    /** Tirage du titre/corps de la notification (voir postNotification) — pas
     *  besoin d'aléatoire cryptographique pour une variété cosmétique. */
    private static final Random RANDOM = new Random();

    public NewsCheckWorker(@NonNull Context context, @NonNull WorkerParameters params) {
        super(context, params);
    }

    public static void schedule(Context context) {
        Constraints constraints = new Constraints.Builder()
            .setRequiredNetworkType(NetworkType.CONNECTED)
            .build();
        PeriodicWorkRequest request = new PeriodicWorkRequest.Builder(
                NewsCheckWorker.class, INTERVAL_HOURS, TimeUnit.HOURS)
            .setConstraints(constraints)
            .build();
        // KEEP : un appel répété (plusieurs allers-retours du réglage) ne doit
        // pas remettre le compteur de la période à zéro à chaque fois.
        WorkManager.getInstance(context)
            .enqueueUniquePeriodicWork(WORK_NAME, ExistingPeriodicWorkPolicy.KEEP, request);
    }

    public static void cancel(Context context) {
        WorkManager.getInstance(context).cancelUniqueWork(WORK_NAME);
    }

    @NonNull
    @Override
    public Result doWork() {
        Context ctx = getApplicationContext();
        SharedPreferences prefs = ctx.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        // Double garde avec schedule()/cancel() : un réglage désactivé entre la
        // programmation et ce réveil (l'utilisateur a redécoché entre-temps, ou
        // l'annulation d'un ancien réveil en vol a raté) ne doit rien envoyer.
        if (!prefs.getBoolean(KEY_ENABLED, false)) return Result.success();

        JSONArray feeds;
        try {
            feeds = new JSONArray(prefs.getString(KEY_FEEDS, "[]"));
        } catch (JSONException e) {
            return Result.success();
        }
        if (feeds.length() == 0) return Result.success();

        int newCount = 0;
        String firstNewName = null;
        String firstNewTitle = null;
        JSONArray updated = new JSONArray();
        int checkedMax = Math.min(feeds.length(), MAX_FEEDS);

        for (int i = 0; i < feeds.length(); i++) {
            JSONObject f = feeds.optJSONObject(i);
            if (f == null) continue;
            String url = f.optString("url", "");
            String name = f.optString("name", "");
            String knownLink = f.optString("link", "");

            if (url.isEmpty() || i >= checkedMax) {
                updated.put(f);   // hors budget de ce réveil, ou entrée illisible : inchangé
                continue;
            }

            Head head;
            try {
                head = fetchNewestHead(url);
            } catch (Exception e) {
                updated.put(f);   // échec ponctuel : on retentera au prochain réveil
                continue;
            }
            String freshLink = head == null ? null : head.link;
            if (freshLink == null || freshLink.isEmpty()) {
                updated.put(f);
                continue;
            }
            // knownLink vide : pas encore de repère (tout juste synchronisé
            // depuis le web) — on POSE le repère, sans jamais notifier sur cette
            // première mesure : ce serait annoncer comme neuf un article que
            // l'utilisateur a justement sous les yeux dans le fil déjà affiché.
            if (!knownLink.isEmpty() && !knownLink.equals(freshLink)) {
                newCount++;
                if (firstNewName == null) {
                    firstNewName = name;
                    firstNewTitle = head.title;   // voir le rôle du titre en tête de fichier
                }
            }
            JSONObject nf = new JSONObject();
            try {
                nf.put("url", url);
                nf.put("name", name);
                nf.put("link", freshLink);
                updated.put(nf);
            } catch (JSONException e) {
                updated.put(f);
            }
        }

        prefs.edit().putString(KEY_FEEDS, updated.toString()).apply();
        if (newCount > 0) postNotification(ctx, newCount, firstNewName, firstNewTitle);
        return Result.success();
    }

    /** Lien ET titre du premier {@code <item>}/{@code <entry>} du flux — le
     *  plus récent, par convention (le fil lui-même trie ensuite par date,
     *  mais ici on ne veut qu'un signal de changement, pas un ordre). */
    private static final class Head {
        final String link;
        final String title;
        Head(String link, String title) { this.link = link; this.title = title; }
    }

    private static Head fetchNewestHead(String urlStr) throws IOException {
        HttpURLConnection conn = (HttpURLConnection) new URL(urlStr).openConnection();
        conn.setConnectTimeout(CONNECT_TIMEOUT_MS);
        conn.setReadTimeout(READ_TIMEOUT_MS);
        conn.setInstanceFollowRedirects(true);
        conn.setRequestProperty("User-Agent", "SwiperNews (background check)");
        try {
            int code = conn.getResponseCode();
            if (code < 200 || code >= 300) return null;
            try (InputStream in = new BufferedInputStream(conn.getInputStream())) {
                return parseFirstHead(in);
            }
        } finally {
            conn.disconnect();
        }
    }

    private static Head parseFirstHead(InputStream in) throws IOException {
        long deadline = System.currentTimeMillis() + PARSE_BUDGET_MS;
        try {
            XmlPullParser parser = Xml.newPullParser();
            parser.setFeature(XmlPullParser.FEATURE_PROCESS_NAMESPACES, false);
            parser.setInput(in, null);
            int itemDepth = -1;   // profondeur du item/entry trouvé, -1 = pas encore
            String link = null;
            String title = null;
            int event = parser.next();
            while (event != XmlPullParser.END_DOCUMENT) {
                if (System.currentTimeMillis() > deadline) break;
                if (event == XmlPullParser.START_TAG) {
                    String tag = parser.getName();
                    if (itemDepth < 0 && ("item".equals(tag) || "entry".equals(tag))) {
                        itemDepth = parser.getDepth();
                    } else if (itemDepth >= 0 && link == null && "link".equals(tag)) {
                        // Atom : href en attribut. RSS : le lien est le texte de l'élément.
                        String href = parser.getAttributeValue(null, "href");
                        if (href != null && !href.isEmpty()) {
                            link = href;
                        } else if (parser.next() == XmlPullParser.TEXT) {
                            String text = parser.getText();
                            if (text != null && !text.trim().isEmpty()) link = text.trim();
                            continue;   // TEXT déjà consommé ci-dessus
                        }
                    } else if (itemDepth >= 0 && title == null && "title".equals(tag)) {
                        // Même position dans l'arbre en RSS et en Atom : texte de
                        // l'élément, jamais un attribut — pas de variante href ici.
                        if (parser.next() == XmlPullParser.TEXT) {
                            String text = parser.getText();
                            if (text != null && !text.trim().isEmpty()) title = text.trim();
                            continue;   // TEXT déjà consommé ci-dessus
                        }
                    }
                } else if (event == XmlPullParser.END_TAG && itemDepth >= 0
                    && parser.getDepth() == itemDepth
                    && ("item".equals(parser.getName()) || "entry".equals(parser.getName()))) {
                    break;   // premier item/entry entièrement lu
                }
                event = parser.next();
            }
            return new Head(link, title);
        } catch (Exception e) {
            return null;   // XML mal formé : pas une panne du réveil, juste rien à en tirer
        }
    }

    /** Coupe un titre trop long avant de l'insérer dans la notification — un
     *  {@code <title>} RSS n'a aucune limite de taille garantie, et un pavé de
     *  texte dans une notification en collapsed masquerait tout le reste. */
    private static String clampTitle(String title) {
        final int MAX = 80;
        String t = title.trim();
        if (t.length() <= MAX) return t;
        return t.substring(0, MAX).trim() + "…";
    }

    private void postNotification(Context ctx, int count, String firstName, String firstTitle) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU
            && ContextCompat.checkSelfPermission(ctx, Manifest.permission.POST_NOTIFICATIONS)
                != PackageManager.PERMISSION_GRANTED) {
            return;   // permission révoquée depuis les réglages système entre-temps
        }
        NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm == null) return;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = nm.getNotificationChannel(CHANNEL_ID);
            if (channel == null) {
                channel = new NotificationChannel(CHANNEL_ID,
                    ctx.getString(R.string.notif_channel_name), NotificationManager.IMPORTANCE_DEFAULT);
                channel.setDescription(ctx.getString(R.string.notif_channel_desc));
                nm.createNotificationChannel(channel);
            }
        }
        Intent launch = new Intent(ctx, MainActivity.class);
        launch.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE;
        PendingIntent pi = PendingIntent.getActivity(ctx, 0, launch, flags);
        boolean one = count == 1 && firstName != null && !firstName.isEmpty();
        // Un titre RSS manque rarement, mais un flux malformé ne doit jamais
        // empêcher la notification de partir (même principe que « aucune
        // donnée locale ne doit pouvoir empêcher le fil de se charger », côté
        // web) — repli sur les variantes SANS titre quand il est absent.
        boolean hasTitle = firstTitle != null && !firstTitle.trim().isEmpty();
        // Titre ET corps tirés au sort à chaque envoi : voir strings.xml
        // (notif_titles/notif_bodies_*) pour la raison — purement cosmétique,
        // ne change jamais ce qui est annoncé.
        String title = pickRandom(ctx, R.array.notif_titles);
        String bodyTemplate;
        String body;
        if (one) {
            bodyTemplate = pickRandom(ctx, hasTitle ? R.array.notif_bodies_one_titled : R.array.notif_bodies_one);
            body = hasTitle
                ? String.format(Locale.getDefault(), bodyTemplate, firstName, clampTitle(firstTitle))
                : String.format(Locale.getDefault(), bodyTemplate, firstName);
        } else {
            bodyTemplate = pickRandom(ctx, hasTitle ? R.array.notif_bodies_many_titled : R.array.notif_bodies_many);
            body = hasTitle
                ? String.format(Locale.getDefault(), bodyTemplate, count, clampTitle(firstTitle))
                : String.format(Locale.getDefault(), bodyTemplate, count);
        }
        Notification notification = new NotificationCompat.Builder(ctx, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle(title)
            .setContentText(body)
            // Un titre d'article peut dépasser la ligne unique du corps
            // collapsed : BigTextStyle le rend lisible en entier une fois la
            // notification dépliée, sans rien changer à la forme repliée.
            .setStyle(new NotificationCompat.BigTextStyle().bigText(body))
            .setAutoCancel(true)
            .setContentIntent(pi)
            .build();
        nm.notify(NOTIF_ID, notification);
    }

    private static String pickRandom(Context ctx, int arrayResId) {
        String[] items = ctx.getResources().getStringArray(arrayResId);
        return items[RANDOM.nextInt(items.length)];
    }
}
