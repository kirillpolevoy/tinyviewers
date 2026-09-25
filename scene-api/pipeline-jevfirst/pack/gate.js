// v7 SEGMENTATION VALIDITY GATE. Pure code, no I/O, no model calls (check-split.js sends the Jev
// requests built here; segment.js runs the gate and retries once on failure).
//
// Round-2 finding: Sonnet's Wild Robot segmentation broke (21 model scenes for ~102 min, boundaries at
// round numbers, scenes numbered past the last cue, 70% of its cited lines outside their own scene,
// 21/39 sentences dropped) and nothing stopped it, so every later step inherited 5-16 minute scenes.
// Two layers decide whether a segmentation is usable:
//
//   A1 CODE CHECKS (codeChecks): computed from the model's own scenes before any repair --
//      cited_outside_share   L-cites of scene sentences that fall outside the sentence's own scene
//      scenes_per_10_min     scenes after coverage repair per 10 minutes of film
//      max_scene_minutes     the longest scene (dialogue bounds), v10.1: its part outside the end credits
//      overshoot_cues        how far the model's cue numbers run past the last cue
//      repaired_share        cues whose scene coverage repair changed (gaps, overlaps, head, tail) / all cues
//      dropped_share         scene sentences left with no valid cite in their own scene
//
//   A2 JEV AS THE VALIDATOR (jev-1.13.0; built here, sent by check-split.js):
//      alignment  per scene, the documented citation-check shape: state {scene lines, the model's
//                 summary sentences for that scene}; one Choice supports / contradicts / says_nothing
//                 per sentence ("do these lines show what this sentence describes?")
//      boundary   per scene boundary, a Noul over a window of lines on both sides: "Does a new scene
//                 start at line L<n> -- a change of place, time, or who is present?" A boundary Jev
//                 rejects confidently (p < merge_below) is a MERGE candidate.
//      probe      inside every scene, the same Noul at its largest silence (a CONTROL), and in long
//                 scenes one more per probe.every_min minutes. A confident yes (p >= split_at) is an
//                 unmarked scene change: a SPLIT candidate.
//      film metrics: aligned_share, unaligned_scene_share, boundary_auc (does Jev see the model's
//      boundaries as scene changes more often than the silences inside its scenes? the Mann-Whitney
//      AUC of boundary p vs probe p; ~0.5 = the boundaries are no better than arbitrary points),
//      merge / split candidates (reported per boundary and scene, not gated: the v6 prompt cuts at the
//      onset of a danger inside one place on purpose, so a boundary with no change of place, time or
//      people is often a policy cut, not an error).
//
// Thresholds live in policy.json split_gate and were set on the round-2 dev segmentations only
// (nemo, monsters-inc, lion-king, frankenweenie must pass; round-2 wild-robot must fail); see
// policy.json split_gate._about for the numbers they were set from.

import { repairCoverage } from './validate.js';
import { checkCites } from './cite.js';
import { nonCreditMinutes } from './credits.js';

// v10.1: max_scene_minutes is measured on each scene's part OUTSIDE the end-credits span (credits.js), which
// check-split.js passes as ctx.credits. Round 6: Frozen's and Zootopia's accepted-looking splits were rejected
// only because the last model scene ran into a 9-10 minute credits roll.
export const SPLIT_VERSION = 'splitcheck-v10.1';
export const MODEL = 'jev-1.13.0';
const r3 = (x) => (x == null || !Number.isFinite(x) ? null : Math.round(x * 1000) / 1000);
const pad2 = (n) => String(n).padStart(2, '0');
/** 'HH:MM:SS' for ms. */
export const hms = (ms) => { const s = Math.floor(ms / 1000); return `${pad2(Math.floor(s / 3600))}:${pad2(Math.floor((s % 3600) / 60))}:${pad2(s % 60)}`; };
/** One subtitle line as Jev reads it: 'L412 [00:31:05] text'. */
export const lineText = (c) => `L${c.index} [${hms(c.startMs)}] ${c.text}`;

// ---- A1: code checks -----------------------------------------------------------------------------

/**
 * Metrics of one model segmentation. `modelScenes` = the model's scenes exactly as returned
 * ({start_cue, end_cue, sentences:[{text, cites}]}); `cues` = the parsed SRT; ctx = {wCount, tCount}.
 * Returns { metrics, covered, repairs } (covered = the scenes after coverage repair, model fields kept).
 */
