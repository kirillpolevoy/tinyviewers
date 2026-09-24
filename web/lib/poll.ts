// Polling one job, without React: the loop `usePolledJob` wraps, kept here so it can be tested with a
// fake fetch and a fake clock.
//
// Two rules, both learned the hard way:
//
//  1. One request at a time. The next poll is scheduled when the current one settles, never on a
//     fixed interval — an interval lets a slow answer land after a newer one and put old steps back
//     on screen, and lets slow requests pile up behind each other.
//  2. A failed poll is news. The card that polls says "Now" beside a step; if the API stops answering,
//     that word is only the last thing we heard, and after a few misses the page has to say so. A 404
//     is not a hiccup at all: the job is gone, and asking again will not bring it back.

import { isLive, type Job } from './job';

/** Often enough that the steps feel live, seldom enough to be nothing to the API. */
export const POLL_MS = 1500;
/** The longest wait between tries once polls start failing. */
export const MAX_BACKOFF_MS = 15_000;
/** Misses in a row before the page stops presenting the last answer as current. */
export const INTERRUPTED_AFTER = 3;

export type PollHealth = {
  /**
   * `ok`: the last poll answered. `retrying`: one or two misses — too few to worry anyone about.
   * `interrupted`: enough misses that the job on screen is only the last known state. `missing`:
   * the API says there is no such job.
   */
  state: 'ok' | 'retrying' | 'interrupted' | 'missing';
  /** Misses in a row. */
  failures: number;
  /** When the last successful answer arrived (the caller's clock), or null before any. */
  lastOkAt: number | null;
};

export type PollAnswer = { kind: 'job'; job: Job } | { kind: 'missing' } | { kind: 'error' };

/** How long to wait before the next poll, given the misses in a row: 1.5 s, then doubling to 15 s. */
export function nextDelayMs(failures: number): number {
  if (failures <= 0) return POLL_MS;
  return Math.min(MAX_BACKOFF_MS, POLL_MS * 2 ** failures);
}

export function healthAfter(previous: PollHealth, answer: PollAnswer, now: number): PollHealth {
  if (answer.kind === 'job') return { state: 'ok', failures: 0, lastOkAt: now };
  if (answer.kind === 'missing') return { ...previous, state: 'missing' };
  const failures = previous.failures + 1;
  return { ...previous, failures, state: failures >= INTERRUPTED_AFTER ? 'interrupted' : 'retrying' };
}

type Timers = {
  setTimeout: (fn: () => void, ms: number) => unknown;
  clearTimeout: (handle: unknown) => void;
  now: () => number;
};

type Options = {
  job: Job;
  /** One poll. It must honour the signal; anything it throws counts as a miss. */
  fetchJob: (id: string, signal: AbortSignal) => Promise<PollAnswer>;
  onJob: (job: Job) => void;
  onHealth: (health: PollHealth) => void;
  timers?: Timers;
  /** When the job on screen was last known to be current. Defaults to now. */
  lastOkAt?: number | null;
};

const realTimers: Timers = {
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
  now: () => Date.now(),
};

/**
 * Poll a job until it stops moving, the API says it is gone, or `stop()` is called. Returns the
 * controls: `stop` aborts whatever is in flight and cancels whatever is scheduled, so after it no
 * callback fires; `retryNow` skips the wait (the parent pressed "Try again").
 */
export function startJobPoll({ job, fetchJob, onJob, onHealth, timers = realTimers, lastOkAt }: Options) {
  let stopped = false;
  let timer: unknown = null;
  let inFlight: AbortController | null = null;
  let health: PollHealth = { state: 'ok', failures: 0, lastOkAt: lastOkAt === undefined ? timers.now() : lastOkAt };

  const schedule = (ms: number) => {
    if (stopped) return;
    timer = timers.setTimeout(tick, ms);
  };

  async function tick() {
    timer = null;
    if (stopped || inFlight) return;
    const controller = new AbortController();
    inFlight = controller;
    let answer: PollAnswer;
    try {
      answer = await fetchJob(job.id, controller.signal);
    } catch {
      answer = { kind: 'error' };
    }
    inFlight = null;
    if (stopped || controller.signal.aborted) return;

    health = healthAfter(health, answer, timers.now());
    onHealth(health);
    if (answer.kind === 'job') {
      onJob(answer.job);
      if (!isLive(answer.job.status)) return;
    }
    if (answer.kind === 'missing') return;
    schedule(nextDelayMs(health.failures));
  }

  if (isLive(job.status)) schedule(POLL_MS);

  return {
    stop() {
      stopped = true;
      if (timer !== null) timers.clearTimeout(timer);
      timer = null;
      inFlight?.abort();
    },
    retryNow() {
      if (stopped || inFlight) return;
      if (timer !== null) timers.clearTimeout(timer);
      void tick();
    },
  };
}

/** The real fetch: the job, a 404 as "missing", anything else as a miss. */
export async function fetchJobOverHttp(id: string, signal: AbortSignal): Promise<PollAnswer> {
  const response = await fetch(`/api/add/jobs/${id}`, { cache: 'no-store', signal });
  if (response.status === 404) return { kind: 'missing' };
  if (!response.ok) return { kind: 'error' };
  return { kind: 'job', job: (await response.json()) as Job };
}
