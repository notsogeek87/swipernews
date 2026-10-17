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
# Un build qui doit tourner sur TOUS les téléphones, pas seulement celui de la
# CI : pas d'optimisation « native » (instructions de la machine hôte), et pas
# d'OpenMP (absent ou instable selon le NDK). Contrepartie assumée : on ne
# profite pas de dotprod/i8mm — plus lent, mais jamais d'instruction illégale.
set(GGML_NATIVE OFF CACHE BOOL "" FORCE)
set(GGML_OPENMP OFF CACHE BOOL "" FORCE)
set(GGML_LLAMAFILE OFF CACHE BOOL "" FORCE)

add_subdirectory(llama.cpp llama.cpp-build EXCLUDE_FROM_ALL)

add_library(swiperllm SHARED summarizer_jni.cpp)
target_include_directories(swiperllm PRIVATE llama.cpp/include llama.cpp/ggml/include)
target_link_libraries(swiperllm PRIVATE llama ggml android log)

# Android 15+ : pages mémoire de 16 Ko. Une bibliothèque alignée sur 4 Ko est
# refusée au chargement sur ces appareils, et par le Play Store à la publication.
target_link_options(swiperllm PRIVATE -Wl,-z,max-page-size=16384)
