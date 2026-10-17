cmake_minimum_required(VERSION 3.22.1)
project(swiperllm LANGUAGES C CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# llama.cpp, en sous-module épinglé sur un tag (voir .gitmodules). On ne
# construit que la bibliothèque : ni outils, ni serveur, ni exemples, ni tests,
# et aucun accès réseau (pas de libcurl, pas d'OpenSSL — le téléchargement du
# modèle est fait par le Java, pas par llama.cpp).
set(BUILD_SHARED_LIBS OFF CACHE BOOL "" FORCE)
set(LLAMA_BUILD_COMMON OFF CACHE BOOL "" FORCE)
set(LLAMA_BUILD_TESTS OFF CACHE BOOL "" FORCE)
set(LLAMA_BUILD_TOOLS OFF CACHE BOOL "" FORCE)
set(LLAMA_BUILD_EXAMPLES OFF CACHE BOOL "" FORCE)
set(LLAMA_BUILD_SERVER OFF CACHE BOOL "" FORCE)
set(LLAMA_BUILD_APP OFF CACHE BOOL "" FORCE)
set(LLAMA_OPENSSL OFF CACHE BOOL "" FORCE)
# Pas d'optimisation « native » (instructions de la machine hôte, ici celle de la
# CI), et pas d'OpenMP (absent ou instable selon le NDK). Les architectures
# autres qu'arm64 restent donc sur le jeu d'instructions de base ; arm64 reçoit
# son réglage explicite juste en dessous.
set(GGML_NATIVE OFF CACHE BOOL "" FORCE)
set(GGML_OPENMP OFF CACHE BOOL "" FORCE)
set(GGML_LLAMAFILE OFF CACHE BOOL "" FORCE)
# arm64 : produits dot (dotprod) et demi-précision (fp16), présents sur tous les
# processeurs ARM depuis 2018 (Cortex-A75/A55 et suivants). C'est le plus gros
# levier de vitesse : la lecture de l'article (le prompt) passe par des produits
# scalaires d'entiers que dotprod fait 4 par 4. Contrepartie : un processeur plus
# ancien lèverait « instruction illégale » — d'où le contrôle de /proc/cpuinfo
# dans Summarizer.java, AVANT de charger la bibliothèque. À garder synchronisés.
if(ANDROID_ABI STREQUAL "arm64-v8a")
    set(GGML_CPU_ARM_ARCH "armv8.2-a+dotprod+fp16" CACHE STRING "" FORCE)
endif()

add_subdirectory(llama.cpp llama.cpp-build EXCLUDE_FROM_ALL)

add_library(swiperllm SHARED summarizer_jni.cpp)
target_include_directories(swiperllm PRIVATE llama.cpp/include llama.cpp/ggml/include)
target_link_libraries(swiperllm PRIVATE llama ggml android log)

# Android 15+ : pages mémoire de 16 Ko. Une bibliothèque alignée sur 4 Ko est
# refusée au chargement sur ces appareils, et par le Play Store à la publication.
target_link_options(swiperllm PRIVATE -Wl,-z,max-page-size=16384)
