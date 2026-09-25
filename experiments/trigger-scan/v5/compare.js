#!/usr/bin/env node
// v5 vs the live database baseline, vs v4, plus (secondarily) the Claude-drafted, UNREVIEWED gold lists.
// Pure code: no model calls, no network, no database. Started from v4/compare.js.
//
//   node compare.js [--films nemo,monsters-inc,lion-king] [--runs r1,r2] [--max-items 70]
//
// BASELINE = exactly what scene-api/load.js loads for the film (imported read-only, as v4 did): the
// Sonnet scene file mapped to v3 events plus the ASSERTED presence rows. Jev "second opinion" rows
// are never asserted and are ignored.
// V5 = out/<slug>.tags.<run>.json (select.js, with the r1 moment spans attached). A v5 scene's tags =
// its ACT-level tags; flagged = select.js's `flagged`; skip = the moment spans (or the whole scene).
// V4 = ../v4/out (read-only): v4's flagged minutes and the scenes v4 found or got wrong.
//
// Writes out/summary.json, out/<slug>.cast.json (cast + dangers with cites, evidence and claim-check
// verdicts, for the user to correct) and review/review.json (git-ignored).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSrt, formatTime } from '../srt.js';
import { scoreFilm, summariseGrid, unionIntervals, totalLength, intersectLength } from '../score.js';
import * as T3 from '../taxonomy-v3.js';
import * as T2 from '../taxonomy-v2.js';
import { CATEGORY_IDS } from '../taxonomy.js';
import * as L from '../../../scene-api/load.js';
import { castClaim, evidenceText } from './claims.js';
import { verifiedField, verified } from './questions.js';
import { readLedger } from './ledger.js';
import { selectScene, loadPolicy, usableFilmItems } from './select.js';
import crypto from 'node:crypto';

const here = path.dirname(fileURLToPath(import.meta.url));
const TS = path.resolve(here, '..');
const V4 = path.join(TS, 'v4');
const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const FILMS = opt('films', 'nemo,monsters-inc,lion-king').split(',');
const [RA, RB] = opt('runs', 'r1,r2').split(',');
const MAX_ITEMS = Number(opt('max-items', 70));
const HELD_OUT = new Set(['lion-king']);
// Phase accounting: everything this phase ran is in the per-film ledgers after this instant (the
// builders' earlier Nemo / Monsters, Inc. segmentation and claim checks are before it and reused).
const PHASE_START = '2026-09-24T17:30:00.000Z';
const PHASE_CAP = { total: 1.2, lion_king_sonnet: 0.45, jev: 0.4 };
// The frozen round-1 run (policy as run, before the offline v5.1 policy fixes) is kept in out/asrun/.
// Its numbers are reported next to the current ones; for the held-out film only the as-run numbers
// are held-out evidence (the v5.1 changes were made after its outputs were seen).
const ASRUN_DIR = path.join(here, 'out', 'asrun');
const asrunSummary = fs.existsSync(path.join(ASRUN_DIR, 'summary.json')) ? JSON.parse(fs.readFileSync(path.join(ASRUN_DIR, 'summary.json'), 'utf8')) : null;
const freezeFile = path.join(here, 'out', 'freeze.json');
const freeze = fs.existsSync(freezeFile) ? JSON.parse(fs.readFileSync(freezeFile, 'utf8')) : null;
const hash16 = (f) => crypto.createHash('sha256').update(fs.readFileSync(path.join(here, f))).digest('hex').slice(0, 16);
const freezeCheck = freeze ? {
  frozen_at: freeze.frozen_at,
  changed_since_freeze: Object.entries(freeze.files).filter(([f, h]) => !fs.existsSync(path.join(here, f)) || hash16(f) !== h).map(([f]) => f),
  note: 'Files changed after the freeze are the offline v5.1 fixes (no model calls). The held-out Lion King result is the as-run one (out/asrun); its current numbers are post-hoc.',
} : null;
const CFG = loadPolicy();

const r3 = (x) => (x == null ? null : Math.round(x * 1000) / 1000);
const pct = (x) => (x == null ? null : Math.round(x * 1000) / 10);
const cueNum = (c) => (typeof c === 'number' ? c : Number(String(c).replace(/^C0*/, '')));
const overlap = (a0, a1, b0, b1) => Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));
const material = (a0, a1, b0, b1) => overlap(a0, a1, b0, b1) > 0 && overlap(a0, a1, b0, b1) >= Math.min(10_000, 0.5 * Math.min(a1 - a0, b1 - b0));
const readJson = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const hms = (ms) => formatTime(ms);
const min = (ms) => r3(ms / 60000);
const inc = (o, k, n = 1) => { o[k] = (o[k] ?? 0) + n; };

function prf(tp, fp, fn) {
  const p = tp + fp ? tp / (tp + fp) : null;
  const r = tp + fn ? tp / (tp + fn) : null;
  const f = p != null && r != null && p + r > 0 ? (2 * p * r) / (p + r) : p == null && r == null ? null : 0;
  return { tp, fp, fn, precision: r3(p), recall: r3(r), f1: r3(f) };
}
const jaccard = (a, b) => { const u = new Set([...a, ...b]); if (!u.size) return 1; let i = 0; for (const x of a) if (b.has(x)) i++; return i / u.size; };

// ---- label spaces (as v4) ------------------------------------------------------------------------
const V3 = T3.BY_ID;
const groupOfV3 = (id) => V3[id]?.group ?? null;
const V2_GROUP = Object.fromEntries(T2.ATTRIBUTES.map((a) => [a.id, a.group]));
const V2_LEGACY = Object.fromEntries(T2.ATTRIBUTES.map((a) => [a.id, a.legacy]));
const V2_GROUP_IDS = Object.keys(T2.GROUPS).filter((g) => T2.ATTRIBUTES.some((a) => a.group === g));
const v2Of = (v3id) => [...(V3[v3id]?.v2 ?? []), ...(v3id === 'dies' ? Object.keys(L.TEMPORARY_V2_MAPPING) : [])];
const toV2Groups = (v3ids) => new Set([...v3ids].flatMap((id) => v2Of(id).map((a) => V2_GROUP[a])).filter(Boolean));
const toLegacy = (v3ids) => new Set([...v3ids].flatMap((id) => v2Of(id).map((a) => V2_LEGACY[a])).filter(Boolean));

// ---- v4 reference points (read-only) -------------------------------------------------------------
// Real scenes the live DB misses that v4 found (round-0 verifiers), and v4 scenes whose summaries
// had memory errors (sources/segment builder's re-check). Mapped to v5 by TIME.
const V4_KNOWN_MISSES = {
  nemo: { S036: 'whale swallows Marlin and Dory', S040: 'pelican chase' },
  'monsters-inc': { S031: 'trash compactor (1/2)', S032: 'trash compactor (2/2)', S037: 'extractor-room escape', S043: 'blizzard', S044: 'Boo in the extractor (1/2)', S045: 'Boo in the extractor (2/2)', S049: 'Randall and the shovel' },
};
const V4_MEMORY_ERRORS = {
  nemo: { S026: '"young Crush"', S040: '"pelican is attacked"', S042: '"trash can / nearly flushed"', S043: '"dentist washes Nemo down the drain"', S046: '"fishing net" (before the reunion)', S047: '"hostile gull"' },
  'monsters-inc': { S031: 'trash compactor omitted', S044: 'Boo in the extractor' },
};
const v4Summary = fs.existsSync(path.join(V4, 'out', 'summary.json')) ? readJson(path.join(V4, 'out', 'summary.json')) : null;
function v4Scenes(slug) {
  const f = path.join(V4, 'out', `${slug}.segments.json`);
  const t = path.join(V4, 'out', `${slug}.tags.r1.json`);
  if (!fs.existsSync(f) || !fs.existsSync(t)) return null;
  const seg = readJson(f);
  const tags = readJson(t);
  const flagged = new Map(tags.scenes.map((s) => [s.id, s.flagged]));
  return seg.scenes.map((s) => ({ id: s.id, start_ms: s.start_ms, end_ms: s.end_ms, start_cue: s.start_cue, end_cue: s.end_cue, flagged: flagged.get(s.id) }));
}

