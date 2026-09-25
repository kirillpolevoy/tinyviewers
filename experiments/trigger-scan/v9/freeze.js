#!/usr/bin/env node
// v9 FREEZE (v8's approach). Records the sha256 of every file that decides what a model is asked, how
// answers become sentences / flags / skip spans / a split verdict / parent text, which model answers
// which question (split.json), or which films may run (env.js FROZEN_FILES) into out/freeze.json.
// Run ONCE, after the dev-film work (all ten dev films: nemo, monsters-inc, lion-king, frankenweenie,
// wild-robot, iron-giant, up, tangled, coco, how-to-train-your-dragon) and BEFORE the first held-out
// step. The held-out gate (env.js heldOutGate, called by every stage script incl. v9's sonnetq.js,
// describe.js, check-describe.js and run-film.js) refuses every non-dev film unless
// --final-held-out-run is passed AND every listed file still matches.
//
//   node freeze.js            write out/freeze.json (refuses to overwrite an existing one)
//   node freeze.js --check    print which frozen files changed (exit 1 if any)
//   node freeze.js --list     print the files that are (or would be) frozen, with their sha256
//
// Frozen (env.js FROZEN_FILES): v8's list (questions.js, policy.json, select.js, check-claims.js,
// segment.js, segment-prompt.js, gate.js, check-split.js, claims.js, cite.js, validate.js,
// classify.js, moments.js, aliases.js, spans.js, sources.js, text.js, jev-client.js, jev.js, sonnet.js,
// budget.js, ledger.js, env.js, ../srt.js, accept.js, refold.js, fill.js, reclassify.js, reasons.js,
// run-film.js) + ../claude.js (price table) and ../common.js (key loading) + v9's split.json, split.js,
// sonnet-questions.js, sonnetq.js, merge.js, describe.js, check-describe.js.
// Not frozen (scoring, split measurement and dev analysis only, never read by the pipeline):
// split/stage-a.mjs, split/stage-b.mjs, split/decide.mjs (they WROTE split.json, which is frozen),
// compare.js, refscore.js, parent-checks.js, codex.js, calibrate-claims.js, phase-spend.js, eval/*,
// dev/*, test/*, verify/*.
import fs from 'node:fs';
import path from 'node:path';
import { V8, DEV_FILMS, FROZEN_FILES, FREEZE_FILE, sha256File, freezeStatus } from './env.js';

const file = FREEZE_FILE();
if (process.argv.includes('--list')) {
  for (const f of FROZEN_FILES) console.log(`${fs.existsSync(path.join(V8, f)) ? sha256File(f) : '(missing)'.padEnd(64)}  ${f}`);
  process.exit(0);
}
if (process.argv.includes('--check')) {
  const st = freezeStatus();
  console.log(st.missing ? 'no out/freeze.json' : st.ok ? `freeze intact (${st.frozen_at})` : `CHANGED since ${st.frozen_at}: ${st.changed.join(', ')}`);
  process.exit(st.ok ? 0 : 1);
}
if (fs.existsSync(file)) { console.error(`${path.relative(V8, file)} exists; not overwriting (delete it deliberately to re-freeze).`); process.exit(2); }
const missing = FROZEN_FILES.filter((f) => !fs.existsSync(path.join(V8, f)));
if (missing.length) { console.error(`cannot freeze: missing ${missing.join(', ')}`); process.exit(2); }
const files = Object.fromEntries(FROZEN_FILES.map((f) => [f, sha256File(f)]));
fs.mkdirSync(path.dirname(file), { recursive: true });
fs.writeFileSync(file, JSON.stringify({ frozen_at: new Date().toISOString(), version: 'v9', dev_films: DEV_FILMS, note: 'sha256 of every file that decides what a model is asked, how answers become sentences, flags, skip spans, a split verdict or a why, or which films may run. Held-out films are refused unless all still match.', files }, null, 2));
console.log(`${path.relative(V8, file)}: ${Object.keys(files).length} files frozen`);
