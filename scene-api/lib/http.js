// Shared plumbing for the handlers. Written so the same default-exported function works as a
// Vercel Node function and under the local node:http server in server.js.

import crypto from 'node:crypto';

// Both sides hashed before the comparison: `timingSafeEqual` throws on buffers of different
// lengths, so comparing the raw strings would leak the secret's length. Same rule as the passcode.
const digest = (s) => crypto.createHash('sha256').update(String(s ?? ''), 'utf8').digest();

export class HttpError extends Error {
  constructor(status, message, extra = {}) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

export const badRequest = (message, extra) => new HttpError(400, message, extra);
export const notFound = (message, extra) => new HttpError(404, message, extra);

export const ALLOWED_METHODS = 'GET, HEAD, OPTIONS';
// The add-a-film endpoints are the only writes in this API, so they carry their own method list
// rather than widening the one every read-only route advertises.
export const WRITE_METHODS = 'POST, OPTIONS';

export function cors(res, methods = ALLOWED_METHODS) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', methods);
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Max-Age', '86400');
}

export function sendJson(res, status, body, { cacheControl = null, methods = ALLOWED_METHODS, compact = false } = {}) {
  cors(res, methods);
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  // An error must never be cached: the caller fixes the request and retries immediately.
  res.setHeader('Cache-Control', cacheControl ?? (status >= 400 ? 'no-store' : 'public, max-age=300'));
  res.statusCode = status;
  // Everything here is pretty-printed, because these answers are read by people curling them as
  // often as by machines. The one exception is a whole recording: indentation adds a third of a
  // megabyte to something no human is going to read, and the platform's response limit is 4.5 MB.
  // Node drops the body of a HEAD response by itself (ServerResponse._hasBody), so the same call
  // works for both methods.
  res.end(`${JSON.stringify(body, null, compact ? 0 : 2)}\n`);
}

// Wraps a handler: CORS preflight, read-only methods, JSON errors with a usable message.
export function handler(fn, { compact = false } = {}) {
  return async (req, res) => {
    if (req.method === 'OPTIONS') { cors(res); res.statusCode = 204; res.end(); return; }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      sendJson(res, 405, { error: 'method_not_allowed', message: `This API is read-only; use ${ALLOWED_METHODS}.` });
      return;
    }
    try {
      const body = await fn(req, res);
      if (body !== undefined && !res.writableEnded) sendJson(res, 200, body, { compact });
    } catch (err) {
      if (err instanceof HttpError) {
        sendJson(res, err.status, {
          error: err.status === 404 ? 'not_found' : 'bad_request',
          message: err.message,
          ...err.extra,
        });
        return;
      }
      // Never leak a connection string or a stack trace to the caller.
      console.error(err);
      sendJson(res, 500, { error: 'internal_error', message: 'Something went wrong on our side.' });
    }
  };
}

/**
 * A handler that never gets cached, for the two kinds of answer that must not be: a POST, and a GET
 * whose whole point is that it changes between one second and the next (a job's progress).
 *
 * @param {(req: object, res: object) => Promise<object|undefined>} fn
 * @param {{ methods?: string[], parseBody?: boolean }} opts `methods` is what this route accepts
 *   besides OPTIONS. A thrown HttpError becomes its status, with `error` naming the family (the
 *   same word the read-only routes use) and its `extra` spread alongside — which is how a refusal
 *   carries the `error_code` the web branches on, e.g. 409 { error: 'conflict', error_code: 'busy' }.
 */
export function noStoreHandler(fn, { methods = ['POST'], parseBody = false } = {}) {
  const advertised = [...methods, 'OPTIONS'].join(', ');
  const send = (res, status, body) => sendJson(res, status, body, { cacheControl: 'no-store', methods: advertised });
  return async (req, res) => {
    if (req.method === 'OPTIONS') { cors(res, advertised); res.statusCode = 204; res.end(); return; }
    if (!methods.includes(req.method)) {
      send(res, 405, { error: 'method_not_allowed', message: `Use ${advertised} on this endpoint.` });
      return;
    }
    try {
      if (parseBody) req.jsonBody = await readJsonBody(req);
      const body = await fn(req, res);
      if (body !== undefined && !res.writableEnded) send(res, 200, body);
    } catch (err) {
      if (err instanceof HttpError) {
        send(res, err.status, {
          error: DEFAULT_ERROR[err.status] ?? 'error',
          message: err.message,
          ...err.extra,
        });
        return;
      }
      console.error(err);
      send(res, 500, { error: 'internal_error', message: 'Something went wrong on our side.' });
    }
  };
}

