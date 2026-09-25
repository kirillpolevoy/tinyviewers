// PORT of experiments/trigger-scan/v10_1/segment.js (a script whose whole body runs at import time,
// so it cannot be copied into pack/ like the rest). The logic is the script's, split into the stages
// the runner can checkpoint between -- each Sonnet call is its own stage, so no single invocation has
// to hold two of them:
//
//   segment_a1     attempt 1: one whole-film Sonnet call (v6 prompt, pack/segment-prompt.js)
//   gate_a1        the split gate on it: code checks + Jev (pack/check-split.js checkSegmentation)
//   segment_a2_1   attempt 2, only when gate_a1 failed: the first of two overlapping halves
//   segment_a2_2   the second half
//   gate_a2        mergeHalves, then the gate again
//   segment_build  the accepted attempt through the script's own validation (buildSegments below,
//                  verbatim), the gate's verdicts folded in (foldIntoSegments), the credits span
//
// Unchanged: the three verified sources and nothing else, every fact cited and every cite checked in
// code, coverage repair, word limits, the 8-word quotation rule on every stored string, judgement
// words flagged, the per-film Sonnet cap of $1.05 with attempt 2's $0.60 set aside first
// (pack/budget.js attemptCaps), the split check's own $0.03, reserve-before-dispatch on every call.
//
// Deviations, each forced by running inside a 300 s function, and each stated where it happens:
//   * max_tokens of a call is also capped at SEGMENT_TIME_MAX_OUT (28,000), so a call cannot outlive
//     the invocation that makes it (Sonnet streamed ~125 tokens/s in the v10.1 runs; the largest real
//     whole-film answer was 12,820 tokens; the script allowed up to 48,000). The script's own floor
//     (24,000 whole film, 12,000 per half) still refuses a call the cap cannot afford.
//   * the model output is checkpointed with the quotation rule already applied (the script applied it
//     only to the copy it wrote to disk), so the gate after a resume sees the same text as before it.
import { makePrompts } from '../pack/segment-prompt.js';
import { halves, mergeHalves, mergeCast, mergeDangers } from '../pack/gate.js';
import { checkSegmentation, foldIntoSegments } from '../pack/check-split.js';
import { attemptCaps } from '../pack/budget.js';
import { creditsSpan, isCreditsScene } from '../pack/credits.js';
import { repairCoverage, assertCoverage, clampWords, wordCount, transcriptGrams, judgementWords } from '../pack/validate.js';
import { checkCites, sourcesOf, gateCastMember, wikiSpread, GROUPS } from '../pack/cite.js';
import { countTokens, PRICES } from '../pack/sonnet.js';
import { POLICY, SONNET_MODEL, Interrupted, fail, sonnetCall, quoteRuler, checkInterrupted, enforceQuoteRuleStrict } from './common.js';
import { runCtx } from '../context.js';

export const PROMPT_VERSION = 'segment-v6.0-beats-and-cited-aliases';
export const PART_VERSION = 'part-rule-v7.0';
/** run-film.js: --cap 1.05 --attempt1-cap 0.45 --attempt2-cap 0.60 --split-cap 0.03 */
export const SEGMENT_CAPS = { film: 1.05, a1: 0.45, a2: 0.6, split: 0.03 };
export const SEGMENT_TIME_MAX_OUT = 28_000;
const EFFORT = 'low';
export const GATE_CFG = { ...POLICY.split_gate, credits: POLICY.credits };

const sourcesOfRun = (S) => {
  const SRC = S.out('sources');
  return { SRC, film: SRC.film, W: SRC.wikipedia.sentences, T: SRC.tmdb.cast };
};

