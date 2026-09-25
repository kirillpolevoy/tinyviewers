// Library maintenance, behind the add-film passcode (ADD_FILM_PASSCODE):
//
//   POST /api/admin/rebuild  { passcode, slug }        -> 202 { id, slug }: run the Jev-first pipeline (v10.4)
//        on an existing library film and REPLACE its guide when the run finishes. Poll the job exactly like
//        an add: GET /api/add/jobs/{id}. The subtitles are the film's stored track (subtitle_tracks) when
//        there is one, else fetched from OpenSubtitles by its IMDb id (and then kept). The previous guide is
//        copied into guide_backups in the same transaction that replaces it; nothing changes on the page
//        until that transaction commits, and a run that fails leaves the old guide exactly as it was.
//   POST /api/admin/backups  { passcode, slug }        -> { backups: [...] } newest first
//   POST /api/admin/restore  { passcode, backup_id }   -> put a backup back (the guide it replaces is
//        itself backed up first, so a restore can be undone the same way)
//
// Money: a rebuild is admitted like an add -- it reserves the pipeline's whole worst case
// (JEVFIRST_RESERVE_USD) against the day's spending in the same INSERT that takes the one-live-job lock --
// but against REBUILD_DAILY_CAP_USD (default $15, optional), because re-running the library is a planned
// batch of several films a day, not a visitor's button. The day's total counts adds and rebuilds together.
import { HttpError, badRequest } from './http.js';
import { requirePasscodeShared, newJobId, createJob, liveJob, spentTodayUsd } from './jobs.js';
import { continuation } from './jevfirst.js';
import { advanceJevfirst } from './add.js';
import { JEVFIRST_RESERVE_USD } from '../pipeline-jevfirst/caps.js';
import { freshJevfirstSteps } from '../pipeline-jevfirst/steps.js';

export const DEFAULT_REBUILD_CAP_USD = 15;
export const rebuildCapUsd = () => {
  const raw = Number(process.env.REBUILD_DAILY_CAP_USD);
  return process.env.REBUILD_DAILY_CAP_USD && Number.isFinite(raw) && raw >= 0 ? raw : DEFAULT_REBUILD_CAP_USD;
};

const slugOf = (body) => {
  const slug = typeof body.slug === 'string' ? body.slug.trim().toLowerCase() : '';
  if (!slug || !/^[a-z0-9][a-z0-9-]{0,80}$/.test(slug)) throw badRequest('Name a library film by its slug, e.g. "nemo".', { error_code: 'no_slug' });
  return slug;
};

async function filmBySlug(db, slug) {
  const { rows } = await db.query('select id, slug, title, year, imdb_id, poster_url, overview from films where lower(slug) = $1', [slug]);
  const film = rows[0];
  if (!film) throw new HttpError(404, `There is no film "${slug}" in the library.`, { error_code: 'no_such_film' });
  return film;
}

/**
 * Admit a rebuild of one library film and start its first invocation.
 * @returns {Promise<{ id: string, slug: string, done: Promise|null }>}
 */
export async function startRebuild(db, body = {}, { ip = null, launch, keys, fetchImpl, jevfirst = {} } = {}) {
  await requirePasscodeShared(db, body.passcode, ip);
  const slug = slugOf(body);
  const film = await filmBySlug(db, slug);
  if (!film.imdb_id || !/^tt\d{6,10}$/i.test(film.imdb_id)) {
    throw new HttpError(409, `${film.title} has no IMDb id on record, so its subtitles and sources cannot be found.`, { error_code: 'no_imdb_id' });
  }
  if (continuation().mode === 'none') {
    throw new HttpError(503, 'This deployment cannot run the longer analysis: its continuation secret (ADD_FILM_PROXY_SECRET) is not configured.', { error_code: 'no_continue_secret' });
  }
  const busy = async () => {
    const live = await liveJob(db);
    return new HttpError(409, 'Another film is being analysed right now. Wait for it to finish.', { error_code: 'busy', id: live?.id ?? null });
  };
  if (await liveJob(db)) throw await busy();
  const id = newJobId();
  const jobFilm = {
    slug: film.slug, imdb_id: film.imdb_id.toLowerCase(), title: film.title, year: film.year ?? null,
    poster_url: film.poster_url ?? null, overview: film.overview ?? null, rebuild_of: film.id,
  };
  const cap = rebuildCapUsd();
  const admission = await createJob(db, { id, film: jobFilm, cap, pipeline: 'jevfirst', reserveUsd: JEVFIRST_RESERVE_USD, steps: freshJevfirstSteps(), kind: 'rebuild' });
  if (!admission.admitted && admission.reason === 'busy') throw await busy();
  if (!admission.admitted) {
    const spent = await spentTodayUsd(db, 'rebuild');
    throw new HttpError(429, `Today's budget for rebuilds is spent ($${spent.toFixed(2)} of $${cap.toFixed(2)}, adds included). Try again tomorrow.`, {
      error_code: 'daily_cap', spent_usd: Number(spent.toFixed(6)), cap_usd: cap, reserve_usd: JEVFIRST_RESERVE_USD,
    });
  }
  const start = () => advanceJevfirst(db, id, { keys, fetchImpl, ...jevfirst });
  let done = null;
  if (launch) launch(() => { done = start(); return done; });
  else { done = start(); done.catch(() => {}); }
  return { id, slug: film.slug, done };
}

