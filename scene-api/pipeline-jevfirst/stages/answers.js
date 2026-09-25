// Who answers what, and what gets flagged (v10.4; every function body here is the experiment's CLI body
// with its file reads replaced by the stage inputs; the question sets, the split, the policy and the flag
// rules are the pack's, untouched):
//
//   classify  pack/classify.js run(): Jev answers ITS questions (jev-set.js via questions.js, the
//             split.json 'jev' ids) in their minimal states, plus v9's mention / modifier / Score / kind
//             / film-presence questions. Raw answers only.
//   sonnetq   pack/sonnetq.js run(): Sonnet answers the ten concepts split.json gives it, several
//             consecutive scenes per call, left-out scenes re-asked once.
//   childcry  pack/childcry.js CLI body: Jev's "is the one who cries a child?" where Sonnet's crying
//             is at act (v10.1 rule 2).
//   resolve   pack/resolve.js CLI body: the v10.2 resolution guard -- Jev's arrest / celebration
//             questions where a Sonnet reason the guard can cancel is at act.
//   mortal    pack/mortal.js CLI body: the v10.3 mortal-danger questions (deadly fall, bomb) the policy
//             keeps, on every non-credits scene.
//   select    pack/select.js selectRun (the user's flag policy, tier-A gate, guard, co-occurrence, span
//             bridge, v10.4 why_tags) -- three times, as run-film.js does: select1 (flags), select2
//             (+ moments' skip spans), select3 (+ the merged parent text, mergetext).
//   moments   pack/moments.js run(): Jev's moment spans inside each flagged scene.
import crypto from 'node:crypto';
import { checkSegments, planScene, unpackAnswers, RESERVE_FIXED_TOK as CLASSIFY_FIXED_TOK } from '../pack/classify.js';
import { loadSplit } from '../pack/split.js';
import { creditsSceneIds } from '../pack/credits.js';
import { buildQuestions, filmItems, filmQuestions, jevQuestions, JEV_QUESTIONS, JEV_SET_VERSION, JEV_FIX_MODE, VERSION as Q_VERSION, MODEL as JEV_MODEL } from '../pack/questions.js';
import { batchScenes } from '../pack/sonnetq.js';
import { SYSTEM as SQ_SYSTEM, userPrompt as sqUserPrompt, schemaFor as sqSchemaFor, parseAnswers, sceneView, checkIds, promptHash, SONNET_MODEL as SQ_MODEL, SONNET_Q_VERSION, P_MAP, P_UNLISTED } from '../pack/sonnet-questions.js';
import { scenesToAsk, childCryBody, CHILD_CRY_Q, CHILDCRY_VERSION, RESERVE_FIXED_TOK as CC_FIXED_TOK } from '../pack/childcry.js';
import { selectRun } from '../pack/select.js';
import { guardScenes, r1Scenes, guardBody, r1Body, GUARD_QS, R1_Q, GUARDED_IDS, RESOLVE_VERSION, RESERVE_FIXED_TOK as RV_FIXED_TOK } from '../pack/resolve.js';
import { mortalScenes, mortalBody, plannedAsks, MORTAL_QS, MORTAL_VERSION, RESERVE_FIXED_TOK as MV_FIXED_TOK } from '../pack/mortal.js';
import { planMoments, spansFromAnswers } from '../pack/moments.js';
import { wholeSceneSpan } from '../pack/spans.js';
import { runJobs, sizeRequest, usd, estTokens, PRICE_PER_MTOK, MAX_CONCURRENCY } from '../pack/jev-client.js';
import { key } from '../pack/env.js';
import { countTokens, PRICES } from '../pack/sonnet.js';
import { POLICY, fail, sonnetCall, Interrupted, checkInterrupted } from './common.js';
import { runCtx } from '../context.js';

/** run-film.js (v10.4): classify --cap 0.25, sonnetq 0.30, childcry 0.01, resolve 0.01, mortal 0.04, moments 0.02 */
export const ANSWER_CAPS = { classify: 0.25, sonnetq: 0.3, childcry: 0.01, resolve: 0.01, mortal: 0.04, moments: 0.02 };

const refusedOrFailed = (what) => (runCtx().signal?.aborted ? new Interrupted() : fail('jev_answers_failed', `Jev could not finish ${what}, so the film was not written in.`));

