#!/usr/bin/env node
// Run-phase spend guard (not part of the pipeline; no model calls). Sums every per-film ledger in the
// output directory and checks a proposed reservation against the phase caps.
// v8 round-4 DEV phase: total API spend <= $1.50 (Sonnet + Jev, every v8 ledger in out/), all Jev
// <= $0.50. Codex (the dev labeller) runs on a ChatGPT plan with no per-token charge.
//   node phase-spend.js                         print totals
//   node phase-spend.js --reserve-jev 0.06      exit 1 if Jev spent + 0.06 > 0.50 or total would pass 2.50
//   node phase-spend.js --reserve-sonnet 0.45   exit 1 if total spent + 0.45 + unspent Jev allowance > 2.50
import fs from 'node:fs';
import path from 'node:path';
import { outDir } from './env.js';

const PHASE_CAP = 1.5;
const JEV_CAP = 0.5;
const argv = process.argv.slice(2);
const opt = (k) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? Number(argv[i + 1]) : null; };
const dir = outDir();
const films = {};
for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.spend.json'))) {
  const l = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
  const slug = f.replace(/\.spend\.json$/, '');
  films[slug] = { sonnet: 0, jev: 0 };
  for (const e of l.entries) films[slug][e.kind] += e.usd;
}
const sum = (k) => Object.values(films).reduce((a, x) => a + x[k], 0);
const sonnet = sum('sonnet');
const jev = sum('jev');
console.log(JSON.stringify({ films: Object.fromEntries(Object.entries(films).map(([k, v]) => [k, { sonnet: +v.sonnet.toFixed(6), jev: +v.jev.toFixed(6) }])), sonnet: +sonnet.toFixed(6), jev: +jev.toFixed(6), total: +(sonnet + jev).toFixed(6) }));
const rj = opt('reserve-jev');
if (rj != null && (jev + rj > JEV_CAP || sonnet + jev + rj > PHASE_CAP)) { console.error(`REFUSE: Jev ${jev.toFixed(4)} + ${rj} > ${JEV_CAP} (or phase cap)`); process.exit(1); }
const rs = opt('reserve-sonnet');
if (rs != null && sonnet + rs + Math.max(jev, JEV_CAP) > PHASE_CAP) { console.error(`REFUSE: Sonnet ${sonnet.toFixed(4)} + ${rs} + Jev allowance ${JEV_CAP} > ${PHASE_CAP}`); process.exit(1); }
