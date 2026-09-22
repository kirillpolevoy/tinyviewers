import type { Metadata } from 'next';
import { WatchPlaceholder } from '@/components/WatchPlaceholder';
import { listFilms } from '@/lib/queries';
import { soleMatch } from '@/lib/search';
import { WATCH } from '@/lib/copy';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Watch it work — Tiny Viewers',
  description: WATCH.comingLine,
};

type Props = { searchParams: Promise<{ film?: string | string[] }> };

/**
 * Reached from the Home band, the navigation, and the "not on our shelf" state, which arrives with
 * ?film=<what the parent typed>. If that title turns out to be on the shelf after all, point at its
 * scene list rather than pretending it is unknown.
 */
export default async function WatchPage({ searchParams }: Props) {
  const params = await searchParams;
  const raw = Array.isArray(params.film) ? params.film[0] : params.film;
  const requested = (raw ?? '').trim();
  // The same rule the library uses to decide whether a query names one film, so a title that
  // opens its scene guide from the shelf is recognised here too.
  const film = requested ? soleMatch(await listFilms(), requested) : null;

  return (
    <WatchPlaceholder
      film={film ? { title: film.title, slug: film.slug } : null}
      requested={requested || null}
    />
  );
}