// ---- classify ----------------------------------------------------------------------------------------

export function planClassify({ seg, cues }) {
  checkSegments(seg, cues.length);
  const items = filmItems(seg);
  const credits = creditsSceneIds(seg.scenes, cues, POLICY.credits ?? {});
  const scenes = seg.scenes.filter((s) => !credits.ids.has(s.id));
  const plans = scenes.map((scene) => ({ scene, ...planScene({ seg, scene, cues: cues.slice(scene.start_cue - 1, scene.end_cue), items }) }));
  return { items, credits, plans, creditRows: seg.scenes.filter((s) => credits.ids.has(s.id)).map((s) => ({ id: s.id, start_cue: s.start_cue, end_cue: s.end_cue, start_ms: s.start_ms, end_ms: s.end_ms, n_lines: s.end_cue - s.start_cue + 1, skipped: 'end_credits', requests: [], answers: null })) };
}

export async function classifyStage(S) {
  const seg = S.out('refold').segments;
  const { cues } = S;
  const { partial, warnings } = checkSegments(seg, cues.length);
  const { items, credits, plans, creditRows } = planClassify({ seg, cues });
  const split = loadSplit();
  const jevQs = jevQuestions(seg, items);
  const qHash = crypto.createHash('sha256').update(JSON.stringify({ jev: jevQs, v9: buildQuestions({ channels: ['m', 'mod', 's', 'kind'] }), film: filmQuestions(items, { channels: ['fpl', 'fps'] }) })).digest('hex').slice(0, 12);
  const header = {
    film: seg.film, sources: seg.sources ?? null, run: 'r1', model: JEV_MODEL,
    question_set: { version: Q_VERSION, jev_set: JEV_SET_VERSION, jev_set_fix_mode: JEV_FIX_MODE, sha256_12: qHash, jev_questions: jevQs.length, jev_questions_universal: Object.keys(JEV_QUESTIONS).filter((k) => !k.includes('{item}')).length },
    film_items: items,
    layout: 'v10: one request per distinct minimal state (questions.js statesFor) + v9 lines / context requests for the v9-kept questions',
    split: { file: 'split.json', sha256_12: split.sha256_12, sonnet_used: split.sonnet_used },
    segments_model: seg.model ?? null, partial_segments: partial, segment_warnings: warnings,
    cap_usd: ANSWER_CAPS.classify, concurrency: MAX_CONCURRENCY, price_per_mtok: PRICE_PER_MTOK, reserve_fixed_tokens: CLASSIFY_FIXED_TOK,
  };
  const sum = (a) => a.reduce((x, y) => x + y, 0);
  const allReqs = plans.flatMap((p) => p.reqs);
  const estimate = { requests: allReqs.length, est_tokens_total: sum(allReqs.map((r) => r.est)), worst_case_reserve_usd: sum(allReqs.map((r) => r.reserveUsd)) };
  estimate.est_usd = usd(estimate.est_tokens_total);

  const w = S.wallet('jev', ANSWER_CAPS.classify);
  const started = Date.now();
  const jobs = plans.flatMap((p, i) => p.reqs.map((r) => ({ body: r.body, est: r.est, reserveUsd: r.reserveUsd, req: r, meta: { kind: 'classify', i, scene: p.scene.id, part: r.part, label: `${p.scene.id}/${r.part}`, questions: Object.keys(r.body.questions).length, of: p.reqs.length } })));
  S.progress?.({ stage: 'classify', total: jobs.length, scenes: plans.map((p) => ({ id: p.scene.id, requests: p.reqs.length })) });
  const { results, stopped } = await w.run(() => runJobs(jobs, { key: key('TYPESAFE_API_KEY'), budget: w.budget, concurrency: MAX_CONCURRENCY }));
  checkInterrupted();

  const rows = plans.map((p) => ({ id: p.scene.id, start_cue: p.scene.start_cue, end_cue: p.scene.end_cue, start_ms: p.scene.start_ms, end_ms: p.scene.end_ms, n_lines: p.scene.end_cue - p.scene.start_cue + 1, cast_used: p.castUsed, verified_sentences: p.verifiedSentences, sentences: p.sentences, summary_empty: p.summaryEmpty, requests: [], answers: null }));
  const into = rows.map(() => ({ q: {} }));
  const got = rows.map(() => 0);
  results.forEach((res, j) => {
    const { i, part } = res.meta;
    const row = rows[i];
    if (res.skipped) { row.skipped = res.skipped; return; }
    row.requests.push({ part, ...res.record });
    if (!res.ok) { row.error = res.error; return; }
    try { unpackAnswers(jobs[j].req, res.json.answers, into[i]); got[i] += 1; } catch (err) { row.error = err.message; }
  });
  rows.forEach((row, i) => {
    if (row.error || row.skipped || got[i] !== plans[i].reqs.length) return;
    const a = into[i];
    if (plans[i].summaryEmpty) a.fps = null;
    row.answers = a;
  });
  const done = rows.filter((r) => r.answers);
  // The experiment wrote an incomplete run and let select.js leave the unanswered scenes unclassified.
  // A parent-facing guide must not silently skip scenes, so an incomplete classify stops the run here.
  if (done.length !== plans.length) throw refusedOrFailed(`answering its questions for every scene (${done.length} of ${plans.length}${stopped ? `; ${stopped.reason}` : ''})`);
  const allRows = [...rows, ...creditRows].sort((a, b) => a.start_cue - b.start_cue);
  const reqs = rows.flatMap((r) => r.requests);
  const inputTokens = reqs.reduce((s, r) => s + (r.input_tokens ?? 0), 0);
  S.detail(`Jev answered ${jevQs.length + Object.keys(buildQuestions({ channels: ['m', 'mod', 's', 'kind'] })).length} kinds of question over ${done.length} scenes in ${reqs.length} requests`);
  return {
    ...header, run_at: new Date(started).toISOString(), wall_ms: Date.now() - started, complete: true, stopped,
    scenes_total: plans.length, scenes_done: done.length, requests: reqs.length,
    retries: reqs.reduce((s, r) => s + (r.retries ?? 0), 0), estimate,
    usage: { input_tokens: inputTokens, output_tokens: reqs.reduce((s, r) => s + (r.output_tokens ?? 0), 0) },
    cost_usd: Number(w.budget.spent.toFixed(8)), credits: credits.span, credits_scenes: creditRows.map((r) => r.id),
    scenes: allRows,
  };
}

