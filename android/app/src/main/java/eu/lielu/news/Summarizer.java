package eu.lielu.news;

import android.os.Handler;
import android.os.Looper;

import java.io.File;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Résumé d'un article par un modèle LOCAL (GGUF, via llama.cpp, voir
 * {@code src/main/cpp}). Rien ne quitte l'appareil : le texte va de la WebView
 * au moteur, qui tourne dans le processus de l'app, et le résultat revient à
 * l'écran. Le modèle, lui, est un fichier que l'utilisateur a fourni (étape
 * suivante : téléchargement à sa demande ou import).
 *
 * Un seul fil de travail : charger un modèle puis générer est lent, et deux
 * générations simultanées se disputeraient la mémoire. Les rappels reviennent
 * sur le fil principal.
 *
 * La bibliothèque native peut manquer (architecture non construite) ou refuser
 * de se charger : {@link #isAvailable()} le dit, et l'app doit alors masquer le
 * bouton plutôt que de planter.
 */
public final class Summarizer {

    /** Rappels, toujours sur le fil principal. */
    public interface Listener {
        /**
         * Le résumé s'écrira en {@code count} parties, annoncé avant la première. Un article
         * court n'en a qu'une. Le texte des parties arrive par {@link #onText}, séparées
         * d'une ligne vide.
         */
        default void onPart(int index, int count) {}

        /** Un morceau de résumé de plus (à AJOUTER à ce qui est déjà affiché). */
        void onText(String piece);

        /** Terminé, ou interrompu par {@link #cancel()}. */
        void onDone(boolean cancelled);

        /** Échec : {@code code} est une des constantes ERR_*. */
        void onError(int code);
    }

    /** Reçoit les octets UTF-8 produits par le moteur (appelé depuis le C++). */
    interface Sink {
        boolean accept(byte[] utf8);
    }

    // À garder identiques à summarizer_jni.cpp.
    static final int RES_OK = 0;
    static final int RES_CANCELLED = 1;
    public static final int ERR_BAD_HANDLE = -1;
    public static final int ERR_TOO_LONG = -2;
    public static final int ERR_DECODE = -3;
    public static final int ERR_PROMPT = -4;
    /** Le fichier n'a pas pu être chargé comme modèle (ou plus de mémoire). */
    public static final int ERR_LOAD = -10;
    /** Pas de moteur natif sur cet appareil. */
    public static final int ERR_UNAVAILABLE = -11;

    /** Texte d'article envoyé au modèle en UN morceau, au plus (voir {@link #splitParts}). */
    static final int MAX_INPUT_CHARS = 4000;
    /**
     * Au-delà de MAX_INPUT_CHARS, l'article est découpé en parties d'environ cette taille,
     * résumées l'une après l'autre : la première s'affiche pendant que la suivante s'écrit.
     */
    static final int PART_CHARS = 3000;
    /** Nombre de parties au plus : au-delà, la fin de l'article est ignorée. */
    static final int MAX_PARTS = 4;
    /** Plafond de sécurité d'UNE partie (une cinquantaine de mots visés). */
    static final int MAX_NEW_TOKENS_PART = 180;
    /** Plafond du résumé court d'une vidéo (jetons) : une quarantaine de mots visés dans le prompt. */
    static final int MAX_NEW_TOKENS_BRIEF = 140;
    /**
     * Fenêtre de contexte demandée (jetons) : prompt + résumé. 4000 caractères de
     * français font environ 1200 jetons, plus le prompt système et 320 jetons de
     * résumé : 3072 laisse de la marge, sans payer la mémoire d'un contexte plus gros.
     */
    static final int N_CTX = 3072;
    /**
     * Plafond de sécurité du résumé (jetons). La longueur visée (une centaine de
     * mots, soit 10 à 15 lignes à l'écran) se demande dans le prompt ; ce plafond
     * n'est qu'un garde-fou contre un modèle qui ne s'arrête pas.
     */
    static final int MAX_NEW_TOKENS = 320;

    private static final boolean LIB_OK;

    static {
        boolean ok;
        try {
            // Contrôle AVANT le chargement : la bibliothèque arm64 est compilée avec
            // dotprod et fp16 (voir CMakeLists.txt), un processeur plus ancien la
            // chargerait sans broncher puis planterait à la première génération.
            ok = cpuCanRunBuild();
            if (ok) System.loadLibrary("swiperllm");
        } catch (Throwable t) {
            ok = false;
        }
        LIB_OK = ok;
    }

    /**
     * Vrai si ce processeur sait exécuter la bibliothèque native livrée. Seul le
     * cas arm64 64 bits est contraint (dotprod = « asimddp », fp16 = « asimdhp »
     * dans /proc/cpuinfo) ; les autres architectures sont compilées sans
     * extension particulière.
     */
    static boolean cpuCanRunBuild() {
        final boolean arm64 = android.os.Process.is64Bit()
            && android.os.Build.SUPPORTED_ABIS.length > 0
            && android.os.Build.SUPPORTED_ABIS[0].startsWith("arm64");
        if (!arm64) return true;
        try (java.io.BufferedReader r = new java.io.BufferedReader(
                new java.io.FileReader("/proc/cpuinfo"))) {
            String line;
            while ((line = r.readLine()) != null) {
                if (line.startsWith("Features")) {
                    final java.util.List<String> f = java.util.Arrays.asList(line.split("\\s+"));
                    return f.contains("asimddp") && f.contains("asimdhp");
                }
            }
        } catch (java.io.IOException e) {
            // illisible : mieux vaut masquer la fonction que risquer un plantage
        }
        return false;
    }

    private static native long nativeLoad(String path, int nCtx, int nThreads);

    private static native void nativeFree(long handle);

    private static native void nativeCancel();

    private static native int nativeGenerate(long handle, byte[] system, byte[] user, int maxNew,
                                             Sink sink);

    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private final Handler main = new Handler(Looper.getMainLooper());

    // Touchés uniquement depuis `worker`.
    private long handle;
    private String loadedPath;

    /** Génération courante : un rappel d'une demande dépassée est ignoré. */
    private volatile int gen;

    public static boolean isAvailable() {
        return LIB_OK;
    }

    /**
     * Résume {@code text} avec le modèle {@code model}. Annule la demande
     * précédente si elle tourne encore.
     *
     * @param lang "fr" ou "en" : langue du résumé demandé
     */
    public void summarize(File model, String title, String text, String lang, Listener l) {
        summarize(model, title, text, lang, false, l);
    }

    /**
     * @param brief résumé COURT d'une transcription de vidéo (une quarantaine de mots, une seule
     *              passe) : un oral se lit mal en 4 parties, et le texte est déjà condensé
     *              par {@link YoutubeTranscript#condense}
     */
    public void summarize(File model, String title, String text, String lang, boolean brief, Listener l) {
        if (!LIB_OK) {
            main.post(() -> l.onError(ERR_UNAVAILABLE));
            return;
        }
        final int my = ++gen;
        nativeCancel();
        final java.util.List<String> parts = splitParts(text);
        final boolean multi = parts.size() > 1 && !brief;
        final byte[] system = (brief ? videoSystemPrompt(lang) : multi ? partSystemPrompt(lang) : systemPrompt(lang))
            .getBytes(StandardCharsets.UTF_8);
        final String path = model.getAbsolutePath();
        worker.execute(() -> {
            if (my != gen) return;  // supplantée avant d'avoir commencé
            if (!ensureLoaded(path)) {
                post(my, () -> l.onError(ERR_LOAD));
                return;
            }
            final int count = parts.size();
            post(my, () -> l.onPart(0, count));
            // Vrai dès qu'une partie a écrit quelque chose : sert à séparer la suivante.
            final boolean[] wrote = {false};
            for (int i = 0; i < count; i++) {
                if (my != gen) return;
                final int index = i;
                if (index > 0) post(my, () -> l.onPart(index, count));
                final byte[] user = (multi
                    ? userPromptPart(title, parts.get(index), lang, index, count)
                    : userPrompt(title, parts.get(index), lang)).getBytes(StandardCharsets.UTF_8);
                wrote[0] = false;
                final int res = nativeGenerate(handle, system, user,
                    brief ? MAX_NEW_TOKENS_BRIEF : multi ? MAX_NEW_TOKENS_PART : MAX_NEW_TOKENS, bytes -> {
                        if (my != gen) return false;
                        String piece = new String(bytes, StandardCharsets.UTF_8);
                        if (!wrote[0]) {
                            // Début de partie : pas d'espace en tête, et une ligne vide
                            // entre deux parties.
                            piece = piece.replaceFirst("^\\s+", "");
                            if (piece.isEmpty()) return true;
                            wrote[0] = true;
                            if (index > 0) piece = "\n\n" + piece;
                        }
                        final String out = piece;
                        post(my, () -> l.onText(out));
                        return true;
                    });
                if (res == RES_CANCELLED) {
                    post(my, () -> l.onDone(true));
                    return;
                }
                if (res != RES_OK) {
                    // Une partie en échec n'efface pas celles déjà lues : on s'arrête là.
                    if (index == 0) post(my, () -> l.onError(res));
                    else post(my, () -> l.onDone(false));
                    return;
                }
            }
            post(my, () -> l.onDone(false));
        });
    }

    /**
     * Charge le modèle d'avance, sans rien générer : le chargement (centaines de Mo)
     * est la part la plus lente avant le premier mot, et se paie alors pendant que
     * l'utilisateur lit plutôt qu'après son appui. Sans effet si ce modèle est déjà
     * chargé. Passe par le même fil de travail : un résumé demandé entre-temps
     * attend simplement la fin du chargement, qu'il aurait dû faire lui-même.
     */
    public void warmUp(File model) {
        if (!LIB_OK || worker.isShutdown()) return;
        final String path = model.getAbsolutePath();
        try {
            worker.execute(() -> ensureLoaded(path));
        } catch (java.util.concurrent.RejectedExecutionException e) {
            // libéré entre le test et l'appel : rien à préchauffer
        }
    }

    /** Interrompt la génération en cours (sans libérer le modèle). */
    public void cancel() {
        gen++;
        nativeCancel();
    }

    /**
     * Libère le modèle (la mémoire qu'il occupe se compte en centaines de Mo) ET le
     * fil de travail : l'objet n'est plus utilisable ensuite.
     */
    public void release() {
        if (worker.isShutdown()) return;
        cancel();
        worker.execute(() -> {
            if (handle != 0) nativeFree(handle);
            handle = 0;
            loadedPath = null;
        });
        worker.shutdown();   // la libération ci-dessus s'exécute encore ; plus aucune demande ensuite
    }

    private boolean ensureLoaded(String path) {
        if (handle != 0 && path.equals(loadedPath)) return true;
        if (handle != 0) {
            nativeFree(handle);
            handle = 0;
            loadedPath = null;
        }
        final int threads = Math.max(2, Math.min(4, Runtime.getRuntime().availableProcessors() / 2));
        handle = nativeLoad(path, N_CTX, threads);
        if (handle == 0) return false;
        loadedPath = path;
        return true;
    }

    /** Ne remet au Java que si la demande est toujours la courante. */
    private void post(int my, Runnable r) {
        main.post(() -> {
            if (my == gen) r.run();
        });
    }

    static String systemPrompt(String lang) {
        if ("en".equals(lang)) {
            return "You summarize news articles. Write a faithful summary in English of about "
                + "100 words, in one or two short paragraphs (10 to 15 lines on a phone screen). "
                + "No list, no title. Use only what the article says: no opinion, no added fact.";
        }
        return "Tu résumes des articles de presse. Écris un résumé fidèle en français d'environ "
            + "100 mots, en un ou deux courts paragraphes (de 10 à 15 lignes sur un écran de "
            + "téléphone). Pas de liste, pas de titre. Appuie-toi uniquement sur l'article : "
            + "aucun avis, aucun fait ajouté.";
    }

    /** Consigne d'un résumé COURT de vidéo : ce qui est dit, en quelques phrases. */
    static String videoSystemPrompt(String lang) {
        if ("en".equals(lang)) {
            return "You summarize the transcript of a video. Write a faithful summary in English of "
                + "about 40 words, in one short paragraph of 2 or 3 sentences. No list, no title. "
                + "Use only what is said: no opinion, no added fact.";
        }
        return "Tu résumes la transcription d'une vidéo. Écris un résumé fidèle en français "
            + "d'environ 40 mots, en un seul court paragraphe de 2 ou 3 phrases. Pas de liste, "
            + "pas de titre. Appuie-toi uniquement sur ce qui est dit : aucun avis, aucun fait ajouté.";
    }

    /** Consigne d'une PARTIE d'un long article : plus courte, et sans conclure à la place de l'article. */
    static String partSystemPrompt(String lang) {
        if ("en".equals(lang)) {
            return "You summarize one passage of a news article. Write a faithful summary in "
                + "English of about 50 words, in one short paragraph. No list, no title. Use only "
                + "what the passage says: no opinion, no added fact, and do not conclude the article.";
        }
        return "Tu résumes un passage d'un article de presse. Écris un résumé fidèle en français "
            + "d'environ 50 mots, en un seul court paragraphe. Pas de liste, pas de titre. "
            + "Appuie-toi uniquement sur le passage : aucun avis, aucun fait ajouté, et ne conclus "
            + "pas l'article.";
    }

    static String userPromptPart(String title, String text, String lang, int index, int count) {
        final boolean en = "en".equals(lang);
        final StringBuilder sb = new StringBuilder();
        if (title != null && !title.trim().isEmpty()) {
            sb.append(en ? "Title: " : "Titre : ").append(title.trim()).append("\n\n");
        }
        sb.append(en ? "Passage " : "Passage ").append(index + 1).append(en ? " of " : " sur ")
            .append(count).append(" :\n").append(text.trim());
        sb.append(en ? "\n\nSummary of the passage:" : "\n\nRésumé du passage :");
        return sb.toString();
    }

    /**
     * Découpe l'article en parties à résumer une par une. Jusqu'à MAX_INPUT_CHARS : une seule,
     * comme avant. Au-delà : des parties d'égale taille (PART_CHARS environ, MAX_PARTS au plus),
     * coupées de préférence entre deux paragraphes, sinon entre deux phrases.
     */
    static java.util.List<String> splitParts(String text) {
        final java.util.List<String> out = new java.util.ArrayList<>();
        String body = text == null ? "" : text.trim();
        if (body.length() <= MAX_INPUT_CHARS) {
            out.add(body);
            return out;
        }
        final int cap = PART_CHARS * MAX_PARTS;
        if (body.length() > cap) {
            int cut = cap;
            if (Character.isHighSurrogate(body.charAt(cut - 1))) cut--;
            body = body.substring(0, cut);
        }
        final int n = Math.min(MAX_PARTS, (body.length() + PART_CHARS - 1) / PART_CHARS);
        final int target = (body.length() + n - 1) / n;
        int start = 0;
        for (int i = 0; i < n - 1; i++) {
            final int want = Math.min(body.length(), start + target);
            final int floor = start + target / 2;
            int end = body.lastIndexOf('\n', want);
            if (end < floor) end = body.lastIndexOf(". ", want) + 1;
            if (end < floor) {
                end = want;
                if (end < body.length() && Character.isHighSurrogate(body.charAt(end - 1))) end--;
            }
            final String part = body.substring(start, end).trim();
            if (!part.isEmpty()) out.add(part);
            start = end;
        }
        final String last = body.substring(start).trim();
        if (!last.isEmpty()) out.add(last);
        return out;
    }

    static String userPrompt(String title, String text, String lang) {
        String body = text == null ? "" : text.trim();
        if (body.length() > MAX_INPUT_CHARS) {
            // Ne pas couper au milieu d'une paire de substitution (emoji).
            int cut = MAX_INPUT_CHARS;
            if (Character.isHighSurrogate(body.charAt(cut - 1))) cut--;
            body = body.substring(0, cut);
        }
        final boolean en = "en".equals(lang);
        final StringBuilder sb = new StringBuilder();
        if (title != null && !title.trim().isEmpty()) {
            sb.append(en ? "Title: " : "Titre : ").append(title.trim()).append("\n\n");
        }
        sb.append(en ? "Article:\n" : "Article :\n").append(body);
        sb.append(en ? "\n\nSummary:" : "\n\nRésumé :");
        return sb.toString();
    }
}
