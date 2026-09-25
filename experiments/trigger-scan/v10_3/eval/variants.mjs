#!/usr/bin/env node
// v10.3 SEEN-FILM MEASUREMENT OF THE FLAG / SPAN FIXES (19 films, IN-SAMPLE and labelled: v10.3 was designed on
// them; not a test). Pure code over stored answers (no model calls):
//   live      the live pipeline's scenes (18 films; up has no live baseline)
//   v102      v10.2 as measured before (v10_2/select.js + policy, stored moment answers; a reason the stored run never
//             asked -> the whole scene)
//   v102r     v10.2 re-spanned with the SAME moment answers v10.3 uses (out103/seen: stored + the requests the stored
//             runs lacked), so v10.3 vs v10.2 differs only by flags and bridge, not by which clauses were asked
//   A         v10.3 select.js with only fix (a) (mortal questions), B only fix (b) (afraid_for_safety co-occurrence),
//   C         only fix (c) (span bridge), AB, ABC (= v10.3 policy.json); plus bridge sensitivity rows (C/ABC with other
//             bounds), which are reported, not chosen from.
// Metrics (refscore.js, round-7/8 definitions): conservative recall of mapped should_flag human items, precision proxy
// (strict / gap), skip minutes and ratio to live, wordless should_flag items covered (>= 80%), rules 1/2 recall on
// the clean codex-rules items, rule 3 = tag_only (comic) items skipped, jitter verdicts (300 runs, 95%).
//   node eval/variants.mjs -> eval/out/variants.json + a table
import fs from 'node:fs';
import path from 'node:path';
import * as S102 from '../../v10_2/select.js';
import { loadSplit as loadSplit102 } from '../../v10_2/split.js';
import * as S103 from '../select.js';
import { loadSplit } from '../split.js';
import { FILMS, R8, loadFilm, runSystem, sys, versus, rules12, allWordless, pool, liveFor, resolveFile, mortalFile, rj, V102, V103 } from './seen-lib.mjs';

