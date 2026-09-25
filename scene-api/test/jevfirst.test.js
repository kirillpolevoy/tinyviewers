// The Jev-first add pipeline and its live demo, end to end, against stubs shaped like the real APIs
// (test/jevfirst-stubs.js) and an in-process Postgres (PGlite). No network, no keys.
//
// What is covered, in order:
//   caps          the reserve is the sum of the stage caps, and each cap is the one the stage enforces
//   a whole add   subtitles -> ... -> ingest across many invocations (a zero time budget forces a
//                 hand-off after every stage), then the film read back with the web's own SQL
//   orchestration the lease admits one invocation; a crashed invocation is resumed from its
//                 checkpoint with its money carried; duplicate continuations are no-ops; a quiet job
//                 is resumed by a poll; a dead one is failed by the stale sweep
//   money         a stage refuses a call its cap cannot afford; admission refuses past the daily cap
//   demo          films / status / runs; measured progress; Sonnet never called; the reservation
//                 is a ceiling; the daily cap, the concurrency slots and the per-client limiter
//   seed          the artifact tables are written, the live guide tables are not
//
// Portable: every test here runs on a clean checkout. The subtitles are an INVENTED track committed as
// test/fixtures/synthetic-film.srt (make-synthetic-srt.mjs writes it), and the demo's stored Sonnet
// work is made by a stubbed add run of that film at the start of the demo tests -- nothing is read from
// the git-ignored experiment outputs. (The parity tests against real films' round-9 outputs are in
// jevfirst-parity.test.js, explicitly optional.)
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { freshDb } from './helper.js';
import { applySchema } from '../lib/db.js';
import { startJob, jobStatus, continueJob } from '../lib/add.js';
import { resetPasscodeAttempts, liveJob, getJob } from '../lib/jobs.js';
import { advanceJob, acquireLease } from '../pipeline-jevfirst/runner.js';
import { JEVFIRST_CAPS, JEVFIRST_RESERVE_USD, DEMO_STAGE_CAPS } from '../pipeline-jevfirst/caps.js';
import { SEGMENT_CAPS } from '../pipeline-jevfirst/stages/segment.js';
import { CHECK_CAPS } from '../pipeline-jevfirst/stages/checks.js';
import { ANSWER_CAPS } from '../pipeline-jevfirst/stages/answers.js';
import { TEXT_CAPS } from '../pipeline-jevfirst/stages/text.js';
import { runJobs } from '../pipeline-jevfirst/pack/jev-client.js';
import { budget } from '../pipeline-jevfirst/pack/budget.js';
import { withRun } from '../pipeline-jevfirst/context.js';
import { writeArtifacts, storeTrack, DEMO_KINDS } from '../pipeline-jevfirst/store.js';
import { startDemoRun, demoRun, demoStatus, demoFilms, resetDemoLimiter, DEMO_RESERVE_USD } from '../lib/demo.js';
import { compareWithGuide, applyResult, newProgress, reconcileClaims } from '../pipeline-jevfirst/demo.js';
import { reasonCategory } from '../pipeline-jevfirst/stages/ingest.js';
import { makeFetch, jevAnswer, jsonResponse, claudeStream } from './jevfirst-stubs.js';

const PASSCODE = 'open sesame';
const SRT_FILE = path.join(path.dirname(new URL(import.meta.url).pathname), 'fixtures', 'synthetic-film.srt');
// The demo's film: the synthetic film's artifacts, made by a stubbed add (demoSeed below), under this slug.
const DEMO_FILM = { slug: 'demo-film', imdb_id: 'tt1979388', title: 'The Good Dinosaur', year: 2015 };

const FILM = { imdb_id: 'tt1979388', title: 'The Good Dinosaur', year: 2015 };
const SCENE_LINES = 20; // the stub segmentation cuts a scene every 20 subtitle lines

test.before(() => {
  process.env.ADD_FILM_PASSCODE = PASSCODE;
  process.env.ADD_FILM_DAILY_CAP_USD = '10';
  process.env.TMDB_API_KEY = 'test-key';
  process.env.TYPESAFE_API_KEY = 'test-jev';
  delete process.env.CONTINUE_SECRET;
  delete process.env.VERCEL;
  delete process.env.ADD_PIPELINE;
});
test.beforeEach(() => { resetPasscodeAttempts(); resetDemoLimiter(); });

async function emptyDb() {
  const db = await freshDb();
  await applySchema(db);
  return db;
}

// ------------------------------------------------------------------------------------------------
// The stubbed world: OpenSubtitles, TMDB, Wikipedia, Wikidata, Anthropic, Jev
// ------------------------------------------------------------------------------------------------

const PLOT = [
  'Arlo is the youngest of three dinosaur children on a farm.',
  'Arlo is afraid of almost everything.',
  'His father Henry takes him to catch a critter stealing corn.',
  'Henry is swept away by a flash flood and dies.',
  'Arlo falls into the river and is carried far from home.',
  'He meets a feral human boy he names Spot.',
  'Together they face a storm and a group of pterodactyls.',
  'Arlo and Spot are chased by raptors.',
  'Arlo saves Spot from the flood.',
  'Arlo returns home to his mother.',
];

const claudeKind = (system) => {
  if (system.startsWith('You write the TITLE of a note')) return 'titles';
  if (system.includes('An earlier note for each of these scenes could not be confirmed')) return 'describe2';
  if (system.startsWith('You split a feature film')) return 'segment';
  if (system.includes('Some scenes have almost no dialogue')) return 'fill';
  if (system.includes('you answer a fixed list of yes/no questions')) return 'sonnetq';
  if (system.includes('You write the short notes a parent reads')) return 'describe';
  return 'unknown';
};

function claudeAnswer(body) {
  const system = typeof body.system === 'string' ? body.system : body.system?.[0]?.text ?? '';
  const user = body.messages[0].content;
  const kind = claudeKind(system);
  if (kind === 'segment') {
    const lines = [...user.matchAll(/^L(\d+) \[/gm)].map((m) => Number(m[1]));
    const lo = Math.min(...lines); const hi = Math.max(...lines);
    const T = [...user.matchAll(/^T(\d+) (.+)$/gm)].slice(0, 3);
    const scenes = [];
    for (let a = lo; a <= hi; a += SCENE_LINES) {
      const b = Math.min(hi, a + SCENE_LINES - 1);
      const k = scenes.length;
      scenes.push({ start_cue: a, end_cue: b, setting: 'unknown', setting_cites: [], sentences: [{ text: `Characters talk together in part ${k + 1}.`, cites: [`L${a}`, `L${a + 1}`] }, ...(k === 2 ? [{ text: 'A flood sweeps someone away.', cites: ['W4', `L${a}`] }] : [])] });
    }
    return { kind, data: { cast: T.map(([, n, name]) => ({ name: name.trim(), tmdb: `T${n}`, aliases: [], kind: 'animal', is_child: n === '1' ? 'true' : 'unknown', looks_frightening: 'unknown', disposition: 'ally', disposition_note: '', group: 'none', cites: { name: [`T${n}`], kind: [], is_child: n === '1' ? ['W1'] : [], looks_frightening: [], disposition: [] } })), dangers: [], scenes } };
  }
  if (kind === 'fill') {
    const ids = [...user.matchAll(/^=== (S\d+):/gm)].map((m) => m[1]);
    return { kind, data: { scenes: ids.map((id) => ({ id, decisions: [], sentences: [] })) } };
  }
  if (kind === 'sonnetq') {
    const ids = [...user.matchAll(/^=== (S\d+) ===$/gm)].map((m) => m[1]);
    return { kind, data: { scenes: ids.map((id, i) => ({ id, answers: i % 4 === 0 ? [{ q: 'crying', a: 'yes', c: 'high' }, { q: 'trapped', a: 'yes', c: 'medium' }] : [] })) } };
  }
  if (kind === 'describe' || kind === 'describe2' || kind === 'titles') {
    const blocks = user.split(/^=== /m).slice(1);
    return {
      kind,
      data: {
        scenes: blocks.map((b) => {
          const id = b.match(/^(S\d+)/)[1];
          const firstL = b.match(/^L(\d+) \[/m);
          const cites = firstL ? [`L${firstL[1]}`] : [];
          // attempt 1: a title Jev will not confirm and a sentence it confirms only loosely; the second
          // attempt a sentence it confirms strictly (and the same unconfirmed title); the title pass a title it confirms
          if (kind === 'titles') return { id, title: 'Arlo cries for help', title_cites: cites, sentences: [] };
          if (kind === 'describe2') return { id, title: 'Arlo is in danger', title_cites: cites, sentences: [{ text: 'Arlo cries for help by the river.', cites }] };
          return { id, title: 'Arlo is in danger', title_cites: cites, sentences: [{ text: 'Arlo is in danger by the river.', cites }] };
        }),
      },
    };
  }
  throw new Error(`unexpected Claude call: ${system.slice(0, 60)}`);
}

/** Jev's support for the stub describe texts: loose only, never, strict (the A0>C rule and the second attempt run). */
const SUPPORT = { 'Arlo is in danger by the river.': 0.5, 'Arlo is in danger': 0.2, 'Arlo cries for help by the river.': 0.9, 'Arlo cries for help': 0.9 };

/** Jev: the gate's alignment and cut questions answered the way a sound cut earns, everything else by hash. */
function jevBody(body, { starts = null } = {}) {
  const r = jevAnswer(body);
  for (const [k, q] of Object.entries(body.questions)) {
    if (q.type === 'choice' && q.criteria && 'supports' in q.criteria) {
      const claim = body.state?.claims?.[Number(k.slice(1))]?.claim;
      const ps = SUPPORT[claim] ?? 0.9;
      r.answers[k] = { choice: ps >= 0.45 ? 'supports' : 'says_nothing', confidence: Math.max(ps, 0.98 - ps), probabilities: { supports: ps, contradicts: 0.02, says_nothing: +(0.98 - ps).toFixed(2) } };
    }
    else if (q.type === 'choice' && q.criteria && 'fits' in q.criteria) r.answers[k] = { choice: 'fits', confidence: 0.9, probabilities: { fits: 0.9, conflicts: 0.02, cannot_tell: 0.08 } };
    else if (q.type === 'choice' && q.criteria && 'neither' in q.criteria && 'forward' in q.criteria) r.answers[k] = { choice: 'forward', confidence: 0.9, probabilities: { forward: 0.9, reverse: 0.05, neither: 0.05 } };
    const at = q.instructions?.match(/new scene start at line L(\d+)/);
    if (at) r.answers[k] = { noul: starts ? (starts((Number(at[1]))) ? 0.92 : 0.05) : ((Number(at[1]) - 1) % SCENE_LINES === 0 ? 0.92 : 0.05) };
  }
  return r;
}

function world({ srtText = fs.readFileSync(SRT_FILE, 'utf8'), jevDelayMs = 0, jevHook = null } = {}) {
  const f = makeFetch({
    opensubtitles: async (u) => {
      if (u.includes('/subtitles?')) return u.includes('hearing_impaired=only') ? jsonResponse({ data: [{ attributes: { release: 'Test.Release.1080p', files: [{ file_id: 7 }] } }] }) : jsonResponse({ data: [] });
      if (u.endsWith('/download')) return jsonResponse({ link: 'https://files.test/sub.srt', remaining: 9 });
      throw new Error(`opensubtitles ${u}`);
    },
    other: async (u) => { if (u === 'https://files.test/sub.srt') return new Response(srtText, { status: 200 }); throw new Error(`other ${u}`); },
    tmdb: async (u) => {
      if (u.includes(`/find/${FILM.imdb_id}`)) return jsonResponse({ movie_results: [{ id: 105864, title: FILM.title, release_date: '2015-11-25', poster_path: null, overview: 'A dinosaur and a boy.' }] });
      if (u.includes('/movie/105864/credits')) return jsonResponse({ cast: [{ character: 'Arlo (voice)', name: 'A', order: 0 }, { character: 'Spot (voice)', name: 'B', order: 1 }, { character: 'Henry (voice)', name: 'C', order: 2 }] });
      return jsonResponse({ results: [], movie_results: [] });
    },
    wiki: async (u) => {
      if (u.includes('list=search')) return jsonResponse({ query: { search: [] } });
      return jsonResponse({ query: { pages: [{ pageid: 1, title: 'The Good Dinosaur', fullurl: 'https://en.wikipedia.org/wiki/The_Good_Dinosaur', pageprops: { wikibase_item: 'Q1' }, revisions: [{ revid: 42, timestamp: '2026-01-01T00:00:00Z' }], extract: `Intro.\n\n== Plot ==\n${PLOT.join(' ')}\n\n== Cast ==\nSomeone.` }] } });
    },
    wikidata: async () => jsonResponse({ entities: { Q1: { claims: { P345: [{ mainsnak: { datavalue: { value: FILM.imdb_id } } }] } } } }),
    count_tokens: async (u, init, body) => jsonResponse({ input_tokens: Math.ceil(JSON.stringify(body).length / 4) }),
    anthropic: async (u, init, body) => {
      const { kind, data } = claudeAnswer(body);
      f.claude[kind] = (f.claude[kind] ?? 0) + 1;
      return claudeStream(data, { input: 20000, output: 2000 });
    },
    jev: async (u, init, body) => {
      if (jevHook) { const r = await jevHook(body, init); if (r) return r; }
      if (jevDelayMs) await new Promise((r) => setTimeout(r, jevDelayMs));
      return jsonResponse(jevBody(body));
    },
  });
  f.claude = {};
  return f;
}

const keys = { typesafe: 'k-jev', claude: 'k-claude', tmdb: 'k-tmdb', opensubtitles: 'k-os' };
const noSleep = async () => {};

async function waitFor(fn, { timeoutMs = 60_000, everyMs = 20 } = {}) {
  const t0 = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() - t0 > timeoutMs) throw new Error('timed out waiting');
    await new Promise((r) => setTimeout(r, everyMs));
  }
}
const finished = (db, id) => waitFor(async () => { const j = await getJob(db, id); return j && (j.status === 'done' || j.status === 'failed') ? j : null; });

