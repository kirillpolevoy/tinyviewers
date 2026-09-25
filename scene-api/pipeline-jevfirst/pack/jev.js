// OURS, not a copy. Stands in for experiments/trigger-scan/v10_1/jev.js (the claim check's client):
// the same constants and reservation arithmetic (verbatim), with the request itself going through
// pack/jev-client.js postJev (no response body in any error; fetch, key and signal from the run
// context). Only stages.js's port of check-claims.js imports it.
import { postJev as postSafe } from './jev-client.js';
import { key } from './env.js';

export const API_URL = 'https://api.typesafe.ai/v1/systemone';
export const PRICE_PER_MTOK = 0.042;
export const MAX_CONCURRENCY = 4;
export const RESERVE_CHARS_PER_TOKEN = 2.5;
export const STATE_PLUS_QUESTION_LIMIT = 32_000;
export const REQUEST_LIMIT = 64_000;
export const RETRY_STATUSES = [429, 500, 502, 503, 504, 529];
export const CHOICE_RESERVE_X_EST = 3.0;
export const estTokens = (obj, cpt = 3.2) => Math.ceil(JSON.stringify(obj).length / cpt);
export const usd = (tokens) => (tokens * PRICE_PER_MTOK) / 1e6;
export const reserveTokens = (body) => Math.max(estTokens(body, RESERVE_CHARS_PER_TOKEN), Math.ceil(estTokens(body) * CHOICE_RESERVE_X_EST));
export const reserveUsd = (body) => usd(reserveTokens(body));

/** Throws if a request is near either documented token limit. (verbatim) */
export function checkLimits(body, label) {
  const stateTok = estTokens(body.state, RESERVE_CHARS_PER_TOKEN);
  const longestQ = Math.max(...Object.values(body.questions).map((q) => estTokens(q, RESERVE_CHARS_PER_TOKEN)));
  if (stateTok + longestQ > STATE_PLUS_QUESTION_LIMIT * 0.9) throw new Error(`${label}: state ~${stateTok} + question ~${longestQ} tok is near the 32k limit`);
  if (estTokens(body, RESERVE_CHARS_PER_TOKEN) > REQUEST_LIMIT * 0.9) throw new Error(`${label}: request near the 64k limit`);
}

export const postJev = (body, opts) => postSafe(body, key('TYPESAFE_API_KEY'), opts);

/** The experiment's pool, unchanged. */
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
