#!/usr/bin/env node
// v7 moment finder (v6's, with v7 SKIP-SPAN DISCIPLINE): where inside a FLAGGED scene the flagged thing happens, so a parent skips the
// moment instead of the whole story-length scene (v4 finding 11: median scene 1.5 min; skipping whole
// scenes doubled skip minutes).
//
//   node moments.js <slug> [--run r1] [--cap 0.02] [--concurrency 4] [--dry-run]
//
// Reads out/<slug>.tags.<run>.json (select.js) and the segments file; writes
// out/<slug>.moments.<run>.json. Re-run select.js afterwards to attach the spans to the tags file.
//
// One Jev request per flagged scene (docs: cookbooks/semantic_find, the line-by-line search):
//   state     { film:{title}, scene:{lines: ['L1400| ...', ...]} }  (lines only, global cue ids)
//   per reason k (at most policy.moments.max_reasons):
//     begin.k   Choice over the scene's line ids: "the first line of the moment when <clause>"
//     end.k     Choice over the line ids: "the last line of the moment when <clause>"
//     exists.k  Noul: do the lines show it at all? (Choice probabilities always sum to 1, so a line
//               ranks first even when none qualifies; the Noul is absolute)
// Code: begin = the earliest line whose probability is >= peak_share x the best line's (wider when
// unsure); end = the latest such line. Span from spans.js spanFromLines: the begin extends back over a
// preceding wordless gap (<= 60 s) when the begin line reacts to action, else pads back 15 s; the
// end pads 5 s, or runs over the trailing silence (<= 60 s) when it is the scene's last line.
// v7 (sceneSpans; policy moments.not_shown / unshown / unshown_whole_max_ms, chosen on the dev films):
//   a reason the lines SHOW (exists >= exists_min) -> its span, as in v6;
//   a reason NOT shown while another is -> a span from its own begin/end lines anyway (v6 skipped the
//     whole scene whenever ANY reason was not shown: the largest source of extra skip minutes);
//   NO reason shown -> the best-guess span of the reason with the highest exists; the whole scene
//     only when the scene is <= unshown_whole_max_ms (an event seen, not said, in a short scene).
//   The whole scene without a call only when the scene is mostly wordless (few dialogue cues per
//   minute; sound captions do not count) or has more lines than a Choice can take. Union across
//   reasons. The v7 pad back is 20 s (policy wordless.pad_back_ms).
// Every answer is kept (compactly) in the moments file, so --respan can re-apply any span rule offline.
// A comic carve-out (moments.comic_carve) is built and tested but OFF: see policy.json for why.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSrt } from '../srt.js';
import { budget } from './budget.js';
import { key, outDir, heldOutGate } from './env.js';
import { isCaptionOnly, spanFromLines, wholeSceneSpan, unionSpans } from './spans.js';
import { record } from './ledger.js';
import { sizeRequest, runJobs, usd, MAX_CONCURRENCY, MOMENT_RESERVE_X_EST } from './jev-client.js';
import { ITEMS, MODEL, linesFor } from './questions.js';
import { loadPolicy } from './select.js';
import { MORTAL_BY_REASON } from './mortal.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const r3 = (x) => Math.round(x * 1000) / 1000;

export { isCaptionOnly, spanFromLines, unionSpans };

/** Dialogue cues per minute of the scene. */
export function dialoguePerMin(cues, scene) {
  const minutes = Math.max(1 / 60, (scene.end_ms - scene.start_ms) / 60000);
  return cues.filter((c) => !isCaptionOnly(c.text)).length / minutes;
}

/** The clause a flag reason is searched for ("the moment when <clause>"). */
export function clauseFor(reason, items) {
  const film = items.find((it) => it.id === reason.id);
  if (film) return film.moment;
  if (reason.rule === 'presence_with_creature_threat') return ITEMS.creature_threat.moment;
  if (reason.id === 'animal_creature') return 'an animal or creature is there';
  // v10.3: the mortal-danger reasons (mortal.js) carry their own clause
  if (MORTAL_BY_REASON[reason.id]) return MORTAL_BY_REASON[reason.id].moment;
  const it = ITEMS[reason.id];
  if (!it?.moment) throw new Error(`no moment clause for ${reason.id}`);
  return it.moment;
}

