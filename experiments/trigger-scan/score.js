// Pure scoring module: scores any analyzer's output against a reference list on SHARED UNITS.
// No I/O. Callers pass normalised data; every measure is returned as raw counts so that films can
// be pooled by summing and the derived rates recomputed (see poolResults).
//
// Prediction: { startMs, endMs, labels: Set<string> | string[], severity?: number | {band: number} }
// Reference:  { id, startMs, endMs, labels, visualOnly?, severity?: number | {band: number},
//               control?: boolean }
//
// Why this exists: the old scorers counted found labels per reference label but false labels per run
// of consecutive predictions, and never charged for over-long predictions. One prediction spanning a
// whole film and carrying every label scored ~99% "right" / 100% "found". See METRICS.md.

// ---------------------------------------------------------------------------------------------
// interval helpers
// ---------------------------------------------------------------------------------------------
export const asSet = (x) => (x instanceof Set ? x : new Set(x ?? []));

export function unionIntervals(list, gapMs = 0) {
  const sorted = list.map((i) => [i.startMs, i.endMs]).sort((a, b) => a[0] - b[0]);
  const out = [];
  for (const [s, e] of sorted) {
    const last = out[out.length - 1];
    if (last && s <= last[1] + gapMs) last[1] = Math.max(last[1], e);
    else out.push([s, e]);
  }
  return out;
}
export const totalLength = (u) => u.reduce((s, [a, b]) => s + Math.max(0, b - a), 0);
export function intersectLength(u1, u2) {
  let total = 0;
  for (const [a, b] of u1) for (const [c, d] of u2) total += Math.max(0, Math.min(b, d) - Math.max(a, c));
  return total;
}
const overlapMs = (a, b) => Math.min(a.endMs, b.endMs) - Math.max(a.startMs, b.startMs);

export function prf({ tp, fp, fn }) {
  const precision = tp + fp > 0 ? tp / (tp + fp) : null;
  const recall = tp + fn > 0 ? tp / (tp + fn) : null;
  const f1 = precision !== null && recall !== null && precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : precision === null && recall === null ? null : 0;
  return { tp, fp, fn, precision, recall, f1 };
}

// ---------------------------------------------------------------------------------------------
// defaults
// ---------------------------------------------------------------------------------------------
export const DEFAULT_OPTIONS = {
  binMs: 5000, // time-grid resolution
  toleranceS: [0, 5, 10, 15], // don't-care margin around reference scene edges
  coverage: ['any', 0.25, 0.5], // fraction of a reference scene predictions must cover to "find" it
  controlOverlapMs: [0, 5000, 10000], // a calm control is hit if a prediction overlaps MORE than this
  seriousMin: 2, // reference severity (0-3) counting as a serious scene
  mergeGapMs: 0, // gap allowed when merging predictions into stretches for the overreach report
  textOnly: false, // exclude reference labels marked visual_only (they become don't-care, not negatives)
};

// ---------------------------------------------------------------------------------------------
// time-grid label scoring
// ---------------------------------------------------------------------------------------------
// The film timeline is cut into fixed bins. A bin is reference-positive for label L if a reference
// scene carrying L covers it, prediction-positive if a prediction carrying L covers it. "Covers"
// means any overlap with the bin, so a reference scene shorter than one bin still occupies one bin.
//
// Tolerance policy (documented in METRICS.md): reference boundaries are fuzzy, so with a margin of
// N seconds we only trust the CORE of each reference scene, [start+N, end-N], and treat the band
// [start-N, start+N] u [end-N, end+N] as don't-care: those bins count neither for nor against,
// unless they fall inside the core of some other reference scene carrying the same label. A scene
// shorter than 2N has no core and disappears from that label's scoring entirely; `refBins` and
// `dontCareBins` are reported so that erosion is visible.
function markBins(arr, startMs, endMs, binMs, nBins) {
  if (endMs <= startMs) endMs = startMs + 1; // a zero-length interval still occupies its bin
  const a = Math.max(0, Math.floor(startMs / binMs));
  const b = Math.min(nBins - 1, Math.ceil(endMs / binMs) - 1);
  for (let i = a; i <= b; i++) arr[i] = 1;
}

