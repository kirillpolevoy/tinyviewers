import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { SiteHeader } from '@/components/SiteHeader';
import { LibraryShelf } from '@/components/LibraryShelf';
import { StateCard } from '@/components/StateCard';
import { LIBRARY } from '@/lib/copy';
import { listFilms } from '@/lib/queries';
import { soleMatch } from '@/lib/search';
import { readJob } from '@/lib/job-lookup';
import { isJobId, type Job } from '@/lib/job';
import styles from './library.module.css';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Film library — Tiny Viewers',
  description: LIBRARY.intro,
  openGraph: { type: 'website', siteName: 'Tiny Viewers', title: 'Film library — Tiny Viewers', description: LIBRARY.intro, url: '/library' },
  twitter: { card: 'summary_large_image', title: 'Film library — Tiny Viewers', description: LIBRARY.intro },
};

type Param = string | string[] | undefined;
type Props = { searchParams: Promise<{ q?: Param; add?: Param; job?: Param }> };

const first = (value: Param) => (Array.isArray(value) ? value[0] : value);

export default async function LibraryPage({ searchParams }: Props) {
  const [films, params] = await Promise.all([listFilms(), searchParams]);
  const query = (first(params.q) ?? '').trim();
  const forceAdd = first(params.add) === '1';
  const jobId = first(params.job) ?? null;

  // One answer is not a list: go straight to the scenes. This is what Home's form relies on — it
  // submits here, and a parent who typed a whole title lands on their film, not on a list with one
  // row in it. `soleMatch` is the same rule the list applies to its own Enter key. Not when the
  // page was asked to add a film or to show a run: those are about something else.
  if (!forceAdd && !jobId) {
    const one = soleMatch(films, query);
    if (one) redirect(`/film/${one.slug}`);
  }

  // `?job=`: an add run, shown live in the library. Read here so a reload lands on the same card.
  let job: Job | null = null;
  let unreachable = false;
  if (jobId && isJobId(jobId)) {
    const lookup = await readJob(jobId);
    if (lookup.kind === 'job') {
      // A run of the retired Jev-screening demo: that page is gone, and /watch is where demos live now.
      if (lookup.job.kind === 'demo') redirect('/watch');
      job = lookup.job;
    } else if (lookup.kind === 'unreachable') {
      unreachable = true;
    }
    // A job that does not exist is not worth a page of its own: the library is still the library.
  }

  return (
    <div className="page">
      <SiteHeader current="/library" />

      <main className={`frame ${styles.main}`}>
        {films.length === 0 && !job && !forceAdd && !query ? (
          // Nothing in the library at all, which is not the same as a query matching nothing. Asked
          // to add a film (or searching for one), an empty library still offers the ask: otherwise
          // a fresh deployment would have no way to add its first film.
          <StateCard as="h1" headline={LIBRARY.emptyHeadline} body={LIBRARY.emptyBody} />
        ) : (
          // Not keyed by the run: finishing one replaces the URL with plain /library and refreshes,
          // and a key that changed with it would remount the list mid-arrival and forget the film it
          // was waiting for. A link to another run arrives as a new `initialJob`, handled inside.
          <LibraryShelf
            films={films}
            query={query}
            initialJob={job}
            unreachableJobId={unreachable ? jobId : null}
          />
        )}
      </main>
    </div>
  );
}