// The web's own statements (web/lib/queries.ts), verbatim, so a film written here is what the page reads.
const WEB_FILM_SELECT = `
  select f.slug, f.title, f.year, f.imdb_id, f.poster_url, f.overview,
         t.duration_ms, t.release_label, t.has_sound_captions,
         (select count(*)::int from scenes s where s.film_id = f.id) as scene_count
    from films f
    left join lateral (
      select tr.duration_ms, tr.release_label, tr.has_sound_captions
        from tracks tr where tr.film_id = f.id order by tr.created_at, tr.id limit 1
    ) t on true where lower(f.slug) = lower($1)`;
const WEB_SCENES = `select s.id, s.start_ms, s.end_ms, s.title, s.description,
            s.severity_5_7, s.severity_8_10,
            coalesce((
              select json_agg(json_build_object('id', t.vocabulary_id, 'channel', t.channel, 'label', t.label)
                              order by t.channel_rank, t.label)
                from (select distinct l.vocabulary_id, l.channel,
                             coalesce(v.short_label, v.label) as label,
                             case l.channel when 'presence' then 0 else 1 end as channel_rank
                        from scene_labels l
                        join vocabulary v on v.id = l.vocabulary_id
                       where l.scene_id = s.id
                         and l.asserted
                         and l.channel in ('presence', 'event')) t
            ), '[]'::json) as tags
       from scenes s
       join films f on f.id = s.film_id
      where lower(f.slug) = lower($1)
      order by s.start_ms, s.id`;

// ------------------------------------------------------------------------------------------------
// Caps
// ------------------------------------------------------------------------------------------------

test('the Jev-first reserve is the sum of the caps the stages themselves enforce', () => {
  assert.equal(JEVFIRST_CAPS.segment, SEGMENT_CAPS.film);
  assert.equal(SEGMENT_CAPS.a1 + SEGMENT_CAPS.a2 <= SEGMENT_CAPS.film, true);
  assert.equal(JEVFIRST_CAPS.split, SEGMENT_CAPS.split);
  assert.equal(JEVFIRST_CAPS.claims, CHECK_CAPS.claims);
  assert.equal(JEVFIRST_CAPS.fill_sonnet, CHECK_CAPS.fill_sonnet);
  assert.equal(JEVFIRST_CAPS.fill_jev, CHECK_CAPS.fill_jev);
  for (const k of ['classify', 'sonnetq', 'childcry', 'resolve', 'mortal', 'moments']) assert.equal(JEVFIRST_CAPS[k], ANSWER_CAPS[k], k);
  for (const k of ['describe', 'check_describe', 'describe2', 'check_describe2', 'titles', 'check_describe3']) assert.equal(JEVFIRST_CAPS[k], TEXT_CAPS[k], k);
  assert.equal(JEVFIRST_RESERVE_USD, 2.41, 'v10.4 run-film.js caps, summed');
  // every Jev cap the demo runs under is the add's own
  for (const [k, v] of Object.entries(DEMO_STAGE_CAPS)) assert.equal(v, JEVFIRST_CAPS[k], k);
  assert.equal(DEMO_RESERVE_USD, Math.round(Object.values(DEMO_STAGE_CAPS).reduce((a, b) => a + b, 0) * 1e6) / 1e6);
});

test('a Jev request its cap cannot afford is never sent, and nothing after it starts', async () => {
  let sent = 0;
  // each request is billed close to its reservation (95,000 tokens = $0.00399), as a real one can be
  const fetchImpl = async (u, init) => { sent++; return jsonResponse({ ...jevAnswer(JSON.parse(init.body)), usage: { input_tokens: 95_000, output_tokens: 1 } }); };
  const body = { model: 'jev-1.13.0', state: { lines: ['L1| hello'] }, questions: { q1: { type: 'noul', instructions: 'Is it?' } } };
  const jobs = Array.from({ length: 5 }, (_, i) => ({ body, est: 10, reserveUsd: 0.004, meta: { label: `j${i}` } }));
  const b = budget(0.01);
  const { results, stopped } = await withRun({ fetchImpl, keys: { typesafe: 'x' } }, () => runJobs(jobs, { key: 'x', budget: b, concurrency: 1 }));
  assert.equal(sent, 2, 'two requests billed $0.00399 each leave $0.002 under the $0.01 cap; the third reserves $0.004, so it and the rest are never dispatched');
  assert.equal(results.filter((r) => r.skipped === 'cap').length, 3);
  assert.match(stopped.reason, /^cap:/);
  assert.ok(b.spent <= 0.01);
});

test('a Jev error never carries the response body, which would echo subtitle lines', async () => {
  const fetchImpl = async () => new Response('{"error":"bad state: L12| I will eat you"}', { status: 400 });
  const body = { model: 'jev-1.13.0', state: { lines: ['L12| I will eat you'] }, questions: { q1: { type: 'noul', instructions: 'Is it?' } } };
  const { results } = await withRun({ fetchImpl, keys: { typesafe: 'x' } }, () => runJobs([{ body, est: 10, reserveUsd: 0.001, meta: { label: 'x' } }], { key: 'x', budget: budget(1), concurrency: 1 }));
  assert.equal(results[0].ok, false);
  assert.ok(!JSON.stringify(results[0]).includes('eat you'));
  assert.equal(results[0].record.cost_usd, 0, 'an HTTP refusal is not billed');
});

// ------------------------------------------------------------------------------------------------
// A whole add, across many invocations
// ------------------------------------------------------------------------------------------------

test('a Jev-first add runs every stage across many invocations and writes a film the web can read', async () => {
  const db = await emptyDb();
  const f = world();
  const { id } = await startJob(db, { imdb_id: FILM.imdb_id, passcode: PASSCODE }, { fetchImpl: f, keys, pipeline: 'jevfirst', jevfirst: { budgetMs: 0, sleep: noSleep } });
  const job = await finished(db, id);
  assert.equal(job.status, 'done', `${job.error_code}: ${job.error}`);
  assert.equal(job.pipeline, 'jevfirst');
  assert.equal(Number(job.reserve_usd), JEVFIRST_RESERVE_USD);
  assert.ok(job.invocations >= 15, `a zero budget hands off after every stage (${job.invocations} invocations)`);
  assert.equal(job.lease_owner, null);

  // the steps the page shows: the contract's ids, in order, all done
  const pub = await jobStatus(db, id);
  assert.deepEqual(pub.steps.map((s) => s.id), ['subtitles', 'sources', 'segment', 'split_check', 'claims', 'classify', 'sonnetq', 'moments', 'describe', 'check_describe', 'ingest']);
  assert.deepEqual(pub.steps.map((s) => s.status), Array(11).fill('done'));
  assert.equal(pub.steps.find((s) => s.id === 'segment').label, 'Sonnet reads the film');
  for (const s of pub.steps) { assert.ok(s.started_ms !== null && s.ended_ms >= s.started_ms, s.id); assert.ok(s.detail, s.id); }

  // Sonnet was called exactly where the pipeline calls it, once each (no stage ran twice)
  assert.equal(f.claude.segment, 1);
  assert.ok(f.claude.sonnetq >= 1);
  assert.ok(f.claude.describe >= 1);

  // money: the row reads what was committed, never more than the reserve, and the ledger agrees
  const cost = Number(job.cost_usd);
  assert.ok(cost > 0 && cost <= JEVFIRST_RESERVE_USD);
  const slug = job.film.slug;
  const { rows: led } = await db.query('select sum(usd)::float as usd, count(*)::int as n from jevfirst_ledger where slug = $1', [slug]);
  assert.ok(Math.abs(led[0].usd - cost) < 1e-5, `ledger ${led[0].usd} vs job ${cost}`);

  // the web's own queries read the film
  const { rows: films } = await db.query(WEB_FILM_SELECT, [slug]);
  assert.equal(films.length, 1);
  assert.equal(films[0].title, FILM.title);
  assert.equal(films[0].release_label, 'Test.Release.1080p');
  assert.ok(Number(films[0].duration_ms) > 0);
  assert.ok(films[0].scene_count > 0);
  const { rows: scenes } = await db.query(WEB_SCENES, [slug]);
  assert.equal(scenes.length, films[0].scene_count);
  assert.equal(scenes.length, job.scene_count);
  for (const s of scenes) {
    assert.ok(s.title && typeof s.title === 'string');
    assert.ok(Number(s.end_ms) >= Number(s.start_ms));
    for (const sev of [s.severity_5_7, s.severity_8_10]) assert.ok(sev === null || (sev >= 0 && sev <= 3));
  }
  assert.ok(scenes.some((s) => (typeof s.tags === 'string' ? JSON.parse(s.tags) : s.tags).length > 0), 'asserted labels reach the page');
  // v10.4 (b): every flagged scene shows WHY as chips -- its flag reasons, and only they, are its event chips
  const { rows: sel } = await db.query("select doc from jevfirst_artifacts where slug = $1 and kind = 'tags'", [slug]);
  const tagsDoc = typeof sel[0].doc === 'string' ? JSON.parse(sel[0].doc) : sel[0].doc;
  const flaggedDocs = tagsDoc.scenes.filter((x) => x.flagged);
  assert.equal(flaggedDocs.length, scenes.length);
  for (const s of scenes) {
    const chips = typeof s.tags === 'string' ? JSON.parse(s.tags) : s.tags;
    const events = chips.filter((c) => c.channel === 'event');
    const doc = flaggedDocs.find((x) => s.id === `${slug}:${x.id}`);
    assert.ok(events.length > 0, `${s.id} shows why`);
    assert.ok(events.every((c) => c.id.startsWith('reason:')), `${s.id}: event chips are the flag reasons`);
    // a film-specific reason ('Arlo in danger') is filed under its stable category ('Character in danger'):
    // the chip and the filter are the category, the film's own words stay in why_tags as the detail
    assert.deepEqual(events.map((c) => c.label).sort(), [...new Set(doc.why_tags.tags.map((t) => reasonCategory(t.rule) ?? t.label))].sort());
    const stored = typeof s.why_tags === 'string' ? JSON.parse(s.why_tags) : s.why_tags;
    if (stored) for (const t of stored.tags) if (t.category) assert.notEqual(t.category, t.label);
  }
  // who raised each reason is on the label row (the model), and the vocabulary endpoint does not list the chips
  const { rows: srcs } = await db.query("select distinct source from scene_labels where vocabulary_id like 'reason:%'");
  assert.ok(srcs.every((r) => ['jev-1.13.0', 'claude-sonnet-5'].includes(r.source)));
  const { getVocabulary } = await import('../lib/data.js');
  assert.ok((await getVocabulary(db)).every((v) => !v.id.startsWith('reason:')));
  // v10.4 (a): the text rule. Attempt 1's sentence passed only loosely, so the second attempt ran and its
  // strictly confirmed sentence is shown; the title pass wrote the confirmed title. Nothing unchecked is shown.
  assert.ok(f.claude.describe2 >= 1 && f.claude.titles >= 1, JSON.stringify(f.claude));
  for (const s of scenes) {
    assert.ok([null, 'Arlo cries for help by the river.', 'Arlo is in danger by the river.'].includes(s.description), s.description);
    assert.ok(['Arlo cries for help', 'Flagged scene'].includes(s.title), s.title);
  }
  assert.ok(scenes.some((s) => s.description === 'Arlo cries for help by the river.' && s.title === 'Arlo cries for help'));
  const { rows: st } = await db.query("select stage from job_stages where job_id = $1 and status = 'done'", [id]);
  for (const k of ['resolve', 'mortal', 'describe2', 'check_describe2', 'titles', 'check_describe3', 'mergetext', 'select3']) assert.ok(st.some((r) => r.stage === k), k);

  // the artifacts the demo reads are there, and the film is offered to the demo
  const { rows: kinds } = await db.query('select kind from jevfirst_artifacts where slug = $1 order by kind', [slug]);
  for (const k of DEMO_KINDS) assert.ok(kinds.some((r) => r.kind === k), k);
  const listed = await demoFilms(db);
  assert.equal(listed.length, 1);
  assert.equal(listed[0].in_library, true);
  await db.end();
});

// ------------------------------------------------------------------------------------------------
// Orchestration: lease, crash, idempotency, resume by poll, stale
// ------------------------------------------------------------------------------------------------

async function admitted(db, f, opts = {}) {
  // `launch` that does nothing: the test drives the invocations itself
  const { id } = await startJob(db, { imdb_id: FILM.imdb_id, passcode: PASSCODE }, { fetchImpl: f, keys, pipeline: 'jevfirst', launch: () => {}, ...opts });
  return id;
}

