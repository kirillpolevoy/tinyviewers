import { forwardDemoPost } from '@/lib/scene-api';

export const dynamic = 'force-dynamic';

/** Same allowance as /api/add/resolve: the same TMDB lookups sit behind it. */
export const maxDuration = 35;

/** A title or an IMDb link in, up to three films out. No passcode; the API limits lookups per client. */
export async function POST(request: Request) {
  return forwardDemoPost(request, '/api/demo/resolve');
}
