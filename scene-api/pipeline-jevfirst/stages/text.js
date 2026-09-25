// What a parent reads for each flagged scene (v10.4), in run-film.js's order:
//
//   describe         pack/describe.js CLI body: Sonnet writes a title and 1-2 cited sentences per flagged
//                    scene from verified sources only (the flagged moment's lines, the plot sentences its
//                    verified sentences cite or its order window, the TMDB entries of its cast); code
//                    checks cites / length / the 8-word quotation rule / judgement words.
//   check_describe   pack/check-describe.js CLI body (--attempt 1): Jev claim-checks every sentence and
//                    title at the text / title margins, places Wikipedia-citing ones, checks the direction
//                    of 'X threatens Y', and the v10.2 plot path (support against the cited plot sentence
//                    alone + the neighbour test). Code-built reasons are OFF (policy): nothing is written
//                    from a flag reason.
//   describe2        pack/describe2.js CLI body: Sonnet once more, only for flagged scenes whose first text
//                    or title failed the STRICT check, with a wider window of lines.
//   check_describe2  the same checks on it (--attempt 2)
//   titles           pack/describe2.js --titles: a title restating a verified text that still has none
//   check_describe3  the same checks on it (--attempt 3)
//   mergetext        pack/describe2.js --merge (pure): the strict merge of the three checked attempts, the
//                    loose one re-decided from the same stored Jev answers, and the shown why under the
//                    v10.4 text rule A0>C (textrule.js): strict when anything passed strictly, else loose
//                    (Jev supports >= 0.4 and contradicts < 0.3); contradicted / unplaced / reversed never.
// Demo mode: the three Sonnet stages return the STORED answers of the film's run (restricted to the scenes
// today's live checks would have asked about); every Jev stage runs live.
import { buildContexts, userPrompt as descUserPrompt, schemaFor as descSchemaFor, validateScene as descValidate, SYSTEM as DESC_SYSTEM, DESCRIBE_VERSION, SONNET_MODEL as DESC_MODEL, PER_CALL } from '../pack/describe.js';
import { buildWhy, CHECK_DESCRIBE_VERSION } from '../pack/check-describe.js';
import { SYSTEM2, SYSTEM3, userPrompt2, userPrompt3, retryScenes, buildRetryContexts, titleScenes, mergeFilm, DESCRIBE2_VERSION } from '../pack/describe2.js';
import { textRulePolicy, TEXTRULE_VERSION } from '../pack/textrule.js';
import { batchBody, placementBody, verdictOf, evidenceIds, evidenceText, placementOutcome, DEFAULT_RULE, MODEL as JEV_MODEL } from '../pack/claims.js';
import { acceptSentence } from '../pack/accept.js';
import { planReasons, rankReasons, parentPhrase } from '../pack/reasons.js';
import { verified } from '../pack/questions.js';
import { parseDirection, directionChoiceBody, directionReversed, reasonClaim, reasonAtAct, reasonSayable, reasonPlaced, textAccepted, plotPathOk, TEXTSAFE_VERSION } from '../pack/textsafe.js';
import { neighbourBody } from '../pack/fill.js';
import { transcriptGrams } from '../pack/validate.js';
import { runJobs, sizeRequest, MAX_CONCURRENCY } from '../pack/jev-client.js';
import { key } from '../pack/env.js';
import { countTokens, PRICES } from '../pack/sonnet.js';
import { formatTime } from '../srt.js';
import { POLICY, fail, sonnetCall, Interrupted, checkInterrupted, r3, kindsOf } from './common.js';
import { runCtx } from '../context.js';

/** run-film.js (v10.4): describe 0.15, checkdesc 0.08, describe2 0.12, checkdesc2 0.06, titles 0.04, checkdesc3 0.03 */
export const TEXT_CAPS = { describe: 0.15, check_describe: 0.08, describe2: 0.12, check_describe2: 0.06, titles: 0.04, check_describe3: 0.03 };
const CHECK_STAGE = { 1: 'check_describe', 2: 'check_describe2', 3: 'check_describe3' };
/** The stage whose output each check attempt reads (describe.r1 / describe2.r1 / describe3.r1). */
const DESC_STAGE = { 1: 'describe', 2: 'describe2', 3: 'titles' };
const hms = (ms) => formatTime(ms).slice(0, 8);

