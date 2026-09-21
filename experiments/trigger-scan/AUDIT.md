# Were we using Jev correctly?

Checked 2026-09-20 against the live TypeSafe docs (jev-1.13) and by re-running with changes.
Short answer: the API calls were fine; the question design, the unit being judged, and the scoring were not.

## What was wrong

1. **The scoring, not the model, produced "Jev over-flags".** The reference list touches 39 of the 60
   windows, and Jev flagged 39. Comparing whole 60-120 s windows with tightly bounded reference scenes
   made correct flags look like 25 wasted minutes. `analyze-windows.js` scores every analyzer on the
   same windows instead.
2. **A flagged window was treated as the scene.** The docs localise with line ids and per-item
   questions (`cookbooks/semantic_find`, `cookbooks/autoformat`). We asked once per 11-46 lines, so a
   20 s event flagged up to 120 s and a short scary stretch inside a calm window was diluted.
3. **Questions named a topic or a standing state, not a present event.** Jev "answers the question you
   wrote, not the one you meant" (jaggedness page). "Is a child forcibly taken from a parent" is
   literally true of a father *saying* "my son was taken from me"; "held captive and wants to get
   out" is literally true of fish calmly planning a tank escape. Only one of the 13 questions
   excluded retold danger.
4. **One severity Score mixed several dimensions and was used as a hard gate.** The Score page says
   "Keep each Score question to one dimension". Ours mixed duration, content type and a predicted
   child reaction; its median confidence was 0.61, and the gate blocked real scenes with sparse
   dialogue (the fishing net is mostly "Swim down!").
5. **Bundled questions.** "Ask one yes/no question per Noul" (Noul page). Separation bundled three
   propositions and death four.
6. **0.5 as the act-on threshold.** Cookbooks act at 0.7-0.85 and treat 0.3-0.7 as uncertain. In our
   run labels at 0.5-0.7 were right 46% of the time, at 0.7+ 69%.

## What was not the problem (tested)

Removing the glossary, removing the previous-window lines, and stripping cue ids/timestamps each
changed results by noise only (`ablations/`, `node compare.js ablations`). Many questions per request
do not degrade each other per the docs; we used ~3k of 64k tokens.

## v2 (`run-jev-v2.js`)

One request per window; code cuts it into beats of at most 8 cues and asks 21 narrow present-tense
yes/no questions per beat by path (`beats[2].lines`), plus two single-dimension Scores (threat,
distress) and a "being retold" companion question that vetoes the present-event categories in code.
Sound captions are pulled out by regex and judged on their own. Code maps the atoms onto the 12
categories, flags a beat, and merges neighbouring flagged beats.

| | v1 windows | v2 beats | Sonnet whole transcript |
|---|---|---|---|
| Reference scenes found | 85% | 96% | 78% |
| Serious scenes found | 81% | 94% | 81% |
| Minutes flagged (reference list: 37) | 56 | 33 | 29 |
| Share of flagged time inside reference scenes | 53% | 69% | 90% |
| Calm controls flagged (of 6) | 3 | 2 | 0 |
| Category labels right / found | 58% / 76% | 48% / 77% | 86% / 69% |
| Same result twice | 93% | 94% | 70% |
| Cost, time per film | $0.009, 2 s | $0.014, 3 s | $0.22, 129 s |

