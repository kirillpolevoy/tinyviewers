#!/usr/bin/env node
// v10: Jev asks the jev-set.js questions (the tournament-chosen phrasings, questions.js jevQuestions), each in
// its own minimal state (questions.js statesFor), plus v9's mention, modifier, Score, kind and film-presence
// questions exactly as v9 asked them. The answers are stored RAW per question key (row.answers.q); select.js
// combines them (questions.js conceptAnswers / combine.js). Sonnet answers split.json's Sonnet ids (sonnetq.js).
// (v9 text follows; its two-request layout is replaced by the per-state layout above.)
// v9: Jev asks ONLY the presence / event questions split.json assigns to it (plus every mention,
// modifier, Score, the kind Choice and the film-specific questions); Sonnet answers the rest
// (sonnetq.js) and select.js merges the two.
// v6 Jev classifier (v5's; v6 question set): every scene of out/<slug>.segments.json (segments v2 contract), TWO requests per
// scene (questions.js explains why):
//   lines   state { film:{title}, scene:{lines} }                               pl.*, m.*, fpl.*
//   context state { film, cast (present/mentioned, verified fields), dangers,
//                   scene:{setting, summary (verified sentences), lines} }       ps.*, e.*, mod.*, s.*, kind, fps.*, fe.*
//
//   node classify.js <slug> [--run r1] [--cap 0.25] [--concurrency 4] [--limit N] [--scenes S001,S004]
//                           [--dry-run]
//
// Writes out/<slug>.jev.<run>.json: RAW answers per scene (Noul probabilities; Score expected value,
// confidence, distribution; Choice distribution), the film-specific items, per-request timing, tokens,
// retries with every HTTP status, and actual spend. No tags or flags here (select.js).
//
// Money: every request reserves its worst case BEFORE dispatch (budget.js). Once a reservation would
// break --cap no further request starts and the file is written with complete:false. Actual spend is
// also appended to out/<slug>.spend.json (ledger.js). Model pinned to jev-1.13.0.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { parseSrt } from '../srt.js';
import { budget } from './budget.js';
import { key, outDir as OUT_DIR, heldOutGate } from './env.js';
import { record } from './ledger.js';
import { sizeRequest, runJobs, usd, estTokens, PRICE_PER_MTOK, MAX_CONCURRENCY } from './jev-client.js';
import { loadSplit } from './split.js';
import { buildQuestions, filmItems, filmQuestions, verifiedSentences, statesFor, jevQuestions, JEV_QUESTIONS, JEV_SET_VERSION, JEV_FIX_MODE, VERSION, MODEL, SCORES } from './questions.js';

// Small requests carry a fixed billing overhead above the JSON-length reservation (tournament pilot: 17 of
// 292 small requests billed up to 323 tokens over); every v10 reservation adds this many tokens.
export const RESERVE_FIXED_TOK = 1500;

const here = path.dirname(fileURLToPath(import.meta.url));

export function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) { args._.push(a); continue; }
    const k = a.slice(2);
    const next = argv[i + 1];
    args[k] = next !== undefined && !next.startsWith('--') ? argv[++i] : true;
  }
  return args;
}

/** Contract checks on a segments v2 file. Throws on anything classify/select cannot trust. */
export function checkSegments(seg, nCues) {
  if (!seg?.film?.slug || !Array.isArray(seg.scenes) || !seg.scenes.length || !Array.isArray(seg.cast)) throw new Error('segments: missing film.slug, cast or scenes');
  const sc = seg.scenes;
  const warnings = [];
  sc.forEach((s, i) => {
    if (!Number.isInteger(s.start_cue) || !Number.isInteger(s.end_cue) || s.start_cue > s.end_cue) throw new Error(`segments: ${s.id} bad cue range`);
    if (s.end_cue > nCues) throw new Error(`segments: ${s.id} ends at cue ${s.end_cue} but the SRT has ${nCues}`);
    if (i && s.start_cue !== sc[i - 1].end_cue + 1 && !seg.fixture?.partial) throw new Error(`segments: ${s.id} is not contiguous with ${sc[i - 1].id}`);
    if (!Array.isArray(s.sentences)) warnings.push(`${s.id}: no sentences[]; its summary is treated as empty (unverified text never reaches Jev)`);
  });
  const partial = seg.fixture?.partial === true;
  if (!partial && (sc[0].start_cue !== 1 || sc[sc.length - 1].end_cue !== nCues)) throw new Error(`segments: scenes cover ${sc[0].start_cue}-${sc[sc.length - 1].end_cue}, SRT has 1-${nCues}`);
  return { partial, warnings };
}