// ---- baseline via the loader (read-only) -----------------------------------------------------------
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
    };
  });
  return {
    files: { scenes: inputs.sceneSourceFile, presence: inputs.presenceSourceFile },
    cost_usd: { scenes: inputs.sceneRun.cost_usd ?? inputs.sceneRun.analysis_run?.cost_usd ?? null, presence: inputs.presenceRun?.cost_usd ?? null },
    scenes,
  };
}

// ---- v5 --------------------------------------------------------------------------------------------
// Tag agreement uses ACT tags that name a concern: universal presence/events/derived and the
// film-specific threatens / child-in-danger / danger items (each maps to a v3 id and a group).
// Film-specific PRESENCE ("<name> is in this scene") is who is on screen, not a concern, and its
// group is Sonnet's unverified cast.group: it is left out of agreement (it never flags either).
const concernTag = (t) => !(t.film_specific && t.type === 'presence');
function v5For(slug, run) {
  const seg = readJson(path.join(here, 'out', `${slug}.segments.json`));
  const tags = readJson(path.join(here, 'out', `${slug}.tags.${run}.json`));
  const jev = readJson(path.join(here, 'out', `${slug}.jev.${run}.json`));
  const segById = new Map(seg.scenes.map((s) => [s.id, s]));
  const jevById = new Map(jev.scenes.map((s) => [s.id, s]));
  const scenes = tags.scenes.map((s, i) => {
    const next = tags.scenes[i + 1];
    const act = s.tags.filter((t) => t.level === 'act');
    const concern = act.filter(concernTag);
    return {
      id: s.id, start_ms: s.start_ms, end_ms: s.end_ms, ext_end_ms: next ? Math.max(s.end_ms, next.start_ms) : s.end_ms, line_start_ms: s.line_start_ms ?? s.start_ms, line_end_ms: s.line_end_ms ?? s.end_ms,
      start_cue: s.start_cue, end_cue: s.end_cue, flagged: s.flagged, flag_reasons: s.flag_reasons ?? [], context_reasons: s.context_reasons ?? [],
      act, all: s.tags ?? [], severity: s.severity, modifiers: s.modifiers, kind: s.kind, cancelled: s.cancelled ?? [], vetoed: s.vetoed ?? [],
      mentioned_only: s.mentioned_only ?? [], skip: s.skip ?? null, unclassified: s.unclassified ?? null,
      items: new Set(concern.map((t) => t.v3).filter(Boolean)),
      groups: new Set(concern.map((t) => t.group)),
      seg: segById.get(s.id), jev: jevById.get(s.id),
    };
  });
  return { seg, tags, jev, scenes };
}

// ---- helpers for the review file ---------------------------------------------------------------------
const tagView = (t) => ({ id: t.id, label: t.label, v3: t.v3 ?? null, group: t.group, level: t.level, p: t.p, source: t.source, ...(t.p_lines != null ? { p_lines: t.p_lines } : {}), ...(t.p_summary != null ? { p_summary: t.p_summary } : {}), ...(t.film_specific ? { film_specific: true, type: t.type, entity: t.entity } : {}), ...(t.film_level ? { film_level_context: true } : {}) });
function sentenceView(x) {
  return { text: x.text, cites: x.cites, check: x.check ? { verdict: x.check.verdict ?? null, confidence: x.check.confidence ?? null, status: x.check.status, ...(x.check.placement ? { placement: x.check.placement } : {}) } : null, in_verified_summary: x.check?.status === 'verified' && !x.judgement_words, ...(x.judgement_words ? { judgement_words: x.judgement_words } : {}) };
}
function castInvolved(seg, ids) {
  const byId = new Map(seg.cast.map((c) => [c.id, c]));
  return (ids ?? []).map((id) => byId.get(id)).filter(Boolean).map((c) => ({
    id: c.id, name: c.name,
    verified: Object.fromEntries(['kind', 'is_child', 'looks_frightening', 'disposition'].map((f) => [f, verifiedField(c, f)])),
    claimed: Object.fromEntries(['kind', 'is_child', 'looks_frightening', 'disposition'].map((f) => [f, c[f]])),
  }));
}
function v5View(v, filmItems) {
  const s = v.seg;
  return {
    id: v.id, start: hms(v.start_ms), end: hms(v.end_ms), start_ms: v.start_ms, end_ms: v.end_ms, start_cue: v.start_cue, end_cue: v.end_cue,
    flagged: v.flagged,
    skip: v.skip ? { method: v.skip.method, spans: v.skip.spans.map((x) => ({ start: hms(x.start_ms), end: hms(x.end_ms), start_ms: x.start_ms, end_ms: x.end_ms })), seconds: Math.round(v.skip.ms / 1000) } : null,
    setting: s?.setting ?? null, setting_check: s?.setting_check ?? null,
    verified_summary: s?.summary ?? '',
    sentences: (s?.sentences ?? []).map(sentenceView),
    cast_involved: castInvolved(currentSeg, v.jev?.cast_used),
    flag_reasons: v.flag_reasons,
    context_reasons: v.context_reasons,
    severity: v.severity ? { '5-7': v.severity['5-7'].level, '8-10': v.severity['8-10'].level, score_5_7: v.severity['5-7'].score, score_8_10: v.severity['8-10'].score } : null,
    tags: v.all.map(tagView),
    film_specific_tags: v.all.filter((t) => t.film_specific).map(tagView),
    cancelled: v.cancelled, kind_gate: v.vetoed, mentioned_only: v.mentioned_only,
    modifiers: v.modifiers, kind: v.kind,
    film_items_asked: filmItems.length,
  };
}
let currentSeg = null;
const baseView = (b) => ({ id: b.id, title: b.title, start: hms(b.start_ms), end: hms(b.end_ms), start_cue: b.start_cue, end_cue: b.end_cue, severity: b.severity, tags: b.tags, groups: [...b.groups] });

// ---- per film -------------------------------------------------------------------------------------------
const perFilm = [];
const reviewItems = [];
const problems = [];

