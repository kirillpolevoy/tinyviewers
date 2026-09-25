#!/usr/bin/env node
// v10.1 SPLIT-GATE REPLAY (no model calls). Re-runs the split gate's CODE checks with the v10.1 rule
// (max_scene_minutes outside the end credits) on SAVED model segmentations and combines them with the Jev
// metrics those same segmentations got when they were checked (the Jev layer did not change), so the
// verdict is what segment.js would decide today. Uses SEGMENTATION FILES ONLY: no classification, question
// answer, description or score of any film is read.
//
//   node dev/replay-gate.mjs            -> dev/out/replay-gate.json + a table
//
// Cases:
//   dev accepted     the 14 dev films' accepted segmentations (v10/out/<slug>.segments.raw.json + the Jev
//                    metrics folded into v10/out/<slug>.segments.json; good-dinosaur from v10/out10)
//   dev round 2      v6/out round-2 splits of nemo, monsters-inc, lion-king, frankenweenie (must pass) and
//                    wild-robot (the broken one: must still FAIL), Jev metrics from v7/out/<slug>.splitcheck.r2.json
//   held-out seg     frozen / zootopia round-6 attempt 1 (v10/round6/out/<slug>.attempt1.json) and attempt 2
//                    (halves, v10/out10/<slug>.segments.raw.json), Jev metrics from v10/out10/<slug>.segments.error.json
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSrt } from '../../srt.js';
import { codeMetrics, gateResult } from '../gate.js';
import { loadGateCfg, creditsFor, modelScenesOf } from '../check-split.js';
import { DEV_FILMS } from '../env.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const V101 = path.resolve(here, '..');
const TS = path.resolve(V101, '..');
const V10 = path.join(TS, 'v10');
const rj = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const cfg = loadGateCfg(path.join(V101, 'policy.json'));
const cfgV10 = { ...rj(path.join(V10, 'policy.json')).split_gate };

function src(slug) {
  for (const f of [path.join(V10, 'sources', `${slug}.json`), path.join(here, '..', 'sources', `${slug}.json`)]) if (fs.existsSync(f)) return rj(f);
  throw new Error(`no sources for ${slug}`);
}
function replay({ group, slug, label, modelScenes, jev, expect }) {
  const cues = parseSrt(fs.readFileSync(path.join(TS, 'data', `${slug}.srt`), 'utf8'));
  const S = src(slug);
  const ctx = { wCount: S.wikipedia.sentences.length, tCount: S.tmdb.cast.length };
  const old = gateResult(codeMetrics(modelScenes, cues, ctx).metrics, jev, cfgV10);
  const credits = creditsFor(cues, cfg);
  const m = codeMetrics(modelScenes, cues, { ...ctx, credits }).metrics;
  const now = gateResult(m, jev, cfg);
  return { group, slug, label, expect, v10: { pass: old.pass, failed: old.failed }, v10_1: { pass: now.pass, failed: now.failed }, ok: expect === (now.pass ? 'pass' : 'fail'), max_scene_minutes: m.max_scene_minutes, max_scene_minutes_with_credits: m.max_scene_minutes_with_credits, credits: m.credits };
}

const rows = [];
// v10.2: frozen / zootopia joined DEV_FILMS (round 7); they are replayed below as the round-6 attempts, as in v10.1
for (const slug of DEV_FILMS.filter((s) => s !== 'frozen' && s !== 'zootopia')) {
  // v10.3: the round-8 films (dev since round 8) as v10.2 ran them
  const dir = ['incredibles', 'big-hero-6', 'brave'].includes(slug) ? path.join(TS, 'v10_2', 'out102') : slug === 'good-dinosaur' ? path.join(V10, 'out10') : path.join(V10, 'out');
  const raw = rj(path.join(dir, `${slug}.segments.raw.json`));
  const seg = rj(path.join(dir, `${slug}.segments.json`));
  rows.push(replay({ group: 'dev accepted', slug, label: 'accepted', modelScenes: modelScenesOf(raw), jev: seg.split_check.jev.metrics, expect: 'pass' }));
}
for (const slug of ['nemo', 'monsters-inc', 'lion-king', 'frankenweenie', 'wild-robot']) {
  const chk = rj(path.join(TS, 'v7', 'out', `${slug}.splitcheck.r2.json`));
  const raw = rj(path.resolve(TS, 'v7', chk.raw_file));
  rows.push(replay({ group: 'dev round 2', slug, label: 'round-2 split', modelScenes: modelScenesOf(raw), jev: chk.jev.metrics, expect: slug === 'wild-robot' ? 'fail' : 'pass' }));
}
for (const slug of ['frozen', 'zootopia']) {
  const err = rj(path.join(V10, 'out10', `${slug}.segments.error.json`));
  const a1 = rj(path.join(V10, 'round6', 'out', `${slug}.attempt1.json`));
  const raw = rj(path.join(V10, 'out10', `${slug}.segments.raw.json`));
  rows.push(replay({ group: 'held-out segmentation', slug, label: 'round-6 attempt 1 (whole film)', modelScenes: a1.data.scenes, jev: err.gate_reports[0].jev.metrics, expect: 'pass' }));
  const a2 = raw.attempts.find((a) => a.attempt === 2);
  rows.push(replay({ group: 'held-out segmentation', slug, label: 'round-6 attempt 2 (halves)', modelScenes: a2.scenes, jev: err.gate_reports[1].jev.metrics, expect: 'pass' }));
}
fs.mkdirSync(path.join(here, 'out'), { recursive: true });
const out = { generated_at: new Date().toISOString(), note: 'segmentation files and their saved Jev split-check metrics only; code metrics recomputed with v10.1 gate.js + credits.js', all_as_expected: rows.every((r) => r.ok), rows };
fs.writeFileSync(path.join(here, 'out', 'replay-gate.json'), JSON.stringify(out, null, 2));
for (const r of rows) console.log(`${r.ok ? 'ok ' : 'BAD'} ${r.group.padEnd(22)} ${r.slug.padEnd(24)} ${r.label.padEnd(32)} v10 ${r.v10.pass ? 'PASS' : 'FAIL'} -> v10.1 ${r.v10_1.pass ? 'PASS' : 'FAIL'}  max scene ${r.max_scene_minutes_with_credits} -> ${r.max_scene_minutes} min${r.credits ? `  credits L${r.credits.start_cue}-${r.credits.end_cue} (${r.credits.how})` : ''}${r.v10_1.failed.length ? `  failed: ${r.v10_1.failed.join('; ')}` : ''}`);
console.log(`all as expected: ${out.all_as_expected}`);