export function gridScore({ reference, predictions, labelIds, filmEndMs, binMs, toleranceS, textOnly }) {
  const nBins = Math.max(1, Math.ceil(filmEndMs / binMs));
  const predBins = new Map(labelIds.map((id) => [id, new Uint8Array(nBins)]));
  for (const p of predictions) {
    for (const id of p.labels) {
      const arr = predBins.get(id);
      if (arr) markBins(arr, p.startMs, p.endMs, binMs, nBins);
    }
  }
  const byTolerance = {};
  for (const N of toleranceS) {
    const tol = N * 1000;
    const perLabel = {};
    for (const id of labelIds) {
      const core = new Uint8Array(nBins);
      const band = new Uint8Array(nBins);
      for (const g of reference) {
        if (!g.labels.has(id)) continue;
        if (textOnly && g.visualOnly.has(id)) {
          // the reference says this label is there but invisible in the subtitles: don't-care, not a negative
          markBins(band, g.startMs - tol, g.endMs + tol, binMs, nBins);
          continue;
        }
        if (g.endMs - g.startMs > 2 * tol) markBins(core, g.startMs + tol, g.endMs - tol, binMs, nBins);
        if (tol > 0) {
          markBins(band, g.startMs - tol, g.startMs + tol, binMs, nBins);
          markBins(band, g.endMs - tol, g.endMs + tol, binMs, nBins);
        }
      }
      const pred = predBins.get(id);
      let tp = 0, fp = 0, fn = 0, tn = 0, dc = 0, refB = 0;
      for (let i = 0; i < nBins; i++) {
        if (core[i]) refB++;
        if (band[i] && !core[i]) { dc++; continue; }
        if (core[i]) (pred[i] ? tp++ : fn++);
        else (pred[i] ? fp++ : tn++);
      }
      perLabel[id] = { tp, fp, fn, tn, dontCare: dc, refBins: refB };
    }
    byTolerance[N] = { perLabel, nBins };
  }
  return byTolerance;
}

// micro = pool counts over labels; macro = mean per-label F1 over labels with reference positives.
export function summariseGrid(perLabel, labelIds = Object.keys(perLabel)) {
  const micro = prf(labelIds.reduce((s, id) => ({ tp: s.tp + perLabel[id].tp, fp: s.fp + perLabel[id].fp, fn: s.fn + perLabel[id].fn }), { tp: 0, fp: 0, fn: 0 }));
  const scored = labelIds.filter((id) => perLabel[id].tp + perLabel[id].fn > 0);
  const avg = (f) => (scored.length ? scored.reduce((s, id) => s + (f(prf(perLabel[id])) ?? 0), 0) / scored.length : null);
  return {
    micro,
    macro: { precision: avg((r) => r.precision), recall: avg((r) => r.recall), f1: avg((r) => r.f1), labels: scored.length },
    dontCareBins: labelIds.reduce((s, id) => s + perLabel[id].dontCare, 0),
    refBins: labelIds.reduce((s, id) => s + perLabel[id].refBins, 0),
    totalBins: labelIds.reduce((s, id) => s + perLabel[id].tp + perLabel[id].fp + perLabel[id].fn + perLabel[id].tn + perLabel[id].dontCare, 0),
  };
}

// ---------------------------------------------------------------------------------------------
// event-level detection that breadth cannot game, plus overreach
// ---------------------------------------------------------------------------------------------
const bandsOf = (sev) => (sev == null ? {} : typeof sev === 'number' ? { single: sev } : sev);
const maxSeverity = (sev) => { const v = Object.values(bandsOf(sev)); return v.length ? Math.max(...v) : null; };

export function detectionScore({ reference, predictions, coverage, seriousMin }) {
  const predU = unionIntervals(predictions);
  const covered = reference.map((g) => {
    const dur = Math.max(1, g.endMs - g.startMs);
    return { id: g.id, dur, covMs: intersectLength(predU, [[g.startMs, g.endMs]]), serious: (maxSeverity(g.severity) ?? 0) >= seriousMin };
  });
  const out = {};
  for (const c of coverage) {
    const hit = (x) => (c === 'any' ? x.covMs > 0 : x.covMs / x.dur >= c);
    const serious = covered.filter((x) => x.serious);
    out[String(c)] = {
      refs: covered.length,
      found: covered.filter(hit).length,
      seriousRefs: serious.length,
      seriousFound: serious.filter(hit).length,
      missed: covered.filter((x) => !hit(x)).map((x) => x.id),
    };
  }
  return out;
}

