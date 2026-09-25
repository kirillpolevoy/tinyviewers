// The server-side reads the Watch pages make, through the same forwarder the browser's proxy routes
// use. Each answers "could not ask" as null rather than throwing: the pages have a sentence for that.

import 'server-only';
import { forwardToSceneApi } from './scene-api';
import { isJobId } from './job';
import { normalizeRun, type DemoFilm, type DemoRun, type DemoStatus } from './demo';

async function readJson<T>(path: string): Promise<T | null> {
  try {
    const response = await forwardToSceneApi(path);
    if (!response.ok) return null;
    return (await response.json()) as T;
  } catch {
    return null;
  }
}

/** The films list, as an array whether the API sends one bare or under `films`. */
export function filmsFrom(body: unknown): DemoFilm[] | null {
  if (Array.isArray(body)) return body as DemoFilm[];
  if (body && typeof body === 'object' && Array.isArray((body as { films?: unknown }).films)) {
    return (body as { films: DemoFilm[] }).films;
  }
  return null;
}

export async function readDemoFilms(): Promise<DemoFilm[] | null> {
  return filmsFrom(await readJson<unknown>('/api/demo/films'));
}

export async function readDemoStatus(): Promise<DemoStatus | null> {
  return readJson<DemoStatus>('/api/demo/status');
}

/**
 * One run: the run, "no such run", or "could not ask". A 404 is news about the run; a 502 or 504 is
 * news about us, and a reload during an outage must not tell the reader their run never existed.
 */
export type RunLookup = { kind: 'run'; run: DemoRun } | { kind: 'missing' } | { kind: 'unreachable' };

export async function readDemoRun(id: string): Promise<RunLookup> {
  if (!isJobId(id)) return { kind: 'missing' };
  try {
    const response = await forwardToSceneApi(`/api/demo/runs/${id}`);
    if (response.ok) return { kind: 'run', run: normalizeRun(await response.json()) };
    return response.status === 404 ? { kind: 'missing' } : { kind: 'unreachable' };
  } catch {
    return { kind: 'unreachable' };
  }
}
