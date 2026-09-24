// Talking to the scene API, which the browser is not allowed to talk to.
//
// The CSP says `connect-src 'self'`: a page of this app may only fetch this app. That is not an
// obstacle to work around, it is the reason the add flow has route handlers at all — every request
// the browser makes goes to /api/add/*, this app forwards it server-side, and the answer comes back
// down the same wire. One origin, one policy, nothing to widen.
//
// The other thing that follows from forwarding server-side: the passcode. It travels in a POST body
// over HTTPS, is held in React state for as long as the form is on screen, and is written nowhere
// else — not localStorage, not a query string, not a log line. Which is why nothing in this file
// ever touches a request or response body except to hand it on: `forwardToSceneApi` copies bytes and
// reports status, and its error paths name the endpoint and the failure, never the payload.
//
// No 'server-only' marker here on purpose: there is no secret in this module, and it is plain enough
// to test directly with a fake fetch (see test/scene-api.test.ts). It is server-side because only
// route handlers import it.

/** Long enough for a subtitle search behind it; short enough that a hung API is not a hung page. */
export const SCENE_API_TIMEOUT_MS = 10_000;

/**
 * Except for the title lookup, which is allowed four times as long.
 *
 * `/api/add/resolve` is not one call: behind it the API runs a TMDB search and then up to three
 * detail requests, one after another, each with its own eight-second deadline. Four honest
 * three-second answers already pass ten seconds — so a ten-second proxy would time out on lookups
 * that were going to succeed, and the parent would be told the analyser is not answering when in
 * fact it was still reading. The route that owns this path raises its own `maxDuration` to match.
 */
export const RESOLVE_TIMEOUT_MS = 30_000;

/**
 * How long this proxy waits on one path. Pure, so the two numbers above are testable facts. The
 * demo's title lookup is the same TMDB work as the add flow's, so it gets the same allowance.
 */
export function timeoutMsFor(path: string): number {
  return path.startsWith('/api/add/resolve') || path.startsWith('/api/demo/resolve')
    ? RESOLVE_TIMEOUT_MS
    : SCENE_API_TIMEOUT_MS;
}

/** Local `node server.js --pglite` in scene-api. Production sets SCENE_API_URL. */
export const SCENE_API_DEFAULT = 'http://localhost:8787';

export function sceneApiBase(): string {
  return (process.env.SCENE_API_URL || SCENE_API_DEFAULT).replace(/\/+$/, '');
}

const json = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });

// ------------------------------------------------------------------------------------------------
// Who is asking
// ------------------------------------------------------------------------------------------------

/**
 * The visitor's address, or `'unknown'`.
 *
 * `x-real-ip` and `x-forwarded-for` are whatever the previous hop wrote, and any caller may write
 * them. They are therefore read in exactly one situation: on Vercel, where the edge overwrites both
 * before the function ever sees them. Anywhere else — a laptop, a container, somebody's reverse
 * proxy — there is no address this app can stand behind, so it says so rather than inventing one
 * out of a header the caller controls. A limiter keyed on a forgeable header is a limiter the
 * attacker switches off.
 */
export function clientIp(headers: Headers, env: NodeJS.ProcessEnv = process.env): string {
  if (env.VERCEL !== '1') return 'unknown';
  const real = headers.get('x-real-ip')?.trim();
  if (real) return real;
  // The first entry is the client; everything after it is the chain that carried the request.
  const forwarded = headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  return forwarded || 'unknown';
}

/**
 * The secret that lets the API believe the two headers above.
 *
 * Without it the API is receiving `x-tinyviewers-client` from an anonymous caller, which is worth
 * nothing; with it, the header is only as trustworthy as the secret, which is the point. Absent
 * from the environment, the headers are not sent at all — an API that sees no proxy header falls
 * back to the address it can see for itself.
 */
const proxySecret = () => process.env.ADD_FILM_PROXY_SECRET || '';

// ------------------------------------------------------------------------------------------------
// Wrong passcodes, counted at the ingress
// ------------------------------------------------------------------------------------------------
//
// The scene API counts wrong passcodes too, but by the time a guess reaches it every guess looks
// like it came from this proxy: one warm instance, one address, one counter shared by every visitor
// on earth. Counting here instead means the count is keyed on the visitor, which is the only key
// that makes it a throttle rather than a way to lock a stranger out of their own passcode.
//
// Same window and same ceiling as the API's, deliberately: two limiters with different numbers
// would produce refusals neither of them can explain. And the same honest limitation — this is a
// per-instance map, so an attacker spread across cold starts is not slowed by it. It stops the dumb
// case for free. The real answer is a Vercel firewall rule on /api/add/*, and the README says so.

