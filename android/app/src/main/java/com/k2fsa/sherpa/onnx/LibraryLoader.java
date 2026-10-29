package com.k2fsa.sherpa.onnx;

/**
 * Version Android : la bibliothèque native est empaquetée dans l'APK (jniLibs, voir
 * android/app/sherpa.gradle), donc System.loadLibrary suffit. L'original amont passe par LibraryUtils,
 * qui extrait la bibliothèque d'un jar pour le bureau : inutile et absent ici.
 */
public class LibraryLoader {
    private static volatile boolean autoLoadEnabled = true;
    private static volatile boolean isLoaded = false;

    static synchronized void loadLibrary() {
        if (!isLoaded) {
            System.loadLibrary("sherpa-onnx-jni");
            isLoaded = true;
        }
    }

    public static void setAutoLoadEnabled(boolean enabled) {
        autoLoadEnabled = enabled;
    }

    static void maybeLoad() {
        if (autoLoadEnabled) {
            loadLibrary();
        }
    }
}