/** A Sonnet call inside a text stage: a failure is recorded on the row (the script's behaviour), an interruption is not. */
async function askSonnet(w, row, args) {
  try {
    const { r, cost } = await sonnetCall(w, args);
    Object.assign(row, { usage: r.usage, cost_usd: +cost.toFixed(6), latency_ms: r.latencyMs });
    return r;
  } catch (err) {
    if (runCtx().signal?.aborted) throw new Interrupted();
    row.error = String(err.message).slice(0, 200);
    row.cost_usd = +(err.cost ?? 0).toFixed(6);
    if (err.refused) row.refused = true;
    return null;
  }
}

// ---- describe (attempt 1) --------------------------------------------------------------------------------

export async function describeStage(S) {
  if (S.mode === 'demo') {
    const stored = S.stored('describe');
    if (!stored || stored.version !== DESCRIBE_VERSION) throw fail('stale_artifacts', "This film's stored scene descriptions were written by a different version of the describe step, so a demo run of it would not be the real pipeline.");
    S.detail("Sonnet's stored descriptions, not written again");
    return { ...stored, replayed: true };
  }
  const seg = S.out('refold').segments;
  const tags = S.out('select2');
  const items = S.out('classify').film_items ?? [];
  const SRC = S.out('sources');
  const { cues } = S;
  const src = { W: SRC.wikipedia.sentences, T: SRC.tmdb.cast };
  const film = { title: SRC.film.title, year: SRC.film.year ?? seg.film.year ?? null };
  const ctxs = buildContexts({ seg, tags, cues, src, items });
  const effort = 'low';
  const w = S.wallet('sonnet', TEXT_CAPS.describe);
  const [pIn, pOut] = PRICES[DESC_MODEL];
  const chunks = [];
  for (let k = 0; k < ctxs.length; k += PER_CALL) chunks.push(ctxs.slice(k, k + PER_CALL));
  const grams = transcriptGrams(cues.map((c) => c.text), 9);
  const calls = [];
  const outScenes = {};
  for (const [k, chunk] of chunks.entries()) {
    checkInterrupted();
    const user = descUserPrompt(film, chunk);
    const counted = await countTokens({ model: DESC_MODEL, system: DESC_SYSTEM, user });
    const inWorst = (counted ?? Math.ceil((DESC_SYSTEM.length + user.length) / 2.5)) + 2000;
    const maxTokens = Math.min(8000, 400 + chunk.length * 220);
    const worst = (inWorst * pIn + maxTokens * pOut) / 1e6;
    const row = { call: k + 1, scenes: chunk.map((c) => c.id), counted_input: counted, reserved_usd: +worst.toFixed(6) };
    calls.push(row);
    const r = await askSonnet(w, row, { system: DESC_SYSTEM, user, schema: descSchemaFor(chunk.map((c) => c.id)), maxTokens, effort, worst, model: DESC_MODEL, label: `describe ${k + 1}` });
    if (!r) { if (row.refused) break; continue; } // the script stops at a refused reservation too
    for (const c of chunk) {
      const raw = (r.data.scenes ?? []).find((x) => x.id === c.id) ?? null;
      outScenes[c.id] = { flagged_for: c.flagged_for, reasons: c.reasons, evidence_ids: { lines: c.lines.map((x) => x.id), w: c.w.map((x) => x.id), t: c.t.map((x) => x.id) }, ...descValidate(raw, c, grams) };
    }
  }
  const n = Object.values(outScenes);
  const missing = ctxs.filter((c) => !outScenes[c.id]?.returned).map((c) => c.id);
  // A flagged scene with no description is still flagged and still says why (its why_tags); it shows
  // no text. So a partial answer is recorded, not fatal -- the experiment's CLI exited 1 but its outputs
  // were used the same way by the next step.
  S.detail(`Sonnet wrote titles and sentences for ${ctxs.length - missing.length} of ${ctxs.length} flagged scenes`);
  return {
    film: seg.film, version: DESCRIBE_VERSION, run: 'r1', model: DESC_MODEL, effort, run_at: new Date().toISOString(),
    calls, cost_usd: +calls.reduce((a, c) => a + (c.cost_usd ?? 0), 0).toFixed(6),
    flagged: ctxs.length, returned: n.filter((x) => x.returned).length, sentences: n.reduce((a, x) => a + x.sentences.length, 0), rejected: n.reduce((a, x) => a + x.rejected.length, 0), titles: n.filter((x) => x.title).length,
    missing, scenes: outScenes,
  };
}

// ---- check_describe (attempts 1, 2, 3) -------------------------------------------------------------------

