// Scores every run in runs/ against gold.json and writes results.json (input to build-report.js).
// Everything is on the SDH track's timeline; runs on the db track are shifted by the measured offset.
import fs from 'node:fs';
import path from 'node:path';
import { CATEGORIES, CATEGORY_IDS } from './taxonomy.js';
import { here, loadTrack } from './common.js';
import { windowsToScenes, DEFAULT_POLICY } from './events.js';
import { formatTime } from './srt.js';

const TOLERANCE_MS = 15_000; // a prediction this close to a gold scene still counts as finding it
const CORE = CATEGORIES.filter((c) => !c.inferred).map((c) => c.id);

const sdh = loadTrack('sdh');
const db = loadTrack('db');
const cueById = new Map(sdh.cues.map((c) => [c.id, c]));

// Median start-time difference between identical long lines in the two tracks.
function trackOffsetMs() {
  const norm = (s) => s.toLowerCase().replace(/[^a-z ]/g, '').trim();
  const index = new Map();
  for (const c of db.cues) {
    const k = norm(c.text);
    if (k.length > 25) index.set(k, index.has(k) ? null : c);
  }
  const diffs = sdh.cues.map((c) => [c, index.get(norm(c.text))]).filter(([, m]) => m).map(([c, m]) => c.startMs - m.startMs).sort((a, b) => a - b);
  return { offsetMs: diffs[Math.floor(diffs.length / 2)], matchedLines: diffs.length };
}
const { offsetMs, matchedLines } = trackOffsetMs();

const gold = JSON.parse(fs.readFileSync(path.join(here, 'gold.json'), 'utf8')).map((g) => {
  const start = cueById.get(g.start_cue);
  const end = cueById.get(g.end_cue);
  if (!start || !end) throw new Error(`gold ${g.id}: unknown cue id`);
  return { ...g, startMs: start.startMs, endMs: end.endMs };
});
const goldScenes = gold.filter((g) => !g.control);
const controls = gold.filter((g) => g.control);

// ---- interval helpers -------------------------------------------------------------------------
const overlapMs = (a, b, tol = 0) => Math.min(a.endMs, b.endMs + tol) - Math.max(a.startMs, b.startMs - tol);
const overlaps = (a, b, tol = TOLERANCE_MS) => overlapMs(a, b, tol) > 0;
function union(intervals) {
  const sorted = intervals.map((i) => [i.startMs, i.endMs]).sort((a, b) => a[0] - b[0]);
  const out = [];
  for (const [s, e] of sorted) {
    if (out.length && s <= out[out.length - 1][1]) out[out.length - 1][1] = Math.max(out[out.length - 1][1], e);
    else out.push([s, e]);
  }
  return out;
}
const length = (u) => u.reduce((s, [a, b]) => s + (b - a), 0);
function intersectLength(u1, u2) {
  let total = 0;
  for (const [a, b] of u1) for (const [c, d] of u2) total += Math.max(0, Math.min(b, d) - Math.max(a, c));
  return total;
}
const prf = (tp, fp, fn) => {
  const precision = tp + fp ? tp / (tp + fp) : null;
  const recall = tp + fn ? tp / (tp + fn) : null;
  return { tp, fp, fn, precision, recall, f1: precision && recall ? (2 * precision * recall) / (precision + recall) : tp + fp + fn === 0 ? null : 0 };
};

// ---- normalise every run to scenes: { startMs, endMs, categories: [ids], severity } -------------
function normalise(run, policy = DEFAULT_POLICY) {
  const shift = run.track === 'db' ? offsetMs : 0;
  let scenes;
  if (run.windows) scenes = windowsToScenes(run.windows, { ...policy, merge: Boolean(run.v2) }).map((s) => ({ ...s, categories: Object.keys(s.categories), probabilities: s.categories }));
  else if (run.events) scenes = run.events.filter((e) => e.validCues && e.severity > 0).map((e) => ({ startMs: e.startMs, endMs: e.endMs, categories: e.categories, severity: e.severity, title: e.title, evidence: e.evidence_cues }));
  else scenes = run.scenes.filter((s) => s.claude.is_real_trigger && s.claude.severity > 0).map((s) => ({ startMs: s.startMs, endMs: s.endMs, categories: s.claude.categories, severity: s.claude.severity, description: s.claude.description, peakCue: s.peakCue }));
  return scenes.map((s) => ({ ...s, startMs: s.startMs + shift, endMs: s.endMs + shift })).sort((a, b) => a.startMs - b.startMs);
}