/** One Sonnet call for lines first..last (part = null for the whole film). The script's callPart. */
async function callPart(S, w, first, last, part, { minOutput, maxOut, limit = Infinity }) {
  const { SRC, film, W, T } = sourcesOfRun(S);
  const { cues } = S;
  const { systemFor, userFor, SCHEMA } = makePrompts({ film, W, T, cues, SRC });
  const system = systemFor(first, last, part);
  const user = userFor(first, last, part);
  const schemaMargin = Math.ceil(JSON.stringify(SCHEMA).length / 1.5) + 1000;
  const [pIn, pOut] = PRICES[SONNET_MODEL];
  const counted = await countTokens({ model: SONNET_MODEL, system, user });
  const inWorst = counted != null ? Math.ceil(counted * 1.05) + schemaMargin : Math.ceil((system.length + user.length) / 1.5) + schemaMargin;
  const left = Math.min(w.budget.cap - w.budget.spent - w.budget.reserved, limit);
  const affordableOut = Math.floor(((left - (inWorst * pIn) / 1e6) * 1e6) / pOut);
  const maxTokens = Math.min(maxOut, affordableOut, SEGMENT_TIME_MAX_OUT);
  const worst = (inWorst * pIn + maxTokens * pOut) / 1e6;
  const label = part ? `part ${part.k}/${part.of} L${first}-L${last}` : 'whole film';
  if (maxTokens < minOutput) throw Object.assign(new Error(`cap leaves only ${maxTokens} output tokens (< ${minOutput}) for ${label}`), { refused: true, cost: 0 });
  const t0 = Date.now();
  const { r, cost } = await sonnetCall(w, { system, user, schema: SCHEMA, maxTokens, effort: EFFORT, worst, label });
  return { data: r.data, usage: r.usage, cost, wall_ms: Date.now() - t0, max_tokens: maxTokens, reserved_usd: +worst.toFixed(5), counted_input: counted, range: [first, last], part };
}

/** A failed call is a result (the script moves on to attempt 2), unless the invocation is stopping. */
function asFailure(err) {
  if (runCtx().signal?.aborted) throw new Interrupted();
  return { error: String(err.message ?? 'failed').slice(0, 200), cost: err.cost ?? 0, cost_is_upper_bound: !!err.cost_is_upper_bound, refused: !!err.refused };
}

const a1Caps = () => attemptCaps({ cap: SEGMENT_CAPS.film, prior: 0, a1: SEGMENT_CAPS.a1, a2: SEGMENT_CAPS.a2 });

// ---- stages ------------------------------------------------------------------------------------------

export async function segmentA1(S) {
  const rule = quoteRuler(S.cues);
  const w = S.wallet('sonnet', a1Caps().a1_cap);
  let a1;
  try {
    a1 = await callPart(S, w, 1, S.cues.length, null, { minOutput: 24_000, maxOut: 48_000 });
  } catch (err) {
    a1 = asFailure(err);
  }
  S.detail(a1.data ? `Sonnet cut the film into ${a1.data.scenes.length} scenes from the subtitles, the plot and the cast` : 'Sonnet could not cut the film on the first try');
  return { attempt: 1, mode: 'whole_film', effort: EFFORT, prompt_version: PROMPT_VERSION, cost_usd: +(a1.cost ?? 0).toFixed(6), usage: a1.usage ?? null, wall_ms: a1.wall_ms ?? null, max_tokens: a1.max_tokens ?? null, reserved_usd: a1.reserved_usd ?? null, ...(a1.data ? { data: rule(a1.data) } : { error: a1.error, refused: a1.refused }) };
}

async function gate(S, data, cap) {
  const { film, W, T } = sourcesOfRun(S);
  const w = S.wallet('jev', cap);
  const out = await w.run(() => checkSegmentation({ film, modelScenes: data.scenes, cues: S.cues, ctx: { wCount: W.length, tCount: T.length }, cfg: GATE_CFG, wallet: w.budget }));
  checkInterrupted();
  return out;
}

const gateLine = (g) => `${g.code.metrics.scenes} scenes; Jev agreed with ${g.jev?.metrics.sentences_supported ?? 0} of ${g.jev?.metrics.sentences_asked ?? 0} sentences and confirmed ${g.jev?.metrics.boundaries_confirmed ?? 0} of ${g.jev?.metrics.boundaries ?? 0} cuts`;

