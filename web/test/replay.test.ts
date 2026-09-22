import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  buildReplayPayload,
  filmLengthMs,
  finishedState,
  formatCents,
  formatProbability,
  formatSeconds,
  formatTokens,
  labelOf,
  replayStateAt,
  scoreRows,
  triggersFlag,
  windowOf,
  withLines,
  TOP_ANSWERS,
  type RawExcerpts,
  type RawRecording,
} from '../lib/replay';
import { unknownLabelIds } from '../lib/taxonomy-labels';

// --- a tiny hand-built recording ---------------------------------------------------------------
//
// Two requests and three beats, with the one case the real files are full of and a synthetic
// fixture usually forgets: a response that lands out of send order, so a beat from the second
// request is known before a beat from the first.

const recording: RawRecording = {
  meta: {
    film: 'fixture',
    model: 'jev-1.13.0',
    model_reported: 'jev-1.13.0',
    taxonomy: 'v3',
    started_at: '2026-09-21T23:57:07.684Z',
    concurrency: 8,
    cues: 30,
    windows: 2,
    beats: 3,
    questions_per_beat: 103,
    total_answers: 309,
    requests: 2,
    wall_ms: 900,
    input_tokens: 3000,
    output_tokens: 1000,
    cost_usd: 0.000126,
    price_per_mtok: 0.042,
    retries: 0,
  },
  thresholds: { flag_threshold: 0.7 },
  requests: [
    {
      id: 'R0000',
      kind: 'beats',
      window_id: 'W001',
      part: 0,
      parts: 1,
      sent_ms: 0,
      received_ms: 900,
      status: 200,
      retries: 1,
      input_tokens: 2000,
      output_tokens: 600,
      questions: 206,
      beats: ['W001.1', 'W001.2'],
    },
    {
      id: 'R0001',
      kind: 'beats',
      window_id: 'W002',
      part: 0,
      parts: 1,
      sent_ms: 10,
      received_ms: 400,
      status: 200,
      retries: 0,
      input_tokens: 1000,
      output_tokens: 400,
      questions: 103,
      beats: ['W002.1'],
    },
  ],
  beats: [
    {
      id: 'W001.1',
      window_id: 'W001',
      start_ms: 0,
      end_ms: 1000,
      n_cues: 4,
      flagged: false,
      loud_caption: 0,
      request_id: 'R0000',
      answers: {
        presence: { shark: 0.1, darkness: 0, fire: 0.3 },
        mention: { shark: 0.2 },
        event: { chased: 0.05 },
        score: {
          threat: { score: 0.1, confidence: 0.9, probabilities: { 0: 1 } },
          distress: { score: 0.2, confidence: 0.8 },
          sev57: { score: 0.3, confidence: 0.7 },
          sev810: { score: 0.4, confidence: 0.6 },
        },
      },
    },
    {
      id: 'W001.2',
      window_id: 'W001',
      start_ms: 1000,
      end_ms: 2000,
      n_cues: 6,
      flagged: true,
      loud_caption: 0.5,
      request_id: 'R0000',
      answers: {
        // Eight answers above zero, so the cap has something to cut.
        presence: { shark: 0.94, darkness: 0.81, fire: 0.5, heights: 0.4, gun: 0.3 },
        mention: { shark: 0.25, fire: 0.22 },
        event: { chased: 0.88, terrified: 0.6, dies: 0 },
        score: {
          threat: { score: 2.4, confidence: 0.95 },
          distress: { score: 2.1, confidence: 0.9 },
          sev57: { score: 3, confidence: 0.88 },
          sev810: { score: 2, confidence: 0.86 },
        },
      },
    },
    {
      id: 'W002.1',
      window_id: 'W002',
      start_ms: 2000,
      end_ms: 3000,
      n_cues: 5,
      flagged: true,
      loud_caption: 0,
      request_id: 'R0001',
      answers: {
        presence: { deep_dark_water: 0.82 },
        event: {},
        score: { threat: { score: 1, confidence: 0.5 } },
      },
    },
  ],
};

