#!/usr/bin/env node
// v10.2 STAGE RUNNER: v10.1's + resolve (the resolution guard's Jev questions, fix 3) after childcry; outputs in
// out102 (env.js). Everything else as v10.1.
// v10.1 STAGE RUNNER (v10's + childcry, the per-attempt segment caps and a larger checkdesc cap).
// v10 STAGE RUNNER (v9's, with v10's classify / select): one film through the whole pipeline, in order, each
// stage a separate process with its own cap (every model call inside reserves its worst case first). Stops
// at the first failing stage. Outputs go to outDir() = v10_1/out101 (env.js); v10's outputs are never written.
//
//   node run-film.js <slug> [--from <stage>] [--to <stage>] [--dry] [--final-held-out-run]
//   node run-film.js <dev slug> --reuse-v9-segments [--to <stage>] [--dry]
//
// --reuse-v9-segments (dev films only): v10 changed nothing upstream of classify, so a dev film can start
// from v9's verified segmentation instead of paying for Sonnet segmentation again: the v9 files
// (<slug>.segments.json, .claims.json, .fill.json when present) are COPIED into out10 (never moved, never
// overwritten if already there) and the run starts at classify. A held-out film always runs every stage.
// v10 caps: classify's Jev set costs ~$0.05-0.06 per film (dry run: nemo 409 requests, est $0.060, worst-case
// reserve $0.103), so the v9 cap ($0.25) stays; sonnetq asks 12 ids instead of 43 (v9 max $0.045 per call).
//
// Stages (logs in <out>/logs/<slug>.<stage>.log):
//   sources    sources.js         Wikipedia plot (revision pinned) + TMDB cast            (no model)
//   segment    segment.js         Sonnet split from verified sources + JEV SPLIT GATE      Sonnet <= $1.05 per film:
//                                 attempt 1 <= $0.45, attempt 2 (halves) <= $0.60 set aside first (v10.1); Jev <= $0.03
//   claims     check-claims.js    Jev claim check + Wikipedia placement                    Jev <= $0.05
//   fill       fill.js            wordless scenes: Sonnet from W-sentences + Jev checks    Sonnet <= $0.15, Jev <= $0.02
//   refold     refold.js          unified acceptance rule (claim precedence), summaries    (no model)
//   classify   classify.js        JEV answers ITS questions (split.json), two requests/scene Jev <= $0.25
//   sonnetq    sonnetq.js         SONNET answers the rest (split.json), batched scenes     Sonnet <= $0.30
//   childcry   childcry.js        v10.1 rule 2: JEV 'is the one who cries a child?' where Sonnet's crying is at act  Jev <= $0.01
//   resolve    resolve.js         v10.2 fix 3: JEV guard questions (arrest / celebrate) where Sonnet's captured /
//                                 weapon_used is at act (+ the rule-1 question only if enabled)  Jev <= $0.01
//   select1    select.js          merge (merge.js) + the user's flag policy + v10.2 tier-A gate + guard (no model)
//   moments    moments.js         Jev moment spans in flagged scenes (+ wordless extension) Jev <= $0.02
//   select2    select.js          flags + skip spans                                       (no model)
//   describe   describe.js        SONNET title + 1-2 cited sentences per flagged scene     Sonnet <= $0.15
//   checkdesc  check-describe.js  JEV claim check of every sentence + v10.1 text safety     Jev <= $0.08
//                                 (reason claim checks, margin, direction check); code rebuilds the text
//   select3    select.js          flags + spans + parent text                              (no model)
// A held-out film needs --final-held-out-run and an intact out/freeze.json (every stage checks it).
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { outDir, heldOutGate, HELD_OUT } from './env.js';

const here = path.dirname(fileURLToPath(import.meta.url));
export const STAGES = [
  ['sources', 'sources.js', []],
  ['segment', 'segment.js', ['--cap', '1.05', '--attempt1-cap', '0.45', '--attempt2-cap', '0.60', '--split-cap', '0.03']],
  ['claims', 'check-claims.js', ['--cap', '0.05']],
  ['fill', 'fill.js', ['--cap', '0.15', '--jev-cap', '0.02']],
  ['refold', 'refold.js', []],
  ['classify', 'classify.js', ['--run', 'r1', '--cap', '0.25']],
  ['sonnetq', 'sonnetq.js', ['--run', 'r1', '--cap', '0.30']],
  ['childcry', 'childcry.js', ['--run', 'r1', '--cap', '0.01']],
  ['resolve', 'resolve.js', ['--run', 'r1', '--cap', '0.01']],
  ['select1', 'select.js', ['--run', 'r1']],
  ['moments', 'moments.js', ['--run', 'r1', '--cap', '0.02']],
  ['select2', 'select.js', ['--run', 'r1']],
  ['describe', 'describe.js', ['--run', 'r1', '--cap', '0.15']],
  ['checkdesc', 'check-describe.js', ['--run', 'r1', '--cap', '0.08']],
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
  let fromIdx = from;
  if (argv.includes('--reuse-v9-segments')) {
    if (HELD_OUT.has(slug)) { console.error(`${slug} is held out: --reuse-v9-segments is for dev films only (a held-out film runs every stage)`); process.exit(2); }
    const v9out = path.resolve(here, '..', 'v9', 'out');
    const seg = path.join(v9out, `${slug}.segments.json`);
    if (!fs.existsSync(seg)) { console.error(`no v9 segments for ${slug} (${path.relative(here, seg)})`); process.exit(2); }
    for (const f of [`${slug}.segments.json`, `${slug}.claims.json`, `${slug}.fill.json`]) {
      const src = path.join(v9out, f); const dst = path.join(outDir(), f);
      if (!fs.existsSync(src)) continue;
      if (fs.existsSync(dst)) { console.log(`[seed] ${path.relative(here, dst)} exists, kept`); continue; }
      if (argv.includes('--dry')) { console.log(`[seed] would copy ${path.relative(here, src)} -> ${path.relative(here, dst)}`); continue; }
      fs.copyFileSync(src, dst, fs.constants.COPYFILE_EXCL);
      console.log(`[seed] copied ${path.relative(here, src)} -> ${path.relative(here, dst)}`);
    }
    fromIdx = Math.max(from, names.indexOf('classify'));
  }
  const logs = path.join(outDir(), 'logs');
  fs.mkdirSync(logs, { recursive: true });
  for (const [name, script, args] of STAGES.slice(fromIdx, to + 1)) {
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
