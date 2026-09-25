// OURS, not a copy (scripts/sync-jevfirst-pack.mjs never overwrites it). Stands in for
// experiments/trigger-scan/v10_1/jev-client.js with the same exports, the same constants and the same
// reservation arithmetic -- sizeRequest and the reserve/settle rules of runJobs are the experiment's,
// line for line -- and four differences, all because this runs in a request for somebody else:
//
//   1. errors never carry a response body. The experiment put `jev 400: <first 300 chars of the body>`
//      in the message; a Jev error body echoes the state it was sent, and the state is subtitle lines.
//      Errors here are pipeline/errors.js UpstreamErrors: service, status, request id, a code.
//   2. fetch, the key, the abort signal and the backoff sleep come from the run context (context.js),
//      so a test runs a whole film against a stub and a time budget can stop a stage.
//   3. money: before a request is sent the run context's beforeDispatch(reserve) is awaited (the
//      runner persists a spending high-water mark there), and every settled amount goes to the
//      context's onSpend as well as the caller's -- with `uncertain_usd`, the part of it that is an
//      upper bound rather than a measured bill (an attempt that never answered, a 200 whose body could
//      not be read or is not an answer object, an answer whose usage is not a readable token count, a
//      failure that brought no attempt history: each charged at its reservation). Where the experiment
//      read a missing usage as 0 tokens and a malformed 200 as free, this one never lets money that may
//      have been billed go unrecorded.
//   4. progress: every request is reported to the context's onDispatch(meta) as it is sent and to
//      onResult(meta, result) when it completes, which is how the demo page counts real requests.
// TODO(v10.2-sync): if v10_2/jev-client.js changes a constant (reserve factors, concurrency, the fixed
// overhead), change it here too; test/jevfirst-pack.test.js compares these constants with the source.
import { runCtx } from '../context.js';
import { UpstreamError, requestIdOf } from '../../pipeline/errors.js';

export const API_URL = 'https://api.typesafe.ai/v1/systemone';
export const PRICE_PER_MTOK = 0.042;
export const MAX_CONCURRENCY = 4; // 250k tokens/s account limit; the brief caps concurrency at 4
export const RESERVE_CHARS_PER_TOKEN = 2.5;
export const EST_CHARS_PER_TOKEN = 3.2;
export const STATE_PLUS_QUESTION_LIMIT = 32_000;
export const REQUEST_LIMIT = 64_000;
export const RETRY_STATUSES = [429, 500, 502, 503, 504, 529];
export const MOMENT_RESERVE_X_EST = 3.0;

export const estTokens = (obj, cpt = EST_CHARS_PER_TOKEN) => Math.ceil(JSON.stringify(obj).length / cpt);
export const usd = (tokens) => (tokens * PRICE_PER_MTOK) / 1e6;

/** Size checks and the worst-case reservation for one request body. Throws near the model limits. (verbatim) */
export function sizeRequest(body, label, { reserveXEst = null } = {}) {
  const stateTok = estTokens(body.state);
  const longestQ = Math.max(...Object.values(body.questions).map((q) => estTokens(q)));
  const est = estTokens(body);
  if (stateTok + longestQ > STATE_PLUS_QUESTION_LIMIT * 0.9) throw new Error(`${label}: state ~${stateTok} tok + longest question ~${longestQ} is near the 32k limit`);
  if (est > REQUEST_LIMIT * 0.9) throw new Error(`${label}: request ~${est} tok is near the 64k limit`);
  const reserveTok = Math.max(estTokens(body, RESERVE_CHARS_PER_TOKEN), reserveXEst ? Math.ceil(est * reserveXEst) : 0);
  return { est, stateTok, reserveTok, reserveUsd: usd(reserveTok) };
}

/**
 * POST with retries; returns { json, attempts:[{status, ms}], latencyMs }. Throws an UpstreamError
 * carrying `attempts` (statuses and times only). The last attempt's status is null when no response
 * arrived at all -- the case runJobs treats as possibly billed.
 */
