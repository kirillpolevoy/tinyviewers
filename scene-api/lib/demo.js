// The public live Jev demo:
//
//   GET  /api/demo/films        films with stored Jev-first artifacts
//   GET  /api/demo/status       { spent_today_usd, cap_usd, available }
//   POST /api/demo/runs {slug}  -> 202 { id }: Jev's stages, live, on that film's stored Sonnet work
//   GET  /api/demo/runs/{id}    the run's measured progress and, when done, its result
//
// This is the one path that spends money without a passcode, so it is fenced three ways, none of
// which depends on the browser behaving:
//
//   1. a daily dollar cap, DEMO_DAILY_CAP_USD (default $2), separate from the add cap. Admission
//      RESERVES the run's worst case (pipeline-jevfirst/demo.js demoReserveFor: every Jev stage cap a
//      demo runs under) in the same transaction that checks the day's total, under an advisory lock,
//      so two admissions cannot both squeeze under the cap. The run is then held to its reservation
//      (each wallet is min(stage cap, reservation left)), and the row is reconciled to the real cost
//      when the run ends. The day's total counts every run that was live at any time that UTC day --
//      created today, ended today, or still going -- so a run that started before midnight is not
//      forgotten at midnight while it keeps spending (a run that spans midnight counts on both days:
//      the cap errs on the side of spending less). A run that dies is resumed (pipeline-jevfirst/demo.js);
//      one the sweep gives up on is charged at its durable spending mark, an upper bound, not its whole
//      reservation -- and that figure is never shown as a measured bill.
//   2. at most DEMO_CONCURRENCY runs at once, enforced by a unique index over `slot`.
//   3. a per-client limit (DEMO_RUNS_PER_CLIENT runs per ten minutes), keyed on the identity the web's
//      proxy vouches for (lib/http.js clientIp) -- one instance's memory, so it stops one script on one
//      connection; the money is bounded by (1) whatever happens here.
import crypto from 'node:crypto';
import { HttpError, badRequest } from './http.js';

export const DEMO_DEFAULT_CAP_USD = 2;
export const DEMO_CONCURRENCY = 2;
export const DEMO_WINDOW_MS = 10 * 60 * 1000;
export const DEMO_RUNS_PER_CLIENT = 5;
/** A run that has not written for this long is dead (a run takes about a minute; the function dies at 300 s). */
export const DEMO_STALE_MS = 6 * 60 * 1000;

const envNumber = (name, fallback) => {
  const raw = Number(process.env[name]);
  return process.env[name] !== undefined && process.env[name] !== '' && Number.isFinite(raw) && raw >= 0 ? raw : fallback;
};
export const demoCapUsd = () => envNumber('DEMO_DAILY_CAP_USD', DEMO_DEFAULT_CAP_USD);

// The demo's reservation, without loading the pipeline (lib must stay light for the list and status).
import { DEMO_STAGE_CAPS } from '../pipeline-jevfirst/caps.js';
export const DEMO_RESERVE_USD = Math.round(Object.values(DEMO_STAGE_CAPS).reduce((a, b) => a + b, 0) * 1e6) / 1e6;

// ------------------------------------------------------------------------------------------------
// Per-client limiter
// ------------------------------------------------------------------------------------------------

const MAX_TRACKED = 1000;
const runsByClient = new Map(); // client -> [timestamps]
export const resetDemoLimiter = () => runsByClient.clear();

/** Throws 429 when this client has started DEMO_RUNS_PER_CLIENT runs in the window. A null client is never counted. */
export function checkClient(client, now = Date.now()) {
  if (!client) return;
  const recent = (runsByClient.get(client) ?? []).filter((t) => now - t < DEMO_WINDOW_MS);
  runsByClient.set(client, recent);
  if (recent.length >= DEMO_RUNS_PER_CLIENT) {
    const retry = Math.ceil((DEMO_WINDOW_MS - (now - recent[0])) / 1000);
    throw new HttpError(429, 'You have started several live runs in the last few minutes. Wait a little and try again.', { error_code: 'too_many_runs', retry_after_s: retry });
  }
}
export function noteClient(client, now = Date.now()) {
  if (!client) return;
  if (runsByClient.size >= MAX_TRACKED && !runsByClient.has(client)) {
    for (const [k, v] of runsByClient) if (!v.some((t) => now - t < DEMO_WINDOW_MS)) runsByClient.delete(k);
    if (runsByClient.size >= MAX_TRACKED) runsByClient.clear();
  }
  runsByClient.set(client, [...(runsByClient.get(client) ?? []), now]);
}

