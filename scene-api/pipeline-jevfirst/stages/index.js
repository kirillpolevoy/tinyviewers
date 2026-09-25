// The Jev-first pipeline (v10.4) as a list of checkpointable stages, in the order v10.4's run-film.js
// runs them, and the parent-readable steps they are reported under on GET /api/add/jobs/{id}.
//
// run-film.js (v10.4)     here
//   sources               subtitles (the track: from subtitle_tracks, else OpenSubtitles), sources
//   segment               segment_a1, gate_a1, [segment_a2_1, segment_a2_2, gate_a2], segment_build
//   claims, fill, refold  claims, fill, refold
//   classify, sonnetq,    classify, sonnetq, childcry, resolve, mortal
//   childcry, resolve,
//   mortal
//   select1, moments,     select1, moments, select2
//   select2
//   describe, checkdesc,  describe, check_describe, describe2, check_describe2, titles, check_describe3,
//   describe2, checkdesc2 mergetext, select3
//   titles, checkdesc3,
//   mergetext, select3
//   (new)                 ingest (a new film, or a rebuild that replaces an existing film's guide)
//
// Steps never go backwards on the page: a stage is reported under the step that is already running
// when it starts (resolve / mortal follow sonnetq and childcry; the second describe attempt and the
// title pass are part of checking the descriptions), so a finished step is never shown running again.
// `est` is how many seconds of an invocation a stage may need; the runner starts a stage only when
// that much of the invocation's budget is left, and otherwise hands the job to a fresh invocation.
// `fresh: true` marks a stage that must start at the top of an invocation (a single Sonnet call over
// the whole film can take most of one).
import { sourcesStage } from './sources.js';
import { segmentA1, gateA1, segmentA2Part, gateA2, segmentBuild, needsAttempt2, needsHalf2, GATE_CFG } from './segment.js';
import { claimsStage, fillStage, refoldStage } from './checks.js';
import { classifyStage, sonnetqStage, childcryStage, resolveStage, mortalStage, select1Stage, momentsStage, select2Stage, select3Stage } from './answers.js';
import { describeStage, checkDescribeStage, describe2Stage, titlesStage, mergeTextStage } from './text.js';
import { ingestStage } from './ingest.js';
import { checkSegmentation, foldIntoSegments, modelScenesOf, planSplitCheck, withIds, creditsFor } from '../pack/check-split.js';
import { codeMetrics } from '../pack/gate.js';
import { getSubtitles } from '../store.js';
import { fail, checkInterrupted, Interrupted, kindsOf } from './common.js';
import { runCtx } from '../context.js';

export { JEVFIRST_STEPS } from '../steps.js';

async function subtitlesStage(S) {
  const subs = await getSubtitles(S.db, { imdbId: S.job.film.imdb_id, apiKey: runCtx().keys?.opensubtitles ?? process.env.OPENSUBTITLES_API_KEY, fetchImpl: runCtx().fetchImpl });
  S.detail(`${subs.cues.length} subtitle lines${subs.hearing_impaired ? ', hearing-impaired track (it has sound captions)' : ''}${subs.cached ? ', already on file' : ''}`);
  return { release: subs.release ?? null, hearing_impaired: !!subs.hearing_impaired, cue_count: subs.cues.length, sha256: subs.sha256, cached: !!subs.cached };
}

export const ADD_STAGES = [
  { id: 'subtitles', step: 'subtitles', est: 40, run: subtitlesStage },
  { id: 'sources', step: 'sources', est: 60, run: sourcesStage },
  { id: 'segment_a1', step: 'segment', est: 250, fresh: true, run: segmentA1 },
  { id: 'gate_a1', step: 'split_check', est: 60, run: gateA1 },
  { id: 'segment_a2_1', step: 'segment', est: 250, fresh: true, when: needsAttempt2, run: (S) => segmentA2Part(S, 1) },
  { id: 'segment_a2_2', step: 'segment', est: 250, fresh: true, when: needsHalf2, run: (S) => segmentA2Part(S, 2) },
  { id: 'gate_a2', step: 'split_check', est: 60, when: needsHalf2, run: gateA2 },
  { id: 'segment_build', step: 'split_check', est: 10, run: segmentBuild },
  { id: 'claims', step: 'claims', est: 90, run: claimsStage },
  { id: 'fill', step: 'claims', est: 120, run: fillStage },
  { id: 'refold', step: 'claims', est: 10, run: refoldStage },
  { id: 'classify', step: 'classify', est: 120, run: classifyStage },
  { id: 'sonnetq', step: 'sonnetq', est: 150, run: sonnetqStage },
  { id: 'childcry', step: 'sonnetq', est: 30, run: childcryStage },
  { id: 'resolve', step: 'sonnetq', est: 30, run: resolveStage },
  { id: 'mortal', step: 'sonnetq', est: 60, run: mortalStage },
  { id: 'select1', step: 'moments', est: 10, run: select1Stage },
  { id: 'moments', step: 'moments', est: 60, run: momentsStage },
  { id: 'select2', step: 'moments', est: 10, run: select2Stage },
  { id: 'describe', step: 'describe', est: 200, run: describeStage },
  { id: 'check_describe', step: 'check_describe', est: 90, run: (S) => checkDescribeStage(S, 1) },
  { id: 'describe2', step: 'check_describe', est: 200, run: describe2Stage },
  { id: 'check_describe2', step: 'check_describe', est: 90, run: (S) => checkDescribeStage(S, 2) },
  { id: 'titles', step: 'check_describe', est: 120, run: titlesStage },
  { id: 'check_describe3', step: 'check_describe', est: 60, run: (S) => checkDescribeStage(S, 3) },
  { id: 'mergetext', step: 'check_describe', est: 10, run: mergeTextStage },
  { id: 'select3', step: 'check_describe', est: 10, run: select3Stage },
  { id: 'ingest', step: 'ingest', est: 40, run: ingestStage },
];

