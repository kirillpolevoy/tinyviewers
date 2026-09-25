#!/usr/bin/env node
// v10.2 (fixes 1-3, rule 1): after v10.1's per-scene policy, a flag reason must pass the TIER-A GATE (policy
// flag.gating, the pre-registered round-7 rule v10/prereg-tierA-gating.json): it may flag only when it comes from a
// tier-A Jev concept or a Sonnet-owned concept (split.json concepts); tier-B/C Jev reasons stay tags
// (gated_reasons). Rule 2: Sonnet's crying flags only when Jev says the one who cries is a child (no cast-child
// route). Fix 3: the RESOLUTION GUARD (resolve.js answers, answers.x.guard_*) cancels the Sonnet reasons it names in
// arrest / celebration / reunion scenes (guard_cancelled). Rule 1: the RULE-1 QUESTION (answers.x.r1_threat), when
// policy flag.rule1_question.enabled, adds a threatens_harm reason that passes the gate (tier A on the seen films).
// v10: select.js first COMBINES the raw v10 Jev answers (classify.js row.answers.q, one probability per
// jev-set.js question) into one probability per v9 id with questions.js conceptAnswers (combine.js
// expressions): answers.c[id] (presence and events), answers.d[id] (derived: jump_scare) and answers.cf[item]
// (film templates). Each has its concept's own act threshold (questions.js JEV_THRESHOLDS, merged into
// cfg.overrides as c.<id> / d.<id> / cf.<type> by withJevThresholds). Sonnet's ids still arrive through
// merge.js as pl / ps / e, exactly as in v9, and are read when an id has no c entry. Everything after the
// per-id probability (modifiers, cancellation, flag policy, severity, spans) is v9's code, unchanged.
// (v6 text follows.)
// v6 selection: pure code over Jev's raw answers (classify.js) and, when present, the moment finder's
// spans (moments.js). No model calls.
//
// v6: the user's flag policy (policy.json _about): threats / plans to kill or hurt and a child
// frightened or crying flag; comic peril (e.comic_peril AND the laughs Score) turns physical events
// into tags; ghosts and the undead need danger; generated threat items are never cancelled by retold
// or comic (FILM_CANCEL by item type, so saved v5 answers are re-selected under v6 rules too);
// v5.1's select-only stopgaps are gone. Whole-scene skips get the wordless lead-in (spans.js) when
// the SRT cues are passed.
//
//   node select.js <slug> [--run r1] [--policy policy.json]
//
// Reads out/<slug>.jev.<run>.json (+ out/<slug>.moments.<run>.json if it exists); writes
// out/<slug>.tags.<run>.json. Per scene:
//   1. modifiers: retold (only with the danger Score saying the danger is not here), imagined, comic
//      (s.laughs Score)
//   2. universal presence tags from two channels (lines / summary), source lines|summary|both; kind
//      gate for shark / large_predator; mention-only
//   3. universal events at act / possible, modifier cancellation; jump_scare derived from two events
//   4. film-specific tags (presence on two channels, threatens / child in danger / danger used)
//   5. flag reasons from policy.flag (narrow lists); film-level context removed from the reasons
//   6. severity per age band (content term capped); skip spans from moments or the whole scene
// Per film (two passes): film-level context notes (an item at act in >= 60% of scenes), chips.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PRESENCE, EVENTS, SCORES, GROUPS, ITEMS, DERIVED, FILM_CANCEL, conceptAnswers, JEV_THRESHOLDS } from './questions.js';
import { sceneBounds, wholeSceneSpan } from './spans.js';
import { parseSrt } from '../srt.js';
import { outDir } from './env.js';
import { mergeAnswers } from './merge.js';
import { loadSplit } from './split.js';
import { SONNET_Q_VERSION, promptHash } from './sonnet-questions.js';
import { creditsSceneIds } from './credits.js';
import { GUARD_QS } from './resolve.js';

export { sceneBounds };

const here = path.dirname(fileURLToPath(import.meta.url));
export const BANDS = ['5-7', '8-10'];
const r3 = (x) => Math.round(x * 1000) / 1000;

export const loadPolicy = (file = path.join(here, 'policy.json')) => JSON.parse(fs.readFileSync(file, 'utf8'));

export function thresholdsFor(cfg, key) {
  const o = cfg.overrides?.[key] ?? {};
  return { act: o.act ?? cfg.act, low: o.band_low ?? cfg.band_low };
}

const levelOf = (p, t) => (p >= t.act ? 'act' : p >= t.low ? 'possible' : null);

/** v10: the policy with the Jev set's per-concept act thresholds as overrides (policy overrides win). */
export function withJevThresholds(cfg) {
  const o = { ...Object.fromEntries(Object.entries(JEV_THRESHOLDS).map(([k, act]) => [k, { act }])), ...(cfg.overrides ?? {}) };
  return { ...cfg, overrides: o };
}

/** v10: raw answers (row.answers with .q) -> the same object plus c / d / cf from the combine step. */
export function withConcepts(answers, items = []) {
  if (!answers || !answers.q) return answers;
  return { ...answers, ...conceptAnswers(answers, items) };
}

/**
 * The modifiers that may cancel a film-specific item: questions.js FILM_CANCEL for its type (so
 * items saved by an older run are selected under the current rules), minus
 * policy.film_specific.cancel_exempt[type].
 */