function score(scenes) {
  // 1. scene detection, category-agnostic
  const found = goldScenes.map((g) => ({ gold: g, hits: scenes.filter((s) => overlaps(s, g)) }));
  const falseAlarms = scenes.filter((s) => !goldScenes.some((g) => overlaps(s, g)));
  const detection = prf(found.filter((f) => f.hits.length).length, falseAlarms.length, found.filter((f) => !f.hits.length).length);
  const serious = found.filter((f) => f.gold.severity >= 2);
  // 2. time: how much is flagged, and how much of that is gold
  const predU = union(scenes);
  const goldU = union(goldScenes);
  const time = { flaggedMin: length(predU) / 60000, goldMin: length(goldU) / 60000, timePrecision: length(predU) ? intersectLength(predU, goldU) / length(predU) : null, timeRecall: intersectLength(predU, goldU) / length(goldU) };
  // 3. categories (core = judged from dialogue; inferred = sound/light captions)
  const perCategory = {};
  for (const id of CATEGORY_IDS) {
    const goldWith = goldScenes.filter((g) => g.categories.includes(id));
    const predWith = scenes.filter((s) => s.categories.includes(id));
    const tp = goldWith.filter((g) => predWith.some((s) => overlaps(s, g))).length;
    const fp = predWith.filter((s) => !goldWith.some((g) => overlaps(s, g))).length;
    perCategory[id] = prf(tp, fp, goldWith.length - tp);
  }
  const micro = (ids) => prf(...['tp', 'fp', 'fn'].map((k) => ids.reduce((s, id) => s + perCategory[id][k], 0)));
  // 4. severity agreement on found scenes
  const sevDiffs = found.filter((f) => f.hits.length).map((f) => Math.abs(Math.round(Math.max(...f.hits.map((h) => h.severity))) - f.gold.severity));
  // 5. controls (calm ranges): any real overlap > 10 s is a false positive
  const controlsHit = controls.filter((c) => scenes.some((s) => overlapMs(s, c) > 10_000)).map((c) => c.id);
  return {
    sceneCount: scenes.length,
    detection,
    seriousRecall: serious.length ? serious.filter((f) => f.hits.length).length / serious.length : null,
    missed: found.filter((f) => !f.hits.length).map((f) => f.gold.id),
    falseAlarms: falseAlarms.map((s) => `${formatTime(s.startMs)}-${formatTime(s.endMs)}`),
    time,
    perCategory,
    categoriesCore: micro(CORE),
    categoriesInferred: micro(CATEGORY_IDS.filter((id) => !CORE.includes(id))),
    severityMae: sevDiffs.length ? sevDiffs.reduce((a, b) => a + b, 0) / sevDiffs.length : null,
    controlsHit,
  };
}

// Run-to-run stability: share of flagged time the two runs agree on (intersection over union).
function stability(a, b) {
  const ua = union(a);
  const ub = union(b);
  const inter = intersectLength(ua, ub);
  const uni = length(ua) + length(ub) - inter;
  return uni ? inter / uni : 1;
}

// ---- load runs ---------------------------------------------------------------------------------
// `node compare.js ablations` scores the ablation runs (plus the baseline Jev run) instead.
const RUN_DIR = process.argv[2] ?? 'runs';
const runs = fs.readdirSync(path.join(here, RUN_DIR)).filter((f) => f.endsWith('.json')).sort().map((f) => ({ file: f, ...JSON.parse(fs.readFileSync(path.join(here, RUN_DIR, f), 'utf8')) }));
const arms = {};
for (const run of runs) {
  const key = `${run.arm} (${run.track})`;
  (arms[key] ??= { arm: run.arm, track: run.track, model: run.model, runs: [] }).runs.push(run);
}

