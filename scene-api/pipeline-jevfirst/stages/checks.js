// Jev checks what Sonnet wrote: the claim check, the wordless-scene fill, and the acceptance rule.
//
//   claims   PORT of experiments/trigger-scan/v10_1/check-claims.js (a script whose body runs at
//            import time): the main pass exactly -- every claim alone (batch 1), evidence = its own
//            cites + 2 neighbouring lines, placement for sentences citing Wikipedia, the policy's
//            claim_accept rule, adoptTmdbNames, applyChecks. Not ported: --reuse, --refold and the
//            leakage probes, which are measurement tools of the experiment.
//   fill     pack/fill.js's CLI body, with its pure functions imported unchanged.
//   refold   pack/refold.js's CLI body (applyUnified with ruleOf(policy)).
import { buildClaims, strideBatches, batchBody, placementBody, verdictOf, applyChecks, tally, MODEL as JEV_CLAIMS_MODEL, VERSION as CLAIMS_VERSION, evidenceText, evidenceIds, DEFAULT_RULE, adoptTmdbNames } from '../pack/claims.js';
import { reserveUsd as choiceReserveUsd, checkLimits, estTokens } from '../pack/jev.js';
import { runJobs, sizeRequest, MAX_CONCURRENCY } from '../pack/jev-client.js';
import { key } from '../pack/env.js';
import { judgementWords, transcriptGrams } from '../pack/validate.js';
import { wordlessScenes, anchorsOf, sceneContext, validateScene, fillPlacement, foldFill, neighbourBody, SYSTEM as FILL_SYSTEM, SCHEMA as FILL_SCHEMA, userPrompt as fillUserPrompt, FILL_VERSION, SONNET_MODEL as FILL_MODEL } from '../pack/fill.js';
import { splitAlignmentBySentence, applyUnified } from '../pack/accept.js';
import { ruleOf } from '../pack/refold.js';
import { countTokens, PRICES } from '../pack/sonnet.js';
import { POLICY, fail, sonnetCall, checkInterrupted, Interrupted, quoteRuler, r3, kindsOf } from './common.js';
import { runCtx } from '../context.js';

/** run-film.js: claims --cap 0.05; fill --cap 0.15 --jev-cap 0.02 */
export const CHECK_CAPS = { claims: 0.05, fill_sonnet: 0.15, fill_jev: 0.02 };
const CONTEXT = 2;
const BATCH = 1;

const jevFailed = (what) => {
  if (runCtx().signal?.aborted) return new Interrupted();
  return fail('jev_check_failed', `Jev could not finish ${what}, so the film was not written in.`);
};