export function codeMetrics(modelScenes, cues, ctx = {}) {
  const N = cues.length;
  let lineCites = 0; let outside = 0; let sentences = 0; let dropped = 0;
  for (const s of modelScenes) {
    for (const x of s.sentences ?? []) {
      sentences++;
      const L = (x.cites ?? []).map((c) => String(c).trim().toUpperCase()).filter((c) => /^L[1-9]\d*$/.test(c)).map((c) => Number(c.slice(1)));
      lineCites += L.length;
      outside += L.filter((n) => n < s.start_cue || n > s.end_cue).length;
      const r = checkCites(x.cites, { nCues: N, wCount: ctx.wCount ?? Infinity, tCount: ctx.tCount ?? Infinity, range: [s.start_cue, s.end_cue] });
      if (!r.ok.length) dropped++;
    }
  }
  const maxCue = Math.max(0, ...modelScenes.flatMap((s) => [s.start_cue, s.end_cue]).filter(Number.isFinite));
  const { scenes: covered, repairs } = repairCoverage(modelScenes, N);
  // cues whose scene the repair changed (gap fill, overlap trim, head / tail extension); the cues of a
  // dropped invalid scene are counted once, by the repair that re-covers them
  const repaired = repairs.reduce((a, r) => a + (r.cues ?? 0), 0);
  const filmMin = cues[N - 1].endMs / 60000;
  const sceneMin = covered.map((s) => (cues[s.end_cue - 1].endMs - cues[s.start_cue - 1].startMs) / 60000);
  const credits = ctx.credits ?? null;
  const sceneMinNc = covered.map((s) => nonCreditMinutes(s, cues, credits));
  const metrics = {
    model_scenes: modelScenes.length,
    scenes: covered.length,
    film_minutes: r3(filmMin),
    scenes_per_10_min: r3((covered.length / filmMin) * 10),
    max_scene_minutes: r3(Math.max(...sceneMinNc)),
    max_scene_minutes_with_credits: r3(Math.max(...sceneMin)),
    credits: credits ? { start_cue: credits.start_cue, end_cue: credits.end_cue, minutes: credits.minutes, how: credits.how } : null,
    median_scene_minutes: r3([...sceneMin].sort((a, b) => a - b)[Math.floor(sceneMin.length / 2)]),
    line_cites: lineCites,
    cited_outside: outside,
    cited_outside_share: lineCites ? r3(outside / lineCites) : 0,
    overshoot_cues: Math.max(0, maxCue - N),
    invalid_scenes: repairs.filter((r) => r.kind === 'dropped_invalid').length,
    repaired_cues: repaired,
    repaired_share: r3(repaired / N),
    sentences,
    sentences_dropped: dropped,
    dropped_share: sentences ? r3(dropped / sentences) : 0,
  };
  return { metrics, covered, repairs };
}

/** Compare metrics with limits: [{ id, value, limit, op, pass }]. `limits` = policy split_gate.code. */
export function evaluate(metrics, limits) {
  const rows = [];
  for (const [id, lim] of Object.entries(limits ?? {})) {
    if (id.startsWith('_')) continue;
    const [op, limit] = Object.entries(lim)[0];
    const value = metrics[id];
    const pass = value == null ? false : op === 'max' ? value <= limit : op === 'min' ? value >= limit : false;
    rows.push({ id, value, op, limit, pass });
  }
  return rows;
}

// ---- A2: Jev requests ------------------------------------------------------------------------------

export const ALIGN_CRITERIA = {
  supports: 'The lines show this happening in this scene: there is dialogue or a sound caption that belongs to the event the sentence describes, with the same characters or things.',
  contradicts: 'The lines show that this cannot be what happens here: throughout them, other characters are in another situation that has nothing to do with the sentence.',
  says_nothing: 'The lines neither show the event nor rule it out: they are about something else only in part, too few, or only music.',
};
const LINES_NOTE = 'The lines are subtitle dialogue and sound captions in order, "L<number> [time] text"; the speaker is usually not named.';

/** One alignment request: the scene's lines and the model's summary sentences for it; one Choice each. */
export function alignmentBody({ film, lines, sentences }) {
  const questions = {};
  sentences.forEach((_, k) => {
    questions[`a${k}`] = {
      type: 'choice',
      instructions: `\`summary[${k}]\` is meant to describe what happens during \`scene.lines\`. How do \`scene.lines\` relate to \`summary[${k}]\`? Judge only from \`scene.lines\`, not from the other summary sentences and not from outside knowledge of the film. ${LINES_NOTE}`,
      criteria: ALIGN_CRITERIA,
    };
  });
  return { model: MODEL, state: { film: { title: film.title }, scene: { lines }, summary: sentences }, questions };
}

