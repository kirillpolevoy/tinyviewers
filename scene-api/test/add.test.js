// The "Add a movie" flow: resolving a title, admitting a run, refusing one, and the whole pipeline
// end to end against stubs shaped like the real APIs.
//
// Nothing here touches a network. The three services the pipeline calls — OpenSubtitles, Jev and the
// Anthropic Messages API — are answered by `stubFetch` below, which returns real `Response` objects
// so the streaming parse in pipeline/claude.js is exercised for real rather than mocked away.
//
// The subtitles are a slice of an actual track from experiments/trigger-scan/data. They are read at
// run time and never written anywhere: no subtitle text is committed with these tests, and the
// pipeline's own rule — that a track lives only in job_blobs and only while the job runs — is
// asserted twice, once mid-run and once after.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { applySchema } from '../lib/db.js';
import { resolve, startJob, jobStatus, jobRecording, addStatus } from '../lib/add.js';
import { slugify } from '../lib/tmdb.js';
import {
  liveJob, putBlob, sweepBlobs, maybeSweepBlobs, resetBlobSweepThrottle, resetPasscodeAttempts,
  STALE_MS, RESERVE_USD, PASSCODE_MAX_FAILURES,
} from '../lib/jobs.js';
import { parseSrt, buildWindows } from '../pipeline/srt.js';
import { costUsd } from '../pipeline/claude.js';
import { findScenes, MODEL as SCENES_MODEL, MAX_OUTPUT_TOKENS as SCENES_MAX_OUTPUT_TOKENS } from '../pipeline/scenes.js';
import { labelPresence } from '../pipeline/presence.js';
import { ingestFilm } from '../pipeline/ingest.js';
import { CONCURRENCY as JEV_CONCURRENCY, PRICE_PER_MTOK } from '../pipeline/jev-core.js';
import { buildExcerpts, verifyExcerpts } from '../pipeline/excerpts.js';
import { MAX_FILE_BYTES } from '../pipeline/subtitles.js';
import { DEFAULT_EXPERIMENT_DIR } from '../load.js';
import { freshDb } from './helper.js';

const PASSCODE = 'open sesame';

test.before(() => {
  process.env.ADD_FILM_PASSCODE = PASSCODE;
  process.env.ADD_FILM_DAILY_CAP_USD = '5';
  // `startJob` looks its film up from TMDB by IMDb id, so it needs a key to be configured. Every
  // request still goes to a stub; nothing in this file touches a network.
  process.env.TMDB_API_KEY = 'test-key';
});

// The failed-passcode counter is per process and this file makes a lot of wrong guesses on purpose.
test.beforeEach(() => resetPasscodeAttempts());

async function emptyDb() {
  const db = await freshDb();
  await applySchema(db);
  return db;
}

// ------------------------------------------------------------------------------------------------
// The stubs
// ------------------------------------------------------------------------------------------------

/** A real subtitle track, cut to just over the 300-cue floor. Read here, never written anywhere. */
function srtSnippet(slug = 'lion-king', blocks = 420) {
  const file = path.join(DEFAULT_EXPERIMENT_DIR, 'data', `${slug}.srt`);
  const raw = fs.readFileSync(file, 'utf8').replace(/\r\n?/g, '\n');
  return `${raw.split(/\n{2,}/).slice(0, blocks).join('\n\n')}\n`;
}

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { 'content-type': 'application/json' },
});

// The two usages every stubbed Claude call reports, so a test can work out what a run cost.
const SCENES_USAGE = { input_tokens: 1200, output_tokens: 400 };
const PRESENCE_USAGE = { input_tokens: 800, output_tokens: 60 };

/** The Messages API answers as a stream of SSE events; claude.js parses exactly these three. */
const sse = (data, usage = SCENES_USAGE) => new Response([
  `data: ${JSON.stringify({ type: 'message_start', message: { usage } })}`,
  `data: ${JSON.stringify({ type: 'content_block_delta', delta: { type: 'text_delta', text: JSON.stringify(data) } })}`,
  `data: ${JSON.stringify({ type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: usage.output_tokens } })}`,
  '',
].join('\n'), { status: 200 });

/**
 * One fetch that answers every service the pipeline talks to.
 *
 * `plan` lets a test bend one answer without rewriting the rest: `plan.onScenes(body)` returns the
 * scene list, `plan.subtitleSearch` replaces the first OpenSubtitles response, and so on.
 */
function stubFetch(plan = {}) {
  const calls = { jev: 0, claudeScenes: 0, claudePresence: 0, downloads: 0 };
  const srtText = plan.srtText ?? srtSnippet();
  const cues = parseSrt(srtText);

  const fetchImpl = async (url, opts = {}) => {
    const u = String(url);

    // ---- OpenSubtitles ---------------------------------------------------------------------------
    if (u.includes('/subtitles?')) {
      if (plan.subtitleSearch) return plan.subtitleSearch(u);
      // Only the hearing-impaired search answers, which is the branch the pipeline prefers.
      if (!u.includes('hearing_impaired=only')) return json({ data: [] });
      return json({ data: [{ attributes: { release: 'Test.Release.1080p', files: [{ file_id: 4242 }] } }] });
    }
    if (u.endsWith('/download')) {
      calls.downloads += 1;
      if (plan.download) return plan.download();
      return json({ link: 'https://files.test/sub.srt', remaining: 99 });
    }
    if (u === 'https://files.test/sub.srt') return new Response(srtText, { status: 200 });

    // ---- Jev -------------------------------------------------------------------------------------
    if (u.includes('api.typesafe.ai')) {
      calls.jev += 1;
      if (plan.jev) return plan.jev(JSON.parse(opts.body));
      return json(jevAnswers(JSON.parse(opts.body)));
    }

    // ---- Anthropic -------------------------------------------------------------------------------
    if (u.includes('api.anthropic.com')) {
      const body = JSON.parse(opts.body);
      // The two passes are told apart by their output ceiling, as they are in the scripts: the
      // whole-transcript scene pass asks for MAX_OUTPUT_TOKENS, the per-scene presence pass for 4k.
      if (body.max_tokens === SCENES_MAX_OUTPUT_TOKENS) {
        calls.claudeScenes += 1;
        const scenes = plan.onScenes ? await plan.onScenes(body) : defaultScenes(cues);
        // As with onPresence: a plan may hand back a whole Response, which is how a test makes the
        // scene pass fail the way a real upstream error does.
        return scenes instanceof Response ? scenes : sse(scenes);
      }
      calls.claudePresence += 1;
      // A plan may hand back a whole Response instead of an answer, which is how a test makes one
      // call in the middle of the stage fail the way a real 400 does.
      const answer = plan.onPresence
        ? await plan.onPresence(body, calls.claudePresence)
        : { present: [{ id: 'large_predator', confidence: 'stated_in_lines' }], talked_about_only: ['darkness'] };
      return answer instanceof Response ? answer : sse(answer, PRESENCE_USAGE);
    }

    // ---- TMDB ------------------------------------------------------------------------------------
    if (u.includes('api.themoviedb.org')) {
      if (plan.tmdb) return plan.tmdb(u);
      // `startJob` looks the film up by IMDb id rather than trusting the body, so every admission
      // test needs /find to answer. This is the record FILM below is derived from.
      if (u.includes(`/find/${FILM.imdb_id}`)) return json({ movie_results: [TMDB_RECORD] });
      return json({ results: [], movie_results: [] });
    }
    throw new Error(`the stub was not expecting ${u}`);
  };
  return { fetchImpl, calls, srtText, cues };
}

/**
 * Jev's answer shape: one entry per question key, `noul` for a yes/no and a level distribution for a
 * Score. The first beat of every window is given a probability over the flag threshold, so roughly
 * a third of the beats flag and the excerpt builder has real work to do.
 */
