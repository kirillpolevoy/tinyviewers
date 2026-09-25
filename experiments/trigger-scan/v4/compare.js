#!/usr/bin/env node
// v4 vs the live database baseline, plus (secondarily) the Claude-drafted, UNREVIEWED gold lists.
// Pure code: no model calls, no network, no database.
//
//   node compare.js [--films nemo,monsters-inc] [--runs r1,r2] [--max-items 60]
//
// BASELINE = exactly what scene-api/load.js loads for the film (imported read-only; nothing in
// scene-api is written): the Sonnet scene file (scenes.nemo.grounded.json / runs-v3/sonnet-alone-
// <slug>.json) mapped to v3 events, plus the ASSERTED presence of runs-v3/sonnet-presence-<slug>.json.
// The Jev beat "second opinion" rows the loader also builds are never asserted and are ignored here.
//
// V4 = out/<slug>.tags.<run>.json (select.js). A v4 scene's tags = its ACT-level tags (what would be
// shown as a tag); flagged = select.js's `flagged`.
//
// Definitions (all printed into summary.json under `definitions`):
//   material overlap  time overlap >= min(10 s, half the shorter scene)
//   covered           a baseline scene is covered when >= 50% of its duration lies inside flagged
//                     v4 scenes, each v4 scene extended to the next scene's start (the silent gap
//                     after a scene's last cue belongs to it; the contract's end_ms stops at the cue)
//   outside           a flagged v4 scene with zero time overlap with every baseline scene
//   tag agreement     per covered baseline scene: baseline tag set vs the union of ACT tags of the
//                     flagged v4 scenes with a material overlap. Baseline = reference. Micro P/R/F1
//                     over pooled pairs, plus mean Jaccard. Item level = v3 ids (v4's parent tag
//                     animal_creature has no v3 id and is left out at item level); group = 13 groups.
// Writes out/summary.json (numbers) and review/disagreements.json (git-ignored; cue ranges and ids,
// no subtitle text).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSrt, formatTime } from '../srt.js';
import { scoreFilm, summariseGrid, unionIntervals, totalLength, intersectLength } from '../score.js';
import * as T3 from '../taxonomy-v3.js';
import * as T2 from '../taxonomy-v2.js';
import { CATEGORY_IDS } from '../taxonomy.js';
import * as L from '../../../scene-api/load.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const TS = path.resolve(here, '..');
const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const FILMS = opt('films', 'nemo,monsters-inc').split(',');
const [RA, RB] = opt('runs', 'r1,r2').split(',');
const MAX_ITEMS = Number(opt('max-items', 60));
const PHASE_CAP_USD = 0.75;

const r3 = (x) => (x == null ? null : Math.round(x * 1000) / 1000);
const pct = (x) => (x == null ? null : Math.round(x * 1000) / 10);
const cueNum = (c) => (typeof c === 'number' ? c : Number(String(c).replace(/^C0*/, '')));
const overlap = (a0, a1, b0, b1) => Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));
const material = (a0, a1, b0, b1) => overlap(a0, a1, b0, b1) >= Math.min(10_000, 0.5 * Math.min(a1 - a0, b1 - b0)) && overlap(a0, a1, b0, b1) > 0;
const readJson = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const hms = (ms) => formatTime(ms);

function prf(tp, fp, fn) {
  const p = tp + fp ? tp / (tp + fp) : null;
  const r = tp + fn ? tp / (tp + fn) : null;
  const f = p != null && r != null && p + r > 0 ? (2 * p * r) / (p + r) : p == null && r == null ? null : 0;
  return { tp, fp, fn, precision: r3(p), recall: r3(r), f1: r3(f) };
}
const jaccard = (a, b) => { const u = new Set([...a, ...b]); if (!u.size) return 1; let i = 0; for (const x of a) if (b.has(x)) i++; return i / u.size; };

