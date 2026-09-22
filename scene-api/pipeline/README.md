# pipeline — the analysis, as code that runs in a request

This directory is a **copy** of the analysis code in `experiments/trigger-scan`, taken at commit
`5fe8fb5`. The experiment scripts stay exactly where they are. They are the historical record: they
produced the six films in this database, the numbers in `METRICS.md`, the judgements in `AUDIT.md`
and the recordings in `recordings/`, and nothing in this directory may quietly change what any of
those mean.

## Why a copy and not an import

`experiments/trigger-scan` is not deployable and should not become so.

- Its modules read and write files. `common.js` loads `data/<slug>.srt` off disk and calls
  `dotenv.config()` as a side effect of being imported. A serverless function receives its subtitles
  over the wire and already has its environment.
- Its scripts are CLIs. They parse `process.argv`, print to stdout, write into `runs-v3/`, and call
  `process.exit(3)` when a cost cap is hit. None of that can happen inside a request.
- It is outside the Vercel project. The deployment's root directory is `scene-api`; `../experiments`
  is not part of the build and never will be.
- And the important one: an experiment is allowed to move. Someone tuning the excerpt rule or trying
  a new taxonomy should not be able to change, by accident, what a live "Add a movie" run produces
  for a parent tomorrow. A copy makes that a decision someone takes, with a diff.

The cost is real and worth naming: **this code and the experiment's can drift.** If you change one,
read the other. The files here say at the top which file they were copied from, and the two
taxonomies — the one thing where a silent drift would change what every label in the database means
— are asserted byte-identical to the originals by a test in `test/unit.test.js`.

## What came across, and what was left behind

| here | from | changes |
| --- | --- | --- |
| `srt.js` | `srt.js` | none, byte for byte |
| `taxonomy-v3.js` | `taxonomy-v3.js` | none |
| `taxonomy-v2.js` | `taxonomy-v2.js` | none (the scene pass still labels in v2; `load.js` maps it to v3) |
| `net.js` | `common.js` | only `pool` and `postJson`; no dotenv, no file reads; `fetch` and the backoff sleep are injectable; `pool` cancels (see below) and `postJson` never carries a response body into an error |
| `claude.js` | `claude.js` | no `import './common.js'`; api key and `fetch` are arguments; usage is reported through `onUsage` the moment a response lands, and the call takes an `AbortSignal` |
| `jev-core.js` | `jev-v3-core.js` | `analyzeFilm` takes `windows` instead of reading a slug off disk; key and `fetch` are arguments; the pool's cancellation signal reaches each request |
| `record.js` | `record-jev-run.js` | returns the recording instead of writing two files; no CLI, no git shell-out, no exposure statistics; a `COST_CAP_USD` of $0.20, reserved per request |
| `scenes.js` | `run-sonnet-alone.js` | the `--alone` arm only: no `--checklist`, no second run, no file I/O. Output ceiling 16k rather than 64k, and `COST_CAP_USD` enforced — see below |
| `presence.js` | `run-sonnet-presence.js` | takes the scene list as a value; no `data/<slug>.context.json` (a film added live has no hand-written plot summary); `COST_CAP_USD` lowered from $3.00 to $1.00 |
| `excerpts.js` | `excerpts.js` + `verify-excerpts.js` | `buildExcerpts` takes the recording and the cues as values; keyword tables and `chooseExcerpts` byte-identical; `verifyExcerpts` is the exposure half of the verifier, ported |
| `subtitles.js` | `fetch-subtitles.js` | generalised from one hard-coded film to any IMDb id, with the quota and too-short-file cases named; every request has a deadline and the file has a 5 MB bound |
| `ingest.js`, `run.js`, `errors.js` | — | new: the stage orchestrator, and the bridge into `load.js` |
| `budget.js`, `quotes.js` | — | new: the reservation ledger every cap is enforced with, and the eight-word quotation rule `test/load.test.js` applies to the loaded films, applied here to a live one |

Not copied: `run-jev-v3.js`, `build-scenes.js`, `verify-recording.js`, `score.js`, the ablations and
everything else that exists to measure or compare. Those are the experiment's job and they stay
there. `verify-excerpts.js` is the one exception, and only half of it: the assertions about how much
text an excerpt file exposes are now enforced on every live run (see below), while the ones about
whether a `why` block cites the right item stay in the experiment, because a wrong citation is a
measurement problem rather than a rights one.

### The caps, and why they are different numbers here

A script that overspends prints a number and someone reads it. A request that overspends is a bill.
So all three caps are enforced rather than reported, and they are the numbers `RESERVE_USD` in
`lib/jobs.js` is built out of — $0.20 + $0.60 + $1.00 = $1.80, and a test asserts that sum.

