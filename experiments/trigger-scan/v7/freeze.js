#!/usr/bin/env node
// v7 FREEZE. Records the sha256 of every file that decides what a model is asked, how answers become
// flags / skip spans / a split verdict, or which films may run (env.js FROZEN_FILES) into
// out/freeze.json. Run ONCE, after the dev-film work (nemo, monsters-inc, lion-king, frankenweenie,
// wild-robot) and BEFORE the first held-out step. The held-out gate (env.js heldOutGate, called by
// segment.js, check-split.js, check-claims.js, classify.js, moments.js, sources.js) refuses every
// non-dev film unless --final-held-out-run is passed AND every listed file still matches.
//
//   node freeze.js            write out/freeze.json (refuses to overwrite an existing one)
//   node freeze.js --check    print which frozen files changed (exit 1 if any)
//   node freeze.js --list     print the files that are (or would be) frozen, with their sha256
//
// Frozen (env.js FROZEN_FILES): questions.js, policy.json (flag policy, split_gate limits, moments /
// wordless span rules), select.js, check-claims.js, segment.js, segment-prompt.js, gate.js,
// check-split.js, claims.js, cite.js, validate.js, classify.js, moments.js, aliases.js, spans.js,
// sources.js, text.js, jev-client.js, jev.js, sonnet.js, budget.js, ledger.js, env.js, ../srt.js.
// Not frozen (scoring and dev analysis only, never read by the pipeline): compare.js, refscore.js,
// dev/*, test/*.
import fs from 'node:fs';
import path from 'node:path';
import { V7, FROZEN_FILES, FREEZE_FILE, sha256File, freezeStatus } from './env.js';

const file = FREEZE_FILE();
if (process.argv.includes('--list')) {
  for (const f of FROZEN_FILES) console.log(`${fs.existsSync(path.join(V7, f)) ? sha256File(f) : '(missing)'.padEnd(64)}  ${f}`);
  process.exit(0);
}
if (process.argv.includes('--check')) {
  const st = freezeStatus();
  console.log(st.missing ? 'no out/freeze.json' : st.ok ? `freeze intact (${st.frozen_at})` : `CHANGED since ${st.frozen_at}: ${st.changed.join(', ')}`);
  process.exit(st.ok ? 0 : 1);
}
if (fs.existsSync(file)) { console.error(`${path.relative(V7, file)} exists; not overwriting (delete it deliberately to re-freeze).`); process.exit(2); }
const missing = FROZEN_FILES.filter((f) => !fs.existsSync(path.join(V7, f)));
if (missing.length) { console.error(`cannot freeze: missing ${missing.join(', ')}`); process.exit(2); }
const files = Object.fromEntries(FROZEN_FILES.map((f) => [f, sha256File(f)]));
fs.mkdirSync(path.dirname(file), { recursive: true });
fs.writeFileSync(file, JSON.stringify({ frozen_at: new Date().toISOString(), version: 'v7', dev_films: ['nemo', 'monsters-inc', 'lion-king', 'frankenweenie', 'wild-robot'], note: 'sha256 of every file that decides what a model is asked, how answers become flags, skip spans or a split verdict, or which films may run. Held-out films are refused unless all still match.', files }, null, 2));
console.log(`${path.relative(V7, file)}: ${Object.keys(files).length} files frozen`);
