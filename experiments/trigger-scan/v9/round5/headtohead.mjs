#!/usr/bin/env node
// ROUND 5 (held-out: book-of-life, princess-and-the-frog, moana): a copy of v9/eval/headtohead.mjs (itself
// v8's round-4 scorer, unchanged) with v9 in place of v8, the live outputs read from round5/live/, and
// parent text (iii) read from v9's why (check-describe.js) instead of v8's reasons.js. Scoring functions,
// verdict rule, jitter runs, wordless definitions and rules 1/2 are the round-4 ones, untouched.
// Output: round5/out/headtohead.json. Description quality and the final bar: round5/judge.mjs, round5/bar.mjs.
// Round-4 HEAD-TO-HEAD scoring (not pipeline, not frozen; pure code, no model calls, no network).
// v9 (frozen, run with --final-held-out-run: out/<slug>.*) vs the LIVE pipeline (baseline/run-live.mjs:
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
//   (ii) wordless scenes: key items inside the wordless scenes of v9's segmentation (fill.js
//        wordlessScenes; < 3 dialogue cues/min), found by either system's skip. Same regions for both.
//   (iii) v9: check-describe.js why per flagged scene (whyCheck: sources + no-uncited-memory check).
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
const FILMS = (process.argv[2] ?? 'book-of-life,princess-and-the-frog,moana').split(',');
const OUT = outDir();
const BASE = process.env.R5_BASE ? path.resolve(process.env.R5_BASE) : path.join(V8, 'round5', 'live'); // R5_BASE only to validate this scorer on round-4 films
const R5OUT = path.join(V8, 'round5', 'out');
fs.mkdirSync(R5OUT, { recursive: true });
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

function rules12(fullKey, v9Flagged, v9Skip, liveSpans, slug) {
  const auditFalse = new Set((fullKey.audit ?? rj(path.join(TS, 'refs', 'audits.json'))[slug] ?? []).filter((a) => a.rule_applies === false).map((a) => a.id));
  const items = fullKey.items.filter((i) => i.source === 'codex-rules' && i.mappable && Number.isFinite(i.start_ms));
  const clean = (i) => !i.played_for_laughs && !auditFalse.has(i.id);
  const inside = (i, u) => shareInside(i.start_ms, i.end_ms, u) >= 0.5;
  const spansOf = (s) => (s.skip?.spans ?? []).map((x) => [x.start_ms, x.end_ms]);
  const ruleOnly = v9Flagged.filter((s) => s.flag_reasons.length && s.flag_reasons.every((r) => R1(r.id) || R2(r.id)));
  const anyRule = v9Flagged.filter((s) => s.flag_reasons.some((r) => R1(r.id) || R2(r.id)));
  const rowsFor = (list) => list.map((s) => {
    const rule = s.flag_reasons.filter((r) => R1(r.id) || R2(r.id)).every((r) => R1(r.id)) ? 'villain_threat' : s.flag_reasons.filter((r) => R1(r.id) || R2(r.id)).every((r) => R2(r.id)) ? 'child_terrified' : 'both';
    const match = (i) => rule === 'both' || i.marker === rule;
    const sk = union(spansOf(s)); const sc = [[s.start_ms, s.end_ms]];
    const hit = (pool, u) => pool.filter((i) => inside(i, u)).map((i) => i.id);
    return { scene: s.id, rule, reasons: s.flag_reasons.map((r) => r.id), skip_s: Math.round((s.skip?.ms ?? 0) / 1000), matched_in_skip: hit(items.filter(match), sk), matched_in_scene: hit(items.filter(match), sc), clean_matched_in_scene: hit(items.filter((i) => match(i) && clean(i)), sc), any_in_scene: hit(items, sc) };
  });
  const ro = rowsFor(ruleOnly); const ar = rowsFor(anyRule);
  const prec = (rows, k) => ({ hit: rows.filter((r) => r[k].length).length, of: rows.length });
  const skipU = union(v9Skip); const liveU = union(liveSpans);
  const rec = (pool) => ({ n: pool.length, v9_skip: pool.filter((i) => inside(i, skipU)).length, live: pool.filter((i) => inside(i, liveU)).length });
  return {
    codex_rule_items: items.length, clean_items: items.filter(clean).length, audit_rule_false: [...auditFalse],
    v9_rule_only_scenes: ro.length, v9_scenes_with_any_rule_reason: ar.length,
    precision_v9_rule_only: { marker_matched_in_skip: prec(ro, 'matched_in_skip'), marker_matched_in_scene: prec(ro, 'matched_in_scene'), clean_marker_matched_in_scene: prec(ro, 'clean_matched_in_scene'), any_item_in_scene: prec(ro, 'any_in_scene') },
    precision_v9_any_rule_reason: { marker_matched_in_skip: prec(ar, 'matched_in_skip'), marker_matched_in_scene: prec(ar, 'matched_in_scene'), clean_marker_matched_in_scene: prec(ar, 'clean_matched_in_scene') },
    recall: { all: rec(items), clean: rec(items.filter(clean)), villain_threat: rec(items.filter((i) => i.marker === 'villain_threat')), child_terrified: rec(items.filter((i) => i.marker === 'child_terrified')), clean_child: rec(items.filter((i) => clean(i) && i.marker === 'child_terrified')) },
    rule_only_rows: ro,
  };
}