function jevAnswers(body) {
  const answers = {};
  for (const [key, q] of Object.entries(body.questions)) {
    if (q.type === 'score') {
      answers[key] = { score: 1, confidence: 0.62, probabilities: { 0: 0.25, 1: 0.35, 2: 0.25, 3: 0.15 } };
      continue;
    }
    const flagged = key === 'b0.presence.large_predator' || key === 'b0.event.chased';
    answers[key] = { noul: flagged ? 0.86 : 0.04 };
  }
  return { model: 'jev-1.13.0', answers, usage: { input_tokens: 9000, output_tokens: 2500 } };
}

/** `n` non-overlapping scenes, for a test that needs the presence stage to make several calls. */
function manyScenes(cues, n) {
  const at = (i) => cues[Math.min(i, cues.length - 1)].id;
  return Array.from({ length: n }, (_, i) => ({
    title: `Scene ${i + 1}`,
    start_cue: at(20 + i * 40), end_cue: at(40 + i * 40),
    description: 'Something happens that a child of five might find hard to watch.',
    attributes: ['chased'],
    keywords: ['chase'],
    severity_5_7: 2, severity_8_10: 1, text_visibility: 'high',
  }));
}

/** Two scenes bounded by cues that really are in the snippet, both scored above zero so they survive. */
function defaultScenes(cues) {
  const at = (i) => cues[Math.min(i, cues.length - 1)].id;
  return {
    scenes: [
      {
        title: 'A stampede in the gorge',
        start_cue: at(40), end_cue: at(60),
        description: 'Animals thunder through a narrow gorge while a child is caught in the middle of it.',
        attributes: ['chased', 'family_in_danger', 'terrified'],
        keywords: ['stampede', 'gorge'],
        severity_5_7: 3, severity_8_10: 2, text_visibility: 'high',
      },
      {
        title: 'Alone in the dark',
        start_cue: at(120), end_cue: at(150),
        description: 'A young animal is left by itself somewhere dark and unfamiliar.',
        attributes: ['pitch_dark', 'abandoned'],
        keywords: ['dark', 'alone'],
        severity_5_7: 2, severity_8_10: 1, text_visibility: 'high',
      },
    ],
  };
}

/** What TMDB's /find answers for FILM.imdb_id. Everything a run uses comes from here, not the body. */
const TMDB_RECORD = {
  id: 8587,
  title: 'A Test Film',
  release_date: '1994-06-24',
  poster_path: '/test.jpg',
  overview: 'A film that exists only in this test.',
};

/** The whole request body a run is started from: an IMDb id and the passcode, and nothing else. */
const FILM = {
  imdb_id: 'tt9999999', // a well-formed id belonging to none of the loaded films
  passcode: PASSCODE,
};

const FILM_POSTER = 'https://image.tmdb.org/t/p/w500/test.jpg';

// ------------------------------------------------------------------------------------------------
// resolve
// ------------------------------------------------------------------------------------------------

const tmdbSearch = (u) => {
  if (u.includes('/search/movie')) {
    return json({ results: [{ id: 8587, title: 'The Lion King', release_date: '1994-06-24', poster_path: '/lk.jpg', overview: 'Simba.' }] });
  }
  if (u.includes('/movie/8587')) {
    return json({ id: 8587, title: 'The Lion King', release_date: '1994-06-24', poster_path: '/lk.jpg', overview: 'Simba.', external_ids: { imdb_id: 'tt0110357' } });
  }
  if (u.includes('/find/tt0110357')) {
    return json({ movie_results: [{ id: 8587, title: 'The Lion King', release_date: '1994-06-24', poster_path: '/lk.jpg', overview: 'Simba.' }] });
  }
  return json({ results: [], movie_results: [] });
};

test('resolve turns a title into a candidate with an IMDb id and a slug', async () => {
  const db = await emptyDb();
  const { fetchImpl } = stubFetch({ tmdb: tmdbSearch });
  const { candidates } = await resolve(db, { query: 'lion king', passcode: PASSCODE }, { apiKey: 'k', fetchImpl });
  assert.equal(candidates.length, 1);
  assert.deepEqual(candidates[0], {
    tmdb_id: 8587,
    imdb_id: 'tt0110357',
    title: 'The Lion King',
    year: 1994,
    poster_url: 'https://image.tmdb.org/t/p/w500/lk.jpg',
    overview: 'Simba.',
    slug: 'the-lion-king',
    exists: false,
  });
  await db.end();
});

test('resolve takes an IMDb URL and skips the search entirely', async () => {
  const db = await emptyDb();
  const seen = [];
  const { fetchImpl } = stubFetch({ tmdb: (u) => { seen.push(u); return tmdbSearch(u); } });
  const { candidates } = await resolve(db, { query: 'https://www.imdb.com/title/tt0110357/?ref_=nv', passcode: PASSCODE }, { apiKey: 'k', fetchImpl });
  assert.equal(candidates[0].imdb_id, 'tt0110357');
  assert.equal(seen.length, 1, 'one /find call, no /search and no per-candidate lookup');
  assert.ok(seen[0].includes('/find/tt0110357'));
  await db.end();
});

test('resolve says so when the film is already loaded, and keeps its existing slug', async () => {
  const db = await emptyDb();
  await db.query("insert into films (id, slug, title, year, imdb_id) values ('lion-king', 'lion-king', 'The Lion King', 1994, 'tt0110357')");
  const { fetchImpl } = stubFetch({ tmdb: tmdbSearch });
  const { candidates } = await resolve(db, { query: 'lion king', passcode: PASSCODE }, { apiKey: 'k', fetchImpl });
  assert.equal(candidates[0].exists, true);
  assert.equal(candidates[0].slug, 'lion-king', 'not a second copy under the-lion-king');
  await db.end();
});

test('resolve refuses a wrong passcode and an empty query', async () => {
  const db = await emptyDb();
  const { fetchImpl } = stubFetch({ tmdb: tmdbSearch });
  await assert.rejects(
    () => resolve(db, { query: 'lion king', passcode: 'wrong' }, { apiKey: 'k', fetchImpl }),
    (e) => e.status === 401 && e.extra.error_code === 'bad_passcode',
  );
  // A passcode of a different length must fail the same way, not throw out of timingSafeEqual.
  await assert.rejects(
    () => resolve(db, { query: 'lion king', passcode: 'x' }, { apiKey: 'k', fetchImpl }),
    (e) => e.status === 401,
  );
  await assert.rejects(
    () => resolve(db, { query: '   ', passcode: PASSCODE }, { apiKey: 'k', fetchImpl }),
    (e) => e.status === 400 && e.extra.error_code === 'empty_query',
  );
  await db.end();
});

test('two candidates with the same title do not offer the same slug', async () => {
  // A real case: "the gruffalo" returns the 2009 film and the 2004 stage recording of it.
  const db = await emptyDb();
  const { fetchImpl } = stubFetch({
    tmdb: (u) => {
      if (u.includes('/search/movie')) {
        return json({ results: [
          { id: 1, title: 'The Gruffalo', release_date: '2009-01-01' },
          { id: 2, title: 'The Gruffalo', release_date: '2004-01-01' },
        ] });
      }
      const id = Number(u.match(/\/movie\/(\d+)/)[1]);
      return json({ id, title: 'The Gruffalo', release_date: id === 1 ? '2009-01-01' : '2004-01-01', external_ids: { imdb_id: `tt000000${id}` } });
    },
  });
  const { candidates } = await resolve(db, { query: 'the gruffalo', passcode: PASSCODE }, { apiKey: 'k', fetchImpl });
  assert.deepEqual(candidates.map((c) => c.slug), ['the-gruffalo', 'the-gruffalo-2004']);
  await db.end();
});

test('resolve turns a TMDB failure into a 502, not a 500', async () => {
  const db = await emptyDb();
  const { fetchImpl } = stubFetch({ tmdb: () => json({ error: 'nope' }, 503) });
  await assert.rejects(
    () => resolve(db, { query: 'lion king', passcode: PASSCODE }, { apiKey: 'k', fetchImpl }),
    (e) => e.status === 502 && e.extra.error_code === 'tmdb_failed',
  );
  await db.end();
});

test('slugify handles the punctuation real titles have in them', () => {
  assert.equal(slugify('Monsters, Inc.'), 'monsters-inc');
  assert.equal(slugify("A Bug's Life"), 'a-bugs-life');
  assert.equal(slugify('WALL·E'), 'wall-e');
  assert.equal(slugify('?', 'tt123'), 'tt123');
});

