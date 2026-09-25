#!/usr/bin/env node
// v10 DEV-ONLY POST-HOC ESTIMATE (not pipeline, not frozen; pure code, no model calls, no network).
//
// THIS IS NOT A TEST. All 13 films are SEEN films: the v10 phrasings, bundles and thresholds were chosen on
// these very films (assemble/decide.mjs over the phrasing tournament), so every number below is in-sample and
// optimistic. It estimates what v10 WOULD flag on them, from stored answers only:
//   Jev      the phrasing tournament's stored answers (jevfirst/tournament/out) + v9's stored answers for the
//            v9 wording (v9/out/<slug>.jev.r1.json: also the Scores, modifiers, kind, mention and film
//            presence v10 keeps) -- assemble/score-lib.mjs loadData -- and the lint-fixed wordings' own answers
//            (assemble/fixrun/out) once that run is complete ('measured'); until then each lint-fixed
//            wording is read as its original wording's answer (a PROXY). The mode is printed in the label.
//   Sonnet   v9's stored Sonnet answers (v9/out/<slug>.sonnetq.r1.json), asked 43 ids; v10 reads only its 12.
//   select   v10/select.js selectRun (the v10 code path: combine -> merge -> v9 flag policy), policy.json.
//   spans    moments.js respanScenes over v9's stored moment answers; a newly flagged scene, or a reason whose
//            clause v9 never asked, gets the WHOLE scene (counted).
// Systems compared, on the human keys (refs/, codex-rules items excluded), with v9's scoring (refscore.js):
//   v10          the assembled v10 (jev-set.js + split.json)
//   v10_strict   the same owner rule over MEASURED wordings only (assemble/decisions.strict.json)
//   v9           v9 as run (v9/out/<slug>.tags.r1.json)
//   live         the live pipeline's scenes (v8/baseline/out, v9/round5/live, or scene-api/load.js read-only)
// Metrics: conservative recall = min(strict, gap window) of mapped should_flag items >= 50% inside the skip;
// should_flag precision proxy (strict / gap); skip minutes; flagged scenes; rules 1/2 (villain threat,
// child terrified) recall on the clean codex-rules items. Pooled = films end to end, jitter-tested
// (compareSystems: a difference counts only when >= 95% of 300 jitter runs agree).
//
//   node eval/posthoc.mjs    -> eval/out/posthoc.json + a table on stdout
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSrt } from '../../srt.js';
import * as L from '../../../../scene-api/load.js';
import { scoreKey, sensitivity, compareSystems, union, shareInside } from '../refscore.js';
import { checkWordlessPeaks, WORDLESS_SHARE } from '../parent-checks.js';
import { loadPolicy, selectRun } from '../select.js';
import { respanScenes, clauseFor } from '../moments.js';
import { loadSplit } from '../split.js';
import { JEV_CONCEPTS } from '../questions.js';
import { evalExpr } from '../combine.js';
import { loadData, FILMS, fixrunComplete } from '../assemble/score-lib.mjs';
import { conceptTargets } from '../assemble/targets.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const V10 = path.resolve(here, '..');
const TS = path.resolve(V10, '..');
const V9OUT = path.join(TS, 'v9', 'out');
const OUTD = path.join(here, 'out');
fs.mkdirSync(OUTD, { recursive: true });
const rj = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const r3 = (x) => (x == null || Number.isNaN(x) ? null : Math.round(x * 1000) / 1000);
const POLICY = loadPolicy();
const SPLIT = loadSplit();
const FIX_MODE = fixrunComplete() ? 'measured' : 'proxy';
const DATA = loadData({ fix: FIX_MODE });
const STRICT = rj(path.join(V10, 'assemble', 'decisions.strict.json'));
const MAIN = rj(path.join(V10, 'assemble', 'decisions.json'));

