// Offline: the current select.js with the as-run policy must reproduce the as-run tags exactly.
import fs from 'node:fs';
import { selectRun, loadPolicy } from '../select.js';
const V5 = new URL('..', import.meta.url);
const cfg = loadPolicy(new URL('out/asrun/policy.asrun.json', V5).pathname);
let bad = 0;
for (const slug of ['nemo', 'monsters-inc', 'lion-king']) for (const run of ['r1', 'r2']) {
  const jev = JSON.parse(fs.readFileSync(new URL(`out/${slug}.jev.${run}.json`, V5)));
  const mom = run === 'r1' ? JSON.parse(fs.readFileSync(new URL(`out/asrun/${slug}.moments.r1.json`, V5))) : null;
  const saved = JSON.parse(fs.readFileSync(new URL(`out/asrun/${slug}.tags.${run}.json`, V5)));
  const out = selectRun(jev, cfg, { moments: mom });
  const key = (t) => t.scenes.map((s) => [s.id, s.flagged, (s.flag_reasons ?? []).map((r) => r.id + r.rule).join(','), s.skip?.ms ?? null, s.severity?.['5-7']?.level, (s.tags ?? []).map((x) => x.id + x.level).join(',')].join('|')).join('\n');
  const same = key(out) === key(saved);
  if (!same) bad++;
  console.log(slug, run, same ? 'identical' : 'DIFFERENT');
}
process.exit(bad ? 1 : 0);
