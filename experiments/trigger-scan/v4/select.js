#!/usr/bin/env node
// v4 tag selection: pure code over Jev's raw answers. No model calls.
//
//   node select.js <slug> [--run r1] [--thresholds thresholds.json]
//
// Reads out/<slug>.jev.<run>.json (classify.js) and the segments file it names; writes
// out/<slug>.tags.<run>.json. Per scene:
//   1. presence tags from two channels (lines, summary): level act / possible, source lines|summary|both
//   2. kind gate: shark / large_predator / monster must agree with the creature-kind Choice when it is
//      confident (>= kind_confidence); otherwise the tag falls back to the parent "animal or creature"
//   3. mention-only = mention at act AND both presence channels below band_low (never flags)
//   4. events at act / possible, then modifier cancellation (retold / imagined / comic, per item)
//   5. flagged = any act-level parents_care presence tag or any act-level event
//   6. severity per age band = composite of the five Scores + content weight, scaled by modifiers
// Per film: scene counts per parent-facing group ("chips") and per tag.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PRESENCE, EVENTS, SCORES, GROUPS, ITEMS } from './questions.js';

const here = path.dirname(fileURLToPath(import.meta.url));
export const BANDS = ['5-7', '8-10'];
const r3 = (x) => Math.round(x * 1000) / 1000;

export const loadConfig = (file = path.join(here, 'thresholds.json')) => JSON.parse(fs.readFileSync(file, 'utf8'));

export function thresholdsFor(cfg, key) {
  const o = cfg.overrides?.[key] ?? {};
  return { act: o.act ?? cfg.act, low: o.band_low ?? cfg.band_low };
}

const levelOf = (p, t) => (p >= t.act ? 'act' : p >= t.low ? 'possible' : null);

/** Source label from which channels reached the given level. */
function sourceOf(pl, ps, tl, ts, level) {
  const cut = (t) => (level === 'act' ? t.act : t.low);
  const l = pl >= cut(tl);
  const s = ps >= cut(ts);
  return l && s ? 'both' : l ? 'lines' : 'summary';
}

/**
 * One scene. `answers` is classify.js's per-scene `answers` object; `meta` carries the segment
 * fields select needs (known_from_film). Returns the scene's tags, flag and severity.
 */