export async function backups(db, body = {}, { ip = null } = {}) {
  await requirePasscodeShared(db, body.passcode, ip);
  const film = await filmBySlug(db, slugOf(body));
  const { listBackups } = await import('../pipeline-jevfirst/guide.js');
  return { slug: film.slug, backups: await listBackups(db, film.id) };
}

export async function restore(db, body = {}, { ip = null } = {}) {
  await requirePasscodeShared(db, body.passcode, ip);
  const id = Number(body.backup_id);
  if (!Number.isInteger(id) || id <= 0) throw badRequest('Name the backup to restore by its id (POST /api/admin/backups lists them).', { error_code: 'no_backup_id' });
  const busy = () => new HttpError(409, 'A film is being analysed right now; restore when it has finished.', { error_code: 'busy' });
  // A friendly early answer; the guarantee is the lock below.
  if (await liveJob(db)) throw busy();
  const { restoreGuide } = await import('../pipeline-jevfirst/guide.js');
  // The restore takes the SAME one-live-job lock a rebuild's admission takes (the jobs_one_live unique
  // index): a jobs row of kind 'restore', inserted and finished inside the restore's own transaction.
  // A rebuild already admitted makes this insert fail (busy); a rebuild asked for while the restore
  // runs waits on the uncommitted row and is admitted only after the restore has committed -- so a
  // rebuild can never be admitted "around" a restore and overwrite it unseen.
  const lockId = newJobId();
  const lock = async (tx) => {
    await tx.query(
      `insert into jobs (id, status, step, film, steps, cost_usd, pipeline, reserve_usd, kind)
       values ($1, 'running', 'restore', $2::jsonb, '[]'::jsonb, 0, 'live', 0, 'restore')`,
      [lockId, JSON.stringify({ backup_id: id, title: 'restore' })],
    );
  };
  const unlock = (tx) => tx.query("update jobs set status = 'done', updated_at = now() where id = $1", [lockId]);
  try {
    return await restoreGuide(db, id, { lock, unlock });
  } catch (err) {
    if (err?.code === '23505') throw busy();
    if (err?.code === 'no_such_backup' || err?.code === 'no_such_film') throw new HttpError(404, err.message, { error_code: err.code });
    throw err;
  }
}

/**
 * POST /api/admin/reapply { passcode, slug }: rebuild a film's guide from its STORED Jev-first answers
 * (the tags and checked segments of its last add or rebuild) with the current code -- strength rule,
 * mild scenes -- and no model call. The old guide is backed up first; same one-job lock as restore.
 */
export async function reapply(db, body = {}, { ip = null } = {}) {
  await requirePasscodeShared(db, body.passcode, ip);
  const film = await filmBySlug(db, slugOf(body));
  const { getJevfirstFilm, readArtifacts, readTrack } = await import('../pipeline-jevfirst/store.js');
  const ing = await import('../pipeline-jevfirst/stages/ingest.js');
  const { backupGuide, replaceGuide } = await import('../pipeline-jevfirst/guide.js');
  const taxonomy = await import('../pipeline-jevfirst/taxonomy-v3.js');
  const { ensureVocabulary } = await import('../load.js');
  const { invalidateVocabularyCache } = await import('./data.js');
  const jf = await getJevfirstFilm(db, film.slug);
  const docs = jf ? await readArtifacts(db, film.slug, ['tags', 'segments', 'segments_precheck']) : {};
  const track = jf ? await readTrack(db, jf.imdb_id) : null;
  if (!jf || !docs.tags || !docs.segments || !track) throw new HttpError(409, 'This film has no stored Jev-first answers to re-apply; rebuild it instead.', { error_code: 'not_available' });
  const busy = () => new HttpError(409, 'A film is being analysed right now; re-apply when it has finished.', { error_code: 'busy' });
  if (await liveJob(db)) throw busy();
  const lockId = newJobId();
  try {
    const out = await db.withTransaction(async (tx) => {
      await tx.query(
        `insert into jobs (id, status, step, film, steps, cost_usd, pipeline, reserve_usd, kind)
         values ($1, 'running', 'reapply', $2::jsonb, '[]'::jsonb, 0, 'live', 0, 'restore')`,
        [lockId, JSON.stringify({ slug: film.slug, title: 'reapply' })],
      );
      const { rows: runs } = await tx.query('select role, cost_usd from analysis_runs where film_id = $1', [film.id]);
      const cost = (role) => Number(runs.find((r) => r.role === role)?.cost_usd ?? 0);
      const built = ing.buildGuide({
        slug: film.id, film: jf, srt: { release: track.release, sha256: track.sha256 }, cues: track.cues, tags: docs.tags,
        costs: { sonnet: cost('finder'), jev: cost('labeller') }, segments: docs.segments.scenes ?? null, precheck: docs.segments_precheck?.scenes ?? null,
      });
      await ensureVocabulary(tx, taxonomy);
      await ing.ensureReasonVocabulary(tx, built.reasonLabels);
      const backupId = await backupGuide(tx, film.id, { reason: 'reapply', jobId: lockId, pipelineVersion: ing.PIPELINE_VERSION });
      await replaceGuide(tx, film.id, built);
      await tx.query("update jobs set status = 'done', updated_at = now() where id = $1", [lockId]);
      return { slug: film.slug, scenes: built.scenes.length, backup_id: backupId };
    });
    invalidateVocabularyCache(db);
    return out;
  } catch (err) {
    if (err?.code === '23505') throw busy();
    throw err;
  }
}
