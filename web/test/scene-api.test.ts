import test from 'node:test';
import assert from 'node:assert/strict';
import {
  clientIp,
  forwardDemoPost,
  forwardToSceneApi,
  isDemoThrottled,
  isThrottled,
  noteDemoRun,
  resetDemoRuns,
  DEMO_RUNS_PER_VISITOR,
  noteFailure,
  readBody,
  resetAttempts,
  sceneApiBase,
  timeoutMsFor,
  ATTEMPT_MAX_FAILURES,
  ATTEMPT_WINDOW_MS,
  MAX_BODY_BYTES,
  RESOLVE_TIMEOUT_MS,
  SCENE_API_DEFAULT,
  SCENE_API_TIMEOUT_MS,
  TOO_LARGE,
  TOO_MANY,
} from '../lib/scene-api';

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

/** A fetch that records what it was asked and answers with whatever the test hands it. */
function fakeFetch(answer: Response | ((url: string, init: RequestInit) => Promise<Response>)) {
  const calls: { url: string; init: RequestInit }[] = [];
  const impl = (async (url: string | URL | Request, init: RequestInit = {}) => {
    calls.push({ url: String(url), init });
    return typeof answer === 'function' ? answer(String(url), init) : answer;
  }) as unknown as typeof fetch;
  return { impl, calls };
}

test('the base URL comes from SCENE_API_URL, with the local server as the default', () => {
  const before = process.env.SCENE_API_URL;
  try {
    delete process.env.SCENE_API_URL;
    assert.equal(sceneApiBase(), SCENE_API_DEFAULT);
    process.env.SCENE_API_URL = 'https://scenes.example.com/';
    // A trailing slash in the environment must not become a double slash in the path.
    assert.equal(sceneApiBase(), 'https://scenes.example.com');
  } finally {
    if (before === undefined) delete process.env.SCENE_API_URL;
    else process.env.SCENE_API_URL = before;
  }
});

test('a GET is forwarded to the scene API and its JSON comes back unchanged', async () => {
  const { impl, calls } = fakeFetch(
    jsonResponse({ running: null, spent_today_usd: 0.12, cap_usd: 2, passcode_configured: true }),
  );
  const response = await forwardToSceneApi('/api/add/status', { fetchImpl: impl });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, `${sceneApiBase()}/api/add/status`);
  assert.equal(calls[0].init.method, 'GET');
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await response.json(), {
    running: null,
    spent_today_usd: 0.12,
    cap_usd: 2,
    passcode_configured: true,
  });
});

test('every refusal status is passed through with the code that explains it', async () => {
  const cases: [number, Record<string, unknown>][] = [
    [401, { error: 'bad passcode' }],
    [409, { error_code: 'exists', slug: 'nemo' }],
    [409, { error_code: 'busy', id: 'job_7' }],
    [429, { error_code: 'daily_cap', spent_usd: 2, cap_usd: 2 }],
    [503, { error_code: 'not_configured' }],
  ];
  for (const [status, body] of cases) {
    const { impl } = fakeFetch(jsonResponse(body, status));
    const response = await forwardToSceneApi('/api/add/jobs', {
      method: 'POST',
      body: '{}',
      fetchImpl: impl,
    });
    assert.equal(response.status, status);
    assert.deepEqual(await response.json(), body);
  }
});

test('the body is handed on byte for byte and never parsed on the way', async () => {
  // The passcode is in here. Nothing in the forwarder may read it, reshape it or log it.
  const body = JSON.stringify({ query: 'Finding Nemo', passcode: 'hunter2' });
  const { impl, calls } = fakeFetch(jsonResponse({ candidates: [] }, 200));
  await forwardToSceneApi('/api/add/resolve', { method: 'POST', body, fetchImpl: impl });
  assert.equal(calls[0].init.body, body);
  assert.equal(calls[0].init.method, 'POST');
  assert.equal((calls[0].init.headers as Record<string, string>)['content-type'], 'application/json');
});

test('a request that times out becomes a 504 with a code, not a hung page', async () => {
  const { impl } = fakeFetch(async () => {
    const err = new Error('The operation was aborted due to timeout');
    err.name = 'TimeoutError';
    throw err;
  });
  const response = await forwardToSceneApi('/api/add/status', { fetchImpl: impl });
  assert.equal(response.status, 504);
  assert.deepEqual(await response.json(), { error_code: 'timed_out' });
});

