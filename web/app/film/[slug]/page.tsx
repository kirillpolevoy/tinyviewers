import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { SiteHeader } from '@/components/SiteHeader';
import { SceneList } from '@/components/SceneList';
import { AgeToggle, FilterPanel, LevelsDisclosure } from '@/components/FilmControls';
import { Strip } from '@/components/Strip';
import { Poster } from '@/components/Poster';
import { WaveRule } from '@/components/Art';
import { EMPTY, FILM } from '@/lib/copy';
import { getFilm, getFilmScenes } from '@/lib/queries';
import { filmHref, filmPageModel, formatTime } from '@/lib/scenes';
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

export default async function FilmPage({ params, searchParams }: Props) {
  const { slug } = await params;
  const [film, allScenes, query] = await Promise.all([
    getFilm(slug),
    getFilmScenes(slug),
    searchParams,
  ]);
  if (!film) notFound();

  // Every derivation the page makes from its scenes and its query string, in one tested function.
  const { band, presence, events, selected, scenes, matching, strongest, lastEnd } =
    filmPageModel(allScenes, query);
  const durationMs = Math.max(film.durationMs, lastEnd);

  return (
    <div className="page">
      <SiteHeader />

      <main className={`frame ${styles.main}`}>
        <div className={styles.head}>
          <div className={styles.headText}>
            <h1 className={styles.title}>
              {film.title}
              {film.year && <span className={styles.year}>{film.year}</span>}
            </h1>
            {/* The film's own synopsis, from TMDB, so a parent knows they are on the right film
                before reading a word about its scenes. Null for a film TMDB has no words for, and
                then the header is the title alone: an empty paragraph is not a synopsis. */}
            {film.overview && <p className={styles.overview}>{film.overview}</p>}
          </div>
          <Poster
            url={film.posterUrl}
            title={film.title}
            width={92}
            height={130}
            priority
            className={styles.filmPoster}
          />
        </div>

        <div className={styles.controls}>
          <AgeToggle slug={film.slug} band={band} selected={selected} />
          <LevelsDisclosure />
        </div>

        {allScenes.length > 0 && (
          <div className={styles.timeline}>
            <Strip
              variant="timeline"
              markers={allScenes.map((s) => ({
                startMs: s.startMs,
                severity57: s.severity57,
                severity810: s.severity810,
                matches: matching.has(s.id),
              }))}
              durationMs={durationMs}
              band={band}
              summary={`Where the ${allScenes.length} scenes sit across ${film.title}, tallest where strongest for ages ${band === '8-10' ? '8 to 10' : '5 to 7'}.`}
            />
            <p className={styles.timelineNote}>
              <b>{allScenes.length} scenes</b>
              {strongest > 0 && <> · {strongest} at very strong</>} · up to {formatTime(lastEnd)}
              {selected.length > 0 && <> · {scenes.length} match your filters</>}
            </p>
          </div>
        )}

        {/* Above the list, not under it: a parent narrows the list and then reads it, so the
            control comes before the thing it changes — and on a long film the panel is no longer
            a scroll away from the scenes it filters. */}
        {allScenes.length > 0 && (
          <FilterPanel
            slug={film.slug}
            band={band}
            presence={presence}
            events={events}
            selected={selected}
            shown={scenes.length}
            total={allScenes.length}
          />
        )}

        <h2 className={styles.listHeading}>{FILM.listHeading}</h2>

        {allScenes.length === 0 ? (
          <div className={styles.state}>
            <h3 className={styles.stateHeadline}>{EMPTY.noScenesHeadline}</h3>
            <p className={styles.stateBody}>{EMPTY.noScenesBody}</p>
          </div>
        ) : scenes.length === 0 ? (
          <div className={styles.state}>
            <h3 className={styles.stateHeadline}>{EMPTY.noMatchesHeadline}</h3>
            <p className={styles.stateBody}>{EMPTY.noMatchesBody}</p>
            <Link href={filmHref(film.slug, { band, selected: [] })} className="button buttonQuiet">
              {FILM.clearFilters}
            </Link>
          </div>
        ) : (
          <SceneList scenes={scenes} band={band} />
        )}

        <div className={styles.foot}>
          <Link href={`/watch/${film.slug}`} className={styles.footLink}>
            {FILM.crossLink}
          </Link>
          <span className={styles.footNote}>
            <WaveRule />
            {FILM.crossLinkNote}
          </span>
        </div>
      </main>
    </div>
  );
}
