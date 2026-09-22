// The live analysis, start to finish, for one film nobody has analysed before.
//
//   subtitles -> jev -> scenes -> presence -> excerpts -> ingest
//
// Every stage is timed and written to the job row as it starts and as it ends, because the whole
// point of the page on the other side is that you can watch it happen. Three writes matter more
// than the rest:
//
//   * the recording goes into the job the instant the jev stage ends. Sonnet then takes two or
//     three minutes, and there is no reason to make someone stare at a spinner when the thing worth
//     watching — a real run of 78 requests over 5 seconds — is already finished and replayable. It
//     is served by GET /api/add/jobs/{id}/recording, not by the endpoint the page polls.
//   * money is banked as it is incurred, not when a stage ends. See `onSpend` below.
//   * the subtitle blob is deleted the moment the job reaches done OR failed, and the excerpts are
//     nulled out at the same point. The blob is the only place a whole track ever sits (see the
//     comment on job_blobs in schema.sql), and "the run crashed" is not a reason to keep one.
//
// Nothing in here throws at the caller. A stage that fails marks its step failed, writes an
// error_code the web can branch on, and returns; the job row is the only channel.

import {
  patchJob, getJob, putBlob, getBlob, dropBlob, sweepBlobs, freshSteps, RESERVE_USD,
} from '../lib/jobs.js';
import { PipelineError, errorSummary } from './errors.js';
import { buildWindows } from './srt.js';
import { fetchSubtitles } from './subtitles.js';
import { recordJevRun } from './record.js';
import { findScenes } from './scenes.js';
import { labelPresence } from './presence.js';
import { buildExcerpts, excerptExposure, verifyExcerpts } from './excerpts.js';
import { ingestFilm } from './ingest.js';

/** What a stage is allowed to be asked for before the platform kills the function at 300 s. */
export const STEP_IDS = ['subtitles', 'jev', 'scenes', 'presence', 'excerpts', 'ingest'];

const round6 = (n) => Math.round(n * 1e6) / 1e6;

/**
 * Run the whole pipeline for one job, writing progress into `jobs` as it goes.
 *
 * @param {object} db
 * @param {object} opts
 * @param {string} opts.jobId
 * @param {object} opts.film { slug, title, year, imdb_id, poster_url, overview }
 * @param {{ typesafe?: string, claude?: string, opensubtitles?: string }} [opts.keys] defaults to
 *   the environment. Passed explicitly by the tests, which hand over stubs instead.
 * @param {typeof fetch} [opts.fetchImpl]
 * @returns {Promise<{ status: 'done'|'failed', error_code?: string, cost_usd: number }>}
 */
