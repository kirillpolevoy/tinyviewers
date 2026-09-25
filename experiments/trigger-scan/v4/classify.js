#!/usr/bin/env node
// v4 Jev classifier runner: every scene of out/<slug>.segments.json against the v4 question set.
//
//   node classify.js <slug> [--run r1] [--cap 0.25] [--concurrency 4] [--limit N]
//                           [--layout single|split] [--full-cast] [--dry-run]
//
// Writes out/<slug>.jev.<run>.json with the RAW answers per scene (Noul probabilities, Score
// value + confidence + distribution, Choice distribution), per-request timing, tokens, every
// attempt's HTTP status, and the actual spend. No tags or flags here: that is select.js.
//
// Layouts
//   single (default): one request per scene; state has both scene.summary and scene.lines and each
//                     question points at the path it may use (docs: backticked state paths).
//   split:            three requests per scene over three states — lines only (pl.*, m.*), summary
//                     only (ps.*), both (events, modifiers, scores, kind). Costs a little more
//                     (film + cast + setting are sent three times) but the two presence channels
//                     cannot see each other's evidence. Used to measure whether path references
//                     alone keep the source attribution clean.
//
// Money: every request reserves its worst case BEFORE dispatch (budget.js); the run stops cleanly
// when the next reservation would break --cap, and writes what it has with complete:false.
// Model pinned to jev-1.13.0. Output tokens are free; input is $0.042 per M tokens.
//
// Nothing here prints secrets. The key is read from ../../../.env.local by a small parser (values
// can contain '&'; never shell-source them).

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { parseSrt } from '../srt.js';
import { budget } from './budget.js';
import { buildQuestions, questionCounts, stateFor, VERSION, MODEL, SCORES } from './questions.js';

const here = path.dirname(fileURLToPath(import.meta.url));
export const API_URL = 'https://api.typesafe.ai/v1/systemone';
export const PRICE_PER_MTOK = 0.042;
export const MAX_CONCURRENCY = 4; // documented limit is 1200 req/min; the brief caps us at 4
// Reservation uses a deliberately pessimistic chars-per-token (English JSON is ~3.5-4 in practice)
// so the reserved worst case is always above the billed amount.
export const RESERVE_CHARS_PER_TOKEN = 2.5;
export const EST_CHARS_PER_TOKEN = 3.2;
export const STATE_PLUS_QUESTION_LIMIT = 32_000; // jev-1.13: state + longest question
export const REQUEST_LIMIT = 64_000; // jev-1.13: state + all questions
export const RETRY_STATUSES = [429, 500, 502, 503, 504, 529];

// ---- env ------------------------------------------------------------------------------------------

export function readEnvFile(file) {
  const out = {};
  if (!fs.existsSync(file)) return out;
  for (const raw of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = raw.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    out[m[1]] = v;
  }
  return out;
}

function typesafeKey() {
  if (process.env.TYPESAFE_API_KEY) return process.env.TYPESAFE_API_KEY;
  const root = path.resolve(here, '../../..');
  for (const f of [path.join(root, '.env.local'), path.join(root, 'scene-api/.env.local')]) {
    const v = readEnvFile(f).TYPESAFE_API_KEY;
    if (v) return v;
  }
  throw new Error('TYPESAFE_API_KEY not found in env or .env.local');
}

// ---- helpers ----------------------------------------------------------------------------------------

export const estTokens = (obj, cpt = EST_CHARS_PER_TOKEN) => Math.ceil(JSON.stringify(obj).length / cpt);
export const usd = (tokens) => (tokens * PRICE_PER_MTOK) / 1e6;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) { args._.push(a); continue; }
    const key = a.slice(2);
    const next = argv[i + 1];
    args[key] = next !== undefined && !next.startsWith('--') ? argv[++i] : true;
  }
  return args;
}

