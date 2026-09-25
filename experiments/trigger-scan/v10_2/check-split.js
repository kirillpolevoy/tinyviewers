#!/usr/bin/env node
// v7 step 1b: JEV AS THE SEGMENTATION VALIDATOR, plus the code checks (gate.js explains both).
// segment.js calls runSplitCheck() on every attempt and retries once when the gate fails. This CLI
// runs the same gate on a saved model segmentation (e.g. round 2's) and can fold the verdicts into a
// segments file.
//
//   node check-split.js <slug> --raw <segments.raw.json> [--label r2] [--cap 0.03] [--concurrency 4]
//                       [--fold <segments.json>] [--no-jev] [--reuse <splitcheck.json>] [--final-held-out-run]
// --reuse: no calls; take the verdicts of an earlier check of the same raw file (e.g. to --fold them).
//
// --raw: a model segmentation: a v6 segments.raw.json ({data:{scenes}}) or a v7 one ({attempts:[..]},
//        the accepted attempt is used). Writes <out>/<slug>.splitcheck.<label>.json (verdicts and
//        numbers only, no text). --fold also writes the verdicts into that segments file (scenes are
//        matched by cue range; the file must hold the same segmentation).
//
// Requests (jev-1.13.0): one alignment request per scene with sentences (a Choice per sentence), one
// Noul per boundary, one Noul per probe. Every request reserves its worst case before dispatch
// (3.0 x the estimate, as for moments: Choice/Noul requests over short states bill far above their
// JSON length); --cap is per film for this script across reruns (ledger).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSrt } from '../srt.js';
import { budget } from './budget.js';
import { key, outDir, heldOutGate, sourcesFile, V8, TS } from './env.js';
import { readLedger, record } from './ledger.js';
import { sizeRequest, runJobs, MAX_CONCURRENCY } from './jev-client.js';
import { creditsSpan } from './credits.js';
import { codeMetrics, gateResult, alignmentBody, boundaryBody, boundaryWindow, probePositions, alignVerdict, boundaryVerdict, jevMetrics, lineText, SPLIT_VERSION, MODEL } from './gate.js';

const here = path.dirname(fileURLToPath(import.meta.url));
export const RESERVE_X_EST = 3.0;

/** v10.1: the end-credits span the gate excludes from max_scene_minutes (split_gate.exclude_credits), or null. */
export const creditsFor = (cues, cfg) => (cfg.exclude_credits ? creditsSpan(cues, cfg.credits ?? {}) : null);
const r3 = (x) => Math.round(x * 1000) / 1000;

/** The split_gate section of policy.json. */
export const loadGateCfg = (file = path.join(here, 'policy.json')) => { const p = JSON.parse(fs.readFileSync(file, 'utf8')); return { ...p.split_gate, credits: p.credits }; };

/** Scene ids for a covered list. */
export const withIds = (scenes) => scenes.map((s, i) => ({ ...s, id: s.id ?? `S${String(i + 1).padStart(3, '0')}` }));

/**
 * Plan every Jev request for one segmentation. scenes: [{id, start_cue, end_cue, sentences:[{text}]}].
 * Returns jobs for jev-client runJobs.
 */
export function planSplitCheck({ film, scenes, cues, cfg }) {
  const jobs = [];
  const job = (kind, meta, body) => {
    const sz = sizeRequest(body, `${kind}:${meta.id}`, { reserveXEst: RESERVE_X_EST });
    jobs.push({ body, est: sz.est, reserveUsd: sz.reserveUsd, meta: { kind, label: `${kind}:${meta.id}`, ...meta } });
  };
  for (const s of scenes) {
    const sentences = (s.sentences ?? []).map((x) => String(x.text ?? '').trim()).filter(Boolean);
    if (!sentences.length) continue;
    const lines = cues.slice(s.start_cue - 1, s.end_cue).map(lineText);
    job('align', { id: s.id, scene: s.id, n: sentences.length }, alignmentBody({ film, lines, sentences }));
  }
  scenes.slice(1).forEach((s) => job('boundary', { id: `${s.id}@L${s.start_cue}`, scene: s.id, at: s.start_cue }, boundaryBody({ film, window: boundaryWindow(cues, s.start_cue, cfg.window_lines), at: s.start_cue })));
  for (const p of probePositions(scenes, cues, cfg.probe)) job('probe', { id: `${p.scene}@L${p.at}`, scene: p.scene, at: p.at, gap_ms: p.gap_ms }, boundaryBody({ film, window: boundaryWindow(cues, p.at, cfg.window_lines), at: p.at }));
  return jobs;
}

