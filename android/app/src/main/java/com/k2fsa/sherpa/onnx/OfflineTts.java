// Binding Java minimal de sherpa-onnx v1.12.0 (https://github.com/k2-fsa/sherpa-onnx,
// Apache License 2.0, Copyright (c) 2023 Xiaomi Corporation). Réécrit d'après
// kotlin-api/Tts.kt de cette version : le code natif (libsherpa-onnx-jni.so) lit
// ces classes PAR LEUR NOM ET LEURS CHAMPS, donc le paquet, les noms et les types
// ne doivent pas changer — ni être « nettoyés » — sans changer la version de la
// bibliothèque en même temps (voir android/app/build.gradle, tâche fetchSherpa).
package com.k2fsa.sherpa.onnx;

/**
 * Synthèse vocale neuronale hors ligne. Seul le chargement depuis un FICHIER est
 * exposé (newFromFile) : le modèle est téléchargé dans l'espace de l'app, jamais
 * embarqué dans l'APK, donc newFromAsset (qui demande un AssetManager) n'a pas
 * d'usage ici.
 *
 * <p>Non réentrant : un appel à la fois par instance (le phonémiseur espeak-ng
 * du code natif n'est pas sûr en concurrence) — voir NeuralSpeaker.
 */
public class OfflineTts {
    static {
        System.loadLibrary("sherpa-onnx-jni");
    }

    private long ptr;

    public OfflineTts(OfflineTtsConfig config) {
        ptr = newFromFile(config);
        if (ptr == 0L) throw new IllegalStateException("modèle de voix illisible");
    }

    public int sampleRate() {
        return getSampleRate(ptr);
    }

    public int numSpeakers() {
        return getNumSpeakers(ptr);
    }

    public GeneratedAudio generate(String text, int sid, float speed) {
        Object[] r = generateImpl(ptr, text, sid, speed);
        return new GeneratedAudio((float[]) r[0], (Integer) r[1]);
    }

    public void release() {
        if (ptr != 0L) {
            delete(ptr);
            ptr = 0L;
        }
    }

    private native long newFromFile(OfflineTtsConfig config);

    private native void delete(long ptr);

    private native int getSampleRate(long ptr);

    private native int getNumSpeakers(long ptr);

    private native Object[] generateImpl(long ptr, String text, int sid, float speed);
}
