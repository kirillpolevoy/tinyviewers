#!/usr/bin/env node
// v7 scoring (v6's compare.js, relabelled). Pure code: no model calls, no network, no database.
// v7 adds, per dev film: ROUND 2 AS RUN (../v6/out/<slug>.tags.r1.json skip spans, read-only) scored
// with the same functions -- the 'before' of the v7 span and split changes -- and a code-computed
// verdict v7 vs round 2 (compareSystems, jitter); and the split-gate summary from the segments file.
// Held-out films have no round-2 output and get none.
//
//   node compare.js [--films nemo,monsters-inc,lion-king,frankenweenie,wild-robot] [--runs r1,r2]
//                   [--refs ../refs]         (V7_OUT selects the output directory, default out/)
//
// PRIMARY: the HUMAN-WRITTEN reference key, refs/<slug>.key.json (IMDb Parents Guide / Kids-In-Mind
// moments mapped to subtitle cues by Codex; DoesTheDogDie topic votes). refscore.js defines the
// metrics; the SAME functions score v7 and the live DB, so the two can be compared:
//   recall (items and same-moment clusters) of should_flag items, found when >= 50% of the item's
//   span is inside the skip spans, on the strict span AND on the gap window; tag-only (comic) items
//   flagged (target 0); precision proxy = share of skip minutes overlapping a mapped should_flag
//   item (and, for v7, or a live-DB scene), with minutes over comic/false items reported as a cost;
//   mapping-error sensitivity (+-15/30 s shifts, 300 seeded +-30 s jitter runs); a code-computed
//   verdict v7 vs live DB (refscore.js compareSystems); unmappable items apart; DTDD agreement.
// SECONDARY: the live DB baseline, exactly what scene-api/load.js loads (imported read-only): baseline
// scenes covered (>= 50% inside v7 skip spans / flagged scenes), v7 flags outside it, tag agreement.
// The reference key is never read by anything but this file and refscore.js.
//
// Writes <out>/summary.json and <out>/explain.json (every missed should_flag item and every v7 flag
// that matches neither the key nor the live DB, with the scene evidence needed to classify the cause;
// no subtitle or reference text beyond the key's own short paraphrases).

import fs from 'node:fs';
import path from 'node:path';
import { parseSrt, formatTime } from '../srt.js';
import * as T3 from '../taxonomy-v3.js';
import * as L from '../../../scene-api/load.js';
import { V7, TS, outDir, HELD_OUT, DEV_FILMS, freezeStatus } from './env.js';
import { readLedger } from './ledger.js';
import { ITEMS } from './questions.js';
import { scoreKey, dtddAgreement, union, total, inter, sensitivity, compareSystems, JITTER, DECISIVE_SHARE } from './refscore.js';

const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const FILMS = opt('films', DEV_FILMS.join(',')).split(',');
const ROUND2 = path.resolve(V7, opt('round2', '../v6/out'));
const [RA, RB] = opt('runs', 'r1,r2').split(',');
const REFS = path.resolve(V7, opt('refs', '../refs'));
const OUT = outDir();

const r3 = (x) => (x == null ? null : Math.round(x * 1000) / 1000);
const min = (ms) => r3(ms / 60000);
const readJson = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const exists = (f) => fs.existsSync(f);
const cueNum = (c) => (typeof c === 'number' ? c : Number(String(c).replace(/^C0*/, '')));
const overlap = (a0, a1, b0, b1) => Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));
const hms = (ms) => formatTime(ms);
const inc = (o, k, n = 1) => { o[k] = (o[k] ?? 0) + n; };
function prf(tp, fp, fn) {
  const p = tp + fp ? tp / (tp + fp) : null;
  const r = tp + fn ? tp / (tp + fn) : null;
  const f = p != null && r != null && p + r > 0 ? (2 * p * r) / (p + r) : p == null && r == null ? null : 0;
  return { tp, fp, fn, precision: r3(p), recall: r3(r), f1: r3(f) };
}
const V3 = T3.BY_ID;
const groupOfV3 = (id) => V3[id]?.group ?? null;

// ---- live DB baseline via the loader (read-only) ---------------------------------------------------
const ctx = await L.openExperiment(TS);
const v2map = L.buildV2Map(ctx.taxonomy);
const vocabIds = new Set(L.buildVocabulary(ctx.taxonomy).items.map((i) => i.id));
function baselineFor(slug) {
  try {
    const inputs = L.readFilmInputs(slug, ctx);
    const built = L.buildFilmFrom(inputs, { srt: ctx.srt, v2map, vocabIds });
    const scenes = built.scenes.map((s) => {
      const tags = built.labels.filter((l) => l.scene_id === s.id && l.asserted && l.channel !== 'mention').map((l) => l.vocabulary_id);
      return { id: s.id.split(':').pop(), title: s.title, start_ms: s.start_ms, end_ms: s.end_ms, start_cue: cueNum(s.start_cue), end_cue: cueNum(s.end_cue), items: new Set(tags), groups: new Set(tags.map(groupOfV3).filter(Boolean)) };
    });
    return { files: { scenes: inputs.sceneSourceFile, presence: inputs.presenceSourceFile }, scenes };
  } catch (err) {
    return { error: err.message, scenes: [] };
  }
}

