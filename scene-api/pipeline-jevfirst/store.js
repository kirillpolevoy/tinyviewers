// Everything the Jev-first pipeline reads from or writes to the database, in one place: subtitle
// tracks, stage checkpoints (job_stages), per-film artifacts (jevfirst_films / jevfirst_artifacts /
// jevfirst_ledger). No handler serialises anything from here except the demo list's counts.
import crypto from 'node:crypto';
import { parseSrt } from './srt.js';
import { fetchSubtitles } from '../pipeline/subtitles.js';

const sha256 = (text) => crypto.createHash('sha256').update(text).digest('hex');
const json = (v) => (v === null || v === undefined ? null : JSON.stringify(v));
const parsed = (v) => (typeof v === 'string' ? JSON.parse(v) : v);
const rowCount = (res) => res?.rowCount ?? res?.affectedRows ?? 0;
export const imdbKey = (imdbId) => String(imdbId ?? '').trim().toLowerCase();

// ------------------------------------------------------------------------------------------------
// Subtitle tracks (ported from the earlier build's lib/subtitle-cache.js)
// ------------------------------------------------------------------------------------------------

/** The stored track, parsed, or null. */
export async function readTrack(db, imdbId) {
  const { rows } = await db.query(
    'select srt, release, hearing_impaired, sha256, cue_count from subtitle_tracks where imdb_id = $1',
    [imdbKey(imdbId)],
  );
  const row = rows[0];
  if (!row) return null;
  return { srtText: row.srt, cues: parseSrt(row.srt), release: row.release ?? null, hearing_impaired: Boolean(row.hearing_impaired), sha256: row.sha256, cached: true };
}

export async function hasTrack(db, imdbId) {
  const { rows } = await db.query('select 1 from subtitle_tracks where imdb_id = $1', [imdbKey(imdbId)]);
  return rows.length > 0;
}

/**
 * Keep a track. Insert-only: a stored track is never replaced, because a film analysed from it has
 * timestamps that belong to exactly that file. Returns whether a row was written.
 */
export async function storeTrack(db, imdbId, { srtText, release = null, hearingImpaired = false, fileId = null, source = 'opensubtitles' }) {
  const res = await db.query(
    `insert into subtitle_tracks (imdb_id, srt, cue_count, release, hearing_impaired, source, file_id, sha256)
     values ($1, $2, $3, $4, $5, $6, $7, $8) on conflict (imdb_id) do nothing`,
    [imdbKey(imdbId), srtText, parseSrt(srtText).length, release, hearingImpaired, source, fileId, sha256(srtText)],
  );
  return rowCount(res) > 0;
}

/** From subtitle_tracks when there, else OpenSubtitles (then kept). */
export async function getSubtitles(db, { imdbId, apiKey, fetchImpl }) {
  const stored = await readTrack(db, imdbId);
  if (stored) return stored;
  const subs = await fetchSubtitles({ imdbId, apiKey, fetchImpl });
  await storeTrack(db, imdbId, { srtText: subs.srtText, release: subs.release, hearingImpaired: subs.hearing_impaired, fileId: subs.file_id ?? null });
  return { ...subs, sha256: sha256(subs.srtText), cached: false };
}

// ------------------------------------------------------------------------------------------------
// Stage checkpoints
// ------------------------------------------------------------------------------------------------

const addUp = (a = {}, b = {}) => {
  const out = { ...a };
  for (const [k, v] of Object.entries(b)) out[k] = (Number(out[k]) || 0) + (Number(v) || 0);
  return out;
};

/** Every stage row of a job, as a Map stage -> { status, output, spent, mark, carried, attempt, detail }. */
export async function loadStages(db, jobId) {
  const { rows } = await db.query('select * from job_stages where job_id = $1', [jobId]);
  return new Map(rows.map((r) => [r.stage, { ...r, output: parsed(r.output), spent: parsed(r.spent) ?? {}, mark: parsed(r.mark) ?? {}, carried: parsed(r.carried) ?? {} }]));
}

