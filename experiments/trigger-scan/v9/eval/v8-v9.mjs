#!/usr/bin/env node
// v9 EVALUATION on the DEV films (not pipeline, not frozen; pure code, no model calls, no network).
// v9 (out/<slug>.tags.r1.json) vs v8 as run (../v8/out/<slug>.tags.r1.json) vs the LIVE pipeline, on
// the HUMAN keys (refs/<slug>.key.json without the model-written codex-rules items), with v8's scoring:
//   refscore.js scoreKey (recall of should_flag items >= 50% inside the skip, strict + gap window;
//   conservative recall = min; should_flag-only precision proxy; tag-only / comic items skipped),
//   sensitivity (300 seeded jitter runs) + compareSystems (a difference counts only when >= 95% of
//   jitter runs agree), parent checks (parent-checks.js: (i) wordless peaks, (ii) wordless scenes),
//   rules 1/2 recall on the codex-rules items, and COCO death/loss item by item.
// LIVE: baseline/out/<slug>.built.json (tangled, coco, how-to-train-your-dragon; ../v8/baseline) and
// the live DB of the older dev films via scene-api/load.js (read-only, as v8/compare.js does). Live
// 'skip' = every live scene span. Up has no live scene file.
// POOLED: films laid end to end (film k offset by k x 1e8 ms) and scored with the same functions.
//   node eval/v8-v9.mjs [--films a,b,...]        -> out/eval/v8-v9.json
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSrt } from '../../srt.js';
import * as L from '../../../../scene-api/load.js';
import { scoreKey, sensitivity, compareSystems, union, shareInside } from '../refscore.js';
import { checkWordlessPeaks, checkWordlessScenes, WORDLESS_SHARE } from '../parent-checks.js';
import { wordlessScenes } from '../fill.js';
import { loadPolicy } from '../select.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const V9 = path.resolve(here, '..');
const TS = path.resolve(V9, '..');
const V8OUT = path.join(TS, 'v8', 'out');
const V9OUT = path.join(V9, 'out');
const BASE = path.join(TS, 'v8', 'baseline', 'out');
const POLICY = loadPolicy();
const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const FILMS = opt('films', 'nemo,monsters-inc,lion-king,frankenweenie,wild-robot,iron-giant,up,tangled,coco,how-to-train-your-dragon').split(',');
const ROUND4 = ['tangled', 'coco', 'how-to-train-your-dragon'];
const rj = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const r3 = (x) => (x == null ? null : Math.round(x * 1000) / 1000);

// ---- live ----
const ctx = await L.openExperiment(TS);
const v2map = L.buildV2Map(ctx.taxonomy);
const vocabIds = new Set(L.buildVocabulary(ctx.taxonomy).items.map((i) => i.id));
function liveSkip(slug) {
  const f = path.join(BASE, `${slug}.built.json`);
  try {
    const built = fs.existsSync(f) ? rj(f) : L.buildFilmFrom(L.readFilmInputs(slug, ctx), { srt: ctx.srt, v2map, vocabIds });
    return built.scenes.map((s) => [s.start_ms, s.end_ms]);
  } catch (err) { return null; }
}

