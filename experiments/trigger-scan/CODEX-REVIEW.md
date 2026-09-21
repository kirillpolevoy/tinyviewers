# Independent review by Codex (gpt-6-astra, high reasoning effort, read-only), 2026-09-20

Verbatim. Brief: find what is wrong with the analysis in AUDIT.md and the stance built on it.

**The evidence supports Jev as a cheap candidate generator. It does not establish “Jev cannot label,” or that Jev → Sonnet is the best architecture. The headline label metric is broken.**

I reproduced the scoring in memory with writes disabled. No files changed; no new model calls.

**Conclusion-changing findings**

1. **“Labels right” is not precision. A useless predictor beats both models.**

   The scorer counts true positives per **reference label**, but false positives per **prediction run**. One broad prediction can earn many true positives while its incorrect portions incur no penalty. This also affects scene precision in `compare.js`. See [tune-labels.js:43](/Users/kpolevoy/toddler-movies/experiments/trigger-scan/tune-labels.js:43) and [compare.js:75](/Users/kpolevoy/toddler-movies/experiments/trigger-scan/compare.js:75).

   I tested one prediction spanning each entire film, containing every label:

   | Prediction | “Right” | “Found” | F1 |
   |---|---:|---:|---:|
   | Every attribute throughout every film | 77.7% | 100% | 87.5% |
   | Every group throughout every film | 99.2% | 100% | 99.6% |

   These percentages cannot establish scene-label accuracy. Use common evaluation units or explicit event matching, with temporal coverage and overreach reported separately.

2. **The false-positive implementation additionally favors sparse scene lists.**

   `inRun` resets only when the next array element is not a false hit. Two Sonnet scenes minutes apart can count as one false positive. Jev’s intervening negative beats usually break that run. See [tune-labels.js:46](/Users/kpolevoy/toddler-movies/experiments/trigger-scan/tune-labels.js:46).

   Holding predictions and thresholds fixed, requiring successive false hits to be within 10 seconds changes:

   | Labels | Jev “right” | Sonnet “right” |
   |---|---:|---:|
   | Attributes | 27.0% → 26.6% | 54.6% → 50.9% |
   | Groups | 34.2% → 33.6% | 68.2% → 62.7% |

   **This defect inflates Sonnet’s advantage but does not reverse it.** Fixing it alone does not repair finding 1.

3. **91% recall establishes overlap with candidates, not successful scene extraction.**

   Removing the 15-second tolerance changes Jev from **147/161 to 144/161**. Tolerance is not the main explanation.

   Breadth is. Under the merged-range policy:

   - Jev flags **161.1 minutes**, versus **120.1 reference minutes**.
   - Only **47.2%** of flagged time overlaps reference time.
   - Only **116/161** reference scenes have at least half their duration covered.
   - One prediction receives credit for **nine reference scenes**; the longest spans nine minutes.

   Merging uses array adjacency without checking elapsed gaps: [events.js:24](/Users/kpolevoy/toddler-movies/experiments/trigger-scan/events.js:24). Matching requires any overlap: [compare.js:40](/Users/kpolevoy/toddler-movies/experiments/trigger-scan/compare.js:40).

   Conversely, reference timing is itself unreliable: *Iron Giant* G03 represents an approximately three-minute wordless sequence with a single three-second cue. So temporal metrics need video-reviewed boundaries too. [gold/iron-giant.json:65](/Users/kpolevoy/toddler-movies/experiments/trigger-scan/gold/iron-giant.json:65)

   **8/25 calm controls is a selected stress-test result, not a population false-positive rate.** The scorer also ignores control overlaps of ten seconds or less—potentially an entire jump scare. [compare.js:95](/Users/kpolevoy/toddler-movies/experiments/trigger-scan/compare.js:95)

