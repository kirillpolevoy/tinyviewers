#!/usr/bin/env node
// Scoring-only: merge the run agent's cause classification (out/causes.json) into out/summary.json and
// out/explain.json, and add the phase spend. No model calls. Run after compare.js.
import fs from 'node:fs';
import path from 'node:path';
import { outDir } from './env.js';

const OUT = outDir();
const read = (f) => JSON.parse(fs.readFileSync(path.join(OUT, f), 'utf8'));
const summary = read('summary.json');
const explain = read('explain.json');
const causes = read('causes.json');
const missing = [];
for (const it of explain.items) {
  const key = it.kind === 'missed_should_flag' ? `${it.film}:${it.item.id}` : `${it.film}:${it.scene.id}`;
  const c = (it.kind === 'missed_should_flag' ? causes.misses : causes.unmatched_flags)[key];
  if (!c) { missing.push(key); continue; }
  it.cause = c;
}
if (missing.length) { console.error(`no cause for: ${missing.join(', ')}`); process.exit(1); }
const tally = (o) => Object.values(o).reduce((m, c) => ({ ...m, [c.primary]: (m[c.primary] ?? 0) + 1 }), {});
for (const f of summary.films) {
  const pick = (o) => Object.entries(o).filter(([k]) => k.startsWith(`${f.slug}:`)).map(([k, c]) => ({ id: k.split(':')[1], ...c }));
  f.explained = { misses: pick(causes.misses), unmatched_flags: pick(causes.unmatched_flags) };
}
summary.cause_tally = { misses: tally(causes.misses), unmatched_flags: tally(causes.unmatched_flags) };
const spend = { sonnet: 0, jev: 0 };
for (const f of fs.readdirSync(OUT).filter((x) => x.endsWith('.spend.json'))) for (const e of read(f).entries) spend[e.kind] += e.usd;
summary.phase_spend_usd = { sonnet: +spend.sonnet.toFixed(6), jev: +spend.jev.toFixed(6), total: +(spend.sonnet + spend.jev).toFixed(6), caps: { total: 2.5, sonnet_per_film: 0.45, jev_total: 0.5 } };
fs.writeFileSync(path.join(OUT, 'summary.json'), JSON.stringify(summary, null, 2));
fs.writeFileSync(path.join(OUT, 'explain.json'), JSON.stringify(explain, null, 2));
console.log(JSON.stringify({ cause_tally: summary.cause_tally, phase_spend_usd: summary.phase_spend_usd }));