// ---- label space mappings ----------------------------------------------------------------------
const V3 = T3.BY_ID;
const groupOfV3 = (id) => V3[id]?.group ?? null;
const V2_GROUP = Object.fromEntries(T2.ATTRIBUTES.map((a) => [a.id, a.group]));
const V2_LEGACY = Object.fromEntries(T2.ATTRIBUTES.map((a) => [a.id, a.legacy]));
const V2_GROUP_IDS = Object.keys(T2.GROUPS).filter((g) => T2.ATTRIBUTES.some((a) => a.group === g));
// v3 id -> v2 attribute ids (taxonomy-v3 `v2` arrays; plus the loader's two temporary v2 ids under `dies`)
const v2Of = (v3id) => [...(V3[v3id]?.v2 ?? []), ...(v3id === 'dies' ? Object.keys(L.TEMPORARY_V2_MAPPING) : [])];
const toV2Groups = (v3ids) => new Set([...v3ids].flatMap((id) => v2Of(id).map((a) => V2_GROUP[a])).filter(Boolean));
const toLegacy = (v3ids) => new Set([...v3ids].flatMap((id) => v2Of(id).map((a) => V2_LEGACY[a])).filter(Boolean));

// ---- baseline via the loader (read-only) ---------------------------------------------------------
const ctx = await L.openExperiment(TS);
const v2map = L.buildV2Map(ctx.taxonomy);
const vocabIds = new Set(L.buildVocabulary(ctx.taxonomy).items.map((i) => i.id));

function baselineFor(slug) {
  const inputs = L.readFilmInputs(slug, ctx);
  const built = L.buildFilmFrom(inputs, { srt: ctx.srt, v2map, vocabIds });
  const scenes = built.scenes.map((s) => {
    const labels = built.labels.filter((l) => l.scene_id === s.id && l.asserted);
    const tags = labels.filter((l) => l.channel !== 'mention').map((l) => ({ id: l.vocabulary_id, channel: l.channel, source: l.channel === 'presence' ? l.confidence_kind : 'labeller' }));
    return {
      id: s.id.split(':').pop(), title: s.title, start_ms: s.start_ms, end_ms: s.end_ms,
      start_cue: cueNum(s.start_cue), end_cue: cueNum(s.end_cue),
      severity: { '5-7': s.severity_5_7, '8-10': s.severity_8_10 },
      tags, items: new Set(tags.map((t) => t.id)), groups: new Set(tags.map((t) => groupOfV3(t.id)).filter(Boolean)),
      mentions: labels.filter((l) => l.channel === 'mention').map((l) => l.vocabulary_id),
    };
  });
  return {
    files: { scenes: inputs.sceneSourceFile, presence: inputs.presenceSourceFile },
    cost_usd: { scenes: inputs.sceneRun.cost_usd ?? inputs.sceneRun.analysis_run?.cost_usd ?? null, presence: inputs.presenceRun?.cost_usd ?? null },
    wall_s: { scenes: inputs.sceneRun.wall_s ?? null, presence: inputs.presenceRun?.wall_s ?? null },
    scenes,
  };
}

// ---- v4 ------------------------------------------------------------------------------------------
function v4For(slug, run) {
  const seg = readJson(path.join(here, 'out', `${slug}.segments.json`));
  const tags = readJson(path.join(here, 'out', `${slug}.tags.${run}.json`));
  const jev = readJson(path.join(here, 'out', `${slug}.jev.${run}.json`));
  const segById = new Map(seg.scenes.map((s) => [s.id, s]));
  const scenes = tags.scenes.map((s, i) => {
    const next = tags.scenes[i + 1];
    const act = s.tags.filter((t) => t.level === 'act');
    return {
      id: s.id, start_ms: s.start_ms, end_ms: s.end_ms, ext_end_ms: next ? next.start_ms : s.end_ms,
      start_cue: s.start_cue, end_cue: s.end_cue, flagged: s.flagged, flag_reasons: s.flag_reasons ?? [],
      act, all: s.tags, severity: s.severity, mentioned_only: s.mentioned_only ?? [], unclassified: s.unclassified ?? null,
      items: new Set(act.map((t) => t.v3).filter(Boolean)),
      groups: new Set(act.map((t) => t.group)),
      summary: segById.get(s.id)?.summary ?? null, setting: segById.get(s.id)?.setting ?? null, known_from_film: segById.get(s.id)?.known_from_film ?? null,
    };
  });
  return { seg, tags, jev, scenes };
}

// ---- per film ------------------------------------------------------------------------------------
const disagreements = [];
const perFilm = [];
const problems = [];

