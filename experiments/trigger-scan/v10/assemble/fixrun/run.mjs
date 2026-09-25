#!/usr/bin/env node
// LINT-FIX RUN: asks Jev (jev-1.13.0) the lint-fix variants (fixes.mjs) on every scene of the 13 seen films,
// over v9's segmentation and verified summaries, in the same states the tournament used
// (jevfirst/tournament/pool.mjs sceneStates). Same runner discipline as the tournament (tournament/run.mjs):
// one request per scene per distinct state; every request reserves its worst case (2.5 chars/token of the
// JSON + 1,500 tokens fixed overhead) BEFORE dispatch against a hard cap; reservations and actual spend
// go to ledger.jsonl; the key is parsed in Node (v9/env.js) and never printed.
//
//   node assemble/fixrun/run.mjs --dry-run      price it (no calls)
//   node assemble/fixrun/run.mjs [--cap 0.80]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSrt } from '../../../srt.js';
import { budget } from '../../../v9/budget.js';
import { key } from '../../../v9/env.js';
import { sizeRequest, runJobs, usd, estTokens } from '../../../v9/jev-client.js';
import { sceneStates, hashOf, MODEL } from '../../jevfirst/tournament/pool.mjs';
import { FILMS } from '../../jevfirst/tournament/films.mjs';
import { buildFixes } from './fixes.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const V9OUT = path.resolve(HERE, '../../../v9/out');
const DATA = path.resolve(HERE, '../../../data');
const OUT = path.join(HERE, 'out');
const LEDGER = path.join(HERE, 'ledger.jsonl');
const MAX_EST_PER_REQ = 40_000;
const RESERVE_FIXED_TOK = 1500;
const args = Object.fromEntries(process.argv.slice(2).map((a, i, arr) => (a.startsWith('--') ? [a.slice(2), arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : true] : null)).filter(Boolean));
const CAP = Number(args.cap ?? 0.8);
const ledger = (e) => fs.appendFileSync(LEDGER, JSON.stringify({ at: new Date().toISOString(), ...e }) + '\n');
const FIXES = buildFixes();

function planFilm(slug) {
  const seg = JSON.parse(fs.readFileSync(path.join(V9OUT, `${slug}.segments.json`), 'utf8'));
  const cues = parseSrt(fs.readFileSync(path.join(DATA, `${slug}.srt`), 'utf8')).map((c, i) => ({ ...c, index: i + 1 }));
  const jobs = []; const scenes = [];
  for (const [si, scene] of seg.scenes.entries()) {
    const { states, summaryEmpty } = sceneStates({ seg, scene, cues: cues.slice(scene.start_cue - 1, scene.end_cue) });
    const groups = new Map(); const unasked = [];
    for (const x of FIXES) {
      const body = states[x.state];
      if (!body) { unasked.push(x.key); continue; }
      const sh = hashOf(body);
      if (!groups.has(sh)) groups.set(sh, { body, names: new Set(), qs: [] });
      const g = groups.get(sh); g.names.add(x.state); g.qs.push(x);
    }
    for (const g of groups.values()) {
      const stateTok = estTokens(g.body);
      let chunk = []; let tok = stateTok;
      const flush = () => {
        if (!chunk.length) return;
        const qmap = {}; const back = {};
        chunk.forEach((c, i) => { qmap[`q${i + 1}`] = c.q; back[`q${i + 1}`] = c.key; });
        const body = { model: MODEL, state: g.body, questions: qmap };
        const size = sizeRequest(body, `${slug}/${scene.id}/${[...g.names].join('+')}`);
        jobs.push({ body, est: size.est, reserveUsd: usd(size.reserveTok + RESERVE_FIXED_TOK), back, meta: { i: jobs.length, scene: si, label: `${slug}/${scene.id}/${[...g.names].join('+')}#${jobs.length}` } });
        chunk = []; tok = stateTok;
      };
      for (const c of g.qs) { const t = estTokens(c.q); if (tok + t > MAX_EST_PER_REQ) flush(); chunk.push(c); tok += t; }
      flush();
    }
    scenes.push({ id: scene.id, start_ms: scene.start_ms, end_ms: scene.end_ms, summary_empty: summaryEmpty, unasked, answers: {} });
  }
  return { seg, jobs, scenes };
}

