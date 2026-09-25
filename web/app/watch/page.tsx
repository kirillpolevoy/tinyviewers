import type { Metadata } from 'next';
import { SiteHeader } from '@/components/SiteHeader';
import { WatchPick } from '@/components/WatchPick';
import { HowItFits } from '@/components/HowItFits';
import { readDemoFilms, readDemoStatus } from '@/lib/demo-lookup';
import { DEMO_LIVE } from '@/lib/copy';
import styles from '@/components/Watch.module.css';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Watch it work — Tiny Viewers',
  description: DEMO_LIVE.intro,
  openGraph: { type: 'website', siteName: 'Tiny Viewers', title: 'Watch it work — Tiny Viewers', description: DEMO_LIVE.intro, url: '/watch' },
  twitter: { card: 'summary_large_image', title: 'Watch it work — Tiny Viewers', description: DEMO_LIVE.intro },
};

/**
 * Pick a film, and watch Jev do its three jobs on it live.
 *
 * Written for a parent who has never heard of Jev: one line on what they get, then how it works -- the
 * three things they do (pick, watch, read) and what happens behind the scenes (what Sonnet did earlier,
 * Jev's three jobs, what the rules do after) -- then the films, then the plain note that this is the step
 * that builds the guides (not a showcase).
 *
 * Read fresh on every request: which films have Sonnet's reading stored, and whether today's budget
 * has room for a run. Each state is its own sentence (`pickState`): live, the budget is used up, both
 * slots are busy for a minute, live checks are switched off, no film is ready yet, or the service is
 * not answering.
 */
export default async function WatchPage() {
  const [films, status] = await Promise.all([readDemoFilms(), readDemoStatus()]);

  return (
    <div className="page">
      <SiteHeader current="/watch" />
      <main className={`frame ${styles.main}`}>
        <section className={styles.intro}>
          <p className="eyebrow">{DEMO_LIVE.eyebrow}</p>
          <h1 className={styles.headline}>{DEMO_LIVE.headline}</h1>
          <p className={styles.lead}>{DEMO_LIVE.intro}</p>
        </section>

        {/* How it works first: what to do (pick, watch, read), then what happens behind the scenes. */}
        <HowItFits steps />

        <WatchPick films={films} status={status} />

        <p className={styles.realStep}>
          {DEMO_LIVE.realStep} {DEMO_LIVE.sourcesNote}
        </p>
      </main>
    </div>
  );
}