const DEFAULT_ERROR = { 400: 'bad_request', 401: 'unauthorized', 404: 'not_found', 409: 'conflict', 429: 'too_many_requests', 503: 'unavailable' };

/** At a megabyte this is already far more than any of these bodies should be. */
export const MAX_BODY_BYTES = 1_000_000;

// Vercel parses a JSON body onto req.body for us; the local server in server.js does not, so the
// stream is read here when nothing has been parsed yet. Either way an unparseable body is a 400
// with a sentence, not a stack trace.
export async function readJsonBody(req) {
  if (req.body !== undefined && req.body !== null && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') return parseOrThrow(req.body);
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw badRequest('That request body is too large.');
    chunks.push(chunk);
  }
  const text = Buffer.concat(chunks).toString('utf8').trim();
  return text ? parseOrThrow(text) : {};
}

function parseOrThrow(text) {
  try {
    const value = JSON.parse(text);
    return value && typeof value === 'object' ? value : {};
  } catch {
    throw badRequest('The request body is not valid JSON.');
  }
}

/**
 * Who is calling, for the failed-passcode counter and nothing else.
 *
 * Two sources, in order:
 *
 *  1. `x-tinyviewers-client`, but ONLY when the same request carries `x-tinyviewers-proxy` equal to
 *     `ADD_FILM_PROXY_SECRET`. The web app is a Next.js server that proxies these calls, so without
 *     this every visitor arrives as the same handful of proxy egress addresses and ten anonymous
 *     wrong guesses lock out everybody else on that instance. The secret is what makes the header
 *     worth reading: any stranger can send `x-tinyviewers-client`, and one who does without the
 *     secret is ignored. Set the variable on both projects, or leave it unset and get the old
 *     behaviour.
 *  2. `x-forwarded-for`'s left-most entry, then the socket. Forgeable by the caller, which is why
 *     this is only ever used to slow a guesser down — never to allow anything.
 *
 * The proxy sends the literal `unknown` when it cannot see the visitor, and that is NOT an
 * identity: bucketing on it would put every unidentifiable visitor in one counter, where ten wrong
 * guesses from any of them lock out all the rest — the exact failure this header exists to fix.
 *
 * Best effort either way. The real answer is a Vercel firewall rate-limit rule on /api/add/*.
 */
export function clientIp(req) {
  const headers = req?.headers ?? {};
  const head = (name) => {
    const v = headers[name];
    return String((Array.isArray(v) ? v[0] : v) ?? '').trim();
  };

  const secret = process.env.ADD_FILM_PROXY_SECRET;
  if (secret && head('x-tinyviewers-proxy')) {
    const given = digest(head('x-tinyviewers-proxy'));
    if (crypto.timingSafeEqual(given, digest(secret))) {
      // Whatever the proxy says its visitor is, capped so a long header cannot bloat the counter's
      // key. It is an opaque identity, not necessarily an address, and nothing else reads it.
      const client = head('x-tinyviewers-client').slice(0, 100);
      if (client && client.toLowerCase() !== 'unknown') return client;
      // Trusted, but with nothing to attribute the guess to. The socket, not `x-forwarded-for`:
      // the forwarded header on a trusted request is this same proxy's own claim about itself.
      // Null when there is no socket either, and then nothing is counted at all.
      return req?.socket?.remoteAddress || null;
    }
  }

  const fwd = headers['x-forwarded-for'];
  const first = Array.isArray(fwd) ? fwd[0] : fwd;
  const ip = String(first ?? '').split(',')[0].trim() || req?.socket?.remoteAddress || '';
  return ip || null;
}

// --- query parameter helpers -------------------------------------------------------------------

export const first = (v) => (Array.isArray(v) ? v[0] : v);

export function str(query, name, { max = 200 } = {}) {
  const raw = first(query[name]);
  if (raw === undefined || raw === null || raw === '') return null;
  const value = String(raw).trim();
  if (value === '') return null;
  if (value.length > max) throw badRequest(`${name} is too long (max ${max} characters).`);
  return value;
}