/** check-describe.js CLI body for one attempt (no --reuse-why: every answer is asked live). */
export async function checkDescribeStage(S, attempt = 1) {
  const cfg = POLICY;
  const RULE = { ...DEFAULT_RULE, ...(cfg.claim_accept ?? {}) }; delete RULE._about;
  const TS_CFG = cfg.text_safety;
  const ACC = { ...RULE, ...(cfg.sentence_accept ?? {}), min_supports: TS_CFG.accept.min_supports, max_contradicts: TS_CFG.accept.max_contradicts };
  const ACC_T = { ...ACC, min_supports: TS_CFG.title_accept.min_supports, max_contradicts: TS_CFG.title_accept.max_contradicts };
  const seg = S.out('refold').segments;
  const tags = S.out('select2');
  const desc = S.out(DESC_STAGE[attempt]) ?? { scenes: {} };
  const items = S.out('classify').film_items ?? [];
  const SRC = S.out('sources');
  const { cues } = S;
  const src = { cues, W: SRC.wikipedia.sentences, T: SRC.tmdb.cast };
  const segById = new Map(seg.scenes.map((s) => [s.id, s]));
  const flagged = tags.scenes.filter((s) => s.flagged);
  const sceneLines = (sc) => cues.slice(sc.start_cue - 1, sc.end_cue).map((q) => evidenceText(`L${q.index}`, src));
  const plainLines = (sc) => cues.slice(sc.start_cue - 1, sc.end_cue).map((q) => evidenceText(`L${q.index}`, src).replace(' (subtitle line)', ''));
  const summaryW = (sc) => [...new Set((sc.sentences ?? []).filter((x) => verified(x.check) && !x.judgement_words?.length).flatMap((x) => x.cites.filter((c) => c[0] === 'W')))];
  const lineText = (q) => `L${q.index} [${formatTime(q.startMs).slice(0, 8)}] ${String(q.text).replace(/\n/g, ' / ')}`;
  const neighbours = (sc) => ({ before: cues.slice(Math.max(0, sc.start_cue - 1 - 8), sc.start_cue - 1).map(lineText), after: cues.slice(sc.end_cue, sc.end_cue + 8).map(lineText) });

  // phase 1: support + placement + plot path + direction for every sentence and title; the reason claims
  const claims = [];
  for (const s of flagged) {
    const d = desc.scenes?.[s.id];
    if (!d) continue;
    const sc = segById.get(s.id);
    const range = [sc.start_cue, sc.end_cue];
    const add = (k, x) => {
      const ids = evidenceIds(x.cites, { context: 2, range, nCues: cues.length });
      const wCites = x.cites.filter((c) => c[0] === 'W');
      claims.push({ scene: s.id, key: `${s.id}.${k}`, text: x.text, cites: x.cites, evidence: ids.map((id) => evidenceText(id, src)), wiki: wCites.length > 0, wOnly: !x.cites.some((c) => c[0] === 'L'), sceneLines: plainLines(sc), direction: parseDirection(x.text), wCites, wAllowed: wCites.every((id) => (d.evidence_ids?.w ?? []).includes(id)), nb: neighbours(sc) });
    };
    (d.sentences ?? []).forEach((x, i) => add(`d${i + 1}`, x));
    if (d.title) add('title', d.title);
  }
  const reasonClaims = [];
  if (TS_CFG.code_built_reasons !== false) {
    for (const s of flagged) {
      const sc = segById.get(s.id);
      const W = summaryW(sc);
      const evidence = [...sceneLines(sc), ...W.map((id) => evidenceText(id, src))];
      for (const r of rankReasons(s.flag_reasons, items).filter((x) => reasonAtAct(x, s.tags) && reasonSayable(x)).slice(0, TS_CFG.max_reasons_checked)) {
        reasonClaims.push({ scene: s.id, reason: r.id, key: `${s.id}.reason.${r.id}`, claim: reasonClaim(r, items), evidence, sceneLines: plainLines(sc) });
      }
    }
  }
  const jobs = [];
  const push = (kind, key0, body, extra = {}) => { const sz = sizeRequest(body, `${kind}:${key0}`, { reserveXEst: 3.0 }); jobs.push({ body, est: sz.est, reserveUsd: sz.reserveUsd, meta: { kind: `describe_${kind}`, key: key0, label: `${kind}:${key0}`, attempt, ...extra } }); };
  for (const c of claims) {
    push('support', c.key, batchBody([{ claim: c.text, evidence: c.evidence }]), { text: c.text, rule: c.key.endsWith('title') ? ACC_T : ACC, scene: c.scene, title: c.key.endsWith('title') });
    if (c.wiki) {
      push('placement', c.key, placementBody(c.text, c.sceneLines), { scene: c.scene });
      push('wsupport', c.key, batchBody([{ claim: c.text, evidence: c.wCites.map((id) => evidenceText(id, src)) }]), { scene: c.scene });
      push('neighbour', c.key, neighbourBody({ film: seg.film, event: c.text, before: c.nb.before, after: c.nb.after }), { scene: c.scene });
    }
    if (c.direction) {
      const plot = c.cites.filter((id) => id[0] === 'W').map((id) => evidenceText(id, src));
      push('direction', c.key, directionChoiceBody({ film: seg.film, lines: c.sceneLines, plot, d: c.direction, model: JEV_MODEL }), { scene: c.scene });
    }
  }
  for (const rc of reasonClaims) {
    if (TS_CFG.reason_placement) push('rplace', rc.key, placementBody(rc.claim, rc.sceneLines), { scene: rc.scene });
    push('reason', rc.key, batchBody([{ claim: rc.claim, evidence: rc.evidence }]), { text: rc.claim, rule: RULE, scene: rc.scene });
  }
  const w = S.wallet('jev', TEXT_CAPS[CHECK_STAGE[attempt]]);
  const failed = () => (runCtx().signal?.aborted ? new Interrupted() : fail('jev_check_failed', 'Jev could not finish checking the scene descriptions, so the film was not written in.'));
  S.progress?.({ stage: 'claims', total: jobs.length, kinds: kindsOf(jobs) });
  const r1 = jobs.length ? await w.run(() => runJobs(jobs, { key: key('TYPESAFE_API_KEY'), budget: w.budget, concurrency: MAX_CONCURRENCY })) : { results: [] };
  if (r1.results.some((r) => !r.ok)) throw failed();
  const ans = {};
  for (const r of r1.results) {
    const k = r.meta.kind.replace(/^describe_/, '');
    const a = (ans[r.meta.key] ??= {});
    const A = r.json.answers ?? {};
    if (k === 'support' || k === 'reason') a.support = verdictOf(A.r0, RULE);
    else if (k === 'placement') a.placement = { choice: A.placement.choice, confidence: A.placement.confidence, probabilities: A.placement.probabilities };
    else if (k === 'direction') { const pr = A.direction?.probabilities ?? {}; a.direction = { choice: A.direction?.choice ?? null, p_forward: r3(Number(pr.forward) || 0), p_reverse: r3(Number(pr.reverse) || 0), p_neither: r3(Number(pr.neither) || 0) }; }
    else if (k === 'wsupport') a.wsupport = verdictOf(A.r0, RULE);
    else if (k === 'rplace') a.place = { choice: A.placement.choice, probabilities: A.placement.probabilities };
    else if (k === 'neighbour') { const pr = A.shown?.probabilities ?? {}; a.neighbour = { choice: A.shown?.choice ?? null, p_before: r3(Number(pr.before) || 0), p_after: r3(Number(pr.after) || 0), p_neither: r3(Number(pr.neither) || 0) }; }
  }
  for (const c of claims) {
    const a = ans[c.key];
    const isTitle = c.key.endsWith('title');
    const st = acceptSentence(a.support, null, isTitle ? ACC_T : ACC).status;
    const placed = c.wiki ? placementOutcome(a.placement, c.wOnly, RULE) === 'placed' : true;
    const dirOk = c.direction ? !directionReversed(a.direction) : true;
    const linesFinal = st !== 'verified' ? st : !placed ? 'unplaced' : !dirOk ? 'reversed' : 'verified';
    const plot = c.wiki && linesFinal !== 'verified' ? plotPathOk({ status: st, wsupport: a.wsupport, wAllowed: c.wAllowed, neighbour: a.neighbour, dirOk }, { accept: isTitle ? TS_CFG.title_accept : TS_CFG.accept, neighbourMin: cfg.fill.neighbour_min }) : null;
    c.check = { support: a.support, ...(a.placement ? { placement: a.placement } : {}), ...(c.direction ? { direction: { ...c.direction, ...a.direction, ok: dirOk } } : {}), ...(a.wsupport ? { wsupport: a.wsupport } : {}), ...(a.neighbour ? { neighbour: a.neighbour } : {}), ...(plot ? { plot_path: plot } : {}), status: st, placed, lines_final: linesFinal, via: linesFinal === 'verified' ? 'lines' : plot?.ok ? 'plot' : null, final: linesFinal === 'verified' || plot?.ok ? 'verified' : linesFinal };
  }
  for (const rc of reasonClaims) {
    const v = ans[rc.key].support;
    const pl = ans[rc.key].place ?? null;
    const placedOk = TS_CFG.reason_placement ? reasonPlaced(pl, TS_CFG.reason_placement) : true;
    rc.check = { verdict: v.verdict, p_supports: v.probabilities?.supports ?? null, p_contradicts: v.probabilities?.contradicts ?? null, ...(pl ? { placement: pl.choice, p_fits: Number(pl.probabilities?.fits) || 0, p_conflicts: Number(pl.probabilities?.conflicts) || 0 } : {}), supported: textAccepted(v, TS_CFG.accept), placed: placedOk, pass: textAccepted(v, TS_CFG.accept) && placedOk };
  }
  checkInterrupted();

  // phase 2: does a verified sentence state a flag reason?
  const plans = [];
  for (const s of flagged) {
    const ok = claims.filter((c) => c.scene === s.id && !c.key.endsWith('title') && c.check.final === 'verified');
    const plan = planReasons({ film: seg.film, scene: s, sentences: ok.map((c) => c.text), reasons: s.flag_reasons, items, cfg });
    if (plan) plans.push({ s, ok, plan });
  }
  const jobs2 = plans.map((p) => ({ body: p.plan.body, est: p.plan.est, reserveUsd: p.plan.reserveUsd, meta: { kind: 'describe_states', id: p.s.id, scene: p.s.id, attempt, label: `${p.s.id}/states` } }));
  S.progress?.({ stage: 'claims', total: jobs2.length, kinds: kindsOf(jobs2) });
  const r2 = jobs2.length ? await w.run(() => runJobs(jobs2, { key: key('TYPESAFE_API_KEY'), budget: w.budget, concurrency: MAX_CONCURRENCY })) : { results: [] };
  if (r2.results.some((r) => !r.ok)) throw failed();
  const statesBy = {};
  for (const r of r2.results) {
    const p = plans.find((x) => x.s.id === r.meta.id);
    statesBy[r.meta.id] = p.plan.reasons.flatMap((rid, k) => p.ok.map((c, j) => ({ reason: rid, sentence: c.key, p: r3(Number(r.json.answers[`r${k}.s${j}`]?.noul) || 0) })));
  }

  const scenes = {};
  for (const s of flagged) {
    const cs = claims.filter((c) => c.scene === s.id);
    const title = cs.find((c) => c.key.endsWith('title'));
    const sentences = cs.filter((c) => !c.key.endsWith('title'));
    const rcs = reasonClaims.filter((x) => x.scene === s.id);
    const stated = TS_CFG.code_built_reasons === false ? [] : rcs.filter((x) => x.check.pass).map((x) => x.reason);
    const why = buildWhy({ title: title && { text: title.text, final: title.check.final }, sentences: sentences.map((c) => ({ key: c.key, text: c.text, final: c.check.final })), states: statesBy[s.id] ?? [], reasons: s.flag_reasons, items, minP: cfg.reasons.min_p, stated });
    scenes[s.id] = {
      reasons: s.flag_reasons.map((r) => r.id),
      checked: cs.map((c) => ({ key: c.key, text: c.text, cites: c.cites, status: c.check.status, placed: c.check.placed, final: c.check.final, via: c.check.via, ...(c.check.wsupport ? { p_w_supports: c.check.wsupport.probabilities?.supports ?? null, p_w_contradicts: c.check.wsupport.probabilities?.contradicts ?? null } : {}), ...(c.check.neighbour ? { p_neighbour_neither: c.check.neighbour.p_neither } : {}), ...(c.check.plot_path ? { plot_path: c.check.plot_path } : {}), p_supports: c.check.support.probabilities?.supports ?? null, p_contradicts: c.check.support.probabilities?.contradicts ?? null, ...(c.check.placement ? { placement: c.check.placement.choice, p_fits: c.check.placement.probabilities?.fits ?? null, p_conflicts: c.check.placement.probabilities?.conflicts ?? null } : {}), ...(c.check.direction ? { direction: c.check.direction } : {}) })),
      reason_checks: rcs.map((x) => ({ reason: x.reason, claim: x.claim, ...x.check })),
      states: statesBy[s.id] ?? [],
      why,
    };
  }
  const n = Object.values(scenes);
  const cnt = (k) => n.filter((x) => x.why.source === k).length;
  const texts = n.flatMap((x) => x.checked.filter((c) => !c.key.endsWith('title')));
  const rcAll = n.flatMap((x) => x.reason_checks);
  const out = {
    film: seg.film, version: CHECK_DESCRIBE_VERSION, textsafe: TEXTSAFE_VERSION, run: 'r1', attempt,
    policy: { claim_accept: RULE, text_accept: TS_CFG.accept, title_accept: TS_CFG.title_accept, direction: TS_CFG.direction, max_reasons_checked: TS_CFG.max_reasons_checked, reasons_min_p: cfg.reasons.min_p }, run_at: new Date().toISOString(),
    requests: jobs.length + jobs2.length, cost_usd: +w.budget.spent.toFixed(6),
    flagged: n.length, sentences: texts.length, verified: texts.filter((c) => c.final === 'verified').length, contradicted: texts.filter((c) => c.final === 'contradicted').length, unplaced: texts.filter((c) => c.final === 'unplaced').length, reversed: n.flatMap((x) => x.checked).filter((c) => c.final === 'reversed').length,
    titles_verified: n.filter((x) => x.why.title_source === 'sonnet_verified').length,
    verified_via_plot: n.flatMap((x) => x.checked).filter((c) => c.via === 'plot').map((c) => c.key),
    reasons_checked: rcAll.length, reasons_passed: rcAll.filter((x) => x.pass).length,
    why: { described: cnt('described'), described_plus_reason: cnt('described+reason'), described_only: cnt('described_only'), plain_reason: cnt('plain_reason'), no_verified_text: cnt('no_verified_text') },
    scenes,
  };
  if (attempt === 1) S.detail(`${out.verified} of ${out.sentences} sentences and ${out.titles_verified} of ${out.flagged} titles supported by the cited lines on the first check; only checked text is ever shown`);
  else if (claims.length) S.detail(`Second look: ${out.verified} of ${out.sentences} new sentences and ${n.filter((x) => x.checked.some((c) => c.key.endsWith('title') && c.final === 'verified')).length} new titles supported by the cited lines`);
  return out;
}

