#!/usr/bin/env node
// v10.3 FREEZE: v10.2's freeze.js with v10.3's paths -- out103/freeze.json, FROZEN_FILES (+ mortal.js, describe2.js,
// bridge.js), the 19 dev films (incredibles, big-hero-6, brave since round 8); the record names the v10.2 freeze it
// descends from.
// v10.2 FREEZE: v10.1's freeze.js with v10.2's paths -- out102/freeze.json, FROZEN_FILES (+ resolve.js), the 16 dev
// films (frozen and zootopia since round 7); the record names the v10.1 freeze it descends from.
// v10.1 FREEZE: v10's freeze.js with v10.1's paths -- out101/freeze.json, the Jev set's decisions read from
// v10/assemble/decisions.json (v10.1 did not change the Jev set), env.js FROZEN_FILES (v10's list + credits.js,
// textsafe.js, childcry.js). Dev films: the 14 of env.js DEV_FILMS (good-dinosaur added); frozen and zootopia stay
// held out. The record also names the v10 freeze it descends from.
// (v10 text follows.)
// v10 FREEZE (v9's approach; NOT RUN YET). Records the sha256 of every file that decides what a model is
// asked, how answers become sentences / flags / skip spans / a split verdict / parent text, which model
// answers which question (split.json), which Jev phrasings, combine rules and thresholds v10 uses
// (jev-set.js, combine.js, lint.js), or which films may run (env.js) into out10/freeze.json. Run ONCE,
// after the dev work on the 13 seen films and BEFORE the first held-out step. The held-out gate (env.js
// heldOutGate, called by every stage script and run-film.js) refuses every non-dev film unless
// --final-held-out-run is passed AND every listed file still matches.
//
//   node freeze.js            write out10/freeze.json (refuses to overwrite an existing one, and refuses
//                             while the Jev set rests on unmeasured wording: see below)
//   node freeze.js --check    print which frozen files changed (exit 1 if any)
//   node freeze.js --list     print the files that are (or would be) frozen, with their sha256
//
// v10 preconditions (checked before writing):
//   * jev-set.js was generated from the current assemble/decisions.json (its DECISIONS_SHA256_12 matches);
//   * jev-set.js FIX_MODE is 'measured': the lint-fixed wordings (assemble/fixrun/fixes.mjs) were asked of
//     Jev on the 13 seen films (assemble/fixrun/run.mjs) and decide.mjs chose on their own answers. A set
//     built in 'proxy' mode (each lint-fixed wording scored with its original's answers) cannot be frozen;
//     --allow-proxy overrides this only on the user's explicit decision, and the freeze file records it.
// Frozen: env.js FROZEN_FILES (v9's list + jev-set.js, combine.js, lint.js). Not frozen (they wrote or
// score the frozen files, never read by the pipeline): assemble/*, eval/*, jevfirst/*, dev/*, test/*.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { V8, DEV_FILMS, FROZEN_FILES, FREEZE_FILE, sha256File, freezeStatus } from './env.js';
import { FIX_MODE, DECISIONS_SHA256_12, JEV_SET_VERSION } from './jev-set.js';

const file = FREEZE_FILE();
if (process.argv.includes('--list')) {
  for (const f of FROZEN_FILES) console.log(`${fs.existsSync(path.join(V8, f)) ? sha256File(f) : '(missing)'.padEnd(64)}  ${f}`);
  process.exit(0);
}
if (process.argv.includes('--check')) {
  const st = freezeStatus();
  console.log(st.missing ? `no ${path.relative(V8, file)}` : st.ok ? `freeze intact (${st.frozen_at})` : `CHANGED since ${st.frozen_at}: ${st.changed.join(', ')}`);
  process.exit(st.ok ? 0 : 1);
}
if (fs.existsSync(file)) { console.error(`${path.relative(V8, file)} exists; not overwriting (delete it deliberately to re-freeze).`); process.exit(2); }
const missing = FROZEN_FILES.filter((f) => !fs.existsSync(path.join(V8, f)));
if (missing.length) { console.error(`cannot freeze: missing ${missing.join(', ')}`); process.exit(2); }
const decisions = path.join(V8, '..', 'v10', 'assemble', 'decisions.json');
const dsha = crypto.createHash('sha256').update(fs.readFileSync(decisions)).digest('hex').slice(0, 12);
if (dsha !== DECISIONS_SHA256_12) { console.error(`cannot freeze: jev-set.js was built from decisions ${DECISIONS_SHA256_12}, v10/assemble/decisions.json is now ${dsha}`); process.exit(2); }
const allowProxy = process.argv.includes('--allow-proxy');
if (FIX_MODE !== 'measured' && !allowProxy) { console.error(`cannot freeze: jev-set.js FIX_MODE is '${FIX_MODE}': its lint-fixed wordings were never asked of Jev. Run node assemble/fixrun/run.mjs, then node assemble/decide.mjs && node assemble/build.mjs.`); process.exit(2); }
const files = Object.fromEntries(FROZEN_FILES.map((f) => [f, sha256File(f)]));
fs.mkdirSync(path.dirname(file), { recursive: true });
const v101Freeze = path.join(V8, '..', 'v10_2', 'out102', 'freeze.json');
const parent = fs.existsSync(v101Freeze) ? { file: path.relative(V8, v101Freeze), sha256: crypto.createHash('sha256').update(fs.readFileSync(v101Freeze)).digest('hex'), frozen_at: JSON.parse(fs.readFileSync(v101Freeze, 'utf8')).frozen_at } : null;
fs.writeFileSync(file, JSON.stringify({ frozen_at: new Date().toISOString(), version: 'v10.3', parent_freeze: parent, jev_set: JEV_SET_VERSION, jev_set_fix_mode: FIX_MODE, allow_proxy: allowProxy, decisions_sha256_12: dsha, dev_films: DEV_FILMS, note: 'sha256 of every file that decides what a model is asked, how answers become sentences, flags, skip spans, a split verdict or a why, or which films may run. Held-out films are refused unless all still match.', files }, null, 2));
console.log(`${path.relative(V8, file)}: ${Object.keys(files).length} files frozen`);
