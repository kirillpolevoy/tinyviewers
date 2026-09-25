#!/usr/bin/env node
// v9 SONNET QUESTION PASS: every scene of out/<slug>.segments.json, the questions split.json gives Sonnet
// (sonnet_asked = the used ones + the shadow ones; sonnet-questions.js explains both), several
// consecutive scenes per call.
//
//   node sonnetq.js <slug> [--run r1] [--cap 0.25] [--scene-chars 24000] [--max-scenes 20]
//                          [--concurrency 3] [--resume] [--dry] [--final-held-out-run]
// --resume keeps a previous run's answered scenes and asks only the unanswered ones (e.g. after a cap stop).
//
// Per call: system (sonnet-questions.js SYSTEM), the question block, then each scene's verified state
// (the same state Jev's context request sees: setting, verified summary, verified cast notes of the
// characters in it, verified film dangers, numbered lines). Strict JSON schema; typed answers
// { q, a: yes|no, c: high|medium|low } listed per scene; unlisted = confident no (P_UNLISTED).
// A scene the model leaves out is re-asked ONCE in a follow-up call with the other left-out scenes;
// still missing -> recorded as missing (select.js then falls back to Jev's answer for that scene, when
// Jev asked the question, else no tag).
//
// Money: before each call the input is counted (free count_tokens endpoint; a 2.5 chars/token
// estimate if unavailable) + a 2,500-token schema margin, and the worst case (that input + max_tokens
// of output) is reserved against --cap minus this script's earlier spend on this film (ledger). A
// reservation that would break the cap stops the pass (complete:false, exit 1).
// Writes out/<slug>.sonnetq.<run>.json (answers, per-call usage, cost). Model text is typed enums only.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSrt } from '../srt.js';
import { callClaude, countTokens, costUsd, PRICES } from './sonnet.js';
import { budget } from './budget.js';
import { outDir, heldOutGate } from './env.js';
import { readLedger, record } from './ledger.js';
import { SYSTEM, userPrompt, schemaFor, parseAnswers, sceneView, checkIds, promptHash, SONNET_MODEL, SONNET_Q_VERSION, P_MAP, P_UNLISTED } from './sonnet-questions.js';
import { loadSplit } from './split.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = 'sonnetq.js';

/** Consecutive batches with at most maxChars of scene text and maxScenes scenes each. */
export function batchScenes(views, { maxChars = 24000, maxScenes = 20 } = {}) {
  const out = []; let cur = []; let chars = 0;
  for (const v of views) {
    const c = JSON.stringify(v).length;
    if (cur.length && (chars + c > maxChars || cur.length >= maxScenes)) { out.push(cur); cur = []; chars = 0; }
    cur.push(v); chars += c;
  }
  if (cur.length) out.push(cur);
  return out;
}

