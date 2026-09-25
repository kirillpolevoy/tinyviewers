// Per-film spend ledger (out/<slug>.spend.json), so a per-film cap holds across reruns and failures,
// not only within one process. Each entry: { at, script, kind: 'sonnet'|'jev', usd, note }.
import fs from 'node:fs';
import path from 'node:path';
import { V5 } from './env.js';

const file = (slug) => path.join(V5, 'out', `${slug}.spend.json`);

export function readLedger(slug) {
  try { return JSON.parse(fs.readFileSync(file(slug), 'utf8')); } catch { return { entries: [] }; }
}

export const spentSoFar = (slug, kind) => readLedger(slug).entries.filter((e) => e.kind === kind).reduce((s, e) => s + e.usd, 0);

export function record(slug, entry) {
  const l = readLedger(slug);
  l.entries.push({ at: new Date().toISOString(), ...entry, usd: +entry.usd.toFixed(6) });
  l.totals = Object.fromEntries(['sonnet', 'jev'].map((k) => [k, +l.entries.filter((e) => e.kind === k).reduce((s, e) => s + e.usd, 0).toFixed(6)]));
  fs.mkdirSync(path.dirname(file(slug)), { recursive: true });
  fs.writeFileSync(file(slug), JSON.stringify(l, null, 2));
}