for (const slug of FILMS) {
  const needed = [`${slug}.segments.json`, `${slug}.tags.${RA}.json`, `${slug}.tags.${RB}.json`, `${slug}.jev.${RA}.json`, `${slug}.jev.${RB}.json`];
  const missing = needed.filter((f) => !fs.existsSync(path.join(here, 'out', f)));
  if (missing.length) { problems.push(`${slug}: missing ${missing.join(', ')}; film skipped`); continue; }
  const base = baselineFor(slug);
  const A = v5For(slug, RA);
  const B = v5For(slug, RB);
  currentSeg = A.seg;
  const cues = parseSrt(fs.readFileSync(path.join(TS, 'data', `${slug}.srt`), 'utf8'));
  const filmEndMs = cues[cues.length - 1].endMs;
  const momFile = path.join(here, 'out', `${slug}.moments.${RA}.json`);
  const mom = fs.existsSync(momFile) ? readJson(momFile) : null;
  if (!mom) problems.push(`${slug}: no moments file for ${RA}; skip = whole flagged scenes`);
  if (!A.tags.moments_file) problems.push(`${slug}: tags.${RA} was selected without moment spans`);

  const flagged = A.scenes.filter((s) => s.flagged);
  const skipU = unionIntervals(flagged.flatMap((s) => (s.skip?.spans ?? []).map((x) => ({ startMs: x.start_ms, endMs: x.end_ms }))));
  const flaggedU = unionIntervals(flagged.map((s) => ({ startMs: s.start_ms, endMs: s.end_ms })));
  const flaggedExtU = unionIntervals(flagged.map((s) => ({ startMs: s.start_ms, endMs: s.ext_end_ms })));
  const baseU = unionIntervals(base.scenes.map((s) => ({ startMs: s.start_ms, endMs: s.end_ms })));

  // ---- claim check summary ------------------------------------------------------------------------------
  const cc = A.seg.claim_check ?? null;
  const sceneMs = (s) => s.end_ms - s.start_ms;
  const summarised = A.seg.scenes.filter((s) => s.summary);
  const sent = A.seg.scenes.flatMap((s) => s.sentences);
  const claimCheck = cc ? {
    claims: cc.claims, requests: cc.requests, tally: cc.tally, by_type: cc.by_type,
    sentences_verified: `${sent.filter((x) => x.check?.status === 'verified').length}/${sent.length}`,
    scenes_with_verified_summary: `${summarised.length}/${A.seg.scenes.length}`,
    minutes_with_verified_summary: `${min(summarised.reduce((a, s) => a + sceneMs(s), 0))}/${min(A.seg.scenes.reduce((a, s) => a + sceneMs(s), 0))}`,
    settings_verified: `${A.seg.scenes.filter((s) => s.setting_check?.status === 'verified').length}/${A.seg.scenes.filter((s) => s.setting_check).length}`,
    dangers_verified: `${A.seg.dangers.filter((d) => d.check?.status === 'verified').length}/${A.seg.dangers.length + (cc.dropped_by_check ?? []).filter((d) => /^D\d+$/.test(d.key)).length}`,
    contradicted_dropped: cc.dropped_by_check,
    leakage_probe: cc.leakage_probe, batch_size: cc.batch_size, evidence_context_lines: cc.evidence_context_lines,
    cost_usd: cc.cost_usd, wall_s: r3((cc.wall_ms_main + (cc.wall_ms_probes ?? 0)) / 1000),
  } : null;
  if (!cc) problems.push(`${slug}: segments file has no claim_check`);
  const claimLine = cc ? `sentences ${claimCheck.sentences_verified} verified; ${claimCheck.scenes_with_verified_summary} scenes / ${claimCheck.minutes_with_verified_summary} min have a verified summary; verdicts supports ${cc.tally.supports} (${cc.tally.supports_below_0_8} < 0.8), contradicts ${cc.tally.contradicts}, says_nothing ${cc.tally.says_nothing} of ${cc.claims} claims; dangers ${claimCheck.dangers_verified} verified` : 'no claim check';

  // ---- coverage ---------------------------------------------------------------------------------------------
  const baseRows = base.scenes.map((b) => {
    const dur = Math.max(1, b.end_ms - b.start_ms);
    const covSkip = intersectLength(skipU, [[b.start_ms, b.end_ms]]) / dur;
    const covFlag = intersectLength(flaggedExtU, [[b.start_ms, b.end_ms]]) / dur;
    const mat = flagged.filter((v) => material(v.start_ms, v.ext_end_ms, b.start_ms, b.end_ms));
    const touching = A.scenes.filter((v) => overlap(v.start_ms, v.ext_end_ms, b.start_ms, b.end_ms) > 0);
    return { b, covSkip, covFlag, mat, touching };
  });
  const coveredSkip = baseRows.filter((r) => r.covSkip >= 0.5);
  const coveredFlag = baseRows.filter((r) => r.covFlag >= 0.5);
  // outside the baseline is judged on the scene's dialogue bounds, as in round 1 (the v5.1 scene
  // extension over wordless gaps would otherwise make every flag touch a neighbouring baseline scene)
  const v5Rows = flagged.map((v) => {
    const inside = intersectLength(baseU, [[v.line_start_ms, v.line_end_ms]]) / Math.max(1, v.line_end_ms - v.line_start_ms);
    const touching = base.scenes.filter((b) => overlap(v.line_start_ms, v.line_end_ms, b.start_ms, b.end_ms) > 0);
    return { v, inside, touching };
  });
  const outside = v5Rows.filter((r) => r.touching.length === 0);

  // ---- tag agreement on covered baseline scenes (v4 method; flagged-scene coverage) ---------------------
  const agg = { item: { tp: 0, fp: 0, fn: 0, j: [] }, group: { tp: 0, fp: 0, fn: 0, j: [] } };
  const itemFN = {}; const itemFP = {};
  for (const r of coveredFlag) {
    const vItems = new Set(r.mat.flatMap((v) => [...v.items]));
    const vGroups = new Set(r.mat.flatMap((v) => [...v.groups]));
    for (const [lvl, bs, vset] of [['item', r.b.items, vItems], ['group', r.b.groups, vGroups]]) {
      let tp = 0; for (const x of vset) if (bs.has(x)) tp++;
      agg[lvl].tp += tp; agg[lvl].fp += vset.size - tp; agg[lvl].fn += bs.size - tp; agg[lvl].j.push(jaccard(bs, vset));
    }
    for (const x of r.b.items) if (!vItems.has(x)) inc(itemFN, x);
    for (const x of vItems) if (!r.b.items.has(x)) inc(itemFP, x);
  }
  const top = (o, n = 8) => Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, v]) => `${k} ${v}`);
  const meanJ = (a) => r3(a.reduce((x, y) => x + y, 0) / (a.length || 1));
  const agreement = {
    reference: 'baseline = the live database tags (Sonnet scenes + asserted Sonnet presence via scene-api/load.js). v5 = union of ACT concern tags (film-specific presence excluded) of flagged v5 scenes with a material overlap, on baseline scenes >= 50% covered by flagged v5 scenes (v4 method).',
    covered_baseline_scenes: coveredFlag.length,
    item_v3: { ...prf(agg.item.tp, agg.item.fp, agg.item.fn), mean_jaccard: meanJ(agg.item.j) },
    group_13: { ...prf(agg.group.tp, agg.group.fp, agg.group.fn), mean_jaccard: meanJ(agg.group.j) },
    baseline_items_v5_misses_top: top(itemFN), v5_items_baseline_lacks_top: top(itemFP),
  };
  const v4f = v4Summary?.films.find((f) => f.slug === slug) ?? null;
  const v4Agreement = v4f ? { item_f1: v4f.tag_agreement.item_v3.f1, group_f1: v4f.tag_agreement.group_13.f1, covered: v4f.tag_agreement.covered_baseline_scenes } : null;

  // ---- film-specific layer ----------------------------------------------------------------------------------
  const items = A.jev.film_items ?? [];
  const fsReasonCount = {};
  for (const v of flagged) for (const r of v.flag_reasons) if (r.film_specific) inc(fsReasonCount, r.id);
  const fsDriven = flagged.filter((v) => v.flag_reasons.some((r) => r.film_specific));
  const fsOnly = flagged.filter((v) => v.flag_reasons.length && v.flag_reasons.every((r) => r.film_specific));
  const filmSpecific = {
    questions: A.jev.question_set.generated,
    items: items.map((it) => `${it.id} (${it.name}, ${it.type}, ${it.why}, group ${it.group})`),
    flagged_scenes_with_a_film_specific_reason: fsDriven.length,
    flagged_scenes_only_film_specific: fsOnly.map((v) => v.id),
    reason_counts: fsReasonCount,
  };
  const fsFlagsLine = `${fsDriven.length} flagged scenes carry a film-specific reason (${fsOnly.length} flagged ONLY by one: ${fsOnly.map((v) => v.id).join(',') || '-'}); ${Object.entries(fsReasonCount).map(([k, n]) => `${k} ${n}`).join(', ') || 'none'}`;

  // ---- v4 comparisons by time ----------------------------------------------------------------------------------
  const v4s = v4Scenes(slug);
  const mapV4 = (ids) => (v4s ? Object.entries(ids ?? {}).map(([id, what]) => {
    const s = v4s.find((x) => x.id === id);
    if (!s) return { v4_id: id, what, error: 'not in v4 segments' };
    const dur = Math.max(1, s.end_ms - s.start_ms);
    const over = A.scenes.filter((v) => overlap(v.start_ms, v.ext_end_ms, s.start_ms, s.end_ms) > 0);
    const covFlag = intersectLength(flaggedExtU, [[s.start_ms, s.end_ms]]) / dur;
    const covSkip = intersectLength(skipU, [[s.start_ms, s.end_ms]]) / dur;
    return {
      v4_id: id, what, v4_time: `${hms(s.start_ms)}-${hms(s.end_ms)}`, v4_cues: `${s.start_cue}-${s.end_cue}`, v4_flagged: s.flagged,
      v5_scenes: over.map((v) => ({ id: v.id, flagged: v.flagged, reasons: v.flag_reasons.map((r) => r.id), share_of_v4_scene: r3(overlap(v.start_ms, v.ext_end_ms, s.start_ms, s.end_ms) / dur) })),
      v5_flagged_coverage: r3(covFlag), v5_skip_coverage: r3(covSkip), found: covFlag >= 0.5, found_in_skip: covSkip >= 0.5,
    };
  }) : []);
  const misses = mapV4(V4_KNOWN_MISSES[slug]);
  const memErrors = mapV4(V4_MEMORY_ERRORS[slug]);
  const missesLine = misses.length ? `${misses.filter((m) => m.found).length}/${misses.length} found by flagged v5 scenes, ${misses.filter((m) => m.found_in_skip).length}/${misses.length} >= 50% inside skip spans: ${misses.map((m) => `${m.v4_id} ${m.what} -> ${m.v5_scenes.map((x) => `${x.id}${x.flagged ? '*' : ''}`).join('+')} flag ${m.v5_flagged_coverage} skip ${m.v5_skip_coverage}`).join('; ')}` : (HELD_OUT.has(slug) ? 'n/a (v4 did not run the held-out film)' : 'n/a');

  // ---- v4 false-flag causes remaining ----------------------------------------------------------------------
  const reasonIds = (v) => v.flag_reasons.map((r) => r.id);
  const actP = (v, id) => v.act.find((t) => t.id === id);
  const captionRe = /[([][^)\]]*(machin|motor|engine|whir|hum|buzz|beep|clank|grind|drill|saw|electric|zap|crackl|mechani|rumbl|click)[^)\]]*[)\]]/i;
  const causes = {
    '1_flag_policy_or': { flagged: `${flagged.length}/${A.scenes.length}`, v4: v4f ? `${v4f.scenes_flagged_v4}/${v4f.scenes_total}` : null, flagged_by_presence_only: flagged.filter((v) => v.flag_reasons.every((r) => r.rule.startsWith('presence'))).length },
    '2_comic_screams_read_as_fear': {
      flagged_only_by_afraid_for_safety: flagged.filter((v) => reasonIds(v).length === 1 && reasonIds(v)[0] === 'afraid_for_safety').length,
      of_which_comic_on: flagged.filter((v) => reasonIds(v).length === 1 && reasonIds(v)[0] === 'afraid_for_safety' && v.modifiers?.comic?.on).length,
      flagged_with_afraid_for_safety_and_comic_on: flagged.filter((v) => reasonIds(v).includes('afraid_for_safety') && v.modifiers?.comic?.on).length,
      scenes_with_screams_at_act_not_flagged: A.scenes.filter((v) => actP(v, 'screams') && !v.flagged).length,
    },
    '3_monster_creature': { flags_with_monster_creature_reason: flagged.filter((v) => reasonIds(v).includes('monster_creature')).length, scenes_monster_creature_at_act: A.scenes.filter((v) => actP(v, 'monster_creature')).length, film_level_context: (A.tags.summary.film_level_notes ?? []).some((n) => n.id === 'monster_creature') },
    '4_parent_searching': { flags_with_parent_searching_reason: flagged.filter((v) => reasonIds(v).includes('parent_searching')).length, scenes_at_act: A.scenes.filter((v) => actP(v, 'parent_searching')).length },
    '5_dangerous_machine_on_sound_captions': (() => {
      const dm = flagged.filter((v) => reasonIds(v).includes('dangerous_machine'));
      const linesOnly = dm.filter((v) => v.flag_reasons.find((r) => r.id === 'dangerous_machine').source === 'lines');
      const withCaption = linesOnly.filter((v) => cues.slice(v.start_cue - 1, v.end_cue).some((c) => captionRe.test(c.text)));
      const soleReason = dm.filter((v) => reasonIds(v).length === 1);
      return { flags_with_dangerous_machine_reason: dm.length, of_which_lines_channel_only: linesOnly.length, lines_only_in_scenes_with_a_machine_like_sound_caption: withCaption.map((v) => v.id), dangerous_machine_is_the_only_reason: soleReason.map((v) => v.id), scenes_at_act: A.scenes.filter((v) => actP(v, 'dangerous_machine')).length };
    })(),
    '6_jump_scare_bundled': { flags_from_jump_scare_parts: flagged.filter((v) => reasonIds(v).some((id) => ['jump_scare', 'appears_suddenly', 'startled'].includes(id))).length, jump_scare_tag_at_act: A.scenes.filter((v) => actP(v, 'jump_scare')).length },
    '7_retold_cancel': (() => {
      // act-level cancellations are the ones that can remove a flag; 'possible'-band ones never flag
      const actCancels = A.scenes.flatMap((v) => v.cancelled.filter((c) => c.by.includes('retold') && c.level === 'act').map((c) => `${v.id}:${c.id}`));
      // scenes that retold ALONE unflagged: re-select the scene with retold switched off
      const noRetold = { ...CFG, retold_cancel: { ...CFG.retold_cancel, act: 1.01 }, modifier_act: CFG.modifier_act };
      const ctxSet = new Set((A.tags.summary.film_level_notes ?? []).map((n) => n.id));
      const items = usableFilmItems(A.jev.film_items ?? [], CFG);
      const unflaggedByRetold = A.scenes.filter((v) => !v.flagged && v.jev?.answers && v.modifiers?.retold?.on && selectScene(v.jev.answers, noRetold, { items, context: ctxSet }).flagged).map((v) => ({ id: v.id, lost: v.cancelled.filter((c) => c.by.includes('retold') && c.level === 'act').map((c) => `${c.id} ${c.p}`) }));
      return {
        scenes_retold_on: A.scenes.filter((v) => v.modifiers?.retold?.on).map((v) => v.id),
        events_cancelled_by_retold_all_levels: A.scenes.reduce((a, v) => a + v.cancelled.filter((c) => c.by.includes('retold')).length, 0),
        events_cancelled_by_retold_at_act: actCancels.length, act_cancellations: actCancels,
        scenes_unflagged_by_retold_alone: unflaggedByRetold,
        flagged_with_retold_p_ge_0_7_but_off: flagged.filter((v) => (v.modifiers?.retold?.p ?? 0) >= 0.7 && !v.modifiers.retold.on).map((v) => v.id),
      };
    })(),
    '8_severity_pinned': { flagged_severity_5_7: A.tags.summary.severity_levels['5-7'], flagged_severity_8_10: A.tags.summary.severity_levels['8-10'], flagged_at_3_3: flagged.filter((v) => v.severity['5-7'].level === 3 && v.severity['8-10'].level === 3).length, comic_on_scenes: A.scenes.filter((v) => v.modifiers?.comic?.on).length },
    '9_lines_channel_contamination': { fixed_by_construction: 'lines request state = {film:{title}, scene:{lines}} only (questions.js linesState)', presence_act_by_source: A.scenes.flatMap((v) => v.act.filter((t) => t.layer === 'presence')).reduce((m, t) => ({ ...m, [t.source]: (m[t.source] ?? 0) + 1 }), {}) },
    '10_kind_choice': { non_none_confident_ge_0_9: A.scenes.filter((v) => v.kind && v.kind.choice !== 'none' && v.kind.confidence >= 0.9).reduce((m, v) => ({ ...m, [v.kind.choice]: (m[v.kind.choice] ?? 0) + 1 }), {}), kind_gate_vetoes: A.scenes.reduce((a, v) => a + v.vetoed.length, 0) },
    '11_story_length_scenes': { flagged_scene_minutes: min(totalLength(flaggedU)), skip_minutes: min(totalLength(skipU)), moment_calls: mom ? mom.requests : 0, scenes_whole_scene_fallback: mom ? Object.entries(mom.scenes).filter(([, m]) => m.method !== 'moments').map(([id, m]) => `${id} (${String(m.why).split(':')[0]})`) : null },
    '12_memory_errors': cc ? { contradicted: cc.tally.contradicted, unverified: cc.tally.unverified, verified: cc.tally.verified } : null,
    '13_test_film_names_in_wording': 'test/questions.test.js deny-list (Nemo, Monsters, Inc., Lion King entities) passes',
  };
  const causesLine = [
    `(1) ${causes['1_flag_policy_or'].flagged} flagged (v4 ${causes['1_flag_policy_or'].v4}), ${causes['1_flag_policy_or'].flagged_by_presence_only} by presence only`,
    `(2) ${causes['2_comic_screams_read_as_fear'].of_which_comic_on} scenes flagged only by afraid_for_safety in a comic scene; ${causes['2_comic_screams_read_as_fear'].flagged_with_afraid_for_safety_and_comic_on} flagged scenes carry afraid_for_safety with comic on`,
    `(3) monster_creature flags ${causes['3_monster_creature'].flags_with_monster_creature_reason} (act in ${causes['3_monster_creature'].scenes_monster_creature_at_act} scenes; film-level ${causes['3_monster_creature'].film_level_context})`,
    `(4) parent_searching flags ${causes['4_parent_searching'].flags_with_parent_searching_reason}`,
    `(5) dangerous_machine flags ${causes['5_dangerous_machine_on_sound_captions'].flags_with_dangerous_machine_reason} (lines-only ${causes['5_dangerous_machine_on_sound_captions'].of_which_lines_channel_only}, of which in scenes with a machine-like caption ${causes['5_dangerous_machine_on_sound_captions'].lines_only_in_scenes_with_a_machine_like_sound_caption.length}; sole reason ${causes['5_dangerous_machine_on_sound_captions'].dangerous_machine_is_the_only_reason.length})`,
    `(6) jump-scare flags ${causes['6_jump_scare_bundled'].flags_from_jump_scare_parts}`,
    `(7) retold on in ${causes['7_retold_cancel'].scenes_retold_on.length} scenes; ${causes['7_retold_cancel'].events_cancelled_by_retold_at_act} act-level events cancelled (${causes['7_retold_cancel'].events_cancelled_by_retold_all_levels} at all levels); scenes unflagged by retold alone: ${causes['7_retold_cancel'].scenes_unflagged_by_retold_alone.map((x) => x.id).join(',') || 'none'}`,
    `(8) flagged at 3/3: ${causes['8_severity_pinned'].flagged_at_3_3}/${flagged.length}`,
    `(10) kind-gate vetoes ${causes['10_kind_choice'].kind_gate_vetoes}`,
    `(11) skip ${causes['11_story_length_scenes'].skip_minutes} of ${causes['11_story_length_scenes'].flagged_scene_minutes} flagged-scene min; ${causes['11_story_length_scenes'].scenes_whole_scene_fallback?.length ?? '?'} whole-scene fallbacks`,
  ].join('; ');

  // ---- stability ------------------------------------------------------------------------------------------------
  const bById = new Map(B.scenes.map((s) => [s.id, s]));
  let flagFlips = 0; let tagFlips = 0; let tagUnion = 0; let groupFlips = 0; let groupUnion = 0; let reasonSetDiffs = 0; let sevChanges = 0;
  const flipIds = [];
  for (const a of A.scenes) {
    const b = bById.get(a.id);
    if (!b) continue;
    if (a.flagged !== b.flagged) { flagFlips++; flipIds.push(a.id); }
    if (a.flagged && b.flagged) {
      const ra = new Set(reasonIds(a)); const rb = new Set(reasonIds(b));
      if (ra.size !== rb.size || [...ra].some((x) => !rb.has(x))) reasonSetDiffs++;
      if (a.severity['5-7'].level !== b.severity['5-7'].level || a.severity['8-10'].level !== b.severity['8-10'].level) sevChanges++;
    }
    const ta = new Set(a.act.map((t) => t.id)); const tb = new Set(b.act.map((t) => t.id));
    const u = new Set([...ta, ...tb]); tagUnion += u.size; for (const x of u) if (ta.has(x) !== tb.has(x)) tagFlips++;
    const gu = new Set([...a.groups, ...b.groups]); groupUnion += gu.size; for (const x of gu) if (a.groups.has(x) !== b.groups.has(x)) groupFlips++;
  }
  let maxDiff = 0; let sumDiff = 0; let nDiff = 0; let crossings = 0;
  const jB = new Map(B.jev.scenes.map((s) => [s.id, s]));
  for (const sa of A.jev.scenes) {
    const sb = jB.get(sa.id);
    if (!sa.answers || !sb?.answers) continue;
    for (const ch of ['pl', 'ps', 'm', 'e', 'mod', 'fpl', 'fps', 'fe']) for (const [k, p] of Object.entries(sa.answers[ch] ?? {})) {
      const q = sb.answers[ch]?.[k]; if (q == null) continue;
      const d = Math.abs(p - q); maxDiff = Math.max(maxDiff, d); sumDiff += d; nDiff++;
      if ((p >= 0.7) !== (q >= 0.7)) crossings++;
    }
  }
  const nFlagB = B.scenes.filter((s) => s.flagged).length;
  const stability = {
    runs: [RA, RB], flagged: [flagged.length, nFlagB], flag_flips: flagFlips, flag_flip_scenes: flipIds,
    reason_set_differs_in_flagged_both: reasonSetDiffs, severity_level_changes_in_flagged_both: sevChanges,
    act_tag_flips: tagFlips, act_tag_union: tagUnion, group_flips: groupFlips, group_union: groupUnion,
    noul_abs_diff: { mean: r3(sumDiff / (nDiff || 1)), max: r3(maxDiff), n: nDiff, crossings_of_0_70: crossings },
  };
  const stabilityLine = `flagged ${flagged.length}/${nFlagB}; ${flagFlips} flag flips${flipIds.length ? ` (${flipIds.join(',')})` : ''}; reason sets differ in ${reasonSetDiffs} scenes flagged in both; act-tag flips ${tagFlips}/${tagUnion}; yes/no |d| mean ${stability.noul_abs_diff.mean} max ${stability.noul_abs_diff.max}, ${crossings}/${nDiff} cross 0.70`;

  // ---- cost & wall -------------------------------------------------------------------------------------------------
  const ledger = readLedger(slug).entries;
  const phaseEntries = ledger.filter((e) => e.at >= PHASE_START);
  const cost = {
    segment_sonnet: A.seg.cost_usd, claim_check_jev: cc?.cost_usd ?? null,
    classify_jev_r1: A.jev.cost_usd, classify_jev_r2: B.jev.cost_usd, select: 0, moments_jev_r1: mom?.cost_usd ?? 0,
    one_pass_total: r3((A.seg.cost_usd ?? 0) + (cc?.cost_usd ?? 0) + A.jev.cost_usd + (mom?.cost_usd ?? 0)),
    ledger_total: { sonnet: r3(ledger.filter((e) => e.kind === 'sonnet').reduce((a, e) => a + e.usd, 0)), jev: Number(ledger.filter((e) => e.kind === 'jev').reduce((a, e) => a + e.usd, 0).toFixed(6)) },
    this_phase: { sonnet: r3(phaseEntries.filter((e) => e.kind === 'sonnet').reduce((a, e) => a + e.usd, 0)), jev: Number(phaseEntries.filter((e) => e.kind === 'jev').reduce((a, e) => a + e.usd, 0).toFixed(6)) },
    baseline_scenes: base.cost_usd.scenes, baseline_presence: base.cost_usd.presence,
    v4_one_pass_total: v4f?.cost_usd?.v4_one_pass_total ?? null,
  };
  const wall = {
    segment_sonnet: r3(A.seg.wall_ms / 1000), claim_check_jev: claimCheck?.wall_s ?? null,
    classify_jev_r1: r3(A.jev.wall_ms / 1000), classify_jev_r2: r3(B.jev.wall_ms / 1000), select: 'pure code (<1 s)', moments_jev_r1: mom ? r3(mom.wall_ms / 1000) : null,
  };

  // ---- secondary: unreviewed gold (v4 method) ----------------------------------------------------------------
  let gold = null;
  const cueByNum = new Map(cues.map((c) => [c.index, c]));
  const maxLevels = (v) => ({ '5-7': v.severity['5-7'].level, '8-10': v.severity['8-10'].level });
  const flagPreds = flagged.map((v) => ({ startMs: v.start_ms, endMs: v.end_ms, v3: v.items, severity: maxLevels(v) }));
  const skipPreds = flagged.flatMap((v) => (v.skip?.spans ?? []).map((x) => ({ startMs: x.start_ms, endMs: x.end_ms, v3: v.items, severity: maxLevels(v) })));
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
  let goldSpec = null;
  if (slug === 'nemo') {
    const g = readJson(path.join(TS, 'gold.json')).map((x) => ({ ...x, startMs: cueByNum.get(cueNum(x.start_cue)).startMs, endMs: cueByNum.get(cueNum(x.end_cue)).endMs, labels: new Set(x.categories) }));
    goldSpec = { file: 'gold.json', label_space: 'legacy 12 categories (v3 -> v2 -> legacy)', g, labelIds: CATEGORY_IDS, map: (p) => ({ ...p, labels: toLegacy(p.v3), severity: Math.max(p.severity['5-7'] ?? 0, p.severity['8-10'] ?? 0) }) };
  } else if (fs.existsSync(path.join(TS, 'gold', `${slug}.json`))) {
    const g = readJson(path.join(TS, 'gold', `${slug}.json`)).map((x) => ({ ...x, startMs: cueByNum.get(cueNum(x.start_cue)).startMs, endMs: cueByNum.get(cueNum(x.end_cue)).endMs, labels: new Set(x.attributes.map((a) => V2_GROUP[a]).filter(Boolean)), severity: { '5-7': x.severity_5_7, '8-10': x.severity_8_10 } }));
    goldSpec = { file: `gold/${slug}.json`, label_space: `${V2_GROUP_IDS.length} v2 groups (v3 -> v2 attribute -> v2 group)`, g, labelIds: V2_GROUP_IDS, map: (p) => ({ ...p, labels: toV2Groups(p.v3) }) };
  }
  if (goldSpec) {
    const ref = goldSpec.g.filter((x) => !x.control); const controls = goldSpec.g.filter((x) => x.control);
    const score = (preds) => scoreFilm({ film: slug, filmEndMs, labelIds: goldSpec.labelIds, reference: ref, controls, predictions: preds.map(goldSpec.map), options: { toleranceS: [0] } });
    const share = totalLength(unionIntervals(ref)) / filmEndMs;
    gold = {
      label: 'UNREVIEWED', reference: `${goldSpec.file} — Claude-drafted, NOT human-reviewed`, label_space: goldSpec.label_space, ref_scenes: ref.length, controls: controls.length,
      flag_everything_any_f1_floor: pct((2 * share) / (1 + share)),
      v5_flagged_scenes: summarise(score(flagPreds), goldSpec.labelIds), v5_skip_spans: summarise(score(skipPreds), goldSpec.labelIds), baseline: summarise(score(basePreds), goldSpec.labelIds),
      v4_flagged_scenes: v4f?.gold_secondary?.v4 ?? null,
    };
  }

  // ---- cast file for the user to correct ------------------------------------------------------------------------
  const SRC = readJson(path.join(here, 'sources', `${slug}.json`));
  const src = { cues, W: SRC.wikipedia.sentences, T: SRC.tmdb.cast };
  const claimsFile = path.join(here, 'out', `${slug}.claims.json`);
  const claimRows = fs.existsSync(claimsFile) ? new Map(readJson(claimsFile).claims.map((c) => [c.key, c])) : new Map();
  const ev = (ids) => (ids ?? []).map((id) => ({ id, text: evidenceText(id, src) }));
  const castFile = {
    film: A.seg.film, sources: A.seg.sources, note: 'Cast and dangers exactly as the pipeline holds them. Each field: the claimed value, its cites with the cited text, and the Jev claim-check verdict (verified = supports at confidence >= 0.8). Only verified values reach Jev classification or generate film-specific questions. Correct any row by editing the value and cites.',
    cast: A.seg.cast.map((c) => ({
      id: c.id, name: c.name, tmdb: c.tmdb, aliases: c.aliases, group: c.group, disposition_note: c.disposition_note,
      fields: Object.fromEntries(['name', 'kind', 'is_child', 'looks_frightening', 'disposition'].map((f) => {
        const row = claimRows.get(`${c.id}.${f}`);
        return [f, { value: f === 'name' ? c.name : c[f], used_by_jev: f === 'name' ? true : verifiedField(c, f), claim: row?.claim ?? (f === 'name' ? null : castClaim(c, f)), cites: c.cites?.[f] ?? [], evidence: ev(row?.evidence_ids ?? c.cites?.[f]), check: c.check?.[f] ?? null, ...(row?.status === 'contradicted' ? { contradicted_was: row.claim } : {}) }];
      })),
      ...(c.demoted_to_unknown ? { demoted_to_unknown_uncited: c.demoted_to_unknown } : {}),
    })),
    dangers: A.seg.dangers.map((d) => ({ id: d.id, name: d.name, kind: d.kind, note: d.note, group: d.group, cites: d.cites, evidence: ev(claimRows.get(d.id)?.evidence_ids ?? d.cites), check: d.check ?? null, used_by_jev: verified(d.check) })),
    dropped_by_check: cc?.dropped_by_check ?? [],
    film_specific_items: items.map(({ id, name, type, why, group }) => ({ id, name, type, why, group })),
  };
  fs.writeFileSync(path.join(here, 'out', `${slug}.cast.json`), JSON.stringify(castFile, null, 2));

  // ---- review items ---------------------------------------------------------------------------------------------
  const isLK = HELD_OUT.has(slug);
  for (const r of baseRows.filter((x) => x.covSkip < 0.5)) {
    reviewItems.push({
      film: slug, kind: 'b_baseline_scene_not_covered', held_out: isLK,
      why: `baseline scene ${r.b.id} has ${Math.round(r.covSkip * 100)}% of its time inside v5 skip spans (${Math.round(r.covFlag * 100)}% inside flagged v5 scenes)`,
      baseline: baseView(r.b), v5_skip_coverage: r3(r.covSkip), v5_flagged_scene_coverage: r3(r.covFlag),
      v5_scenes: r.touching.map((v) => v5View(v, items)),
      cue_range: { start_cue: Math.min(r.b.start_cue, ...r.touching.map((v) => v.start_cue)), end_cue: Math.max(r.b.end_cue, ...r.touching.map((v) => v.end_cue)) },
      _rank: (isLK ? 1000 : 500) + Math.max(r.b.severity['5-7'] ?? 0, r.b.severity['8-10'] ?? 0),
    });
  }
  // one review item per v4 scene: a scene on both lists (MI v4 S031, S044) carries both list names
  const v4Rows = new Map();
  for (const m of [...misses.map((x) => ({ ...x, list: 'v4_found_live_db_missed' })), ...memErrors.map((x) => ({ ...x, list: 'v4_summary_memory_error' }))]) {
    const had = v4Rows.get(m.v4_id);
    if (had) { had.lists.push(m.list); had.what = `${had.what}; ${m.what}`; continue; }
    v4Rows.set(m.v4_id, { ...m, lists: [m.list] });
  }
  for (const m of v4Rows.values()) {
    if (m.error) continue;
    const vs = m.v5_scenes.map((x) => A.scenes.find((v) => v.id === x.id));
    reviewItems.push({
      film: slug, kind: 'c_v4_known_error_scene', held_out: false, v4_list: m.lists.join('+'),
      why: `v4 ${m.v4_id} (${m.what}); v5 flagged coverage ${m.v5_flagged_coverage}, skip coverage ${m.v5_skip_coverage}`,
      v4: { id: m.v4_id, what: m.what, time: m.v4_time, cues: m.v4_cues, v4_flagged: m.v4_flagged },
      v5_scenes: vs.map((v) => v5View(v, items)),
      baseline: base.scenes.filter((b) => vs.some((v) => overlap(v.start_ms, v.end_ms, b.start_ms, b.end_ms) > 0)).map(baseView),
      cue_range: { start_cue: Math.min(...vs.map((v) => v.start_cue)), end_cue: Math.max(...vs.map((v) => v.end_cue)) },
      _rank: 300 + (m.lists.includes('v4_found_live_db_missed') ? 10 : 0) + (m.found ? 0 : 5),
    });
  }
  for (const r of outside) {
    reviewItems.push({
      film: slug, kind: 'a_v5_flag_with_zero_baseline_overlap', held_out: isLK,
      why: `flagged v5 scene ${r.v.id} overlaps no baseline scene`,
      v5_scenes: [v5View(r.v, items)], baseline: [],
      cue_range: { start_cue: r.v.start_cue, end_cue: r.v.end_cue },
      _rank: (isLK ? 900 : 100) + Math.max(r.v.severity['5-7'].level, r.v.severity['8-10'].level),
    });
  }

  const asrunFilm = asrunSummary?.films?.find((f) => f.slug === slug) ?? null;
  const gapMs = A.scenes.reduce((a, v) => a + Math.max(0, (v.start_ms ?? 0) - (v.line_start_ms ?? v.start_ms)) + Math.max(0, v.end_ms - (v.line_end_ms ?? v.end_ms)), 0);
  perFilm.push({
    slug, title: A.seg.film.title, held_out: isLK, baseline_files: base.files,
    policy: { file: A.tags.policy_file ?? 'policy.json', film_items_dropped_by_policy: A.tags.film_items_dropped_by_policy ?? [], scene_bounds: A.tags.policy?.scene_bounds ?? null, wordless_gap_minutes_added_to_scenes: min(gapMs) },
    ...(asrunFilm ? { asrun: {
      label: isLK ? 'HELD-OUT RESULT: policy as run, frozen before any Lion King step (out/asrun). The current numbers for this film are post-hoc.' : 'round-1 as run (out/asrun), before the offline v5.1 policy fixes',
      flagged_scenes: asrunFilm.flagged_scenes, flagged_scenes_r2: asrunFilm.flagged_scenes_r2, minutes: asrunFilm.minutes,
      baseline_covered_by_skip_spans: asrunFilm.baseline_covered_by_skip_spans, baseline_covered_by_flagged_scenes: asrunFilm.baseline_covered_by_flagged_scenes,
      baseline_not_covered_by_skip: asrunFilm.baseline_not_covered_by_skip, v5_flags_outside_baseline_ids: asrunFilm.v5_flags_outside_baseline_ids,
      film_level_notes: asrunFilm.film_level_notes, film_specific_line: asrunFilm.film_specific_line, v4_known_misses_line: asrunFilm.v4_known_misses_line,
      tag_agreement: { item_f1: asrunFilm.tag_agreement.item_v3.f1, group_f1: asrunFilm.tag_agreement.group_13.f1, covered: asrunFilm.tag_agreement.covered_baseline_scenes },
      stability_line: asrunFilm.stability_line, gold_secondary: asrunFilm.gold_secondary ? { v5_flagged_scenes: asrunFilm.gold_secondary.v5_flagged_scenes, v5_skip_spans: asrunFilm.gold_secondary.v5_skip_spans } : null,
    } } : {}),
    segmentation: { scenes: A.seg.scenes.length, model: A.seg.model, prompt_version: A.seg.prompt_version, effort: A.seg.effort, cast: A.seg.cast.length, dangers: A.seg.dangers.length, repairs: A.seg.validation?.repairs_count ?? null, minutes_per_scene: A.seg.validation?.minutes_per_scene ?? null, wikipedia: A.seg.sources.wikipedia, tmdb: A.seg.sources.tmdb },
    claim_check: claimCheck, claim_check_line: claimLine,
    scenes_total: A.scenes.length, flagged_scenes: flagged.length, flagged_scenes_r2: nFlagB,
    minutes: { film: min(filmEndMs), skip_v5_moments: min(totalLength(skipU)), flagged_scenes_v5: min(totalLength(flaggedU)), flagged_scenes_v5_extended: min(totalLength(flaggedExtU)), baseline_scenes: min(totalLength(baseU)), v4_flagged: v4f?.flagged_minutes_v4 ?? null },
    baseline_scenes: base.scenes.length,
    baseline_covered_by_skip_spans: coveredSkip.length, baseline_covered_by_flagged_scenes: coveredFlag.length,
    baseline_not_covered_by_skip: baseRows.filter((r) => r.covSkip < 0.5).map((r) => r.b.id),
    baseline_not_covered_by_flagged_scenes: baseRows.filter((r) => r.covFlag < 0.5).map((r) => r.b.id),
    v4_baseline_covered: v4f ? `${v4f.baseline_scenes_covered_by_v4_flags}/${v4f.baseline_scenes}` : null,
    v5_flags_outside_baseline: outside.length, v5_flags_outside_baseline_ids: outside.map((r) => r.v.id),
    v5_flags_mostly_outside_baseline: v5Rows.filter((r) => r.inside < 0.5).length,
    v4_flags_outside_baseline: v4f?.v4_flags_outside_baseline ?? null,
    film_level_notes: A.tags.summary.film_level_notes,
    flag_reason_counts: Object.fromEntries(Object.entries(A.tags.summary.flag_reason_counts).sort((a, b) => b[1] - a[1])),
    chips: A.tags.summary.chips,
    film_specific: filmSpecific, film_specific_line: fsFlagsLine,
    v4_known_misses: misses, v4_known_misses_line: missesLine, v4_memory_error_scenes: memErrors,
    v4_false_flag_causes: causes, v4_false_flag_causes_line: causesLine,
    tag_agreement: agreement, v4_tag_agreement: v4Agreement,
    stability, stability_line: stabilityLine,
    cost_usd: cost, wall_s: wall,
    gold_secondary: gold,
  });
}

