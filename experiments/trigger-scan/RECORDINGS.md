# Recordings — a Jev run you can replay at the speed it happened

`recordings/<slug>.jev.json` is a recording of one real Jev v3 analysis of one film: every request
that went out, when it went out, when it came back, and every probability that came back in it. It
exists so a "Watch it work" page can replay the run truthfully instead of animating a guess.

The analysis is not a special one. `record-jev-run.js` and `run-jev-v3.js` both call `analyzeFilm()`
in `jev-v3-core.js`: same beats, same 103 questions per beat, same model (`jev-1.13.0`), same
concurrency of 8, same splitting of a window's questions when the estimate approaches the 64k token
limit. The recorder adds one thing — a timing wrapper around every request — and writes a different
file.

## Regenerate

```sh
node record-jev-run.js --film nemo     # one film: re-runs the analysis, rewrites both files
node record-jev-run.js --all           # all six in films.json
node excerpts.js                       # rebuild the excerpt files only — no API calls
node verify-recording.js               # check every recording in recordings/
node verify-excerpts.js                # check every excerpt file against the policy
```

Changing which lines the excerpts show never needs a re-run: `excerpts.js` rebuilds them from the
recording plus the subtitle file. Only a change to the analysis itself costs money.

Needs `TYPESAFE_API_KEY` in `../../.env.local` and `data/<slug>.srt` (subtitles are not in git; see
`fetch-subtitles.js`). A full six-film re-record costs about $0.48 and takes about 35 seconds of
wall clock. Re-recording changes the timings, because the timings are real.

## Files

| file | tracked | contains |
| --- | --- | --- |
| `recordings/<slug>.jev.json` | yes | ids, offsets, token counts, probabilities. **No subtitle text.** |
| `recordings/<slug>.excerpts.json` | no (`.gitignore`) | the two most relevant short lines per flagged beat, with why |

## Format

### `meta`

Film slug, `model` (what we asked for) and `model_reported` (what the API said it used), taxonomy
version, `started_at` (ISO wall clock, for provenance only), `concurrency`, counts of cues, windows,
beats, `questions_per_beat` and `total_answers`, `requests`, `caption_questions`, `wall_ms`,
`input_tokens`, `output_tokens`, `cost_usd`, `price_per_mtok`, the token limit and per-request
ceiling, `windows_split`, `largest_estimated_request_tokens`, `retries`, and `git_commit` /
`git_scripts_clean` (false means the analysis scripts had uncommitted edits when this was recorded,
so the commit locates the tree but not the exact code).

`wall_ms` is first request sent to last response received. Run start is the dispatch of the first
request, so `requests[0].sent_ms` is exactly `0` and `wall_ms` is the largest `received_ms`.

### `requests[]` — in send order

`id` (`R0000`…, handed out at dispatch, so array order is send order), `kind` (`captions` for the
one sound-caption pass, `beats` for everything else), `window_id`, `part`/`parts` (which slice of a
split window this is), `sent_ms` and `received_ms` as offsets from run start on the monotonic clock
(`performance.now()`), `status`, `retries`, `input_tokens`, `output_tokens`, `est_tokens` (the
pre-flight estimate that drove splitting), `questions` carried, and `beats` — the beat ids it
covered.

`sent_ms` is the first attempt and `received_ms` is the successful response, so a request that was
rate-limited and retried shows its real, long span. Those spans are not smoothed out.

### `beats[]` — in film order

`id` (`W012.3` — window, then beat within window), `window_id`, `start_ms`/`end_ms` in film time,
`start_cue`/`end_cue` cue ids, `n_cues`, `flagged`, `loud_caption`, and:

- `request_id` — the request whose arrival makes this beat known. **This is the one to replay on.**
- `request_ids` — every request that carried part of this beat. Usually one. A split window cuts the
  question list by token budget, not on beat boundaries, so a beat at a cut is carried by two
  requests; it resolves when the later one lands, which is `request_id`.
- `answers` — `presence`, `mention`, `event` and `modifier` probabilities rounded to 3 decimals, and
  `score` with the four severity scores, each `{ score, confidence, probabilities }` over levels
  0–3. Nothing is thresholded. 103 numbers-or-score-objects per beat, always.

### `timeline[]` — what a front end iterates

One entry per response, sorted by `received_ms`, each a snapshot of the whole run at that instant:

```json
{ "t_ms": 893.73, "request_id": "R0001", "kind": "beats",
  "resolves_beats": ["W001.1", "W001.2", "W001.3"],
  "beats_resolved_total": 3, "answers_returned": 309,
  "input_tokens": 24850, "cost_usd": 0.001044, "in_flight_after": 1 }
```

`answers_returned`, `input_tokens`, `cost_usd` and `beats_resolved_total` are running totals and end
exactly at the `meta` totals. `in_flight_after` is how many requests were still open the moment after
this one landed (so it is at most `concurrency - 1`).

### `thresholds`

The flag rule, stated so a front end never has to invent one:

> **A beat is flagged when any presence probability or any event probability is >= 0.70.** The
> mention, modifier and score channels never flag a beat.

`flagged[]` lists every flagged beat with the `t_ms` it resolved at and its `top` three
presence/event items (`{channel, id, p}`, highest first). `beats[].flagged` says the same thing
per beat. `verify-recording.js` re-derives both from the raw probabilities.

## How to replay

```js
const rec = await (await fetch('/recordings/nemo.jev.json')).json();
const t0 = performance.now();
let i = 0;
function frame() {
  const t = performance.now() - t0;                  // real elapsed ms, same clock scale
  while (i < rec.timeline.length && rec.timeline[i].t_ms <= t) apply(rec.timeline[i++]);
  if (i < rec.timeline.length) requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
```

