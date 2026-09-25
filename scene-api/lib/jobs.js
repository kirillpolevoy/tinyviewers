// Everything about an "Add a movie" job that is not the analysis itself: admitting one, recording
// its progress, and the three refusals that keep a public button from costing real money.
//
// The id is the only protection a job has. It is 22 characters of base64url over 16 random bytes,
// it is returned once to whoever started the run, and GET /api/add/jobs/{id} is otherwise open —
// which is a deliberate trade (the web page must poll without a session) and the reason no column
// on `jobs` may ever hold anything but what a stranger could already be shown.

import crypto from 'node:crypto';
import { HttpError } from './http.js';
import { JEVFIRST_STALE_MS } from './jevfirst.js';

// ------------------------------------------------------------------------------------------------
// The passcode
// ------------------------------------------------------------------------------------------------

/**
 * Hashing both sides first is what makes the comparison constant-time in practice:
 * `crypto.timingSafeEqual` throws on buffers of different lengths, so comparing the raw strings
 * would leak the passcode's length through the exception before it compared a single byte.
 */
// Trimmed on both sides: a passcode piped into `vercel env add` arrives with a trailing newline,
// and one pasted into a form can carry a space. Neither is part of what a person means by it.
const digest = (s) => crypto.createHash('sha256').update(String(s ?? '').trim(), 'utf8').digest();

// Guessing the passcode should cost something. This is an in-memory counter per calling IP, which
// on a serverless platform means PER INSTANCE and only for as long as that instance lives: an
// attacker who spreads their guesses across cold starts is not slowed down at all. It is here
// because it is nearly free and it stops the dumb case (one script hammering one connection), not
// because it is a defence. The real answer is a Vercel firewall rate-limit rule on /api/add/*.
export const PASSCODE_WINDOW_MS = 10 * 60 * 1000;
export const PASSCODE_MAX_FAILURES = 10;
const MAX_TRACKED_IPS = 1000; // a bound on the map, so the counter cannot itself become the leak

const failures = new Map(); // ip -> { n, until }

/** Tests and a long-lived local server; production instances are short-lived enough not to need it. */
export const resetPasscodeAttempts = () => failures.clear();

function attemptsFor(ip) {
  const now = Date.now();
  const rec = failures.get(ip);
  if (rec && rec.until > now) return rec;
  failures.delete(ip);
  return null;
}

function noteFailure(ip) {
  const rec = attemptsFor(ip);
  if (rec) { rec.n += 1; return; }
  // Only ever prune on a miss, and only when the map has actually grown: an expired entry that
  // nobody asks about again is harmless until then.
  if (failures.size >= MAX_TRACKED_IPS) {
    const now = Date.now();
    for (const [k, v] of failures) if (v.until <= now) failures.delete(k);
    if (failures.size >= MAX_TRACKED_IPS) failures.clear();
  }
  failures.set(ip, { n: 1, until: Date.now() + PASSCODE_WINDOW_MS });
}

/**
 * Never logged, never echoed, never part of an error message.
 *
 * @param {string} given
 * @param {string|null} [ip] the caller, for the failed-attempt counter. Omitted by the tests that
 *   only care about the comparison, and by any caller that has no address to attribute a guess to.
 */
export function requirePasscode(given, ip = null) {
  const expected = process.env.ADD_FILM_PASSCODE;
  if (!expected?.trim()) {
    throw new HttpError(503, 'Adding films is switched off on this deployment: no passcode is configured.', { error_code: 'no_passcode' });
  }
  if (ip && (attemptsFor(ip)?.n ?? 0) >= PASSCODE_MAX_FAILURES) {
    throw new HttpError(429, 'Too many wrong passcodes from this address. Wait ten minutes.', { error_code: 'too_many_attempts' });
  }
  if (!crypto.timingSafeEqual(digest(given), digest(expected))) {
    if (ip) noteFailure(ip);
    throw new HttpError(401, 'That passcode is not right.', { error_code: 'bad_passcode' });
  }
}

export const passcodeConfigured = () => Boolean(process.env.ADD_FILM_PASSCODE?.trim());

