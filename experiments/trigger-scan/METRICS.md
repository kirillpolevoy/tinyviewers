# How analyzer output is scored (`score.js`, `rescore.js`)

Written after the Codex review showed the old label numbers were not a precision measure at all.
Everything here is computed from saved output; `node rescore.js` makes no model calls.

## The problem the old scorers had

`tune-labels.js` counted **found** labels per *reference label* but **false** labels per *run of
consecutive predictions*, and never charged anything for a prediction being too long. The two sides
of the fraction were not the same kind of thing, so breadth was free:

| Old measure | One prediction spanning a whole film, carrying every label |
|---|---|
| "right" (attributes) | 78% |
| "right" (groups) | 99% |
| "found" | 100% |

The false-positive counter also reset only on the *next array element*, so two Sonnet scenes minutes
apart could count as one false positive while Jev's intervening negative beats broke the run. That
penalised dense beat lists and flattered sparse scene lists. `compare.js` had the same weakness for
scene detection: any overlap counted as "found", so one broad flagged stretch could be credited with
nine reference scenes.

## The fix: everyone is scored on the same units

Every analyzer's output is normalised to `[{startMs, endMs, labels}]` and scored against the
reference list on a **fixed time grid** (default 5 s bins, `--bins <seconds>`). A bin is
reference-positive for a label if a reference scene carrying that label overlaps it, and
prediction-positive if a prediction carrying that label overlaps it. Precision, recall and F1 then
mean what they normally mean, and a prediction that is too long pays for every bin it is wrong in.

### The measures

1. **Time-grid label scoring** — per label, plus micro (bins pooled over labels) and macro (mean of
   per-label F1 over labels that have any reference positives). Reported at both grains: the 53
   attributes and the 12 parent-facing groups. (`sound` has no attributes, so it is not scorable —
   "13 groups" in AUDIT.md was always 12.)
2. **Any-trigger time grid** (`anyF1`) — the same grid with labels ignored: "is anything flagged
   here at all". This is the **breadth-proof headline for finding scenes**: scene recall alone can
   always be bought by flagging the whole film, but flagging the whole film costs precision here.
