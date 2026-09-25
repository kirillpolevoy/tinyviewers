#!/bin/bash
# v10.3 seen-film text run, step 4: the title pass (describe2.js --titles, Sonnet) for flagged scenes with a verified text
# and no verified title, its check (check-describe.js --attempt 3, Jev), and the merge -> whyfinal.
cd "$(dirname "$0")/.."
for slug in ${FILMS:-nemo monsters-inc lion-king frankenweenie wild-robot iron-giant up tangled coco how-to-train-your-dragon book-of-life princess-and-the-frog moana good-dinosaur frozen zootopia incredibles big-hero-6 brave}; do
  node eval/spend.mjs --need 0.04 || exit 3
  V103_OUT=out103/seen node describe2.js $slug --titles --cap 0.04 || echo "$slug titles exit $?"
  node eval/spend.mjs --need 0.03 || exit 3
  V103_OUT=out103/seen node check-describe.js $slug --cap 0.03 --attempt 3 || { echo "$slug checkdesc3 FAILED"; exit 1; }
  V103_OUT=out103/seen node describe2.js $slug --merge || exit 1
done
node eval/spend.mjs