/** Questions for one scene's reasons over its line ids. */
export function momentQuestions(clauses, lineIds) {
  const options = Object.fromEntries(lineIds.map((id) => [id, null]));
  const q = {};
  clauses.forEach((clause, k) => {
    q[`begin.${k}`] = { type: 'choice', instructions: `Which line of \`scene.lines\` is the first line of the moment when ${clause}?`, criteria: options };
    q[`end.${k}`] = { type: 'choice', instructions: `Which line of \`scene.lines\` is the last line of the moment when ${clause}?`, criteria: options };
    q[`exists.${k}`] = { type: 'noul', instructions: `Do \`scene.lines\` show the moment when ${clause}?`, criteria: { true: 'At least one line, in words or in a sound caption, shows it happening in this scene.', false: 'No line shows it happening: it is only talked about, only seen on screen, or does not happen.' } };
  });
  return q;
}

/** Lines whose probability is >= share x the best line's, in scene order. */
function candidates(probabilities, lineIds, share) {
  const top = Math.max(...lineIds.map((id) => Number(probabilities?.[id]) || 0));
  if (!(top > 0)) return [];
  return lineIds.filter((id) => (Number(probabilities[id]) || 0) >= share * top);
}

/**
 * One reason's span from its three answers. Returns { span|null, begin, end, exists, fallback? }.
 * cuesById: Map 'L<n>' -> cue; scene: {start_ms, end_ms}; cueByIndex: global index -> cue.
 */
export function spanFor({ begin, end, exists }, lineIds, cuesById, scene, cfg, cueByIndex = null, { force = false } = {}) {
  const m = cfg.moments;
  const info = { exists: r3(exists) };
  if (exists < m.exists_min && !force) return { ...info, span: null, fallback: 'not_in_lines' };
  const b = candidates(begin?.probabilities, lineIds, m.peak_share);
  const e = candidates(end?.probabilities, lineIds, m.peak_share);
  if (!b.length || !e.length) return { ...info, span: null, fallback: 'no_line' };
  const idx = (id) => lineIds.indexOf(id);
  let bi = idx(b[0]);
  let ei = idx(e[e.length - 1]);
  if (ei < bi) [bi, ei] = [Math.min(bi, idx(e[0])), Math.max(ei, idx(b[b.length - 1]))];
  const { start_ms: start, end_ms: stop, lead_in: leadIn, wordless } = spanFromLines(bi, ei, lineIds, cuesById, scene, cfg, cueByIndex);
  return {
    ...info,
    begin: { line: lineIds[bi], p: r3(Number(begin.probabilities[lineIds[bi]]) || 0), confidence: r3(begin.confidence ?? 0), choice: begin.choice },
    end: { line: lineIds[ei], p: r3(Number(end.probabilities[lineIds[ei]]) || 0), confidence: r3(end.confidence ?? 0), choice: end.choice },
    span: { start_ms: start, end_ms: stop, ...(leadIn ? { lead_in: true } : {}), ...(wordless ? { wordless } : {}) },
  };
}

// ---- v7 comic carve-out (policy moments.comic_carve) -------------------------------------------------
// User policy (3): comic peril is a tag, never a skip. Round 2: comic key items still ended up inside
// skips (nemo 4/7, MI 3/6, LK 2/3), almost all pulled in by the span of ANOTHER flag reason in the same
// scene (a chase with a gag in the middle, a frightened child next to a pratfall). When a flagged scene
// has a comic signal from classify (e.comic_peril p or the laughs Score), the moment finder also asks
// where the comic moment is; its core (Jev's first begin line .. last end line) is cut out of the
// skip, except where it overlaps the core lines of any flag reason Jev shows in the scene.
export const COMIC_CLAUSE = 'a character is in slapstick or comic peril that is played for laughs';

/** Does this flagged scene get the comic question? (classify's comic signal, policy thresholds) */
export function wantsComic(scene, cfg) {
  const cc = cfg.moments?.comic_carve;
  if (!cc?.enabled) return false;
  const mods = scene.modifiers ?? {};
  return (Number(mods.comic_peril?.p) || 0) >= cc.comic_peril_min || (Number(mods.comic?.laughs) || 0) >= cc.laughs_min;
}
export function comicQuestions(lineIds) {
  const q = momentQuestions([COMIC_CLAUSE], lineIds);
  return { 'begin.comic': q['begin.0'], 'end.comic': q['end.0'], 'exists.comic': q['exists.0'] };
}

/** Subtract [a,b] ranges (ms) from spans; spans keep their extra fields. */
export function subtractRanges(spans, cuts) {
  let out = spans.map((x) => ({ ...x }));
  for (const [a, b] of cuts) {
    const next = [];
    for (const x of out) {
      if (b <= x.start_ms || a >= x.end_ms) { next.push(x); continue; }
      if (a > x.start_ms) next.push({ ...x, end_ms: a });
      if (b < x.end_ms) next.push({ ...x, start_ms: b, lead_in: false });
    }
    out = next.filter((x) => x.end_ms - x.start_ms > 0).map(({ lead_in, ...x }) => (lead_in ? { ...x, lead_in } : x));
  }
  return out;
}