export function overreachScore({ reference, predictions, filmEndMs, mergeGapMs }) {
  const refU = unionIntervals(reference);
  const refMs = totalLength(refU);
  const stats = (preds) => {
    const u = unionIntervals(preds);
    const flaggedMs = totalLength(u);
    const perPred = preds.map((p) => reference.filter((g) => overlapMs(p, g) > 0).length);
    return {
      count: preds.length,
      flaggedMs,
      insideRefMs: intersectLength(u, refU),
      longestMs: preds.length ? Math.max(...preds.map((p) => p.endMs - p.startMs)) : 0,
      refScenesPerPrediction: { mean: preds.length ? perPred.reduce((a, b) => a + b, 0) / preds.length : 0, max: preds.length ? Math.max(...perPred) : 0 },
    };
  };
  return {
    filmMs: filmEndMs,
    refMs,
    asGiven: stats(predictions),
    merged: stats(unionIntervals(predictions, mergeGapMs).map(([s, e]) => ({ startMs: s, endMs: e }))),
  };
}

export function controlScore({ controls, predictions, controlOverlapMs }) {
  const out = {};
  for (const thr of controlOverlapMs) {
    const hit = controls.filter((c) => predictions.some((p) => overlapMs(p, c) > thr));
    out[String(thr)] = { total: controls.length, hit: hit.length, ids: hit.map((c) => c.id) };
  }
  return out;
}

// Severity: for each reference scene that any prediction overlaps, the predicted severity is the
// maximum over overlapping predictions. Pairs are returned so pooled correlations can be recomputed.
export function severityPairs({ reference, predictions }) {
  const out = {};
  for (const g of reference) {
    const hits = predictions.filter((p) => overlapMs(p, g) > 0 && p.severity != null);
    if (!hits.length) continue;
    const refB = bandsOf(g.severity);
    for (const band of Object.keys(refB)) {
      const vals = hits.map((h) => bandsOf(h.severity)[band]).filter((v) => v != null);
      if (!vals.length) continue;
      (out[band] ??= []).push([refB[band], Math.max(...vals)]);
    }
  }
  return out;
}

export function severityStats(pairs) {
  const out = {};
  for (const [band, list] of Object.entries(pairs)) {
    if (!list.length) continue;
    const n = list.length;
    const mae = list.reduce((s, [a, b]) => s + Math.abs(a - b), 0) / n;
    out[band] = { n, mae, pearson: pearson(list), spearman: pearson(rankPairs(list)) };
  }
  return out;
}
function pearson(list) {
  const n = list.length;
  if (n < 2) return null;
  const mx = list.reduce((s, p) => s + p[0], 0) / n;
  const my = list.reduce((s, p) => s + p[1], 0) / n;
  let sxy = 0, sxx = 0, syy = 0;
  for (const [x, y] of list) { sxy += (x - mx) * (y - my); sxx += (x - mx) ** 2; syy += (y - my) ** 2; }
  return sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : null;
}
function rankPairs(list) {
  const rank = (vals) => {
    const idx = vals.map((v, i) => [v, i]).sort((a, b) => a[0] - b[0]);
    const r = new Array(vals.length);
    for (let i = 0; i < idx.length;) {
      let j = i;
      while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++;
      const avg = (i + j) / 2 + 1;
      for (let k = i; k <= j; k++) r[idx[k][1]] = avg;
      i = j + 1;
    }
    return r;
  };
  const rx = rank(list.map((p) => p[0]));
  const ry = rank(list.map((p) => p[1]));
  return list.map((_, i) => [rx[i], ry[i]]);
}

// ---------------------------------------------------------------------------------------------
// one film
// ---------------------------------------------------------------------------------------------
export const ANY_IDS = ['any'];
const ANY_SET = new Set(ANY_IDS);
const EMPTY_SET = new Set();

