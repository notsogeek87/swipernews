// Binding Java minimal de sherpa-onnx v1.12.0 (https://github.com/k2-fsa/sherpa-onnx,
// Apache License 2.0, Copyright (c) 2023 Xiaomi Corporation). Réécrit d'après
// kotlin-api/Tts.kt de cette version : le code natif (libsherpa-onnx-jni.so) lit
// ces classes PAR LEUR NOM ET LEURS CHAMPS, donc le paquet, les noms et les types
// ne doivent pas changer — ni être « nettoyés » — sans changer la version de la
// bibliothèque en même temps (voir android/app/build.gradle, tâche fetchSherpa).
package com.k2fsa.sherpa.onnx;

public class OfflineTtsKokoroModelConfig {
    public String model = "";
    public String voices = "";
    public String tokens = "";
    public String dataDir = "";
    public String lexicon = "";
    public String dictDir = "";
    public float lengthScale = 1.0f;
}
