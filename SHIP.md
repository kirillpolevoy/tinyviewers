# SHIP: the Jev-first pipeline (v10.4), the library rebuild, and the live demo

Branch `ship/jev-pipeline` (worktree `/Users/kpolevoy/tm-jev-ship`, from `origin/main` 7a2097d). Nothing
here is committed, pushed or deployed; the main session ships it. Two Vercel projects are involved:

| Project | Root | What changes |
| --- | --- | --- |
| scene API (`tinyviewers-scenes`) | `scene-api/` | Jev-first pipeline for new adds (default), admin rebuild/backups/restore, live demo API with resumable runs, schema v10.4.3 applied on cold start |
| web (`tinyviewers-new`) | `web/` | `/watch` live demo (picker, live check, finished list, one scene up close), add/rebuild card, film page copy and phone layout |

## 0. Before deploying

1. `cd scene-api && npm test` (202 pass, 0 skipped; every mandatory contract runs on committed synthetic
   fixtures). Optional, on a machine with the round-9 outputs:
   `JEVFIRST_REQUIRE_PARITY=1 node --test test/jevfirst-parity.test.js` (9 pass).
2. `cd web && npm test && npx tsc --noEmit && npx next build` (114 pass, typecheck and build clean).
3. Grep of the changed files (done 2026-09-25): no placeholder keys or test values in shipped code; the
   only `localhost` strings are the off-Vercel fallback in `scene-api/lib/jevfirst.js` `continueBase()` and
   the local server's own banner; the remaining `TODO` markers were already on `main` (phase-4 feedback,
   v10.2-sync notes).

## 1. Database: nothing to run by hand

The scene API brings its own schema up to date. On the first database use of each instance,
`lib/ensure-schema.js` applies the Jev-first section under an advisory lock and records
`jevfirst-schema-v10.4.3` in `schema_marks`. Every statement is additive and idempotent. It was
checked on 2026-09-25 against a scratch database that already had v10.4.2, and v10.4.3 was added on the
API's cold start. New since v10.4.2: `demo_runs` lease, money and checkpoint columns, the `demo_run_stages`
table, the `passcode_failures` table, and `jobs.kind` now accepts `'restore'`.

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
- **web**: `DATABASE_URL`, `SCENE_API_URL`, `ADD_FILM_PROXY_SECRET` (the same value).
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
   against `REBUILD_DAILY_CAP_USD` and is reconciled to the real cost when the film finishes.

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

## 6. Changed files (against origin/main 7a2097d)

- `scene-api/api/add/jobs/[id].js` (modified)
- `scene-api/api/jevfirst.js` (new)
- `scene-api/lib/add.js` (modified)
- `scene-api/lib/admin.js` (new)
- `scene-api/lib/data.js` (modified)
- `scene-api/lib/db.js` (modified)
- `scene-api/lib/demo.js` (new)
- `scene-api/lib/ensure-schema.js` (new)
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
- `scene-api/vercel.json` (modified)
- `web/app/add/job/[id]/page.tsx` (modified)
- `web/app/api/add/finish/route.ts` (deleted)
- `web/app/api/add/jobs/[id]/recording/route.ts` (deleted)
- `web/app/api/demo/films/route.ts` (new)
- `web/app/api/demo/resolve/route.ts` (deleted)
- `web/app/api/demo/runs/[id]/route.ts` (new)
- `web/app/api/demo/runs/route.ts` (modified)
- `web/app/api/films/[slug]/recording/route.ts` (deleted)
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
- `web/components/FilmFindings.module.css` (modified)
- `web/components/FilmFindings.tsx` (modified)
- `web/components/HowItFits.tsx` (new)
- `web/components/Job.module.css` (deleted)
- `web/components/JobSteps.tsx` (deleted)
- `web/components/JobUnreachable.module.css` (deleted)
- `web/components/JobUnreachable.tsx` (deleted)
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
- `web/lib/replay.ts` (deleted)
- `web/lib/scenes.ts` (modified)
- `web/README.md` (modified)
- `web/scripts/mock-scene-api.fixture.json` (new)
- `web/scripts/mock-scene-api.mjs` (new)
- `web/test/demo.test.ts` (new)
- `web/test/findings.test.ts` (modified)
- `web/test/job.test.ts` (modified)
- `web/test/replay.test.ts` (deleted)
- `SHIP.md` (new; this file)
