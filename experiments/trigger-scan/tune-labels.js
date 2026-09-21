// Can Jev do the attribute labels? Tunes one threshold per attribute on some films and tests on a
// film it has not seen (leave-one-film-out), against reference lists in gold/<slug>.json.
// Optionally scores language-model scene lists (scenes/<slug>.json from build-scenes.js) the same way.
//   node tune-labels.js            score the 53 attributes
//   node tune-labels.js --groups   score the 13 parent-facing groups instead (a group fires if any of its attributes does)
import fs from 'node:fs';
import path from 'node:path';
import { ATTRIBUTES, GROUPS, CANCELLED_WHEN_RETOLD } from './taxonomy-v2.js';
import { here, loadFilm } from './common.js';

const TOL_MS = 10_000;
const GRID = [0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 0.95, 1.01]; // 1.01 = attribute switched off
const MIN_TRAIN_POSITIVES = 3;
const GROUP_MODE = process.argv.includes('--groups');
const groupOf = Object.fromEntries(ATTRIBUTES.map((a) => [a.id, a.group]));
const IDS = GROUP_MODE ? Object.keys(GROUPS).filter((g) => ATTRIBUTES.some((a) => a.group === g)) : ATTRIBUTES.map((a) => a.id);
const toLabels = (ids) => (GROUP_MODE ? [...new Set(ids.map((id) => groupOf[id]))] : ids);

const overlap = (a, b) => Math.min(a.endMs, b.endMs + TOL_MS) - Math.max(a.startMs, b.startMs - TOL_MS) > 0;

function loadFilmData(slug) {
  const cueById = new Map(loadFilm(slug).cues.map((c) => [c.id, c]));
  const gold = JSON.parse(fs.readFileSync(path.join(here, 'gold', `${slug}.json`), 'utf8')).map((g) => ({ ...g, attributes: toLabels(g.attributes), visual_only: GROUP_MODE ? [] : g.visual_only, startMs: cueById.get(g.start_cue).startMs, endMs: cueById.get(g.end_cue).endMs }));
  const runFile = fs.readdirSync(path.join(here, 'runs-films')).filter((f) => f.includes(`jev-v3-universal-${slug}`)).sort().pop();
  const run = JSON.parse(fs.readFileSync(path.join(here, 'runs-films', runFile), 'utf8'));
  // a retelling or a dream is not the event (same rule as the runner)
  const beats = run.windows.map((b) => {
    const a = b.atoms;
    const notNow = (a.recounting >= 0.6 || a.imagined >= 0.6) && a.terrified < 0.7;
    const attrP = Object.fromEntries(ATTRIBUTES.map((t) => [t.id, notNow && CANCELLED_WHEN_RETOLD.has(t.id) ? 0 : a[t.id]]));
    return { startMs: b.startMs, endMs: b.endMs, p: GROUP_MODE ? Object.fromEntries(IDS.map((g) => [g, Math.max(...ATTRIBUTES.filter((t) => t.group === g).map((t) => attrP[t.id]))])) : attrP };
  });
  const scenesFile = path.join(here, 'scenes', `${slug}.json`);
  const llm = fs.existsSync(scenesFile) ? JSON.parse(fs.readFileSync(scenesFile, 'utf8')).scenes.map((s) => ({ startMs: s.start_ms, endMs: s.end_ms, attrs: new Set(toLabels(s.attributes.map((x) => x.id))) })) : null;
  return { slug, gold: gold.filter((g) => !g.control), controls: gold.filter((g) => g.control), beats, llm, jevCost: run.costUsd };
}

// preds: time-ordered [{startMs,endMs,attrs:Set}]. Counts per attribute: found / missed reference labels, and
// false events (runs of consecutive predictions carrying the attribute with no reference scene that has it).
function score(film, preds, { textOnly = false } = {}) {
  const counts = Object.fromEntries(IDS.map((id) => [id, { tp: 0, fn: 0, fp: 0 }]));
  for (const id of IDS) {
    const goldWith = film.gold.filter((g) => g.attributes.includes(id) && !(textOnly && (g.visual_only ?? []).includes(id)));
    const anyGoldWith = film.gold.filter((g) => g.attributes.includes(id));
    for (const g of goldWith) counts[id][preds.some((p) => p.attrs.has(id) && overlap(p, g)) ? 'tp' : 'fn']++;
    let inRun = false;
    for (const p of preds) {
      const falseHit = p.attrs.has(id) && !anyGoldWith.some((g) => overlap(p, g));
      if (falseHit && !inRun) counts[id].fp++;
      inRun = falseHit;
    }
  }
  return counts;
}
const add = (into, c) => { for (const id of IDS) for (const k of ['tp', 'fn', 'fp']) into[id][k] += c[id][k]; return into; };
const zero = () => Object.fromEntries(IDS.map((id) => [id, { tp: 0, fn: 0, fp: 0 }]));
function prf(counts, ids = IDS) {
  const t = ids.reduce((s, id) => ({ tp: s.tp + counts[id].tp, fn: s.fn + counts[id].fn, fp: s.fp + counts[id].fp }), { tp: 0, fn: 0, fp: 0 });
  const precision = t.tp + t.fp ? t.tp / (t.tp + t.fp) : null;
  const recall = t.tp + t.fn ? t.tp / (t.tp + t.fn) : null;
  return { ...t, precision, recall, f1: precision && recall ? (2 * precision * recall) / (precision + recall) : 0 };
}
const jevPreds = (film, thr) => film.beats.map((b) => ({ startMs: b.startMs, endMs: b.endMs, attrs: new Set(IDS.filter((id) => b.p[id] >= (typeof thr === 'number' ? thr : thr[id]))) }));

