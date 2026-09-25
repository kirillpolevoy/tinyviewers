// The library's side of an add run, as pure rules: what the URL says, which films are "Just added",
// and what to do while a finished run's film has not yet reached the list on screen.
//
// LibraryShelf does the effects (history, router.refresh, focus); these decide them, so the whole
// sequence — accepted, polled, done, refreshed, landed — can be walked through in a test without a
// browser.

import type { Job } from './job';

/** How many times the library asks for a fresh list before it stops and shows a link instead. */
export const MAX_ARRIVAL_REFRESHES = 3;
/** The first refresh goes at once; the later ones give the database a moment. */
export const ARRIVAL_RETRY_MS = 1500;

/** The library's address: the filter as typed, and the run on screen so a reload finds it again. */
export function libraryHref(query: string, jobId: string | null): string {
  const params = new URLSearchParams();
  const trimmed = query.trim();
  if (trimmed) params.set('q', trimmed);
  if (jobId) params.set('job', jobId);
  const qs = params.toString();
  return qs ? `/library?${qs}` : '/library';
}

/** The "Just added" list with this film first, once. */
export function withJustAdded(list: string[], slug: string): string[] {
  return [slug, ...list.filter((s) => s !== slug)];
}

/** `rebuilt`: the film was already in the library and its guide was replaced (an admin rebuild). */
export type AddedFilm = { slug: string; title: string; rebuilt?: boolean };

/** The film a run added, when the run is finished and names one. */
export function addedFilm(job: Job | null): AddedFilm | null {
  if (!job || job.status !== 'done' || !job.film.slug) return null;
  return { slug: job.film.slug, title: job.film.title, ...(job.kind === 'rebuild' ? { rebuilt: true } : {}) };
}

/**
 * Should a job the page was loaded with be shown as a live card?
 *
 * Not once it is done and names its film: that film is simply in the library — or about to be, and
 * `arrivalStep` sees to that. A done job without a film still gets its card ("That one is done"),
 * and every other state is live or failed, which the card shows.
 */
export function showsAsCard(job: Job | null): boolean {
  return job !== null && addedFilm(job) === null;
}

export type ArrivalStep =
  | { kind: 'arrived' }
  | { kind: 'refresh'; delayMs: number }
  | { kind: 'gave-up' };

/**
 * A run has finished and added `slug`. Given the films on screen and the refreshes asked for so far,
 * what next? It is the same answer whether the run finished while the page watched or before the
 * page was loaded — a reload can read the library a moment before the film is written and the job a
 * moment after, and that film must still land.
 */
export function arrivalStep(slug: string, films: { slug: string }[], refreshesSoFar: number): ArrivalStep {
  if (films.some((film) => film.slug === slug)) return { kind: 'arrived' };
  if (refreshesSoFar >= MAX_ARRIVAL_REFRESHES) return { kind: 'gave-up' };
  return { kind: 'refresh', delayMs: refreshesSoFar === 0 ? 0 : ARRIVAL_RETRY_MS };
}
