#!/usr/bin/env node
// v10.3 API SPEND (seen-film checks; cap $2.00): every per-film ledger under out103/ (all subdirectories).
//   node eval/spend.mjs [--need <usd>]  -> total; with --need, exit 3 when spent + need > cap
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
export const CAP = 2.0;
export function spent(root = path.resolve(here, '..', 'out103')) {
  const tot = { sonnet: 0, jev: 0, files: 0 };
  const walk = (d) => { if (!fs.existsSync(d)) return; for (const x of fs.readdirSync(d)) { const p = path.join(d, x); if (fs.statSync(p).isDirectory()) walk(p); else if (x.endsWith('.spend.json')) { const l = JSON.parse(fs.readFileSync(p, 'utf8')); tot.files++; for (const e of l.entries ?? []) tot[e.kind] = (tot[e.kind] ?? 0) + e.usd; } } };
  walk(root);
  return { ...tot, total: +(tot.sonnet + tot.jev).toFixed(6) };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const s = spent(); const i = process.argv.indexOf('--need'); const need = i > 0 ? Number(process.argv[i + 1]) : 0;
  console.log(`v10.3 spend: total $${s.total} (sonnet $${s.sonnet.toFixed(6)}, jev $${s.jev.toFixed(6)}; ${s.files} ledgers); cap $${CAP}${need ? `; need $${need} -> ${s.total + need <= CAP ? 'OK' : 'REFUSED'}` : ''}`);
  if (need && s.total + need > CAP) process.exit(3);
}