const skipOf = (tags) => tags.scenes.filter((s) => s.flagged).flatMap((s) => (s.skip?.spans ?? []).map((x) => [x.start_ms, x.end_ms]));
const brief = (s) => ({ recall: `${s.recall_items.found}/${s.recall_items.of}`, found: s.recall_items.found, of: s.recall_items.of, precision: s.precision_proxy_ref_only, skip_minutes: s.skip_minutes, tag_only_flagged: `${s.tag_only.flagged}/${s.tag_only.items}`, villain: `${s.recall_by_policy.villain_threat.found}/${s.recall_by_policy.villain_threat.n}`, child: `${s.recall_by_policy.child_terrified.found}/${s.recall_by_policy.child_terrified.n}` });
function allWordless(key, skip) {
  const U = union(skip);
  const rows = key.items.filter((i) => i.mappable && Number.isFinite(i.start_ms) && i.should_flag === true && i.wordless).map((i) => ({ id: i.id, share: r3(shareInside(i.start_ms, i.end_ms, U)) }));
  return { n: rows.length, covered: rows.filter((r) => r.share >= WORDLESS_SHARE).length };
}
function versus(key, a, b) {
  const aS = scoreKey(key, a); const aG = scoreKey(key, a, { window: 'gap' });
  const bS = scoreKey(key, b); const bG = scoreKey(key, b, { window: 'gap' });
  const sens = sensitivity(key, a, b);
  const v = compareSystems({ aStrict: aS, aGap: aG, bStrict: bS, bGap: bG, sens });
  return { a: { strict: brief(aS), gap: brief(aG) }, b: { strict: brief(bS), gap: brief(bG) }, verdict: { recall: v.recall, precision: v.precision, overall: v.overall, conservative_recall: v.conservative_recall }, jitter: { recall_a_gt_b: sens.recall_diff_a_minus_b.share_a_gt_b, recall_a_lt_b: sens.recall_diff_a_minus_b.share_a_lt_b, precision_a_gt_b: sens.precision_diff_a_minus_b.share_a_gt_b, precision_a_lt_b: sens.precision_diff_a_minus_b.share_a_lt_b } };
}
function rules12(fullKey, skip, slug) {
  const auditFalse = new Set((fullKey.audit ?? rj(path.join(TS, 'refs', 'audits.json'))[slug] ?? []).filter((a) => a.rule_applies === false).map((a) => a.id));
  const items = fullKey.items.filter((i) => i.source === 'codex-rules' && i.mappable && Number.isFinite(i.start_ms) && !i.played_for_laughs && !auditFalse.has(i.id));
  const U = union(skip);
  const got = (m) => items.filter((i) => i.marker === m && shareInside(i.start_ms, i.end_ms, U) >= 0.5).length;
  return { villain: [got('villain_threat'), items.filter((i) => i.marker === 'villain_threat').length], child: [got('child_terrified'), items.filter((i) => i.marker === 'child_terrified').length] };
}