/** The core [start, end] (ms, no padding) of a clause: Jev's top begin line .. top end line. */
export function coreOf(ans, lineIds, cuesById) {
  const top = (a) => { let best = null; for (const id of lineIds) { const p = Number(a?.probabilities?.[id]) || 0; if (!best || p > best.p) best = { id, p }; } return best?.p > 0 ? best.id : null; };
  const b = top(ans.begin); const e = top(ans.end);
  if (!b || !e) return null;
  const [i, j] = [lineIds.indexOf(b), lineIds.indexOf(e)].sort((x, y) => x - y);
  return [cuesById.get(lineIds[i]).startMs, cuesById.get(lineIds[j]).endMs];
}

/**
 * Cut the comic core out of a scene's spans, protecting the cores of the reasons shown in the lines.
 * Returns { spans, carved_ms, comic } (comic = what was found, for the record).
 */
export function carveComic(spans, { comic, perClause, lineIds, cuesById, cfg }) {
  const cc = cfg.moments?.comic_carve;
  if (!cc?.enabled || !comic || !(comic.exists >= cc.exists_min)) return { spans, carved_ms: 0, comic: comic ? { exists: r3(comic.exists ?? 0), carved: false } : null };
  const core = coreOf(comic, lineIds, cuesById);
  if (!core) return { spans, carved_ms: 0, comic: { exists: r3(comic.exists), carved: false } };
  const protectedCores = perClause.filter((c) => (c.exists ?? 0) >= cfg.moments.exists_min).map((c) => coreOf(c, lineIds, cuesById)).filter(Boolean).sort((x, y) => x[0] - y[0]);
  // core minus every protected core
  let cuts = [core];
  for (const [a, b] of protectedCores) cuts = cuts.flatMap(([x, y]) => (b <= x || a >= y ? [[x, y]] : [...(a > x ? [[x, a]] : []), ...(b < y ? [[b, y]] : [])]));
  cuts = cuts.filter(([x, y]) => y - x >= (cc.min_cut_ms ?? 0));
  const before = spans.reduce((t, x) => t + x.end_ms - x.start_ms, 0);
  const out = subtractRanges(spans, cuts);
  const after = out.reduce((t, x) => t + x.end_ms - x.start_ms, 0);
  return { spans: out, carved_ms: before - after, comic: { exists: r3(comic.exists), core, cuts, carved: before > after } };
}

/** Plan for one flagged scene: either a request or a whole-scene fallback without a call. */
export function planMoments({ film, scene, cues, reasons, items, cfg, cueByIndex = null }) {
  const m = cfg.moments;
  const w = wholeSceneSpan(scene, cues, cfg, cueByIndex);
  const whole = (why) => ({ scene: scene.id, call: false, method: 'whole_scene', why, spans: [w] });
  // the wordless test uses the dialogue bounds, so extending scenes over the gaps (policy
  // scene_bounds) does not change which scenes get a call
  const dpm = dialoguePerMin(cues, { start_ms: scene.line_start_ms ?? scene.start_ms, end_ms: scene.line_end_ms ?? scene.end_ms });
  if (dpm < m.wordless_dialogue_per_min) return { ...whole('wordless'), dialogue_per_min: r3(dpm) };
  if (cues.length > m.max_lines) return { ...whole('too_many_lines'), dialogue_per_min: r3(dpm) };
  const picked = reasons.slice(0, m.max_reasons);
  const clauses = [...new Set(picked.map((r) => clauseFor(r, items)))];
  const lines = linesFor(cues);
  const lineIds = cues.map((c) => `L${c.index}`);
  const questions = momentQuestions(clauses, lineIds);
  const comic = wantsComic(scene, cfg);
  if (comic) Object.assign(questions, comicQuestions(lineIds));
  const body = { model: MODEL, state: { film: { title: film.title }, scene: { lines } }, questions };
  return { scene: scene.id, call: true, clauses, reasons: picked.map((r) => r.id), lineIds, body, dialogue_per_min: r3(dpm), ...(comic ? { comic: true } : {}), ...sizeRequest(body, `${scene.id}/moments`, { reserveXEst: MOMENT_RESERVE_X_EST }) };
}

/** A Choice answer kept compactly: choice, confidence, and every line with p >= 0.005 (4 dp). */
export function compactChoice(a) {
  if (!a) return null;
  const probabilities = Object.fromEntries(Object.entries(a.probabilities ?? {}).filter(([, p]) => Number(p) >= 0.005).map(([k, p]) => [k, Math.round(Number(p) * 1e4) / 1e4]));
  return { choice: a.choice ?? null, confidence: r3(Number(a.confidence) || 0), probabilities };
}