for (const slug of FILMS) {
  const base = baselineFor(slug);
  const A = v4For(slug, RA);
  const B = v4For(slug, RB);
  const cues = parseSrt(fs.readFileSync(path.join(TS, 'data', `${slug}.srt`), 'utf8'));
  const filmEndMs = cues[cues.length - 1].endMs;

  const flagged = A.scenes.filter((s) => s.flagged);
  const flaggedExtU = unionIntervals(flagged.map((s) => ({ startMs: s.start_ms, endMs: s.ext_end_ms })));
  const flaggedU = unionIntervals(flagged.map((s) => ({ startMs: s.start_ms, endMs: s.end_ms })));
  const baseU = unionIntervals(base.scenes.map((s) => ({ startMs: s.start_ms, endMs: s.end_ms })));

  // coverage of baseline scenes by flagged v4 scenes
  const baseRows = base.scenes.map((b) => {
    const cov = intersectLength(flaggedExtU, [[b.start_ms, b.end_ms]]) / Math.max(1, b.end_ms - b.start_ms);
    const mat = flagged.filter((v) => material(v.start_ms, v.ext_end_ms, b.start_ms, b.end_ms));
    const touching = A.scenes.filter((v) => overlap(v.start_ms, v.ext_end_ms, b.start_ms, b.end_ms) > 0);
    return { b, cov, mat, touching };
  });
  const covered = baseRows.filter((r) => r.cov >= 0.5);

  // flagged v4 scenes vs baseline
  const v4Rows = flagged.map((v) => {
    const inside = intersectLength(baseU, [[v.start_ms, v.end_ms]]) / Math.max(1, v.end_ms - v.start_ms);
    const touching = base.scenes.filter((b) => overlap(v.start_ms, v.end_ms, b.start_ms, b.end_ms) > 0);
    return { v, inside, touching };
  });
  const outside = v4Rows.filter((r) => r.touching.length === 0);

  // tag agreement on covered baseline scenes
  const agg = { item: { tp: 0, fp: 0, fn: 0, j: [] }, group: { tp: 0, fp: 0, fn: 0, j: [] } };
  const srcSplit = { v4_presence_all: {}, v4_presence_matched: {}, v4_presence_unmatched: {}, baseline_presence: {}, baseline_presence_found: {} };
  const inc = (o, k) => { o[k] = (o[k] ?? 0) + 1; };
  const pairRows = [];
  for (const r of covered) {
    const vs = r.mat.length ? r.mat : [];
    const vItems = new Set(vs.flatMap((v) => [...v.items]));
    const vGroups = new Set(vs.flatMap((v) => [...v.groups]));
    for (const [lvl, bs, vset] of [['item', r.b.items, vItems], ['group', r.b.groups, vGroups]]) {
      let tp = 0; for (const x of vset) if (bs.has(x)) tp++;
      agg[lvl].tp += tp; agg[lvl].fp += vset.size - tp; agg[lvl].fn += bs.size - tp; agg[lvl].j.push(jaccard(bs, vset));
    }
    // presence source split (v4 act presence tags on the contributing scenes, deduped per v3 id; source = strongest)
    const pres = new Map();
    for (const v of vs) for (const t of v.act) if (t.layer === 'presence' && t.v3) {
      const prev = pres.get(t.v3);
      pres.set(t.v3, prev && prev !== t.source ? 'both' : t.source);
    }
    for (const [id, src] of pres) { inc(srcSplit.v4_presence_all, src); inc(r.b.items.has(id) ? srcSplit.v4_presence_matched : srcSplit.v4_presence_unmatched, src); }
    for (const t of r.b.tags) if (t.channel === 'presence') { inc(srcSplit.baseline_presence, t.source); if (vItems.has(t.id)) inc(srcSplit.baseline_presence_found, t.source); }
    pairRows.push({ r, vItems, vGroups });
  }
  const agreement = {
    reference: 'baseline (the live database tags); v4 = union of ACT tags of flagged v4 scenes with a material overlap',
    covered_baseline_scenes: covered.length,
    item_v3: { ...prf(agg.item.tp, agg.item.fp, agg.item.fn), mean_jaccard: r3(agg.item.j.reduce((a, b) => a + b, 0) / (agg.item.j.length || 1)) },
    group_13: { ...prf(agg.group.tp, agg.group.fp, agg.group.fn), mean_jaccard: r3(agg.group.j.reduce((a, b) => a + b, 0) / (agg.group.j.length || 1)) },
    presence_source_split: srcSplit,
  };

  // per-item FN/FP counts at item level, to see what drives disagreement
  const itemFN = {}; const itemFP = {};
  for (const { r, vItems } of pairRows) {
    for (const x of r.b.items) if (!vItems.has(x)) inc(itemFN, x);
    for (const x of vItems) if (!r.b.items.has(x)) inc(itemFP, x);
  }
  const top = (o, n = 8) => Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, v]) => `${k} ${v}`);

  // flag reasons (what drives the flag)
  const reasonCount = {};
  for (const v of flagged) for (const id of v.flag_reasons) inc(reasonCount, id);
  const presenceOnly = flagged.filter((v) => v.flag_reasons.every((id) => v.act.find((t) => t.id === id)?.layer === 'presence'));

  // ---- stability A vs B ------------------------------------------------------------------------
  const bById = new Map(B.scenes.map((s) => [s.id, s]));
  let flagFlips = 0; let tagFlips = 0; let tagUnion = 0; let groupFlips = 0; let groupUnion = 0;
  const flipIds = [];
  for (const a of A.scenes) {
    const b = bById.get(a.id);
    if (!b) continue;
    if (a.flagged !== b.flagged) { flagFlips++; flipIds.push(a.id); }
    const ta = new Set(a.act.map((t) => t.id)); const tb = new Set(b.act.map((t) => t.id));
    const u = new Set([...ta, ...tb]); tagUnion += u.size; for (const x of u) if (ta.has(x) !== tb.has(x)) tagFlips++;
    const ga = a.groups; const gb = b.groups; const gu = new Set([...ga, ...gb]); groupUnion += gu.size; for (const x of gu) if (ga.has(x) !== gb.has(x)) groupFlips++;
  }
  // raw probability drift
  let maxDiff = 0; let sumDiff = 0; let nDiff = 0; let crossings = 0;
  const jB = new Map(B.jev.scenes.map((s) => [s.id, s]));
  for (const sa of A.jev.scenes) {
    const sb = jB.get(sa.id);
    if (!sa.answers || !sb?.answers) continue;
    for (const ch of ['pl', 'ps', 'm', 'e', 'mod']) for (const [k, p] of Object.entries(sa.answers[ch] ?? {})) {
      const q = sb.answers[ch]?.[k]; if (q == null) continue;
      const d = Math.abs(p - q); maxDiff = Math.max(maxDiff, d); sumDiff += d; nDiff++;
      if ((p >= 0.7) !== (q >= 0.7)) crossings++;
    }
  }
  const stability = {
    runs: [RA, RB], flagged: [flagged.length, B.scenes.filter((s) => s.flagged).length],
    flag_flips: flagFlips, flag_flip_scenes: flipIds,
    act_tag_flips: tagFlips, act_tag_union: tagUnion, group_flips: groupFlips, group_union: groupUnion,
    noul_abs_diff: { mean: r3(sumDiff / (nDiff || 1)), max: r3(maxDiff), n: nDiff, crossings_of_0_70: crossings },
  };

  // ---- cost & wall -----------------------------------------------------------------------------
  const cost = {
    segment_sonnet: A.seg.cost_usd, classify_jev_r1: A.jev.cost_usd, classify_jev_r2: B.jev.cost_usd, select: 0,
    v4_one_pass_total: r3(A.seg.cost_usd + A.jev.cost_usd), baseline_scenes: base.cost_usd.scenes, baseline_presence: base.cost_usd.presence,
  };
  const wall = {
    segment_sonnet: r3(A.seg.wall_ms / 1000), classify_jev_r1: r3(A.jev.wall_ms / 1000), classify_jev_r2: r3(B.jev.wall_ms / 1000), select: 'pure code (<1 s)',
    baseline_scenes: base.wall_s.scenes, baseline_presence: base.wall_s.presence,
  };

  // ---- secondary: unreviewed gold ----------------------------------------------------------------
  let gold = null;
  const cueByNum = new Map(cues.map((c) => [c.index, c]));
  const v4Preds = flagged.map((v) => ({ startMs: v.start_ms, endMs: v.end_ms, v3: v.items, severity: { '5-7': v.severity['5-7'].level, '8-10': v.severity['8-10'].level } }));
  const basePreds = base.scenes.map((b) => ({ startMs: b.start_ms, endMs: b.end_ms, v3: b.items, severity: b.severity }));
  const summarise = (res, labelIds) => {
    const any = summariseGrid(res.anyGrid[0].perLabel, ['any']).micro;
    const lab = summariseGrid(res.grid[0].perLabel, labelIds);
    const det = res.detection['0.5'];
    return {
      any_f1: pct(any.f1), any_precision: pct(any.precision), any_recall: pct(any.recall),
      label_micro_f1: pct(lab.micro.f1), label_micro_precision: pct(lab.micro.precision), label_micro_recall: pct(lab.micro.recall), label_macro_f1: pct(lab.macro.f1),
      found_c050: `${det.found}/${det.refs}`, serious_found_c050: `${det.seriousFound}/${det.seriousRefs}`,
      controls_hit_gt0s: `${res.controls['0'].hit}/${res.controls['0'].total}`,
      flagged_min: r3(res.overreach.asGiven.flaggedMs / 60000), share_flagged_inside_ref: pct(res.overreach.asGiven.insideRefMs / Math.max(1, res.overreach.asGiven.flaggedMs)),
    };
  };
  if (slug === 'nemo') {
    const g = readJson(path.join(TS, 'gold.json')).map((x) => ({ ...x, startMs: cueByNum.get(cueNum(x.start_cue)).startMs, endMs: cueByNum.get(cueNum(x.end_cue)).endMs, labels: new Set(x.categories) }));
    const ref = g.filter((x) => !x.control); const controls = g.filter((x) => x.control);
    const score = (preds) => scoreFilm({ film: slug, filmEndMs, labelIds: CATEGORY_IDS, reference: ref, controls, predictions: preds.map((p) => ({ ...p, labels: toLegacy(p.v3), severity: Math.max(p.severity['5-7'] ?? 0, p.severity['8-10'] ?? 0) })), options: { toleranceS: [0] } });
    const b = unionIntervals(ref); const share = totalLength(b) / filmEndMs;
    gold = { reference: 'gold.json — Claude-drafted, NOT human-reviewed (unreviewed reference)', label_space: 'legacy 12 categories (v3 -> v2 -> legacy)', ref_scenes: ref.length, controls: controls.length, flag_everything_any_f1_floor: pct((2 * share) / (1 + share)), v4: summarise(score(v4Preds), CATEGORY_IDS), baseline: summarise(score(basePreds), CATEGORY_IDS) };
  } else if (fs.existsSync(path.join(TS, 'gold', `${slug}.json`))) {
    const g = readJson(path.join(TS, 'gold', `${slug}.json`)).map((x) => ({ ...x, startMs: cueByNum.get(cueNum(x.start_cue)).startMs, endMs: cueByNum.get(cueNum(x.end_cue)).endMs, labels: new Set(x.attributes.map((a) => V2_GROUP[a]).filter(Boolean)), severity: { '5-7': x.severity_5_7, '8-10': x.severity_8_10 } }));
    const ref = g.filter((x) => !x.control); const controls = g.filter((x) => x.control);
    const score = (preds) => scoreFilm({ film: slug, filmEndMs, labelIds: V2_GROUP_IDS, reference: ref, controls, predictions: preds.map((p) => ({ ...p, labels: toV2Groups(p.v3) })), options: { toleranceS: [0] } });
    const b = unionIntervals(ref); const share = totalLength(b) / filmEndMs;
    gold = { reference: `gold/${slug}.json — Claude-drafted, NOT human-reviewed (unreviewed reference)`, label_space: `${V2_GROUP_IDS.length} v2 groups (v3 -> v2 attribute -> v2 group), the rescore.js group grain`, ref_scenes: ref.length, controls: controls.length, flag_everything_any_f1_floor: pct((2 * share) / (1 + share)), v4: summarise(score(v4Preds), V2_GROUP_IDS), baseline: summarise(score(basePreds), V2_GROUP_IDS) };
  }

  // ---- disagreements ---------------------------------------------------------------------------
  const tagView = (t) => ({ id: t.id, v3: t.v3 ?? null, group: t.group, level: t.level, p: t.p, source: t.source, ...(t.from_film_knowledge ? { from_film_knowledge: true } : {}) });
  const v4View = (v) => ({
    id: v.id, start_ms: v.start_ms, end_ms: v.end_ms, start: hms(v.start_ms), end: hms(v.end_ms), start_cue: v.start_cue, end_cue: v.end_cue,
    flagged: v.flagged, flag_reasons: v.flag_reasons, severity: { '5-7': v.severity?.['5-7']?.level ?? null, '8-10': v.severity?.['8-10']?.level ?? null },
    top_tags: [...v.act, ...v.all.filter((t) => t.level === 'possible')].slice(0, 10).map(tagView),
    summary: v.summary, setting: v.setting, known_from_film: v.known_from_film,
  });
  const baseView = (b) => ({ id: b.id, title: b.title, start: hms(b.start_ms), end: hms(b.end_ms), start_cue: b.start_cue, end_cue: b.end_cue, severity: b.severity, tags: b.tags, groups: [...b.groups] });
  const maxSev = (v) => Math.max(v.severity?.['5-7']?.level ?? 0, v.severity?.['8-10']?.level ?? 0);
  const ctxRange = (list) => ({ start_cue: Math.min(...list.map((x) => x.start_cue)), end_cue: Math.max(...list.map((x) => x.end_cue)) });

  for (const r of v4Rows.filter((x) => x.inside < 0.5)) {
    const v = r.v;
    const hasEvent = v.flag_reasons.some((id) => v.act.find((t) => t.id === id)?.layer === 'event');
    disagreements.push({
      film: slug, kind: 'a_v4_flag_not_in_baseline', v4: v4View(v), v4_share_inside_baseline: r3(r.inside),
      baseline: r.touching.map(baseView), context: ctxRange([v, ...r.touching]),
      _rank: maxSev(v) + (hasEvent ? 1 : 0) + Math.max(0, ...v.act.map((t) => t.p)), _sig: `${slug}|${[...v.flag_reasons].sort().join(',')}`,
    });
  }
  for (const r of baseRows.filter((x) => x.cov < 0.5)) {
    const b = r.b;
    disagreements.push({
      film: slug, kind: 'b_baseline_not_flagged_by_v4', baseline: baseView(b), v4_coverage_of_baseline: r3(r.cov),
      v4: r.touching.map(v4View), context: ctxRange([b, ...r.touching]),
      _rank: 10 + Math.max(b.severity['5-7'] ?? 0, b.severity['8-10'] ?? 0) + b.items.size / 10, _sig: `${slug}|b|${b.id}`,
    });
  }
  for (const { r, vGroups } of pairRows) {
    const b = r.b;
    const same = b.groups.size === vGroups.size && [...b.groups].every((g) => vGroups.has(g));
    if (same) continue;
    const missing = [...b.groups].filter((g) => !vGroups.has(g));
    const extra = [...vGroups].filter((g) => !b.groups.has(g));
    disagreements.push({
      film: slug, kind: 'c_group_tags_differ', baseline: baseView(b), v4: r.mat.map(v4View), v4_coverage_of_baseline: r3(r.cov),
      groups_only_baseline: missing, groups_only_v4: extra, context: ctxRange([b, ...r.mat]),
      _rank: missing.length * 1.5 + extra.length * 0.5 + Math.max(b.severity['5-7'] ?? 0, b.severity['8-10'] ?? 0), _sig: `${slug}|c|${b.id}`,
    });
  }

  const flaggedMinV4 = totalLength(flaggedU) / 60000;
  perFilm.push({
    slug,
    title: A.seg.film.title,
    baseline_files: base.files,
    scenes_total: A.scenes.length,
    scenes_flagged_v4: flagged.length,
    scenes_flagged_v4_r2: B.scenes.filter((s) => s.flagged).length,
    baseline_scenes: base.scenes.length,
    baseline_scenes_covered_by_v4_flags: covered.length,
    baseline_scenes_not_covered: baseRows.filter((r) => r.cov < 0.5).map((r) => r.b.id),
    v4_flags_outside_baseline: outside.length,
    v4_flags_mostly_outside_baseline: v4Rows.filter((r) => r.inside < 0.5).length,
    flagged_minutes_v4: r3(flaggedMinV4),
    flagged_minutes_v4_extended: r3(totalLength(flaggedExtU) / 60000),
    flagged_minutes_baseline: r3(totalLength(baseU) / 60000),
    film_minutes: r3(filmEndMs / 60000),
    flag_reason_counts: Object.fromEntries(Object.entries(reasonCount).sort((a, b) => b[1] - a[1])),
    flagged_by_presence_only: presenceOnly.length,
    tag_agreement: agreement,
    item_misses_top: top(itemFN), item_extras_top: top(itemFP),
    stability,
    cost_usd: cost,
    wall_s: wall,
    gold_secondary: gold,
    segmentation: { scenes: A.seg.scenes.length, known_from_film: A.seg.scenes.filter((s) => s.known_from_film).length, repairs: A.seg.validation?.repairs_count ?? null, cast: A.seg.cast.length },
  });
}

