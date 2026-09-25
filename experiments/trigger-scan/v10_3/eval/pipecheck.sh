#!/bin/bash
# v10.3 RUNTIME CHECK of the stage runner (not a measurement): run-film.js's stages from mortal to select3 on
# big-hero-6 (a dev film since round 8), starting from v10.2's as-run upstream outputs (segments, claims, fill, Jev
# classify answers, sonnetq, childcry, resolve) copied into out103/pipecheck. The $2.00 cap is checked before each
# stage against that stage's own worst-case cap.
cd "$(dirname "$0")/.."
for pair in mortal:0.04 select1:0 moments:0.02 select2:0 describe:0.15 checkdesc:0.08 describe2:0.12 checkdesc2:0.06 titles:0.04 checkdesc3:0.03 mergetext:0 select3:0; do
  st=${pair%%:*}; cap=${pair#*:}
  node eval/spend.mjs --need $cap >/dev/null || { echo "REFUSED at $st"; exit 3; }
  V103_OUT=out103/pipecheck node run-film.js big-hero-6 --from $st --to $st || { echo "stage $st FAILED"; exit 1; }
done
node eval/spend.mjs