/**
 * v7 span rule for one flagged scene from its per-clause answers
 * ([{ clause, exists, begin, end }], begin/end = Choice answers over the scene's line ids).
 *   SHOWN     clauses whose exists Noul >= exists_min: each gives a span (spanFor); union.
 *   NOT SHOWN clauses (exists < exists_min) while another clause is shown: no span of their own -- the
 *             lines do not show them, and v6's whole-scene fallback for them was the largest single
 *             source of skip minutes on the dev films (nemo 10 of 25 flagged scenes).
 *   NONE SHOWN policy moments.unshown: 'best_guess' = the clause with the highest exists, from the
 *             lines Jev ranks as its begin and end anyway (the event is seen, not said: its begin/end
 *             Choices still point at the lines around it), method 'moments_unshown'; 'whole_scene' =
 *             v6's fallback.
 * Returns { method, spans, per_reason, why? }.
 */
export function sceneSpans(perClause, opts) {
  const r = sceneSpansRaw(perClause, opts);
  if (!opts.comic || r.method === 'whole_scene_wordless') return r;
  const c = carveComic(r.spans, { comic: opts.comic, perClause, lineIds: opts.lineIds, cuesById: opts.cuesById, cfg: opts.cfg });
  return { ...r, spans: c.spans, ...(c.comic ? { comic: { ...c.comic, carved_ms: c.carved_ms } } : {}) };
}

function sceneSpansRaw(perClause, { lineIds, cuesById, scene, cfg, cueByIndex = null, cues = null }) {
  const m = cfg.moments;
  const rows = perClause.map((c) => ({ clause: c.clause, ...spanFor({ begin: c.begin, end: c.end, exists: c.exists }, lineIds, cuesById, scene, cfg, cueByIndex) }));
  const shown = rows.filter((r) => r.span);
  if (shown.length) {
    const notShown = rows.filter((r) => !r.span);
    const ns = m.not_shown ?? 'drop';
    if (notShown.length && ns === 'whole_scene') return { method: 'whole_scene', why: notShown.map((r) => `${r.fallback}: ${r.clause}`).join('; '), spans: [wholeSceneSpan(scene, cues ?? lineIds.map((id) => cuesById.get(id)), cfg, cueByIndex)], per_reason: rows };
    const guesses = ns === 'best_guess' ? notShown.map((r) => { const c = perClause.find((x) => x.clause === r.clause); return { clause: r.clause, ...spanFor({ begin: c.begin, end: c.end, exists: c.exists }, lineIds, cuesById, scene, cfg, cueByIndex, { force: true }) }; }).filter((g) => g.span) : [];
    return { method: 'moments', spans: unionSpans([...shown, ...guesses].map((r) => r.span)), per_reason: rows, ...(notShown.length ? { not_shown: notShown.map((r) => `${r.fallback}: ${r.clause}`), not_shown_rule: ns } : {}) };
  }
  const whole = () => ({ method: 'whole_scene', why: rows.map((r) => `${r.fallback}: ${r.clause}`).join('; '), spans: [wholeSceneSpan(scene, cues ?? lineIds.map((id) => cuesById.get(id)), cfg, cueByIndex)], per_reason: rows });
  if ((m.unshown ?? 'whole_scene') !== 'best_guess') return whole();
  // a short scene where nothing is shown in the lines: the whole scene (the event is on screen, not in the lines)
  if (m.unshown_whole_max_ms && (scene.end_ms - scene.start_ms) <= m.unshown_whole_max_ms) return whole();
  const best = [...perClause].sort((a, b) => (b.exists ?? 0) - (a.exists ?? 0))[0];
  const g = spanFor({ begin: best.begin, end: best.end, exists: best.exists }, lineIds, cuesById, scene, cfg, cueByIndex, { force: true });
  if (!g.span) return whole();
  return { method: 'moments_unshown', why: `no clause shown in the lines; best guess from '${best.clause}' (exists ${r3(best.exists)})`, spans: [g.span], per_reason: rows.map((r) => (r.clause === best.clause ? { ...r, best_guess: { begin: g.begin, end: g.end, span: g.span } } : r)) };
}

