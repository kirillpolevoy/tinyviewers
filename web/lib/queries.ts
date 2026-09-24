// Every SQL statement the site runs, and the only place database shapes become page shapes.
//
// What a parent page is allowed to see: a film, its scenes in time order, each scene's asserted
// labels as plain short words, and the two severities. What never leaves this file: engine and model
// names, probabilities, `possibly_present`, confidence kinds and review status. The queries below
// ask for `asserted` labels only, so an unasserted row cannot reach a page even by accident.
//
// Every reader is wrapped in React's `cache()`, so two components (or a page and its
// generateMetadata) asking the same question in one request share one round trip. Each page has a
// budget: Home issues 4 statements, a film page 3. Anything that would need a fifth belongs in an
// aggregate, not in another call — hence the json_agg in listFilms and getFilmScenes.

import 'server-only';
import { cache } from 'react';
import { getDb } from './db';
import { buildReplayPayload } from './replay';
import type { RawExcerpts, RawRecording, ReplayPayload } from './replay';
import type { Scene, SceneTag } from './scenes';

export type FilmSummary = {
  slug: string;
  title: string;
  year: number | null;
  imdbId: string | null;
  posterUrl: string | null;
  /** The film's synopsis, as TMDB writes it, or null. Nothing here describes our scenes. */
  overview: string | null;
  sceneCount: number;
  durationMs: number;
  /** Start time and both severities of every scene, for the library card's strip. */
  markers: { startMs: number; severity57: number | null; severity810: number | null }[];
};

export type Film = {
  slug: string;
  title: string;
  year: number | null;
  /** The IMDb id the film was matched on, when the loader recorded one. The rail links to it. */
  imdbId: string | null;
  posterUrl: string | null;
  /** The film's synopsis, as TMDB writes it, or null. Nothing here describes our scenes. */
  overview: string | null;
  /** Where the subtitles end — the end of the last cue, NOT the film's runtime. Scales the timeline. */
  durationMs: number;
};

/** The film page's extra facts about the subtitles its times come from. */
export type FilmDetail = Film & {
  /** The subtitle release the times follow, e.g. 'Finding.Nemo.2003.Bluray.Original.SDH', or null. */
  releaseLabel: string | null;
  /** Whether that track captions sounds as well as speech (an SDH / hearing-impaired track). */
  hasSoundCaptions: boolean;
};

type MarkerRow = { start_ms: string | number; severity_5_7: number | null; severity_8_10: number | null };

type FilmRow = {
  slug: string;
  title: string;
  year: number | null;
  imdb_id?: string | null;
  poster_url: string | null;
  overview: string | null;
  duration_ms: string | number | null;
  scene_count: number;
  markers?: MarkerRow[] | string | null;
  release_label?: string | null;
  has_sound_captions?: boolean | null;
};

// json_agg comes back parsed by `pg` and by PGlite; a string would mean a driver that does not, and
// is handled rather than trusted.
const asRows = (value: MarkerRow[] | string | null | undefined): MarkerRow[] => {
  if (!value) return [];
  const rows = typeof value === 'string' ? (JSON.parse(value) as MarkerRow[]) : value;
  return Array.isArray(rows) ? rows : [];
};

const toFilm = (row: FilmRow): Film => ({
  slug: row.slug,
  title: row.title,
  year: row.year,
  imdbId: row.imdb_id ?? null,
  posterUrl: row.poster_url,
  overview: row.overview,
  durationMs: Number(row.duration_ms ?? 0),
});

const toSummary = (row: FilmRow): FilmSummary => ({
  ...toFilm(row),
  sceneCount: row.scene_count,
  markers: asRows(row.markers).map((m) => ({
    startMs: Number(m.start_ms),
    severity57: m.severity_5_7,
    severity810: m.severity_8_10,
  })),
});

// A film has one analysed track today; the schema allows more, so take the first deterministically.
// The track's release and whether it captions sounds come along in the same statement: the film page
// says which subtitles its times follow and what they cannot hear, and its budget is three queries.
const FILM_SELECT = `
  select f.slug, f.title, f.year, f.imdb_id, f.poster_url, f.overview,
         t.duration_ms, t.release_label, t.has_sound_captions,
         (select count(*)::int from scenes s where s.film_id = f.id) as scene_count
    from films f
    left join lateral (
      select tr.duration_ms, tr.release_label, tr.has_sound_captions
        from tracks tr where tr.film_id = f.id order by tr.created_at, tr.id limit 1
    ) t on true`;

/** Every film, with the markers its library-card strip draws, in one statement. */
export const listFilms = cache(async (): Promise<FilmSummary[]> => {
  const db = await getDb();
  const { rows } = await db.query<FilmRow>(
    `select f.slug, f.title, f.year, f.imdb_id, f.poster_url, f.overview,
            (select t.duration_ms from tracks t where t.film_id = f.id order by t.created_at, t.id limit 1) as duration_ms,
            (select count(*)::int from scenes s where s.film_id = f.id) as scene_count,
            (select coalesce(json_agg(json_build_object(
                      'start_ms', s.start_ms,
                      'severity_5_7', s.severity_5_7,
                      'severity_8_10', s.severity_8_10) order by s.start_ms), '[]'::json)
               from scenes s where s.film_id = f.id) as markers
       from films f
      order by f.title`,
  );
  return rows.map(toSummary);
});

