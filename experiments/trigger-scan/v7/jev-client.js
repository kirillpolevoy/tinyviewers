// Jev (TypeSafe System One) HTTP client shared by classify.js and moments.js.
// Model pinned by the callers (jev-1.13.0). Output tokens are free; input is $0.042 per M tokens.
// jev-1.13 limits: 32k tokens for state + the longest question, 64k per request.
// The key comes from env.js (parsed .env.local files, never shell-sourced); nothing here prints it.

export const API_URL = 'https://api.typesafe.ai/v1/systemone';
export const PRICE_PER_MTOK = 0.042;
export const MAX_CONCURRENCY = 4; // 250k tokens/s account limit; the brief caps concurrency at 4
// Reservation uses a deliberately pessimistic chars-per-token (English JSON bills at ~3.5-4) so the
// reserved worst case is always above the billed amount.
export const RESERVE_CHARS_PER_TOKEN = 2.5;
export const EST_CHARS_PER_TOKEN = 3.2;
export const STATE_PLUS_QUESTION_LIMIT = 32_000;
export const REQUEST_LIMIT = 64_000;
export const RETRY_STATUSES = [429, 500, 502, 503, 504, 529];
// Moment-finder requests (Choice questions over line ids) bill far above the JSON-length estimate:
// over the 54 round-1 moment requests billed/est was 1.39-2.07 (median ~1.8), while the default
// reserve above is only est x 3.2/2.5 = 1.28 -- every one of them was under-reserved. Classify
// requests (0 of 632 over) keep the default. Moments reserve est x MOMENT_RESERVE_X_EST instead
// (45% headroom over the worst observed ratio). test/reserve.test.js replays the 54 real
// (est, billed) pairs against this.
export const MOMENT_RESERVE_X_EST = 3.0;

export const estTokens = (obj, cpt = EST_CHARS_PER_TOKEN) => Math.ceil(JSON.stringify(obj).length / cpt);
export const usd = (tokens) => (tokens * PRICE_PER_MTOK) / 1e6;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Size checks and the worst-case reservation for one request body. Throws near the model limits. */
export function sizeRequest(body, label, { reserveXEst = null } = {}) {
  const stateTok = estTokens(body.state);
  const longestQ = Math.max(...Object.values(body.questions).map((q) => estTokens(q)));
  const est = estTokens(body);
  if (stateTok + longestQ > STATE_PLUS_QUESTION_LIMIT * 0.9) throw new Error(`${label}: state ~${stateTok} tok + longest question ~${longestQ} is near the 32k limit`);
  if (est > REQUEST_LIMIT * 0.9) throw new Error(`${label}: request ~${est} tok is near the 64k limit`);
  const reserveTok = Math.max(estTokens(body, RESERVE_CHARS_PER_TOKEN), reserveXEst ? Math.ceil(est * reserveXEst) : 0);
  return { est, stateTok, reserveTok, reserveUsd: usd(reserveTok) };
}

