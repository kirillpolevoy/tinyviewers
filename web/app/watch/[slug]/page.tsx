import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { WatchPlaceholder } from '@/components/WatchPlaceholder';
import { getFilm } from '@/lib/queries';
import { WATCH } from '@/lib/copy';

export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const film = await getFilm(slug);
  return {
    title: film ? `How ${film.title} was worked out — Tiny Viewers` : 'Watch it work — Tiny Viewers',
    description: WATCH.comingLine,
  };
}

/** One film's recorded analysis. Phase 2; the page exists now so the film page's link is real. */
export default async function WatchFilmPage({ params }: Props) {
  const { slug } = await params;
  const film = await getFilm(slug);
  if (!film) notFound();
  return <WatchPlaceholder film={{ title: film.title, slug: film.slug }} />;
}