export async function run({ slug, runId = 'r1', cap = 0.25, maxChars = 24000, maxScenes = 20, concurrency = 3, dry = false, effort = 'low', resume = false }) {
  const OUT = outDir();
  const seg = JSON.parse(fs.readFileSync(path.join(OUT, `${slug}.segments.json`), 'utf8'));
  const cues = parseSrt(fs.readFileSync(path.resolve(here, '..', 'data', `${seg.film.slug}.srt`), 'utf8'));
  const split = loadSplit();
  const ids = split.sonnet_asked;
  checkIds(ids);
  const views = seg.scenes.map((scene) => sceneView({ seg, scene, cues: cues.slice(scene.start_cue - 1, scene.end_cue) }));
  const batches = batchScenes(views, { maxChars, maxScenes });
  const film = { title: seg.film.title, year: seg.film.year };
  const [pIn, pOut] = PRICES[SONNET_MODEL];
  const prior = readLedger(slug).entries.filter((e) => e.script === SCRIPT && e.kind === 'sonnet').reduce((a, e) => a + e.usd, 0);
  const wallet = budget(Math.max(0, cap - prior));
  const maxTokensFor = (n) => Math.min(8000, 500 + n * 160); // ~60 tok/scene observed; 2.5x headroom
  console.log(`${slug}: ${views.length} scenes in ${batches.length} calls; ${ids.length} questions (${split.sonnet_used.length} used, ${ids.length - split.sonnet_used.length} shadow); cap $${cap} (spent before $${prior.toFixed(4)})`);

  const calls = [];
  const answers = {};
  let stopped = null;
  let inflight = 0;
  // --resume: keep a previous run's answered scenes and ask only the rest (same prompt, same questions)
  const file = path.join(OUT, `${slug}.sonnetq.${runId}.json`);
  let prev = null;
  if (resume && fs.existsSync(file)) {
    prev = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (JSON.stringify(prev.split?.sonnet_asked) !== JSON.stringify(ids)) throw new Error('--resume: the previous run asked a different question list');
    for (const [id, row] of Object.entries(prev.scenes)) if (row) answers[id] = row;
    calls.push(...prev.calls.filter((c) => !c.skipped));
  }
  const todo = views.filter((v) => !answers[v.id]);
  const batchesTodo = prev ? batchScenes(todo, { maxChars, maxScenes }) : batches;
  const doCall = async (scenes, label) => {
    const sceneIds = scenes.map((s) => s.id);
    const user = userPrompt({ film, scenes, ids });
    const schema = schemaFor(sceneIds, ids);
    const counted = dry ? null : await countTokens({ model: SONNET_MODEL, system: SYSTEM, user });
    const inWorst = (counted ?? Math.ceil((SYSTEM.length + user.length) / 2.5)) + 2500;
    const maxTokens = maxTokensFor(scenes.length);
    const worst = (inWorst * pIn + maxTokens * pOut) / 1e6;
    const row = { label, scenes: sceneIds, counted_input: counted, reserved_usd: +worst.toFixed(6), max_tokens: maxTokens };
    calls.push(row);
    if (dry) return row;
    // a refused reservation waits while other calls are in flight (their reservations settle below
    // their worst case); it stops the pass only when nothing is in flight
    while (!stopped && !wallet.reserve(worst)) {
      if (inflight === 0) { stopped = `cap: spent ${wallet.spent.toFixed(4)} + reserved ${wallet.reserved.toFixed(4)} + next ${worst.toFixed(4)} > ${wallet.cap.toFixed(4)}`; break; }
      await new Promise((r) => setTimeout(r, 500));
    }
    if (stopped) { row.skipped = 'cap'; return row; }
    inflight++;
    let cost = worst;
    try {
      const r = await callClaude({ model: SONNET_MODEL, system: SYSTEM, user, schema, maxTokens, effort });
      cost = costUsd(SONNET_MODEL, r.usage);
      const parsed = parseAnswers(r.data, sceneIds, ids);
      Object.assign(answers, parsed.answers);
      Object.assign(row, { usage: r.usage, cost_usd: +cost.toFixed(6), latency_ms: r.latencyMs, missing: parsed.missing, problems: parsed.problems, listed: Object.values(parsed.answers).reduce((a, x) => a + Object.keys(x).length, 0) });
      console.log(`  ${label} ${sceneIds[0]}..${sceneIds.at(-1)} (${sceneIds.length}) in ${r.usage.input_tokens} out ${r.usage.output_tokens} $${cost.toFixed(4)}${parsed.missing.length ? ` MISSING ${parsed.missing.join(',')}` : ''}${parsed.problems.length ? ` problems ${parsed.problems.length}` : ''}`);
    } catch (err) {
      cost = err.rejected ? 0 : err.usage && Object.keys(err.usage).length ? costUsd(SONNET_MODEL, err.usage) : worst;
      Object.assign(row, { error: err.message, cost_usd: +cost.toFixed(6) });
      console.log(`  ${label} ERROR ${err.message.slice(0, 200)}`);
    } finally {
      inflight--;
      wallet.settle(worst, cost);
      if (cost > 0) record(slug, { script: SCRIPT, kind: 'sonnet', usd: cost, note: `${SONNET_Q_VERSION} ${label} ${sceneIds.length} scenes` });
    }
    return row;
  };

  const started = Date.now();
  let next = 0;
  await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, batchesTodo.length)) }, async () => {
    while (next < batchesTodo.length) { const i = next++; await doCall(batchesTodo[i], `${prev ? 'resume-' : ''}b${String(i + 1).padStart(2, '0')}`); }
  }));
  if (dry) {
    const worst = calls.reduce((a, c) => a + c.reserved_usd, 0);
    console.log(`  dry: ${calls.length} calls, worst case $${worst.toFixed(4)} (est. input ~${Math.round(views.reduce((a, v) => a + JSON.stringify(v).length, 0) / 3.6)} tok of scenes)`);
    return { dry: true, calls, worst_usd: worst };
  }
  // one retry for left-out scenes (not for cap-skipped ones)
  const left = views.filter((v) => !answers[v.id] && !calls.some((c) => c.skipped && c.scenes.includes(v.id)));
  if (left.length && !stopped) for (const [k, b] of batchScenes(left, { maxChars, maxScenes }).entries()) await doCall(b, `retry${k + 1}`);

  const missing = views.filter((v) => !answers[v.id]).map((v) => v.id);
  const spent = calls.reduce((a, c) => a + (c.cost_usd ?? 0), 0);
  const out = {
    film: seg.film, run: runId, version: SONNET_Q_VERSION, model: SONNET_MODEL, effort,
    split: { file: 'split.json', sha256_12: split.sha256_12, sonnet_asked: ids, sonnet_used: split.sonnet_used },
    prompt_sha256_12: promptHash(ids),
    ...(prev ? { resumed_from: prev.run_at } : {}),
    p_map: P_MAP, p_unlisted: P_UNLISTED,
    run_at: new Date(started).toISOString(), wall_ms: Date.now() - started,
    complete: missing.length === 0 && !stopped, stopped, missing,
    calls, cost_usd: +spent.toFixed(6),
    usage: { input_tokens: calls.reduce((a, c) => a + (c.usage?.input_tokens ?? 0), 0), output_tokens: calls.reduce((a, c) => a + (c.usage?.output_tokens ?? 0), 0) },
    scenes: Object.fromEntries(views.map((v) => [v.id, answers[v.id] ?? null])),
  };
  fs.writeFileSync(file, JSON.stringify(out, null, 2));
  console.log(`${file}\n  ${views.length - missing.length}/${views.length} scenes answered, ${calls.length} calls, $${spent.toFixed(4)}; in ${out.usage.input_tokens} out ${out.usage.output_tokens} tok${missing.length ? `; MISSING ${missing.join(',')}` : ''}${stopped ? `; STOPPED ${stopped}` : ''}`);
  return out;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2);
  const slug = argv.find((a) => !a.startsWith('--') && !argv[argv.indexOf(a) - 1]?.startsWith('--'));
  const opt = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
  if (!slug) { console.error('usage: node sonnetq.js <slug> [--run r1] [--cap 0.25] [--dry]'); process.exit(2); }
  heldOutGate(slug);
  const r = await run({ slug, runId: opt('run', 'r1'), cap: Number(opt('cap', '0.25')), maxChars: Number(opt('scene-chars', '24000')), maxScenes: Number(opt('max-scenes', '20')), concurrency: Number(opt('concurrency', '3')), dry: argv.includes('--dry'), effort: opt('effort', 'low'), resume: argv.includes('--resume') });
  if (!r.dry && !r.complete) process.exitCode = 1;
}
