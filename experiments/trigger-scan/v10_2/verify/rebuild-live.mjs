#!/usr/bin/env node
// VERIFIER: re-derive round8/live/<slug>.built.json from the stored live scenes.json + presence.json with the unchanged
// scene-api load.js buildFilmFrom (no model, no DB, no network), and compare. Confirms the live baseline scored is
// exactly what the live code builds from its own model outputs. Writes out/rebuild-live.json.
import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
import * as srt from '../../../../scene-api/pipeline/srt.js';
import * as taxonomy from '../../../../scene-api/pipeline/taxonomy-v3.js';
import { buildFilmFrom, buildVocabulary, buildV2Map } from '../../../../scene-api/load.js';
const here = path.dirname(fileURLToPath(import.meta.url)); const V = path.resolve(here, '..'); const TS = path.resolve(V, '..');
const rj = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const strip = (o) => JSON.parse(JSON.stringify(o, (k, v) => (/(_at|generated|built_at|loaded_at)$/.test(k) ? undefined : v)));
const res = {};
for (const slug of ['incredibles', 'big-hero-6', 'brave']) {
  const L = path.join(V, 'round8', 'live'); const meta = rj(path.join(TS, 'films.json'))[slug];
  const srtText = fs.readFileSync(path.join(TS, meta.track ?? `data/${slug}.srt`), 'utf8');
  const sceneRun = rj(path.join(L, `${slug}.scenes.json`)); const pr = rj(path.join(L, `${slug}.presence.json`));
  const { items } = buildVocabulary(taxonomy);
  const ctx = { srt, v2map: buildV2Map(taxonomy), vocabIds: new Set(items.map((i) => i.id)) };
  const b = buildFilmFrom({ slug, meta: { title: meta.title, year: meta.year ?? null, imdb_id: meta.imdb_id ?? null }, srtText, releaseLabel: null, sceneRun, sceneScript: 'pipeline/scenes.js', sceneSourceFile: null, r2Scenes: null, presenceRun: pr.null_run ? null : pr, presenceScript: 'pipeline/presence.js', presenceSourceFile: null, jevRun: null, jevScript: 'pipeline/record.js', jevSourceFile: null }, ctx);
  const stored = rj(path.join(L, `${slug}.built.json`));
  const same = (a, c) => JSON.stringify(strip(a)) === JSON.stringify(strip(c));
  res[slug] = { scenes_equal: same(b.scenes, stored.scenes), labels_equal: same(b.labels, stored.labels), film_equal: same(b.film, stored.film), scenes: b.scenes.length, scene_spans_equal: JSON.stringify(b.scenes.map((s) => [s.start_ms, s.end_ms])) === JSON.stringify(stored.scenes.map((s) => [s.start_ms, s.end_ms])), spend_total: rj(path.join(L, `${slug}.spend.json`)).entries.reduce((a, e) => a + e.usd, 0), scene_run_cost: sceneRun.cost_usd, presence_cost: pr.cost_usd };
}
fs.writeFileSync(path.join(here, 'out', 'rebuild-live.json'), JSON.stringify(res, null, 2)); console.log(JSON.stringify(res, null, 1));