// ---- review set (cap, Lion King and misses first) -------------------------------------------------------------
const order = (d) => d._rank;
const sorted = reviewItems.slice().sort((a, b) => order(b) - order(a));
const kept = sorted.slice(0, MAX_ITEMS);
const dropped = sorted.slice(MAX_ITEMS).map((d) => ({ film: d.film, kind: d.kind, v5: d.v5_scenes.map((v) => v.id), baseline: Array.isArray(d.baseline) ? d.baseline.map((b) => b.id) : d.baseline?.id }));
const countKinds = (list) => list.reduce((m, d) => ({ ...m, [`${d.film}:${d.kind}`]: (m[`${d.film}:${d.kind}`] ?? 0) + 1 }), {});
fs.mkdirSync(path.join(here, 'review'), { recursive: true });
const reviewFile = path.join(here, 'review', 'review.json');
fs.writeFileSync(reviewFile, JSON.stringify({
  generated_at: new Date().toISOString(), run: RA,
  note: 'UNREVIEWED. Baseline = the live database (Sonnet scenes + asserted Sonnet presence, via scene-api/load.js). v5 = verified-source Sonnet segmentation + Jev claim check + Jev classification + select.js + moment finder. Summaries are only the sentences Jev verified (supports >= 0.8); every sentence is listed with its cites and verdict. Subtitle text is not included: read cue_range from the SRT.',
  kinds: {
    b_baseline_scene_not_covered: 'baseline scene with < 50% of its time inside v5 skip spans',
    c_v4_known_error_scene: 'a v4 scene that v4 found and the live DB missed, or whose v4 summary had a memory error, mapped to v5 scenes by time',
    a_v5_flag_with_zero_baseline_overlap: 'flagged v5 scene that overlaps no baseline scene',
  },
  selection: `Lion King first (misses, then flags outside the baseline), then the other films' misses (by baseline severity), then v4 known-error scenes, then flags outside the baseline; cap ${MAX_ITEMS}`,
  found: countKinds(reviewItems), kept_count: kept.length, cap: MAX_ITEMS,
  items: kept.map(({ _rank, ...d }) => d),
  dropped,
}, null, 2));