/**
 * Run the Jev layer for one segmentation. Returns { metrics, alignment, boundaries, probes, run }.
 * `post` can be injected (tests); `wallet` is a budget.js budget.
 */
export async function runSplitCheck({ film, scenes, cues, cfg, wallet, post, log = () => {}, concurrency = MAX_CONCURRENCY }) {
  const jobs = planSplitCheck({ film, scenes, cues, cfg });
  const started = Date.now();
  const { results, stopped } = jobs.length
    ? await runJobs(jobs, { key: post ? 'test' : key('TYPESAFE_API_KEY'), budget: wallet, concurrency, ...(post ? { post } : {}), log })
    : { results: [], stopped: null };
  const wallMs = Date.now() - started;
  const failed = results.filter((r) => !r.ok);
  if (failed.length) throw Object.assign(new Error(`split check: ${failed.length}/${jobs.length} requests failed (${failed[0].skipped ?? failed[0].error})${stopped ? `; ${stopped.reason}` : ''}`), { results });
  const alignment = []; const boundaries = []; const probes = [];
  for (const r of results) {
    const m = r.meta;
    if (m.kind === 'align') alignment.push({ scene: m.scene, sentences: Array.from({ length: m.n }, (_, k) => ({ k, ...alignVerdict(r.json.answers?.[`a${k}`], cfg) })) });
    else {
      const p = r3(Number(r.json.answers?.boundary?.noul));
      if (!Number.isFinite(p)) throw new Error(`${m.label}: no noul answer`);
      (m.kind === 'boundary' ? boundaries : probes).push({ scene: m.scene, at: m.at, p, ...(m.gap_ms != null ? { gap_ms: m.gap_ms } : {}), ...(m.kind === 'boundary' ? { verdict: boundaryVerdict(p, cfg) } : { split_candidate: p >= cfg.split_at }) });
    }
  }
  const byScene = (a, b) => a.scene.localeCompare(b.scene) || (a.at ?? 0) - (b.at ?? 0);
  alignment.sort(byScene); boundaries.sort(byScene); probes.sort(byScene);
  const recs = results.map((r) => r.record);
  const lat = recs.map((x) => x.latency_ms).sort((a, b) => a - b);
  const filmMinutes = cues[cues.length - 1].endMs / 60000;
  return {
    metrics: jevMetrics({ alignment, boundaries, probes }, filmMinutes, cfg),
    alignment, boundaries, probes,
    run: {
      model: MODEL, requests: recs.length, by_kind: Object.fromEntries(['align', 'boundary', 'probe'].map((k) => [k, jobs.filter((j) => j.meta.kind === k).length])),
      input_tokens: recs.reduce((a, x) => a + x.input_tokens, 0), cost_usd: +recs.reduce((a, x) => a + x.cost_usd, 0).toFixed(6),
      reserved_usd_total: +jobs.reduce((a, j) => a + j.reserveUsd, 0).toFixed(6), over_reserve: recs.filter((x) => x.over_reserve).length,
      wall_ms: wallMs, latency_ms: { median: lat[Math.floor(lat.length / 2)] ?? null, p95: lat[Math.floor(0.95 * (lat.length - 1))] ?? null, max: lat.at(-1) ?? null }, retries: recs.reduce((a, x) => a + x.retries, 0), concurrency,
    },
  };
}

/** Code checks + Jev layer + verdict for one model segmentation. */
export async function checkSegmentation({ film, modelScenes, cues, ctx, cfg, wallet, post, log, skipJev = false }) {
  const { metrics: code, covered } = codeMetrics(modelScenes, cues, { ...ctx, credits: creditsFor(cues, cfg) });
  const scenes = withIds(covered);
  const jev = skipJev ? null : await runSplitCheck({ film, scenes, cues, cfg, wallet, post, log });
  const gate = gateResult(code, jev?.metrics ?? null, cfg);
  return { version: SPLIT_VERSION, pass: gate.pass, failed: gate.failed, code: { metrics: code, rows: gate.code }, jev: jev ? { metrics: jev.metrics, rows: gate.jev, run: jev.run, alignment: jev.alignment, boundaries: jev.boundaries, probes: jev.probes } : null, scenes: scenes.map((s) => ({ id: s.id, start_cue: s.start_cue, end_cue: s.end_cue })) };
}

