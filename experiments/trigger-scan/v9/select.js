#!/usr/bin/env node
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
import { PRESENCE, EVENTS, SCORES, GROUPS, ITEMS, DERIVED, FILM_CANCEL } from './questions.js';
import { sceneBounds, wholeSceneSpan } from './spans.js';
import { parseSrt } from '../srt.js';
import { outDir } from './env.js';
import { mergeAnswers } from './merge.js';
import { loadSplit } from './split.js';
import { SONNET_Q_VERSION, promptHash } from './sonnet-questions.js';

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

/** One flag requirement (policy.flag.requires): a Score level, an act-level event, a tag source, or any of these. */
export function meetsRequirement(req, answers, tags, tag) {
  if (!req) return true;
  if (req.any) return req.any.some((r) => meetsRequirement(r, answers, tags, tag));
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
  const comicPerilP = cp ? answers.e?.[cp.event] : undefined;
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
    const pl = answers.pl?.[item.id] ?? 0;
    const ps = hasSummary ? answers.ps[item.id] ?? 0 : 0;
    const tl = thresholdsFor(cfg, `pl.${item.id}`);
    const ts = thresholdsFor(cfg, `ps.${item.id}`);
    const lv = pl >= tl.act || ps >= ts.act ? 'act' : pl >= tl.low || ps >= ts.low ? 'possible' : null;
    if (item.mention && answers.m?.[item.id] !== undefined) {
      const m = answers.m[item.id];
      if (m >= thresholdsFor(cfg, `m.${item.id}`).act && pl < tl.low && ps < ts.low) mentionedOnly.push({ id: item.id, label: item.label, group: item.group, p: r3(m) });
    }
    if (!lv) continue;
    const tag = { id: item.id, v3: item.v3, group: item.group, label: item.label, layer: 'presence', level: lv, p: r3(Math.max(pl, ps)), source: sourceOf(pl, ps, tl, ts, lv), p_lines: r3(pl), ...(hasSummary ? { p_summary: r3(ps) } : {}) };
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
    const p = answers.e?.[item.id];
    if (p === undefined) continue;
    const lv = levelOf(p, thresholdsFor(cfg, `e.${item.id}`));
    eventLevel[item.id] = { p, lv };
    if (!lv) continue;
    const by = cancelBy(item.cancel);
    if (by.length) { cancelled.push({ id: item.id, p: r3(p), level: lv, by }); continue; }
    tags.push({ id: item.id, v3: item.v3, group: item.group, label: item.label, layer: 'event', level: lv, p: r3(p), source: 'scene' });
  }
  // derived: jump_scare needs both halves; its level is the weaker half
  for (const d of Object.values(DERIVED)) {
    const ps = d.from.map((id) => eventLevel[id]?.p ?? 0);
    const p = Math.min(...ps);
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
      tags.push({ id: it.id, entity: it.entity, type: it.type, group: it.group, label: it.label, layer: 'film', film_specific: true, level: lv, p: r3(Math.max(pl, ps)), source: sourceOf(pl, ps, tl, ts, lv), p_lines: r3(pl), ...(hasSummary ? { p_summary: r3(ps) } : {}) });
      continue;
    }
    const p = answers.fe?.[it.id];
    if (p === undefined) continue;
    const lv = levelOf(p, thresholdsFor(cfg, `fe.${it.id}`));
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
 * One scene, given the film's context set. Returns tags, flag, reasons, severity.
 * context: Set of item ids that are film-level context in this film.
 */