// ---- summary ---------------------------------------------------------------------------------------------------
const phase = perFilm.map((f) => ({ film: f.slug, ...f.cost_usd.this_phase }));
const phaseSonnet = phase.reduce((a, x) => a + x.sonnet, 0);
const phaseJev = phase.reduce((a, x) => a + x.jev, 0);
const summary = {
  generated_at: new Date().toISOString(),
  definitions: {
    skip_minutes: 'union of the moment-finder skip spans of flagged v5 scenes (r1); whole scene where the finder fell back',
    baseline_minutes: 'union of all baseline (live DB) scene spans',
    v4_flagged_minutes: 'v4 summary.json flagged_minutes_v4 (union of flagged v4 scene spans)',
    covered_by_skip: 'baseline scene >= 50% of its time inside v5 skip spans',
    covered_by_flagged_scenes: 'baseline scene >= 50% inside flagged v5 scenes extended to the next scene start (v4 method)',
    outside: 'flagged v5 scene with zero overlap with every baseline scene',
    material_overlap: '>= min(10 s, half the shorter scene)',
    tag_agreement: 'baseline is the reference: P = share of v5 tags the baseline also has, R = share of baseline tags v5 also has; micro over baseline scenes covered by flagged v5 scenes; item = v3 ids, group = 13 v3 groups; film-specific presence tags excluded',
    v4_known_misses: 'v4 scenes the round-0 verifiers found that the live DB misses; found = >= 50% of the v4 scene inside flagged v5 scenes (extended); found_in_skip = >= 50% inside skip spans',
    gold: 'secondary, Claude-drafted UNREVIEWED references scored with score.js on 5 s bins at tolerance 0 (v4 method)',
  },
  policy: { file: 'policy.json', asrun_file: 'out/asrun/policy.asrun.json', note: 'v5.1-offline: select-only changes justified on Nemo / Monsters, Inc. and applied unchanged to Lion King (see policy.json _retold_change_v5_1, flag.requires, film_specific, scene_bounds, moments._pad_about). No model calls.' },
  freeze_check: freezeCheck,
  films: perFilm,
  phase_spend_usd: { sonnet: r3(phaseSonnet), jev: Number(phaseJev.toFixed(6)), total: Number((phaseSonnet + phaseJev).toFixed(6)), by_film: phase, caps: PHASE_CAP, since: PHASE_START },
  review: { file: path.relative(here, reviewFile), found: countKinds(reviewItems), kept: kept.length, dropped: dropped.length },
  problems,
};
fs.writeFileSync(path.join(here, 'out', 'summary.json'), JSON.stringify(summary, null, 2));

