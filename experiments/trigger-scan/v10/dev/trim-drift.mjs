#!/usr/bin/env node
// DEV: does TRIMMING Jev's request (v9 asks only its split.json questions) change its answers? Compares
// v9 out/<slug>.jev.r1.json (trimmed request) with v8's saved answers (full request) for every question
// both asked, per scene: mean |dp|, share of answers moving across the 0.7 act threshold.
//   node dev/trim-drift.mjs coco tangled how-to-train-your-dragon
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const rj = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const out = {};
for (const slug of process.argv.slice(2)) {
  const a = new Map(rj(path.resolve(here, '../../v8/out', `${slug}.jev.r1.json`)).scenes.map((s) => [s.id, s.answers]));
  const b = rj(path.resolve(here, '../out', `${slug}.jev.r1.json`));
  let n = 0, sum = 0, cross = 0, max = 0; const crossed = [];
  for (const s of b.scenes) {
    const x = a.get(s.id); const y = s.answers; if (!x || !y) continue;
    for (const ch of ['pl', 'ps', 'm', 'e', 'mod', 'fpl', 'fps', 'fe']) {
      for (const [q, p] of Object.entries(y[ch] ?? {})) {
        const p0 = x[ch]?.[q]; if (p0 === undefined) continue;
        n++; const d = Math.abs(p - p0); sum += d; max = Math.max(max, d);
        if ((p >= 0.7) !== (p0 >= 0.7)) { cross++; crossed.push(`${s.id}:${ch}.${q} ${p0}->${p}`); }
      }
    }
  }
  out[slug] = { answers: n, mean_abs_dp: +(sum / n).toFixed(4), max_abs_dp: +max.toFixed(3), crossed_0_7: cross, crossed_share: +(cross / n).toFixed(4), crossed_examples: crossed.slice(0, 15), cost_usd: b.cost_usd };
  console.log(slug, JSON.stringify(out[slug]));
}
fs.writeFileSync(path.resolve(here, '../out/dev/trim-drift.json'), JSON.stringify(out, null, 2));