/** Contract checks on a segments file. Throws on anything select/classify cannot trust. */
export function checkSegments(seg, nCues) {
  if (!seg?.film?.slug || !Array.isArray(seg.scenes) || !seg.scenes.length || !Array.isArray(seg.cast)) throw new Error('segments: missing film.slug, cast or scenes');
  const sc = seg.scenes;
  sc.forEach((s, i) => {
    if (!Number.isInteger(s.start_cue) || !Number.isInteger(s.end_cue) || s.start_cue > s.end_cue) throw new Error(`segments: ${s.id} bad cue range`);
    if (s.end_cue > nCues) throw new Error(`segments: ${s.id} ends at cue ${s.end_cue} but the SRT has ${nCues}`);
    if (i && s.start_cue !== sc[i - 1].end_cue + 1) throw new Error(`segments: ${s.id} is not contiguous with ${sc[i - 1].id}`);
    if (typeof s.summary !== 'string') throw new Error(`segments: ${s.id} has no summary`);
  });
  const partial = seg.fixture?.partial === true;
  if (!partial && (sc[0].start_cue !== 1 || sc[sc.length - 1].end_cue !== nCues)) throw new Error(`segments: scenes cover ${sc[0].start_cue}-${sc[sc.length - 1].end_cue}, SRT has 1-${nCues}`);
  return { partial };
}