const plans = Object.fromEntries(FILMS.map((s) => [s, planFilm(s)]));
const tot = (f) => Object.values(plans).reduce((a, p) => a + f(p), 0);
const estTok = tot((p) => p.jobs.reduce((a, j) => a + j.est, 0));
const reserveUsd = tot((p) => p.jobs.reduce((a, j) => a + j.reserveUsd, 0));
console.log(JSON.stringify({ fixes: FIXES.length, films: FILMS.length, scenes: tot((p) => p.scenes.length), requests: tot((p) => p.jobs.length), est_tokens: estTok, est_usd: +usd(estTok).toFixed(4), expected_usd_at_0_87: +usd(estTok * 0.87).toFixed(4), worst_case_reserve_usd: +reserveUsd.toFixed(4), cap_usd: CAP }, null, 2));
if (args['dry-run']) process.exit(0);

fs.mkdirSync(OUT, { recursive: true });
const prior = fs.existsSync(LEDGER) ? fs.readFileSync(LEDGER, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((e) => e.kind === 'actual').reduce((a, e) => a + e.usd, 0) : 0;
const B = budget(CAP - prior);
ledger({ kind: 'reserve_plan', worst_case_usd: +reserveUsd.toFixed(6), prior_spend_usd: +prior.toFixed(6), cap_usd: CAP });
const KEY = key('TYPESAFE_API_KEY');
for (const slug of FILMS) {
  const file = path.join(OUT, `${slug}.answers.json`);
  if (fs.existsSync(file) && JSON.parse(fs.readFileSync(file, 'utf8')).complete) { console.log(`${slug}: done already`); continue; }
  const p = plans[slug];
  const before = B.spent; const t0 = Date.now();
  const { results, stopped } = await runJobs(p.jobs, { key: KEY, budget: B, concurrency: 4, log: (s) => { if (/ERROR|OVER RESERVE/.test(s)) process.stderr.write(`${s}\n`); } });
  let errors = 0; const reqs = [];
  results.forEach((r, j) => {
    const job = p.jobs[j];
    reqs.push({ label: job.meta.label, est: job.est, reserve_usd: job.reserveUsd, input_tokens: r.record?.input_tokens, cost_usd: r.record?.cost_usd, over_reserve: r.record?.over_reserve, skipped: r.skipped ?? null, error: r.error ?? null });
    if (!r.ok) { errors += 1; return; }
    const sc = p.scenes[job.meta.scene];
    for (const [k, ak] of Object.entries(job.back)) { const a = r.json.answers?.[k]; if (!a || typeof a.noul !== 'number') { errors += 1; continue; } sc.answers[ak] = a.noul; }
  });
  const cost = B.spent - before;
  ledger({ kind: 'actual', film: slug, usd: +cost.toFixed(8), requests: p.jobs.length, errors, input_tokens: reqs.reduce((a, r) => a + (r.input_tokens ?? 0), 0), over_reserve: reqs.filter((r) => r.over_reserve).length });
  fs.writeFileSync(file, JSON.stringify({ film: p.seg.film, model: MODEL, run_at: new Date(t0).toISOString(), complete: !stopped && errors === 0, stopped, errors, cost_usd: +cost.toFixed(8), fixes: FIXES.map((f) => ({ key: f.key, fixes: f.fixes })), requests: reqs, scenes: p.scenes }));
  console.log(`${slug}: ${p.jobs.length} requests, errors ${errors}, $${cost.toFixed(6)} (spent ${B.spent.toFixed(6)} of ${B.cap.toFixed(4)})${stopped ? ` STOPPED ${stopped.reason}` : ''}`);
  if (stopped) break;
  if (errors && errors >= p.jobs.length) { console.error(`${slug}: every request failed (first error: ${reqs.find((x) => x.error)?.error?.slice(0, 160)}); stopping (2026-09-25: HTTP 402, no TypeSafe credits)`); process.exitCode = 1; break; }
}