export async function claimsStage(S) {
  const RULE = { ...DEFAULT_RULE, ...(POLICY.claim_accept ?? {}) };
  delete RULE._about;
  const seg = structuredClone(S.out('segment_build').segments);
  const SRC = S.out('sources');
  const { cues } = S;
  if (cues.length !== seg.sources.srt.cues) throw fail('internal', 'The subtitle track changed since the scene cut was made.');
  const src = { cues, W: SRC.wikipedia.sentences, T: SRC.tmdb.cast };
  const claims = buildClaims(seg, src, { context: CONTEXT });
  const refusedAliases = claims.refused_aliases ?? [];
  const sceneById = Object.fromEntries(seg.scenes.map((s) => [s.id, s]));
  const sceneLines = (s) => cues.slice(s.start_cue - 1, s.end_cue).map((q) => evidenceText(`L${q.index}`, src).replace(' (subtitle line)', ''));
  const placementWanted = claims.filter((c) => c.target.type === 'sentence' && c.cites.some((id) => id[0] === 'W'));

  const batches = strideBatches(claims, BATCH);
  const jobs = batches.map((b, i) => ({ kind: 'batch', label: `batch${i}`, claims: b, body: batchBody(b) }));
  for (const c of placementWanted) jobs.push({ kind: 'placement', label: `place:${c.key}`, key: c.key, claim: c.claim, body: placementBody(c.claim, sceneLines(sceneById[c.target.scene])) });
  for (const j of jobs) checkLimits(j.body, j.label);

  const w = S.wallet('jev', CHECK_CAPS.claims);
  const t0 = Date.now();
  const runnable = jobs.map((j) => ({ body: j.body, est: estTokens(j.body), reserveUsd: choiceReserveUsd(j.body), meta: { kind: j.kind === 'batch' ? 'claim' : 'placement', label: j.label, job: j, text: j.kind === 'batch' ? j.claims[0].claim : j.claim, rule: RULE } }));
  S.progress?.({ stage: 'claims', total: runnable.length, kinds: kindsOf(runnable) });
  const { results } = await w.run(() => runJobs(runnable, { key: key('TYPESAFE_API_KEY'), budget: w.budget, concurrency: MAX_CONCURRENCY }));
  if (results.some((r) => !r.ok)) throw jevFailed('checking what Sonnet wrote');
  const checks = {};
  const placements = {};
  const raw = {};
  let inputTokens = 0;
  const requests = [];
  for (const r of results) {
    const job = r.meta.job;
    inputTokens += r.record.input_tokens;
    requests.push({ label: job.label, ok: true, ms: r.record.latency_ms, input_tokens: r.record.input_tokens, attempts: r.record.attempts.length, reserve_usd: +r.record.reserve_usd.toFixed(8), ...(r.record.over_reserve ? { over_reserve: true } : {}) });
    if (job.kind === 'batch') {
      job.claims.forEach((c, i) => {
        const a = r.json.answers?.[`r${i}`];
        if (!a) throw jevFailed('checking what Sonnet wrote (an answer was missing)');
        checks[c.key] = verdictOf(a, RULE);
        raw[c.key] = { batch: job.label, pos: i, batch_size: job.claims.length };
      });
    } else {
      const a = r.json.answers?.placement;
      if (!a) throw jevFailed('placing the plot sentences (an answer was missing)');
      placements[job.key] = { choice: a.choice, confidence: +Number(a.confidence).toFixed(4), probabilities: Object.fromEntries(Object.entries(a.probabilities ?? {}).map(([k, v]) => [k, +Number(v).toFixed(4)])) };
    }
  }
  const mainMs = Date.now() - t0;

  for (const s of seg.scenes) for (const x of s.sentences) { const j = judgementWords(x.text); if (j.length) x.judgement_words = j; else delete x.judgement_words; }
  const namesByTmdb = adoptTmdbNames(seg, src, checks);
  const { seg: checked, dropped } = applyChecks(seg, checks, placements, RULE);
  const t = tally(checks);
  const typeKey = (c) => (c.target.type === 'cast' ? `cast.${c.target.field}` : c.target.type);
  const byType = {};
  for (const c of claims) {
    const st = checks[c.key];
    const row = (byType[typeKey(c)] ??= { n: 0, verified: 0, unverified: 0, contradicted: 0 });
    row.n++; row[st.status]++;
  }
  const sent = checked.scenes.flatMap((s) => s.sentences);
  const sceneMs = (s) => s.end_ms - s.start_ms;
  checked.claim_check = {
    version: CLAIMS_VERSION, model: JEV_CLAIMS_MODEL, run_at: new Date(t0).toISOString(), rule: RULE, batch_size: BATCH,
    evidence_context_lines: CONTEXT, claims: claims.length, requests: requests.length, reused: { claims: 0, placements: 0, from: null },
    input_tokens: inputTokens, cost_usd: +w.budget.spent.toFixed(6), main_pass_cost_usd: +w.budget.spent.toFixed(6), wall_ms_main: mainMs, wall_ms_probes: 0,
    tally: t, by_type: byType, aliases_refused_without_check: refusedAliases, names_from_tmdb: namesByTmdb,
    placement: Object.fromEntries(Object.entries(placements).map(([k, v]) => [k, `${v.choice} ${v.confidence}`])),
    unplaced_sentences: sent.filter((x) => x.check?.status === 'unplaced').length,
    dropped_by_check: dropped,
    probe: { singles: 0, singles_same_status: 0 },
    summaries: {
      sentences_in_summary: `${sent.filter((x) => x.check?.status === 'verified' && !x.judgement_words).length}/${sent.length}`,
      scenes_with_verified_summary: checked.scenes.filter((s) => s.summary).length,
      minutes_with_verified_summary: +(checked.scenes.filter((s) => s.summary).reduce((a, s) => a + sceneMs(s), 0) / 60000).toFixed(3),
      scenes_with_empty_summary: checked.scenes.filter((s) => !s.summary).map((s) => s.id),
    },
  };
  const claimsDoc = {
    film: seg.film, version: CLAIMS_VERSION, model: JEV_CLAIMS_MODEL, rule: RULE,
    claims: claims.map((c) => ({ key: c.key, target: c.target, claim: c.claim, cites: c.cites, evidence_ids: c.evidence_ids, ...checks[c.key], ...raw[c.key], ...(placements[c.key] ? { placement: placements[c.key] } : {}) })),
    refused_aliases: refusedAliases, probe: { singles: [], swap: [] }, requests,
  };
  S.detail(`Jev checked ${claims.length} sentences against the lines they cite: ${t.verified} supported, ${t.unverified} not supported, ${t.contradicted} contradicted`);
  return { segments: checked, claims: claimsDoc };
}

