#!/usr/bin/env node
// v10.3 harness check (no model calls): the 19-film loader re-selects v10.2 (v10_2/select.js + policy) from the
// stored answers and must reproduce v10.2's flags: out102/seen tags (16 films) and the round-8 tags as run (3 films).
import path from 'node:path';
import * as S102 from '../../v10_2/select.js';
import { loadSplit } from '../../v10_2/split.js';
import { FILMS, loadFilm, runSystem, resolveFile, rj, v102Dir, V102, sys } from './seen-lib.mjs';

const SPLIT = loadSplit();
const P = S102.loadPolicy(path.join(V102, 'policy.json'));
let bad = 0;
for (const slug of (process.argv[2] ?? FILMS.join(',')).split(',')) {
  const F = loadFilm(slug);
  const b = runSystem(F, S102, P, { used: SPLIT.sonnet_used, resolve: rj(resolveFile(slug)), split: SPLIT });
  const t = rj(path.join(v102Dir(slug), `${slug}.tags.r1.json`));
  const A = JSON.stringify(t.scenes.filter((s) => s.flagged).map((s) => [s.id, s.flag_reasons.map((r) => r.id)]));
  const B = JSON.stringify(b.flagged.map((s) => [s.id, s.flag_reasons.map((r) => r.id)]));
  const skipAsRun = t.scenes.filter((s) => s.flagged).reduce((a, s) => a + (s.skip?.ms ?? 0), 0);
  const ok = A === B; if (!ok) bad++;
  const S = sys(F.key, b.skip);
  console.log(`${slug}: flags ${ok ? 'SAME' : 'DIFFER'} (${b.flagged.length}); skip re-spanned ${(b.skip.reduce((a, [x, y]) => a + y - x, 0) / 60000).toFixed(2)} min vs stored ${(skipAsRun / 60000).toFixed(2)}; recall ${S.conservative_recall}/${S.of}`);
}
process.exit(bad ? 1 : 0);