export function selectScene(answers, cfg, meta = {}) {
  const tags = [];
  const vetoed = [];
  const mentionedOnly = [];
  const cancelled = [];

  // ---- modifiers ---------------------------------------------------------------------------------
  const modifiers = Object.fromEntries(Object.entries(answers.mod ?? {}).map(([id, p]) => [id, { p, on: p >= cfg.modifier_act }]));
  const on = (m) => modifiers[m]?.on === true;

  // ---- presence (two channels) + kind gate -------------------------------------------------------
  const kind = answers.kind ?? null;
  const parent = cfg.parent_tag;
  let parentTag = null;
  const addParent = (from, level, detail) => {
    if (!parentTag) {
      parentTag = { id: parent.id, v3: parent.v3, group: parent.group, label: parent.label, layer: 'presence', level, p: from.p, source: from.source, detail: [], from: [] };
      tags.push(parentTag);
    }
    if (level === 'act') parentTag.level = 'act';
    parentTag.p = Math.max(parentTag.p, from.p);
    if (parentTag.source !== from.source) parentTag.source = 'both';
    if (!parentTag.detail.includes(detail)) parentTag.detail.push(detail);
    parentTag.from.push(from.id);
  };

  for (const item of PRESENCE) {
    const pl = answers.pl?.[item.id] ?? 0;
    const ps = answers.ps?.[item.id] ?? 0;
    const tl = thresholdsFor(cfg, `pl.${item.id}`);
    const ts = thresholdsFor(cfg, `ps.${item.id}`);
    const lv = pl >= tl.act || ps >= ts.act ? 'act' : pl >= tl.low || ps >= ts.low ? 'possible' : null;

    if (item.mention && answers.m?.[item.id] !== undefined) {
      const m = answers.m[item.id];
      const tm = thresholdsFor(cfg, `m.${item.id}`);
      if (m >= tm.act && pl < tl.low && ps < ts.low) mentionedOnly.push({ id: item.id, v3: item.v3, group: item.group, label: item.label, p: r3(m) });
    }
    if (!lv) continue;

    const tag = { id: item.id, v3: item.v3, group: item.group, label: item.label, layer: 'presence', level: lv, p: r3(Math.max(pl, ps)), source: sourceOf(pl, ps, tl, ts, lv), p_lines: r3(pl), p_summary: r3(ps) };
    if (tag.source === 'summary' && meta.known_from_film) tag.from_film_knowledge = true;
    if (item.textBlind) tag.text_blind = true;

    if (lv === 'act' && item.kindGate && kind) {
      const match = item.kindGate.includes(kind.choice);
      const sure = kind.confidence >= cfg.kind_confidence;
      if (match && sure) {
        tag.kind = kind.choice;
      } else if (!match && sure && kind.choice === 'none') {
        vetoed.push({ id: item.id, p: tag.p, reason: 'kind_none', kind: kind.choice, kind_confidence: r3(kind.confidence) });
        continue;
      } else if (!match && sure) {
        // Confidently a different creature: the specific label is wrong, the creature is real.
        vetoed.push({ id: item.id, p: tag.p, reason: 'kind_mismatch', kind: kind.choice, kind_confidence: r3(kind.confidence) });
        addParent(tag, 'act', kind.choice);
        continue;
      } else {
        // Not confident: report the parent level, keep the specific one as possible.
        vetoed.push({ id: item.id, p: tag.p, reason: 'kind_unsure', kind: kind.choice, kind_confidence: r3(kind.confidence), kept_as: 'possible' });
        addParent(tag, 'act', `${kind.choice}?`);
        tag.level = 'possible';
      }
    }
    tags.push(tag);
  }

  // ---- events + modifier cancellation ------------------------------------------------------------
  for (const item of EVENTS) {
    const p = answers.e?.[item.id];
    if (p === undefined) continue;
    const lv = levelOf(p, thresholdsFor(cfg, `e.${item.id}`));
    if (!lv) continue;
    const by = Object.keys(item.cancel ?? {}).filter((m) => item.cancel[m] && on(m));
    if (by.length) {
      cancelled.push({ id: item.id, p: r3(p), level: lv, by });
      continue;
    }
    tags.push({ id: item.id, v3: item.v3, group: item.group, label: item.label, layer: 'event', level: lv, p: r3(p), source: 'scene' });
  }

  // ---- rank + flag -------------------------------------------------------------------------------
  const rank = { act: 0, possible: 1 };
  tags.sort((a, b) => rank[a.level] - rank[b.level] || b.p - a.p);
  const care = new Set(cfg.parents_care_presence);
  const flagEvent = (t) => cfg.flag_events === 'all' || (Array.isArray(cfg.flag_events) && cfg.flag_events.includes(t.id));
  const reasons = tags.filter((t) => t.level === 'act' && ((t.layer === 'presence' && care.has(t.id)) || (t.layer === 'event' && flagEvent(t))));

  return {
    flagged: reasons.length > 0,
    flag_reasons: reasons.map((t) => t.id),
    tags,
    mentioned_only: mentionedOnly.sort((a, b) => b.p - a.p),
    cancelled,
    vetoed,
    modifiers: Object.fromEntries(Object.entries(modifiers).map(([k, v]) => [k, { p: r3(v.p), on: v.on }])),
    kind: kind ? { choice: kind.choice, confidence: r3(kind.confidence) } : null,
    severity: severity(answers, cfg, reasons, on),
  };
}

/** Composite severity per age band. `reasons` = the flagging tags (for the content term). */
export function severity(answers, cfg, reasons, on) {
  const sv = cfg.severity;
  const norm = Object.fromEntries(Object.keys(SCORES).map((d) => {
    const s = answers.s?.[d];
    if (!s) return [d, 0];
    const top = s.top ?? SCORES[d].levels.length - 1;
    return [d, Math.max(0, Math.min(1, s.score / top))];
  }));
  const out = {};
  for (const band of BANDS) {
    const w = sv.weights[band];
    const base = Object.keys(w).reduce((acc, d) => acc + w[d] * (norm[d] ?? 0), 0);
    const content = reasons.reduce((m, t) => {
      const weight = t.id === cfg.parent_tag.id ? cfg.parent_tag.weights[band] : ITEMS[t.id]?.weights?.[band] ?? 0;
      return Math.max(m, weight / 3);
    }, 0);
    let score = (1 - sv.content_weight) * base + sv.content_weight * content;
    if (on('child_in_trouble')) score += sv.child_in_trouble_boost?.[band] ?? 0;
    const scaledBy = [];
    for (const [m, scale] of Object.entries(sv.modifier_scale ?? {})) {
      if (on(m)) { score *= scale[band]; scaledBy.push(m); }
    }
    score = Math.max(0, Math.min(1, score));
    const [l1, l2, l3] = sv.levels;
    const level = score < l1 ? 0 : score < l2 ? 1 : score < l3 ? 2 : 3;
    out[band] = { score: r3(score), level, base: r3(base), content: r3(content), scaled_by: scaledBy };
  }
  out.dimensions = Object.fromEntries(Object.entries(norm).map(([d, v]) => [d, r3(v)]));
  return out;
}

