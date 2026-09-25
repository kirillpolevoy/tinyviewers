#!/usr/bin/env node
// Round-4 HEAD-TO-HEAD spend guard (not pipeline, not frozen; no model calls). The phase cap is $3.00 of
// API spend across BOTH systems on the three held-out films:
//   v8      out/<slug>.spend.json         (the frozen pipeline's own per-film ledgers)
//   live    baseline/out/<slug>.spend.json (run-live.mjs; one entry per priced response)
// Every stage reserves its worst case against this cap before it starts (reserve()), on top of the
// per-call worst-case reservation each pipeline makes inside the stage.
//   node baseline/spend.mjs                  print totals
//   node baseline/spend.mjs --reserve 0.98   exit 1 if spent + 0.98 > 3.00
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const HEADTOHEAD_CAP = 3.0;
export const HELD = ['tangled', 'coco', 'how-to-train-your-dragon'];
const here = path.dirname(fileURLToPath(import.meta.url));
const V8 = path.resolve(here, '..');
const sumFile = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')).entries.reduce((a, e) => a + e.usd, 0); } catch { return 0; } };

export function spent() {
  const films = {};
  for (const s of HELD) films[s] = { v8: sumFile(path.join(V8, 'out', `${s}.spend.json`)), live: sumFile(path.join(here, 'out', `${s}.spend.json`)) };
  const v8 = Object.values(films).reduce((a, x) => a + x.v8, 0);
  const live = Object.values(films).reduce((a, x) => a + x.live, 0);
  return { films, v8, live, total: v8 + live };
}

export function reserve(usd, pending = 0) {
  const s = spent();
  return { ok: s.total + pending + usd <= HEADTOHEAD_CAP, spent: s.total, pending, usd, cap: HEADTOHEAD_CAP };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const i = process.argv.indexOf('--reserve');
  const p = process.argv.indexOf('--pending');
  const s = spent();
  const r6 = (x) => +x.toFixed(6);
  console.log(JSON.stringify({ films: Object.fromEntries(Object.entries(s.films).map(([k, v]) => [k, { v8: r6(v.v8), live: r6(v.live) }])), v8: r6(s.v8), live: r6(s.live), total: r6(s.total), cap: HEADTOHEAD_CAP }));
  if (i >= 0) {
    const r = reserve(Number(process.argv[i + 1]), p >= 0 ? Number(process.argv[p + 1]) : 0);
    if (!r.ok) { console.error(`REFUSE: spent ${r.spent.toFixed(4)} + pending ${r.pending} + ${r.usd} > ${r.cap}`); process.exit(1); }
    console.log(`reserve ok: ${r.spent.toFixed(4)} + ${r.pending} + ${r.usd} <= ${r.cap}`);
  }
}
