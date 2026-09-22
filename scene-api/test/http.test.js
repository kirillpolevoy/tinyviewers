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
  assert.equal((await get('/api/films/nemo/recording')).status, 200);
  assert.equal((await get('/api/vocabulary')).status, 200);
  assert.equal((await get('/api/openapi.json')).status, 200);
  assert.equal((await get('/api/openapi')).status, 200);
  assert.equal((await get('/nope')).status, 404);
});

test('openapi.json is served as valid JSON and lists every route, and nothing that spends money', async () => {
  const { body, headers } = await get('/api/openapi.json');
  assert.match(headers.get('content-type'), /application\/json/);
  assert.equal(body.openapi, '3.1.0');
  assert.deepEqual(Object.keys(body.paths).sort(), [...ROUTES].sort());
  for (const [path, item] of Object.entries(body.paths)) {
    assert.deepEqual(Object.keys(item), ['get'], `${path} offers more than GET to a connector`);
  }
  assert.match(body.servers[0].url, /^http:\/\/127\.0\.0\.1:\d+$/);

  // The complete account of the deployment is still one query parameter away, for the owner.
  const { body: internal } = await get('/api/openapi.json?internal=1');
  assert.ok(internal.paths['/api/add/jobs'].post['x-internal']);
  assert.ok(internal.paths['/api/add/resolve'].post['x-internal']);
});

test('a film page sweeps an orphaned subtitle blob, so the bound is not "whenever the cron runs"', async () => {
  // The 30-minute rule used to be enforced only by the /api/add routes and a DAILY cron (Vercel's
  // Hobby plan refuses anything more frequent), so a function killed just after the cron left a
  // whole subtitle track in the database until the next day.
  const db = await loadedDb();
  const { resetBlobSweepThrottle } = await import('../lib/jobs.js');
  await db.query("insert into jobs (id, status, film) values ('orphanjob0000000000000', 'done', '{}'::jsonb) on conflict (id) do nothing");
  await db.query("insert into job_blobs (job_id, srt, created_at) values ('orphanjob0000000000000', 'a whole subtitle track', now() - interval '45 minutes') on conflict (job_id) do update set created_at = excluded.created_at");

  resetBlobSweepThrottle();
  assert.equal((await get('/api/films?q=nemo')).status, 200);
  const { rows } = await db.query('select count(*)::int as n from job_blobs');
  assert.equal(rows[0].n, 0, 'ordinary parent traffic did not sweep the orphan');
  resetBlobSweepThrottle();
});

test('CORS is open and every route an assistant is told about is read-only', async () => {
  const res = await fetch(`${base}/api/films`);
  assert.equal(res.headers.get('access-control-allow-origin'), '*');
  const preflight = await fetch(`${base}/api/films`, { method: 'OPTIONS' });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get('access-control-allow-methods'), 'GET, HEAD, OPTIONS');
  const post = await fetch(`${base}/api/films`, { method: 'POST' });
  assert.equal(post.status, 405);
  // And the one place that does take a POST refuses a GET, so the two halves cannot be confused.
  const getOnPost = await fetch(`${base}/api/add/jobs`);
  assert.equal(getOnPost.status, 405);
  assert.equal((await getOnPost.json()).message, 'Use POST, OPTIONS on this endpoint.');
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

test('a job\'s recording is a route of its own, and the job body is not the place to find it', async () => {
  // Route ORDER is the thing being checked as much as the handler: /api/add/jobs/{id}/recording
  // has to be tried before /api/add/jobs/{id}, or the id becomes "abc/recording".
  const db = await loadedDb();
  const live = 'httpjoblive0000000000';
  const done = 'httpjobdone0000000000';
  const recording = { meta: { film: 'nemo' }, beats: [], timeline: [] };
  const excerpts = { 'W001.0': [{ cue: 'C0001', line: 'Run!', score: 1, why: { items: [], words: [] } }] };
  await db.query(
    `insert into jobs (id, status, film, recording, excerpts) values
       ($1, 'running', '{}'::jsonb, $3::jsonb, $4::jsonb),
       ($2, 'done',    '{}'::jsonb, $3::jsonb, null)`,
    [live, done, JSON.stringify(recording), JSON.stringify(excerpts)],
  );

  try {
    const running = await fetch(`${base}/api/add/jobs/${live}/recording`);
    assert.equal(running.status, 200);
    // A running job's recording is still being written to, so it must not be cached.
    assert.equal(running.headers.get('cache-control'), 'no-store');
    const runningBody = await running.json();
    assert.deepEqual(Object.keys(runningBody).sort(), ['excerpts', 'recording']);
    assert.equal(runningBody.recording.meta.film, 'nemo');
    assert.equal(runningBody.excerpts['W001.0'][0].line, 'Run!');

    const finished = await fetch(`${base}/api/add/jobs/${done}/recording`);
    assert.equal(finished.status, 200);
    assert.equal(finished.headers.get('cache-control'), 'public, max-age=300');
    assert.equal((await finished.json()).excerpts, null, 'excerpts do not outlive their job');

    // The polled body says only whether to come and get it.
    const job = await get(`/api/add/jobs/${live}`);
    assert.equal(job.status, 200);
    assert.equal(job.body.recording_ready, true);
    assert.ok(!('recording' in job.body) && !('excerpts' in job.body));
    assert.equal(job.headers.get('cache-control'), 'no-store');

    // And it is un-indented, for the same reason the film recording is.
    assert.ok(!(await (await fetch(`${base}/api/add/jobs/${done}/recording`)).text()).includes('\n  '));
  } finally {
    await db.query('delete from jobs where id = any($1::text[])', [[live, done]]);
  }
});