const excerpts: RawExcerpts = {
  'W001.2': [
    { cue: 'C0001', line: 'It’s right behind us!', score: 1.4, why: { words: ['behind us'] } },
    { cue: 'C0002', line: 'Swim, Nemo, swim!', score: 0.9, why: { fallback: 'longest_cue' } },
  ],
  // A beat that is not flagged has no business having lines; the builder must not take them.
  'W001.1': [{ cue: 'C0009', line: 'A calm line.', score: 0.1 }],
};

const payload = buildReplayPayload(recording, excerpts);

test('the timeline is dropped and the requests are kept whole', () => {
  assert.equal('timeline' in payload, false);
  assert.equal(payload.requests.length, 2);
  // The real spans, including the retried one: not smoothed, not reordered.
  assert.deepEqual(
    payload.requests.map((r) => [r.id, r.sentMs, r.receivedMs, r.retries]),
    [
      ['R0000', 0, 900, 1],
      ['R0001', 10, 400, 0],
    ],
  );
});

test('meta carries the run, and counts the flagged beats itself', () => {
  assert.equal(payload.meta.model, 'jev-1.13.0');
  assert.equal(payload.meta.questionsPerBeat, 103);
  assert.equal(payload.meta.concurrency, 8);
  assert.equal(payload.meta.wallMs, 900);
  assert.equal(payload.meta.flaggedBeats, 2);
  assert.equal(payload.meta.flagThreshold, 0.7);
});

test('top is the highest few answers across the three channels, zeroes dropped', () => {
  const beat = payload.beats.find((b) => b.id === 'W001.2')!;
  assert.equal(beat.top.length, TOP_ANSWERS);
  assert.deepEqual(
    beat.top.map((a) => [a.channel, a.id, a.p]),
    [
      ['presence', 'shark', 0.94],
      ['event', 'chased', 0.88],
      ['presence', 'darkness', 0.81],
      ['event', 'terrified', 0.6],
      ['presence', 'fire', 0.5],
      ['presence', 'heights', 0.4],
    ],
  );
  // `dies` was answered 0 and `gun` was pushed out by six better answers; neither is a top answer.
  assert.equal(
    beat.top.some((a) => a.id === 'dies' || a.id === 'gun'),
    false,
  );
});

test('a beat with fewer than six answers above zero shows fewer bars', () => {
  const beat = payload.beats.find((b) => b.id === 'W002.1')!;
  assert.equal(beat.top.length, 1);
  assert.equal(labelOf(beat.top[0]), 'Deep or dark water');
});

test('the mention channel is labelled apart from presence', () => {
  const beat = payload.beats.find((b) => b.id === 'W001.1')!;
  const mention = beat.top.find((a) => a.channel === 'mention')!;
  assert.equal(labelOf(mention), 'Shark (talked about)');
});

test('all four scores are present and in order, missing ones as zero', () => {
  const rows = scoreRows(payload.beats.find((b) => b.id === 'W001.2')!);
  assert.deepEqual(
    rows.map((r) => [r.id, r.score, r.confidence]),
    [
      ['threat', 2.4, 0.95],
      ['distress', 2.1, 0.9],
      ['sev57', 3, 0.88],
      ['sev810', 2, 0.86],
    ],
  );
  assert.equal(rows[0].label, 'Physical danger');

  // W002.1 recorded only `threat`. The array stays four long rather than short.
  const sparse = scoreRows(payload.beats.find((b) => b.id === 'W002.1')!);
  assert.equal(sparse.length, 4);
  assert.deepEqual(sparse.map((r) => r.score), [1, 0, 0, 0]);
});

