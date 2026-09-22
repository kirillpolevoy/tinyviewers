import Link from 'next/link';
import { SiteHeader } from '@/components/SiteHeader';
import { ArrowRight } from '@/components/Art';
import { WATCH } from '@/lib/copy';
import styles from './WatchPlaceholder.module.css';

type Props = {
  /** When a film is known: the one this page will replay. */
  film?: { title: string; slug: string } | null;
  /** A title the parent typed that is not on the shelf. */
  requested?: string | null;
};

/**
 * Phase 2 lives here: the recorded analysis, in the dark instrument register the design gives it.
 * Phase 1 says so plainly and shows no numbers at all — a fabricated counter would be the one thing
 * this page must never do.
 */
export function WatchPlaceholder({ film = null, requested = null }: Props) {
  return (
    <div className={`page darkPage ${styles.page}`}>
      <SiteHeader current="/watch" tone="dark" />

      <main className={`frame ${styles.main}`}>
        <div className={styles.head}>
          <h1 className={styles.headline}>{WATCH.headline}</h1>
          <svg
            className={styles.rule}
            viewBox="0 0 460 14"
            preserveAspectRatio="none"
            fill="none"
            aria-hidden="true"
            focusable="false"
          >
            <path
              d="M4 9c76-7 152 5 228-1 76-6 152 3 224-3"
              stroke="var(--coral)"
              strokeWidth="5"
              strokeLinecap="round"
            />
          </svg>
        </div>

        <div className={styles.panel}>
          {film && <p className={styles.panelFilm}>{film.title}</p>}
          {requested && !film && (
            <p className={styles.panelFilm}>
              You asked about “{requested}”. It is not on the shelf yet.
            </p>
          )}
          <p className={styles.coming}>{WATCH.comingLine}</p>
          <div className={styles.actions}>
            {film ? (
              <Link href={`/film/${film.slug}`} className={`button ${styles.button}`}>
                {WATCH.toFilmList}
                <ArrowRight />
              </Link>
            ) : (
              <Link href="/library" className={`button ${styles.button}`}>
                {WATCH.backToLibrary}
                <ArrowRight />
              </Link>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