Still weak in v2: category labels. Narrow literal questions still fire on innocent matches ("Dad, you
can go now" reads as a companion being told to leave). Fixing that needs per-question thresholds
tuned on films other than the one being scored; every number here comes from one film whose
reference list was drafted by Claude and not yet reviewed by a person.

## Extending Jev further (tested on Finding Nemo, 2026-09-20)

| Step moved to Jev | How | Result | Verdict |
|---|---|---|---|
| Scene-cut detection | one Choice per window over line ids: "after which line does the film cut to different characters in a different place?" (`--cuts`) | 20 cuts in 19 of 60 windows, most of them real scene changes; missed the known problem case by two lines; scene and label scores unchanged (labels right 38% vs 40%) | plausible for cleaner scene boundaries, no measurable gain yet; one cut per window is a limit |
| Severity per age band | two Scores per beat with situation-based levels for 5-7 and 8-10 (`--bands`) | error vs reference 0.70 (5-7 scale) and 0.59 (old threat/distress); Sonnet 0.46. Correlation with the reference: Jev 0.45, Sonnet 0.50. Jev's scores bunch between 1.4 and 2.5 | coarse ordering only; keep severity with the language model. Both correlate weakly, so the unreviewed reference severities are part of the problem |
| Search keywords | code extracts candidate words from the scene's lines, one Noul per word | finds "sharks", "jellyfish", "whale" when spoken; cannot produce words nobody says (barracuda, anglerfish, pelican, net); picks noise ("clearly", "beer", "hair") | not viable; derive keywords from attribute labels in code and let the language model add the rest |
| Checking generated descriptions | Noul: is the summary consistent with the lines? | marks nearly every description unsupported because descriptions name characters the lines never name; the known-bad one was not in the bottom ten | not viable as designed |
| Attribute labels | per-attribute thresholds | needs several films to tune and test; reference lists for Lion King, Iron Giant, Monsters Inc., Frankenweenie being drafted | open: the one extension that would remove the language model from labelling |

> **Warning, 2026-09-20:** an independent review (CODEX-REVIEW.md) showed the "labels right" figures in this file are not a valid precision measure. One prediction spanning a whole film and carrying every label scores 99% right / 100% found, because found labels are counted per reference label while false ones are counted per run of predictions, and over-long predictions are not penalised. Sparse scene lists (Sonnet) are also under-penalised relative to dense beat sequences (Jev): with a 10 s gap rule Sonnet drops from 55% to 51% (attributes) and 68% to 63% (groups). The ranking Sonnet > Jev survives; the absolute numbers, and the conclusion "Jev cannot label", do not. Treat label results as "this Jev beat-labelling setup scores poorly against Claude-drafted references".

## Four more films (2026-09-20): The Lion King, The Iron Giant, Monsters, Inc., Frankenweenie

Nothing was tuned on these films except where stated; reference lists in `gold/<slug>.json` were drafted
by Claude agents that were barred from seeing model output, and have not been reviewed by a person.
Subtitles are the tracks stored in the app database. Scripts: `run-jev-v2.js --film <slug> --taxonomy
universal`, `build-scenes.js`, `tune-labels.js`.

**Finding scenes generalises.** Jev alone found 123 of 132 reference scenes (93%) and 86 of 90 serious
ones, at about $0.03 and 3 s per film. It also flagged 8 of 20 calm control stretches, and only about
half of its flagged time falls inside a reference scene. Passing its flagged stretches to Sonnet keeps
88% of scenes, drops the calm controls to 3 of 20, and costs $0.13-0.20 per film.

**Jev cannot do the attribute labels.** Leave-one-film-out, 53 attributes, 344 reference labels:

| Labels from | Right | Found | F1 |
|---|---|---|---|
| Jev, fixed threshold 0.5 | 20% | 55% | 30% |
| Jev, fixed threshold 0.7 | 30% | 36% | 33% |
| Jev, one threshold per attribute (tuned on the other films) | 29% | 47% | 36% |
| Sonnet, labelling Jev's flagged stretches | 58% | 54% | 56% |

Per-attribute thresholds add about 3 points. Only "character distress" is usable from Jev (60% right,
73% found); creatures, dark/startle and hostility produce mostly false labels. Sonnet's 58% / 54% on this
strict measure is itself a warning that 53 fine-grained attributes are hard to agree on; the reference
lists' own "least sure" notes are mostly about which attribute id fits.

### Update: fifth film (The Wild Robot) and scoring at group level

All five unseen films together (161 reference scenes, 109 serious, 25 calm controls, 415 reference labels):

| | Jev alone | Jev, then Sonnet on the flagged stretches |
|---|---|---|
| Reference scenes found | 91% (147) | 86% (139) |
| Serious scenes found (of 109) | 104 | 101 |
| Calm controls flagged (of 25) | 8 | 3 |
| Labels right / found, 53 attributes | 27% / 44% | 55% / 53% |
| Labels right / found, 13 groups | 34% / 62% | 68% / 64% |
| Cost per film | about $0.03 | $0.16-0.24 |

- Scoring on the 13 parent-facing groups instead of the 53 attributes lifts Sonnet from F1 54% to 66% and
  Jev from 33% to 44%. Much of the 53-attribute error is disagreement about which fine-grained id fits,
  so the groups are the right grain for a parent's filter; keep the 53 as detail underneath.
- Jev stays unusable for labels at either grain. At group level only character distress (65% right,
  79% found) and hostility (46% / 84%) are close; dark/startle (15% right), animals (18%) and copyable
  risk (11%) are mostly false.
- The Wild Robot, the film the models know least, scored lowest for everyone: Sonnet's labels 42% right /
  48% found (other films 48-68% / 46-65%), Jev's 15% / 41%, scenes found 24 of 29. Either knowing a film
  helps Sonnet more than the subtitles do, or that film's reference list is weaker (its drafter said it
  knew the film less well). This cannot be separated without a human-reviewed list.
