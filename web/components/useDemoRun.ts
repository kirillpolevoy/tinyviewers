'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { isRunLive, normalizeRun, runRefusal, type DemoRun, type RunRefusal } from '@/lib/demo';
import { DEMO_LIVE } from '@/lib/copy';
import { startPoll, type Answer, type PollHealth } from '@/lib/poll';

/** One poll of a live run: the run, a 404 as "missing", anything else as a miss. */
export async function fetchRunOverHttp(id: string, signal: AbortSignal): Promise<Answer<DemoRun>> {
  const response = await fetch(`/api/demo/runs/${id}`, { cache: 'no-store', signal });
  if (response.status === 404) return { kind: 'missing' };
  if (!response.ok) return { kind: 'error' };
  return { kind: 'value', value: normalizeRun(await response.json()) };
}

/**
 * One live run, kept current, and how current it is — the add card's loop (`lib/poll.ts`): one
 * request at a time, the next scheduled when the last settles, backing off when polls fail, and the
 * one in flight aborted when the page goes away. It stops when the run does.
 */
export function useDemoRun(id: string, initialRun: DemoRun): { run: DemoRun; health: PollHealth; retry: () => void } {
  const [run, setRun] = useState(initialRun);
  const [health, setHealth] = useState<PollHealth>(() => ({ state: 'ok', failures: 0, lastOkAt: null }));
  const control = useRef<{ retryNow: () => void } | null>(null);

  useEffect(() => {
    const poll = startPoll<DemoRun>({
      id,
      live: isRunLive(initialRun.status),
      fetchOne: fetchRunOverHttp,
      isLive: (value) => isRunLive(value.status),
      onValue: setRun,
      onHealth: setHealth,
    });
    control.current = poll;
    return () => {
      poll.stop();
      control.current = null;
    };
    // The initial run is the loop's starting point, not a dependency: a new id is a new loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const retry = useCallback(() => control.current?.retryNow(), []);
  return { run, health, retry };
}

/**
 * Start one live run on a film and go to its page, or hold the refusal for the caller to show.
 * The browser only ever talks to this app (`connect-src 'self'`); /api/demo/runs forwards it.
 */
export function useStartRun() {
  const router = useRouter();
  const [starting, setStarting] = useState<string | null>(null);
  const [refusal, setRefusal] = useState<{ slug: string; refusal: RunRefusal } | null>(null);

  const start = async (slug: string) => {
    if (starting) return;
    setRefusal(null);
    setStarting(slug);
    try {
      const response = await fetch('/api/demo/runs', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ slug }),
      });
      const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
      if (response.status === 202 && typeof body.id === 'string') {
        router.push(`/watch/run/${encodeURIComponent(body.id)}?film=${encodeURIComponent(slug)}`);
        return;
      }
      setRefusal({ slug, refusal: runRefusal(response.status, body) });
    } catch {
      setRefusal({ slug, refusal: { kind: 'unreachable', text: DEMO_LIVE.downBody } });
    }
    setStarting(null);
  };

  return { start, starting, refusal };
}
