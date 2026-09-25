// The Jev-first pipeline's plumbing on the API side: which pipeline a new job runs, how a job asks
// for its next invocation, and how a stalled one is resumed.
//
//   ADD_PIPELINE            'live' switches new adds back to the one-invocation pipeline (pipeline/run.js);
//                           anything else, and unset, is the Jev-first pipeline (v10.4), the default.
//   ADD_FILM_PROXY_SECRET   the shared secret on the internal continuation call. Already set on both
//                           projects for the web proxy (lib/http.js clientIp); reused here so shipping
//                           this needs no new variable. (CONTINUE_SECRET, if ever set, overrides it.)
//   CONTINUE_BASE_URL       optional: where that call goes. Default: the production domain on a production
//                           deployment (VERCEL_PROJECT_PRODUCTION_URL, which deployment protection does not
//                           cover), else https://$VERCEL_URL, else http://localhost:$PORT.
//
// A Jev-first run is longer than one 300 s function, so each invocation hands the job to the next by
// calling POST /api/add/jobs/{id}/continue on its own deployment with `x-continue-secret`. The call is
// made inside the invocation's waitUntil promise and is fire-and-check: it returns 202 as soon as the
// new invocation has the work in hand (its own waitUntil), and if it never lands -- a cold start that
// failed, a network blip -- nothing is lost: the job's lease expires, and the next poll of
// GET /api/add/jobs/{id} that finds the job quiet asks again (kick). Crons are daily on Hobby, so
// nothing else is relied on.
import crypto from 'node:crypto';
import { HttpError } from './http.js';

export const pipelineMode = () => (String(process.env.ADD_PIPELINE ?? '').trim().toLowerCase() === 'live' ? 'live' : 'jevfirst');

const onVercel = () => Boolean(process.env.VERCEL);
const digest = (s) => crypto.createHash('sha256').update(String(s ?? ''), 'utf8').digest();
/** The continuation secret: CONTINUE_SECRET when set, else ADD_FILM_PROXY_SECRET. */
export const continueSecret = () => (process.env.CONTINUE_SECRET?.trim() || process.env.ADD_FILM_PROXY_SECRET?.trim() || '');

/** Where the continuation call goes (see the header). */
export function continueBase(env = process.env) {
  if (env.CONTINUE_BASE_URL?.trim()) return env.CONTINUE_BASE_URL.trim().replace(/\/+$/, '');
  if (env.VERCEL_ENV === 'production' && env.VERCEL_PROJECT_PRODUCTION_URL) return `https://${env.VERCEL_PROJECT_PRODUCTION_URL}`;
  if (env.VERCEL_URL) return `https://${env.VERCEL_URL}`;
  return `http://localhost:${env.PORT ?? 8787}`;
}

/** Can a job ask for its next invocation? Off Vercel with no secret it continues in-process instead. */
export function continuation() {
  const secret = continueSecret();
  // Off Vercel, a secret alone does not mean there is a server to call: the local server and the tests
  // continue in-process unless CONTINUE_BASE_URL says where to call.
  if (secret && (onVercel() || process.env.CONTINUE_BASE_URL?.trim())) return { mode: 'http', base: continueBase(), secret };
  return onVercel() ? { mode: 'none' } : { mode: 'inprocess' };
}

/** A continuation request's secret, compared in constant time. */
export function requireContinueSecret(given) {
  const secret = continueSecret();
  if (!secret) throw new HttpError(503, 'Continuations are not configured on this deployment.', { error_code: 'no_continue_secret' });
  if (!crypto.timingSafeEqual(digest(given), digest(secret))) throw new HttpError(401, 'Not allowed.', { error_code: 'bad_continue_secret' });
}

/**
 * Ask for the job's next invocation. `http`: POST the internal endpoint and wait (at most 10 s) for its
 * 202. `inprocess` (local development without a secret): run it here, after this one has returned.
 * Never throws: a continuation that did not land is picked up by the next poll (kickIfStalled).
 */
export async function requestContinuation(jobId, { fetchImpl = globalThis.fetch, runInProcess, path = null } = {}) {
  const c = continuation();
  if (c.mode === 'inprocess') {
    if (runInProcess) setImmediate(() => { runInProcess(jobId).catch(() => {}); });
    return { mode: 'inprocess' };
  }
  if (c.mode !== 'http') return { mode: 'none' };
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), 10_000);
  try {
    const headers = { 'content-type': 'application/json', 'x-continue-secret': c.secret };
    // Vercel's Protection Bypass for Automation, when the project has it: the deployment URL may be protected.
    if (process.env.VERCEL_AUTOMATION_BYPASS_SECRET) headers['x-vercel-protection-bypass'] = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
    // `path`: a demo run continues at /api/demo/runs/{id}/continue; an add or rebuild job at /api/add/jobs/{id}/continue.
    const url = `${c.base}${path ?? `/api/add/jobs/${encodeURIComponent(jobId)}/continue`}`;
    const res = await fetchImpl(url, { method: 'POST', headers, body: '{}', signal: ac.signal });
    await res.text().catch(() => {});
    return { mode: 'http', status: res.status };
  } catch {
    return { mode: 'http', status: null };
  } finally {
    clearTimeout(t);
  }
}

/** A job no invocation is working on, quiet for this long, is asked for again by the next poll. */
export const RESUME_GRACE_MS = 20_000;
/** A Jev-first job with no invocation alive for this long is failed as timed_out by the stale sweep. */
export const JEVFIRST_STALE_MS = 20 * 60 * 1000;

/**
 * If this Jev-first job is live, holds no lease and has been quiet, claim the right to kick it (one
 * UPDATE, so of many polls exactly one kicks) and return true.
 */
export async function claimKick(db, jobId, graceMs = RESUME_GRACE_MS) {
  const res = await db.query(
    `update jobs set kicked_at = now()
      where id = $1 and pipeline = 'jevfirst' and status in ('queued', 'running')
        and (lease_until is null or lease_until < now())
        and coalesce(progress_at, created_at) < now() - ($2::bigint * interval '1 millisecond')
        and (kicked_at is null or kicked_at < now() - ($2::bigint * interval '1 millisecond'))
      returning id`,
    [jobId, graceMs],
  );
  return (res.rows?.length ?? 0) > 0;
}