/** The requests for one scene: [{ part, state, questions, castUsed }]. Pure. */
export function planScene({ film, cast, scene, cues, layout = 'single', fullCast = false }) {
  const parts = layout === 'split'
    ? [
      { part: 'lines', include: ['lines'], channels: ['pl', 'm'] },
      { part: 'summary', include: ['summary'], channels: ['ps'] },
      { part: 'both', include: ['summary', 'lines'], channels: ['e', 'mod', 's', 'kind'] },
    ]
    : [{ part: 'all', include: ['summary', 'lines'], channels: undefined }];
  return parts.map(({ part, include, channels }) => {
    const { state, castUsed } = stateFor({ film, cast, scene, cues, fullCast, include });
    const questions = buildQuestions(channels ? { channels } : {});
    const body = { model: MODEL, state, questions };
    const stateTok = estTokens(state);
    const longestQ = Math.max(...Object.values(questions).map((q) => estTokens(q)));
    const est = estTokens(body);
    if (stateTok + longestQ > STATE_PLUS_QUESTION_LIMIT * 0.9) throw new Error(`${scene.id}: state ~${stateTok} tok + longest question ~${longestQ} is near the 32k limit; split the scene`);
    if (est > REQUEST_LIMIT * 0.9) throw new Error(`${scene.id}: request ~${est} tok is near the 64k limit`);
    return { part, body, castUsed, est, stateTok, reserveUsd: usd(estTokens(body, RESERVE_CHARS_PER_TOKEN)) };
  });
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

/** Raw answers of one response, grouped by channel. Throws if any asked question is missing. */
export function unpackAnswers(questions, answers) {
  const out = { pl: {}, ps: {}, m: {}, e: {}, mod: {}, s: {}, kind: null };
  for (const [k, q] of Object.entries(questions)) {
    const a = answers?.[k];
    if (!a) throw new Error(`missing answer ${k}`);
    if (k === 'kind') { out.kind = { choice: a.choice, confidence: a.confidence, probabilities: a.probabilities }; continue; }
    const [ch, id] = [k.slice(0, k.indexOf('.')), k.slice(k.indexOf('.') + 1)];
    if (q.type === 'noul') out[ch][id] = a.noul;
    else if (q.type === 'score') {
      const top = SCORES[id].levels.length - 1;
      const probs = a.probabilities;
      const mode = Object.entries(probs).sort((x, y) => y[1] - x[1])[0][0];
      out[ch][id] = { score: a.score, top, confidence: a.confidence, probabilities: probs, mode: Number(mode) };
    }
  }
  return out;
}

const mergeAnswers = (a, b) => ({
  pl: { ...a.pl, ...b.pl }, ps: { ...a.ps, ...b.ps }, m: { ...a.m, ...b.m }, e: { ...a.e, ...b.e },
  mod: { ...a.mod, ...b.mod }, s: { ...a.s, ...b.s }, kind: b.kind ?? a.kind,
});

// ---- run ---------------------------------------------------------------------------------------------

export async function run({ slug, runId = 'r1', cap = 0.25, concurrency = MAX_CONCURRENCY, limit, layout = 'single', fullCast = false, dryRun = false, post = postJev }) {
  const outDir = path.join(here, 'out');
  const segFile = path.join(outDir, `${slug}.segments.json`);
  const seg = JSON.parse(fs.readFileSync(segFile, 'utf8'));
  const srtFile = path.resolve(here, '..', 'data', `${seg.film.slug}.srt`);
  const cues = parseSrt(fs.readFileSync(srtFile, 'utf8'));
  const { partial } = checkSegments(seg, cues.length);
  const scenes = limit ? seg.scenes.slice(0, Number(limit)) : seg.scenes;
  concurrency = Math.max(1, Math.min(MAX_CONCURRENCY, Number(concurrency)));

  const allQuestions = buildQuestions();
  const qHash = crypto.createHash('sha256').update(JSON.stringify(allQuestions)).digest('hex').slice(0, 12);
  const plans = scenes.map((scene) => ({ scene, reqs: planScene({ film: seg.film, cast: seg.cast, scene, cues: cues.slice(scene.start_cue - 1, scene.end_cue), layout, fullCast }) }));

  const header = {
    film: seg.film,
    run: runId,
    model: MODEL,
    question_set: { version: VERSION, sha256_12: qHash, counts: questionCounts(allQuestions) },
    layout,
    full_cast: fullCast,
    segments_file: path.relative(here, segFile),
    segments_model: seg.model,
    partial_segments: partial,
    srt_file: path.relative(here, srtFile),
    cap_usd: cap,
    concurrency,
    price_per_mtok: PRICE_PER_MTOK,
  };

  if (dryRun) {
    const est = plans.flatMap((p) => p.reqs.map((r) => r.est));
    const reserve = plans.flatMap((p) => p.reqs.map((r) => r.reserveUsd));
    return { ...header, dry_run: true, scenes: scenes.length, requests: est.length, est_tokens_total: est.reduce((a, b) => a + b, 0), est_tokens_max: Math.max(...est), est_usd: usd(est.reduce((a, b) => a + b, 0)), worst_case_reserve_usd: reserve.reduce((a, b) => a + b, 0) };
  }

  const key = typesafeKey();
  const b = budget(cap);
  const started = Date.now();
  const results = new Array(plans.length).fill(null);
  let stopped = null;
  let next = 0;

  const worker = async () => {
    while (!stopped && next < plans.length) {
      const i = next++;
      const { scene, reqs } = plans[i];
      const row = { id: scene.id, start_cue: scene.start_cue, end_cue: scene.end_cue, start_ms: scene.start_ms, end_ms: scene.end_ms, n_lines: scene.end_cue - scene.start_cue + 1, cast_used: reqs[0].castUsed, requests: [], answers: null };
      let answers = null;
      for (const r of reqs) {
        if (!b.reserve(r.reserveUsd)) {
          stopped ??= { at_scene: scene.id, reason: `cap: spent ${b.spent.toFixed(6)} + reserved ${b.reserved.toFixed(6)} + next ${r.reserveUsd.toFixed(6)} > ${cap}` };
          row.skipped = 'cap';
          break;
        }
        const t0 = Date.now();
        let res;
        try {
          res = await post(r.body, key);
        } catch (err) {
          // An HTTP error status means the request was refused (nothing billed). A network error or
          // our own timeout abort may have reached the server and been billed, so the reservation
          // is kept as spent (an upper bound) rather than released. [v4 run-phase fix]
          const lastStatus = (err.attempts ?? []).at(-1)?.status ?? null;
          const maybeBilled = lastStatus === null;
          b.settle(r.reserveUsd, maybeBilled ? r.reserveUsd : 0);
          row.requests.push({ part: r.part, est_tokens: r.est, error: err.message, attempts: err.attempts ?? [], wall_ms: Date.now() - t0, cost_usd: maybeBilled ? r.reserveUsd : 0, cost_is_upper_bound: maybeBilled });
          row.error = err.message;
          break;
        }
        const inTok = res.json.usage?.input_tokens ?? 0;
        const cost = usd(inTok);
        b.settle(r.reserveUsd, cost);
        row.requests.push({
          part: r.part, model: res.json.model, est_tokens: r.est, est_state_tokens: r.stateTok,
          input_tokens: inTok, output_tokens: res.json.usage?.output_tokens ?? 0, cost_usd: cost,
          latency_ms: res.latencyMs, wall_ms: Date.now() - t0, retries: res.attempts.length - 1, attempts: res.attempts,
          question_count: Object.keys(r.body.questions).length,
        });
        try {
          const part = unpackAnswers(r.body.questions, res.json.answers);
          answers = answers ? mergeAnswers(answers, part) : part;
        } catch (err) {
          row.error = err.message;
          break;
        }
      }
      if (!row.error && !row.skipped) row.answers = answers;
      results[i] = row;
      const tag = row.skipped ? 'SKIP(cap)' : row.error ? `ERROR ${row.error}` : `${row.requests.reduce((s, q) => s + q.input_tokens, 0)} tok`;
      process.stderr.write(`  ${scene.id} ${tag}\n`);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, plans.length) }, worker));

  const done = results.filter((r) => r && r.answers);
  const reqs = results.filter(Boolean).flatMap((r) => r.requests);
  const inputTokens = reqs.reduce((s, r) => s + (r.input_tokens ?? 0), 0);
  const out = {
    ...header,
    run_at: new Date(started).toISOString(),
    wall_ms: Date.now() - started,
    complete: done.length === plans.length,
    stopped,
    scenes_total: plans.length,
    scenes_done: done.length,
    requests: reqs.length,
    retries: reqs.reduce((s, r) => s + (r.retries ?? 0), 0),
    retry_statuses: reqs.flatMap((r) => (r.attempts ?? []).slice(0, -1).map((a) => a.status)),
    usage: { input_tokens: inputTokens, output_tokens: reqs.reduce((s, r) => s + (r.output_tokens ?? 0), 0) },
    cost_usd: Number(b.spent.toFixed(8)),
    cost_per_scene_usd: done.length ? Number((b.spent / done.length).toFixed(8)) : null,
    tokens_per_scene: done.length ? Math.round(inputTokens / done.length) : null,
    scenes: results.map((r, i) => r ?? { id: plans[i].scene.id, skipped: stopped ? 'cap' : 'not_run' }),
  };
  const file = path.join(outDir, `${slug}.jev.${runId}.json`);
  fs.writeFileSync(file, JSON.stringify(out, null, 2));
  return { ...out, file };
}

