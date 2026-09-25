// Offline (no calls): rebuild each moment request body from the as-run tags and compare the
// jev-client reservation with the billed input tokens recorded in out/<slug>.moments.r1.json.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSrt } from '../../srt.js';
import { planMoments } from '../moments.js';
import { loadPolicy } from '../select.js';
import { estTokens, usd } from '../jev-client.js';
const here = path.dirname(fileURLToPath(import.meta.url));
const V5 = path.resolve(here, '..');
const cfg = loadPolicy(path.join(V5, 'out/asrun/policy.asrun.json'));
const rows = [];
for (const slug of ['nemo', 'monsters-inc', 'lion-king']) {
  const tags = JSON.parse(fs.readFileSync(path.join(V5, 'out/asrun', `${slug}.tags.r1.json`)));
  const mom = JSON.parse(fs.readFileSync(path.join(V5, 'out/asrun', `${slug}.moments.r1.json`)));
  const jev = JSON.parse(fs.readFileSync(path.join(V5, tags.jev_file)));
  const seg = JSON.parse(fs.readFileSync(path.join(V5, jev.segments_file)));
  const cues = parseSrt(fs.readFileSync(path.resolve(V5, '..', 'data', `${seg.film.slug}.srt`), 'utf8'));
  for (const s of tags.scenes.filter((x) => x.flagged)) {
    const rec = mom.scenes[s.id]?.request;
    if (!rec?.input_tokens) continue;
    const plan = planMoments({ film: seg.film, scene: s, cues: cues.slice(s.start_cue - 1, s.end_cue), reasons: s.flag_reasons, items: jev.film_items ?? [], cfg });
    if (!plan.call) continue;
    const opts = Object.values(plan.body.questions).filter((q) => q.type === 'choice').reduce((a, q) => a + Object.keys(q.criteria).length, 0);
    rows.push({ slug, id: s.id, est: plan.est, recEst: rec.est_tokens, reserveTok: Math.round(plan.reserveUsd / usd(1)), billed: rec.input_tokens, opts, lines: plan.lineIds.length, q: Object.keys(plan.body.questions).length });
  }
}
let worst = 0;
for (const r of rows) { r.ratio = r.billed / r.est; r.overReserve = r.billed > r.reserveTok; worst = Math.max(worst, r.billed / r.reserveTok); }
console.log(`requests ${rows.length}; est matches recorded ${rows.filter((r) => r.est === r.recEst).length}/${rows.length}; billed > reserve (as run) ${rows.filter((r) => r.overReserve).length}; worst billed/reserve ${worst.toFixed(2)}`);
// least squares billed ~ a*est + b*opts
let sxx = 0, sxy = 0, syy = 0, sxb = 0, syb = 0;
for (const r of rows) { sxx += r.est * r.est; sxy += r.est * r.opts; syy += r.opts * r.opts; sxb += r.est * r.billed; syb += r.opts * r.billed; }
const det = sxx * syy - sxy * sxy;
const a = (sxb * syy - syb * sxy) / det, b = (sxx * syb - sxy * sxb) / det;
console.log(`fit billed ~ ${a.toFixed(3)} x est + ${b.toFixed(3)} x choice_options`);
for (const r of rows) r.fit = a * r.est + b * r.opts;
console.log('max billed/fit', Math.max(...rows.map((r) => r.billed / r.fit)).toFixed(3), 'min', Math.min(...rows.map((r) => r.billed / r.fit)).toFixed(3));
if (process.argv.includes('--json')) console.log(JSON.stringify(rows.map(({ est, opts, billed }) => [est, opts, billed])));
