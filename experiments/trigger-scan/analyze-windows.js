// Window-level view: treats each windowed analyzer as a classifier over the SAME windows and asks
// how well its scores separate windows that contain a reference scene from windows that do not.
// This removes the granularity penalty of comparing 60-120 s windows with tightly bounded scenes.
//   node analyze-windows.js [dir ...]      (default: runs ablations)
import fs from 'node:fs';
import path from 'node:path';
import { CATEGORIES } from './taxonomy.js';
import { here, loadTrack } from './common.js';

const MIN_OVERLAP_MS = 10_000;
const cueById = new Map(loadTrack('sdh').cues.map((c) => [c.id, c]));
const gold = JSON.parse(fs.readFileSync(path.join(here, 'gold.json'), 'utf8'))
  .filter((g) => !g.control)
  .map((g) => ({ ...g, startMs: cueById.get(g.start_cue).startMs, endMs: cueById.get(g.end_cue).endMs }));

const overlap = (a, b) => Math.min(a.endMs, b.endMs) - Math.max(a.startMs, b.startMs);
const touches = (w, g) => overlap(w, g) >= Math.min(MIN_OVERLAP_MS, (g.endMs - g.startMs) * 0.5);

// Area under the ROC curve = chance a random positive window outscores a random negative one.
function auc(items) {
  const pos = items.filter((x) => x.y);
  const neg = items.filter((x) => !x.y);
  if (!pos.length || !neg.length) return null;
  let wins = 0;
  for (const p of pos) for (const n of neg) wins += p.s > n.s ? 1 : p.s === n.s ? 0.5 : 0;
  return wins / (pos.length * neg.length);
}
function bestF1(items) {
  let best = { f1: 0 };
  for (const t of [...new Set(items.map((x) => x.s))]) {
    const tp = items.filter((x) => x.s >= t && x.y).length;
    const fp = items.filter((x) => x.s >= t && !x.y).length;
    const fn = items.filter((x) => x.s < t && x.y).length;
    const f1 = tp ? (2 * tp) / (2 * tp + fp + fn) : 0;
    if (f1 > best.f1) best = { f1, t, precision: tp / (tp + fp), recall: tp / (tp + fn) };
  }
  return best;
}

// Same footing for the whole-transcript analyzers: project their scenes onto the baseline windows.
function projectEvents() {
  const windows = loadTrack('sdh').windows;
  console.log('\nwhole-transcript scenes projected onto the same 60 windows (window flagged if a scene overlaps it >= 10 s):');
  for (const file of fs.readdirSync(path.join(here, 'runs')).filter((x) => x.endsWith('.json')).sort()) {
    const run = JSON.parse(fs.readFileSync(path.join(here, 'runs', file), 'utf8'));
    if (!run.events) continue;
    const events = run.events.filter((e) => e.validCues && e.severity > 0);
    const rows = windows.map((w) => ({ y: gold.some((g) => touches(w, g)), p: events.some((e) => touches(w, e)) }));
    const tp = rows.filter((r) => r.y && r.p).length, fp = rows.filter((r) => !r.y && r.p).length, fn = rows.filter((r) => r.y && !r.p).length;
    console.log(`  ${run.arm} ${run.label}`.padEnd(30), `flagged ${tp + fp} windows | precision ${f(tp / (tp + fp))} recall ${f(tp / (tp + fn))} F1 ${f((2 * tp) / (2 * tp + fp + fn))}`);
  }
}

const dirs = process.argv.slice(2).length ? process.argv.slice(2) : ['runs', 'ablations'];
const seen = new Set();
const f = (x) => (x == null ? '  - ' : x.toFixed(2));
console.log('arm'.padEnd(34), 'wins', 'pos', '| any scene: AUC(sev) bestF1 @thr  P    R  | serious: AUC | mean per-category AUC | any-category max-prob AUC');
for (const dir of dirs) {
  for (const file of fs.readdirSync(path.join(here, dir)).filter((x) => x.endsWith('.json')).sort()) {
    const run = JSON.parse(fs.readFileSync(path.join(here, dir, file), 'utf8'));
    const key = `${run.arm}|${run.track}|${run.label ?? ''}`;
    if (!run.windows || run.track !== 'sdh' || run.from || seen.has(key)) continue;
    seen.add(key);
    const rows = run.windows.map((w) => ({ w, scenes: gold.filter((g) => touches(w, g)) }));
    const any = rows.map((r) => ({ s: r.w.severity, y: r.scenes.length > 0 }));
    const serious = rows.map((r) => ({ s: r.w.severity, y: r.scenes.some((g) => g.severity >= 2) }));
    const core = CATEGORIES.filter((c) => !c.inferred);
    const catAucs = core.map((c) => auc(rows.map((r) => ({ s: r.w.categories[c.id], y: r.scenes.some((g) => g.categories.includes(c.id)) })))).filter((x) => x != null);
    const maxProb = rows.map((r) => ({ s: Math.max(...core.map((c) => r.w.categories[c.id])), y: r.scenes.length > 0 }));
    const b = bestF1(any);
    console.log(`${run.arm} ${run.label ?? ''}`.padEnd(34), String(rows.length).padStart(4), String(any.filter((x) => x.y).length).padStart(3), '|', f(auc(any)).padStart(12), f(b.f1).padStart(10), f(b.t).padStart(5), f(b.precision), f(b.recall), '|', f(auc(serious)).padStart(10), '|', f(catAucs.reduce((a, x) => a + x, 0) / catAucs.length).padStart(14), '|', f(auc(maxProb)).padStart(10));
  }
}
projectEvents();
