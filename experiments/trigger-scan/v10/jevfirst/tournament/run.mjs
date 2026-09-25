#!/usr/bin/env node
// PHRASING TOURNAMENT runner: asks Jev (jev-1.13.0) every pooled phrasing on every scene of the 13 seen
// films, over v9's segmentation and verified summaries (v9/out/<slug>.segments.json, data/<slug>.srt).
//
//   node run.mjs --dry-run            price the whole run (no calls)
//   node run.mjs [--cap 2.00] [--films a,b]
//
// Fan-out: per scene, every question that shares a state goes in ONE request (split only when a
// request would pass ~40k estimated tokens). States with identical content (e.g. lines with no lyric
// removed == full lines) are merged. Identical questions are asked once.
// Money: $2.00 hard cap for the whole run (API cap from the brief). Every request reserves its worst
// case (v9 jev-client sizeRequest: JSON length / 2.5 chars per token, pessimistic; v9 billed ~0.87 of
// the 3.2-chars estimate for Noul requests) BEFORE dispatch; nothing starts once a reservation would
// pass the cap. Reservations and actual spend are appended to ledger.jsonl. Key parsed in Node
// (v9/env.js), never printed.
import fs from 'node:fs';
import path from 'node:path';
import { parseSrt } from '../../../srt.js';
import { budget } from '../../../v9/budget.js';
import { key } from '../../../v9/env.js';
import { sizeRequest, runJobs, usd, estTokens } from '../../../v9/jev-client.js';
import { buildPool, instantiateFilm, sceneStates, hashOf, HERE, MODEL } from './pool.mjs';

export const FILMS = ['nemo', 'monsters-inc', 'lion-king', 'frankenweenie', 'wild-robot', 'iron-giant', 'up', 'tangled', 'coco', 'how-to-train-your-dragon', 'book-of-life', 'princess-and-the-frog', 'moana'];
const V9OUT = path.resolve(HERE, '../../../v9/out');
const DATA = path.resolve(HERE, '../../../data');
const OUT = path.join(HERE, 'out');
const LEDGER = path.join(HERE, 'ledger.jsonl');
const MAX_EST_PER_REQ = 40_000;
// Pilot (princess-and-the-frog, 292 requests): billed/est 0.826 overall, but small requests carry a fixed
// overhead (billed - est up to 787 tokens; 17 of 292 billed up to 323 tokens above the 2.5-cpt
// reservation). Every reservation adds 1500 tokens on top of the 2.5-cpt worst case.
const RESERVE_FIXED_TOK = 1500;

const args = Object.fromEntries(process.argv.slice(2).map((a, i, arr) => a.startsWith('--') ? [a.slice(2), arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : true] : null).filter(Boolean));
const CAP = Number(args.cap ?? 2.0);
const films = typeof args.films === 'string' ? args.films.split(',') : FILMS;
const ledger = (e) => fs.appendFileSync(LEDGER, JSON.stringify({ at: new Date().toISOString(), ...e }) + '\n');

const POOL = buildPool();

/** All request jobs of one film. Each job carries the map request-key -> answer-keys it answers. */
function planFilm(slug) {
  const seg = JSON.parse(fs.readFileSync(path.join(V9OUT, `${slug}.segments.json`), 'utf8'));
  const cues = parseSrt(fs.readFileSync(path.join(DATA, `${slug}.srt`), 'utf8')).map((c, i) => ({ ...c, index: i + 1 }));
  const { questions, items } = instantiateFilm(POOL, seg);
  const jobs = [];
  const scenes = [];
  for (const [si, scene] of seg.scenes.entries()) {
    const sc = cues.slice(scene.start_cue - 1, scene.end_cue);
    const { states, lyricCues, summaryEmpty } = sceneStates({ seg, scene, cues: sc });
    const groups = new Map(); // state-content hash -> { body, qs: Map(qHash -> {q, answerKeys:[]}) }
    const unasked = [];
    for (const x of questions) {
      const ak = `${x.src}:${x.sub}@${x.state}`;
      const body = states[x.state];
      if (!body) { unasked.push(ak); continue; }
      const sh = hashOf(body);
      if (!groups.has(sh)) groups.set(sh, { body, stateNames: new Set(), qs: new Map() });
      const g = groups.get(sh);
      g.stateNames.add(x.state);
      const qh = hashOf(x.q);
      if (!g.qs.has(qh)) g.qs.set(qh, { q: x.q, answerKeys: [] });
      g.qs.get(qh).answerKeys.push(ak);
    }
    for (const [sh, g] of groups) {
      const stateTok = estTokens(g.body);
      let chunk = [];
      let tok = stateTok;
      const flush = () => {
        if (!chunk.length) return;
        const qmap = {};
        const back = {};
        chunk.forEach((c, i) => { const k = `q${i + 1}`; qmap[k] = c.q; back[k] = c.answerKeys; });
        const body = { model: MODEL, state: g.body, questions: qmap };
        const size = sizeRequest(body, `${slug}/${scene.id}/${[...g.stateNames].join('+')}`);
        jobs.push({ body, est: size.est, reserveUsd: usd(size.reserveTok + RESERVE_FIXED_TOK), back, meta: { i: jobs.length, scene: si, label: `${slug}/${scene.id}/${[...g.stateNames].join('+')}#${jobs.length}` } });
        chunk = []; tok = stateTok;
      };
      for (const c of g.qs.values()) {
        const t = estTokens(c.q);
        if (tok + t > MAX_EST_PER_REQ) flush();
        chunk.push(c); tok += t;
      }
      flush();
    }
    scenes.push({ id: scene.id, start_ms: scene.start_ms, end_ms: scene.end_ms, start_cue: scene.start_cue, end_cue: scene.end_cue, summary_empty: summaryEmpty, lyric_cues: lyricCues, unasked, answers: {} });
  }
  return { seg, items, jobs, scenes, questionCount: questions.length };
}

