#!/usr/bin/env node
// Round-4 HEAD-TO-HEAD scoring (not pipeline, not frozen; pure code, no model calls, no network).
// v8 (frozen, run with --final-held-out-run: out/<slug>.*) vs the LIVE pipeline (baseline/run-live.mjs:
// baseline/out/<slug>.built.json) on the three held-out films, against the blind keys (refs/).
//
// Same functions as compare.js (refscore.js, parent-checks.js), same v7 verdict rule:
//   conservative recall = min(strict, gap) of should_flag human items found (>= 50% inside the skip);
//   precision = should_flag-only precision proxy, strict and gap; 300 seeded jitter runs; 95% bar.
//   live 'skip' = every live scene span (as compare.js scores the live DB).
// POOLED: the three films laid end to end on one timeline (film k offset by k x 1e8 ms, ids prefixed)
// and scored with the same functions, so pooled recall / precision / jitter are the same statistics
// over all items at once.
// PARENT CHECKS, both systems:
//   (i)  wordless peaks: parent-checks.js definition (items inside a FLAGGED scene; live's flagged scenes
//        are all its scenes, so its denominator differs) AND a system-independent variant over ALL
//        mapped should_flag wordless items (>= 80% inside the skip) -- the comparable one.
//   (ii) wordless scenes: key items inside the wordless scenes of v8's segmentation (fill.js
//        wordlessScenes; < 3 dialogue cues/min), found by either system's skip. Same regions for both.
//   (iii) v8: reasons.js why per flagged scene (checkWhy) + the why text on each flagged scene in tags.
//        live: Sonnet's scene description (not source-checked; redacted when it quotes).
// RULES 1/2 vs the key's codex-rules items (model-written; clean = not played for laughs and not judged
//   rule-false by the key builder's audit), as eval/rules12.mjs.
// Writes out/headtohead.json.
import fs from 'node:fs';
import path from 'node:path';
import { parseSrt } from '../../srt.js';
import { V8, TS, outDir, freezeStatus } from '../env.js';
import { ITEMS } from '../questions.js';
import { scoreKey, sensitivity, compareSystems, dtddAgreement, union, total, shareInside } from '../refscore.js';
import { checkWordlessPeaks, checkWordlessScenes, checkWhy, WORDLESS_SHARE } from '../parent-checks.js';
import { wordlessScenes } from '../fill.js';
import { loadPolicy } from '../select.js';

const POLICY = loadPolicy();
const FILMS = (process.argv[2] ?? 'tangled,coco,how-to-train-your-dragon').split(',');
const OUT = outDir();
const BASE = path.join(V8, 'baseline', 'out');
const rj = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const r3 = (x) => (x == null ? null : Math.round(x * 1000) / 1000);
const min = (ms) => r3(ms / 60000);
const R1 = (id) => ['threatens_harm', 'plots_harm'].includes(id) || /_threatens$/.test(id);
const R2 = (id) => id === 'child_frightened';
const ledger = (f) => { try { const l = rj(f); const s = (k) => l.entries.filter((e) => e.kind === k).reduce((a, e) => a + e.usd, 0); return { sonnet: +s('sonnet').toFixed(6), jev: +s('jev').toFixed(6) }; } catch { return { sonnet: 0, jev: 0 }; } };

function allWordless(key, skip) {
  const U = union(skip);
  const rows = key.items.filter((i) => i.mappable && Number.isFinite(i.start_ms) && i.should_flag === true && i.wordless).map((i) => ({ id: i.id, share: r3(shareInside(i.start_ms, i.end_ms, U)) }));
  return { n: rows.length, covered: rows.filter((r) => r.share >= WORDLESS_SHARE).length, missed: rows.filter((r) => r.share < WORDLESS_SHARE).map((r) => `${r.id}:${r.share}`) };
}

