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

    /**
     * Les voix à PROPOSER pour la langue demandée. Un moteur en déclare souvent des dizaines,
     * presque toutes inutiles à l'oreille : on écarte celles qui ne sont pas installées
     * (listées mais muettes), celles d'une autre région quand la région demandée en a
     * (fr-CA, fr-BE… face à fr-FR), et celles qui exigent le réseau dès qu'une voix locale
     * existe (l'écoute écran éteint ne doit pas dépendre de la connexion). Triées par
     * qualité décroissante puis par nom, de façon stable d'une ouverture à l'autre.
     */
    static java.util.List<Voice> forLanguage(TextToSpeech tts, String tag) {
        java.util.List<Voice> out = new java.util.ArrayList<>();
        if (tts == null) return out;
        final Locale want = Locale.forLanguageTag(tag);
        try {
            Set<Voice> all = tts.getVoices();
            if (all == null) return out;
            for (Voice v : all) {
                if (v.getLocale() == null || !want.getLanguage().equals(v.getLocale().getLanguage())) continue;
                if (v.getName() == null || !v.getName().matches("[A-Za-z0-9_.\\-]{1,80}")) continue;
                if (v.getFeatures() != null
                    && v.getFeatures().contains(TextToSpeech.Engine.KEY_FEATURE_NOT_INSTALLED)) continue;
                out.add(v);
            }
        } catch (RuntimeException e) {
            return new java.util.ArrayList<>();
        }
        // Même région que celle demandée, s'il y en a au moins une.
        boolean region = false;
        for (Voice v : out) if (want.getCountry().equals(v.getLocale().getCountry())) region = true;
        if (region && !want.getCountry().isEmpty()) {
            java.util.Iterator<Voice> it = out.iterator();
            while (it.hasNext()) if (!want.getCountry().equals(it.next().getLocale().getCountry())) it.remove();
        }
        // Voix locales de préférence aux voix réseau.
        boolean local = false;
        for (Voice v : out) if (!v.isNetworkConnectionRequired()) local = true;
        if (local) {
            java.util.Iterator<Voice> it = out.iterator();
            while (it.hasNext()) if (it.next().isNetworkConnectionRequired()) it.remove();
        }
        java.util.Collections.sort(out, (a, b) -> {
            int q = Integer.compare(b.getQuality(), a.getQuality());
            return q != 0 ? q : a.getName().compareTo(b.getName());
        });
        return out;
    }
}
