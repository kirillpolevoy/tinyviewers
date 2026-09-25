#!/usr/bin/env node
// v10.3 fix (c) BOUND SELECTION (no model calls; 18 seen films with live, IN-SAMPLE).
// Why: with the a-priori bounds (run-on 30 s) v10.3 held the seen-film skip bar pooled (1.01x live over 18 films) but
// sat at 1.29x on the three round-8 films, and the fresh test's bar is judged on a pool of THREE films. The bound is
// therefore chosen by how often v10.3 would pass the fresh bar's code-measurable criteria on a 3-film pool.
// RULE (written before this script was first run): for each bridge setting of the full v10.3 (fixes a+b+c), enumerate
// every 3-film subset of the 18 seen films with a live baseline (816) and count the subsets where, pooled over the 3
// films, ALL of: conservative recall >= live, strict precision >= live, skip <= 1.15 x live, wordless should_flag
// items covered >= live. Pick the setting with the highest pass rate; a tie (within 1 subset) -> the lower skip.
// Settings: run-on 0 (gap fill only), 15, 30 (the a-priori value), 30 / 45 / 60 stopping at the neighbour's first
// calm spoken line, and the bridge off (fixes a+b only).
//   node eval/bridge-select.mjs -> eval/out/bridge-select.json
import fs from 'node:fs';
import path from 'node:path';
import * as S103 from '../select.js';
import { loadSplit } from '../split.js';
import { scoreKey } from '../refscore.js';
import { FILMS, loadFilm, runSystem, allWordless, liveFor, resolveFile, mortalFile, rj, V103 } from './seen-lib.mjs';

const SPLIT = loadSplit();
const P103 = S103.loadPolicy(path.join(V103, 'policy.json'));
const clone = (o) => JSON.parse(JSON.stringify(o));
const SETTINGS = {
  'bridge off': { enabled: false }, 'run0 (gap fill only)': { run_ms: 0 }, run15: { run_ms: 15000 }, 'run30 (a priori)': { run_ms: 30000 },
  'run30 stop-at-speech': { run_ms: 30000, stop_at_speech: true }, 'run45 stop-at-speech': { run_ms: 45000, stop_at_speech: true }, 'run60 stop-at-speech': { run_ms: 60000, stop_at_speech: true },
};
const per = {}; // setting -> slug -> counts
const liveC = {};
const counts = (key, skip) => {
  const S = scoreKey(key, skip); const G = scoreKey(key, skip, { window: 'gap' });
  const w = allWordless(key, skip);
  return { fs: S.recall_items.found, fg: G.recall_items.found, of: S.recall_items.of, skip: S.skip_minutes, over: S.precision_proxy_ref_only * S.skip_minutes, wc: w.covered, wn: w.n };
};
const films = [];
for (const slug of FILMS) {
  const live = await liveFor(slug); if (!live.scenes) continue;
  const F = loadFilm(slug); films.push(slug);
  const merged = rj(path.join(V103, 'out103', 'seen', `${slug}.moments.r1.json`));
  liveC[slug] = counts(F.key, live.scenes.map((x) => [x.start_ms, x.end_ms]));
  for (const [name, b] of Object.entries(SETTINGS)) {
    const p = clone(P103); p.spans_bridge = { ...p.spans_bridge, ...b };
    const r = runSystem(F, S103, p, { used: SPLIT.sonnet_used, resolve: rj(resolveFile(slug)), split: SPLIT, mortal: rj(mortalFile(slug)), saved: merged });
    (per[name] ??= {})[slug] = counts(F.key, r.skip);
  }
}
const sum = (rows) => rows.reduce((a, x) => ({ fs: a.fs + x.fs, fg: a.fg + x.fg, of: a.of + x.of, skip: a.skip + x.skip, over: a.over + x.over, wc: a.wc + x.wc, wn: a.wn + x.wn }), { fs: 0, fg: 0, of: 0, skip: 0, over: 0, wc: 0, wn: 0 });
const subsets = [];
for (let i = 0; i < films.length; i++) for (let j = i + 1; j < films.length; j++) for (let k = j + 1; k < films.length; k++) subsets.push([films[i], films[j], films[k]]);
const res = {};
for (const name of Object.keys(SETTINGS)) {
  let pass = 0; const fails = { recall: 0, precision: 0, skip: 0, wordless: 0 };
  for (const sub of subsets) {
    const v = sum(sub.map((s) => per[name][s])); const l = sum(sub.map((s) => liveC[s]));
    const ok = { recall: Math.min(v.fs, v.fg) >= Math.min(l.fs, l.fg), precision: v.over / v.skip >= l.over / l.skip, skip: v.skip <= 1.15 * l.skip, wordless: v.wc >= l.wc };
    for (const [k, x] of Object.entries(ok)) if (!x) fails[k]++;
    if (Object.values(ok).every(Boolean)) pass++;
  }
  const all = sum(films.map((s) => per[name][s])); const L = sum(films.map((s) => liveC[s]));
  res[name] = { pass, of: subsets.length, pass_rate: +(pass / subsets.length).toFixed(3), fails, pooled18: { recall: Math.min(all.fs, all.fg), live_recall: Math.min(L.fs, L.fg), precision: +(all.over / all.skip).toFixed(3), live_precision: +(L.over / L.skip).toFixed(3), skip_ratio: +(all.skip / L.skip).toFixed(3), wordless: `${all.wc}/${all.wn}`, live_wordless: `${L.wc}/${L.wn}` } };
}
const ranked = Object.entries(res).sort((a, b) => (Math.abs(b[1].pass - a[1].pass) <= 1 ? a[1].pooled18.skip_ratio - b[1].pooled18.skip_ratio : b[1].pass - a[1].pass));
const out = { generated_at: new Date().toISOString(), label: 'IN-SAMPLE bound selection for the span bridge (3-film pools of the 18 seen films with live)', settings: SETTINGS, results: res, pick: ranked[0][0] };
fs.writeFileSync(path.join(V103, 'eval', 'out', 'bridge-select.json'), JSON.stringify(out, null, 2));
for (const [n, r] of Object.entries(res)) console.log(`${n.padEnd(22)} pass ${r.pass}/${r.of} (${r.pass_rate}) fails ${JSON.stringify(r.fails)} | pooled18 ${JSON.stringify(r.pooled18)}`);
console.log(`PICK: ${out.pick}`);
