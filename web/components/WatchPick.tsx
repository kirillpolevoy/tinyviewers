'use client';

import Link from 'next/link';
import { Poster } from './Poster';
import { ArrowRight } from './Art';
import { useStartRun } from './useDemoRun';
import { DEMO_LIVE } from '@/lib/copy';
import { pickState, type DemoFilm, type DemoStatus } from '@/lib/demo';
import styles from './Watch.module.css';

type Props = {
  /** null: the list could not be read. */
  films: DemoFilm[] | null;
  /** null: the budget could not be read. */
  status: DemoStatus | null;
};

/**
 * The films Jev can run on, and the button that starts a real run. A run the API refuses says why
 * beside the film; a refusal for the day's budget turns the whole list off, because it is true of
 * every film.
 */
export function WatchPick({ films, status }: Props) {
  const { start, starting, refusal } = useStartRun();
  // A run refused for the day's budget is news about every film, not the one pressed.
  const state = refusal?.refusal.kind === 'cap' ? 'cap' : pickState(films, status);
  // When no check can start, a film that is in the library can still be read: its saved guide.
  const savedOnly = state === 'cap' || state === 'busy' || state === 'off';

  return (
    <section className={styles.pick} aria-labelledby="pick-heading">
      <div className={styles.pickHead}>
        <h2 id="pick-heading" className={styles.sectionHeading}>
          {DEMO_LIVE.pickHeading}
        </h2>
        {films && films.length > 0 && <span className={styles.pickNote}>{DEMO_LIVE.pickNote}</span>}
      </div>

      {state === 'down' && (
        <div className={styles.notice} role="status">
          <p>
            <b>{DEMO_LIVE.downHeadline}</b> {DEMO_LIVE.downBody}
          </p>
          {/* A bare anchor: asking again has to be a fresh server render of this page. */}
          <a href="/watch" className="button buttonQuiet">
            {DEMO_LIVE.retry}
          </a>
        </div>
      )}

      {state === 'empty' && (
        <div className={styles.notice} role="status">
          <p>
            <b>{DEMO_LIVE.emptyHeadline}</b> {DEMO_LIVE.emptyBody}
          </p>
          <Link href="/library" className="button buttonQuiet">
            {DEMO_LIVE.toLibrary}
          </Link>
        </div>
      )}

      {state === 'cap' && (
        <div className={styles.notice} role="status">
          <p>
            <b>{DEMO_LIVE.capHeadline}</b> {DEMO_LIVE.capBody}
          </p>
        </div>
      )}

      {state === 'busy' && (
        <div className={styles.notice} role="status">
          <p>
            <b>{DEMO_LIVE.busyHeadline}</b> {DEMO_LIVE.busyBody}
          </p>
          {/* A bare anchor: asking again is a fresh read of the slots. */}
          <a href="/watch" className="button buttonQuiet">
            {DEMO_LIVE.refresh}
          </a>
        </div>
      )}

      {state === 'off' && (
        <div className={styles.notice} role="status">
          <p>
            <b>{DEMO_LIVE.offHeadline}</b> {DEMO_LIVE.offBody}
          </p>
        </div>
      )}

      {films && films.length > 0 && (
        <ul className={styles.filmList}>
          {films.map((film) => {
            const refused = refusal && refusal.slug === film.slug && refusal.refusal.kind !== 'cap' ? refusal.refusal : null;
            return (
              <li key={film.slug} className={styles.filmRow}>
                <Poster
                  url={film.poster}
                  title={film.title}
                  width={56}
                  height={78}
                  placeholder=""
                  decorative
                  className={styles.filmPoster}
                />
                <span className={styles.filmName}>
                  <span className={styles.filmTitle}>{film.title}</span>
                  <span className={styles.filmYear}>
                    {film.year ?? ''}
                    {film.in_library && <span className={styles.chip}>{DEMO_LIVE.inLibrary}</span>}
                  </span>
                </span>
                <span className={`tabular ${styles.filmReady}`}>{DEMO_LIVE.ready(film.scene_count)}</span>
                {state === 'live' && (
                  <button
                    type="button"
                    className={`button ${styles.runButton}`}
                    onClick={() => start(film.slug)}
                    disabled={starting !== null}
                    aria-describedby={refused ? `refusal-${film.slug}` : undefined}
                  >
                    {starting === film.slug ? DEMO_LIVE.starting : DEMO_LIVE.run}
                    {starting !== film.slug && <ArrowRight />}
                  </button>
                )}
                {savedOnly && film.in_library && (film.library_slug ?? film.slug) && (
                  <Link href={`/film/${film.library_slug ?? film.slug}`} className={`button buttonQuiet ${styles.runButton}`}>
                    {DEMO_LIVE.openSaved}
                  </Link>
                )}
                {refused && (
                  <p id={`refusal-${film.slug}`} className={styles.refusal} role="alert">
                    {refused.kind === 'not_ready' && <b>{DEMO_LIVE.notReadyHeadline} </b>}
                    {refused.text}
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {/* What today's live runs have cost, and the ceiling: both from the API, never from here. */}
      {status && <p className={`tabular ${styles.budget}`}>{DEMO_LIVE.budget(status.spent_today_usd, status.cap_usd)}</p>}
    </section>
  );
}
