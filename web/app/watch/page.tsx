import type { Metadata } from 'next';
import { WatchShell } from '@/components/WatchShell';
import { DemoPicker } from '@/components/DemoPicker';
import { listFilms } from '@/lib/queries';
import { forwardToSceneApi } from '@/lib/scene-api';
import { DEMO, WATCH } from '@/lib/copy';
import type { DemoStatus } from '@/lib/job';
import styles from './watch.module.css';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Watch it work — Tiny Viewers',
  description: WATCH.intro,
};

type Props = { searchParams: Promise<{ film?: string | string[] }> };

/**
 * Whether a live run can start right now, read fresh on every request.
 *
 * A scene API that is down is not an error page: the shelf is in the database, and each film's
 * recorded run with it. Only the live runs go away, and the page says so.
 */
async function readStatus(): Promise<DemoStatus | null> {
  try {
    const response = await forwardToSceneApi('/api/demo/status');
    if (!response.ok) return null;
    return (await response.json()) as DemoStatus;
  } catch {
    return null;
  }
}

/**
 * Pick any film, and watch the public part of the analysis run on it live.
 *
 * Three states, not two, and each says what it is: live runs are on; they are off for today (the
 * budget is spent) or for this deployment (a key the public stages need is missing); or we cannot tell (the service is not
 * answering). In every state but the first, each film on the shelf offers its recorded run
 * instead, labelled as a recording.
 */
export default async function WatchPage({ searchParams }: Props) {
  const [params, films, status] = await Promise.all([searchParams, listFilms(), readStatus()]);
  const raw = Array.isArray(params.film) ? params.film[0] : params.film;
  const live = status !== null && status.configured && status.available;

  return (
    <WatchShell headline={WATCH.headline} lead={WATCH.intro}>
      <section className={styles.panel} aria-labelledby="pick-heading">
        <h2 id="pick-heading" className={styles.sectionHeading}>
          {DEMO.pickHeading}
        </h2>
        {live ? (
          <p className={styles.sectionLead}>{DEMO.pickLead}</p>
        ) : (
          <p className={styles.sectionLead}>
            <b className={styles.off}>
              {status === null ? DEMO.unreachable : !status.configured ? DEMO.offHeadline : DEMO.capHeadline}
            </b>{' '}
            {status === null ? DEMO.unknownBody : !status.configured ? DEMO.offBody : DEMO.capBody}
          </p>
        )}

        {/* What today's live runs have cost, and the ceiling: both from the API, never from here. */}
        {status && <p className={styles.statusLine}>{DEMO.budgetLine(status.spent_today_usd, status.cap_usd)}</p>}

        <DemoPicker
          films={films.map(({ slug, title, year, posterUrl }) => ({ slug, title, year, posterUrl }))}
          initialSlug={(raw ?? '').trim()}
          live={live}
        />
      </section>
    </WatchShell>
  );
}