const SPLIT = loadSplit(); const SPLIT102 = loadSplit102();
const P102 = S102.loadPolicy(path.join(V102, 'policy.json'));
const P103 = S103.loadPolicy(path.join(V103, 'policy.json'));
const clone = (o) => JSON.parse(JSON.stringify(o));
const r3 = (x) => (x == null || Number.isNaN(x) ? null : Math.round(x * 1000) / 1000);
function variant({ a = true, b = true, c = true, bridge = {} } = {}) {
  const p = clone(P103);
  p.flag.mortal.enabled = a;
  if (!b) delete p.flag.gating.cooccur;
  p.spans_bridge = { ...p.spans_bridge, ...bridge, enabled: c && (bridge.enabled ?? true) };
  return p;
}
const VARIANTS = {
  A: variant({ b: false, c: false }), B: variant({ a: false, c: false }), C: variant({ a: false, b: false }), AB: variant({ c: false }), ABC: variant(),
  'C gap-only': variant({ a: false, b: false, bridge: { run_ms: 0 } }), 'ABC run0': variant({ bridge: { run_ms: 0 } }), 'ABC run30 no-stop': variant({ bridge: { run_ms: 30000, stop_at_speech: false } }),
};
const NAMES = ['v102', 'v102r', ...Object.keys(VARIANTS)];
const films = [];
for (const slug of FILMS) {
  const F = loadFilm(slug);
  const merged = rj(path.join(V103, 'out103', 'seen', `${slug}.moments.r1.json`));
  const rv = rj(resolveFile(slug)); const mv = rj(mortalFile(slug));
  const out = {
    v102: runSystem(F, S102, P102, { used: SPLIT102.sonnet_used, resolve: rv, split: SPLIT102 }),
    v102r: runSystem(F, S102, P102, { used: SPLIT102.sonnet_used, resolve: rv, split: SPLIT102, saved: merged }),
  };
  for (const [k, p] of Object.entries(VARIANTS)) out[k] = runSystem(F, S103, p, { used: SPLIT.sonnet_used, resolve: rv, split: SPLIT, mortal: mv, saved: merged });
  const live = await liveFor(slug);
  const liveSkip = live.scenes ? live.scenes.map((x) => [x.start_ms, x.end_ms]) : null;
  films.push({ slug, F, key: F.key, out, skip: { ...Object.fromEntries(NAMES.map((n) => [n, out[n].skip])), ...(liveSkip ? { live: liveSkip } : {}) } });
}
function pooled(list, label) {
  const wl = list.filter((f) => f.skip.live);
  const P = pool(wl, [...NAMES, 'live']);
  const rows = {};
  for (const n of [...NAMES, 'live']) {
    const s = sys(P.key, P.skips[n]);
    const wd = wl.reduce((a, f) => { const w = allWordless(f.F.key, f.skip[n]); return [a[0] + w.covered, a[1] + w.n]; }, [0, 0]);
    const ru = wl.reduce((a, f) => { const r = rules12(f.F.fullKey, f.skip[n], f.slug); return [a[0] + r.villain[0], a[1] + r.villain[1], a[2] + r.child[0], a[3] + r.child[1]]; }, [0, 0, 0, 0]);
    rows[n] = { recall: s.conservative_recall, of: s.of, precision: `${s.precision_strict}/${s.precision_gap}`, precision_strict: s.precision_strict, precision_gap: s.precision_gap, skip: s.skip_minutes, skip_ratio_live: null, wordless: `${wd[0]}/${wd[1]}`, rule1: `${ru[0]}/${ru[1]}`, rule2: `${ru[2]}/${ru[3]}`, rule3_tag_only: s.tag_only_skipped, flagged: n === 'live' ? null : wl.reduce((a, f) => a + f.out[n].flagged.length, 0) };
  }
  for (const n of NAMES) rows[n].skip_ratio_live = r3(rows[n].skip / rows.live.skip);
  const vs = {};
  for (const n of NAMES.filter((x) => x !== 'v102')) { const v = versus(P.key, P.skips[n], P.skips.live); const w = versus(P.key, P.skips[n], P.skips.v102r); vs[n] = { vs_live: { recall: v.recall, precision: v.precision, jitter: v.jitter }, vs_v102r: { recall: w.recall, precision: w.precision, jitter: w.jitter } }; }
  const v2 = versus(P.key, P.skips.v102, P.skips.live); vs.v102 = { vs_live: { recall: v2.recall, precision: v2.precision, jitter: v2.jitter } };
  return { label, films: wl.map((f) => f.slug), rows, verdicts: vs };
}
const sets = [pooled(films, '18 seen films with a live baseline (19 minus up)'), pooled(films.filter((f) => R8.includes(f.slug)), 'round-8 films (incredibles, big-hero-6, brave)'), pooled(films.filter((f) => !R8.includes(f.slug)), 'the 15 films of rounds 1-7 with live')];
// per film: recall / skip / new flags of ABC vs v102r
const perFilm = films.map((f) => {
  const o = f.out; const k = f.F.key;
  const row = { slug: f.slug };
  for (const n of ['v102', 'v102r', 'A', 'B', 'C', 'ABC']) { const s = sys(k, o[n].skip); row[n] = `${s.conservative_recall}/${s.of} p${s.precision_strict} ${s.skip_minutes}m f${o[n].flagged.length}`; }
  if (f.skip.live) { const s = sys(k, f.skip.live); row.live = `${s.conservative_recall}/${s.of} p${s.precision_strict} ${s.skip_minutes}m`; }
  const ids = (n) => new Set(o[n].flagged.map((s) => s.id));
  const base = ids('v102r');
  row.abc_new_flags = o.ABC.flagged.filter((s) => !base.has(s.id)).map((s) => `${s.id}:${s.flag_reasons.filter((r) => r.rule === 'mortal_question' || r.cooccur).map((r) => r.id).join('+')}`);
  row.abc_mortal = o.ABC.tags.summary.mortal_reasons; row.abc_cooccur = o.ABC.tags.summary.cooccur_reasons;
  row.abc_bridge = o.ABC.flagged.filter((s) => s.skip.bridge?.length).map((s) => `${s.id}:${s.skip.bridge.map((x) => `${x.kind} ${Math.round((x.end_ms - x.start_ms) / 1000)}s`).join('+')}`);
  return row;
});
const out = { generated_at: new Date().toISOString(), label: 'DEV-ONLY, IN-SAMPLE (19 seen films; v10.3 was designed on them). Not a test.', policy_v103: P103.spans_bridge, pooled: sets, per_film: perFilm };
fs.mkdirSync(path.join(V103, 'eval', 'out'), { recursive: true });
fs.writeFileSync(path.join(V103, 'eval', 'out', 'variants.json'), JSON.stringify(out, null, 2));
console.log(out.label);
for (const S of sets) {
  console.log(`\n=== ${S.label}`);
  for (const n of [...NAMES, 'live']) { const r = S.rows[n]; const v = S.verdicts[n]; console.log(`  ${n.padEnd(20)} recall ${String(r.recall).padStart(3)}/${r.of} prec ${r.precision} skip ${r.skip} (x${r.skip_ratio_live ?? '-'}) wordless ${r.wordless} r1 ${r.rule1} r2 ${r.rule2} r3 ${r.rule3_tag_only} flagged ${r.flagged ?? '-'}${v ? ` | vs live R:${v.vs_live.recall} P:${v.vs_live.precision} (r>${v.vs_live.jitter.recall_a_gt_b} r<${v.vs_live.jitter.recall_a_lt_b})${v.vs_v102r ? ` | vs v102r R:${v.vs_v102r.recall} P:${v.vs_v102r.precision}` : ''}` : ''}`); }
}
console.log('');
for (const r of perFilm) console.log(`${r.slug}: v102 ${r.v102} | v102r ${r.v102r} | A ${r.A} | B ${r.B} | C ${r.C} | ABC ${r.ABC} | live ${r.live ?? '-'}\n    new ${r.abc_new_flags.join(' ') || '-'} | mortal ${r.abc_mortal.join(' ') || '-'} | cooccur ${r.abc_cooccur.join(',') || '-'} | bridge ${r.abc_bridge.join(' ') || '-'}`);
