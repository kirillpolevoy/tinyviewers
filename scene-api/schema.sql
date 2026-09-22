-- scene-api schema. Plain Postgres, idempotent: safe to apply any number of times.
-- Target: Neon (also runs on plain Postgres 14+ and on @electric-sql/pglite for the tests).
--
-- NO SUBTITLE TEXT IS STORED ANYWHERE in here. The only verbatim words from a subtitle track are
-- the anchor quotes (anchors.quote), which are capped at 12 words and exist so a parent can find
-- the same line on their own player and tell us where it lands on their clock.

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