export function filmCancel(it, cfg) {
  const base = FILM_CANCEL[it.type] ?? it.cancel ?? {};
  const exempt = cfg.film_specific?.cancel_exempt?.[it.type] ?? [];
  return Object.fromEntries(Object.entries(base).filter(([m, on]) => on && !exempt.includes(m)));
}

/**
 * v10.1 rule 2: is a child involved in the scene? (a) a verified cast child's film presence tag at act
 * (questions.js filmItems, why 'child'), when req.cast_presence; (b) Jev's childcry.js answer ("is the one who
 * cries a child?", answers.x.crying_child) >= req.jev_min. v10.2: policy.json drops cast_presence for crying
 * (Zootopia S005: an adult's sob flagged because a cast child was in the scene), so only (b) applies.
 */
export function childInvolved(req, answers, tags) {
  if (req.cast_presence && tags.some((t) => t.child && t.layer === 'film' && t.type === 'presence' && t.level === 'act')) return 'cast_child';
  const p = answers.x?.crying_child;
  if (p != null && p >= req.jev_min) return 'jev_child';
  return null;
}

/** One flag requirement (policy.flag.requires): a Score level, an act-level event, a tag source, a child involved (v10.1), or any of these. */
export function meetsRequirement(req, answers, tags, tag) {
  if (!req) return true;
  if (req.any) return req.any.some((r) => meetsRequirement(r, answers, tags, tag));
  if (req.child) return !!childInvolved(req.child, answers, tags);
  if (req.score) return expected(answers.s?.[req.score]) >= req.min_expected;
  if (req.event) return tags.some((t) => t.layer === 'event' && t.id === req.event && t.level === 'act');
  if (req.source) return req.source.includes(tag.source);
  throw new Error(`unknown flag requirement ${JSON.stringify(req)}`);
}

function sourceOf(pl, ps, tl, ts, level) {
  const cut = (t) => (level === 'act' ? t.act : t.low);
  const l = pl >= cut(tl);
  const s = ps >= cut(ts);
  return l && s ? 'both' : l ? 'lines' : 'summary';
}

/** Expected level of a Score answer (the API's `score` is already the probability-weighted mean). */
export const expected = (s) => (s ? Number(s.score) : 0);
/** Probability mass on the given levels. */
const mass = (s, levels) => (s?.probabilities ? levels.reduce((a, l) => a + (Number(s.probabilities[String(l)]) || 0), 0) : 0);

/** Scene modifiers from the raw answers. */
export function modifiersOf(answers, cfg) {
  const retoldP = answers.mod?.retold ?? 0;
  const imaginedP = answers.mod?.imagined ?? 0;
  const dangerAbsent = mass(answers.s?.danger, [0, 1]);
  const laughs = expected(answers.s?.[cfg.comic.score]);
  const cp = cfg.comic_peril;
  const comicPerilP = cp ? answers.c?.[cp.event] ?? answers.e?.[cp.event] : undefined;
  return {
    retold: { p: r3(retoldP), danger_absent: r3(dangerAbsent), on: retoldP >= (cfg.retold_cancel.act ?? cfg.modifier_act) && dangerAbsent >= cfg.retold_cancel.danger_absent_mass },
    imagined: { p: r3(imaginedP), on: cfg.imagined_cancel && imaginedP >= cfg.modifier_act },
    comic: { laughs: r3(laughs), on: laughs >= cfg.comic.on_at },
    // user policy (3): comic peril is a tag. All three literal signals must agree (policy comic_peril).
    comic_peril: { p: comicPerilP === undefined ? null : r3(comicPerilP), laughs: r3(laughs), on: !!cp && comicPerilP !== undefined && comicPerilP >= cp.act && laughs >= cp.laughs_min && expected(answers.s?.danger) < (cp.danger_max ?? Infinity) },
  };
}

/**
 * Tags of one scene, before flagging. `items` = the film-specific items (questions.js filmItems).
 * Returns { tags, cancelled, vetoed, mentioned_only, modifiers, kind }.
 */
