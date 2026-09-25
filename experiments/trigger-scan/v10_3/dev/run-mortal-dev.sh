#!/bin/bash
# v10.3 dev: mortal.js --dev on the 19 seen films' stored segmentations (out103/dev); every film checks the $2.00 cap first.
cd "$(dirname "$0")/.."
for pair in nemo:../v10/out monsters-inc:../v10/out lion-king:../v10/out frankenweenie:../v10/out wild-robot:../v10/out iron-giant:../v10/out up:../v10/out tangled:../v10/out coco:../v10/out how-to-train-your-dragon:../v10/out book-of-life:../v10/out princess-and-the-frog:../v10/out moana:../v10/out good-dinosaur:../v10_1/round7/gd-out frozen:../v10_1/out101 zootopia:../v10_1/out101 incredibles:../v10_2/out102 big-hero-6:../v10_2/out102 brave:../v10_2/out102; do
  slug=${pair%%:*}; dir=${pair#*:}
  [ -f out103/dev/$slug.mortal.r1.json ] && { echo "$slug: exists"; continue; }
  node eval/spend.mjs --need 0.04 || exit 3
  V103_OUT=out103/dev node mortal.js $slug --dev --in $dir --cap 0.04 || exit 1
done
node eval/spend.mjs
