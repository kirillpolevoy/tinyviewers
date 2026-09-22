import Link from 'next/link';
import type { Metadata } from 'next';
import { WatchShell } from '@/components/WatchShell';
import { AddFilm } from '@/components/AddFilm';
import { Poster } from '@/components/Poster';
import { listRecordedFilms } from '@/lib/queries';
import { forwardToSceneApi } from '@/lib/scene-api';
import { formatCents, formatSeconds } from '@/lib/replay';
import { ADD, spentLine, WATCH } from '@/lib/copy';
import type { AddStatus } from '@/lib/job';
import styles from './watch.module.css';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Watch it work — Tiny Viewers',
  description: WATCH.intro,
};

type Props = { searchParams: Promise<{ film?: string | string[] }> };

/**
 * Whether anything can be added right now, read fresh on every request.
 *
 * `forwardToSceneApi` rather than fetching this app's own /api/add/status: the handler is a thin
 * forwarder, and a server component calling its own HTTP endpoint would be a round trip through the
 * network stack to run the same function. The handler exists for the browser, which cannot call the
 * scene API at all under this app's CSP.
 *
 * A scene API that is down is not an error page. The runs on the shelf are in the database and have
 * nothing to do with it; only the form goes away, and it says so.
 */
async function readStatus(): Promise<AddStatus | null> {
  try {
    const response = await forwardToSceneApi('/api/add/status');
    if (!response.ok) return null;
    return (await response.json()) as AddStatus;
  } catch {
    return null;
  }
}

export default async function WatchPage({ searchParams }: Props) {
  const [params, films, status] = await Promise.all([
    searchParams,
    listRecordedFilms(),
    readStatus(),
  ]);
  const raw = Array.isArray(params.film) ? params.film[0] : params.film;
  // Three states, not two. "No passcode is configured" is something the API told us; a status read
  // that failed told us nothing at all, and saying the first when we mean the second sends the
  // owner looking for a missing environment variable while the real answer is that the service is
  // down. Same missing form either way, different sentence under it.
  const canAdd = status?.passcode_configured === true;
  const unknown = status === null;

  return (
    <WatchShell headline={WATCH.headline} lead={WATCH.intro}>
      <section className={styles.addPanel} aria-labelledby="add-heading">
        <h2 id="add-heading" className={styles.sectionHeading}>
          {ADD.heading}
        </h2>

        {canAdd ? (
          <>
            <p className={styles.sectionLead}>{ADD.lead}</p>
            <AddFilm initialQuery={(raw ?? '').trim()} />
          </>
        ) : (
          <p className={styles.sectionLead}>
            <b className={styles.off}>{unknown ? ADD.unknownHeadline : ADD.offHeadline}</b> —{' '}
            {unknown ? ADD.unknownBody : ADD.offBody}
          </p>
        )}

        {/* The three things a visitor is owed before pressing anything: what is running, what it
            has cost today, and what the ceiling is. All three come from the API, never from here. */}
        {status && (
          <p className={styles.statusLine}>
            {status.running ? (
              <>
                {ADD.runningNow} —{' '}
                <Link href={`/watch/job/${status.running.id}`} className={styles.statusLink}>
                  {ADD.runningLink}
                </Link>
                {' · '}
              </>
            ) : null}
            {/* The reserve clause only where there is a run to attribute it to, and only when the
                API sent the figure: today's total already contains that run's whole ceiling. */}
            {spentLine(
              status.spent_today_usd,
              status.cap_usd,
              status.running ? (status.reserve_usd ?? null) : null,
            )}
          </p>
        )}
      </section>

      <section className={styles.shelf} aria-labelledby="runs-heading">
        <h2 id="runs-heading" className={styles.sectionHeading}>
          {WATCH.shelfHeading}
        </h2>
        <p className={styles.sectionLead}>{WATCH.shelfNote}</p>

        {films.length === 0 ? (
          <p className={styles.sectionLead}>{WATCH.noRecording}</p>
        ) : (
          <ul className={styles.grid}>
            {films.map((film) => (
              <li key={film.slug}>
                <Link href={`/watch/${film.slug}`} className={styles.card}>
                  <Poster
                    url={film.posterUrl}
                    title={film.title}
                    width={92}
                    height={130}
                    className={styles.cardPoster}
                  />
                  <span className={styles.cardText}>
                    <span className={styles.cardTitle}>
                      {film.title}
                      {film.year && <span className={styles.cardYear}>{film.year}</span>}
                    </span>
                    {/* Both numbers are read off that film's own recording. */}
                    <span className={`tabular ${styles.cardFacts}`}>
                      {formatSeconds(film.wallMs)} · {formatCents(film.costUsd)} · {film.beats} beats
                    </span>
                    <span className={styles.cardAction}>{WATCH.play} →</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </WatchShell>
  );
}
