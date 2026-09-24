import { forwardAddPost } from '@/lib/scene-api';

export const dynamic = 'force-dynamic';

/**
 * Carry a finished demo run on into the library. Passcoded, so it is the same forwarder as the other
 * two add POSTs: throttled after ten wrong passcodes, size-limited, attributed, and counted.
 */
export async function POST(request: Request) {
  return forwardAddPost(request, '/api/add/finish');
}