export async function gateA1(S) {
  const a1 = S.out('segment_a1');
  if (!a1.data) return { skipped: 'no_output', pass: false };
  try {
    const g = await gate(S, a1.data, SEGMENT_CAPS.split);
    S.detail(`${g.pass ? 'Passed' : 'Failed'}: ${gateLine(g)}`);
    return g;
  } catch (err) {
    if (err instanceof Interrupted || runCtx().signal?.aborted) throw new Interrupted();
    // The script let a failed split check fail the run (it has no second opinion to fall back on).
    throw fail('split_check_failed', 'Jev could not finish checking the scene cut, so the film was not written in.');
  }
}

export const needsAttempt2 = (S) => !S.out('gate_a1')?.pass;

export async function segmentA2Part(S, k) {
  const a1 = S.out('segment_a1');
  const h = halves(S.cues.length, GATE_CFG.retry.overlap_cues);
  // committed = billed + what a crashed attempt of that stage may have been billed (its carried mark)
  const a2Cap = a1Caps().a2_after(S.committed('segment_a1'));
  const rule = quoteRuler(S.cues);
  const [first, last] = k === 1 ? h.a : h.b;
  const priorPart = k === 2 ? S.committed('segment_a2_1') : 0;
  // Attempt 2 is one wallet across both halves in the script; here the halves are two stages, so the
  // second half's cap is attempt 2's cap minus what the first half spent. Same ceiling.
  const w = S.wallet('sonnet', Math.max(0, a2Cap - priorPart));
  let r;
  try {
    r = await callPart(S, w, first, last, { k, of: 2 }, { minOutput: 12_000, maxOut: 32_000, limit: k === 1 ? a2Cap / 2 : Infinity });
  } catch (err) {
    r = asFailure(err);
  }
  S.detail(r.data ? `Second try, half ${k} of 2: ${r.data.scenes.length} scenes` : `Second try, half ${k} of 2 did not come back`);
  return { k, halves: h, attempt2_cap_usd: +a2Cap.toFixed(6), cost_usd: +(r.cost ?? 0).toFixed(6), usage: r.usage ?? null, wall_ms: r.wall_ms ?? null, range: [first, last], ...(r.data ? { data: rule(r.data), model_scenes: r.data.scenes.length } : { error: r.error, refused: r.refused }) };
}

export const needsHalf2 = (S) => needsAttempt2(S) && !!S.out('segment_a2_1')?.data;

export async function gateA2(S) {
  const A = S.out('segment_a2_1');
  const B = S.out('segment_a2_2');
  if (!A?.data || !B?.data) return { skipped: 'no_output', pass: false };
  const h = A.halves;
  const m = mergeHalves(A.data.scenes, B.data.scenes, h);
  const data = { cast: mergeCast(A.data.cast, B.data.cast), dangers: mergeDangers(A.data.dangers, B.data.dangers), scenes: m.scenes.map(({ part, ...s }) => s) };
  const used = S.committed('gate_a1');
  let g;
  try {
    g = await gate(S, data, Math.max(0, SEGMENT_CAPS.split - used));
  } catch (err) {
    if (err instanceof Interrupted || runCtx().signal?.aborted) throw new Interrupted();
    throw fail('split_check_failed', 'Jev could not finish checking the second scene cut, so the film was not written in.');
  }
  S.detail(`Second cut ${g.pass ? 'passed' : 'failed'}: ${gateLine(g)}`);
  return { merge: { cut: m.cut, how: m.how, scenes_from_a: m.scenes.filter((s) => s.part === 'A').length, scenes_from_b: m.scenes.filter((s) => s.part === 'B').length }, data, gate: g, pass: g.pass };
}

// ---- segment_build: the script's validation, verbatim ------------------------------------------------