// ------------------------------------------------------------------------------------------------
// Money
// ------------------------------------------------------------------------------------------------

/**
 * The day's demo spending, as the cap counts it: every run live at any time this UTC day (created or
 * ended today, or still going), at cost_usd -- its reservation while live, its final figure after.
 */
export const DEMO_DAY_SQL = `select coalesce(sum(cost_usd), 0) as spent from demo_runs
  where created_at >= (date_trunc('day', now() at time zone 'utc') at time zone 'utc')
     or ended_at >= (date_trunc('day', now() at time zone 'utc') at time zone 'utc')
     or status in ('queued', 'running')`;

export async function demoSpentTodayUsd(db) {
  const { rows } = await db.query(DEMO_DAY_SQL);
  return Number(rows[0]?.spent ?? 0);
}

/**
 * Runs no invocation has worked on for staleMs (lease lapsed, no progress; polls kept asking and nothing
 * came) are failed and give up their slot. Their cost for the cap is their durable spending mark -- an
 * upper bound of what they can owe -- and the part of it that was never measured is recorded as uncertain.
 */
export async function sweepDemoRuns(db, staleMs = DEMO_STALE_MS) {
  await db.query(
    `update demo_runs set status = 'failed', slot = null, error_code = 'timed_out',
            error = 'This live run stopped part-way through and did not finish.',
            uncertain_usd = uncertain_usd + greatest(mark_usd - spent_usd, 0),
            spent_usd = greatest(mark_usd, spent_usd), cost_usd = greatest(mark_usd, spent_usd),
            lease_owner = null, lease_until = null, ended_at = now(), updated_at = now()
      where status in ('queued', 'running')
        and (lease_until is null or lease_until < now())
        and coalesce(progress_at, updated_at) < now() - ($1::bigint * interval '1 millisecond')`,
    [staleMs],
  );
  await db.query("delete from demo_run_stages where run_id in (select id from demo_runs where status in ('done', 'failed'))").catch(() => {});
}

/** A live run no invocation holds, quiet for this long, is asked for again by the next poll. */
export const DEMO_RESUME_GRACE_MS = 15_000;

/** Claim the right to kick a stalled run (one UPDATE: of many polls, exactly one kicks). */
export async function claimDemoKick(db, id, graceMs = DEMO_RESUME_GRACE_MS) {
  const res = await db.query(
    `update demo_runs set kicked_at = now()
      where id = $1 and status in ('queued', 'running')
        and (lease_until is null or lease_until < now())
        and coalesce(progress_at, created_at) < now() - ($2::bigint * interval '1 millisecond')
        and (kicked_at is null or kicked_at < now() - ($2::bigint * interval '1 millisecond'))
      returning id`,
    [id, graceMs],
  );
  return (res.rows?.length ?? 0) > 0;
}

/**
 * Run a demo run's next invocation, handing on to a fresh one when this one runs short of time: an
 * authenticated self-call to POST /api/demo/runs/{id}/continue (lib/jevfirst.js), or in-process locally.
 */
export async function advanceDemo(db, id, runOpts = {}) {
  const { runDemo } = await import('../pipeline-jevfirst/demo.js');
  const { requestContinuation } = await import('./jevfirst.js');
  const continueRun = runOpts.continueRun ?? ((next) => requestContinuation(next, {
    path: `/api/demo/runs/${encodeURIComponent(next)}/continue`,
    runInProcess: (again) => advanceDemo(db, again, runOpts),
    ...(runOpts.fetchContinue ? { fetchImpl: runOpts.fetchContinue } : {}),
  }));
  return runDemo(db, id, { ...runOpts, continueRun });
}

/** POST /api/demo/runs/{id}/continue: INTERNAL, authenticated with the continuation secret. */
export async function continueDemoRun(db, id, secret, runOpts = {}) {
  const { requireContinueSecret } = await import('./jevfirst.js');
  requireContinueSecret(secret);
  if (!id || !/^[A-Za-z0-9_-]{16,64}$/.test(id)) throw badRequest('That is not a run id.');
  return { accepted: true, done: advanceDemo(db, id, runOpts) };
}

const demoKeyConfigured = () => Boolean(process.env.TYPESAFE_API_KEY?.trim());