export function scoreFilm({ film, filmEndMs, labelIds, reference, controls = [], predictions, options = {} }) {
  const o = { ...DEFAULT_OPTIONS, ...options };
  const ref = reference.map((g) => ({ ...g, labels: asSet(g.labels), visualOnly: asSet(g.visualOnly) }));
  const preds = predictions.map((p) => ({ ...p, labels: asSet(p.labels) }));
  return {
    film,
    filmEndMs,
    labelIds,
    binMs: o.binMs,
    grid: gridScore({ reference: ref, predictions: preds, labelIds, filmEndMs, binMs: o.binMs, toleranceS: o.toleranceS, textOnly: o.textOnly }),
    // label-agnostic time grid: "is anything flagged here at all". This is the breadth-proof
    // headline for finding scenes: recall alone can always be bought by flagging everything.
    anyGrid: gridScore({
      reference: ref.map((g) => ({ ...g, labels: ANY_SET, visualOnly: EMPTY_SET })),
      predictions: preds.map((p) => ({ ...p, labels: ANY_SET })),
      labelIds: ANY_IDS, filmEndMs, binMs: o.binMs, toleranceS: o.toleranceS, textOnly: false,
    }),
    detection: detectionScore({ reference: ref, predictions: preds, coverage: o.coverage, seriousMin: o.seriousMin }),
    overreach: overreachScore({ reference: ref, predictions: preds, filmEndMs, mergeGapMs: o.mergeGapMs }),
    controls: controlScore({ controls, predictions: preds, controlOverlapMs: o.controlOverlapMs }),
    severity: severityPairs({ reference: ref, predictions: preds }),
  };
}

// ---------------------------------------------------------------------------------------------
// pooling: sum counts across films (or across random draws) and recompute the rates
// ---------------------------------------------------------------------------------------------
export function poolResults(results, { divideBy = 1 } = {}) {
  if (!results.length) return null;
  const labelIds = results[0].labelIds;
  const first = results[0];
  const grid = {};
  for (const N of Object.keys(first.grid)) {
    const perLabel = Object.fromEntries(labelIds.map((id) => [id, { tp: 0, fp: 0, fn: 0, tn: 0, dontCare: 0, refBins: 0 }]));
    for (const r of results) for (const id of labelIds) for (const k of ['tp', 'fp', 'fn', 'tn', 'dontCare', 'refBins']) perLabel[id][k] += r.grid[N].perLabel[id][k] / divideBy;
    grid[N] = { perLabel };
  }
  const anyGrid = {};
  for (const N of Object.keys(first.anyGrid)) {
    const perLabel = { any: { tp: 0, fp: 0, fn: 0, tn: 0, dontCare: 0, refBins: 0 } };
    for (const r of results) for (const k of ['tp', 'fp', 'fn', 'tn', 'dontCare', 'refBins']) perLabel.any[k] += r.anyGrid[N].perLabel.any[k] / divideBy;
    anyGrid[N] = { perLabel };
  }
  const detection = {};
  for (const c of Object.keys(first.detection)) {
    detection[c] = ['refs', 'found', 'seriousRefs', 'seriousFound'].reduce((acc, k) => ({ ...acc, [k]: results.reduce((s, r) => s + r.detection[c][k], 0) / divideBy }), {});
    detection[c].missed = results.flatMap((r) => r.detection[c].missed.map((id) => `${r.film}:${id}`));
  }
  const sumShape = (pick) => ({
    count: results.reduce((s, r) => s + pick(r).count, 0) / divideBy,
    flaggedMs: results.reduce((s, r) => s + pick(r).flaggedMs, 0) / divideBy,
    insideRefMs: results.reduce((s, r) => s + pick(r).insideRefMs, 0) / divideBy,
    longestMs: Math.max(...results.map((r) => pick(r).longestMs)),
    refScenesPerPrediction: {
      mean: results.reduce((s, r) => s + pick(r).refScenesPerPrediction.mean * pick(r).count, 0) / Math.max(1, results.reduce((s, r) => s + pick(r).count, 0)),
      max: Math.max(...results.map((r) => pick(r).refScenesPerPrediction.max)),
    },
  });
  const overreach = {
    filmMs: results.reduce((s, r) => s + r.overreach.filmMs, 0) / divideBy,
    refMs: results.reduce((s, r) => s + r.overreach.refMs, 0) / divideBy,
    asGiven: sumShape((r) => r.overreach.asGiven),
    merged: sumShape((r) => r.overreach.merged),
  };
  const controls = {};
  for (const thr of Object.keys(first.controls)) {
    controls[thr] = { total: results.reduce((s, r) => s + r.controls[thr].total, 0) / divideBy, hit: results.reduce((s, r) => s + r.controls[thr].hit, 0) / divideBy, ids: results.flatMap((r) => r.controls[thr].ids.map((id) => `${r.film}:${id}`)) };
  }
  const severity = {};
  for (const r of results) for (const [band, list] of Object.entries(r.severity)) (severity[band] ??= []).push(...list);
  return { film: 'POOLED', labelIds, grid, anyGrid, detection, overreach, controls, severity, films: results.map((r) => r.film) };
}