/** fill.js's CLI body. `mode === 'demo'` takes Sonnet's fill sentences from the stored run instead of calling. */
export async function fillStage(S) {
  const cfg = POLICY;
  const RULE = { ...DEFAULT_RULE, ...cfg.claim_accept };
  const seg = S.out('claims').segments;
  const SRC = S.out('sources');
  const { cues } = S;
  const W = SRC.wikipedia.sentences;
  const film = { title: SRC.film.title, year: SRC.film.year ?? seg.film.year ?? null };
  const anchors = anchorsOf(seg);
  const wordless = wordlessScenes(seg, cues, cfg);
  const ctxs = wordless.map((ws) => sceneContext(seg, ws, cues, W, anchors)).filter((c) => c.candidates.length);
  const started = Date.now();
  let modelOut = null;
  let sonnet = null;
  if (S.mode === 'demo') {
    const stored = S.stored('fill');
    modelOut = stored?.model_output ?? null;
    sonnet = stored?.sonnet ? { ...stored.sonnet, replayed: true } : null;
  } else if (ctxs.length) {
    const user = fillUserPrompt({ film, scenes: ctxs });
    const [pIn, pOut] = PRICES[FILL_MODEL];
    const counted = await countTokens({ model: FILL_MODEL, system: FILL_SYSTEM, user });
    const inWorst = (counted ?? Math.ceil((FILL_SYSTEM.length + user.length) / 2.5)) + 1500;
    const maxTokens = 6000;
    const effort = cfg.fill.effort ?? 'medium';
    const worst = (inWorst * pIn + maxTokens * pOut) / 1e6;
    const w = S.wallet('sonnet', CHECK_CAPS.fill_sonnet);
    try {
      const { r, cost } = await sonnetCall(w, { system: FILL_SYSTEM, user, schema: FILL_SCHEMA, maxTokens, effort, worst, model: FILL_MODEL, label: 'fill' });
      modelOut = quoteRuler(cues)(r.data);
      sonnet = { model: FILL_MODEL, effort, usage: r.usage, cost_usd: +cost.toFixed(6), reserved_usd: +worst.toFixed(6), latency_ms: r.latencyMs };
    } catch (err) {
      if (runCtx().signal?.aborted) throw new Interrupted();
      throw fail('fill_failed', 'Sonnet could not describe the scenes with almost no dialogue, so the film was not written in.');
    }
  }
  checkInterrupted();

  const grams = transcriptGrams(cues.map((c) => c.text), 9);
  const nC = { nCues: cues.length, wCount: W.length, tCount: SRC.tmdb.cast.length, grams, maxWords: cfg.fill.max_words ?? 25 };
  const scenes = ctxs.map((c) => {
    const raw = (modelOut?.scenes ?? []).find((x) => x.id === c.id);
    const v = validateScene(raw, c, nC);
    const decisions = Object.fromEntries((raw?.decisions ?? []).filter((d) => c.candidates.includes(Number(String(d.w).replace(/^W/i, '')))).map((d) => [String(d.w).toUpperCase(), d.during_this_scene]));
    const yes = Object.entries(decisions).filter(([, d]) => d === 'yes').map(([x]) => x);
    const uncovered = yes.filter((x) => !v.kept.some((k) => k.cites.includes(x)));
    return { id: c.id, window: c.window, candidates: c.candidates, minutes: c.minutes, dialogue_per_min: c.dialogue_per_min, decisions, uncovered_yes: uncovered, returned: raw?.sentences?.length ?? 0, rejected: v.rejected, sentences: v.kept };
  });

  const jobs = [];
  const job = (kind, meta, body) => { const sz = sizeRequest(body, `${kind}:${meta.id}`, { reserveXEst: 3.0 }); jobs.push({ body, est: sz.est, reserveUsd: sz.reserveUsd, meta: { kind: `fill_${kind}`, label: `${kind}:${meta.id}`, ...meta } }); };
  for (const f of scenes) {
    const c = ctxs.find((x) => x.id === f.id);
    const s = seg.scenes.find((x) => x.id === f.id);
    f.sentences.forEach((x, k) => {
      const id = `${f.id}.f${k + 1}`;
      const ids = evidenceIds(x.cites, { context: 2, range: [s.start_cue, s.end_cue], nCues: cues.length });
      job('support', { id, scene: f.id, k, text: x.text, rule: RULE }, batchBody([{ claim: x.text, evidence: ids.map((e) => evidenceText(e, { cues, W, T: SRC.tmdb.cast })) }]));
      job('own', { id, scene: f.id, k }, placementBody(x.text, c.lines.length ? c.lines : ['(no subtitle lines)']));
      job('neighbour', { id, scene: f.id, k }, neighbourBody({ film, event: x.text, before: c.before, after: c.after }));
    });
  }
  const jw = S.wallet('jev', CHECK_CAPS.fill_jev);
  S.progress?.({ stage: 'claims', total: jobs.length, kinds: kindsOf(jobs) });
  const { results } = jobs.length ? await jw.run(() => runJobs(jobs, { key: key('TYPESAFE_API_KEY'), budget: jw.budget, concurrency: MAX_CONCURRENCY })) : { results: [] };
  if (results.some((r) => !r.ok)) throw jevFailed('checking the wordless-scene sentences');
  const compact = (a) => a && { choice: a.choice ?? null, confidence: r3(Number(a.confidence) || 0), probabilities: Object.fromEntries(Object.entries(a.probabilities ?? {}).map(([k, v]) => [k, r3(Number(v))])) };
  for (const r of results) {
    const x = scenes.find((f) => f.id === r.meta.scene).sentences[r.meta.k];
    if (r.meta.kind === 'fill_support') x.check = verdictOf(r.json.answers.r0, RULE);
    if (r.meta.kind === 'fill_own') x.own = compact(r.json.answers.placement);
    if (r.meta.kind === 'fill_neighbour') x.neighbour = compact(r.json.answers.shown);
  }
  for (const f of scenes) for (const x of f.sentences) x.placement = fillPlacement({ own: x.own, neighbour: x.neighbour }, cfg, RULE);
  const fillDoc = {
    film: seg.film, version: FILL_VERSION, run_at: new Date(started).toISOString(), policy: cfg.fill, rule: RULE,
    anchors: anchors.length, wordless: wordless.length, sonnet, model_output: modelOut,
    jev: { model: JEV_CLAIMS_MODEL, requests: results.length, cost_usd: +jw.budget.spent.toFixed(6), input_tokens: results.reduce((a, r) => a + (r.record?.input_tokens ?? 0), 0) },
    scenes,
  };
  const folded = foldFill(seg, fillDoc);
  folded.fill = { version: FILL_VERSION, run_at: fillDoc.run_at, wordless_scenes: wordless.map((x) => x.id), sentences: scenes.reduce((a, f) => a + f.sentences.length, 0), placed: scenes.reduce((a, f) => a + f.sentences.filter((x) => x.placement.placed).length, 0) };
  const n = folded.fill.sentences;
  S.detail(n ? `${n} sentence${n === 1 ? '' : 's'} for scenes with almost no dialogue, from the plot; Jev placed ${folded.fill.placed}` : 'No scene needed a plot sentence');
  return { segments: folded, fill: fillDoc };
}

/** refold.js's CLI body: the unified acceptance rule and the summaries Jev's questions will read. */
export async function refoldStage(S) {
  const rule = ruleOf(POLICY);
  const seg = structuredClone(S.out('fill').segments);
  const raw = S.out('segment_build').raw;
  const SRC = S.out('sources');
  const alignment = splitAlignmentBySentence(seg, raw, S.cues, { wCount: SRC.wikipedia.sentences.length, tCount: SRC.tmdb.cast.length });
  const counts = applyUnified(seg, alignment, rule);
  const fillSent = seg.scenes.flatMap((s) => s.sentences.filter((x) => x.fill));
  seg.acceptance = { at: new Date().toISOString(), rule, counts, fill: { sentences: fillSent.length, verified: fillSent.filter((x) => x.check.status === 'verified').length }, scenes_with_summary: seg.scenes.filter((s) => s.summary).length };
  S.detail(`${counts.verified} of ${counts.sentences} sentences supported by the cited lines; ${seg.acceptance.scenes_with_summary} of ${seg.scenes.length} scenes have a checked summary`);
  return { segments: seg };
}
