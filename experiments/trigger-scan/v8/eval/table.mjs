#!/usr/bin/env node
// Prints the round-4 before/after table (v7 as run vs v8) from <out>/summary.json. No model calls.
import fs from 'node:fs';
import path from 'node:path';
import { outDir } from '../env.js';
const s = JSON.parse(fs.readFileSync(path.join(outDir(), 'summary.json'), 'utf8'));
const rows = [];
const T = { a: {}, b: {} };
const add = (o, k, v) => { o[k] = (o[k] ?? 0) + v; };
for (const f of s.films) {
  const r = f.reference; if (!r) continue;
  const A = r.v8_skip, Ag = r.gap_window.v8_skip, B = r.before_v7_as_run?.skip, Bg = r.before_v7_as_run?.gap_window;
  const v = r.before_v7_as_run?.verdict_v8_vs_v7;
  const pa = r.parent_checks.v8, pb = r.parent_checks.v7_as_run;
  const cons = (x, g) => Math.min(x.recall_items.found, g.recall_items.found);
  const why = (x) => x?.iii_why ? `${x.iii_why.stated}+${x.iii_why.generated}g/${x.iii_why.flagged} (unrel ${x.iii_why.unrelated_only}, none ${x.iii_why.nothing})` : '-';
  const w = (x) => (x === 'A' ? 'v8' : x === 'B' ? 'v7' : 'tie');
  rows.push([f.slug,
    `${cons(B, Bg)} -> ${cons(A, Ag)} /${A.recall_items.of}`,
    `${B.recall_items.found}/${Bg.recall_items.found} -> ${A.recall_items.found}/${Ag.recall_items.found}`,
    `${B.precision_proxy_ref_only}/${Bg.precision_proxy_ref_only} -> ${A.precision_proxy_ref_only}/${Ag.precision_proxy_ref_only}`,
    `${B.tag_only.flagged} -> ${A.tag_only.flagged} /${A.tag_only.items}`,
    `${B.skip_minutes} -> ${A.skip_minutes}`,
    `rec ${w(v.recall)}, prec ${w(v.precision)} (jit ${r.before_v7_as_run.sensitivity_v8_vs_v7.recall_diff_a_minus_b.share_a_ge_b})`,
    `${pb.i_wordless_peaks.covered}/${pb.i_wordless_peaks.n} -> ${pa.i_wordless_peaks.covered}/${pa.i_wordless_peaks.n}`,
    `${pb.ii_wordless_scenes.found}/${pb.ii_wordless_scenes.n} -> ${pa.ii_wordless_scenes.found}/${pa.ii_wordless_scenes.n}`,
    `${why(pb)} -> ${why(pa)}`,
    `${r.before_v7_as_run?.dtdd?.agree}/${r.before_v7_as_run?.dtdd?.scored} -> ${r.dtdd.v8.agree}/${r.dtdd.v8.scored}`,
    r.verdict_v8_vs_live_db ? `rec ${w(r.verdict_v8_vs_live_db.recall)}, prec ${w(r.verdict_v8_vs_live_db.precision).replace('v7', 'DB')}` : 'no live DB',
  ]);
  add(T.b, 'cons', cons(B, Bg)); add(T.a, 'cons', cons(A, Ag)); add(T.a, 'of', A.recall_items.of);
  add(T.b, 'skip', B.skip_minutes); add(T.a, 'skip', A.skip_minutes); add(T.b, 'tag', B.tag_only.flagged); add(T.a, 'tag', A.tag_only.flagged);
  add(T.b, 'i', pb.i_wordless_peaks.covered); add(T.a, 'i', pa.i_wordless_peaks.covered); add(T.a, 'in', pa.i_wordless_peaks.n); add(T.b, 'in', pb.i_wordless_peaks.n);
  add(T.b, 'ii', pb.ii_wordless_scenes.found); add(T.a, 'ii', pa.ii_wordless_scenes.found); add(T.a, 'iin', pa.ii_wordless_scenes.n);
  add(T.b, 'st', pb.iii_why.stated); add(T.a, 'st', pa.iii_why.stated); add(T.a, 'gen', pa.iii_why.generated); add(T.b, 'fl', pb.iii_why.flagged); add(T.a, 'fl', pa.iii_why.flagged);
  add(T.b, 'unrel', pb.iii_why.unrelated_only); add(T.b, 'none', pb.iii_why.nothing); add(T.a, 'unrel', pa.iii_why.unrelated_only); add(T.a, 'none', pa.iii_why.nothing);
}
const head = ['film', 'cons recall', 'recall strict/gap', 'precision strict/gap', 'tag-only', 'skip min', 'verdict v8 vs v7', '(i) peaks', '(ii) wordless', '(iii) why stated+generated', 'DTDD', 'v8 vs live DB'];
for (const r of [head, ...rows]) console.log(r.join(' | '));
console.log(`TOTAL | ${T.b.cons} -> ${T.a.cons} /${T.a.of} | | | ${T.b.tag} -> ${T.a.tag} | ${T.b.skip.toFixed(2)} -> ${T.a.skip.toFixed(2)} | | ${T.b.i}/${T.b.in} -> ${T.a.i}/${T.a.in} | ${T.b.ii} -> ${T.a.ii}/${T.a.iin} | stated ${T.b.st}/${T.b.fl} (unrelated-only ${T.b.unrel}, nothing ${T.b.none}) -> stated ${T.a.st} + generated ${T.a.gen} /${T.a.fl} (unrelated-only ${T.a.unrel}, nothing ${T.a.none})`);
