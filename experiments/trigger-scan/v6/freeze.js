#!/usr/bin/env node
// Record the sha256 of every file that decides questions, policy, claims, segmentation or spans into
// out/freeze.json. Run once, after the dev films and before the first held-out step. The held-out
// gate (env.js heldOutGate) refuses held-out films unless every listed file still matches.
//
//   node freeze.js            write out/freeze.json (refuses to overwrite an existing one)
//   node freeze.js --check    print which frozen files changed (exit 1 if any)
import fs from 'node:fs';
import path from 'node:path';
import { V6, FROZEN_FILES, FREEZE_FILE, sha256File, freezeStatus } from './env.js';

const file = FREEZE_FILE();
if (process.argv.includes('--check')) {
  const st = freezeStatus();
  console.log(st.missing ? 'no out/freeze.json' : st.ok ? `freeze intact (${st.frozen_at})` : `CHANGED since ${st.frozen_at}: ${st.changed.join(', ')}`);
  process.exit(st.ok ? 0 : 1);
}
if (fs.existsSync(file)) { console.error(`${path.relative(V6, file)} exists; not overwriting (delete it deliberately to re-freeze).`); process.exit(2); }
const files = Object.fromEntries(FROZEN_FILES.filter((f) => fs.existsSync(path.join(V6, f))).map((f) => [f, sha256File(f)]));
fs.mkdirSync(path.dirname(file), { recursive: true });
fs.writeFileSync(file, JSON.stringify({ frozen_at: new Date().toISOString(), note: 'sha256 of every file that decides what a model is asked or how answers become flags and spans. Held-out films are refused unless all still match.', files }, null, 2));
console.log(`${path.relative(V6, file)}: ${Object.keys(files).length} files frozen`);
