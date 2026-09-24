// The job poll: one request at a time, backing off when polls fail, saying so when they keep
// failing, stopping for good on a 404 or a finished job, and never calling back after stop().

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  INTERRUPTED_AFTER,
  POLL_MS,
  healthAfter,
  nextDelayMs,
  startJobPoll,
  type PollAnswer,
  type PollHealth,
} from '../lib/poll';
import type { Job, JobStatus } from '../lib/job';

const job = (status: JobStatus, step: string | null = null): Job => ({
  id: 'job-1',
  kind: 'add',
  status,
  step,
  steps: [],
  film: { title: 'Coco', year: 2017, slug: status === 'done' ? 'coco' : null, poster_url: null, imdb_id: 'tt2380307' },
  cost_usd: null,
  error_code: null,
  error: null,
  recording_ready: false,
  scene_count: null,
  elapsed_ms: null,
  created_at: '',
  updated_at: '',
});

/** A clock and a timer queue the test moves by hand. */
function fakeTimers() {
  let now = 0;
  let seq = 0;
  const queue = new Map<number, { at: number; fn: () => void }>();
  const flush = () => new Promise((resolve) => setImmediate(resolve));
  return {
    timers: {
      setTimeout: (fn: () => void, ms: number) => {
        const id = ++seq;
        queue.set(id, { at: now + ms, fn });
        return id;
      },
      clearTimeout: (id: unknown) => void queue.delete(id as number),
      now: () => now,
    },
    pending: () => [...queue.values()].map((t) => t.at - now),
    async advance(ms: number) {
      const until = now + ms;
      for (;;) {
        const due = [...queue.entries()].filter(([, t]) => t.at <= until).sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        queue.delete(due[0]);
        now = due[1].at;
        due[1].fn();
        await flush();
        await flush();
      }
      now = until;
      await flush();
    },
    flush,
  };
}

test('the wait between polls is 1.5 s, and doubles to at most 15 s while they fail', () => {
  assert.deepEqual([0, 1, 2, 3, 4, 10].map(nextDelayMs), [1500, 3000, 6000, 12_000, 15_000, 15_000]);
});

test('health: a miss or two is only "retrying"; three in a row is "interrupted"; an answer resets it', () => {
  let h: PollHealth = { state: 'ok', failures: 0, lastOkAt: 5 };
  h = healthAfter(h, { kind: 'error' }, 10);
  assert.equal(h.state, 'retrying');
  h = healthAfter(h, { kind: 'error' }, 20);
  h = healthAfter(h, { kind: 'error' }, 30);
  assert.equal(h.state, 'interrupted');
  assert.equal(h.failures, INTERRUPTED_AFTER);
  assert.equal(h.lastOkAt, 5, 'the last good answer is remembered, not replaced by the time of a miss');
  h = healthAfter(h, { kind: 'job', job: job('running') }, 40);
  assert.deepEqual(h, { state: 'ok', failures: 0, lastOkAt: 40 });
  assert.equal(healthAfter(h, { kind: 'missing' }, 50).state, 'missing');
});

test('one request at a time: a slow answer is waited for, not overtaken', async () => {
  const clock = fakeTimers();
  let calls = 0;
  let inFlight = 0;
  let maxInFlight = 0;
  const answers: ((a: PollAnswer) => void)[] = [];
  const seen: (string | null)[] = [];
  startJobPoll({
    job: job('queued'),
    timers: clock.timers,
    fetchJob: () => {
      calls += 1;
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      return new Promise<PollAnswer>((resolve) =>
        answers.push((a) => {
          inFlight -= 1;
          resolve(a);
        }),
      );
    },
    onJob: (j) => seen.push(j.step),
    onHealth: () => {},
  });

  await clock.advance(POLL_MS);
  assert.equal(calls, 1);
  // Ten seconds pass with the first poll still out: no second request goes after it.
  await clock.advance(10_000);
  assert.equal(calls, 1);
  answers[0]({ kind: 'job', job: job('running', 'subtitles') });
  await clock.flush();
  // The next poll is scheduled from the answer, not from a fixed beat.
  assert.deepEqual(clock.pending(), [POLL_MS]);
  await clock.advance(POLL_MS);
  assert.equal(calls, 2);
  answers[1]({ kind: 'job', job: job('running', 'scenes') });
  await clock.flush();
  assert.equal(maxInFlight, 1);
  assert.deepEqual(seen, ['subtitles', 'scenes']);
});