// ---- cap the review list -------------------------------------------------------------------------
const byKind = (k) => disagreements.filter((d) => d.kind.startsWith(k)).sort((a, b) => b._rank - a._rank);
const dA = byKind('a'); const dB = byKind('b'); const dC = byKind('c');
// diversity for (a): at most 3 items with the same film + flag-reason signature before others get a turn
function diversify(list, perSig) {
  const seen = {}; const first = []; const rest = [];
  for (const d of list) { seen[d._sig] = (seen[d._sig] ?? 0) + 1; (seen[d._sig] <= perSig ? first : rest).push(d); }
  return [...first, ...rest];
}
const cReserve = Math.min(dC.length, 10);
const takeB = dB.slice(0, MAX_ITEMS);
const aRoom = Math.max(0, MAX_ITEMS - takeB.length - cReserve);
const aOrdered = diversify(dA, 3);
const takeA = aOrdered.slice(0, aRoom);
const takeC = dC.slice(0, MAX_ITEMS - takeB.length - takeA.length);
const kept = [...takeB, ...takeA, ...takeC];
const dropped = disagreements.filter((d) => !kept.includes(d)).map((d) => ({ film: d.film, kind: d.kind, v4: Array.isArray(d.v4) ? d.v4.map((x) => x.id) : d.v4?.id, baseline: Array.isArray(d.baseline) ? d.baseline.map((x) => x.id) : d.baseline?.id, rank: r3(d._rank) }));
const strip = ({ _rank, _sig, ...d }) => ({ ...d, rank: r3(_rank) });
const counts = (list) => Object.fromEntries(['a', 'b', 'c'].map((k) => [k, list.filter((d) => d.kind.startsWith(k)).length]));

