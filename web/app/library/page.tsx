import Link from 'next/link';
import type { Metadata } from 'next';
import { SiteHeader } from '@/components/SiteHeader';
import { SearchForm } from '@/components/SearchForm';
import { Poster } from '@/components/Poster';
import { Strip, StripLegend } from '@/components/Strip';
import { LIBRARY, SEARCH } from '@/lib/copy';
import { listFilms } from '@/lib/queries';
import { DEFAULT_BAND } from '@/lib/scenes';
import styles from './library.module.css';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Film library — Tiny Viewers',
  description: LIBRARY.intro,
};

export default async function LibraryPage() {
  const films = await listFilms();

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
            <SearchForm
              id="library-search"
              label={SEARCH.fieldLabel}
              placeholder={SEARCH.placeholder}
              button={SEARCH.button}
            />
          </div>
        </div>

        {films.length === 0 ? (
          <div className={styles.empty}>
            <h2 className={styles.emptyHeadline}>{LIBRARY.emptyHeadline}</h2>
            <p className={styles.emptyBody}>{LIBRARY.emptyBody}</p>
            <Link href="/search" className="button buttonQuiet">
              {LIBRARY.emptyAction}
            </Link>
          </div>
        ) : (
          <ul className={styles.grid}>
            {films.map((film) => {
              const strongest = film.markers.filter((m) => m.severity57 === 3).length;
              return (
                <li key={film.slug}>
                  <Link href={`/film/${film.slug}`} className={styles.card}>
                    <Poster
                      url={film.posterUrl}
                      title={film.title}
                      width={300}
                      height={200}
                      className={styles.cardPoster}
                    />
                    <span className={styles.cardTitleRow}>
                      <span className={styles.cardTitle}>{film.title}</span>
                      {film.year && <span className={styles.cardYear}>{film.year}</span>}
                    </span>
                    <span className={styles.cardFacts}>
                      <b>{film.sceneCount} scenes flagged</b>
                      {strongest > 0 && <> · {strongest} at very strong</>}
                    </span>
                    {/* Decorative: the counts above it already say this in words, and the card
                        is one link whose name must stay short. */}
                    <Strip
                      markers={film.markers}
                      durationMs={film.durationMs}
                      band={DEFAULT_BAND}
                      decorative
                    />
                    <span className={styles.cardFoot}>
                      <span className={styles.cardMicro}>{LIBRARY.cardMicrocopy}</span>
                      <span className={styles.cardAction}>{LIBRARY.cardAction} →</span>
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </main>
    </div>
  );
}