export async function runPipeline(db, { jobId, film, keys = {}, fetchImpl = globalThis.fetch } = {}) {
  const apiKeys = {
    typesafe: keys.typesafe ?? process.env.TYPESAFE_API_KEY,
    claude: keys.claude ?? process.env.CLAUDE_API_KEY,
    opensubtitles: keys.opensubtitles ?? process.env.OPENSUBTITLES_API_KEY,
  };

  const t0 = Date.now();
  const steps = freshSteps();
  const at = () => Date.now() - t0;
  let cost = 0;

  // ---- money ------------------------------------------------------------------------------------
  // Two rules, and both exist because a run can stop without warning: the platform kills the
  // function at 300 s, and a 400 from Anthropic throws out of the middle of a stage.
  //
  //  1. While the job is live the row never reads below the reserve `createJob` wrote. An abandoned
  //     row is the dangerous one — nothing will ever reconcile it — and a row that reads as free
  //     lets the daily cap admit run after run after a crash loop.
  //  2. Money is banked as it is incurred, not when a stage ends. `findScenes` and `labelPresence`
  //     call `onSpend` after every priced call; presence makes one call per scene over two minutes,
  //     so "when the stage ends" would have thrown away every call a failing film had already paid
  //     for.
  // The real total replaces the reserve exactly once, at done or failed.
  // `reconciled` flips once, just before the row is written for the last time. After that a write
  // from a call that was still in flight when the stage failed must not put the reserve back.
  let reconciled = false;
  const liveCost = () => round6(reconciled ? cost : Math.max(cost, RESERVE_USD));
  let banking = Promise.resolve();
  // Chained rather than fired off: two presence calls finish at the same moment, both write the
  // running total, and out of order the smaller one would land last. A failed write is not retried,
  // it is simply superseded by the next one — and by the reconciliation at the end.
  const onSpend = (usd) => {
    if (!(usd > 0)) return;
    cost += usd;
    banking = banking.then(() => patchJob(db, jobId, { cost_usd: liveCost() })).catch(() => {});
  };
  const settleBank = () => banking.catch(() => {});

  const byId = new Map(steps.map((s) => [s.id, s]));
  const save = (fields = {}) => patchJob(db, jobId, { steps, cost_usd: liveCost(), ...fields });

  const begin = async (id) => {
    const s = byId.get(id);
    s.status = 'running';
    s.started_ms = at();
    await save({ status: 'running', step: id });
  };
  const end = async (id, detail, spent = 0, extra = {}) => {
    const s = byId.get(id);
    s.status = 'done';
    s.ended_ms = at();
    s.detail = detail;
    cost += spent;
    await save(extra);
  };

  try {
    // ---- subtitles ------------------------------------------------------------------------------
    await begin('subtitles');
    const subs = await fetchSubtitles({ imdbId: film.imdb_id, apiKey: apiKeys.opensubtitles, fetchImpl });
    // Straight into the blob table and out of this function's variables as soon as it is used.
    await putBlob(db, jobId, subs.srtText);
    const cues = subs.cues;
    await end('subtitles', `${cues.length} subtitle lines${subs.hearing_impaired ? ', hearing-impaired track (it has sound captions)' : ''}`);

    // ---- jev ------------------------------------------------------------------------------------
    await begin('jev');
    const windows = buildWindows(cues);
    const { recording, jevRun } = await recordJevRun({
      slug: film.slug, windows, apiKey: apiKeys.typesafe, fetchImpl, onSpend,
    });
    // Written now, not at the end: the replay is what the page is for, and Sonnet has not started.
    // `spent` is 0 here and for the two stages after it: all three bank their own money through
    // `onSpend` as each call returns, so adding a run total again here would count it twice.
    await end(
      'jev',
      `${recording.meta.beats} beats x ${recording.meta.questions_per_beat} questions in ${(recording.meta.wall_ms / 1000).toFixed(1)}s, ${recording.thresholds.flagged_beats} flagged`,
      0,
      { recording },
    );

    // ---- scenes ---------------------------------------------------------------------------------
    await begin('scenes');
    const sceneRun = await findScenes({ film, cues, apiKey: apiKeys.claude, fetchImpl, onSpend });
    if (!sceneRun.scenes.length) {
      throw new PipelineError('no_scenes', 'The scene pass came back with nothing to flag in this film, so there is nothing to add.');
    }
    // The redaction counts are on the step because they are the only trace of the quotation rule
    // having bitten: a dropped description is not visible anywhere else once the film is written.
    const quoted = [
      sceneRun.redacted_descriptions ? `${sceneRun.redacted_descriptions} description${sceneRun.redacted_descriptions === 1 ? '' : 's'} dropped for quoting the subtitles` : null,
      sceneRun.dropped_quoting_title ? `${sceneRun.dropped_quoting_title} scene${sceneRun.dropped_quoting_title === 1 ? '' : 's'} dropped for a title that quoted them` : null,
    ].filter(Boolean);
    await end('scenes', [`${sceneRun.scenes.length} scenes`, ...quoted].join(', '), 0, { scene_count: sceneRun.scenes.length });

    // ---- presence -------------------------------------------------------------------------------
    await begin('presence');
    const presenceRun = await labelPresence({
      film, cues, scenes: sceneRun.scenes, apiKey: apiKeys.claude, fetchImpl, onSpend,
    });
    const asserted = (presenceRun?.scenes ?? []).reduce((n, s) => n + s.present.length, 0);
    await end('presence', presenceRun ? `${asserted} things labelled present across ${presenceRun.scenes_asked} scenes` : 'no scene could be asked about', 0);

    // ---- excerpts -------------------------------------------------------------------------------
    // No model call: this is the lexical rule in excerpts.js over the recording we already have.
    // The output is then checked against the exposure policy it was granted, because this and
    // `recordings.excerpts` are two of the four places in this schema that hold subtitle text.
    await begin('excerpts');
    const excerpts = buildExcerpts(recording, cues);
    const policy = verifyExcerpts(excerpts, recording, cues);
    if (policy.fails.length) {
      throw new PipelineError('excerpts_policy', `The evidence lines came out outside the excerpt policy (${policy.fails.length} problems, the first: ${policy.fails[0]}), so this film was not written in.`);
    }
    const exposure = excerptExposure(excerpts, cues);
    await end('excerpts', `${exposure.lines} lines for ${exposure.beats} flagged beats (${((exposure.words / exposure.filmWords) * 100).toFixed(1)}% of the film's words)`, 0, { excerpts });

    // ---- ingest ---------------------------------------------------------------------------------
    await begin('ingest');
    const srtText = await getBlob(db, jobId);
    if (!srtText) throw new PipelineError('blob_gone', 'The subtitle file for this run was cleaned up before it could be written in. Start the run again.');
    // `slug` is decided in there, not here: the one the job was admitted with may have been taken
    // by another film in the minutes since, and a live run suffixes rather than replacing.
    const { scenes, slug } = await ingestFilm(db, {
      film, srtText, releaseLabel: subs.release, sceneRun, presenceRun, jevRun, recording, excerpts,
    });
    await end('ingest', `${scenes} scenes written`, 0, { scene_count: scenes });

    await dropBlob(db, jobId);
    await settleBank();
    reconciled = true;
    await patchJob(db, jobId, {
      status: 'done', step: null, steps, cost_usd: round6(cost),
      film: { ...film, slug },
      // The excerpts were on the job so the page could show evidence lines mid-run. They are in
      // `recordings.excerpts` now, under the retention rule in schema.sql.
      excerpts: null,
    });
    return { status: 'done', cost_usd: round6(cost) };
  } catch (err) {
    const known = err instanceof PipelineError;
    // Only the allowlisted fields, never the error itself: an upstream failure's message and stack
    // could carry the response body, and a response body from Jev or Anthropic echoes the subtitle
    // lines this run just sent them. See errorSummary in errors.js.
    if (!known) console.error(`[job ${jobId}]`, errorSummary(err));
    const running = steps.find((s) => s.status === 'running');
    if (running) {
      running.status = 'failed';
      running.ended_ms = at();
      running.detail = known ? err.message : 'This step failed.';
    }
    await settleBank();
    reconciled = true;
    await patchJob(db, jobId, {
      status: 'failed',
      step: running?.id ?? null,
      steps,
      // The one place the reserve is replaced by what the run really spent — this and the `done`
      // branch. A run that reaches neither keeps the reserve, which is the point of it.
      cost_usd: round6(cost),
      // A failed run has no film to hang evidence lines off, so they go with it.
      excerpts: null,
      error_code: known ? err.code : 'internal',
      // A non-PipelineError can carry an upstream response in its message, so it is never shown.
      error: known ? err.message : 'Something went wrong on our side part-way through this run.',
    });
    // Failure is not a reason to keep a subtitle track lying about.
    await dropBlob(db, jobId);
    return { status: 'failed', error_code: known ? err.code : 'internal', cost_usd: round6(cost) };
  } finally {
    // Cheap, and the only thing that catches a blob whose function died before either branch ran.
    await sweepBlobs(db).catch(() => {});
  }
}

/** Re-read a job after a run, for a caller that wants the final row rather than the summary. */
export const finalJob = (db, jobId) => getJob(db, jobId);
