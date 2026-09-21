// Rescores every SAVED analyzer output with score.js. No model calls, no network.
//
//   node rescore.js              five films + Finding Nemo, both label grains
//   node rescore.js --bins 10    change the time-grid bin size (seconds, default 5)
//
// Writes rescore/results.json and prints compact tables (pooled and per film).
import fs from 'node:fs';
import path from 'node:path';
import { ATTRIBUTES, GROUPS, CANCELLED_WHEN_RETOLD } from './taxonomy-v2.js';
import { CATEGORY_IDS } from './taxonomy.js';
import { here, loadFilm, loadTrack, parseArgs } from './common.js';
import { flaggedCategories, DEFAULT_POLICY } from './events.js';
import { parseSrt } from './srt.js';
import {
  scoreFilm, poolResults, headline, summariseGrid, prf, matchProfile, mulberry32,
  baselineWholeFilm, baselineEveryUnit, baselineNothing, baselineRandomMatched, unionIntervals, totalLength,
} from './score.js';

const args = parseArgs();
const BIN_MS = (Number(args.bins) || 5) * 1000;
const OPTIONS = { binMs: BIN_MS };
const THRESHOLD_GRID = [0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 0.95, 1.01]; // 1.01 = label switched off
const MIN_TRAIN_POSITIVES = 3; // reference scenes carrying the label, in the training films
const RANDOM_DRAWS = 20;
const BRIDGE_MS = 20_000; // build-scenes.js bridges one short unflagged beat inside a stretch

const groupOf = Object.fromEntries(ATTRIBUTES.map((a) => [a.id, a.group]));
const ATTR_IDS = ATTRIBUTES.map((a) => a.id);
const GROUP_IDS = Object.keys(GROUPS).filter((g) => ATTRIBUTES.some((a) => a.group === g)); // 12: `sound` has no attributes

// ---------------------------------------------------------------------------------------------
// five films: load reference lists, Jev beats, Sonnet scene lists
// ---------------------------------------------------------------------------------------------
const slugs = fs.readdirSync(path.join(here, 'gold')).filter((f) => f.endsWith('.json')).map((f) => f.replace('.json', ''))
  .filter((s) => fs.readdirSync(path.join(here, 'runs-films')).some((f) => f.includes(`jev-v3-universal-${s}`)));

function loadFilmData(slug) {
  const { cues } = loadFilm(slug);
  const cueById = new Map(cues.map((c) => [c.id, c]));
  const filmEndMs = cues[cues.length - 1].endMs;
  const raw = JSON.parse(fs.readFileSync(path.join(here, 'gold', `${slug}.json`), 'utf8')).map((g) => {
    const s = cueById.get(g.start_cue);
    const e = cueById.get(g.end_cue);
    if (!s || !e) throw new Error(`${slug} ${g.id}: unknown cue id`);
    return { ...g, startMs: s.startMs, endMs: e.endMs, severity: { '5-7': g.severity_5_7, '8-10': g.severity_8_10 } };
  });
  const runFile = fs.readdirSync(path.join(here, 'runs-films')).filter((f) => f.includes(`jev-v3-universal-${slug}`)).sort().pop();
  const run = JSON.parse(fs.readFileSync(path.join(here, 'runs-films', runFile), 'utf8'));
  const scenesFile = path.join(here, 'scenes', `${slug}.json`);
  const sonnet = fs.existsSync(scenesFile) ? JSON.parse(fs.readFileSync(scenesFile, 'utf8')) : null;
  return {
    slug, filmEndMs, runFile,
    reference: raw.filter((g) => !g.control),
    controls: raw.filter((g) => g.control),
    beats: run.windows,
    jevCostUsd: run.costUsd,
    sonnetScenes: sonnet ? sonnet.scenes : null,
    sonnetCostUsd: sonnet?.analysis_run?.cost_usd ?? null,
  };
}
const films = slugs.map(loadFilmData);