// Comma-separated list, trimmed, empties dropped.
export function list(query, name, { maxItems = 25 } = {}) {
  const raw = str(query, name, { max: 1000 });
  if (raw === null) return [];
  const items = raw.split(',').map((s) => s.trim()).filter(Boolean);
  if (items.length > maxItems) throw badRequest(`${name} accepts at most ${maxItems} values, got ${items.length}.`);
  return items;
}

export function int(query, name, { min, max, fallback = null } = {}) {
  const raw = str(query, name, { max: 20 });
  if (raw === null) return fallback;
  if (!/^-?\d+$/.test(raw)) throw badRequest(`${name} must be a whole number, got "${raw}".`);
  const value = Number(raw);
  if (min !== undefined && value < min) throw badRequest(`${name} must be at least ${min}, got ${value}.`);
  if (max !== undefined && value > max) throw badRequest(`${name} must be at most ${max}, got ${value}.`);
  return value;
}

const TRUE = new Set(['1', 'true', 'yes', 'y', 'on']);
const FALSE = new Set(['0', 'false', 'no', 'n', 'off']);

export function bool(query, name, fallback = false) {
  const raw = str(query, name, { max: 10 });
  if (raw === null) return fallback;
  const v = raw.toLowerCase();
  if (TRUE.has(v)) return true;
  if (FALSE.has(v)) return false;
  throw badRequest(`${name} must be true or false, got "${raw}".`);
}

// --- per-endpoint parameter contracts ------------------------------------------------------------
//
// One global allowlist meant /api/films?presence=shark silently ignored the filter and answered as
// though no filter had been asked for, which is the worst kind of wrong answer for this API. Each
// endpoint now declares exactly what it takes, and a parameter offered to the wrong endpoint is a
// 400 that names the right one.
//
// `list` parameters accept repetition (?presence=shark&presence=gun is merged, left to right).
// `scalar` parameters do not: repeating one is a 400 rather than a silent "first one wins".

export const ROUTE_OF = {
  films: 'GET /api/films',
  film: 'GET /api/films/{slug}',
  scenes: 'GET /api/films/{slug}/scenes',
  recording: 'GET /api/films/{slug}/recording',
  vocabulary: 'GET /api/vocabulary',
};

export const PARAMS = {
  films: { scalar: ['q', 'limit'], list: [] },
  film: { scalar: [], list: [] },
  scenes: {
    scalar: ['age', 'min_severity', 'only_confirmed', 'include_possible', 'platform', 'limit', 'offset'],
    list: ['presence', 'event', 'group', 'anchor_cue', 'observed_at'],
  },
  recording: { scalar: [], list: [] },
  vocabulary: { scalar: [], list: [] },
};

const endpointsTaking = (name) => Object.entries(PARAMS)
  .filter(([, spec]) => spec.scalar.includes(name) || spec.list.includes(name))
  .map(([endpoint]) => ROUTE_OF[endpoint]);

/**
 * Validates a query against one endpoint's contract and returns a normalised copy where every
 * value is a single string. Repeated list parameters are joined with commas.
 */
export function checkParams(query, endpoint) {
  const spec = PARAMS[endpoint];
  if (!spec) throw new Error(`no parameter contract for endpoint "${endpoint}"`);
  const allowed = [...spec.scalar, ...spec.list];
  const out = {};

  for (const [key, raw] of Object.entries(query ?? {})) {
    if (key === 'slug') { out[key] = first(raw); continue; }

    if (!allowed.includes(key)) {
      const elsewhere = endpointsTaking(key);
      if (elsewhere.length) {
        throw badRequest(
          `"${key}" is not a parameter of ${ROUTE_OF[endpoint]}. It belongs to ${elsewhere.join(' or ')}.`,
          { supported_here: allowed, use_instead: elsewhere },
        );
      }
      throw badRequest(`Unknown query parameter: ${key}.`, { supported_here: allowed });
    }

    const values = (Array.isArray(raw) ? raw : [raw]).filter((v) => v !== undefined && v !== null);
    if (values.length > 1) {
      if (spec.scalar.includes(key)) {
        throw badRequest(
          `${key} was given ${values.length} times (${values.map((v) => `"${v}"`).join(', ')}). It takes exactly one value.`,
        );
      }
      out[key] = values.join(','); // e.g. ?presence=shark&presence=gun -> "shark,gun"
    } else {
      out[key] = values[0];
    }
  }
  return out;
}
