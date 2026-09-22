-- scene-api schema. Plain Postgres, idempotent: safe to apply any number of times.
-- Target: Neon (also runs on plain Postgres 14+ and on @electric-sql/pglite for the tests).
--
-- NO SUBTITLE TEXT IS STORED ANYWHERE in here, with four named exceptions, and nothing else may be
-- added to that list without the owner saying so:
--
--   1. anchors.quote — three lines per track, capped at 12 words, so a parent can find the same line
--      on their own player and tell us where it lands on their clock.
--   2. recordings.excerpts — the owner-approved beat excerpts: at most two lines of at most 12 words
--      each, for FLAGGED beats only, 12-20% of a film's subtitle words. The policy is stated in
--      experiments/trigger-scan/RECORDINGS.md, enforced by verify-excerpts.js, and enforced again on
--      every live run by verifyExcerpts() in pipeline/excerpts.js.
--      recordings.recording itself contains no text at all: ids, offsets and numbers only.
--   3. jobs.excerpts — the SAME excerpts, on the job row, for the minutes one live analysis is
--      running. The replay page shows the evidence lines while the run is still going, before there
--      is a film to hang them off. Nulled out the moment the job reaches done or failed: by the
--      run itself, by the stale sweep in lib/jobs.js when a run died without getting that far, and
--      by the migration below on an older database. The recording endpoint refuses to serve them
--      for a job that is not live regardless, so the column going stale cannot become an answer.
--   4. job_blobs.srt — a whole subtitle file, for the minutes one live analysis is running, and
--      deleted the moment the job ends. See the comment on that table; it is the only place a whole
--      track ever sits, and it is never served by any endpoint.

-- ---------------------------------------------------------------------------------------------
-- Films and tracks
-- ---------------------------------------------------------------------------------------------

create table if not exists films (
  id          text primary key,              -- the slug, e.g. 'nemo'
  slug        text not null unique,
  title       text not null,
  year        integer,
  imdb_id     text,
  poster_url  text,                          -- TMDB image URL, or null: the UI draws a placeholder
  overview    text,                          -- TMDB synopsis, or null: the UI shows nothing
  created_at  timestamptz not null default now()
);

-- Added after the first version of this file; both are no-ops on a fresh database.
alter table films add column if not exists poster_url text;
alter table films add column if not exists overview text;

-- One row per subtitle file we analysed. Timestamps in `scenes` belong to exactly one track.
create table if not exists tracks (
  id                  text primary key,      -- e.g. 'nemo:opensubtitles:sdh'
  film_id             text not null references films (id) on delete cascade,
  source              text not null,         -- 'opensubtitles', 'app-database', ...
  release_label       text,                  -- e.g. 'Finding.Nemo.2003.Bluray.Original.SDH'
  language            text not null default 'en',
  has_sound_captions  boolean not null default false,
  cue_count           integer not null,
  duration_ms         bigint not null,       -- end of the last cue, not the true runtime
  sha256              text not null,         -- of the subtitle file, so a re-parse can be checked
  created_at          timestamptz not null default now()
);

-- Three short lines per track that a parent can hear on their own copy. Used to calibrate.
create table if not exists anchors (
  id          text primary key,              -- e.g. 'nemo:opensubtitles:sdh:early'
  track_id    text not null references tracks (id) on delete cascade,
  position    text not null check (position in ('early', 'middle', 'late')),
  cue_id      text not null,                 -- 'C0042', the id used by anchor_cue in the API
  cue_index   integer not null,              -- 1-based cue number in the track
  start_ms    bigint not null,
  quote       text not null,                 -- at most 12 words
  created_at  timestamptz not null default now()
);

