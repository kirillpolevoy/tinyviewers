// ROUND 9 (v10.3, fresh films kung-fu-panda, onward, croods): copy of v10_2/round8/spend.mjs; films, the v10.3 output dir
// (out103) and round9/live changed; names v102* kept as 'system under test' (= v10.3) so copied scripts need no edits.
// Round-8 spend guard (evaluation harness; no model calls). Phase cap $3.00 of API spend for this round, over the
// fresh films' ledgers of BOTH systems:
//   v10.2  out102/<slug>.spend.json      (the frozen pipeline's own per-film ledgers; absent before round 8)
//   live   round8/live/<slug>.spend.json (round8/run-live.mjs; one entry per priced response)
// Before every stage its whole worst-case cap is reserved (spent + in-flight reservations + cap <= 3.00), on top of
// the per-call worst-case reservation each pipeline makes inside the stage. Codex judging is not API spend.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const PHASE_CAP = 3.0;
export const FILMS = ['kung-fu-panda', 'onward', 'croods'];
const here = path.dirname(fileURLToPath(import.meta.url));
const V102 = path.resolve(here, '..');
export const outFor = () => path.join(V102, 'out103');
export const LIVE_OUT = path.join(here, 'live');
const sum = (f, k) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')).entries.filter((e) => !k || e.kind === k).reduce((a, e) => a + e.usd, 0); } catch { return 0; } };
export function spent() {
  const films = {};
  for (const s of FILMS) {
    const f = path.join(outFor(s), `${s}.spend.json`); const l = path.join(LIVE_OUT, `${s}.spend.json`);
    films[s] = { v102: sum(f), v102_sonnet: sum(f, 'sonnet'), v102_jev: sum(f, 'jev'), live: sum(l) };
  }
  const v102 = Object.values(films).reduce((a, x) => a + x.v102, 0); const live = Object.values(films).reduce((a, x) => a + x.live, 0);
  return { films, v102, live, total: v102 + live };
}
export function reserve(usd, pending = 0) {
  const s = spent();
  return { ok: s.total + pending + usd <= PHASE_CAP + 1e-9, spent: s.total, pending, usd, cap: PHASE_CAP };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const s = spent(); const r6 = (x) => +x.toFixed(6);
  console.log(JSON.stringify({ films: Object.fromEntries(Object.entries(s.films).map(([k, v]) => [k, Object.fromEntries(Object.entries(v).map(([a, b]) => [a, r6(b)]))])), v102: r6(s.v102), live: r6(s.live), total: r6(s.total), cap: PHASE_CAP }, null, 1));
}
