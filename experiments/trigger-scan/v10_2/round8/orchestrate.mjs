#!/usr/bin/env node
// Round-8 orchestrator (evaluation harness; not pipeline, not frozen; copy of v10/round6/orchestrate.mjs with v10.2's
// stages). For each fresh film (incredibles, big-hero-6, brave -- held out for v10.2) it runs
//   live   round8/run-live.mjs <slug> scenes -> presence -> build   (scene-api/pipeline imported read-only)
//   v10.2  run-film.js <slug> --from X --to X --final-held-out-run   (one stage per process, in order; every stage
//          re-checks out102/freeze.json through env.js heldOutGate)
// Before a stage starts, its whole worst-case cap is reserved against the $3.00 phase cap (spend.mjs): spent (all
// ledgers) + caps of stages in flight + this cap <= 3.00, else it waits (or, if nothing is in flight, stops). Jev
// stages run one at a time across films. Every model call inside a stage also reserves its own worst case.
//   node round8/orchestrate.mjs [--films a,b] [--only live|v102]
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { spent, PHASE_CAP, FILMS as HELD } from './spend.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const V102 = path.resolve(here, '..');
const LOGS = path.join(here, 'out', 'logs');
fs.mkdirSync(LOGS, { recursive: true });
const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const FILMS = opt('films', HELD.join(',')).split(',');
const ONLY = opt('only', null);

// v10.2 run-film.js STAGES caps (Sonnet + Jev caps per stage) and whether Jev is called
const V102_STAGES = [
  ['sources', 0, false], ['segment', 1.08, true], ['claims', 0.05, true], ['fill', 0.17, true], ['refold', 0, false],
  ['classify', 0.25, true], ['sonnetq', 0.30, false], ['childcry', 0.01, true], ['resolve', 0.01, true], ['select1', 0, false],
  ['moments', 0.02, true], ['select2', 0, false], ['describe', 0.15, false], ['checkdesc', 0.08, true], ['select3', 0, false],
];
const LIVE_STAGES = [['scenes', 0.60, false], ['presence', 1.00, false], ['build', 0, false]];

let pending = 0; let jevBusy = false; let inflight = 0;
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
function run(cmd, args, logFile, env = {}) {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, [cmd, ...args], { cwd: V102, env: { ...process.env, ...env } });
    let out = '';
    p.stdout.on('data', (d) => { out += d; }); p.stderr.on('data', (d) => { out += d; });
    p.on('close', (code) => { fs.writeFileSync(logFile, out); resolve({ code, out }); });
  });
}
async function chain(slug, kind) {
  const stages = kind === 'live' ? LIVE_STAGES : V102_STAGES;
  for (const [name, cap, jev] of stages) {
    if (!(await acquire(cap, jev))) { log(`${kind} ${slug} ${name}: REFUSED (phase cap ${PHASE_CAP}, spent ${spent().total.toFixed(4)})`); return false; }
    const t0 = Date.now();
    log(`${kind} ${slug} ${name}: start (reserved ${cap}; spent ${spent().total.toFixed(4)}, pending ${pending.toFixed(2)})`);
    const logFile = path.join(LOGS, `${slug}.${kind}.${name}.log`);
    const r = kind === 'live'
      ? await run(path.join(here, 'run-live.mjs'), [slug, name], logFile, { R5_PENDING: String(Math.max(0, pending - cap)) })
      : await run(path.join(V102, 'run-film.js'), [slug, '--from', name, '--to', name, '--final-held-out-run'], logFile);
    release(cap, jev);
    const tail = r.out.trim().split('\n').filter(Boolean).slice(-2).join(' | ').slice(0, 400);
    log(`${kind} ${slug} ${name}: exit ${r.code} in ${Math.round((Date.now() - t0) / 1000)} s; spent ${spent().total.toFixed(4)} :: ${tail}`);
    if (r.code !== 0) return false;
  }
  return true;
}
const jobs = [];
for (const slug of FILMS) {
  if (ONLY !== 'v102') jobs.push(chain(slug, 'live').then((ok) => [slug, 'live', ok]));
  if (ONLY !== 'live') jobs.push(chain(slug, 'v102').then((ok) => [slug, 'v102', ok]));
}
const res = await Promise.all(jobs);
log(`done: ${JSON.stringify(res)}; spend ${JSON.stringify(spent())}`);
