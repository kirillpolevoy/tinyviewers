// Round-7 spend guard (evaluation harness; no model calls). Phase cap $2.50 of API spend for this round:
// v10.1 ledgers out101/frozen.spend.json, out101/zootopia.spend.json (both absent before round 7) and
// round7/gd-out/good-dinosaur.spend.json. The live pipeline is not re-run (round6/live reused, $0).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const PHASE_CAP = 2.5;
export const FILMS = ['frozen', 'zootopia', 'good-dinosaur'];
const here = path.dirname(fileURLToPath(import.meta.url));
const V101 = path.resolve(here, '..');
// R7_OUT_<SLUG> (absolute dir) overrides one film's dir: scorer validation only (e.g. v10's round-6 outputs)
export const outFor = (slug) => process.env[`R7_OUT_${slug.replace(/-/g, '_').toUpperCase()}`] ?? (slug === 'good-dinosaur' ? path.join(here, 'gd-out') : path.join(V101, 'out101'));
export const LIVE_OUT = path.resolve(V101, '..', 'v10', 'round6', 'live');
const sum = (f, k) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')).entries.filter((e) => !k || e.kind === k).reduce((a, e) => a + e.usd, 0); } catch { return 0; } };
export function spent() {
  const films = {};
  for (const s of FILMS) { const f = path.join(outFor(s), `${s}.spend.json`); films[s] = { total: sum(f), sonnet: sum(f, 'sonnet'), jev: sum(f, 'jev') }; }
  return { films, total: Object.values(films).reduce((a, x) => a + x.total, 0) };
}
