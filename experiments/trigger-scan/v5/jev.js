// Jev (TypeSafe System One) HTTP client, copied from v4/classify.js postJev with its constants.
// $0.042 per M input tokens, output free; 32k tokens for state + longest question, 64k per request.
import { key } from './env.js';

export const API_URL = 'https://api.typesafe.ai/v1/systemone';
export const PRICE_PER_MTOK = 0.042;
export const MAX_CONCURRENCY = 4;
export const RESERVE_CHARS_PER_TOKEN = 2.5; // pessimistic: reserved worst case stays above the bill
export const STATE_PLUS_QUESTION_LIMIT = 32_000;
export const REQUEST_LIMIT = 64_000;
export const RETRY_STATUSES = [429, 500, 502, 503, 504, 529];

export const estTokens = (obj, cpt = 3.2) => Math.ceil(JSON.stringify(obj).length / cpt);
export const usd = (tokens) => (tokens * PRICE_PER_MTOK) / 1e6;
export const reserveUsd = (body) => usd(estTokens(body, RESERVE_CHARS_PER_TOKEN));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Throws if a request is near either documented token limit. */
export function checkLimits(body, label) {
  const stateTok = estTokens(body.state, RESERVE_CHARS_PER_TOKEN);
  const longestQ = Math.max(...Object.values(body.questions).map((q) => estTokens(q, RESERVE_CHARS_PER_TOKEN)));
  if (stateTok + longestQ > STATE_PLUS_QUESTION_LIMIT * 0.9) throw new Error(`${label}: state ~${stateTok} + question ~${longestQ} tok is near the 32k limit`);
  if (estTokens(body, RESERVE_CHARS_PER_TOKEN) > REQUEST_LIMIT * 0.9) throw new Error(`${label}: request near the 64k limit`);
}

let KEY;
/** POST with retries; returns { json, attempts:[{status, ms, error?}], latencyMs }. */
export async function postJev(body, { retries = 5, timeoutMs = 60_000 } = {}) {
  KEY ??= key('TYPESAFE_API_KEY');
  const attempts = [];
  for (let attempt = 0; ; attempt++) {
    const started = Date.now();
    let res;
    try {
      const ac = new AbortController();
      const t = setTimeout(() => ac.abort(), timeoutMs);
      res = await fetch(API_URL, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${KEY}` }, body: JSON.stringify(body), signal: ac.signal });
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

export async function pool(items, concurrency, worker) {
  const results = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await worker(items[i], i);
    }
  }));
  return results;
}