-- A measured relationship between a track's clock and one streaming release's clock:
--   player_ms = track_ms * scale + offset_ms
-- Empty on purpose for now; nothing here has been measured yet.
create table if not exists time_mappings (
  id           text primary key,
  track_id     text not null references tracks (id) on delete cascade,
  platform     text not null,                -- 'Disney+', 'Netflix', 'US Blu-ray', ...
  offset_ms    bigint not null default 0,
  scale        double precision not null default 1.0,
  measured_how text,                         -- free text: how the numbers were obtained
  confidence   text check (confidence in ('high', 'medium', 'low')),
  created_at   timestamptz not null default now(),
  unique (track_id, platform)
);

-- ---------------------------------------------------------------------------------------------
-- Vocabulary (taxonomy v3)
-- ---------------------------------------------------------------------------------------------

create table if not exists groups (
  id          text primary key,
  label       text not null,
  layer       text,                          -- 'presence' | 'event' | 'other'
  created_at  timestamptz not null default now()
);

create table if not exists vocabulary (
  id               text primary key,
  layer            text not null check (layer in ('presence', 'event', 'modifier')),
  group_id         text references groups (id) on delete set null,
  label            text not null,            -- parent-facing, a whole phrase
  short_label      text,                     -- 1-3 plain words for a scene row's tag list
  text_blind       boolean not null default false,
  taxonomy_version text not null,
  aliases          text[] not null default '{}',  -- extra words a parent might use
  created_at       timestamptz not null default now()
);

-- Added after the first version of this file; a no-op on a fresh database.
alter table vocabulary add column if not exists short_label text;

-- ---------------------------------------------------------------------------------------------
-- Provenance
-- ---------------------------------------------------------------------------------------------

create table if not exists analysis_runs (
  id               text primary key,
  film_id          text not null references films (id) on delete cascade,
  track_id         text references tracks (id) on delete cascade,
  role             text not null check (role in ('finder', 'labeller', 'presence')),
  model            text not null,
  taxonomy_version text,
  script           text,                     -- prompt / script name that produced the file
  started_at       timestamptz,
  cost_usd         numeric(10, 6),
  source_file      text,                     -- path inside experiments/trigger-scan/
  created_at       timestamptz not null default now()
);

-- ---------------------------------------------------------------------------------------------
-- Scenes and labels
-- ---------------------------------------------------------------------------------------------

create table if not exists scenes (
  id                       text primary key,   -- '<slug>:S01'
  film_id                  text not null references films (id) on delete cascade,
  track_id                 text not null references tracks (id) on delete cascade,
  run_id                   text references analysis_runs (id) on delete set null,
  start_ms                 bigint not null,
  end_ms                   bigint not null,
  start_cue                text,
  end_cue                  text,
  title                    text not null,
  severity_5_7             smallint,
  severity_8_10            smallint,
  confirmed_by_second_run  boolean,            -- null = no second run exists for this film
  text_visibility          text,               -- how much of the scene the subtitles can see
  review_status            text not null default 'unreviewed',
  description              text,
  created_at               timestamptz not null default now(),
  check (end_ms >= start_ms)
);

-- One row per (scene, item, channel, SOURCE). Two sources may say the same thing about the same
-- item; both rows are kept so the API can report that they agree.
--
-- `asserted` is the difference between "we say this is in the scene" and "one detector leaned that
-- way". Only a per-scene judgement asserts. A per-beat probability, however high, does not: rolled
-- up to a scene it accumulates false positives, so it is served as "possibly present" instead.
create table if not exists scene_labels (
  id               text primary key,
  scene_id         text not null references scenes (id) on delete cascade,
  vocabulary_id    text not null references vocabulary (id) on delete cascade,
  channel          text not null check (channel in ('presence', 'mention', 'event')),
  source           text not null,             -- the model that produced it
  probability      double precision,          -- null when the source does not give one
  asserted         boolean not null,
  confidence_kind  text check (confidence_kind in ('stated_in_lines', 'known_from_film')),
  detail           text,                      -- free text the vocabulary has no id for yet
  review_status    text not null default 'unreviewed',
  created_at       timestamptz not null default now(),
  unique (scene_id, vocabulary_id, channel, source)
);