test('the timeout it arms is the declared one', async () => {
  const { impl, calls } = fakeFetch(jsonResponse({}, 200));
  await forwardToSceneApi('/api/add/status', { fetchImpl: impl });
  // Ten seconds: long enough for a subtitle search behind it, short enough to give up on.
  assert.equal(SCENE_API_TIMEOUT_MS, 10_000);
  assert.ok(calls[0].init.signal instanceof AbortSignal);
});

test('an unreachable scene API becomes a 502, not an exception', async () => {
  const { impl } = fakeFetch(async () => {
    throw new TypeError('fetch failed');
  });
  const response = await forwardToSceneApi('/api/add/status', { fetchImpl: impl });
  assert.equal(response.status, 502);
  assert.deepEqual(await response.json(), { error_code: 'unreachable' });
});

test('an upstream answer that is not JSON is not relayed', async () => {
  // A proxy's HTML error page or a stack trace is the one body this app must not pass on.
  const { impl } = fakeFetch(
    new Response('<html>502 Bad Gateway</html>', {
      status: 502,
      headers: { 'content-type': 'text/html' },
    }),
  );
  const response = await forwardToSceneApi('/api/add/status', { fetchImpl: impl });
  assert.equal(response.status, 502);
  assert.deepEqual(await response.json(), { error_code: 'unreachable' });
});

