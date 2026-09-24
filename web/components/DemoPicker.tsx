'use client';

import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import { Poster } from './Poster';
import { ArrowRight } from './Art';
import { useStartDemo } from './useStartDemo';
import { demoRefusal, type Candidate, type Refusal } from '@/lib/job';
import { DEMO, WATCH } from '@/lib/copy';
import addStyles from './AddFilm.module.css';
import styles from './DemoPicker.module.css';

export type PickerFilm = { slug: string; title: string; year: number | null; posterUrl: string | null };

type Props = {
  films: PickerFilm[];
  /** `?film=` from a film page's "See how this was worked out": that film goes first. */
  initialSlug: string;
  /**
   * False when a live run cannot start today — the budget is spent, the deployment lacks a key,
   * or the service is not answering. The shelf then offers each film's recorded run instead, and
   * the search box is put away.
   */
  live: boolean;
};

/**
 * Pick a film for a live run: one from the shelf, or any film by title or IMDb link.
 *
 * Every refusal the API can return has a sentence (`demoRefusal`), and the day's cap on a shelf
 * film comes with its recorded run as the way onward.
 */
export function DemoPicker({ films, initialSlug, live }: Props) {
  const { start, starting, refusal: startRefusal } = useStartDemo();
  const [query, setQuery] = useState('');
  const [finding, setFinding] = useState(false);
  const [candidates, setCandidates] = useState<Candidate[] | null>(null);
  const [lookupRefusal, setLookupRefusal] = useState<Refusal | null>(null);
  const refusal = startRefusal ?? lookupRefusal;

  const ordered = [...films].sort((a, b) => Number(b.slug === initialSlug) - Number(a.slug === initialSlug));

  const onFind = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (finding || starting) return;
    setLookupRefusal(null);
    setCandidates(null);
    setFinding(true);
    try {
      const response = await fetch('/api/demo/resolve', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ query: query.trim() }),
      });
      const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
      if (!response.ok) setLookupRefusal(demoRefusal(response.status, body));
      else setCandidates(Array.isArray(body.candidates) ? (body.candidates as Candidate[]).slice(0, 3) : []);
    } catch {
      setLookupRefusal({ text: DEMO.unreachable });
    }
    setFinding(false);
  };

  const busy = finding || starting !== null;

  return (
    <div className={styles.picker}>
      {live && (
        <form className={addStyles.form} onSubmit={onFind}>
          <div className={addStyles.field}>
            <label className={`eyebrow ${addStyles.label}`} htmlFor="demo-film">
              {DEMO.searchLabel}
            </label>
            <input
              id="demo-film"
              className={addStyles.input}
              type="text"
              name="film"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={DEMO.searchPlaceholder}
              autoComplete="off"
              required
            />
          </div>
          <button type="submit" className={`button ${addStyles.submit}`} disabled={busy}>
            {finding ? DEMO.finding : DEMO.find}
          </button>
        </form>
      )}

      {/* Assertive: a refusal is the answer to the button just pressed. */}
      {refusal && (
        <p className={addStyles.refusal} role="alert">
          {refusal.text}{' '}
          {refusal.link && (
            <Link href={refusal.link.href} className={addStyles.refusalLink}>
              {refusal.link.label}
            </Link>
          )}
        </p>
      )}

      {candidates && candidates.length === 0 && (
        <p className={addStyles.refusal} role="status">
          {DEMO.noCandidates}
        </p>
      )}

      {candidates && candidates.length > 0 && (
        <section className={addStyles.candidates} aria-label={DEMO.candidatesHeading}>
          <h3 className={addStyles.candidatesHeading}>{DEMO.candidatesHeading}</h3>
          <ul className={addStyles.candidateList}>
            {candidates.map((candidate) => (
              <li key={candidate.tmdb_id} className={addStyles.candidate}>
                <Poster
                  url={candidate.poster_url}
                  title={candidate.title}
                  width={64}
                  height={90}
                  className={addStyles.candidatePoster}
                />
                <div className={addStyles.candidateText}>
                  <p className={addStyles.candidateTitle}>
                    {candidate.title}
                    {candidate.year && <span className={addStyles.candidateYear}>{candidate.year}</span>}
                  </p>
                  {candidate.exists && <p className={addStyles.candidateOverview}>{DEMO.onShelf}</p>}
                </div>
                {candidate.imdb_id ? (
                  <button
                    type="button"
                    className={`button buttonQuiet ${addStyles.candidateAction}`}
                    onClick={() =>
                      start(
                        candidate.exists && candidate.slug
                          ? { slug: candidate.slug }
                          : { imdb_id: candidate.imdb_id!, tmdb_id: candidate.tmdb_id },
                        `tmdb-${candidate.tmdb_id}`,
                      )
                    }
                    disabled={busy}
                  >
                    {starting === `tmdb-${candidate.tmdb_id}` ? DEMO.starting : DEMO.choose}
                    <ArrowRight />
                  </button>
                ) : (
                  <p className={addStyles.candidateOverview}>{DEMO.badRequest}</p>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className={styles.shelf} aria-labelledby="shelf-heading">
        <h2 id="shelf-heading" className={styles.shelfHeading}>
          {WATCH.shelfHeading}
        </h2>
        {live && <p className={styles.shelfNote}>{WATCH.shelfNote}</p>}
        <ul className={styles.grid}>
          {ordered.map((film) => {
            const inner = (
              <>
                <Poster url={film.posterUrl} title={film.title} width={92} height={130} className={styles.cardPoster} />
                <span className={styles.cardText}>
                  <span className={styles.cardTitle}>
                    {film.title}
                    {film.year && <span className={styles.cardYear}>{film.year}</span>}
                  </span>
                  <span className={styles.cardAction}>
                    {live ? (starting === film.slug ? DEMO.starting : WATCH.play) : DEMO.watchRecording} →
                  </span>
                </span>
              </>
            );
            return (
              <li key={film.slug}>
                {live ? (
                  <button
                    type="button"
                    className={styles.card}
                    onClick={() => start({ slug: film.slug }, film.slug)}
                    disabled={busy}
                    autoFocus={film.slug === initialSlug}
                  >
                    {inner}
                  </button>
                ) : (
                  <Link href={`/watch/${film.slug}`} className={styles.card}>
                    {inner}
                  </Link>
                )}
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