test('the lease admits one invocation: a second one while the first holds it does nothing', async () => {
  const db = await emptyDb();
  const f = world();
  const id = await admitted(db, f);
  const first = await acquireLease(db, id, 'owner-a');
  assert.ok(first);
  assert.equal(await acquireLease(db, id, 'owner-b'), null);
  const r = await advanceJob(db, id, { fetchImpl: f, keys, sleep: noSleep });
  assert.equal(r.acquired, false);
  const { rows } = await db.query('select count(*)::int as n from job_stages where job_id = $1', [id]);
  assert.equal(rows[0].n, 0, 'the refused invocation did no work');
  await db.end();
});

test('two continuations at once: exactly one works, and a finished stage is never run again', async () => {
  process.env.CONTINUE_SECRET = 'cs';
  try {
    const db = await emptyDb();
    const f = world({ jevDelayMs: 1 });
    const id = await admitted(db, f);
    const opts = { fetchImpl: f, keys, sleep: noSleep, budgetMs: 0, continueJob: async () => {} };
    const a = continueJob(db, id, 'cs', opts);
    const b = continueJob(db, id, 'cs', opts);
    const [ra, rb] = await Promise.all([a.done, b.done]);
    assert.equal([ra, rb].filter((r) => r.acquired).length, 1);
    assert.throws(() => continueJob(db, id, 'wrong', opts), (e) => e.status === 401);
    // run to the end, one invocation at a time
    for (let i = 0; i < 40; i++) {
      const r = await advanceJob(db, id, opts);
      if (!r.acquired) break;
      if (r.status !== 'running') break;
    }
    const job = await getJob(db, id);
    assert.equal(job.status, 'done', `${job.error_code}: ${job.error}`);
    const calls = { ...f.calls };
    const again = await advanceJob(db, id, opts);
    assert.equal(again.acquired, false, 'a finished job takes no lease');
    assert.deepEqual(f.calls, calls, 'and makes no call');
    assert.equal(f.claude.segment, 1);
    await db.end();
  } finally { delete process.env.CONTINUE_SECRET; }
});

test('an invocation that dies mid-stage is resumed from its checkpoint, with its money carried', async () => {
  const db = await emptyDb();
  // classify requests hang after the tenth, until the invocation that sent them is cancelled
  let classifyCalls = 0;
  let hang = true;
  const f = world({
    jevHook: async (body, init) => {
      const isClassify = Object.keys(body.questions).every((k) => /^q\d+$/.test(k)) && body.state?.scene;
      if (!isClassify || !hang) return null;
      classifyCalls++;
      if (classifyCalls <= 10) return null;
      return new Promise((_, reject) => init.signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))));
    },
  });
  const id = await admitted(db, f);
  const base = { fetchImpl: f, keys, sleep: noSleep, budgetMs: 10_000_000, heartbeatMs: 30, continueJob: async () => {} };
  // invocations run (handing off at the Sonnet stages that must start fresh) until one hangs in
  // classify; that one never finishes on its own
  const hung = () => waitFor(async () => { const { rows } = await db.query("select status from job_stages where job_id = $1 and stage = 'classify'", [id]); return rows[0]?.status === 'running' && classifyCalls > 10 ? 'hung' : null; });
  const hungP = hung();
  let zombie = null;
  for (let i = 0; i < 20 && !zombie; i++) {
    const inv = advanceJob(db, id, base);
    const first = await Promise.race([inv.then(() => 'returned'), hungP]);
    if (first === 'hung') zombie = inv;
  }
  assert.ok(zombie, 'an invocation reached classify and hung there');
  const segmentCalls = f.claude.segment;
  // the platform kills it: its lease is past, and a new invocation takes the job over
  await db.query('update jobs set lease_until = now() - interval \'1 second\' where id = $1', [id]);
  hang = false;
  const r = await advanceJob(db, id, base);
  assert.equal(r.acquired, true);
  assert.equal(r.status, 'done', JSON.stringify(r));
  const z = await zombie;
  assert.equal(z.lostLease, true, 'the dead invocation noticed its lease was gone and stopped without writing');
  const job = await getJob(db, id);
  assert.equal(job.status, 'done');
  assert.equal(job.crash_count, 1);
  assert.equal(f.claude.segment, segmentCalls, 'nothing before the crashed stage ran again');
  const { rows } = await db.query("select attempt, carried from job_stages where job_id = $1 and stage = 'classify'", [id]);
  assert.equal(rows[0].attempt, 2);
  const carried = typeof rows[0].carried === 'string' ? JSON.parse(rows[0].carried) : rows[0].carried;
  assert.ok(carried.jev > 0, 'the crashed attempt\'s persisted high-water mark is carried into the cost');
  const { rows: led } = await db.query("select sum(usd)::float as usd from jevfirst_ledger where stage = 'classify'");
  assert.ok(led[0].usd >= carried.jev);
  await db.end();
});

test('a job whose continuation never landed is resumed by the next poll, and only one poll kicks it', async () => {
  const db = await emptyDb();
  const f = world();
  const id = await admitted(db, f);
  // one invocation that runs one stage and "loses" its continuation
  const r = await advanceJob(db, id, { fetchImpl: f, keys, sleep: noSleep, budgetMs: 0, continueJob: async () => {} });
  assert.equal(r.handedOff, true);
  let kicks = 0;
  const kick = () => { kicks++; };
  await jobStatus(db, id, { kick });
  assert.equal(kicks, 0, 'a job that just handed off is given time for its continuation to land');
  await db.query("update jobs set progress_at = now() - interval '1 minute' where id = $1", [id]);
  await jobStatus(db, id, { kick });
  await jobStatus(db, id, { kick });
  assert.equal(kicks, 1, 'exactly one poll claims the kick');
  await db.end();
});

test('a Jev-first job nobody has run for twenty minutes is failed by the stale sweep; a leased one is not', async () => {
  const db = await emptyDb();
  await db.query(`insert into jobs (id, status, film, pipeline, reserve_usd, cost_usd, progress_at, lease_until)
                  values ('stale-jevfirst-00000000', 'running', '{}'::jsonb, 'jevfirst', 2.11, 2.11, now() - interval '30 minutes', null)`);
  assert.equal(await liveJob(db), null);
  const j = await getJob(db, 'stale-jevfirst-00000000');
  assert.equal(j.status, 'failed');
  assert.equal(j.error_code, 'timed_out');
  assert.equal(Number(j.cost_usd), 2.11, 'a dead run keeps its reserve: nothing reconciled it');
  await db.query(`insert into jobs (id, status, film, pipeline, reserve_usd, cost_usd, progress_at, lease_until)
                  values ('leased-jevfirst-0000000', 'running', '{}'::jsonb, 'jevfirst', 2.11, 2.11, now() - interval '30 minutes', now() + interval '2 minutes')`);
  assert.equal((await liveJob(db))?.id, 'leased-jevfirst-0000000');
  await db.end();
});

// ------------------------------------------------------------------------------------------------
// Admission
// ------------------------------------------------------------------------------------------------

test('admission reserves the Jev-first worst case against the daily cap', async () => {
  const db = await emptyDb();
  const f = world();
  process.env.ADD_FILM_DAILY_CAP_USD = '2';
  try {
    await assert.rejects(admitted(db, f), (e) => e.status === 429 && e.extra.error_code === 'daily_cap' && e.extra.reserve_usd === JEVFIRST_RESERVE_USD);
  } finally { process.env.ADD_FILM_DAILY_CAP_USD = '10'; }
  await db.end();
});

test('on Vercel with no continuation secret a Jev-first add is refused, not started and stranded', async () => {
  const db = await emptyDb();
  process.env.VERCEL = '1';
  try {
    await assert.rejects(admitted(db, world()), (e) => e.status === 503 && e.extra.error_code === 'no_continue_secret');
  } finally { delete process.env.VERCEL; }
  await db.end();
});

// ------------------------------------------------------------------------------------------------
// The demo
// ------------------------------------------------------------------------------------------------

const SRT_TEXT = () => fs.readFileSync(SRT_FILE, 'utf8');
const parsedDoc = (v) => (typeof v === 'string' ? JSON.parse(v) : v);

/** The demo's stored Sonnet work: one stubbed add of the synthetic film, run once, its artifacts kept. */
let DEMO_SEED = null;
async function demoSeed() {
  if (DEMO_SEED) return DEMO_SEED;
  const db = await emptyDb();
  const { id } = await startJob(db, { imdb_id: FILM.imdb_id, passcode: PASSCODE }, { fetchImpl: world(), keys, pipeline: 'jevfirst', jevfirst: { sleep: noSleep } });
  const job = await finished(db, id);
  assert.equal(job.status, 'done', `the seed add failed: ${job.error_code}: ${job.error}`);
  const { rows } = await db.query('select kind, doc from jevfirst_artifacts where slug = $1', [job.film.slug]);
  DEMO_SEED = { docs: Object.fromEntries(rows.map((r) => [r.kind, parsedDoc(r.doc)])) };
  await db.end();
  return DEMO_SEED;
}

/** A database holding only the demo film's artifacts and track (not in the library unless asked). */
async function seededDb({ inLibrary = false } = {}) {
  const { docs } = await demoSeed();
  const db = await emptyDb();
  await storeTrack(db, DEMO_FILM.imdb_id, { srtText: SRT_TEXT() });
  await db.withTransaction((tx) => writeArtifacts(tx, DEMO_FILM, docs, { origin: 'seed', pipelineVersion: 'test', demoReserveUsd: DEMO_RESERVE_USD }));
  if (inLibrary) await libraryFilm(db);
  return db;
}

test('a demo run is Jev live on stored Sonnet work: measured progress, no Sonnet call, held to its reservation', async () => {
  const db = await seededDb();
  const f = world({ jevDelayMs: 1 });
  const films = await demoFilms(db);
  assert.deepEqual(films.map((x) => [x.slug, x.in_library]), [[DEMO_FILM.slug, false]]);
  assert.ok(films[0].scene_count > 0 && films[0].cut_count === films[0].scene_count - 1 && films[0].sentence_count > 0);
  const st = await demoStatus(db);
  assert.equal(st.available, true);
  assert.equal(st.spent_today_usd, 0);

  const { id, done } = await startDemoRun(db, { slug: DEMO_FILM.slug }, { ip: 'a', runOpts: { fetchImpl: f, keys: { typesafe: 'x' }, sleep: noSleep, flushMs: 5 } });
  const mid = await demoRun(db, id);
  assert.ok(['queued', 'running'].includes(mid.status));
  const res = await done;
  assert.equal(res.status, 'done', JSON.stringify(res));
  const r = await demoRun(db, id);
  assert.equal(r.status, 'done');
  assert.equal(f.calls.anthropic + f.calls.count_tokens, 0, 'Sonnet is never called by a demo run');
  // every counter is a count of completed requests, and every total the number actually sent
  const sent = f.calls.jev;
  // split_check and claims count cuts and sentences in done/total, and every request in requests_*
  const doneAll = Object.values(r.stages).reduce((a, s) => a + (s.requests_done ?? s.done), 0);
  assert.equal(doneAll, sent);
  for (const [k, s] of Object.entries(r.stages)) {
    assert.equal(s.done, s.total, k);
    if ('requests_done' in s) assert.equal(s.requests_done, s.requests_total, k);
  }
  assert.ok(r.stages.split_check.total > 0 && r.stages.split_check.total < r.stages.split_check.requests_total, 'one counted check per cut, fewer than all its requests');
  assert.ok(r.stages.claims.total > 0 && r.stages.claims.total <= r.stages.claims.requests_total);
  assert.equal(r.stages.claims.supported + r.stages.claims.unsupported + r.stages.claims.contradicted, r.stages.claims.done, 'every counted sentence has Jev\'s answer');
  // ...which is provisional: the run ends by reconciling it with what the guide kept
  const fin = r.stages.claims.final;
  assert.ok(fin && fin.summary.checked > 0 && fin.summary.kept + fin.summary.left_out === fin.summary.checked);
  assert.equal(fin.descriptions.scenes, r.result.flagged.length);
  assert.ok(r.feed.filter((e) => e.kind === 'claim').every((e) => ['supported', 'unsupported', 'contradicted'].includes(e.verdict) && ['kept', 'left_out'].includes(e.final)));
  assert.ok(r.stages.split_check.doubtful <= r.stages.split_check.total);
  assert.ok(r.stages.classify.answers > r.stages.classify.done);
  assert.ok(r.scenes.length > 0 && r.scenes.every((s) => s.state === 'answered'));
  assert.ok(r.scenes.every((s) => typeof s.flagged === 'boolean'));
  assert.ok(r.feed.length > 0 && r.feed.every((e) => ['cut', 'claim', 'scene', 'probe'].includes(e.kind) && typeof e.at_ms === 'number'));
  assert.ok(r.feed.filter((e) => e.kind !== 'scene').every((e) => typeof e.scene === 'string'), 'every feed item names its scene');
  assert.ok(r.cost_usd > 0 && r.cost_usd <= DEMO_RESERVE_USD);
  assert.ok(Array.isArray(r.result.flagged));
  for (const x of r.result.flagged) {
    assert.ok(x.scene_id && x.end_ms >= x.start_ms);
    assert.ok(x.title === null || (typeof x.title === 'string' && x.title !== 'Flagged scene'), 'a scene with no checked title has title null, never the placeholder');
    // every flagged scene says why: its reasons as plain tags, with who answered each
    assert.ok(x.reasons.length > 0 && x.why_line === x.reasons.map((y) => y.label).join(' · '), x.scene_id);
    assert.ok(x.reasons.every((y) => ['jev', 'sonnet'].includes(y.by) && y.by_all.includes(y.by)));
    assert.ok(x.text_rule === null || ['strict', 'loose'].includes(x.text_rule));
    assert.ok('5_7' in x.strength_by_band && '8_10' in x.strength_by_band);
    const tile = r.scenes.find((sc) => sc.id === x.scene_id);
    assert.ok(tile.flagged && tile.why.length === x.reasons.length);
    // ...and, for the scene up close, each reason's question as asked, Jev's line and the rule
    assert.equal(x.why.line, x.why_line);
    assert.deepEqual(x.why.tags.map((t) => t.label), x.reasons.map((y) => y.label));
    for (const t of x.why.tags) {
      assert.ok(typeof t.question === 'string' && t.question.length > 5, `${x.scene_id} ${t.label} has its question`);
      assert.ok(typeof t.rule === 'string');
      if (t.by[0] === 'jev') assert.ok(t.act === null || (t.act > 0 && t.act < 1));
    }
  }
  assert.ok(r.result.compare_stored_run && r.result.compare_stored_run.guide_scenes > 0, 'compared with the film\'s last full run');
  assert.ok(r.feed.some((e) => e.kind === 'scene' && e.verdict === 'flagged'));
  // the Jev-only v10.4 stages ran live: the resolution guard / mortal questions count as answered questions
  assert.ok(r.stages.claims.done > 0);
  assert.equal(r.result.compare, null, 'a film with no guide in the library has nothing to compare with, which is not zero');
  const after = await demoStatus(db);
  assert.ok(Math.abs(after.spent_today_usd - r.cost_usd) < 1e-6, 'the day reads the reconciled cost, not the reservation');
  await db.end();
});

