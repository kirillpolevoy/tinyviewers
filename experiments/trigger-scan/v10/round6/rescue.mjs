#!/usr/bin/env node
// Round-6 SUPPLEMENTARY RESCUE (evaluation harness; NOT the frozen configuration). The frozen run (run-film.js,
// segment --cap 0.45) REJECTED frozen and zootopia: attempt 1 (whole film) failed the split gate on
// max_scene_minutes only (10.85 / 10.58 > 10) and attempt 2 (halves) was refused by the $0.45 per-film cap.
// This rescue changes ONE run argument, never a frozen file: segment.js is re-run with its own default cap
// (--cap 0.90, per film across reruns, so the attempt-1 spend counts) and --attempt1-from the saved attempt-1
// output (no new whole-film call; replayed through the same frozen gate, so attempt 2 runs). Every later stage is
// run-film.js --from <stage> --to <stage> --final-held-out-run, unchanged. Each stage's worst case is reserved
// against the $3.00 phase cap (spend.mjs) before it starts; films run one after the other.
//   node round6/rescue.mjs [frozen,zootopia]
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { spent, PHASE_CAP } from './spend.mjs';
const here = path.dirname(fileURLToPath(import.meta.url));
const V10 = path.resolve(here, '..');
const LOGS = path.join(here, 'out', 'logs'); fs.mkdirSync(LOGS, { recursive: true });
const FILMS = (process.argv[2] ?? 'frozen,zootopia').split(',');
const SEG_CAP = 0.90; const SPLIT_CAP = 0.03;
const REST = [['claims', 0.05], ['fill', 0.17], ['refold', 0], ['classify', 0.25], ['sonnetq', 0.30], ['select1', 0], ['moments', 0.02], ['select2', 0], ['describe', 0.15], ['checkdesc', 0.02], ['select3', 0]];
const log = (m) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${m}`);
const filmSonnet = (slug) => { try { return JSON.parse(fs.readFileSync(path.join(V10, 'out10', `${slug}.spend.json`), 'utf8')).entries.filter((e) => e.kind === 'sonnet').reduce((a, e) => a + e.usd, 0); } catch { return 0; } };
function stage(slug, name, reserve, cmd) {
  const s = spent().total;
  if (s + reserve > PHASE_CAP + 1e-9) { log(`${slug} ${name}: REFUSED (spent ${s.toFixed(4)} + reserve ${reserve.toFixed(3)} > ${PHASE_CAP})`); return false; }
  log(`${slug} ${name}: start (reserved ${reserve.toFixed(3)}; spent ${s.toFixed(4)})`);
  const r = spawnSync(process.execPath, cmd, { cwd: V10, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const out = `${r.stdout ?? ''}\n--- stderr ---\n${r.stderr ?? ''}`;
  fs.writeFileSync(path.join(LOGS, `${slug}.rescue.${name}.log`), out);
  log(`${slug} ${name}: exit ${r.status}; spent ${spent().total.toFixed(4)} :: ${String(r.stdout ?? '').trim().split('\n').filter(Boolean).slice(-2).join(' | ').slice(0, 400)}`);
  return r.status === 0;
}
for (const slug of FILMS) {
  const raw = path.join(here, 'out', `${slug}.attempt1.json`);
  if (fs.existsSync(path.join(V10, 'out10', `${slug}.segments.json`))) { log(`${slug}: segments exist, skipping segment`); }
  else {
    const reserve = Math.max(0, SEG_CAP - filmSonnet(slug)) + SPLIT_CAP;
    if (!stage(slug, 'segment', reserve, [path.join(V10, 'segment.js'), slug, '--cap', String(SEG_CAP), '--split-cap', String(SPLIT_CAP), '--attempt1-from', raw, '--final-held-out-run'])) continue;
  }
  for (const [name, cap] of REST) if (!stage(slug, name, cap, [path.join(V10, 'run-film.js'), slug, '--from', name, '--to', name, '--final-held-out-run'])) break;
}
log(`done; spend ${JSON.stringify(spent())}`);