function rules12(fullKey, v8Flagged, v8Skip, liveSpans, slug) {
  const auditFalse = new Set((fullKey.audit ?? rj(path.join(TS, 'refs', 'audits.json'))[slug] ?? []).filter((a) => a.rule_applies === false).map((a) => a.id));
  const items = fullKey.items.filter((i) => i.source === 'codex-rules' && i.mappable && Number.isFinite(i.start_ms));
  const clean = (i) => !i.played_for_laughs && !auditFalse.has(i.id);
  const inside = (i, u) => shareInside(i.start_ms, i.end_ms, u) >= 0.5;
  const spansOf = (s) => (s.skip?.spans ?? []).map((x) => [x.start_ms, x.end_ms]);
  const ruleOnly = v8Flagged.filter((s) => s.flag_reasons.length && s.flag_reasons.every((r) => R1(r.id) || R2(r.id)));
  const anyRule = v8Flagged.filter((s) => s.flag_reasons.some((r) => R1(r.id) || R2(r.id)));
  const rowsFor = (list) => list.map((s) => {
    const rule = s.flag_reasons.filter((r) => R1(r.id) || R2(r.id)).every((r) => R1(r.id)) ? 'villain_threat' : s.flag_reasons.filter((r) => R1(r.id) || R2(r.id)).every((r) => R2(r.id)) ? 'child_terrified' : 'both';
    const match = (i) => rule === 'both' || i.marker === rule;
    const sk = union(spansOf(s)); const sc = [[s.start_ms, s.end_ms]];
    const hit = (pool, u) => pool.filter((i) => inside(i, u)).map((i) => i.id);
    return { scene: s.id, rule, reasons: s.flag_reasons.map((r) => r.id), skip_s: Math.round((s.skip?.ms ?? 0) / 1000), matched_in_skip: hit(items.filter(match), sk), matched_in_scene: hit(items.filter(match), sc), clean_matched_in_scene: hit(items.filter((i) => match(i) && clean(i)), sc), any_in_scene: hit(items, sc) };
  });
  const ro = rowsFor(ruleOnly); const ar = rowsFor(anyRule);
  const prec = (rows, k) => ({ hit: rows.filter((r) => r[k].length).length, of: rows.length });
  const skipU = union(v8Skip); const liveU = union(liveSpans);
  const rec = (pool) => ({ n: pool.length, v8_skip: pool.filter((i) => inside(i, skipU)).length, live: pool.filter((i) => inside(i, liveU)).length });
  return {
    codex_rule_items: items.length, clean_items: items.filter(clean).length, audit_rule_false: [...auditFalse],
    v8_rule_only_scenes: ro.length, v8_scenes_with_any_rule_reason: ar.length,
    precision_v8_rule_only: { marker_matched_in_skip: prec(ro, 'matched_in_skip'), marker_matched_in_scene: prec(ro, 'matched_in_scene'), clean_marker_matched_in_scene: prec(ro, 'clean_matched_in_scene'), any_item_in_scene: prec(ro, 'any_in_scene') },
    precision_v8_any_rule_reason: { marker_matched_in_skip: prec(ar, 'matched_in_skip'), marker_matched_in_scene: prec(ar, 'matched_in_scene'), clean_marker_matched_in_scene: prec(ar, 'clean_matched_in_scene') },
    recall: { all: rec(items), clean: rec(items.filter(clean)), villain_threat: rec(items.filter((i) => i.marker === 'villain_threat')), child_terrified: rec(items.filter((i) => i.marker === 'child_terrified')), clean_child: rec(items.filter((i) => clean(i) && i.marker === 'child_terrified')) },
    rule_only_rows: ro,
  };
}

const brief = (s) => ({ recall: `${s.recall_items.found}/${s.recall_items.of}`, moments: `${s.recall_moments.found}/${s.recall_moments.of}`, precision: s.precision_proxy_ref_only, skip_minutes: s.skip_minutes, tag_only_flagged: `${s.tag_only.flagged}/${s.tag_only.items}`, should_flag_false_skipped: `${s.should_not_flag_items_skipped.skipped}/${s.should_not_flag_items_skipped.items}`, villain: `${s.recall_by_policy.villain_threat.found}/${s.recall_by_policy.villain_threat.n}`, child: `${s.recall_by_policy.child_terrified.found}/${s.recall_by_policy.child_terrified.n}` });