test('the demo daily cap is a reservation: a second run that would pass it is refused while the first is live', async () => {
  const db = await seededDb();
  let release;
  const gate = new Promise((r) => { release = r; });
  const f = world({ jevHook: async () => { await gate; return null; } });
  process.env.DEMO_DAILY_CAP_USD = String(DEMO_RESERVE_USD * 1.5);
  try {
    const one = await startDemoRun(db, { slug: DEMO_FILM.slug }, { ip: 'a', runOpts: { fetchImpl: f, keys: { typesafe: 'x' }, sleep: noSleep } });
    await assert.rejects(startDemoRun(db, { slug: DEMO_FILM.slug }, { ip: 'b', runOpts: { fetchImpl: f, keys: { typesafe: 'x' } } }), (e) => e.status === 429 && e.extra.error_code === 'daily_cap');
    assert.equal((await demoStatus(db)).available, false);
    release();
    await one.done;
    // reconciled to its real cost, the day has room again
    const two = await startDemoRun(db, { slug: DEMO_FILM.slug }, { ip: 'b', runOpts: { fetchImpl: f, keys: { typesafe: 'x' }, sleep: noSleep } });
    await two.done;
  } finally { delete process.env.DEMO_DAILY_CAP_USD; release(); }
  await db.end();
});

test('at most two demo runs at once, and one client may start five in ten minutes', async () => {
  const db = await seededDb();
  let release;
  const gate = new Promise((r) => { release = r; });
  const slow = world({ jevHook: async () => { await gate; return null; } });
  process.env.DEMO_DAILY_CAP_USD = '100';
  try {
    const runs = [
      await startDemoRun(db, { slug: DEMO_FILM.slug }, { ip: 'x', runOpts: { fetchImpl: slow, keys: { typesafe: 'x' }, sleep: noSleep } }),
      await startDemoRun(db, { slug: DEMO_FILM.slug }, { ip: 'y', runOpts: { fetchImpl: slow, keys: { typesafe: 'x' }, sleep: noSleep } }),
    ];
    await assert.rejects(startDemoRun(db, { slug: DEMO_FILM.slug }, { ip: 'z', runOpts: { fetchImpl: slow, keys: { typesafe: 'x' } } }), (e) => e.status === 409 && e.extra.error_code === 'busy');
    release();
    await Promise.all(runs.map((r) => r.done));
    const fast = world();
    for (let i = 0; i < 4; i++) await (await startDemoRun(db, { slug: DEMO_FILM.slug }, { ip: 'x', runOpts: { fetchImpl: fast, keys: { typesafe: 'x' }, sleep: noSleep } })).done;
    await assert.rejects(startDemoRun(db, { slug: DEMO_FILM.slug }, { ip: 'x', runOpts: { fetchImpl: fast, keys: { typesafe: 'x' } } }), (e) => e.status === 429 && e.extra.error_code === 'too_many_runs');
    await startDemoRun(db, { slug: DEMO_FILM.slug }, { ip: 'someone-else', runOpts: { fetchImpl: fast, keys: { typesafe: 'x' }, sleep: noSleep } }).then((r) => r.done);
  } finally { delete process.env.DEMO_DAILY_CAP_USD; release(); }
  await db.end();
});

test('a demo refuses a film it has no stored analysis for, and an unknown run id', async () => {
  const db = await emptyDb();
  await assert.rejects(startDemoRun(db, { slug: 'nemo' }, { ip: 'a' }), (e) => e.status === 404 && e.extra.error_code === 'no_such_film');
  await assert.rejects(startDemoRun(db, { slug: '../x' }, { ip: 'a' }), (e) => e.status === 400);
  await assert.rejects(demoRun(db, 'AAAAAAAAAAAAAAAAAAAAAA'), (e) => e.status === 404);
  await db.end();
});

test('compare counts a run scene and a guide scene as the same when they overlap by half the shorter', () => {
  const run = [{ start_ms: 0, end_ms: 100 }, { start_ms: 500, end_ms: 600 }];
  const guide = [{ id: 'g1', start_ms: 40, end_ms: 200 }, { id: 'g2', start_ms: 900, end_ms: 1000 }];
  assert.deepEqual(compareWithGuide(run, guide), { both: 1, only_run: 1, only_guide: 1, guide_scenes: 2, run_scenes: 2 });
  assert.equal(compareWithGuide(run, null), null);
  // one to one: a long run scene cannot stand for two guide scenes (Astra's reproduction)
  const wide = compareWithGuide([{ start_ms: 0, end_ms: 1000 }], [{ id: 'a', start_ms: 0, end_ms: 100 }, { id: 'b', start_ms: 900, end_ms: 1000 }]);
  assert.deepEqual(wide, { both: 1, only_run: 0, only_guide: 1, guide_scenes: 2, run_scenes: 1 });
});

test('seeding writes the artifact tables and never the live guide tables', async () => {
  const db = await freshDb();
  const { loadAll } = await import('../load.js');
  await loadAll(db, { tmdbApiKey: null });
  const count = async () => (await db.query('select (select count(*) from films)::int f, (select count(*) from scenes)::int s, (select count(*) from scene_labels)::int l')).rows[0];
  const before = await count();
  await storeTrack(db, DEMO_FILM.imdb_id, { srtText: SRT_TEXT() });
  const { docs } = await demoSeed();
  await db.withTransaction((tx) => writeArtifacts(tx, DEMO_FILM, { segments_precheck: docs.segments_precheck }, { origin: 'seed', pipelineVersion: 'test' }));
  assert.deepEqual(await count(), before);
  await db.end();
});

// ------------------------------------------------------------------------------------------------
// Rebuilds: a library film re-run by the new pipeline, its old guide backed up and restorable
// ------------------------------------------------------------------------------------------------

async function libraryFilm(db) {
  const { ensureVocabulary, insertRows } = await import('../load.js');
  const taxonomy = await import('../pipeline-jevfirst/taxonomy-v3.js');
  await db.withTransaction(async (tx) => {
    await ensureVocabulary(tx, taxonomy);
    await insertRows(tx, 'films', [{ id: 'good-dinosaur', slug: 'good-dinosaur', title: FILM.title, year: 2015, imdb_id: FILM.imdb_id, poster_url: 'https://img.test/old.jpg', overview: 'The old synopsis.' }]);
    await insertRows(tx, 'tracks', [{ id: 'good-dinosaur:old', film_id: 'good-dinosaur', source: 'app-database', release_label: 'Old.Release', language: 'en', has_sound_captions: false, cue_count: 10, duration_ms: 5_000_000, sha256: 'x' }]);
    await insertRows(tx, 'analysis_runs', [{ id: 'good-dinosaur:old-run', film_id: 'good-dinosaur', track_id: 'good-dinosaur:old', role: 'finder', model: 'old-model' }]);
    await insertRows(tx, 'scenes', [{ id: 'good-dinosaur:OLD1', film_id: 'good-dinosaur', track_id: 'good-dinosaur:old', run_id: 'good-dinosaur:old-run', start_ms: 1000, end_ms: 2000, title: 'The old scene', severity_5_7: 2, severity_8_10: 1, review_status: 'unreviewed', description: 'Old words.' }]);
    await insertRows(tx, 'scene_labels', [{ id: 'good-dinosaur:OLD1:presence:shark:x', scene_id: 'good-dinosaur:OLD1', vocabulary_id: 'shark', channel: 'presence', source: 'old-model', probability: null, asserted: true, review_status: 'unreviewed' }]);
  });
}

test('a rebuild replaces a library film\'s guide in one step, keeps the old one as a backup, and a restore puts it back', async () => {
  const { startRebuild, restore, backups } = await import('../lib/admin.js');
  const db = await emptyDb();
  await libraryFilm(db);
  const f = world();
  await assert.rejects(startRebuild(db, { slug: 'good-dinosaur', passcode: 'nope' }, { fetchImpl: f, keys }), (e) => e.status === 401);
  await assert.rejects(startRebuild(db, { slug: 'no-such-film', passcode: PASSCODE }, { fetchImpl: f, keys }), (e) => e.status === 404);
  const before = (await db.query(WEB_SCENES, ['good-dinosaur'])).rows;
  assert.deepEqual(before.map((s) => s.title), ['The old scene']);

  // while it runs the page keeps reading the old guide; at the end the new one replaces it at once
  const { id, done } = await startRebuild(db, { slug: 'good-dinosaur', passcode: PASSCODE }, { fetchImpl: f, keys, jevfirst: { budgetMs: 0, sleep: noSleep } });
  await assert.rejects(startRebuild(db, { slug: 'good-dinosaur', passcode: PASSCODE }, { fetchImpl: f, keys, launch: () => {} }), (e) => e.status === 409 && e.extra.error_code === 'busy');
  await done;
  const job = await finished(db, id);
  assert.equal(job.status, 'done', `${job.error_code}: ${job.error}`);
  assert.equal(job.kind, 'rebuild');
  const pub = await jobStatus(db, id);
  assert.equal(pub.kind, 'rebuild');
  const { rows: filmRows } = await db.query('select * from films');
  assert.equal(filmRows.length, 1, 'no second film: the library film was rebuilt in place');
  assert.equal(filmRows[0].poster_url, 'https://img.test/old.jpg', 'the film row (poster, synopsis) is kept');
  const after = (await db.query(WEB_SCENES, ['good-dinosaur'])).rows;
  assert.ok(after.length > 0 && after.every((s) => s.title !== 'The old scene'));
  const { rows: fr } = await db.query(WEB_FILM_SELECT, ['good-dinosaur']);
  assert.equal(fr[0].release_label, 'Test.Release.1080p', 'the new track replaced the old one');
  const { rows: tr } = await db.query("select count(*)::int n from tracks where film_id = 'good-dinosaur'");
  assert.equal(tr[0].n, 1);

  const list = await backups(db, { slug: 'good-dinosaur', passcode: PASSCODE });
  assert.equal(list.backups.length, 1);
  assert.equal(list.backups[0].reason, 'rebuild');
  assert.equal(list.backups[0].scene_count, 1);
  assert.equal(list.backups[0].job_id, id);

  // restore: the old guide is back exactly, and the rebuilt one is itself backed up
  const r = await restore(db, { backup_id: list.backups[0].id, passcode: PASSCODE });
  assert.equal(r.scenes, 1);
  const restored = (await db.query(WEB_SCENES, ['good-dinosaur'])).rows;
  assert.deepEqual(restored.map((s) => [s.title, s.description, s.severity_5_7]), [['The old scene', 'Old words.', 2]]);
  assert.deepEqual((typeof restored[0].tags === 'string' ? JSON.parse(restored[0].tags) : restored[0].tags).map((t) => t.id), ['shark']);
  const list2 = await backups(db, { slug: 'good-dinosaur', passcode: PASSCODE });
  assert.equal(list2.backups.length, 2);
  assert.match(list2.backups[0].reason, /^before_restore_of_/);
  assert.equal(list2.backups[0].scene_count, after.length);
  // and undo the restore: the rebuilt guide comes back
  await restore(db, { backup_id: list2.backups[0].id, passcode: PASSCODE });
  assert.equal((await db.query(WEB_SCENES, ['good-dinosaur'])).rows.length, after.length);
  await db.end();
});

test('a rebuild that fails leaves the library film\'s guide exactly as it was', async () => {
  const { startRebuild } = await import('../lib/admin.js');
  const db = await emptyDb();
  await libraryFilm(db);
  // Jev refuses every request from the split check on: the run fails before anything is written
  const f = world({ jevHook: async () => new Response('{}', { status: 400 }) });
  const { id, done } = await startRebuild(db, { slug: 'good-dinosaur', passcode: PASSCODE }, { fetchImpl: f, keys, jevfirst: { sleep: noSleep } });
  await done;
  const job = await finished(db, id);
  assert.equal(job.status, 'failed');
  const now = (await db.query(WEB_SCENES, ['good-dinosaur'])).rows;
  assert.deepEqual(now.map((s) => s.title), ['The old scene']);
  const { rows } = await db.query('select count(*)::int n from guide_backups');
  assert.equal(rows[0].n, 0);
  await db.end();
});

