// Served at /api/openapi.json (see vercel.json) and at /api/openapi.
//
// `?internal=1` adds the owner's own /api/add operations. Without it the document describes the
// read-only connector surface and nothing else, because an importer that walks `paths` will offer
// whatever it finds there — and two of those operations spend real money.
import { handler, bool } from '../lib/http.js';
import { openapi } from '../lib/openapi.js';

export default handler(async (req) => {
  const host = req.headers?.['x-forwarded-host'] ?? req.headers?.host ?? 'localhost';
  const local = /^(localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0)(:|$)/.test(String(host));
  const proto = req.headers?.['x-forwarded-proto'] ?? (local ? 'http' : 'https');
  return openapi({ serverUrl: `${proto}://${host}`, internal: bool(req.query ?? {}, 'internal') });
});