/** POST with retries; returns { json, attempts:[{status, ms, error?}], latencyMs }. */
export async function postJev(body, key, { retries = 5, timeoutMs = 60_000, fetchImpl = fetch } = {}) {
  const attempts = [];
  for (let attempt = 0; ; attempt++) {
    const started = Date.now();
    let res;
    try {
      const ac = new AbortController();
      const t = setTimeout(() => ac.abort(), timeoutMs);
      res = await fetchImpl(API_URL, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` }, body: JSON.stringify(body), signal: ac.signal });
      clearTimeout(t);
    } catch (err) {
      attempts.push({ status: null, ms: Date.now() - started, error: String(err.name ?? err) });
      if (attempt >= retries) throw Object.assign(new Error(`network: ${err.message}`), { attempts });
      await sleep(1000 * 2 ** attempt);
      continue;
    }
    const ms = Date.now() - started;
    if (res.ok) {
      attempts.push({ status: res.status, ms });
      return { json: await res.json(), attempts, latencyMs: ms };
    }
    const text = await res.text();
    attempts.push({ status: res.status, ms, error: text.slice(0, 300) });
    if (!RETRY_STATUSES.includes(res.status) || attempt >= retries) throw Object.assign(new Error(`jev ${res.status}: ${text.slice(0, 300)}`), { attempts });
    const ra = Number(res.headers.get('retry-after'));
    await sleep(ra > 0 ? ra * 1000 : 1000 * 2 ** attempt);
  }
}

/**
 * Run request jobs through a pool of <= MAX_CONCURRENCY workers under a budget. Each job:
 *   { body, reserveUsd, meta }  ->  result { meta, ok, json?, error?, record }
 * The reservation is taken BEFORE dispatch; when it would break the cap the job is skipped
 * ('cap') and no later job starts. An HTTP error status means nothing was billed (reservation
 * released); a network error or our own timeout may have been billed, so the reservation is kept
 * as spent (an upper bound). `onSpend(usd)` is called with every settled amount.
 */
export async function runJobs(jobs, { key, budget, concurrency = MAX_CONCURRENCY, post = postJev, onSpend = () => {}, log = () => {} }) {
  concurrency = Math.max(1, Math.min(MAX_CONCURRENCY, Number(concurrency) || 1));
  const results = new Array(jobs.length).fill(null);
  let stopped = null;
  let next = 0;
  const worker = async () => {
    while (next < jobs.length) {
      const i = next++;
      const job = jobs[i];
      if (stopped || !budget.reserve(job.reserveUsd)) {
        stopped ??= { at: job.meta, reason: `cap: spent ${budget.spent.toFixed(6)} + reserved ${budget.reserved.toFixed(6)} + next ${job.reserveUsd.toFixed(6)} > ${budget.cap}` };
        results[i] = { meta: job.meta, ok: false, skipped: 'cap' };
        continue;
      }
      const t0 = Date.now();
      try {
        const res = await post(job.body, key);
        const inTok = res.json.usage?.input_tokens ?? 0;
        const cost = usd(inTok);
        budget.settle(job.reserveUsd, cost);
        onSpend(cost);
        // The spend rule: the reservation must be the worst case. Record (and log) any breach.
        const overReserve = cost > job.reserveUsd;
        if (overReserve) log(`  ${job.meta.label} OVER RESERVE: billed ${inTok} tok ($${cost.toFixed(8)}) > reserved $${job.reserveUsd.toFixed(8)}`);
        results[i] = {
          meta: job.meta, ok: true, json: res.json,
          record: { model: res.json.model, est_tokens: job.est, input_tokens: inTok, output_tokens: res.json.usage?.output_tokens ?? 0, cost_usd: cost, latency_ms: res.latencyMs, wall_ms: Date.now() - t0, retries: res.attempts.length - 1, attempts: res.attempts, question_count: Object.keys(job.body.questions).length, reserve_usd: job.reserveUsd, ...(overReserve ? { over_reserve: true } : {}) },
        };
        log(`  ${job.meta.label} ${inTok} tok ${res.latencyMs} ms${res.attempts.length > 1 ? ` retries ${res.attempts.length - 1} [${res.attempts.slice(0, -1).map((a) => a.status).join(',')}]` : ''}`);
      } catch (err) {
        const lastStatus = (err.attempts ?? []).at(-1)?.status ?? null;
        const maybeBilled = lastStatus === null;
        const cost = maybeBilled ? job.reserveUsd : 0;
        budget.settle(job.reserveUsd, cost);
        if (cost) onSpend(cost);
        results[i] = { meta: job.meta, ok: false, error: err.message, record: { est_tokens: job.est, error: err.message, attempts: err.attempts ?? [], wall_ms: Date.now() - t0, cost_usd: cost, cost_is_upper_bound: maybeBilled } };
        log(`  ${job.meta.label} ERROR ${err.message}`);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, jobs.length) }, worker));
  return { results, stopped };
}