// ------------------------------------------------------------------------------------------------
// Deployment plumbing: the schema, the continuation secret, the default pipeline, the one router
// ------------------------------------------------------------------------------------------------

test('the API brings the Jev-first schema up itself, once, on a database that has only the base schema', async () => {
  const { ensureSchema, ensureSchemaOnce } = await import('../lib/ensure-schema.js');
  const { JEVFIRST_SCHEMA_SQL } = await import('../lib/schema-jevfirst.js');
  const db = await freshDb();
  await db.exec(fs.readFileSync(new URL('../schema.sql', import.meta.url), 'utf8'));
  await db.query("insert into jobs (id, status, film) values ('old-job-00000000000000', 'done', '{}'::jsonb)");
  assert.equal(await ensureSchema(db), 'applied');
  assert.equal(await ensureSchema(db), 'present', 'a second cold start sees the mark and does nothing');
  assert.equal(await ensureSchemaOnce(db), 'present');
  const { rows } = await db.query("select pipeline, kind from jobs where id = 'old-job-00000000000000'");
  assert.deepEqual(rows[0], { pipeline: 'live', kind: 'add' }, 'existing rows get the defaults');
  // the emitted file is the module's SQL, byte for byte
  assert.equal(fs.readFileSync(new URL('../schema-jevfirst.sql', import.meta.url), 'utf8'), JEVFIRST_SCHEMA_SQL);
  // and applying it again over a populated database is harmless
  await db.exec(JEVFIRST_SCHEMA_SQL);
  await db.end();
});

test('continuations use ADD_FILM_PROXY_SECRET (no new variable) and call the production domain on production', async () => {
  const { continuation, continueBase, requireContinueSecret, pipelineMode } = await import('../lib/jevfirst.js');
  const saved = { ...process.env };
  try {
    delete process.env.CONTINUE_SECRET; delete process.env.ADD_PIPELINE;
    assert.equal(pipelineMode(), 'jevfirst', 'the new pipeline is the default');
    process.env.ADD_PIPELINE = 'live';
    assert.equal(pipelineMode(), 'live', 'and the env can switch back');
    process.env.VERCEL = '1';
    delete process.env.ADD_FILM_PROXY_SECRET;
    assert.equal(continuation().mode, 'none');
    process.env.ADD_FILM_PROXY_SECRET = 'proxy-secret';
    Object.assign(process.env, { VERCEL_ENV: 'production', VERCEL_PROJECT_PRODUCTION_URL: 'scenes.example.app', VERCEL_URL: 'scene-api-abc123.vercel.app' });
    assert.deepEqual(continuation(), { mode: 'http', base: 'https://scenes.example.app', secret: 'proxy-secret' });
    assert.equal(continueBase({ VERCEL_ENV: 'preview', VERCEL_URL: 'x-1.vercel.app' }), 'https://x-1.vercel.app');
    assert.doesNotThrow(() => requireContinueSecret('proxy-secret'));
    assert.throws(() => requireContinueSecret('guess'), (e) => e.status === 401);
  } finally {
    for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
    Object.assign(process.env, saved);
  }
});

test('a continuation that lands is authenticated, answered 202 at once, and runs the job\'s next invocation', async () => {
  const db = await emptyDb();
  const f = world();
  const id = await admitted(db, f);
  const { requestContinuation } = await import('../lib/jevfirst.js');
  const { route } = await import('../server.js');
  const { setDb } = await import('../lib/db.js');
  setDb(db);
  const saved = { ...process.env };
  process.env.ADD_FILM_PROXY_SECRET = 'proxy-secret';
  process.env.CONTINUE_BASE_URL = 'http://scene-api.test';
  Object.assign(process.env, { OPENSUBTITLES_API_KEY: 'k-os', CLAUDE_API_KEY: 'k-claude' });
  // the invocation the router starts uses the process's fetch and env keys: point both at the stub world
  // (and the chain's own self-calls back into the router), so the job runs to the end off the network
  const realFetch = globalThis.fetch;
  let selfFetch;
  globalThis.fetch = (url, init) => (String(url).startsWith('http://scene-api.test/') ? selfFetch(url, init) : f(url, init));
  try {
    // the self-call goes to our own router (server.js routes it exactly as vercel.json's rewrite does)
    let status = null;
    selfFetch = async (url, init) => {
      const u = new URL(url);
      const { Readable } = await import('node:stream');
      const req = Object.assign(Readable.from([init.body ?? '']), { url: u.pathname, method: init.method, headers: Object.fromEntries(Object.entries(init.headers).map(([k, v]) => [k.toLowerCase(), v])) });
      const chunks = [];
      const res = { statusCode: 200, headers: {}, setHeader(k, v) { this.headers[k] = v; }, end(b) { if (b) chunks.push(b); this.writableEnded = true; }, writableEnded: false };
      await route(req, res);
      status = res.statusCode;
      return new Response(chunks.join(''), { status: res.statusCode });
    };
    const out = await requestContinuation(id, { fetchImpl: selfFetch });
    assert.equal(out.status, 202);
    assert.equal(status, 202);
    await waitFor(async () => (await getJob(db, id)).invocations >= 1);
    // a wrong secret is refused before anything runs
    const res2 = await selfFetch(`http://scene-api.test/api/add/jobs/${id}/continue`, { method: 'POST', headers: { 'x-continue-secret': 'guess' }, body: '{}' });
    assert.equal(res2.status, 401);
    const job = await finished(db, id);
    assert.equal(job.status, 'done', `${job.error_code}: ${job.error}`);
  } finally {
    globalThis.fetch = realFetch;
    for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
    Object.assign(process.env, saved);
    setDb(null);
  }
  await db.end();
});

test('the library rebuild script runs its films one after another through the admin endpoint and stops at a failure', async () => {
  const { rebuildLibrary } = await import('../scripts/rebuild-library.mjs');
  const { route } = await import('../server.js');
  const { setDb } = await import('../lib/db.js');
  const { Readable } = await import('node:stream');
  const db = await emptyDb();
  await libraryFilm(db);
  setDb(db);
  const f = world();
  const saved = { ...process.env };
  Object.assign(process.env, { OPENSUBTITLES_API_KEY: 'k-os', CLAUDE_API_KEY: 'k-claude' });
  const realFetch = globalThis.fetch;
  globalThis.fetch = f; // the pipeline inside the server, off the network
  const http = async (url, init = {}) => {
    const u = new URL(url);
    const req = Object.assign(Readable.from([Buffer.from(init.body ?? '')]), { url: `${u.pathname}${u.search}`, method: init.method ?? 'GET', headers: { 'content-type': 'application/json' } });
    const chunks = [];
    const res = { statusCode: 200, setHeader() {}, end(b) { if (b) chunks.push(b); this.writableEnded = true; }, writableEnded: false };
    await route(req, res);
    return new Response(chunks.join(''), { status: res.statusCode });
  };
  try {
    const lines = [];
    const out = await rebuildLibrary({ api: 'http://api.test', films: ['good-dinosaur', 'no-such-film', 'good-dinosaur'], code: PASSCODE, pollMs: 5, fetchImpl: http, log: (l) => lines.push(l) });
    assert.deepEqual(out.map((r) => r.status), ['done', 'not_started'], lines.join(' | '));
    assert.ok(out[0].scenes > 0 && out[0].cost_usd > 0);
    assert.ok(lines.every((l) => !l.includes(PASSCODE)), 'the passcode is never printed');
    const { rows } = await db.query("select count(*)::int n from guide_backups where film_id = 'good-dinosaur'");
    assert.equal(rows[0].n, 1);
  } finally {
    globalThis.fetch = realFetch;
    for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
    Object.assign(process.env, saved);
    setDb(null);
  }
  await db.end();
});

test('a Jev request that got no answer is counted at its reservation, and its retry takes a fresh one', async () => {
  let n = 0;
  const fetchImpl = async (u, init) => { n++; if (n === 1) throw new Error('socket hang up'); return jsonResponse({ ...jevAnswer(JSON.parse(init.body)), usage: { input_tokens: 1000, output_tokens: 1 } }); };
  const body = { model: 'jev-1.13.0', state: { lines: ['L1| hi'] }, questions: { q1: { type: 'noul', instructions: 'Is it?' } } };
  const marks = [];
  const b = budget(0.01);
  const { results } = await withRun({ fetchImpl, keys: { typesafe: 'x' }, sleep: noSleep, beforeDispatch: async (r) => { marks.push(r); } }, () => runJobs([{ body, est: 10, reserveUsd: 0.001, meta: { label: 'x' } }], { key: 'x', budget: b, concurrency: 1 }));
  assert.equal(results[0].ok, true);
  assert.equal(n, 2);
  assert.equal(marks.length, 2, 'the retry was reserved and its mark persisted before it went out');
  const want = 0.001 + (1000 * 0.042) / 1e6;
  assert.ok(Math.abs(results[0].record.cost_usd - want) < 1e-12);
  assert.ok(Math.abs(b.spent - want) < 1e-12 && b.reserved < 1e-12);
  // and with no room for a second reservation, the retry is not sent
  let m = 0;
  const f2 = async () => { m++; throw new Error('socket hang up'); };
  const b2 = budget(0.0015);
  const r2 = await withRun({ fetchImpl: f2, keys: { typesafe: 'x' }, sleep: noSleep }, () => runJobs([{ body, est: 10, reserveUsd: 0.001, meta: { label: 'y' } }], { key: 'x', budget: b2, concurrency: 1 }));
  assert.equal(m, 1);
  assert.equal(r2.results[0].ok, false);
  assert.ok(Math.abs(b2.spent - 0.001) < 1e-12, 'the unanswered attempt is counted at its reservation');
});

test('an ingest whose commit landed but whose checkpoint did not is not run twice on resume', async () => {
  const db = await emptyDb();
  const f = world();
  const id = await admitted(db, f);
  const opts = { fetchImpl: f, keys, sleep: noSleep, budgetMs: 0, continueJob: async () => {} };
  // run until only ingest is left
  for (let i = 0; i < 60; i++) {
    const { rows } = await db.query("select stage from job_stages where job_id = $1 and stage = 'select3' and status = 'done'", [id]);
    if (rows[0]) break;
    await advanceJob(db, id, opts);
  }
  // ingest runs and commits, then the invocation "dies" before its checkpoint: undo only the checkpoint
  await advanceJob(db, id, opts);
  let job = await getJob(db, id);
  assert.equal(job.status, 'done');
  await db.query("update job_stages set status = 'running', output = null where job_id = $1 and stage = 'ingest'", [id]);
  await db.query("update jobs set status = 'running', lease_owner = null, lease_until = null where id = $1", [id]);
  const r = await advanceJob(db, id, opts);
  assert.equal(r.status, 'done', JSON.stringify(r));
  job = await getJob(db, id);
  assert.equal(job.status, 'done', `${job.error_code}: ${job.error}`);
  const { rows } = await db.query('select count(*)::int n from films');
  assert.equal(rows[0].n, 1);
  await db.end();
});

test('a Jev-first film still answers the API\'s event filters, though its event chips are its flag reasons', async () => {
  const db = await emptyDb();
  const f = world();
  const { id } = await startJob(db, { imdb_id: FILM.imdb_id, passcode: PASSCODE }, { fetchImpl: f, keys, jevfirst: { budgetMs: 0, sleep: noSleep } });
  const job = await finished(db, id);
  assert.equal(job.status, 'done', `${job.error_code}: ${job.error}`);
  assert.equal(job.pipeline, 'jevfirst', 'the default pipeline');
  const { rows } = await db.query("select vocabulary_id, count(*)::int n from scene_labels where detail = 'at act, not a flag reason' group by 1 order by 2 desc limit 1");
  assert.ok(rows[0], 'some taxonomy event at act');
  const { scenes } = await import('../lib/endpoints.js');
  const out = await scenes(db, job.film.slug, { event: rows[0].vocabulary_id });
  assert.ok(out.scenes.length > 0, `event=${rows[0].vocabulary_id} matches`);
  await db.end();
});

test('a job that crashed too often is failed at its persisted high-water mark, never at less', async () => {
  const { stagesCost } = await import('../pipeline-jevfirst/store.js');
  const rows = new Map([
    ['a', { status: 'done', spent: { jev: 0.01 }, mark: { jev: 0.05 }, carried: {} }],
    ['b', { status: 'running', spent: { sonnet: 0.02 }, mark: { sonnet: 0.2 }, carried: { sonnet: 0.1 } }],
  ]);
  assert.ok(Math.abs(stagesCost(rows) - (0.01 + 0.1 + 0.2)) < 1e-12);
});

test('no Jev request goes out until a spending mark covering it is durable, even with requests in parallel', async () => {
  const db0 = await emptyDb();
  let classifySent = 0;
  const f = world({ jevHook: async (body) => { if (Object.keys(body.questions).every((k) => /^q\d+$/.test(k)) && body.state?.scene) classifySent++; return null; } });
  const id = await admitted(db0, f);
  const opts = { fetchImpl: f, keys, sleep: noSleep, budgetMs: 0, continueJob: async () => {} };
  for (let i = 0; i < 40; i++) {
    const { rows } = await db0.query("select 1 from job_stages where job_id = $1 and stage = 'refold' and status = 'done'", [id]);
    if (rows[0]) break;
    await advanceJob(db0, id, opts);
  }
  // from here on, the classify stage's money writes are slow and never land
  const db = { ...db0, query: async (sql, params) => {
    if (/^update job_stages set spent/.test(sql) && params?.[1] === 'classify') { await new Promise((r) => setTimeout(r, 30)); return { rows: [], rowCount: 0 }; }
    return db0.query(sql, params);
  } };
  const r = await advanceJob(db, id, opts);
  assert.equal(classifySent, 0, 'every classify request waited for its mark, and none was sent');
  assert.equal(r.status, 'failed');
  await db0.end();
});