/**
 * Open a stage attempt. A row still 'running' is an attempt that crashed (its invocation died or ran
 * out of time without finishing it): what it committed -- per wallet, the larger of its persisted mark
 * and its banked spend -- moves into `carried`, and the new attempt's caps are reduced by it.
 * Returns { attempt, carried }.
 */
export async function beginStage(db, jobId, stage) {
  const { rows } = await db.query('select status, attempt, spent, mark, carried from job_stages where job_id = $1 and stage = $2', [jobId, stage]);
  const prev = rows[0];
  if (!prev) {
    await db.query("insert into job_stages (job_id, stage, status) values ($1, $2, 'running') on conflict (job_id, stage) do nothing", [jobId, stage]);
    return { attempt: 1, carried: {} };
  }
  if (prev.status !== 'running') throw new Error(`stage ${stage} is already ${prev.status}`);
  const spent = parsed(prev.spent) ?? {};
  const mark = parsed(prev.mark) ?? {};
  const committed = {};
  for (const k of new Set([...Object.keys(spent), ...Object.keys(mark)])) committed[k] = Math.max(Number(spent[k]) || 0, Number(mark[k]) || 0);
  const carried = addUp(parsed(prev.carried) ?? {}, committed);
  await db.query(
    `update job_stages set attempt = attempt + 1, carried = $3::jsonb, spent = '{}'::jsonb, mark = '{}'::jsonb,
            started_at = now(), updated_at = now() where job_id = $1 and stage = $2`,
    [jobId, stage, json(carried)],
  );
  return { attempt: prev.attempt + 1, carried };
}

export async function writeStageMoney(db, jobId, stage, { spent, mark }) {
  await db.query(
    'update job_stages set spent = $3::jsonb, mark = $4::jsonb, updated_at = now() where job_id = $1 and stage = $2',
    [jobId, stage, json(spent), json(mark)],
  );
}

export async function finishStage(db, jobId, stage, { output, spent, status = 'done', detail = null }) {
  await db.query(
    `update job_stages set status = $3, output = $4::jsonb, spent = $5::jsonb, mark = $5::jsonb, detail = $6,
            ended_at = now(), updated_at = now() where job_id = $1 and stage = $2`,
    [jobId, stage, status, json(output), json(spent ?? {}), detail],
  );
}

/** Everything a job's stages have committed so far (carried + spent, per stage), in USD. */
export function stagesCost(stages) {
  let total = 0;
  for (const s of stages.values()) {
    for (const v of Object.values(s.carried ?? {})) total += Number(v) || 0;
    // an attempt that has not finished may owe up to its persisted high-water mark (a crash in flight)
    const open = s.status === 'running';
    for (const k of new Set([...Object.keys(s.spent ?? {}), ...(open ? Object.keys(s.mark ?? {}) : [])])) {
      total += Math.max(Number(s.spent?.[k]) || 0, open ? Number(s.mark?.[k]) || 0 : 0);
    }
  }
  return total;
}

// ------------------------------------------------------------------------------------------------
// Per-film artifacts
// ------------------------------------------------------------------------------------------------

export const ARTIFACT_KINDS = ['sources', 'segments_raw', 'segments_precheck', 'segments', 'claims', 'fill', 'jev', 'sonnetq', 'childcry', 'resolve', 'mortal', 'moments', 'describe', 'why', 'describe2', 'why2', 'describe3', 'why3', 'whyfinal', 'tags'];
/** What a demo run needs; a film missing any of these is not offered. */
export const DEMO_KINDS = ['sources', 'segments_raw', 'segments_precheck', 'sonnetq', 'describe'];
/** Read by a demo run when present (Sonnet's second attempt and title pass; the stored guide to compare with). */
export const DEMO_OPTIONAL_KINDS = ['fill', 'describe2', 'describe3', 'tags'];

