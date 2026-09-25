#!/usr/bin/env node
// Round-5 HEAD-TO-HEAD spend guard (evaluation harness; not pipeline, not frozen; no model calls).
// Phase cap: $3.00 of API spend across BOTH systems on the three held-out films:
//   v9    out/<slug>.spend.json            (the frozen pipeline's own per-film ledgers)
//   live  round5/live/<slug>.spend.json    (round5/run-live.mjs; one entry per priced response)
// Before every stage its whole worst-case cap is reserved here (spent + in-flight reservations + cap
// <= 3.00), on top of the per-call worst-case reservation each pipeline makes inside the stage.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const PHASE_CAP = 3.0;
export const HELD = ['book-of-life', 'princess-and-the-frog', 'moana'];
const here = path.dirname(fileURLToPath(import.meta.url));
const V9 = path.resolve(here, '..');
export const LIVE_OUT = path.join(here, 'live');
const sum = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')).entries.reduce((a, e) => a + e.usd, 0); } catch { return 0; } };
const sumKind = (f, k) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')).entries.filter((e) => e.kind === k).reduce((a, e) => a + e.usd, 0); } catch { return 0; } };

export function spent() {
  const films = {};
  for (const s of HELD) {
    const v9f = path.join(V9, 'out', `${s}.spend.json`); const lf = path.join(LIVE_OUT, `${s}.spend.json`);
    films[s] = { v9: sum(v9f), v9_sonnet: sumKind(v9f, 'sonnet'), v9_jev: sumKind(v9f, 'jev'), live: sum(lf) };
  }
  const v9 = Object.values(films).reduce((a, x) => a + x.v9, 0);
  const live = Object.values(films).reduce((a, x) => a + x.live, 0);
  return { films, v9, live, total: v9 + live };
}

export function reserve(usd, pending = 0) {
  const s = spent();
  return { ok: s.total + pending + usd <= PHASE_CAP + 1e-9, spent: s.total, pending, usd, cap: PHASE_CAP };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const s = spent();
  const r6 = (x) => +x.toFixed(6);
  console.log(JSON.stringify({ films: Object.fromEntries(Object.entries(s.films).map(([k, v]) => [k, Object.fromEntries(Object.entries(v).map(([a, b]) => [a, r6(b)]))])), v9: r6(s.v9), live: r6(s.live), total: r6(s.total), cap: PHASE_CAP }, null, 1));
}
