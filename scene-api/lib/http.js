// Shared plumbing for the handlers. Written so the same default-exported function works as a
// Vercel Node function and under the local node:http server in server.js.

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

export function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', ALLOWED_METHODS);
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Max-Age', '86400');
}

export function sendJson(res, status, body) {
  cors(res);
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  // An error must never be cached: the caller fixes the request and retries immediately.
  res.setHeader('Cache-Control', status >= 400 ? 'no-store' : 'public, max-age=300');
  res.statusCode = status;
  // Node drops the body of a HEAD response by itself (ServerResponse._hasBody), so the same call
  // works for both methods.
  res.end(`${JSON.stringify(body, null, 2)}\n`);
}

// Wraps a handler: CORS preflight, read-only methods, JSON errors with a usable message.
export function handler(fn) {
  return async (req, res) => {
    if (req.method === 'OPTIONS') { cors(res); res.statusCode = 204; res.end(); return; }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      sendJson(res, 405, { error: 'method_not_allowed', message: `This API is read-only; use ${ALLOWED_METHODS}.` });
      return;
    }
    try {
      const body = await fn(req, res);
      if (body !== undefined && !res.writableEnded) sendJson(res, 200, body);
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
  vocabulary: 'GET /api/vocabulary',
};

export const PARAMS = {
  films: { scalar: ['q', 'limit'], list: [] },
  film: { scalar: [], list: [] },
  scenes: {
    scalar: ['age', 'min_severity', 'only_confirmed', 'include_possible', 'platform', 'limit', 'offset'],
    list: ['presence', 'event', 'group', 'anchor_cue', 'observed_at'],
  },
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