test('a body that stops arriving is a 504, not an exception', async () => {
  // The headers said JSON and the status was 200; the body then timed out. Reading it outside the
  // guarded fetch used to throw a raw TimeoutError out of a function whose whole promise is that it
  // returns a JSON refusal instead of throwing one.
  const { impl } = fakeFetch(
    new Response(
      new ReadableStream({
        start(controller) {
          const err = new Error('The operation was aborted due to timeout');
          err.name = 'TimeoutError';
          controller.error(err);
        },
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    ),
  );
  const response = await forwardToSceneApi('/api/add/status', { fetchImpl: impl });
  assert.equal(response.status, 504);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await response.json(), { error_code: 'timed_out' });
});

test('the title lookup gets a longer deadline than everything else', () => {
  // Behind /api/add/resolve the API runs a TMDB search plus up to three sequential detail requests
  // at eight seconds each. Four honest three-second answers already pass ten.
  assert.equal(timeoutMsFor('/api/add/resolve'), RESOLVE_TIMEOUT_MS);
  assert.equal(RESOLVE_TIMEOUT_MS, 30_000);
  assert.equal(timeoutMsFor('/api/add/status'), SCENE_API_TIMEOUT_MS);
  assert.equal(timeoutMsFor('/api/add/jobs'), SCENE_API_TIMEOUT_MS);
  assert.equal(timeoutMsFor('/api/add/jobs/abc/recording'), SCENE_API_TIMEOUT_MS);
  // The demo's lookup is the same TMDB work, so it gets the same allowance; starting a run does not.
  assert.equal(timeoutMsFor('/api/demo/resolve'), RESOLVE_TIMEOUT_MS);
  assert.equal(timeoutMsFor('/api/demo/runs'), SCENE_API_TIMEOUT_MS);
  assert.equal(timeoutMsFor('/api/add/finish'), SCENE_API_TIMEOUT_MS);
});

test('an oversized body is refused by the byte, while it is still arriving', async () => {
  const big = new Request('http://localhost/api/add/resolve', {
    method: 'POST',
    body: 'x'.repeat(MAX_BODY_BYTES + 1),
  });
  assert.equal(await readBody(big), null);

  // 8,192 accented characters are 16,384 bytes of UTF-8 — exactly the limit as characters, twice
  // it as bytes. Counting characters let this straight through.
  const multibyte = new Request('http://localhost/api/add/resolve', {
    method: 'POST',
    body: 'é'.repeat(MAX_BODY_BYTES),
  });
  assert.equal(await readBody(multibyte), null);

  // And a body that is exactly the limit, in bytes, is still fine.
  const edge = new Request('http://localhost/api/add/resolve', {
    method: 'POST',
    body: 'é'.repeat(MAX_BODY_BYTES / 2),
  });
  assert.equal((await readBody(edge))?.length, MAX_BODY_BYTES / 2);

  const fine = new Request('http://localhost/api/add/resolve', {
    method: 'POST',
    body: '{"query":"nemo"}',
  });
  assert.equal(await readBody(fine), '{"query":"nemo"}');
});

test('a body too long is 413 and a body-less POST is an empty string', async () => {
  // 413, not 400: nothing about the request was malformed, only long. The client has its own
  // sentence for it, so "that did not look like a title" is not shown over a title that was fine.
  const large = TOO_LARGE();
  assert.equal(large.status, 413);
  assert.deepEqual(await large.json(), { error_code: 'too_large' });

  assert.equal(await readBody(new Request('http://localhost/api/add/jobs', { method: 'POST' })), '');
});

// --- who is asking ------------------------------------------------------------------------------

const headers = (init: Record<string, string>) => new Headers(init);

test('the client address is read only where a trusted proxy writes it', () => {
  const both = headers({ 'x-real-ip': '203.0.113.7', 'x-forwarded-for': '198.51.100.9, 10.0.0.1' });

  // Off Vercel these headers are whatever the caller typed, and a limiter keyed on a header the
  // caller controls is a limiter the caller switches off.
  assert.equal(clientIp(both, {} as NodeJS.ProcessEnv), 'unknown');
  assert.equal(clientIp(both, { VERCEL: '0' } as unknown as NodeJS.ProcessEnv), 'unknown');

  // On Vercel the edge overwrites both before the function sees them. x-real-ip first.
  const on = { VERCEL: '1' } as unknown as NodeJS.ProcessEnv;
  assert.equal(clientIp(both, on), '203.0.113.7');
  // Without it, the first entry of the forwarded chain — the client, not the hops behind it.
  assert.equal(clientIp(headers({ 'x-forwarded-for': '198.51.100.9, 10.0.0.1' }), on), '198.51.100.9');
  assert.equal(clientIp(headers({ 'x-real-ip': '  ' , 'x-forwarded-for': ' 198.51.100.9 ' }), on), '198.51.100.9');
  assert.equal(clientIp(headers({}), on), 'unknown');
});

test('the proxy names itself and its visitor, but only when it has a secret to do it with', async () => {
  const before = process.env.ADD_FILM_PROXY_SECRET;
  try {
    delete process.env.ADD_FILM_PROXY_SECRET;
    const plain = fakeFetch(jsonResponse({}, 200));
    await forwardToSceneApi('/api/add/jobs', {
      method: 'POST',
      body: '{}',
      clientIp: '203.0.113.7',
      fetchImpl: plain.impl,
    });
    const sentWithout = plain.calls[0].init.headers as Record<string, string>;
    // An unsigned client header is worth nothing to the API, so it is not sent at all.
    assert.equal(sentWithout['x-tinyviewers-proxy'], undefined);
    assert.equal(sentWithout['x-tinyviewers-client'], undefined);

    process.env.ADD_FILM_PROXY_SECRET = 's3cret';
    const signed = fakeFetch(jsonResponse({}, 200));
    await forwardToSceneApi('/api/add/jobs', {
      method: 'POST',
      body: '{}',
      clientIp: '203.0.113.7',
      fetchImpl: signed.impl,
    });
    const sent = signed.calls[0].init.headers as Record<string, string>;
    assert.equal(sent['x-tinyviewers-proxy'], 's3cret');
    assert.equal(sent['x-tinyviewers-client'], '203.0.113.7');
    assert.equal(sent['content-type'], 'application/json');

    // No address to attribute it to is said out loud rather than left off.
    const anon = fakeFetch(jsonResponse({}, 200));
    await forwardToSceneApi('/api/add/status', { fetchImpl: anon.impl });
    assert.equal((anon.calls[0].init.headers as Record<string, string>)['x-tinyviewers-client'], 'unknown');
  } finally {
    if (before === undefined) delete process.env.ADD_FILM_PROXY_SECRET;
    else process.env.ADD_FILM_PROXY_SECRET = before;
  }
});

// --- wrong passcodes, counted at the ingress ----------------------------------------------------

test('ten wrong passcodes from one address, then ten minutes of nothing', () => {
  resetAttempts();
  const now = 1_000_000;
  for (let i = 0; i < ATTEMPT_MAX_FAILURES - 1; i += 1) noteFailure('203.0.113.7', now);
  assert.equal(isThrottled('203.0.113.7', now), false);

  noteFailure('203.0.113.7', now);
  assert.equal(isThrottled('203.0.113.7', now), true);

  // The point of counting here rather than upstream: one visitor's guesses are one visitor's.
  assert.equal(isThrottled('198.51.100.9', now), false);

  // And the window ends by itself.
  assert.equal(isThrottled('203.0.113.7', now + ATTEMPT_WINDOW_MS - 1), true);
  assert.equal(isThrottled('203.0.113.7', now + ATTEMPT_WINDOW_MS + 1), false);
  resetAttempts();
});

test('an address we cannot identify is never throttled, because it is everybody', () => {
  // 'unknown' is the absence of an address, shared by every caller this app cannot tell apart.
  // Throttling that bucket is the exact bug this limiter exists to fix.
  resetAttempts();
  for (let i = 0; i < ATTEMPT_MAX_FAILURES * 3; i += 1) noteFailure('unknown', 1_000_000);
  assert.equal(isThrottled('unknown', 1_000_000), false);
  resetAttempts();
});

test('the throttle refusal carries the code the client has a sentence for', async () => {
  const many = TOO_MANY();
  assert.equal(many.status, 429);
  assert.equal(many.headers.get('cache-control'), 'no-store');
  // Not `daily_cap`: the client branches on this code, and reading a fumbled passcode as budget is
  // how "$0.00 of $0.00 spent today" ended up on screen.
  assert.deepEqual(await many.json(), { error_code: 'too_many_attempts' });
});

// --- live demo runs, counted at the ingress -------------------------------------------------------

test('five demo runs from one visitor, then ten minutes of nothing; unknown is never throttled', () => {
  resetDemoRuns();
  const now = 2_000_000;
  for (let i = 0; i < DEMO_RUNS_PER_VISITOR - 1; i += 1) noteDemoRun('203.0.113.8', now);
  assert.equal(isDemoThrottled('203.0.113.8', now), false);
  noteDemoRun('203.0.113.8', now);
  assert.equal(isDemoThrottled('203.0.113.8', now), true);
  assert.equal(isDemoThrottled('198.51.100.9', now), false);
  assert.equal(isDemoThrottled('203.0.113.8', now + ATTEMPT_WINDOW_MS + 1), false);
  for (let i = 0; i < DEMO_RUNS_PER_VISITOR * 3; i += 1) noteDemoRun('unknown', now);
  assert.equal(isDemoThrottled('unknown', now), false);
  resetDemoRuns();
});

test('a demo POST is counted only when a run started, and refused here once the visitor is over', async () => {
  resetDemoRuns();
  const before = process.env.VERCEL;
  process.env.VERCEL = '1';
  const originalFetch = globalThis.fetch;
  let upstreamCalls = 0;
  let answer = 202;
  globalThis.fetch = (async () => {
    upstreamCalls += 1;
    return jsonResponse(answer === 202 ? { id: 'abc', cached_subtitles: true } : { error_code: 'busy' }, answer);
  }) as typeof fetch;
  const request = () =>
    new Request('http://localhost/api/demo/runs', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-real-ip': '203.0.113.20' },
      body: JSON.stringify({ slug: 'nemo' }),
    });
  try {
    // A refusal from upstream costs the visitor nothing.
    answer = 409;
    assert.equal((await forwardDemoPost(request(), '/api/demo/runs', { countRuns: true })).status, 409);
    assert.equal(isDemoThrottled('203.0.113.20'), false);

    answer = 202;
    for (let i = 0; i < DEMO_RUNS_PER_VISITOR; i += 1) {
      assert.equal((await forwardDemoPost(request(), '/api/demo/runs', { countRuns: true })).status, 202);
    }
    const calls = upstreamCalls;
    const refused = await forwardDemoPost(request(), '/api/demo/runs', { countRuns: true });
    assert.equal(refused.status, 429);
    assert.deepEqual(await refused.json(), { error_code: 'too_many_runs' });
    assert.equal(upstreamCalls, calls, 'a throttled visitor never reaches the API');

    // Lookups are not runs, and are not counted here.
    assert.equal((await forwardDemoPost(request(), '/api/demo/resolve')).status, 202);
  } finally {
    globalThis.fetch = originalFetch;
    if (before === undefined) delete process.env.VERCEL;
    else process.env.VERCEL = before;
    resetDemoRuns();
  }
});
