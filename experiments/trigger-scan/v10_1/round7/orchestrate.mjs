#!/usr/bin/env node
// Round-7 (v10.1 held-out run; evaluation harness, not pipeline, not frozen). Runs the frozen v10.1 chain
// (run-film.js <slug> --from X --to X [--final-held-out-run], one stage per process, in order) on:
//   frozen, zootopia   HELD OUT: outputs in v10_1/out101 (the freeze gate checks out101/freeze.json)
//   good-dinosaur      SEEN/dev: outputs in v10_1/round7/gd-out (V101_OUT), so the fix agent's out101 run is
//                      never overwritten
// Sources: sources.js is unchanged in v10.1, so the pinned v10/sources/<slug>.json are reused (env.js
// sourcesFile fallback); the chain starts at 'segment'. The live pipeline is NOT re-run (round6/live reused).
// SPEND: phase cap $2.50 over this round's three ledgers. Before a stage starts, its whole worst-case cap
// is reserved: spent + in-flight reservations + cap <= 2.50, else wait (or stop when nothing is in flight).
// Every model call inside a stage also reserves its own worst case (the pipeline's per-call rule).
// Jev stages run one at a time across films.
//   node round7/orchestrate.mjs [--films a,b]
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { spent, PHASE_CAP, FILMS as ALL, outFor } from './spend.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const V101 = path.resolve(here, '..');
const LOGS = path.join(here, 'out', 'logs');
fs.mkdirSync(LOGS, { recursive: true });
const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const FILMS = opt('films', ALL.join(',')).split(',');

// v10.1 run-film.js STAGES caps (Sonnet + Jev per stage) and whether Jev is called
const STAGES = [
  ['segment', 1.08, true], ['claims', 0.05, true], ['fill', 0.17, true], ['refold', 0, false],
  ['classify', 0.25, true], ['sonnetq', 0.30, false], ['childcry', 0.01, true], ['select1', 0, false],
  ['moments', 0.02, true], ['select2', 0, false], ['describe', 0.15, false], ['checkdesc', 0.08, true], ['select3', 0, false],
];

let pending = 0; let inflight = 0; let jevBusy = false;
const log = (m) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${m}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function acquire(cap, jev) {
  for (;;) {
    const s = spent().total;
    if ((!jev || !jevBusy) && s + pending + cap <= PHASE_CAP + 1e-9) { pending += cap; inflight++; if (jev) jevBusy = true; return true; }
    if (inflight === 0 && s + cap > PHASE_CAP) return false;
    await sleep(2000);
  }
}
function release(cap, jev) { pending -= cap; inflight--; if (jev) jevBusy = false; }
function run(args, logFile, env) {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, [path.join(V101, 'run-film.js'), ...args], { cwd: V101, env: { ...process.env, ...env } });
    let out = '';
    p.stdout.on('data', (d) => { out += d; }); p.stderr.on('data', (d) => { out += d; });
    p.on('close', (code) => { fs.writeFileSync(logFile, out); resolve({ code, out }); });
  });
}
async function chain(slug) {
  const held = slug !== 'good-dinosaur';
  const env = held ? {} : { V101_OUT: path.relative(V101, outFor(slug)) };
  for (const [name, cap, jev] of STAGES) {
    if (!(await acquire(cap, jev))) { log(`${slug} ${name}: REFUSED (phase cap ${PHASE_CAP}, spent ${spent().total.toFixed(4)})`); return false; }
    const t0 = Date.now();
    log(`${slug} ${name}: start (reserved ${cap}; spent ${spent().total.toFixed(4)}, pending ${pending.toFixed(2)})`);
    const r = await run([slug, '--from', name, '--to', name, ...(held ? ['--final-held-out-run'] : [])], path.join(LOGS, `${slug}.${name}.log`), env);
    release(cap, jev);
    const tail = r.out.trim().split('\n').filter(Boolean).slice(-2).join(' | ').slice(0, 400);
    log(`${slug} ${name}: exit ${r.code} in ${Math.round((Date.now() - t0) / 1000)} s; spent ${spent().total.toFixed(4)} :: ${tail}`);
    if (r.code !== 0) return false;
  }
  return true;
}
const res = await Promise.all(FILMS.map((s) => chain(s).then((ok) => [s, ok])));
log(`done: ${JSON.stringify(res)}; spend ${JSON.stringify(spent())}`);