/** Spans for one scene from a moments response (v7: raw answers kept compactly per clause). */
export function spansFromAnswers(plan, answers, cues, scene, cfg, cueByIndex = null) {
  const cuesById = new Map(cues.map((c) => [`L${c.index}`, c]));
  const perClause = plan.clauses.map((clause, k) => ({ clause, exists: Number(answers[`exists.${k}`]?.noul ?? 0), begin: compactChoice(answers[`begin.${k}`]), end: compactChoice(answers[`end.${k}`]) }));
  const comic = plan.comic ? { clause: COMIC_CLAUSE, exists: Number(answers['exists.comic']?.noul ?? 0), begin: compactChoice(answers['begin.comic']), end: compactChoice(answers['end.comic']) } : null;
  const out = sceneSpans(perClause, { lineIds: plan.lineIds, cuesById, scene, cfg, cueByIndex, cues, comic });
  return { ...out, answers: perClause.map((c) => ({ ...c, exists: r3(c.exists) })), ...(comic ? { comic_answer: { ...comic, exists: r3(comic.exists) } } : {}) };
}

/**
 * Offline re-span (no model calls): recompute every flagged scene's skip spans from the begin / end
 * lines Jev already chose (saved per_reason), under the current policy's padding and scene bounds.
 * `tags` = the current select.js output (its flagged set and reasons); `saved` = the moments file
 * the answers came from. A reason whose clause was never asked, or a scene that was never asked
 * (flagged only under a later policy), falls back to the whole scene and says so.
 */
export function respanScenes({ tags, saved, cues, items, cfg }) {
  const scenes = {};
  const cueByIndex = new Map(cues.map((c) => [c.index, c]));
  for (const s of tags.scenes.filter((x) => x.flagged)) {
    const whole = (why, extra = {}) => ({ method: 'whole_scene', why, spans: [wholeSceneSpan(s, cues.slice(s.start_cue - 1, s.end_cue), cfg, cueByIndex)], reasons: s.flag_reasons.map((r) => r.id), ...extra });
    const old = saved?.scenes?.[s.id];
    const clauses = [...new Set(s.flag_reasons.slice(0, cfg.moments.max_reasons).map((r) => clauseFor(r, items)))];
    if (!old) { scenes[s.id] = whole('not_asked: flagged only under the current policy; a moments call is needed'); continue; }
    const keep = { ...(old.request ? { request: old.request } : {}), ...(old.dialogue_per_min != null ? { dialogue_per_min: old.dialogue_per_min } : {}) };
    if (old.answers) {
      // v7 file: the raw answers per clause are saved, so every span rule can be re-applied
      const byC = new Map(old.answers.map((a) => [a.clause, a]));
      const miss = clauses.filter((c) => !byC.has(c));
      if (miss.length) { scenes[s.id] = whole(`reason_not_asked: ${miss.join('; ')}`, keep); continue; }
      const slice = cues.slice(s.start_cue - 1, s.end_cue);
      const lineIds = slice.map((c) => `L${c.index}`);
      const cuesById = new Map(slice.map((c) => [`L${c.index}`, c]));
      const rows = clauses.map((c) => byC.get(c));
      scenes[s.id] = { ...sceneSpans(rows, { lineIds, cuesById, scene: s, cfg, cueByIndex, cues: slice, comic: old.comic_answer ?? null }), answers: rows, ...(old.comic_answer ? { comic_answer: old.comic_answer } : {}), reasons: s.flag_reasons.map((r) => r.id), ...keep };
      continue;
    }
    if (!old.per_reason) { scenes[s.id] = whole(old.why ?? 'whole_scene', keep); continue; }
    const byClause = new Map(old.per_reason.map((r) => [r.clause, r]));
    const missing = clauses.filter((c) => !byClause.has(c));
    if (missing.length) { scenes[s.id] = whole(`reason_not_asked: ${missing.join('; ')}`, { ...keep, per_reason: old.per_reason }); continue; }
    const rows = clauses.map((c) => byClause.get(c));
    const noSpan = rows.filter((r) => !r.begin || !r.end);
    if (noSpan.length) { scenes[s.id] = whole(noSpan.map((r) => `${r.fallback ?? 'no_span'}: ${r.clause}`).join('; '), { ...keep, per_reason: rows }); continue; }
    const slice = cues.slice(s.start_cue - 1, s.end_cue);
    const lineIds = slice.map((c) => `L${c.index}`);
    const cuesById = new Map(slice.map((c) => [`L${c.index}`, c]));
    const perReason = rows.map((r) => {
      const bi = lineIds.indexOf(r.begin.line);
      const ei = lineIds.indexOf(r.end.line);
      if (bi < 0 || ei < 0) throw new Error(`${s.id}: saved line ${r.begin.line}/${r.end.line} not in the scene`);
      return { ...r, span_asrun: r.span, span: spanFromLines(Math.min(bi, ei), Math.max(bi, ei), lineIds, cuesById, s, cfg, cueByIndex) };
    });
    scenes[s.id] = { method: 'moments', spans: unionSpans(perReason.map((r) => r.span)), per_reason: perReason, reasons: s.flag_reasons.map((r) => r.id), ...keep };
  }
  for (const [id, m] of Object.entries(scenes)) {
    const s = tags.scenes.find((x) => x.id === id);
    m.skip_ms = m.spans.reduce((a, x) => a + x.end_ms - x.start_ms, 0);
    m.scene_ms = s.end_ms - s.start_ms;
  }
  return scenes;
}