// ------------------------------------------------------------------------------------------------
// GET /api/demo/films, GET /api/demo/status
// ------------------------------------------------------------------------------------------------

export async function demoFilms(db) {
  const { listDemoFilms } = await import('../pipeline-jevfirst/store.js');
  const rows = await listDemoFilms(db);
  return rows.map((r) => ({
    slug: r.slug, title: r.title, year: r.year, poster: r.poster_url ?? r.library_poster ?? null,
    scene_count: r.scene_count, cut_count: r.cut_count, sentence_count: r.sentence_count, in_library: Boolean(r.in_library),
    // the film's own page, when it is in the library (its slug there can differ from this list's)
    library_slug: r.library_slug ?? null,
  }));
}

export async function demoStatus(db) {
  await sweepDemoRuns(db).catch(() => {});
  const spent = await demoSpentTodayUsd(db);
  const cap = demoCapUsd();
  const { rows } = await db.query("select count(*)::int as n from demo_runs where status in ('queued', 'running')");
  const busy = (rows[0]?.n ?? 0) >= DEMO_CONCURRENCY;
  return {
    spent_today_usd: Number(spent.toFixed(6)),
    cap_usd: cap,
    available: demoKeyConfigured() && spent + DEMO_RESERVE_USD <= cap && !busy,
    reserve_usd: DEMO_RESERVE_USD,
    ...(busy ? { busy: true } : {}),
    ...(!demoKeyConfigured() ? { reason: 'not_configured' } : spent + DEMO_RESERVE_USD > cap ? { reason: 'daily_cap' } : busy ? { reason: 'busy' } : {}),
  };
}

// ------------------------------------------------------------------------------------------------
// POST /api/demo/runs
// ------------------------------------------------------------------------------------------------

export const newRunId = () => crypto.randomBytes(16).toString('base64url');
const clientKey = (client) => (client ? crypto.createHash('sha256').update(String(client)).digest('hex').slice(0, 32) : null);

/**
 * Admit one demo run, or say why not. The reservation, the day's total and the slot are decided in
 * ONE transaction under an advisory lock: two simultaneous admissions cannot both fit under the cap.
 * @returns {Promise<{ id: string, done: Promise|null }>}
 */
export async function startDemoRun(db, body = {}, { ip = null, launch, runOpts = {} } = {}) {
  const slug = typeof body.slug === 'string' ? body.slug.trim() : '';
  if (!slug || !/^[a-z0-9][a-z0-9-]{0,80}$/.test(slug)) throw badRequest('Pick a film from the list.', { error_code: 'no_slug' });
  if (!demoKeyConfigured() && !runOpts.keys?.typesafe) throw new HttpError(503, 'Live runs are switched off on this deployment.', { error_code: 'not_configured' });
  checkClient(ip);
  const { listDemoFilms } = await import('../pipeline-jevfirst/store.js');
  const film = (await listDemoFilms(db)).find((f) => f.slug === slug);
  if (!film) throw new HttpError(404, 'That film has no stored analysis to run live.', { error_code: 'no_such_film' });
  await sweepDemoRuns(db).catch(() => {});

  const id = newRunId();
  const cap = demoCapUsd();
  const reserve = DEMO_RESERVE_USD;
  const outcome = await db.withTransaction(async (tx) => {
    await tx.query('select pg_advisory_xact_lock(7210012)');
    const { rows: s } = await tx.query(DEMO_DAY_SQL);
    const spent = Number(s[0]?.spent ?? 0);
    if (spent + reserve > cap) return { refused: 'daily_cap', spent };
    const { rows: live } = await tx.query("select slot from demo_runs where status in ('queued', 'running') and slot is not null");
    const taken = new Set(live.map((r) => r.slot));
    let slot = null;
    for (let k = 1; k <= DEMO_CONCURRENCY; k++) if (!taken.has(k)) { slot = k; break; }
    if (!slot) return { refused: 'busy' };
    await tx.query(
      "insert into demo_runs (id, slug, status, slot, client_key, reserve_usd, cost_usd, progress) values ($1, $2, 'queued', $3, $4, $5, $5, '{}'::jsonb)",
      [id, slug, slot, clientKey(ip), reserve],
    );
    return { admitted: true };
  });
  if (outcome.refused === 'daily_cap') {
    throw new HttpError(429, `Today's budget for live runs is spent ($${outcome.spent.toFixed(2)} of $${cap.toFixed(2)}). Try again tomorrow.`, { error_code: 'daily_cap', spent_usd: Number(outcome.spent.toFixed(6)), cap_usd: cap, reserve_usd: reserve });
  }
  if (outcome.refused === 'busy') throw new HttpError(409, 'Two live runs are going right now. Try again in a minute.', { error_code: 'busy' });
  noteClient(ip);
  const start = () => advanceDemo(db, id, runOpts);
  let done = null;
  if (launch) launch(() => { done = start(); return done; });
  else { done = start(); done.catch(() => {}); }
  return { id, done };
}

