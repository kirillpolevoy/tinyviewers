// All SQL lives here. Every value is passed as a parameter; nothing is interpolated into SQL
// except generated `$n` placeholders.

import { notFound } from './http.js';
import { POSSIBLE_THRESHOLD } from './present.js';

// --- films --------------------------------------------------------------------------------------

export async function searchFilms(db, q, limit = 25) {
  if (q) {
    const { rows } = await db.query(
      `select f.id, f.slug, f.title, f.year, f.imdb_id, f.overview,
              (select count(*)::int from scenes s where s.film_id = f.id) as scene_count
         from films f
        where lower(f.title) like '%' || lower($1) || '%'
           or lower(f.slug)  like '%' || lower($1) || '%'
        order by (lower(f.title) = lower($1)) desc, f.title
        limit $2`,
      [q, limit],
    );
    return rows;
  }
  const { rows } = await db.query(
    `select f.id, f.slug, f.title, f.year, f.imdb_id, f.overview,
            (select count(*)::int from scenes s where s.film_id = f.id) as scene_count
       from films f order by f.title limit $1`,
    [limit],
  );
  return rows;
}

// Slugs are lowercase by construction, but an assistant may echo one back capitalised; a 404 for
// "NEMO" would be a lie about the database.
export async function getFilm(db, slug) {
  const { rows } = await db.query('select * from films where lower(slug) = lower($1)', [slug]);
  return rows[0] ?? null;
}

export async function requireFilm(db, slug) {
  const film = await getFilm(db, slug);
  if (!film) {
    const { rows } = await db.query('select slug, title from films order by title');
    throw notFound(
      `No film with slug "${slug}". This database holds ${rows.length} films.`,
      { available: rows.map((r) => `${r.slug} (${r.title})`) },
    );
  }
  return film;
}

// The recorded Jev run for a film, if one was loaded. `excerpts` is null for a film whose excerpt
// file was not on the loading machine, and the replay has to work without it.
export async function getRecording(db, filmId) {
  const { rows } = await db.query(
    'select recording, excerpts, recorded_at from recordings where film_id = $1',
    [filmId],
  );
  return rows[0] ?? null;
}

// A film has exactly one analysed track today; the schema allows more.
export async function getTrack(db, filmId) {
  const { rows } = await db.query(
    'select * from tracks where film_id = $1 order by created_at, id limit 1',
    [filmId],
  );
  return rows[0] ?? null;
}

export async function getAnchors(db, trackId) {
  const { rows } = await db.query(
    `select position, cue_id, cue_index, start_ms, quote
       from anchors where track_id = $1
      order by case position when 'early' then 1 when 'middle' then 2 else 3 end`,
    [trackId],
  );
  return rows;
}

export async function getAnchorByCue(db, trackId, cueId) {
  const { rows } = await db.query(
    'select position, cue_id, cue_index, start_ms, quote from anchors where track_id = $1 and upper(cue_id) = upper($2)',
    [trackId, cueId],
  );
  return rows[0] ?? null;
}

export async function getTimeMapping(db, trackId, platform) {
  const { rows } = await db.query(
    `select platform, offset_ms, scale, measured_how, confidence
       from time_mappings where track_id = $1 and lower(platform) = lower($2)`,
    [trackId, platform],
  );
  return rows[0] ?? null;
}

export async function listPlatforms(db, trackId) {
  const { rows } = await db.query('select platform from time_mappings where track_id = $1 order by platform', [trackId]);
  return rows.map((r) => r.platform);
}

export async function getRuns(db, filmId) {
  const { rows } = await db.query(
    `select role, model, taxonomy_version, script, started_at, cost_usd, source_file
       from analysis_runs where film_id = $1 order by role, started_at`,
    [filmId],
  );
  return rows;
}

// --- vocabulary ---------------------------------------------------------------------------------
//
// The vocabulary and the groups are ~90 rows that change only when the loader runs, and every
// /scenes call reads both. They are cached in module scope with a short TTL: long enough to spare
// a serverless instance two round trips per request, short enough that a reload is picked up
// without a redeploy. Keyed on the db object so a test's PGlite never serves a pg pool's rows.

const CACHE_TTL_MS = 5 * 60_000;
const cache = new WeakMap();

function cached(db, key, load) {
  const now = Date.now();
  let forDb = cache.get(db);
  if (!forDb) { forDb = new Map(); cache.set(db, forDb); }
  const hit = forDb.get(key);
  if (hit && hit.expires > now) return hit.value;
  // Store the promise, not the rows, so concurrent requests share one query.
  const value = load().catch((err) => { forDb.delete(key); throw err; });
  forDb.set(key, { value, expires: now + CACHE_TTL_MS });
  return value;
}

// Exported for the loader and the tests: after writing new rows, forget what we cached.
export function invalidateVocabularyCache(db) {
  if (db) cache.delete(db); else cache.clear?.();
}

