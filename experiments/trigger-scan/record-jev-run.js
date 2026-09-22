// record-jev-run.js — run the Jev v3 analysis and record it precisely enough to replay.
//
//   node record-jev-run.js --film nemo
//   node record-jev-run.js --all
//
// This is the SAME analysis as run-jev-v3.js (same beats, same questions, same model, same
// concurrency of 8, same request splitting under the token limit): both call analyzeFilm() in
// jev-v3-core.js. The only thing added here is measurement. Every request is timed on the monotonic
// clock (performance.now()) and written out as an offset from run start, so a front end can replay
// the run at exactly the speed it really happened.
//
// Two files come out:
//   recordings/<slug>.jev.json       tracked in git; contains NO subtitle text, only ids and numbers
//   recordings/<slug>.excerpts.json  NOT tracked; two short lines for flagged beats only
//
// See RECORDINGS.md for the format and the replay contract.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { COUNTS } from './taxonomy-v3.js';
import { parseArgs, here, postJson, loadFilm } from './common.js';
import {
  analyzeFilm, API_URL, authHeaders, MODEL, PRICE_PER_MTOK, TOKEN_LIMIT, TOKEN_CEILING, CONCURRENCY,
  FLAG_CHANNELS, FLAG_THRESHOLD, FLAG_RULE, EXCERPT_MAX_LINES,
} from './jev-v3-core.js';
import { chooseExcerpts } from './excerpts.js';

const r3 = (x) => Math.round(x * 1000) / 1000;
const r6 = (x) => Math.round(x * 1e6) / 1e6;
const round3 = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, r3(v)]));
const wordsOf = (s) => s.replace(/\s+/g, ' ').trim().split(' ').filter(Boolean).length;

const args = parseArgs();
const films = args.all
  ? Object.keys(JSON.parse(fs.readFileSync(path.join(here, 'films.json'), 'utf8')))
  : [args.film ?? 'nemo'];

const git = (a) => {
  try {
    return execFileSync('git', a, { cwd: here, encoding: 'utf8' }).trim();
  } catch {
    return null;
  }
};

// Presence + event probabilities, highest first: the flag rule reads the top of this list.
const flagItems = (presence, event) => [
  ...Object.entries(presence).map(([id, p]) => ({ channel: 'presence', id, p })),
  ...Object.entries(event).map(([id, p]) => ({ channel: 'event', id, p })),
].sort((a, b) => b.p - a.p);


async function recordFilm(slug) {
  const startedAt = new Date().toISOString();
  const requests = [];
  let t0 = null;
  let modelReported = null;

  // Timing wrapper. Run start is the moment the first request is dispatched, so requests[0].sent_ms
  // is 0 and wall_ms is the last received_ms: "first request sent to last response received".
  // Ids are handed out at dispatch, so request order is send order and sent_ms is monotonic.
  // sent_ms is the first attempt; received_ms is the successful response, retries included.
  async function post(body, ctx) {
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
    const res = await postJson(API_URL, authHeaders(), body);
    rec.received_ms = r3(performance.now() - t0);
    rec.status = res.status;
    rec.retries = res.retries;
    rec.input_tokens = res.json.usage.input_tokens ?? 0;
    rec.output_tokens = res.json.usage.output_tokens ?? 0;
    modelReported ??= res.json.model ?? null;
    return { ...res, requestId: id };
  }

  const a = await analyzeFilm({ slug, limit: args.limit, concurrency: CONCURRENCY, post });
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
      concurrency: CONCURRENCY,
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
      git_commit: git(['rev-parse', 'HEAD']),
      // false = the analysis scripts had uncommitted edits when this was recorded
      git_scripts_clean: git(['status', '--porcelain', '--', 'record-jev-run.js', 'jev-v3-core.js', 'taxonomy-v3.js', 'common.js', 'srt.js']) === '',
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

  const dir = path.join(here, 'recordings');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${slug}.jev.json`);
  fs.writeFileSync(file, JSON.stringify(recording, null, 1));

  // ---- excerpts: flagged beats only, two lines of at most 12 words, never tracked -----------------
  // The choice of WHICH lines lives in excerpts.js, which can also rebuild this file from the
  // recording alone (node excerpts.js <slug>) — no re-analysis needed to change the excerpt rule.
  const topOf = new Map(flagged.map((f) => [f.beat_id, f.top]));
  const excerpts = {};
  for (const b of beats) {
    if (!b.flagged) continue;
    const cues = cueBeats.get(b.id) ?? [];
    excerpts[b.id] = chooseExcerpts(cues, topOf.get(b.id) ?? [], { maxLines: Math.min(EXCERPT_MAX_LINES, cues.length) });
  }
  const excerptFile = path.join(dir, `${slug}.excerpts.json`);
  fs.writeFileSync(excerptFile, JSON.stringify(excerpts, null, 1));

  const exposed = Object.values(excerpts).flat().reduce((s, e) => s + wordsOf(e.line), 0);
  const filmWords = loadFilm(slug).cues.reduce((s, c) => s + wordsOf(c.text), 0);
  const size = fs.statSync(file).size;
  console.log(`${slug}: ${beats.length} beats, ${requests.length} requests, ${(wallMs / 1000).toFixed(1)}s wall, ${inputTokens} in-tok, $${recording.meta.cost_usd.toFixed(4)}, ${flagged.length} flagged, ${recording.meta.retries} retries, ${(size / 1024).toFixed(0)} KB`);
  console.log(`  ${path.relative(here, file)} + ${path.relative(here, excerptFile)}: ${exposed} excerpt words = ${((exposed / filmWords) * 100).toFixed(2)}% of ${filmWords} subtitle words`);
  return { slug, meta: recording.meta, size, exposed, filmWords, excerptBeats: Object.keys(excerpts).length, flagged: flagged.length };
}

const out = [];
for (const slug of films) out.push(await recordFilm(slug));
if (out.length > 1) {
  console.log(`\ntotal: $${out.reduce((s, r) => s + r.meta.cost_usd, 0).toFixed(4)} across ${out.length} films, ${out.reduce((s, r) => s + r.meta.beats, 0)} beats`);
}
