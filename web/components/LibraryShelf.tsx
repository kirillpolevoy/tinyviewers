'use client';

import { useMemo, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Poster } from './Poster';
import { Strip } from './Strip';
import { ArrowRight, SearchIcon } from './Art';
import { LIBRARY, SEARCH, libraryCount } from '@/lib/copy';
import { matchFilms, soleMatch } from '@/lib/search';
import { DEFAULT_BAND } from '@/lib/scenes';
import type { FilmSummary } from '@/lib/queries';
import styles from './LibraryShelf.module.css';

type Props = {
  /** Every film, already fetched by the page. The shelf never asks the server for a narrower list. */
  films: FilmSummary[];
  /** `?q=` as the server read it, so the first paint already shows the right films. */
  query: string;
};

/**
 * The library, filtered as a parent types.
 *
 * The whole shelf is six films and it is already on the page, so narrowing it is a filter over an
 * array, not a round trip: there is nothing to wait for and nothing to debounce. The matching is
 * `lib/search.ts` — the same pure rules the server used to decide whether `?q=` names one film —
 * so what the parent sees while typing and what pressing Enter does can never disagree.
 *
 * Without JavaScript the form still submits to /library and the server renders the same filtered
 * shelf. With it, the URL is kept in step through `history.replaceState`, so a refresh or a back
 * button keeps the filter without pushing a history entry per keystroke.
 */
export function LibraryShelf({ films, query: initialQuery }: Props) {
  const router = useRouter();
  const [query, setQuery] = useState(initialQuery);

  const shown = useMemo(
    () => (query.trim() ? matchFilms(films, query).films : films),
    [films, query],
  );

  const onChange = (value: string) => {
    setQuery(value);
    const trimmed = value.trim();
    // replaceState, not push: a filter is not a place you navigate back through letter by letter.
    window.history.replaceState(null, '', trimmed ? `/library?q=${encodeURIComponent(trimmed)}` : '/library');
  };

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    // Enter on a filtered shelf either opens the one film named, or does nothing: reloading the
    // page to show the films already on screen would be a step backwards.
    event.preventDefault();
    const one = soleMatch(films, query);
    if (one) router.push(`/film/${one.slug}`);
  };

  return (
    <>
      <form method="get" action="/library" role="search" className={styles.search} onSubmit={onSubmit}>
        <label className={`eyebrow ${styles.label}`} htmlFor="library-search">
          {SEARCH.fieldLabel}
        </label>
        <span className={styles.field}>
          <SearchIcon className={styles.icon} />
          <input
            id="library-search"
            className={styles.input}
            type="search"
            name="q"
            value={query}
            onChange={(event) => onChange(event.target.value)}
            placeholder={SEARCH.placeholder}
            autoComplete="off"
            enterKeyHint="search"
          />
        </span>
        {/* Sighted parents see the shelf shrink; this says the same thing to a screen reader, and
            it is polite so it waits for a pause in typing rather than interrupting every letter. */}
        <p className={styles.count} aria-live="polite">
          {libraryCount(shown.length, films.length)}
        </p>
      </form>

      {shown.length === 0 ? (
        <section className={styles.nothing} aria-labelledby="nothing-heading">
          <h2 id="nothing-heading" className={styles.nothingHeadline}>
            {SEARCH.noMatchHeadline}
          </h2>
          <p className={styles.nothingBody}>{SEARCH.noMatchBody}</p>
          {/* The way onward from a film we do not have: the add flow lives behind the passcode on
              the analysis page, and carries the title the parent already typed. */}
          <Link href={`/watch?film=${encodeURIComponent(query.trim())}`} className={`button ${styles.nothingAction}`}>
            {SEARCH.noMatchAction}
            <ArrowRight />
          </Link>
        </section>
      ) : (
        <ul className={styles.grid}>
          {shown.map((film) => {
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
    </>
  );
}