/**
 * The same check, with the wrong-passcode count kept in the DATABASE (passcode_failures), so every
 * function instance -- and every cold start -- shares one count. Used by every route that takes the
 * passcode (/api/add/* and /api/admin/*), inside the handler, so it holds however the route is reached.
 *
 *   * PER CALLER, and only per caller: PASSCODE_MAX_FAILURES wrong passcodes per caller per window. The
 *     caller is lib/http.js clientIp: an identity Vercel's edge writes (or our own proxy vouches for
 *     with ADD_FILM_PROXY_SECRET), which a caller cannot choose. Other callers' failures never refuse
 *     anyone: the passcode is 16 random characters, so no number of guesses spread across callers is a
 *     threat worth locking the owner out for -- and a lock shared by everybody is one any stranger can
 *     pull. Across all callers there is only an ALERT (a log line once PASSCODE_GLOBAL_ALERT_FAILURES
 *     wrong passcodes land in one window), never a refusal.
 *   * ATOMIC: an attempt is counted BEFORE its passcode is compared, by one upsert that returns the new
 *     count, so N concurrent guesses get N different numbers and only the first PASSCODE_MAX_FAILURES
 *     are compared at all. A right passcode (and a refused attempt, which was never compared) gives its
 *     count back.
 *   * rows whose window has passed are deleted on the way in.
 *
 * A caller with no identity is not counted (a shared bucket would be a lock anyone could pull). The
 * in-memory counter above still runs too. If the table cannot be used the database count is skipped,
 * never the check.
 */
export const PASSCODE_GLOBAL_ALERT_FAILURES = 60;
const COUNT_SQL = `insert into passcode_failures (key, failures, window_start) values ($1, 1, now())
  on conflict (key) do update set
    failures = case when passcode_failures.window_start < now() - ($2::bigint * interval '1 millisecond') then 1 else passcode_failures.failures + 1 end,
    window_start = case when passcode_failures.window_start < now() - ($2::bigint * interval '1 millisecond') then now() else passcode_failures.window_start end
  returning failures`;
const GIVE_BACK_SQL = 'update passcode_failures set failures = greatest(failures - 1, 0) where key = $1';
const PRUNE_SQL = `delete from passcode_failures where window_start < now() - ($1::bigint * interval '1 millisecond')`;

export async function requirePasscodeShared(db, given, ip = null, { log = console } = {}) {
  // Not configured: the 503 says so, and nothing is counted.
  if (!expectedPasscodeSet()) return requirePasscode(given, ip);
  const clientKey = ip ? `client:${crypto.createHash('sha256').update(String(ip)).digest('hex').slice(0, 32)}` : null;
  let counted = false;
  if (clientKey) {
    let n = null;
    try {
      await db.query(PRUNE_SQL, [PASSCODE_WINDOW_MS]);
      const { rows } = await db.query(COUNT_SQL, [clientKey, PASSCODE_WINDOW_MS]);
      n = Number(rows[0]?.failures);
      counted = Number.isFinite(n);
    } catch { /* the database count is an addition; the in-memory one below still applies */ }
    if (counted && n > PASSCODE_MAX_FAILURES) {
      // Over this caller's limit: refused without comparing, and this attempt is not left counted.
      await db.query(GIVE_BACK_SQL, [clientKey]).catch(() => {});
      throw new HttpError(429, 'Too many wrong passcodes from you. Wait ten minutes.', { error_code: 'too_many_attempts' });
    }
  }
  try {
    requirePasscode(given, ip);
  } catch (err) {
    if (err?.status === 401) {
      // A wrong passcode keeps its count. Across all callers: counted for the alert only.
      try {
        const { rows } = await db.query(COUNT_SQL, ['all', PASSCODE_WINDOW_MS]);
        if (Number(rows[0]?.failures) === PASSCODE_GLOBAL_ALERT_FAILURES) {
          log.warn?.(`[passcode] ${PASSCODE_GLOBAL_ALERT_FAILURES} wrong passcodes across all callers in the last ten minutes; nobody has been locked out`);
        }
      } catch { /* the alert is best effort */ }
    } else if (counted) {
      await db.query(GIVE_BACK_SQL, [clientKey]).catch(() => {});
    }
    throw err;
  }
  // Right: this attempt was never a failure.
  if (counted) await db.query(GIVE_BACK_SQL, [clientKey]).catch(() => {});
}
const expectedPasscodeSet = () => Boolean(process.env.ADD_FILM_PASSCODE?.trim());

// ------------------------------------------------------------------------------------------------
// Money and time
// ------------------------------------------------------------------------------------------------