// ---- v7 --------------------------------------------------------------------------------------------
// Film-specific PRESENCE ('<name> is in this scene') is who is on screen, not a concern: left out of
// tag agreement (it never flags either).
const concernTag = (t) => !(t.film_specific && t.type === 'presence');
function v7For(slug, run) {
  const tags = readJson(path.join(OUT, `${slug}.tags.${run}.json`));
  const jev = readJson(path.join(OUT, `${slug}.jev.${run}.json`));
  const jevById = new Map(jev.scenes.map((s) => [s.id, s]));
  const scenes = tags.scenes.map((s) => {
    const act = (s.tags ?? []).filter((t) => t.level === 'act');
    const concern = act.filter(concernTag);
    return {
      id: s.id, start_ms: s.start_ms, end_ms: s.end_ms, line_start_ms: s.line_start_ms ?? s.start_ms, line_end_ms: s.line_end_ms ?? s.end_ms,
      start_cue: s.start_cue, end_cue: s.end_cue, flagged: s.flagged, flag_reasons: s.flag_reasons ?? [], context_reasons: s.context_reasons ?? [],
      act, severity: s.severity, modifiers: s.modifiers, cancelled: s.cancelled ?? [], skip: s.skip ?? null, unclassified: s.unclassified ?? null,
      items: new Set(concern.map((t) => t.v3).filter(Boolean)), groups: new Set(concern.map((t) => t.group)),
      jev: jevById.get(s.id),
    };
  });
  return { tags, jev, scenes };
}

const perFilm = [];
const explain = [];
const problems = [];

