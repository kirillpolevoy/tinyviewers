'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { buildReplayPayload, withLines, type ReplayPayload } from '@/lib/replay';
import { isLive, type Job, type JobRecording } from '@/lib/job';
import { fetchJobOverHttp, startJobPoll, type PollHealth } from '@/lib/poll';

/**
 * How long a fetch that is not the poll waits before asking again, one entry per retry.
 *
 * The recording and the lines used to ride the poll, which meant they inherited its one fatal
 * property: it stops. A recording that failed to load at the moment the run reached `done` was
 * never asked for again. These back off on their own clock and give up on their own terms.
 */
const RETRY_MS = [1000, 2000, 4000, 8000];

/**
 * Run `ask` until it says it got what it came for, or until the retries run out. Returns the
 * cleanup an effect wants: after it, nothing is in flight and nothing is scheduled.
 */
function retrying(ask: () => Promise<boolean>): () => void {
  let cancelled = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let attempt = 0;

  const go = async () => {
    const got = await ask().catch(() => false);
    if (got || cancelled || attempt >= RETRY_MS.length) return;
    timer = setTimeout(go, RETRY_MS[attempt]);
    attempt += 1;
  };
  void go();

  return () => {
    cancelled = true;
    clearTimeout(timer);
  };
}

/**
 * One job, kept current — and how current it is.
 *
 * Polls until the job stops moving and then stops (`lib/poll.ts` has the loop and its rules: one
 * request at a time, backing off when polls fail). `health` says whether the job on screen is the
 * API's latest answer or only the last one we got, and `retry` asks again straight away.
 */
export function usePolledJob(initialJob: Job): { job: Job; health: PollHealth; retry: () => void } {
  const [job, setJob] = useState(initialJob);
  const [health, setHealth] = useState<PollHealth>(() => ({ state: 'ok', failures: 0, lastOkAt: null }));
  const control = useRef<{ retryNow: () => void } | null>(null);

  // One loop per job id. It ends on its own when the job stops moving; the cleanup aborts whatever
  // is in flight, so an answer for an unmounted card (or a previous job) never lands.
  useEffect(() => {
    if (!isLive(initialJob.status)) return;
    const poll = startJobPoll({ job: initialJob, fetchJob: fetchJobOverHttp, onJob: setJob, onHealth: setHealth });
    control.current = poll;
    return () => {
      poll.stop();
      control.current = null;
    };
    // The initial job is the loop's starting point, not a dependency: a new id is a new loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialJob.id]);

  const retry = useCallback(() => control.current?.retryNow(), []);
  return { job, health, retry };
}

/**
 * The job's recording (the Jev stage's, when that stage has run) as a replay payload, once there is one — and, for a film that is in the
 * library, the evidence lines merged in from the film's own recorded excerpts.
 *
 * The recording is turned into a payload **once** and kept: rebuilding it on a later poll would
 * hand `RunReplay` a new object mid-animation. The lines are merged rather than swapped for the
 * same reason (`withLines`). A run's recording carries no lines of its own once it is over — the
 * job keeps no subtitle text past its end — so `linesFrom` names the film whose stored excerpts
 * should be read, when it has any; a beat that flagged in this run but not in the stored one simply
 * has no lines.
 */
export function useJobReplay(
  job: Job,
  initialRecording: JobRecording | null,
  linesFrom: string | null,
): ReplayPayload | null {
  const [payload, setPayload] = useState<ReplayPayload | null>(() =>
    initialRecording ? buildReplayPayload(initialRecording.recording, initialRecording.excerpts) : null,
  );

  // `payload` in the dependencies is what ends it: the effect re-runs when the recording lands and
  // returns immediately, so exactly one of these loops is ever alive. Nothing is said on screen
  // while it retries — a 404 here is normal (the flag and the write race by a moment).
  useEffect(() => {
    if (!job.recording_ready || payload) return;
    return retrying(async () => {
      const response = await fetch(`/api/add/jobs/${job.id}/recording`, { cache: 'no-store' });
      if (!response.ok) return false;
      const body = (await response.json()) as JobRecording;
      setPayload(buildReplayPayload(body.recording, body.excerpts));
      return true;
    });
  }, [job.recording_ready, job.id, payload]);

  const merged = useRef(false);
  const hasPayload = payload !== null;
  useEffect(() => {
    if (!linesFrom || !hasPayload || merged.current) return;
    return retrying(async () => {
      const response = await fetch(`/api/films/${linesFrom}/recording`, { cache: 'no-store' });
      if (!response.ok) return false;
      const body = (await response.json()) as { payload: ReplayPayload | null };
      merged.current = true;
      // No recording row for this film is an answer, not a failure: there is nothing to wait for.
      if (body.payload) setPayload((current) => (current ? withLines(current, body.payload!) : current));
      return true;
    });
  }, [linesFrom, hasPayload]);

  return payload;
}
