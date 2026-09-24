import { forwardToSceneApi } from '@/lib/scene-api';

export const dynamic = 'force-dynamic';

/** Whether a live demo run can start right now, straight from the scene API. */
export async function GET(request: Request) {
  return forwardToSceneApi('/api/demo/status', { signal: request.signal });
}
