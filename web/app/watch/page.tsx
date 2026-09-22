import type { Metadata } from 'next';
import { WatchPlaceholder } from '@/components/WatchPlaceholder';
import { searchFilmsByName } from '@/lib/queries';
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
  const { films, exact } = requested
    ? await searchFilmsByName(requested)
    : { films: [], exact: null };
  const film = exact ?? (films.length === 1 ? films[0] : null);

  return (
    <WatchPlaceholder
      film={film ? { title: film.title, slug: film.slug } : null}
      requested={requested || null}
    />
  );
}