test('excerpt lines join onto flagged beats only, with the words behind them', () => {
  const flagged = payload.beats.find((b) => b.id === 'W001.2')!;
  assert.deepEqual(flagged.lines, [
    { line: 'It’s right behind us!', words: ['behind us'] },
    { line: 'Swim, Nemo, swim!', words: [] },
  ]);
  // The excerpt file offered a line for an unflagged beat. The policy says flagged only.
  assert.deepEqual(payload.beats.find((b) => b.id === 'W001.1')!.lines, []);
});

test('no excerpts at all is a normal case, not a failure', () => {
  const without = buildReplayPayload(recording, null);
  assert.equal(without.beats.every((b) => b.lines.length === 0), true);
  assert.equal(without.beats.length, payload.beats.length);
});

test('lines arriving late join the payload that is already playing', () => {
  // The live job page fetches its recording the moment Jev is done, minutes before the excerpts
  // exist. When the film lands in the database its row has both, and the lines are copied across.
  const without = buildReplayPayload(recording, null);
  const filled = withLines(without, payload);

  assert.deepEqual(filled.beats.find((b) => b.id === 'W001.2')!.lines, [
    { line: 'It’s right behind us!', words: ['behind us'] },
    { line: 'Swim, Nemo, swim!', words: [] },
  ]);
  // Everything that is not a line is the same recording: nothing else is taken from the later read.
  assert.deepEqual(filled.meta, without.meta);
  assert.deepEqual(filled.requests, without.requests);
  assert.deepEqual(
    filled.beats.map((b) => b.id),
    without.beats.map((b) => b.id),
  );
});

test('a merge with nothing to add hands back the very same object', () => {
  // `RunReplay` holds the payload in state and animates it. A new object with identical contents
  // would be a re-render mid-run for no reason, so "nothing arrived" is the same reference.
  const empty = buildReplayPayload(recording, null);
  assert.equal(withLines(payload, empty), payload);
  // And lines already in hand are not replaced by a second copy of themselves.
  assert.equal(withLines(payload, payload), payload);
});

test('only an answer the flag rule reads gets the trigger colour', () => {
  // A character saying "shark" is not a shark on screen, and the flag rule never looks at the
  // mention channel — so an 85% mention claiming the colour claims a rule that did not fire.
  assert.equal(triggersFlag({ channel: 'presence', id: 'shark', p: 0.85 }, 0.7), true);
  assert.equal(triggersFlag({ channel: 'event', id: 'chase', p: 0.7 }, 0.7), true);
  assert.equal(triggersFlag({ channel: 'mention', id: 'shark', p: 0.85 }, 0.7), false);
  assert.equal(triggersFlag({ channel: 'mention', id: 'shark', p: 1 }, 0.7), false);
  assert.equal(triggersFlag({ channel: 'presence', id: 'shark', p: 0.69 }, 0.7), false);
});

test('a window is the prefix of a beat id', () => {
  assert.equal(windowOf('W012.3'), 'W012');
  assert.equal(windowOf('W001'), 'W001');
});

// --- the clock ---------------------------------------------------------------------------------

test('a beat is known when its request lands, which is not film order', () => {
  // At 500 ms only R0001 is back, so the third beat is known and the first two are not.
  const mid = replayStateAt(payload, 500);
  assert.equal(mid.landed.has('R0001'), true);
  assert.equal(mid.landed.has('R0000'), false);
  assert.equal(mid.beatsKnown, 1);
  assert.equal(mid.beatsFlagged, 1);
  const known = payload.beats.filter((b) => mid.landed.has(b.requestId)).map((b) => b.id);
  assert.deepEqual(known, ['W002.1']);
});

test('counters sum only what has landed, and in flight is what is still open', () => {
  assert.deepEqual(
    [0, 10, 500, 900].map((t) => {
      const s = replayStateAt(payload, t);
      return [s.requestsDone, s.inFlight, s.inputTokens, s.outputTokens];
    }),
    [
      // t=0: R0000 is away, and R0001 is not dispatched until 10 ms.
      [0, 1, 0, 0],
      [0, 2, 0, 0],
      [1, 1, 1000, 400],
      [2, 0, 3000, 1000],
    ],
  );
});