Every one of them works the same way, through `budget.js`: a call **reserves its own worst case
before it is dispatched** (the whole prompt billed as fresh input at a deliberately pessimistic 3
characters per token, plus a completely full output buffer) and settles that reservation against
the real bill when it lands. Checking completed spending is not a cap when calls run five at a
time — five presence workers each read the same "still under $1.00" figure, all five dispatched,
and the stage finished at $1.176.

- **`scenes.js`** asks for a 16k output ceiling instead of the script's 64k — a whole film's scene
  list is about 10k output tokens, so 64k was never a ceiling on anything — and refuses a transcript
  outright (`scenes_cap`) when the estimated input plus a full output buffer would not fit inside
  $0.60. It refuses *before* the call.
- **`presence.js`** keeps the script's behaviour of stopping part-way through a film, at $1.00
  rather than $3.00. A real film spends $0.05-$0.06 here, so $3 would only ever have caught a bug —
  after letting it spend fifty films' worth.
- **`record.js`** has a cap the script had none of, $0.20. The six recorded films cost $0.057 to
  $0.109, so this is not a number a real run meets; it exists because `RESERVE_USD` is quoted to a
  person as the most one run can cost, and a term in that sum has to be something the code refuses
  to pass.
- All three take an `onSpend` callback and call it **per response, as it arrives** — before the body
  is parsed and before `stop_reason` is looked at — because `run.js` writes money into the job row
  as it is incurred. A stage that makes thirty calls and then takes a 400 used to record nothing at
  all, and a Claude response that reported $0.16 of usage and then stopped at `max_tokens` banked
  zero. Where nothing can say what a call cost — it went out and no response ever came back — the
  request's own input estimate is charged rather than nothing.

### Cancellation, and why the pool had to learn it

`pool` used to let `Promise.all` reject on the first failure while the surviving workers carried on
taking items. `run.js` then marked the job failed, released the one-live-run lock and resolved the
promise it had handed `waitUntil` — with up to eight paid calls still in flight, and the next run
admitted on top of them. `pool` now stops dispatching at the first failure, aborts the calls already
out through a signal each worker is handed, and does not settle until every worker has.

### What an error is allowed to say

Jev and Anthropic are sent subtitle lines, and both quote the request back in an error body. That
body used to be pasted into the thrown message and then logged in full. `UpstreamError` in
`errors.js` carries four fields — service, HTTP status, upstream request id, a short code — and the
body is drained and dropped. `errorSummary` is the only shape `run.js` logs.

## The stages

```
subtitles -> jev -> scenes -> presence -> excerpts -> ingest
```

Each is a function of in-memory values returning the same JSON shape the loader already consumes,
and each writes its own timing into the job row as it starts and as it finishes. `run.js` is the
only thing that knows about jobs; every other module here would work just as well from a script.

Two rules the orchestrator keeps that are not obvious from the stage list:

1. **The recording is written to the job the moment the `jev` stage ends**, before Sonnet has
   started. The screening pass takes about five seconds and is the thing worth watching; there is no
   reason to make someone wait two more minutes for the scene pass before the replay can start.
2. **The subtitle text lives only in `job_blobs`, and only while the job runs.** It is deleted when
   the job reaches `done` *or* `failed`, and anything older than thirty minutes is swept by the next
   caller to any `/api/add` or `/api/films` route (and by a daily cron) in case a function died
   between the two. No endpoint returns it. The excerpts on the job row follow
   the same rule for the same reason: they are there so the replay can show evidence lines before
   there is a film to hang them off, and they are nulled out at `done` or `failed`.
3. **Money is banked as it is incurred.** `cost_usd` starts at the reserve, rises with every priced
   call, and is replaced by the real total exactly once — at `done` or `failed`. A run that reaches
   neither keeps the reserve, so an abandoned row never reads as free to the daily cap.

## Keeping the recording a recording

`record.js` must produce exactly what `record-jev-run.js` produces, field for field: the format in
`experiments/trigger-scan/RECORDINGS.md`, including `timeline[]` and its running totals, and the
leakage rule (`^[\w.:+-]+$` for every string but `thresholds.flag_rule`). A replay page cannot tell
whether a run was recorded on a laptop in September or in a Vercel function this afternoon, and it
must not have to. `verify-recording.js` in the experiment is the definition; `test/add.test.js`
asserts the same invariants against a live run.

Two fields cannot mean the same thing here and say so rather than pretend: `git_commit` comes from
`VERCEL_GIT_COMMIT_SHA` when the platform sets one and is `null` otherwise, and `git_scripts_clean`
is always `null`, because a deployed function has a build artefact, not a working tree.
