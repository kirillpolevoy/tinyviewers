'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { demoRefusal, type Refusal } from '@/lib/job';
import { DEMO } from '@/lib/copy';

/** How a demo run names its film: a library film by slug, anything else by IMDb id. */
export type DemoTarget = { slug: string } | { imdb_id: string; tmdb_id?: number };

/**
 * Start one live run and go to its page, or hold the refusal for the caller to show.
 *
 * The browser only ever talks to this app (`connect-src 'self'`); /api/demo/runs forwards it.
 */
export function useStartDemo() {
  const router = useRouter();
  const [starting, setStarting] = useState<string | null>(null);
  const [refusal, setRefusal] = useState<Refusal | null>(null);

  const start = async (target: DemoTarget, key: string) => {
    if (starting) return;
    setRefusal(null);
    setStarting(key);
    try {
      const response = await fetch('/api/demo/runs', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(target),
      });
      const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
      if (response.status === 202 && typeof body.id === 'string') {
        router.push(`/watch/run/${body.id}`);
        return;
      }
      setRefusal(demoRefusal(response.status, body));
    } catch {
      setRefusal({ text: DEMO.unreachable });
    }
    setStarting(null);
  };

  return { start, starting, refusal, setRefusal };
}