export async function run({ slug, runId = 'r1', cap = 0.02, concurrency = MAX_CONCURRENCY, dryRun = false, post, policyFile, only = null, write = true }) {
  const cfg = loadPolicy(policyFile);
  const OUT = outDir();
  const tags = JSON.parse(fs.readFileSync(path.join(OUT, `${slug}.tags.${runId}.json`), 'utf8'));
  const jevRun = JSON.parse(fs.readFileSync(path.join(OUT, `${slug}.jev.${runId}.json`), 'utf8'));
  const seg = JSON.parse(fs.readFileSync(path.resolve(here, jevRun.segments_file), 'utf8'));
  const items = jevRun.film_items ?? [];
  const cues = parseSrt(fs.readFileSync(path.resolve(here, '..', 'data', `${seg.film.slug}.srt`), 'utf8'));
  const cueByIndex = new Map(cues.map((c) => [c.index, c]));
  // v8 --incremental: `only` = the flagged scenes that still need a moments request
  const flagged = tags.scenes.filter((s) => s.flagged && (!only || only.has(s.id)));
  const plans = flagged.map((s) => ({ s, plan: planMoments({ film: seg.film, scene: s, cues: cues.slice(s.start_cue - 1, s.end_cue), reasons: s.flag_reasons, items, cfg, cueByIndex }) }));
  const calls = plans.filter((p) => p.plan.call);
  if (dryRun) {
    return { dry_run: true, flagged: flagged.length, calls: calls.length, est_tokens: calls.reduce((a, p) => a + p.plan.est, 0), worst_case_reserve_usd: calls.reduce((a, p) => a + p.plan.reserveUsd, 0), fallbacks: plans.filter((p) => !p.plan.call).map((p) => ({ scene: p.s.id, why: p.plan.why, dialogue_per_min: p.plan.dialogue_per_min })) };
  }
  const b = budget(cap);
  const started = Date.now();
  const jobs = calls.map((p) => ({ body: p.plan.body, est: p.plan.est, reserveUsd: p.plan.reserveUsd, meta: { id: p.s.id, label: `${p.s.id}/moments` } }));
  const { results, stopped } = jobs.length
    ? await runJobs(jobs, { key: key('TYPESAFE_API_KEY'), budget: b, concurrency, ...(post ? { post } : {}), log: (s) => process.stderr.write(`${s}\n`) })
    : { results: [], stopped: null };
  const byId = new Map(results.map((r) => [r.meta.id, r]));
  const scenes = {};
  for (const { s, plan } of plans) {
    if (!plan.call) { scenes[s.id] = { method: plan.method, why: plan.why, dialogue_per_min: plan.dialogue_per_min, spans: plan.spans, reasons: s.flag_reasons.map((r) => r.id) }; continue; }
    const res = byId.get(s.id);
    if (!res?.ok) { scenes[s.id] = { method: 'whole_scene', why: res?.skipped ? 'cap' : `error: ${res?.error}`, spans: [wholeSceneSpan(s, cues.slice(s.start_cue - 1, s.end_cue), cfg, cueByIndex)], reasons: plan.reasons, request: res?.record ?? null }; continue; }
    const cueSlice = cues.slice(s.start_cue - 1, s.end_cue);
    scenes[s.id] = { ...spansFromAnswers(plan, res.json.answers, cueSlice, s, cfg, cueByIndex), reasons: plan.reasons, dialogue_per_min: plan.dialogue_per_min, request: res.record };
  }
  for (const [id, m] of Object.entries(scenes)) {
    const s = flagged.find((x) => x.id === id);
    m.skip_ms = m.spans.reduce((a, x) => a + x.end_ms - x.start_ms, 0);
    m.scene_ms = s.end_ms - s.start_ms;
  }
  if (b.spent > 0) record(slug, { script: 'moments.js', kind: 'jev', usd: b.spent, note: `run ${runId}, ${jobs.length} requests` });
  const reqs = results.map((r) => r.record).filter(Boolean);
  const out = {
    film: seg.film, run: runId, model: MODEL, tags_file: path.relative(here, path.join(OUT, `${slug}.tags.${runId}.json`)), policy: { ...cfg.moments, wordless: cfg.wordless ?? null },
    run_at: new Date(started).toISOString(), wall_ms: Date.now() - started, stopped,
    flagged_scenes: flagged.length, requests: reqs.length,
    usage: { input_tokens: reqs.reduce((a, r) => a + (r.input_tokens ?? 0), 0) },
    cost_usd: Number(b.spent.toFixed(8)),
    skip_ms: Object.values(scenes).reduce((a, m) => a + m.skip_ms, 0),
    flagged_scene_ms: Object.values(scenes).reduce((a, m) => a + m.scene_ms, 0),
    scenes,
  };
  const file = path.join(OUT, `${slug}.moments.${runId}.json`);
  if (write) fs.writeFileSync(file, JSON.stringify(out, null, 2));
  return { ...out, file };
}