// reference labels at a grain; a group is visual-only only if every contributing attribute is
const refAt = (film, grain) => film.reference.map((g) => {
  const vis = new Set(g.visual_only ?? []);
  if (grain === 'attributes') return { id: g.id, startMs: g.startMs, endMs: g.endMs, labels: new Set(g.attributes), visualOnly: vis, severity: g.severity };
  const labels = new Set(g.attributes.map((a) => groupOf[a]).filter(Boolean));
  const visualOnly = new Set([...labels].filter((G) => g.attributes.filter((a) => groupOf[a] === G).every((a) => vis.has(a))));
  return { id: g.id, startMs: g.startMs, endMs: g.endMs, labels, visualOnly, severity: g.severity };
});
const labelIdsAt = (grain) => (grain === 'attributes' ? ATTR_IDS : GROUP_IDS);

// Jev beat probabilities, with the same retold/imagined veto tune-labels.js applies.
function jevBeatProbs(film, grain) {
  return film.beats.map((b) => {
    const a = b.atoms;
    const notNow = (a.recounting >= 0.6 || a.imagined >= 0.6) && a.terrified < 0.7;
    const attrP = Object.fromEntries(ATTRIBUTES.map((t) => [t.id, notNow && CANCELLED_WHEN_RETOLD.has(t.id) ? 0 : a[t.id]]));
    const p = grain === 'attributes' ? attrP : Object.fromEntries(GROUP_IDS.map((G) => [G, Math.max(...ATTRIBUTES.filter((t) => t.group === G).map((t) => attrP[t.id]))]));
    return { startMs: b.startMs, endMs: b.endMs, p, severity: { '5-7': b.severity, '8-10': b.severity } };
  });
}
// A beat is a prediction only if it carries at least one label: that is what this labeller flags.
const jevPreds = (beats, thr, labelIds) => beats
  .map((b) => ({ startMs: b.startMs, endMs: b.endMs, severity: b.severity, labels: new Set(labelIds.filter((id) => b.p[id] >= (typeof thr === 'number' ? thr : thr[id]))) }))
  .filter((b) => b.labels.size > 0);

// Jev alone as a scene finder: the runner's own gate, one short unflagged beat bridged, then merged.
// bridge=false is the plain merged-range policy AUDIT.md's "Jev alone" numbers came from.
function jevStretches(film, bridge = true) {
  const beats = film.beats;
  const flag = beats.map((b) => flaggedCategories(b).length > 0);
  if (bridge) flag.forEach((f, i) => { if (!f && flag[i - 1] && flag[i + 1] && beats[i].endMs - beats[i].startMs <= BRIDGE_MS) flag[i] = true; });
  const out = [];
  beats.forEach((b, i) => {
    if (!flag[i]) return;
    const prev = out[out.length - 1];
    if (prev && prev.lastBeat === i - 1) Object.assign(prev, { lastBeat: i, endMs: b.endMs, severity: { '5-7': Math.max(prev.severity['5-7'], b.severity), '8-10': Math.max(prev.severity['8-10'], b.severity) } });
    else out.push({ lastBeat: i, startMs: b.startMs, endMs: b.endMs, labels: new Set(), severity: { '5-7': b.severity, '8-10': b.severity } });
  });
  return out.map(({ lastBeat, ...s }) => s);
}

const sonnetPreds = (film, grain) => (film.sonnetScenes ?? []).map((s) => ({
  startMs: s.start_ms, endMs: s.end_ms,
  labels: new Set(s.attributes.map((x) => (grain === 'attributes' ? x.id : groupOf[x.id])).filter(Boolean)),
  severity: { '5-7': s.severity['5-7'], '8-10': s.severity['8-10'] },
}));