// ---- the strict (measured-only) variant: its targets, thresholds and Sonnet ids --------------------------
const strictTargets = []; const strictAssign = {};
for (const d of STRICT.decisions) { const t = conceptTargets(d); strictTargets.push(...t.targets); Object.assign(strictAssign, t.assign); }
const strictSonnet = Object.entries(strictAssign).filter(([, o]) => o === 'sonnet').map(([id]) => id);
const thrKey = (t) => (t.layer === 'film' ? `cf.${t.type}` : t.layer === 'derived' ? `d.${t.id}` : `c.${t.id}`);
const strictCfg = { ...structuredClone(POLICY), overrides: { ...(POLICY.overrides ?? {}), ...Object.fromEntries(strictTargets.map((t) => [thrKey(t), { act: t.act }])) } };
function strictConcepts(flat, scores, items) {
  const ctx = { a: flat, scores, items }; const c = {}; const d = {}; const cf = {};
  for (const t of strictTargets) {
    if (t.layer === 'film') { for (const it of items.filter((x) => x.type === t.type)) cf[it.id] = evalExpr(t.expr, { ...ctx, item: it }); continue; }
    const p = evalExpr(t.expr, ctx);
    if (t.layer === 'derived') d[t.id] = p; else c[t.id] = p;
  }
  return { c, d, cf };
}

// ---- live ------------------------------------------------------------------------------------------
const ctxL = await L.openExperiment(TS);
const v2map = L.buildV2Map(ctxL.taxonomy);
const vocabIds = new Set(L.buildVocabulary(ctxL.taxonomy).items.map((i) => i.id));
function liveSkip(slug) {
  for (const f of [path.join(TS, 'v8', 'baseline', 'out', `${slug}.built.json`), path.join(TS, 'v9', 'round5', 'live', `${slug}.built.json`)]) if (fs.existsSync(f)) return { src: path.relative(TS, f), spans: rj(f).scenes.map((s) => [s.start_ms, s.end_ms]) };
  try { const b = L.buildFilmFrom(L.readFilmInputs(slug, ctxL), { srt: ctxL.srt, v2map, vocabIds }); return { src: 'scene-api/load.js (read-only)', spans: b.scenes.map((s) => [s.start_ms, s.end_ms]) }; } catch (err) { return { src: null, error: err.message, spans: null }; }
}

// ---- scoring helpers (v9 eval/v8-v9.mjs) ------------------------------------------------------------
const brief = (s) => ({ recall: `${s.recall_items.found}/${s.recall_items.of}`, found: s.recall_items.found, of: s.recall_items.of, precision: s.precision_proxy_ref_only, skip_minutes: s.skip_minutes, tag_only_flagged: `${s.tag_only.flagged}/${s.tag_only.items}` });
function sys(key, skip) {
  const S = scoreKey(key, skip); const G = scoreKey(key, skip, { window: 'gap' });
  return { conservative_recall: Math.min(S.recall_items.found, G.recall_items.found), of: S.recall_items.of, precision_strict: S.precision_proxy_ref_only, precision_gap: G.precision_proxy_ref_only, skip_minutes: S.skip_minutes, strict: brief(S), gap: brief(G) };
}
function versus(key, a, b) {
  const aS = scoreKey(key, a); const aG = scoreKey(key, a, { window: 'gap' });
  const bS = scoreKey(key, b); const bG = scoreKey(key, b, { window: 'gap' });
  const sens = sensitivity(key, a, b);
  const v = compareSystems({ aStrict: aS, aGap: aG, bStrict: bS, bGap: bG, sens });
  return { recall: v.recall, precision: v.precision, overall: v.overall, conservative_recall: v.conservative_recall, precision_strict: v.precision_strict, precision_gap: v.precision_gap, skip_minutes: v.skip_minutes, jitter: { recall_a_gt_b: sens.recall_diff_a_minus_b.share_a_gt_b, recall_a_lt_b: sens.recall_diff_a_minus_b.share_a_lt_b, precision_a_gt_b: sens.precision_diff_a_minus_b.share_a_gt_b, precision_a_lt_b: sens.precision_diff_a_minus_b.share_a_lt_b } };
}
function rules12(fullKey, skip, slug) {
  const auditFalse = new Set((fullKey.audit ?? rj(path.join(TS, 'refs', 'audits.json'))[slug] ?? []).filter((a) => a.rule_applies === false).map((a) => a.id));
  const items = fullKey.items.filter((i) => i.source === 'codex-rules' && i.mappable && Number.isFinite(i.start_ms) && !i.played_for_laughs && !auditFalse.has(i.id));
  const U = union(skip);
  const got = (m) => items.filter((i) => i.marker === m && shareInside(i.start_ms, i.end_ms, U) >= 0.5).length;
  return { villain: [got('villain_threat'), items.filter((i) => i.marker === 'villain_threat').length], child: [got('child_terrified'), items.filter((i) => i.marker === 'child_terrified').length] };
}
const allWordless = (key, skip) => { const U = union(skip); const rows = key.items.filter((i) => i.mappable && Number.isFinite(i.start_ms) && i.should_flag === true && i.wordless); return { n: rows.length, covered: rows.filter((i) => shareInside(i.start_ms, i.end_ms, U) >= WORDLESS_SHARE).length }; };
const skipOfTags = (tags) => tags.scenes.filter((s) => s.flagged).flatMap((s) => (s.skip?.spans ?? []).map((x) => [x.start_ms, x.end_ms]));