for (const slug of FILMS) {
  const need = [`${slug}.segments.json`, `${slug}.tags.${RA}.json`, `${slug}.jev.${RA}.json`];
  const missing = need.filter((f) => !exists(path.join(OUT, f)));
  if (missing.length) { problems.push(`${slug}: missing ${missing.join(', ')} in ${path.relative(V7, OUT)}; film skipped`); continue; }
  const held = HELD_OUT.has(slug);
  const seg = readJson(path.join(OUT, `${slug}.segments.json`));
  const A = v7For(slug, RA);
  const B = RB && exists(path.join(OUT, `${slug}.tags.${RB}.json`)) && exists(path.join(OUT, `${slug}.jev.${RB}.json`)) ? v7For(slug, RB) : null;
  const cues = parseSrt(fs.readFileSync(path.join(TS, 'data', `${slug}.srt`), 'utf8'));
  const filmEndMs = cues[cues.length - 1].endMs;
  const base = baselineFor(slug);
  if (base.error) problems.push(`${slug}: live DB baseline unavailable (${base.error})`);
  const momFile = path.join(OUT, `${slug}.moments.${RA}.json`);
  const mom = exists(momFile) ? readJson(momFile) : null;
  if (!mom) problems.push(`${slug}: no moments file for ${RA}; skip = whole flagged scenes`);

  const flagged = A.scenes.filter((s) => s.flagged);
  const skipSpans = flagged.flatMap((s) => (s.skip?.spans ?? []).map((x) => [x.start_ms, x.end_ms]));
  const skipU = union(skipSpans);
  const flaggedU = union(flagged.map((s) => [s.start_ms, s.end_ms]));
  const baseU = union(base.scenes.map((b) => [b.start_ms, b.end_ms]));

  // ---- claim check (verified share), with v5's for the dev films ------------------------------------
  const verifiedShare = (sg) => {
    const sent = sg.scenes.flatMap((s) => s.sentences ?? []);
    const cc = sg.claim_check ?? {};
    const ms = (s) => s.end_ms - s.start_ms;
    const summarised = sg.scenes.filter((s) => s.summary);
    return {
      sentences_verified: `${sent.filter((x) => x.check?.status === 'verified').length}/${sent.length}`,
      scenes_with_verified_summary: `${summarised.length}/${sg.scenes.length}`,
      minutes_with_verified_summary: `${min(summarised.reduce((a, s) => a + ms(s), 0))}/${min(sg.scenes.reduce((a, s) => a + ms(s), 0))}`,
      by_type: cc.by_type ?? null, rule: cc.rule ?? (cc.auto_accept ? `supports at confidence >= ${cc.auto_accept}` : null), cost_usd: cc.cost_usd ?? null,
    };
  };
  const v5seg = path.join(TS, 'v5', 'out', `${slug}.segments.json`);
  const claimCheck = { v7: verifiedShare(seg), ...(!held && exists(v5seg) ? { v5_round1: verifiedShare(readJson(v5seg)) } : {}) };

  // ---- live DB (secondary) ---------------------------------------------------------------------------
  const baseRows = base.scenes.map((b) => {
    const dur = Math.max(1, b.end_ms - b.start_ms);
    return { b, covSkip: inter(skipU, [[b.start_ms, b.end_ms]]) / dur, covFlag: inter(flaggedU, [[b.start_ms, b.end_ms]]) / dur };
  });
  const outsideBase = flagged.filter((v) => !base.scenes.some((b) => overlap(v.line_start_ms, v.line_end_ms, b.start_ms, b.end_ms) > 0));
  // tag agreement on baseline scenes >= 50% covered by flagged scenes (v4/v5 method)
  const agg = { item: { tp: 0, fp: 0, fn: 0 }, group: { tp: 0, fp: 0, fn: 0 } };
  for (const r of baseRows.filter((x) => x.covFlag >= 0.5)) {
    const mat = flagged.filter((v) => overlap(v.start_ms, v.end_ms, r.b.start_ms, r.b.end_ms) >= Math.min(10_000, 0.5 * Math.min(v.end_ms - v.start_ms, r.b.end_ms - r.b.start_ms)));
    const vi = new Set(mat.flatMap((v) => [...v.items]));
    const vg = new Set(mat.flatMap((v) => [...v.groups]));
    for (const [k, bs, vs] of [['item', r.b.items, vi], ['group', r.b.groups, vg]]) {
      let tp = 0; for (const x of vs) if (bs.has(x)) tp++;
      agg[k].tp += tp; agg[k].fp += vs.size - tp; agg[k].fn += bs.size - tp;
    }
  }
  const liveDb = {
    scenes: base.scenes.length, minutes: min(total(baseU)),
    covered_by_skip: `${baseRows.filter((r) => r.covSkip >= 0.5).length}/${base.scenes.length}`,
    covered_by_flagged_scenes: `${baseRows.filter((r) => r.covFlag >= 0.5).length}/${base.scenes.length}`,
    not_covered_by_skip: baseRows.filter((r) => r.covSkip < 0.5).map((r) => `${r.b.id} ${Math.round(r.covSkip * 100)}%`),
    v7_flags_outside: outsideBase.map((v) => v.id),
    tag_agreement: { item_v3: prf(agg.item.tp, agg.item.fp, agg.item.fn), group_13: prf(agg.group.tp, agg.group.fp, agg.group.fn) },
  };

  const onlyBy = (pred) => flagged.filter((v) => v.flag_reasons.length && v.flag_reasons.every(pred)).map((v) => v.id);
  const onlyThreat = onlyBy((r) => ['threatens_harm', 'plots_harm'].includes(r.id) || /_threatens$/.test(r.id));
  const onlyChild = onlyBy((r) => r.id === 'child_frightened');
  const onlyRule12 = onlyBy((r) => ['threatens_harm', 'plots_harm', 'child_frightened'].includes(r.id) || /_threatens$/.test(r.id));

  // ---- reference key (primary) -----------------------------------------------------------------------
  const keyFile = path.join(REFS, `${slug}.key.json`);
  let reference = null;
  if (!exists(keyFile)) problems.push(`${slug}: no reference key ${path.relative(V7, keyFile)}`);
  else {
    const key = readJson(keyFile);
    const dbSpans = base.scenes.map((b) => [b.start_ms, b.end_ms]);
    const v7Score = scoreKey(key, skipSpans, { liveDb: base.scenes.length ? dbSpans : null });
    const v7Gap = scoreKey(key, skipSpans, { liveDb: base.scenes.length ? dbSpans : null, window: 'gap' });
    const v7ByScenes = scoreKey(key, flagged.map((s) => [s.start_ms, s.end_ms]));
    const v7ByScenesGap = scoreKey(key, flagged.map((s) => [s.start_ms, s.end_ms]), { window: 'gap' });
    const dbScore = base.scenes.length ? scoreKey(key, dbSpans) : null;
    const dbGap = base.scenes.length ? scoreKey(key, dbSpans, { window: 'gap' }) : null;
    const sens = base.scenes.length ? sensitivity(key, skipSpans, dbSpans) : null;
    // round 2 as run (the 'before'), dev films only
    const r2File = path.join(ROUND2, `${slug}.tags.r1.json`);
    let round2 = null;
    if (!held && exists(r2File)) {
      const r2 = readJson(r2File);
      const r2Skip = r2.scenes.filter((x) => x.flagged).flatMap((x) => (x.skip?.spans ?? []).map((y) => [y.start_ms, y.end_ms]));
      const r2s = scoreKey(key, r2Skip, { liveDb: base.scenes.length ? dbSpans : null });
      const r2g = scoreKey(key, r2Skip, { liveDb: base.scenes.length ? dbSpans : null, window: 'gap' });
      const sensR2 = sensitivity(key, skipSpans, r2Skip);
      round2 = { file: path.relative(V7, r2File), scenes: r2.scenes.length, flagged: r2.scenes.filter((x) => x.flagged).length, strict: r2s, gap: r2g, sens: sensR2, verdict: compareSystems({ aStrict: v7Score, aGap: v7Gap, bStrict: r2s, bGap: r2g, sens: sensR2 }) };
    }
    const verdict = base.scenes.length ? compareSystems({ aStrict: v7Score, aGap: v7Gap, bStrict: dbScore, bGap: dbGap, sens }) : null;
    // the key barely covers policy rules 1 (explicit villain threat) and 2 (child terrified): precision
    // with and without the v7 scenes flagged ONLY for a threat, a plan to harm or a frightened child
    const noRule12 = flagged.filter((s) => !onlyRule12.includes(s.id)).flatMap((s) => (s.skip?.spans ?? []).map((x) => [x.start_ms, x.end_ms]));
    const flagTrue = key.items.filter((i) => i.should_flag === true);
    const rule12 = {
      key_items_marked: { villain_threat: flagTrue.filter((i) => i.policy?.villain_threat).length, child_terrified: flagTrue.filter((i) => i.policy?.child_terrified).length, of_should_flag: flagTrue.length },
      v7_scenes_flagged_only_by_rule_1_or_2: onlyRule12,
      minutes_only_by_rule_1_or_2: min(total(union(flagged.filter((s) => onlyRule12.includes(s.id)).flatMap((s) => (s.skip?.spans ?? []).map((x) => [x.start_ms, x.end_ms]))))),
      v7_without_those_scenes: (() => { const a = scoreKey(key, noRule12); const g = scoreKey(key, noRule12, { window: 'gap' }); return { skip_minutes: a.skip_minutes, recall_strict: `${a.recall_items.found}/${a.recall_items.of}`, recall_gap: `${g.recall_items.found}/${g.recall_items.of}`, precision_strict: a.precision_proxy_ref_only, precision_gap: g.precision_proxy_ref_only }; })(),
      note: 'Parent guides describe physical peril, not spoken threats or a child\'s fear; the key cannot test policy rules 1 and 2, and its precision proxy counts rule-1/2 flags as misses of the key.',
    };
    const actTags = A.scenes.flatMap((s) => s.act.map((t) => ({ id: t.id, group: t.group })));
    const dbTags = base.scenes.flatMap((b) => [...b.items].map((id) => ({ id, group: groupOfV3(id) })));
    const dtddV7 = dtddAgreement(key, actTags);
    const dtddDb = base.scenes.length ? dtddAgreement(key, dbTags, { toId: (id) => ITEMS[id]?.v3 ?? id }) : null;
    const brief = (s) => s && { recall_items: s.recall_items, recall_moments: s.recall_moments, recall_by_policy: s.recall_by_policy, tag_only: { items: s.tag_only.items, flagged: s.tag_only.flagged, flagged_ids: s.tag_only.flagged_ids }, should_not_flag_items_skipped: s.should_not_flag_items_skipped, skip_minutes: s.skip_minutes, precision_proxy_ref_only: s.precision_proxy_ref_only, precision_proxy_ref_or_live_db: s.precision_proxy_ref_or_live_db, precision_proxy_any_item: s.precision_proxy_any_item, skip_minutes_over_non_flag_items: { tag_only: s.skip_minutes_over_non_flag_items.tag_only, should_flag_false: s.skip_minutes_over_non_flag_items.should_flag_false }, found_should_flag_per_skip_minute: s.found_should_flag_per_skip_minute };
    const dtddBrief = (d) => d && { topics: d.topics, scored: d.scored, agree: d.agree, tp: d.tp, tn: d.tn, fp: d.fp, fn: d.fn, unscored: d.unscored, coarse_groups: d.coarse_groups, disagreements: d.rows.filter((r) => r.agree === false && r.target.kind === 'tags').map((r) => `${r.id} '${r.text}' DTDD ${r.answer}, system ${r.v6} [${r.target.ids.join('|')}]`) };
    reference = {
      file: path.relative(V7, keyFile), sources_used: (key.sources_used ?? []).map((s) => s.source), counts: key.counts ?? null,
      items: v7Score.items_total, mapped: v7Score.mapped, unmappable: v7Score.unmappable.length, unmappable_items: v7Score.unmappable,
      v7_skip: brief(v7Score), v7_flagged_scenes: brief(v7ByScenes), live_db: brief(dbScore),
      gap_window: { v7_skip: brief(v7Gap), v7_flagged_scenes: brief(v7ByScenesGap), live_db: brief(dbGap) },
      sensitivity_v7_vs_live_db: sens,
      verdict_v7_vs_live_db: verdict,
      policy_rules_1_2: rule12,
      round2_as_run: round2 && { file: round2.file, scenes: round2.scenes, flagged: round2.flagged, skip: brief(round2.strict), gap_window: brief(round2.gap), sensitivity_v7_vs_round2: round2.sens, verdict_v7_vs_round2: round2.verdict },
      dtdd: { v7: dtddBrief(dtddV7), live_db: dtddBrief(dtddDb) },
    };
    // explanations: every missed should_flag item, with the scenes it overlaps
    for (const m of v7Score.missed) {
      const it = key.items.find((x) => x.id === m.id);
      const touching = A.scenes.filter((s) => overlap(s.start_ms, s.end_ms, m.start_ms, Math.max(m.end_ms, m.start_ms + 1)) > 0);
      explain.push({
        film: slug, held_out: held, kind: 'missed_should_flag', item: { id: m.id, source: m.source, text: it?.text ?? null, categories: m.categories, policy: m.policy, time: `${hms(m.start_ms)}-${hms(m.end_ms)}`, cue_range: it?.cue_range ?? null, wordless: it?.wordless ?? null, map_confidence: it?.map_confidence ?? null },
        share_in_v7_skip: m.share_in_skip, share_in_flagged_scenes: r3(v7ByScenes.rows.find((r) => r.id === m.id)?.share_in_skip ?? 0), share_in_live_db: r3(dbScore?.rows.find((r) => r.id === m.id)?.share_in_skip ?? null),
        v7_scenes: touching.map((s) => ({
          id: s.id, time: `${hms(s.start_ms)}-${hms(s.end_ms)}`, cues: `${s.start_cue}-${s.end_cue}`, flagged: s.flagged, flag_reasons: s.flag_reasons.map((r) => r.id), context_reasons: s.context_reasons.map((r) => r.id),
          skip: s.skip ? s.skip.spans.map((x) => `${hms(x.start_ms)}-${hms(x.end_ms)}`) : null,
          act_tags: s.act.map((t) => `${t.id}:${t.p}`), cancelled_at_act: s.cancelled.filter((c) => c.level === 'act').map((c) => `${c.id}(${c.by.join('+')})`),
          near_misses: Object.entries(s.jev?.answers?.e ?? {}).filter(([, p]) => p >= 0.5 && p < 0.7).map(([k, p]) => `${k}:${r3(p)}`),
          modifiers: { retold: s.modifiers?.retold?.on, imagined: s.modifiers?.imagined?.on, comic: s.modifiers?.comic?.laughs, comic_peril: s.modifiers?.comic_peril?.on },
          danger: r3(s.jev?.answers?.s?.danger?.score ?? null), summary_empty: s.jev?.summary_empty ?? null,
        })),
      });
    }
    // v7 flags whose skip matches neither the key nor the live DB
    const refU = union(key.items.filter((x) => x.mappable && Number.isFinite(x.start_ms)).map((x) => [x.start_ms, x.end_ms]));
    for (const s of flagged) {
      const sp = union((s.skip?.spans ?? []).map((x) => [x.start_ms, x.end_ms]));
      if (inter(sp, refU) > 0 || inter(sp, baseU) > 0) continue;
      explain.push({ film: slug, held_out: held, kind: 'v7_flag_matching_neither', scene: { id: s.id, time: `${hms(s.start_ms)}-${hms(s.end_ms)}`, cues: `${s.start_cue}-${s.end_cue}`, flag_reasons: s.flag_reasons.map((r) => `${r.id}:${r.p}`), act_tags: s.act.map((t) => t.id), modifiers: { comic: s.modifiers?.comic?.laughs, comic_peril: s.modifiers?.comic_peril?.on }, danger: r3(s.jev?.answers?.s?.danger?.score ?? null), skip_s: Math.round((s.skip?.ms ?? 0) / 1000) } });
    }
  }

  // ---- wordless coverage ------------------------------------------------------------------------------
  const gapMs = A.scenes.reduce((a, v) => a + Math.max(0, v.line_start_ms - v.start_ms) + Math.max(0, v.end_ms - v.line_end_ms), 0);
  const leadIns = flagged.flatMap((s) => (s.skip?.spans ?? []).filter((x) => x.lead_in));

  // ---- stability ---------------------------------------------------------------------------------------
  let stability = null;
  if (B) {
    const bById = new Map(B.scenes.map((s) => [s.id, s]));
    const flips = A.scenes.filter((a) => bById.get(a.id) && a.flagged !== bById.get(a.id).flagged).map((a) => a.id);
    let tagFlips = 0; let tagUnion = 0;
    for (const a of A.scenes) {
      const b = bById.get(a.id); if (!b) continue;
      const ta = new Set(a.act.map((t) => t.id)); const tb = new Set(b.act.map((t) => t.id));
      const u = new Set([...ta, ...tb]); tagUnion += u.size; for (const x of u) if (ta.has(x) !== tb.has(x)) tagFlips++;
    }
    stability = { runs: [RA, RB], flagged: [flagged.length, B.scenes.filter((s) => s.flagged).length], flag_flips: flips, act_tag_flips: `${tagFlips}/${tagUnion}` };
  }

  // ---- film-specific + reasons ---------------------------------------------------------------------------
  const reasonCounts = {};
  for (const v of flagged) for (const r of v.flag_reasons) inc(reasonCounts, r.id);

  // ---- cost ------------------------------------------------------------------------------------------------
  const ledger = readLedger(slug).entries;
  const cost = {
    segment_sonnet: seg.cost_usd ?? null, claim_check_jev: seg.claim_check?.cost_usd ?? null,
    classify_jev_r1: A.jev.cost_usd, classify_jev_r2: B?.jev.cost_usd ?? null, moments_jev_r1: mom?.cost_usd ?? null,
    ledger: { sonnet: r3(ledger.filter((e) => e.kind === 'sonnet').reduce((a, e) => a + e.usd, 0)), jev: Number(ledger.filter((e) => e.kind === 'jev').reduce((a, e) => a + e.usd, 0).toFixed(6)) },
  };

  perFilm.push({
    slug, title: seg.film.title, held_out: held,
    segmentation: { scenes: seg.scenes.length, model: seg.model ?? null, prompt_version: seg.prompt_version ?? null, effort: seg.effort ?? null, cast: seg.cast.length, dangers: seg.dangers.length, minutes_per_scene: seg.validation?.minutes_per_scene ?? null, accepted_attempt: seg.accepted_attempt ?? null, attempts: (seg.segmentation_attempts ?? []).map((a) => ({ attempt: a.attempt, mode: a.mode, gate: a.gate?.pass ?? null, failed: a.gate?.failed ?? [], cost_usd: a.cost_usd })) },
    split_check: seg.split_check ? { pass: seg.split_check.pass, label: seg.split_check.label ?? `attempt ${seg.split_check.attempt}`, code: seg.split_check.code?.metrics, jev: seg.split_check.jev?.metrics, jev_run: seg.split_check.jev?.run ? { requests: seg.split_check.jev.run.requests, cost_usd: seg.split_check.jev.run.cost_usd, wall_ms: seg.split_check.jev.run.wall_ms, latency_ms: seg.split_check.jev.run.latency_ms } : null } : null,
    claim_check: claimCheck,
    flagged_scenes: flagged.length, flagged_scenes_r2: B ? B.scenes.filter((s) => s.flagged).length : null, scenes_total: A.scenes.length,
    minutes: { film: min(filmEndMs), skip: min(total(skipU)), flagged_scenes: min(total(flaggedU)), live_db_scenes: min(total(baseU)), wordless_gaps_inside_scenes: min(gapMs), lead_in_spans: leadIns.length },
    moments: mom ? { requests: mom.requests, whole_scene_fallbacks: Object.entries(mom.scenes).filter(([, m]) => m.method !== 'moments').map(([id, m]) => `${id} (${String(m.why ?? '').split(':')[0]})`) } : null,
    reference, live_db: liveDb,
    film_level_notes: A.tags.summary.film_level_notes,
    flag_reason_counts: Object.fromEntries(Object.entries(reasonCounts).sort((a, b) => b[1] - a[1])),
    flagged_only_by_threat_or_plan: onlyThreat,
    flagged_only_by_child_frightened: onlyChild,
    comic_peril_scenes: A.scenes.filter((s) => s.modifiers?.comic_peril?.on).map((s) => s.id),
    film_items: (A.jev.film_items ?? []).map((it) => `${it.id} (${it.name}, ${it.type}, ${it.why})`),
    stability, cost_usd: cost,
  });
}

