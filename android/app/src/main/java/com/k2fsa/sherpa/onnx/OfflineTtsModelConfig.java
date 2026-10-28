// Binding Java minimal de sherpa-onnx v1.12.7 (https://github.com/k2-fsa/sherpa-onnx,
// Apache License 2.0, Copyright (c) 2023 Xiaomi Corporation). Réécrit d'après
// kotlin-api/Tts.kt de cette version (1.12.7 : comme la 1.12.0, plus le champ « lang » de Kokoro) : le code natif (libsherpa-onnx-jni.so) lit
// ces classes PAR LEUR NOM ET LEURS CHAMPS, donc le paquet, les noms et les types
// ne doivent pas changer — ni être « nettoyés » — sans changer la version de la
// bibliothèque en même temps (voir android/app/build.gradle, tâche fetchSherpa).
package com.k2fsa.sherpa.onnx;

public class OfflineTtsModelConfig {
    public OfflineTtsVitsModelConfig vits = new OfflineTtsVitsModelConfig();
    public OfflineTtsMatchaModelConfig matcha = new OfflineTtsMatchaModelConfig();
    public OfflineTtsKokoroModelConfig kokoro = new OfflineTtsKokoroModelConfig();
    public int numThreads = 1;
    public boolean debug = false;
    public String provider = "cpu";
}