/**
 * v10: the request bodies for one scene. Pure. Every question is asked in its own state (questions.js
 * statesFor); questions whose states have the same content (e.g. lines with no lyric == lines) share one
 * request, split when a request would pass ~MAX_EST_PER_REQ estimated tokens.
 *   v9-kept   m.* + fpl.* on L (v9's lines state); mod.* + s.* + kind + fps.* on V9C (v9's context state)
 *   v10       every jev-set.js question (film templates once per generated item) in its state
 * A state that is null (a summary state on a scene with no verified summary) is not asked; nor are v9's
 * summary-channel questions (V:ps.*, fps.*) when the summary is empty (v9 did not ask them either).
 * Question keys never reach the model: a request's questions are q1..qN, mapped back in `back`.
 */
export const MAX_EST_PER_REQ = 40_000;
export function planScene({ seg, scene, cues, items }) {
  const { states, summaryEmpty, castUsed } = statesFor({ seg, scene, cues });
  const groups = new Map();
  const add = (state, key, q, kind) => {
    const body = states[state];
    if (!body) return;
    const h = crypto.createHash('sha256').update(JSON.stringify(body)).digest('hex');
    if (!groups.has(h)) groups.set(h, { body, names: new Set(), qs: [] });
    const g = groups.get(h); g.names.add(state); g.qs.push({ key, q, kind });
  };
  for (const [k, q] of Object.entries({ ...buildQuestions({ channels: ['m'] }), ...filmQuestions(items, { channels: ['fpl'] }) })) add('L', k, q, 'v9');
  for (const [k, q] of Object.entries({ ...buildQuestions({ channels: ['mod', 's', 'kind'] }), ...(summaryEmpty ? {} : filmQuestions(items, { channels: ['fps'] })) })) add('V9C', k, q, 'v9');
  for (const x of jevQuestions(seg, items)) {
    if (summaryEmpty && x.key.startsWith('V:ps.')) continue;
    add(x.state, x.key, x.q, 'jev');
  }
  const reqs = [];
  for (const g of groups.values()) {
    const stateTok = estTokens(g.body);
    let chunk = []; let tok = stateTok;
    const flush = () => {
      if (!chunk.length) return;
      const questions = {}; const back = {};
      chunk.forEach((c, i) => { questions[`q${i + 1}`] = c.q; back[`q${i + 1}`] = { key: c.key, kind: c.kind }; });
      const part = `${[...g.names].sort().join('+')}#${reqs.length}`;
      const body = { model: MODEL, state: g.body, questions };
      const size = sizeRequest(body, `${scene.id}/${part}`);
      reqs.push({ part, body, back, ...size, reserveUsd: usd(size.reserveTok + RESERVE_FIXED_TOK) });
      chunk = []; tok = stateTok;
    };
    for (const c of g.qs) { const t = estTokens(c.q); if (tok + t > MAX_EST_PER_REQ) flush(); chunk.push(c); tok += t; }
    flush();
  }
  return { reqs, castUsed, summaryEmpty, verifiedSentences: verifiedSentences(scene).length, sentences: scene.sentences?.length ?? 0 };
}

/** Raw answers of one response into row.answers ({ q, m, fpl, fps, mod, s, kind }). Throws if an asked question is missing. */
export function unpackAnswers(req, answers, into = {}) {
  for (const [qk, { key, kind }] of Object.entries(req.back)) {
    const a = answers?.[qk];
    if (!a) throw new Error(`missing answer ${key}`);
    const q = req.body.questions[qk];
    if (kind === 'jev') { if (typeof a.noul !== 'number') throw new Error(`no noul for ${key}`); (into.q ??= {})[key] = a.noul; continue; }
    if (key === 'kind') { into.kind = { choice: a.choice, confidence: a.confidence, probabilities: a.probabilities }; continue; }
    const ch = key.slice(0, key.indexOf('.'));
    const id = key.slice(key.indexOf('.') + 1);
    into[ch] ??= {};
    if (q.type === 'noul') into[ch][id] = a.noul;
    else if (q.type === 'score') into[ch][id] = { score: a.score, top: SCORES[id].levels.length - 1, confidence: a.confidence, probabilities: a.probabilities };
    else if (q.type === 'choice') into[ch][id] = { choice: a.choice, confidence: a.confidence, probabilities: a.probabilities };
  }
  return into;
}