const freeze = freezeStatus();
const summary = {
  generated_at: new Date().toISOString(),
  out_dir: path.relative(V7, OUT),
  definitions: {
    reference_key: 'refs/<slug>.key.json: human-written advisories (IMDb Parents Guide, Kids-In-Mind; DoesTheDogDie votes) mapped to subtitle cues by Codex. Scoring only.',
    recall_items: 'should_flag === true mapped items with >= 50% of their span inside the skip spans',
    recall_moments: 'same, per cluster of items linked by same_moment_as (found when any mapped member is found)',
    tag_only: "should_flag === 'tag_only' mapped items (comic peril) >= 50% inside skip spans: should be 0",
    precision_proxy: 'share of skip minutes overlapping a mapped should_flag === true item (ref_only), or such an item or a live-DB scene (ref_or_live_db). Minutes over comic (tag_only) or should_flag:false items only are a separate cost (skip_minutes_over_non_flag_items). precision_proxy_any_item is the pre-fix definition (overlap with any mapped item, incl. comic and false items)',
    windows: "reference.* scores the strict item span (start_ms..end_ms); reference.gap_window.* the tolerance window gap_start_ms..gap_end_ms (to the neighbouring cues). A wider window is harder to cover by 50%, so gap recall can be lower",
    sensitivity: `every item shifted ${JITTER.shifts_s.join('/')} s, and ${JITTER.runs} seeded runs (seed ${JITTER.seed}) moving each item's start and end independently by up to ${JITTER.max_ms / 1000} s; strict span`,
    verdict: `code-computed (refscore.js compareSystems): recall differs only when the conservative recall (min of strict, gap) differs and >= ${DECISIVE_SHARE * 100}% of jitter runs agree; precision only when strict and gap agree and >= ${DECISIVE_SHARE * 100}% of jitter runs agree; otherwise tie`,
    live_db_on_the_key: "the live DB's scene spans scored with the same functions (its 'skip' = every live-DB scene)",
    dtdd: 'DoesTheDogDie topics with a yes/no answer; v7 yes when any scene has an act-level tag the topic maps to (refscore.js dtddTargets)',
    live_db_coverage: 'live-DB scene >= 50% of its time inside v7 skip spans / flagged scenes; outside = flagged v7 scene whose dialogue bounds overlap no live-DB scene',
  },
  freeze: freeze.missing ? 'no out/freeze.json' : { frozen_at: freeze.frozen_at, intact: freeze.ok, changed: freeze.changed },
  films: perFilm,
  verdict_v7_vs_live_db: Object.fromEntries(perFilm.filter((f) => f.reference?.verdict_v7_vs_live_db).map((f) => { const v = f.reference.verdict_v7_vs_live_db; const w = (x) => (x === 'A' ? 'v7' : x === 'B' ? 'live DB' : 'tie'); return [f.slug, { held_out: f.held_out, recall: w(v.recall), precision: w(v.precision), overall: v.overall === 'A' ? 'v7' : v.overall === 'B' ? 'live DB' : v.overall, conservative_recall: `${v.conservative_recall.a} vs ${v.conservative_recall.b} of ${v.conservative_recall.of}`, precision_strict: `${v.precision_strict.a} vs ${v.precision_strict.b}`, precision_gap: `${v.precision_gap.a} vs ${v.precision_gap.b}`, skip_minutes: `${v.skip_minutes.a} vs ${v.skip_minutes.b}` }]; })),
  verdict_v7_vs_round2: Object.fromEntries(perFilm.filter((f) => f.reference?.round2_as_run).map((f) => { const r = f.reference.round2_as_run; const v = r.verdict_v7_vs_round2; const w = (x) => (x === 'A' ? 'v7' : x === 'B' ? 'round 2' : 'tie'); return [f.slug, { recall: w(v.recall), precision: w(v.precision), overall: v.overall === 'A' ? 'v7' : v.overall === 'B' ? 'round 2' : v.overall, conservative_recall: `${v.conservative_recall.a} vs ${v.conservative_recall.b} of ${v.conservative_recall.of}`, precision_strict: `${v.precision_strict.a} vs ${v.precision_strict.b}`, precision_gap: `${v.precision_gap.a} vs ${v.precision_gap.b}`, skip_minutes: `${v.skip_minutes.a} vs ${v.skip_minutes.b}`, tag_only_flagged: `${f.reference.v7_skip.tag_only.flagged} vs ${r.skip.tag_only.flagged} of ${r.skip.tag_only.items}`, tag_only_minutes: `${f.reference.v7_skip.skip_minutes_over_non_flag_items.tag_only} vs ${r.skip.skip_minutes_over_non_flag_items.tag_only}`, jitter_recall_share_v7_ge_round2: r.sensitivity_v7_vs_round2.recall_diff_a_minus_b.share_a_ge_b }]; })),
  problems,
};
fs.writeFileSync(path.join(OUT, 'summary.json'), JSON.stringify(summary, null, 2));
fs.writeFileSync(path.join(OUT, 'explain.json'), JSON.stringify({ generated_at: summary.generated_at, note: 'Evidence for classifying each miss / unmatched flag (policy, wording, claim check, segmentation, wordless/visual, span, reference error). Key text is the key\'s own short paraphrase.', items: explain }, null, 2));