// ---- one variant through the v10 select path ---------------------------------------------------------
function runVariant({ slug, rows, items, cues, sonnet, used, cfg, saved }) {
  const tags = selectRun({ film: { slug }, run: 'posthoc', film_items: items, scenes: rows }, cfg, { cues, sonnet, used });
  const sp = respanScenes({ tags, saved, cues, items, cfg: POLICY });
  const flagged = tags.scenes.filter((s) => s.flagged);
  const skip = flagged.flatMap((s) => (sp[s.id]?.spans ?? []).map((x) => [x.start_ms, x.end_ms]));
  const whole = flagged.filter((s) => sp[s.id]?.method === 'whole_scene' && /not_asked/.test(sp[s.id]?.why ?? '')).map((s) => s.id);
  // lower bound on skip (narrow/rescore.mjs 'asked_only'): in a scene v9's moment finder saw, keep only the
  // reasons whose clause it asked; a scene v9 never flagged keeps the whole scene. Under-skips on purpose.
  const asked = (id) => new Set((saved.scenes?.[id]?.answers ?? []).map((a) => a.clause));
  const narrowed = { ...tags, scenes: tags.scenes.map((s) => {
    if (!s.flagged || !saved.scenes?.[s.id]?.answers) return s;
    const keep = s.flag_reasons.filter((r) => asked(s.id).has(clauseFor(r, items)));
    return keep.length ? { ...s, flag_reasons: keep } : s;
  }) };
  const spLo = respanScenes({ tags: narrowed, saved, cues, items, cfg: POLICY });
  const skipLo = flagged.flatMap((s) => (spLo[s.id]?.spans ?? []).map((x) => [x.start_ms, x.end_ms]));
  const reasons = {}; for (const s of flagged) for (const r of s.flag_reasons) reasons[r.id] = (reasons[r.id] ?? 0) + 1;
  const by = { jev: flagged.flatMap((s) => s.flag_reasons).filter((r) => r.by === 'jev').length, sonnet: flagged.flatMap((s) => s.flag_reasons).filter((r) => r.by === 'sonnet').length, scenes_only_sonnet: flagged.filter((s) => s.flag_reasons.every((r) => r.by === 'sonnet')).length, scenes_only_jev: flagged.filter((s) => s.flag_reasons.every((r) => r.by === 'jev')).length };
  return { tags, flagged, skip, skipLo, whole_scene_fallback: whole, reason_counts: reasons, by };
}