// ------------------------------------------------------------------------------------------------
// admission
// ------------------------------------------------------------------------------------------------

const neverRun = () => {}; // a launch that drops the promise: admission only, no pipeline

/** Admission only: the TMDB lookup is stubbed, the pipeline never starts. */
const admit = (db, body = FILM, plan = {}) =>
  startJob(db, body, { launch: neverRun, fetchImpl: stubFetch(plan).fetchImpl });

test('a job is refused when the film is already loaded', async () => {
  const db = await emptyDb();
  await db.query("insert into films (id, slug, title, year, imdb_id) values ('lion-king', 'lion-king', 'The Lion King', 1994, 'tt0110357')");
  await assert.rejects(
    () => admit(db, { ...FILM, imdb_id: 'tt0110357' }, { tmdb: tmdbSearch }),
    (e) => e.status === 409 && e.extra.error_code === 'exists' && e.extra.slug === 'lion-king',
  );
  await db.end();
});

test('a job is refused while another one is running, and the refusal names it', async () => {
  const db = await emptyDb();
  await db.query("insert into jobs (id, status, film) values ('busyjob', 'running', '{}'::jsonb)");
  await assert.rejects(
    () => admit(db),
    (e) => e.status === 409 && e.extra.error_code === 'busy' && e.extra.id === 'busyjob',
  );
  await db.end();
});

test('two simultaneous starts admit exactly one: the INSERT is the lock, not a SELECT before it', async () => {
  // The bug this covers: both calls read `liveJob` as empty, both were admitted, both spent real
  // money, and the second one's writeFilm deleted the first one's film. There is no sleep in here
  // to make it race — every await between the two reads is a real yield.
  const db = await emptyDb();
  const results = await Promise.allSettled([admit(db), admit(db), admit(db)]);

  const admitted = results.filter((r) => r.status === 'fulfilled');
  const refused = results.filter((r) => r.status === 'rejected');
  assert.equal(admitted.length, 1, JSON.stringify(results.map((r) => r.status)));
  assert.equal(refused.length, 2);
  for (const r of refused) {
    assert.equal(r.reason.status, 409);
    assert.equal(r.reason.extra.error_code, 'busy');
  }

  // And the database agrees: one live row, and it is the one that was handed an id.
  const { rows } = await db.query("select id from jobs where status in ('queued', 'running')");
  assert.deepEqual(rows.map((r) => r.id), [admitted[0].value.id]);
  await db.end();
});

test('a wrong passcode is rate-limited per address after ten tries', async () => {
  const db = await emptyDb();
  const guess = () => resolve(db, { query: 'lion king', passcode: 'wrong' }, { apiKey: 'k', fetchImpl: stubFetch({ tmdb: tmdbSearch }).fetchImpl, ip: '203.0.113.7' });
  for (let i = 0; i < PASSCODE_MAX_FAILURES; i++) {
    await assert.rejects(guess, (e) => e.status === 401 && e.extra.error_code === 'bad_passcode');
  }
  await assert.rejects(guess, (e) => e.status === 429 && e.extra.error_code === 'too_many_attempts');
  // The right passcode from that address is refused too — the counter is on the address, not the
  // guess — while another address is untouched.
  await assert.rejects(
    () => resolve(db, { query: 'lion king', passcode: PASSCODE }, { apiKey: 'k', fetchImpl: stubFetch({ tmdb: tmdbSearch }).fetchImpl, ip: '203.0.113.7' }),
    (e) => e.status === 429,
  );
  const ok = await resolve(db, { query: 'lion king', passcode: PASSCODE }, { apiKey: 'k', fetchImpl: stubFetch({ tmdb: tmdbSearch }).fetchImpl, ip: '198.51.100.4' });
  assert.equal(ok.candidates.length, 1);
  await db.end();
});

test('a job that stopped writing six minutes ago is failed as timed_out and stops blocking', async () => {
  const db = await emptyDb();
  await db.query(
    `insert into jobs (id, status, film, created_at, updated_at)
     values ('deadjob', 'running', '{}'::jsonb, now() - interval '20 minutes', now() - ($1::bigint * interval '1 millisecond'))`,
    [STALE_MS + 60_000],
  );
  await putBlob(db, 'deadjob', 'subtitle text that must not outlive the job');

  assert.equal(await liveJob(db), null, 'a stale job does not hold the lock');
  const { rows } = await db.query('select status, error_code from jobs where id = $1', ['deadjob']);
  assert.equal(rows[0].status, 'failed');
  assert.equal(rows[0].error_code, 'timed_out');
  const { rows: blobs } = await db.query('select count(*)::int as n from job_blobs');
  assert.equal(blobs[0].n, 0, 'a dead run does not leave a subtitle file behind');

  // And a new job is admitted now that the lock is free — the stale row must not keep holding the
  // `jobs_one_live` index against it.
  const { id } = await admit(db);
  assert.match(id, /^[A-Za-z0-9_-]{22}$/);
  await db.end();
});

test('the daily cap counts what today already spent plus what this run would', async () => {
  const db = await emptyDb();
  await db.query("insert into jobs (id, status, film, cost_usd) values ('spent', 'done', '{}'::jsonb, 4.75)");
  await assert.rejects(
    () => admit(db),
    (e) => e.status === 429 && e.extra.error_code === 'daily_cap'
      && Math.abs(e.extra.spent_usd - 4.75) < 1e-9 && e.extra.cap_usd === 5
      && e.extra.reserve_usd === RESERVE_USD,
  );
  // Yesterday's spending does not count against today.
  await db.query("update jobs set created_at = now() - interval '2 days' where id = 'spent'");
  const { id } = await admit(db);
  assert.ok(id);
  // And the reserve is on the row from the moment it is created, so a run that is killed before it
  // writes anything still counts against the day rather than reading as free.
  const { rows } = await db.query('select cost_usd from jobs where id = $1', [id]);
  assert.equal(Number(rows[0].cost_usd), RESERVE_USD);
  await db.end();
});

test('a job needs a passcode and a well-formed IMDb id, and takes nothing else from the body', async () => {
  const db = await emptyDb();
  await assert.rejects(() => admit(db, { ...FILM, passcode: 'nope' }), (e) => e.status === 401);
  await assert.rejects(() => admit(db, { ...FILM, imdb_id: '' }), (e) => e.extra.error_code === 'no_imdb_id');
  await assert.rejects(() => admit(db, { ...FILM, imdb_id: 'tt1' }), (e) => e.extra.error_code === 'no_imdb_id');
  // An id TMDB knows nothing about is a 502, not a run started on a title someone typed.
  await assert.rejects(() => admit(db, { ...FILM, imdb_id: 'tt1234567' }), (e) => e.status === 502 && e.extra.error_code === 'tmdb_failed');
  await db.end();
});

test('a run is built from TMDB, not from the request body: a made-up title cannot choose the slug', async () => {
  const db = await emptyDb();
  const { id } = await admit(db, {
    ...FILM,
    // Everything below is ignored. The old code took the title from here, which meant the caller
    // chose the slug — and the slug decides which rows a run replaces.
    title: 'Finding Nemo',
    year: 2003,
    poster_url: 'https://evil.test/poster.jpg',
    overview: 'not the synopsis TMDB has',
  });
  const { rows } = await db.query('select film from jobs where id = $1', [id]);
  assert.equal(rows[0].film.slug, 'a-test-film');
  assert.equal(rows[0].film.title, 'A Test Film');
  assert.equal(rows[0].film.year, 1994);
  assert.equal(rows[0].film.poster_url, FILM_POSTER);
  assert.equal(rows[0].film.overview, TMDB_RECORD.overview);
  await db.end();
});

