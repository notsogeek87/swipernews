#!/usr/bin/env bash
# Vérifie la cohérence APP_VERSION / CACHE / ?v= (voir SKILL.md).
set -u
cd "$(git rev-parse --show-toplevel)"
app=$(grep -oP 'const APP_VERSION="\K[0-9]+' index.html)
cache=$(grep -oP 'CACHE = "flux-v\K[0-9]+' sw.js)
err=0
[ "$app" = "$cache" ] || { echo "ERREUR: APP_VERSION=$app mais CACHE=flux-v$cache"; err=1; }
changed=$(git diff --name-only HEAD -- src; git ls-files --others --exclude-standard -- src)
for f in $(grep -oP 'src="\Ksrc/[^"?]+(?=\?v=)' index.html); do
  v=$(grep -oP "src=\"$f\?v=\K[0-9]+" index.html)
  [ "$v" -le "$app" ] || { echo "ERREUR: $f?v=$v dépasse APP_VERSION=$app"; err=1; }
  if echo "$changed" | grep -qx "$f" && [ "$v" != "$app" ]; then
    echo "ERREUR: $f modifié mais ?v=$v (attendu $app)"; err=1
  fi
done
if git diff --quiet HEAD -- index.html src && [ -z "$changed" ]; then :; else
  old=$(git show HEAD:index.html | grep -oP 'const APP_VERSION="\K[0-9]+')
  [ "$app" -gt "$old" ] || { echo "ERREUR: index.html/src modifiés mais APP_VERSION n'a pas augmenté ($old)"; err=1; }
fi
[ $err = 0 ] && echo "OK: version $app cohérente"
exit $err
