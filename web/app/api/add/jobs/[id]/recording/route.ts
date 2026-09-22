import { forwardToSceneApi } from '@/lib/scene-api';
import { isJobId } from '@/lib/job';

export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ id: string }> };

/**
 * The Jev recording for one job: about a megabyte, asked for once.
 *
 * It is its own endpoint precisely because of that size — the job itself is polled every 1.5 s and
 * has no business carrying this. Until the jev stage ends the scene API answers 404 `no_recording`,
 * which is a normal answer here rather than an error: the page simply asks again on the next poll.
 * Same id rule as every other job route, for the same reason.
 */
export async function GET(request: Request, { params }: Context) {
  const { id } = await params;
  if (!isJobId(id)) {
    return new Response(JSON.stringify({ error_code: 'bad_request' }), {
      status: 400,
      headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
    });
  }
  return forwardToSceneApi(`/api/add/jobs/${id}/recording`, { signal: request.signal });
}