test('a retry cancelled in its backoff is not charged; a silent attempt then a 400 is charged once, as an upper bound', async () => {
  const body = { model: 'jev-1.13.0', state: { lines: ['L1| hi'] }, questions: { q1: { type: 'noul', instructions: 'Is it?' } } };
  const ac = new AbortController();
  let sent = 0;
  const b = budget(0.01);
  const r = await withRun({ fetchImpl: async () => { sent++; throw new Error('socket hang up'); }, keys: { typesafe: 'x' }, signal: ac.signal, sleep: async () => { ac.abort(); } }, () => runJobs([{ body, est: 10, reserveUsd: 0.001, meta: { label: 'a' } }], { key: 'x', budget: b, concurrency: 1 }));
  assert.equal(sent, 1);
  assert.ok(Math.abs(r.results[0].record.cost_usd - 0.001) < 1e-12 && Math.abs(b.spent - 0.001) < 1e-12 && b.reserved < 1e-12);
  let n = 0;
  const b2 = budget(0.01);
  const r2 = await withRun({ fetchImpl: async () => { n++; if (n === 1) throw new Error('socket hang up'); return new Response('{}', { status: 400 }); }, keys: { typesafe: 'x' }, sleep: noSleep }, () => runJobs([{ body, est: 10, reserveUsd: 0.001, meta: { label: 'b' } }], { key: 'x', budget: b2, concurrency: 1 }));
  assert.equal(n, 2);
  assert.equal(r2.results[0].record.cost_is_upper_bound, true);
  assert.ok(Math.abs(b2.spent - 0.001) < 1e-12 && b2.reserved < 1e-12);
});

test('demo progress: a Jev request that failed is never counted as a check done, and counters count cuts and sentences', () => {
  const p = newProgress();
  p.scenes = [{ id: 'S001', start_ms: 0, end_ms: 10 }, { id: 'S002', start_ms: 10_000, end_ms: 20_000 }];
  p.stages.split_check.total = 1; p.stages.split_check.requests_total = 3;
  applyResult(p, { kind: 'boundary', scene: 'S002', at: 1 }, { ok: false, error: 'HTTP 401' }, { atMs: 5 });
  assert.equal(p.stages.split_check.done, 0);
  assert.equal(p.stages.split_check.failed, 1);
  assert.equal(p.feed.length, 0);
  applyResult(p, { kind: 'align', scene: 'S001' }, { ok: true, json: { answers: {} } }, { atMs: 6 });
  assert.equal(p.stages.split_check.done, 0, 'an alignment request is not a cut');
  assert.equal(p.stages.split_check.requests_done, 1);
  applyResult(p, { kind: 'boundary', scene: 'S002', at: 1 }, { ok: true, json: { answers: { boundary: { noul: 0.01 } } } }, { atMs: 7 });
  assert.equal(p.stages.split_check.done, 1);
  assert.equal(p.stages.split_check.doubtful, 1, 'a merge candidate is a doubted cut');
  assert.equal(p.scenes[1].cut, 'merge_candidate', 'the verdict stays on the scene after the feed moves on');
  assert.equal(p.feed.at(-1).scene, 'S002');
  applyResult(p, { kind: 'placement', scene: 'S001' }, { ok: true, json: { answers: {} } }, { atMs: 8 });
  assert.equal(p.stages.claims.done, 0, 'a placement check is not a sentence');
  assert.equal(p.stages.claims.requests_done, 1);
});

// ------------------------------------------------------------------------------------------------
// The final-review findings (Astra, 2026-09-25): each one reproduced, then held
// ------------------------------------------------------------------------------------------------

test('an add or rebuild whose Sonnet answers leave a scene unanswered fails, and a rebuild keeps the old guide', async () => {
  const { startRebuild } = await import('../lib/admin.js');
  const db = await emptyDb();
  await libraryFilm(db);
  // Sonnet's question calls answer every scene but S003, the retry included
  const f = world();
  const base = f;
  const drop = async (u, init = {}) => {
    const body = init.body ? JSON.parse(init.body) : null;
    const system = typeof body?.system === 'string' ? body.system : '';
    if (u.startsWith('https://api.anthropic.com/v1/messages') && !u.includes('count_tokens') && system.includes('you answer a fixed list of yes/no questions')) {
      const ids = [...body.messages[0].content.matchAll(/^=== (S\d+) ===$/gm)].map((m) => m[1]).filter((id) => id !== 'S003');
      return claudeStream({ scenes: ids.map((id) => ({ id, answers: [] })) }, { input: 20000, output: 2000 });
    }
    return base(u, init);
  };
  drop.calls = base.calls; drop.claude = base.claude;
  const { id, done } = await startRebuild(db, { slug: 'good-dinosaur', passcode: PASSCODE }, { fetchImpl: drop, keys, jevfirst: { sleep: noSleep } });
  await done;
  const job = await finished(db, id);
  assert.equal(job.status, 'failed');
  assert.equal(job.error_code, 'sonnet_answers_failed');
  assert.deepEqual((await db.query(WEB_SCENES, ['good-dinosaur'])).rows.map((s) => s.title), ['The old scene'], 'the old guide is untouched');
  await db.end();
});

test('a demo refuses stored Sonnet answers that are incomplete', async () => {
  const db = await seededDb();
  const { docs } = await demoSeed();
  const sq = structuredClone(docs.sonnetq);
  const first = Object.keys(sq.scenes)[0];
  sq.scenes[first] = null;
  sq.complete = false;
  await db.query("update jevfirst_artifacts set doc = $2::jsonb where slug = $1 and kind = 'sonnetq'", [DEMO_FILM.slug, JSON.stringify(sq)]);
  const { id, done } = await startDemoRun(db, { slug: DEMO_FILM.slug }, { ip: 'a', runOpts: { fetchImpl: world(), keys: { typesafe: 'x' }, sleep: noSleep } });
  await done;
  const r = await demoRun(db, id);
  assert.equal(r.status, 'failed');
  assert.equal(r.error_code, 'incomplete_artifacts');
  await db.end();
});

test('a demo run hands off between invocations, resumes from its checkpoints, and counts every check once', async () => {
  const db = await seededDb();
  const f = world();
  const invocations = [];
  const runOpts = { fetchImpl: f, keys: { typesafe: 'x' }, sleep: noSleep, flushMs: 5, budgetMs: 0 };
  // a zero budget: every invocation runs one stage, checkpoints it, and asks for the next one (in-process)
  const { id, done } = await startDemoRun(db, { slug: DEMO_FILM.slug }, { ip: 'a', runOpts: { ...runOpts, continueRun: async (next) => { invocations.push(next); } } });
  let res = await done;
  const { advanceDemo } = await import('../lib/demo.js');
  while (res.status === 'running' && res.handedOff) res = await advanceDemo(db, id, { ...runOpts, continueRun: async (next) => { invocations.push(next); } });
  assert.equal(res.status, 'done', JSON.stringify(res));
  const r = await demoRun(db, id);
  assert.equal(r.status, 'done');
  assert.ok(r.invocations >= 15, `one stage per invocation (${r.invocations})`);
  assert.equal(invocations.length, r.invocations - 1, 'every hand-off asked for the next invocation');
  const doneAll = Object.values(r.stages).reduce((a, s) => a + (s.requests_done ?? s.done), 0);
  assert.equal(doneAll, f.calls.jev, 'no check counted twice across invocations');
  for (const [k, s] of Object.entries(r.stages)) assert.equal(s.done, s.total, k);
  const { rows } = await db.query('select count(*)::int n from demo_run_stages where run_id = $1', [id]);
  assert.equal(rows[0].n, 0, 'checkpoints are cleared when the run ends');
  await db.end();
});

test('a demo run whose invocation crashed is taken over from its checkpoint, its in-flight money carried at its mark', async () => {
  const db = await seededDb();
  const f = world();
  const runOpts = { fetchImpl: f, keys: { typesafe: 'x' }, sleep: noSleep, flushMs: 5 };
  // the first invocation dies at the start of classify: it never releases its lease
  const { id } = await startDemoRun(db, { slug: DEMO_FILM.slug }, { ip: 'a', launch: () => {}, runOpts });
  const { runDemo } = await import('../pipeline-jevfirst/demo.js');
  const died = await runDemo(db, id, { ...runOpts, onStageStart: (stage) => { if (stage === 'classify') throw Object.assign(new Error('boom'), { crash: true }); } }).catch((e) => e);
  // a thrown non-pipeline error fails the run -- so simulate the crash at the database instead: a lease
  // still held, a mark above what was banked, and a lapsed lease_until
  if (died?.status === 'failed') {
    await db.query("update demo_runs set status = 'running', slot = 1, ended_at = null, result = null, error = null, error_code = null, lease_owner = 'dead-invocation', lease_until = now() - interval '1 second' where id = $1", [id]);
  }
  await db.query("update demo_runs set lease_owner = 'dead-invocation', lease_until = now() - interval '1 second', mark_usd = spent_usd + 0.004 where id = $1", [id]);
  const before = (await db.query('select spent_usd, checkpoint from demo_runs where id = $1', [id])).rows[0];
  const checkpointed = (typeof before.checkpoint === 'string' ? JSON.parse(before.checkpoint) : before.checkpoint)?.done ?? [];
  assert.ok(checkpointed.includes('refold'), `stages before the crash were checkpointed (${checkpointed})`);
  const res = await runDemo(db, id, runOpts);
  assert.equal(res.status, 'done', JSON.stringify(res));
  const r = await demoRun(db, id);
  assert.equal(r.status, 'done');
  const row = (await db.query('select crash_count, uncertain_usd, spent_usd from demo_runs where id = $1', [id])).rows[0];
  assert.equal(row.crash_count, 1);
  assert.ok(Math.abs(Number(row.uncertain_usd) - 0.004) < 1e-6, 'the crashed attempt\'s unmeasured exposure is recorded as uncertain');
  assert.ok(Math.abs(r.cost_uncertain_usd - 0.004) < 1e-6);
  assert.ok(r.cost_usd >= 0 && Math.abs(r.cost_usd + r.cost_uncertain_usd - Number(row.spent_usd)) < 1e-6, 'measured and uncertain are reported apart');
  await db.end();
});

test('a quiet demo run is resumed by a poll, by exactly one poll', async () => {
  const db = await seededDb();
  const runOpts = { fetchImpl: world(), keys: { typesafe: 'x' }, sleep: noSleep, flushMs: 5 };
  const { id } = await startDemoRun(db, { slug: DEMO_FILM.slug }, { ip: 'a', launch: () => {}, runOpts });
  // its continuation never landed: nobody holds it, and it has been quiet past the grace
  await db.query("update demo_runs set progress_at = now() - interval '30 seconds', created_at = now() - interval '30 seconds' where id = $1", [id]);
  const kicked = [];
  const kick = (d, runId) => { kicked.push(runId); return Promise.resolve(); };
  await demoRun(db, id, Date.now(), { kick });
  await demoRun(db, id, Date.now(), { kick });
  assert.deepEqual(kicked, [id], 'one poll kicks it; the next finds it kicked');
  await db.end();
});

test('the demo day counts a run that started before midnight and is still going, and one that ended today', async () => {
  const { demoSpentTodayUsd, sweepDemoRuns } = await import('../lib/demo.js');
  const db = await emptyDb();
  await db.query("insert into demo_runs (id, slug, status, reserve_usd, cost_usd, created_at, updated_at, progress_at, lease_until, lease_owner) values ('run-yesterday-live-000', 'x', 'running', 0.6, 0.6, now() - interval '1 day', now(), now(), now() + interval '1 minute', 'someone')");
  await db.query("insert into demo_runs (id, slug, status, reserve_usd, cost_usd, created_at, ended_at) values ('run-yesterday-ended-00', 'x', 'done', 0.6, 0.05, now() - interval '1 day', now())");
  await db.query("insert into demo_runs (id, slug, status, reserve_usd, cost_usd, created_at, ended_at) values ('run-long-ago-000000000', 'x', 'done', 0.6, 0.07, now() - interval '3 days', now() - interval '3 days')");
  assert.ok(Math.abs((await demoSpentTodayUsd(db)) - 0.65) < 1e-9);
  // a run the sweep gives up on is charged its durable mark, not its whole reservation
  await db.query("insert into demo_runs (id, slug, status, reserve_usd, cost_usd, spent_usd, mark_usd, created_at, updated_at, progress_at) values ('run-dead-0000000000000', 'x', 'running', 0.6, 0.6, 0.03, 0.05, now(), now() - interval '1 hour', now() - interval '1 hour')");
  await sweepDemoRuns(db);
  const dead = (await db.query("select status, cost_usd, spent_usd, uncertain_usd from demo_runs where id = 'run-dead-0000000000000'")).rows[0];
  assert.deepEqual([dead.status, Number(dead.cost_usd), Number(dead.spent_usd), Number(dead.uncertain_usd)], ['failed', 0.05, 0.05, 0.02]);
  const view = await demoRun(db, 'run-dead-0000000000000');
  assert.equal(view.cost_usd, 0.03, 'the measured part only');
  assert.equal(view.cost_uncertain_usd, 0.02, 'the rest is reported as uncertain, never as a bill');
  await db.end();
});