export async function run({ slug, runId = 'r1', cap = 0.25, concurrency = MAX_CONCURRENCY, limit, scenesWanted, dryRun = false, post, segFile }) {
  const outDir = OUT_DIR();
  segFile ??= path.join(outDir, `${slug}.segments.json`);
  const seg = JSON.parse(fs.readFileSync(segFile, 'utf8'));
  const srtFile = path.resolve(here, '..', 'data', `${seg.film.slug}.srt`);
  const cues = parseSrt(fs.readFileSync(srtFile, 'utf8'));
  const { partial, warnings } = checkSegments(seg, cues.length);
  let scenes = seg.scenes;
  if (scenesWanted) scenes = scenes.filter((s) => scenesWanted.includes(s.id));
  if (limit) scenes = scenes.slice(0, Number(limit));

  const items = filmItems(seg);
  const split = loadSplit();
  const jevQs = jevQuestions(seg, items);
  const qHash = crypto.createHash('sha256').update(JSON.stringify({ jev: jevQs, v9: buildQuestions({ channels: ['m', 'mod', 's', 'kind'] }), film: filmQuestions(items, { channels: ['fpl', 'fps'] }) })).digest('hex').slice(0, 12);
  const plans = scenes.map((scene) => ({ scene, ...planScene({ seg, scene, cues: cues.slice(scene.start_cue - 1, scene.end_cue), items }) }));

  const header = {
    film: seg.film,
    sources: seg.sources ?? null,
    run: runId,
    model: MODEL,
    question_set: { version: VERSION, jev_set: JEV_SET_VERSION, jev_set_fix_mode: JEV_FIX_MODE, sha256_12: qHash, jev_questions: jevQs.length, jev_questions_universal: Object.keys(JEV_QUESTIONS).filter((k) => !k.includes('{item}')).length },
    film_items: items,
    layout: 'v10: one request per distinct minimal state (questions.js statesFor) + v9 lines / context requests for the v9-kept questions',
    split: { file: 'split.json', sha256_12: split.sha256_12, sonnet_used: split.sonnet_used },
    segments_file: path.relative(here, segFile),
    segments_model: seg.model ?? null,
    fixture: seg.fixture ?? null,
    partial_segments: partial,
    segment_warnings: warnings,
    srt_file: path.relative(here, srtFile),
    cap_usd: cap,
    concurrency: Math.min(MAX_CONCURRENCY, Number(concurrency)),
    price_per_mtok: PRICE_PER_MTOK,
    reserve_fixed_tokens: RESERVE_FIXED_TOK,
  };

  const sum = (a) => a.reduce((x, y) => x + y, 0);
  const allReqs = plans.flatMap((p) => p.reqs);
  const estimate = {
    requests: allReqs.length,
    est_tokens_total: sum(allReqs.map((r) => r.est)),
    worst_case_reserve_usd: sum(allReqs.map((r) => r.reserveUsd)),
  };
  estimate.est_usd = usd(estimate.est_tokens_total);

  if (dryRun) return { ...header, dry_run: true, scenes: plans.length, ...estimate, est_tokens_per_scene: Math.round(estimate.est_tokens_total / plans.length) };

  const b = budget(cap);
  const started = Date.now();
  const jobs = plans.flatMap((p, i) => p.reqs.map((r) => ({ body: r.body, est: r.est, reserveUsd: r.reserveUsd, req: r, meta: { i, part: r.part, label: `${p.scene.id}/${r.part}` } })));
  const { results, stopped } = await runJobs(jobs, {
    key: dryRun ? null : key('TYPESAFE_API_KEY'),
    budget: b,
    concurrency,
    ...(post ? { post } : {}),
    onSpend: () => {},
    log: (s) => process.stderr.write(`${s}\n`),
  });

  const rows = plans.map((p) => ({ id: p.scene.id, start_cue: p.scene.start_cue, end_cue: p.scene.end_cue, start_ms: p.scene.start_ms, end_ms: p.scene.end_ms, n_lines: p.scene.end_cue - p.scene.start_cue + 1, cast_used: p.castUsed, verified_sentences: p.verifiedSentences, sentences: p.sentences, summary_empty: p.summaryEmpty, requests: [], answers: null }));
  const into = rows.map(() => ({ q: {} }));
  const got = rows.map(() => 0);
  results.forEach((res, j) => {
    const { i, part } = res.meta;
    const row = rows[i];
    if (res.skipped) { row.skipped = 'cap'; return; }
    row.requests.push({ part, ...res.record });
    if (!res.ok) { row.error = res.error; return; }
    try { unpackAnswers(jobs[j].req, res.json.answers, into[i]); got[i] += 1; } catch (err) { row.error = err.message; }
  });
  rows.forEach((row, i) => {
    if (row.error || row.skipped || got[i] !== plans[i].reqs.length) return;
    const a = into[i];
    if (plans[i].summaryEmpty) a.fps = null;
    row.answers = a;
  });

  const done = rows.filter((r) => r.answers);
  const reqs = rows.flatMap((r) => r.requests);
  const inputTokens = reqs.reduce((s, r) => s + (r.input_tokens ?? 0), 0);
  if (b.spent > 0) record(slug, { script: 'classify.js', kind: 'jev', usd: b.spent, note: `run ${runId}, ${done.length} scenes, ${reqs.length} requests` });
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
    estimate,
    usage: { input_tokens: inputTokens, output_tokens: reqs.reduce((s, r) => s + (r.output_tokens ?? 0), 0) },
    cost_usd: Number(b.spent.toFixed(8)),
    cost_per_scene_usd: done.length ? Number((b.spent / done.length).toFixed(8)) : null,
    tokens_per_scene: done.length ? Math.round(inputTokens / done.length) : null,
    scenes: rows,
  };
  fs.mkdirSync(outDir, { recursive: true });
  const file = path.join(outDir, `${slug}.jev.${runId}.json`);
  fs.writeFileSync(file, JSON.stringify(out, null, 2));
  return { ...out, file };
}

