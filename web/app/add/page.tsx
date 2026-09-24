import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

type Props = { searchParams: Promise<{ film?: string | string[] }> };

/**
 * Adding a movie lives inside the library now: a search that misses becomes the ask. This route
 * stays so old links work, and carries the title it was given.
 */
export default async function AddPage({ searchParams }: Props) {
  const params = await searchParams;
  const film = ((Array.isArray(params.film) ? params.film[0] : params.film) ?? '').trim();
  const qs = new URLSearchParams({ add: '1' });
  if (film) qs.set('q', film);
  redirect(`/library?${qs.toString()}`);
}