// ---- per film ----------------------------------------------------------------------------------------
const films = []; const pool = { items: [], v10: [], v10lo: [], liveV10lo: [], v10s: [], v9: [], live: [], liveItems: [], liveV10: [], liveV10s: [], liveV9: [] };
const fidelity = {}; // per Jev target: fires through the select path vs decisions.json
FILMS.forEach((slug, k) => {
  const off = k * 1e8;
  const fullKey = rj(path.join(TS, 'refs', `${slug}.key.json`));
  const key = { ...fullKey, items: fullKey.items.filter((i) => i.source !== 'codex-rules') };
  const run9 = rj(path.join(V9OUT, `${slug}.jev.r1.json`));
  const sonnet = rj(path.join(V9OUT, `${slug}.sonnetq.r1.json`));
  const saved = rj(path.join(V9OUT, `${slug}.moments.r1.json`));
  const tags9 = rj(path.join(V9OUT, `${slug}.tags.r1.json`));
  const cues = parseSrt(fs.readFileSync(path.join(TS, 'data', `${slug}.srt`), 'utf8'));
  const items = run9.film_items ?? [];
  const F = DATA[slug];
  const tItems = F.filmItems.map((x) => x.id).join();
  if (tItems !== items.map((x) => x.id).join()) throw new Error(`${slug}: film items differ between v9 and the tournament`);
  const flatBy = new Map(F.scenes.map((s) => [s.id, s]));
  const keep = (a) => ({ m: a.m, mod: a.mod, s: a.s, kind: a.kind, fpl: a.fpl, fps: a.fps });
  const rowsMain = run9.scenes.map((r) => (r.answers ? { ...r, answers: { q: flatBy.get(r.id).a, ...keep(r.answers) } } : { ...r, answers: null }));
  const rowsStrict = run9.scenes.map((r) => (r.answers ? { ...r, answers: { ...keep(r.answers), ...strictConcepts(flatBy.get(r.id).a, flatBy.get(r.id).scores, items) } } : { ...r, answers: null }));
  const main = runVariant({ slug, rows: rowsMain, items, cues, sonnet, used: SPLIT.sonnet_used, cfg: POLICY, saved });
  const strict = runVariant({ slug, rows: rowsStrict, items, cues, sonnet, used: strictSonnet, cfg: strictCfg, saved });
  // fidelity: scenes where select tagged each Jev target at 'act' (kept, cancelled by a modifier, or moved
  // by the kind gate) must equal the fires decide.mjs scored for that concept at its threshold
  for (const [cname, con] of Object.entries(JEV_CONCEPTS)) {
    for (const t of con.targets) {
      const kk = `${cname}:${t.layer === 'film' ? t.type : t.id}`;
      fidelity[kk] ??= { fires: 0 };
      for (const sc of main.tags.scenes) {
        if (sc.unclassified) continue;
        const hit = t.layer === 'film'
          ? [...sc.tags, ...sc.cancelled].some((x) => x.level === 'act' && items.find((it) => it.id === x.id)?.type === t.type && x.id.endsWith(t.type === 'danger' ? '_endangers' : t.type === 'threatens' ? '_threatens' : '_in_danger'))
          : [...sc.tags.filter((x) => x.level === 'act'), ...sc.cancelled.filter((x) => x.level === 'act'), ...sc.vetoed].some((x) => x.id === t.id);
        if (hit) fidelity[kk].fires += 1;
      }
    }
  }
  const s9 = skipOfTags(tags9); const f9 = tags9.scenes.filter((s) => s.flagged);
  const live = liveSkip(slug); const sl = live.spans;
  const row = {
    slug, scenes: tags9.scenes.length,
    flagged: { v10: main.flagged.length, v10_strict: strict.flagged.length, v9: f9.length },
    whole_scene_fallback: { v10: main.whole_scene_fallback.length, v10_strict: strict.whole_scene_fallback.length },
    flag_reasons_by: { v10: main.by, v10_strict: strict.by, v9: tags9.summary.flag_reasons_by },
    reason_counts: { v10: main.reason_counts, v9: f9.flatMap((s) => s.flag_reasons.map((r) => r.id)).reduce((m, id) => ({ ...m, [id]: (m[id] ?? 0) + 1 }), {}) },
    systems: { v10: sys(key, main.skip), v10_asked_only: sys(key, main.skipLo), v10_strict: sys(key, strict.skip), v9: sys(key, s9), ...(sl ? { live: sys(key, sl) } : {}) },
    wordless_all: { v10: allWordless(key, main.skip), v9: allWordless(key, s9), ...(sl ? { live: allWordless(key, sl) } : {}) },
    rules_1_2: { v10: rules12(fullKey, main.skip, slug), v10_strict: rules12(fullKey, strict.skip, slug), v9: rules12(fullKey, s9, slug), ...(sl ? { live: rules12(fullKey, sl, slug) } : {}) },
    live_source: live.src ?? `none (${live.error})`,
    v10_vs_v9: versus(key, main.skip, s9),
    ...(sl ? { v10_vs_live: versus(key, main.skip, sl), v9_vs_live: versus(key, s9, sl) } : {}),
    newly_flagged_vs_v9: main.flagged.filter((s) => !f9.some((x) => x.id === s.id)).map((s) => `${s.id}:${s.flag_reasons.map((r) => r.id).join('+')}`),
    no_longer_flagged_vs_v9: f9.filter((s) => !main.flagged.some((x) => x.id === s.id)).map((s) => `${s.id}:${s.flag_reasons.map((r) => r.id).join('+')}`),
  };
  films.push(row);
  const sh = ([a, b]) => [a + off, b + off];
  const pid = (id) => `${slug}:${id}`;
  const shifted = key.items.map((it) => { const o = { ...it, id: pid(it.id), same_moment_as: (it.same_moment_as ?? []).map(pid) }; for (const fl of ['start_ms', 'end_ms', 'gap_start_ms', 'gap_end_ms']) if (Number.isFinite(it[fl])) o[fl] = it[fl] + off; return o; });
  pool.items.push(...shifted); pool.v10.push(...main.skip.map(sh)); pool.v10lo.push(...main.skipLo.map(sh)); pool.v10s.push(...strict.skip.map(sh)); pool.v9.push(...s9.map(sh));
  if (sl) { pool.live.push(...sl.map(sh)); pool.liveItems.push(...shifted); pool.liveV10.push(...main.skip.map(sh)); pool.liveV10lo.push(...main.skipLo.map(sh)); pool.liveV10s.push(...strict.skip.map(sh)); pool.liveV9.push(...s9.map(sh)); }
});