/**
 * The most one run may cost, not the most one is expected to cost — the cap is only a cap if the
 * reserve is a real ceiling. It is the sum of the three per-stage ceilings the pipeline enforces,
 * and every one of them now reserves each call's worst case BEFORE dispatching it, so none of them
 * can be overshot by the calls that were already in flight when the cap was reached:
 *
 *   jev       $0.20  pipeline/record.js COST_CAP_USD, reserved per request at its own token
 *                    estimate. The six recorded films cost $0.057-$0.109 each.
 *   scenes    $0.60  pipeline/scenes.js COST_CAP_USD, refused before the call when the
 *                    transcript plus the output ceiling would not fit inside it.
 *   presence  $1.00  pipeline/presence.js COST_CAP_USD, reserved per scene, so the film stops
 *                    part-way rather than between films and never with five calls out.
 *                    ------
 *                    $1.80
 *
 * A real film is nothing like that: Gruffalo and Room on the Broom cost $0.05-$0.06 of presence and
 * about $0.25 all in. The gap between $0.25 and $1.80 is the price of the cap meaning what it says.
 * If any of those three numbers moves, this one moves with it — that is what makes the refusal
 * `spent + reserve > cap` an honest one.
 */
export const RESERVE_USD = 1.8;
export const DEFAULT_CAP_USD = 5;

/**
 * A job that has not been touched for this long is not running any more. Vercel kills a function at
 * 300 s, so nothing healthy can go six minutes without writing a step; anything that has is a run
 * whose process died between two stages, and it must not hold the lock for the rest of the day.
 */
export const STALE_MS = 6 * 60 * 1000;

export const capUsd = () => {
  const raw = Number(process.env.ADD_FILM_DAILY_CAP_USD);
  return Number.isFinite(raw) && raw >= 0 ? raw : DEFAULT_CAP_USD;
};

/**
 * Which jobs the day's spending counts (adds and rebuilds together, failures included -- a failed run
 * still paid): every job that was live at any time this UTC day. Created today; or ended today (a job's
 * last write is its end: `updated_at` is stamped by every write and nothing writes a job after it ends);
 * or still queued or running. A job admitted before midnight that finishes, or is still going, after it
 * is not forgotten at midnight -- it counts at its reservation while live and its real cost after. A job
 * live across midnight counts on both days: the cap errs on the side of spending less (the demo's rule,
 * lib/demo.js DEMO_DAY_SQL).
 */
const UTC_DAY_START = "(date_trunc('day', now() at time zone 'utc') at time zone 'utc')";
export const JOBS_DAY_WHERE = `(created_at >= ${UTC_DAY_START} or updated_at >= ${UTC_DAY_START} or status in ('queued', 'running'))`;

/**
 * What the jobs of one kind live today have spent (JOBS_DAY_WHERE). Adds and rebuilds have their own
 * daily caps (ADD_FILM_DAILY_CAP_USD, REBUILD_DAILY_CAP_USD), so each counts only its own jobs: a
 * library rebuild must not use up the day's budget for adding a film.
 */
export async function spentTodayUsd(db, kind = 'add') {
  const { rows } = await db.query(`select coalesce(sum(cost_usd), 0) as spent from jobs where ${JOBS_DAY_WHERE} and coalesce(kind, 'add') = $1`, [kind]);
  return Number(rows[0]?.spent ?? 0);
}

// ------------------------------------------------------------------------------------------------
// Rows
// ------------------------------------------------------------------------------------------------

/** 16 random bytes, base64url: 22 characters, no padding, safe in a path and in a URL. */
export const newJobId = () => crypto.randomBytes(16).toString('base64url');

export const STEPS = [
  { id: 'subtitles', label: 'Finding the subtitles' },
  { id: 'jev', label: 'Screening every beat' },
  { id: 'scenes', label: 'Reading the film for scenes' },
  { id: 'presence', label: 'Labelling what is in each scene' },
  { id: 'excerpts', label: 'Choosing the evidence lines' },
  { id: 'ingest', label: 'Writing it into the database' },
];

export const freshSteps = () => STEPS.map((s) => ({ ...s, status: 'pending', started_ms: null, ended_ms: null, detail: null }));

/**
 * Admit one run, or say which refusal it hit — in a single statement, because the two refusals it
 * checks are races.
 *
 * "Is another run going?" as a SELECT followed by an INSERT is not a lock. Two POSTs a millisecond
 * apart both read no live job, both read the same day's spending, both were admitted, both spent
 * real money, and the second one's `writeFilm` deleted the first one's film. So the INSERT is the
 * gate: the `jobs_one_live` partial unique index in schema.sql makes a second live row impossible
 * and the loser gets a 23505, and the day's spending is read in the same statement's WHERE clause
 * rather than in a query before it. No explicit transaction and no advisory lock: one statement is
 * already atomic on both adapters, and PGlite's single connection cannot hold two of them at once
 * (a second `begin` there joins the first transaction, so the loser's rollback would discard the
 * winner's row — which is exactly what the test for this would have been asserting).
 *
 * `cost_usd` starts at the reserve rather than at 0. A run that is abandoned — the platform kills
 * the function at 300 s, the instance goes away mid-stage — never writes a final cost, and a row
 * that reads as free would let the daily cap admit run after run. The real total replaces the
 * reserve when the run reaches done or failed; see pipeline/run.js.
 *
 * @returns {Promise<{admitted: true, row: object} | {admitted: false, reason: 'busy'|'daily_cap'}>}
 */
