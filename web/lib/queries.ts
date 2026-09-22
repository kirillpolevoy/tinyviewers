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
import { matchFilms } from './search';
import type { Scene, SceneTag } from './scenes';

export type FilmSummary = {
  slug: string;
  title: string;
  year: number | null;
  posterUrl: string | null;
  sceneCount: number;
  durationMs: number;
  /** Start time and both severities of every scene, for the library card's strip. */
  markers: { startMs: number; severity57: number | null; severity810: number | null }[];
};

export type Film = {
  slug: string;
  title: string;
  year: number | null;
  posterUrl: string | null;
  durationMs: number;
};

type MarkerRow = { start_ms: string | number; severity_5_7: number | null; severity_8_10: number | null };

type FilmRow = {
  slug: string;
  title: string;
  year: number | null;
  poster_url: string | null;
  duration_ms: string | number | null;
  scene_count: number;
  markers?: MarkerRow[] | string | null;
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
  posterUrl: row.poster_url,
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
const FILM_SELECT = `
  select f.slug, f.title, f.year, f.poster_url,
         (select t.duration_ms from tracks t where t.film_id = f.id order by t.created_at, t.id limit 1) as duration_ms,
         (select count(*)::int from scenes s where s.film_id = f.id) as scene_count
    from films f`;

/** Every film, with the markers its library-card strip draws, in one statement. */
export const listFilms = cache(async (): Promise<FilmSummary[]> => {
  const db = await getDb();
  const { rows } = await db.query<FilmRow>(
    `select f.slug, f.title, f.year, f.poster_url,
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

export const getFilm = cache(async (slug: string): Promise<Film | null> => {
  const db = await getDb();
  const { rows } = await db.query<FilmRow>(`${FILM_SELECT} where lower(f.slug) = lower($1)`, [slug]);
  return rows[0] ? toFilm(rows[0]) : null;
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

export type SearchResult = { films: FilmSummary[]; exact: FilmSummary | null };

/**
 * Search by movie name, over the cached film list.
 *
 * There is no SQL here on purpose. Folding accents portably in Postgres needs an extension we
 * cannot assume, and the LIKE-based version had two faults a parent would meet: a query of "???"
 * normalised to an empty string and matched every film, and "The Lion King 2019" matched the 1994
 * film through a reverse-substring test and then redirected straight to it. The rules now live in
 * lib/search.ts, in one place, under test. listFilms is cached, so on a page that has already
 * listed the films this costs no extra round trip.
 */
export const searchFilmsByName = cache(async (query: string): Promise<SearchResult> => {
  const q = query.trim();
  if (!q) return { films: [], exact: null };
  return matchFilms(await listFilms(), q);
});

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
    posterUrl: chosen.posterUrl,
    durationMs: chosen.durationMs,
    sceneCount: chosen.sceneCount,
    markers: chosen.markers,
    hasShark: sharkIndex >= 0,
    scenes: [...picked.values()].sort((a, b) => a.startMs - b.startMs),
  };
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