/** Film-level chips: flagged scenes per group, and per tag. */
export function filmChips(scenes) {
  const groups = {};
  const tagsCount = {};
  const mentions = {};
  for (const s of scenes) {
    if (!s.flagged) continue;
    const seen = new Set();
    for (const t of s.tags) {
      if (t.level !== 'act') continue;
      tagsCount[t.id] = (tagsCount[t.id] ?? 0) + 1;
      if (!seen.has(t.group)) { groups[t.group] = (groups[t.group] ?? 0) + 1; seen.add(t.group); }
    }
  }
  for (const s of scenes) for (const m of s.mentioned_only ?? []) mentions[m.id] = (mentions[m.id] ?? 0) + 1;
  const chips = Object.entries(groups).map(([group, n]) => ({ group, label: GROUPS[group], scenes: n })).sort((a, b) => b.scenes - a.scenes || a.group.localeCompare(b.group));
  return { chips, tag_counts: tagsCount, mentioned_only_counts: mentions };
}

export function selectRun(run, cfg, segments = null) {
  const segById = new Map((segments?.scenes ?? []).map((s) => [s.id, s]));
  const scenes = run.scenes.map((row) => {
    const base = { id: row.id, start_cue: row.start_cue, end_cue: row.end_cue, start_ms: row.start_ms, end_ms: row.end_ms };
    if (!row.answers) return { ...base, unclassified: row.skipped ?? row.error ?? 'no answers', flagged: false, tags: [], mentioned_only: [] };
    const seg = segById.get(row.id);
    return { ...base, known_from_film: seg?.known_from_film ?? null, ...selectScene(row.answers, cfg, { known_from_film: seg?.known_from_film }) };
  });
  const flagged = scenes.filter((s) => s.flagged);
  return {
    film: run.film,
    run: run.run,
    question_set: run.question_set,
    jev_file: null,
    generated_at: new Date().toISOString(),
    thresholds: cfg,
    summary: {
      scenes: scenes.length,
      unclassified: scenes.filter((s) => s.unclassified).length,
      flagged: flagged.length,
      flagged_ms: flagged.reduce((acc, s) => acc + ((s.end_ms ?? 0) - (s.start_ms ?? 0)), 0),
      ...filmChips(scenes),
    },
    scenes,
  };
}

// ---- CLI -------------------------------------------------------------------------------------------

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2);
  const slug = argv.find((a) => !a.startsWith('--'));
  const opt = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
  if (!slug) { console.error('usage: node select.js <slug> [--run r1] [--thresholds thresholds.json]'); process.exit(2); }
  const runId = opt('run', 'r1');
  const jevFile = path.join(here, 'out', `${slug}.jev.${runId}.json`);
  const run = JSON.parse(fs.readFileSync(jevFile, 'utf8'));
  const segFile = path.join(here, run.segments_file);
  const segments = fs.existsSync(segFile) ? JSON.parse(fs.readFileSync(segFile, 'utf8')) : null;
  const thrFile = path.resolve(opt('thresholds', path.join(here, 'thresholds.json')));
  const out = selectRun(run, loadConfig(thrFile), segments);
  out.jev_file = path.relative(here, jevFile);
  out.thresholds_file = path.relative(here, thrFile);
  const file = path.join(here, 'out', `${slug}.tags.${runId}.json`);
  fs.writeFileSync(file, JSON.stringify(out, null, 2));
  console.log(file);
  const s = out.summary;
  console.log(`  flagged ${s.flagged}/${s.scenes} scenes (${Math.round(s.flagged_ms / 1000)} s); chips: ${s.chips.map((c) => `${c.label} ${c.scenes}`).join(', ') || 'none'}`);
  for (const sc of out.scenes) {
    const act = sc.tags.filter((t) => t.level === 'act').map((t) => `${t.id}${t.layer === 'presence' ? `[${t.source}]` : ''}:${t.p}`);
    console.log(`  ${sc.id} ${sc.flagged ? 'FLAG' : '    '} sev ${sc.severity?.['5-7']?.level ?? '-'}/${sc.severity?.['8-10']?.level ?? '-'}  ${act.join(' ')}${sc.mentioned_only?.length ? `  | mentioned: ${sc.mentioned_only.map((m) => m.id).join(',')}` : ''}${sc.cancelled?.length ? `  | cancelled: ${sc.cancelled.map((c) => `${c.id}(${c.by})`).join(',')}` : ''}${sc.vetoed?.length ? `  | kind-gate: ${sc.vetoed.map((v) => `${v.id}->${v.reason}`).join(',')}` : ''}`);
  }
}