/** Per-scene view of a check for the segments file: alignment, the boundary before it, its probes. */
export function perScene(check) {
  const out = {};
  for (const s of check.scenes) out[s.id] = { start_cue: s.start_cue, end_cue: s.end_cue };
  for (const a of check.jev?.alignment ?? []) out[a.scene].alignment = { sentences: a.sentences.map(({ k, choice, p_supports, p_contradicts, supported }) => ({ k, choice, p_supports, p_contradicts, supported })), supported: a.sentences.filter((x) => x.supported).length, of: a.sentences.length };
  for (const b of check.jev?.boundaries ?? []) out[b.scene].boundary_before = { at: `L${b.at}`, p: b.p, verdict: b.verdict };
  for (const p of check.jev?.probes ?? []) (out[p.scene].probes ??= []).push({ at: `L${p.at}`, p: p.p, gap_s: r3(p.gap_ms / 1000), split_candidate: p.split_candidate });
  return out;
}

/** Fold a check into a segments object (scenes matched by cue range). Returns the number matched. */
export function foldIntoSegments(seg, check, extra = {}) {
  const view = perScene(check);
  const byRange = new Map(Object.entries(view).map(([id, v]) => [`${v.start_cue}-${v.end_cue}`, { id, ...v }]));
  let matched = 0;
  for (const s of seg.scenes) {
    const v = byRange.get(`${s.start_cue}-${s.end_cue}`);
    if (!v) continue;
    matched++;
    const { id, start_cue, end_cue, ...rest } = v;
    s.split_check = { checked_as: id, ...rest };
  }
  if (matched !== seg.scenes.length) throw new Error(`fold: only ${matched}/${seg.scenes.length} scenes match the checked segmentation`);
  const { scenes, ...summary } = check;
  seg.split_check = { ...summary, jev: summary.jev ? { metrics: summary.jev.metrics, rows: summary.jev.rows, run: summary.jev.run } : null, ...extra };
  return matched;
}

/** The accepted model scenes of a raw segmentation file (v6 {data} or v7 {attempts}). */
export function modelScenesOf(raw) {
  if (raw.data?.scenes) return raw.data.scenes;
  const acc = (raw.attempts ?? []).find((a) => a.accepted) ?? raw.attempts?.at(-1);
  if (!acc?.scenes) throw new Error('raw file has neither data.scenes nor attempts[].scenes');
  return acc.scenes;
}