export function sceneTags(answers, cfg, items = []) {
  const tags = [];
  const vetoed = [];
  const cancelled = [];
  const mentionedOnly = [];
  const modifiers = modifiersOf(answers, cfg);
  const cancelBy = (cancel) => Object.keys(cancel ?? {}).filter((m) => cancel[m] && modifiers[m]?.on);
  const hasSummary = answers.ps !== null && answers.ps !== undefined;

  // ---- universal presence + kind gate -------------------------------------------------------------
  const kind = answers.kind ?? null;
  const parent = cfg.parent_tag;
  let parentTag = null;
  const addParent = (from, detail) => {
    if (!parentTag) {
      parentTag = { id: parent.id, v3: parent.v3, group: parent.group, label: parent.label, layer: 'presence', level: 'act', p: from.p, source: from.source, detail: [], from: [] };
      tags.push(parentTag);
    }
    parentTag.p = Math.max(parentTag.p, from.p);
    if (parentTag.source !== from.source) parentTag.source = 'both';
    if (!parentTag.detail.includes(detail)) parentTag.detail.push(detail);
    parentTag.from.push(from.id);
  };

  for (const item of PRESENCE) {
    // v10: a Jev-set id has ONE combined probability (answers.c) with its concept's threshold
    const jev = answers.c && answers.c[item.id] !== undefined;
    const pl = jev ? answers.c[item.id] : answers.pl?.[item.id] ?? 0;
    const ps = jev ? 0 : hasSummary ? answers.ps[item.id] ?? 0 : 0;
    const tl = thresholdsFor(cfg, jev ? `c.${item.id}` : `pl.${item.id}`);
    const ts = jev ? tl : thresholdsFor(cfg, `ps.${item.id}`);
    const lv = pl >= tl.act || ps >= ts.act ? 'act' : pl >= tl.low || ps >= ts.low ? 'possible' : null;
    if (item.mention && answers.m?.[item.id] !== undefined) {
      const m = answers.m[item.id];
      if (m >= thresholdsFor(cfg, `m.${item.id}`).act && pl < tl.low && ps < ts.low) mentionedOnly.push({ id: item.id, label: item.label, group: item.group, p: r3(m) });
    }
    if (!lv) continue;
    const tag = jev
      ? { id: item.id, v3: item.v3, group: item.group, label: item.label, layer: 'presence', level: lv, p: r3(pl), source: 'jev_set' }
      : { id: item.id, v3: item.v3, group: item.group, label: item.label, layer: 'presence', level: lv, p: r3(Math.max(pl, ps)), source: sourceOf(pl, ps, tl, ts, lv), p_lines: r3(pl), ...(hasSummary ? { p_summary: r3(ps) } : {}) };
    if (item.textBlind) tag.text_blind = true;
    if (lv === 'act' && item.kindGate && kind && kind.choice !== 'none' && kind.confidence >= cfg.kind_confidence && !item.kindGate.includes(kind.choice)) {
      vetoed.push({ id: item.id, p: tag.p, reason: 'kind_mismatch', kind: kind.choice, kind_confidence: r3(kind.confidence) });
      addParent(tag, kind.choice);
      continue;
    }
    if (lv === 'act' && item.kindGate && kind?.choice && item.kindGate.includes(kind.choice) && kind.confidence >= cfg.kind_confidence) tag.kind = kind.choice;
    tags.push(tag);
  }

  // ---- universal events + cancellation ------------------------------------------------------------
  const eventLevel = {};
  for (const item of EVENTS) {
    const jev = answers.c && answers.c[item.id] !== undefined;
    const p = jev ? answers.c[item.id] : answers.e?.[item.id];
    if (p === undefined) continue;
    const lv = levelOf(p, thresholdsFor(cfg, jev ? `c.${item.id}` : `e.${item.id}`));
    eventLevel[item.id] = { p, lv };
    if (!lv) continue;
    const by = cancelBy(item.cancel);
    if (by.length) { cancelled.push({ id: item.id, p: r3(p), level: lv, by }); continue; }
    tags.push({ id: item.id, v3: item.v3, group: item.group, label: item.label, layer: 'event', level: lv, p: r3(p), source: 'scene' });
  }
  // derived: jump_scare needs both halves; its level is the weaker half
  for (const d of Object.values(DERIVED)) {
    // v10: the Jev set may give the derived tag its own combined probability (answers.d)
    const p = answers.d?.[d.id] !== undefined ? answers.d[d.id] : Math.min(...d.from.map((id) => eventLevel[id]?.p ?? 0));
    const lv = levelOf(p, thresholdsFor(cfg, `d.${d.id}`));
    if (lv) tags.push({ id: d.id, v3: d.v3, group: d.group, label: d.label, layer: 'derived', level: lv, p: r3(p), source: 'scene', from: d.from });
  }

  // ---- film-specific ---------------------------------------------------------------------------------
  for (const it of items) {
    if (it.type === 'presence') {
      const pl = answers.fpl?.[it.id] ?? 0;
      const ps = hasSummary ? answers.fps?.[it.id] ?? 0 : 0;
      const tl = thresholdsFor(cfg, `fpl.${it.id}`);
      const ts = thresholdsFor(cfg, `fps.${it.id}`);
      const lv = pl >= tl.act || ps >= ts.act ? 'act' : pl >= tl.low || ps >= ts.low ? 'possible' : null;
      if (!lv) continue;
      tags.push({ id: it.id, entity: it.entity, type: it.type, group: it.group, label: it.label, layer: 'film', film_specific: true, level: lv, p: r3(Math.max(pl, ps)), source: sourceOf(pl, ps, tl, ts, lv), p_lines: r3(pl), ...(hasSummary ? { p_summary: r3(ps) } : {}), ...(it.why === 'child' ? { child: true } : {}) });
      continue;
    }
    const jev = answers.cf && answers.cf[it.id] !== undefined;
    const p = jev ? answers.cf[it.id] : answers.fe?.[it.id];
    if (p === undefined) continue;
    const lv = levelOf(p, thresholdsFor(cfg, jev ? `cf.${it.type}` : `fe.${it.id}`));
    if (!lv) continue;
    const by = cancelBy(filmCancel(it, cfg));
    if (by.length) { cancelled.push({ id: it.id, p: r3(p), level: lv, by, film_specific: true }); continue; }
    tags.push({ id: it.id, entity: it.entity, type: it.type, v3: it.v3, group: it.group, label: it.label, layer: 'film', film_specific: true, level: lv, p: r3(p), source: 'scene' });
  }

  const rank = { act: 0, possible: 1 };
  tags.sort((a, b) => rank[a.level] - rank[b.level] || b.p - a.p);
  return {
    tags,
    cancelled,
    vetoed,
    mentioned_only: mentionedOnly.sort((a, b) => b.p - a.p),
    modifiers,
    kind: kind ? { choice: kind.choice, confidence: r3(kind.confidence) } : null,
  };
}