// ------------------------------------------------------------------------------------------------
// GET /api/demo/runs/{id}
// ------------------------------------------------------------------------------------------------

const parsed = (v) => (typeof v === 'string' ? JSON.parse(v) : v);

/**
 * @param {object} [opts]
 * @param {(db, id) => void} [opts.kick] resume a stalled run (default: advanceDemo, kept alive by `keepAlive`)
 */
export async function demoRun(db, id, now = Date.now(), { kick = null, keepAlive = (p) => p.catch(() => {}), runOpts = {} } = {}) {
  if (!id || !/^[A-Za-z0-9_-]{16,64}$/.test(id)) throw badRequest('That is not a run id.');
  await sweepDemoRuns(db).catch(() => {});
  const { rows } = await db.query('select * from demo_runs where id = $1', [id]);
  const row = rows[0];
  if (!row) throw new HttpError(404, 'No live run with that id.', { error_code: 'no_run' });
  // A live run nobody is working on (a continuation that never landed, a crashed invocation) is asked
  // for again by this poll -- by exactly one poll, however many are polling.
  if ((row.status === 'queued' || row.status === 'running') && (await claimDemoKick(db, id).catch(() => false))) {
    keepAlive((kick ?? ((d, runId) => advanceDemo(d, runId, runOpts)))(db, id));
  }
  const p = parsed(row.progress) ?? {};
  const started = row.started_at ? new Date(row.started_at).getTime() : null;
  const live = row.status === 'queued' || row.status === 'running';
  const end = row.ended_at ? new Date(row.ended_at).getTime() : now;
  // The film, named by the run itself: its title, and whether (and where) it is in the library now.
  const { rows: fr } = await db.query(
    `select j.slug, j.title, j.year, j.imdb_id,
            (select f.slug from films f where lower(f.imdb_id) = j.imdb_id or f.slug = j.slug order by (lower(f.imdb_id) = j.imdb_id) desc limit 1) as library_slug
       from jevfirst_films j where j.slug = $1`,
    [row.slug],
  ).catch(() => ({ rows: [] }));
  const f = fr[0] ?? null;
  const spentMeasured = Number(live ? (p.spent_usd ?? row.spent_usd ?? 0) : row.spent_usd ?? row.cost_usd);
  const uncertain = Number(row.uncertain_usd ?? 0);
  return {
    id: row.id,
    slug: row.slug,
    film: f ? { slug: f.slug, title: f.title, year: f.year ?? null, in_library: Boolean(f.library_slug), library_slug: f.library_slug ?? null } : null,
    status: row.status,
    stage: p.stage ?? null,
    started_at: row.started_at,
    elapsed_ms: started === null ? 0 : Math.max(0, (live ? now : end) - started),
    // What the run has been billed so far. Measured, except `cost_uncertain_usd`: the part of it that is
    // a crashed attempt's spending mark (an upper bound of requests that were in flight), never shown as
    // a bill. The reservation the daily cap holds while the run is live is `reserve_usd`, not a cost.
    cost_usd: Number(Math.max(0, spentMeasured - uncertain).toFixed(6)),
    cost_uncertain_usd: uncertain > 0 ? Number(uncertain.toFixed(6)) : null,
    reserve_usd: Number(row.reserve_usd),
    invocations: row.invocations ?? null,
    stages: p.stages ?? null,
    scenes: (p.scenes ?? []).map(({ requests, requests_done, ...s }) => s),
    credits: p.credits ?? null,
    feed: p.feed ?? [],
    feed_total: p.feed_total ?? 0,
    ...(row.status === 'done' ? { result: parsed(row.result) } : {}),
    ...(row.status === 'failed' ? { error_code: row.error_code, error: row.error } : {}),
  };
}