test('failed polls back off, turn into "interrupted", and recover on the next answer', async () => {
  const clock = fakeTimers();
  const script: PollAnswer[] = [
    { kind: 'job', job: job('running', 'subtitles') },
    { kind: 'error' },
    { kind: 'error' },
    { kind: 'error' },
    { kind: 'job', job: job('running', 'scenes') },
  ];
  const health: PollHealth['state'][] = [];
  const gaps: number[] = [];
  let last = 0;
  startJobPoll({
    job: job('queued'),
    timers: clock.timers,
    fetchJob: async () => {
      gaps.push(clock.timers.now() - last);
      last = clock.timers.now();
      return script.shift() ?? { kind: 'error' };
    },
    onJob: () => {},
    onHealth: (h) => health.push(h.state),
  });
  await clock.advance(60_000);
  assert.deepEqual(health.slice(0, 5), ['ok', 'retrying', 'retrying', 'interrupted', 'ok']);
  // 1.5 s to the first poll, 1.5 s after an answer, then 3, 6, 12 s after one, two, three misses.
  assert.deepEqual(gaps.slice(0, 5), [1500, 1500, 3000, 6000, 12_000]);
});

test('a thrown fetch counts as a miss, not a crash', async () => {
  const clock = fakeTimers();
  const health: PollHealth['state'][] = [];
  startJobPoll({
    job: job('running'),
    timers: clock.timers,
    fetchJob: async () => {
      throw new TypeError('Failed to fetch');
    },
    onJob: () => assert.fail('no job from a failed fetch'),
    onHealth: (h) => health.push(h.state),
  });
  await clock.advance(POLL_MS);
  assert.deepEqual(health, ['retrying']);
});

test('a 404 is final: the card is told the run is gone and polling stops', async () => {
  const clock = fakeTimers();
  let calls = 0;
  const health: PollHealth['state'][] = [];
  startJobPoll({
    job: job('running'),
    timers: clock.timers,
    fetchJob: async () => {
      calls += 1;
      return { kind: 'missing' };
    },
    onJob: () => {},
    onHealth: (h) => health.push(h.state),
  });
  await clock.advance(60_000);
  assert.equal(calls, 1);
  assert.deepEqual(health, ['missing']);
});

test('polling stops by itself once the job is done', async () => {
  const clock = fakeTimers();
  let calls = 0;
  startJobPoll({
    job: job('running'),
    timers: clock.timers,
    fetchJob: async () => {
      calls += 1;
      return { kind: 'job', job: job('done') };
    },
    onJob: () => {},
    onHealth: () => {},
  });
  await clock.advance(60_000);
  assert.equal(calls, 1);
  assert.deepEqual(clock.pending(), []);
});

test('stop() aborts the request in flight and nothing calls back after it', async () => {
  const clock = fakeTimers();
  let signal: AbortSignal | null = null;
  let resolve: (a: PollAnswer) => void = () => {};
  const poll = startJobPoll({
    job: job('running'),
    timers: clock.timers,
    fetchJob: (_id, s) => {
      signal = s;
      return new Promise<PollAnswer>((r) => (resolve = r));
    },
    onJob: () => assert.fail('no answer may land after stop()'),
    onHealth: () => assert.fail('no health may land after stop()'),
  });
  await clock.advance(POLL_MS);
  poll.stop();
  assert.equal((signal as AbortSignal | null)?.aborted, true);
  resolve({ kind: 'job', job: job('running', 'scenes') });
  await clock.flush();
  assert.deepEqual(clock.pending(), []);
});

test('"Ask again now" polls at once instead of waiting out the back-off', async () => {
  const clock = fakeTimers();
  let calls = 0;
  const poll = startJobPoll({
    job: job('running'),
    timers: clock.timers,
    fetchJob: async () => {
      calls += 1;
      return { kind: 'error' };
    },
    onJob: () => {},
    onHealth: () => {},
  });
  await clock.advance(POLL_MS + 3000 + 6000);
  assert.equal(calls, 3);
  poll.retryNow();
  await clock.flush();
  await clock.flush();
  assert.equal(calls, 4);
  poll.stop();
});

test('a job that is already finished is not polled at all', async () => {
  const clock = fakeTimers();
  startJobPoll({
    job: job('done'),
    timers: clock.timers,
    fetchJob: async () => assert.fail('a finished job is not asked about'),
    onJob: () => {},
    onHealth: () => {},
  });
  await clock.advance(60_000);
});
