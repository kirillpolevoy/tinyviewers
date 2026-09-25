#!/usr/bin/env node
// Round-4 VERIFIER: independent dev-phase headline check (v8 r1 vs v7 as run r1) on the 7 dev films:
// conservative recall, skip minutes, parent check (i) (wordless items inside a flagged scene, >=80% in skip).
import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
const V8 = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'); const TS = path.resolve(V8, '..');
const rj = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const merge = (sp) => { const s = sp.map((x) => [...x]).sort((a, b) => a[0] - b[0]); const o = []; for (const x of s) { if (o.length && x[0] <= o.at(-1)[1]) o.at(-1)[1] = Math.max(o.at(-1)[1], x[1]); else o.push(x); } return o; };
const ovl = (u, a, b) => u.reduce((t, [x, y]) => t + Math.max(0, Math.min(y, b) - Math.max(x, a)), 0);
const share = (u, a, b) => (b <= a ? (u.some(([x, y]) => a >= x && a <= y) ? 1 : 0) : ovl(u, a, b) / (b - a));
const isM = (i) => i.mappable && Number.isFinite(i.start_ms) && Number.isFinite(i.end_ms);
const gw = (i) => (Number.isFinite(i.gap_start_ms) ? [Math.min(i.start_ms, i.gap_start_ms), Math.max(i.end_ms, i.gap_end_ms)] : [i.start_ms, i.end_ms]);
const FILMS = ['nemo', 'monsters-inc', 'lion-king', 'frankenweenie', 'wild-robot', 'iron-giant', 'up'];
const tot = { v8: [0, 0, 0, 0, 0], v7: [0, 0, 0, 0, 0], of: 0 };
for (const slug of FILMS) {
  const items = rj(path.join(TS, 'refs', `${slug}.key.json`)).items.filter((i) => i.source !== 'codex-rules' && isM(i));
  const T = items.filter((i) => i.should_flag === true); tot.of += T.length;
  const row = [slug, T.length];
  for (const [n, dir] of [['v8', path.join(V8, 'out')], ['v7', path.join(TS, 'v7', 'out')]]) {
    const tags = rj(path.join(dir, `${slug}.tags.r1.json`)); const fl = tags.scenes.filter((s) => s.flagged);
    const U = merge(fl.flatMap((s) => (s.skip?.spans ?? []).map((x) => [x.start_ms, x.end_ms])));
    const st = T.filter((i) => share(U, i.start_ms, i.end_ms) >= 0.5).length; const gp = T.filter((i) => { const [a, b] = gw(i); return share(U, a, b) >= 0.5; }).length;
    const wl = T.filter((i) => i.wordless && fl.some((s) => share([[s.start_ms, s.end_ms]], i.start_ms, i.end_ms) >= 0.5));
    const cv = wl.filter((i) => share(U, i.start_ms, i.end_ms) >= 0.8).length;
    const skip = U.reduce((a, [x, y]) => a + y - x, 0) / 60000;
    tot[n][0] += Math.min(st, gp); tot[n][1] += skip; tot[n][2] += cv; tot[n][3] += wl.length; tot[n][4] += fl.length;
    row.push(`${n} cons ${Math.min(st, gp)} skip ${skip.toFixed(1)} (i) ${cv}/${wl.length} flagged ${fl.length}`);
  }
  console.log(row.join(' | '));
}
console.log(`TOTAL of ${tot.of}: v8 cons ${tot.v8[0]} skip ${tot.v8[1].toFixed(1)} (i) ${tot.v8[2]}/${tot.v8[3]} flagged ${tot.v8[4]} | v7 cons ${tot.v7[0]} skip ${tot.v7[1].toFixed(1)} (i) ${tot.v7[2]}/${tot.v7[3]} flagged ${tot.v7[4]}`);