test('status is public, says whether a passcode is configured, and never reveals it', async () => {
  const db = await emptyDb();
  const idle = await addStatus(db);
  assert.deepEqual(idle, { running: null, spent_today_usd: 0, cap_usd: 5, passcode_configured: true });
  assert.ok(!('reserve_usd' in idle), 'with nothing running there is no reserve inside the figure');
  assert.ok(!JSON.stringify(idle).includes(PASSCODE));

  await db.query("insert into jobs (id, status, film, cost_usd) values ('live', 'running', '{}'::jsonb, 0.12)");
  const busy = await addStatus(db);
  assert.deepEqual(busy.running, { id: 'live' });
  assert.ok(Math.abs(busy.spent_today_usd - 0.12) < 1e-9);
  // How much of spent_today_usd is set aside rather than billed, so the web can say so instead of
  // showing a budget bar that jumps up $1.80 and then back down when the run reconciles.
  assert.equal(busy.reserve_usd, RESERVE_USD);
  await db.end();
});

test('status sweeps a subtitle blob that outlived its job', async () => {
  const db = await emptyDb();
  await db.query("insert into jobs (id, status, film) values ('old', 'done', '{}'::jsonb)");
  await putBlob(db, 'old', 'left behind');
  await db.query("update job_blobs set created_at = now() - interval '45 minutes'");
  assert.equal(await sweepBlobs(db), 1);
  const { rows } = await db.query('select count(*)::int as n from job_blobs');
  assert.equal(rows[0].n, 0);
  await db.end();
});

// ------------------------------------------------------------------------------------------------
// the whole pipeline
// ------------------------------------------------------------------------------------------------

test('a full run: six stages, a replayable recording, a film in the normal tables, no blob left', async () => {
  const db = await emptyDb();
  // Mid-run assertion: while the scene pass is in flight, the track must be in job_blobs and the
  // recording must already be on the job, because the page starts replaying before Sonnet finishes.
  let midRun = null;
  const { fetchImpl, calls, cues } = stubFetch({
    onScenes: async (body) => {
      const { rows } = await db.query('select count(*)::int as n from job_blobs');
      const { rows: jobs } = await db.query("select recording, status, step from jobs where status = 'running'");
      midRun = { blobs: rows[0].n, hasRecording: Boolean(jobs[0]?.recording), step: jobs[0]?.step };
      assert.ok(body.system.some((s) => s.text.includes('A Test Film')), 'the film is named in the system prompt');
      return defaultScenes(cues);
    },
  });

  const { id, done } = await startJob(db, FILM, { keys: { typesafe: 't', claude: 'c', opensubtitles: 'o' }, fetchImpl });
  const result = await done;
  assert.equal(result.status, 'done', JSON.stringify(result));

  assert.deepEqual(midRun, { blobs: 1, hasRecording: true, step: 'scenes' });

  const job = await jobStatus(db, id);
  assert.equal(job.status, 'done');
  assert.equal(job.error_code, null);
  assert.deepEqual(job.steps.map((s) => s.id), ['subtitles', 'jev', 'scenes', 'presence', 'excerpts', 'ingest']);
  assert.ok(job.steps.every((s) => s.status === 'done'), JSON.stringify(job.steps));
  assert.ok(job.steps.every((s) => s.started_ms !== null && s.ended_ms >= s.started_ms), 'every step is timed');
  assert.ok(job.cost_usd > 0, 'the run reports what it spent');
  assert.equal(job.scene_count, 2);
  assert.ok(job.elapsed_ms >= 0);
  assert.equal(job.film.slug, 'a-test-film');

  // The megabyte is not in the polled body. The page is told when to go and fetch it, once.
  assert.equal(job.recording_ready, true);
  assert.ok(!('recording' in job), 'the polled body never carries the recording');
  assert.ok(!('excerpts' in job), 'nor the excerpts');

  // The recording is the real artefact, with the fields RECORDINGS.md documents.
  const { body: replay, live } = await jobRecording(db, id);
  assert.equal(live, false, 'a finished job is cacheable');
  assert.equal(replay.recording.meta.film, 'a-test-film');
  assert.equal(replay.recording.meta.model, 'jev-1.13.0');
  assert.equal(replay.recording.meta.concurrency, 8);
  assert.equal(replay.recording.meta.questions_per_beat, 103);
  assert.equal(replay.recording.meta.total_answers, replay.recording.beats.length * 103);
  assert.equal(replay.recording.requests.length, calls.jev);
  assert.equal(replay.recording.timeline.length, replay.recording.requests.length);
  assert.equal(replay.recording.requests[0].sent_ms, 0);
  assert.ok(replay.recording.thresholds.flagged_beats > 0, 'the stub flags beats, so there is something to excerpt');

  // The excerpts are gone from the job the moment it ended, and are on the film instead.
  assert.equal(replay.excerpts, null, 'excerpts do not outlive the job that made them');
  const { rows: recRow } = await db.query('select excerpts from recordings where film_id = $1', ['a-test-film']);
  assert.equal(Object.keys(recRow[0].excerpts).length, replay.recording.thresholds.flagged_beats);

  // The film landed in the ordinary tables, indistinguishable from a loaded one.
  const { rows: films } = await db.query('select * from films where slug = $1', ['a-test-film']);
  assert.equal(films.length, 1);
  assert.equal(films[0].imdb_id, FILM.imdb_id);
  assert.equal(films[0].poster_url, FILM_POSTER);
  const { rows: tracks } = await db.query('select * from tracks where film_id = $1', ['a-test-film']);
  assert.equal(tracks[0].release_label, 'Test.Release.1080p');
  assert.equal(tracks[0].cue_count, cues.length);
  const { rows: scenes } = await db.query('select count(*)::int as n from scenes where film_id = $1', ['a-test-film']);
  assert.equal(scenes[0].n, 2);
  const { rows: labels } = await db.query(
    "select count(*)::int as n from scene_labels l join scenes s on s.id = l.scene_id where s.film_id = $1 and l.channel = 'presence' and l.asserted",
    ['a-test-film'],
  );
  assert.equal(labels[0].n, 2, 'the per-scene presence pass asserted large_predator in both scenes');
  const { rows: rec } = await db.query('select count(*)::int as n from recordings where film_id = $1', ['a-test-film']);
  assert.equal(rec[0].n, 1);

  // And the subtitle track is gone the moment the job finished.
  const { rows: blobs } = await db.query('select count(*)::int as n from job_blobs');
  assert.equal(blobs[0].n, 0);
  // A live recording has to pass the same leakage rule a recorded one does: every string in it is
  // an id, a model name or an ISO date, and the flag rule is the only prose.
  const SAFE = /^[\w.:+-]+$/;
  const walk = (node, at) => {
    if (typeof node === 'string') {
      if (at === 'thresholds.flag_rule') return;
      assert.match(node, SAFE, `${at} carries text: ${JSON.stringify(node.slice(0, 60))}`);
      return;
    }
    if (Array.isArray(node)) { node.forEach((v, i) => walk(v, `${at}[${i}]`)); return; }
    if (node && typeof node === 'object') for (const [k, v] of Object.entries(node)) walk(v, at ? `${at}.${k}` : k);
  };
  walk(replay.recording, '');

  assert.equal(calls.claudeScenes, 1, 'one whole-transcript pass, no second run');
  assert.equal(calls.claudePresence, 2, 'one call per scene');
  await db.end();
});

test('a run that fails records why, keeps the steps it finished, and deletes the blob', async () => {
  const db = await emptyDb();
  const { fetchImpl } = stubFetch({
    onScenes: () => { throw new Error('anthropic 500: upstream said something with a key in it'); },
  });
  const { id, done } = await startJob(db, FILM, { keys: { typesafe: 't', claude: 'c', opensubtitles: 'o' }, fetchImpl });
  await done;

  const job = await jobStatus(db, id);
  assert.equal(job.status, 'failed');
  assert.equal(job.error_code, 'internal');
  assert.equal(job.error, 'Something went wrong on our side part-way through this run.');
  assert.ok(!job.error.includes('anthropic'), 'an upstream message is never passed through');
  assert.equal(job.step, 'scenes');
  assert.deepEqual(job.steps.filter((s) => s.status === 'done').map((s) => s.id), ['subtitles', 'jev']);
  assert.equal(job.steps.find((s) => s.id === 'scenes').status, 'failed');
  assert.ok(job.cost_usd > 0, 'a failed run still reports what it had already spent');
  assert.equal(job.recording_ready, true, 'the screening pass finished, so its recording survives the failure');
  const { body: replay } = await jobRecording(db, id);
  assert.ok(replay.recording.beats.length > 0);

  const { rows } = await db.query('select count(*)::int as n from job_blobs');
  assert.equal(rows[0].n, 0);
  await db.end();
});