export const BOUNDARY_CRITERIA = {
  true: 'The lines from the marked line on belong to a different situation than the lines before it: another place, a later time, or a different group of characters.',
  false: 'The marked line continues the situation of the lines just before it: the same exchange, the same place and the same characters.',
};
/** One boundary / probe request: a window of lines around cue `at`; one Noul. */
export function boundaryBody({ film, window, at }) {
  return {
    model: MODEL,
    state: { film: { title: film.title }, lines: window },
    questions: {
      boundary: {
        type: 'noul',
        instructions: `Does a new scene start at line L${at} in \`lines\` -- a change of place, a jump in time, or a change in who is present? ${LINES_NOTE}`,
        criteria: BOUNDARY_CRITERIA,
      },
    },
  };
}

/** Window of line texts around cue `at` (1-based): `w` lines before it, `w` lines from it on. */
export function boundaryWindow(cues, at, w) {
  const lo = Math.max(1, at - w);
  const hi = Math.min(cues.length, at + w - 1);
  return cues.slice(lo - 1, hi).map(lineText);
}

/**
 * Probe positions inside scenes: cue indices whose preceding silence is among the scene's largest,
 * at least `min_gap_ms`, at least `min_lines` cues from either scene edge and from each other; at
 * most max(min_per_scene, floor(scene minutes / every_min)) per scene (a scene shorter than
 * 2 x min_lines cues gets none). Returns [{ scene, at, gap_ms }].
 */
export function probePositions(scenes, cues, { every_min: everyMin = 2, min_gap_ms: minGap = 0, min_lines: minLines = 8, min_per_scene: minPer = 1 } = {}) {
  const out = [];
  for (const s of scenes) {
    const minutes = (cues[s.end_cue - 1].endMs - cues[s.start_cue - 1].startMs) / 60000;
    const k = Math.max(minPer, Math.floor(minutes / everyMin));
    if (k < 1) continue;
    const cand = [];
    for (let i = s.start_cue + minLines; i <= s.end_cue - minLines + 1; i++) {
      const gap = cues[i - 1].startMs - cues[i - 2].endMs;
      if (gap >= minGap) cand.push({ at: i, gap_ms: gap });
    }
    cand.sort((a, b) => b.gap_ms - a.gap_ms || a.at - b.at);
    const picked = [];
    for (const c of cand) {
      if (picked.length >= k) break;
      if (picked.some((p) => Math.abs(p.at - c.at) < minLines)) continue;
      picked.push(c);
    }
    picked.sort((a, b) => a.at - b.at).forEach((p) => out.push({ scene: s.id, ...p }));
  }
  return out;
}

// ---- fold ------------------------------------------------------------------------------------------

const P = (probs, k) => Number(probs?.[k]) || 0;
/** One alignment answer -> { choice, p_supports, p_contradicts, supported }. */
export function alignVerdict(a, cfg) {
  const ps = P(a?.probabilities, 'supports');
  return { choice: a?.choice ?? null, p_supports: r3(ps), p_contradicts: r3(P(a?.probabilities, 'contradicts')), supported: ps >= cfg.supported_at };
}

/** A boundary p -> 'confirmed' | 'merge_candidate' | 'uncertain'. */
export const boundaryVerdict = (p, cfg) => (p >= cfg.confirmed_at ? 'confirmed' : p < cfg.merge_below ? 'merge_candidate' : 'uncertain');

/**
 * Film-level Jev metrics from the folded answers.
 *   alignment: [{ scene, sentences: [alignVerdict...] }]
 *   boundaries: [{ scene, at, p }]  (the boundary BEFORE `scene`, i.e. at its first cue)
 *   probes: [{ scene, at, p }]
 * filmMinutes: the film's length.
 */
export function jevMetrics({ alignment, boundaries, probes }, filmMinutes, cfg) {
  const sent = alignment.flatMap((a) => a.sentences);
  const scenesAsked = alignment.filter((a) => a.sentences.length);
  const unaligned = scenesAsked.filter((a) => !a.sentences.some((x) => x.supported));
  const merge = boundaries.filter((b) => boundaryVerdict(b.p, cfg) === 'merge_candidate');
  const confirmed = boundaries.filter((b) => boundaryVerdict(b.p, cfg) === 'confirmed');
  const split = probes.filter((p) => p.p >= cfg.split_at);
  const bp = boundaries.map((b) => b.p);
  const pp = probes.map((p) => p.p);
  const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
  return {
    sentences_asked: sent.length,
    sentences_supported: sent.filter((x) => x.supported).length,
    aligned_share: sent.length ? r3(sent.filter((x) => x.supported).length / sent.length) : null,
    scenes_asked: scenesAsked.length,
    scenes_unaligned: unaligned.map((a) => a.scene),
    unaligned_scene_share: scenesAsked.length ? r3(unaligned.length / scenesAsked.length) : null,
    boundaries: boundaries.length,
    boundaries_confirmed: confirmed.length,
    boundary_confirmed_share: boundaries.length ? r3(confirmed.length / boundaries.length) : null,
    boundary_auc: auc(bp, pp),
    mean_boundary_p: r3(mean(bp)),
    mean_probe_p: r3(mean(pp)),
    merge_candidates: merge.map((b) => `L${b.at}`),
    merge_candidate_share: boundaries.length ? r3(merge.length / boundaries.length) : null,
    probes: probes.length,
    split_candidates: split.map((p) => `L${p.at}`),
    split_candidates_per_hour: r3((split.length / filmMinutes) * 60),
  };
}