/**
 * v8: flagged scenes of `tags` that need a moments request under `cfg`: never asked, or asked without
 * one of the clauses their current reasons need (moments.js respanScenes would fall back to the whole
 * scene for them). Wordless / too-long scenes are included; planMoments skips the call for them.
 */
export function scenesNeedingMoments({ tags, saved, items, cfg }) {
  const need = [];
  for (const s of tags.scenes.filter((x) => x.flagged)) {
    const old = saved?.scenes?.[s.id];
    const clauses = [...new Set(s.flag_reasons.slice(0, cfg.moments.max_reasons).map((r) => clauseFor(r, items)))];
    if (!old) { need.push(s.id); continue; }
    if (old.answers && clauses.some((c) => !old.answers.some((a) => a.clause === c))) need.push(s.id);
  }
  return need;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2);
  const slug = argv.find((a) => !a.startsWith('--'));
  const opt = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
  if (!slug) { console.error('usage: node moments.js <slug> [--run r1] [--cap 0.02] [--concurrency 4] [--dry-run] | --respan [--from out/asrun/<slug>.moments.r1.json]'); process.exit(2); }
  heldOutGate(slug);
  if (argv.includes('--respan')) {
    // offline: no Jev calls; the saved answers' begin/end lines under the current policy
    const runId = opt('run', 'r1');
    const cfg = loadPolicy();
    const OUT = outDir();
    const from = path.resolve(here, opt('from', path.join(OUT, `${slug}.moments.${runId}.json`)));
    const saved = JSON.parse(fs.readFileSync(from, 'utf8'));
    const tags = JSON.parse(fs.readFileSync(path.join(OUT, `${slug}.tags.${runId}.json`), 'utf8'));
    const jevRun = JSON.parse(fs.readFileSync(path.join(OUT, `${slug}.jev.${runId}.json`), 'utf8'));
    const cues = parseSrt(fs.readFileSync(path.resolve(here, '..', 'data', `${saved.film.slug}.srt`), 'utf8'));
    const scenes = respanScenes({ tags, saved, cues, items: jevRun.film_items ?? [], cfg });
    const unflagged = Object.entries(saved.scenes).filter(([id]) => !scenes[id]).map(([id, m]) => ({ id, method: m.method, request: m.request ?? null }));
    const out = {
      ...saved, policy: { ...cfg.moments, wordless: cfg.wordless ?? null }, scene_bounds: cfg.scene_bounds ?? null,
      respan: { at: new Date().toISOString(), from: path.relative(here, from), note: 'Offline re-span: no Jev calls. Spans recomputed from the saved begin/end lines under the current policy (padding, scene bounds) for the current flagged set. cost_usd / requests / usage are the original calls, unchanged.', no_longer_flagged: unflagged, not_asked: Object.entries(scenes).filter(([, m]) => String(m.why ?? '').startsWith('not_asked')).map(([id]) => id) },
      flagged_scenes: Object.keys(scenes).length,
      skip_ms: Object.values(scenes).reduce((a, m) => a + m.skip_ms, 0),
      flagged_scene_ms: Object.values(scenes).reduce((a, m) => a + m.scene_ms, 0),
      scenes,
    };
    const file = path.join(OUT, `${slug}.moments.${runId}.json`);
    fs.writeFileSync(file, JSON.stringify(out, null, 2));
    console.log(`${file} (respan from ${path.relative(here, from)})\n  flagged ${out.flagged_scenes}; skip ${(out.skip_ms / 1000).toFixed(0)} s of ${(out.flagged_scene_ms / 1000).toFixed(0)} s; not asked ${out.respan.not_asked.join(',') || '-'}; no longer flagged ${unflagged.map((u) => u.id).join(',') || '-'}`);
    for (const [id, m] of Object.entries(scenes)) console.log(`  ${id} ${m.method}${m.why ? ` (${m.why})` : ''}: ${m.spans.map((x) => `${(x.start_ms / 1000).toFixed(0)}-${(x.end_ms / 1000).toFixed(0)}s`).join(', ')} [${m.reasons.join(',')}]`);
    process.exit(0);
  }
  if (argv.includes('--incremental')) {
    // v8: ask only the flagged scenes the saved answers do not cover, merge, then re-span every flagged
    // scene from the saved + new answers under the current policy (no other calls)
    const runId = opt('run', 'r1');
    const cfg = loadPolicy();
    const OUT = outDir();
    const file = path.join(OUT, `${slug}.moments.${runId}.json`);
    const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
    const tags = JSON.parse(fs.readFileSync(path.join(OUT, `${slug}.tags.${runId}.json`), 'utf8'));
    const jevRun = JSON.parse(fs.readFileSync(path.join(OUT, `${slug}.jev.${runId}.json`), 'utf8'));
    const need = scenesNeedingMoments({ tags, saved, items: jevRun.film_items ?? [], cfg });
    console.log(`${slug}: ${need.length} flagged scenes need a moments request: ${need.join(',') || 'none'}`);
    let fresh = null;
    if (need.length) {
      fresh = await run({ slug, runId, cap: Number(opt('cap', 0.02)), concurrency: Number(opt('concurrency', MAX_CONCURRENCY)), dryRun: argv.includes('--dry-run'), only: new Set(need), write: false });
      if (fresh.dry_run) { console.log(JSON.stringify(fresh, null, 2)); process.exit(0); }
    }
    const merged = { ...saved, scenes: { ...saved.scenes, ...(fresh?.scenes ?? {}) } };
    const cues = parseSrt(fs.readFileSync(path.resolve(here, '..', 'data', `${saved.film.slug}.srt`), 'utf8'));
    const scenes = respanScenes({ tags, saved: merged, cues, items: jevRun.film_items ?? [], cfg });
    const out = {
      ...saved, policy: { ...cfg.moments, wordless: cfg.wordless ?? null }, scene_bounds: cfg.scene_bounds ?? null,
      incremental: [...(saved.incremental ?? []), { at: new Date().toISOString(), asked: need, requests: fresh?.requests ?? 0, cost_usd: fresh?.cost_usd ?? 0 }],
      cost_usd: +((saved.cost_usd ?? 0) + (fresh?.cost_usd ?? 0)).toFixed(8), requests: (saved.requests ?? 0) + (fresh?.requests ?? 0),
      flagged_scenes: Object.keys(scenes).length,
      skip_ms: Object.values(scenes).reduce((a, m) => a + m.skip_ms, 0),
      flagged_scene_ms: Object.values(scenes).reduce((a, m) => a + m.scene_ms, 0),
      scenes,
    };
    fs.writeFileSync(file, JSON.stringify(out, null, 2));
    console.log(`  asked ${need.length} (${fresh?.requests ?? 0} requests, $${(fresh?.cost_usd ?? 0).toFixed(6)}); flagged ${out.flagged_scenes}; skip ${(out.skip_ms / 1000).toFixed(0)} s of ${(out.flagged_scene_ms / 1000).toFixed(0)} s; wordless-extended spans ${Object.values(scenes).flatMap((m) => m.spans).filter((x) => x.wordless).length}`);
    process.exit(0);
  }
  const r = await run({ slug, runId: opt('run', 'r1'), cap: Number(opt('cap', 0.02)), concurrency: Number(opt('concurrency', MAX_CONCURRENCY)), dryRun: argv.includes('--dry-run') });
  if (r.dry_run) console.log(JSON.stringify(r, null, 2));
  else {
    console.log(`${r.file}\n  flagged ${r.flagged_scenes}, requests ${r.requests}, input tokens ${r.usage.input_tokens}, cost $${r.cost_usd.toFixed(6)}`);
    console.log(`  skip ${(r.skip_ms / 1000).toFixed(0)} s of ${(r.flagged_scene_ms / 1000).toFixed(0)} s in flagged scenes`);
    for (const [id, m] of Object.entries(r.scenes)) console.log(`  ${id} ${m.method}${m.why ? ` (${m.why})` : ''}: ${m.spans.map((x) => `${(x.start_ms / 1000).toFixed(0)}-${(x.end_ms / 1000).toFixed(0)}s`).join(', ')} [${m.reasons.join(',')}]`);
  }
}