/** Why this act-level tag flags the scene (a short rule name), or null. Pure policy. */
export function flagRule(tag, answers, tags, cfg, modifiers = null) {
  if (tag.level !== 'act') return null;
  const f = cfg.flag;
  const req = (key) => meetsRequirement(f.requires?.[key], answers, tags, tag);
  if (tag.layer === 'film') return f.film_specific_types.includes(tag.type) && req(`film_${tag.type}`) ? `film_${tag.type}` : null;
  if (tag.layer === 'derived') return null;
  if (tag.layer === 'event') {
    if (!f.strong_events.includes(tag.id)) return null;
    return req(tag.id) ? 'strong_event' : null;
  }
  // presence: the tier rule, then any per-item requirement
  const pr = f.presence;
  const comicPeril = (modifiers ?? modifiersOf(answers, cfg)).comic_peril?.on;
  let rule = null;
  if (pr.always.includes(tag.id)) rule = 'presence';
  else if (comicPeril) rule = null; // user policy (3): hazards and creatures in comic peril are tags
  else if (pr.with_danger.includes(tag.id)) rule = expected(answers.s?.danger) >= pr.danger_min_expected ? 'presence_with_danger' : null;
  else if (pr.with_creature_threat.includes(tag.id)) rule = tags.some((t) => t.id === 'creature_threat' && t.level === 'act') ? 'presence_with_creature_threat' : null;
  return rule && req(tag.id) ? rule : null;
}

/** Composite severity per age band. `reasons` = the flagging tags, `items` = film items (for weights). */
export function severity(answers, cfg, reasons, modifiers, items = [], flagged = false) {
  const sv = cfg.severity;
  const byId = new Map(items.map((it) => [it.id, it]));
  const norm = {};
  for (const d of Object.keys(sv.weights['5-7'])) {
    const s = answers.s?.[d];
    const top = s?.top ?? SCORES[d].levels.length - 1;
    norm[d] = s ? Math.max(0, Math.min(1, expected(s) / top)) : 0;
  }
  const out = {};
  for (const band of BANDS) {
    const w = sv.weights[band];
    const base = Object.keys(w).reduce((acc, d) => acc + w[d] * (norm[d] ?? 0), 0);
    const content = reasons.reduce((m, t) => {
      const weight = t.id === cfg.parent_tag.id ? cfg.parent_tag.weights[band] : byId.get(t.id)?.weights?.[band] ?? ITEMS[t.id]?.weights?.[band] ?? 0;
      return Math.max(m, weight / 3);
    }, 0);
    let score = base + Math.min(sv.content_weight * content, sv.content_cap);
    const scaledBy = [];
    for (const [m, scale] of Object.entries(sv.modifier_scale ?? {})) {
      if (modifiers[m]?.on) { score *= scale[band]; scaledBy.push(m); }
    }
    score = Math.max(0, Math.min(1, score));
    const [l1, l2, l3] = sv.levels;
    let level = score < l1 ? 0 : score < l2 ? 1 : score < l3 ? 2 : 3;
    if (flagged) level = Math.max(level, sv.flagged_min_level ?? 0);
    out[band] = { score: r3(score), level, base: r3(base), content: r3(content), scaled_by: scaledBy };
  }
  out.dimensions = Object.fromEntries(Object.entries(norm).map(([d, v]) => [d, r3(v)]));
  return out;
}

/**
 * v10.2 fix 1: the concept a flag reason belongs to (split.json concepts): a film item -> 'film:<type>', a v9 id ->
 * the concept whose v9_ids hold it, anything else (the kind-gate parent 'animal_creature') -> its own id.
 */
export function conceptOf(reason, items = [], conceptByV9 = null) {
  const it = items.find((x) => x.id === reason.id);
  if (it) return `film:${it.type}`;
  return conceptByV9?.get(reason.id) ?? reason.id;
}
/** v9 id -> concept id, from split.json's concepts. */
export const conceptMap = (split) => new Map(Object.entries(split?.concepts ?? {}).flatMap(([c, d]) => (d.v9_ids ?? []).map((id) => [id, c])));

/**
 * v10.2 fix 1, the TIER-A GATE (policy flag.gating): may this reason flag? A Sonnet-answered reason whose concept is
 * Sonnet-owned, a Jev-answered reason whose concept is tier A, or the rule-1 question's reason (measured tier A).
 * No gating block in the policy = every reason may flag (v10.1 behaviour).
 */
export function passesGate(reason, gating, conceptByV9, items = []) {
  if (!gating) return true;
  if (reason.rule === 'rule1_question') return true;
  const c = conceptOf(reason, items, conceptByV9);
  if (reason.by === 'sonnet') return gating.sonnet_concepts.includes(c);
  return gating.tier_a_jev_concepts.includes(c);
}

/**
 * v10.2 fix 3, the RESOLUTION GUARD (policy flag.resolution_guard): the guard questions (resolve.js) whose answer
 * cancels a Sonnet-answered reason with this id in this scene, [] when none fires. answers.x.guard_<q> = Jev's p.
 */
export function guardCancels(reason, answers, guardCfg) {
  if (!guardCfg || reason.by !== 'sonnet') return [];
  const qs = guardCfg.cancels?.[reason.id] ?? [];
  return qs.filter((q) => Number(answers.x?.[`guard_${q}`]) >= guardCfg.min_p);
}

