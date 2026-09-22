import { getReplay } from '@/lib/queries';

export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ slug: string }> };

const json = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });

/**
 * One finished film's recorded run, for the live job page to finish with.
 *
 * The job page gets its recording from the scene API the moment Jev's pass ends — which is minutes
 * before the excerpts exist, so the lines under each flagged beat are missing and the job's own
 * copy of them is nulled out once the run reaches `done`. The lines are in this app's own database
 * by then, in the same `recordings` row `/watch/[slug]` reads, so the page asks once and merges
 * them in (`withLines`).
 *
 * It answers with the reduced payload rather than the raw row for the reason `getReplay` exists at
 * all: the row is about a megabyte and the browser needs a seventh of it. Nothing here is new
 * machinery — it is the reader `/watch/[slug]` already uses, behind the route the client can reach.
 *
 * A film with no recording is `{ payload: null }` and a 200, not a 404: "there is nothing recorded
 * for this film" is an answer, and the caller stops asking on it.
 */
export async function GET(_request: Request, { params }: Context) {
  const { slug } = await params;
  // Same shape rule as the job routes: this string came out of a URL and is about to become a
  // query parameter, so it is checked before it is used rather than trusted because it is short.
  if (!/^[\w-]{1,120}$/.test(slug)) return json({ error_code: 'bad_request' }, 400);

  try {
    return json({ payload: await getReplay(slug) }, 200);
  } catch {
    // The database is the database's problem; the page simply keeps the lines it has.
    return json({ error_code: 'unreachable' }, 502);
  }
}