const plans = Object.fromEntries(films.map((s) => [s, planFilm(s)]));
const tot = (f) => Object.values(plans).reduce((a, p) => a + f(p), 0);
const estTok = tot((p) => p.jobs.reduce((a, j) => a + j.est, 0));
const reserveUsd = tot((p) => p.jobs.reduce((a, j) => a + j.reserveUsd, 0));
const summary = {
  films: films.length, scenes: tot((p) => p.scenes.length), requests: tot((p) => p.jobs.length),
  questions_asked: tot((p) => p.jobs.reduce((a, j) => a + Object.keys(j.body.questions).length, 0)),
  est_tokens: estTok, est_usd_at_3_2_cpt: +usd(estTok).toFixed(4), expected_usd_at_v9_billed_ratio_0_87: +usd(estTok * 0.87).toFixed(4), worst_case_reserve_usd: +reserveUsd.toFixed(4), cap_usd: CAP,
  per_film: Object.fromEntries(Object.entries(plans).map(([s, p]) => [s, { scenes: p.scenes.length, film_items: p.items.length, pooled_questions_per_scene: p.questionCount, requests: p.jobs.length, est_usd: +usd(p.jobs.reduce((a, j) => a + j.est, 0)).toFixed(4) }])),
};
console.log(JSON.stringify(summary, null, 2));
if (args.show) {
  const [slug, sid] = String(args.show).split(':');
  const p = plans[slug];
  const si = p.scenes.findIndex((s) => s.id === sid);
  fs.writeFileSync(path.join(HERE, `show.${slug}.${sid}.json`), JSON.stringify(p.jobs.filter((j) => j.meta.scene === si).map((j) => ({ label: j.meta.label, est: j.est, body: j.body })), null, 2));
  process.exit(0);
}
if (args['dry-run']) process.exit(0);

// ---- live ----
fs.mkdirSync(OUT, { recursive: true });
const priorSpend = fs.existsSync(LEDGER) ? fs.readFileSync(LEDGER, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((e) => e.kind === 'actual').reduce((a, e) => a + e.usd, 0) : 0;
const B = budget(CAP - priorSpend);
ledger({ kind: 'reserve_plan', films, worst_case_usd: +reserveUsd.toFixed(6), expected_usd: summary.expected_usd_at_v9_billed_ratio_0_87, prior_spend_usd: +priorSpend.toFixed(6), cap_usd: CAP, note: 'per-request worst case is reserved again before each dispatch (budget.js)' });
const KEY = key('TYPESAFE_API_KEY');
let grand = 0;
for (const slug of films) {
  const file = path.join(OUT, `${slug}.answers.json`);
  if (fs.existsSync(file) && JSON.parse(fs.readFileSync(file, 'utf8')).complete) { console.log(`${slug}: done already, skipped`); continue; }
  const p = plans[slug];
  const spentBefore = B.spent;
  const t0 = Date.now();
  const { results, stopped } = await runJobs(p.jobs, { key: KEY, budget: B, concurrency: 4, log: (s) => { if (/ERROR|OVER RESERVE/.test(s)) process.stderr.write(`${s}\n`); } });
  const reqs = [];
  let errors = 0;
  results.forEach((r, j) => {
    const job = p.jobs[j];
    reqs.push({ label: job.meta.label, est: job.est, reserve_usd: job.reserveUsd, ...(r.record ?? {}), skipped: r.skipped ?? null, attempts: undefined });
    if (!r.ok) { errors += 1; return; }
    const sc = p.scenes[job.meta.scene];
    for (const [k, aks] of Object.entries(job.back)) {
      const a = r.json.answers?.[k];
      if (!a || typeof a.noul !== 'number') { errors += 1; continue; }
      for (const ak of aks) sc.answers[ak] = a.noul;
    }
  });
  const cost = B.spent - spentBefore;
  grand += cost;
  ledger({ kind: 'actual', film: slug, usd: +cost.toFixed(8), requests: p.jobs.length, errors, input_tokens: reqs.reduce((a, r) => a + (r.input_tokens ?? 0), 0), over_reserve: reqs.filter((r) => r.over_reserve).length });
  const out = { film: p.seg.film, model: MODEL, run_at: new Date(t0).toISOString(), wall_ms: Date.now() - t0, complete: !stopped && errors === 0, stopped, errors, cost_usd: +cost.toFixed(8),
    film_items: p.items.map((it) => ({ id: it.id, type: it.type, group: it.group, name: it.name, entity: it.entity })),
    input_tokens: reqs.reduce((a, r) => a + (r.input_tokens ?? 0), 0), est_tokens: p.jobs.reduce((a, j) => a + j.est, 0),
    requests: reqs.map(({ label, est, input_tokens, cost_usd, reserve_usd, over_reserve, retries, skipped, error, latency_ms }) => ({ label, est, input_tokens, cost_usd, reserve_usd, over_reserve, retries, skipped, error, latency_ms })),
    scenes: p.scenes };
  fs.writeFileSync(file, JSON.stringify(out));
  console.log(`${slug}: ${p.jobs.length} requests, errors ${errors}, $${cost.toFixed(6)} (run total $${grand.toFixed(6)}, spent ${B.spent.toFixed(6)} of ${B.cap.toFixed(4)}), ${Math.round((Date.now() - t0) / 1000)} s${stopped ? ` STOPPED: ${stopped.reason}` : ''}`);
  if (stopped) break;
}