export const getFilm = cache(async (slug: string): Promise<FilmDetail | null> => {
  const db = await getDb();
  const { rows } = await db.query<FilmRow>(`${FILM_SELECT} where lower(f.slug) = lower($1)`, [slug]);
  const row = rows[0];
  if (!row) return null;
  return {
    ...toFilm(row),
    releaseLabel: row.release_label?.trim() || null,
    hasSoundCaptions: row.has_sound_captions === true,
  };
});

type SceneRow = {
  id: string;
  start_ms: string | number;
  end_ms: string | number;
  title: string;
  description: string | null;
  severity_5_7: number | null;
  severity_8_10: number | null;
  tags: { id: string; channel: 'presence' | 'event'; label: string }[] | string | null;
};

/**
 * Every scene of one film in time order, each with the plain-word tags a row shows: asserted
 * presence first, then asserted events. `short_label` is what a parent reads; the long sentence
 * label stays in the database. One statement, because the film page's whole budget is three.
 */
export const getFilmScenes = cache(async (slug: string): Promise<Scene[]> => {
  const db = await getDb();
  const { rows } = await db.query<SceneRow>(
    // `asserted` is the whole difference between "this is in the scene" and "a detector leaned that
    // way". Only asserted rows, and only the two channels a parent page shows.
    `select s.id, s.start_ms, s.end_ms, s.title, s.description,
            s.severity_5_7, s.severity_8_10,
            coalesce((
              select json_agg(json_build_object('id', t.vocabulary_id, 'channel', t.channel, 'label', t.label)
                              order by t.channel_rank, t.label)
                from (select distinct l.vocabulary_id, l.channel,
                             coalesce(v.short_label, v.label) as label,
                             case l.channel when 'presence' then 0 else 1 end as channel_rank
                        from scene_labels l
                        join vocabulary v on v.id = l.vocabulary_id
                       where l.scene_id = s.id
                         and l.asserted
                         and l.channel in ('presence', 'event')) t
            ), '[]'::json) as tags
       from scenes s
       join films f on f.id = s.film_id
      where lower(f.slug) = lower($1)
      order by s.start_ms, s.id`,
    [slug],
  );

  return rows.map((row) => {
    const tags = (typeof row.tags === 'string' ? JSON.parse(row.tags) : (row.tags ?? [])) as {
      id: string;
      channel: 'presence' | 'event';
      label: string;
    }[];
    return {
      id: row.id,
      startMs: Number(row.start_ms),
      endMs: Number(row.end_ms),
      title: row.title,
      description: row.description,
      severity57: row.severity_5_7,
      severity810: row.severity_8_10,
      tags: tags as SceneTag[],
    };
  });
});

// Searching by name used to live here, as `searchFilmsByName`. It does not any more: the library
// page fetches the film list it was going to render anyway and matches against it with
// lib/search.ts, which is pure, tested and — unlike this file — safe to run in the browser, so the
// server's redirect and the shelf's own filter cannot drift apart. There is still no SQL for it,
// for the reason there never was: folding accents portably in Postgres needs an extension Neon may
// not have, and the LIKE version matched every film on a query that normalised to nothing.

export type Showcase = Film & {
  sceneCount: number;
  /** Three real rows for Home's peek card. */
  scenes: Scene[];
  markers: FilmSummary['markers'];
  hasShark: boolean;
};

/**
 * The film Home peeks at: the one with a shark in it, because the caption points at the shark row.
 * Everything shown comes from the database, so Home can never promise a scene a film page denies.
 *
 * `films` is the list the caller already has. Passing it in keeps Home inside its query budget;
 * leaving it out falls back to the cached listFilms.
 */