export async function createJob(db, { id, film, reserveUsd = RESERVE_USD, cap = capUsd(), pipeline = 'live', steps = freshSteps(), kind = 'add' }) {
  let res;
  try {
    // `reserve_usd` is recorded on the row because the two pipelines reserve different amounts
    // (pipeline-jevfirst/caps.js), and /api/add/status must say which one is in the day's figure.
    res = await db.query(
      `insert into jobs (id, status, step, film, steps, cost_usd, pipeline, reserve_usd, kind)
       select $1, 'queued', null, $2::jsonb, $3::jsonb, $4::numeric, $6, $4::numeric, $7
        where (select coalesce(sum(cost_usd), 0) from jobs where ${JOBS_DAY_WHERE} and coalesce(kind, 'add') = $7) + $4::numeric <= $5::numeric`,
      [id, JSON.stringify(film), JSON.stringify(steps), reserveUsd, cap, pipeline, kind],
    );
  } catch (err) {
    // The only other unique key on this table is the primary key, and a collision on 128 bits of
    // randomness is a bug worth seeing rather than a "someone else is running" message.
    if (err?.code !== '23505' || err?.constraint === 'jobs_pkey') throw err;
    return { admitted: false, reason: 'busy' };
  }
  // `pg` reports an insert's row count as `rowCount` and PGlite as `affectedRows`. Zero means the
  // WHERE clause said no: today's spending plus this run's reserve would pass the cap.
  const inserted = res?.rowCount ?? res?.affectedRows ?? 0;
  if (!inserted) return { admitted: false, reason: 'daily_cap' };
  return { admitted: true, row: await getJob(db, id) };
}

export async function getJob(db, id) {
  const { rows } = await db.query('select * from jobs where id = $1', [id]);
  return rows[0] ?? null;
}

/**
 * Patch a job and stamp `updated_at`. Every stage calls this, which is what makes the staleness
 * rule work: `updated_at` is a heartbeat, not a record of the last interesting change.
 */
export async function patchJob(db, id, fields) {
  const keys = Object.keys(fields);
  const jsonCols = new Set(['film', 'steps', 'recording', 'excerpts']);
  const params = [id];
  const sets = keys.map((k) => {
    const v = fields[k];
    params.push(jsonCols.has(k) && v !== null && v !== undefined ? JSON.stringify(v) : v);
    return `${k} = $${params.length}`;
  });
  await db.query(`update jobs set ${[...sets, 'updated_at = now()'].join(', ')} where id = $1`, params);
}

/**
 * The job that currently holds the lock, if there is one.
 *
 * Stale jobs are not merely ignored: they are marked failed on the way past, so the row stops
 * claiming to be running and whoever started it sees `timed_out` rather than a spinner forever.
 * Their blobs go with them — a dead run must not leave a subtitle file sitting in the database —
 * and so do their excerpts, which are subtitle text under the retention rule in schema.sql and
 * have no film to hang off once the run that made them is dead.
 */
export async function liveJob(db) {
  const { rows } = await db.query(
    `select id, status, updated_at, pipeline, reserve_usd, lease_until, progress_at, created_at
       from jobs where status in ('queued', 'running') order by created_at`,
  );
  let live = null;
  for (const row of rows) {
    // A Jev-first job runs as a chain of invocations with gaps between them, and a stalled one is
    // RESUMED by the next poll rather than failed (lib/jevfirst.js). It is dead only when no invocation
    // has been alive for JEVFIRST_STALE_MS and none holds the lease now.
    const jevfirst = row.pipeline === 'jevfirst';
    const leaseLive = jevfirst && row.lease_until && new Date(row.lease_until).getTime() > Date.now();
    const idleMs = Date.now() - new Date(jevfirst ? (row.progress_at ?? row.created_at) : row.updated_at).getTime();
    if (!leaseLive && idleMs > (jevfirst ? JEVFIRST_STALE_MS : STALE_MS)) {
      // The UPDATE re-checks what the SELECT saw: an invocation may have taken the lease (or a live run
      // written) in between, and a job that is alive again must not be failed from under it.
      const res = await db.query(
        `update jobs set status = 'failed', error_code = 'timed_out',
           error = 'This run stopped part-way through and did not finish.',
           excerpts = null, updated_at = now()
         where id = $1 and status in ('queued', 'running')
           and (case when pipeline = 'jevfirst'
                     then (lease_until is null or lease_until < now())
                          and coalesce(progress_at, created_at) < now() - ($2::bigint * interval '1 millisecond')
                     else updated_at < now() - ($3::bigint * interval '1 millisecond') end)`,
        [row.id, JEVFIRST_STALE_MS, STALE_MS],
      );
      if ((res?.rowCount ?? res?.affectedRows ?? 0) > 0) { await dropBlob(db, row.id); continue; }
    }
    live ??= row;
  }
  return live;
}