const perFilm = [];
const pool = { v8Skip: [], liveSkip: [], items: [], problems: [] };
FILMS.forEach((slug, k) => {
  const off = k * 1e8;
  const fullKey = rj(path.join(TS, 'refs', `${slug}.key.json`));
  const key = { ...fullKey, items: fullKey.items.filter((i) => i.source !== 'codex-rules') }; // human key
  const seg = rj(path.join(OUT, `${slug}.segments.json`));
  const tags = rj(path.join(OUT, `${slug}.tags.r1.json`));
  const reasons = fs.existsSync(path.join(OUT, `${slug}.reasons.r1.json`)) ? rj(path.join(OUT, `${slug}.reasons.r1.json`)) : null;
  const built = rj(path.join(BASE, `${slug}.built.json`));
  const liveScenesRun = rj(path.join(BASE, `${slug}.scenes.json`));
  const cues = parseSrt(fs.readFileSync(path.join(TS, 'data', `${slug}.srt`), 'utf8'));

  const flagged = tags.scenes.filter((s) => s.flagged);
  const v8Skip = flagged.flatMap((s) => (s.skip?.spans ?? []).map((x) => [x.start_ms, x.end_ms]));
  const liveScenes = built.scenes.map((s) => ({ id: s.id.split(':').pop(), start_ms: s.start_ms, end_ms: s.end_ms, description: s.description }));
  const liveSkip = liveScenes.map((s) => [s.start_ms, s.end_ms]);

  const aS = scoreKey(key, v8Skip, { liveDb: liveSkip }); const aG = scoreKey(key, v8Skip, { liveDb: liveSkip, window: 'gap' });
  const bS = scoreKey(key, liveSkip); const bG = scoreKey(key, liveSkip, { window: 'gap' });
  const sens = sensitivity(key, v8Skip, liveSkip);
  const verdict = compareSystems({ aStrict: aS, aGap: aG, bStrict: bS, bGap: bG, sens });

  const wl = wordlessScenes(seg, cues, POLICY);
  const why = reasons ? checkWhy(reasons, flagged.map((s) => s.id)) : null;
  const whyOnTags = flagged.map((s) => ({ id: s.id, source: s.why?.source ?? null, has_text: Boolean(s.why?.text && s.why.text.trim().length > 10) }));
  const parent = {
    v8: {
      i_wordless_peaks_in_flagged: checkWordlessPeaks(key, flagged, v8Skip),
      i_wordless_peaks_all: allWordless(key, v8Skip),
      ii_wordless_scenes: checkWordlessScenes(key, wl, v8Skip),
      iii_why: why,
      iii_why_text_on_every_flagged_scene: `${whyOnTags.filter((x) => x.has_text).length}/${flagged.length}`,
      iii_missing_why: whyOnTags.filter((x) => !x.has_text).map((x) => x.id),
    },
    live: {
      i_wordless_peaks_in_flagged: checkWordlessPeaks(key, liveScenes, liveSkip),
      i_wordless_peaks_all: allWordless(key, liveSkip),
      ii_wordless_scenes: checkWordlessScenes(key, wl, liveSkip),
      iii_description: `${liveScenes.filter((s) => s.description && s.description.trim()).length}/${liveScenes.length} scenes have a Sonnet description; 0 are source-checked (the live pass may use film memory)`,
    },
    wordless_scene_regions: wl.map((w) => `${w.id} ${min(w.start_ms)}-${min(w.end_ms)} min, ${w.dialogue_per_min}/min`),
  };

  const actTags = tags.scenes.flatMap((s) => (s.tags ?? []).filter((t) => t.level === 'act').map((t) => ({ id: t.id, group: t.group })));
  const liveTags = built.labels.filter((l) => l.asserted && l.channel !== 'mention').map((l) => ({ id: l.vocabulary_id, group: null }));
  const dA = dtddAgreement(key, actTags); const dB = dtddAgreement(key, liveTags, { toId: (id) => ITEMS[id]?.v3 ?? id });

  const rules = rules12(fullKey, flagged, v8Skip, liveSkip, slug);

  const attempts = (seg.segmentation_attempts ?? []).map((a) => ({ attempt: a.attempt, mode: a.mode, pass: a.gate?.pass ?? null, failed: a.gate?.failed ?? [], cost_usd: a.cost_usd }));
  const gate = seg.split_check ? `${seg.split_check.pass ? 'PASS' : 'FAIL'} (${seg.split_check.label ?? `attempt ${seg.split_check.attempt}`}); attempts ${attempts.map((a) => `${a.attempt}:${a.mode}:${a.pass ? 'pass' : 'fail'}${a.failed.length ? `[${a.failed.join(',')}]` : ''}`).join(', ')}; aligned ${seg.split_check.jev?.metrics?.aligned_share ?? '-'}, boundary AUC ${seg.split_check.jev?.metrics?.boundary_auc ?? '-'}` : 'no split_check';

  const costV8 = ledger(path.join(OUT, `${slug}.spend.json`));
  const costLive = ledger(path.join(BASE, `${slug}.spend.json`));
  const sentences = seg.scenes.flatMap((s) => s.sentences ?? []);
  perFilm.push({
    slug, title: seg.film?.title ?? slug,
    scenes: { v8: tags.scenes.length, v8_flagged: flagged.length, live: liveScenes.length, live_returned: liveScenesRun.returned_scenes, live_redacted_descriptions: liveScenesRun.redacted_descriptions },
    gate, attempts,
    claim_check: { verified: `${sentences.filter((x) => x.check?.status === 'verified').length}/${sentences.length}`, scenes_with_verified_summary: `${seg.scenes.filter((s) => s.summary).length}/${seg.scenes.length}` },
    key: { human_items: key.items.length, mapped: aS.mapped, should_flag_mapped: aS.recall_items.of, unmappable: aS.unmappable.length },
    v8: { strict: brief(aS), gap: brief(aG) }, live: { strict: brief(bS), gap: brief(bG) },
    verdict, sensitivity: { recall: sens.recall_diff_a_minus_b, precision: sens.precision_diff_a_minus_b, shifts: sens.shifts },
    parent, rules_1_2: rules,
    dtdd: { v8: `${dA.agree}/${dA.scored} (tp ${dA.tp} tn ${dA.tn} fp ${dA.fp} fn ${dA.fn})`, live: `${dB.agree}/${dB.scored} (tp ${dB.tp} tn ${dB.tn} fp ${dB.fp} fn ${dB.fn})` },
    cost_usd: { v8: costV8, live: costLive },
    v8_missed: aS.missed.map((m) => m.id), live_missed: bS.missed.map((m) => m.id),
    flag_reason_counts: flagged.flatMap((s) => s.flag_reasons.map((r) => r.id)).reduce((o, x) => ((o[x] = (o[x] ?? 0) + 1), o), {}),
    film_level_notes: tags.summary?.film_level_notes ?? null,
  });

  // pooled timeline
  const shiftSpan = ([a, b]) => [a + off, b + off];
  pool.v8Skip.push(...v8Skip.map(shiftSpan));
  pool.liveSkip.push(...liveSkip.map(shiftSpan));
  const pid = (id) => `${slug}:${id}`;
  for (const it of key.items) {
    const o = { ...it, id: pid(it.id), same_moment_as: (it.same_moment_as ?? []).map(pid) };
    for (const f of ['start_ms', 'end_ms', 'gap_start_ms', 'gap_end_ms']) if (Number.isFinite(it[f])) o[f] = it[f] + off;
    pool.items.push(o);
  }
});