/** Counts the demo list shows, from the documents. */
export function artifactCounts(docs) {
  const seg = docs.segments_precheck ?? docs.segments;
  const scenes = seg?.scenes ?? [];
  return {
    scene_count: scenes.length,
    cut_count: Math.max(0, scenes.length - 1),
    sentence_count: scenes.reduce((n, s) => n + (s.sentences ?? []).filter((x) => !x.fill).length, 0),
    flagged_count: docs.tags ? docs.tags.scenes.filter((s) => s.flagged).length : null,
  };
}

/**
 * Write (replace) one film's artifacts, inside the caller's transaction. Replacing is the right
 * contract here: these rows belong to the Jev-first pipeline alone, and a re-seed or a re-add of the
 * same film is meant to supersede them. The live guide tables are not touched.
 */
export async function writeArtifacts(tx, film, docs, { origin, pipelineVersion, jobId = null, demoReserveUsd = null, ledger = [] }) {
  const counts = artifactCounts(docs);
  await tx.query('delete from jevfirst_films where slug = $1', [film.slug]);
  await tx.query(
    `insert into jevfirst_films (slug, imdb_id, title, year, poster_url, origin, pipeline_version, scene_count, cut_count,
                                 sentence_count, flagged_count, demo_reserve_usd, job_id)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
    [film.slug, imdbKey(film.imdb_id), film.title, film.year ?? null, film.poster_url ?? null, origin, pipelineVersion,
      counts.scene_count, counts.cut_count, counts.sentence_count, counts.flagged_count, demoReserveUsd, jobId],
  );
  for (const [kind, doc] of Object.entries(docs)) {
    if (doc === null || doc === undefined) continue;
    if (!ARTIFACT_KINDS.includes(kind)) throw new Error(`unknown artifact kind ${kind}`);
    await tx.query('insert into jevfirst_artifacts (slug, kind, doc, version) values ($1, $2, $3::jsonb, $4)', [film.slug, kind, json(doc), doc.version ?? null]);
  }
  for (const e of ledger) {
    await tx.query(
      'insert into jevfirst_ledger (slug, job_id, stage, model, usd, note, at) values ($1,$2,$3,$4,$5,$6,coalesce($7::timestamptz, now()))',
      [film.slug, jobId, e.stage, e.model, e.usd, e.note ?? null, e.at ?? null],
    );
  }
  return counts;
}

export async function readArtifacts(db, slug, kinds = ARTIFACT_KINDS) {
  const { rows } = await db.query('select kind, doc from jevfirst_artifacts where slug = $1 and kind = any($2::text[])', [slug, kinds]);
  return Object.fromEntries(rows.map((r) => [r.kind, parsed(r.doc)]));
}

export async function getJevfirstFilm(db, slug) {
  const { rows } = await db.query('select * from jevfirst_films where slug = $1', [slug]);
  return rows[0] ?? null;
}

/** The films a demo can run: every one with the documents a demo needs and a stored track. */
export async function listDemoFilms(db) {
  const { rows } = await db.query(
    `select j.slug, j.title, j.year, j.imdb_id, j.poster_url, j.scene_count, j.cut_count, j.sentence_count, j.demo_reserve_usd,
            exists (select 1 from films f where lower(f.imdb_id) = j.imdb_id or f.slug = j.slug) as in_library,
            (select f.slug from films f where lower(f.imdb_id) = j.imdb_id or f.slug = j.slug order by (lower(f.imdb_id) = j.imdb_id) desc limit 1) as library_slug,
            (select coalesce(f.poster_url, null) from films f where lower(f.imdb_id) = j.imdb_id or f.slug = j.slug limit 1) as library_poster
       from jevfirst_films j
      where (select count(*) from jevfirst_artifacts a where a.slug = j.slug and a.kind = any($1::text[])) = $2
        and exists (select 1 from subtitle_tracks t where t.imdb_id = j.imdb_id)
      order by j.title`,
    [DEMO_KINDS, DEMO_KINDS.length],
  );
  return rows;
}
