#!/usr/bin/env node
// v10.3 DEV ANALYSIS (no model calls, 19 seen films, in-sample): where v10.2 misses mapped should_flag human items.
//   span      the item lies >= 50% inside a FLAGGED scene but the skip covers < 50% of it
//   boundary  the item overlaps a flagged scene but lies mostly outside it (a neighbour or across a boundary)
//   gated     the item lies in an unflagged scene that held tier-B/C (gated) reasons only
//   none      the item lies in an unflagged scene with no flag reason at all
// Also: whether live found it. Writes eval/out/miss-anatomy.json.
import fs from 'node:fs';
import path from 'node:path';
import * as S102 from '../../v10_2/select.js';
import { loadSplit } from '../../v10_2/split.js';
import { FILMS, loadFilm, runSystem, resolveFile, rj, V102, V103, union, shareInside, liveFor } from './seen-lib.mjs';

const SPLIT = loadSplit();
const P = S102.loadPolicy(path.join(V102, 'policy.json'));
const out = { per_film: {}, totals: {} };
const inter = (a, b, s) => Math.max(0, Math.min(b, s.end_ms) - Math.max(a, s.start_ms));
for (const slug of (process.argv[2] ?? FILMS.join(',')).split(',')) {
  const F = loadFilm(slug);
  const b = runSystem(F, S102, P, { used: SPLIT.sonnet_used, resolve: rj(resolveFile(slug)), split: SPLIT });
  const live = await liveFor(slug); const LU = live.scenes ? union(live.scenes.map((x) => [x.start_ms, x.end_ms])) : null;
  const U = union(b.skip);
  const items = F.key.items.filter((i) => i.mappable && Number.isFinite(i.start_ms) && i.should_flag === true);
  const rows = [];
  for (const it of items) {
    const sh = Math.max(shareInside(it.start_ms, it.end_ms, U), shareInside(it.gap_start_ms ?? it.start_ms, it.gap_end_ms ?? it.end_ms, U));
    if (shareInside(it.start_ms, it.end_ms, U) >= 0.5) continue;
    const len = Math.max(1, it.end_ms - it.start_ms);
    const host = [...b.tags.scenes].map((s) => ({ s, ov: inter(it.start_ms, it.end_ms, s) / len })).sort((x, y) => y.ov - x.ov);
    const main = host[0].s; const fl = host.filter((h) => h.ov > 0 && h.s.flagged);
    let kind;
    if (main.flagged && host[0].ov >= 0.5) kind = 'span';
    else if (fl.length) kind = 'boundary';
    else if ((main.gated_reasons ?? []).length) kind = 'gated';
    else kind = 'none';
    rows.push({ id: it.id, t: `${(it.start_ms / 60000).toFixed(2)}-${(it.end_ms / 60000).toFixed(2)}`, wordless: !!it.wordless, kind, scene: main.id, scene_share: +host[0].ov.toFixed(2), flagged_overlap: fl.map((h) => h.s.id), gated: (main.gated_reasons ?? []).map((r) => r.id), covered_share: +sh.toFixed(2), live_found: LU ? shareInside(it.start_ms, it.end_ms, LU) >= 0.5 : null, cats: it.categories });
  }
  out.per_film[slug] = rows;
  const c = rows.reduce((m, r) => ({ ...m, [r.kind]: (m[r.kind] ?? 0) + 1 }), {});
  const cl = rows.filter((r) => r.live_found).reduce((m, r) => ({ ...m, [r.kind]: (m[r.kind] ?? 0) + 1 }), {});
  for (const [k, v] of Object.entries(c)) out.totals[k] = (out.totals[k] ?? 0) + v;
  for (const [k, v] of Object.entries(cl)) out.totals[`${k}_live_found`] = (out.totals[`${k}_live_found`] ?? 0) + v;
  console.log(`${slug}: missed ${rows.length}/${items.length} ${JSON.stringify(c)} (live found ${JSON.stringify(cl)})`);
  for (const r of rows) console.log(`   ${r.id} ${r.t} ${r.kind} ${r.scene}(${r.scene_share}) flaggedOv ${r.flagged_overlap.join(',') || '-'} gated ${r.gated.join('+') || '-'} cov ${r.covered_share} live ${r.live_found} ${r.wordless ? 'W' : ''}`);
}
console.log(JSON.stringify(out.totals));
fs.mkdirSync(path.join(V103, 'eval', 'out'), { recursive: true });
fs.writeFileSync(path.join(V103, 'eval', 'out', 'miss-anatomy.json'), JSON.stringify(out, null, 2));
