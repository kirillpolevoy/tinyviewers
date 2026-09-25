# SHIP: the Jev-first pipeline (v10.4), the library rebuild, and the live demo

Branch `ship/jev-pipeline` (worktree `/Users/kpolevoy/tm-jev-ship`, from `origin/main` 7a2097d). Nothing
here is committed, pushed or deployed; the main session ships it. Two Vercel projects are involved:

| Project | Root | What changes |
| --- | --- | --- |
| scene API (`tinyviewers-scenes`) | `scene-api/` | Jev-first pipeline for new adds (default), admin rebuild/backups/restore, live demo API with resumable runs, schema v10.4.4 applied on cold start |
| web (`tinyviewers-web`) | `web/` | `/watch` live demo (picker, live check, finished list, one scene up close), add/rebuild card, film page copy and phone layout |

## 0. Before deploying

1. `cd scene-api && npm test` (223 pass, 0 skipped; every mandatory contract runs on committed synthetic
   fixtures). Optional, on a machine with the round-9 outputs:
   `JEVFIRST_REQUIRE_PARITY=1 node --test test/jevfirst-parity.test.js` (9 pass).
2. `cd web && npm test && npx tsc --noEmit && npx next build` (136 pass, typecheck and build clean).
3. Grep of the changed files (done 2026-09-25): no placeholder keys or test values in shipped code; the
   only `localhost` strings are the off-Vercel fallback in `scene-api/lib/jevfirst.js` `continueBase()` and
   the local server's own banner; the remaining `TODO` markers were already on `main` (phase-4 feedback,
   v10.2-sync notes).

## 1. Database: nothing to run by hand

The scene API brings its own schema up to date. On the first database use of each instance,
`lib/ensure-schema.js` applies the Jev-first section under an advisory lock and records
`jevfirst-schema-v10.4.4` in `schema_marks`. Every statement is additive and idempotent. New since
v10.4.2: `demo_runs` lease, money and checkpoint columns, the `demo_run_stages` table, the
`passcode_failures` table, and `jobs.kind` now accepts `'restore'`.

v10.4.4 adds one data step: demo runs written by the v10.4.2 code get their money columns filled in
from the old accounting, instead of the zeros the new columns started with. A finished run's `cost_usd`
becomes its `spent_usd` and `mark_usd`; the part of a `timed_out` run's cost it never measured becomes
`uncertain_usd`. A live run keeps its reservation as its mark, with what it had measured as its spend.
The new code never takes over such a live run: its old invocation may still be alive and it has no
checkpoint. The sweep ends it at its reservation. The step only touches rows the column defaults left
untouched, so applying it again changes nothing. It was checked on 2026-09-25 against the scratch
database `jevint`, which had v10.4.2 and v10.4.3: on the API's cold start v10.4.4 was recorded, the five
v10.4.2 runs went from a shown cost of $0 to their real cost (for example 0.056787), and the v10.4.3 rows
were left as they were. Production has none of these tables yet, so there it only creates them.