3. **Event-level detection with a coverage threshold** — a reference scene counts as found only if
   predictions cover at least a fraction *c* of its duration, swept over {any overlap, 0.25, 0.5}.
   Reported for all scenes and for serious ones (reference severity >= 2 in either age band: 111 of
   161 scenes; AUDIT.md's "109 serious" used the 5-7 band only).
4. **Overreach**, reported next to detection so recall can never be read alone: flagged minutes,
   share of flagged time that falls inside a reference scene, reference scenes per prediction (mean
   and max), and the longest single prediction. Computed both on the predictions as given and on
   their time-merged stretches.
5. **Calm-control hits** at overlap thresholds > 0 s, > 5 s and > 10 s. (`compare.js` only ever used
   > 10 s, which ignores a whole jump scare.)
6. **Severity agreement** on scenes a prediction overlaps: n, mean absolute error and Spearman rank
   correlation, per age band for the five films and on the single severity for Finding Nemo. Jev's
   number is its 0-3 threat score, which is not band-specific and not calibrated against the
   reference scale, so read its rank correlation and not its MAE.
7. **Text-visible labels only** — a separate run in which reference labels marked `visual_only`
   become don't-care bins rather than reference positives. They are not turned into negatives,
   because charging a subtitle-only system for missing something the subtitles never show, or for
   guessing it right, are both wrong. In group mode a group counts as visual-only only when *every*
   contributing attribute in that scene is visual-only; the old group mode silently deleted the
   visual-only lists, so its "text-only" figure was not text-only.

### Tolerance policy for fuzzy reference boundaries

Reference scene boundaries come from cue ids chosen by a Claude agent reading subtitles, so they are
good to a few seconds at best. With a margin of **N** seconds:

- only the **core** of a reference scene, `[start+N, end-N]`, is reference-positive;
- the **edge bands**, `[start-N, start+N]` and `[end-N, end+N]`, are **don't-care**: they count
  neither for nor against, unless they fall inside the core of another reference scene carrying the
  same label;
- a reference scene shorter than 2N therefore has no core and disappears from that label entirely.

This is symmetric: a prediction that runs a little past the edge is not charged a false positive,
and a prediction that stops a little short is not charged a false negative. N is swept over
{0, 5, 10, 15} seconds and every table reports the whole sweep, because the sweep is the honest
statement. The margin is not free: on the five films it erodes the reference from 1583 positive bins
to 1280 / 982 / 726 at N = 5 / 10 / 15, so at N = 15 more than half of the reference is gone and
every arm's precision falls, because the surviving reference is concentrated in long scenes while
the false positives elsewhere are untouched. **N = 0 is the headline** and the sweep is the
robustness check, not a knob to pick a flattering number from.

## Headline numbers

For finding scenes: **`anyF1`** (label-agnostic time grid, N = 0), read together with **flagged
minutes** and **share of flagged time inside a reference scene**. Reference scenes found at
**c >= 0.5** is the honest "did it find the scene" number; found at any overlap is reported but is
not a headline, because breadth buys it.

For labels: **micro F1 on the time grid at N = 0**, at both grains, with precision and recall shown.
Macro F1 is shown beside it because a handful of common attributes dominate the micro number.

## Mandatory sanity baselines

Any measure that a useless predictor wins is not fit for purpose, so four of them are scored
alongside every real arm in `rescore.js` and asserted in `score.test.js`:

(a) one prediction spanning the whole film carrying every label; (b) every beat flagged with every
label; (c) nothing flagged; (d) a random predictor matched to each real analyzer's flagged-time
share and per-label frequency (interval lengths bootstrapped from that analyzer, uniform random
placement, fixed seed, averaged over 20 draws).

On the five films pooled, at the attribute grain, they land at label F1 3%, 3%, 0% and 5%, against
23% for Jev and 33% for Jev+Sonnet; on `anyF1` they land at 46%, 45%, 0% and 32-36%, against 59% for
the Jev finder and 64% for Jev+Sonnet. Every real arm beats every baseline on both headline
measures. Baseline (a) still wins **scene recall at any coverage** (100%), which is exactly why
recall is not a headline on its own.

`anyF1` has a floor, and it must be quoted with it. Flagging everything scores
`2b / (1 + b)` where `b` is the reference's share of runtime: **46% on the five films** (b = 28%)
and **59% on Finding Nemo** (b = 40%). On Nemo the headroom above that floor is therefore small —
the real arms run 60-79% — so on Nemo the label measures and the overreach columns carry most of
the signal, not `anyF1`.

## Limits you must state with any number from this file

- **The references are Claude-drafted and not human-reviewed.** These are agreement scores with one
  model family's reading of the subtitles, not accuracy.
- **147 of the 415 reference labels on the five films are marked `visual_only`** — the subtitles do
  not show them. The default tables score them anyway; the text-visible-only tables are the fairer
  read for a subtitle-only system.
- **Many attributes have almost no examples.** Eleven have zero reference examples across the five
  films: `ghost_supernatural`, `uncanny_figures`, `blood_wounds`, `parents_fighting`,
  `serious_illness`, `needles_hospital`, `disfigured_body`, `pitch_dark`, `nightmare`,
  `caregiver_cruelty`, `animal_cruelty`. Six more have one or two: `drowning` (1), `blade_weapon`
  (1), `runs_away` (1), `phobia_animals` (2), `sealed_in` (2), `discrimination` (2). Per-label
  numbers for these are noise, and no claim about "53 attributes" is supported.
- **Reference timings are themselves unreliable** in both directions: Iron Giant G03 stands for a
  roughly three-minute wordless sequence bounded by a single three-second cue. The tolerance sweep
  does not repair that; only video-reviewed boundaries would.
- **Five animated films are five clustered cases**, and Finding Nemo is development data. Nothing
  here is a held-out generalisation claim except the leave-one-film-out Jev thresholds, which are
  tuned on the other four films only.
- The time grid treats every second of a scene as equally important. A short, intense moment inside
  a long calm scene is worth few bins; the event-level coverage numbers are there as the counterweight.
