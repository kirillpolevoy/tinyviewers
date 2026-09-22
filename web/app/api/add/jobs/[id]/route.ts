import { forwardToSceneApi } from '@/lib/scene-api';
import { isJobId } from '@/lib/job';

export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ id: string }> };

/**
 * One job as it stands. Polled every 1.5 s by the live page until it is done or failed, so it must
 * never be cached and the id must never be anything but an id: it is pasted into a URL, and a path
 * from a stranger's address bar is not a path this app forwards.
 *
 * What it does not carry is the recording — that is `[id]/recording`, asked for once.
 */
export async function GET(request: Request, { params }: Context) {
  const { id } = await params;
  if (!isJobId(id)) {
    return new Response(JSON.stringify({ error_code: 'bad_request' }), {
      status: 400,
      headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
    });
  }
  return forwardToSceneApi(`/api/add/jobs/${id}`, { signal: request.signal });
}