test('a job with no recording yet answers 404 no_recording rather than an empty body', async () => {
  const db = await emptyDb();
  const { id } = await admit(db);
  await assert.rejects(
    () => jobRecording(db, id),
    (e) => e.status === 404 && e.extra.error_code === 'no_recording',
  );
  await assert.rejects(
    () => jobRecording(db, 'AAAAAAAAAAAAAAAAAAAAAA'),
    (e) => e.status === 404 && e.extra.error_code === 'no_job',
  );
  await db.end();
});

test('money is banked as it is spent, so a 400 in the middle of a stage still counts against the day', async () => {
  // The bug: cost was added to the job only when a stage ENDED. A presence stage that made thirty
  // calls and then took a 400 recorded nothing at all, and the daily cap then admitted the next run
  // as though the day had been free.
  const db = await emptyDb();
  let costWhileRunning = null;
  const { fetchImpl, cues } = stubFetch({
    onScenes: async () => {
      const { rows } = await db.query("select cost_usd from jobs where status = 'running'");
      costWhileRunning = Number(rows[0].cost_usd);
      return { scenes: manyScenes(cues, 4) };
    },
    onPresence: async (body, n) => {
      if (n <= 3) return { present: [{ id: 'large_predator', confidence: 'stated_in_lines' }], talked_about_only: [] };
      // Delayed so the three that succeed have certainly banked before this one brings the stage
      // down — the point of the test is the money, not a race between stubs.
      await new Promise((r) => setTimeout(r, 25));
      return new Response(JSON.stringify({ error: 'bad_request' }), { status: 400 });
    },
  });

  const { id, done } = await startJob(db, FILM, { keys: { typesafe: 't', claude: 'c', opensubtitles: 'o' }, fetchImpl });
  await done;

  const job = await jobStatus(db, id);
  assert.equal(job.status, 'failed');
  assert.equal(job.step, 'presence');

  // While the run was going the row never read below the reserve, so a run the platform kills at
  // 300 s cannot leave a row that looks free.
  assert.ok(costWhileRunning >= RESERVE_USD, `mid-run cost was ${costWhileRunning}`);

  // And the final figure is the real one, to the cent: the jev run, the one scene call, and the
  // three presence calls that answered before the fourth failed.
  const { body: replay } = await jobRecording(db, id);
  const expected = replay.recording.meta.cost_usd
    + costUsd(SCENES_MODEL, [SCENES_USAGE])
    + costUsd(SCENES_MODEL, [PRESENCE_USAGE, PRESENCE_USAGE, PRESENCE_USAGE]);
  assert.ok(Math.abs(job.cost_usd - expected) < 1e-6, `${job.cost_usd} vs ${expected}`);
  assert.ok(job.cost_usd < RESERVE_USD, 'the reserve is replaced by the real total, not kept');
  await db.end();
});

test('an exhausted OpenSubtitles allowance is named, not swallowed', async () => {
  const db = await emptyDb();
  const { fetchImpl } = stubFetch({ subtitleSearch: () => json({ errors: ['quota'] }, 406) });
  const { id, done } = await startJob(db, FILM, { keys: { opensubtitles: 'o' }, fetchImpl });
  await done;
  const job = await jobStatus(db, id);
  assert.equal(job.status, 'failed');
  assert.equal(job.error_code, 'subtitle_quota');
  assert.equal(job.error, 'OpenSubtitles download limit reached for today');
  assert.equal(job.steps[0].status, 'failed');
  assert.equal(job.cost_usd, 0, 'nothing was spent, so nothing counts against the cap');
  await db.end();
});

test('a film with no English subtitles fails as no_subtitles', async () => {
  const db = await emptyDb();
  const { fetchImpl } = stubFetch({ subtitleSearch: () => json({ data: [] }) });
  const { id, done } = await startJob(db, FILM, { keys: { opensubtitles: 'o' }, fetchImpl });
  await done;
  const job = await jobStatus(db, id);
  assert.equal(job.error_code, 'no_subtitles');
  await db.end();
});

test('a subtitle file too short to be a feature is rejected rather than analysed', async () => {
  const db = await emptyDb();
  const { fetchImpl } = stubFetch({ srtText: srtSnippet('lion-king', 50) });
  const { id, done } = await startJob(db, FILM, { keys: { opensubtitles: 'o' }, fetchImpl });
  await done;
  const job = await jobStatus(db, id);
  assert.equal(job.error_code, 'no_subtitles');
  assert.match(job.error, /below the 300/);
  await db.end();
});

test('an unknown job id is a 404 and a malformed one a 400', async () => {
  const db = await emptyDb();
  await assert.rejects(() => jobStatus(db, 'AAAAAAAAAAAAAAAAAAAAAA'), (e) => e.status === 404);
  await assert.rejects(() => jobStatus(db, 'nope!'), (e) => e.status === 400);
  await db.end();
});

test('polling a job does the housekeeping: a dead run is told it is dead, and blobs are swept', async () => {
  // The sweep used to ride only on /api/add/status and on a run finishing, which meant a page
  // watching a run that died kept its spinner and the blob sat there until someone else called in.
  const db = await emptyDb();
  await db.query(
    `insert into jobs (id, status, film, created_at, updated_at)
     values ('deadjob0000000000000000', 'running', '{}'::jsonb, now() - interval '20 minutes', now() - ($1::bigint * interval '1 millisecond'))`,
    [STALE_MS + 60_000],
  );
  await db.query("insert into jobs (id, status, film) values ('otherjob00000000000000', 'done', '{}'::jsonb)");
  await putBlob(db, 'otherjob00000000000000', 'orphaned by a function that died');
  await db.query("update job_blobs set created_at = now() - interval '45 minutes'");

  const job = await jobStatus(db, 'deadjob0000000000000000');
  assert.equal(job.status, 'failed');
  assert.equal(job.error_code, 'timed_out');
  const { rows } = await db.query('select count(*)::int as n from job_blobs');
  assert.equal(rows[0].n, 0, 'the poll swept the orphaned blob too');
  await db.end();
});

// ------------------------------------------------------------------------------------------------
// the cost caps, and the two third-party calls that could otherwise run away
// ------------------------------------------------------------------------------------------------

test('the reserve is exactly the sum of the caps the pipeline will actually refuse to pass', async () => {
  // What makes `spent + reserve > cap` an honest refusal. If any stage's cap moves and this one
  // does not, the daily budget starts quoting a number nothing enforces.
  const [{ COST_CAP_USD: jev }, { COST_CAP_USD: scenesCap }, { COST_CAP_USD: presenceCap }] = await Promise.all([
    import('../pipeline/record.js'), import('../pipeline/scenes.js'), import('../pipeline/presence.js'),
  ]);
  assert.ok(Math.abs(RESERVE_USD - (jev + scenesCap + presenceCap)) < 1e-9, `${RESERVE_USD} vs ${jev} + ${scenesCap} + ${presenceCap}`);
});

test('the scene pass refuses a transcript it cannot read inside its cost cap', async () => {
  // Not a decorative constant any more: COST_CAP_USD is one of the three numbers RESERVE_USD is
  // built out of, so it has to be able to say no.
  const huge = Array.from({ length: 30_000 }, (_, i) => ({
    id: `C${String(i + 1).padStart(4, '0')}`,
    startMs: i * 2000,
    endMs: i * 2000 + 1500,
    text: 'a line of dialogue long enough to be worth counting',
  }));
  let sent = 0;
  await assert.rejects(
    () => findScenes({ film: { slug: 'x', title: 'X', year: 2000 }, cues: huge, apiKey: 'c', fetchImpl: async () => { sent += 1; return new Response('', { status: 500 }); } }),
    (e) => e.code === 'scenes_cap',
  );
  assert.equal(sent, 0, 'refused before the call, not after the bill');
});

