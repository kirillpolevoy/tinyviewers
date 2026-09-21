// End-to-end over real HTTP: server.js routing -> the Vercel-shaped handlers in api/ -> lib.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from '../server.js';
import { ROUTES } from '../lib/openapi.js';
import { loadedDb } from './helper.js';

let base;
let server;

test.before(async () => {
  await loadedDb();                       // also injects the PGlite db into lib/db.js
  server = createServer();
  await new Promise((r) => server.listen(0, r));
  base = `http://127.0.0.1:${server.address().port}`;
});

test.after(() => server?.close());

const get = async (p) => {
  const res = await fetch(base + p);
  return { status: res.status, headers: res.headers, body: await res.json() };
};

test('the routes Vercel would serve are all reachable locally', async () => {
  assert.equal((await get('/api/films?q=nemo')).status, 200);
  assert.equal((await get('/api/films/nemo')).status, 200);
  assert.equal((await get('/api/films/nemo/scenes?presence=shark')).status, 200);
  assert.equal((await get('/api/vocabulary')).status, 200);
  assert.equal((await get('/api/openapi.json')).status, 200);
  assert.equal((await get('/api/openapi')).status, 200);
  assert.equal((await get('/nope')).status, 404);
});

test('openapi.json is served as valid JSON and lists every route', async () => {
  const { body, headers } = await get('/api/openapi.json');
  assert.match(headers.get('content-type'), /application\/json/);
  assert.equal(body.openapi, '3.1.0');
  assert.deepEqual(Object.keys(body.paths).sort(), [...ROUTES].sort());
  assert.match(body.servers[0].url, /^http:\/\/127\.0\.0\.1:\d+$/);
});

test('CORS is open and the API is read-only', async () => {
  const res = await fetch(`${base}/api/films`);
  assert.equal(res.headers.get('access-control-allow-origin'), '*');
  const preflight = await fetch(`${base}/api/films`, { method: 'OPTIONS' });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get('access-control-allow-methods'), 'GET, HEAD, OPTIONS');
  const post = await fetch(`${base}/api/films`, { method: 'POST' });
  assert.equal(post.status, 405);
});

test('errors come back as JSON with the right status', async () => {
  const missing = await get('/api/films/the-incredibles');
  assert.equal(missing.status, 404);
  assert.equal(missing.body.error, 'not_found');
  const bad = await get('/api/films/nemo/scenes?age=toddler');
  assert.equal(bad.status, 400);
  assert.equal(bad.body.error, 'bad_request');
  assert.match(bad.body.message, /age "toddler"/);
});

test('a calibrated request over HTTP returns both timelines', async () => {
  const detail = (await get('/api/films/nemo')).body;
  const early = detail.anchors.lines[0];
  const { body } = await get(`/api/films/nemo/scenes?presence=shark&anchor_cue=${early.cue_id}&observed_at=0:05:12`);
  assert.equal(body.calibration.method, 'one_anchor');
  const s = body.scenes[0];
  assert.equal(s.player_time.start_ms, s.track_time.start_ms + body.calibration.offset_ms);
  assert.notEqual(s.player_time.start, s.track_time.start);
});

// ------------------------------------------------------------------------------------------------
// Regressions from the code review
// ------------------------------------------------------------------------------------------------

test('HEAD is allowed wherever GET is, and returns no body', async () => {
  for (const path of ['/api/films', '/api/films/nemo', '/api/films/nemo/scenes?presence=shark', '/api/vocabulary', '/api/openapi.json']) {
    const head = await fetch(base + path, { method: 'HEAD' });
    const get = await fetch(base + path);
    assert.equal(head.status, 200, `HEAD ${path}`);
    assert.equal(head.status, get.status);
    assert.match(head.headers.get('content-type'), /application\/json/);
    assert.equal(await head.text(), '', `HEAD ${path} must send no body`);
    assert.ok((await get.text()).length > 0);
  }
  // A HEAD that would have been an error still reports the error status, with no body.
  const bad = await fetch(`${base}/api/films/nemo/scenes?age=toddler`, { method: 'HEAD' });
  assert.equal(bad.status, 400);
  assert.equal(await bad.text(), '');
  assert.equal((await fetch(`${base}/api/films`, { method: 'PUT' })).status, 405);
});

test('errors are never cached; successful responses are', async () => {
  const ok = await fetch(`${base}/api/films?q=nemo`);
  assert.equal(ok.headers.get('cache-control'), 'public, max-age=300');
  for (const path of ['/api/films/the-incredibles', '/api/films/nemo/scenes?age=toddler', '/api/films/nemo/scenes?group=e']) {
    const res = await fetch(base + path);
    assert.ok(res.status >= 400, path);
    assert.equal(res.headers.get('cache-control'), 'no-store', `${path} must not be cached`);
  }
  const notAllowed = await fetch(`${base}/api/films`, { method: 'POST' });
  assert.equal(notAllowed.headers.get('cache-control'), 'no-store');
});

test('repeated query parameters survive the URL, merged for lists and rejected for scalars', async () => {
  const merged = await get('/api/films/iron-giant/scenes?presence=shark&presence=gun');
  assert.equal(merged.status, 200);
  assert.deepEqual(merged.body.filters_applied.presence.map((p) => p.you_asked), ['shark', 'gun']);

  const twice = await get('/api/films/nemo/scenes?limit=5&limit=10');
  assert.equal(twice.status, 400);
  assert.match(twice.body.message, /limit was given 2 times/);

  const wrongEndpoint = await get('/api/films?presence=shark');
  assert.equal(wrongEndpoint.status, 400);
  assert.match(wrongEndpoint.body.message, /not a parameter of GET \/api\/films/);
});