const films = []; const pool = { items: [], v8: [], v9: [], live: [], liveItems: [] };
FILMS.forEach((slug, k) => {
  const off = k * 1e8;
  const fullKey = rj(path.join(TS, 'refs', `${slug}.key.json`));
  const key = { ...fullKey, items: fullKey.items.filter((i) => i.source !== 'codex-rules') };
  const t8 = rj(path.join(V8OUT, `${slug}.tags.r1.json`)); const t9 = rj(path.join(V9OUT, `${slug}.tags.r1.json`));
  const s8 = skipOf(t8); const s9 = skipOf(t9); const sl = liveSkip(slug);
  const seg = rj(path.join(V9OUT, `${slug}.segments.json`));
  const cues = parseSrt(fs.readFileSync(path.join(TS, 'data', `${slug}.srt`), 'utf8'));
  const wl = wordlessScenes(seg, cues, POLICY);
  const f8 = t8.scenes.filter((s) => s.flagged); const f9 = t9.scenes.filter((s) => s.flagged);
  const row = {
    slug, flagged: { v8: f8.length, v9: f9.length, scenes: t9.scenes.length },
    v9_vs_v8: versus(key, s9, s8),
    ...(sl ? { v9_vs_live: versus(key, s9, sl), v8_vs_live: versus(key, s8, sl) } : {}),
    parent: {
      i_wordless_peaks_in_flagged: { v8: checkWordlessPeaks(key, f8, s8), v9: checkWordlessPeaks(key, f9, s9) },
      i_wordless_peaks_all: { v8: allWordless(key, s8), v9: allWordless(key, s9), ...(sl ? { live: allWordless(key, sl) } : {}) },
      ii_wordless_scenes: { v8: checkWordlessScenes(key, wl, s8), v9: checkWordlessScenes(key, wl, s9), ...(sl ? { live: checkWordlessScenes(key, wl, sl) } : {}) },
    },
    rules_1_2: { v8: rules12(fullKey, s8, slug), v9: rules12(fullKey, s9, slug), ...(sl ? { live: rules12(fullKey, sl, slug) } : {}) },
    v9_flag_reasons_by: t9.summary.flag_reasons_by, v9_why: t9.summary.why,
  };
  // death / loss item by item (every film; Coco is the headline)
  const U8 = union(s8); const U9 = union(s9); const UL = sl ? union(sl) : null;
  row.death_items = key.items.filter((i) => i.mappable && Number.isFinite(i.start_ms) && (i.categories ?? []).includes('death')).map((i) => {
    const sc9 = f9.find((s) => Math.min(s.end_ms, i.end_ms) - Math.max(s.start_ms, i.start_ms) > 0);
    return { id: i.id, should_flag: i.should_flag, v8: r3(shareInside(i.start_ms, i.end_ms, U8)), v9: r3(shareInside(i.start_ms, i.end_ms, U9)), ...(UL ? { live: r3(shareInside(i.start_ms, i.end_ms, UL)) } : {}), v9_scene: sc9?.id ?? null, v9_reasons: sc9 ? sc9.flag_reasons.map((r) => `${r.id}${r.by === 'sonnet' ? '{S}' : ''}`) : [] };
  });
  films.push(row);
  const sh = ([a, b]) => [a + off, b + off];
  pool.v8.push(...s8.map(sh)); pool.v9.push(...s9.map(sh));
  const pid = (id) => `${slug}:${id}`;
  const shifted = key.items.map((it) => { const o = { ...it, id: pid(it.id), same_moment_as: (it.same_moment_as ?? []).map(pid) }; for (const fl of ['start_ms', 'end_ms', 'gap_start_ms', 'gap_end_ms']) if (Number.isFinite(it[fl])) o[fl] = it[fl] + off; return o; });
  pool.items.push(...shifted);
  if (sl) { pool.live.push(...sl.map(sh)); pool.liveItems.push(...shifted); pool.liveV9 ??= []; pool.liveV9.push(...s9.map(sh)); pool.liveV8 ??= []; pool.liveV8.push(...s8.map(sh)); }
});
const pk = { items: pool.items, film_level: [] };
const pkl = { items: pool.liveItems, film_level: [] };
const r4 = films.filter((f) => ROUND4.includes(f.slug));
const sum = (arr, g) => arr.reduce((a, x) => a + g(x), 0);
const out = {
  generated_at: new Date().toISOString(), films: FILMS,
  pooled_all: { v9_vs_v8: versus(pk, pool.v9, pool.v8) },
  pooled_with_live: { films: films.filter((f) => f.v9_vs_live).map((f) => f.slug), v9_vs_live: versus(pkl, pool.liveV9, pool.live), v8_vs_live: versus(pkl, pool.liveV8, pool.live) },
  parent_pooled: Object.fromEntries(['v8', 'v9'].map((s) => [s, { i_in_flagged: `${sum(films, (f) => f.parent.i_wordless_peaks_in_flagged[s].covered)}/${sum(films, (f) => f.parent.i_wordless_peaks_in_flagged[s].n)}`, i_all: `${sum(films, (f) => f.parent.i_wordless_peaks_all[s].covered)}/${sum(films, (f) => f.parent.i_wordless_peaks_all[s].n)}`, ii: `${sum(films, (f) => f.parent.ii_wordless_scenes[s].found)}/${sum(films, (f) => f.parent.ii_wordless_scenes[s].n)}`, rules_villain: `${sum(films, (f) => f.rules_1_2[s].villain[0])}/${sum(films, (f) => f.rules_1_2[s].villain[1])}`, rules_child: `${sum(films, (f) => f.rules_1_2[s].child[0])}/${sum(films, (f) => f.rules_1_2[s].child[1])}`, round4_wordless_all: `${sum(r4, (f) => f.parent.i_wordless_peaks_all[s].covered)}/${sum(r4, (f) => f.parent.i_wordless_peaks_all[s].n)}` }])),
  per_film: films,
};
out.parent_pooled.live_round4 = { wordless_all: `${sum(r4, (f) => f.parent.i_wordless_peaks_all.live?.covered ?? 0)}/${sum(r4, (f) => f.parent.i_wordless_peaks_all.live?.n ?? 0)}`, rules_villain: `${sum(r4, (f) => f.rules_1_2.live?.villain[0] ?? 0)}/${sum(r4, (f) => f.rules_1_2.live?.villain[1] ?? 0)}`, rules_child: `${sum(r4, (f) => f.rules_1_2.live?.child[0] ?? 0)}/${sum(r4, (f) => f.rules_1_2.live?.child[1] ?? 0)}` };
// round-4 films pooled (the v8-vs-live head-to-head set)
{
  const idx = FILMS.map((s, k) => [s, k]).filter(([s]) => ROUND4.includes(s));
  if (idx.length) {
    const items = []; const a = []; const b = []; const l = [];
    for (const [slug, k] of idx) {
      const off = k * 1e8; const f = films.find((x) => x.slug === slug);
      const pid = (id) => `${slug}:${id}`;
      items.push(...pool.items.filter((it) => it.id.startsWith(`${slug}:`)));
      a.push(...pool.v9.filter(([s]) => s >= off && s < off + 1e8)); b.push(...pool.v8.filter(([s]) => s >= off && s < off + 1e8)); l.push(...pool.live.filter(([s]) => s >= off && s < off + 1e8));
    }
    const kk = { items, film_level: [] };
    out.pooled_round4 = { films: idx.map(([s]) => s), v9_vs_v8: versus(kk, a, b), v9_vs_live: versus(kk, a, l), v8_vs_live: versus(kk, b, l) };
  }
}
fs.mkdirSync(path.join(V9OUT, 'eval'), { recursive: true });
fs.writeFileSync(path.join(V9OUT, 'eval', 'v8-v9.json'), JSON.stringify(out, null, 2));