// ---- sonnetq -----------------------------------------------------------------------------------------

/**
 * The non-credits scenes a stored sonnetq run has no answers for (null or absent), plus every scene when
 * the run says it was incomplete. Empty = complete. Pure.
 */
export function sonnetUnanswered(stored, seg, cues) {
  const credits = creditsSceneIds(seg.scenes, cues, POLICY.credits ?? {});
  const ids = seg.scenes.filter((s) => !credits.ids.has(s.id)).map((s) => s.id);
  const missing = new Set([...ids.filter((id) => !stored?.scenes?.[id]), ...(Array.isArray(stored?.missing) ? stored.missing : [])]);
  // A run that says it stopped early is incomplete even if every scene has an entry.
  if (!missing.size && (stored?.complete === false || stored?.stopped)) return ids;
  return [...missing];
}

export async function sonnetqStage(S) {
  if (S.mode === 'demo') {
    const stored = S.stored('sonnetq');
    const split = loadSplit();
    // select.js refuses Sonnet answers asked with another question list or prompt; so does the demo.
    if (!stored || stored.version !== SONNET_Q_VERSION || JSON.stringify(stored.split?.sonnet_asked ?? []) !== JSON.stringify(split.sonnet_asked) || (stored.prompt_sha256_12 && stored.prompt_sha256_12 !== promptHash(split.sonnet_asked))) {
      throw fail('stale_artifacts', "This film's stored Sonnet answers were asked a different question list than this pipeline uses, so a demo run of it would not be the real pipeline.");
    }
    // An incomplete stored run would drop Sonnet's reasons for the scenes it never answered.
    const unanswered = sonnetUnanswered(stored, S.out('refold').segments, S.cues);
    if (unanswered.length) throw fail('incomplete_artifacts', `This film's stored Sonnet answers leave ${unanswered.length} scene${unanswered.length === 1 ? '' : 's'} unanswered, so a live run of it would not be the real pipeline.`);
    S.detail(`Sonnet's stored answers (made ${stored.run_at?.slice(0, 10) ?? 'earlier'}), not asked again`);
    return { ...stored, replayed: true };
  }
  const seg = S.out('refold').segments;
  const { cues } = S;
  const split = loadSplit();
  const ids = split.sonnet_asked;
  checkIds(ids);
  const credits = creditsSceneIds(seg.scenes, cues, POLICY.credits ?? {});
  const views = seg.scenes.filter((scene) => !credits.ids.has(scene.id)).map((scene) => sceneView({ seg, scene, cues: cues.slice(scene.start_cue - 1, scene.end_cue) }));
  const maxChars = 24000; const maxScenes = 20; const concurrency = 3; const effort = 'low';
  const batches = batchScenes(views, { maxChars, maxScenes });
  const film = { title: seg.film.title, year: seg.film.year };
  const [pIn, pOut] = PRICES[SQ_MODEL];
  const w = S.wallet('sonnet', ANSWER_CAPS.sonnetq);
  const maxTokensFor = (n) => Math.min(8000, 500 + n * 160);
  const calls = [];
  const answers = {};
  let stopped = null;
  let inflight = 0;
  const doCall = async (scenes, label) => {
    const sceneIds = scenes.map((s) => s.id);
    const user = sqUserPrompt({ film, scenes, ids });
    const schema = sqSchemaFor(sceneIds, ids);
    const counted = await countTokens({ model: SQ_MODEL, system: SQ_SYSTEM, user });
    const inWorst = (counted ?? Math.ceil((SQ_SYSTEM.length + user.length) / 2.5)) + 2500;
    const maxTokens = maxTokensFor(scenes.length);
    const worst = (inWorst * pIn + maxTokens * pOut) / 1e6;
    const row = { label, scenes: sceneIds, counted_input: counted, reserved_usd: +worst.toFixed(6), max_tokens: maxTokens };
    calls.push(row);
    // a refused reservation waits while other calls are in flight (theirs settle below their worst case)
    while (!stopped && !w.budget.reserve(worst)) {
      if (inflight === 0) { stopped = `cap: spent ${w.budget.spent.toFixed(4)} + reserved ${w.budget.reserved.toFixed(4)} + next ${worst.toFixed(4)} > ${w.budget.cap.toFixed(4)}`; break; }
      await new Promise((r) => setTimeout(r, 500));
    }
    if (stopped) { row.skipped = 'cap'; return row; }
    inflight++;
    try {
      const { r, cost } = await sonnetCall(w, { system: SQ_SYSTEM, user, schema, maxTokens, effort, worst, model: SQ_MODEL, label, reserved: true });
      const parsed = parseAnswers(r.data, sceneIds, ids);
      Object.assign(answers, parsed.answers);
      Object.assign(row, { usage: r.usage, cost_usd: +cost.toFixed(6), latency_ms: r.latencyMs, missing: parsed.missing, problems: parsed.problems, listed: Object.values(parsed.answers).reduce((a, x) => a + Object.keys(x).length, 0) });
    } catch (err) {
      Object.assign(row, { error: String(err.message).slice(0, 200), cost_usd: +(err.cost ?? 0).toFixed(6) });
      if (err.refused) { row.skipped = 'ledger'; stopped ??= err.message; }
    } finally {
      inflight--;
    }
    return row;
  };
  const started = Date.now();
  let next = 0;
  await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, batches.length)) }, async () => {
    while (next < batches.length && !runCtx().signal?.aborted) { const i = next++; await doCall(batches[i], `b${String(i + 1).padStart(2, '0')}`); }
  }));
  checkInterrupted();
  const left = views.filter((v) => !answers[v.id] && !calls.some((c) => c.skipped && c.scenes.includes(v.id)));
  if (left.length && !stopped) for (const [k, b] of batchScenes(left, { maxChars, maxScenes }).entries()) await doCall(b, `retry${k + 1}`);
  checkInterrupted();
  const missing = views.filter((v) => !answers[v.id]).map((v) => v.id);
  const spent = calls.reduce((a, c) => a + (c.cost_usd ?? 0), 0);
  // The experiment wrote an incomplete run and let select.js skip the Sonnet-owned hazards of the
  // unanswered scenes. A guide must not silently lose those reasons (a rebuild would replace a whole
  // guide with it), so a run that could not answer every non-credits scene stops here, like classify.
  if (missing.length || stopped) {
    throw fail('sonnet_answers_failed', `Sonnet could not answer its questions for every scene (${views.length - missing.length} of ${views.length}${stopped ? '; stopped early' : ''}), so the film was not written in.`);
  }
  S.detail(`Sonnet answered ${ids.length} questions for ${views.length} scenes`);
  return {
    film: seg.film, run: 'r1', version: SONNET_Q_VERSION, model: SQ_MODEL, effort,
    split: { file: 'split.json', sha256_12: split.sha256_12, sonnet_asked: ids, sonnet_used: split.sonnet_used },
    prompt_sha256_12: promptHash(ids), p_map: P_MAP, p_unlisted: P_UNLISTED,
    run_at: new Date(started).toISOString(), wall_ms: Date.now() - started,
    complete: missing.length === 0 && !stopped, stopped, missing,
    calls, cost_usd: +spent.toFixed(6),
    usage: { input_tokens: calls.reduce((a, c) => a + (c.usage?.input_tokens ?? 0), 0), output_tokens: calls.reduce((a, c) => a + (c.usage?.output_tokens ?? 0), 0) },
    scenes: Object.fromEntries(views.map((v) => [v.id, answers[v.id] ?? null])),
    credits_scenes: [...credits.ids],
  };
}