/** Mann-Whitney AUC: P(a random x from xs > a random y from ys), ties 1/2. null when either is empty. */
export function auc(xs, ys) {
  if (!xs.length || !ys.length) return null;
  let s = 0;
  for (const x of xs) for (const y of ys) s += x > y ? 1 : x === y ? 0.5 : 0;
  return r3(s / (xs.length * ys.length));
}

/** The whole gate: code rows + Jev rows; pass only when every row passes. */
export function gateResult(codeM, jevM, cfg) {
  const code = evaluate(codeM, cfg.code);
  const jev = jevM ? evaluate(jevM, cfg.jev) : [];
  const failed = [...code, ...jev].filter((r) => !r.pass).map((r) => `${r.id} ${r.value} (${r.op} ${r.limit})`);
  return { pass: failed.length === 0 && (!!jevM || cfg.jev_optional === true), code, jev, failed: jevM ? failed : [...failed, ...(cfg.jev_optional ? [] : ['jev check not run'])] };
}

// ---- retry: two overlapping halves ------------------------------------------------------------------

/** The two overlapping parts of a film of n cues: A = 1..mid+ov, B = mid-ov..n. */
export function halves(n, overlap) {
  const mid = Math.round(n / 2);
  const ov = Math.max(1, Math.min(overlap, Math.floor(n / 4)));
  return { mid, overlap: ov, a: [1, mid + ov], b: [mid - ov, n] };
}

/**
 * Merge the scenes of two overlapping halves into one list. `A` covers a[0]..a[1], `B` covers
 * b[0]..b[1] (b[0] < a[1]). The cut is a scene start both halves agree on inside the overlap
 * (closest to mid), else any half's scene start inside the overlap closest to mid, else mid itself.
 * A's scenes before the cut are kept (the last one ends at cut-1); B's scenes from the cut on (the
 * one containing the cut starts at it). Returns { scenes, cut, how }.
 */
export function mergeHalves(A, B, { a, b, mid }) {
  const lo = b[0] + 1; const hi = a[1];
  const inZone = (c) => c >= lo && c <= hi;
  const startsA = new Set(A.map((s) => s.start_cue).filter(inZone));
  const startsB = new Set(B.map((s) => s.start_cue).filter(inZone));
  const closest = (arr) => [...arr].sort((x, y) => Math.abs(x - mid) - Math.abs(y - mid) || x - y)[0];
  const both = [...startsA].filter((c) => startsB.has(c));
  let cut; let how;
  if (both.length) { cut = closest(both); how = 'agreed_boundary'; }
  else if (startsA.size || startsB.size) { cut = closest(new Set([...startsA, ...startsB])); how = 'one_half_boundary'; }
  else { cut = mid; how = 'midpoint'; }
  const left = A.filter((s) => s.start_cue < cut).map((s) => ({ ...s, end_cue: Math.min(s.end_cue, cut - 1), part: 'A' }));
  const right = B.filter((s) => s.end_cue >= cut).map((s) => ({ ...s, start_cue: Math.max(s.start_cue, cut), part: 'B' }));
  if (left.length) left[left.length - 1].end_cue = cut - 1;
  return { scenes: [...left, ...right], cut, how };
}

/** Merge the cast of two halves: A's, then B's members A does not have (same TMDB id or same name). */
export function mergeCast(a, b) {
  const norm = (x) => String(x ?? '').trim().toLowerCase();
  const seen = new Set(a.flatMap((c) => [norm(c.name), c.tmdb ? `t:${norm(c.tmdb)}` : null]).filter(Boolean));
  return [...a, ...b.filter((c) => !seen.has(norm(c.name)) && !(c.tmdb && seen.has(`t:${norm(c.tmdb)}`)))];
}
/** Merge the dangers of two halves: A's, then B's with a name A does not have. */
export function mergeDangers(a, b) {
  const n = new Set(a.map((d) => String(d.name).trim().toLowerCase()));
  return [...a, ...b.filter((d) => !n.has(String(d.name).trim().toLowerCase()))];
}
