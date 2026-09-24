import { forwardDemoPost } from '@/lib/scene-api';

export const dynamic = 'force-dynamic';

/**
 * Start one live Jev run on any film. 202 with an id is the only success; the refusals — 409 busy,
 * 429 the demo's daily cap or too many runs from one visitor — are passed through unchanged, and
 * counted here per visitor as well as at the API.
 */
export async function POST(request: Request) {
  return forwardDemoPost(request, '/api/demo/runs', { countRuns: true });
}