fs.mkdirSync(path.join(here, 'review'), { recursive: true });
const disFile = path.join(here, 'review', 'disagreements.json');
fs.writeFileSync(disFile, JSON.stringify({
  generated_at: new Date().toISOString(), runs: RA, note: 'Unreviewed. Baseline = the live database (Sonnet scenes + Sonnet presence); v4 = Sonnet segmentation + Jev + select.js. Lines are not included; pull context.start_cue..end_cue from the SRT.',
  kinds: { a_v4_flag_not_in_baseline: 'flagged v4 scene with < 50% of its time inside baseline scenes', b_baseline_not_flagged_by_v4: 'baseline scene < 50% covered by flagged v4 scenes', c_group_tags_differ: 'covered baseline scene whose 13-group tag set differs from the union of materially overlapping flagged v4 scenes' },
  total_found: counts(disagreements), kept: counts(kept), cap: MAX_ITEMS,
  selection: 'all (b) first (by baseline severity), then (a) ranked by v4 severity + event-driven flag + max p with at most 3 per identical flag-reason signature before repeats, then (c) ranked by missing groups; up to 10 slots held for (c)',
  items: kept.map(strip),
  dropped,
}, null, 2));

// ---- summary -------------------------------------------------------------------------------------
const spend = [];
for (const f of perFilm) {
  const seg = readJson(path.join(here, 'out', `${f.slug}.segments.json`));
  const reused = f.slug === 'nemo';
  spend.push({ film: f.slug, segment_usd: reused ? 0 : seg.cost_usd, segment_reused: reused, jev_usd: f.cost_usd.classify_jev_r1 + f.cost_usd.classify_jev_r2 });
}
const phaseSpend = spend.reduce((s, x) => s + x.segment_usd + x.jev_usd, 0);
const summary = {
  generated_at: new Date().toISOString(),
  definitions: {
    material_overlap: '>= min(10 s, half the shorter scene)',
    covered: 'baseline scene >= 50% inside flagged v4 scenes (v4 scenes extended to the next scene start)',
    outside: 'flagged v4 scene with zero overlap with every baseline scene',
    mostly_outside: 'flagged v4 scene with < 50% of its time inside baseline scenes (= disagreement kind a)',
    tag_agreement: 'baseline is the reference: P = share of v4 tags the baseline also has, R = share of baseline tags v4 also has; micro over covered baseline scenes; item = v3 ids, group = 13 v3 groups',
    flagged_minutes: 'union of flagged scene cue spans (v4 also given extended to the next scene start)',
    gold: 'secondary, Claude-drafted UNREVIEWED references scored with score.js on 5 s bins at tolerance 0; any_f1 is label-agnostic',
  },
  films: perFilm,
  phase_spend_usd: r3(phaseSpend) , phase_spend_detail: spend, phase_cap_usd: PHASE_CAP_USD,
  disagreements: { file: path.relative(here, disFile), found: counts(disagreements), kept: counts(kept), dropped: dropped.length },
  problems,
};
fs.writeFileSync(path.join(here, 'out', 'summary.json'), JSON.stringify(summary, null, 2));