export const ATTEMPT_WINDOW_MS = 10 * 60 * 1000;
export const ATTEMPT_MAX_FAILURES = 10;
/** A bound on the map, so the counter cannot itself become the leak. */
const MAX_TRACKED_IPS = 1000;

type Counter = Map<string, { n: number; until: number }>;

const attempts: Counter = new Map();

/** Tests, and a dev server that outlives a fumbled passcode. */
export const resetAttempts = () => attempts.clear();

function record(counter: Counter, ip: string, now: number) {
  const rec = counter.get(ip);
  if (rec && rec.until > now) return rec;
  counter.delete(ip);
  return null;
}

function bump(counter: Counter, ip: string, now: number) {
  const rec = record(counter, ip, now);
  if (rec) {
    rec.n += 1;
    return;
  }
  // Prune only on a miss, and only once the map has actually grown: an expired entry nobody asks
  // about again is harmless until then.
  if (counter.size >= MAX_TRACKED_IPS) {
    for (const [key, value] of counter) if (value.until <= now) counter.delete(key);
    if (counter.size >= MAX_TRACKED_IPS) counter.clear();
  }
  counter.set(ip, { n: 1, until: now + ATTEMPT_WINDOW_MS });
}

/**
 * Has this address used up its guesses?
 *
 * `'unknown'` never has: it is not an address, it is the absence of one, and every caller this app
 * cannot identify shares it. Throttling that bucket would be the very bug this limiter exists to
 * fix — one stranger's ten wrong guesses refusing everybody else's right one.
 */
export function isThrottled(ip: string, now: number = Date.now()): boolean {
  if (ip === 'unknown') return false;
  return (record(attempts, ip, now)?.n ?? 0) >= ATTEMPT_MAX_FAILURES;
}

export function noteFailure(ip: string, now: number = Date.now()): void {
  if (ip === 'unknown') return;
  bump(attempts, ip, now);
}

// ------------------------------------------------------------------------------------------------
// Live demo runs, counted at the ingress
// ------------------------------------------------------------------------------------------------
//
// A demo run needs no passcode and costs real money (a few cents of Jev each), so the scene API
// limits how many one client may start: five in ten minutes, two of them on films whose subtitles
// have to be downloaded. As with passcodes, by the time a request reaches the API every visitor
// looks like this proxy unless ADD_FILM_PROXY_SECRET is set — so the same count is kept here, keyed
// on the visitor, with the same window and the same ceiling. Only the overall one: whether a film
// needs a download is the API's knowledge, and it enforces the tighter limit itself.

export const DEMO_RUNS_PER_VISITOR = 5;

const demoRuns: Counter = new Map();

export const resetDemoRuns = () => demoRuns.clear();

export function isDemoThrottled(ip: string, now: number = Date.now()): boolean {
  if (ip === 'unknown') return false;
  return (record(demoRuns, ip, now)?.n ?? 0) >= DEMO_RUNS_PER_VISITOR;
}

export function noteDemoRun(ip: string, now: number = Date.now()): void {
  if (ip === 'unknown') return;
  bump(demoRuns, ip, now);
}

// ------------------------------------------------------------------------------------------------
// Forwarding
// ------------------------------------------------------------------------------------------------

type ForwardOptions = {
  method?: 'GET' | 'POST';
  /** The request body, already read by the handler. Passed through untouched and never inspected. */
  body?: string;
  /** For tests. Production uses the platform fetch. */
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
  /** Who this call is on behalf of, from `clientIp`. Sent on only when a proxy secret is set. */
  clientIp?: string;
};

/**
 * One scene-api call, forwarded.
 *
 * Status codes are the contract — 401 wrong passcode, 409 already running, 429 daily cap — so they
 * are passed through exactly as they arrive, together with the JSON that explains them. Anything
 * that is not JSON is not passed on: a proxy's HTML error page or a stack trace would be the one
 * kind of body this app must not relay, so it becomes a plain 502 with a code the client can read.
 *
 * The response body is read **inside** the same try and the same deadline as the request. A body
 * that stops arriving halfway is exactly as much of a timeout as a request that never connects, and
 * it used to escape as a raw `TimeoutError` — an exception out of a function whose whole promise is
 * that it returns a JSON refusal instead of throwing one.
 *
 * Nothing is cached at any level. A job that finished half a second ago must not be reported as
 * still running because a CDN thought the answer looked stable.
 */
