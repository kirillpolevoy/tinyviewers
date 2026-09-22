// COPY of the recording half of experiments/trigger-scan/record-jev-run.js as of commit 5fe8fb5.
//
// This is the SAME analysis as run-jev-v3.js (same beats, same questions, same model, same
// concurrency of 8, same request splitting under the token limit): both call analyzeFilm() in
// jev-core.js. The only thing added here is measurement. Every request is timed on the monotonic
// clock (performance.now()) and written out as an offset from run start, so a front end can replay
// the run at exactly the speed it really happened.
//
// The differences from the script: it returns the recording instead of writing
// recordings/<slug>.jev.json, it takes the film's windows rather than a slug to read off disk, it
// banks each request's cost as that request lands, and it has a cost cap the script had no need of
// (COST_CAP_USD below). The object it returns is byte-for-byte the same artefact, field for field,
// because the replay contract in RECORDINGS.md and verify-recording.js apply to a live run exactly
// as they do to a recorded one.
import { performance } from 'node:perf_hooks';
import { COUNTS } from './taxonomy-v3.js';
import { postJson } from './net.js';
import { budget } from './budget.js';
import { fail } from './errors.js';
import {
  analyzeFilm, API_URL, authHeaders, MODEL, PRICE_PER_MTOK, TOKEN_LIMIT, TOKEN_CEILING, CONCURRENCY,
  FLAG_CHANNELS, FLAG_THRESHOLD, FLAG_RULE, estTokens,
} from './jev-core.js';

/**
 * The most the screening pass may cost. The script had no cap at all — a run is a fixed number of
 * questions over a fixed transcript, so there was nothing to run away — but "nothing to run away"
 * is an argument, not a ceiling, and lib/jobs.js quotes a reserve to the person as the most one run
 * can cost. That reserve has to be the sum of numbers this code will actually refuse to pass.
 *
 * The six recorded films cost $0.057 (Iron Giant) to $0.109 (Monsters, Inc.) at $0.042/Mtok, and
 * every request is reserved at its own pre-send token estimate, which runs about 25% above what Jev
 * then bills. $0.20 leaves the longest film measured roughly 60% of head-room and still refuses a
 * run that has somehow doubled.
 */
export const COST_CAP_USD = 0.2;

const r3 = (x) => Math.round(x * 1000) / 1000;
const r6 = (x) => Math.round(x * 1e6) / 1e6;
const round3 = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, r3(v)]));

// Presence + event probabilities, highest first: the flag rule reads the top of this list.
const flagItems = (presence, event) => [
  ...Object.entries(presence).map(([id, p]) => ({ channel: 'presence', id, p })),
  ...Object.entries(event).map(([id, p]) => ({ channel: 'event', id, p })),
].sort((a, b) => b.p - a.p);

/**
 * Run the Jev v3 analysis over one film's windows and record it precisely enough to replay.
 *
 * @param {object} opts
 * @param {string} opts.slug              the film slug, written into meta.film
 * @param {Array} opts.windows            windows from srt.js buildWindows
 * @param {string} [opts.apiKey]          TYPESAFE_API_KEY; defaults to the environment
 * @param {typeof fetch} [opts.fetchImpl]
 * @param {(usd: number) => void} [opts.onSpend] called per REQUEST with what that request cost, as
 *   it lands. This stage makes sixty to a hundred of them in five seconds; banking the run's total
 *   when the stage ended meant a failure at request 58 wrote off everything the first 57 had paid.
 * @returns {Promise<{ recording: object, cueBeats: Map<string, Array>, jevRun: object }>}
 *   `recording` is the content of recordings/<slug>.jev.json. `cueBeats` maps a beat id to the cues
 *   it covers, which is what the excerpt builder needs and what the recording deliberately omits.
 *   `jevRun` is the same run in the shape the loader's second-opinion path consumes.
 */