const jevRun = runs.find((r) => r.arm === 'jev-windowed' && r.track === 'sdh');
// Two-stage arms carry the cost and time of the run that fed them.
const upstream = (run) => run.from && runs.find((r) => run.from.endsWith(r.file));
const results = { generatedAt: new Date().toISOString(), toleranceMs: TOLERANCE_MS, policy: DEFAULT_POLICY, trackOffset: { offsetMs, matchedLines }, movieEndMs: sdh.cues.at(-1).endMs, gold, arms: [] };
for (const [key, arm] of Object.entries(arms)) {
  const normalised = arm.runs.map((r) => normalise(r));
  const scores = normalised.map(score);
  const avg = (f) => scores.map(f).reduce((a, b) => a + (b ?? 0), 0) / scores.length;
  results.arms.push({
    key,
    ...arm,
    runs: arm.runs.map((r, i) => ({ file: r.file, label: r.label, calls: r.calls, inputTokens: r.inputTokens, outputTokens: r.outputTokens, costUsd: r.costUsd, wallMs: r.wallMs, scenes: normalised[i], score: scores[i] })),
    // the describe arm cannot run without the Jev pass that feeds it, so it carries that cost too
    costUsd: arm.runs.reduce((s, r) => s + r.costUsd, 0) / arm.runs.length + (upstream(arm.runs[0])?.costUsd ?? 0),
    wallMs: arm.runs.reduce((s, r) => s + r.wallMs, 0) / arm.runs.length + (upstream(arm.runs[0])?.wallMs ?? 0),
    stability: normalised.length > 1 ? stability(normalised[0], normalised[1]) : null,
    summary: {
      sceneRecall: avg((s) => s.detection.recall),
      scenePrecision: avg((s) => s.detection.precision),
      seriousRecall: avg((s) => s.seriousRecall),
      flaggedMin: avg((s) => s.time.flaggedMin),
      timePrecision: avg((s) => s.time.timePrecision),
      categoryF1: avg((s) => s.categoriesCore.f1),
      categoryPrecision: avg((s) => s.categoriesCore.precision),
      categoryRecall: avg((s) => s.categoriesCore.recall),
      severityMae: avg((s) => s.severityMae),
      controlsHit: avg((s) => s.controlsHit.length),
    },
  });
}

// ---- Jev threshold sweep (no new API calls: raw probabilities are stored) -----------------------
if (jevRun) {
  results.jevSweep = [];
  for (const minSeverity of [0.5, 1.0, 1.5]) {
    for (const threshold of [0.3, 0.4, 0.5, 0.6, 0.7, 0.8]) {
      const s = score(normalise(jevRun, { threshold, minSeverity }));
      results.jevSweep.push({ threshold, minSeverity, scenes: s.sceneCount, sceneRecall: s.detection.recall, scenePrecision: s.detection.precision, flaggedMin: s.time.flaggedMin, categoryPrecision: s.categoriesCore.precision, categoryRecall: s.categoriesCore.recall, categoryF1: s.categoriesCore.f1, controlsHit: s.controlsHit.length });
    }
  }
  // Detection vs classification: what did Jev's raw answers look like on every gold scene?
  results.jevOnGold = goldScenes.map((g) => {
    const wins = jevRun.windows.filter((w) => overlapMs(w, g) > 0);
    const maxProb = Object.fromEntries(CATEGORY_IDS.map((id) => [id, Math.max(0, ...wins.map((w) => w.categories[id]))]));
    const expected = g.categories.filter((id) => CORE.includes(id));
    return {
      gold: g.id,
      title: g.title,
      textVisibility: g.text_visibility,
      maxSeverity: Math.max(0, ...wins.map((w) => w.severity)),
      expected: Object.fromEntries(expected.map((id) => [id, maxProb[id]])),
      unexpected: Object.fromEntries(CORE.filter((id) => !expected.includes(id) && maxProb[id] >= DEFAULT_POLICY.threshold).map((id) => [id, maxProb[id]])),
    };
  });
}

fs.writeFileSync(path.join(here, RUN_DIR === 'runs' ? 'results.json' : `results.${RUN_DIR}.json`), JSON.stringify(results, null, 2));

const pct = (x) => (x == null ? '  - ' : `${Math.round(x * 100)}%`.padStart(4));
console.log(`gold: ${goldScenes.length} scenes, ${controls.length} controls | db track is ${offsetMs} ms behind sdh (${matchedLines} matched lines)\n`);
console.log('arm'.padEnd(36), 'scenes', 'recall', 'serious', 'precis', 'flagMin', 'timeP', 'catP', 'catR', 'catF1', 'sevMAE', 'ctrl', 'stable', '   cost', '  wall');
for (const a of results.arms) {
  const s = a.summary;
  console.log(a.key.padEnd(36), String(a.runs[0].score.sceneCount).padStart(6), pct(s.sceneRecall).padStart(6), pct(s.seriousRecall).padStart(7), pct(s.scenePrecision).padStart(6), s.flaggedMin.toFixed(1).padStart(7), pct(s.timePrecision).padStart(5), pct(s.categoryPrecision), pct(s.categoryRecall), pct(s.categoryF1).padStart(5), s.severityMae.toFixed(2).padStart(6), String(s.controlsHit).padStart(4), pct(a.stability).padStart(6), `$${a.costUsd.toFixed(4)}`.padStart(8), `${(a.wallMs / 1000).toFixed(1)}s`.padStart(6));
}
