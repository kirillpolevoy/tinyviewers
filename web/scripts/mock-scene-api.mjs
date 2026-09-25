#!/usr/bin/env node
// A stand-in for the scene API's /api/demo/* and /api/add/* contract, for developing the web app
// before the real endpoints are up. Development only: nothing in the app imports it, and the real
// API replaces it by pointing SCENE_API_URL somewhere else.
//
//   node scripts/mock-scene-api.mjs            # http://localhost:8788
//   SCENE_API_URL=http://localhost:8788 npm run dev
//
// The films, scenes, flagged scenes (with their why tags, the questions behind them and Jev's lines)
// and sentences are real v10.4 output for three films (scripts/mock-scene-api.fixture.json). The *progress* is simulated: a run started here advances
// on this process's clock, which is exactly what the real API must never do and why this file is a
// mock. The web app itself has no clock of its own — it draws whatever this answers.
//
// Switches, for looking at every state:
//   GET /__mock/mode?set=normal|cap|down|empty|notready|flaky|differs   (flaky: run polls answer 502;
//                                                   differs: a finished run's list differs from the page's)
//   run ids  fixed-<slug>-t<ms>   a run frozen at that many ms in, e.g. fixed-croods-t004000 (the descriptions)
//            fixed-<slug>-done    a finished run;  fixed-<slug>-fail   a failed one
//   job ids  fixed-addjob-t<ms>   an add run frozen at that many ms in
//   MOCK_SEGMENT_MS=30000         how long "Sonnet reads the film" takes in a live add run here

import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(fs.readFileSync(path.join(here, 'mock-scene-api.fixture.json'), 'utf8'));
const PORT = Number(process.env.PORT ?? 8788);
const SEGMENT_MS = Number(process.env.MOCK_SEGMENT_MS ?? 30_000);

let mode = 'normal';
const runs = new Map(); // id -> { slug, created }
const jobs = new Map(); // id -> { created }

const clamp = (x) => Math.min(1, Math.max(0, x));
const share = (t, from, to) => clamp((t - from) / (to - from));

// --- demo runs ------------------------------------------------------------------------------------

// One stage at a time, in the real API's order (pipeline-jevfirst/stages/index.js DEMO_STAGES): the scene
// breaks, then the descriptions, then the questions per scene, then where to skip. `stage` names the one
// running, as the real API's does.
const T = { cutsFrom: 300, cutsEnd: 2500, claimsFrom: 2500, claimsEnd: 6500, classifyFrom: 6500, classifyEnd: 10500, momentsFrom: 11000, momentsEnd: 12200, done: 13000 };
const STAGE_AT = [
  [T.cutsFrom, 'segment_build'],
  [T.claimsFrom, 'claims'],
  [T.classifyFrom, 'classify'],
  [T.classifyEnd, 'mortal'],
  [T.momentsFrom, 'moments'],
  [T.momentsEnd, 'check_describe'],
  [12_800, 'select3'],
];
const stageAt = (t) => (t < T.cutsFrom || t >= T.done ? null : STAGE_AT.filter(([from]) => t >= from).at(-1)?.[1] ?? null);