export async function recordJevRun({
  slug, windows, apiKey, fetchImpl, onSpend, concurrency = CONCURRENCY, costCapUsd = COST_CAP_USD,
} = {}) {
  const startedAt = new Date().toISOString();
  const requests = [];
  const ledger = budget(costCapUsd);
  const priceOf = (tokens) => (tokens / 1e6) * PRICE_PER_MTOK;
  let t0 = null;
  let modelReported = null;

  // Timing wrapper. Run start is the moment the first request is dispatched, so requests[0].sent_ms
  // is 0 and wall_ms is the last received_ms: "first request sent to last response received".
  // Ids are handed out at dispatch, so request order is send order and sent_ms is monotonic.
  // sent_ms is the first attempt; received_ms is the successful response, retries included.
  async function post(body, ctx) {
    // Reserved before the request is dispatched, at its own token estimate, and settled against
    // what Jev actually billed when it lands. The estimate is the conservative one the splitter
    // already computed (3.2 chars/token, measured 25% above the real bill on the six recordings).
    const estimate = ctx.estTokens ?? estTokens(body);
    const reserved = priceOf(estimate);
    if (!ledger.reserve(reserved)) {
      throw fail('jev_cap', `The screening pass for this film would cost more than the $${costCapUsd} cap for this step, so it was stopped at $${ledger.spent.toFixed(4)}.`);
    }
    const id = `R${String(requests.length).padStart(4, '0')}`;
    const dispatched = performance.now();
    if (t0 === null) t0 = dispatched;
    const rec = {
      id,
      kind: ctx.kind,
      window_id: ctx.windowId ?? null,
      part: ctx.part ?? 0,
      parts: ctx.parts ?? 1,
      sent_ms: r3(dispatched - t0),
      received_ms: null,
      status: null,
      retries: 0,
      input_tokens: 0,
      output_tokens: 0,
      est_tokens: ctx.estTokens ?? null,
      questions: ctx.questionCount,
      beats: [],
    };
    requests.push(rec);
    let res;
    try {
      res = await postJson(API_URL, authHeaders(apiKey), body, { fetchImpl, signal: ctx.signal, service: 'jev' });
    } catch (err) {
      // A request that went out and never came back may well have been served and billed; only one
      // that was refused outright, or cancelled before it was sent, certainly was not.
      const unbilled = err?.code === 'no_response' ? reserved : 0;
      ledger.settle(reserved, unbilled);
      if (unbilled) onSpend?.(unbilled);
      throw err;
    }
    rec.received_ms = r3(performance.now() - t0);
    rec.status = res.status;
    rec.retries = res.retries;
    rec.input_tokens = res.json.usage.input_tokens ?? 0;
    rec.output_tokens = res.json.usage.output_tokens ?? 0;
    modelReported ??= res.json.model ?? null;
    ledger.settle(reserved, priceOf(rec.input_tokens));
    onSpend?.(priceOf(rec.input_tokens));
    return { ...res, requestId: id };
  }

  const a = await analyzeFilm({ windows, concurrency, post, apiKey, fetchImpl });
  const wallMs = r3(Math.max(...requests.map((r) => r.received_ms)));
  const byId = new Map(requests.map((r) => [r.id, r]));

  // ---- beats, in film order -----------------------------------------------------------------------
  // A split window can cut between two of one beat's questions, so a beat can be carried by more than
  // one request. The beat becomes known to a replay when the LAST of them lands; that is `request_id`,
  // and `request_ids` lists every request that carried part of it.
  const cueBeats = new Map();
  const beats = a.perWindow.flatMap((r) => r.beats.map((b, i) => {
    cueBeats.set(b.beatId, r.cueBeats[i]);
    const ids = [...new Set(b.requestIds)];
    const resolver = ids.reduce((best, id) => (best === null || byId.get(id).received_ms > byId.get(best).received_ms ? id : best), null);
    const presence = round3(b.presence);
    const event = round3(b.events);
    const top = flagItems(presence, event);
    return {
      id: b.beatId,
      window_id: b.windowId,
      start_ms: b.startMs,
      end_ms: b.endMs,
      start_cue: b.cueIds[0],
      end_cue: b.cueIds[1],
      n_cues: b.nCues,
      request_id: resolver,
      request_ids: ids,
      flagged: top.length > 0 && top[0].p >= FLAG_THRESHOLD,
      answers: {
        presence,
        mention: round3(b.mention),
        event,
        modifier: round3(b.modifiers),
        score: Object.fromEntries(Object.entries(b.scores).map(([id, s]) => [id, {
          score: r3(s.score),
          confidence: r3(s.confidence),
          probabilities: round3(s.probabilities),
        }])),
      },
      loud_caption: r3(b.loudCaption),
    };
  }));
  for (const b of beats) for (const id of b.request_ids) byId.get(id).beats.push(b.id);

  // ---- timeline: the replay-ready list a front end iterates ---------------------------------------
  const resolvedBy = new Map();
  for (const b of beats) {
    if (!resolvedBy.has(b.request_id)) resolvedBy.set(b.request_id, []);
    resolvedBy.get(b.request_id).push(b.id);
  }
  const inFlightAt = (t) => requests.filter((r) => r.sent_ms <= t && r.received_ms > t).length;
  let answers = 0;
  let tokens = 0;
  let resolved = 0;
  const timeline = [...requests]
    .sort((x, y) => x.received_ms - y.received_ms)
    .map((r) => {
      const resolves = resolvedBy.get(r.id) ?? [];
      answers += r.kind === 'beats' ? r.questions : 0;
      tokens += r.input_tokens;
      resolved += resolves.length;
      return {
        t_ms: r.received_ms,
        request_id: r.id,
        kind: r.kind,
        resolves_beats: resolves,
        beats_resolved_total: resolved,
        answers_returned: answers,
        input_tokens: tokens,
        cost_usd: r6((tokens / 1e6) * PRICE_PER_MTOK),
        in_flight_after: inFlightAt(r.received_ms),
      };
    });

  // ---- flagged beats -------------------------------------------------------------------------------
  const flagged = beats.filter((b) => b.flagged).map((b) => ({
    beat_id: b.id,
    t_ms: byId.get(b.request_id).received_ms,
    top: flagItems(b.answers.presence, b.answers.event).slice(0, 3),
  }));

  const inputTokens = requests.reduce((s, r) => s + r.input_tokens, 0);
  const recording = {
    meta: {
      film: slug,
      model: MODEL,
      model_reported: modelReported,
      taxonomy: 'v3',
      started_at: startedAt,
      concurrency,
      cues: a.windows.reduce((s, w) => s + w.cues.length, 0),
      windows: a.windows.length,
      beats: beats.length,
      questions_per_beat: COUNTS.questionsPerBeat,
      total_answers: beats.length * COUNTS.questionsPerBeat,
      requests: requests.length,
      caption_questions: a.captionCount,
      wall_ms: wallMs,
      input_tokens: inputTokens,
      output_tokens: requests.reduce((s, r) => s + r.output_tokens, 0),
      cost_usd: (inputTokens / 1e6) * PRICE_PER_MTOK,
      price_per_mtok: PRICE_PER_MTOK,
      token_limit: TOKEN_LIMIT,
      token_ceiling_per_request: TOKEN_CEILING,
      windows_split: a.splitWindows,
      largest_estimated_request_tokens: a.maxEst,
      retries: requests.reduce((s, r) => s + r.retries, 0),
      // There is no git checkout inside a deployed function, so the commit comes from the platform
      // when it sets one and is null otherwise. `git_scripts_clean` cannot be known here at all: the
      // code is a build artefact, not a working tree, so it is null rather than a reassuring false.
      git_commit: process.env.VERCEL_GIT_COMMIT_SHA ?? null,
      git_scripts_clean: null,
    },
    thresholds: {
      flag_rule: FLAG_RULE,
      flag_threshold: FLAG_THRESHOLD,
      flag_channels: FLAG_CHANNELS,
      flagged_beats: flagged.length,
      flagged,
    },
    requests,
    beats,
    timeline,
  };

  // The loader's second-opinion path reads a run-jev-v3.js `v3b` file: the same beats, under their
  // camelCase names and with nothing rounded. Handing it over from here means a live film gets the
  // same `possibly_present` leads a loaded one does, from the one analysis we paid for.
  const jevRun = {
    arm: 'jev-v3-layers',
    taxonomy: 'v3',
    film: slug,
    model: MODEL,
    startedAt,
    wallMs,
    inputTokens,
    outputTokens: recording.meta.output_tokens,
    costUsd: recording.meta.cost_usd,
    beats: a.perWindow.flatMap((r) => r.beats.map((b) => ({
      beatId: b.beatId,
      windowId: b.windowId,
      startMs: b.startMs,
      endMs: b.endMs,
      cueIds: b.cueIds,
      nCues: b.nCues,
      presence: b.presence,
      mention: b.mention,
      events: b.events,
      modifiers: b.modifiers,
      scores: b.scores,
      loudCaption: b.loudCaption,
    }))),
  };

  return { recording, cueBeats, jevRun };
}
