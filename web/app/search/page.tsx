import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { SiteHeader } from '@/components/SiteHeader';
import { SearchForm } from '@/components/SearchForm';
import { Poster } from '@/components/Poster';
import { ArrowRight, WaveRule } from '@/components/Art';
import { SEARCH } from '@/lib/copy';
import { searchFilmsByName } from '@/lib/queries';
import styles from './search.module.css';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Find tonight’s film — Tiny Viewers',
};

type Props = { searchParams: Promise<{ q?: string | string[] }> };

export default async function SearchPage({ searchParams }: Props) {
  const params = await searchParams;
  const raw = Array.isArray(params.q) ? params.q[0] : params.q;
  const query = (raw ?? '').trim();

  const { films, exact } = query ? await searchFilmsByName(query) : { films: [], exact: null };

  // One answer is not a list: go straight to the scenes. An exact title wins over a longer list.
  if (query && (films.length === 1 || exact)) {
    redirect(`/film/${(exact ?? films[0]).slug}`);
  }

  return (
    <div className="page">
      <SiteHeader current="/search" />

      <main className={`frame ${styles.main}`}>
        <h1 className={styles.title}>{SEARCH.title}</h1>

        <div className={styles.formWrap}>
          <SearchForm
            id="search-field"
            label={SEARCH.fieldLabel}
            placeholder={SEARCH.placeholder}
            button={SEARCH.button}
            defaultValue={query}
          />
        </div>

        {!raw && <p className={styles.prompt}>{SEARCH.prompt}</p>}
        {raw !== undefined && !query && <p className={styles.prompt}>{SEARCH.emptySubmission}</p>}

        {query && films.length > 1 && (
          <section className={styles.results} aria-labelledby="results-heading">
            <h2 id="results-heading" className={styles.resultsHeading}>
              {SEARCH.resultsHeading}
            </h2>
            <p className={styles.resultsInstruction}>{SEARCH.resultsInstruction}</p>
            <ul className={styles.list}>
              {films.map((film) => (
                <li key={film.slug}>
                  <Link href={`/film/${film.slug}`} className={styles.result}>
                    <Poster
                      url={film.posterUrl}
                      title={film.title}
                      width={74}
                      height={104}
                      className={styles.resultPoster}
                    />
                    <span className={styles.resultText}>
                      <span className={styles.resultTitleRow}>
                        <span className={styles.resultTitle}>{film.title}</span>
                        {film.year && <span className={styles.resultYear}>{film.year}</span>}
                      </span>
                      <span className={styles.resultFacts}>{film.sceneCount} scenes flagged</span>
                    </span>
                    <span className={styles.resultGo}>
                      Open it
                      <ArrowRight />
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}

        {query && films.length === 0 && (
          <section className={styles.nothing} aria-labelledby="nothing-heading">
            <div className={styles.nothingArt} aria-hidden="true">
              <svg
                viewBox="0 0 24 24"
                width="54"
                height="54"
                fill="none"
                stroke="var(--ink)"
                strokeWidth="1.7"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <circle cx="11" cy="11" r="6.6" />
                <path d="M16 16l4.6 4.6" />
                <path d="M8.6 11h4.8" />
              </svg>
            </div>
            <h2 id="nothing-heading" className={styles.nothingHeadline}>
              {SEARCH.noMatchHeadline}
            </h2>
            <p className={styles.nothingBody}>{SEARCH.noMatchBody}</p>
            <p className={styles.nothingQuery}>
              Nothing on the shelf matches <b>“{query}”</b>.
            </p>
            <Link
              href={`/watch?film=${encodeURIComponent(query)}`}
              className={`button ${styles.nothingAction}`}
            >
              {SEARCH.noMatchAction}
              <ArrowRight />
            </Link>
            <p className={styles.nothingFoot}>
              <WaveRule />
              <Link href="/library">Browse the library</Link>
            </p>
          </section>
        )}
      </main>
    </div>
  );
}