export async function postJev(body, key, { retries = 5, timeoutMs = 60_000, beforeRetryAfterSilence = null } = {}) {
  const ctx = runCtx();
  const attempts = [];
  // A backoff the run's abort signal cuts short: a stopping invocation never sits out a retry delay.
  const pause = (ms) => abortableSleep(ctx, ms);
  for (let attempt = 0; ; attempt++) {
    if (ctx.signal?.aborted) throw Object.assign(new UpstreamError({ service: 'jev', code: 'cancelled' }), { attempts, notSent: attempt === 0 });
    const started = Date.now();
    const ac = new AbortController();
    const onAbort = () => ac.abort();
    ctx.signal?.addEventListener?.('abort', onAbort, { once: true });
    const t = setTimeout(() => ac.abort(), timeoutMs);
    // The per-attempt deadline and the parent's abort cover the WHOLE exchange -- headers and body --
    // so a response whose body stalls cannot outlive either (the listener is removed only after the
    // body has been read or dropped).
    const done = () => { clearTimeout(t); ctx.signal?.removeEventListener?.('abort', onAbort); };
    let res;
    try {
      res = await ctx.fetchImpl(API_URL, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` }, body: JSON.stringify(body), signal: ac.signal });
    } catch {
      done();
      attempts.push({ status: null, ms: Date.now() - started });
      if (attempt >= retries || ctx.signal?.aborted) throw Object.assign(new UpstreamError({ service: 'jev', code: ctx.signal?.aborted ? 'cancelled' : 'no_response' }), { attempts });
      await pause(1000 * 2 ** attempt);
      if (ctx.signal?.aborted) throw Object.assign(new UpstreamError({ service: 'jev', code: 'cancelled' }), { attempts });
      // An attempt that got no answer may have been billed. Before sending the same request again, the
      // caller reserves for it once more (runJobs); when it cannot, the request stops here.
      if (beforeRetryAfterSilence && !(await beforeRetryAfterSilence())) throw Object.assign(new UpstreamError({ service: 'jev', code: 'no_response' }), { attempts });
      continue;
    }
    const ms = Date.now() - started;
    if (res.ok) {
      let json;
      try {
        json = await readBody(res, ac.signal, 'json');
      } catch {
        done();
        attempts.push({ status: res.status, ms });
        // A 200 whose body never arrived whole (unreadable, stalled past the deadline, or cut by the
        // abort) was billed for work done at an amount we cannot read: 'unparseable', charged at its
        // reservation by runJobs.
        throw Object.assign(new UpstreamError({ service: 'jev', status: res.status, requestId: requestIdOf(res.headers), code: 'unparseable' }), { attempts });
      }
      done();
      attempts.push({ status: res.status, ms });
      // Valid JSON that is not an answer object (`null`, an array, a number...) is no more readable than
      // invalid JSON: the same 'unparseable', with the attempts that led to it kept for the charge.
      if (!isAnswerObject(json)) throw Object.assign(new UpstreamError({ service: 'jev', status: res.status, requestId: requestIdOf(res.headers), code: 'unparseable' }), { attempts });
      return { json, attempts, latencyMs: ms };
    }
    // Drained and dropped: a Jev error body quotes the state, and the state is subtitle lines.
    await readBody(res, ac.signal, 'text').catch(() => {});
    done();
    attempts.push({ status: res.status, ms });
    if (!RETRY_STATUSES.includes(res.status) || attempt >= retries) throw Object.assign(new UpstreamError({ service: 'jev', status: res.status, requestId: requestIdOf(res.headers), code: 'http_error' }), { attempts });
    const ra = Number(res.headers.get('retry-after'));
    await pause(ra > 0 ? ra * 1000 : 1000 * 2 ** attempt);
    if (ctx.signal?.aborted) throw Object.assign(new UpstreamError({ service: 'jev', code: 'cancelled' }), { attempts });
  }
}

/** A 200's body is an answer only when it is a JSON object (not null, not an array, not a scalar). */
export const isAnswerObject = (json) => json !== null && typeof json === 'object' && !Array.isArray(json);

/**
 * The input tokens a response says it was billed for, or null when it does not say so readably: a
 * billed request always has input, so only a finite number above zero is a measured bill.
 */
export function billedInputTokens(json) {
  const n = json?.usage?.input_tokens;
  return typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Read a response body, but give up the moment `signal` aborts: a fetch implementation that does not
 * wire its signal into the body stream (or a stalled stream) must not hold the caller past its deadline.
 */
export function readBody(res, signal, how) {
  const read = how === 'json' ? res.json() : res.text();
  if (!signal) return read;
  if (signal.aborted) { read.catch(() => {}); return Promise.reject(new Error('aborted')); }
  return new Promise((resolve, reject) => {
    const onAbort = () => { read.catch(() => {}); reject(new Error('aborted')); };
    signal.addEventListener('abort', onAbort, { once: true });
    read.then((v) => { signal.removeEventListener('abort', onAbort); resolve(v); }, (e) => { signal.removeEventListener('abort', onAbort); reject(e); });
  });
}

/** The run context's sleep, cut short when the run's signal aborts (resolves either way). */
export function abortableSleep(ctx, ms) {
  const signal = ctx.signal;
  if (!signal) return ctx.sleep(ms);
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const onAbort = () => resolve();
    signal.addEventListener('abort', onAbort, { once: true });
    Promise.resolve(ctx.sleep(ms)).then(() => { signal.removeEventListener('abort', onAbort); resolve(); }, () => { signal.removeEventListener('abort', onAbort); resolve(); });
  });
}

/**
 * Run request jobs through a pool of <= MAX_CONCURRENCY workers under a budget (the experiment's
 * contract, unchanged). Each job: { body, reserveUsd, meta } -> result { meta, ok, json?, error?, record }.
 * The reservation is taken BEFORE dispatch; when it would break the cap the job is skipped ('cap')
 * and no later job starts. An HTTP error status means nothing was billed (reservation released); a
 * network error or our own timeout may have been billed, so the reservation is kept as spent (an
 * upper bound). So is a 200 that is not an answer object (ok: false), an answer whose usage is not a
 * readable token count (ok: true, record.usage_unreadable), and a failure with no attempt history.
 * A cancelled run skips what it has not sent ('cancelled').
 */
export async function runJobs(jobs, { key, budget, concurrency = MAX_CONCURRENCY, post = postJev, onSpend = () => {}, log = () => {} }) {
  const ctx = runCtx();
  concurrency = Math.max(1, Math.min(MAX_CONCURRENCY, Number(concurrency) || 1));
  const results = new Array(jobs.length).fill(null);
  let stopped = null;
  let next = 0;
  // the run's ledger first: it is what the spending mark and the daily cap are reconciled from
  const spend = (cost, uncertain = 0) => { if (cost > 0) { ctx.onSpend(cost, { service: 'jev', uncertain_usd: Math.min(cost, uncertain) }); onSpend(cost); } };
  const worker = async () => {
    while (next < jobs.length) {
      const i = next++;
      const job = jobs[i];
      if (ctx.signal?.aborted) {
        stopped ??= { at: job.meta, reason: 'cancelled: the invocation ran out of time or lost its lease' };
        results[i] = { meta: job.meta, ok: false, skipped: 'cancelled' };
        continue;
      }
      if (stopped || !budget.reserve(job.reserveUsd)) {
        stopped ??= { at: job.meta, reason: `cap: spent ${budget.spent.toFixed(6)} + reserved ${budget.reserved.toFixed(6)} + next ${job.reserveUsd.toFixed(6)} > ${budget.cap}` };
        results[i] = { meta: job.meta, ok: false, skipped: 'cap' };
        continue;
      }
      try {
        await ctx.beforeDispatch(job.reserveUsd);
      } catch {
        // The high-water mark could not be persisted: nothing is sent that a crash could hide.
        budget.settle(job.reserveUsd, 0);
        stopped ??= { at: job.meta, reason: 'ledger: the spending mark could not be written' };
        results[i] = { meta: job.meta, ok: false, skipped: 'ledger' };
        continue;
      }
      try { ctx.onDispatch?.(job.meta); } catch { /* progress is never allowed to fail a stage */ }
      const t0 = Date.now();
      // Each attempt that went out and got no answer may have been billed: a retry after one takes a fresh
      // reservation (persisted like the first), and those silent attempts are counted at their reservation.
      let silent = 0;
      const beforeRetryAfterSilence = async () => {
        if (!budget.reserve(job.reserveUsd)) return false;
        try { await ctx.beforeDispatch(job.reserveUsd); } catch { budget.settle(job.reserveUsd, 0); return false; } // not sent
        silent++;
        return true;
      };
      // The request, and nothing else, inside this try: whatever went wrong afterwards must never be
      // mistaken for the request failing, and nothing may lose the attempt history the charge needs.
      let res = null;
      let err = null;
      try {
        res = await post(job.body, key, { beforeRetryAfterSilence });
      } catch (e) {
        err = e ?? new Error('request failed');
      }
      // A 200 that is not an answer object is 'unparseable' (postJev says so itself; a `post` passed in
      // may not), with the history it came with -- or none, when it brought none.
      if (!err && !isAnswerObject(res?.json)) err = Object.assign(new UpstreamError({ service: 'jev', status: 200, code: 'unparseable' }), { attempts: Array.isArray(res?.attempts) ? res.attempts : null });
      const reserved = (1 + silent) * job.reserveUsd;
      if (!err) {
        const history = Array.isArray(res.attempts) ? res.attempts : [];
        // the unanswered attempts before the answer, each at its reservation (an upper bound). `silent` is
        // our own count of them, so a history that lost some can never make them free.
        const extra = Math.max(silent, history.filter((a) => a?.status === null).length) * job.reserveUsd;
        // The answer's own usage is a measured bill only when it is a readable token count; otherwise the
        // answer is charged at its reservation, and all of it is an upper bound.
        const inTok = billedInputTokens(res.json);
        const answerCost = inTok === null ? job.reserveUsd : usd(inTok);
        const cost = answerCost + extra;
        budget.settle(reserved, cost);
        spend(cost, inTok === null ? cost : extra);
        const overReserve = inTok !== null && usd(inTok) > job.reserveUsd;
        try {
          if (overReserve) log(`  ${job.meta.label} OVER RESERVE: billed ${inTok} tok > reserved $${job.reserveUsd.toFixed(8)}`);
          if (inTok === null) log(`  ${job.meta.label} USAGE UNREADABLE: charged at its reservation $${job.reserveUsd.toFixed(8)}`);
        } catch { /* a log line never fails a request that was paid for */ }
        results[i] = {
          meta: job.meta, ok: true, json: res.json,
          record: {
            model: res.json.model, est_tokens: job.est, input_tokens: inTok ?? 0, output_tokens: res.json.usage?.output_tokens ?? 0, cost_usd: cost, latency_ms: res.latencyMs, wall_ms: Date.now() - t0,
            retries: Math.max(0, history.length - 1), attempts: history, question_count: Object.keys(job.body.questions ?? {}).length, reserve_usd: job.reserveUsd,
            ...(overReserve ? { over_reserve: true } : {}), ...(inTok === null ? { usage_unreadable: true, cost_is_upper_bound: true } : {}),
          },
        };
      } else {
        const history = Array.isArray(err?.attempts) ? err.attempts : null;
        // Billable: every attempt that went out and got no answer, and a 200 whose body could not be read
        // (work was done; its usage is unreadable) -- each at its reservation, an upper bound. A retry that
        // was reserved but never sent (cancelled in its backoff) costs nothing. A failure that brought no
        // attempt history at all cannot show that nothing went out: everything reserved for it is charged.
        // Never above what was reserved.
        const billable = history
          ? Math.max(silent, history.filter((a) => a?.status === null).length) + (err?.code === 'unparseable' ? 1 : 0)
          : 1 + silent;
        const cost = Math.min(reserved, billable * job.reserveUsd);
        budget.settle(reserved, cost);
        // none of it measured: every billable attempt here is charged at its reservation
        spend(cost, cost);
        const message = err instanceof UpstreamError ? err.message : 'request failed';
        results[i] = { meta: job.meta, ok: false, error: message, record: { est_tokens: job.est, error: message, attempts: history ?? [], wall_ms: Date.now() - t0, cost_usd: cost, cost_is_upper_bound: cost > 0 } };
      }
      try { ctx.onResult(job.meta, results[i]); } catch { /* progress is never allowed to fail a stage */ }
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, jobs.length) }, worker));
  return { results, stopped };
}