// v9 parent text (check-describe.js why): source counts, and the NO-UNCITED-MEMORY check: every sentence a
// parent sees is either a Sonnet sentence that cites ids from its own scene's evidence and that Jev verified,
// or the code-built plain reason; every title is a verified cited Sonnet title or a code-built plain title.
function whyCheck(whyRun, flagged) {
  const desc = rj(path.join(OUT, `${whyRun.film?.slug ?? whyRun.film}.describe.r1.json`));
  const out = { flagged: flagged.length, stated: 0, generated: 0, unrelated_only: 0, nothing: 0, described: 0, described_plus_reason: 0, plain_reason: 0, missing: [], shown_sentences: 0, shown_titles_sonnet: 0, uncited_or_unverified: [], mismatched: [] };
  for (const s of flagged) {
    const w = s.why; const run = whyRun.scenes?.[s.id]; const ev = desc.scenes?.[s.id]?.evidence_ids ?? { lines: [], w: [], t: [] };
    const evIds = new Set([...(ev.lines ?? []), ...(ev.w ?? []), ...(ev.t ?? [])]);
    if (!w?.text) { out.nothing++; out.missing.push(s.id); continue; }
    if (w.source === 'described') { out.described++; out.stated++; } else if (w.source === 'described+reason') { out.described_plus_reason++; out.generated++; } else if (w.source === 'plain_reason') { out.plain_reason++; out.generated++; }
    if (!run || run.why?.text !== w.text) out.mismatched.push(s.id);
    const checked = new Map((run?.checked ?? []).map((c) => [c.key, c]));
    const shown = (w.sentences ?? []).map((k) => checked.get(k));
    for (const [k, c] of (w.sentences ?? []).map((k, j) => [k, shown[j]])) {
      out.shown_sentences++;
      if (!c || c.final !== 'verified' || !c.cites?.length || !c.cites.every((x) => evIds.has(x))) out.uncited_or_unverified.push(`${s.id}:${k}`);
    }
    const body = shown.filter(Boolean).map((c) => c.text).join(' ');
    const rest = w.source === 'plain_reason' ? w.text : w.text.slice(body.length).trim();
    if (w.source !== 'plain_reason' && !w.text.startsWith(body)) out.mismatched.push(`${s.id}:body`);
    if (w.source === 'described' ? rest !== '' : !/^Flagged because [^.]+\.$/.test(rest)) out.uncited_or_unverified.push(`${s.id}:extra-text`);
    if (w.title_source === 'sonnet_verified') {
      out.shown_titles_sonnet++;
      const t = checked.get(`${s.id}.title`);
      if (!t || t.final !== 'verified' || t.text !== w.title || !t.cites?.length || !t.cites.every((x) => evIds.has(x))) out.uncited_or_unverified.push(`${s.id}:title`);
    }
  }
  out.parent_text_states_why = `${out.stated + out.generated}/${out.flagged}`;
  return out;
}

