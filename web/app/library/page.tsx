import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { SiteHeader } from '@/components/SiteHeader';
import { LibraryShelf } from '@/components/LibraryShelf';
import { StripLegend } from '@/components/Strip';
import { LIBRARY } from '@/lib/copy';
import { listFilms } from '@/lib/queries';
import { soleMatch } from '@/lib/search';
import styles from './library.module.css';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Film library — Tiny Viewers',
  description: LIBRARY.intro,
};

type Props = { searchParams: Promise<{ q?: string | string[] }> };

export default async function LibraryPage({ searchParams }: Props) {
  const [films, params] = await Promise.all([listFilms(), searchParams]);
  const raw = Array.isArray(params.q) ? params.q[0] : params.q;
  const query = (raw ?? '').trim();

  // One answer is not a list: go straight to the scenes. This is what Home's form relies on —
  // it submits here, and a parent who typed a whole title lands on their film, not on a shelf
  // with one card on it. `soleMatch` is the same rule the shelf applies to its own Enter key.
  const one = soleMatch(films, query);
  if (one) redirect(`/film/${one.slug}`);

  return (
    <div className="page">
      <SiteHeader current="/library" />

      <main className={`frame ${styles.main}`}>
        <div className={styles.head}>
          <div className={styles.headText}>
            <h1 className={styles.title}>{LIBRARY.title}</h1>
            <p className={styles.intro}>{LIBRARY.intro}</p>
            <p className={styles.stripNote}>{LIBRARY.stripNote}</p>
          </div>
          <div className={styles.headAside}>
            <StripLegend />
          </div>
        </div>

        {films.length === 0 ? (
          // The shelf has nothing on it at all, which is not the same as a query matching nothing:
          // there is no field to correct and nowhere to send the parent.
          <div className={styles.empty}>
            <h2 className={styles.emptyHeadline}>{LIBRARY.emptyHeadline}</h2>
            <p className={styles.emptyBody}>{LIBRARY.emptyBody}</p>
          </div>
        ) : (
          <LibraryShelf films={films} query={query} />
        )}
      </main>
    </div>
  );
}
