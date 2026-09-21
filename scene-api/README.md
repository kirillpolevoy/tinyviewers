# scene-api

A read-only HTTP API over the scene database built from `experiments/trigger-scan`.

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

Nothing here calls a model. The whole database is built from files already on disk.

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
| **Machine-written, unreviewed `description` fields are exposed.** No human has read them, and `AUDIT.md` documents descriptions that name the wrong creature and one that invented an event. | The OpenAPI text and every response tell the assistant that descriptions are machine-written and may be wrong about who or what is on screen, and `review_status` is `unreviewed` on every row. | Before showing this to parents who are not the owner: review the descriptions, or stop returning `description` until a scene's `review_status` says a person has read it. |

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

`DATABASE_URL` is the only environment variable this project reads. Nothing here loads a `.env`
file by itself; if you keep the URL in `scene-api/.env.local`, use Node's own flag:

```bash
node --env-file=.env.local load.js
node --env-file=.env.local server.js
```

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
curl 'http://localhost:8787/api/vocabulary'
curl 'http://localhost:8787/api/openapi.json'
```

### Tests

```bash
npm test          # node --test test/
```

75 tests, no external database: they run against `@electric-sql/pglite`, which installed cleanly
here. They cover the schema applying twice (including over a populated database), loader
idempotency per film, that no verbatim subtitle text is stored, broad-word and ambiguous-word
filter matching, the present / possibly_present split, the age bands, the calibration arithmetic
(including a PAL 25/24 case and the implausible-anchor guard), `only_confirmed`,
`include_possible`, `min_severity=0`, repeated and misplaced query parameters, GET/HEAD/405,
cache headers, 400s, 404s, CORS, and the OpenAPI document.

---

## What is in the box

```
schema.sql        Postgres schema, idempotent. Targets Neon; runs anywhere.
load.js           Builds every row from experiments/trigger-scan and writes it. No model calls.
server.js         Local node:http router -> the same handlers Vercel would run.
api/              Vercel-style Node functions, one per route. Thin wrappers over lib/endpoints.js.
lib/              db, http plumbing, time arithmetic, word matching, response shaping, OpenAPI.
test/             node --test suites.
vercel.json       Rewrites /api/openapi.json and / ; CORS headers.
.env.local        Untracked. DATABASE_URL for local work against Neon. Never committed.
```

### Where the data comes from

| Table | Built from |
|---|---|
| `films` | `films.json` |
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

**No subtitle text is stored.** The only verbatim words from a track are the three anchor quotes per
film, each capped at 12 words, and they exist so a parent can find the line on their own player.

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
   `load.js` applies `schema.sql` itself, so there is no separate migration step. Expect 6 films,
   6 tracks, 18 anchors, 19 analysis runs, 103 scenes, 6,352 scene label rows, 72 vocabulary items.
   Re-run it whenever the experiment outputs change; it replaces each film in a transaction. (The
   exact counts are printed by the loader — see the report line per film.)

3. **The Vercel project.** It builds from the GitHub **`main`** branch with **root directory
   `scene-api`**, and holds `DATABASE_URL` as an environment variable (production and preview).
   There is no build step and no framework: Vercel picks up `api/*.js` as Node functions and
   `vercel.json` adds the `/api/openapi.json` rewrite. `server.js`, `load.js` and `test/` are not
   part of the deployment.

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
