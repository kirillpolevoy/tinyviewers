import { forwardToSceneApi } from '@/lib/scene-api';
import { isJobId } from '@/lib/job';

export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ id: string }> };

/**
 * One live demo run as it stands. Polled by /watch/run/[id] until it is done or failed, so it is
 * never cached, and the id is checked before it becomes part of a path this app forwards.
 */
export async function GET(request: Request, { params }: Context) {
  const { id } = await params;
  if (!isJobId(id)) {
    return new Response(JSON.stringify({ error_code: 'bad_request' }), {
      status: 400,
      headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
    });
  }
  return forwardToSceneApi(`/api/demo/runs/${id}`, { signal: request.signal });
}
