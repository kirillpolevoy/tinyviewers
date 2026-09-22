// `pool` and `postJson`, COPIED from experiments/trigger-scan/common.js as of commit 5fe8fb5.
//
// Only these two functions came across. The rest of common.js is file I/O and dotenv: it reads
// data/<slug>.srt from disk and loads ../../.env.local as a side effect of being imported. Neither
// belongs in a serverless function, where the subtitles arrive over the wire and the environment is
// already populated, so the two pure pieces are lifted out instead of the module.
//
// Both have since grown one thing the scripts did not need, because a script that dies leaves
// nothing behind and a serverless run leaves a job row and a lock:
//
//   * `pool` cancels. The original let `Promise.all` reject on the first failure while the other
//     workers carried on taking items — so the pipeline marked the job failed, released the
//     one-live-run lock and let the next run in while eight paid calls were still in flight.
//   * `postJson` refuses to dispatch once cancelled, carries the cancellation into `fetch`, and
//     throws an UpstreamError that has never seen the response body.

import { UpstreamError, requestIdOf } from './errors.js';

/**
 * Run `worker` over `items`, `concurrency` at a time, and stop the whole pool at the first failure.
 *
 * "Stop" means all three of: no further item is dispatched, every call already in flight is
 * aborted through the signal the worker is handed, and this function does not resolve until every
 * worker has settled. Only then is the first error rethrown. A caller can therefore treat a
 * rejection from here as "nothing of mine is still running", which is what makes it safe for
 * run.js to bank the money, write `failed` and drop the lock.
 *
 * @param {Array} items
 * @param {number} concurrency
 * @param {(item: any, i: number, signal: AbortSignal) => Promise<any>} worker
 */
export async function pool(items, concurrency, worker) {
  const results = new Array(items.length);
  const cancel = new AbortController();
  let next = 0;
  let failure = null;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, async () => {
      while (next < items.length && !failure) {
        const i = next++;
        try {
          results[i] = await worker(items[i], i, cancel.signal);
        } catch (err) {
          // The first failure is the one reported; the aborts it causes in its siblings are not.
          failure ??= err;
          if (!cancel.signal.aborted) cancel.abort(err);
        }
      }
    }),
  );
  if (failure) throw failure;
  return results;
}

// Injectable so a test can exercise the retry path without actually waiting out the backoff.
const defaultSleep = (ms) => new Promise((r) => setTimeout(r, ms));

// POST JSON with backoff on rate-limit / overload responses.
// Resolves to { json, latencyMs, status, retries, attempts } — the last three are there so a caller
// that records a run can say what really happened, including the failed attempts.
//
// `signal` is checked before every attempt as well as being passed to `fetch`, so a cancelled pool
// dispatches nothing new even against an implementation of fetch that ignores signals.
export async function postJson(url, headers, body, {
  retries = 5, fetchImpl = globalThis.fetch, sleep = defaultSleep, signal, service = 'upstream',
} = {}) {
  const attempts = [];
  for (let attempt = 0; ; attempt++) {
    if (signal?.aborted) throw new UpstreamError({ service, code: 'cancelled' });
    const started = Date.now();
    let res;
    try {
      res = await fetchImpl(url, {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body), signal,
      });
    } catch {
      // No response, so there is nothing to read and nothing to say beyond "it did not answer".
      throw new UpstreamError({ service, code: signal?.aborted ? 'cancelled' : 'no_response' });
    }
    attempts.push({ status: res.status, ms: Date.now() - started });
    if (res.ok) return { json: await res.json(), latencyMs: Date.now() - started, status: res.status, retries: attempt, attempts };
    // The body is drained and dropped: it can echo the subtitle lines this request just sent.
    await res.text().catch(() => {});
    if (![429, 500, 502, 503, 529].includes(res.status) || attempt >= retries) {
      throw new UpstreamError({ service, status: res.status, requestId: requestIdOf(res.headers), code: 'http_error' });
    }
    const retryAfter = Number(res.headers.get('retry-after'));
    await sleep(retryAfter > 0 ? retryAfter * 1000 : 2000 * 2 ** attempt);
  }
}