-- Columns and constraints added after the first version of this file; both are no-ops on a fresh
-- database and bring an older one forward.
alter table scene_labels add column if not exists confidence_kind text;
alter table scene_labels add column if not exists detail text;
-- The 3-column key is superseded by the 4-column one (two sources may label the same item).
alter table scene_labels drop constraint if exists scene_labels_scene_id_vocabulary_id_channel_key;
-- `create table if not exists` above is skipped entirely on an existing database, so the 4-column
-- key inside it is never created there. Add it explicitly. Postgres has no
-- `add constraint if not exists`, hence the exception block; it is a no-op on a fresh database
-- where the create table already made it.
do $$
begin
  alter table scene_labels
    add constraint scene_labels_scene_id_vocabulary_id_channel_source_key
    unique (scene_id, vocabulary_id, channel, source);
exception
  when duplicate_table or duplicate_object then null;
end $$;

-- ---------------------------------------------------------------------------------------------
-- Recordings: one real Jev run per film, replayable at the speed it happened
-- ---------------------------------------------------------------------------------------------

-- `recording` is the exact content of experiments/trigger-scan/recordings/<slug>.jev.json: every
-- request that went out, when it went out, when it came back, and the 103 probabilities per beat.
-- It is served whole so a "Watch it work" page can iterate its `timeline[]` against a real clock.
-- It contains NO subtitle text; verify-recording.js asserts that every string in it matches
-- ^[\w.:+-]+$ (ids, model names, ISO dates — dialogue has spaces).
--
-- `excerpts` is the optional file beside it: two lines of at most 12 words for flagged beats only.
-- This one DOES hold subtitle text, deliberately and within the policy in RECORDINGS.md, so a beat
-- can show the evidence behind its flag. Null is a normal value; the page must work without it.
--
-- `recorded_at` is the run's own meta.started_at, not when the row was written, so re-loading the
-- same file does not move the date.
create table if not exists recordings (
  film_id     text primary key references films (id) on delete cascade,
  recording   jsonb not null,
  excerpts    jsonb,
  recorded_at timestamptz,
  created_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------------------------------
-- Jobs: one live run of the analysis pipeline for a film nobody has analysed yet
-- ---------------------------------------------------------------------------------------------

-- A job is the whole state of one "Add a movie" run, and it is polled by id over a public endpoint:
-- the 22-character id IS the secret, so nothing sensitive may ever be put in a column here.
--
-- `steps` is the array the progress UI renders, one entry per stage:
--   { id, label, status: 'pending'|'running'|'done'|'failed', started_ms, ended_ms, detail }
-- The two times are OFFSETS IN MILLISECONDS from the job's own start, not wall-clock timestamps, so
-- the browser can show elapsed time without knowing anything about the server's clock or timezone.
--
-- `recording` is written the moment the jev stage ends, before Sonnet has started, because the
-- replay is the most interesting thing on the page and there is no reason to make anyone wait two
-- more minutes for it. It is served by GET /api/add/jobs/{id}/recording, not by the polling
-- endpoint: a recording is about a megabyte and the page polls every 1.5 s.
--
-- `excerpts` is the fourth exception in the header of this file, and the only one with a retention
-- rule: it is nulled out when the job reaches done or failed.
create table if not exists jobs (
  id          text primary key,             -- 22 chars, base64url of 16 random bytes
  status      text not null check (status in ('queued', 'running', 'done', 'failed')),
  step        text,                         -- the stage id currently running, or the one that failed
  film        jsonb not null,               -- { tmdb_id, imdb_id, title, year, poster_url, overview, slug }
  steps       jsonb not null default '[]'::jsonb,
  cost_usd    numeric(10, 6) not null default 0,
  error_code  text,                         -- machine-readable: the web branches on this
  error       text,                         -- one sentence, safe to show a person
  recording   jsonb,
  excerpts    jsonb,
  scene_count integer,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- THE ONLY PLACE A WHOLE SUBTITLE TRACK EVER SITS. A stage hands the text to the next stage through
-- this table rather than through memory, because the pipeline has to survive being resumed and
-- because holding a megabyte of dialogue in a function's heap for five minutes is worse, not better.
--
-- It is deleted the moment its job reaches done or failed. A function that is killed between two
-- stages reaches neither, and its blob is then swept by whichever comes first: the next call to any
-- /api/add route or any /api/films route (once per instance per ten minutes, see maybeSweepBlobs),
-- or the daily cron on /api/add/status. So: minutes on a deployment anybody is using, and within a
-- day on one nobody is. Thirty minutes is the age at which a blob becomes eligible to be swept, not
-- a promise about when it will be. Vercel's Hobby plan refuses any cron more frequent than daily.
-- No endpoint returns this column.
create table if not exists job_blobs (
  job_id     text primary key references jobs (id) on delete cascade,
  srt        text not null,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------------------------------

create index if not exists films_title_lower_idx      on films (lower(title));
create index if not exists tracks_film_idx            on tracks (film_id);
create index if not exists anchors_track_idx          on anchors (track_id);
create index if not exists anchors_track_cue_idx      on anchors (track_id, cue_id);
create index if not exists time_mappings_track_idx    on time_mappings (track_id, lower(platform));
create index if not exists vocabulary_group_idx       on vocabulary (group_id);
create index if not exists vocabulary_layer_idx       on vocabulary (layer);
create index if not exists analysis_runs_film_idx     on analysis_runs (film_id, role);
create index if not exists scenes_film_start_idx      on scenes (film_id, start_ms);
create index if not exists scenes_track_idx           on scenes (track_id);
create index if not exists scene_labels_scene_idx     on scene_labels (scene_id);
create index if not exists scene_labels_vocab_idx     on scene_labels (vocabulary_id, channel, asserted);
create index if not exists scene_labels_possible_idx  on scene_labels (vocabulary_id, channel, probability);
-- "is another run already going?" and "what has today cost?" are the two questions the add
-- endpoints ask on every request, so both have an index.
create index if not exists jobs_live_idx              on jobs (status, updated_at);
create index if not exists jobs_created_idx           on jobs (created_at);
create index if not exists job_blobs_created_idx      on job_blobs (created_at);

-- ---------------------------------------------------------------------------------------------
-- One live run at a time, enforced by the database rather than by a read-then-write
-- ---------------------------------------------------------------------------------------------

-- "Is another run going?" used to be a SELECT followed by an INSERT, which is not a lock: two
-- requests a millisecond apart both saw no live job, both were admitted, both spent money, and the
-- second one's `writeFilm` deleted the first one's film. The INSERT is the gate now — the index
-- below makes a second live row impossible, and lib/add.js turns the resulting 23505 into the same
-- 409 `busy` the SELECT used to produce.
--
-- `((true))` is the whole trick: every live row indexes the same key, so at most one may exist.

-- An older database may already hold more than one live row, in which case the index cannot be
-- created. Those rows are stale by definition (nothing has been writing to them), so fail all but
-- the newest first. A no-op on a fresh database and on a healthy one.
-- `excerpts` goes with them, for the same reason lib/jobs.js nulls it when it fails a stale run:
-- it is subtitle text kept only for the minutes a run is live, and these runs are not live.
update jobs set status = 'failed', error_code = coalesce(error_code, 'timed_out'),
       error = coalesce(error, 'This run stopped part-way through and did not finish.'),
       excerpts = null, updated_at = now()
 where status in ('queued', 'running')
   and id <> (select id from jobs where status in ('queued', 'running') order by created_at desc limit 1);

create unique index if not exists jobs_one_live on jobs ((true)) where status in ('queued', 'running');
