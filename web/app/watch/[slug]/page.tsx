import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { WatchShell } from '@/components/WatchShell';
import { RunReplay } from '@/components/RunReplay';
import { SceneList } from '@/components/SceneList';
import { ArrowRight } from '@/components/Art';
import { getFilm, getFilmScenes, getReplay } from '@/lib/queries';
import { DEFAULT_BAND } from '@/lib/scenes';
import { WATCH } from '@/lib/copy';
import styles from './replay.module.css';

export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const film = await getFilm(slug);
  return {
    title: film ? `${film.title}, a recorded run — Tiny Viewers` : 'Watch it work — Tiny Viewers',
    description: WATCH.intro,
  };
}

/**
 * One film's recorded analysis, replayed — the fallback for a day whose live-run budget is spent.
 * Every other run on /watch is live, so this page says plainly, twice, that it is a recording: in
 * the headline and in the lead, with the date the run happened.
 *
 * Three reads, all of them the same rows every other page uses: the film, its recorded run reduced
 * to a replay payload, and its scenes. The scenes go down to the client component as children so
 * they are in the server's HTML — the run is an animation, the scene list is the point, and the
 * point does not wait for JavaScript.
 */
export default async function WatchFilmPage({ params }: Props) {
  const { slug } = await params;
  const [film, payload, scenes] = await Promise.all([
    getFilm(slug),
    getReplay(slug),
    getFilmScenes(slug),
  ]);
  if (!film) notFound();

  const headline = (
    <>
      {film.title}
      {film.year && <span className={styles.year}>{film.year}</span>}
      <span className={styles.recorded}>{WATCH.recordedEyebrow}</span>
    </>
  );

  if (!payload) {
    return (
      <WatchShell headline={headline} lead={WATCH.noRecording}>
        <div className={styles.actions}>
          <Link href={`/film/${film.slug}`} className={`button ${styles.button}`}>
            {WATCH.toFilmList}
            <ArrowRight />
          </Link>
          <Link href="/watch" className={styles.quietLink}>
            {WATCH.backToRuns}
          </Link>
        </div>
      </WatchShell>
    );
  }

  const recordedOn = new Date(payload.meta.startedAt).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });

  return (
    <WatchShell headline={headline} lead={WATCH.recordedLead(recordedOn)}>
      <RunReplay payload={payload}>
        {/* The scene list is the parent-facing artifact, so it keeps the parent-facing register:
            a light sheet inside the dark instrument, styled by the same component the film page
            uses rather than a dark copy of it that could drift. */}
        <section className={styles.scenes} aria-labelledby="scenes-heading">
          <h2 id="scenes-heading" className={styles.scenesHeading}>
            {WATCH.scenesHeading}
          </h2>
          <p className={styles.scenesNote}>{WATCH.scenesNote}</p>
          {scenes.length === 0 ? (
            <p className={styles.scenesNote}>{WATCH.noScenesYet}</p>
          ) : (
            <SceneList scenes={scenes} band={DEFAULT_BAND} />
          )}
          <div className={styles.actions}>
            <Link href={`/film/${film.slug}`} className={`button ${styles.button}`}>
              {WATCH.toFilmList}
              <ArrowRight />
            </Link>
            <Link href="/watch" className={styles.sheetLink}>
              {WATCH.backToRuns}
            </Link>
          </div>
        </section>
      </RunReplay>
    </WatchShell>
  );
}