// ---- childcry ----------------------------------------------------------------------------------------

export async function childcryStage(S) {
  const seg = S.out('refold').segments;
  const sonnet = S.out('sonnetq');
  const { cues } = S;
  const act = POLICY.overrides?.['e.crying']?.act ?? POLICY.act;
  const ask = scenesToAsk({ seg, sonnet, cues, act, creditsCfg: POLICY.credits ?? {} });
  const byId = new Map(seg.scenes.map((s) => [s.id, s]));
  const jobs = ask.map((x) => {
    const body = childCryBody({ seg, scene: byId.get(x.id), cues });
    const sz = sizeRequest(body, `childcry:${x.id}`, { reserveXEst: 3.0 });
    return { body, est: sz.est, reserveUsd: sz.reserveUsd + usd(CC_FIXED_TOK), meta: { kind: 'childcry', id: x.id, scene: x.id, label: `childcry:${x.id}` } };
  });
  const w = S.wallet('jev', ANSWER_CAPS.childcry);
  S.progress?.({ stage: 'classify', total: jobs.length });
  const r = jobs.length ? await w.run(() => runJobs(jobs, { key: key('TYPESAFE_API_KEY'), budget: w.budget, concurrency: MAX_CONCURRENCY })) : { results: [] };
  if (r.results.some((x) => !x.ok)) throw refusedOrFailed('checking who cries');
  const scenes = {};
  for (const x of r.results) {
    const p = Number(x.json.answers?.child?.noul);
    if (!Number.isFinite(p)) throw refusedOrFailed('checking who cries (an answer was missing)');
    scenes[x.meta.id] = { crying_p: ask.find((a) => a.id === x.meta.id).p, p_child: Math.round(p * 1000) / 1000 };
  }
  if (jobs.length) S.detail(`Jev checked whether the one crying is a child in ${jobs.length} scene${jobs.length === 1 ? '' : 's'}`);
  return { film: seg.film, version: CHILDCRY_VERSION, run: 'r1', model: JEV_MODEL, question: CHILD_CRY_Q, crying_act: act, run_at: new Date().toISOString(), requests: jobs.length, cost_usd: +w.budget.spent.toFixed(8), scenes };
}

