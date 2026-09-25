'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { isLive, type Job } from '@/lib/job';
import { fetchJobOverHttp, startJobPoll, type PollHealth } from '@/lib/poll';

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