A rolling upgrade has one more case, handled by the demo sweep, not the schema (so the schema mark stays
v10.4.4): a v10.4.2 invocation still alive when v10.4.4 ran ends its run the old way, writing `cost_usd` but
leaving `spent_usd` at the figure measured at the upgrade, so the page showed a stale cost ($0.01 against a
$0.12 final bill in Astra's reproduction). The new code always ends a run with `spent_usd = cost_usd`, so the
sweep that every demo status, poll and admission already runs (`lib/demo.js` `healOldEndings`) gives any
finished row where they differ the same money columns the upgrade gives an old finished run. `cost_usd`, what
the daily cap counts, never goes down, and a run the old sweep ended keeps the part it never measured as
`uncertain_usd`. Production has no v10.4.2 demo code, so there this never matches a row.

To apply it by hand anyway (for example, before the deploy, from a laptop):

```bash
cd scene-api
node scripts/emit-schema.mjs > /tmp/jevfirst.sql          # the same SQL as schema-jevfirst.sql
psql "$DATABASE_URL_UNPOOLED" -v ON_ERROR_STOP=1 -f /tmp/jevfirst.sql
```

(Take the Neon URL from its dashboard. Never shell-source a `.env` file to get it.)

## 2. Environment variables: none new

Nothing new is required. Check that these are already set:

- **scene API**: `DATABASE_URL`, `TYPESAFE_API_KEY`, `CLAUDE_API_KEY`, `TMDB_API_KEY`,
  `OPENSUBTITLES_API_KEY`, `ADD_FILM_PASSCODE`, and `ADD_FILM_PROXY_SECRET`. That secret is also the
  continuation secret for add, rebuild and demo hand-offs. Without it, a Jev-first add or rebuild on
  Vercel is refused with 503 instead of being left stuck.
- **web**: `DATABASE_URL`, `SCENE_API_URL`, `ADD_FILM_PROXY_SECRET` (the same value). The API also
  uses this secret to trust the visitor identity the web sends with a passcode. Without it, every web
  visitor looks like the web's own address and shares one wrong-passcode limit.
- Optional, with these defaults: `ADD_PIPELINE` unset (the Jev-first pipeline; `live` switches adds back
  to the old pipeline), `DEMO_DAILY_CAP_USD=2`, `REBUILD_DAILY_CAP_USD=15`,
  `ADD_FILM_DAILY_CAP_USD=5`. Leave `JEVFIRST_LOCAL_BUDGET_MS` unset (it is a local-only test knob, and
  Vercel ignores it).
- The continuation self-call goes to `VERCEL_PROJECT_PRODUCTION_URL` on production, which deployment
  protection does not cover. If preview deployments are protected, previews also need
  `VERCEL_AUTOMATION_BYPASS_SECRET`; production does not.

## 3. Deploy order

1. **scene API first.** Its changes are additive, and the web deployed now keeps working against it.
   After it is live:
   - `curl -s https://tinyviewers-scenes.vercel.app/api/demo/status`: expect
     `available: true` (or `reason: daily_cap`), never `not_configured`.
   - `curl -s https://tinyviewers-scenes.vercel.app/api/demo/films`: expect the stored films. After the
     rebuild in step 3 it lists every library film.
   - The first request triggers the schema check. The function log should show no `[schema]` error.
     `schema_marks` then has `jevfirst-schema-v10.4.4`.
   - Passcode limits (scene API, every `/api/add/*` and `/api/admin/*` route): 10 wrong passcodes per
     caller per ten minutes, counted in the database. The caller is the address Vercel's edge writes
     (`x-real-ip`), or the visitor our web proxy vouches for with `ADD_FILM_PROXY_SECRET`. Other callers'
     wrong guesses never lock anyone out. At 60 wrong passcodes across all callers in ten minutes the
     function log shows one `[passcode]` alert line. Nobody is refused because of it.
2. **web second.** Smoke test on production:
   - `/watch`: the film list comes right under the intro. Start one live check (it costs about 3 to 6
     cents and counts against the $2 daily demo cap) and watch it finish. Then open one scene, press
     "Back to scene list", and confirm you land on the same row.
   - Open one film page (`/film/<slug>`) on a phone and on a desktop.
3. **Library rebuild** (spends money: about $0.55 to $0.70 a film, so about $5 for all eight). It runs
   one film at a time, and each film's guide is replaced in a single step, with the old guide kept as a
   backup:

   ```bash
   cd scene-api
   node scripts/rebuild-library.mjs --api https://tinyviewers-scenes.vercel.app
   #   default films: nemo, frankenweenie, frozen, monsters-inc, room-on-the-broom, iron-giant, lion-king, wild-robot
   #   --films nemo,frozen   only these     --keep-going   do not stop at a failure     --dry-run   print the plan
   ```

   The passcode is `ADD_FILM_PASSCODE`, taken from the environment or parsed from `scene-api/.env.local`
   or `../.env.local`. It is never printed. The script prints one line per film: status, scenes, cost and
   backup id. A failed rebuild leaves that film's guide exactly as it was. Each admission reserves $2.41
   against `REBUILD_DAILY_CAP_USD` and is reconciled to the real cost when the film finishes. The day's
   total (adds and rebuilds together) counts every job that was live at any time that UTC day. A rebuild
   admitted before midnight that finishes after it counts on both days, so a batch that crosses midnight
   can be refused early. It is never admitted past the cap.

   After it finishes, open each film page. Film-specific reasons now show as stable chips
   ("Character in danger") with the film's own words inside the open row. `/watch` then offers every
   rebuilt film for a live check.

## 4. Rollback

- **One film's guide**: `POST /api/admin/backups {passcode, slug}` lists that film's backups, newest
  first. `POST /api/admin/restore {passcode, backup_id}` puts one back. The guide it replaces is backed up
  first, so a restore can be undone the same way. A restore is refused (409) while an add or rebuild is
  running.
- **New adds back to the old pipeline**: set `ADD_PIPELINE=live` on the scene API and redeploy it.
  Running Jev-first jobs finish on their own pipeline.
- **Live demo off**: set `DEMO_DAILY_CAP_USD=0` on the scene API. `/watch` then says today's live checks
  are used up and still links each library film's saved guide. To also remove the nav entry, set
  `WATCH_LINKED = false` in `web/lib/copy.ts` and redeploy the web.
- **Code**: in Vercel, use Instant Rollback (promote the previous production deployment) on each project.
  Roll back the web first, then the API. The schema is additive, so the database needs no rollback; the
  old code ignores the new columns and tables.

## 5. What was verified locally (2026-09-25)

Setup: scene API on `:8797` with the real keys and a scratch Postgres (`jevint`), web `next start` on
`:3497`.

- Three real demo checks went through the web proxy:
  - Iron Giant: 27.1 s, 5.6¢, 3 invocations with HTTP hand-offs (`JEVFIRST_LOCAL_BUDGET_MS=8000`). It
    matched the saved guide 11 = 11 one-to-one.
  - The Gruffalo: 20 s, 3.4¢, 2 invocations; 8 = 8.
  - The Gruffalo again: 3.4¢; 9 scenes against the saved 8, shown as "1 extra · 0 missing".
- A failed check with an invalid Jev key: `split_check_failed`, cost $0.
- Screenshots of every changed screen, desktop and true 390x844 phone, are in the scratchpad
  (`jev-ship/final-*.png`). No page scrolls sideways at 390 px.

Scene API ship-blocker round (after Astra's code re-check), same scratch database, API only:

- **Schema**: v10.4.4 applied itself on the API's cold start. The v10.4.2 runs now show their real costs.
- **A real demo check** (The Gruffalo), called on the API directly: 21 s, 3.4¢ (all measured), 3
  invocations with two HTTP hand-offs through the fenced checkpoint statement. It matched the saved guide
  8 of 8 plus 1 extra, with the new edge tolerance. When it ended, no checkpoint rows were left and the
  lease and slot were released.
- **Takeover, on real Postgres** (`pg` driver, stubbed Jev, $0): invocation B took over the run at
  classify, and the old invocation's stage then failed. The old invocation reported the lost lease and
  left B's four checkpoints alone. The run stayed B's.
- **Passcode limits**, on two API instances sharing the database: 80 callers made one wrong guess each
  and all got 401. The owner then got in (200). A burst of 60 simultaneous wrong guesses from one caller,
  split over both instances, had exactly 10 compared (the other 50 got 429). One `[passcode]` alert was
  logged, and an expired row was pruned.
- **Day total for adds and rebuilds**: a rebuild created yesterday and finished today at $2.41 raised
  `/api/add/status` `spent_today_usd` by $2.41. (That test row was then deleted.)
- **Not verified here**: Vercel's own `x-real-ip` / `x-forwarded-for` behaviour (the API trusts those
  headers only when `VERCEL=1`), and any browser rendering (no web change in this round).

Scene API round 2 (Astra's second code review), API only, no web change:

- **Malformed 200s** (the blocker). Before: a request whose first attempt died on the socket and whose retry
  got HTTP 200 `null` threw a TypeError when its usage was read; the catch lost the attempt history and
  settled both reservations at $0. Astra's offline full-demo reproduction was 268 attempts and $0 recorded;
  the new test reproduced exactly that (268 attempts, $0) before the fix. Now (`pack/jev-client.js`, our shim,
  not a frozen file):
  - a 200 that is not a JSON object is 'unparseable', like invalid JSON, with its attempts kept;
  - an answer whose `usage.input_tokens` is not a number above zero is charged at its reservation;
  - a failure with no attempt history is charged at everything reserved for it;
  - all of these count as uncertain, never as a measured bill.
  As a backstop, a demo invocation that ends or hands off with a wallet reservation still open charges it the
  same way (`pipeline-jevfirst/demo.js` `chargeOpen`).
- **On real Postgres** (pg driver, scratch copy `jevr2` of `jevint`, Jev stubbed, $0), the same fault on
  The Gruffalo: 136 attempts, the run charged $0.00817, all of it uncertain (`GET /api/demo/runs/{id}`: `cost_usd`
  0, `cost_uncertain_usd` 0.00817). A second admission under a cap of one reservation was refused (429 `daily_cap`).
- **Rolling-upgrade display**, same database: a row the old code ended at $0.12 while `spent_usd` said $0.01
  now shows $0.12. A row the old sweep ended at its $0.60 reservation shows $0.01 billed and $0.59 uncertain.
  The day's total was unchanged by the heal.
- **A real demo check** (The Gruffalo, API only, real keys, `jevint`): 21 s, 3.4¢ ($0.034101), all of it
  measured (uncertain 0), 2 invocations with one hand-off, 8 of 8 scenes matching the saved guide. Real Jev
  responses still carry a readable `usage.input_tokens`, so the new rule does not turn real bills into
  upper bounds. The day's total rose by exactly $0.034101.
- On the API's cold start the sweep found one row in `jevint` with `spent_usd` ($0.003977) above
  `cost_usd` ($0) and raised `cost_usd` to it. It was a failed run with error code `verification`, left
  from an earlier check.

Round 2 verification (both fix rounds together, 2026-09-25), web `:3497` and scene API `:8797` on `jevint`:

- scene-api `npm test` 218 pass; web `npm test` 129 pass, `tsc --noEmit` and `next build` clean; the frozen
  pack matches `experiments/trigger-scan/v10_4` (`sync-jevfirst-pack.mjs --check`).
- Schema: with the v10.4.4 mark removed, the API's cold start recorded `jevfirst-schema-v10.4.4` again and
  left every `demo_runs` money column unchanged (same checksum before and after).
- One real Iron Giant check through the web proxy: 27.5 s, 5.7 cents ($0.057061, none of it uncertain), 3
  invocations. It found 12 scenes against the saved 11 ("2 extra scenes, 1 missing": one is the same
  Mansley scene starting 35 s earlier, past the edge tolerance). The day's total rose by exactly that amount.
- One check with an invalid Jev key: `split_check_failed` after 3 s, $0, slot and lease released, day total
  unchanged.
- Screens at 1296 and true 390x844 (`jev-ship/r2/`: `watch-picker-*`, `live-f1..f7-*`, `run-finished-*`,
  `scene-reasons-*`, `run-failed-*`, `run-failed-open-*`, `film-scene-open-*`, `add-card-*`). No page
  scrolls sideways at 390 px.

Scene API round 3 (Astra's third code review, both blockers), API only. No schema change: the mark stays
v10.4.4.

- **Null Jev scores could replace a good guide with a worse one.** Before: the stages read a noul answer
  with `Number()`, so `noul: null` became 0, a "no". Astra's in-memory rebuild with every mortal-danger
  answer null finished `done` and took the guide from 13 "Deadly fall" reasons to 0. The new test reproduced
  exactly that (13 to 0, `done`) before the fix. The frozen `classify.js` also copied a null v9 answer through,
  and `check-describe`'s reader turned a missing one into 0. Now `pack/jev-client.js` (our shim, not a frozen
  file) checks every answer against the question it answers, before any stage sees it (`malformedAnswers`):
  - a noul must be a number from 0 to 1;
  - a choice must have a non-empty choice, a confidence and a probability distribution;
  - a score must have a number, a confidence and a probability distribution.
  A response that fails the check is paid for by its usage, like any answer, and returned as a failed
  request. The stage then fails (`jev_answers_failed` / `jev_check_failed` / `split_check_failed`), so an add
  writes nothing and a rebuild keeps its guide. The moments stage keeps the experiment's own fallback for a
  failed request: the whole scene becomes the skip span. The stage readers now use `probOf` (never
  `Number()`), in `stages/answers.js` (child-cry, resolve, mortal), `stages/text.js` (reason check) and the
  demo's cut feed (`demo.js`). The recorded real runs hold 445,626 noul, 3,227 choice and 19,362 score answers.
  None of them fails the check.
- **Unreadable Sonnet usage recorded $0.** Before: a successful stream with an empty usage settled its
  reservation at $0 (Astra: $0.10 reserved, $0 recorded). An offline add with no usage in any stream made
  12 Sonnet calls, recorded no Sonnet spend and ended `done`; the new test reproduced that (12 calls, $0).
  A final event with no output count was read at `message_start`'s placeholder of 1 token. Now:
  - `pack/sonnet.js` never reports the placeholder, and `usageReadable` accepts only input and output token
    counts above zero, plus cache counts that are absent, null or counts;
  - `stages/common.js` `sonnetCall` charges any other usage at the call's whole reservation, as uncertain;
    that goes for successful calls and failed ones alone;
  - stage rows carry `cost_is_upper_bound`.
  The recorded real runs hold 406 Sonnet usages; all are readable.
- **Real rebuild of The Gruffalo** (API `:8797`, real keys, `jevint`): `done` in 99 s, $0.201. It made
  159 Jev requests, and none failed the new check. The guide was rewritten (9 scenes, all with reasons) and
  the old one kept as a backup. Sonnet's 6 recorded calls were all priced from a readable usage; none was
  charged as an upper bound. The whole-film cut, for example, cost $0.095884, which is exactly its usage price
  (14,427 in, 6,703 out, the output count taken from the final event), against a $0.31194 reservation.
- **Real demo check of The Gruffalo**, on the API directly: `done` in 16 s, $0.028187, none of it uncertain.
  All 22 cuts got a real verdict from the new cut reader (7 doubtful, 11 uncertain, 4 confirmed, none
  `no_answer`), and no request was counted as failed.
- The failure paths (null scores, empty usage) cannot be produced with the real services. They are shown
  in-process with stubs: 5 new tests in `test/jevfirst.test.js` (section "Astra's round-3 code review"),
  each failing before the fix. scene-api `npm test` gives 223 pass. Parity with
  `JEVFIRST_REQUIRE_PARITY=1` gives 9 pass. The 37 frozen pack files still match `SOURCE.json`.

Round 3 verification (both round-3 fix passes together, 2026-09-25), web `:3497` (`next start`) and scene API
`:8797` on `jevint`:

- scene-api `npm test` 223 pass; parity with `JEVFIRST_REQUIRE_PARITY=1` 9 pass; web `npm test` 136 pass,
  `tsc --noEmit` and `next build` clean. The 37 frozen pack files match `SOURCE.json`.
- Schema: with the v10.4.4 mark removed, the API's start recorded `jevfirst-schema-v10.4.4` again and left
  every `demo_runs` money column unchanged.
- One real Iron Giant check through the web proxy: 26.1 s, 5.7 cents ($0.056719, none of it uncertain), 3
  invocations. It found 12 scenes against the saved 11 ("1 extra scene, none missing"). The day's total rose
  by exactly that amount ($0.599319 to $0.656038).
- One check with an invalid Jev key: `split_check_failed` after 2.1 s, $0, day total unchanged.
- Screens at 1296 and true 390x844 (`jev-ship/r3/`): picker, live run, finished run, a scene with 8 reasons
  and its checking details open, the failed run, the film page with a scene open, the add card (closed, open,
  finished add and rebuild, and a mid-run card from the mock API). No page scrolls sideways at 390 px, no
  console errors, and no 8-word run of the film's subtitles appears in the rendered pages or the run JSON.

## 6. Changed files (against origin/main 7a2097d)

- `scene-api/api/add/jobs/[id].js` (modified)
- `scene-api/api/jevfirst.js` (new)
- `scene-api/lib/add.js` (modified)
- `scene-api/lib/admin.js` (new)
- `scene-api/lib/data.js` (modified)
- `scene-api/lib/db.js` (modified)
- `scene-api/lib/demo.js` (new)
- `scene-api/lib/ensure-schema.js` (new)
- `scene-api/lib/http.js` (modified)
- `scene-api/lib/jevfirst.js` (new)
- `scene-api/lib/jobs.js` (modified)
- `scene-api/lib/openapi.js` (modified)
- `scene-api/lib/schema-jevfirst.js` (new)
- `scene-api/load.js` (modified)
- `scene-api/pipeline-jevfirst/caps.js` (new)
- `scene-api/pipeline-jevfirst/context.js` (new)
- `scene-api/pipeline-jevfirst/demo.js` (new)
- `scene-api/pipeline-jevfirst/guide.js` (new)
- `scene-api/pipeline-jevfirst/pack/accept.js` (new)
- `scene-api/pipeline-jevfirst/pack/aliases.js` (new)
- `scene-api/pipeline-jevfirst/pack/bridge.js` (new)
- `scene-api/pipeline-jevfirst/pack/budget.js` (new)
- `scene-api/pipeline-jevfirst/pack/check-describe.js` (new)
- `scene-api/pipeline-jevfirst/pack/check-split.js` (new)
- `scene-api/pipeline-jevfirst/pack/childcry.js` (new)
- `scene-api/pipeline-jevfirst/pack/cite.js` (new)
- `scene-api/pipeline-jevfirst/pack/claims.js` (new)
- `scene-api/pipeline-jevfirst/pack/classify.js` (new)
- `scene-api/pipeline-jevfirst/pack/combine.js` (new)
- `scene-api/pipeline-jevfirst/pack/credits.js` (new)
- `scene-api/pipeline-jevfirst/pack/describe.js` (new)
- `scene-api/pipeline-jevfirst/pack/describe2.js` (new)
- `scene-api/pipeline-jevfirst/pack/env.js` (new)
- `scene-api/pipeline-jevfirst/pack/fill.js` (new)
- `scene-api/pipeline-jevfirst/pack/gate.js` (new)
- `scene-api/pipeline-jevfirst/pack/jev-client.js` (new)
- `scene-api/pipeline-jevfirst/pack/jev-set.js` (new)
- `scene-api/pipeline-jevfirst/pack/jev.js` (new)
- `scene-api/pipeline-jevfirst/pack/ledger.js` (new)
- `scene-api/pipeline-jevfirst/pack/merge.js` (new)
- `scene-api/pipeline-jevfirst/pack/moments.js` (new)
- `scene-api/pipeline-jevfirst/pack/mortal.js` (new)
- `scene-api/pipeline-jevfirst/pack/policy.json` (new)
- `scene-api/pipeline-jevfirst/pack/questions.js` (new)
- `scene-api/pipeline-jevfirst/pack/reasons.js` (new)
- `scene-api/pipeline-jevfirst/pack/refold.js` (new)
- `scene-api/pipeline-jevfirst/pack/resolve.js` (new)
- `scene-api/pipeline-jevfirst/pack/segment-prompt.js` (new)
- `scene-api/pipeline-jevfirst/pack/select.js` (new)
- `scene-api/pipeline-jevfirst/pack/sonnet-questions.js` (new)
- `scene-api/pipeline-jevfirst/pack/sonnet.js` (new)
- `scene-api/pipeline-jevfirst/pack/sonnetq.js` (new)
- `scene-api/pipeline-jevfirst/pack/SOURCE.json` (new)
- `scene-api/pipeline-jevfirst/pack/sources.js` (new)
- `scene-api/pipeline-jevfirst/pack/spans.js` (new)
- `scene-api/pipeline-jevfirst/pack/split.js` (new)
- `scene-api/pipeline-jevfirst/pack/split.json` (new)
- `scene-api/pipeline-jevfirst/pack/text.js` (new)
- `scene-api/pipeline-jevfirst/pack/textrule.js` (new)
- `scene-api/pipeline-jevfirst/pack/textsafe.js` (new)
- `scene-api/pipeline-jevfirst/pack/validate.js` (new)
- `scene-api/pipeline-jevfirst/runner.js` (new)
- `scene-api/pipeline-jevfirst/srt.js` (new)
- `scene-api/pipeline-jevfirst/stages/answers.js` (new)
- `scene-api/pipeline-jevfirst/stages/checks.js` (new)
- `scene-api/pipeline-jevfirst/stages/common.js` (new)
- `scene-api/pipeline-jevfirst/stages/index.js` (new)
- `scene-api/pipeline-jevfirst/stages/ingest.js` (new)
- `scene-api/pipeline-jevfirst/stages/segment.js` (new)
- `scene-api/pipeline-jevfirst/stages/sources.js` (new)
- `scene-api/pipeline-jevfirst/stages/text.js` (new)
- `scene-api/pipeline-jevfirst/steps.js` (new)
- `scene-api/pipeline-jevfirst/store.js` (new)
- `scene-api/pipeline-jevfirst/taxonomy-v3.js` (new)
- `scene-api/pipeline-jevfirst/why-detail.js` (new)
- `scene-api/README.md` (modified)
- `scene-api/schema-jevfirst.sql` (new)
- `scene-api/schema.sql` (modified)
- `scene-api/scripts/emit-schema.mjs` (new)
- `scene-api/scripts/rebuild-library.mjs` (new)
- `scene-api/scripts/seed-jevfirst.mjs` (new)
- `scene-api/scripts/sync-jevfirst-pack.mjs` (new)
- `scene-api/server.js` (modified)
- `scene-api/test/add.test.js` (modified)
- `scene-api/test/fixtures/make-synthetic-srt.mjs` (new)
- `scene-api/test/fixtures/synthetic-film.srt` (new)
- `scene-api/test/jevfirst-parity.test.js` (new)
- `scene-api/test/jevfirst-stubs.js` (new)
- `scene-api/test/jevfirst.test.js` (new)
- `scene-api/test/load.test.js` (modified)
- `scene-api/test/unit.test.js` (modified)
- `scene-api/vercel.json` (modified)
- `web/app/add/job/[id]/page.tsx` (modified)
- `web/app/api/add/finish/route.ts` (deleted)
- `web/app/api/add/jobs/[id]/recording/route.ts` (deleted)
- `web/app/api/demo/films/route.ts` (new)
- `web/app/api/demo/resolve/route.ts` (deleted)
- `web/app/api/demo/runs/[id]/route.ts` (new)
- `web/app/api/demo/runs/route.ts` (modified)
- `web/app/api/films/[slug]/recording/route.ts` (deleted)
- `web/app/film/[slug]/film.module.css` (modified)
- `web/app/film/[slug]/page.tsx` (modified)
- `web/app/globals.css` (modified)
- `web/app/library/page.tsx` (modified)
- `web/app/page.tsx` (modified)
- `web/app/watch/[slug]/page.tsx` (modified)
- `web/app/watch/[slug]/replay.module.css` (deleted)
- `web/app/watch/page.tsx` (modified)
- `web/app/watch/run/[id]/page.tsx` (modified)
- `web/app/watch/watch.module.css` (deleted)
- `web/components/AddMovie.module.css` (modified)
- `web/components/AddMovie.tsx` (modified)
- `web/components/DemoPicker.module.css` (deleted)
- `web/components/DemoPicker.tsx` (deleted)
- `web/components/DemoRun.tsx` (deleted)
- `web/components/FilmControls.module.css` (modified)
- `web/components/FilmFindings.module.css` (modified)
- `web/components/FilmFindings.tsx` (modified)
- `web/components/HowItFits.tsx` (new)
- `web/components/Job.module.css` (deleted)
- `web/components/JobSteps.tsx` (deleted)
- `web/components/JobUnreachable.module.css` (deleted)
- `web/components/JobUnreachable.tsx` (deleted)
- `web/components/LibraryShelf.module.css` (modified)
- `web/components/LibraryShelf.tsx` (modified)
- `web/components/LiveRun.tsx` (new)
- `web/components/PeekCard.tsx` (modified)
- `web/components/RunReplay.module.css` (deleted)
- `web/components/RunReplay.tsx` (deleted)
- `web/components/SceneList.module.css` (modified)
- `web/components/SceneList.tsx` (modified)
- `web/components/useDemoRun.ts` (new)
- `web/components/useJob.ts` (modified)
- `web/components/useStartDemo.ts` (deleted)
- `web/components/useWidth.ts` (new)
- `web/components/Watch.module.css` (new)
- `web/components/WatchPick.tsx` (new)
- `web/components/WatchShell.module.css` (deleted)
- `web/components/WatchShell.tsx` (deleted)
- `web/lib/add-flow.ts` (modified)
- `web/lib/copy.ts` (modified)
- `web/lib/demo-lookup.ts` (new)
- `web/lib/demo.ts` (new)
- `web/lib/job-lookup.ts` (modified)
- `web/lib/job.ts` (modified)
- `web/lib/poll.ts` (modified)
- `web/lib/queries.ts` (modified)
- `web/lib/reasons.ts` (new)
- `web/lib/replay.ts` (deleted)
- `web/lib/scenes.ts` (modified)
- `web/README.md` (modified)
- `web/scripts/mock-scene-api.fixture.json` (new)
- `web/scripts/mock-scene-api.mjs` (new)
- `web/test/demo.test.ts` (new)
- `web/test/findings.test.ts` (modified)
- `web/test/job.test.ts` (modified)
- `web/test/reasons.test.ts` (new)
- `web/test/replay.test.ts` (deleted)
- `SHIP.md` (new; this file)

## 7. Deferred to a follow-up PR (owner's decision, 2026-09-25)

Astra's round-3 code re-check left two blockers of one class, which the owner chose to ship now and fix
in a separate PR: a malformed model response can be read as a confident answer instead of failing.

1. A Jev distribution missing a required choice (for example `supports`) is accepted
   (`scene-api/pipeline-jevfirst/pack/jev-client.js:125`), and the missing value becomes 0
   (`pack/claims.js:205`).
2. Sonnet `answers: null` is read as an empty list, so "no" for every question
   (`pack/sonnet-questions.js:162`; the completeness check in `stages/answers.js:204` only checks
   that scene entries exist).

Either one, during a rebuild, can replace a good guide with a worse one. Until the follow-up lands:
every rebuild backs up the old guide first, `POST /api/admin/restore` puts it back, and each rebuilt
film is compared with its backup (scene count, flagged count, descriptions) before the next film.

The follow-up closes the class, not the two instances: strict validation of every Jev and Sonnet
response where it enters (invalid = failed attempt, retried, then the stage fails and the old guide
stays), a field-by-field mutation test over recorded responses, and a check of the whole assembled
guide before ingest. It also carries Astra's remaining UX follow-ups (live phone strip cells, cluster
number caption, stopped-run wording, the long category explanation, hybrid-touch timeline) and the
comparison-freshness note.