// ---- resolve (v10.2 resolution guard) -----------------------------------------------------------------

const r3 = (x) => Math.round(x * 1000) / 1000;

/** resolve.js CLI body (the pipeline's asks: only the guard questions policy.flag.resolution_guard uses). */
export async function resolveStage(S) {
  const policy = POLICY;
  const seg = S.out('refold').segments;
  const sonnet = S.out('sonnetq');
  const { cues } = S;
  const actOf = (id) => policy.overrides?.[`e.${id}`]?.act ?? policy.overrides?.[`pl.${id}`]?.act ?? policy.act;
  const askR1 = policy.flag?.rule1_question?.enabled === true;
  const askGuard = !!policy.flag?.resolution_guard;
  const byId = new Map(seg.scenes.map((s) => [s.id, s]));
  const G = policy.flag?.resolution_guard ?? null;
  const gIds = !G ? GUARDED_IDS : Object.keys(G.cancels);
  const gQs = !G ? Object.keys(GUARD_QS) : [...new Set(Object.values(G.cancels).flat())];
  const gs = askGuard ? guardScenes({ seg, sonnet, cues, act: actOf, creditsCfg: policy.credits ?? {}, ids: gIds }) : [];
  const rs = askR1 ? r1Scenes({ seg, cues, creditsCfg: policy.credits ?? {} }) : [];
  const job = (kind, id, body) => { const sz = sizeRequest(body, `${kind}:${id}`, { reserveXEst: 3.0 }); return { body, est: sz.est, reserveUsd: sz.reserveUsd + usd(RV_FIXED_TOK), meta: { kind: kind === 'guard' ? 'resolve' : 'resolve_r1', id, scene: id, label: `${kind}:${id}` } }; };
  const jobs = [...gs.map((x) => job('guard', x.id, guardBody({ seg, scene: byId.get(x.id), cues, qs: gQs }))), ...rs.map((id) => job('r1', id, r1Body({ seg, scene: byId.get(id), cues })))];
  const w = S.wallet('jev', ANSWER_CAPS.resolve);
  S.progress?.({ stage: 'classify', total: jobs.length });
  const r = jobs.length ? await w.run(() => runJobs(jobs, { key: key('TYPESAFE_API_KEY'), budget: w.budget, concurrency: MAX_CONCURRENCY })) : { results: [] };
  if (r.results.some((x) => !x.ok)) throw refusedOrFailed('asking whether a scene ends in an arrest or a celebration');
  const scenes = {};
  for (const x of r.results) {
    const a = x.json.answers ?? {};
    const s = (scenes[x.meta.id] ??= {});
    if (x.meta.kind === 'resolve') {
      s.guard_ids = gs.find((g) => g.id === x.meta.id).ids;
      s.guard = Object.fromEntries(gQs.map((k) => { const p = Number(a[k]?.noul); if (!Number.isFinite(p)) throw refusedOrFailed('the resolution questions (an answer was missing)'); return [k, r3(p)]; }));
    } else {
      const p = Number(a.r1?.noul); if (!Number.isFinite(p)) throw refusedOrFailed('the rule-1 question (an answer was missing)');
      s.r1 = r3(p);
    }
  }
  if (jobs.length) S.detail(`Jev checked ${gs.length} scene${gs.length === 1 ? '' : 's'} for an arrest or a happy ending that cancels a danger`);
  return { film: seg.film, version: RESOLVE_VERSION, run: 'r1', model: JEV_MODEL, questions: { guard: Object.fromEntries(gQs.map((k) => [k, GUARD_QS[k]])), ...(askR1 ? { r1: R1_Q } : {}) }, asked: { guard: askGuard, r1: askR1 }, run_at: new Date().toISOString(), requests: jobs.length, cost_usd: +w.budget.spent.toFixed(8), scenes };
}