// ---- describe2 (the second attempt) and titles (the title pass) ------------------------------------------

/** Demo: the stored Sonnet answers, only for the scenes today's live checks would have asked about. */
function storedFor(S, kind, ids) {
  const stored = S.stored(kind);
  if (!stored) return { version: DESCRIBE2_VERSION, replayed: true, scenes: {}, not_stored: [...ids] };
  const scenes = Object.fromEntries(Object.entries(stored.scenes ?? {}).filter(([id]) => ids.has(id)));
  return { ...stored, replayed: true, scenes, not_stored: [...ids].filter((id) => !scenes[id]) };
}

export async function describe2Stage(S) {
  const tags = S.out('select2');
  const why1 = S.out('check_describe');
  const want = retryScenes(tags, why1);
  const ids = new Set(want.map((x) => x.id));
  if (S.mode === 'demo') {
    const out = storedFor(S, 'describe2', ids);
    S.detail(`Sonnet's stored second attempt for ${Object.keys(out.scenes).length} scenes, not written again`);
    return out;
  }
  const seg = S.out('refold').segments;
  const items = S.out('classify').film_items ?? [];
  const SRC = S.out('sources');
  const { cues } = S;
  const src = { W: SRC.wikipedia.sentences, T: SRC.tmdb.cast };
  const film = { title: SRC.film.title, year: SRC.film.year ?? seg.film.year ?? null };
  const ctxs = buildRetryContexts({ seg, tags, cues, src, items, ids, why: why1 });
  const w = S.wallet('sonnet', TEXT_CAPS.describe2);
  const [pIn, pOut] = PRICES[DESC_MODEL];
  const chunks = [];
  for (let k = 0; k < ctxs.length; k += PER_CALL) chunks.push(ctxs.slice(k, k + PER_CALL));
  const grams = transcriptGrams(cues.map((c) => c.text), 9);
  const calls = [];
  const outScenes = {};
  let stopped = null;
  const ask = async (chunk, k) => {
    checkInterrupted();
    const user = userPrompt2(film, chunk);
    const counted = await countTokens({ model: DESC_MODEL, system: SYSTEM2, user });
    const inWorst = (counted ?? Math.ceil((SYSTEM2.length + user.length) / 2.5)) + 2000;
    const maxTokens = Math.min(8000, 400 + chunk.length * 300);
    const worst = (inWorst * pIn + maxTokens * pOut) / 1e6;
    const row = { call: k, scenes: chunk.map((c) => c.id), counted_input: counted, reserved_usd: +worst.toFixed(6) };
    calls.push(row);
    const r = await askSonnet(w, row, { system: SYSTEM2, user, schema: descSchemaFor(chunk.map((c) => c.id)), maxTokens, effort: 'low', worst, model: DESC_MODEL, label: `describe2 ${k}` });
    if (!r) { if (row.refused) stopped = row.error; return; }
    for (const c of chunk) {
      const raw = (r.data.scenes ?? []).find((x) => x.id === c.id) ?? null;
      if (!raw && outScenes[c.id]?.returned) continue;
      outScenes[c.id] = { flagged_for: c.flagged_for, reasons: c.reasons, confirmed: c.confirmed.map((x) => x.text), evidence_ids: { lines: c.lines.map((x) => x.id), w: c.w.map((x) => x.id), t: c.t.map((x) => x.id) }, ...descValidate(raw, c, grams) };
    }
  };
  // Deviation from the script: a refused reservation stops asking (the script exited 3 and the run
  // stopped). The second attempt only adds text; a film is never failed for not getting one.
  for (const [k, chunk] of chunks.entries()) { if (stopped) break; await ask(chunk, k + 1); }
  const left = ctxs.filter((c) => !outScenes[c.id]?.returned);
  if (left.length && !stopped) await ask(left, chunks.length + 1);
  const n = Object.values(outScenes);
  if (ctxs.length) S.detail(`Sonnet took a second look at ${ctxs.length} flagged scene${ctxs.length === 1 ? '' : 's'} whose first note the cited lines did not support`);
  return {
    film: seg.film, version: DESCRIBE2_VERSION, run: 'r1', model: DESC_MODEL, effort: 'low', run_at: new Date().toISOString(),
    calls, cost_usd: +calls.reduce((a, c) => a + (c.cost_usd ?? 0), 0).toFixed(6), stopped,
    flagged: tags.scenes.filter((s) => s.flagged).length, retried: ctxs.length, need: Object.fromEntries(want.map((x) => [x.id, x.need])),
    returned: n.filter((x) => x.returned).length, sentences: n.reduce((a, x) => a + x.sentences.length, 0), rejected: n.reduce((a, x) => a + x.rejected.length, 0), titles: n.filter((x) => x.title).length,
    missing: ctxs.filter((c) => !outScenes[c.id]?.returned).map((c) => c.id), scenes: outScenes,
  };
}

