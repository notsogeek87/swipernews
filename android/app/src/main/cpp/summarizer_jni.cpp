// Pont JNI entre Summarizer.java et llama.cpp.
//
// Tout ce qui est texte traverse la frontière en OCTETS UTF-8 (byte[]), jamais
// en jstring : NewStringUTF attend de l'UTF-8 « modifié », où un emoji (4
// octets) n'est pas valide — CheckJNI abandonne alors le processus entier sur
// les appareils qui l'activent. Un byte[] décodé par new String(…, UTF_8) côté
// Java n'a pas ce défaut.
//
// Un seul moteur à la fois (Summarizer sérialise les appels sur un fil unique) :
// le drapeau d'annulation est donc global, ce qui permet de l'abaisser depuis
// n'importe quel fil sans tenir de poignée qui pourrait être libérée entre-temps.

#include <android/log.h>
#include <jni.h>

#include <algorithm>
#include <atomic>
#include <mutex>
#include <string>
#include <vector>

#include "llama.h"

#define TAG "SwiperLLM"
#define LOGI(...) __android_log_print(ANDROID_LOG_INFO, TAG, __VA_ARGS__)
#define LOGW(...) __android_log_print(ANDROID_LOG_WARN, TAG, __VA_ARGS__)
#define LOGE(...) __android_log_print(ANDROID_LOG_ERROR, TAG, __VA_ARGS__)

namespace {

// Codes de retour de nativeGenerate — à garder identiques à Summarizer.java.
constexpr jint RES_OK = 0;
constexpr jint RES_CANCELLED = 1;
constexpr jint ERR_BAD_HANDLE = -1;
constexpr jint ERR_TOO_LONG = -2;
constexpr jint ERR_DECODE = -3;
constexpr jint ERR_PROMPT = -4;

std::atomic<bool> g_cancel{false};
std::once_flag g_backend_once;

struct Engine {
    llama_model *model = nullptr;
    llama_context *ctx = nullptr;
    const llama_vocab *vocab = nullptr;
    int n_ctx = 0;
    int n_batch = 0;
};

void log_callback(ggml_log_level level, const char *text, void *) {
    int prio = ANDROID_LOG_DEBUG;
    if (level == GGML_LOG_LEVEL_ERROR) prio = ANDROID_LOG_ERROR;
    else if (level == GGML_LOG_LEVEL_WARN) prio = ANDROID_LOG_WARN;
    else if (level == GGML_LOG_LEVEL_INFO) prio = ANDROID_LOG_INFO;
    __android_log_write(prio, TAG, text);
}

bool abort_callback(void *) { return g_cancel.load(); }

std::string to_string(JNIEnv *env, jbyteArray arr) {
    if (!arr) return std::string();
    jsize len = env->GetArrayLength(arr);
    std::string out(static_cast<size_t>(len), '\0');
    if (len > 0) env->GetByteArrayRegion(arr, 0, len, reinterpret_cast<jbyte *>(&out[0]));
    return out;
}

// Plus long préfixe de `s` qui se termine sur une frontière de caractère UTF-8.
// Un jeton peut ne porter qu'un morceau d'emoji ou de lettre accentuée : on
// garde l'octet orphelin en attente plutôt que de le publier tronqué.
size_t utf8_complete_len(const std::string &s) {
    const size_t n = s.size();
    size_t i = n;
    for (int back = 0; i > 0 && back < 4; ++back) {
        const unsigned char c = static_cast<unsigned char>(s[i - 1]);
        if ((c & 0xC0) == 0x80) {  // octet de continuation : on remonte vers son octet de tête
            --i;
            continue;
        }
        const size_t need = c < 0x80 ? 1 : c >= 0xF0 ? 4 : c >= 0xE0 ? 3 : c >= 0xC0 ? 2 : 1;
        const size_t have = n - (i - 1);
        return have >= need ? n : i - 1;
    }
    return n;
}

// Publie des octets au Java ; rend faux si on doit s'arrêter (annulation, ou
// exception levée par le rappel).
bool emit(JNIEnv *env, jobject sink, jmethodID accept, const std::string &bytes) {
    if (bytes.empty()) return true;
    jbyteArray arr = env->NewByteArray(static_cast<jsize>(bytes.size()));
    if (!arr) return false;
    env->SetByteArrayRegion(arr, 0, static_cast<jsize>(bytes.size()),
                            reinterpret_cast<const jbyte *>(bytes.data()));
    const jboolean keep = env->CallBooleanMethod(sink, accept, arr);
    env->DeleteLocalRef(arr);
    if (env->ExceptionCheck()) {
        env->ExceptionClear();
        return false;
    }
    return keep == JNI_TRUE;
}

// Le prompt : le modèle porte son propre gabarit de conversation dans le GGUF.
// S'il n'en a pas (ou si le gabarit n'est pas reconnu par llama.cpp), on retombe
// sur un prompt brut — moins bon, mais jamais un résumé impossible.
bool build_prompt(const Engine &e, const std::string &system, const std::string &user,
                  std::string &out) {
    const char *tmpl = llama_model_chat_template(e.model, nullptr);
    if (tmpl) {
        const llama_chat_message msgs[2] = {{"system", system.c_str()}, {"user", user.c_str()}};
        std::vector<char> buf((system.size() + user.size()) * 2 + 512);
        int32_t n = llama_chat_apply_template(tmpl, msgs, 2, true, buf.data(),
                                              static_cast<int32_t>(buf.size()));
        if (n > static_cast<int32_t>(buf.size())) {
            buf.resize(static_cast<size_t>(n));
            n = llama_chat_apply_template(tmpl, msgs, 2, true, buf.data(),
                                          static_cast<int32_t>(buf.size()));
        }
        if (n > 0) {
            out.assign(buf.data(), static_cast<size_t>(n));
            return true;
        }
    }
    out = system + "\n\n" + user + "\n\n";
    return false;
}

}  // namespace

