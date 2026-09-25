-- =============================================================================================
-- The Jev-first pipeline (pipeline-jevfirst/, v10.4): new-film adds (the default; ADD_PIPELINE=live
-- switches back), library rebuilds, and the public live Jev demo. Everything below is additive and
-- IDEMPOTENT: safe to apply any number of times, on a fresh database or on production. The scene-api
-- applies this file itself on a cold start (lib/ensure-schema.js: once per instance, under an advisory
-- lock, skipped when schema_marks already records this file's version), so no manual migration is
-- needed; 'node scripts/emit-schema.mjs' prints it for anyone who wants to apply it by hand.
-- Nothing here touches an existing film's rows.
-- =============================================================================================

-- ---------------------------------------------------------------------------------------------
-- Jobs: which pipeline a job runs, and the lease that keeps two invocations off one job
-- ---------------------------------------------------------------------------------------------

-- 'pipeline' is decided at admission from ADD_PIPELINE and never changes for a job: 'live' is the
-- one-invocation pipeline in pipeline/run.js, 'jevfirst' the checkpointed one in pipeline-jevfirst/.
--
-- A Jev-first run takes longer than one 300 s function, so it runs as a chain of invocations, each
-- of which holds the job's LEASE while it works: 'lease_owner' is a random id per invocation and
-- 'lease_until' is that invocation's start plus a little more than the platform's 300 s limit, so a
-- lease can never be taken from a live invocation and always expires on its own after a crash.
-- The lease is taken by one conditional UPDATE (lib/jevfirst.js acquireLease), so two invocations can
-- never both hold it. A clean hand-off sets 'lease_owner' back to null; a takeover of an expired lease
-- that was never released is a crash and counts in 'crash_count' (the job fails after three).
alter table jobs add column if not exists pipeline text not null default 'live';
alter table jobs add column if not exists lease_owner text;
alter table jobs add column if not exists lease_until timestamptz;
alter table jobs add column if not exists invocations integer not null default 0;
alter table jobs add column if not exists crash_count integer not null default 0;
alter table jobs add column if not exists reserve_usd numeric(10, 6);
-- progress_at: the last time an invocation of this job was demonstrably alive (took the lease, beat
-- its heartbeat, finished a stage). kicked_at: the last time a poll asked for a continuation. Kept
-- apart so that polls asking again and again cannot make a dead job look alive to the stale rule.
alter table jobs add column if not exists progress_at timestamptz;
alter table jobs add column if not exists kicked_at timestamptz;
do $$
begin
  alter table jobs add constraint jobs_pipeline_check check (pipeline in ('live', 'jevfirst'));
exception
  when duplicate_table or duplicate_object then null;
end $$;

-- One row per (job, internal stage): the stage's checkpointed OUTPUT once it is done, and its money.
-- A later invocation reads the outputs of the stages before it from here, so a job resumes where it
-- stopped and never re-runs a finished stage.
--
-- Money per wallet (a stage can have two: fill has a Sonnet and a Jev cap), all in USD:
--   spent   what this attempt has been billed, banked as each response lands
--   mark    this attempt's high-water mark: persisted BEFORE a call is dispatched whenever spent +
--           in-flight reservations would pass the last mark, so it is always >= what the attempt
--           can owe, even if the function dies with calls in flight
--   carried what earlier attempts that crashed committed (their max(mark, spent)); a re-run's cap is
--           the stage cap minus this, so a per-stage cap holds across crashes
-- 'output' holds no subtitle text beyond the policy exceptions at the top of this file: segment
-- outputs are stored with the 8-word quotation rule already applied. Never served by an endpoint.
create table if not exists job_stages (
  job_id      text not null references jobs (id) on delete cascade,
  stage       text not null,
  status      text not null check (status in ('running', 'done', 'skipped')),
  attempt     integer not null default 1,
  output      jsonb,
  spent       jsonb not null default '{}'::jsonb,
  mark        jsonb not null default '{}'::jsonb,
  carried     jsonb not null default '{}'::jsonb,
  detail      text,
  started_at  timestamptz not null default now(),
  ended_at    timestamptz,
  updated_at  timestamptz not null default now(),
  primary key (job_id, stage)
);

-- ---------------------------------------------------------------------------------------------
-- Subtitle tracks: kept, one per film
-- ---------------------------------------------------------------------------------------------

-- A whole subtitle file per IMDb id. THIS IS THE FIFTH NAMED EXCEPTION to the rule at the top of this
-- file, carried over from the owner's earlier decision (the uncommitted build that introduced
-- subtitle_tracks): a Jev-first run reads its film's lines in every stage across several invocations,
-- and the public demo re-runs Jev on a stored film's lines, so the track has to outlive one job.
-- Never served by any endpoint, never logged; only pipeline-jevfirst/ and the seed script read it.
create table if not exists subtitle_tracks (
  imdb_id           text primary key,         -- 'tt0266543', lower case
  srt               text not null,
  cue_count         integer not null,
  release           text,
  hearing_impaired  boolean not null default false,
  source            text not null default 'opensubtitles',
  file_id           bigint,
  sha256            text not null,
  fetched_at        timestamptz not null default now()
);