function runAt(slug, t, { failed = false } = {}) {
  const f = fixture.films.find((x) => x.film.slug === slug);
  if (!f) return null;
  const N = f.scenes.length;
  const cutScenes = f.scenes.slice(1);
  const doubtIdx = new Set([3, Math.floor(cutScenes.length * 0.6)]);
  const cutsDone = Math.floor(share(t, T.cutsFrom, T.cutsEnd) * cutScenes.length);
  const S = f.sentences.length;
  const claimsDone = Math.floor(share(t, T.claimsFrom, T.claimsEnd) * S);
  const answered = Math.floor(share(t, T.classifyFrom, T.classifyEnd) * N);
  // Like the API's select1: whether a scene is on the list is known only once every scene is answered.
  const ruled = answered >= N && t >= T.momentsFrom;
  const flaggedCount = f.flagged.length;
  const momentsDone = ruled && t >= T.momentsFrom ? Math.floor(share(t, T.momentsFrom, T.momentsEnd) * flaggedCount) : 0;
  const done = !failed && t >= T.done;
  const scenes = f.scenes.map((s, i) => ({
    ...s,
    state: i < answered ? 'answered' : i < answered + 4 && t >= T.classifyFrom ? 'asking' : 'pending',
    // the real API counts each scene's answered questions; the mock uses the fixture's per-scene mean
    ...(i < answered ? { questions: f.answers_per_scene } : {}),
    flagged: ruled ? s.flagged : null,
    strength_5_7: ruled ? s.strength_5_7 : null,
    strength_8_10: ruled ? s.strength_8_10 : null,
  }));
  // The API's feed: the newest items, each stamped with when it landed (ms into the run) and the scene
  // it is about. Doubted cuts are kept once each so the board can still mark them.
  const feed = [];
  const at = (share0, i, n, from, to) => Math.round(from + ((to - from) * (i + 1)) / Math.max(1, n));
  for (const i of doubtIdx) if (i < cutsDone - 6) feed.push({ kind: 'cut', text: `Cut before ${cutScenes[i].id}`, verdict: 'doubtful', at_ms: at(0, i, cutScenes.length, T.cutsFrom, T.cutsEnd), scene: cutScenes[i].id });
  for (let i = Math.max(0, cutsDone - 6); i < cutsDone; i++) {
    feed.push({ kind: 'cut', text: `Cut before ${cutScenes[i].id}`, verdict: doubtIdx.has(i) ? 'doubtful' : 'confirmed', at_ms: at(0, i, cutScenes.length, T.cutsFrom, T.cutsEnd), scene: cutScenes[i].id });
  }
  for (let i = Math.max(0, claimsDone - 6); i < claimsDone; i++) {
    const c = f.sentences[i];
    feed.push({ kind: 'claim', text: c.text, verdict: c.dropped ? 'unsupported' : 'supported', source: 'summary', at_ms: at(0, i, S, T.claimsFrom, T.claimsEnd), scene: c.scene });
  }
  for (let i = Math.max(0, answered - 3); i < answered; i++) {
    const s = f.scenes[i];
    feed.push({ kind: 'scene', text: `${s.id} answered`, verdict: 'answered', at_ms: at(0, i, N, T.classifyFrom, T.classifyEnd), scene: s.id });
  }
  feed.sort((a, b) => a.at_ms - b.at_ms);
  const elapsed = Math.min(t, failed ? 6200 : T.done);
  const inGuide = f.film.in_library ? flaggedCount : 0;
  const compare = !f.film.in_library
    ? null
    : mode === 'differs'
      ? // Consistent by construction: both + only_run = this run's list, both + only_guide = the page's.
        { both: flaggedCount - 2, only_run: 2, only_guide: 1, guide_scenes: flaggedCount - 1 }
      : { both: inGuide, only_run: 0, only_guide: 0, guide_scenes: inGuide };
  return {
    id: 'mock',
    slug,
    status: failed ? 'failed' : done ? 'done' : t < 300 ? 'queued' : 'running',
    stage: failed ? stageAt(Math.min(t, 6200)) : done ? null : stageAt(t),
    started_at: t < 300 ? null : new Date(Date.now() - t).toISOString(),
    elapsed_ms: t < 300 ? 0 : elapsed,
    cost_usd: Math.round(0.0213 * (elapsed / T.done) * 1e6) / 1e6,
    stages: t < 300 ? null : {
      split_check: { done: cutsDone, total: cutScenes.length, doubtful: [...doubtIdx].filter((i) => i < cutsDone).length },
      classify: { done: answered, total: N, answers: answered * f.answers_per_scene },
      claims: { done: claimsDone, total: S, unsupported: f.sentences.slice(0, claimsDone).filter((c) => c.dropped).length, supported: claimsDone - f.sentences.slice(0, claimsDone).filter((c) => c.dropped).length, contradicted: 0, final: null },
      moments: { done: momentsDone, total: ruled ? flaggedCount : 0 },
    },
    scenes: t < 300 ? [] : scenes,
    credits: f.credits,
    feed,
    ...(done ? { result: { flagged: f.flagged, compare } } : {}),
    ...(failed ? { error_code: 'timed_out', error: 'This live run ran out of time and stopped.' } : {}),
  };
}

function readRun(id) {
  const fixed = /^fixed-(.+)-(t(\d+)|done|fail)$/.exec(id);
  if (fixed) {
    const t = fixed[2] === 'done' ? T.done + 1 : fixed[2] === 'fail' ? 6200 : Number(fixed[3]);
    return runAt(fixed[1], t, { failed: fixed[2] === 'fail' });
  }
  const r = runs.get(id);
  return r ? runAt(r.slug, Date.now() - r.created) : null;
}

// --- add jobs -------------------------------------------------------------------------------------

const ADD_STEPS = [
  ['subtitles', 'Finding the subtitles', 1500, '1,912 subtitle lines, with sound captions'],
  ['sources', 'Reading the plot and the cast', 2000, 'Wikipedia plot, 31 sentences · TMDB cast, 28 names'],
  ['segment', 'Sonnet reads the film', SEGMENT_MS, '44 scenes, 118 sentences, each citing a line or the plot'],
  ['split_check', 'Jev checks the cut', 3000, '43 breaks checked · 1 looked doubtful'],
  ['claims', 'Jev checks what Sonnet wrote', 3000, '118 sentences checked · 6 dropped'],
  ['classify', 'Jev answers the concrete questions', 5000, '44 scenes · 6,072 answers'],
  ['sonnetq', 'Sonnet answers the rest', 12000, '10 questions about meaning, for 44 scenes'],
  ['childcry', 'Jev: is the one crying a child?', 1000, null],
  ['mortal', 'Jev: life-or-death questions', 1500, null],
  ['moments', 'Jev finds the exact moments', 3000, '17 scenes on the list, each with where to skip'],
  ['describe', 'Sonnet describes', 25000, '17 scenes described'],
  ['check_describe', 'Jev checks the descriptions', 3000, '31 sentences checked · 2 dropped'],
  ['ingest', 'Saving the scene guide', 2000, 'Saved'],
];

