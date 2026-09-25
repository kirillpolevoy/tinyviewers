#!/usr/bin/env node
// Dev-film effect of the v6 wordless-action span rule (spans.js) against v5.1's, with the flagged
// scenes and Jev's begin/end lines held fixed. No model calls. Two inputs per dev film:
//   v5   ../v5/out tags.r1 (v5.1 flags) + moments.r1 (round-1 answers, respanned under v5.1)
//   v6   out-dev tags.r1 + moments.r1 (the builder's v6 dev run on v5's segmentation)
// For each: skip minutes and live-DB scenes >= 50% inside skip spans, under
//   v5.1 rule: begin = min(first.start - 15 s, previous line's end) (unbounded back over a gap, never
//             past the scene start); a span ending at the scene's last line runs to the scene end
//             (unbounded); whole-scene skips = the extended scene
//   v6 rule:   spans.js (lead-in over <= 60 s of silence before a line that reacts to action, may
//             cross the scene start; else 15 s pad; trailing <= 60 s; whole scenes get the lead-in)
// Writes out-dev/span-effect.json (numbers only).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSrt } from '../../srt.js';
import { spanFromLines as v6Span, wholeSceneSpan, unionSpans } from '../spans.js';
import { loadPolicy } from '../select.js';
import { union, total, inter } from '../refscore.js';
import * as L from '../../../../scene-api/load.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const V6 = path.resolve(here, '..');
const TS = path.resolve(V6, '..');
const cfg = loadPolicy();
const readJson = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const min = (ms) => Math.round(ms / 60) / 1000;

function v51Span(bi, ei, lineIds, cuesById, scene) {
  const first = cuesById.get(lineIds[bi]);
  const last = cuesById.get(lineIds[ei]);
  let back = first.startMs - 15000;
  if (bi > 0) back = Math.min(back, cuesById.get(lineIds[bi - 1]).endMs);
  const start = bi === 0 ? scene.start_ms : Math.max(scene.start_ms, back);
  const stop = ei === lineIds.length - 1 ? scene.end_ms : Math.min(scene.end_ms, last.endMs + 5000);
  return { start_ms: start, end_ms: stop };
}

const ctx = await L.openExperiment(TS);
const v2map = L.buildV2Map(ctx.taxonomy);
const vocabIds = new Set(L.buildVocabulary(ctx.taxonomy).items.map((i) => i.id));
const baseSpans = (slug) => { const b = L.buildFilmFrom(L.readFilmInputs(slug, ctx), { srt: ctx.srt, v2map, vocabIds }); return b.scenes.map((s) => [s.start_ms, s.end_ms]); };

function skipUnder(rule, tags, moments, cues) {
  const byIndex = new Map(cues.map((c) => [c.index, c]));
  const spans = [];
  let leadIns = 0;
  for (const s of tags.scenes.filter((x) => x.flagged)) {
    const slice = cues.slice(s.start_cue - 1, s.end_cue);
    const lineIds = slice.map((c) => `L${c.index}`);
    const cuesById = new Map(slice.map((c) => [`L${c.index}`, c]));
    const m = moments?.scenes?.[s.id];
    const rows = m?.method === 'moments' ? (m.per_reason ?? []).filter((r) => r.begin && r.end) : [];
    if (!rows.length) {
      if (rule === 'v6') { const w = wholeSceneSpan(s, slice, cfg, byIndex); if (w.lead_in) leadIns++; spans.push(w); } else spans.push({ start_ms: s.start_ms, end_ms: s.end_ms });
      continue;
    }
    for (const r of rows) {
      const bi = lineIds.indexOf(r.begin.line); const ei = lineIds.indexOf(r.end.line);
      const [a, b] = [Math.min(bi, ei), Math.max(bi, ei)];
      if (rule === 'v6') { const x = v6Span(a, b, lineIds, cuesById, s, cfg, byIndex); if (x.lead_in) leadIns++; spans.push(x); } else spans.push(v51Span(a, b, lineIds, cuesById, s));
    }
  }
  const u = union(unionSpans(spans).map((x) => [x.start_ms, x.end_ms]));
  return { u, leadIns };
}

const out = {};
for (const slug of ['nemo', 'monsters-inc', 'lion-king']) {
  const cues = parseSrt(fs.readFileSync(path.join(TS, 'data', `${slug}.srt`), 'utf8'));
  const base = baseSpans(slug);
  const covered = (u) => base.filter(([a, b]) => inter(u, [[a, b]]) / Math.max(1, b - a) >= 0.5).length;
  const row = {};
  for (const [name, dir] of [['v5_flags', path.join(TS, 'v5', 'out')], ['v6_dev_flags', path.join(V6, 'out-dev')]]) {
    const tags = readJson(path.join(dir, `${slug}.tags.r1.json`));
    const mom = readJson(path.join(dir, `${slug}.moments.r1.json`));
    const a = skipUnder('v51', tags, mom, cues);
    const b = skipUnder('v6', tags, mom, cues);
    row[name] = {
      flagged: tags.scenes.filter((x) => x.flagged).length,
      skip_min_v51_rule: min(total(a.u)), skip_min_v6_rule: min(total(b.u)),
      live_db_covered_v51_rule: `${covered(a.u)}/${base.length}`, live_db_covered_v6_rule: `${covered(b.u)}/${base.length}`,
      v6_lead_in_spans: b.leadIns,
      minutes_only_in_v6_rule: min(total(b.u) - inter(a.u, b.u)), minutes_only_in_v51_rule: min(total(a.u) - inter(a.u, b.u)),
    };
  }
  out[slug] = row;
  console.log(slug, JSON.stringify(row));
}
fs.writeFileSync(path.join(V6, 'out-dev', 'span-effect.json'), JSON.stringify({ generated_at: new Date().toISOString(), films: out }, null, 2));