Rules:

1. **Iterate `timeline` against a real clock. Never stretch or compress time.** No easing between
   entries, no "speed up the boring part", no fixed interval per entry. The point of the page is that
   this is how fast it actually was. If the run took 5.2 s, the replay takes 5.2 s.
2. Drive counters off the running totals in the entry, not off your own accumulator — then a dropped
   frame or a backgrounded tab cannot desynchronise the numbers.
3. A beat becomes known at its resolving request's `t_ms`. Look it up through
   `timeline[].resolves_beats`, or through `beats[].request_id`; both say the same thing.
4. Beats do **not** arrive in film order. Requests go out eight at a time in film order, but
   responses come back when they come back, so the timeline sweeps roughly left to right with local
   scatter — and a rate-limited window can land seconds later, far behind the sweep. Design for a
   board that lights up mostly-forward and sometimes fills a hole behind itself. Do not sort the
   timeline by film time to make it tidy; that would be a different, fictional run.
5. A pause or a restart is fine (you hold the clock), but do not offer a speed control that claims to
   be the real thing.

## Excerpt policy

The recording has no subtitle text in it at all. For the beat explorer the owner approved showing
lines **only for flagged beats**, **two** lines per beat, each at most **12 words** (a longer cue is
cut with an ellipsis), in film order. A beat with a single cue gets a single line. Those lines live in
`recordings/<slug>.excerpts.json`, which is git-ignored.

Which two lines: the **most relevant** ones, meaning the cues most responsible for the flag.

Jev answers per beat, not per cue, so the recording cannot say which of a beat's eight lines produced
`shark = 0.94`. `excerpts.js` approximates it lexically:

1. Each taxonomy item has a keyword list built from three sources — the parent-facing alias table in
   `scene-api/load.js`, the item's own label words, and `DIALOGUE`, which is what a character actually
   *says* while the thing is happening. The third source does the real work: "Someone is being chased"
   never appears in a subtitle, "He's right behind us!" does. `jump_scare` and `terrified` also match
   scream spellings by pattern (`Aagghh!`, `Argh!`, `Eek!`), because stemming cannot relate those.
2. A cue's score is `sum over the beat's top three flagged items of (item probability x number of
   distinct keywords that item matched in the cue)`. The item Jev was most sure about pulls hardest.
3. Ties break on whether the cue is a bracketed sound caption (that is what Jev keyed on for the
   sound-driven items), then the longer line, then the earlier cue.
4. The top two scoring cues win. Where fewer than two cues score above zero, the remaining slot goes
   to the beat's longest cue, so the beat still gets its two lines.

Each excerpt carries a `why` block so the front end can highlight the evidence rather than assert it:

```json
{ "W014.4": [
  { "cue": "C0404", "line": "- Fish are friends, not food. - Food!", "score": 1.42,
    "why": { "items": [{ "channel": "presence", "id": "shark", "p": 0.71 }],
             "words": ["food!", "friends not food"] } } ] }
```

A line chosen by the fallback says so instead: `"why": { "items": [], "words": [],
"fallback": "longest_cue" }`. Roughly half of all lines are fallbacks, and that is not a bug to tune
away: a beat flagged `robot_machine_being` because the protagonist *is* a robot, or `large_predator`
in a film where every character is a lion, has no single cue responsible for it. Those items are
ambient, and no lexical rule can localise them. Where the flag comes from something said or screamed —
`terrified`, `jump_scare`, `storm_lightning`, `shark`, `explosion` — the match rate is high.

Exposure across the six films is 12–20% of a film's subtitle words (it was 17–24% under the earlier
"two longest cues" rule, since the most relevant line is usually shorter than the longest one). The
share is driven by how many beats flag — roughly half of them — so the lever for reducing it further
is one line per beat, not a shorter word cap.

A front end that wants excerpts must load the file separately and treat it as missing-by-default:
everything else on the page has to work without it.

`verify-excerpts.js` checks the policy, separately from the recording because this file is optional
and untracked: excerpts exist for flagged beats and only for flagged beats, the right number of lines
per beat, every cue id inside the beat's cue range and present in the subtitle file, no cue quoted
twice, film order, at most 12 words, each quoted line identical to that cue's real text (whole, or a
true prefix ending in an ellipsis), and every `why` citing only items in the beat's recorded top three
at the recorded probability with words that really occur in the line.

## What the verifier checks

`verify-recording.js` reads only the tracked file and makes no API calls. It asserts: every beat
resolved exactly once and by a request that lists it; `answers` count per beat equals
`questions_per_beat` and the total equals beats × questions; score level probabilities sum to 1 and
every probability is in [0, 1]; beats in film order; `sent_ms` monotonic in send order, every span
inside `wall_ms`, every status 200; never more than `concurrency` requests in flight (swept over all
send/receive events); `timeline` the same set as `requests`, sorted, non-decreasing counters ending
exactly at the `meta` totals; `cost_usd` = `input_tokens` × `price_per_mtok`; the flagged list and
each beat's `flagged` flag re-derived from the raw probabilities, with `top` items sorted and
matching the stored numbers.

`verify-excerpts.js` covers the excerpt files; see the excerpt policy above.

For text leakage `verify-recording.js` applies two rules. The stated one: no string longer than 80 characters (other
than the one prose field, `thresholds.flag_rule`). And a stronger one, because plenty of subtitle
lines are shorter than 80 characters: **every** string in the file must match `^[\w.:+-]+$`. Ids,
slugs, model names, ISO dates and shas have no spaces; dialogue does.