// ---- CLI -----------------------------------------------------------------------------------------------

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = parseArgs(process.argv.slice(2));
  const slug = args._[0];
  if (!slug) {
    console.error('usage: node classify.js <slug> [--run r1] [--cap 0.25] [--concurrency 4] [--limit N] [--layout single|split] [--full-cast] [--dry-run]');
    process.exit(2);
  }
  const r = await run({
    slug,
    runId: args.run ?? 'r1',
    cap: Number(args.cap ?? 0.25),
    concurrency: Number(args.concurrency ?? MAX_CONCURRENCY),
    limit: args.limit,
    layout: args.layout ?? 'single',
    fullCast: !!args['full-cast'],
    dryRun: !!args['dry-run'],
  });
  if (r.dry_run) console.log(JSON.stringify(r, null, 2));
  else {
    console.log(`${r.file}\n  scenes ${r.scenes_done}/${r.scenes_total}${r.complete ? '' : ` (stopped: ${r.stopped?.reason ?? 'errors'})`}, requests ${r.requests}, retries ${r.retries}${r.retries ? ` [${r.retry_statuses.join(',')}]` : ''}`);
    console.log(`  input tokens ${r.usage.input_tokens} (${r.tokens_per_scene}/scene), cost $${r.cost_usd.toFixed(6)} ($${r.cost_per_scene_usd?.toFixed(6)}/scene), wall ${r.wall_ms} ms`);
    if (!r.complete) process.exitCode = 1;
  }
}