export function selectScene(answers, cfg, { items = [], context = new Set() } = {}) {
  const base = sceneTags(answers, cfg, items);
  const reasons = [];
  const contextReasons = [];
  for (const t of base.tags) {
    const rule = flagRule(t, answers, base.tags, cfg, base.modifiers);
    if (!rule) continue;
    const r = { id: t.id, label: t.label, group: t.group, p: t.p, source: t.source, rule, ...(t.film_specific ? { film_specific: true } : {}) };
    if (context.has(t.id)) contextReasons.push(r); else reasons.push(r);
  }
  for (const t of base.tags) if (context.has(t.id)) t.film_level = true;
  const flagged = reasons.length > 0;
  return {
    flagged,
    flag_reasons: reasons,
    context_reasons: contextReasons,
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

export function selectRun(run, cfg, { moments = null, cues = null, reasons = null, why = null, sonnet = null, used = [] } = {}) {
  const items = run.film_items ?? [];
  // v9: Sonnet's answers replace Jev's for the questions split.json assigns to Sonnet (merge.js)
  const usedSet = new Set(used);
  const rows = run.scenes.map((row) => (row.answers && used.length ? { ...row, answers: mergeAnswers(row.answers, sonnet?.scenes?.[row.id] ?? null, used) } : row));
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
    if (!row.answers) return { ...baseRow, unclassified: row.skipped ?? row.error ?? 'no answers', flagged: false, tags: [], flag_reasons: [] };
    const r = selectScene(row.answers, cfg, { items, context });
    // v9: which model answered each tag's question (split.json)
    for (const t of [...r.tags, ...r.flag_reasons, ...r.context_reasons]) t.by = usedSet.has(t.id) ? 'sonnet' : 'jev';
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
    summary: {
      scenes: scenes.length,
      unclassified: scenes.filter((s) => s.unclassified).length,
      flagged: flagged.length,
      flagged_scene_ms: flagged.reduce((a, s) => a + (s.end_ms - s.start_ms), 0),
      skip_ms: flagged.reduce((a, s) => a + (s.skip?.ms ?? 0), 0),
      film_ms_in_scenes: totalMs,
      film_level_notes: notes,
      act_counts: counts,
      ...filmChips(scenes),
      flag_reason_counts: flagged.flatMap((s) => s.flag_reasons.map((r) => r.id)).reduce((m, id) => ({ ...m, [id]: (m[id] ?? 0) + 1 }), {}),
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
  const out = selectRun(run, loadPolicy(polFile), { moments, cues, why, sonnet, used: split.sonnet_used });
  out.jev_file = path.relative(here, jevFile);
  out.sonnetq_file = sonnet ? path.relative(here, sqFile) : null;
  out.split = { sha256_12: split.sha256_12, sonnet_used: split.sonnet_used };
  out.moments_file = moments ? path.relative(here, momFile) : null;
  out.why_file = why ? path.relative(here, whyFile) : null;
  const fl = out.scenes.filter((x) => x.flagged);
  out.summary.why = { described: fl.filter((x) => x.why?.source === 'described').length, described_plus_reason: fl.filter((x) => x.why?.source === 'described+reason').length, plain_reason: fl.filter((x) => x.why?.source === 'plain_reason').length, missing: fl.filter((x) => !x.why).map((x) => x.id) };
  out.summary.flag_reasons_by = { sonnet: fl.flatMap((x) => x.flag_reasons).filter((r) => r.by === 'sonnet').length, jev: fl.flatMap((x) => x.flag_reasons).filter((r) => r.by === 'jev').length, scenes_flagged_only_by_sonnet: fl.filter((x) => x.flag_reasons.every((r) => r.by === 'sonnet')).length };
  out.policy_file = path.relative(here, polFile);
  const file = path.join(OUT, `${slug}.tags.${runId}.json`);
  fs.writeFileSync(file, JSON.stringify(out, null, 2));
  const s = out.summary;
  const min = (ms) => (ms / 60000).toFixed(1);
  console.log(file);
  console.log(`  flagged ${s.flagged}/${s.scenes} scenes (reasons by sonnet ${s.flag_reasons_by.sonnet}, jev ${s.flag_reasons_by.jev}; ${s.flag_reasons_by.scenes_flagged_only_by_sonnet} scenes only by sonnet); flagged scenes ${min(s.flagged_scene_ms)} min, skip ${min(s.skip_ms)} min (${out.moments_file ? 'moments' : 'whole scenes'}); why: described ${s.why.described}, +reason ${s.why.described_plus_reason}, plain ${s.why.plain_reason}, missing ${s.why.missing.length ? s.why.missing.join(',') : 0}`);
  console.log(`  film-level notes: ${s.film_level_notes.map((n) => `${n.id} ${n.scenes}/${n.of}`).join(', ') || 'none'}`);
  console.log(`  chips: ${s.chips.map((c) => `${c.label} ${c.scenes}`).join(', ') || 'none'}`);
  for (const sc of out.scenes) {
    if (sc.unclassified) { console.log(`  ${sc.id} UNCLASSIFIED ${sc.unclassified}`); continue; }
    const act = sc.tags.filter((t) => t.level === 'act').map((t) => `${t.id}${t.by === 'sonnet' ? '{S}' : ''}${t.layer === 'presence' || t.type === 'presence' ? `[${t.source}]` : ''}:${t.p}${t.film_level ? '(ctx)' : ''}`);
    const skip = sc.skip ? ` skip ${Math.round(sc.skip.ms / 1000)}s/${Math.round((sc.end_ms - sc.start_ms) / 1000)}s ${sc.skip.method}` : '';
    console.log(`  ${sc.id} ${sc.flagged ? 'FLAG' : '    '} sev ${sc.severity['5-7'].level}/${sc.severity['8-10'].level}${skip}  reasons: ${sc.flag_reasons.map((r) => r.id).join(',') || '-'}`);
    console.log(`        act: ${act.join(' ') || '-'}${sc.cancelled.length ? ` | cancelled: ${sc.cancelled.map((c) => `${c.id}(${c.by})`).join(',')}` : ''}${sc.vetoed.length ? ` | kind-gate: ${sc.vetoed.map((v) => `${v.id}->${v.kind}`).join(',')}` : ''} | mods: retold ${sc.modifiers.retold.on ? 'ON' : 'off'} imagined ${sc.modifiers.imagined.on ? 'ON' : 'off'} comic ${sc.modifiers.comic.laughs}${sc.modifiers.comic.on ? ' ON' : ''} comic_peril ${sc.modifiers.comic_peril?.p ?? '-'}${sc.modifiers.comic_peril?.on ? ' ON' : ''} | kind ${sc.kind?.choice}:${sc.kind?.confidence}`);
  }
}