for (const f of perFilm) {
  console.log(`\n=== ${f.slug} (${f.title})${f.held_out ? ' [HELD OUT]' : ''} ===`);
  const cc = f.claim_check;
  if (f.split_check) console.log(`split gate: ${f.split_check.pass ? 'PASS' : 'FAIL'} (${f.split_check.label}); aligned ${f.split_check.jev?.aligned_share}, boundary AUC ${f.split_check.jev?.boundary_auc}, cited outside ${f.split_check.code?.cited_outside_share}; attempts ${f.segmentation.attempts.map((a) => `${a.attempt}:${a.mode}:${a.gate ? 'pass' : 'fail'}`).join(', ') || 'round-2 split reused'}`);
  console.log(`claim check: sentences ${cc.v7.sentences_verified} verified, ${cc.v7.scenes_with_verified_summary} scenes / ${cc.v7.minutes_with_verified_summary} min with a verified summary${cc.v5_round1 ? ` (v5: ${cc.v5_round1.sentences_verified}, ${cc.v5_round1.scenes_with_verified_summary}, ${cc.v5_round1.minutes_with_verified_summary} min)` : ''}`);
  console.log(`flagged ${f.flagged_scenes}/${f.scenes_total}${f.flagged_scenes_r2 != null ? ` (${RB}: ${f.flagged_scenes_r2})` : ''}; skip ${f.minutes.skip} min, flagged scenes ${f.minutes.flagged_scenes}, live DB ${f.minutes.live_db_scenes} of ${f.minutes.film}; lead-in spans ${f.minutes.lead_in_spans}`);
  if (f.reference) {
    const r = f.reference;
    const line = (n, s) => s && console.log(`  ${n.padEnd(14)} recall items ${s.recall_items.found}/${s.recall_items.of}, moments ${s.recall_moments.found}/${s.recall_moments.of}; villain ${s.recall_by_policy.villain_threat.found}/${s.recall_by_policy.villain_threat.n}, child ${s.recall_by_policy.child_terrified.found}/${s.recall_by_policy.child_terrified.n}; tag-only flagged ${s.tag_only.flagged}/${s.tag_only.items}; precision ref ${s.precision_proxy_ref_only}${s.precision_proxy_ref_or_live_db != null ? `, ref|DB ${s.precision_proxy_ref_or_live_db}` : ''}; skip ${s.skip_minutes} min; found/min ${s.found_should_flag_per_skip_minute}`);
    console.log(`reference ${r.file}: ${r.items} items, ${r.mapped} mapped, ${r.unmappable} unmappable; sources ${r.sources_used.join(',')}`);
    line('v7 skip', r.v7_skip); line('v7 scenes', r.v7_flagged_scenes); line('live DB', r.live_db);
    line('v7 skip gap', r.gap_window.v7_skip); line('live DB gap', r.gap_window.live_db);
    if (r.round2_as_run) { line('round 2', r.round2_as_run.skip); line('round 2 gap', r.round2_as_run.gap_window); const v = r.round2_as_run.verdict_v7_vs_round2; console.log(`  VERDICT v7 vs round 2: recall ${v.recall}, precision ${v.precision}, overall ${v.overall} (A = v7); conservative recall ${v.conservative_recall.a} vs ${v.conservative_recall.b}; jitter v7>=r2 ${r.round2_as_run.sensitivity_v7_vs_round2.recall_diff_a_minus_b.share_a_ge_b}`); }
    if (r.sensitivity_v7_vs_live_db) {
      const sx = r.sensitivity_v7_vs_live_db;
      console.log(`  shifts (v7/DB recall): ${Object.entries(sx.shifts).map(([k, x]) => `${k} ${x.a_recall}/${x.b_recall}`).join(', ')}; jitter recall diff p05..p95 ${sx.recall_diff_a_minus_b.p05}..${sx.recall_diff_a_minus_b.p95} (v7>DB ${sx.recall_diff_a_minus_b.share_a_gt_b}, v7<DB ${sx.recall_diff_a_minus_b.share_a_lt_b}); precision diff ${sx.precision_diff_a_minus_b.p05}..${sx.precision_diff_a_minus_b.p95} (v7>DB ${sx.precision_diff_a_minus_b.share_a_gt_b})`);
      const v = r.verdict_v7_vs_live_db;
      console.log(`  VERDICT recall ${v.recall}, precision ${v.precision}, overall ${v.overall} (A = v7, B = live DB); conservative recall ${v.conservative_recall.a} vs ${v.conservative_recall.b}`);
    }
    const q = r.policy_rules_1_2;
    console.log(`  rules 1/2: key marks villain ${q.key_items_marked.villain_threat}, child ${q.key_items_marked.child_terrified} of ${q.key_items_marked.of_should_flag}; v7 scenes only by rule 1/2: ${q.v7_scenes_flagged_only_by_rule_1_or_2.join(',') || '-'} (${q.minutes_only_by_rule_1_or_2} min); without them precision ${q.v7_without_those_scenes.precision_strict}/${q.v7_without_those_scenes.precision_gap} (strict/gap), recall ${q.v7_without_those_scenes.recall_strict}`);
    if (r.dtdd.v7) console.log(`  DTDD (${r.dtdd.v7.scored} of ${r.dtdd.v7.topics} topics map to specific tags) v7 agree ${r.dtdd.v7.agree}/${r.dtdd.v7.scored} (tp ${r.dtdd.v7.tp} tn ${r.dtdd.v7.tn} fp ${r.dtdd.v7.fp} fn ${r.dtdd.v7.fn})${r.dtdd.live_db ? `; live DB ${r.dtdd.live_db.agree}/${r.dtdd.live_db.scored} (tp ${r.dtdd.live_db.tp} tn ${r.dtdd.live_db.tn} fp ${r.dtdd.live_db.fp} fn ${r.dtdd.live_db.fn})` : ''}`);
  }
  const d = f.live_db;
  console.log(`live DB: covered by skip ${d.covered_by_skip}, by flagged ${d.covered_by_flagged_scenes}; v7 flags outside ${d.v7_flags_outside.length} (${d.v7_flags_outside.join(',') || '-'}); tag F1 item ${d.tag_agreement.item_v3.f1} group ${d.tag_agreement.group_13.f1}`);
  console.log(`reasons: ${Object.entries(f.flag_reason_counts).slice(0, 12).map(([k, n]) => `${k} ${n}`).join(', ')}; only threat/plan: ${f.flagged_only_by_threat_or_plan.join(',') || '-'}; only child_frightened: ${f.flagged_only_by_child_frightened.join(',') || '-'}; comic peril: ${f.comic_peril_scenes.join(',') || '-'}`);
  console.log(`film-level notes: ${f.film_level_notes.map((n) => `${n.id} ${n.scenes}/${n.of}`).join(', ') || 'none'}${f.stability ? `; stability flagged ${f.stability.flagged.join('/')}, flips ${f.stability.flag_flips.join(',') || '-'}, act-tag flips ${f.stability.act_tag_flips}` : ''}`);
  console.log(`cost ${JSON.stringify(f.cost_usd)}`);
}
console.log(`\nexplain: ${explain.length} items -> ${path.relative(V7, path.join(OUT, 'explain.json'))}; freeze ${JSON.stringify(summary.freeze)}`);
if (problems.length) console.log(`problems:\n  ${problems.join('\n  ')}`);