test('wrong passcodes are counted in the database: a new instance still refuses, for every passcode route', async () => {
  const { startRebuild, backups } = await import('../lib/admin.js');
  const { resolve } = await import('../lib/add.js');
  const { PASSCODE_MAX_FAILURES } = await import('../lib/jobs.js');
  const db = await emptyDb();
  await libraryFilm(db);
  for (let i = 0; i < PASSCODE_MAX_FAILURES; i++) {
    resetPasscodeAttempts(); // every guess from a fresh instance: the in-memory counter never sees two
    await assert.rejects(backups(db, { slug: 'good-dinosaur', passcode: 'guess' }, { ip: '198.51.100.7' }), (e) => e.status === 401);
  }
  resetPasscodeAttempts();
  await assert.rejects(startRebuild(db, { slug: 'good-dinosaur', passcode: PASSCODE }, { ip: '198.51.100.7', launch: () => {} }), (e) => e.status === 429 && e.extra.error_code === 'too_many_attempts');
  await assert.rejects(resolve(db, { query: 'x', passcode: PASSCODE }, { ip: '198.51.100.7', apiKey: 'k' }), (e) => e.status === 429);
  // another caller is not locked out by the first (and never by guesses spread across many callers:
  // see the blocker 3 test below)
  await backups(db, { slug: 'good-dinosaur', passcode: PASSCODE }, { ip: '203.0.113.9' });
  await db.end();
});

test('a restore takes the one-live-job lock: it is refused while a rebuild is admitted, and leaves no live row', async () => {
  const { startRebuild, restore } = await import('../lib/admin.js');
  const { backupGuide } = await import('../pipeline-jevfirst/guide.js');
  const db = await emptyDb();
  await libraryFilm(db);
  const backupId = await db.withTransaction((tx) => backupGuide(tx, 'good-dinosaur', { reason: 'manual' }));
  // a rebuild admitted (queued, not yet running)
  const { id } = await startRebuild(db, { slug: 'good-dinosaur', passcode: PASSCODE }, { launch: () => {} });
  await assert.rejects(restore(db, { backup_id: backupId, passcode: PASSCODE }), (e) => e.status === 409 && e.extra.error_code === 'busy');
  // the lock itself, not only the early check: with the early check blind, the insert still refuses
  const { restoreGuide } = await import('../pipeline-jevfirst/guide.js');
  await assert.rejects(restoreGuide(db, backupId, { lock: (tx) => tx.query("insert into jobs (id, status, film, pipeline, reserve_usd, kind) values ('restore-lock-test-0000', 'running', '{}'::jsonb, 'live', 0, 'restore')") }), (e) => e.code === '23505');
  await db.query("update jobs set status = 'failed' where id = $1", [id]);
  const r = await restore(db, { backup_id: backupId, passcode: PASSCODE });
  assert.equal(r.scenes, 1);
  assert.equal(await liveJob(db), null, 'the restore\'s lock row is finished inside its transaction');
  await db.end();
});

test('the eight-word rule holds for hyphenated copies: repair by the detector\'s words, and a final gate that drops', async () => {
  const { enforceQuoteRuleStrict, quoteGrams } = await import('../pipeline-jevfirst/stages/common.js');
  const { enforceQuoteRule, quoteRuns } = await import('../pipeline-jevfirst/pack/validate.js');
  const { quoteGate } = await import('../pipeline-jevfirst/stages/ingest.js');
  const grams = quoteGrams([{ text: 'one two three four five six seven eight nine ten' }]);
  const copy = 'one-two three-four five-six seven-eight nine-ten';
  assert.ok(quoteRuns(enforceQuoteRule(copy, grams).text, grams).length > 0, 'the frozen pack\'s repair leaves the run (the finding)');
  const fixed = enforceQuoteRuleStrict(`He says ${copy} and leaves.`, grams);
  assert.equal(quoteRuns(fixed.text, grams).length, 0);
  assert.equal(fixed.text, 'He says one-two three-four… and leaves.');
  const gate = quoteGate(copy, `A calm first sentence. Then ${copy}.`, grams);
  assert.deepEqual([gate.title, gate.description, gate.dropped], [null, 'A calm first sentence.', 2]);
});

test('a combined Jev answer shows each question with its own answer, and which one decided', async () => {
  const { contributors } = await import('../pipeline-jevfirst/why-detail.js');
  const expr = { max: [{ q: 'lines' }, { q: 'summary' }] };
  const c = contributors(expr, { a: { lines: 0.05, summary: 0.9 } });
  assert.equal(c.p, 0.9);
  assert.equal(c.how, 'any');
  assert.deepEqual(c.parts.map((x) => [x.key, x.p, x.decides]), [['lines', 0.05, false], ['summary', 0.9, true]]);
  const g = contributors({ gate: { q: 'danger' }, at: 0.5, then: { q: 'child' } }, { a: { danger: 0.7, child: 0.8 } });
  assert.deepEqual(g.parts.map((x) => [x.key, x.role ?? 'answer', x.decides]), [['danger', 'condition', false], ['child', 'answer', true]]);
});

test('the sentence feed is Jev\'s provisional answer, reconciled with what the guide finally kept', async () => {
  const { reconcileClaims } = await import('../pipeline-jevfirst/demo.js');
  const p = newProgress();
  p.scenes = [{ id: 'S001', start_ms: 0, end_ms: 10 }];
  const loose = { ok: true, json: { answers: { r0: { choice: 'supports', confidence: 0.5, probabilities: { supports: 0.5, contradicts: 0.02, says_nothing: 0.48 } } } } };
  applyResult(p, { kind: 'describe_support', scene: 'S001', text: 'Arlo is in danger by the river.' }, loose, { atMs: 1 });
  assert.equal(p.feed[0].verdict, 'unsupported', 'at 0.50 Jev\'s strict answer is not "supported"...');
  reconcileClaims(p, { refold: { scenes: [] }, rows: [{ scene_id: 'S001', title: 'Flagged scene', description: 'Arlo is in danger by the river.' }] });
  assert.equal(p.feed[0].final, 'kept', '...but the loose text rule kept it, and the feed says so');
  assert.deepEqual(p.stages.claims.final.descriptions, { scenes: 1, with_text: 1, with_title: 0 });
});

test('a Jev response whose body stalls is cut off at the deadline and by the run\'s abort', async () => {
  const { postJev } = await import('../pipeline-jevfirst/pack/jev-client.js');
  const stalled = () => new Response(new ReadableStream({ start() {} }), { status: 200, headers: { 'content-type': 'application/json' } });
  const t0 = Date.now();
  await assert.rejects(withRun({ fetchImpl: async () => stalled(), keys: { typesafe: 'x' }, sleep: noSleep }, () => postJev({ questions: {} }, 'x', { retries: 0, timeoutMs: 50 })), (e) => e.code === 'unparseable');
  assert.ok(Date.now() - t0 < 2000, 'the per-attempt deadline covers the body');
  const ac = new AbortController();
  setTimeout(() => ac.abort(), 30);
  const t1 = Date.now();
  await assert.rejects(withRun({ fetchImpl: async () => stalled(), keys: { typesafe: 'x' }, signal: ac.signal, sleep: noSleep }, () => postJev({ questions: {} }, 'x', { retries: 0, timeoutMs: 60_000 })));
  assert.ok(Date.now() - t1 < 2000, 'the parent abort covers the body');
  // a retry backoff is cut short by the abort, however long the sleep would have been
  const ac2 = new AbortController();
  setTimeout(() => ac2.abort(), 30);
  const t2 = Date.now();
  await assert.rejects(withRun({ fetchImpl: async () => new Response('{}', { status: 503 }), keys: { typesafe: 'x' }, signal: ac2.signal, sleep: () => new Promise(() => {}) }, () => postJev({ questions: {} }, 'x', { retries: 3 })));
  assert.ok(Date.now() - t2 < 2000, 'the backoff sleep is abortable');
});

// ------------------------------------------------------------------------------------------------
// Ship blockers and follow-ups from the last review (each test reproduces the finding first)
// ------------------------------------------------------------------------------------------------

const TAKEOVER_SQL = "update demo_runs set lease_owner = 'invocation-B', lease_until = now() + interval '1 minute' where id = $1";
const stageRows = async (db, id) => (await db.query('select stage, output from demo_run_stages where run_id = $1 order by stage', [id])).rows;

test('blocker 1: an invocation that lost its lease never deletes the checkpoints of the one that took the run over', async () => {
  const db = await seededDb();
  let takenOver = false;
  let before = null;
  // after the takeover the old invocation's classify requests are refused, so its stage FAILS and it cleans up
  const f = world({ jevHook: async () => (takenOver ? new Response('{}', { status: 400 }) : null) });
  const runOpts = { fetchImpl: f, keys: { typesafe: 'x' }, sleep: noSleep, flushMs: 5 };
  const { id } = await startDemoRun(db, { slug: DEMO_FILM.slug }, { ip: 'a', launch: () => {}, runOpts });
  const { runDemo } = await import('../pipeline-jevfirst/demo.js');
  const res = await runDemo(db, id, {
    ...runOpts,
    onStageStart: (stage) => {
      if (stage !== 'classify' || takenOver) return;
      takenOver = true;
      // invocation B takes the run over (A's lease lapsed); A does not know yet
      before = db.query(TAKEOVER_SQL, [id]).then(() => stageRows(db, id));
    },
  });
  const had = await before;
  assert.ok(had.length >= 3, `stages were checkpointed before the takeover (${had.map((r) => r.stage)})`);
  assert.deepEqual((await stageRows(db, id)).map((r) => r.stage), had.map((r) => r.stage), 'B\'s checkpoints are all still there');
  const row = (await db.query('select status, lease_owner from demo_runs where id = $1', [id])).rows[0];
  assert.deepEqual([row.status, row.lease_owner], ['running', 'invocation-B'], 'the run is still B\'s, not failed by A');
  assert.equal(res.lostLease, true, JSON.stringify(res));
  await db.end();
});

test('blocker 1: an invocation that lost its lease never overwrites a stage output with its own', async () => {
  const db = await seededDb();
  const runOpts = { fetchImpl: world(), keys: { typesafe: 'x' }, sleep: noSleep, flushMs: 5 };
  const { id } = await startDemoRun(db, { slug: DEMO_FILM.slug }, { ip: 'a', launch: () => {}, runOpts });
  const { runDemo } = await import('../pipeline-jevfirst/demo.js');
  let once = false;
  const res = await runDemo(db, id, {
    ...runOpts,
    onStageStart: (stage) => {
      if (stage !== 'refold' || once) return;
      once = true;
      db.query(TAKEOVER_SQL, [id]);
      db.query(`insert into demo_run_stages (run_id, stage, output) values ($1, 'refold', '"from-B"'::jsonb)
                on conflict (run_id, stage) do update set output = excluded.output`, [id]);
    },
  });
  assert.equal(res.lostLease, true, JSON.stringify(res));
  const refold = (await stageRows(db, id)).find((r) => r.stage === 'refold');
  // (jsonb 'from-B' comes back as the string itself, or as its JSON text on the pg driver)
  assert.ok(refold.output === 'from-B' || refold.output === '"from-B"', 'A\'s late output did not replace B\'s');
  await db.end();
});

test('blocker 1: a finishing invocation drains its queued writes while its heartbeat still holds the lease', async () => {
  const base = await seededDb();
  let slow = 0;
  // one progress write stalls for well over the lease: the drain at the end of the run has to wait for it
  const db = {
    ...base,
    query: async (sql, params) => {
      if (slow > 0 && /^\s*update demo_runs set progress = \$3::jsonb/.test(sql)) { slow--; await new Promise((r) => setTimeout(r, 1500)); }
      return base.query(sql, params);
    },
  };
  let inClassify = false;
  let refused = false;
  // the first classify request is refused (the stage will fail); the rest take a moment, so the stalled
  // write is already in flight when the run ends and starts cleaning up
  const f = world({ jevHook: async () => {
    if (!inClassify) return null;
    if (!refused) { refused = true; slow = 1; return new Response('{}', { status: 400 }); }
    await new Promise((r) => setTimeout(r, 2));
    return null;
  } });
  const runOpts = { fetchImpl: f, keys: { typesafe: 'x' }, sleep: noSleep, flushMs: 5, leaseMs: 500, heartbeatMs: 40 };
  const { id } = await startDemoRun(base, { slug: DEMO_FILM.slug }, { ip: 'a', launch: () => {}, runOpts });
  const { runDemo, acquireDemoLease } = await import('../pipeline-jevfirst/demo.js');
  let finished = false;
  const a = runDemo(db, id, { ...runOpts, onStageStart: (s) => { if (s === 'classify') inClassify = true; } }).finally(() => { finished = true; });
  // invocation B keeps trying to take the run over the whole time
  let bTook = null;
  while (!finished && !bTook) {
    if (refused) bTook = await acquireDemoLease(base, id, 'invocation-B', 60_000);
    await new Promise((r) => setTimeout(r, 25));
  }
  const res = await a;
  assert.equal(bTook, null, 'no other invocation could take the run while it was draining its writes');
  assert.equal(res.status, 'failed', JSON.stringify(res));
  const row = (await base.query('select status, error_code from demo_runs where id = $1', [id])).rows[0];
  assert.deepEqual([row.status, row.error_code], ['failed', 'jev_answers_failed']);
  await base.end();
});

