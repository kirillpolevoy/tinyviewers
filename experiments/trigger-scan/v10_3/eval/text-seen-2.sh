#!/bin/bash
# v10.3 seen-film text run, step 3: the second attempt (describe2.js, Sonnet) on flagged scenes whose first text or title
# failed, its check (check-describe.js --attempt 2, Jev), and the merge (describe2.js --merge) -> whyfinal.
# The $2.00 v10.3 cap is checked before every model stage (worst case of the stage's own cap).
cd "$(dirname "$0")/.."
for slug in ${FILMS:-nemo monsters-inc lion-king frankenweenie wild-robot iron-giant up tangled coco how-to-train-your-dragon book-of-life princess-and-the-frog moana good-dinosaur frozen zootopia incredibles big-hero-6 brave}; do
  node eval/spend.mjs --need 0.12 || exit 3
  V103_OUT=out103/seen node describe2.js $slug --cap ${D2CAP:-0.12} || echo "$slug describe2 exit $?"
  node eval/spend.mjs --need 0.06 || exit 3
  V103_OUT=out103/seen node check-describe.js $slug --cap 0.06 --attempt 2 || { echo "$slug checkdesc2 FAILED"; exit 1; }
  V103_OUT=out103/seen node describe2.js $slug --merge || exit 1
done
node eval/spend.mjs