// ------------------------------------------------------------------------------------------------
// The subtitle blob
// ------------------------------------------------------------------------------------------------

/** How long an orphaned blob may survive a function that died without finishing. */
export const BLOB_SWEEP_MS = 30 * 60 * 1000;

export async function putBlob(db, jobId, srt) {
  await db.query(
    'insert into job_blobs (job_id, srt) values ($1, $2) on conflict (job_id) do update set srt = excluded.srt',
    [jobId, srt],
  );
}

export async function getBlob(db, jobId) {
  const { rows } = await db.query('select srt from job_blobs where job_id = $1', [jobId]);
  return rows[0]?.srt ?? null;
}

export async function dropBlob(db, jobId) {
  await db.query('delete from job_blobs where job_id = $1', [jobId]);
}

/**
 * Anything left behind by a run that never reached done or failed. Cheap enough to do on any call.
 *
 * `pg` reports how many rows a delete touched as `rowCount` and PGlite as `affectedRows`, and this
 * runs against both.
 */
export async function sweepBlobs(db, olderThanMs = BLOB_SWEEP_MS) {
  const res = await db.query(
    `delete from job_blobs where created_at < now() - ($1::bigint * interval '1 millisecond')`,
    [olderThanMs],
  );
  return res?.rowCount ?? res?.affectedRows ?? 0;
}

/** How often one instance will bother sweeping off the back of ordinary read traffic. */
export const SWEEP_EVERY_MS = 10 * 60 * 1000;
let lastSweep = 0;

/**
 * The same sweep, hung off the routes parents actually use.
 *
 * The `/api/add` routes sweep on every call, but nobody is on those pages: an orphaned blob is
 * created precisely when a run dies, and the person watching it closes the tab. The cron in
 * vercel.json is daily, because Vercel's Hobby plan refuses any schedule that runs more often, so
 * the cron alone makes the real bound "within a day", not thirty minutes. `/api/films*` is the
 * traffic this deployment has, and one DELETE against an indexed timestamp every ten minutes per
 * instance costs nothing while making the usual case minutes rather than hours.
 *
 * Never throws and never blocks the answer: sweeping is housekeeping, not part of the response.
 */
export async function maybeSweepBlobs(db, now = Date.now()) {
  if (now - lastSweep < SWEEP_EVERY_MS) return false;
  lastSweep = now;
  await sweepBlobs(db).catch(() => {});
  return true;
}

/** Tests only: the throttle above is module state and a test needs a fresh instance's view. */
export const resetBlobSweepThrottle = () => { lastSweep = 0; };

// ------------------------------------------------------------------------------------------------
// What a caller is shown
// ------------------------------------------------------------------------------------------------

/**
 * A job row as the polling endpoint returns it.
 *
 * `recording` and `excerpts` are deliberately NOT in here. Between them they are 0.7-1.3 MB, they
 * do not change after the jev stage ends, and the page asks for this body every 1.5 s for three
 * minutes — a megabyte a second of something already on the client. `recording_ready` says when to
 * fetch GET /api/add/jobs/{id}/recording, once.
 *
 * What is left is what the page actually re-reads: the step list, the money, the error. The other
 * job of this function is to normalise the numbers Postgres hands back as strings and to add
 * `elapsed_ms`, which is the only thing the page cannot work out without trusting its own clock
 * against ours.
 */
export function publicJob(row, now = Date.now()) {
  const created = new Date(row.created_at).getTime();
  const updated = new Date(row.updated_at).getTime();
  const running = row.status === 'queued' || row.status === 'running';
  return {
    id: row.id,
    kind: row.kind ?? 'add',
    status: row.status,
    step: row.step,
    film: row.film,
    steps: row.steps ?? [],
    cost_usd: Number(row.cost_usd ?? 0),
    error_code: row.error_code,
    error: row.error,
    recording_ready: Boolean(row.recording),
    scene_count: row.scene_count ?? null,
    created_at: row.created_at,
    updated_at: row.updated_at,
    elapsed_ms: Math.max(0, (running ? now : updated) - created),
  };
}