test('blocker 2: upgrading populated v10.4.2 demo tables keeps their spending', async () => {
  const { JEVFIRST_SCHEMA_SQL } = await import('../lib/schema-jevfirst.js');
  const { sweepDemoRuns, demoSpentTodayUsd } = await import('../lib/demo.js');
  const { acquireDemoLease } = await import('../pipeline-jevfirst/demo.js');
  const db = await emptyDb();
  // a v10.4.2 database: demo_runs without the v10.4.3 columns, no demo_run_stages
  await db.exec(`drop table demo_run_stages;
    alter table demo_runs drop column lease_owner, drop column lease_until, drop column invocations, drop column crash_count,
      drop column spent_usd, drop column mark_usd, drop column uncertain_usd, drop column checkpoint, drop column progress_at, drop column kicked_at;
    delete from schema_marks;`);
  const ins = (id, status, slot, cost, spent, extra = '') => db.query(
    `insert into demo_runs (id, slug, status, slot, reserve_usd, cost_usd, progress, created_at, started_at, updated_at${extra ? ', error_code, ended_at' : ''})
     values ($1, 'x', $2, $3, 0.6, $4, $5::jsonb, now() - interval '10 minutes', now() - interval '10 minutes', now() - interval '10 minutes'${extra ? ", $6, now() - interval '9 minutes'" : ''})`,
    [id, status, slot, cost, JSON.stringify(spent === null ? {} : { spent_usd: spent }), ...(extra ? [extra] : [])],
  );
  await ins('old-done-0000000000000', 'done', null, 0.056787, 0.056787, 'none');
  await ins('old-timedout-000000000', 'failed', null, 0.6, 0.02, 'timed_out');
  await ins('old-running-stale-0000', 'running', 1, 0.6, 0.05);
  await ins('old-running-fresh-0000', 'running', 2, 0.6, 0.01);
  await db.query("update demo_runs set updated_at = now() where id = 'old-running-fresh-0000'");
  const dayBefore = await demoSpentTodayUsd(db);
  await db.exec(JEVFIRST_SCHEMA_SQL); // the upgrade
  await db.exec(JEVFIRST_SCHEMA_SQL); // and again: idempotent
  assert.ok(Math.abs((await demoSpentTodayUsd(db)) - dayBefore) < 1e-9, 'the day\'s total is unchanged by the upgrade');
  // a finished run still shows what it cost
  const done = await demoRun(db, 'old-done-0000000000000');
  assert.deepEqual([done.cost_usd, done.cost_uncertain_usd], [0.056787, null]);
  // a run the old sweep charged at its reservation: only what it measured is shown as a bill
  const timedOut = await demoRun(db, 'old-timedout-000000000');
  assert.deepEqual([timedOut.cost_usd, timedOut.cost_uncertain_usd], [0.02, 0.58]);
  // an old live run is never picked up by the new code (the old invocation may be alive; there is no checkpoint)
  assert.equal(await acquireDemoLease(db, 'old-running-fresh-0000', 'new-code'), null);
  // ...and the sweep charges the stale one its reservation, the only upper bound the old code kept
  await sweepDemoRuns(db);
  const stale = (await db.query("select status, cost_usd, spent_usd, uncertain_usd from demo_runs where id = 'old-running-stale-0000'")).rows[0];
  assert.deepEqual([stale.status, Number(stale.cost_usd), Number(stale.spent_usd), Number(stale.uncertain_usd)], ['failed', 0.6, 0.6, 0.55]);
  const view = await demoRun(db, 'old-running-stale-0000');
  assert.deepEqual([view.cost_usd, view.cost_uncertain_usd], [0.05, 0.55]);
  assert.ok(Math.abs((await demoSpentTodayUsd(db)) - dayBefore) < 1e-9, 'the sweep did not release the old run\'s reservation');
  const { JEVFIRST_SCHEMA_VERSION } = await import('../lib/schema-jevfirst.js');
  assert.equal(JEVFIRST_SCHEMA_VERSION, 'jevfirst-schema-v10.4.4');
  await db.end();
});

test('blocker 3: other callers\' wrong passcodes never lock the owner out; one caller\'s guesses are capped atomically', async () => {
  const { backups } = await import('../lib/admin.js');
  const { PASSCODE_MAX_FAILURES, PASSCODE_GLOBAL_ALERT_FAILURES } = await import('../lib/jobs.js');
  const db = await emptyDb();
  await libraryFilm(db);
  const slug = 'good-dinosaur';
  // 1. many anonymous callers, each under its own limit, far past any count across callers
  const warned = [];
  const warn = console.warn;
  console.warn = (...a) => warned.push(a.join(' '));
  try {
    // 80 callers, one wrong guess each: more than the old shared ceiling of 60
    for (let i = 0; i < 80; i++) {
      resetPasscodeAttempts();
      await backups(db, { slug, passcode: 'guess' }, { ip: `10.1.${i}.1` }).catch(() => {});
    }
  } finally { console.warn = warn; }
  resetPasscodeAttempts();
  assert.equal((await backups(db, { slug, passcode: PASSCODE }, { ip: '203.0.113.50' })).slug, slug, 'the owner is let in');
  assert.ok(PASSCODE_GLOBAL_ALERT_FAILURES < 80);
  assert.equal(warned.filter((w) => w.includes('[passcode]')).length, 1, 'one alert when the count across callers passes its mark');
  // 2. one caller's concurrent guesses, each on a fresh instance (no in-memory count): no more than the limit are compared
  const fresh = { ...db, query: async (sql, p) => { try { return await db.query(sql, p); } finally { resetPasscodeAttempts(); } } };
  const outcomes = await Promise.allSettled(Array.from({ length: 100 }, () => backups(fresh, { slug, passcode: 'guess' }, { ip: '198.51.100.99' })));
  assert.ok(outcomes.every((o) => o.status === 'rejected' && [401, 429].includes(o.reason.status)));
  const compared = outcomes.filter((o) => o.reason.status === 401).length;
  assert.ok(compared <= PASSCODE_MAX_FAILURES, `${compared} of 100 concurrent guesses were compared`);
  resetPasscodeAttempts();
  await assert.rejects(backups(db, { slug, passcode: PASSCODE }, { ip: '198.51.100.99' }), (e) => e.status === 429, 'that caller is held to its own limit');
  // 3. expired rows are pruned
  await db.query("insert into passcode_failures (key, failures, window_start) values ('client:expired', 3, now() - interval '1 hour')");
  resetPasscodeAttempts();
  await backups(db, { slug, passcode: PASSCODE }, { ip: '203.0.113.51' });
  assert.equal((await db.query("select count(*)::int n from passcode_failures where key = 'client:expired'")).rows[0].n, 0);
  await db.end();
});

test('blocker 4: a rebuild created yesterday and finished today counts against today\'s cap', async () => {
  const { startRebuild } = await import('../lib/admin.js');
  const { spentTodayUsd } = await import('../lib/jobs.js');
  const db = await emptyDb();
  await libraryFilm(db);
  await db.query(`insert into jobs (id, status, film, cost_usd, pipeline, reserve_usd, kind, created_at, updated_at)
                  values ('rebuild-yesterday-00000', 'done', '{}'::jsonb, $1, 'jevfirst', $1, 'rebuild', now() - interval '1 day', now())`, [JEVFIRST_RESERVE_USD]);
  await db.query(`insert into jobs (id, status, film, cost_usd, pipeline, reserve_usd, kind, created_at, updated_at)
                  values ('rebuild-long-ago-000000', 'done', '{}'::jsonb, 1, 'jevfirst', 1, 'rebuild', now() - interval '3 days', now() - interval '3 days')`);
  assert.ok(Math.abs((await spentTodayUsd(db)) - JEVFIRST_RESERVE_USD) < 1e-9, 'the job that ended today is in today\'s total');
  process.env.REBUILD_DAILY_CAP_USD = String(JEVFIRST_RESERVE_USD);
  try {
    await assert.rejects(startRebuild(db, { slug: 'good-dinosaur', passcode: PASSCODE }, { launch: () => {} }), (e) => e.status === 429 && e.extra.error_code === 'daily_cap');
  } finally { delete process.env.REBUILD_DAILY_CAP_USD; }
  // a job still live that was admitted yesterday counts at its reservation today
  await db.query("update jobs set status = 'running', updated_at = now() - interval '1 day', progress_at = now(), lease_owner = 'x', lease_until = now() + interval '1 minute' where id = 'rebuild-yesterday-00000'");
  assert.ok(Math.abs((await spentTodayUsd(db)) - JEVFIRST_RESERVE_USD) < 1e-9);
  await db.end();
});

test('row 7: the quotation gate reads the whole shown text, across sentences and the title', async () => {
  const { quoteGrams } = await import('../pipeline-jevfirst/stages/common.js');
  const { quoteRuns } = await import('../pipeline-jevfirst/pack/validate.js');
  const { quoteGate } = await import('../pipeline-jevfirst/stages/ingest.js');
  const grams = quoteGrams([{ text: 'one two three four five six seven eight nine ten' }]);
  // each sentence alone copies five words; together they copy ten
  const g = quoteGate(null, 'One two three four five. Six seven eight nine ten. A calm sentence.', grams);
  assert.deepEqual([g.description, g.dropped], ['One two three four five. A calm sentence.', 1]);
  assert.equal(quoteRuns(g.description, grams).length, 0);
  const t = quoteGate('One two three four five', 'Six seven eight nine ten. A calm sentence.', grams);
  assert.deepEqual([t.title, t.description, t.dropped], ['One two three four five', 'A calm sentence.', 1]);
  assert.equal(quoteRuns(`${t.title} ${t.description}`, grams).length, 0);
});

test('row 9: a sentence left out of the summary for a judgement word is not "in the guide"', () => {
  const p = newProgress();
  p.scenes = [{ id: 'S001', start_ms: 0, end_ms: 10 }];
  const yes = { ok: true, json: { answers: { r0: { choice: 'supports', confidence: 0.95, probabilities: { supports: 0.95, contradicts: 0.01, says_nothing: 0.04 } } } } };
  applyResult(p, { kind: 'claim', scene: 'S001', text: 'A scary storm hits the farm.' }, yes, { atMs: 1 });
  applyResult(p, { kind: 'claim', scene: 'S001', text: 'A storm hits the farm.' }, yes, { atMs: 2 });
  const refold = { scenes: [{ id: 'S001', summary: 'A storm hits the farm.', sentences: [
    { text: 'A scary storm hits the farm.', judgement_words: ['scary'], check: { status: 'verified' } },
    { text: 'A storm hits the farm.', judgement_words: [], check: { status: 'verified' } },
  ] }] };
  reconcileClaims(p, { refold, rows: [] });
  assert.deepEqual(p.feed.map((x) => [x.text, x.final]), [['A scary storm hits the farm.', 'left_out'], ['A storm hits the farm.', 'kept']]);
  assert.deepEqual(p.stages.claims.final.summary, { checked: 2, kept: 1, left_out: 1 });
});

test('row 10: guide comparison has a boundary tolerance: a 0-1000 s run scene is not a 0-100 s guide scene', () => {
  assert.deepEqual(compareWithGuide([{ start_ms: 0, end_ms: 1_000_000 }], [{ id: 'g', start_ms: 0, end_ms: 100_000 }]), { both: 0, only_run: 1, only_guide: 1, guide_scenes: 1, run_scenes: 1 });
  // the same scene with slightly different edges still matches
  assert.equal(compareWithGuide([{ start_ms: 60_000, end_ms: 180_000 }], [{ id: 'g', start_ms: 62_000, end_ms: 175_000 }]).both, 1);
});

test('row 13: a 200 whose body could not be read is charged as uncertain, never as measured', async () => {
  const { UpstreamError } = await import('../pipeline/errors.js');
  const seen = [];
  const b = budget(1);
  const job = { body: { questions: { q0: {} } }, reserveUsd: 0.001, meta: { kind: 'classify' } };
  await withRun({ onSpend: (usd, info) => seen.push([usd, info?.uncertain_usd ?? 0]), keys: { typesafe: 'x' } }, () => runJobs([job], {
    key: 'x', budget: b, post: async () => { throw Object.assign(new UpstreamError({ service: 'jev', status: 200, code: 'unparseable' }), { attempts: [{ status: 200, ms: 1 }] }); },
  }));
  assert.deepEqual(seen, [[0.001, 0.001]]);
  // ...and in a demo run the page reports it apart from the measured cost
  const db = await seededDb();
  let bad = 0;
  const f = world({ jevHook: async () => (bad++ === 0 ? new Response('not json', { status: 200, headers: { 'content-type': 'application/json' } }) : null) });
  const { id, done } = await startDemoRun(db, { slug: DEMO_FILM.slug }, { ip: 'a', runOpts: { fetchImpl: f, keys: { typesafe: 'x' }, sleep: noSleep, flushMs: 5 } });
  await done;
  const r = await demoRun(db, id);
  const row = (await db.query('select spent_usd, uncertain_usd from demo_runs where id = $1', [id])).rows[0];
  assert.ok(r.cost_uncertain_usd > 0, JSON.stringify({ cost: r.cost_usd, uncertain: r.cost_uncertain_usd }));
  assert.ok(Math.abs(r.cost_usd + r.cost_uncertain_usd - Number(row.spent_usd)) < 1e-6);
  await db.end();
});