function jobAt(id, t) {
  let at = 0;
  const steps = ADD_STEPS.map(([sid, label, ms, detail]) => {
    const started = at;
    at += ms;
    const status = t >= at ? 'done' : t >= started ? 'running' : 'pending';
    return { id: sid, label, status, started_ms: t >= started ? started : null, ended_ms: t >= at ? at : null, detail: status === 'done' ? detail : null };
  });
  const done = t >= at;
  const running = steps.find((s) => s.status === 'running');
  return {
    id,
    kind: 'add',
    status: done ? 'done' : t < 400 ? 'queued' : 'running',
    step: running?.id ?? null,
    steps: t < 400 ? steps.map((s) => ({ ...s, status: 'pending', started_ms: null, ended_ms: null, detail: null })) : steps,
    film: { title: 'Coco', year: 2017, slug: done ? 'coco' : null, poster_url: null, imdb_id: 'tt2380307' },
    cost_usd: done ? 0.58 : 1.8,
    error_code: null,
    error: null,
    scene_count: done ? 44 : null,
    elapsed_ms: Math.min(t, at),
    created_at: new Date(Date.now() - t).toISOString(),
    updated_at: new Date().toISOString(),
  };
}

function readJob(id) {
  const fixed = /^fixed-addjob-t(\d+)$/.exec(id);
  if (fixed) return jobAt(id, Number(fixed[1]));
  const j = jobs.get(id);
  return j ? jobAt(id, Date.now() - j.created) : null;
}

// --- http -----------------------------------------------------------------------------------------

const send = (res, status, body) => {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
};
const readBody = (req) =>
  new Promise((resolve) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      try {
        resolve(JSON.parse(raw || '{}'));
      } catch {
        resolve({});
      }
    });
  });
const newId = () => crypto.randomBytes(16).toString('base64url');

http
  .createServer(async (req, res) => {
    const url = new URL(req.url, `http://localhost:${PORT}`);
    const p = url.pathname;
    if (p === '/__mock/mode') {
      if (url.searchParams.get('set')) mode = url.searchParams.get('set');
      return send(res, 200, { mode });
    }
    if (mode === 'down' && p.startsWith('/api/demo')) return send(res, 503, { error_code: 'unavailable' });

    if (req.method === 'GET' && p === '/api/demo/films') {
      return send(res, 200, mode === 'empty' ? [] : fixture.films.map((f) => f.film));
    }
    if (req.method === 'GET' && p === '/api/demo/status') {
      return send(res, 200, mode === 'cap' ? { spent_today_usd: 2, cap_usd: 2, available: false } : { spent_today_usd: 0.12, cap_usd: 2, available: true });
    }
    if (req.method === 'POST' && p === '/api/demo/runs') {
      const body = await readBody(req);
      if (mode === 'cap') return send(res, 429, { error_code: 'daily_cap', spent_usd: 2, cap_usd: 2 });
      if (mode === 'notready' || !fixture.films.some((f) => f.film.slug === body.slug)) return send(res, 404, { error_code: 'not_ready' });
      const id = newId();
      runs.set(id, { slug: body.slug, created: Date.now() });
      return send(res, 202, { id });
    }
    let m = /^\/api\/demo\/runs\/([A-Za-z0-9_-]+)$/.exec(p);
    if (req.method === 'GET' && m) {
      if (mode === 'flaky') return send(res, 502, { error_code: 'unreachable' });
      const run = readRun(m[1]);
      return run ? send(res, 200, run) : send(res, 404, { error_code: 'not_found' });
    }

    if (req.method === 'GET' && p === '/api/add/status') {
      return send(res, 200, { running: null, spent_today_usd: 0.42, cap_usd: 5, passcode_configured: true });
    }
    if (req.method === 'POST' && p === '/api/add/resolve') {
      return send(res, 200, {
        candidates: [
          { tmdb_id: 354912, imdb_id: 'tt2380307', title: 'Coco', year: 2017, poster_url: null, overview: 'Despite his family’s baffling generations-old ban on music, Miguel dreams of becoming an accomplished musician.', slug: null, exists: false },
        ],
      });
    }
    if (req.method === 'POST' && p === '/api/add/jobs') {
      const id = newId();
      jobs.set(id, { created: Date.now() });
      return send(res, 202, { id });
    }
    m = /^\/api\/add\/jobs\/([A-Za-z0-9_-]+)$/.exec(p);
    if (req.method === 'GET' && m) {
      const job = readJob(m[1]);
      return job ? send(res, 200, job) : send(res, 404, { error_code: 'not_found' });
    }
    send(res, 404, { error_code: 'not_found' });
  })
  .listen(PORT, () => console.log(`mock scene API on http://localhost:${PORT} (mode ${mode})`));
