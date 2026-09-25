#!/bin/bash
# v10.3 seen-film text run, step 2: attempt 1 = describe.js (v10.2's, unchanged) on the flagged scenes prep-seen did
# not reuse, then check-describe.js (Jev) on every flagged scene, reusing v10.2's Jev answers for identical texts.
# The $2.00 v10.3 cap is checked before every model stage (worst case of the stage's own cap).
cd "$(dirname "$0")/.."
R8=" incredibles big-hero-6 brave "
for slug in nemo monsters-inc lion-king frankenweenie wild-robot iron-giant up tangled coco how-to-train-your-dragon book-of-life princess-and-the-frog moana good-dinosaur frozen zootopia incredibles big-hero-6 brave; do
  if [[ "$R8" == *" $slug "* ]]; then old=../v10_2/out102/$slug.why.r1.json; else old=../v10_2/out102/seen/$slug.why.r1.json; fi
  node eval/spend.mjs --need 0.15 || exit 3
  V103_OUT=out103/seen node describe.js $slug --resume --cap 0.15 || echo "$slug describe exit $?"
  node eval/spend.mjs --need 0.08 || exit 3
  V103_OUT=out103/seen node check-describe.js $slug --cap 0.08 --reuse-why $old || { echo "$slug checkdesc FAILED"; exit 1; }
done
node eval/spend.mjs
