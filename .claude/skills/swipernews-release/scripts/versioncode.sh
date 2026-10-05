#!/usr/bin/env bash
# Usage : versioncode.sh X.Y.Z [--check]
# Affiche le versionCode (majeur×10^8 + mineur×10^6 + correctif×10^4).
# Avec --check : compare à android/app/build.gradle (valeurs en clair).
set -u
cd "$(git rev-parse --show-toplevel)"
[[ "${1:-}" =~ ^([0-9]+)\.([0-9]+)\.([0-9]+)$ ]] || { echo "usage: $0 X.Y.Z [--check]"; exit 2; }
code=$(( BASH_REMATCH[1]*100000000 + BASH_REMATCH[2]*1000000 + BASH_REMATCH[3]*10000 ))
echo "$code"
[ "${2:-}" = "--check" ] || exit 0
g=android/app/build.gradle
c=$(grep -oP '^\s*versionCode \K[0-9]+' $g | head -1)
n=$(grep -oP '^\s*versionName "\K[^"]+' $g | head -1)
err=0
[ "$c" = "$code" ] || { echo "ERREUR: build.gradle versionCode=$c, attendu $code"; err=1; }
[ "$n" = "$1" ]    || { echo "ERREUR: build.gradle versionName=$n, attendu $1"; err=1; }
[ $err = 0 ] && echo "OK: build.gradle aligné sur $1"
exit $err
