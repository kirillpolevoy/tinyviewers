import Link from 'next/link';
import { SiteHeader } from '@/components/SiteHeader';
import { SearchForm } from '@/components/SearchForm';
import { PeekCard } from '@/components/PeekCard';
import { FinUnderline, SeaFloor } from '@/components/Art';
import { HOME, WATCH_LINKED } from '@/lib/copy';
import { getShowcase, listFilms } from '@/lib/queries';
import styles from './home.module.css';

// The peek card is real rows from the real database, so Home cannot drift away from what a film
// page will say.
export const dynamic = 'force-dynamic';

/**
 * Proof first: the search, and beside it the answer a parent gets. Everything else is one quiet
 * row of links under it.
 */
export default async function HomePage() {
  // listFilms first, then hand the same list to getShowcase: with React's cache() around both, Home
  // costs three statements in total (films, the showcase lookup, that film's scenes).
  const films = await listFilms();
  const showcase = await getShowcase(films);

  return (
    <div className={`page ${styles.page}`}>
      <SiteHeader />

      <main className={styles.main}>
        <section className={`frame ${styles.hero}`} aria-labelledby="home-headline">
          <div className={styles.heroText}>
            <p className="eyebrow">{HOME.eyebrow}</p>

            <h1 id="home-headline" className={styles.headline}>
              <span className={styles.headlineLine}>
                {HOME.headlineLine1Before}
                <em className={styles.circled}>{HOME.headlineEmphasis}</em>
                {HOME.headlineLine1After}
              </span>
              <span className={styles.headlineLine}>
                {HOME.headlineLine2}
                <FinUnderline className={styles.fin} />
              </span>
            </h1>

            <div className={styles.searchWrap}>
              <SearchForm
                id="home-search"
                size="hero"
                label={HOME.searchLabel}
                placeholder={HOME.searchPlaceholder}
                button={HOME.searchButton}
              />
              <p className={styles.valueLine}>{HOME.valueLine}</p>
            </div>
          </div>

          {showcase && (
            <div className={styles.heroArt}>
              <PeekCard title={showcase.title} sceneCount={showcase.sceneCount} scenes={showcase.scenes} />
            </div>
          )}
        </section>

        <nav className={`frame ${styles.links}`} aria-label="More">
          <Link href="/library" className={styles.link}>
            {HOME.browseLink}
          </Link>
          {/* `WATCH_LINKED` in lib/copy.ts puts this and the nav entry in front of everyone, or takes both away. */}
          {WATCH_LINKED && (
            <Link href="/watch" className={styles.link}>
              {HOME.watchLink}
            </Link>
          )}
        </nav>
      </main>

      <SeaFloor className={styles.seafloor} />
    </div>
  );
}