// ---- pooled ----
const pk = { items: pool.items, film_level: [] };
const PA = scoreKey(pk, pool.v8Skip, { liveDb: pool.liveSkip }); const PAg = scoreKey(pk, pool.v8Skip, { liveDb: pool.liveSkip, window: 'gap' });
const PB = scoreKey(pk, pool.liveSkip); const PBg = scoreKey(pk, pool.liveSkip, { window: 'gap' });
const psens = sensitivity(pk, pool.v8Skip, pool.liveSkip);
const pverdict = compareSystems({ aStrict: PA, aGap: PAg, bStrict: PB, bGap: PBg, sens: psens });
const sumOf = (f) => perFilm.reduce((a, x) => a + f(x), 0);
const ppar = {
  v8: {
    i_in_flagged: `${sumOf((f) => f.parent.v8.i_wordless_peaks_in_flagged.covered)}/${sumOf((f) => f.parent.v8.i_wordless_peaks_in_flagged.n)}`,
    i_all: `${sumOf((f) => f.parent.v8.i_wordless_peaks_all.covered)}/${sumOf((f) => f.parent.v8.i_wordless_peaks_all.n)}`,
    ii: `${sumOf((f) => f.parent.v8.ii_wordless_scenes.found)}/${sumOf((f) => f.parent.v8.ii_wordless_scenes.n)}`,
    iii: `stated ${sumOf((f) => f.parent.v8.iii_why?.stated ?? 0)} + generated ${sumOf((f) => f.parent.v8.iii_why?.generated ?? 0)} of ${sumOf((f) => f.parent.v8.iii_why?.flagged ?? 0)} (unrelated-only ${sumOf((f) => f.parent.v8.iii_why?.unrelated_only ?? 0)}, nothing ${sumOf((f) => f.parent.v8.iii_why?.nothing ?? 0)})`,
  },
  live: {
    i_in_flagged: `${sumOf((f) => f.parent.live.i_wordless_peaks_in_flagged.covered)}/${sumOf((f) => f.parent.live.i_wordless_peaks_in_flagged.n)}`,
    i_all: `${sumOf((f) => f.parent.live.i_wordless_peaks_all.covered)}/${sumOf((f) => f.parent.live.i_wordless_peaks_all.n)}`,
    ii: `${sumOf((f) => f.parent.live.ii_wordless_scenes.found)}/${sumOf((f) => f.parent.live.ii_wordless_scenes.n)}`,
  },
};
const skipA = PA.skip_minutes; const skipB = PB.skip_minutes;
const whyAll = perFilm.every((f) => f.parent.v8.iii_why && f.parent.v8.iii_why.unrelated_only === 0 && f.parent.v8.iii_why.nothing === 0 && f.parent.v8.iii_missing_why.length === 0);
const bar = {
  recall: { v8: pverdict.conservative_recall.a, live: pverdict.conservative_recall.b, of: pverdict.conservative_recall.of, verdict: pverdict.recall, pass: pverdict.conservative_recall.a >= pverdict.conservative_recall.b && pverdict.recall !== 'B' },
  precision: { v8: `${PA.precision_proxy_ref_only}/${PAg.precision_proxy_ref_only}`, live: `${PB.precision_proxy_ref_only}/${PBg.precision_proxy_ref_only}`, verdict: pverdict.precision, pass: pverdict.precision !== 'B' },
  skip_minutes: { v8: skipA, live: skipB, ratio: r3(skipA / skipB), pass: skipA <= 1.15 * skipB },
  wordless_peaks_all: { v8: ppar.v8.i_all, live: ppar.live.i_all, pass: sumOf((f) => f.parent.v8.i_wordless_peaks_all.covered) >= sumOf((f) => f.parent.live.i_wordless_peaks_all.covered) },
  wordless_scenes: { v8: ppar.v8.ii, live: ppar.live.ii, pass: sumOf((f) => f.parent.v8.ii_wordless_scenes.found) >= sumOf((f) => f.parent.live.ii_wordless_scenes.found) },
  why_100: { v8: ppar.v8.iii, pass: whyAll },
};
bar.all_pass = Object.values(bar).every((x) => x.pass);
const result = {
  generated_at: new Date().toISOString(), freeze: freezeStatus(), films: perFilm,
  pooled: { v8: { strict: brief(PA), gap: brief(PAg) }, live: { strict: brief(PB), gap: brief(PBg) }, verdict: pverdict, sensitivity: { recall: psens.recall_diff_a_minus_b, precision: psens.precision_diff_a_minus_b, shifts: psens.shifts }, parent: ppar, bar },
};
fs.writeFileSync(path.join(OUT, 'headtohead.json'), JSON.stringify(result, null, 2));