/**
 * v10.2 rule 1: the rule-1 question's reason ("does a character say that they will kill or hurt another
 * character?", answers.x.r1_threat >= min_p), as a threatens_harm reason, or null. Cancelled like threatens_harm
 * (imagined), never by comedy (user policy 1: a comic villain's threat is still a threat).
 */
export function rule1Reason(answers, cfg, modifiers, tags) {
  const r1 = cfg.flag.rule1_question;
  if (!r1?.enabled) return null;
  const p = Number(answers.x?.r1_threat);
  if (!Number.isFinite(p) || p < r1.min_p) return null;
  const ev = EVENTS.find((e) => e.id === r1.reason_id);
  if (Object.keys(ev.cancel ?? {}).some((m) => ev.cancel[m] && modifiers[m]?.on)) return null;
  const t = tags.find((x) => x.id === ev.id);
  return { id: ev.id, label: ev.label, group: ev.group, p: r3(p), source: 'r1_question', rule: 'rule1_question', by: 'jev', ...(t ? { tag_p: t.p } : {}) };
}

/**
 * One scene, given the film's context set. Returns tags, flag, reasons, severity.
 * context: Set of item ids that are film-level context in this film.
 * v10.2: byOf(id) -> 'jev' | 'sonnet' (split.json), conceptByV9 (conceptMap) for the tier-A gate.
 */
export function selectScene(answers, cfg, { items = [], context = new Set(), byOf = null, conceptByV9 = null } = {}) {
  const base = sceneTags(answers, cfg, items);
  const candidates = [];
  const contextReasons = [];
  const who = (id) => (byOf ? byOf(id) : 'jev');
  for (const t of base.tags) {
    const rule = flagRule(t, answers, base.tags, cfg, base.modifiers);
    if (!rule) continue;
    const childReq = cfg.flag.requires?.[t.id]?.child;
    const r = { id: t.id, label: t.label, group: t.group, p: t.p, source: t.source, rule, by: who(t.id), ...(t.film_specific ? { film_specific: true } : {}), ...(childReq ? { child: childInvolved(childReq, answers, base.tags) } : {}) };
    if (context.has(t.id)) contextReasons.push(r); else candidates.push(r);
  }
  // v10.2 rule 1: the rule-1 question's threatens_harm reason (replaces a tier-B threatens_harm reason of the scene)
  const r1 = rule1Reason(answers, cfg, base.modifiers, base.tags);
  if (r1 && !context.has(r1.id)) {
    const k = candidates.findIndex((x) => x.id === r1.id);
    if (k >= 0) candidates.splice(k, 1, { ...candidates[k], rule: 'rule1_question', r1_p: r1.p, source: candidates[k].source });
    else candidates.push(r1);
  }
  for (const t of base.tags) if (context.has(t.id)) t.film_level = true;
  // v10.2 fix 3: the resolution guard cancels the Sonnet reasons it names; fix 1: the tier-A gate
  const reasons = []; const gated = []; const guarded = [];
  const G = cfg.flag.gating ?? null;
  for (const r of candidates) {
    const g = guardCancels(r, answers, cfg.flag.resolution_guard);
    if (g.length) { guarded.push({ ...r, by_guard: g }); continue; }
    if (!passesGate(r, G, conceptByV9, items)) { gated.push({ ...r, concept: conceptOf(r, items, conceptByV9) }); continue; }
    reasons.push(r);
  }
  const flagged = reasons.length > 0;
  return {
    flagged,
    flag_reasons: reasons,
    context_reasons: contextReasons,
    gated_reasons: gated,
    guard_cancelled: guarded,
    ...base,
    film_tags: base.tags.filter((t) => t.film_specific),
    severity: severity(answers, cfg, reasons, base.modifiers, items, flagged),
  };
}

/** Film-level context: item ids at act in >= share of classified scenes (only for films with >= min_scenes). */
export function filmContext(sceneTagLists, cfg, items = []) {
  const n = sceneTagLists.length;
  const counts = {};
  const meta = {};
  for (const tags of sceneTagLists) {
    for (const t of new Map(tags.filter((x) => x.level === 'act').map((x) => [x.id, x])).values()) {
      counts[t.id] = (counts[t.id] ?? 0) + 1;
      meta[t.id] ??= { label: t.label, group: t.group, film_specific: !!t.film_specific };
    }
  }
  const notes = [];
  if (n >= cfg.film_level.min_scenes) {
    for (const [id, c] of Object.entries(counts)) {
      if (c / n >= cfg.film_level.share) notes.push({ id, ...meta[id], scenes: c, of: n, share: r3(c / n) });
    }
  }
  notes.sort((a, b) => b.share - a.share);
  return { context: new Set(notes.map((x) => x.id)), notes, counts };
}

/**
 * Skip spans: the moment finder's union when it ran for this scene, else the whole scene (from its
 * wordless lead-in, scene.whole_span, when the cues were available).
 */
export function skipFor(scene, flagged, moments) {
  if (!flagged) return null;
  const m = moments?.[scene.id];
  if (m?.spans?.length) {
    const ms = m.spans.reduce((a, s) => a + (s.end_ms - s.start_ms), 0);
    return { method: m.method ?? 'moments', spans: m.spans, ms };
  }
  const w = scene.whole_span ?? { start_ms: scene.start_ms, end_ms: scene.end_ms };
  return { method: m?.method ?? 'whole_scene', spans: [{ start_ms: w.start_ms, end_ms: w.end_ms, ...(w.lead_in ? { lead_in: true } : {}) }], ms: w.end_ms - w.start_ms };
}