extern "C" {

JNIEXPORT jlong JNICALL Java_eu_lielu_news_Summarizer_nativeLoad(JNIEnv *env, jclass,
                                                                 jstring jpath, jint nCtx,
                                                                 jint nThreads) {
    std::call_once(g_backend_once, [] {
        llama_log_set(log_callback, nullptr);
        llama_backend_init();
    });

    const char *path = env->GetStringUTFChars(jpath, nullptr);
    if (!path) return 0;
    llama_model_params mp = llama_model_default_params();
    mp.n_gpu_layers = 0;  // CPU seul : pas de GPU dans ce build
    llama_model *model = llama_model_load_from_file(path, mp);
    env->ReleaseStringUTFChars(jpath, path);
    if (!model) {
        LOGE("modèle illisible");
        return 0;
    }

    llama_context_params cp = llama_context_default_params();
    cp.n_ctx = static_cast<uint32_t>(nCtx);
    cp.n_batch = std::min<uint32_t>(512, cp.n_ctx);
    cp.n_ubatch = cp.n_batch;
    cp.n_threads = nThreads;
    cp.n_threads_batch = nThreads;
    cp.no_perf = true;
    llama_context *ctx = llama_init_from_model(model, cp);
    if (!ctx) {
        LOGE("contexte non créé (mémoire insuffisante ?)");
        llama_model_free(model);
        return 0;
    }
    llama_set_abort_callback(ctx, abort_callback, nullptr);

    Engine *e = new Engine();
    e->model = model;
    e->ctx = ctx;
    e->vocab = llama_model_get_vocab(model);
    e->n_ctx = static_cast<int>(llama_n_ctx(ctx));
    e->n_batch = static_cast<int>(cp.n_batch);
    LOGI("modèle chargé, n_ctx=%d", e->n_ctx);
    return reinterpret_cast<jlong>(e);
}

JNIEXPORT void JNICALL Java_eu_lielu_news_Summarizer_nativeFree(JNIEnv *, jclass, jlong handle) {
    Engine *e = reinterpret_cast<Engine *>(handle);
    if (!e) return;
    if (e->ctx) llama_free(e->ctx);
    if (e->model) llama_model_free(e->model);
    delete e;
}

JNIEXPORT void JNICALL Java_eu_lielu_news_Summarizer_nativeCancel(JNIEnv *, jclass) {
    g_cancel.store(true);
}

JNIEXPORT jint JNICALL Java_eu_lielu_news_Summarizer_nativeGenerate(
    JNIEnv *env, jclass, jlong handle, jbyteArray jsystem, jbyteArray juser, jint maxNew,
    jobject sink) {
    Engine *e = reinterpret_cast<Engine *>(handle);
    if (!e || !e->ctx) return ERR_BAD_HANDLE;
    g_cancel.store(false);

    jclass sinkClass = env->GetObjectClass(sink);
    jmethodID accept = env->GetMethodID(sinkClass, "accept", "([B)Z");
    if (!accept) return ERR_PROMPT;

    std::string prompt;
    const bool templated = build_prompt(*e, to_string(env, jsystem), to_string(env, juser), prompt);

    // Un gabarit de chat écrit déjà le jeton de début de séquence quand le modèle
    // en veut un : l'ajouter une seconde fois dégrade la sortie.
    const bool add_special = !templated;
    int32_t n_tok = -llama_tokenize(e->vocab, prompt.c_str(), static_cast<int32_t>(prompt.size()),
                                    nullptr, 0, add_special, true);
    if (n_tok <= 0) return ERR_PROMPT;
    std::vector<llama_token> tokens(static_cast<size_t>(n_tok));
    if (llama_tokenize(e->vocab, prompt.c_str(), static_cast<int32_t>(prompt.size()),
                       tokens.data(), n_tok, add_special, true) < 0) {
        return ERR_PROMPT;
    }
    if (n_tok + maxNew > e->n_ctx) return ERR_TOO_LONG;

    // Chaque résumé repart d'un contexte vide.
    llama_memory_clear(llama_get_memory(e->ctx), true);

    // Lecture du prompt par tranches : un seul llama_decode n'accepte pas plus
    // de n_batch jetons.
    for (int32_t i = 0; i < n_tok; i += e->n_batch) {
        const int32_t n = std::min(e->n_batch, n_tok - i);
        if (llama_decode(e->ctx, llama_batch_get_one(tokens.data() + i, n)) != 0) {
            return g_cancel.load() ? RES_CANCELLED : ERR_DECODE;
        }
        if (g_cancel.load()) return RES_CANCELLED;
    }

    // Échantillonnage peu créatif : un résumé doit coller au texte, pas broder.
    llama_sampler *smpl = llama_sampler_chain_init(llama_sampler_chain_default_params());
    llama_sampler_chain_add(smpl, llama_sampler_init_top_k(40));
    llama_sampler_chain_add(smpl, llama_sampler_init_top_p(0.9f, 1));
    llama_sampler_chain_add(smpl, llama_sampler_init_temp(0.3f));
    llama_sampler_chain_add(smpl, llama_sampler_init_dist(LLAMA_DEFAULT_SEED));

    jint result = RES_OK;
    std::string pending;
    char piece[256];
    for (int i = 0; i < maxNew; ++i) {
        if (g_cancel.load()) {
            result = RES_CANCELLED;
            break;
        }
        llama_token tok = llama_sampler_sample(smpl, e->ctx, -1);
        if (llama_vocab_is_eog(e->vocab, tok)) break;

        const int32_t len = llama_token_to_piece(e->vocab, tok, piece, sizeof(piece), 0, false);
        if (len > 0) pending.append(piece, static_cast<size_t>(len));
        const size_t ok = utf8_complete_len(pending);
        if (ok > 0) {
            if (!emit(env, sink, accept, pending.substr(0, ok))) {
                result = RES_CANCELLED;
                break;
            }
            pending.erase(0, ok);
        }

        if (llama_decode(e->ctx, llama_batch_get_one(&tok, 1)) != 0) {
            result = g_cancel.load() ? RES_CANCELLED : ERR_DECODE;
            break;
        }
    }
    if (result == RES_OK && !pending.empty()) emit(env, sink, accept, pending);

    llama_sampler_free(smpl);
    return result;
}

}  // extern "C"