// Headline numbers for one result (pooled or per film).
export function headline(result, { tolerance = 0, coverage = '0.5' } = {}) {
  const g = summariseGrid(result.grid[tolerance].perLabel, result.labelIds);
  const d = result.detection[coverage];
  const o = result.overreach;
  const ctrl = result.controls['5000'] ?? Object.values(result.controls)[0];
  const a = prf(result.anyGrid[tolerance].perLabel.any);
  return {
    anyPrecision: a.precision,
    anyRecall: a.recall,
    anyF1: a.f1,
    labelPrecision: g.micro.precision,
    labelRecall: g.micro.recall,
    labelF1: g.micro.f1,
    macroF1: g.macro.f1,
    sceneRecall: d.refs ? d.found / d.refs : null,
    seriousRecall: d.seriousRefs ? d.seriousFound / d.seriousRefs : null,
    flaggedMin: o.merged.flaggedMs / 60000,
    refMin: o.refMs / 60000,
    shareInsideRef: o.merged.flaggedMs ? o.merged.insideRefMs / o.merged.flaggedMs : null,
    refPerPrediction: o.merged.refScenesPerPrediction.mean,
    maxRefPerPrediction: o.merged.refScenesPerPrediction.max,
    longestPredictionMin: o.merged.longestMs / 60000,
    controlsHit: ctrl.hit,
    controlsTotal: ctrl.total,
  };
}

// ---------------------------------------------------------------------------------------------
// sanity baselines: any acceptable measure must make these lose clearly
// ---------------------------------------------------------------------------------------------
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// (a) one prediction spanning the whole film, carrying every label
export const baselineWholeFilm = (filmEndMs, labelIds) => [{ startMs: 0, endMs: filmEndMs, labels: new Set(labelIds) }];
// (b) every unit (beat) flagged with every label
export const baselineEveryUnit = (units, labelIds) => units.map((u) => ({ startMs: u.startMs, endMs: u.endMs, labels: new Set(labelIds) }));
// (c) nothing flagged
export const baselineNothing = () => [];

// (d) random predictor matched to an analyzer's flagged-time share and per-label frequency.
// Durations are bootstrapped from the analyzer's own predictions and placed uniformly at random
// until the flagged time matches; each prediction carries label L with the analyzer's frequency for L.
export function matchProfile(predictions, labelIds) {
  const n = Math.max(1, predictions.length);
  return {
    targetFlaggedMs: totalLength(unionIntervals(predictions)),
    durations: predictions.map((p) => Math.max(1, p.endMs - p.startMs)),
    labelProbs: Object.fromEntries(labelIds.map((id) => [id, predictions.filter((p) => asSet(p.labels).has(id)).length / n])),
    count: predictions.length,
  };
}
export function baselineRandomMatched({ filmEndMs, profile, labelIds, rng }) {
  const { targetFlaggedMs, durations, labelProbs } = profile;
  if (!durations.length || targetFlaggedMs <= 0) return [];
  const out = [];
  let guard = 0;
  while (totalLength(unionIntervals(out)) < targetFlaggedMs && guard++ < 10000) {
    const dur = Math.min(durations[Math.floor(rng() * durations.length)], filmEndMs);
    const startMs = Math.floor(rng() * Math.max(1, filmEndMs - dur));
    out.push({ startMs, endMs: startMs + dur, labels: new Set(labelIds.filter((id) => rng() < labelProbs[id])) });
  }
  return out;
}
