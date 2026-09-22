import test from 'node:test';
import assert from 'node:assert/strict';
import { failureSentence, isJobId, isLive, stepDurationMs, type JobStep } from '../lib/job';
import { ADD, finishLine, spentLine } from '../lib/copy';

const step = (over: Partial<JobStep>): JobStep => ({
  id: 'jev',
  label: 'Jev',
  status: 'pending',
  started_ms: null,
  ended_ms: null,
  detail: null,
  ...over,
});

test('polling stops as soon as the job stops moving', () => {
  assert.equal(isLive('queued'), true);
  assert.equal(isLive('running'), true);
  assert.equal(isLive('done'), false);
  assert.equal(isLive('failed'), false);
});

test('a job id is an id, and every route that takes one asks the same question', () => {
  // Three places now put this string into a path the app forwards: the job endpoint, the recording
  // endpoint beside it, and the server render. They share one rule so a new endpoint cannot be the
  // lenient one.
  assert.equal(isJobId('a1b2c3'), true);
  assert.equal(isJobId('job_2026-09-22_nemo'), true);
  assert.equal(isJobId(''), false);
  assert.equal(isJobId('a'.repeat(65)), false);
  assert.equal(isJobId('../../etc/passwd'), false);
  assert.equal(isJobId('abc/recording'), false);
  assert.equal(isJobId('abc?x=1'), false);
  // Anchored to the end of the string, not to the end of a line: a trailing newline is not an id.
  assert.equal(isJobId('replay\n'), false);
});

test('a step that has not started has no duration, which is not zero', () => {
  // Four pending steps printing "0.0 s" would read as four instant successes.
  assert.equal(stepDurationMs(step({})), null);
  assert.equal(stepDurationMs(step({ status: 'running', started_ms: 1000 })), null);
  assert.equal(stepDurationMs(step({ status: 'running', started_ms: 1000 }), 3500), 2500);
  assert.equal(stepDurationMs(step({ status: 'done', started_ms: 1000, ended_ms: 6200 })), 5200);
});

test('every failure a parent can hit has a sentence, and the rest fall back honestly', () => {
  assert.equal(failureSentence('no_subtitles', null), ADD.failNoSubtitles);
  assert.equal(failureSentence('subtitle_quota', null), ADD.failSubtitleQuota);
  assert.equal(failureSentence('timed_out', null), ADD.failTimedOut);
  assert.equal(failureSentence('kaboom', 'the loader fell over'), `${ADD.failGeneric} the loader fell over`);
  // No code and no message: the generic line stands alone rather than trailing "undefined".
  assert.equal(failureSentence(null, null), ADD.failGeneric);
});

test('a live job shows money set aside, a finished one shows a bill', () => {
  // `cost_usd` on a queued job is the reserve the budget booked for it — $1.70 before a single
  // model call — and it goes *down* when the run reconciles. "170¢ so far" was that reserve
  // presented as spending, followed by spending that appeared to fall.
  assert.equal(ADD.costReserved(1.7), 'up to $1.70 set aside');
  assert.equal(ADD.costReserved(0), 'up to $0.00 set aside');
  assert.equal(ADD.costTotal, 'in total');
});

test('the day’s spending says when part of it is only set aside', () => {
  assert.equal(spentLine(0.34, 5), '$0.34 of $5.00 spent today');
  assert.equal(
    spentLine(2.04, 5, 1.7),
    '$2.04 of $5.00 spent today — includes $1.70 set aside for the run in progress',
  );
  // An API that has not told us the figure gets no vague clause: null is "say only what we know".
  assert.equal(spentLine(2.04, 5, null), '$2.04 of $5.00 spent today');
});

test('the finish line names whose pass it is the finish of', () => {
  // Sonnet's reading of the transcript is not in this recording and its seconds and cents are not
  // in these counters, so calling it the whole run was a claim the numbers do not support.
  assert.equal(
    finishLine('5.2 s', 78, 247, '8¢'),
    'That was Jev’s pass: 5.2 s · 78 requests · 247 beats · 8¢',
  );
});