// ---------------------------------------------------------------------------------------------
// leave-one-film-out per-label thresholds, tuned on the NEW time-grid micro F1 (tolerance 0)
// ---------------------------------------------------------------------------------------------
function tuneTable(grain) {
  const labelIds = labelIdsAt(grain);
  const per = new Map();
  for (const film of films) {
    const beats = jevBeatProbs(film, grain);
    const reference = refAt(film, grain);
    per.set(film.slug, THRESHOLD_GRID.map((t) => scoreFilm({ film: film.slug, filmEndMs: film.filmEndMs, labelIds, reference, predictions: jevPreds(beats, t, labelIds), options: { ...OPTIONS, toleranceS: [0] } }).grid[0].perLabel));
  }
  const refScenes = (subset, id) => subset.reduce((s, f) => s + refAt(f, grain).filter((g) => g.labels.has(id)).length, 0);
  const tune = (train) => {
    const pooled = THRESHOLD_GRID.map((_, gi) => Object.fromEntries(labelIds.map((id) => [id, train.reduce((acc, f) => {
      const c = per.get(f.slug)[gi][id];
      return { tp: acc.tp + c.tp, fp: acc.fp + c.fp, fn: acc.fn + c.fn };
    }, { tp: 0, fp: 0, fn: 0 })])));
    const micro = (counts) => prf(labelIds.reduce((s, id) => ({ tp: s.tp + counts[id].tp, fp: s.fp + counts[id].fp, fn: s.fn + counts[id].fn }), { tp: 0, fp: 0, fn: 0 })).f1 ?? 0;
    const globalIdx = pooled.map((c, gi) => [micro(c), gi]).sort((a, b) => b[0] - a[0])[0][1];
    const thr = {};
    for (const id of labelIds) {
      if (refScenes(train, id) < MIN_TRAIN_POSITIVES) { thr[id] = THRESHOLD_GRID[globalIdx]; continue; }
      thr[id] = THRESHOLD_GRID[pooled.map((c, gi) => [prf(c[id]).f1 ?? 0, gi]).sort((a, b) => b[0] - a[0] || b[1] - a[1])[0][1]];
    }
    return { thr, global: THRESHOLD_GRID[globalIdx] };
  };
  return Object.fromEntries(films.map((held) => [held.slug, tune(films.filter((f) => f !== held))]));
}

