import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { SiteHeader } from '@/components/SiteHeader';
import { StateCard } from '@/components/StateCard';
import { LiveRun, type RunFilm } from '@/components/LiveRun';
import { readDemoFilms, readDemoRun } from '@/lib/demo-lookup';
import { runInLibrary, type GuideScene } from '@/lib/demo';
import { getFilmScenes } from '@/lib/queries';
import { ADD, DEMO_LIVE } from '@/lib/copy';
import styles from '@/components/Watch.module.css';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Live run — Tiny Viewers',
  description: DEMO_LIVE.intro,
};

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ film?: string | string[] }>;
};

/**
 * One live run. The run itself is polled by the page (`LiveRun`); the server renders its state as it
 * stands, so a reload mid-run lands on the same board and a finished run needs no JavaScript to read.
 *
 * The film is the one the run names (`run.slug`); its title and library facts come from the run, then
 * from the list of films Jev can check. The address's `?film=` is used only when an older API names no
 * film, and never overrides the run.
 */
export default async function WatchRunPage({ params, searchParams }: Props) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const [lookup, films] = await Promise.all([readDemoRun(id), readDemoFilms()]);
  if (lookup.kind === 'missing') notFound();

  if (lookup.kind === 'unreachable') {
    return (
      <div className="page">
        <SiteHeader current="/watch" />
        <main className={`frame ${styles.main}`}>
          <StateCard as="h1" headline={ADD.jobUnreachableHeadline} body={ADD.jobUnreachableBody}>
            {/* A bare anchor: asking again has to be a fresh request to this same URL. */}
            <a href={`/watch/run/${encodeURIComponent(id)}`} className="button">
              {ADD.jobUnreachableRetry}
            </a>
          </StateCard>
        </main>
      </div>
    );
  }

  const { run } = lookup;
  // The run names its own film, and that is authoritative: the address's `?film=` is only a fallback for
  // an API too old to say (it can never relabel a run as another film's).
  const querySlug = Array.isArray(query.film) ? query.film[0] : query.film;
  const slug = run.slug ?? run.film?.slug ?? querySlug ?? null;
  const listed = slug ? films?.find((f) => f.slug === slug) ?? null : null;
  const librarySlug = run.film?.library_slug ?? listed?.library_slug ?? (listed?.in_library ? listed.slug : null);
  const film: RunFilm = {
    slug,
    librarySlug,
    title: run.film?.title ?? listed?.title ?? null,
    year: run.film?.year ?? listed?.year ?? null,
    // Known only when someone said: the run itself (at its end, or now), else the films list. Unknown is
    // null, and the page says "comparison unavailable", never "not in the library".
    inLibrary: runInLibrary(run, listed),
    sceneCount: listed?.scene_count ?? (run.scenes.length || null),
  };
  // The saved guide's scenes, so a finished check can say WHICH scenes differ from it, not only how
  // many (the API sends counts). Read as the page opens; the page names scenes only while matching them
  // gives the API's own counts, so a guide rebuilt since then falls back to the counts.
  const guide = librarySlug ? await readGuide(librarySlug) : null;

  return (
    <div className="page">
      <SiteHeader current="/watch" />
      <main className={`frame ${styles.main}`}>
        <LiveRun id={id} initialRun={run} film={film} guide={guide} />
      </main>
    </div>
  );
}

/** The library film's scenes, as the comparison names them; null when they could not be read. */
async function readGuide(slug: string): Promise<GuideScene[] | null> {
  try {
    const scenes = await getFilmScenes(slug);
    return scenes.map((s) => ({ id: s.id, start_ms: s.startMs, end_ms: s.endMs, title: s.title || null }));
  } catch {
    return null;
  }
}
