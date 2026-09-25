#!/usr/bin/env node
// v10.2 DEV diagnostic (no model calls): which gated-out concepts carried the should_flag items the tier-A gate loses
// (found by v10.1's skip, not by v10.2's), per film group. Counts each lost item once per concept of the v10.1 flag
// reasons of the scene(s) whose skip held it. In-sample; for the report only (nothing is tuned on it).
import path from 'node:path';
import fs from 'node:fs';
import * as S101 from '../../v10_1/select.js';
import * as S102 from '../select.js';
import { loadSplit } from '../split.js';
import { FILMS, loadFilm, runSystem, resolveFile, rj, V101, V102, union, shareInside } from '../eval/seen-lib.mjs';
const SPLIT = loadSplit(); const CMAP = S102.conceptMap(SPLIT);
const P101 = S101.loadPolicy(path.join(V101, 'policy.json')); const P102 = S102.loadPolicy(path.join(V102, 'policy.json'));
const R7 = ['frozen', 'zootopia', 'good-dinosaur'];
const tally = { r7: {}, dev13: {} }; const lost = { r7: 0, dev13: 0 }; const rows = [];
for (const slug of FILMS) {
  const F = loadFilm(slug);
  const a = runSystem(F, S101, P101, { used: SPLIT.sonnet_used });
  const b = runSystem(F, S102, P102, { used: SPLIT.sonnet_used, resolve: rj(resolveFile(slug)), split: SPLIT });
  const Ub = union(b.skip);
  const items = F.key.items.filter((i) => i.should_flag === true && i.mappable && Number.isFinite(i.start_ms));
  for (const it of items) {
    if (shareInside(it.start_ms, it.end_ms, Ub) >= 0.5) continue;
    const holders = a.flagged.filter((s) => shareInside(it.start_ms, it.end_ms, union(s.skip.spans.map((x) => [x.start_ms, x.end_ms]))) >= 0.5);
    if (!holders.length) continue;
    const g = R7.includes(slug) ? 'r7' : 'dev13'; lost[g]++;
    const cs = [...new Set(holders.flatMap((s) => s.flag_reasons.map((r) => S102.conceptOf(r, F.items, CMAP))))];
    for (const c of cs) tally[g][c] = (tally[g][c] ?? 0) + 1;
    rows.push({ slug, item: it.id, text: undefined, scenes: holders.map((s) => s.id), concepts: cs });
  }
}
const sort = (o) => Object.fromEntries(Object.entries(o).sort((x, y) => y[1] - x[1]));
const out = { note: 'should_flag items inside a v10.1 (ungated) skip but not a v10.2 skip; concepts of the holding scenes\' v10.1 flag reasons (an item can count for several)', lost, by_concept: { r7: sort(tally.r7), dev13: sort(tally.dev13) }, rows };
fs.writeFileSync(path.join(V102, 'dev', 'out', 'gate-cost.json'), JSON.stringify(out, null, 2));
console.log(JSON.stringify({ lost, by_concept: out.by_concept }, null, 1));