export async function getVocabulary(db) {
  return cached(db, 'vocabulary', async () => {
    const { rows } = await db.query(
      `select v.id, v.layer, v.group_id, v.label, v.text_blind, v.taxonomy_version, v.aliases,
              g.label as group_label
         from vocabulary v left join groups g on g.id = v.group_id
        order by v.layer, v.group_id, v.id`,
    );
    return rows;
  });
}

export async function getGroups(db) {
  return cached(db, 'groups', async () => {
    const { rows } = await db.query('select id, label, layer from groups order by id');
    return rows;
  });
}

// --- scenes -------------------------------------------------------------------------------------

/**
 * @param {object} f  { filmId, presenceIds, eventIds, groupIds, band, minSeverity, onlyConfirmed,
 *                      limit, offset }
 */
function sceneWhere(f) {
  const params = [f.filmId];
  const where = ['s.film_id = $1'];
  const p = (value) => { params.push(value); return `$${params.length}`; };

  // A scene "has" an item when a per-scene judgement asserted it. With include_possible a
  // presence item also counts on a per-beat screener probability at or above the threshold, on an
  // item the subtitles are not blind to — exactly the rule the response uses for possibly_present.
  const counts = () => (f.includePossible
    ? `(l.asserted or (l.channel = 'presence' and l.probability >= ${p(POSSIBLE_THRESHOLD)} and not v.text_blind))`
    : 'l.asserted');

  if (f.presenceIds?.length) {
    where.push(`exists (select 1 from scene_labels l join vocabulary v on v.id = l.vocabulary_id
                         where l.scene_id = s.id and l.channel = 'presence'
                           and ${counts()} and l.vocabulary_id = any(${p(f.presenceIds)}))`);
  }
  if (f.eventIds?.length) {
    where.push(`exists (select 1 from scene_labels l where l.scene_id = s.id
                          and l.channel = 'event' and l.asserted and l.vocabulary_id = any(${p(f.eventIds)}))`);
  }
  if (f.groupIds?.length) {
    where.push(`exists (select 1 from scene_labels l join vocabulary v on v.id = l.vocabulary_id
                         where l.scene_id = s.id and l.channel in ('presence','event')
                           and ${counts()} and v.group_id = any(${p(f.groupIds)}))`);
  }
  if (f.minSeverity !== null && f.minSeverity !== undefined) {
    const column = f.band === '8-10' ? 's.severity_8_10' : 's.severity_5_7';
    where.push(`${column} >= ${p(f.minSeverity)}`);
  }
  if (f.onlyConfirmed) where.push('s.confirmed_by_second_run is true');

  return { where: where.join(' and '), params, p };
}

export async function findScenes(db, f) {
  const { where, params, p } = sceneWhere(f);
  const sql = `select s.id, s.start_ms, s.end_ms, s.start_cue, s.end_cue, s.title, s.description,
                      s.severity_5_7, s.severity_8_10, s.confirmed_by_second_run, s.text_visibility,
                      s.review_status
                 from scenes s
                where ${where}
                order by s.start_ms, s.id
                limit ${p(f.limit)} offset ${p(f.offset)}`;
  const { rows } = await db.query(sql, params);
  return rows;
}

// How many scenes match the filters, ignoring limit/offset — so a paged response can say what it
// left out instead of implying the page is the whole answer.
export async function countMatchingScenes(db, f) {
  const { where, params } = sceneWhere(f);
  const { rows } = await db.query(`select count(*)::int as n from scenes s where ${where}`, params);
  return rows[0].n;
}

export async function countScenes(db, filmId) {
  const { rows } = await db.query('select count(*)::int as n from scenes where film_id = $1', [filmId]);
  return rows[0].n;
}

export async function countReviewedScenes(db, filmId) {
  const { rows } = await db.query(
    "select count(*)::int as n from scenes where film_id = $1 and review_status <> 'unreviewed'",
    [filmId],
  );
  return rows[0].n;
}

export async function getLabels(db, sceneIds) {
  if (!sceneIds.length) return [];
  const { rows } = await db.query(
    `select l.scene_id, l.vocabulary_id, l.channel, l.source, l.probability, l.asserted,
            l.confidence_kind, l.detail, l.review_status,
            v.label, v.group_id, v.text_blind, g.label as group_label
       from scene_labels l
       join vocabulary v on v.id = l.vocabulary_id
       left join groups g on g.id = v.group_id
      where l.scene_id = any($1)
      order by l.probability desc nulls last, v.label`,
    [sceneIds],
  );
  return rows;
}

export async function getSeverityHistogram(db, filmId) {
  const { rows } = await db.query(
    `select severity_5_7, count(*)::int as n from scenes where film_id = $1
      group by severity_5_7 order by severity_5_7`,
    [filmId],
  );
  return Object.fromEntries(rows.map((r) => [String(r.severity_5_7), r.n]));
}