// ---- mortal (v10.3 mortal-danger questions) ------------------------------------------------------------

/** mortal.js CLI body (not --dev: only the questions policy.flag.mortal keeps, in their chosen state). */
export async function mortalStage(S) {
  const policy = POLICY;
  const asks = plannedAsks(policy);
  const seg = S.out('refold').segments;
  const { cues } = S;
  const byId = new Map(seg.scenes.map((s) => [s.id, s]));
  const ids = Object.keys(asks).length ? mortalScenes({ seg, cues, creditsCfg: policy.credits ?? {} }) : [];
  const jobs = [];
  for (const id of ids) for (const [state, qs] of Object.entries(asks)) {
    const body = mortalBody({ seg, scene: byId.get(id), cues, state, qs });
    if (!body) continue;
    const sz = sizeRequest(body, `mortal:${id}@${state}`, { reserveXEst: 3.0 });
    jobs.push({ body, est: sz.est, reserveUsd: sz.reserveUsd + usd(MV_FIXED_TOK), meta: { kind: 'mortal', id, scene: id, state, qs, label: `mortal:${id}@${state}` } });
  }
  const w = S.wallet('jev', ANSWER_CAPS.mortal);
  S.progress?.({ stage: 'classify', total: jobs.length });
  const r = jobs.length ? await w.run(() => runJobs(jobs, { key: key('TYPESAFE_API_KEY'), budget: w.budget, concurrency: MAX_CONCURRENCY })) : { results: [] };
  if (r.results.some((x) => !x.ok)) throw refusedOrFailed('the mortal-danger questions');
  const scenes = {};
  for (const x of r.results) {
    const a = x.json.answers ?? {};
    const s = (scenes[x.meta.id] ??= {});
    for (const q of x.meta.qs) { const p = Number(a[q]?.noul); if (!Number.isFinite(p)) throw refusedOrFailed('the mortal-danger questions (an answer was missing)'); s[`${q}@${x.meta.state}`] = r3(p); }
  }
  if (jobs.length) S.detail(`Jev asked ${[...new Set(Object.values(asks).flat())].length} life-or-death questions of ${ids.length} scenes`);
  return { film: seg.film, version: MORTAL_VERSION, run: 'r1', model: JEV_MODEL, dev: false, asked: asks, questions: Object.fromEntries([...new Set(Object.values(asks).flat())].map((k) => [k, MORTAL_QS[k]])), run_at: new Date().toISOString(), requests: jobs.length, cost_usd: +w.budget.spent.toFixed(8), scenes };
}

