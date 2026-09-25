#!/usr/bin/env node
// Dev-film decomposition (no model calls): flags and live-DB coverage by flagged scenes under
//   A. v5.1 as saved (../v5/out tags.r1)
//   B. the v6 POLICY over v5's saved Jev answers (v5 question set: no child_frightened / plots_harm /
//      comic_peril answers exist, threatens_harm had v5 wording; v5's 'changes' threat items removed
//      as v6 would not generate them)
//   C. the builder's v6 dev run (out-dev: v6 claim check + v6 questions + v6 policy, v5 segmentation)
// Writes out-dev/policy-on-v5.json (ids and numbers only).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { selectRun, loadPolicy } from '../select.js';
import { union, inter } from '../refscore.js';
import * as L from '../../../../scene-api/load.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const V6 = path.resolve(here, '..');
const TS = path.resolve(V6, '..');
const cfg = loadPolicy();
const readJson = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const ctx = await L.openExperiment(TS);
const v2map = L.buildV2Map(ctx.taxonomy);
const vocabIds = new Set(L.buildVocabulary(ctx.taxonomy).items.map((i) => i.id));
const out = {};
for (const slug of ['nemo', 'monsters-inc', 'lion-king']) {
  const b = L.buildFilmFrom(L.readFilmInputs(slug, ctx), { srt: ctx.srt, v2map, vocabIds }).scenes.map((s) => ({ id: s.id.split(':').pop(), span: [s.start_ms, s.end_ms] }));
  const cover = (scenes) => { const u = union(scenes.filter((s) => s.flagged).map((s) => [s.start_ms, s.end_ms])); return b.filter((x) => inter(u, [x.span]) / Math.max(1, x.span[1] - x.span[0]) >= 0.5).map((x) => x.id); };
  const outside = (scenes) => scenes.filter((s) => s.flagged && !b.some((x) => Math.min(x.span[1], s.line_end_ms) - Math.max(x.span[0], s.line_start_ms) > 0)).map((s) => s.id);
  const A = readJson(path.join(TS, 'v5', 'out', `${slug}.tags.r1.json`));
  const jev5 = readJson(path.join(TS, 'v5', 'out', `${slug}.jev.r1.json`));
  const B = selectRun({ ...jev5, film_items: (jev5.film_items ?? []).filter((it) => !(it.type === 'threatens' && it.why === 'changes')) }, cfg);
  const C = readJson(path.join(V6, 'out-dev', `${slug}.tags.r1.json`));
  const row = (t) => ({ flagged: t.scenes.filter((s) => s.flagged).length, live_db_covered_by_flagged: `${cover(t.scenes).length}/${b.length}`, not_covered: b.map((x) => x.id).filter((id) => !cover(t.scenes).includes(id)), flags_outside_live_db: outside(t.scenes) });
  const flagsA = new Set(A.scenes.filter((s) => s.flagged).map((s) => s.id));
  const flagsB = new Set(B.scenes.filter((s) => s.flagged).map((s) => s.id));
  out[slug] = { v5_1: row(A), v6_policy_on_v5_answers: { ...row(B), added: [...flagsB].filter((x) => !flagsA.has(x)), removed: [...flagsA].filter((x) => !flagsB.has(x)) }, v6_dev_run: row(C) };
  console.log(slug, JSON.stringify(out[slug]));
}
fs.writeFileSync(path.join(V6, 'out-dev', 'policy-on-v5.json'), JSON.stringify({ generated_at: new Date().toISOString(), films: out }, null, 2));