// fidelity vs decisions.json (non-film targets that are the concept's own expression)
const fid = [];
for (const d of MAIN.decisions) {
  if (d.owner !== 'jev' || !d.jev) continue;
  const tk = d.film ? `${d.concept}:${d.film}` : d.concept === 'appears_suddenly' ? `${d.concept}:jump_scare` : `${d.concept}:${d.v9_ids[0]}`;
  fid.push({ concept: d.concept, decide_fires: d.jev.all.fires, select_path_fires: fidelity[tk]?.fires ?? null, same: d.jev.all.fires === fidelity[tk]?.fires });
}

const pk = { items: pool.items, film_level: [] };
const pkl = { items: pool.liveItems, film_level: [] };
const sum = (f) => films.reduce((a, x) => a + f(x), 0);
const out = {
  generated_at: new Date().toISOString(),
  label: 'DEV-ONLY POST-HOC ESTIMATE on the 13 SEEN films (in-sample; the phrasings were chosen on these films). Not a test. ' + (FIX_MODE === 'measured' ? 'Lint-fixed wordings scored on their own measured Jev answers (assemble/fixrun/out).' : 'Lint-fixed wordings read as their original wording (proxy, unmeasured).'),
  jev_set: { fix_mode: MAIN.fix_mode, sonnet_used: SPLIT.sonnet_used, strict_sonnet_used: strictSonnet },
  films: FILMS,
  pooled: {
    all_13: { v10: sys(pk, pool.v10), v10_asked_only: sys(pk, pool.v10lo), v10_strict: sys(pk, pool.v10s), v9: sys(pk, pool.v9), v10_vs_v9: versus(pk, pool.v10, pool.v9), v10_strict_vs_v9: versus(pk, pool.v10s, pool.v9) },
    with_live: { films: films.filter((f) => f.systems.live).map((f) => f.slug), v10: sys(pkl, pool.liveV10), v10_asked_only: sys(pkl, pool.liveV10lo), v10_strict: sys(pkl, pool.liveV10s), v9: sys(pkl, pool.liveV9), live: sys(pkl, pool.live), v10_vs_live: versus(pkl, pool.liveV10, pool.live), v10_strict_vs_live: versus(pkl, pool.liveV10s, pool.live), v9_vs_live: versus(pkl, pool.liveV9, pool.live) },
  },
  totals: {
    flagged: { v10: sum((f) => f.flagged.v10), v10_strict: sum((f) => f.flagged.v10_strict), v9: sum((f) => f.flagged.v9) },
    whole_scene_fallback: { v10: sum((f) => f.whole_scene_fallback.v10), v10_strict: sum((f) => f.whole_scene_fallback.v10_strict) },
    flag_reasons_by: { v10: { jev: sum((f) => f.flag_reasons_by.v10.jev), sonnet: sum((f) => f.flag_reasons_by.v10.sonnet), scenes_only_sonnet: sum((f) => f.flag_reasons_by.v10.scenes_only_sonnet) }, v9: { jev: sum((f) => f.flag_reasons_by.v9?.jev ?? 0), sonnet: sum((f) => f.flag_reasons_by.v9?.sonnet ?? 0), scenes_only_sonnet: sum((f) => f.flag_reasons_by.v9?.scenes_flagged_only_by_sonnet ?? 0) } },
    rules_1_2: Object.fromEntries(['v10', 'v10_strict', 'v9'].map((s) => [s, { villain: `${sum((f) => f.rules_1_2[s].villain[0])}/${sum((f) => f.rules_1_2[s].villain[1])}`, child: `${sum((f) => f.rules_1_2[s].child[0])}/${sum((f) => f.rules_1_2[s].child[1])}` }])),
    rules_1_2_live_films: Object.fromEntries(['v10', 'v9', 'live'].map((s) => [s, { villain: `${sum((f) => (f.rules_1_2.live ? f.rules_1_2[s].villain[0] : 0))}/${sum((f) => (f.rules_1_2.live ? f.rules_1_2[s].villain[1] : 0))}`, child: `${sum((f) => (f.rules_1_2.live ? f.rules_1_2[s].child[0] : 0))}/${sum((f) => (f.rules_1_2.live ? f.rules_1_2[s].child[1] : 0))}` }])),
  },
  fidelity_select_path_vs_decide: { all_same: fid.every((x) => x.same), rows: fid.filter((x) => !x.same) },
  per_film: films,
};
fs.writeFileSync(path.join(OUTD, 'posthoc.json'), JSON.stringify(out, null, 2));