// ---- select ------------------------------------------------------------------------------------------

/**
 * select.js CLI body (v10.4): selectRun with the split's Sonnet ids, the child-cry, resolve and mortal
 * answers, and whatever of moments / the merged parent text (whyfinal) exists.
 */
export function selectStage(S, { moments = null, why = null } = {}) {
  const run = S.out('classify');
  const split = loadSplit();
  const sonnet = split.sonnet_used.length ? S.out('sonnetq') : null;
  const childcry = S.out('childcry');
  const resolve = S.out('resolve');
  const mortal = S.out('mortal');
  if (!resolve && (POLICY.flag.resolution_guard || POLICY.flag.rule1_question?.enabled)) throw fail('internal', 'The resolution answers are missing, so the flags cannot be decided.');
  if (!mortal && POLICY.flag.mortal?.enabled) throw fail('internal', 'The mortal-danger answers are missing, so the flags cannot be decided.');
  const out = selectRun(run, POLICY, { moments, cues: S.cues, why, sonnet, used: split.sonnet_used, childcry, resolve, split, mortal });
  const fl = out.scenes.filter((x) => x.flagged);
  out.summary.why = { text_strict: fl.filter((x) => x.why?.text_rule === 'strict').length, text_loose: fl.filter((x) => x.why?.text_rule === 'loose').length, title_strict: fl.filter((x) => x.why?.title_rule === 'strict').length, title_loose: fl.filter((x) => x.why?.title_rule === 'loose').length, described_loose: fl.filter((x) => x.why?.source === 'described_loose').length, why_tags_missing: fl.filter((x) => !x.why_tags?.tags?.length).map((x) => x.id), described: fl.filter((x) => x.why?.source === 'described').length, described_plus_reason: fl.filter((x) => x.why?.source === 'described+reason').length, described_only: fl.filter((x) => x.why?.source === 'described_only').length, plain_reason: fl.filter((x) => x.why?.source === 'plain_reason').length, no_verified_text: fl.filter((x) => x.why?.source === 'no_verified_text').length, missing: fl.filter((x) => !x.why).map((x) => x.id) };
  out.summary.flag_reasons_by = { sonnet: fl.flatMap((x) => x.flag_reasons).filter((r) => r.by === 'sonnet').length, jev: fl.flatMap((x) => x.flag_reasons).filter((r) => r.by === 'jev').length, scenes_flagged_only_by_sonnet: fl.filter((x) => x.flag_reasons.every((r) => r.by === 'sonnet')).length };
  out.split = { sha256_12: split.sha256_12, sonnet_used: split.sonnet_used };
  return out;
}