test('the running cost is priced the way the recording prices itself', () => {
  const end = finishedState(payload);
  assert.equal(end.finished, true);
  assert.equal(end.inputTokens, payload.meta.inputTokens);
  // meta.cost_usd = input_tokens x price_per_mtok / 1e6, so the counter arrives exactly at it.
  assert.ok(Math.abs(end.costUsd - payload.meta.costUsd) < 1e-12);
});

test('the clock is clamped to the run at both ends', () => {
  assert.equal(replayStateAt(payload, -500).tMs, 0);
  assert.equal(replayStateAt(payload, 10_000).tMs, 900);
  assert.equal(replayStateAt(payload, 10_000).finished, true);
});

test('the film is as long as its last beat', () => {
  assert.equal(filmLengthMs(payload), 3000);
});

// --- numbers as words ---------------------------------------------------------------------------

test('seconds, cents, tokens and percentages read the way the page prints them', () => {
  assert.equal(formatSeconds(5186.106), '5.2 s');
  assert.equal(formatSeconds(900), '0.90 s');
  assert.equal(formatCents(0.084714504), '8¢');
  assert.equal(formatCents(0.004), '0.4¢');
  assert.equal(formatCents(0.0004), '0.04¢');
  assert.equal(formatTokens(2_017_012), '2.0M');
  assert.equal(formatTokens(577_247), '577k');
  assert.equal(formatTokens(412), '412');
  assert.equal(formatProbability(0.82), '82%');
});

// --- the real recording -------------------------------------------------------------------------
//
// Skipped where the file is not there, because experiments/trigger-scan is a sibling project and a
// checkout of this app alone is a legitimate thing to have.

const nemoPath = path.resolve(
  import.meta.dirname,
  '..',
  '..',
  'experiments',
  'trigger-scan',
  'recordings',
  'nemo.jev.json',
);

test('Nemo reduces to a payload a browser can hold', { skip: !fs.existsSync(nemoPath) }, () => {
  const raw = JSON.parse(fs.readFileSync(nemoPath, 'utf8')) as RawRecording;
  const excerptPath = nemoPath.replace('.jev.json', '.excerpts.json');
  const lines = fs.existsSync(excerptPath)
    ? (JSON.parse(fs.readFileSync(excerptPath, 'utf8')) as RawExcerpts)
    : null;
  const nemo = buildReplayPayload(raw, lines);
  const bytes = JSON.stringify(nemo).length;

  // A megabyte of recording, and what a phone has to download to watch it.
  assert.ok(bytes < 200 * 1024, `payload is ${(bytes / 1024).toFixed(1)}KB, over the 200KB ceiling`);
  assert.equal(nemo.beats.length, raw.meta.beats);
  assert.equal(nemo.requests.length, raw.meta.requests);

  // Every beat resolves through a request that is in the payload, or the board would never light.
  const ids = new Set(nemo.requests.map((r) => r.id));
  assert.equal(nemo.beats.every((b) => ids.has(b.requestId)), true);

  // The finished counters are the published totals, to the last token and the last microdollar.
  const end = finishedState(nemo);
  assert.equal(end.requestsDone, raw.meta.requests);
  assert.equal(end.beatsKnown, raw.meta.beats);
  assert.equal(end.inputTokens, raw.meta.input_tokens);
  assert.equal(end.outputTokens, raw.meta.output_tokens);
  assert.ok(Math.abs(end.costUsd - raw.meta.cost_usd) < 1e-9);

  // Every id in the run has words. A recording made against a newer taxonomy fails here rather
  // than printing `robot_machine_being` at a visitor.
  assert.deepEqual(unknownLabelIds(nemo.beats.flatMap((b) => b.top)), []);
});
