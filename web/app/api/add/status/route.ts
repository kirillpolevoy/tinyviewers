import { forwardToSceneApi } from '@/lib/scene-api';

// Never prerendered, never cached: the answer is "what is happening right now".
export const dynamic = 'force-dynamic';

/** `{ running, spent_today_usd, cap_usd, passcode_configured }`, straight from the scene API. */
export async function GET(request: Request) {
  return forwardToSceneApi('/api/add/status', { signal: request.signal });
}