const p = (x) => (x == null ? '-' : x.toFixed(3));
const line = (n, s) => console.log(`  ${n.padEnd(12)} cons.recall ${String(s.conservative_recall).padStart(3)}/${s.of}  prec strict ${p(s.precision_strict)} gap ${p(s.precision_gap)}  skip ${s.skip_minutes.toFixed(1)} min`);
console.log(out.label);
for (const f of films) {
  console.log(`\n${f.slug}: flagged v10 ${f.flagged.v10} (strict ${f.flagged.v10_strict}) v9 ${f.flagged.v9} of ${f.scenes}; v10 whole-scene fallbacks ${f.whole_scene_fallback.v10}; live: ${f.live_source}`);
  for (const [n, s] of Object.entries(f.systems)) line(n, s);
}
console.log('\nPOOLED, all 13 films'); for (const n of ['v10', 'v10_asked_only', 'v10_strict', 'v9']) line(n, out.pooled.all_13[n]);
console.log(`  v10 vs v9: recall ${out.pooled.all_13.v10_vs_v9.recall}, precision ${out.pooled.all_13.v10_vs_v9.precision}, overall ${out.pooled.all_13.v10_vs_v9.overall}`);
console.log(`\nPOOLED, films with a live baseline (${out.pooled.with_live.films.join(', ')})`);
for (const n of ['v10', 'v10_asked_only', 'v10_strict', 'v9', 'live']) line(n, out.pooled.with_live[n]);
for (const n of ['v10_vs_live', 'v10_strict_vs_live', 'v9_vs_live']) { const v = out.pooled.with_live[n]; console.log(`  ${n}: recall ${v.recall}, precision ${v.precision}, overall ${v.overall}`); }
console.log(`\ntotals ${JSON.stringify(out.totals)}`);
console.log(`fidelity (select path == decide numbers): ${out.fidelity_select_path_vs_decide.all_same}${out.fidelity_select_path_vs_decide.rows.length ? ` ${JSON.stringify(out.fidelity_select_path_vs_decide.rows)}` : ''}`);