/** segment.js buildSegments(data), with its closure variables as arguments. */
export function buildSegments(data, { cues, W, T }) {
  const N = cues.length;
  const ctx = { nCues: N, wCount: W.length, tCount: T.length };
  const grams = transcriptGrams(cues.map((c) => c.text), 9);
  const stats = {
    quote_violations_shortened: 0, sentences_trimmed: 0, settings_trimmed: 0, notes_trimmed: 0,
    scene_sentences_model: 0, scene_sentences_dropped_uncited: 0, scene_cites_rejected: { malformed: 0, unknown: 0, outside_scene: 0 },
    settings_uncited_to_unknown: 0,
    cast_model: data.cast.length, cast_dropped_uncited: 0, cast_fields_demoted_to_unknown: {}, cast_cites_rejected: 0,
    dangers_model: data.dangers.length, dangers_dropped_uncited: 0, danger_cites_rejected: 0,
    sentences_with_judgement_words: 0,
  };
  const issues = {};
  const note = (id, what) => (issues[id] ??= []).push(what);
  const dropped = { scene_sentences: [], cast: [], dangers: [] };

  function clean(text, maxWords, where, counter) {
    let t = String(text ?? '').trim();
    const q = enforceQuoteRuleStrict(t, grams);
    if (q.violations.length) { stats.quote_violations_shortened += q.violations.length; t = q.text ?? '…'; note(where, `quote shortened (${q.violations.map((v) => `${v.words} words`).join(', ')})`); }
    const c = clampWords(t, maxWords);
    if (c.trimmed) { stats[counter]++; note(where, `${counter.replace(/_trimmed$/, '')} trimmed from ${wordCount(t)} words`); t = c.text; }
    return t;
  }

  const modelScenes = data.scenes.map((s, i) => ({ ...s, _i: i }));
  const { scenes: covered, repairs } = repairCoverage(modelScenes, N);
  assertCoverage(covered, N);

  const scenes = covered.map((s, i) => {
    const id = `S${String(i + 1).padStart(3, '0')}`;
    const range = [s.start_cue, s.end_cue];
    const sentences = [];
    s.sentences.forEach((x, k) => {
      stats.scene_sentences_model++;
      const r = checkCites(x.cites, { ...ctx, range });
      r.rejected.forEach((rj) => { stats.scene_cites_rejected[rj.why]++; });
      if (r.rejected.length) note(id, `sentence ${k + 1}: rejected cites ${r.rejected.map((rj) => `${rj.id}(${rj.why})`).join(' ')}`);
      if (!r.ok.length) {
        stats.scene_sentences_dropped_uncited++;
        dropped.scene_sentences.push({ scene: id, index: k + 1, words: wordCount(x.text), cites_given: (x.cites ?? []).length, rejected: r.rejected });
        return;
      }
      const text = clean(x.text, 25, id, 'sentences_trimmed');
      const judged = judgementWords(text);
      if (judged.length) { stats.sentences_with_judgement_words++; note(id, `sentence ${k + 1} judgement words: ${judged.join(', ')}`); }
      sentences.push({ text, cites: r.ok, ...(judged.length ? { judgement_words: judged } : {}) });
    });
    const sc = checkCites(s.setting_cites, { ...ctx, range });
    let setting = clean(s.setting, 6, id, 'settings_trimmed');
    let settingCites = sc.ok;
    if (setting.toLowerCase() !== 'unknown' && !settingCites.length) { stats.settings_uncited_to_unknown++; setting = 'unknown'; }
    if (setting.toLowerCase() === 'unknown') settingCites = [];
    const start = cues[s.start_cue - 1];
    const end = cues[s.end_cue - 1];
    return {
      id,
      start_cue: s.start_cue,
      end_cue: s.end_cue,
      start_ms: start.startMs,
      end_ms: end.endMs,
      setting,
      setting_cites: settingCites,
      sentences,
      summary: sentences.filter((x) => !x.judgement_words).map((x) => x.text).join(' '),
      sources_used: sourcesOf(sentences.flatMap((x) => x.cites)),
    };
  });

  const cast = [];
  data.cast.forEach((raw, i) => {
    const g = gateCastMember(raw, ctx);
    stats.cast_cites_rejected += g.rejected.length;
    if (!g.member) { stats.cast_dropped_uncited++; dropped.cast.push({ model_index: i, rejected: g.rejected }); return; }
    for (const f of g.demoted) stats.cast_fields_demoted_to_unknown[f] = (stats.cast_fields_demoted_to_unknown[f] ?? 0) + 1;
    const id = `C${String(cast.length + 1).padStart(2, '0')}`;
    const m = g.member;
    m.name = clean(m.name, 8, id, 'notes_trimmed');
    m.aliases = m.aliases.map((a) => (typeof a === 'string' ? clean(a, 8, id, 'notes_trimmed') : { ...a, name: clean(a.name, 8, id, 'notes_trimmed') }));
    m.disposition_note = clean(m.disposition_note, 12, id, 'notes_trimmed');
    cast.push({ id, ...m, ...(g.demoted.length ? { demoted_to_unknown: g.demoted } : {}) });
  });

  const dangers = [];
  data.dangers.forEach((raw, i) => {
    const r = checkCites(raw.cites, ctx);
    stats.danger_cites_rejected += r.rejected.length;
    if (!r.ok.length) { stats.dangers_dropped_uncited++; dropped.dangers.push({ model_index: i, rejected: r.rejected }); return; }
    const id = `D${String(dangers.length + 1).padStart(2, '0')}`;
    dangers.push({ id, name: clean(raw.name, 8, id, 'notes_trimmed'), kind: raw.kind, note: clean(raw.note, 12, id, 'notes_trimmed'), group: GROUPS.includes(raw.group) ? raw.group : 'none', cites: r.ok });
  });

  return { scenes, cast, dangers, stats, issues, dropped, repairs, covered };
}

