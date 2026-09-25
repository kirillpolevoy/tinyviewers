#!/usr/bin/env node
// v10.2 seen-film phase spend (API cap $1.50): every ledger under out102/ (dev guard / rule-1 answers, seen-film
// describe / check-describe). `node eval/phase-spend.mjs [reserve]` exits 1 when spent + reserve > the cap.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, '..', 'out102');
export const PHASE_CAP = 1.5;
export function phaseSpent() {
  const by = {}; let total = 0;
  const walk = (d) => { if (!fs.existsSync(d)) return; for (const f of fs.readdirSync(d)) { const p = path.join(d, f); if (fs.statSync(p).isDirectory()) walk(p); else if (f.endsWith('.spend.json')) for (const e of JSON.parse(fs.readFileSync(p, 'utf8')).entries) { const k = `${path.relative(ROOT, d) || '.'}:${e.script}:${e.kind}`; by[k] = (by[k] ?? 0) + e.usd; total += e.usd; } } };
  walk(ROOT);
  return { total: +total.toFixed(6), by: Object.fromEntries(Object.entries(by).map(([k, v]) => [k, +v.toFixed(6)])) };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const reserve = Number(process.argv[2] ?? 0);
  const s = phaseSpent();
  console.log(JSON.stringify({ ...s, reserve, cap: PHASE_CAP, ok: s.total + reserve <= PHASE_CAP }));
  process.exit(s.total + reserve <= PHASE_CAP ? 0 : 1);
}