// ---------------------------------------------------------------------------------------------
// arms
// ---------------------------------------------------------------------------------------------
function armsForFilm(film, grain, lofo) {
  const labelIds = labelIdsAt(grain);
  const beats = jevBeatProbs(film, grain);
  const jev05 = jevPreds(beats, 0.5, labelIds);
  const jev07 = jevPreds(beats, 0.7, labelIds);
  const jevLofo = jevPreds(beats, lofo[film.slug].thr, labelIds);
  const sonnet = sonnetPreds(film, grain);
  const arms = {
    'jev finder, no bridge': { preds: jevStretches(film, false), labelled: false, severityScale: 'threat 0-3' },
    'jev finder (scenes only)': { preds: jevStretches(film), labelled: false, severityScale: 'threat 0-3' },
    'jev labels @0.5': { preds: jev05, severityScale: 'threat 0-3' },
    'jev labels @0.7': { preds: jev07, severityScale: 'threat 0-3' },
    'jev labels, LOFO per-label': { preds: jevLofo, severityScale: 'threat 0-3' },
    'jev finds + sonnet labels': { preds: sonnet, severityScale: 'calibrated' },
    'BASELINE whole film, all labels': { preds: baselineWholeFilm(film.filmEndMs, labelIds) },
    'BASELINE every beat, all labels': { preds: baselineEveryUnit(film.beats, labelIds) },
    'BASELINE nothing flagged': { preds: baselineNothing() },
  };
  const out = {};
  for (const [name, a] of Object.entries(arms)) out[name] = { ...a, result: scoreFilm({ film: film.slug, filmEndMs: film.filmEndMs, labelIds, reference: refAt(film, grain), controls: film.controls, predictions: a.preds, options: OPTIONS }) };
  // (d) random predictors matched to each real analyzer's flagged-time share and label frequency
  for (const [name, source] of [['BASELINE random ~ jev LOFO', jevLofo], ['BASELINE random ~ sonnet', sonnet]]) {
    const profile = matchProfile(source, labelIds);
    const draws = [...Array(RANDOM_DRAWS)].map((_, i) => scoreFilm({
      film: film.slug, filmEndMs: film.filmEndMs, labelIds, reference: refAt(film, grain), controls: film.controls,
      predictions: baselineRandomMatched({ filmEndMs: film.filmEndMs, profile, labelIds, rng: mulberry32(1000 + i) }), options: OPTIONS,
    }));
    out[name] = { labelled: true, result: { ...poolResults(draws, { divideBy: RANDOM_DRAWS }), film: film.slug, labelIds } };
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// printing
// ---------------------------------------------------------------------------------------------
const pct = (x, w = 4) => (x == null || Number.isNaN(x) ? '   -' : `${Math.round(x * 100)}%`).padStart(w);
const num = (x, d = 1, w = 5) => (x == null || Number.isNaN(x) ? '-' : x.toFixed(d)).padStart(w);
const HEAD = ['arm'.padEnd(34), 'anyP', 'anyR', 'anyF1', 'found', 'c>=.5', 'serio', 'flagM', 'insid', 'ref/p', 'maxRp', 'longM', 'ctrl', ' labP', ' labR', 'labF1', 'macro'].join(' ');

function row(name, res, { labelled = true } = {}) {
  const h = headline(res, { tolerance: 0, coverage: '0.5' });
  const any = res.detection.any;
  return [
    name.padEnd(34),
    pct(h.anyPrecision),
    pct(h.anyRecall),
    pct(h.anyF1, 5),
    pct(any.refs ? any.found / any.refs : null, 5),
    pct(h.sceneRecall, 5),
    pct(h.seriousRecall, 5),
    num(h.flaggedMin, 1, 5),
    pct(h.shareInsideRef, 5),
    num(h.refPerPrediction, 2, 5),
    num(h.maxRefPerPrediction, 0, 5),
    num(h.longestPredictionMin, 1, 5),
    `${num(h.controlsHit, 0, 2)}/${Math.round(h.controlsTotal)}`.padStart(5),
    labelled ? pct(h.labelPrecision, 5) : '    -',
    labelled ? pct(h.labelRecall, 5) : '    -',
    labelled ? pct(h.labelF1, 5) : '    -',
    labelled ? pct(h.macroF1, 5) : '    -',
  ].join(' ');
}

// ---------------------------------------------------------------------------------------------
// run: five films
// ---------------------------------------------------------------------------------------------
const out = { generatedAt: new Date().toISOString(), binMs: BIN_MS, options: { thresholdGrid: THRESHOLD_GRID, randomDraws: RANDOM_DRAWS, minTrainPositives: MIN_TRAIN_POSITIVES }, films: {}, nemo: {} };

console.log(`bins ${BIN_MS / 1000} s | five films: ${films.map((f) => f.slug).join(', ')}`);
console.log('columns: anyP/anyR/anyF1=label-agnostic time grid ("is anything flagged here"), the breadth-proof headline for finding scenes,');
console.log('         found=reference scenes with any overlap, c>=.5=at least half the scene covered, serio=serious scenes at c>=.5,');
console.log('         flagM=flagged minutes (time-merged), insid=share of flagged time inside a reference scene, ref/p & maxRp=reference');
console.log('         scenes per merged prediction, longM=longest prediction (min), ctrl=calm controls hit (>5 s), lab*=time-grid labels at 5 s bins, tolerance 0\n');

for (const grain of ['attributes', 'groups']) {
  const labelIds = labelIdsAt(grain);
  const lofo = tuneTable(grain);
  const perFilmArms = films.map((f) => ({ slug: f.slug, arms: armsForFilm(f, grain, lofo) }));
  const armNames = Object.keys(perFilmArms[0].arms);
  const pooled = {};
  for (const name of armNames) pooled[name] = { labelled: perFilmArms[0].arms[name].labelled !== false, result: poolResults(perFilmArms.map((p) => p.arms[name].result)) };

  console.log(`\n=== FIVE FILMS POOLED — ${grain} (${labelIds.length} labels) ===`);
  console.log(HEAD);
  for (const name of armNames) console.log(row(name, pooled[name].result, pooled[name]));

  // tolerance sweep and coverage sweep on the pooled numbers
  const refMin = pooled['BASELINE nothing flagged'].result.overreach.refMs / 60000;
  const filmMin = pooled['BASELINE nothing flagged'].result.overreach.filmMs / 60000;
  console.log(`\nreference: 161 scenes covering ${refMin.toFixed(1)} min of ${filmMin.toFixed(1)} min of film (${Math.round((100 * refMin) / filmMin)}%), 25 calm controls`);

  console.log(`\ntolerance sweep, label-agnostic time grid (anyF1 / P / R) — the breadth-proof detection headline:`);
  console.log('arm'.padEnd(34), [0, 5, 10, 15].map((n) => `N=${n}s`.padStart(18)).join(''));
  for (const name of armNames) {
    const cells = [0, 5, 10, 15].map((n) => { const r = prf(pooled[name].result.anyGrid[n].perLabel.any); return `${pct(r.f1)}/${pct(r.precision)}/${pct(r.recall)}`.padStart(18); });
    console.log(name.padEnd(34), cells.join(''));
  }

  console.log(`\ntolerance sweep (don't-care margin around reference edges), pooled micro label F1 / precision / recall — ${grain}:`);
  console.log('arm'.padEnd(34), [0, 5, 10, 15].map((n) => `N=${n}s`.padStart(18)).join(''));
  for (const name of armNames.filter((n) => pooled[n].labelled)) {
    const cells = [0, 5, 10, 15].map((n) => { const g = summariseGrid(pooled[name].result.grid[n].perLabel, labelIds); return `${pct(g.micro.f1)}/${pct(g.micro.precision)}/${pct(g.micro.recall)}`.padStart(18); });
    console.log(name.padEnd(34), cells.join(''));
  }
  console.log(`\ncoverage sweep, reference scenes found — ${grain} (detection is label-agnostic, so it is the same at both grains):`);
  console.log('arm'.padEnd(34), ['any', '0.25', '0.5'].map((c) => `c=${c}`.padStart(12)).join(''));
  for (const name of armNames) {
    const cells = ['any', '0.25', '0.5'].map((c) => { const d = pooled[name].result.detection[c]; return `${Math.round(d.found)}/${Math.round(d.refs)} ${pct(d.found / d.refs)}`.padStart(12); });
    console.log(name.padEnd(34), cells.join(''));
  }
  console.log(`\ncalm controls hit at overlap > {0 s, 5 s, 10 s} — ${grain}:`);
  for (const name of armNames) console.log(' ', name.padEnd(34), ['0', '5000', '10000'].map((t) => `${Math.round(pooled[name].result.controls[t].hit)}/${Math.round(pooled[name].result.controls[t].total)}`.padStart(8)).join(''));

  console.log(`\ntext-visible labels only (reference labels marked visual_only become don't-care) — ${grain}:`);
  const textOnly = {};
  for (const name of ['jev labels, LOFO per-label', 'jev finds + sonnet labels', 'BASELINE whole film, all labels']) {
    const res = poolResults(films.map((f, i) => scoreFilm({ film: f.slug, filmEndMs: f.filmEndMs, labelIds, reference: refAt(f, grain), controls: f.controls, predictions: perFilmArms[i].arms[name].preds, options: { ...OPTIONS, textOnly: true } })));
    textOnly[name] = summariseGrid(res.grid[0].perLabel, labelIds);
    console.log(' ', name.padEnd(34), `right ${pct(textOnly[name].micro.precision)}  found ${pct(textOnly[name].micro.recall)}  F1 ${pct(textOnly[name].micro.f1)}`);
  }

  console.log(`\nPER FILM — ${grain}`);
  for (const pf of perFilmArms) {
    console.log(`\n  ${pf.slug}`);
    console.log(' ', HEAD);
    for (const name of armNames) console.log(' ', row(name, pf.arms[name].result, pf.arms[name]));
  }

  console.log(`\nper-label detail, ${grain}, pooled, tolerance 0 (reference scenes carrying the label in brackets):`);
  const refCount = Object.fromEntries(labelIds.map((id) => [id, films.reduce((s, f) => s + refAt(f, grain).filter((g) => g.labels.has(id)).length, 0)]));
  for (const id of labelIds) {
    const j = prf(pooled['jev labels, LOFO per-label'].result.grid[0].perLabel[id]);
    const s = prf(pooled['jev finds + sonnet labels'].result.grid[0].perLabel[id]);
    if (!refCount[id] && j.tp + j.fp === 0 && s.tp + s.fp === 0) continue;
    console.log(' ', `${id} [${refCount[id]}]`.padEnd(30), `jev F1 ${pct(j.f1)} (P ${pct(j.precision)} R ${pct(j.recall)})   sonnet F1 ${pct(s.f1)} (P ${pct(s.precision)} R ${pct(s.recall)})`);
  }

  out.films[grain] = {
    labelIds,
    lofoThresholds: lofo,
    refScenesPerLabel: refCount,
    pooled: Object.fromEntries(armNames.map((n) => [n, { headline: headline(pooled[n].result), labelled: pooled[n].labelled, grid: Object.fromEntries(Object.keys(pooled[n].result.grid).map((N) => [N, summariseGrid(pooled[n].result.grid[N].perLabel, labelIds)])), anyGrid: Object.fromEntries(Object.keys(pooled[n].result.anyGrid).map((N) => [N, prf(pooled[n].result.anyGrid[N].perLabel.any)])), perLabel: pooled[n].result.grid[0].perLabel, detection: pooled[n].result.detection, overreach: pooled[n].result.overreach, controls: pooled[n].result.controls }])),
    textOnly,
    perFilm: Object.fromEntries(perFilmArms.map((pf) => [pf.slug, Object.fromEntries(armNames.map((n) => [n, { headline: headline(pf.arms[n].result), grid: summariseGrid(pf.arms[n].result.grid[0].perLabel, labelIds), detection: pf.arms[n].result.detection, overreach: pf.arms[n].result.overreach, controls: pf.arms[n].result.controls }]))])),
  };

  // severity agreement (only where both sides carry severities)
  console.log(`\nseverity agreement on matched scenes — ${grain} (reference 0-3 per band):`);
  const sev = {};
  for (const name of armNames) {
    const pairs = poolResults(perFilmArms.map((p) => p.arms[name].result)).severity;
    const stat = {};
    for (const [band, list] of Object.entries(pairs)) {
      if (!list.length) continue;
      const n = list.length;
      const mae = list.reduce((s, [a, b]) => s + Math.abs(a - b), 0) / n;
      stat[band] = { n, mae, spearman: spearman(list) };
    }
    if (Object.keys(stat).length) {
      sev[name] = stat;
      const scale = perFilmArms[0].arms[name].severityScale ?? 'n/a';
      console.log(' ', name.padEnd(34), Object.entries(stat).map(([b, s]) => `${b}: n=${s.n} MAE ${num(s.mae, 2, 4)} rho ${num(s.spearman, 2, 5)}`).join('   '), ` [${scale}]`);
    }
  }
  out.films[grain].severity = sev;
}

function spearman(list) {
  const rank = (vals) => {
    const idx = vals.map((v, i) => [v, i]).sort((a, b) => a[0] - b[0]);
    const r = new Array(vals.length);
    for (let i = 0; i < idx.length;) { let j = i; while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++; const avg = (i + j) / 2 + 1; for (let k = i; k <= j; k++) r[idx[k][1]] = avg; i = j + 1; }
    return r;
  };
  const rx = rank(list.map((p) => p[0]));
  const ry = rank(list.map((p) => p[1]));
  const n = list.length;
  if (n < 2) return null;
  const mx = rx.reduce((a, b) => a + b, 0) / n;
  const my = ry.reduce((a, b) => a + b, 0) / n;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) { sxy += (rx[i] - mx) * (ry[i] - my); sxx += (rx[i] - mx) ** 2; syy += (ry[i] - my) ** 2; }
  return sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : null;
}

// ---------------------------------------------------------------------------------------------
// Finding Nemo: gold.json (12 legacy categories) against everything in runs/
// ---------------------------------------------------------------------------------------------
const sdh = loadTrack('sdh');
const db = loadTrack('db');
const nemoCue = new Map(sdh.cues.map((c) => [c.id, c]));
const nemoEndMs = sdh.cues[sdh.cues.length - 1].endMs;
function trackOffsetMs() {
  const norm = (s) => s.toLowerCase().replace(/[^a-z ]/g, '').trim();
  const index = new Map();
  for (const c of db.cues) { const k = norm(c.text); if (k.length > 25) index.set(k, index.has(k) ? null : c); }
  const diffs = sdh.cues.map((c) => [c, index.get(norm(c.text))]).filter(([, m]) => m).map(([c, m]) => c.startMs - m.startMs).sort((a, b) => a - b);
  return diffs[Math.floor(diffs.length / 2)];
}
const offsetMs = trackOffsetMs();

const nemoAll = JSON.parse(fs.readFileSync(path.join(here, 'gold.json'), 'utf8')).map((g) => ({
  ...g, startMs: nemoCue.get(g.start_cue).startMs, endMs: nemoCue.get(g.end_cue).endMs,
  labels: new Set(g.categories), visualOnly: new Set(),
}));
const nemoRef = nemoAll.filter((g) => !g.control);
const nemoControls = nemoAll.filter((g) => g.control);

// the three saved run shapes (see compare.js normalise)
function nemoPreds(run) {
  const shift = run.track === 'db' ? offsetMs : 0;
  let preds;
  if (run.windows) preds = run.windows.map((w) => ({ startMs: w.startMs, endMs: w.endMs, labels: new Set(flaggedCategories(w, DEFAULT_POLICY)), severity: w.severity })).filter((p) => p.labels.size);
  else if (run.events) preds = run.events.filter((e) => e.validCues && e.severity > 0).map((e) => ({ startMs: e.startMs, endMs: e.endMs, labels: new Set(e.categories), severity: e.severity }));
  else preds = run.scenes.filter((s) => s.claude.is_real_trigger && s.claude.severity > 0).map((s) => ({ startMs: s.startMs, endMs: s.endMs, labels: new Set(s.claude.categories), severity: s.claude.severity }));
  return preds.map((p) => ({ ...p, startMs: p.startMs + shift, endMs: p.endMs + shift })).sort((a, b) => a.startMs - b.startMs);
}

const nemoRuns = fs.readdirSync(path.join(here, 'runs')).filter((f) => f.endsWith('.json')).sort()
  .map((f) => ({ file: f, run: JSON.parse(fs.readFileSync(path.join(here, 'runs', f), 'utf8')) }));
const nemoBeats = nemoRuns.find((r) => r.run.arm === 'jev-v3-universal' && r.run.label === 'r1').run.windows;

const nemoArms = {};
for (const { file, run } of nemoRuns) {
  const preds = nemoPreds(run);
  nemoArms[`${run.arm} ${run.label ?? ''} (${run.track})`.trim()] = { preds, result: scoreFilm({ film: 'nemo', filmEndMs: nemoEndMs, labelIds: CATEGORY_IDS, reference: nemoRef, controls: nemoControls, predictions: preds, options: OPTIONS }), file };
}
nemoArms['BASELINE whole film, all labels'] = { preds: baselineWholeFilm(nemoEndMs, CATEGORY_IDS) };
nemoArms['BASELINE every beat, all labels'] = { preds: baselineEveryUnit(nemoBeats, CATEGORY_IDS) };
nemoArms['BASELINE nothing flagged'] = { preds: baselineNothing() };
for (const name of ['BASELINE whole film, all labels', 'BASELINE every beat, all labels', 'BASELINE nothing flagged']) {
  nemoArms[name].result = scoreFilm({ film: 'nemo', filmEndMs: nemoEndMs, labelIds: CATEGORY_IDS, reference: nemoRef, controls: nemoControls, predictions: nemoArms[name].preds, options: OPTIONS });
}
for (const [name, src] of [['BASELINE random ~ jev-v3', 'jev-v3-universal r1 (sdh)'], ['BASELINE random ~ sonnet-whole', 'sonnet-5-whole r1 (sdh)']]) {
  const profile = matchProfile(nemoArms[src].preds, CATEGORY_IDS);
  const draws = [...Array(RANDOM_DRAWS)].map((_, i) => scoreFilm({ film: 'nemo', filmEndMs: nemoEndMs, labelIds: CATEGORY_IDS, reference: nemoRef, controls: nemoControls, predictions: baselineRandomMatched({ filmEndMs: nemoEndMs, profile, labelIds: CATEGORY_IDS, rng: mulberry32(2000 + i) }), options: OPTIONS }));
  nemoArms[name] = { result: { ...poolResults(draws, { divideBy: RANDOM_DRAWS }), film: 'nemo', labelIds: CATEGORY_IDS } };
}

console.log(`\n\n=== FINDING NEMO — ${CATEGORY_IDS.length} legacy categories, ${nemoRef.length} reference scenes, ${nemoControls.length} controls ===`);
console.log(HEAD);
for (const [name, a] of Object.entries(nemoArms)) console.log(row(name, a.result));
console.log('\nnemo tolerance sweep, micro label F1:');
for (const [name, a] of Object.entries(nemoArms)) console.log(' ', name.padEnd(34), [0, 5, 10, 15].map((n) => pct(summariseGrid(a.result.grid[n].perLabel, CATEGORY_IDS).micro.f1, 6)).join(''));
console.log('\nnemo severity agreement (single reference severity 0-3):');
for (const [name, a] of Object.entries(nemoArms)) {
  const list = a.result.severity.single ?? [];
  if (list.length) console.log(' ', name.padEnd(34), `n=${list.length} MAE ${num(list.reduce((s, [x, y]) => s + Math.abs(x - y), 0) / list.length, 2, 4)} rho ${num(spearman(list), 2, 5)}`);
}

out.nemo = {
  labelIds: CATEGORY_IDS, refScenes: nemoRef.length, controls: nemoControls.length, trackOffsetMs: offsetMs,
  arms: Object.fromEntries(Object.entries(nemoArms).map(([n, a]) => [n, {
    file: a.file ?? null, headline: headline(a.result),
    grid: Object.fromEntries(Object.keys(a.result.grid).map((N) => [N, summariseGrid(a.result.grid[N].perLabel, CATEGORY_IDS)])),
    anyGrid: Object.fromEntries(Object.keys(a.result.anyGrid).map((N) => [N, prf(a.result.anyGrid[N].perLabel.any)])),
    perLabel: a.result.grid[0].perLabel, detection: a.result.detection, overreach: a.result.overreach, controls: a.result.controls,
    severity: a.result.severity.single ? { n: a.result.severity.single.length, mae: a.result.severity.single.reduce((s, [x, y]) => s + Math.abs(x - y), 0) / a.result.severity.single.length, spearman: spearman(a.result.severity.single) } : null,
  }])),
};

// the random baselines pool 20 draws, so their missed-scene / control-id lists are long and useless
const trim = (v) => (Array.isArray(v) && v.length > 200 ? [...v.slice(0, 200), `...${v.length - 200} more`] : v);
fs.mkdirSync(path.join(here, 'rescore'), { recursive: true });
fs.writeFileSync(path.join(here, 'rescore', 'results.json'), JSON.stringify(out, (k, v) => trim(v), 2));
console.log(`\nwrote rescore/results.json`);
