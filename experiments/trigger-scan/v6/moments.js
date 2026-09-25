#!/usr/bin/env node
// v6 moment finder (v5's, with the v6 wordless-action span rules of spans.js): where inside a FLAGGED scene the flagged thing happens, so a parent skips the
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
// Whole scene when exists < exists_min, when the scene is mostly wordless (few dialogue cues per
// minute; sound captions do not count), or when it has more lines than a Choice can take.
// Union across reasons.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSrt } from '../srt.js';
import { budget } from './budget.js';
import { key, outDir } from './env.js';
import { isCaptionOnly, spanFromLines, wholeSceneSpan, unionSpans } from './spans.js';
import { record } from './ledger.js';
import { sizeRequest, runJobs, usd, MAX_CONCURRENCY, MOMENT_RESERVE_X_EST } from './jev-client.js';
import { ITEMS, MODEL, linesFor } from './questions.js';
import { loadPolicy } from './select.js';

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
export function spanFor({ begin, end, exists }, lineIds, cuesById, scene, cfg, cueByIndex = null) {
  const m = cfg.moments;
  const info = { exists: r3(exists) };
  if (exists < m.exists_min) return { ...info, span: null, fallback: 'not_in_lines' };
  const b = candidates(begin?.probabilities, lineIds, m.peak_share);
  const e = candidates(end?.probabilities, lineIds, m.peak_share);
  if (!b.length || !e.length) return { ...info, span: null, fallback: 'no_line' };
  const idx = (id) => lineIds.indexOf(id);
  let bi = idx(b[0]);
  let ei = idx(e[e.length - 1]);
  if (ei < bi) [bi, ei] = [Math.min(bi, idx(e[0])), Math.max(ei, idx(b[b.length - 1]))];
  const { start_ms: start, end_ms: stop, lead_in: leadIn } = spanFromLines(bi, ei, lineIds, cuesById, scene, cfg, cueByIndex);
  return {
    ...info,
    begin: { line: lineIds[bi], p: r3(Number(begin.probabilities[lineIds[bi]]) || 0), confidence: r3(begin.confidence ?? 0), choice: begin.choice },
    end: { line: lineIds[ei], p: r3(Number(end.probabilities[lineIds[ei]]) || 0), confidence: r3(end.confidence ?? 0), choice: end.choice },
    span: { start_ms: start, end_ms: stop, ...(leadIn ? { lead_in: true } : {}) },
  };
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
  const body = { model: MODEL, state: { film: { title: film.title }, scene: { lines } }, questions: momentQuestions(clauses, lineIds) };
  return { scene: scene.id, call: true, clauses, reasons: picked.map((r) => r.id), lineIds, body, dialogue_per_min: r3(dpm), ...sizeRequest(body, `${scene.id}/moments`, { reserveXEst: MOMENT_RESERVE_X_EST }) };
}

/** Spans for one scene from a moments response. */
export function spansFromAnswers(plan, answers, cues, scene, cfg, cueByIndex = null) {
  const cuesById = new Map(cues.map((c) => [`L${c.index}`, c]));
  const perClause = plan.clauses.map((clause, k) => ({
    clause,
    ...spanFor({ begin: answers[`begin.${k}`], end: answers[`end.${k}`], exists: answers[`exists.${k}`]?.noul ?? 0 }, plan.lineIds, cuesById, scene, cfg, cueByIndex),
  }));
  const fallback = perClause.filter((c) => !c.span);
  if (fallback.length) {
    return { method: 'whole_scene', why: fallback.map((c) => `${c.fallback}: ${c.clause}`).join('; '), spans: [wholeSceneSpan(scene, cues, cfg, cueByIndex)], per_reason: perClause };
  }
  return { method: 'moments', spans: unionSpans(perClause.map((c) => c.span)), per_reason: perClause };
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

export async function run({ slug, runId = 'r1', cap = 0.02, concurrency = MAX_CONCURRENCY, dryRun = false, post, policyFile }) {
  const cfg = loadPolicy(policyFile);
  const OUT = outDir();
  const tags = JSON.parse(fs.readFileSync(path.join(OUT, `${slug}.tags.${runId}.json`), 'utf8'));
  const jevRun = JSON.parse(fs.readFileSync(path.join(OUT, `${slug}.jev.${runId}.json`), 'utf8'));
  const seg = JSON.parse(fs.readFileSync(path.resolve(here, jevRun.segments_file), 'utf8'));
  const items = jevRun.film_items ?? [];
  const cues = parseSrt(fs.readFileSync(path.resolve(here, '..', 'data', `${seg.film.slug}.srt`), 'utf8'));
  const cueByIndex = new Map(cues.map((c) => [c.index, c]));
  const flagged = tags.scenes.filter((s) => s.flagged);
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
  fs.writeFileSync(file, JSON.stringify(out, null, 2));
  return { ...out, file };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2);
  const slug = argv.find((a) => !a.startsWith('--'));
  const opt = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
  if (!slug) { console.error('usage: node moments.js <slug> [--run r1] [--cap 0.02] [--concurrency 4] [--dry-run] | --respan [--from out/asrun/<slug>.moments.r1.json]'); process.exit(2); }
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
  const r = await run({ slug, runId: opt('run', 'r1'), cap: Number(opt('cap', 0.02)), concurrency: Number(opt('concurrency', MAX_CONCURRENCY)), dryRun: argv.includes('--dry-run') });
  if (r.dry_run) console.log(JSON.stringify(r, null, 2));
  else {
    console.log(`${r.file}\n  flagged ${r.flagged_scenes}, requests ${r.requests}, input tokens ${r.usage.input_tokens}, cost $${r.cost_usd.toFixed(6)}`);
    console.log(`  skip ${(r.skip_ms / 1000).toFixed(0)} s of ${(r.flagged_scene_ms / 1000).toFixed(0)} s in flagged scenes`);
    for (const [id, m] of Object.entries(r.scenes)) console.log(`  ${id} ${m.method}${m.why ? ` (${m.why})` : ''}: ${m.spans.map((x) => `${(x.start_ms / 1000).toFixed(0)}-${(x.end_ms / 1000).toFixed(0)}s`).join(', ')} [${m.reasons.join(',')}]`);
  }
}
