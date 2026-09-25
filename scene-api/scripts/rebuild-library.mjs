#!/usr/bin/env node
// Re-run the library through the Jev-first pipeline (v10.4), ONE FILM AT A TIME, through the deployed
// scene-api's passcode-gated admin endpoint. Each rebuild replaces that film's guide atomically when its
// run finishes, and keeps the previous guide as a restorable backup (POST /api/admin/restore).
//
//   node scripts/rebuild-library.mjs [--api https://tinyviewers-scenes.vercel.app] [--films nemo,frozen]
//                                    [--keep-going] [--dry-run] [--poll-seconds 5]
//
// SPENDS MONEY (about $0.55-0.70 a film: Sonnet reads each film again; the admission reserves $2.41 of the
// day's REBUILD_DAILY_CAP_USD, default $15, per film while it runs).
//
// The passcode is ADD_FILM_PASSCODE, from the environment or parsed (never shell-sourced, never printed)
// from scene-api/.env.local or ../.env.local. Stops at the first film that fails unless --keep-going; a
// failed rebuild leaves that film's guide as it was. Prints one line per film: status, scenes, cost, backup.
//
// Sequential on purpose: the API runs one job at a time (the jobs_one_live lock), and a busy answer is
// waited out rather than retried in a loop.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const LIBRARY = ['nemo', 'frankenweenie', 'frozen', 'monsters-inc', 'room-on-the-broom', 'iron-giant', 'lion-king', 'wild-robot'];
const here = path.dirname(fileURLToPath(import.meta.url));

function envFile(file) {
  const out = {};
  if (!fs.existsSync(file)) return out;
  for (const raw of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = raw.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    out[m[1]] = v;
  }
  return out;
}

export function passcode(env = process.env) {
  if (env.ADD_FILM_PASSCODE?.trim()) return env.ADD_FILM_PASSCODE.trim();
  for (const f of [path.join(here, '..', '.env.local'), path.join(here, '..', '..', '.env.local')]) {
    const v = envFile(f).ADD_FILM_PASSCODE;
    if (v?.trim()) return v.trim();
  }
  return null;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function call(api, method, p, body, fetchImpl) {
  const res = await fetchImpl(`${api}${p}`, { method, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  let json = null;
  try { json = await res.json(); } catch { /* not JSON */ }
  return { status: res.status, json };
}

/**
 * Rebuild the films in order. Returns [{ slug, status, ... }]. `log` gets one line per event; nothing it
 * prints carries the passcode.
 */
export async function rebuildLibrary({ api, films = LIBRARY, code, keepGoing = false, pollMs = 5000, fetchImpl = globalThis.fetch, log = console.log, maxWaitMs = 45 * 60 * 1000 }) {
  const results = [];
  for (const slug of films) {
    let started = null;
    const t0 = Date.now();
    while (!started) {
      const r = await call(api, 'POST', '/api/admin/rebuild', { slug, passcode: code }, fetchImpl);
      if (r.status === 202) { started = r.json; break; }
      if (r.status === 409 && r.json?.error_code === 'busy') {
        if (Date.now() - t0 > maxWaitMs) { results.push({ slug, status: 'not_started', error_code: 'busy' }); break; }
        log(`${slug}: another job is running (${r.json.id ?? '?'}); waiting`);
        await sleep(pollMs * 4);
        continue;
      }
      results.push({ slug, status: 'not_started', http: r.status, error_code: r.json?.error_code ?? null, error: r.json?.message ?? null });
      log(`${slug}: NOT STARTED (${r.status} ${r.json?.error_code ?? ''}) ${r.json?.message ?? ''}`);
      break;
    }
    if (!started) { if (!keepGoing) break; continue; }
    log(`${slug}: rebuilding (job ${started.id})`);
    let job = null;
    let lastStep = null;
    for (;;) {
      await sleep(pollMs);
      const r = await call(api, 'GET', `/api/add/jobs/${started.id}`, null, fetchImpl);
      if (r.status !== 200) { log(`${slug}: poll answered ${r.status}; retrying`); continue; }
      job = r.json;
      const running = job.steps?.find((s) => s.status === 'running');
      if (running && running.id !== lastStep) { lastStep = running.id; log(`${slug}:   ${running.label}`); }
      if (job.status === 'done' || job.status === 'failed') break;
      if (Date.now() - t0 > maxWaitMs) { log(`${slug}: still running after ${Math.round(maxWaitMs / 60000)} min; leaving it (it finishes on its own)`); break; }
    }
    const ingest = job?.steps?.find((s) => s.id === 'ingest');
    const row = { slug, id: started.id, status: job?.status ?? 'unknown', scenes: job?.scene_count ?? null, cost_usd: job?.cost_usd ?? null, error_code: job?.error_code ?? null, error: job?.error ?? null, detail: ingest?.detail ?? null };
    results.push(row);
    log(`${slug}: ${row.status}${row.status === 'done' ? `, ${row.scenes} scenes, $${Number(row.cost_usd).toFixed(4)} (${row.detail ?? ''})` : ` (${row.error_code}: ${row.error})`}`);
    if (row.status !== 'done' && !keepGoing) break;
  }
  return results;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2);
  const opt = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
  const api = String(opt('api', process.env.SCENE_API_URL || 'https://tinyviewers-scenes.vercel.app')).replace(/\/+$/, '');
  const films = opt('films', null)?.split(',').map((s) => s.trim()).filter(Boolean) ?? LIBRARY;
  if (argv.includes('--dry-run')) {
    console.log(`would rebuild, in order, on ${api}: ${films.join(', ')}`);
    process.exit(0);
  }
  const code = passcode();
  if (!code) { console.error('ADD_FILM_PASSCODE is not in the environment or .env.local'); process.exit(2); }
  const results = await rebuildLibrary({ api, films, code, keepGoing: argv.includes('--keep-going'), pollMs: Number(opt('poll-seconds', 5)) * 1000 });
  const ok = results.filter((r) => r.status === 'done').length;
  console.log(`\n${ok} of ${films.length} films rebuilt; total $${results.reduce((a, r) => a + (Number(r.cost_usd) || 0), 0).toFixed(4)}`);
  process.exit(ok === films.length ? 0 : 1);
}