/**
 * The demo's split check: Jev's gate, live, on the STORED accepted cut (Sonnet is not asked again),
 * its verdicts folded into the stored pre-check scenes exactly as segment.js folds them. A cut the
 * gate does not pass today is reported, not hidden, and the run carries on with the stored cut --
 * a demo cannot ask Sonnet for another.
 */
async function demoGate(S) {
  const raw = S.stored('segments_raw');
  const segments = structuredClone(S.stored('segments_precheck'));
  const SRC = S.out('sources');
  const w = S.wallet('jev', 0.03);
  const modelScenes = modelScenesOf(raw);
  const { covered } = codeMetrics(modelScenes, S.cues, { wCount: SRC.wikipedia.sentences.length, tCount: SRC.tmdb.cast.length, credits: creditsFor(S.cues, GATE_CFG) });
  const planned = planSplitCheck({ film: SRC.film, scenes: withIds(covered), cues: S.cues, cfg: GATE_CFG });
  S.progress?.({ stage: 'split_check', total: planned.length, kinds: kindsOf(planned) });
  let g;
  try {
    g = await w.run(() => checkSegmentation({ film: SRC.film, modelScenes, cues: S.cues, ctx: { wCount: SRC.wikipedia.sentences.length, tCount: SRC.tmdb.cast.length }, cfg: GATE_CFG, wallet: w.budget }));
  } catch {
    if (runCtx().signal?.aborted) throw new Interrupted();
    throw fail('split_check_failed', 'Jev could not finish checking where the scenes change.');
  }
  checkInterrupted();
  foldIntoSegments(segments, g, { attempt: raw.accepted_attempt ?? 1, checked_at: new Date().toISOString(), live_demo: true });
  S.detail(g.pass ? 'The cut passed' : `The cut did not pass today (${g.failed.join('; ')})`);
  return { segments, raw, gate: { pass: g.pass, failed: g.failed } };
}

/** A demo run: Jev's stages live on a stored film; Sonnet's outputs are the stored ones. */
export const DEMO_STAGES = [
  { id: 'segment_build', step: 'split_check', run: demoGate },
  { id: 'claims', step: 'claims', run: claimsStage },
  { id: 'fill', step: 'claims', run: fillStage },
  { id: 'refold', step: 'claims', run: refoldStage },
  { id: 'classify', step: 'classify', run: classifyStage },
  { id: 'sonnetq', step: 'sonnetq', run: sonnetqStage },
  { id: 'childcry', step: 'classify', run: childcryStage },
  { id: 'resolve', step: 'classify', run: resolveStage },
  { id: 'mortal', step: 'classify', run: mortalStage },
  { id: 'select1', step: 'moments', run: select1Stage },
  { id: 'moments', step: 'moments', run: momentsStage },
  { id: 'select2', step: 'moments', run: select2Stage },
  { id: 'describe', step: 'describe', run: describeStage },
  { id: 'check_describe', step: 'claims', run: (S) => checkDescribeStage(S, 1) },
  { id: 'describe2', step: 'describe', run: describe2Stage },
  { id: 'check_describe2', step: 'claims', run: (S) => checkDescribeStage(S, 2) },
  { id: 'titles', step: 'describe', run: titlesStage },
  { id: 'check_describe3', step: 'claims', run: (S) => checkDescribeStage(S, 3) },
  { id: 'mergetext', step: 'claims', run: mergeTextStage },
  { id: 'select3', step: 'moments', run: select3Stage },
];

export { Interrupted };
