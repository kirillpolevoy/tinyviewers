#!/usr/bin/env node
// v8 STAGE RUNNER: one film through the whole v8 pipeline, in order, each stage a separate process with
// its own cap (every model call inside reserves its worst case first). Stops at the first failing stage.
//
//   node run-film.js <slug> [--from <stage>] [--to <stage>] [--dry] [--final-held-out-run]
//
// Stages (logs in <out>/logs/<slug>.<stage>.log):
//   sources    sources.js       Wikipedia plot (revision pinned) + TMDB cast            (no model)
//   segment    segment.js       Sonnet split from verified sources + split gate, retry   Sonnet <= $0.45, Jev <= $0.03
//   claims     check-claims.js  Jev claim check + Wikipedia placement                    Jev <= $0.05
//   fill       fill.js          wordless scenes: Sonnet from W-sentences + Jev checks    Sonnet <= $0.15, Jev <= $0.02
//   refold     refold.js        unified acceptance rule (claim precedence), summaries    (no model)
//   classify   classify.js      Jev, two requests per scene                              Jev <= $0.25
//   select1    select.js        flags from the answers                                   (no model)
//   moments    moments.js       Jev moment spans in flagged scenes (+ wordless extension) Jev <= $0.02
//   select2    select.js        flags + skip spans                                       (no model)
//   reasons    reasons.js       Jev: which verified sentence states why, else generated  Jev <= $0.01
//   select3    select.js        flags + spans + why                                      (no model)
// A held-out film needs --final-held-out-run and an intact out/freeze.json (every stage checks it).
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { outDir, heldOutGate } from './env.js';

const here = path.dirname(fileURLToPath(import.meta.url));
export const STAGES = [
  ['sources', 'sources.js', []],
  ['segment', 'segment.js', ['--cap', '0.45', '--split-cap', '0.03']],
  ['claims', 'check-claims.js', ['--cap', '0.05']],
  ['fill', 'fill.js', ['--cap', '0.15', '--jev-cap', '0.02']],
  ['refold', 'refold.js', []],
  ['classify', 'classify.js', ['--run', 'r1', '--cap', '0.25']],
  ['select1', 'select.js', ['--run', 'r1']],
  ['moments', 'moments.js', ['--run', 'r1', '--cap', '0.02']],
  ['select2', 'select.js', ['--run', 'r1']],
  ['reasons', 'reasons.js', ['--run', 'r1', '--cap', '0.01']],
  ['select3', 'select.js', ['--run', 'r1']],
];

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2);
  const slug = argv.find((a) => !a.startsWith('--') && !['--from', '--to'].includes(argv[argv.indexOf(a) - 1]));
  const opt = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
  if (!slug) { console.error('usage: node run-film.js <slug> [--from stage] [--to stage] [--dry] [--final-held-out-run]'); process.exit(2); }
  heldOutGate(slug);
  const names = STAGES.map((s) => s[0]);
  const from = names.indexOf(opt('from', names[0]));
  const to = names.indexOf(opt('to', names.at(-1)));
  if (from < 0 || to < 0) { console.error(`stages: ${names.join(', ')}`); process.exit(2); }
  const pass = argv.includes('--final-held-out-run') ? ['--final-held-out-run'] : [];
  const logs = path.join(outDir(), 'logs');
  fs.mkdirSync(logs, { recursive: true });
  for (const [name, script, args] of STAGES.slice(from, to + 1)) {
    const cmd = [path.join(here, script), slug, ...args, ...pass];
    console.log(`[${name}] node ${path.relative(here, cmd[0])} ${cmd.slice(1).join(' ')}`);
    if (argv.includes('--dry')) continue;
    const r = spawnSync(process.execPath, cmd, { cwd: here, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    fs.writeFileSync(path.join(logs, `${slug}.${name}.log`), `${r.stdout ?? ''}\n--- stderr ---\n${r.stderr ?? ''}`);
    const tail = String(r.stdout ?? '').trim().split('\n').slice(0, 3).join('\n  ');
    if (tail) console.log(`  ${tail}`);
    if (r.status !== 0) { console.error(`[${name}] FAILED (exit ${r.status}); log ${path.relative(here, path.join(logs, `${slug}.${name}.log`))}`); process.exit(r.status || 1); }
  }
}