export async function select1Stage(S) {
  const out = selectStage(S);
  S.detail(`${out.summary.flagged} of ${out.summary.scenes} scenes flagged`);
  return out;
}
export async function select2Stage(S) { return selectStage(S, { moments: S.out('moments') }); }
/** select3: the merged parent text (mergetext = describe2.js --merge, text rule A0>C) and every flagged scene's why_tags. */
export async function select3Stage(S) {
  const out = selectStage(S, { moments: S.out('moments'), why: S.out('mergetext') });
  S.detail(`${out.summary.flagged} flagged scenes; every one says why (${out.summary.why.why_tags_missing.length ? `${out.summary.why.why_tags_missing.length} without tags` : 'tags on all'})`);
  return out;
}

// ---- moments -----------------------------------------------------------------------------------------

export async function momentsStage(S) {
  const cfg = POLICY;
  const tags = S.out('select1');
  const jevRun = S.out('classify');
  const seg = S.out('refold').segments;
  const items = jevRun.film_items ?? [];
  const { cues } = S;
  const cueByIndex = new Map(cues.map((c) => [c.index, c]));
  const flagged = tags.scenes.filter((s) => s.flagged);
  const plans = flagged.map((s) => ({ s, plan: planMoments({ film: seg.film, scene: s, cues: cues.slice(s.start_cue - 1, s.end_cue), reasons: s.flag_reasons, items, cfg, cueByIndex }) }));
  const calls = plans.filter((p) => p.plan.call);
  const w = S.wallet('jev', ANSWER_CAPS.moments);
  const started = Date.now();
  const jobs = calls.map((p) => ({ body: p.plan.body, est: p.plan.est, reserveUsd: p.plan.reserveUsd, meta: { kind: 'moments', id: p.s.id, scene: p.s.id, label: `${p.s.id}/moments` } }));
  S.progress?.({ stage: 'moments', total: jobs.length });
  const { results, stopped } = jobs.length ? await w.run(() => runJobs(jobs, { key: key('TYPESAFE_API_KEY'), budget: w.budget, concurrency: MAX_CONCURRENCY })) : { results: [], stopped: null };
  checkInterrupted();
  const byId = new Map(results.map((r) => [r.meta.id, r]));
  const scenes = {};
  for (const { s, plan } of plans) {
    if (!plan.call) { scenes[s.id] = { method: plan.method, why: plan.why, dialogue_per_min: plan.dialogue_per_min, spans: plan.spans, reasons: s.flag_reasons.map((r) => r.id) }; continue; }
    const res = byId.get(s.id);
    // The experiment's own fallback: a moments request that failed or hit the cap skips the whole scene.
    if (!res?.ok) { scenes[s.id] = { method: 'whole_scene', why: res?.skipped ? res.skipped : 'error', spans: [wholeSceneSpan(s, cues.slice(s.start_cue - 1, s.end_cue), cfg, cueByIndex)], reasons: plan.reasons, request: res?.record ?? null }; continue; }
    const cueSlice = cues.slice(s.start_cue - 1, s.end_cue);
    scenes[s.id] = { ...spansFromAnswers(plan, res.json.answers, cueSlice, s, cfg, cueByIndex), reasons: plan.reasons, dialogue_per_min: plan.dialogue_per_min, request: res.record };
  }
  for (const [id, m] of Object.entries(scenes)) {
    const s = flagged.find((x) => x.id === id);
    m.skip_ms = m.spans.reduce((a, x) => a + x.end_ms - x.start_ms, 0);
    m.scene_ms = s.end_ms - s.start_ms;
  }
  const reqs = results.map((r) => r.record).filter(Boolean);
  const skip = Object.values(scenes).reduce((a, m) => a + m.skip_ms, 0);
  const whole = Object.values(scenes).reduce((a, m) => a + m.scene_ms, 0);
  S.detail(`${flagged.length} flagged scenes; the moments to skip come to ${Math.round(skip / 60000)} of their ${Math.round(whole / 60000)} minutes`);
  return {
    film: seg.film, run: 'r1', model: JEV_MODEL, policy: { ...cfg.moments, wordless: cfg.wordless ?? null },
    run_at: new Date(started).toISOString(), wall_ms: Date.now() - started, stopped,
    flagged_scenes: flagged.length, requests: reqs.length,
    usage: { input_tokens: reqs.reduce((a, r) => a + (r.input_tokens ?? 0), 0) },
    cost_usd: Number(w.budget.spent.toFixed(8)), skip_ms: skip, flagged_scene_ms: whole, scenes,
  };
}

export { estTokens };
