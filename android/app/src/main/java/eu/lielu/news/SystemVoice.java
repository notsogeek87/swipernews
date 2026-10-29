package eu.lielu.news;

import android.speech.tts.TextToSpeech;
import android.speech.tts.Voice;

import java.util.Locale;
import java.util.Set;

/**
 * Choix d'une voix PRÉCISE du moteur de synthèse du système (Samsung, Google…).
 * Sans cela, {@code setLanguage} laisse le moteur prendre sa voix par défaut pour la
 * langue, souvent la même quel que soit le nombre de voix installées.
 */
final class SystemVoice {
    private SystemVoice() { }

    /**
     * Fixe la voix {@code name} si le moteur la connaît. À appeler APRÈS
     * {@code setLanguage}, qui remet la voix par défaut de la langue. Un nom vide ou
     * inconnu ne change rien : la voix par défaut sert, jamais un silence.
     */
    static void apply(TextToSpeech tts, String name) {
        if (tts == null || name == null || name.isEmpty()) return;
        try {
            Set<Voice> all = tts.getVoices();
            if (all == null) return;
            for (Voice v : all) {
                if (name.equals(v.getName())) {
                    tts.setVoice(v);
                    return;
                }
            }
        } catch (RuntimeException e) {
            // Certains moteurs lèvent sur getVoices() : on garde la voix par défaut.
        }
    }

    /** Voix de la langue demandée, triées par nom : sans doublon, ni nom exotique pour la page. */
    static java.util.List<Voice> forLanguage(TextToSpeech tts, String tag) {
        java.util.List<Voice> out = new java.util.ArrayList<>();
        if (tts == null) return out;
        final String wanted = Locale.forLanguageTag(tag).getLanguage();
        try {
            Set<Voice> all = tts.getVoices();
            if (all == null) return out;
            for (Voice v : all) {
                if (v.getLocale() != null && wanted.equals(v.getLocale().getLanguage())
                    && v.getName() != null && v.getName().matches("[A-Za-z0-9_.\\-]{1,80}")) {
                    out.add(v);
                }
            }
        } catch (RuntimeException e) {
            return new java.util.ArrayList<>();
        }
        java.util.Collections.sort(out, (a, b) -> a.getName().compareTo(b.getName()));
        return out;
    }
}