// ---- data -------------------------------------------------------------------------------------------
const slugs = fs.readdirSync(path.join(here, 'gold')).filter((f) => f.endsWith('.json')).map((f) => f.replace('.json', '')).filter((s) => fs.existsSync(path.join(here, 'runs-films')) && fs.readdirSync(path.join(here, 'runs-films')).some((f) => f.includes(`jev-v3-universal-${s}`)));
const films = slugs.map(loadFilmData);
console.log(`films: ${films.map((f) => `${f.slug} (${f.gold.length} scenes, ${f.gold.reduce((s, g) => s + g.attributes.length, 0)} labels)`).join(', ')}\n`);

// Pre-compute per film, per attribute, per grid threshold counts (attributes are independent).
const table = new Map(films.map((f) => [f.slug, GRID.map((t) => score(f, jevPreds(f, t)))]));

function tune(train) {
  const pooled = GRID.map((_, gi) => train.reduce((acc, f) => add(acc, table.get(f.slug)[gi]), zero()));
  const globalIdx = pooled.map((c, gi) => [prf(c).f1, gi]).sort((a, b) => b[0] - a[0])[0][1];
  const thr = {};
  for (const id of IDS) {
    const positives = pooled[0][id].tp + pooled[0][id].fn;
    if (positives < MIN_TRAIN_POSITIVES) { thr[id] = GRID[globalIdx]; continue; }
    thr[id] = GRID[pooled.map((c, gi) => [prf(c, [id]).f1, gi]).sort((a, b) => b[0] - a[0] || b[1] - a[1])[0][1]];
  }
  return { thr, global: GRID[globalIdx] };
}

// ---- leave-one-film-out -------------------------------------------------------------------------------
const totals = { 'fixed 0.5': zero(), 'fixed 0.7': zero(), 'one tuned threshold': zero(), 'per-attribute thresholds': zero(), 'per-attribute, text-visible labels only': zero() };
const llmTotals = zero();
let llmFilms = 0;
const pct = (x) => (x == null ? '  -' : `${Math.round(x * 100)}%`.padStart(4));
const line = (name, c) => { const r = prf(c); return `${name.padEnd(42)} right ${pct(r.precision)}  found ${pct(r.recall)}  F1 ${pct(r.f1)}   (${r.tp} found, ${r.fn} missed, ${r.fp} false)`; };
const chosen = {};
for (const held of films) {
  const { thr, global } = tune(films.filter((f) => f !== held));
  chosen[held.slug] = thr;
  add(totals['fixed 0.5'], score(held, jevPreds(held, 0.5)));
  add(totals['fixed 0.7'], score(held, jevPreds(held, 0.7)));
  add(totals['one tuned threshold'], score(held, jevPreds(held, global)));
  const tuned = score(held, jevPreds(held, thr));
  add(totals['per-attribute thresholds'], tuned);
  add(totals['per-attribute, text-visible labels only'], score(held, jevPreds(held, thr), { textOnly: true }));
  let extra = '';
  if (held.llm) { const c = score(held, held.llm); add(llmTotals, c); llmFilms++; extra = `\n   ${line('  language model on Jev stretches', c)}`; }
  console.log(`held out: ${held.slug} (one threshold = ${global})\n   ${line('  Jev per-attribute thresholds', tuned)}${extra}`);
}
console.log('\nALL HELD-OUT FILMS POOLED (Jev never tuned on the film it is scored on)');
for (const [name, c] of Object.entries(totals)) console.log(' ', line(`Jev, ${name}`, c));
if (llmFilms) console.log(' ', line(`Language model labels (${llmFilms} films)`, llmTotals));

console.log('\nBY GROUP, Jev per-attribute thresholds:');
for (const [g, label] of Object.entries(GROUPS)) { const ids = GROUP_MODE ? [g].filter((x) => IDS.includes(x)) : ATTRIBUTES.filter((a) => a.group === g).map((a) => a.id); if (ids.length) { const r = prf(totals['per-attribute thresholds'], ids); if (r.tp + r.fn + r.fp) console.log(' ', label.padEnd(28), `right ${pct(r.precision)}  found ${pct(r.recall)}   (${r.tp}/${r.fn}/${r.fp})`); } }

const all = tune(films);
fs.writeFileSync(path.join(here, GROUP_MODE ? 'thresholds.groups.json' : 'thresholds.json'), JSON.stringify({ tuned_on: slugs, grid: GRID, note: '1.01 = attribute switched off; attributes with fewer than 3 reference examples use the single global threshold', global: all.global, thresholds: all.thr }, null, 2));
console.log(`\nwrote ${GROUP_MODE ? 'thresholds.groups.json' : 'thresholds.json'} (tuned on all ${films.length} films, global ${all.global}); switched off: ${IDS.filter((id) => all.thr[id] > 1).join(', ') || 'none'}`);