export async function titlesStage(S) {
  const tags = S.out('select2');
  const why1 = S.out('check_describe');
  const why2 = S.out('check_describe2') ?? { scenes: {} };
  const want3 = titleScenes(tags, why1, why2);
  if (S.mode === 'demo') return storedFor(S, 'describe3', new Set(want3.map((x) => x.id)));
  const items = S.out('classify').film_items ?? [];
  const SRC = S.out('sources');
  const seg = S.out('refold').segments;
  const { cues } = S;
  const src = { W: SRC.wikipedia.sentences, T: SRC.tmdb.cast };
  const film = { title: SRC.film.title, year: SRC.film.year ?? seg.film.year ?? null };
  const idsIn = (x) => [...new Set(x.flatMap((c) => c.cites))];
  const ctx3 = want3.map((x) => {
    const ids = idsIn(x.confirmed);
    const sc = tags.scenes.find((t) => t.id === x.id);
    const reasons = rankReasons(sc.flag_reasons, items).slice(0, 3);
    return {
      id: x.id, confirmed: x.confirmed, reasons: reasons.map((r) => r.id), flagged_for: [...new Set(reasons.map((r) => parentPhrase(r, items)))],
      lines: ids.filter((i) => i[0] === 'L').map((i) => { const c = cues[Number(i.slice(1)) - 1]; return { id: i, text: `${i} [${hms(c.startMs)}] ${String(c.text).replace(/\n/g, ' / ')}` }; }),
      w: ids.filter((i) => i[0] === 'W').map((i) => ({ id: i, text: `${i} ${src.W[Number(i.slice(1)) - 1].text}` })),
      t: ids.filter((i) => i[0] === 'T').map((i) => ({ id: i, text: `${i} ${src.T[Number(i.slice(1)) - 1].character}` })),
    };
  });
  const w = S.wallet('sonnet', TEXT_CAPS.titles);
  const [pIn, pOut] = PRICES[DESC_MODEL];
  const grams = transcriptGrams(cues.map((c) => c.text), 9);
  const scenes3 = {};
  const calls = [];
  let stopped = null;
  const askT = async (chunk, k) => {
    checkInterrupted();
    const user = userPrompt3(film, chunk);
    const counted = await countTokens({ model: DESC_MODEL, system: SYSTEM3, user });
    const maxTokens = Math.min(4000, 300 + chunk.length * 90);
    const worst = (((counted ?? Math.ceil((SYSTEM3.length + user.length) / 2.5)) + 2000) * pIn + maxTokens * pOut) / 1e6;
    const row = { call: k, scenes: chunk.map((c) => c.id), counted_input: counted, reserved_usd: +worst.toFixed(6) };
    calls.push(row);
    const r = await askSonnet(w, row, { system: SYSTEM3, user, schema: descSchemaFor(chunk.map((c) => c.id)), maxTokens, effort: 'low', worst, model: DESC_MODEL, label: `titles ${k}` });
    if (!r) { if (row.refused) stopped = row.error; return; }
    for (const c of chunk) {
      const raw = (r.data.scenes ?? []).find((x) => x.id === c.id) ?? null;
      if (!raw && scenes3[c.id]?.returned) continue;
      const v = descValidate(raw ? { ...raw, sentences: [] } : null, c, grams);
      scenes3[c.id] = { reasons: c.reasons, flagged_for: c.flagged_for, confirmed: c.confirmed.map((x) => x.text), evidence_ids: { lines: c.lines.map((x) => x.id), w: c.w.map((x) => x.id), t: c.t.map((x) => x.id) }, ...v, sentences: [] };
    }
  };
  const ch3 = [];
  for (let k = 0; k < ctx3.length; k += 30) ch3.push(ctx3.slice(k, k + 30));
  for (const [k, c] of ch3.entries()) { if (stopped) break; await askT(c, k + 1); }
  const left3 = ctx3.filter((c) => !scenes3[c.id]?.returned);
  if (left3.length && !stopped) await askT(left3, ch3.length + 1);
  if (ctx3.length) S.detail(`Sonnet wrote ${Object.values(scenes3).filter((x) => x.title).length} titles for supported notes that had none`);
  return { film: seg.film, version: `${DESCRIBE2_VERSION} titles`, run: 'r1', model: DESC_MODEL, run_at: new Date().toISOString(), calls, cost_usd: +calls.reduce((a, c) => a + (c.cost_usd ?? 0), 0).toFixed(6), stopped, asked: ctx3.length, titles: Object.values(scenes3).filter((x) => x.title).length, missing: ctx3.filter((c) => !scenes3[c.id]?.returned).map((c) => c.id), scenes: scenes3 };
}