for (const f of perFilm) {
  console.log(`\n=== ${f.slug}: v8 ${f.scenes.v8} scenes (${f.scenes.v8_flagged} flagged), live ${f.scenes.live} scenes; gate ${f.gate}`);
  console.log(`  key: ${f.key.should_flag_mapped} mapped should_flag of ${f.key.human_items} human items (${f.key.unmappable} unmappable); claim check ${f.claim_check.verified}, verified summary ${f.claim_check.scenes_with_verified_summary}`);
  for (const [n, s] of [['v8 strict', f.v8.strict], ['v8 gap', f.v8.gap], ['live strict', f.live.strict], ['live gap', f.live.gap]]) console.log(`  ${n.padEnd(12)} recall ${s.recall} moments ${s.moments} prec ${s.precision} skip ${s.skip_minutes} tag-only ${s.tag_only_flagged} false-skipped ${s.should_flag_false_skipped}`);
  const v = f.verdict;
  console.log(`  VERDICT recall ${v.recall} precision ${v.precision} overall ${v.overall} (A=v8,B=live); cons ${v.conservative_recall.a} vs ${v.conservative_recall.b}/${v.conservative_recall.of}; jitter recall v8>live ${f.sensitivity.recall.share_a_gt_b} v8<live ${f.sensitivity.recall.share_a_lt_b}; precision v8>live ${f.sensitivity.precision.share_a_gt_b} v8<live ${f.sensitivity.precision.share_a_lt_b}`);
  const p = f.parent;
  console.log(`  (i) in-flagged v8 ${p.v8.i_wordless_peaks_in_flagged.covered}/${p.v8.i_wordless_peaks_in_flagged.n} live ${p.live.i_wordless_peaks_in_flagged.covered}/${p.live.i_wordless_peaks_in_flagged.n}; all-wordless v8 ${p.v8.i_wordless_peaks_all.covered}/${p.v8.i_wordless_peaks_all.n} live ${p.live.i_wordless_peaks_all.covered}/${p.live.i_wordless_peaks_all.n}`);
  console.log(`  (ii) v8 ${p.v8.ii_wordless_scenes.found}/${p.v8.ii_wordless_scenes.n} live ${p.live.ii_wordless_scenes.found}/${p.live.ii_wordless_scenes.n} [regions ${p.wordless_scene_regions.length}]`);
  console.log(`  (iii) v8 stated ${p.v8.iii_why?.stated} generated ${p.v8.iii_why?.generated} unrelated ${p.v8.iii_why?.unrelated_only} nothing ${p.v8.iii_why?.nothing} of ${p.v8.iii_why?.flagged}; why text ${p.v8.iii_why_text_on_every_flagged_scene}; live ${p.live.iii_description}`);
  const r = f.rules_1_2;
  console.log(`  rules1/2: codex items ${r.codex_rule_items} (clean ${r.clean_items}); v8 rule-only ${r.v8_rule_only_scenes}, any-rule ${r.v8_scenes_with_any_rule_reason}; prec rule-only ${JSON.stringify(r.precision_v8_rule_only)}; any-rule ${JSON.stringify(r.precision_v8_any_rule_reason)}; recall ${JSON.stringify(r.recall)}`);
  console.log(`  DTDD v8 ${f.dtdd.v8} live ${f.dtdd.live}; cost ${JSON.stringify(f.cost_usd)}`);
}
const P = result.pooled;
console.log(`\n=== POOLED (${FILMS.join(', ')})`);
for (const [n, s] of [['v8 strict', P.v8.strict], ['v8 gap', P.v8.gap], ['live strict', P.live.strict], ['live gap', P.live.gap]]) console.log(`  ${n.padEnd(12)} recall ${s.recall} moments ${s.moments} prec ${s.precision} skip ${s.skip_minutes} tag-only ${s.tag_only_flagged}`);
console.log(`  VERDICT recall ${P.verdict.recall} precision ${P.verdict.precision} overall ${P.verdict.overall}; jitter recall v8>live ${P.sensitivity.recall.share_a_gt_b} v8<live ${P.sensitivity.recall.share_a_lt_b} p05..p95 ${P.sensitivity.recall.p05}..${P.sensitivity.recall.p95}; precision v8>live ${P.sensitivity.precision.share_a_gt_b} v8<live ${P.sensitivity.precision.share_a_lt_b}`);
console.log(`  parent ${JSON.stringify(P.parent)}`);
console.log(`  BAR ${JSON.stringify(P.bar)}`);