const line = (n, x) => console.log(`  ${n.padEnd(22)} A ${x.a.strict.recall}/${x.a.gap.recall} prec ${x.a.strict.precision}/${x.a.gap.precision} skip ${x.a.strict.skip_minutes} tag-only ${x.a.strict.tag_only_flagged} || B ${x.b.strict.recall}/${x.b.gap.recall} prec ${x.b.strict.precision}/${x.b.gap.precision} skip ${x.b.strict.skip_minutes} tag-only ${x.b.strict.tag_only_flagged} || recall ${x.verdict.recall} prec ${x.verdict.precision} (jit rec A>B ${x.jitter.recall_a_gt_b} A<B ${x.jitter.recall_a_lt_b}; prec A>B ${x.jitter.precision_a_gt_b} A<B ${x.jitter.precision_a_lt_b})`);
for (const f of films) {
  console.log(`\n${f.slug}: flagged v8 ${f.flagged.v8} v9 ${f.flagged.v9} of ${f.flagged.scenes}; v9 reasons by ${JSON.stringify(f.v9_flag_reasons_by)}`);
  line('v9(A) vs v8(B)', f.v9_vs_v8);
  if (f.v9_vs_live) line('v9(A) vs live(B)', f.v9_vs_live);
  console.log(`  wordless all v8 ${f.parent.i_wordless_peaks_all.v8.covered}/${f.parent.i_wordless_peaks_all.v8.n} v9 ${f.parent.i_wordless_peaks_all.v9.covered}/${f.parent.i_wordless_peaks_all.v9.n}; rules v8 ${JSON.stringify(f.rules_1_2.v8)} v9 ${JSON.stringify(f.rules_1_2.v9)}`);
}
console.log('\nPOOLED ALL 10 (A=v9, B=v8)'); line('v9 vs v8', out.pooled_all.v9_vs_v8);
console.log(`POOLED films with live (${out.pooled_with_live.films.join(',')})`); line('v9 vs live', out.pooled_with_live.v9_vs_live); line('v8 vs live', out.pooled_with_live.v8_vs_live);
if (out.pooled_round4) { console.log('POOLED ROUND-4 FILMS'); line('v9 vs v8', out.pooled_round4.v9_vs_v8); line('v9 vs live', out.pooled_round4.v9_vs_live); line('v8 vs live', out.pooled_round4.v8_vs_live); }
console.log(`parent pooled ${JSON.stringify(out.parent_pooled)}`);
const coco = films.find((f) => f.slug === 'coco');
if (coco) { console.log('\nCOCO death items (share inside skip):'); for (const d of coco.death_items) console.log(`  ${d.id} sf=${d.should_flag} v8 ${d.v8} v9 ${d.v9} live ${d.live ?? '-'} ${d.v9_scene ?? ''} ${d.v9_reasons.join(',')}`); }