test('an oversized subtitle download is skipped rather than read into memory', async () => {
  const db = await emptyDb();
  const { fetchImpl } = stubFetch({});
  const big = 'x'.repeat(MAX_FILE_BYTES + 1024);
  const { id, done } = await startJob(db, FILM, {
    keys: { opensubtitles: 'o' },
    fetchImpl: async (url, opts) => (
      String(url) === 'https://files.test/sub.srt'
        ? new Response(big, { status: 200 })
        : fetchImpl(url, opts)
    ),
  });
  await done;
  const job = await jobStatus(db, id);
  assert.equal(job.error_code, 'no_subtitles');
  await db.end();
});

test('an OpenSubtitles search that never answers is named, not left hanging', async () => {
  // The timer itself is 15 s and not worth waiting for; what is worth asserting is that an abort
  // comes back as a named failure rather than as `internal`, and that the signal is passed at all.
  const db = await emptyDb();
  let sawSignal = false;
  const { id, done } = await startJob(db, FILM, {
    keys: { opensubtitles: 'o' },
    fetchImpl: async (url, opts = {}) => {
      if (String(url).includes('/subtitles?')) {
        sawSignal = Boolean(opts.signal);
        throw Object.assign(new Error('The operation was aborted.'), { name: 'AbortError' });
      }
      return stubFetch({}).fetchImpl(url, opts);
    },
  });
  await done;
  assert.ok(sawSignal, 'the search carries an AbortSignal');
  const job = await jobStatus(db, id);
  assert.equal(job.error_code, 'subtitle_search_failed');
  assert.match(job.error, /within 15s/);
  await db.end();
});

// ------------------------------------------------------------------------------------------------
// the excerpt policy
// ------------------------------------------------------------------------------------------------