// ---- print --------------------------------------------------------------------------------------------------------
for (const f of perFilm) {
  console.log(`\n=== ${f.slug} (${f.title})${f.held_out ? ' [HELD OUT]' : ''} ===`);
  console.log(`claim check: ${f.claim_check_line}`);
  if (f.asrun) console.log(`AS RUN${f.held_out ? ' (HELD-OUT RESULT)' : ''}: flagged ${f.asrun.flagged_scenes}; skip ${f.asrun.minutes.skip_v5_moments} min; baseline covered by skip ${f.asrun.baseline_covered_by_skip_spans}, by flagged ${f.asrun.baseline_covered_by_flagged_scenes}${f.held_out ? '  -- the lines below are POST-HOC for this film' : ''}`);
  console.log(`policy: dropped film items ${f.policy.film_items_dropped_by_policy.map((x) => x.id).join(',') || '-'}; wordless gap minutes now inside scenes ${f.policy.wordless_gap_minutes_added_to_scenes}`);
  console.log(`scenes ${f.scenes_total}, flagged ${f.flagged_scenes} (${RB}: ${f.flagged_scenes_r2}); baseline scenes ${f.baseline_scenes}`);
  console.log(`minutes: skip ${f.minutes.skip_v5_moments}, v5 flagged scenes ${f.minutes.flagged_scenes_v5}, baseline ${f.minutes.baseline_scenes}, v4 flagged ${f.minutes.v4_flagged ?? 'n/a'} of ${f.minutes.film}`);
  console.log(`baseline covered: by skip ${f.baseline_covered_by_skip_spans}/${f.baseline_scenes}, by flagged scenes ${f.baseline_covered_by_flagged_scenes}/${f.baseline_scenes} (v4 ${f.v4_baseline_covered ?? 'n/a'}); not covered by skip: ${f.baseline_not_covered_by_skip.join(',') || '-'}`);
  console.log(`v5 flags outside baseline ${f.v5_flags_outside_baseline} (${f.v5_flags_outside_baseline_ids.join(',') || '-'}), mostly outside ${f.v5_flags_mostly_outside_baseline} (v4 outside ${f.v4_flags_outside_baseline ?? 'n/a'})`);
  console.log(`film-level notes: ${f.film_level_notes.map((n) => `${n.id} ${n.scenes}/${n.of}`).join(', ') || 'none'}`);
  console.log(`film-specific: ${f.film_specific.questions} questions; ${f.film_specific_line}`);
  console.log(`v4 misses: ${f.v4_known_misses_line}`);
  console.log(`v4 causes: ${f.v4_false_flag_causes_line}`);
  const a = f.tag_agreement;
  console.log(`tag agreement on ${a.covered_baseline_scenes} scenes: item P ${a.item_v3.precision} R ${a.item_v3.recall} F1 ${a.item_v3.f1} J ${a.item_v3.mean_jaccard}; group P ${a.group_13.precision} R ${a.group_13.recall} F1 ${a.group_13.f1} J ${a.group_13.mean_jaccard}${f.v4_tag_agreement ? ` (v4 item F1 ${f.v4_tag_agreement.item_f1}, group F1 ${f.v4_tag_agreement.group_f1})` : ''}`);
  console.log(`  misses: ${a.baseline_items_v5_misses_top.join(', ')} | extras: ${a.v5_items_baseline_lacks_top.join(', ')}`);
  console.log(`stability: ${f.stability_line}`);
  console.log(`cost ${JSON.stringify(f.cost_usd)}\nwall ${JSON.stringify(f.wall_s)}`);
  if (f.gold_secondary) console.log(`GOLD (UNREVIEWED) ${f.gold_secondary.label_space}, floor ${f.gold_secondary.flag_everything_any_f1_floor}\n  v5 flagged ${JSON.stringify(f.gold_secondary.v5_flagged_scenes)}\n  v5 skip    ${JSON.stringify(f.gold_secondary.v5_skip_spans)}\n  baseline   ${JSON.stringify(f.gold_secondary.baseline)}${f.gold_secondary.v4_flagged_scenes ? `\n  v4 flagged ${JSON.stringify(f.gold_secondary.v4_flagged_scenes)}` : ''}`);
}
console.log(`\nreview: found ${JSON.stringify(countKinds(reviewItems))}; kept ${kept.length}, dropped ${dropped.length} -> ${path.relative(here, reviewFile)}`);
console.log(`phase spend: sonnet $${phaseSonnet.toFixed(4)}, jev $${phaseJev.toFixed(4)}, total $${(phaseSonnet + phaseJev).toFixed(4)} of $${PHASE_CAP.total}`);
if (freezeCheck) console.log(`freeze check: changed since ${freezeCheck.frozen_at}: ${freezeCheck.changed_since_freeze.join(', ') || 'none'}`);
if (problems.length) console.log(`problems:\n  ${problems.join('\n  ')}`);