// ---- mergetext (code) --------------------------------------------------------------------------------------

/** describe2.js --merge: the shown text per flagged scene under the text rule A0>C. Pure. */
export function mergeText({ why1, why2, why3, describe, describe2, describe3 }) {
  const pol = textRulePolicy(POLICY);
  const retried = new Set(Object.keys(describe2?.scenes ?? {}));
  const titled = new Set(Object.keys(describe3?.scenes ?? {}));
  return {
    film: why1.film, version: DESCRIBE2_VERSION, textrule: TEXTRULE_VERSION, text_rule: pol.rule, loose_accept: pol.loose.text, run: 'r1', merged_at: new Date().toISOString(),
    ...mergeFilm({ why1, why2: why2 ?? { scenes: {} }, why3: why3 ?? { scenes: {} }, desc: [describe ?? { scenes: {} }, describe2 ?? { scenes: {} }, describe3 ?? { scenes: {} }], retried, titled, pol }),
  };
}

export async function mergeTextStage(S) {
  const out = mergeText({ why1: S.out('check_describe'), why2: S.out('check_describe2'), why3: S.out('check_describe3'), describe: S.out('describe'), describe2: S.out('describe2'), describe3: S.out('titles') });
  S.detail(`${out.flagged - out.no_text} of ${out.flagged} flagged scenes have a checked note (${out.text_strict} under the strict rule, ${out.text_loose} under the looser one)`);
  return out;
}