// ---- CLI -------------------------------------------------------------------------------------------
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2);
  const slug = argv.find((a) => !a.startsWith('--') && !argv[argv.indexOf(a) - 1]?.startsWith('--'));
  const opt = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d; };
  const rawFile = opt('raw', null);
  if (!slug || !rawFile) { console.error('usage: node check-split.js <slug> --raw <segments.raw.json> [--label r2] [--cap 0.03] [--fold <segments.json>] [--no-jev]'); process.exit(2); }
  heldOutGate(slug);
  const cfg = loadGateCfg();
  const CAP = Number(opt('cap', '0.03'));
  const label = opt('label', 'check');
  const raw = JSON.parse(fs.readFileSync(path.resolve(rawFile), 'utf8'));
  const cues = parseSrt(fs.readFileSync(path.join(TS, 'data', `${slug}.srt`), 'utf8'));
  const SRC = JSON.parse(fs.readFileSync(sourcesFile(slug), 'utf8'));
  const film = { slug, title: SRC.film.title };
  const prior = readLedger(slug).entries.filter((e) => e.script === 'check-split.js').reduce((a, e) => a + e.usd, 0);
  const wallet = budget(CAP - prior);
  let check;
  const reuse = opt('reuse', null);
  if (reuse) {
    const prev = JSON.parse(fs.readFileSync(path.resolve(reuse), 'utf8'));
    if (prev.raw_file !== path.relative(V8, path.resolve(rawFile))) throw new Error(`--reuse ${reuse} checked ${prev.raw_file}, not ${rawFile}`);
    // no Jev calls: the saved Jev verdicts; code metrics and the gate recomputed with the current code and policy
    const { metrics: codeM, covered } = codeMetrics(modelScenesOf(raw), cues, { wCount: SRC.wikipedia.sentences.length, tCount: SRC.tmdb.cast.length, credits: creditsFor(cues, cfg) });
    const g = gateResult(codeM, prev.jev?.metrics ?? null, cfg);
    check = { version: prev.version, pass: g.pass, failed: g.failed, code: { metrics: codeM, rows: g.code }, jev: prev.jev ? { ...prev.jev, rows: g.jev } : null, scenes: withIds(covered).map((s) => ({ id: s.id, start_cue: s.start_cue, end_cue: s.end_cue })) };
  } else try {
    check = await checkSegmentation({ film, modelScenes: modelScenesOf(raw), cues, ctx: { wCount: SRC.wikipedia.sentences.length, tCount: SRC.tmdb.cast.length }, cfg, wallet, skipJev: argv.includes('--no-jev'), log: () => {} });
  } finally {
    if (wallet.spent > 0) record(slug, { script: 'check-split.js', kind: 'jev', usd: wallet.spent, note: `${SPLIT_VERSION} ${label} on ${path.relative(V8, path.resolve(rawFile))}` });
  }
  const file = path.join(outDir(), `${slug}.splitcheck.${label}.json`);
  fs.writeFileSync(file, JSON.stringify({ film, label, raw_file: path.relative(V8, path.resolve(rawFile)), checked_at: new Date().toISOString(), ...(reuse ? { jev_reused_from: path.relative(V8, path.resolve(reuse)) } : {}), gate_cfg: cfg, ...check }, null, 2));
  const c = check.code.metrics;
  console.log(`${slug} [${label}] gate ${check.pass ? 'PASS' : 'FAIL'}${check.failed.length ? `: ${check.failed.join('; ')}` : ''}`);
  console.log(`  code: ${c.scenes} scenes (model ${c.model_scenes}), ${c.scenes_per_10_min}/10 min, max ${c.max_scene_minutes} min; cited outside ${c.cited_outside}/${c.line_cites} = ${c.cited_outside_share}; overshoot ${c.overshoot_cues}; repaired ${c.repaired_cues} (${c.repaired_share}); dropped ${c.sentences_dropped}/${c.sentences}`);
  if (check.jev) {
    const j = check.jev.metrics; const r = check.jev.run;
    console.log(`  jev: aligned ${j.sentences_supported}/${j.sentences_asked} = ${j.aligned_share}, unaligned scenes ${j.scenes_unaligned.length}/${j.scenes_asked}; boundary AUC ${j.boundary_auc} (mean p boundary ${j.mean_boundary_p} vs probe ${j.mean_probe_p}); boundaries confirmed ${j.boundaries_confirmed}/${j.boundaries} = ${j.boundary_confirmed_share}, merge candidates ${j.merge_candidates.length} (${j.merge_candidate_share}); probes ${j.probes}, split candidates ${j.split_candidates.length} (${j.split_candidates_per_hour}/h)`);
    console.log(`  jev run: ${r.requests} requests (${JSON.stringify(r.by_kind)}), ${r.input_tokens} tok, $${r.cost_usd}, wall ${(r.wall_ms / 1000).toFixed(1)} s, latency median ${r.latency_ms.median} ms p95 ${r.latency_ms.p95} ms, retries ${r.retries}, over-reserve ${r.over_reserve}`);
  }
  const fold = opt('fold', null);
  if (fold) {
    const seg = JSON.parse(fs.readFileSync(path.resolve(fold), 'utf8'));
    const n = foldIntoSegments(seg, check, { label, raw_file: path.relative(V8, path.resolve(rawFile)), checked_at: new Date().toISOString() });
    fs.writeFileSync(path.resolve(fold), JSON.stringify(seg, null, 2));
    console.log(`  folded into ${path.relative(V8, path.resolve(fold))} (${n} scenes)`);
  }
  console.log(`  -> ${path.relative(TS, file)}`);
}