/** Chips: flagged scenes per universal group (film-specific tags count under their group). */
export function filmChips(scenes) {
  const groups = {};
  const tagCounts = {};
  for (const s of scenes) {
    for (const t of s.tags ?? []) if (t.level === 'act') tagCounts[t.id] = (tagCounts[t.id] ?? 0) + 1;
    if (!s.flagged) continue;
    const seen = new Set();
    for (const r of s.flag_reasons) {
      if (seen.has(r.group)) continue;
      seen.add(r.group);
      groups[r.group] = (groups[r.group] ?? 0) + 1;
    }
  }
  const chips = Object.entries(groups).map(([group, n]) => ({ group, label: GROUPS[group] ?? group, scenes: n })).sort((a, b) => b.scenes - a.scenes || a.group.localeCompare(b.group));
  return { chips, tag_counts: tagCounts };
}

export function selectRun(run, cfg0, { moments = null, cues = null, reasons = null, why = null, sonnet = null, used = [], childcry = null, resolve = null, split = null } = {}) {
  const items = run.film_items ?? [];
  const cfg = withJevThresholds(cfg0);
  // v10.2: the concept of every v9 id (split.json) for the tier-A gate
  const conceptByV9 = cfg.flag.gating ? conceptMap(split ?? loadSplit()) : null;
  // v10: combine the raw Jev-set answers per scene (conceptAnswers); v9: Sonnet's answers for the ids
  // split.json assigns to Sonnet (merge.js); v10.1: Jev's child-crying answer (childcry.js) as answers.x
  const usedSet = new Set(used);
  // v10.1: end-credits scenes (credits.js) get no tags and no flags, even when answers exist for them
  const credits = cues && cfg.credits ? creditsSceneIds(run.scenes, cues, cfg.credits) : { span: null, ids: new Set() };
  const rows = run.scenes.map((row) => {
    if (credits.ids.has(row.id)) return { ...row, answers: null, skipped: 'end_credits' };
    if (!row.answers) return row;
    const a = withConcepts(row.answers, items);
    const merged = used.length ? mergeAnswers(a, sonnet?.scenes?.[row.id] ?? null, used) : a;
    const cc = childcry?.scenes?.[row.id];
    // v10.2: the resolution guard's and the rule-1 question's answers (resolve.js) as answers.x
    const rv = resolve?.scenes?.[row.id];
    const x = { ...(merged.x ?? {}), ...(cc ? { crying_child: cc.p_child } : {}), ...(rv?.guard ? Object.fromEntries(Object.keys(GUARD_QS).filter((k) => rv.guard[k] != null).map((k) => [`guard_${k}`, rv.guard[k]])) : {}), ...(rv?.r1 != null ? { r1_threat: rv.r1 } : {}) };
    return { ...row, answers: Object.keys(x).length ? { ...merged, x } : merged };
  });
  const bounds = sceneBounds(rows, cfg);
  if (cues) {
    const byIndex = new Map(cues.map((c) => [c.index, c]));
    rows.forEach((row, i) => { bounds[i].whole_span = wholeSceneSpan(bounds[i], cues.slice(row.start_cue - 1, row.end_cue), cfg, byIndex); });
  }
  const classified = rows.filter((r) => r.answers);
  // pass 1: tags only, to find film-level context
  const { context, notes, counts } = filmContext(classified.map((r) => sceneTags(r.answers, cfg, items).tags), cfg, items);
  // pass 2: flags with context removed
  const scenes = rows.map((row, i) => {
    const baseRow = { id: row.id, start_cue: row.start_cue, end_cue: row.end_cue, ...bounds[i] };
    if (!row.answers) return { ...baseRow, ...(row.skipped === 'end_credits' ? { credits: true } : {}), unclassified: row.skipped ?? row.error ?? 'no answers', flagged: false, tags: [], flag_reasons: [] };
    const byOf = (id) => (usedSet.has(id) ? 'sonnet' : 'jev');
    const r = selectScene(row.answers, cfg, { items, context, byOf, conceptByV9 });
    // v9: which model answered each tag's question (split.json); v10.2: reasons carry theirs from selectScene
    for (const t of [...r.tags, ...r.context_reasons]) t.by = byOf(t.id);
    // v9: why = the checked Sonnet description (check-describe.js); v8's reasons.js why as a fallback
    // input for older runs. Only when computed for the same flag reasons.
    const src = why ?? reasons;
    const w = r.flagged ? src?.scenes?.[row.id] : null;
    const wy = w && w.reasons.join() === r.flag_reasons.map((x) => x.id).join() ? w.why : null;
    return { ...baseRow, ...r, ...(row.answers?.sonnet_missing ? { sonnet_missing: true } : {}), skip: skipFor(baseRow, r.flagged, moments?.scenes), ...(r.flagged ? { why: wy } : {}) };
  });
  const flagged = scenes.filter((s) => s.flagged);
  const totalMs = scenes.reduce((a, s) => a + ((s.end_ms ?? 0) - (s.start_ms ?? 0)), 0);
  return {
    film: run.film,
    run: run.run,
    question_set: run.question_set,
    film_items: items.map(({ id, entity, name, type, why, group, label }) => ({ id, entity, name, type, why, group, label })),
    generated_at: new Date().toISOString(),
    policy: cfg,
    credits: credits.span,
    summary: {
      scenes: scenes.length,
      credits_scenes: scenes.filter((s) => s.credits).map((s) => s.id),
      unclassified: scenes.filter((s) => s.unclassified && !s.credits).length,
      flagged: flagged.length,
      flagged_scene_ms: flagged.reduce((a, s) => a + (s.end_ms - s.start_ms), 0),
      skip_ms: flagged.reduce((a, s) => a + (s.skip?.ms ?? 0), 0),
      film_ms_in_scenes: totalMs,
      film_level_notes: notes,
      act_counts: counts,
      ...filmChips(scenes),
      flag_reason_counts: flagged.flatMap((s) => s.flag_reasons.map((r) => r.id)).reduce((m, id) => ({ ...m, [id]: (m[id] ?? 0) + 1 }), {}),
      // v10.2: scenes that only tier-B/C reasons (gate) or guard-cancelled Sonnet reasons would have flagged
      gated_only_scenes: scenes.filter((s) => !s.flagged && (s.gated_reasons ?? []).length).map((s) => s.id),
      guard_only_scenes: scenes.filter((s) => !s.flagged && (s.guard_cancelled ?? []).length).map((s) => s.id),
      rule1_reasons: flagged.filter((s) => s.flag_reasons.some((r) => r.rule === 'rule1_question')).map((s) => s.id),
      severity_levels: Object.fromEntries(BANDS.map((b) => [b, flagged.reduce((m, s) => ({ ...m, [s.severity[b].level]: (m[s.severity[b].level] ?? 0) + 1 }), {})])),
    },
    scenes,
  };
}

