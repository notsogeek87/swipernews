#!/usr/bin/env bash
# Vérifications rapides SwiperNews. Continue après un échec, résume à la fin.
cd "$(git rev-parse --show-toplevel)" || exit 1
fail=()
run() { local n=$1; shift; echo "== $n"; "$@" >/tmp/verif.$$ 2>&1 && echo "ok" || { tail -25 /tmp/verif.$$; fail+=("$n"); }; }
run tests npm test
run lint npm run lint
run format npm run format:check
tmp=$(mktemp -d)
node -e 'const fs=require("fs"),h=fs.readFileSync("index.html","utf8");
const re=/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g;let m,i=0;
while((m=re.exec(h)))fs.writeFileSync(process.argv[1]+"/chk"+(++i)+".js",m[1]);' "$tmp"
for f in "$tmp"/chk*.js; do run "syntaxe $(basename $f)" node --check "$f"; done
run version bash .claude/skills/swipernews-bump/scripts/check.sh
rm -rf "$tmp" /tmp/verif.$$
echo; [ ${#fail[@]} = 0 ] && echo "TOUT OK" || { echo "ÉCHECS: ${fail[*]}"; exit 1; }