4. **The references measure agreement with Claude’s interpretation, including film memory.**

   Blinding annotators to outputs prevents direct copying. It does not remove shared model-family errors, shared interpretation of ambiguous categories, or remembered plot contamination. The instructions explicitly authorize film knowledge and visual inference. [gold/INSTRUCTIONS.md:23](/Users/kpolevoy/toddler-movies/experiments/trigger-scan/gold/INSTRUCTIONS.md:23)

   Of 415 reference labels, **147 are marked visual-only**. Eleven attributes have **zero** positive examples; six more have only one or two. A universal claim about 53 attributes is unsupported.

   There are concrete definition violations: the reference labels Zazu `captured` while acknowledging he is already caged, whereas the question asks whether capture is happening now. [gold/lion-king.json:601](/Users/kpolevoy/toddler-movies/experiments/trigger-scan/gold/lion-king.json:601)

   Five animated films are five clustered test cases, not 161 independent demonstrations of generalization. *The Wild Robot*’s lower score does not identify model familiarity as the cause; subtitle evidence, content mix, and annotation quality also vary.

5. **The label comparison changes several things simultaneously.**

   Jev answers short-beat questions with no film-specific cast context on these films. Sonnet receives merged stretches, six surrounding cues on each side, the film title/year, and Jev’s label guesses. Sonnet’s vocabulary also omits the attributes’ explicit `no` boundaries. See [run-jev-v2.js:85](/Users/kpolevoy/toddler-movies/experiments/trigger-scan/run-jev-v2.js:85), [build-scenes.js:42](/Users/kpolevoy/toddler-movies/experiments/trigger-scan/build-scenes.js:42), and [build-scenes.js:101](/Users/kpolevoy/toddler-movies/experiments/trigger-scan/build-scenes.js:101).

   Scoring Sonnet’s complete output against all references is legitimate **pipeline evaluation**: missed candidates remain false negatives. It is not an isolated test of labeler capability.

   I applied Jev’s finder gate to its label predictions and retuned within each fold. F1 barely moved, **33.5% → 33.9%**. Candidate restriction alone does not explain the gap; context, scene unit, wording, and reference bias remain unresolved.

   The defensible conclusion is: **“This Jev beat-labeling configuration performs poorly against these references.”**

   Your own earlier experiment argues against the broader claim: Jev labeling Sonnet-defined Nemo scenes scored **76% right / 74% found** on the old coarse taxonomy. That is not independent validation, but it makes scene-level labeling worth testing. [results.json:11335](/Users/kpolevoy/toddler-movies/experiments/trigger-scan/results.json:11335)

6. **The taxonomy is misaligned with the proposed product.**

   “Which scenes contain monsters?” differs from “Does a dangerous monster presently threaten a character?” Friendly creatures, frightening dreams, and imagery can matter to a particular child regardless of characters’ reactions.

   The reference explicitly excludes Mufasa’s ghost from `ghost_supernatural` because Simba is not frightened—even while acknowledging that children might be. [taxonomy-v2.js:38](/Users/kpolevoy/toddler-movies/experiments/trigger-scan/taxonomy-v2.js:38), [gold/lion-king.json:738](/Users/kpolevoy/toddler-movies/experiments/trigger-scan/gold/lion-king.json:738)

   **Store content presence separately from threat, tone, and severity.** The present-event veto should not erase frightening depictions.

   Likewise, higher F1 after collapsing labels does not prove parents want broad filters. It mechanically forgives distinctions. “Animals” or “scary creatures” cannot replace a child-specific shark, spider, or ghost filter.

**Leave-one-film-out and smaller defects**

The threshold cross-validation itself excludes the held-out film correctly, including selection of the fallback global threshold. I found no direct held-out-label leakage there. [tune-labels.js:73](/Users/kpolevoy/toddler-movies/experiments/trigger-scan/tune-labels.js:73)

However:

- Nemo is development data. Repeatedly inspecting these five films makes them development data for subsequent revisions too. Freeze the next evaluation.
- `thresholds*.json` contains thresholds fitted on **all five films**. Reusing those files to score these films would leak; the reported cross-validation does not do that. [tune-labels.js:112](/Users/kpolevoy/toddler-movies/experiments/trigger-scan/tune-labels.js:112)
- Label scoring omits the runner’s joking veto. I reproduced its effect with fold-specific retuning: aggregate F1 remains approximately 33.5%. This inconsistency does **not** rescue Jev. [run-jev-v2.js:60](/Users/kpolevoy/toddler-movies/experiments/trigger-scan/run-jev-v2.js:60)
- Group mode deletes visual-only metadata, so its “text-visible labels only” result is not text-only. [tune-labels.js:23](/Users/kpolevoy/toddler-movies/experiments/trigger-scan/tune-labels.js:23)
- `analyze-windows.js` evaluates each run’s own windows and chooses best F1 on the evaluated data. Those best-threshold figures are descriptive, not held-out performance. [analyze-windows.js:28](/Users/kpolevoy/toddler-movies/experiments/trigger-scan/analyze-windows.js:28)

**Nits:** “13 groups” actually scores **12**; `sound` has no attributes and is filtered out. Beats can contain ten cues after fragment folding, despite “≤8.” “109 serious” means serious for ages 5–7; using either age band gives 111. These do not change the model ranking. [tune-labels.js:16](/Users/kpolevoy/toddler-movies/experiments/trigger-scan/tune-labels.js:16), [run-jev-v2.js:82](/Users/kpolevoy/toddler-movies/experiments/trigger-scan/run-jev-v2.js:82)

**Architecture and readiness**

At the experiment’s recorded prices, $0.16–0.24 per film means **$24–36 for 150 films**. The recorded Nemo Sonnet-alone cost extrapolates to roughly **$33**, though its older output contract makes that an unfair production estimate. Cost does not justify choosing a lossy gate before an equivalent-quality comparison.

The five-film experiment lacks a Sonnet-alone baseline with the same taxonomy and descriptions. The whole-transcript variant still includes Jev’s checklist, so it does not isolate Jev’s contribution. [build-scenes.js:92](/Users/kpolevoy/toddler-movies/experiments/trigger-scan/build-scenes.js:92)

Descriptions remain a product blocker. The stretch output contains the acknowledged “shark ride”; even the whole-transcript output describes the whale-swallowing moment as avoiding a krill swarm. Detection credit does not establish description accuracy. [scenes.nemo.stretch-only.json:1561](/Users/kpolevoy/toddler-movies/experiments/trigger-scan/scenes.nemo.stretch-only.json:1561), [scenes.nemo.json:1120](/Users/kpolevoy/toddler-movies/experiments/trigger-scan/scenes.nemo.json:1120)

Two severity fields are reasonable schema flexibility, but these experiments do not validate age-specific calibration. The visual-information limitation stands; failed Nemo extensions establish failure of those implementations, not impossibility.

My recommendation, in five bullets:

- **Keep Jev experimental.** Treat it as a proposal/checklist source until an equal-contract Sonnet-alone comparison establishes value.
- **Create a complete scene inventory independent of the current trigger list.** Preserve full transcripts and evidence so new attributes can search previously unflagged material.
- **Separate presence, interpretation, and severity.** Offer broad groups plus specific filters; represent unassessed content explicitly.
- **Require human evidence before publishing reliability claims:** independent video annotation, taxonomy agreement, adjudication, description checks, and separate severity agreement for each band.
- **Prototype Neon without freezing the content contract.** Preserve release/track identity and hashes, cue anchors, timestamp mappings, taxonomy/model/prompt versions, evidence provenance, and review status. The connector must distinguish “absent” from “not assessed.”

The three cheapest next experiments, ranked by information gained per cost:

1. **Zero-call metric audit.** Rescore saved outputs on shared units; include whole-film/all-label and flag-everything baselines, tolerance sweeps, temporal overreach, and per-film results. Reject any metric these useless baselines win.
2. **Small blind human/video audit.** Two independent raters review randomly sampled intervals, model disagreements, and unflagged intervals. Measure omissions, attribute agreement, boundary accuracy, and unsupported description claims. Include unfamiliar content.
3. **Matched-input model experiment.** Give Jev and Sonnet identical human-bounded scenes, context, and definitions; compare beat versus scene labeling. Separately compare Sonnet whole-transcript with and without Jev’s checklist. Freeze tuning before new films. If Jev meets the predefined human-reviewed precision/recall targets on identical inputs, “cannot label” is overturned—even if its current beat pipeline remains poor.