test('verifyExcerpts passes what the rule produces and catches every way of exceeding the policy', () => {
  const cues = [
    { id: 'C0001', startMs: 0, endMs: 1000, text: 'Run! It is right behind us!' },
    { id: 'C0002', startMs: 1000, endMs: 2000, text: 'I cannot swim any faster than this and I am really very frightened now' },
    { id: 'C0003', startMs: 2000, endMs: 3000, text: '(ROARS)' },
    { id: 'C0004', startMs: 3000, endMs: 4000, text: 'Elsewhere, calmly.' },
  ];
  const recording = {
    beats: [
      { id: 'W001.0', start_cue: 'C0001', end_cue: 'C0003', flagged: true },
      { id: 'W001.1', start_cue: 'C0004', end_cue: 'C0004', flagged: false },
    ],
    thresholds: { flagged: [{ beat_id: 'W001.0', top: [{ channel: 'event', id: 'chased', p: 0.9 }] }] },
  };

  const good = buildExcerpts(recording, cues);
  assert.deepEqual(verifyExcerpts(good, recording, cues).fails, []);

  const fails = (mutate) => {
    const copy = JSON.parse(JSON.stringify(good));
    mutate(copy);
    return verifyExcerpts(copy, recording, cues).fails;
  };
  assert.match(fails((e) => e['W001.0'].push({ cue: 'C0003', line: '(ROARS)', why: { items: [], words: [] } }))[0], /lines, the cap is 2/);
  assert.match(fails((e) => { e['W001.0'][0].line = cues[1].text; })[0], /words, the cap is 12/);
  assert.match(fails((e) => { e['W001.0'][0].cue = 'C0004'; })[0], /outside the beat/);
  assert.match(fails((e) => { e['W001.0'][0].line = 'a line nobody in this film says'; })[0], /not this cue's text/);
  assert.match(fails((e) => { e['W001.1'] = e['W001.0']; })[0], /not flagged/);
});

// ------------------------------------------------------------------------------------------------
// Regressions from the pre-launch review of the add-a-film pipeline
// ------------------------------------------------------------------------------------------------

test('a failing screening pass stops dispatching, and the job is not failed until every call has settled', async () => {
  // The bug: `Promise.all` rejected on the first failure while the other seven workers carried on
  // taking windows. The run was marked failed, the one-live-run lock was released and the next job
  // was admitted while those calls were still going out and still being billed.
  const db = await emptyDb();
  let failAt = 2;
  let ok = 0;
  let failedAtMs = null;
  const lastCallEndedMs = { at: 0 };
  const { fetchImpl, calls, cues } = stubFetch({
    jev: async (body) => {
      const n = calls.jev;
      if (n === failAt) return json({ error: 'bad_request', detail: 'nope' }, 400);
      await new Promise((r) => setTimeout(r, 20)); // still in flight when the failure lands
      ok += 1;
      lastCallEndedMs.at = Date.now();
      return json(jevAnswers(body));
    },
  });

  const { id, done } = await startJob(db, FILM, { keys: { typesafe: 't', claude: 'c', opensubtitles: 'o' }, fetchImpl });
  await done;
  failedAtMs = Date.now();

  const job = await jobStatus(db, id);
  assert.equal(job.status, 'failed');
  assert.equal(job.step, 'jev');

  // Nothing beyond the wave that was already out went anywhere: the captions call, then at most one
  // dispatch per worker. The film has many more windows than that.
  assert.ok(buildWindows(cues).length > JEV_CONCURRENCY, 'the film must have more windows than the pool is wide, or this proves nothing');
  assert.ok(calls.jev <= 1 + JEV_CONCURRENCY + 1, `${calls.jev} jev calls went out after the failure at call ${failAt}`);
  assert.ok(failedAtMs >= lastCallEndedMs.at, 'the job was written failed before the last call came back');

  // And what those calls cost is on the row, which is the other half of the same bug: a stage that
  // throws used to bank nothing at all.
  const expected = ok * (9000 / 1e6) * PRICE_PER_MTOK;
  assert.ok(ok >= 1, 'some requests did succeed before the failure');
  assert.ok(Math.abs(job.cost_usd - expected) < 1e-9, `${job.cost_usd} banked for ${ok} successful requests, expected ${expected}`);
});

test('a truncated Claude answer is still paid for: usage is banked before the answer is judged', async () => {
  // The bug: `onSpend` ran after the parse and after `stop_reason === 'end_turn'`, so a response
  // that reported real usage and then stopped at max_tokens banked nothing.
  const db = await emptyDb();
  const TRUNCATED_USAGE = { input_tokens: 30_000, output_tokens: 16_000 };
  const { fetchImpl } = stubFetch({
    onScenes: () => new Response([
      `data: ${JSON.stringify({ type: 'message_start', message: { usage: TRUNCATED_USAGE } })}`,
      `data: ${JSON.stringify({ type: 'content_block_delta', delta: { type: 'text_delta', text: '{"scenes":[' } })}`,
      `data: ${JSON.stringify({ type: 'message_delta', delta: { stop_reason: 'max_tokens' }, usage: { output_tokens: TRUNCATED_USAGE.output_tokens } })}`,
      '',
    ].join('\n'), { status: 200 }),
  });

  const { id, done } = await startJob(db, FILM, { keys: { typesafe: 't', claude: 'c', opensubtitles: 'o' }, fetchImpl });
  await done;

  const job = await jobStatus(db, id);
  assert.equal(job.status, 'failed');
  assert.equal(job.step, 'scenes');
  const { body: replay } = await jobRecording(db, id);
  const expected = replay.recording.meta.cost_usd + costUsd(SCENES_MODEL, [TRUNCATED_USAGE]);
  assert.ok(Math.abs(job.cost_usd - expected) < 1e-6, `${job.cost_usd} vs ${expected}`);
  assert.ok(costUsd(SCENES_MODEL, [TRUNCATED_USAGE]) > 0.2, 'the point is that this was not a cheap call to lose');
});

test('the presence cap is a ceiling with calls in flight, not a check against what is already paid', async () => {
  // Reproduced by the review: five workers each read the same "still under the cap" figure and all
  // five dispatched, so a $1.00 cap finished at $1.176. The prices here are the real ones scaled up
  // so that one call is a fifth of the cap; nothing else about the stage is changed.
  const { fetchImpl, cues } = stubFetch({});
  const NEAR_FULL = { input_tokens: 2000, output_tokens: 3800 };
  const film = { slug: 'x', title: 'A Test Film', year: 1994 };
  const scenes = manyScenes(cues, 20).map((s, i) => ({ ...s, id: `S${i + 1}`, start_ms: i * 1000, end_ms: i * 1000 + 500 }));

  const run = await labelPresence({
    film, cues, scenes, apiKey: 'c', costCapUsd: 1,
    prices: [10, 50],
    fetchImpl: async (url, opts) => {
      const body = JSON.parse(opts.body);
      return body.max_tokens === SCENES_MAX_OUTPUT_TOKENS ? fetchImpl(url, opts) : sse({ present: [], talked_about_only: [] }, NEAR_FULL);
    },
  });

  assert.ok(run.stopped, 'the cap stopped the film part-way, which is the behaviour being kept');
  assert.ok(run.scenes_asked < scenes.length, `${run.scenes_asked} of ${scenes.length} scenes were asked about`);
  assert.ok(run.cost_usd < 1, `the stage spent $${run.cost_usd.toFixed(4)}, which is over its $1.00 cap`);
  // Four calls at $0.21 is $0.84. The old rule let all five workers dispatch on the same reading
  // and then kept going, which is where $1.176 came from.
  assert.ok(run.scenes_asked >= 3, `only ${run.scenes_asked} scenes were asked about, so the cap is now too tight`);
});

test('a second film with the same title is written beside the first, never over it', async () => {
  // The bug: the slug was decided before admission and `writeFilm` deleted whatever was on it. Two
  // different IMDb ids that TMDB titles identically meant the second run removed the first film,
  // its scenes, its labels and its recording.
  const db = await emptyDb();
  const record = (id) => ({ id, title: 'Same Title', release_date: '1994-06-24', poster_path: '/t.jpg', overview: 'Two films, one title.' });
  const tmdb = (u) => {
    const m = u.match(/\/find\/(tt\d+)/);
    return m ? json({ movie_results: [record(m[1] === 'tt1111111' ? 11 : 22)] }) : json({ results: [], movie_results: [] });
  };

  const first = await startJob(db, { ...FILM, imdb_id: 'tt1111111' }, { keys: { typesafe: 't', claude: 'c', opensubtitles: 'o' }, fetchImpl: stubFetch({ tmdb }).fetchImpl });
  assert.equal((await first.done).status, 'done');
  const second = await startJob(db, { ...FILM, imdb_id: 'tt2222222' }, { keys: { typesafe: 't', claude: 'c', opensubtitles: 'o' }, fetchImpl: stubFetch({ tmdb }).fetchImpl });
  assert.equal((await second.done).status, 'done', JSON.stringify(await jobStatus(db, second.id)));

  const { rows } = await db.query('select slug, imdb_id from films order by slug');
  assert.deepEqual(rows.map((r) => r.slug), ['same-title', 'same-title-1994']);
  assert.deepEqual(rows.map((r) => r.imdb_id), ['tt1111111', 'tt2222222']);
  // The first film kept everything that hangs off it.
  for (const table of ['scenes', 'tracks', 'recordings']) {
    const { rows: kept } = await db.query(`select count(*)::int as n from ${table} where film_id = $1`, ['same-title']);
    assert.ok(kept[0].n > 0, `the first film lost its ${table}`);
  }
  // And the job sends the person to the film that was actually written.
  assert.equal((await jobStatus(db, second.id)).film.slug, 'same-title-1994');
  await db.end();
});

test('a run whose IMDb id arrived in the database while it was going fails `exists` rather than replacing it', async () => {
  const db = await emptyDb();
  const { fetchImpl } = stubFetch({});
  const { id, done } = await startJob(db, FILM, {
    keys: { typesafe: 't', claude: 'c', opensubtitles: 'o' },
    fetchImpl: async (url, opts) => {
      // Somebody else's film lands on this IMDb id while the scene pass is in flight.
      if (String(url).includes('api.anthropic.com') && JSON.parse(opts.body).max_tokens === SCENES_MAX_OUTPUT_TOKENS) {
        await db.query("insert into films (id, slug, title, year, imdb_id) values ('elsewhere', 'elsewhere', 'Elsewhere', 1994, $1)", [FILM.imdb_id]);
      }
      return fetchImpl(url, opts);
    },
  });
  await done;
  const job = await jobStatus(db, id);
  assert.equal(job.status, 'failed');
  assert.equal(job.error_code, 'exists');
  const { rows } = await db.query('select slug from films');
  assert.deepEqual(rows.map((r) => r.slug), ['elsewhere'], 'the film that was there is the only one there');
  await db.end();
});

test('a presence run missing a scene is a gap, not a crash: that scene is simply not assessed', async () => {
  // `buildFilmFrom` referenced `presencePath`, which has not been in scope since it took its inputs
  // as values, so the first film whose presence stage stopped at its cost cap threw a ReferenceError
  // out of ingestion instead of writing the scenes it had.
  const db = await emptyDb();
  const { cues, srtText } = stubFetch({});
  const { fetchImpl } = stubFetch({ onScenes: () => ({ scenes: manyScenes(cues, 4) }) });
  const film = { slug: 'partial-film', title: 'Partial Film', year: 1994, imdb_id: 'tt7777777' };

  const sceneRun = await findScenes({ film, cues, apiKey: 'c', fetchImpl });
  assert.equal(sceneRun.scenes.length, 4);
  const presenceRun = {
    model: 'claude-sonnet-5',
    taxonomy: 'v3',
    scenes_asked: 3,
    stopped: 'cost cap $1 reached',
    // The last scene is missing, exactly as the presence cap leaves it.
    scenes: sceneRun.scenes.slice(0, 3).map((s) => ({
      id: s.id, title: s.title, start_cue: s.start_cue, end_cue: s.end_cue,
      start_ms: s.start_ms, end_ms: s.end_ms,
      present: [{ id: 'large_predator', confidence: 'stated_in_lines' }], talked_about_only: [],
    })),
  };

  const { report, scenes } = await ingestFilm(db, { film, srtText, sceneRun, presenceRun });
  assert.equal(scenes, 4, 'every scene was still written');
  assert.deepEqual(report.scenes_without_presence_run, [sceneRun.scenes[3].id]);
  const { rows } = await db.query(
    "select count(*)::int as n from scene_labels where scene_id = $1 and channel = 'presence'",
    [`partial-film:${sceneRun.scenes[3].id}`],
  );
  assert.equal(rows[0].n, 0, 'nothing is asserted about a scene nobody was asked about');
  await db.end();
});

test('an upstream error body never reaches the job row or the log', async () => {
  // Jev and Anthropic are sent subtitle lines, and both quote the request back in an error body.
  // That body used to be pasted into the thrown message and then logged in full by run.js.
  const MARKER = 'DIALOGUE-THAT-MUST-NOT-BE-LOGGED';
  const db = await emptyDb();
  const { fetchImpl } = stubFetch({
    onScenes: () => new Response(JSON.stringify({ error: { message: `invalid request: ${MARKER}` } }), { status: 400 }),
  });

  const logged = [];
  const realError = console.error;
  console.error = (...args) => logged.push(args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '));
  try {
    const { id, done } = await startJob(db, FILM, { keys: { typesafe: 't', claude: 'c', opensubtitles: 'o' }, fetchImpl });
    await done;
    const job = await jobStatus(db, id);
    assert.equal(job.status, 'failed');
    assert.equal(job.error_code, 'internal');
    assert.ok(!JSON.stringify(job).includes(MARKER), 'the job row carries the upstream body');
    assert.ok(logged.length > 0, 'the failure is still logged, or nobody can debug it');
    assert.ok(!logged.join('\n').includes(MARKER), `the log carries the upstream body: ${logged.join('\n')}`);
    // What IS logged is enough to find the request at the other end.
    assert.match(logged.join('\n'), /anthropic/);
    assert.match(logged.join('\n'), /400/);
  } finally {
    console.error = realError;
  }
  await db.end();
});

test('a scene description that quotes the subtitles is dropped, and the step says so', async () => {
  // The historical films are checked after the fact by test/load.test.js; a live film is checked
  // here, between the model answering and the row being written, because nothing checks it later.
  const db = await emptyDb();
  const { fetchImpl, cues } = stubFetch({
    onScenes: () => {
      const quotable = cues.find((c) => c.text.split(/\s+/).length >= 10);
      assert.ok(quotable, 'the snippet needs one long line to quote');
      const [a, b] = [cues.indexOf(quotable), cues.indexOf(quotable) + 20];
      return {
        scenes: [{
          title: 'Something frightening happens',
          start_cue: cues[a].id, end_cue: cues[Math.min(b, cues.length - 1)].id,
          description: quotable.text,
          attributes: ['chased'], keywords: ['chase'],
          severity_5_7: 2, severity_8_10: 1, text_visibility: 'high',
        }],
      };
    },
  });

  const { id, done } = await startJob(db, FILM, { keys: { typesafe: 't', claude: 'c', opensubtitles: 'o' }, fetchImpl });
  assert.equal((await done).status, 'done');

  const { rows } = await db.query('select title, description from scenes where film_id = $1', ['a-test-film']);
  assert.equal(rows.length, 1, 'the scene itself is still worth having');
  assert.equal(rows[0].description, null, 'the quoting description was stored anyway');
  assert.equal(rows[0].title, 'Something frightening happens');
  const job = await jobStatus(db, id);
  assert.match(job.steps.find((s) => s.id === 'scenes').detail, /1 description dropped for quoting the subtitles/);
  await db.end();
});

test('a stale run loses its excerpts, and its recording endpoint stops serving them', async () => {
  const db = await emptyDb();
  await db.query(
    `insert into jobs (id, status, film, recording, excerpts, created_at, updated_at)
     values ('stalejob00000000000000', 'running', '{}'::jsonb, '{"meta":{}}'::jsonb,
             '{"W001.0":[{"cue":"C0001","line":"a line of the film"}]}'::jsonb,
             now() - interval '20 minutes', now() - ($1::bigint * interval '1 millisecond'))`,
    [STALE_MS + 60_000],
  );

  assert.equal(await liveJob(db), null);
  const { rows } = await db.query('select status, excerpts from jobs where id = $1', ['stalejob00000000000000']);
  assert.equal(rows[0].status, 'failed');
  assert.equal(rows[0].excerpts, null, 'a dead run keeps no subtitle text');

  const { body, live } = await jobRecording(db, 'stalejob00000000000000');
  assert.equal(live, false);
  assert.equal(body.excerpts, null);
  await db.end();
});

test('the blob sweep also rides on parent traffic, at most once per instance per ten minutes', async () => {
  const db = await emptyDb();
  await db.query("insert into jobs (id, status, film) values ('gone', 'done', '{}'::jsonb)");
  await putBlob(db, 'gone', 'left behind by a function that was killed');
  await db.query("update job_blobs set created_at = now() - interval '45 minutes'");

  resetBlobSweepThrottle();
  assert.equal(await maybeSweepBlobs(db), true);
  const { rows } = await db.query('select count(*)::int as n from job_blobs');
  assert.equal(rows[0].n, 0);

  // The next hundred film pages do not each run a DELETE.
  await putBlob(db, 'gone', 'and another');
  await db.query("update job_blobs set created_at = now() - interval '45 minutes'");
  assert.equal(await maybeSweepBlobs(db), false);
  const { rows: still } = await db.query('select count(*)::int as n from job_blobs');
  assert.equal(still[0].n, 1);
  resetBlobSweepThrottle();
  await db.end();
});

test('a failure at the recording leaves no half-written film to be refused as `exists` later', async () => {
  const db = await emptyDb();
  const { fetchImpl, cues, srtText } = stubFetch({});
  const film = { slug: 'half-film', title: 'Half Film', year: 1994, imdb_id: 'tt6666666' };
  const sceneRun = await findScenes({ film, cues, apiKey: 'c', fetchImpl });

  await assert.rejects(
    () => ingestFilm(db, {
      film, srtText, sceneRun,
      // `recorded_at` comes from the recording's own meta, and Postgres will not take this.
      recording: { meta: { started_at: 'not a timestamp' }, beats: [] },
    }),
  );

  for (const table of ['films', 'scenes', 'scene_labels', 'recordings', 'analysis_runs']) {
    const { rows } = await db.query(`select count(*)::int as n from ${table}`);
    assert.equal(rows[0].n, 0, `${table} kept rows from a run that did not finish`);
  }
  await db.end();
});

test('adding a film fills in missing vocabulary and rewrites none of it', async () => {
  // "Ensure the vocabulary exists" used to be an upsert of every row from the pipeline's snapshot,
  // so one live run reverted every hand-corrected label on the site.
  const db = await emptyDb();
  await db.query("insert into groups (id, label, layer) values ('creatures_figures', 'Curated group name', 'presence')");
  await db.query(
    `insert into vocabulary (id, layer, group_id, label, short_label, text_blind, taxonomy_version, aliases)
     values ('shark', 'presence', 'creatures_figures', 'A curated label a person wrote', 'Curated', false, 'v3', '{}')`,
  );

  const { fetchImpl, cues, srtText } = stubFetch({});
  const film = { slug: 'vocab-film', title: 'Vocab Film', year: 1994, imdb_id: 'tt5555555' };
  const sceneRun = await findScenes({ film, cues, apiKey: 'c', fetchImpl });
  await ingestFilm(db, { film, srtText, sceneRun });

  const { rows } = await db.query("select label, short_label from vocabulary where id = 'shark'");
  assert.equal(rows[0].label, 'A curated label a person wrote');
  assert.equal(rows[0].short_label, 'Curated');
  const { rows: g } = await db.query("select label from groups where id = 'creatures_figures'");
  assert.equal(g[0].label, 'Curated group name');
  // And the rows that were missing are there, or the labels this film just wrote have nothing to
  // point at.
  const { rows: n } = await db.query('select count(*)::int as n from vocabulary');
  assert.ok(n[0].n > 20, 'the missing vocabulary was still provisioned');
  await db.end();
});

test('a database labelled with another taxonomy version refuses the run instead of mixing the two', async () => {
  const db = await emptyDb();
  await db.query(
    `insert into vocabulary (id, layer, group_id, label, short_label, text_blind, taxonomy_version, aliases)
     values ('shark', 'presence', null, 'Shark', 'Shark', false, 'v2', '{}')`,
  );
  const { fetchImpl, cues, srtText } = stubFetch({});
  const film = { slug: 'mismatch-film', title: 'Mismatch Film', year: 1994, imdb_id: 'tt4444444' };
  const sceneRun = await findScenes({ film, cues, apiKey: 'c', fetchImpl });

  await assert.rejects(
    () => ingestFilm(db, { film, srtText, sceneRun }),
    (e) => e.code === 'vocabulary_mismatch',
  );
  const { rows } = await db.query('select count(*)::int as n from films');
  assert.equal(rows[0].n, 0);
  await db.end();
});

test('a live run checks its own excerpts against the policy before it writes them anywhere', async () => {
  const db = await emptyDb();
  const { fetchImpl, cues } = stubFetch({});
  const { id, done } = await startJob(db, FILM, { keys: { typesafe: 't', claude: 'c', opensubtitles: 'o' }, fetchImpl });
  await done;

  // The real rule passes, so the proof that the check ran is the step's own detail line plus the
  // fact that nothing quoted exceeds the policy in the row that was written.
  const job = await jobStatus(db, id);
  assert.equal(job.status, 'done', JSON.stringify({ c: job.error_code, e: job.error }));
  const { rows } = await db.query('select excerpts from recordings where film_id = $1', ['a-test-film']);
  const { body: replay } = await jobRecording(db, id);
  assert.deepEqual(verifyExcerpts(rows[0].excerpts, replay.recording, cues).fails, []);
  await db.end();
});
