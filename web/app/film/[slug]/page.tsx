import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { SiteHeader } from '@/components/SiteHeader';
import { Poster } from '@/components/Poster';
import { FilmFindings } from '@/components/FilmFindings';
import { FILM } from '@/lib/copy';
import { getFilm, getFilmScenes } from '@/lib/queries';
import { dedupe, lastSceneEndMs, readBand, readListParam, splitFirstSentence } from '@/lib/scenes';
import styles from './film.module.css';

export const dynamic = 'force-dynamic';

type Props = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ age?: string | string[]; tag?: string | string[] }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const film = await getFilm(slug);
  if (!film) return { title: 'Not found — Tiny Viewers' };
  return {
    title: `${film.title} — every scary or sad scene | Tiny Viewers`,
    description: `Every scary or sad scene in ${film.title}, in time order: when it happens and what is in it.`,
  };
}

/** An IMDb id the loader recorded, as a link. Anything not shaped like one is not linked. */
function imdbHref(id: string | null): string | null {
  return id && /^tt\d{5,10}$/.test(id) ? `https://www.imdb.com/title/${id}/` : null;
}

/**
 * The synopsis. On a wide screen it is shown whole, as designed. On a phone the findings are what the
 * parent came for, so only the first sentence sits above them and the rest is one tap away — the
 * two renderings are swapped by CSS, and the hidden one is `display: none`, so it is never read twice.
 */
function Overview({ text }: { text: string }) {
  const [first, rest] = splitFirstSentence(text);
  return (
    <>
      <p className={`${styles.overview} ${rest ? styles.overviewWide : ''}`}>{text}</p>
      {rest && (
        <details className={styles.overviewPhone}>
          <summary className={styles.overviewSummary}>
            <span className={styles.overview}>{first}</span>{' '}
            <span className={styles.overviewMore}>{FILM.overviewMore}</span>
          </summary>
          <p className={styles.overview}>{rest}</p>
        </details>
      )}
    </>
  );
}

/**
 * Lead with the verdict; let the timeline be the navigation. A poster-and-facts rail, and one
 * content column: title and synopsis, the findings card, the filter, the scene rows.
 */
export default async function FilmPage({ params, searchParams }: Props) {
  const { slug } = await params;
  const [film, scenes, query] = await Promise.all([getFilm(slug), getFilmScenes(slug), searchParams]);
  if (!film) notFound();

  const durationMs = Math.max(film.durationMs, lastSceneEndMs(scenes));
  const imdb = imdbHref(film.imdbId);

  return (
    <div className="page">
      <SiteHeader />

      <main className={`frame ${styles.main}`}>
        <aside className={styles.rail} aria-label="About the film">
          <Poster
            url={film.posterUrl}
            title={film.title}
            width={280}
            height={400}
            priority
            className={styles.poster}
          />
          <dl className={styles.facts}>
            {film.year && (
              <div className={styles.fact}>
                <dt className="eyebrow">{FILM.factYear}</dt>
                <dd>{film.year}</dd>
              </div>
            )}
            {/* No runtime: the only length stored is where the subtitles end, and that is not how
                long the film runs. See FILM.factImdb's neighbour in lib/copy.ts. */}
            {imdb && (
              <div className={styles.fact}>
                <dt className="eyebrow">{FILM.factImdb}</dt>
                <dd>
                  <a href={imdb} target="_blank" rel="noopener noreferrer" className={styles.factLink}>
                    {FILM.imdbLink}
                  </a>
                </dd>
              </div>
            )}
          </dl>
        </aside>

        <div className={styles.head}>
          <h1 className={styles.title}>{film.title}</h1>
          {/* The film's own synopsis, from TMDB, so a parent knows they are on the right film
              before reading a word about its scenes. Null for a film TMDB has no words for, and
              then the header is the title alone: an empty paragraph is not a synopsis. */}
          {film.overview && <Overview text={film.overview} />}
        </div>

        <div className={styles.content}>
          <FilmFindings
            slug={film.slug}
            title={film.title}
            scenes={scenes}
            durationMs={durationMs}
            initialBand={readBand(query.age)}
            initialTags={dedupe(readListParam(query.tag))}
          />

          {/* What the guide is made from and what that cannot see. Plain text, under the list:
              the scenes come first, and this is what a careful parent reads next. */}
          <section className={styles.about} aria-labelledby="about-guide">
            <h2 id="about-guide" className={styles.aboutTitle}>
              {FILM.aboutTitle}
            </h2>
            <p>{FILM.aboutSource}</p>
            <p>{film.hasSoundCaptions ? FILM.aboutLimitCaptions : FILM.aboutLimitSpeechOnly}</p>
            <p>{FILM.aboutTiming(film.releaseLabel)}</p>
            <p>{FILM.aboutAges}</p>
          </section>
        </div>
      </main>
    </div>
  );
}
