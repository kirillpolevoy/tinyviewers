import { forwardAddPost } from '@/lib/scene-api';

export const dynamic = 'force-dynamic';

/**
 * Start one analysis. 202 with an id is the only success; every refusal is a status with a code —
 * 401 the passcode, 409 already on the shelf or already running, 429 the day's cap or too many
 * wrong passcodes from one address — and the client has a sentence for each. All of them are passed
 * through unchanged.
 */
export async function POST(request: Request) {
  return forwardAddPost(request, '/api/add/jobs');
}
