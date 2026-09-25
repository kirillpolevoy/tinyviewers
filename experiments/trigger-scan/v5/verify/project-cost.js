#!/usr/bin/env node
// Offline cost projection (no model calls): plans the v5 two-request layout for every scene of v4's
// Nemo and Monsters, Inc. segmentations (real scene lengths and line counts) and reports estimated
// tokens per scene and per 100-scene film, calibrated by the fixture run's actual/estimated ratio.
//
// v4 segments are NOT v2-contract: their summaries were written from memory and are unverified. For
// ESTIMATION ONLY this adapter treats each v4 summary as one sentence of about the same length (token
// count is what matters) and gives the film a full generated layer at the cap (40 questions), so the
// projection is an upper-side estimate. Nothing here is sent anywhere.
//
//   node verify/project-cost.js
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSrt } from '../../srt.js';
import { planScene, singleLayoutEstimate } from '../classify.js';
import { planMoments } from '../moments.js';
import { loadPolicy } from '../select.js';
import { filmQuestions } from '../questions.js';
import { usd as usdOf } from '../jev-client.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const V5 = path.resolve(here, '..');
const TS = path.resolve(V5, '..');
const cfg = loadPolicy();
const ok = { verdict: 'supports', confidence: 1, by: 'estimate-adapter' };

// Calibration from the fixture run, when it exists: billed input tokens / estimated tokens.
let calib = 1;
const fx = path.join(V5, 'out', 'fixture.jev.r1.json');
if (fs.existsSync(fx)) {
  const r = JSON.parse(fs.readFileSync(fx, 'utf8'));
  calib = r.usage.input_tokens / r.estimate.est_tokens_total;
}

// A synthetic film layer at the cap: 8 villains/children (2 presence + 1 event = 3 q each) + 4 dangers ~ 28-40 q.
function capItems(cast) {
  const items = [];
  for (const c of cast.slice(0, 12)) {
    items.push({ entity: c.id, name: c.name, who: c.name, id: `${c.id}_present`, type: 'presence', group: 'creatures_figures', label: c.name });
    items.push({ entity: c.id, name: c.name, who: c.name, id: `${c.id}_threatens`, type: 'threatens', group: 'peril', label: c.name, moment: `${c.name} threatens, chases, or attacks someone` });
  }
  let n = Object.keys(filmQuestions(items)).length;
  while (n > 40) { items.pop(); items.pop(); n = Object.keys(filmQuestions(items)).length; }
  return items;
}

const rows = [];
for (const slug of ['nemo', 'monsters-inc']) {
  const v4 = JSON.parse(fs.readFileSync(path.join(TS, 'v4', 'out', `${slug}.segments.json`), 'utf8'));
  const cues = parseSrt(fs.readFileSync(path.join(TS, 'data', `${slug}.srt`), 'utf8'));
  const cast = v4.cast.map((c, i) => ({ id: `C${String(i + 1).padStart(2, '0')}`, name: c.name, aliases: [], kind: c.role === 'child' ? 'child' : 'unknown', is_child: c.role === 'child', looks_frightening: 'unknown', disposition: 'unknown', disposition_note: c.note?.split(/\s+/).slice(0, 12).join(' ') ?? '', check: { is_child: ok, kind: ok } }));
  const seg = { film: v4.film, cast, dangers: [{ id: 'D01', name: 'a named danger', kind: 'place', note: 'twelve words of note about where this danger is found here', check: ok }], scenes: v4.scenes.map((s) => ({ ...s, sentences: [{ text: s.summary, cites: [], check: ok }] })) };
  const items = capItems(cast);
  let lines = 0; let context = 0; let single = 0; let maxReq = 0; let mom = 0; let momCalls = 0;
  for (const s of seg.scenes) {
    const sc = cues.slice(s.start_cue - 1, s.end_cue);
    const p = planScene({ seg, scene: s, cues: sc, items });
    lines += p.reqs[0].est; context += p.reqs[1].est; single += singleLayoutEstimate(p);
    maxReq = Math.max(maxReq, ...p.reqs.map((r) => r.est));
    // moments, as if every scene were flagged with two reasons (upper bound)
    const m = planMoments({ film: seg.film, scene: s, cues: sc, reasons: [{ id: 'chased', rule: 'strong_event' }, { id: 'captured', rule: 'strong_event' }], items: [], cfg });
    if (m.call) { mom += m.est; momCalls++; }
  }
  const n = seg.scenes.length;
  const perScene = ((lines + context) / n) * calib;
  rows.push({
    film: slug, scenes: n, generated_questions: Object.keys(filmQuestions(items)).length,
    est_tokens_per_scene: Math.round(perScene),
    est_tokens_per_scene_lines: Math.round((lines / n) * calib), est_tokens_per_scene_context: Math.round((context / n) * calib),
    split_overhead_vs_single_request: +((lines + context) / single - 1).toFixed(3),
    largest_request_est_tokens: maxReq,
    usd_per_scene: +usdOf(perScene).toFixed(6),
    usd_per_100_scene_film_classify: +usdOf(perScene * 100).toFixed(4),
    usd_per_100_scene_film_moments_if_all_flagged: +usdOf((mom / Math.max(1, momCalls)) * calib * 100).toFixed(4),
  });
}
console.log(JSON.stringify({ calibration_billed_over_estimate: +calib.toFixed(3), films: rows }, null, 2));
