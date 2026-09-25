import { forwardToSceneApi } from '@/lib/scene-api';

export const dynamic = 'force-dynamic';

/** The films Jev can run on live: those whose Sonnet reading is stored. Straight from the scene API. */
export async function GET(request: Request) {
  return forwardToSceneApi('/api/demo/films', { signal: request.signal });
}
