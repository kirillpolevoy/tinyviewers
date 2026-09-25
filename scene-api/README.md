# scene-api

An HTTP API over the scene database built from `experiments/trigger-scan`. Everything an assistant
or a parent reads is a plain, public GET. There is one small write surface — the owner's own
passcode-protected "Add a movie" flow under `/api/add` — and it is described at the bottom.

It exists for one shape of question: *"my kid is 4, which scenes in Finding Nemo have monsters, and
exactly when?"* An AI assistant can already write good prose about a film from the open web. What it
cannot get anywhere is what this serves:

- exact scene start/end times anchored to subtitle cues,
- the **complete** scene list for one analysed release, not a sample,
- per-child filters split into **what is present** (monster, shark, gun, needle, the dark) and
  **what happens** (chased, captured, someone dies),
- an honest grading of how sure we are about each label,
- severity for ages 5-7 and 8-10,
- a way to move our timestamps onto the clock of whatever copy the parent is actually playing,
- and an explicit account of what was *not* assessed, so a missing label is never read as "safe".

It also serves one thing that is not an answer about a film at all: a **recording** of the screening
run for each film — every request that went out, when it came back, and all 103 probabilities per
beat — so a page can replay the analysis at exactly the speed it really happened.

The loader calls no model: the six films already in the database are built from files on disk. The
one code path that does call models is the live pipeline behind `/api/add`, which analyses a film
nobody has looked at yet. It is behind a passcode and a daily spend cap.

## Deployment

**Live: <https://tinyviewers-scenes.vercel.app>** — start at
<https://tinyviewers-scenes.vercel.app/api/openapi.json>.

- **Database:** Neon project **`tinyviewers-scenes`**. The pooled connection string is held only in
  the Vercel project's `DATABASE_URL` environment variable and in an untracked local
  `scene-api/.env.local`. It is not recorded in this repository, and must not be.
- **Deploys:** from the GitHub **`main`** branch, with the Vercel project's **root directory set to
  `scene-api`**. Pushing to `main` deploys; there is no build step, `api/*.js` become Node
  functions and `vercel.json` supplies the `/api/openapi.json` rewrite.
- **Changing the data** is a separate act from deploying. The database is written only by running
  `node load.js` against `DATABASE_URL` from a machine; a deploy never touches rows.

### Accepted risks for this test slice

These are known and deliberately accepted while this is an experiment with a handful of films. They
are not acceptable for anything with real users behind it.

| Risk | Why it is accepted for now | What would change it |
|---|---|---|
| **No rate limiting** on a public, unauthenticated API. Anyone can call it as fast as they like, which costs Neon compute and could exhaust the connection pool. | Traffic is one connector belonging to one household; the data is read-only and public; Neon's free tier suspends rather than bills. | Any real distribution, any paid tier, or the first sign of scripted traffic. Add Vercel firewall rate limits or an API key. |
| **The failed-passcode limiter is per instance, not per deployment.** Ten wrong guesses from one identity get a 429 for ten minutes, but the counter lives in one function instance's memory: it is lost on a cold start and not shared between concurrent instances, so a guesser who spreads their attempts is not slowed at all. | It costs nothing, it stops the one-script-one-connection case, and the money is bounded by the daily cap whatever happens to the passcode. `ADD_FILM_PROXY_SECRET` at least makes the identity the visitor rather than the web app's egress address, so one guesser no longer locks out everyone else on that instance. | It is not a substitute for a Vercel firewall rate-limit rule on `/api/add/*`, which is the real answer and is not configured yet. |
| **Machine-written, unreviewed `description` fields are exposed.** No human has read them, and `AUDIT.md` documents descriptions that name the wrong creature and one that invented an event. | The OpenAPI text and every response tell the assistant that descriptions are machine-written and may be wrong about who or what is on screen, and `review_status` is `unreviewed` on every row. | Before showing this to parents who are not the owner: review the descriptions, or stop returning `description` until a scene's `review_status` says a person has read it. |
| **`/api/add` spends real money and is defended by one shared passcode.** Anyone who has it can start runs; each costs about $0.25. There is no per-caller identity and no audit trail beyond the `jobs` table. | It is one household's page, the passcode is compared in constant time, only one run may be in flight (enforced by a unique index, not by a read-then-write), every stage has a cost cap, and a daily cap (`ADD_FILM_DAILY_CAP_USD`, default $5) bounds the loss to a day's worth even if the passcode leaks. | Any second user, or any sign of a run nobody started: rotate the passcode, drop the cap, and put the endpoints behind real auth. |
| **A job's progress is readable by anyone who has its 22-character id**, with no passcode. | The id is 128 bits of randomness handed only to whoever started the run, and nothing on the row is a secret — it is a film title, a list of step timings and a recording. | If anything private ever needs to live on a job, this stops being acceptable and the endpoint needs the passcode too. |
| **`recordings.excerpts`, `jobs.excerpts` and `job_blobs.srt` hold subtitle text**, which the rest of this schema goes out of its way not to. | Excerpts are the owner-approved policy in `RECORDINGS.md`: two lines of at most 12 words, flagged beats only, 12-20% of a film's words, so a beat can show its evidence — and every live run now checks its own output against that policy (`verifyExcerpts` in `pipeline/excerpts.js`) before anything is written. `jobs.excerpts` is the same data while the run is going, so the replay can show evidence lines before there is a film, and it is nulled out at `done` or `failed`. A blob is a whole track, but only for the minutes one job runs, deleted at `done` or `failed`, swept once it is 30 minutes old by any `/api/add` call, by `/api/films*` (once per instance per ten minutes) or by the daily cron, and returned by no endpoint. | A rights holder objecting to the excerpt share, or any need to keep a track after a run — at which point it is storage of a subtitle file and needs a different conversation. |

Also true and stated in the API itself, not risks so much as the nature of the data: everything is
derived from subtitles, so visual-only frights are missed; severities are one model's judgement;
nothing has been human-reviewed.

---

## Run it locally

```bash
cd scene-api
npm install
```

### Fastest: no Postgres at all