export async function segmentBuild(S) {
  const { SRC, film, W, T } = sourcesOfRun(S);
  const { cues } = S;
  const N = cues.length;
  const a1 = S.out('segment_a1');
  const g1 = S.out('gate_a1');
  const a2A = S.has('segment_a2_1') ? S.out('segment_a2_1') : null;
  const a2B = S.has('segment_a2_2') ? S.out('segment_a2_2') : null;
  const g2 = S.has('gate_a2') ? S.out('gate_a2') : null;

  const attempts = [{ attempt: 1, mode: 'whole_film', effort: a1.effort, cost_usd: a1.cost_usd, usage: a1.usage, wall_ms: a1.wall_ms, data: a1.data, gate: g1?.skipped ? null : g1, error: a1.error }];
  if (a2A) {
    const row = { attempt: 2, mode: 'halves', effort: EFFORT, halves: a2A.halves, cost_usd: (a2A.cost_usd ?? 0) + (a2B?.cost_usd ?? 0), wall_ms: (a2A.wall_ms ?? 0) + (a2B?.wall_ms ?? 0) };
    if (g2 && !g2.skipped) Object.assign(row, { data: g2.data, gate: g2.gate, merge: g2.merge, usage: { input_tokens: (a2A.usage?.input_tokens ?? 0) + (a2B?.usage?.input_tokens ?? 0), output_tokens: (a2A.usage?.output_tokens ?? 0) + (a2B?.usage?.output_tokens ?? 0) } });
    else row.error = a2A.error ?? a2B?.error ?? 'the second half did not run';
    attempts.push(row);
  }
  const accepted = attempts.find((a) => a.gate?.pass) ?? null;
  const attemptSummary = attempts.map((a) => ({ attempt: a.attempt, mode: a.mode, effort: a.effort, cost_usd: +(a.cost_usd ?? 0).toFixed(5), ...(a.halves ? { halves: a.halves, merge: a.merge } : {}), ...(a.error ? { error: a.error } : {}), gate: a.gate ? { pass: a.gate.pass, failed: a.gate.failed, code: a.gate.code.metrics, jev: a.gate.jev ? { metrics: a.gate.jev.metrics, run: a.gate.jev.run } : null } : null }));
  if (!accepted) {
    throw fail('segmentation_rejected', `Jev rejected Sonnet's scene cut on ${attempts.length === 1 ? 'the only attempt' : 'both attempts'}, so there is no scene list to build a guide from. Nothing was written.`);
  }

  const raw = { run_at: new Date().toISOString(), accepted_attempt: accepted.attempt, attempts: attemptSummary.map((a, i) => ({ ...a, accepted: attempts[i] === accepted, scenes: attempts[i].data?.scenes, cast: attempts[i].data?.cast, dangers: attempts[i].data?.dangers })), data: accepted.data };
  const { scenes, cast, dangers, stats, issues, dropped, repairs } = buildSegments(accepted.data, { cues, W, T });
  const cost = attempts.reduce((a, x) => a + (x.cost_usd ?? 0), 0);
  const wallMs = attempts.reduce((a, x) => a + (x.wall_ms ?? 0), 0);
  const lengths = scenes.map((s) => s.end_cue - s.start_cue + 1).sort((a, b) => a - b);
  const minutes = scenes.map((s) => (s.end_ms - s.start_ms) / 60000).sort((a, b) => a - b);
  const med = (a) => a[Math.floor(a.length / 2)];
  const spread = wikiSpread(scenes, W.length);
  const out = {
    film: { slug: film.slug, title: film.title, year: film.year, imdb_id: film.imdb_id, tmdb_id: SRC.tmdb.id },
    sources: {
      tmdb: { id: SRC.tmdb.id, fetched_at: SRC.tmdb.fetched_at, cast_count: T.length },
      wikipedia: { title: SRC.wikipedia.title, revision_id: SRC.wikipedia.revision_id, url: SRC.wikipedia.url, permalink: SRC.wikipedia.permalink, fetched_at: SRC.wikipedia.fetched_at, sentence_count: W.length, verified_by: SRC.wikipedia.verified_by },
      srt: { file: `subtitle_tracks:${film.imdb_id}`, cues: N, sha256: S.srt.sha256 },
    },
    model: SONNET_MODEL,
    run_at: raw.run_at,
    cost_usd: +cost.toFixed(5),
    wall_ms: wallMs,
    usage: accepted.usage,
    cast,
    dangers,
    scenes,
    prompt_version: accepted.mode === 'halves' ? `${PROMPT_VERSION} + ${PART_VERSION}` : PROMPT_VERSION,
    effort: accepted.effort,
    cap_usd: SEGMENT_CAPS.film,
    attempt_caps_usd: { attempt1: a1Caps().a1_cap, attempt2: a1Caps().a2_cap },
    segmentation_attempts: attemptSummary,
    accepted_attempt: accepted.attempt,
    validation: {
      model_scene_count: accepted.data.scenes.length,
      scene_count: scenes.length,
      repairs_count: repairs.length,
      repaired_cues: repairs.reduce((sum, r) => sum + (r.cues ?? 0), 0),
      repairs,
      ...stats,
      scene_sentences_kept: scenes.reduce((n, s) => n + s.sentences.length, 0),
      scenes_with_no_sentence: scenes.filter((s) => !s.sentences.length).map((s) => s.id),
      scenes_by_sources: Object.fromEntries(['lines', 'wikipedia', 'tmdb'].map((k) => [k, scenes.filter((s) => s.sources_used.includes(k)).length])),
      wikipedia_spread: { cited: Object.keys(spread.perW).length, uncited: spread.uncited, max_scenes_per_sentence: spread.max, cited_by_several_scenes: spread.spread },
      cues_per_scene: { min: lengths[0], median: med(lengths), max: lengths[lengths.length - 1] },
      minutes_per_scene: { min: +minutes[0].toFixed(2), median: +med(minutes).toFixed(2), max: +minutes[minutes.length - 1].toFixed(2) },
      dropped,
      scene_issues: issues,
    },
  };
  foldIntoSegments(out, accepted.gate, { attempt: accepted.attempt, checked_at: new Date().toISOString() });
  const cr = creditsSpan(cues, POLICY.credits ?? {});
  out.credits = cr;
  for (const s of out.scenes) if (isCreditsScene(s, cr, POLICY.credits)) s.credits = true;
  S.detail(`${scenes.length} scenes, ${out.validation.scene_sentences_kept} cited sentences kept`);
  return { segments: out, raw };
}