const brief = (s) => ({ recall: `${s.recall_items.found}/${s.recall_items.of}`, moments: `${s.recall_moments.found}/${s.recall_moments.of}`, precision: s.precision_proxy_ref_only, skip_minutes: s.skip_minutes, tag_only_flagged: `${s.tag_only.flagged}/${s.tag_only.items}`, should_flag_false_skipped: `${s.should_not_flag_items_skipped.skipped}/${s.should_not_flag_items_skipped.items}`, villain: `${s.recall_by_policy.villain_threat.found}/${s.recall_by_policy.villain_threat.n}`, child: `${s.recall_by_policy.child_terrified.found}/${s.recall_by_policy.child_terrified.n}` });

const perFilm = [];
const pool = { v9Skip: [], liveSkip: [], items: [], problems: [] };
FILMS.forEach((slug, k) => {
  const off = k * 1e8;
  const fullKey = rj(path.join(TS, 'refs', `${slug}.key.json`));
  const key = { ...fullKey, items: fullKey.items.filter((i) => i.source !== 'codex-rules') }; // human key
  const seg = rj(path.join(OUT, `${slug}.segments.json`));
  const tags = rj(path.join(OUT, `${slug}.tags.r1.json`));
  const whyRun = rj(path.join(OUT, `${slug}.why.r1.json`));
  const built = rj(path.join(BASE, `${slug}.built.json`));
  const liveScenesRun = rj(path.join(BASE, `${slug}.scenes.json`));
  const cues = parseSrt(fs.readFileSync(path.join(TS, 'data', `${slug}.srt`), 'utf8'));

  const flagged = tags.scenes.filter((s) => s.flagged);
  const v9Skip = flagged.flatMap((s) => (s.skip?.spans ?? []).map((x) => [x.start_ms, x.end_ms]));
  const liveScenes = built.scenes.map((s) => ({ id: s.id.split(':').pop(), start_ms: s.start_ms, end_ms: s.end_ms, description: s.description }));
  const liveSkip = liveScenes.map((s) => [s.start_ms, s.end_ms]);

  const aS = scoreKey(key, v9Skip, { liveDb: liveSkip }); const aG = scoreKey(key, v9Skip, { liveDb: liveSkip, window: 'gap' });
  const bS = scoreKey(key, liveSkip); const bG = scoreKey(key, liveSkip, { window: 'gap' });
  const sens = sensitivity(key, v9Skip, liveSkip);
  const verdict = compareSystems({ aStrict: aS, aGap: aG, bStrict: bS, bGap: bG, sens });

  const wl = wordlessScenes(seg, cues, POLICY);
  const why = whyCheck(whyRun, flagged);
  const whyOnTags = flagged.map((s) => ({ id: s.id, source: s.why?.source ?? null, has_text: Boolean(s.why?.text && s.why.text.trim().length > 10) }));
  const parent = {
    v9: {
      i_wordless_peaks_in_flagged: checkWordlessPeaks(key, flagged, v9Skip),
      i_wordless_peaks_all: allWordless(key, v9Skip),
      ii_wordless_scenes: checkWordlessScenes(key, wl, v9Skip),
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

  const rules = rules12(fullKey, flagged, v9Skip, liveSkip, slug);

  const attempts = (seg.segmentation_attempts ?? []).map((a) => ({ attempt: a.attempt, mode: a.mode, pass: a.gate?.pass ?? null, failed: a.gate?.failed ?? [], cost_usd: a.cost_usd }));
  const gate = seg.split_check ? `${seg.split_check.pass ? 'PASS' : 'FAIL'} (${seg.split_check.label ?? `attempt ${seg.split_check.attempt}`}); attempts ${attempts.map((a) => `${a.attempt}:${a.mode}:${a.pass ? 'pass' : 'fail'}${a.failed.length ? `[${a.failed.join(',')}]` : ''}`).join(', ')}; aligned ${seg.split_check.jev?.metrics?.aligned_share ?? '-'}, boundary AUC ${seg.split_check.jev?.metrics?.boundary_auc ?? '-'}` : 'no split_check';

  const costV8 = ledger(path.join(OUT, `${slug}.spend.json`));
  const costLive = ledger(path.join(BASE, `${slug}.spend.json`));
  const sentences = seg.scenes.flatMap((s) => s.sentences ?? []);
  perFilm.push({
    slug, title: seg.film?.title ?? slug,
    scenes: { v9: tags.scenes.length, v9_flagged: flagged.length, live: liveScenes.length, live_returned: liveScenesRun.returned_scenes, live_redacted_descriptions: liveScenesRun.redacted_descriptions },
    gate, attempts,
    claim_check: { verified: `${sentences.filter((x) => x.check?.status === 'verified').length}/${sentences.length}`, scenes_with_verified_summary: `${seg.scenes.filter((s) => s.summary).length}/${seg.scenes.length}` },
    key: { human_items: key.items.length, mapped: aS.mapped, should_flag_mapped: aS.recall_items.of, unmappable: aS.unmappable.length },
    v9: { strict: brief(aS), gap: brief(aG) }, live: { strict: brief(bS), gap: brief(bG) },
    verdict, sensitivity: { recall: sens.recall_diff_a_minus_b, precision: sens.precision_diff_a_minus_b, shifts: sens.shifts },
    parent, rules_1_2: rules,
    dtdd: { v9: `${dA.agree}/${dA.scored} (tp ${dA.tp} tn ${dA.tn} fp ${dA.fp} fn ${dA.fn})`, live: `${dB.agree}/${dB.scored} (tp ${dB.tp} tn ${dB.tn} fp ${dB.fp} fn ${dB.fn})` },
    cost_usd: { v9: costV8, live: costLive },
    v9_missed: aS.missed.map((m) => m.id), live_missed: bS.missed.map((m) => m.id),
    flag_reason_counts: flagged.flatMap((s) => s.flag_reasons.map((r) => r.id)).reduce((o, x) => ((o[x] = (o[x] ?? 0) + 1), o), {}),
    film_level_notes: tags.summary?.film_level_notes ?? null,
  });

  // pooled timeline
  const shiftSpan = ([a, b]) => [a + off, b + off];
  pool.v9Skip.push(...v9Skip.map(shiftSpan));
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
const PA = scoreKey(pk, pool.v9Skip, { liveDb: pool.liveSkip }); const PAg = scoreKey(pk, pool.v9Skip, { liveDb: pool.liveSkip, window: 'gap' });
const PB = scoreKey(pk, pool.liveSkip); const PBg = scoreKey(pk, pool.liveSkip, { window: 'gap' });
const psens = sensitivity(pk, pool.v9Skip, pool.liveSkip);
const pverdict = compareSystems({ aStrict: PA, aGap: PAg, bStrict: PB, bGap: PBg, sens: psens });
const sumOf = (f) => perFilm.reduce((a, x) => a + f(x), 0);
const ppar = {
  v9: {
    i_in_flagged: `${sumOf((f) => f.parent.v9.i_wordless_peaks_in_flagged.covered)}/${sumOf((f) => f.parent.v9.i_wordless_peaks_in_flagged.n)}`,
    i_all: `${sumOf((f) => f.parent.v9.i_wordless_peaks_all.covered)}/${sumOf((f) => f.parent.v9.i_wordless_peaks_all.n)}`,
    ii: `${sumOf((f) => f.parent.v9.ii_wordless_scenes.found)}/${sumOf((f) => f.parent.v9.ii_wordless_scenes.n)}`,
    iii: `stated ${sumOf((f) => f.parent.v9.iii_why?.stated ?? 0)} + generated ${sumOf((f) => f.parent.v9.iii_why?.generated ?? 0)} of ${sumOf((f) => f.parent.v9.iii_why?.flagged ?? 0)} (unrelated-only ${sumOf((f) => f.parent.v9.iii_why?.unrelated_only ?? 0)}, nothing ${sumOf((f) => f.parent.v9.iii_why?.nothing ?? 0)}); described ${sumOf((f) => f.parent.v9.iii_why.described)}, described+reason ${sumOf((f) => f.parent.v9.iii_why.described_plus_reason)}, plain_reason ${sumOf((f) => f.parent.v9.iii_why.plain_reason)}; shown Sonnet sentences ${sumOf((f) => f.parent.v9.iii_why.shown_sentences)}, shown Sonnet titles ${sumOf((f) => f.parent.v9.iii_why.shown_titles_sonnet)}; uncited/unverified ${sumOf((f) => f.parent.v9.iii_why.uncited_or_unverified.length)}; mismatched ${sumOf((f) => f.parent.v9.iii_why.mismatched.length)}`,
  },
  live: {
    i_in_flagged: `${sumOf((f) => f.parent.live.i_wordless_peaks_in_flagged.covered)}/${sumOf((f) => f.parent.live.i_wordless_peaks_in_flagged.n)}`,
    i_all: `${sumOf((f) => f.parent.live.i_wordless_peaks_all.covered)}/${sumOf((f) => f.parent.live.i_wordless_peaks_all.n)}`,
    ii: `${sumOf((f) => f.parent.live.ii_wordless_scenes.found)}/${sumOf((f) => f.parent.live.ii_wordless_scenes.n)}`,
  },
};
const skipA = PA.skip_minutes; const skipB = PB.skip_minutes;
const whyAll = perFilm.every((f) => f.parent.v9.iii_why && f.parent.v9.iii_why.unrelated_only === 0 && f.parent.v9.iii_why.nothing === 0 && f.parent.v9.iii_missing_why.length === 0);
const bar = {
  recall: { v9: pverdict.conservative_recall.a, live: pverdict.conservative_recall.b, of: pverdict.conservative_recall.of, verdict: pverdict.recall, pass: pverdict.conservative_recall.a >= pverdict.conservative_recall.b && pverdict.recall !== 'B' },
  precision: { v9: `${PA.precision_proxy_ref_only}/${PAg.precision_proxy_ref_only}`, live: `${PB.precision_proxy_ref_only}/${PBg.precision_proxy_ref_only}`, verdict: pverdict.precision, pass: pverdict.precision !== 'B' },
  skip_minutes: { v9: skipA, live: skipB, ratio: r3(skipA / skipB), pass: skipA <= 1.15 * skipB },
  wordless_peaks_all: { v9: ppar.v9.i_all, live: ppar.live.i_all, pass: sumOf((f) => f.parent.v9.i_wordless_peaks_all.covered) >= sumOf((f) => f.parent.live.i_wordless_peaks_all.covered) },
  wordless_scenes: { v9: ppar.v9.ii, live: ppar.live.ii, pass: sumOf((f) => f.parent.v9.ii_wordless_scenes.found) >= sumOf((f) => f.parent.live.ii_wordless_scenes.found) },
  why_100: { v9: ppar.v9.iii, pass: whyAll },
};
bar.all_pass = Object.values(bar).every((x) => x.pass);
const result = {
  generated_at: new Date().toISOString(), freeze: freezeStatus(), films: perFilm,
  pooled: { v9: { strict: brief(PA), gap: brief(PAg) }, live: { strict: brief(PB), gap: brief(PBg) }, verdict: pverdict, sensitivity: { recall: psens.recall_diff_a_minus_b, precision: psens.precision_diff_a_minus_b, shifts: psens.shifts }, parent: ppar, bar },
};
fs.writeFileSync(path.join(R5OUT, process.env.R5_NAME ?? 'headtohead.json'), JSON.stringify(result, null, 2));

for (const f of perFilm) {
  console.log(`\n=== ${f.slug}: v9 ${f.scenes.v9} scenes (${f.scenes.v9_flagged} flagged), live ${f.scenes.live} scenes; gate ${f.gate}`);
  console.log(`  key: ${f.key.should_flag_mapped} mapped should_flag of ${f.key.human_items} human items (${f.key.unmappable} unmappable); claim check ${f.claim_check.verified}, verified summary ${f.claim_check.scenes_with_verified_summary}`);
  for (const [n, s] of [['v9 strict', f.v9.strict], ['v9 gap', f.v9.gap], ['live strict', f.live.strict], ['live gap', f.live.gap]]) console.log(`  ${n.padEnd(12)} recall ${s.recall} moments ${s.moments} prec ${s.precision} skip ${s.skip_minutes} tag-only ${s.tag_only_flagged} false-skipped ${s.should_flag_false_skipped}`);
  const v = f.verdict;
  console.log(`  VERDICT recall ${v.recall} precision ${v.precision} overall ${v.overall} (A=v9,B=live); cons ${v.conservative_recall.a} vs ${v.conservative_recall.b}/${v.conservative_recall.of}; jitter recall v9>live ${f.sensitivity.recall.share_a_gt_b} v9<live ${f.sensitivity.recall.share_a_lt_b}; precision v9>live ${f.sensitivity.precision.share_a_gt_b} v9<live ${f.sensitivity.precision.share_a_lt_b}`);
  const p = f.parent;
  console.log(`  (i) in-flagged v9 ${p.v9.i_wordless_peaks_in_flagged.covered}/${p.v9.i_wordless_peaks_in_flagged.n} live ${p.live.i_wordless_peaks_in_flagged.covered}/${p.live.i_wordless_peaks_in_flagged.n}; all-wordless v9 ${p.v9.i_wordless_peaks_all.covered}/${p.v9.i_wordless_peaks_all.n} live ${p.live.i_wordless_peaks_all.covered}/${p.live.i_wordless_peaks_all.n}`);
  console.log(`  (ii) v9 ${p.v9.ii_wordless_scenes.found}/${p.v9.ii_wordless_scenes.n} live ${p.live.ii_wordless_scenes.found}/${p.live.ii_wordless_scenes.n} [regions ${p.wordless_scene_regions.length}]`);
  console.log(`  (iii) v9 stated ${p.v9.iii_why?.stated} generated ${p.v9.iii_why?.generated} unrelated ${p.v9.iii_why?.unrelated_only} nothing ${p.v9.iii_why?.nothing} of ${p.v9.iii_why?.flagged}; why text ${p.v9.iii_why_text_on_every_flagged_scene}; live ${p.live.iii_description}`);
  const r = f.rules_1_2;
  console.log(`  rules1/2: codex items ${r.codex_rule_items} (clean ${r.clean_items}); v9 rule-only ${r.v9_rule_only_scenes}, any-rule ${r.v9_scenes_with_any_rule_reason}; prec rule-only ${JSON.stringify(r.precision_v9_rule_only)}; any-rule ${JSON.stringify(r.precision_v9_any_rule_reason)}; recall ${JSON.stringify(r.recall)}`);
  console.log(`  DTDD v9 ${f.dtdd.v9} live ${f.dtdd.live}; cost ${JSON.stringify(f.cost_usd)}`);
}
const P = result.pooled;
console.log(`\n=== POOLED (${FILMS.join(', ')})`);
for (const [n, s] of [['v9 strict', P.v9.strict], ['v9 gap', P.v9.gap], ['live strict', P.live.strict], ['live gap', P.live.gap]]) console.log(`  ${n.padEnd(12)} recall ${s.recall} moments ${s.moments} prec ${s.precision} skip ${s.skip_minutes} tag-only ${s.tag_only_flagged}`);
console.log(`  VERDICT recall ${P.verdict.recall} precision ${P.verdict.precision} overall ${P.verdict.overall}; jitter recall v9>live ${P.sensitivity.recall.share_a_gt_b} v9<live ${P.sensitivity.recall.share_a_lt_b} p05..p95 ${P.sensitivity.recall.p05}..${P.sensitivity.recall.p95}; precision v9>live ${P.sensitivity.precision.share_a_gt_b} v9<live ${P.sensitivity.precision.share_a_lt_b}`);
console.log(`  parent ${JSON.stringify(P.parent)}`);
console.log(`  BAR ${JSON.stringify(P.bar)}`);
