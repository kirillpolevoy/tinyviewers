#!/usr/bin/env node
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
import { buildQuestions, questionCounts, filmItems, filmQuestions, linesState, contextState, verifiedSentences, VERSION, MODEL, SCORES } from './questions.js';

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
 * The two request bodies for one scene. Pure. When the scene has no verified summary sentence the
 * summary-channel questions (ps.*, fps.*) are not asked (they could only answer 'no').
 */
export function planScene({ seg, scene, cues, items }) {
  const ctx = contextState({ seg, scene, cues });
  const linesQ = { ...buildQuestions({ channels: ['pl', 'm'] }), ...filmQuestions(items, { channels: ['fpl'] }) };
  const ctxChannels = ctx.summaryEmpty ? ['e', 'mod', 's', 'kind'] : ['ps', 'e', 'mod', 's', 'kind'];
  const ctxQ = { ...buildQuestions({ channels: ctxChannels }), ...filmQuestions(items, { channels: ctx.summaryEmpty ? ['fe'] : ['fps', 'fe'] }) };
  const reqs = [
    { part: 'lines', body: { model: MODEL, state: linesState({ film: seg.film, cues }), questions: linesQ } },
    { part: 'context', body: { model: MODEL, state: ctx.state, questions: ctxQ } },
  ];
  for (const r of reqs) Object.assign(r, sizeRequest(r.body, `${scene.id}/${r.part}`));
  return { reqs, castUsed: ctx.castUsed, summaryEmpty: ctx.summaryEmpty, verifiedSentences: verifiedSentences(scene).length, sentences: scene.sentences?.length ?? 0 };
}

/** What v4's single-request layout would cost for the same questions (context state + everything). */
export function singleLayoutEstimate(plan) {
  const [lines, context] = plan.reqs;
  return estTokens({ model: MODEL, state: context.body.state, questions: { ...lines.body.questions, ...context.body.questions } });
}

/** Raw answers of one response by channel. Throws if an asked question is missing. */
export function unpackAnswers(questions, answers) {
  const out = {};
  for (const [k, q] of Object.entries(questions)) {
    const a = answers?.[k];
    if (!a) throw new Error(`missing answer ${k}`);
    if (k === 'kind') { out.kind = { choice: a.choice, confidence: a.confidence, probabilities: a.probabilities }; continue; }
    const ch = k.slice(0, k.indexOf('.'));
    const id = k.slice(k.indexOf('.') + 1);
    out[ch] ??= {};
    if (q.type === 'noul') out[ch][id] = a.noul;
    else if (q.type === 'score') out[ch][id] = { score: a.score, top: SCORES[id].levels.length - 1, confidence: a.confidence, probabilities: a.probabilities };
    else if (q.type === 'choice') out[ch][id] = { choice: a.choice, confidence: a.confidence, probabilities: a.probabilities };
  }
  return out;
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
  const universal = buildQuestions();
  const generated = filmQuestions(items);
  const qHash = crypto.createHash('sha256').update(JSON.stringify({ universal, generated })).digest('hex').slice(0, 12);
  const plans = scenes.map((scene) => ({ scene, ...planScene({ seg, scene, cues: cues.slice(scene.start_cue - 1, scene.end_cue), items }) }));

  const header = {
    film: seg.film,
    sources: seg.sources ?? null,
    run: runId,
    model: MODEL,
    question_set: { version: VERSION, sha256_12: qHash, counts: questionCounts({ ...universal, ...generated }), universal: Object.keys(universal).length, generated: Object.keys(generated).length },
    film_items: items,
    layout: 'two-request (lines-only + context)',
    segments_file: path.relative(here, segFile),
    segments_model: seg.model ?? null,
    fixture: seg.fixture ?? null,
    partial_segments: partial,
    segment_warnings: warnings,
    srt_file: path.relative(here, srtFile),
    cap_usd: cap,
    concurrency: Math.min(MAX_CONCURRENCY, Number(concurrency)),
    price_per_mtok: PRICE_PER_MTOK,
  };

  const perPart = (part) => plans.map((p) => p.reqs.find((r) => r.part === part).est);
  const sum = (a) => a.reduce((x, y) => x + y, 0);
  const estimate = {
    est_tokens_lines: sum(perPart('lines')),
    est_tokens_context: sum(perPart('context')),
    est_tokens_single_layout: sum(plans.map(singleLayoutEstimate)),
    worst_case_reserve_usd: sum(plans.flatMap((p) => p.reqs.map((r) => r.reserveUsd))),
  };
  estimate.est_tokens_total = estimate.est_tokens_lines + estimate.est_tokens_context;
  estimate.est_usd = usd(estimate.est_tokens_total);
  estimate.split_overhead = Number((estimate.est_tokens_total / estimate.est_tokens_single_layout - 1).toFixed(3));

  if (dryRun) return { ...header, dry_run: true, scenes: plans.length, requests: plans.length * 2, ...estimate, est_tokens_per_scene: Math.round(estimate.est_tokens_total / plans.length) };

  const b = budget(cap);
  const started = Date.now();
  const jobs = plans.flatMap((p, i) => p.reqs.map((r) => ({ body: r.body, est: r.est, reserveUsd: r.reserveUsd, meta: { i, part: r.part, label: `${p.scene.id}/${r.part}` } })));
  const { results, stopped } = await runJobs(jobs, {
    key: dryRun ? null : key('TYPESAFE_API_KEY'),
    budget: b,
    concurrency,
    ...(post ? { post } : {}),
    onSpend: () => {},
    log: (s) => process.stderr.write(`${s}\n`),
  });

  const rows = plans.map((p) => ({ id: p.scene.id, start_cue: p.scene.start_cue, end_cue: p.scene.end_cue, start_ms: p.scene.start_ms, end_ms: p.scene.end_ms, n_lines: p.scene.end_cue - p.scene.start_cue + 1, cast_used: p.castUsed, verified_sentences: p.verifiedSentences, sentences: p.sentences, summary_empty: p.summaryEmpty, requests: [], answers: null }));
  const partsByScene = rows.map(() => ({}));
  results.forEach((res, j) => {
    const { i, part } = res.meta;
    const row = rows[i];
    if (res.skipped) { row.skipped = 'cap'; return; }
    row.requests.push({ part, ...res.record });
    if (!res.ok) { row.error = res.error; return; }
    try {
      partsByScene[i][part] = unpackAnswers(jobs[j].body.questions, res.json.answers);
    } catch (err) {
      row.error = err.message;
    }
  });
  rows.forEach((row, i) => {
    if (row.error || row.skipped || !partsByScene[i].lines || !partsByScene[i].context) return;
    const a = { ...partsByScene[i].lines, ...partsByScene[i].context };
    if (plans[i].summaryEmpty) { a.ps = null; a.fps = null; }
    row.answers = a;
  });

  const done = rows.filter((r) => r.answers);
  const reqs = rows.flatMap((r) => r.requests);
  const tok = (part) => reqs.filter((r) => r.part === part).reduce((s, r) => s + (r.input_tokens ?? 0), 0);
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
    usage: { input_tokens: inputTokens, input_tokens_lines: tok('lines'), input_tokens_context: tok('context'), output_tokens: reqs.reduce((s, r) => s + (r.output_tokens ?? 0), 0) },
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