-- ---------------------------------------------------------------------------------------------
-- Per-film Jev-first artifacts
-- ---------------------------------------------------------------------------------------------

-- One row per film analysed by the Jev-first pipeline: a new film added by a jevfirst job, or a film
-- the seed script loaded from the experiment's outputs. Keyed by its own slug, NOT a foreign key to
-- 'films': a seeded film may not be in the library, and a library film seeded here keeps its live
-- guide rows untouched ('in_library' is computed, never assumed). The counts are what
-- GET /api/demo/films lists, stored so the list does not open every document.
create table if not exists jevfirst_films (
  slug             text primary key,
  imdb_id          text not null,
  title            text not null,
  year             integer,
  poster_url       text,
  origin           text not null,             -- 'seed' | 'add' | 'rebuild' (constraint below)
  pipeline_version text not null,
  scene_count      integer not null,
  cut_count        integer not null,           -- scene boundaries Jev checks: scenes - 1
  sentence_count   integer not null,           -- Sonnet's cited scene sentences Jev checks
  flagged_count    integer,
  demo_reserve_usd numeric(10, 6),             -- the worst case one demo run of this film reserves
  job_id           text,                       -- the add job that made it, for origin 'add'
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

-- The documents, one per (film, kind), in the experiment's own file shapes:
--   sources            TMDB cast + the verified Wikipedia plot sentences (W1..Wn), with provenance
--   segments_raw       Sonnet's accepted segmentation (quotation rule applied) + every attempt's gate
--   segments_precheck  the built scenes, cast and dangers, with Sonnet's cited sentences, before Jev
--   segments           after Jev: claim checks, fill sentences, the acceptance rule, summaries
--   claims             every claim Jev checked and its answer
--   fill               the wordless-scene fill: Sonnet's output and Jev's checks
--   jev                classify: Jev's raw answer per question per scene
--   sonnetq            Sonnet's answers to its ten concepts
--   childcry           Jev's "is the one who cries a child?"
--   moments            the moment spans per flagged scene
--   describe           Sonnet's titles and cited sentences per flagged scene
--   why                Jev's checks of those texts and the parent text built from what passed
--   tags               the final selection (flags, reasons, severities, skip spans)
-- Never served whole by any endpoint; the demo reads them server-side.
create table if not exists jevfirst_artifacts (
  slug        text not null references jevfirst_films (slug) on delete cascade,
  kind        text not null,
  doc         jsonb not null,
  version     text,
  created_at  timestamptz not null default now(),
  primary key (slug, kind)
);

-- What producing a film's artifacts cost, one row per stage and model. Seeded rows carry the
-- experiment's own ledger (origin 'seed'); an add job writes its stages' real spend at ingest.
create table if not exists jevfirst_ledger (
  id       bigserial primary key,
  slug     text not null references jevfirst_films (slug) on delete cascade,
  job_id   text,
  stage    text not null,
  model    text not null check (model in ('sonnet', 'jev')),
  usd      numeric(12, 8) not null,
  note     text,
  at       timestamptz not null default now()
);

-- ---------------------------------------------------------------------------------------------
-- Demo runs: Jev's stages, live, on a stored film. Sonnet is never called by one.
-- ---------------------------------------------------------------------------------------------

-- 'cost_usd' starts at the run's reservation (the worst case of the requests it may send) and is
-- replaced by the real total exactly once, at done or failed -- the same rule as jobs.cost_usd, for
-- the same reason: a run that dies must not read as free to the daily cap. The daily cap is
-- DEMO_DAILY_CAP_USD, separate from the add cap. 'slot' (1..DEMO_CONCURRENCY while live, null after)
-- carries a partial unique index, so the concurrency limit is the INSERT, not a count read first.
-- 'progress' is the live state the page polls (counters, per-scene states, the feed), written as
-- requests complete; 'result' is set at done. No subtitle text in either: the feed quotes Sonnet's
-- cited sentences and plain labels, never a line.
create table if not exists demo_runs (
  id           text primary key,              -- 22 chars, base64url of 16 random bytes
  slug         text not null,
  status       text not null check (status in ('queued', 'running', 'done', 'failed')),
  slot         smallint,
  client_key   text,                          -- sha256 of the caller identity; never the address itself
  reserve_usd  numeric(10, 6) not null,
  cost_usd     numeric(10, 6) not null,
  progress     jsonb not null default '{}'::jsonb,
  result       jsonb,
  error_code   text,
  error        text,
  created_at   timestamptz not null default now(),
  started_at   timestamptz,
  updated_at   timestamptz not null default now(),
  ended_at     timestamptz
);

create index if not exists job_stages_job_idx         on job_stages (job_id);
create index if not exists jevfirst_ledger_slug_idx   on jevfirst_ledger (slug);
create index if not exists demo_runs_created_idx      on demo_runs (created_at);
create index if not exists demo_runs_live_idx         on demo_runs (status, updated_at);
create unique index if not exists demo_runs_one_per_slot on demo_runs (slot) where status in ('queued', 'running');

-- origin: 'rebuild' was added with v10.4 (a library film re-run by POST /api/admin/rebuild). Dropped
-- and re-added by name so a database made by an earlier version of this file is brought up to date.
alter table jevfirst_films drop constraint if exists jevfirst_films_origin_check;
alter table jevfirst_films add constraint jevfirst_films_origin_check check (origin in ('seed', 'add', 'rebuild'));

-- ---------------------------------------------------------------------------------------------
-- Rebuilds: a library film re-run by the Jev-first pipeline, its old guide kept
-- ---------------------------------------------------------------------------------------------

-- A job is an 'add' (a new film) or a 'rebuild' (an existing film's guide replaced by a new run of the
-- pipeline, film.rebuild_of = films.id). Both share the one-live-job lock and the daily cap.
alter table jobs add column if not exists kind text not null default 'add';
do $$
begin
  alter table jobs add constraint jobs_kind_check check (kind in ('add', 'rebuild'));
exception
  when duplicate_table or duplicate_object then null;
end $$;

-- Every guide a rebuild (or a restore) replaced, whole: the film row and its tracks, anchors, time
-- mappings, analysis runs, scenes and labels, as they were, in one document. POST /api/admin/restore
-- puts one back (after backing up what it replaces). No subtitle text beyond what those tables already
-- hold (anchors.quote, the first named exception at the top of schema.sql).
create table if not exists guide_backups (
  id               bigserial primary key,
  film_id          text not null,               -- not a foreign key: a backup outlives a deleted film
  slug             text not null,
  reason           text not null,               -- 'rebuild' | 'before_restore_of_<id>' | 'manual'
  job_id           text,
  pipeline_version text,                        -- the pipeline that wrote the guide that REPLACED this one
  scene_count      integer not null,
  doc              jsonb not null,
  taken_at         timestamptz not null default now(),
  restored_at      timestamptz
);
create index if not exists guide_backups_film_idx on guide_backups (film_id, id);

-- ---------------------------------------------------------------------------------------------
-- Why a scene is on the list (v10.4)
-- ---------------------------------------------------------------------------------------------

-- A Jev-first guide's flagged scene carries its flag reasons as plain tags, in the pipeline's order:
-- { line: 'Creature attacks · Child in danger', tags: [{ label, by: ['jev'|'sonnet'], p }] }. The film
-- page reads it (web/lib/queries.ts, through to_jsonb so an older database answers null). The same
-- reasons are also asserted 'event' labels (vocabulary 'reason:*'), which is what the API's filters match.
-- Null on a guide built before v10.4.
alter table scenes add column if not exists why_tags jsonb;

-- ---------------------------------------------------------------------------------------------
-- Demo runs resume like add jobs (v10.4.3): a lease, checkpoints, and money that survives a crash
-- ---------------------------------------------------------------------------------------------

-- A demo run runs as one or more invocations (pipeline-jevfirst/demo.js). The one working on it holds
-- the LEASE (lease_owner, lease_until: short, renewed by a heartbeat); a takeover of a lease that was
-- never released is a crash (crash_count; the run fails after three). 'checkpoint' is
-- { done: [stage ids], progress: <the progress document as of the last finished stage> }; the finished
-- stages' outputs are in demo_run_stages (deleted when the run ends).
--
-- Money, in USD:
--   cost_usd       what the DAILY CAP counts: the reservation while the run is live, its final figure after
--   spent_usd      what the run has been billed (measured), crashed attempts carried at their marks
--   mark_usd       the durable high-water mark: persisted BEFORE a request goes out whenever spent plus
--                  in-flight reservations would pass it, so it always covers what the run can owe
--   uncertain_usd  the part of spent_usd that is a crashed attempt's mark, not a measured bill
-- progress_at: the last time an invocation was alive; kicked_at: the last time a poll asked for one.
alter table demo_runs add column if not exists lease_owner text;
alter table demo_runs add column if not exists lease_until timestamptz;
alter table demo_runs add column if not exists invocations integer not null default 0;
alter table demo_runs add column if not exists crash_count integer not null default 0;
alter table demo_runs add column if not exists spent_usd numeric(10, 6) not null default 0;
alter table demo_runs add column if not exists mark_usd numeric(10, 6) not null default 0;
alter table demo_runs add column if not exists uncertain_usd numeric(10, 6) not null default 0;
alter table demo_runs add column if not exists checkpoint jsonb;
alter table demo_runs add column if not exists progress_at timestamptz;
alter table demo_runs add column if not exists kicked_at timestamptz;
create index if not exists demo_runs_ended_idx on demo_runs (ended_at);

create table if not exists demo_run_stages (
  run_id  text not null references demo_runs (id) on delete cascade,
  stage   text not null,
  output  jsonb,
  at      timestamptz not null default now(),
  primary key (run_id, stage)
);

-- A restore takes the one-live-job lock too (kind 'restore': a jobs row that lives only inside the
-- restore's transaction), so a rebuild and a restore of the same library can never interleave.
alter table jobs drop constraint if exists jobs_kind_check;
alter table jobs add constraint jobs_kind_check check (kind in ('add', 'rebuild', 'restore'));

-- Wrong passcodes, counted in the database so every function instance shares one count, for every
-- route that takes the passcode: /api/add/* and /api/admin/* alike, however they are reached. One row
-- per key and ten-minute window (lib/jobs.js requirePasscodeShared). A caller's row ('client:...') is
-- its LIMIT: an attempt is counted before its passcode is compared (so concurrent guesses cannot
-- overshoot) and given back when the passcode was right. The row across all callers ('all') only
-- raises an alert; it never refuses anyone. Rows whose window has passed are deleted as they are seen.
create table if not exists passcode_failures (
  key           text primary key,             -- 'client:<sha256 of the caller identity>' or 'all'
  failures      integer not null default 0,
  window_start  timestamptz not null default now()
);

-- ---------------------------------------------------------------------------------------------
-- v10.4.4: demo runs written before v10.4.3 keep their spending
-- ---------------------------------------------------------------------------------------------

-- A demo_runs row written by the v10.4.2 code got the v10.4.3 money columns above with their defaults
-- (zero). Its money was cost_usd (the reservation while live, the final figure after) and
-- progress.spent_usd (what it had measured). Left at zero, the sweep would charge a live one
-- greatest(mark_usd, spent_usd) = 0 and release its whole reservation, and a finished one would show a
-- cost of zero. This fills them in from the old accounting:
--   finished   spent = mark = cost_usd. A run the old sweep ended ('timed_out') was left at its
--              reservation: the part of it the run never measured is uncertain_usd, not a bill.
--   live       mark = cost_usd (its reservation, the only upper bound the old code kept) and spent =
--              what it had measured. The v10.4.2 code never set 'invocations', so a 'running' row with
--              invocations = 0 is never leased by the new code (pipeline-jevfirst/demo.js
--              acquireDemoLease): its old invocation may still be alive and there is no checkpoint to
--              resume from. The sweep ends it at that mark.
-- Only rows still exactly as the column defaults left them are touched, so applying this again changes
-- nothing. (A queued row the new code admitted but has not started yet also matches; it gets its
-- reservation as its mark, which is an upper bound too.)
update demo_runs set
    spent_usd = case when status in ('done', 'failed') then cost_usd
                     else least(cost_usd, coalesce(case when jsonb_typeof(progress -> 'spent_usd') = 'number' then (progress ->> 'spent_usd')::numeric end, 0)) end,
    mark_usd = cost_usd,
    uncertain_usd = case when status = 'failed' and error_code = 'timed_out'
                         then greatest(cost_usd - coalesce(case when jsonb_typeof(progress -> 'spent_usd') = 'number' then (progress ->> 'spent_usd')::numeric end, 0), 0)
                         else 0 end
  where invocations = 0 and lease_owner is null and checkpoint is null and progress_at is null
    and spent_usd = 0 and mark_usd = 0 and uncertain_usd = 0;

-- ---------------------------------------------------------------------------------------------
-- Which version of this file a database has had applied (lib/ensure-schema.js reads it)
-- ---------------------------------------------------------------------------------------------
create table if not exists schema_marks (
  id          text primary key,
  applied_at  timestamptz not null default now()
);
