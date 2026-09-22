// The five "Add a movie" endpoints, as plain async functions of (db, input) -> body, in the same
// shape as lib/endpoints.js. The files under api/add/ are thin Vercel wrappers; the tests call
// these directly.
//
// Three refusals do the real work here, and they are all about the same thing: this is a public
// button that spends real money on real API calls, and the only things standing between it and a
// bill are a passcode, a one-at-a-time lock, and a daily cap. None of them may be skippable, and
// none of them may depend on the browser behaving.

import { HttpError, badRequest, notFound } from './http.js';
import { resolveCandidates } from './tmdb.js';
import {
  requirePasscode, passcodeConfigured, capUsd, spentTodayUsd, RESERVE_USD,
  newJobId, createJob, getJob, liveJob, publicJob, sweepBlobs,
} from './jobs.js';
import { runPipeline } from '../pipeline/run.js';

// ------------------------------------------------------------------------------------------------
// POST /api/add/resolve
// ------------------------------------------------------------------------------------------------

/**
 * @param {object} body { query, passcode }
 * @returns {Promise<{ candidates: Array }>} at most three, best first. `exists: true` means the film
 *   is already in the database, and the web offers its page instead of a run.
 */
export async function resolve(db, body = {}, { apiKey = process.env.TMDB_API_KEY, fetchImpl, ip } = {}) {
  requirePasscode(body.passcode, ip);
  const query = typeof body.query === 'string' ? body.query.trim() : '';
  if (!query) throw new HttpError(400, 'Type a film title, or paste an IMDb link.', { error_code: 'empty_query' });
  if (query.length > 200) throw badRequest('That is too long to be a film title.');
  if (!apiKey) throw new HttpError(502, 'TMDB is not configured on this deployment, so films cannot be looked up.', { error_code: 'tmdb_failed' });
  return { candidates: await resolveCandidates(db, query, { apiKey, fetchImpl }) };
}

// ------------------------------------------------------------------------------------------------
// POST /api/add/jobs
// ------------------------------------------------------------------------------------------------

/**
 * Admit one run, or say why not.
 *
 * The only thing taken from the request is the IMDb id (and the passcode). Everything the run and
 * the database then use — title, year, slug, poster, synopsis — is looked up from TMDB by that id
 * here. The comment this replaces said the slug was "re-derived rather than taken from the
 * request", and it was: from a title the caller sent. A caller who could choose the title could
 * choose the slug, and the slug decides which rows a run replaces.
 *
 * @param {object} body { imdb_id, passcode, tmdb_id? } — `tmdb_id` is a hint used only to pick
 *   between several TMDB records for the same IMDb id. Anything else in the body is ignored.
 * @param {object} opts
 * @param {(start: () => Promise<any>) => void} [opts.launch] how the background run is started.
 *   On Vercel this is `waitUntil(start())`, which keeps the invocation alive past the response. The
 *   local server and the tests just call it. The default is fire-and-forget with the rejection
 *   swallowed, because `runPipeline` writes its own failures to the job row and a rejection here
 *   would be an unhandled one.
 * @returns {Promise<{ id: string, done: Promise<any>|null }>} `done` is the run itself, for a test
 *   that wants to await it. The endpoint returns only the id.
 */
export async function startJob(db, body = {}, {
  launch, keys, fetchImpl, ip, apiKey = process.env.TMDB_API_KEY,
} = {}) {
  requirePasscode(body.passcode, ip);

  const imdbId = typeof body.imdb_id === 'string' ? body.imdb_id.trim().toLowerCase() : '';
  if (!imdbId || !/^tt\d{6,10}$/i.test(imdbId)) {
    throw badRequest('That film has no IMDb id, and OpenSubtitles has nothing else to look a film up by.', { error_code: 'no_imdb_id' });
  }
  if (!apiKey) throw new HttpError(502, 'TMDB is not configured on this deployment, so films cannot be looked up.', { error_code: 'tmdb_failed' });

  // The same /find path `resolve` uses, so the candidate a run is built from is the same record the
  // person picked off the list — not a copy of it that travelled through a browser.
  const candidates = await resolveCandidates(db, imdbId, { apiKey, fetchImpl });
  const candidate = candidates.find((c) => c.tmdb_id === body.tmdb_id) ?? candidates[0];
  if (!candidate) {
    throw new HttpError(502, 'TMDB has no film with that IMDb id, so there is nothing to analyse.', { error_code: 'tmdb_failed' });
  }
  if (candidate.exists) {
    throw new HttpError(409, `${candidate.title} is already in the database.`, { error_code: 'exists', slug: candidate.slug });
  }

  const id = newJobId();
  const film = { ...candidate };
  delete film.exists;

  // `liveJob` first, and not as the lock: a run whose function died six minutes ago still has a row
  // saying 'running', and nothing but this marks it failed. Without that sweep the unique index
  // below would hold the lock for a dead run until someone loaded /api/add/status. It also names
  // the live job for the refusal, which is the one thing the index cannot tell us.
  const busy = async () => {
    const live = await liveJob(db);
    return new HttpError(409, 'Another film is being analysed right now. Wait for it to finish.', {
      error_code: 'busy', id: live?.id ?? null,
    });
  };
  const live = await liveJob(db);
  if (live) throw await busy();

  // The INSERT is the real gate for both refusals; see createJob.
  const cap = capUsd();
  const admission = await createJob(db, { id, film, cap });
  if (!admission.admitted && admission.reason === 'busy') throw await busy();
  if (!admission.admitted) {
    const spent = await spentTodayUsd(db);
    throw new HttpError(429, `Today's budget for adding films is spent ($${spent.toFixed(2)} of $${cap.toFixed(2)}). Try again tomorrow.`, {
      error_code: 'daily_cap',
      spent_usd: Number(spent.toFixed(6)),
      cap_usd: cap,
      reserve_usd: RESERVE_USD,
    });
  }

  const start = () => runPipeline(db, { jobId: id, film, keys, fetchImpl });
  let done = null;
  if (launch) launch(() => { done = start(); return done; });
  else { done = start(); done.catch(() => {}); }
  return { id, done };
}

