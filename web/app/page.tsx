import Link from 'next/link';
import Image from 'next/image';
import { SiteHeader } from '@/components/SiteHeader';
import { SearchForm } from '@/components/SearchForm';
import { Strip } from '@/components/Strip';
import {
  Bubbles,
  Clownfish,
  CurvedArrow,
  FinUnderline,
  Lure,
  SeaFloor,
  ArrowRight,
} from '@/components/Art';
import { HOME } from '@/lib/copy';
import { getLibraryTotals, getShowcase, listFilms } from '@/lib/queries';
import { DEFAULT_BAND, formatTime, severityFor, strengthLabel } from '@/lib/scenes';
import styles from './home.module.css';

// The shelf and the peek card are real rows from the real database, so Home cannot drift away from
// what a film page will say.
export const dynamic = 'force-dynamic';

const SHELF_TONES = ['sky', 'butter', 'mint', 'lilac', 'blush', 'sky'] as const;
const SHELF_TILTS = ['-3deg', '2deg', '-1.5deg', '3deg', '-2.5deg', '1.5deg'] as const;

export default async function HomePage() {
  // listFilms first, then hand the same list to getShowcase: with React's cache() around both, Home
  // costs four statements in total (films, the shark lookup, that film's scenes, the totals).
  const films = await listFilms();
  const [showcase, totals] = await Promise.all([getShowcase(films), getLibraryTotals()]);
  const shelf = films.slice(0, 6);

  return (
    <div className="page">
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

            <p className={styles.subhead}>{HOME.subhead}</p>

            <div className={styles.searchWrap}>
              <SearchForm
                id="home-search"
                size="hero"
                label={HOME.searchLabel}
                placeholder={HOME.searchPlaceholder}
                button={HOME.searchButton}
              />
            </div>
          </div>

          {showcase && (
            <div className={styles.heroArt}>
              <Lure className={styles.lure} />

              <div className={styles.peek}>
                <div className={styles.peekHead}>
                  <span className={styles.peekTitle}>{showcase.title}</span>
                  <span className={styles.peekCount}>{showcase.sceneCount} scenes</span>
                </div>
                {showcase.scenes.map((scene) => {
                  const highlight = scene.tags.some((tag) => tag.id === 'shark');
                  return (
                    <div
                      key={scene.id}
                      className={`${styles.peekRow} ${highlight ? styles.peekRowMark : ''}`}
                    >
                      <div className={styles.peekRowTop}>
                        <span className={`tabular ${styles.peekRange}`}>
                          {formatTime(scene.startMs)}–{formatTime(scene.endMs)}
                        </span>
                        <span className={styles.peekStrength}>
                          {strengthLabel(severityFor(scene, DEFAULT_BAND)) ?? 'Not checked'}
                        </span>
                      </div>
                      <span className={styles.peekSceneTitle}>{scene.title}</span>
                      <span className={styles.peekTags}>
                        {scene.tags.map((tag) => tag.label).join(' · ')}
                      </span>
                    </div>
                  );
                })}
              </div>

              {showcase.hasShark && (
                <p className={styles.peekCaption}>
                  <CurvedArrow className={styles.peekArrow} />
                  <span>{HOME.peekCaption}</span>
                </p>
              )}

              <Clownfish className={styles.clownfish} />
            </div>
          )}
        </section>

        <section className={`frame ${styles.shelfSection}`} aria-labelledby="shelf-heading">
          <h2 id="shelf-heading" className={styles.shelfHeading}>
            {HOME.libraryInvitationLead}{' '}
            <Link href="/library" className={styles.shelfLink}>
              {HOME.libraryInvitationLink}
            </Link>
          </h2>

          <ul className={styles.shelf}>
            {shelf.map((film, i) => (
              <li key={film.slug} className={styles.shelfItem} style={{ transform: `rotate(${SHELF_TILTS[i]})` }}>
                <Link href={`/film/${film.slug}`} className={styles.shelfCard}>
                  <span className={`${styles.shelfPoster} ${styles[SHELF_TONES[i]]}`}>
                    {film.posterUrl ? (
                      // A real element rather than a CSS background, so the host allowlist in
                      // next.config.mjs applies to it and the file is served at the size drawn.
                      <Image
                        className={styles.shelfImage}
                        src={film.posterUrl}
                        alt=""
                        width={116}
                        height={158}
                        sizes="116px"
                      />
                    ) : (
                      <span className={styles.shelfPosterWord}>poster</span>
                    )}
                  </span>
                  <span className={styles.shelfTitle}>{film.title}</span>
                  <span className={styles.shelfScenes}>{film.sceneCount} scenes</span>
                </Link>
              </li>
            ))}
            <li className={styles.shelfBubbles} aria-hidden="true">
              <Bubbles />
            </li>
          </ul>

          <p className={styles.signOff}>{HOME.shelfSignOff}</p>
        </section>

        <section className={styles.bandSection} aria-labelledby="band-heading">
          <div className={`frame ${styles.bandFrame}`}>
            <div className={`dark ${styles.band}`}>
              <div className={styles.bandText}>
                <h2 id="band-heading" className={styles.bandHeadline}>
                  {HOME.bandHeadline}
                </h2>
                <p className={styles.bandBody}>{HOME.bandBody}</p>
                <Link href="/watch" className={`button ${styles.bandButton}`}>
                  {HOME.bandButton}
                  <ArrowRight />
                </Link>
              </div>

              <div className={styles.bandInstrument}>
                <dl className={styles.readouts}>
                  <div className={styles.readout}>
                    <dt>Films on the shelf</dt>
                    <dd className="tabular">{totals.films}</dd>
                  </div>
                  <div className={styles.readout}>
                    <dt>Scenes flagged</dt>
                    <dd className="tabular">{totals.scenes}</dd>
                  </div>
                  <div className={styles.readout}>
                    <dt>At very strong</dt>
                    <dd className="tabular">{totals.strongest}</dd>
                  </div>
                </dl>
                {showcase && (
                  <div className={styles.bandStrip}>
                    <Strip
                      markers={showcase.markers}
                      durationMs={showcase.durationMs}
                      band={DEFAULT_BAND}
                      summary={`Where the scenes sit in ${showcase.title}: ${showcase.sceneCount} of them, in time order.`}
                    />
                    <p className={styles.bandStripNote}>
                      {showcase.title} · {showcase.sceneCount} scenes in time order
                    </p>
                  </div>
                )}
              </div>
            </div>
          </div>
        </section>
      </main>

      <SeaFloor className={styles.seafloor} />
    </div>
  );
}