// ---- CLI -------------------------------------------------------------------------------------------

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2);
  const slug = argv.find((a) => !a.startsWith('--'));
  const opt = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
  if (!slug) { console.error('usage: node select.js <slug> [--run r1] [--policy policy.json]'); process.exit(2); }
  const runId = opt('run', 'r1');
  const OUT = outDir();
  const jevFile = path.join(OUT, `${slug}.jev.${runId}.json`);
  const run = JSON.parse(fs.readFileSync(jevFile, 'utf8'));
  const momFile = path.join(OUT, `${slug}.moments.${runId}.json`);
  const moments = fs.existsSync(momFile) ? JSON.parse(fs.readFileSync(momFile, 'utf8')) : null;
  const whyFile = path.join(OUT, `${slug}.why.${runId}.json`);
  const why = fs.existsSync(whyFile) ? JSON.parse(fs.readFileSync(whyFile, 'utf8')) : null;
  const polFile = path.resolve(opt('policy', path.join(here, 'policy.json')));
  const cues = parseSrt(fs.readFileSync(path.resolve(here, '..', 'data', `${run.film.slug}.srt`), 'utf8'));
  // v9: the split and Sonnet's answers
  const split = loadSplit();
  const sqFile = path.join(OUT, `${slug}.sonnetq.${runId}.json`);
  let sonnet = null;
  if (split.sonnet_used.length) {
    if (!fs.existsSync(sqFile)) { console.error(`${slug}: split.json assigns ${split.sonnet_used.length} questions to Sonnet but ${path.relative(here, sqFile)} does not exist (run sonnetq.js)`); process.exit(2); }
    sonnet = JSON.parse(fs.readFileSync(sqFile, 'utf8'));
    const asked = sonnet.split?.sonnet_asked ?? [];
    if (sonnet.version !== SONNET_Q_VERSION || JSON.stringify(asked) !== JSON.stringify(split.sonnet_asked) || (sonnet.prompt_sha256_12 && sonnet.prompt_sha256_12 !== promptHash(split.sonnet_asked))) { console.error(`${slug}: ${path.relative(here, sqFile)} was asked a different question list or prompt than split.json / sonnet-questions.js now define; re-run sonnetq.js`); process.exit(2); }
    if (!sonnet.complete) console.error(`${slug}: WARNING sonnetq incomplete; missing scenes ${sonnet.missing.join(',')} get no Sonnet-assigned tags`);
  }
  // v10.1: Jev's child-crying answers (childcry.js); required whenever Sonnet's crying is at act somewhere
  const ccFile = path.join(OUT, `${slug}.childcry.${runId}.json`);
  const childcry = fs.existsSync(ccFile) ? JSON.parse(fs.readFileSync(ccFile, 'utf8')) : null;
  if (!childcry) console.error(`${slug}: WARNING no ${path.relative(here, ccFile)} (run childcry.js): Sonnet crying never flags`);
  // v10.2: the resolution guard and rule-1 answers (resolve.js); required when the policy uses either
  const policy = loadPolicy(polFile);
  const rvFile = path.join(OUT, `${slug}.resolve.${runId}.json`);
  const resolve = fs.existsSync(rvFile) ? JSON.parse(fs.readFileSync(rvFile, 'utf8')) : null;
  if (!resolve && (policy.flag.resolution_guard || policy.flag.rule1_question?.enabled)) { console.error(`${slug}: ${path.relative(here, rvFile)} does not exist (run resolve.js)`); process.exit(2); }
  const out = selectRun(run, policy, { moments, cues, why, sonnet, used: split.sonnet_used, childcry, resolve, split });
  out.resolve_file = resolve ? path.relative(here, rvFile) : null;
  out.childcry_file = childcry ? path.relative(here, ccFile) : null;
  out.jev_file = path.relative(here, jevFile);
  out.sonnetq_file = sonnet ? path.relative(here, sqFile) : null;
  out.split = { sha256_12: split.sha256_12, sonnet_used: split.sonnet_used };
  out.moments_file = moments ? path.relative(here, momFile) : null;
  out.why_file = why ? path.relative(here, whyFile) : null;
  const fl = out.scenes.filter((x) => x.flagged);
  out.summary.why = { described: fl.filter((x) => x.why?.source === 'described').length, described_plus_reason: fl.filter((x) => x.why?.source === 'described+reason').length, described_only: fl.filter((x) => x.why?.source === 'described_only').length, plain_reason: fl.filter((x) => x.why?.source === 'plain_reason').length, no_verified_text: fl.filter((x) => x.why?.source === 'no_verified_text').length, missing: fl.filter((x) => !x.why).map((x) => x.id) };
  out.summary.flag_reasons_by = { sonnet: fl.flatMap((x) => x.flag_reasons).filter((r) => r.by === 'sonnet').length, jev: fl.flatMap((x) => x.flag_reasons).filter((r) => r.by === 'jev').length, scenes_flagged_only_by_sonnet: fl.filter((x) => x.flag_reasons.every((r) => r.by === 'sonnet')).length };
  out.policy_file = path.relative(here, polFile);
  const file = path.join(OUT, `${slug}.tags.${runId}.json`);
  fs.writeFileSync(file, JSON.stringify(out, null, 2));
  const s = out.summary;
  const min = (ms) => (ms / 60000).toFixed(1);
  console.log(file);
  console.log(`  flagged ${s.flagged}/${s.scenes} scenes (reasons by sonnet ${s.flag_reasons_by.sonnet}, jev ${s.flag_reasons_by.jev}; ${s.flag_reasons_by.scenes_flagged_only_by_sonnet} scenes only by sonnet); flagged scenes ${min(s.flagged_scene_ms)} min, skip ${min(s.skip_ms)} min (${out.moments_file ? 'moments' : 'whole scenes'}); why: described ${s.why.described}, +reason ${s.why.described_plus_reason}, described only ${s.why.described_only}, plain ${s.why.plain_reason}, no verified text ${s.why.no_verified_text}, missing ${s.why.missing.length ? s.why.missing.join(',') : 0}`);
  console.log(`  gate: ${s.gated_only_scenes.length} scenes held only tier-B/C reasons (tags only)${s.gated_only_scenes.length ? ` ${s.gated_only_scenes.join(',')}` : ''}; guard cancelled all reasons in ${s.guard_only_scenes.length}${s.guard_only_scenes.length ? ` ${s.guard_only_scenes.join(',')}` : ''}; rule-1 question reasons in ${s.rule1_reasons.length}`);
  console.log(`  film-level notes: ${s.film_level_notes.map((n) => `${n.id} ${n.scenes}/${n.of}`).join(', ') || 'none'}`);
  console.log(`  chips: ${s.chips.map((c) => `${c.label} ${c.scenes}`).join(', ') || 'none'}`);
  for (const sc of out.scenes) {
    if (sc.unclassified) { console.log(`  ${sc.id} UNCLASSIFIED ${sc.unclassified}`); continue; }
    const act = sc.tags.filter((t) => t.level === 'act').map((t) => `${t.id}${t.by === 'sonnet' ? '{S}' : ''}${t.layer === 'presence' || t.type === 'presence' ? `[${t.source}]` : ''}:${t.p}${t.film_level ? '(ctx)' : ''}`);
    const skip = sc.skip ? ` skip ${Math.round(sc.skip.ms / 1000)}s/${Math.round((sc.end_ms - sc.start_ms) / 1000)}s ${sc.skip.method}` : '';
    console.log(`  ${sc.id} ${sc.flagged ? 'FLAG' : '    '} sev ${sc.severity['5-7'].level}/${sc.severity['8-10'].level}${skip}  reasons: ${sc.flag_reasons.map((r) => r.id).join(',') || '-'}${sc.gated_reasons?.length ? ` | tags only (gate): ${sc.gated_reasons.map((r) => r.id).join(',')}` : ''}${sc.guard_cancelled?.length ? ` | guard: ${sc.guard_cancelled.map((r) => `${r.id}(${r.by_guard.join('+')})`).join(',')}` : ''}`);
    console.log(`        act: ${act.join(' ') || '-'}${sc.cancelled.length ? ` | cancelled: ${sc.cancelled.map((c) => `${c.id}(${c.by})`).join(',')}` : ''}${sc.vetoed.length ? ` | kind-gate: ${sc.vetoed.map((v) => `${v.id}->${v.kind}`).join(',')}` : ''} | mods: retold ${sc.modifiers.retold.on ? 'ON' : 'off'} imagined ${sc.modifiers.imagined.on ? 'ON' : 'off'} comic ${sc.modifiers.comic.laughs}${sc.modifiers.comic.on ? ' ON' : ''} comic_peril ${sc.modifiers.comic_peril?.p ?? '-'}${sc.modifiers.comic_peril?.on ? ' ON' : ''} | kind ${sc.kind?.choice}:${sc.kind?.confidence}`);
  }
}