export const getShowcase = cache(async (films?: FilmSummary[]): Promise<Showcase | null> => {
  const db = await getDb();
  const { rows } = await db.query<{ slug: string }>(
    `select f.slug
       from films f
       join scenes s on s.film_id = f.id
       join scene_labels l on l.scene_id = s.id
      where l.vocabulary_id = 'shark' and l.asserted
      group by f.slug
      order by count(*) desc, f.slug
      limit 1`,
  );
  const all = films ?? (await listFilms());
  const chosen = rows[0] ? all.find((f) => f.slug === rows[0].slug) : all[0];
  if (!chosen) return null;

  const scenes = await getFilmScenes(chosen.slug);
  const sharkIndex = scenes.findIndex((s) => s.tags.some((t) => t.id === 'shark'));

  // The three rows: the shark scene, then the strongest others, back in time order.
  const strongest = [...scenes].sort(
    (a, b) => (b.severity57 ?? -1) - (a.severity57 ?? -1) || a.startMs - b.startMs,
  );
  const picked = new Map<string, Scene>();
  if (sharkIndex >= 0) picked.set(scenes[sharkIndex].id, scenes[sharkIndex]);
  for (const scene of strongest) {
    if (picked.size >= 3) break;
    picked.set(scene.id, scene);
  }

  return {
    slug: chosen.slug,
    title: chosen.title,
    year: chosen.year,
    imdbId: chosen.imdbId,
    posterUrl: chosen.posterUrl,
    overview: chosen.overview,
    durationMs: chosen.durationMs,
    sceneCount: chosen.sceneCount,
    markers: chosen.markers,
    hasShark: sharkIndex >= 0,
    scenes: [...picked.values()].sort((a, b) => a.startMs - b.startMs),
  };
});

// ---------------------------------------------------------------------------------------------
// Recordings — the one place machinery is allowed out, and only onto /watch
// ---------------------------------------------------------------------------------------------
//
// Everything above this line is bound by the rule at the top of the file: no engine, no model, no
// probability reaches a page. "Watch it work" is the deliberate exception — it is the page about
// the machinery, it names Jev and Sonnet out loud, and a parent only reaches it by asking to. The
// separation is kept by route rather than by column: these two readers are used by /watch and by
// nothing else, and no query above them touches the `recordings` table.

export type RecordedFilm = {
  slug: string;
  title: string;
  year: number | null;
  posterUrl: string | null;
  sceneCount: number;
  /** Straight out of the recording's own meta: the run's wall clock and what it cost. */
  wallMs: number;
  costUsd: number;
  beats: number;
};

/**
 * The films with a recording to play, for the /watch index.
 *
 * `wall_ms` and `cost_usd` are pulled out of the jsonb in SQL rather than by loading the document:
 * a recording is about a megabyte, and the index shows two numbers from each of six of them. Postgres
 * reads the two fields and sends twenty bytes.
 */
export const listRecordedFilms = cache(async (): Promise<RecordedFilm[]> => {
  const db = await getDb();
  const { rows } = await db.query<{
    slug: string;
    title: string;
    year: number | null;
    poster_url: string | null;
    scene_count: number;
    wall_ms: string | number | null;
    cost_usd: string | number | null;
    beats: string | number | null;
  }>(
    `select f.slug, f.title, f.year, f.poster_url,
            (select count(*)::int from scenes s where s.film_id = f.id) as scene_count,
            (r.recording -> 'meta' ->> 'wall_ms') as wall_ms,
            (r.recording -> 'meta' ->> 'cost_usd') as cost_usd,
            (r.recording -> 'meta' ->> 'beats') as beats
       from recordings r
       join films f on f.id = r.film_id
      order by f.title`,
  );
  return rows.map((row) => ({
    slug: row.slug,
    title: row.title,
    year: row.year,
    posterUrl: row.poster_url,
    sceneCount: row.scene_count,
    wallMs: Number(row.wall_ms ?? 0),
    costUsd: Number(row.cost_usd ?? 0),
    beats: Number(row.beats ?? 0),
  }));
});

/**
 * One film's recorded run, already reduced to what the browser replays.
 *
 * The reduction happens here, on the server, and not in the component: the row is a megabyte of
 * probabilities and the page needs about a seventh of it. `excerpts` is null for a film whose
 * excerpt file was never loaded — the recordings are in git and the excerpt files are not — and the
 * payload is built without lines rather than refused.
 */
export const getReplay = cache(async (slug: string): Promise<ReplayPayload | null> => {
  const db = await getDb();
  const { rows } = await db.query<{ recording: RawRecording | string; excerpts: RawExcerpts | string | null }>(
    `select r.recording, r.excerpts
       from recordings r
       join films f on f.id = r.film_id
      where lower(f.slug) = lower($1)`,
    [slug],
  );
  const row = rows[0];
  if (!row) return null;
  // jsonb comes back parsed by `pg` and by PGlite; a string would mean a driver that does not.
  const recording = (typeof row.recording === 'string' ? JSON.parse(row.recording) : row.recording) as RawRecording;
  const excerpts = (
    typeof row.excerpts === 'string' ? JSON.parse(row.excerpts) : row.excerpts
  ) as RawExcerpts | null;
  return buildReplayPayload(recording, excerpts);
});

/** Real numbers for the Home band. Counts, nothing invented. */
export const getLibraryTotals = cache(
  async (): Promise<{ films: number; scenes: number; strongest: number }> => {
    const db = await getDb();
    const { rows } = await db.query<{ films: number; scenes: number; strongest: number }>(
      `select (select count(*)::int from films) as films,
              (select count(*)::int from scenes) as scenes,
              (select count(*)::int from scenes where severity_5_7 = 3) as strongest`,
    );
    return rows[0];
  },
);
