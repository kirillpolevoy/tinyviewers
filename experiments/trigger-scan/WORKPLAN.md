# Work plan after the Codex review (2026-09-20)

Read `AUDIT.md` (especially the warning and the five-film section) and `CODEX-REVIEW.md` first.
Product goal: a database of movie SCENES that parents of 5-10 year-olds filter by what bothers their own
child ("which scenes have monsters"), with severity per age band (5-7, 8-10), descriptions, keywords.
Input is subtitles only. Jev = TypeSafe's System One model (typed yes/no, choice, score answers with
probabilities; cannot generate text; reads questions literally; docs at https://docs.typesafe.ai/llms.txt).

## Four workstreams and who owns which files

Nobody edits a file they do not own, and nobody edits existing files unless their stream says so.
All paths are under `experiments/trigger-scan/`.

1. **Scoring rework** owns `score.js`, `rescore.js`, `score.test.js`, `METRICS.md`, output `rescore/`.
2. **Taxonomy v3 (presence / event / severity)** owns `taxonomy-v3.js`, `TAXONOMY-V3.md`, `run-jev-v3.js`,
   output `runs-v3/`.
3. **Fair comparisons** owns `run-sonnet-alone.js`, `run-matched.js`, outputs under `runs-v3/` with the
   prefixes `sonnet-alone-` and `matched-`.
4. **Human review page** owns `build-review.js`, output `review/` (git-ignored; it embeds subtitle text).

Presence annotation of the reference lists (after stream 2 defines the vocabulary) writes
`gold-v3/<slug>.json` only.

## Rules for every agent

- Secrets live in `../../.env.local`, loaded by `common.js`. Never print, log or copy a key.
- Model calls cost real money. Budget per stream: Jev under $1, Claude under $3. Record tokens and cost in
  every run file. Claude calls go through `claude.js` (`callClaude`, `costUsd`); use `claude-sonnet-5`
  unless told otherwise, and the Batch API is not required.
- Subtitle text is copyrighted: never write it into a tracked file beyond short quotes; `data/` and
  `review/` are git-ignored.
- Reference lists (`gold.json`, `gold/*.json`) were drafted by Claude agents and are NOT human-reviewed.
  Never tune anything on a film and then report that film's score as held-out.
- Do not commit, push, or touch anything outside `experiments/trigger-scan/`.
- Verify by running what you wrote. Report what you ran and what it printed; if something was not run or
  failed, say so plainly. No claims without output.
- Finish with a short report: files created, commands to reproduce, key numbers, known weaknesses.