```bash
node server.js --pglite
```

Builds the entire database in memory (Postgres 16 compiled to WebAssembly, via
`@electric-sql/pglite`) from `../experiments/trigger-scan` in under a second, then serves it on
<http://localhost:8787>. Same schema, same SQL, same handlers as the deployed version.

### Against a real Postgres

```bash
export DATABASE_URL='postgres://user:pass@host/db'
node load.js            # applies schema.sql, then loads all six films
node server.js
```

### Environment

`DATABASE_URL` is the only variable the read-only half needs. Nothing here loads a `.env` file by
itself; if you keep values in `scene-api/.env.local` (and the four API keys in the repository root's
`.env.local`), use Node's own flag and pass both:

```bash
node --env-file=.env.local load.js
node --env-file=.env.local --env-file=../.env.local server.js
```

| variable | needed by | what happens without it |
|---|---|---|
| `DATABASE_URL` | everything except `--pglite` | every data route returns 500 |
| `TMDB_API_KEY` | the loader's poster/synopsis lookup; `/api/add/resolve` | loader leaves `poster_url` and `overview` null; resolve returns 502 |
| `ADD_FILM_PASSCODE` | every `/api/add` write | resolve and jobs return **503**, and `/api/add/status` reports `passcode_configured: false` so the web hides the form |
| `ADD_FILM_DAILY_CAP_USD` | the daily spend cap | defaults to **5** |
| `ADD_FILM_PROXY_SECRET` | letting the failed-passcode counter see the visitor rather than the proxy | the counter keys on the proxy's own address, so one guesser can use up everybody's ten tries on that instance |
| `OPENSUBTITLES_API_KEY` | the live pipeline's `subtitles` stage | the job fails with `no_subtitle_key` |
| `TYPESAFE_API_KEY` | the live pipeline's `jev` stage | the job fails in that stage |
| `CLAUDE_API_KEY` | the live pipeline's `scenes` and `presence` stages; the Jev-first pipeline's Sonnet stages | the job fails in those stages |
| `ADD_PIPELINE` | which pipeline a new add runs | **Jev-first (v10.4) by default**; `live` switches back to `pipeline/run.js` |
| `ADD_FILM_PROXY_SECRET` (again) | the Jev-first continuation self-call (`x-continue-secret`) | on Vercel a Jev-first add or rebuild is refused with **503** `no_continue_secret` rather than started and stranded |
| `REBUILD_DAILY_CAP_USD` | optional: the cap rebuilds are admitted against | defaults to **15** (adds keep `ADD_FILM_DAILY_CAP_USD`; both count the same day's jobs) |
| `DEMO_DAILY_CAP_USD` | optional: the live demo's daily cap | defaults to **2** |
| `SCHEMA_AUTO` | optional: `off` stops the API applying `schema-jevfirst.sql` itself on a cold start | the schema is applied once per instance, guarded |
| `JEVFIRST_LOCAL_BUDGET_MS` | local testing only (ignored on Vercel): shortens a Jev-first invocation's time budget so a laptop run hands off to a continuation every few stages | the production budget (240 s) |

Nothing logs a key or the passcode, and the `.env.local` files are untracked. The Neon connection
string contains an `&`: never `echo`, `cat` or `source` these files.

`load.js --dry-run` builds every
row and prints the report without touching a database, and `load.js --film nemo` reloads one film.
Re-running the loader is safe: each film is deleted and rewritten inside a transaction.

### Try it

```bash
curl 'http://localhost:8787/api/films?q=nemo'
curl 'http://localhost:8787/api/films/nemo'
curl 'http://localhost:8787/api/films/nemo/scenes?presence=monsters&age=4'
curl 'http://localhost:8787/api/films/nemo/scenes?presence=shark&include_possible=true'
curl 'http://localhost:8787/api/films/nemo/scenes?presence=shark&anchor_cue=C0056&observed_at=0:05:12'
curl 'http://localhost:8787/api/films/iron-giant/scenes?presence=shot'     # ambiguous word -> gun AND needle
curl 'http://localhost:8787/api/films/iron-giant/scenes?presence=shark&presence=gun'  # repeats merge
curl 'http://localhost:8787/api/films/nemo/recording'      # the replayable screening run
curl 'http://localhost:8787/api/vocabulary'
curl 'http://localhost:8787/api/openapi.json'
curl 'http://localhost:8787/api/add/status'
```

### Tests

```bash
npm test          # node --test test/
```

115 tests, no external database and no network: they run against `@electric-sql/pglite`, which
installed cleanly here. They cover the schema applying twice (including over a populated database),
loader idempotency per film, that no verbatim subtitle text is stored, broad-word and
ambiguous-word filter matching, the TMDB lookup that fills `poster_url` and `overview` (against a
fake fetch, and every way it can fail), the present / possibly_present split, the age bands, the
calibration arithmetic (including a PAL 25/24 case and the implausible-anchor guard),
`only_confirmed`, `include_possible`, `min_severity=0`, repeated and misplaced query parameters,
GET/HEAD/405, cache headers, 400s, 404s, CORS, and the OpenAPI document.

`test/recording.test.js` adds the replay side: a recording per film, `recorded_at` taken from the
run rather than the load, the timeline invariants a replay depends on, the excerpt policy, and the
leakage rule — every string in a served recording has to look like an id, because it is served whole
to a browser.

`test/add.test.js` adds the live pipeline, against stubs shaped like the real APIs (real `Response`
objects, so the streaming parse runs for real). It covers resolve by title and by IMDb URL, a wrong
passcode of a different length, a film that already exists, the three refusals (`exists`, `busy`,
`daily_cap`), the stale-job rule, a full six-stage run ending with rows in the ordinary tables, and
the subtitle blob — present mid-run, gone after `done` and after `failed`. Five of its cases are
about the things that cost money or expose text rather than about the happy path: three simultaneous
starts admitting exactly one, a presence stage that takes a 400 on its fourth call still recording
the first three calls' cost to the cent, the scene pass refusing a transcript too long for its cap
*before* sending it, an oversized subtitle download being skipped, and the excerpt policy being
verified on the run's own output. The subtitles it uses are a slice of a real track read from
`experiments/trigger-scan/data` at run time; none is committed.

---

## What is in the box

```
schema.sql        Postgres schema, idempotent. Targets Neon; runs anywhere.
load.js           Builds every row from experiments/trigger-scan and writes it. No model calls.
server.js         Local node:http router -> the same handlers Vercel would run.
api/              Vercel-style Node functions, one per route. Thin wrappers over lib/.
lib/              db, http plumbing, time arithmetic, word matching, response shaping, OpenAPI,
                  jobs and the add-a-film endpoints.
pipeline/         The analysis itself, copied from experiments/trigger-scan so it can run in a
                  request. See pipeline/README.md for what changed and why it is a copy.
test/             node --test suites.
vercel.json       Rewrites /api/openapi.json and / ; CORS headers; maxDuration 300 on the job route.
.env.local        Untracked. DATABASE_URL for local work against Neon. Never committed.
```

### Where the data comes from

| Table | Built from |
|---|---|
| `films` | `films.json`, plus `poster_url` and `overview` from one TMDB lookup per film by IMDb id (only when `TMDB_API_KEY` is set; both null otherwise, and never guessed) |
| `tracks` | `data/<slug>.srt`, parsed with the experiment's own `srt.js` (imported, never copied) |
| `anchors` | three lines picked from each SRT: 4-12 words, unique in the film, not a caption or a lyric |
| `scenes` | `runs-v3/sonnet-alone-<slug>.json` (five films) and `scenes.nemo.grounded.json` (Nemo) |
| `confirmed_by_second_run` | `runs-v3/sonnet-alone-<slug>-r2.json`, true when an r2 scene covers half the scene |
| `scene_labels` (events) | the scenes' taxonomy-v2 `attributes`, mapped through the `v2` arrays in `taxonomy-v3.js` |
| `scene_labels` (presence, mention — **asserted**) | `runs-v3/sonnet-presence-<slug>.json`, from `run-sonnet-presence.js`: one Claude call per scene |
| `scene_labels` (presence, mention — **screener leads**) | `runs-v3/*jev-v3-layers-<slug>*v3b.json`, max probability over the beats overlapping each scene. Never asserted. |
| `vocabulary`, `groups` | `taxonomy-v3.js` |
| `analysis_runs` | the model, taxonomy, script, start time and cost recorded in each run file |
| `time_mappings` | nothing yet — empty by design; the API applies one when it exists |
| `recordings` | `recordings/<slug>.jev.json` verbatim, plus `recordings/<slug>.excerpts.json` when the loading machine has it (it is git-ignored) |
| `jobs`, `job_blobs` | nothing at load time: written only by a live `/api/add` run |

**Almost no subtitle text is stored, and the exceptions are named.** The only verbatim words from a
track are: the three anchor quotes per film, each capped at 12 words, so a parent can find the line
on their own player; `recordings.excerpts`, which is the owner-approved beat-excerpt policy from
`RECORDINGS.md` (two lines of at most 12 words, flagged beats only); `jobs.excerpts`, the same
excerpts while a live run is going, nulled out the moment it reaches `done` or `failed`; and
`job_blobs.srt`, which holds one whole track for the minutes a live analysis is running and is
deleted the moment the job ends. The recording itself has no text in it at all — `test/recording.test.js` asserts that every
string in a served recording matches `^[\w.:+-]+$`.

To rebuild the presence labels (the only step that calls a model — about $0.42 for all six films):

```bash
cd ../experiments/trigger-scan
node run-sonnet-presence.js --all --dry-run   # see the prompts and a cost estimate, call nothing
node run-sonnet-presence.js --film nemo
```

---

## Four strengths of label, and why they are separate

This is the part an assistant must not flatten. Each scene sorts what we know into four lists:

| List | What it means |
|---|---|
| `present` | A per-scene judgement says it is in the scene. Each entry has `evidence`: `stated_in_lines` (this scene's subtitles show it — evidence from our data) or `known_from_film` (the model says it is on screen from knowing the film; our subtitles do **not** corroborate it). `both_sources_agree: true` when the independent screener also reached threshold. |
| `possibly_present` | Only the cheap per-beat screener leaned this way, with a probability. A lead to check, never a fact. |
| `talked_about_only` | In the dialogue while not in the scene ("there are sharks out there"). Often exactly what a parent does not mind. |
| `not_assessed` | Subtitles are blind to it and nobody looked. Absence proves nothing. |

Filters match `present` only, unless you pass `include_possible=true`.

Why the split exists: presence used to be rolled up from the per-beat screener by taking its
maximum probability over the beats inside a scene. That accumulates its false positives. On Finding
Nemo it made the barracuda attack, the scuba-diver capture and the pelican flight all "shark", the
minefield chase and the anglerfish "clown, doll or puppet", and "Darla believes Nemo is dead"
"something dead brought back to life". Those are now leads under `possibly_present`, and
`presence=shark` returns the four scenes that actually have a shark in them.

## Broad words

A parent who says "monsters" means frightening creatures of any kind. The taxonomy item
`monster_creature` excludes every ordinary animal by definition, so under it Finding Nemo has no
monsters at all — true about our taxonomy, useless to the parent. So `monster(s)`, `creature(s)`,
`scary creature(s)` and `beast(s)` resolve to the whole `creatures_figures` **group**, and the
response says so:

```json
{ "you_asked": "monsters", "broadened_to_group": "creatures_figures", "how": "broadened_to_group",
  "note": "\"monsters\" -> group creatures_figures (any frightening creature or figure; ask for a specific one, e.g. shark or ghost, to narrow)" }
```

`presence=monster_creature` still asks the narrow question. `GET /api/vocabulary` lists every broad
word under `broad_words`.

---

## Calibrating to the parent's copy

Every timestamp belongs to one subtitle track, which belongs to one release. Another release can
start tens of seconds off, and a PAL transfer of a 24 fps film runs about 4% faster, so an error
that starts at zero grows to minutes. Quoting raw times at a parent is the main way this API can be
wrong in a way that matters, so calibration is a first-class parameter:

```
# one anchor: corrects the start
/api/films/nemo/scenes?anchor_cue=C0056&observed_at=0:05:12

# two anchors far apart: corrects the start AND the playback speed
/api/films/nemo/scenes?anchor_cue=C0056,C1420&observed_at=0:05:12,1:31:00

# or, once someone has measured one
/api/films/nemo/scenes?platform=Disney%2B
```

`GET /api/films/{slug}` returns the anchor lines with our time for each. Every scene then comes back
with both `track_time` (ours) and `player_time` (theirs).

---

## Watch it work: `GET /api/films/{slug}/recording`

One real run of the per-beat screener over the whole film, precise enough to replay:

```json
{ "film": { "slug": "nemo", "title": "Finding Nemo", "year": 2003 },
  "recording": { "meta": {...}, "thresholds": {...}, "requests": [...], "beats": [...], "timeline": [...] },
  "excerpts": { "W014.4": [{ "cue": "C0404", "line": "...", "score": 1.42, "why": {...} }] } }
```

`recording` is the exact content of `experiments/trigger-scan/recordings/<slug>.jev.json`, and
**`RECORDINGS.md` in that directory is the contract** — the format and, more importantly, the replay
rules. The short version: iterate `recording.timeline` against a real clock and never stretch it, so
a five-second run takes five seconds; drive counters off each entry's running totals rather than
your own accumulator; do not sort the timeline into film order to make the board look tidy, because
beats really do arrive out of order.

`excerpts` is `null` for a film whose excerpt file was not on the machine that ran the loader (that
file is git-ignored), so a page has to work without it. The response is 700 KB to 1 MB, served
un-indented for that reason and cached like the other GETs.

## Adding a film: `/api/add` (internal)

The owner's own flow, and the only part of this API that spends money or writes rows outside the
loader. **It is not in `/api/openapi.json`.** It used to be, marked `x-internal` — but that is an
annotation, and an importer that enumerates `paths`, which is most of them, cheerfully offered a
parent two POST operations that spend money. The public document now contains the five read-only
routes and nothing else; the complete account of the deployment is at
`/api/openapi.json?internal=1`.

```
GET  /api/add/status                 -> { running: {id}|null, spent_today_usd, cap_usd,
                                          reserve_usd?, passcode_configured }
POST /api/add/resolve  { query, passcode }
                                     -> { candidates: [{ tmdb_id, imdb_id, title, year, poster_url,
                                                          overview, slug, exists }] }   (at most 3)
POST /api/add/jobs     { imdb_id, passcode, tmdb_id? }
                                     -> 202 { id }
GET  /api/add/jobs/{id}              -> the job's progress, no-store
GET  /api/add/jobs/{id}/recording    -> { recording, excerpts }
```

`query` is a title or anything with an IMDb id in it (`tt\d+` anywhere, so a pasted URL works).
`status`, `jobs/{id}` and `jobs/{id}/recording` are public — the 22-character job id is the secret.
The two POSTs need the passcode.

**`POST /api/add/jobs` takes the IMDb id and nothing else.** Title, year, slug, poster and synopsis
are looked up from TMDB by that id, server-side, rather than read out of the request. An earlier
version took them from the body, which meant the caller chose the title — and the title makes the
slug, and the slug decides which film's rows a run replaces. `tmdb_id` is accepted as a hint for
which TMDB record to use when one IMDb id resolves to more than one, and is ignored otherwise.

Ten wrong passcodes from one address inside ten minutes get a 429 (`too_many_attempts`). That
counter is in one function instance's memory — see the accepted risks above; it is best-effort and
a Vercel firewall rule is the real answer.

**Who "one address" is.** The web app proxies these calls from its own server, so without help every
visitor arrives as the same handful of egress addresses and ten anonymous wrong guesses lock out the
next person to type the right passcode. Set `ADD_FILM_PROXY_SECRET` to the same value on both
projects and the proxy may send `x-tinyviewers-client: <the visitor's ip>` alongside
`x-tinyviewers-proxy: <the secret>`; the counter then keys on that. Without the secret header the
identity header is ignored outright, because anyone can send one. The proxy sends the literal
`unknown` when it cannot see the visitor, and `unknown` is never used as a key — otherwise every
unidentifiable visitor would share one counter and ten guesses from any of them would lock out all
the rest, which is the failure this header exists to fix; those requests fall back to the socket
address instead, and are not counted at all if there is no socket. With the variable unset nothing
changes: the counter keys on `x-forwarded-for` and then the socket, as before.

Refusals, all of them deliberate:

| status | body | when |
|---|---|---|
| 401 | `error_code: "bad_passcode"` | wrong passcode (compared with `timingSafeEqual` over sha256, so length does not leak) |
| 503 | `error_code: "no_passcode"` | `ADD_FILM_PASSCODE` is not set on this deployment |
| 400 | `error_code: "empty_query"` / `"no_imdb_id"` / `"no_title"` | nothing to look up, or a film TMDB has no IMDb id for — OpenSubtitles has nothing else to search by |
| 409 | `error_code: "exists"`, `slug` | already in the database |
| 409 | `error_code: "busy"`, `id` | another run is in flight |
| 429 | `error_code: "daily_cap"`, `spent_usd`, `cap_usd`, `reserve_usd` | today's spend plus a $1.80 reserve for this run would pass the cap |
| 429 | `error_code: "too_many_attempts"` | ten wrong passcodes from this address in the last ten minutes |
| 502 | `error_code: "tmdb_failed"` | TMDB did not answer, or has no film with that IMDb id |

The reserve is $1.80 because that is the most one run may cost, not the most one is expected to
cost: the `jev` cap of $0.20 plus the `scenes` cap of $0.60 plus the `presence` cap of $1.00. All
three are enforced the same way — **each call reserves its own worst case before it is dispatched**
(the whole prompt billed as fresh input at 3 characters per token, plus a completely full output
buffer) and settles that reservation against the real bill when it lands. Checking completed
spending instead is not a cap when calls run five at a time: five presence workers each read the
same "still under $1.00" figure, all five dispatched, and the stage finished at $1.176. A stage now
refuses to dispatch when `spent + in flight + this call` would pass its cap, so the number is a real
ceiling and `spent + reserve > cap` is a real refusal. A normal film costs about $0.25 and
reconciles down to its true cost the moment it finishes.

**Busy and the daily cap are one statement, not a check followed by an insert.** `jobs` carries a
partial unique index (`jobs_one_live`, on `((true)) where status in ('queued','running')`), so the
INSERT is the lock: two simultaneous POSTs cannot both be admitted, whatever they each read a
millisecond earlier. The loser's `23505` becomes the same 409 `busy`.

A job that stops writing for six minutes is marked `failed` with `error_code: "timed_out"` by the
next caller that looks — including whoever is polling that very job — and stops holding the lock.
Nothing kills a function on time from inside, so the lock has to expire rather than be released. The
same call sweeps subtitle blobs older than thirty minutes, and so does `/api/films*` — once per
function instance per ten minutes, one DELETE against an indexed timestamp — because nobody is
sitting on an `/api/add` page when a run dies but somebody is usually reading about a film.
`vercel.json` also schedules a daily cron on `/api/add/status` (`0 3 * * *`) for a day nobody opens
anything. **Daily, not hourly:** Vercel's Hobby plan rejects any cron expression that would run more
than once a day, and the deployment fails rather than degrades. So thirty minutes is the age at
which an orphan becomes *eligible* to be swept, not a promise about when it will be: in practice
minutes on a deployment anybody is using, and within a day on one nobody is. A blob is deleted at
`done` or `failed` anyway, and a run that died without reaching either also loses its `excerpts`
when the next caller marks it `timed_out`.

Once admitted, the run continues in the background of the same invocation via `waitUntil` from
`@vercel/functions`, with `maxDuration: 300` on `api/add/jobs.js` in `vercel.json` (Fluid compute
allows 300 s on Hobby). Poll `GET /api/add/jobs/{id}`:

```json
{ "id": "…", "status": "running", "step": "presence", "film": {...},
  "steps": [{ "id": "jev", "label": "Screening every beat", "status": "done",
              "started_ms": 1840, "ended_ms": 7051, "detail": "247 beats x 103 questions in 5.2s, 106 flagged" }],
  "cost_usd": 0.0847, "recording_ready": true,
  "scene_count": 30, "error_code": null, "error": null,
  "created_at": "...", "updated_at": "...", "elapsed_ms": 74213 }
```

`started_ms` and `ended_ms` are offsets from the job's own start, in milliseconds, so the page never
has to reason about our clock. `scene_count` appears after `scenes`, and `film.slug` is the page to
send someone to when `status` is `done`. A failed run keeps every step it finished and whatever it
had already spent.

**The recording is not in this body.** It is 0.7-1.3 MB, it never changes once the `jev` step has
finished, and this endpoint is polled every 1.5 s — so `recording_ready` turns true about five
seconds in, and the page fetches `GET /api/add/jobs/{id}/recording` once:

```json
{ "recording": { "meta": {...}, "thresholds": {...}, "requests": [...], "beats": [...], "timeline": [...] },
  "excerpts": { "W014.4": [{ "cue": "C0404", "line": "...", "score": 1.42, "why": {...} }] } }
```

Same shape as `GET /api/films/{slug}/recording`, and served un-indented for the same reason. It is
404 `no_recording` until the `jev` step finishes, `no-store` while the run is going and cacheable
once it is not. `excerpts` is null after the job ends: the evidence lines live on the film from then
on, and the job row does not keep subtitle text it no longer needs.

One consequence worth knowing before you draw a budget bar: `spent_today_usd` on
`/api/add/status` includes the $1.80 reserve of a run that is still going, and drops to that run's
real cost (about $0.25) when it finishes. That is the conservative direction — the cap must not
admit a second run on the strength of a first one that has not been billed yet — but it means the
number moves down at the end of a run, not only up. **`reserve_usd` says how much of it is the
reserve**, so a page can show "$1.92 of $5.00 today, including $1.80 set aside for the run in
progress" rather than a bar that jumps and then falls back with no explanation. The field is
present only while a run is live; its absence means there is no reserve in the figure.

**Money is written to the row as it is spent, not when a stage ends.** `cost_usd` starts at the
$1.80 reserve the moment the job is created, rises as each priced call returns — the moment a
response arrives, before it is parsed or its `stop_reason` is looked at, because a truncated or
unparseable answer costs exactly what a good one costs — and is replaced by
the run's real total exactly once, at `done` or `failed`. A run the platform kills at 300 s never
reaches either, so its row keeps the reserve rather than reading as free — which is what let the
daily cap admit run after run after a crash.

The six stages, and what each costs:

| stage | what it does | typical |
|---|---|---|
| `subtitles` | OpenSubtitles: hearing-impaired English first (sound captions are the only proxy for a wordless fright), then any English; downloads candidates until one parses to ≥ 300 cues | free, ~2 s |
| `jev` | the recorded screening run: 103 questions per beat, concurrency 8, `jev-1.13.0`, capped at $0.20 | ~$0.08, ~5 s |
| `scenes` | one Sonnet pass over the whole transcript, 16k output ceiling, capped at $0.60 | ~$0.10, ~60 s |
| `presence` | one Sonnet call per scene, concurrency 5, capped at $1.00 | ~$0.07, ~60 s |
| `excerpts` | the lexical rule in `pipeline/excerpts.js`, then `verifyExcerpts` over its own output; no model call | free |
| `ingest` | the same `buildFilmFrom` the loader uses, plus the recording | free |

Failures are named rather than generic: `subtitle_quota` ("OpenSubtitles download limit reached for
today", from a 406 or a 429), `no_subtitles`, `no_subtitle_key`, `subtitle_search_failed`,
`no_scenes`, `scenes_cap` (this film's transcript will not fit inside the scene pass's cost cap),
`jev_cap` (the screening pass would pass its own cap), `excerpts_policy` (the evidence lines came
out outside the policy, so the film was not written in), `exists` (another film took this slug, or
this IMDb id, while the run was going — a live run only ever inserts, so it stops rather than
replacing somebody else's film), `vocabulary_mismatch` (the database is labelled with a different
taxonomy version than this pipeline writes), `timed_out`, and `internal` for anything unexpected.
An upstream failure never passes its message through, and is not logged either: an error body from
Jev or Anthropic quotes the request back, and the request is subtitle lines. Only the service name,
the HTTP status, the upstream request id and a short code of our own survive.

**Two films can be called the same thing.** The slug is decided at admission, and another run can
commit onto it in the minutes a run takes, so the slug is re-derived inside the transaction that
writes the film: a free slug is used, a taken one is suffixed (`same-title-1994`), and the same
IMDb id already being present fails the run as `exists`. The loader still replaces — running it
over the experiment outputs is meant to — but a live run never deletes a row it did not write.
Adding a film likewise only *inserts* missing vocabulary rows; it will not rewrite a label somebody
has corrected by hand.

The analysis code lives in `pipeline/`, copied from `experiments/trigger-scan` at commit `5fe8fb5`.
`pipeline/README.md` says what changed and why it is a copy rather than an import.

## The Jev-first pipeline (v10.4): adds, library rebuilds, the live demo

New films are analysed by the frozen experiment pipeline **v10.4** (`experiments/trigger-scan/v10_4`,
frozen 2026-09-25): Sonnet reads the film from verified sources only (subtitles, TMDB cast, the Wikipedia
plot, with citations), Jev checks Sonnet's scene cut and claims, answers the per-scene questions, the
child-cry, resolution-guard and mortal-danger questions and the exact moments, Sonnet answers its ten
meaning concepts, and code decides the flags. The parent text follows the **A0>C** rule (a Jev-verified
Sonnet text or title, strict when one passed, else loose: supports >= 0.4 and contradicts < 0.3; never a
contradicted, unplaced or reversed one; never text built by code), and **every flagged scene says why**:
its flag reasons as plain tags ("Creature threatens · Child in danger"), each with the model that raised it.

- `pipeline-jevfirst/pack/` is the experiment's modules byte for byte (`scripts/sync-jevfirst-pack.mjs
  --from ../experiments/trigger-scan/v10_4 [--check]`; `pack/SOURCE.json` records the hashes, which equal
  `v10_4/out104/freeze.json`). The script bodies are ported in `pipeline-jevfirst/stages/`, and
  `test/jevfirst-parity.test.js` checks the ports against the experiment's own CLIs on round 9's stored
  outputs (check_describe replayed from stored Jev answers, the A0>C merge, select3, resolve and mortal).
- **Orchestration** (`pipeline-jevfirst/runner.js`): a run is a chain of 300 s invocations. Each takes the
  job's lease (one conditional UPDATE), runs checkpointed stages (`job_stages`) while its time budget
  allows, releases the lease and calls `POST /api/add/jobs/{id}/continue` on its own deployment with
  `x-continue-secret: $ADD_FILM_PROXY_SECRET` inside `waitUntil`. A continuation that never lands is
  re-asked by the next poll of `GET /api/add/jobs/{id}` once the job is quiet (one poll wins the kick). A
  crashed stage re-runs with its spending high-water mark carried, so per-stage caps hold across crashes.
  Crons are daily on Hobby, so nothing relies on them.
- **Money**: every call reserves its worst case before it is sent. An add or rebuild reserves $2.41 (the
  sum of v10.4's stage caps, `pipeline-jevfirst/caps.js`) against the day's cap at admission; the row is
  reconciled to the real cost at the end (a v10.3/v10.4 film costs about $0.55-0.70).
- **Where it lands**: the guide tables the web reads, unchanged in shape, plus `scenes.why_tags` (`{ line, tags: [{ label, category?, by, p }] }`, the flag reasons the film page shows under "Why it's included"; a film-specific reason ("The Iron Giant in danger") carries a stable `category` ("Character in danger") that is its chip and its filter; added by `schema-jevfirst.sql`, null on older guides). A sonnetq run that could not answer every scene fails the job (it never replaces a guide with fewer reasons), and a title or description sentence that still holds more than eight words of the subtitles is dropped at the last step, never repaired. Flagged scenes only; title and
  description per the text rule; presence chips from taxonomy v3; event chips = the flag reasons (vocabulary
  rows `reason:*`, `taxonomy_version 'reasons-v10.4'`, excluded from `/api/vocabulary`). The run's documents
  go to `jevfirst_artifacts` (what the demo reads).

```
POST /api/admin/rebuild  { passcode, slug }       -> 202 { id, slug, poll }   poll GET /api/add/jobs/{id}
POST /api/admin/backups  { passcode, slug }       -> { backups: [...] }
POST /api/admin/restore  { passcode, backup_id }  -> { restored, scenes, backup_of_current }
```

A **rebuild** re-runs an existing library film (its stored track in `subtitle_tracks`, else OpenSubtitles
by its IMDb id) and, in the ingest transaction, copies the old guide into `guide_backups` and replaces it.
A failed rebuild changes nothing. A restore backs up the current guide first, so it can be undone.
`node scripts/rebuild-library.mjs [--films nemo,frozen] [--keep-going]` rebuilds the library one film at a
time (default: nemo, frankenweenie, frozen, monsters-inc, room-on-the-broom, iron-giant, lion-king,
wild-robot); it needs `ADD_FILM_PASSCODE` in the environment or a `.env.local`, and never prints it.

The **live demo** (`/api/demo/*`) runs Jev's stages live on a film's stored Sonnet work (any film a
rebuild or an add wrote, or one seeded locally by `scripts/seed-jevfirst.mjs`): split check, claim and
text checks, the per-scene questions, child-cry, resolution guard, mortal questions, moments, then the
code selection; Sonnet is never called. Progress is written per completed request; the result lists each
flagged scene with its why tags and who answered, compared with the film's current guide and its last
full run. Each flagged scene's `why` carries, per reason, the question as the model was asked it, Jev's line and the policy rule (`pipeline-jevfirst/why-detail.js`). The counters mean what the page says: `split_check.done/total` are cuts (`doubtful` = merge candidates), `claims.done/total` are sentences (claim and description checks); every other request is in `requests_done/requests_total`, a request that failed is `failed` and never counted as done, each scene carries its own `cut` verdict and `questions` count, and every feed item names its `scene`. Fenced by a per-client limit, two runs at once, and `DEMO_DAILY_CAP_USD` (default $2) taken as a
reservation (about $0.60 a run, reconciled to the real ~$0.03-0.06). The day's total counts every run live
at any time that UTC day (created today, ended today, or still going), so a run that crosses midnight is
never forgotten while it spends.

A demo run **resumes like an add job** (`pipeline-jevfirst/demo.js`): one invocation at a time holds its
lease (short, renewed by a heartbeat); every finished stage checkpoints its output (`demo_run_stages`) and
the progress document (`demo_runs.checkpoint`); an invocation that runs short of time hands off through
`POST /api/demo/runs/{id}/continue` (same secret, same `waitUntil` self-call), and a poll of
`GET /api/demo/runs/{id}` that finds the run quiet asks again. A stage cut short re-runs with the page put
back to the last checkpoint, so nothing is counted twice. Every write an invocation makes is fenced by its
lease: one whose lease lapsed and was taken over cannot write progress, a stage output (written in the same
statement as the checkpoint that names it) or the run's end, and it deletes the run's checkpoints only when
its owner-conditional end changed the row. An ending invocation drains its queued writes before it stops its
heartbeat. No request goes out until a spending mark
covering it is durable (`demo_runs.mark_usd`); a crashed invocation's spend is carried at that mark, a
request that never answered, a 200 whose body could not be read or is not a JSON object (`null`, an array),
an answer whose `usage.input_tokens` is not a number above zero, and a failure that brought no attempt history
are each charged at their reservation (the attempts before them kept), and those unmeasured parts are reported
apart (`cost_uncertain_usd`), never as a bill. A reservation still open when an invocation ends or hands off
is charged the same way. The same rule holds for Sonnet in adds and rebuilds (`stages/common.js`
`sonnetCall`): a stream whose usage cannot be read (empty, no final output count, not token counts; the
start event's `output_tokens: 1` is a placeholder and never read as the bill) is charged at its whole
reservation, as uncertain, never at $0. A Jev 200 whose answer to any asked question is missing or unusable
for its type (a null or out-of-range noul, a choice or score without its confidence and distribution;
`pack/jev-client.js` `malformedAnswers`) is paid for by its usage and returned as a failed request, so no
stage reads it as a "no": the stage fails, and a rebuild keeps the guide it had. A finished row the v10.4.2 code ended during a rolling upgrade (`cost_usd` set,
`spent_usd` left stale) is brought into line by the demo sweep (`lib/demo.js` `healOldEndings`). A sentence's live verdict is
Jev's support answer (provisional); the run ends by reconciling the feed and `claims.final` with what the
guide actually kept (a summary sentence counts as kept only if it survived every acceptance step, the
judgement-word exclusion included). The comparison with the library's guide matches scenes one to one, by
overlap and with a boundary tolerance (each edge within 20 s or a quarter of the longer scene).

Every passcode route (`/api/add/*`, `/api/admin/*`) counts wrong passcodes in the database
(`passcode_failures`: 10 per caller per ten minutes), so the limit holds across function instances and cold
starts. An attempt is counted before it is compared, so concurrent guesses cannot overshoot, and a right
passcode gives its count back. The caller is the identity Vercel's edge writes (`x-real-ip`), or the visitor
our own web proxy vouches for with `ADD_FILM_PROXY_SECRET`; off Vercel it is the socket address. Wrong
passcodes across all callers only log a `[passcode]` alert at 60 in ten minutes: they never lock anyone
out, so strangers cannot lock the owner out (the passcode is 16 random characters). A restore takes the same one-live-job lock as a rebuild's admission,
inside its own transaction.

**Schema**: `schema-jevfirst.sql` (generated from `lib/schema-jevfirst.js` by `node scripts/emit-schema.mjs
--write`) is additive and idempotent. The API applies it itself on the first database use of an instance
(`lib/ensure-schema.js`: under an advisory lock, skipped once `schema_marks` records its version), so a
deploy needs no manual migration. `node scripts/emit-schema.mjs` prints it for anyone who wants to apply it
by hand.

**Functions**: every Jev-first route is one function, `api/jevfirst.js`, reached by the rewrites in
`vercel.json`, so the deployment has 12 functions (Hobby's limit).

## Neon and Vercel: how this is set up, and how to redo it

Steps 1 and 3 have been done: the Neon project `tinyviewers-scenes` and the Vercel project behind
<https://tinyviewers-scenes.vercel.app> both exist. They are written out so the setup is
reproducible and so step 2 — reloading the data — can be repeated whenever the experiment outputs
change.

1. **The Neon database.** Project `tinyviewers-scenes`. Use the **pooled** connection string — the
   one whose host contains `-pooler`, of the form
   `postgresql://USER:PASSWORD@ep-xxx-pooler.REGION.aws.neon.tech/DBNAME?sslmode=require`.
   `pg` and this code work with it as-is; `lib/db.js` turns SSL on when the URL says `neon.tech` or
   `sslmode=require`, and attaches a pool `error` listener so an idle connection dropped by Neon
   logs a line instead of killing the instance. Keep the real string in the Vercel environment
   variable and in an untracked `.env.local`; never in a file that is committed.

2. **Load it from your machine.** A deploy does not change any rows; this does.
   ```bash
   cd scene-api
   DATABASE_URL='postgresql://...-pooler.../neondb?sslmode=require' node load.js
   ```
   `load.js` applies `schema.sql` itself, so there is no separate migration step — a new column
   such as `films.overview` arrives with the load that first writes it. Expect 6 films,
   6 tracks, 18 anchors, 19 analysis runs, 103 scenes, 6,352 scene label rows, 72 vocabulary items,
   and 6 recordings (about 5 MB of jsonb, printed as a line per film in the report).
   Re-run it whenever the experiment outputs change; it replaces each film in a transaction. (The
   exact counts are printed by the loader — see the report line per film.)

3. **The Vercel project.** It builds from the GitHub **`main`** branch with **root directory
   `scene-api`**, and holds `DATABASE_URL` as an environment variable (production and preview).
   There is no build step and no framework: Vercel picks up `api/*.js` as Node functions and
   `vercel.json` adds the `/api/openapi.json` rewrite, `maxDuration: 300` on `api/add/jobs.js`, and
   a daily cron on `/api/add/status` (Hobby allows one run a day per cron and refuses anything more
   frequent at deploy time).
   `server.js`, `load.js` and `test/` are not part of the deployment; `pipeline/` is, because the
   add-a-film route imports it.

   **Still to be set by hand before `/api/add` works in production**, none of them in this
   repository: `ADD_FILM_PASSCODE`, `TMDB_API_KEY`, `OPENSUBTITLES_API_KEY`, `TYPESAFE_API_KEY`,
   `CLAUDE_API_KEY`, and optionally `ADD_FILM_DAILY_CAP_USD`. Until `ADD_FILM_PASSCODE` exists the
   flow is simply off: `/api/add/status` says `passcode_configured: false` and the two POSTs answer
   503, which is the right behaviour for a deployment nobody has armed yet.

   This is a project of its own. Confirm the target before any manual deploy: this directory must
   not be deployed into the Next.js app's project.

4. **Deploy.** Push to `main`. To check a deployment:
   ```bash
   curl https://tinyviewers-scenes.vercel.app/api/openapi.json | head
   curl 'https://tinyviewers-scenes.vercel.app/api/films?q=nemo'
   ```

5. **Vercel Authentication is off** for this project (Settings -> Deployment Protection). A
   connector cannot log in, so the API must answer an anonymous GET. It is read-only, has no
   secrets in its responses, and serves `Access-Control-Allow-Origin: *`. See the accepted risks
   at the top of this file for what that costs.

---

## Prompt a parent can paste into Muse

> I want you to build a connector for a public, read-only JSON API and then use it to answer
> questions about films for my child.
>
> The API is at `https://tinyviewers-scenes.vercel.app`. Read its OpenAPI description first:
> `https://tinyviewers-scenes.vercel.app/api/openapi.json`. Everything is a plain GET, there is no
> authentication, and CORS is open. Build the connector from that description.
>
> When I ask about a film:
> 1. Find it with `/api/films?q=<part of the title>`; use the `slug` that comes back.
> 2. Read `/api/films/{slug}` before quoting any times, so you know which release the timestamps
>    belong to and what the caveats are.
> 3. Turn what I said into filters using `/api/vocabulary`. "What is in it" words (monsters, sharks,
>    needles, the dark) go in `presence`; "what happens" words (chased, captured, someone dies) go
>    in `event`. Pass my child's age as `age`.
> 4. Call `/api/films/{slug}/scenes` with those filters and give me the list in time order.
>
> Broad words like "monsters" are answered with a whole group of creatures. If that gives me too
> much, offer to narrow it to a specific one, like sharks or ghosts.
>
> Before you give me times, ask me to play the film and tell you the clock time when you hear one of
> the anchor lines from `/api/films/{slug}`. Then pass `anchor_cue` and `observed_at` so the times
> match my screen. If I can give you two anchor lines, use both — that also fixes a copy that runs
> at a different speed.
>
> Respect the difference between the four lists on each scene. Tell me `present` things plainly, but
> say when one is marked `known_from_film`, because that means our subtitles do not actually show
> it. Do not read me `possibly_present` as though it were in the film — those are unconfirmed
> guesses from a cheap detector that is often wrong; only mention them if I ask you to dig, or use
> `include_possible=true` and label them as leads. `talked_about_only` means it is discussed but not
> shown. `not_assessed` means nobody could tell, so silence there is not reassurance.
>
> Always tell me, in your own words: that these scenes were found by reading the subtitles only, so
> anything purely visual (a scary face, a dark shape, flashing light) can be missed entirely; that
> the list is complete for the release it analysed, not a sample; and that nothing has been checked
> by a person. If the API returns a `nothing_matched` block, read me the screener leads instead of
> telling me the film is clear.

---

## Known limits of the data (from `experiments/trigger-scan/AUDIT.md`)

- Everything comes from subtitles. Purely visual frights, flashing light and wordless scoring are
  invisible. `AUDIT.md` names specific misses: Nemo's net, the Lion King fire, Zazu's cage.
- No scene, label or description has been reviewed by a human. Every row carries
  `review_status: 'unreviewed'`.
- Scene lists are one Sonnet run per film. Two identical Sonnet runs agree on about 64% of their
  flagged time, so `confirmed_by_second_run` is a useful signal and a sobering one.
- Presence is now one Claude call per scene, not a roll-up of the per-beat screener, which fixed
  the wrong labels described above. It has **not** been scored against a reference list — the
  improvement was judged by reading the six films' labels, nothing more. Recall is unmeasured.
- About two thirds of asserted presence labels are `known_from_film`, not `stated_in_lines`. Those
  are the model's knowledge of the film, which our own subtitle data does not corroborate. They are
  useful (the anglerfish is real and invisible to the subtitles) and they are also where a wrong
  label would come from. Treat `stated_in_lines` as evidence and `known_from_film` as testimony.
- The per-beat screener's probabilities are kept, never asserted, and served as leads. Its hand
  check was 74 of 97 confident hits right (76%) at the beat level; rolled up to a scene it is worse.
- Severity is a model's reading of a passage of dialogue, on a 0-3 scale, for two age bands only.
- `loved_one_dies` and `pet_animal_dies` have no taxonomy-v3 item. They are temporarily folded into
  the `dies` event with the lost distinction kept in `scene_labels.detail`. Taxonomy v4 should give
  them ids; the loader prints this as a TEMPORARY MAPPING on every run.
