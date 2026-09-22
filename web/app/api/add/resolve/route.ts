import { forwardAddPost } from '@/lib/scene-api';

export const dynamic = 'force-dynamic';

/**
 * Longer than any other route in this app, because the work behind it is longer: a TMDB search plus
 * up to three sequential detail lookups, each with its own eight-second deadline upstream. The
 * proxy allows 30 s (`RESOLVE_TIMEOUT_MS`); the function has to outlive that or the platform kills
 * it before it can answer, so this is that number plus room to write the reply.
 */
export const maxDuration = 35;

/**
 * "Which film did you mean?" — a title or an IMDb link plus the passcode, in, up to three
 * candidates out. The body is forwarded unread: it carries the passcode, and this app has no
 * business knowing what is in it.
 */
export async function POST(request: Request) {
  return forwardAddPost(request, '/api/add/resolve');
}
