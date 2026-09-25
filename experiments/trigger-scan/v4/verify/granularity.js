// Verifier: granularity floor + boundary agreement between v4 segmentation and baseline scenes.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as L from '../../../../scene-api/load.js';
const here = path.dirname(fileURLToPath(import.meta.url));
const V4 = path.resolve(here, '..'); const TS = path.resolve(V4, '..');
const ctx = await L.openExperiment(TS);
const v2map = L.buildV2Map(ctx.taxonomy);
const vocabIds = new Set(L.buildVocabulary(ctx.taxonomy).items.map((i) => i.id));
const ov = (a0, a1, b0, b1) => Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));
for (const slug of ['nemo', 'monsters-inc']) {
  const built = L.buildFilmFrom(L.readFilmInputs(slug, ctx), { srt: ctx.srt, v2map, vocabIds });
  const base = built.scenes.map((s) => ({ id: s.id.split(':').pop(), s: s.start_ms, e: s.end_ms }));
  const seg = JSON.parse(fs.readFileSync(path.join(V4, 'out', `${slug}.segments.json`))).scenes;
  const sc = seg.map((s, i) => ({ ...s, ee: seg[i + 1]?.start_ms ?? s.end_ms }));
  const need = sc.filter((s) => base.some((b) => ov(s.start_ms, s.ee, b.s, b.e) >= Math.min(5000, 0.5 * (b.e - b.s))));
  const mins = need.reduce((a, s) => a + s.ee - s.start_ms, 0) / 60000;
  const bmins = base.reduce((a, b) => a + b.e - b.s, 0) / 60000;
  const lens = sc.map((s) => (s.ee - s.start_ms) / 1000).sort((a, b) => a - b);
  const blens = base.map((b) => (b.e - b.s) / 1000).sort((a, b) => a - b);
  const med = (a) => a[Math.floor(a.length / 2)];
  // how many baseline scenes start/end within 10 s of a v4 boundary
  const bounds = sc.map((s) => s.start_ms);
  const near = (t, tol) => bounds.some((x) => Math.abs(x - t) <= tol);
  const startNear = base.filter((b) => near(b.s, 10000)).length;
  // baseline scenes that span >1 v4 scene (split) and v4 scenes containing >1 baseline scene (merged)
  const splitB = base.filter((b) => sc.filter((s) => ov(s.start_ms, s.ee, b.s, b.e) >= 5000).length > 1).length;
  const mergedV = sc.filter((s) => base.filter((b) => ov(s.start_ms, s.ee, b.s, b.e) >= Math.min(5000, 0.5 * (b.e - b.s))).length > 1).map((s) => s.id);
  console.log(`${slug}: v4 median scene ${med(lens).toFixed(0)} s (max ${lens.at(-1).toFixed(0)}), baseline median ${med(blens).toFixed(0)} s. Baseline total ${bmins.toFixed(1)} min.`);
  console.log(`  floor: flagging exactly the v4 scenes that hold a baseline scene = ${need.length} scenes, ${mins.toFixed(1)} min (${(mins / bmins).toFixed(2)}x baseline)`);
  console.log(`  baseline starts within 10 s of a v4 boundary: ${startNear}/${base.length}; baseline scenes split across >1 v4 scene: ${splitB}; v4 scenes holding >1 baseline scene: ${mergedV.join(',')}`);
}