export async function forwardToSceneApi(path: string, options: ForwardOptions = {}): Promise<Response> {
  const { method = 'GET', body, fetchImpl = fetch, signal, clientIp: ip } = options;
  const url = `${sceneApiBase()}${path}`;

  const headers: Record<string, string> = {};
  if (body) headers['content-type'] = 'application/json';
  const secret = proxySecret();
  if (secret) {
    headers['x-tinyviewers-proxy'] = secret;
    headers['x-tinyviewers-client'] = ip || 'unknown';
  }

  // AbortSignal.timeout alone would not honour a client that navigated away mid-flight; `any` joins
  // the two so the upstream request ends on whichever comes first.
  const timeout = AbortSignal.timeout(timeoutMsFor(path));
  const abort = signal ? AbortSignal.any([timeout, signal]) : timeout;

  let status: number;
  let payload: string;
  try {
    const upstream = await fetchImpl(url, {
      method,
      headers: Object.keys(headers).length > 0 ? headers : undefined,
      body,
      signal: abort,
      cache: 'no-store',
    });

    const type = upstream.headers.get('content-type') ?? '';
    if (!type.includes('json')) {
      console.error(`[add] ${method} ${path}: upstream answered ${upstream.status} with ${type || 'no content type'}`);
      return json({ error_code: 'unreachable' }, 502);
    }

    status = upstream.status;
    payload = await upstream.text();
  } catch (err) {
    // The endpoint and the reason. Never the body: it may be carrying the passcode.
    const timedOut = err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError');
    console.error(`[add] ${method} ${path}: ${timedOut ? 'timed out' : 'could not be reached'}`);
    return timedOut
      ? json({ error_code: 'timed_out' }, 504)
      : json({ error_code: 'unreachable' }, 502);
  }

  return new Response(payload, {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

/**
 * One passcoded POST, forwarded: throttled, size-limited, attributed, and counted.
 *
 * Both POST routes are this function and nothing else, so the four steps cannot end up in a
 * different order on one of them — and a third passcoded endpoint cannot be the one that forgot to
 * count. The order matters: a blocked address is refused before its body is read, and the count
 * goes up only on a 401, which is the API's word for "that passcode is not right".
 */
export async function forwardAddPost(request: Request, path: string): Promise<Response> {
  const ip = clientIp(request.headers);
  if (isThrottled(ip)) return TOO_MANY();

  const body = await readBody(request);
  if (body === null) return TOO_LARGE();

  const response = await forwardToSceneApi(path, {
    method: 'POST',
    body,
    signal: request.signal,
    clientIp: ip,
  });
  if (response.status === 401) noteFailure(ip);
  return response;
}

/**
 * The body of a POST, read as bytes and cut off the moment it is too long.
 *
 * The handlers do not parse it — the scene API is the one that validates its own contract — but an
 * unbounded body must not be relayed, so a request larger than any legitimate one (a title, a
 * passcode, a poster URL and an overview) is refused here rather than forwarded.
 *
 * Read off the stream rather than with `request.text()`, for two reasons that were both wrong
 * before: an oversized body was fully buffered and only then measured, and it was measured in
 * JavaScript characters, so 8 KB of accented text was 16 KB of UTF-8 and went through. The limit is
 * bytes, counted as they arrive, and the read is abandoned as soon as it is passed.
 */
export const MAX_BODY_BYTES = 8 * 1024;

export async function readBody(request: Request): Promise<string | null> {
  const stream = request.body;
  if (!stream) return '';

  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_BODY_BYTES) {
        await reader.cancel().catch(() => {});
        return null;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const joined = new Uint8Array(bytes);
  let at = 0;
  for (const chunk of chunks) {
    joined.set(chunk, at);
    at += chunk.byteLength;
  }
  return new TextDecoder().decode(joined);
}

/**
 * One passcode-free POST for the public demo, forwarded: size-limited and attributed like the add
 * POSTs, and — for `/api/demo/runs` — counted per visitor. The count goes up only on a 202, which
 * is the API's word for "a run was started and is costing money".
 */
export async function forwardDemoPost(request: Request, path: string, { countRuns = false } = {}): Promise<Response> {
  const ip = clientIp(request.headers);
  if (countRuns && isDemoThrottled(ip)) return TOO_MANY_RUNS();

  const body = await readBody(request);
  if (body === null) return TOO_LARGE();

  const response = await forwardToSceneApi(path, {
    method: 'POST',
    body,
    signal: request.signal,
    clientIp: ip,
  });
  if (countRuns && response.status === 202) noteDemoRun(ip);
  return response;
}

/** The API's own refusal for too many demo runs, from the side that can tell visitors apart. */
export const TOO_MANY_RUNS = () => json({ error_code: 'too_many_runs' }, 429);

/** 413, because that is what happened: nothing about the request was malformed, only long. */
export const TOO_LARGE = () => json({ error_code: 'too_large' }, 413);

/** The same refusal the scene API gives, from the side that can tell the visitors apart. */
export const TOO_MANY = () => json({ error_code: 'too_many_attempts' }, 429);