// ---- CLI -----------------------------------------------------------------------------------------------

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = parseArgs(process.argv.slice(2));
  const slug = args._[0];
  if (slug) heldOutGate(slug);
  if (!slug) {
    console.error('usage: node classify.js <slug> [--run r1] [--cap 0.25] [--concurrency 4] [--limit N] [--scenes S001,S002] [--dry-run]');
    process.exit(2);
  }
  const r = await run({
    slug,
    runId: args.run ?? 'r1',
    cap: Number(args.cap ?? 0.25),
    concurrency: Number(args.concurrency ?? MAX_CONCURRENCY),
    limit: args.limit,
    scenesWanted: typeof args.scenes === 'string' ? args.scenes.split(',') : null,
    dryRun: !!args['dry-run'],
    segFile: typeof args.segments === 'string' ? path.resolve(args.segments) : undefined,
  });
  if (r.dry_run) {
    const { film_items: fi, ...rest } = r;
    console.log(JSON.stringify({ ...rest, film_items: fi.map((x) => x.id) }, null, 2));
  } else {
    console.log(`${r.file}\n  scenes ${r.scenes_done}/${r.scenes_total}${r.complete ? '' : ` (stopped: ${r.stopped?.reason ?? 'errors'})`}, requests ${r.requests}, retries ${r.retries}${r.retries ? ` [${r.retry_statuses.join(',')}]` : ''}`);
    console.log(`  questions: universal ${r.question_set.universal}, generated ${r.question_set.generated}`);
    console.log(`  input tokens ${r.usage.input_tokens} (lines ${r.usage.input_tokens_lines}, context ${r.usage.input_tokens_context}; ${r.tokens_per_scene}/scene), cost $${r.cost_usd.toFixed(6)} ($${r.cost_per_scene_usd?.toFixed(6)}/scene), wall ${r.wall_ms} ms`);
    if (!r.complete) process.exitCode = 1;
  }
}