// ---- print ---------------------------------------------------------------------------------------
for (const f of perFilm) {
  console.log(`\n=== ${f.slug} (${f.title}) ===`);
  console.log(`v4 scenes ${f.scenes_total}, flagged ${f.scenes_flagged_v4} (${RB}: ${f.scenes_flagged_v4_r2}); baseline scenes ${f.baseline_scenes}`);
  console.log(`baseline covered >=50% by v4 flags: ${f.baseline_scenes_covered_by_v4_flags}/${f.baseline_scenes} (not: ${f.baseline_scenes_not_covered.join(',') || '-'})`);
  console.log(`v4 flags outside every baseline scene: ${f.v4_flags_outside_baseline}; mostly outside: ${f.v4_flags_mostly_outside_baseline}`);
  console.log(`flagged minutes: v4 ${f.flagged_minutes_v4} (extended ${f.flagged_minutes_v4_extended}) vs baseline ${f.flagged_minutes_baseline} of ${f.film_minutes}`);
  console.log(`flagged by presence only: ${f.flagged_by_presence_only}; reasons: ${Object.entries(f.flag_reason_counts).slice(0, 10).map(([k, v]) => `${k} ${v}`).join(', ')}`);
  const a = f.tag_agreement;
  console.log(`tag agreement on ${a.covered_baseline_scenes} covered scenes — item P ${a.item_v3.precision} R ${a.item_v3.recall} F1 ${a.item_v3.f1} J ${a.item_v3.mean_jaccard}; group P ${a.group_13.precision} R ${a.group_13.recall} F1 ${a.group_13.f1} J ${a.group_13.mean_jaccard}`);
  console.log(`  source split ${JSON.stringify(a.presence_source_split)}`);
  console.log(`  baseline items v4 misses: ${f.item_misses_top.join(', ')}`);
  console.log(`  v4 items baseline lacks: ${f.item_extras_top.join(', ')}`);
  const s = f.stability;
  console.log(`stability ${s.runs.join('/')}: flag flips ${s.flag_flips} ${s.flag_flip_scenes.join(',')}; act tag flips ${s.act_tag_flips}/${s.act_tag_union}; group flips ${s.group_flips}/${s.group_union}; noul |d| mean ${s.noul_abs_diff.mean} max ${s.noul_abs_diff.max}, 0.70 crossings ${s.noul_abs_diff.crossings_of_0_70}/${s.noul_abs_diff.n}`);
  console.log(`cost ${JSON.stringify(f.cost_usd)}; wall ${JSON.stringify(f.wall_s)}`);
  if (f.gold_secondary) console.log(`GOLD (unreviewed) ${f.gold_secondary.label_space}, floor anyF1 ${f.gold_secondary.flag_everything_any_f1_floor}\n  v4       ${JSON.stringify(f.gold_secondary.v4)}\n  baseline ${JSON.stringify(f.gold_secondary.baseline)}`);
}
console.log(`\ndisagreements found ${JSON.stringify(counts(disagreements))}, kept ${JSON.stringify(counts(kept))}, dropped ${dropped.length} -> ${path.relative(here, disFile)}`);
console.log(`phase spend $${phaseSpend.toFixed(4)} of $${PHASE_CAP_USD}`);