// ------------------------------------------------------------------------------------------------
// GET /api/add/jobs/{id}
// ------------------------------------------------------------------------------------------------

/** Public: the 22-character id is the secret, and nothing on the row is anything else. */
export async function jobStatus(db, id) {
  const row = await jobRow(db, id);
  return publicJob(row);
}

// ------------------------------------------------------------------------------------------------
// GET /api/add/jobs/{id}/recording
// ------------------------------------------------------------------------------------------------

/**
 * The replay, on its own endpoint because it is a megabyte and the job body is polled every 1.5 s.
 *
 * `excerpts` is null once the run is over: they are kept on the job only while it is live (see the
 * retention rule in schema.sql), and after ingest the film's own
 * GET /api/films/{slug}/recording serves them from `recordings.excerpts`.
 *
 * That rule is enforced HERE as well as by the writes that null the column, because a run that
 * died without reaching either branch is marked failed by `liveJob` rather than by itself — and
 * the answer must not become "subtitle lines, and cacheable now" the moment it does.
 *
 * @returns {Promise<{ body: { recording: object, excerpts: object|null }, live: boolean }>} `live`
 *   is the cache decision, not part of the body: a running job's recording is still being written.
 */
export async function jobRecording(db, id) {
  const row = await jobRow(db, id);
  if (!row.recording) {
    throw notFound('The screening pass for this run has not finished yet, so there is nothing to replay.', { error_code: 'no_recording' });
  }
  const live = row.status === 'queued' || row.status === 'running';
  return {
    body: { recording: row.recording, excerpts: live ? (row.excerpts ?? null) : null },
    live,
  };
}

/**
 * The two job endpoints share this. The housekeeping matters more than it looks: `liveJob` is what
 * marks a run that stopped writing six minutes ago as `timed_out`, and it runs BEFORE the row is
 * read so whoever is polling a dead run is told it is dead on the very next poll rather than being
 * left on a spinner until somebody loads /api/add/status.
 */
async function jobRow(db, id) {
  if (!id || !/^[A-Za-z0-9_-]{16,64}$/.test(id)) throw badRequest('That is not a job id.');
  await liveJob(db);
  await sweepBlobs(db).catch(() => {});
  const row = await getJob(db, id);
  if (!row) throw new HttpError(404, 'No job with that id. It may have been started on another deployment, or never existed.', { error_code: 'no_job' });
  return row;
}

// ------------------------------------------------------------------------------------------------
// GET /api/add/status
// ------------------------------------------------------------------------------------------------

/**
 * What the web needs to decide whether to draw the form at all, before anyone types a passcode.
 *
 * `reserve_usd` appears ONLY while a run is going, and it is how much of `spent_today_usd` is money
 * set aside rather than money spent: a live run's row carries the whole reserve from the moment it
 * is admitted and is reconciled down to its real cost (about $0.25) at `done` or `failed`. That is
 * the conservative direction on purpose — the cap must not admit a second run on the strength of a
 * first one nobody has billed yet — but it means a budget bar drawn from `spent_today_usd` alone
 * jumps up by $1.80 and then back down, with nothing on the response to explain either move. Its
 * absence is the honest answer when nothing is running: there is no reserve in the figure then.
 */
export async function addStatus(db) {
  // The same two housekeeping jobs every job poll does: stale runs are failed (inside liveJob) and
  // orphaned subtitle blobs are swept. This endpoint is also what the daily cron in vercel.json
  // hits, so the sweep happens even on a day nobody opens the page.
  const live = await liveJob(db);
  await sweepBlobs(db).catch(() => {});
  return {
    running: live ? { id: live.id } : null,
    spent_today_usd: Number((await spentTodayUsd(db)).toFixed(6)),
    cap_usd: capUsd(),
    passcode_configured: passcodeConfigured(),
    // While a run is live, spent_today_usd carries its reserve; the web says so next to the figure.
    ...(live ? { reserve_usd: RESERVE_USD } : {}),
  };
}
