// Verifier: classify baseline tags that v4 did not assert on covered baseline scenes.
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
const material = (a0, a1, b0, b1) => ov(a0, a1, b0, b1) > 0 && ov(a0, a1, b0, b1) >= Math.min(10000, 0.5 * Math.min(a1 - a0, b1 - b0));
for (const slug of ['nemo', 'monsters-inc']) {
  const built = L.buildFilmFrom(L.readFilmInputs(slug, ctx), { srt: ctx.srt, v2map, vocabIds });
  const tags = JSON.parse(fs.readFileSync(path.join(V4, 'out', `${slug}.tags.r1.json`))).scenes;
  const sc = tags.map((s, i) => ({ ...s, ee: tags[i + 1]?.start_ms ?? s.end_ms }));
  const cls = {}; const byItem = {};
  let total = 0;
  for (const s of built.scenes) {
    const labels = built.labels.filter((l) => l.scene_id === s.id && l.asserted && l.channel !== 'mention');
    const mat = sc.filter((v) => v.flagged && material(v.start_ms, v.ee, s.start_ms, s.end_ms));
    if (!mat.length) continue;
    const allV = sc.filter((v) => material(v.start_ms, v.ee, s.start_ms, s.end_ms));
    const nb = sc.filter((v) => ov(v.start_ms, v.ee, s.start_ms - 60000, s.end_ms + 60000) > 0);
    for (const l of labels) {
      total++;
      const id = l.vocabulary_id;
      const act = mat.some((v) => v.tags.some((t) => t.v3 === id && t.level === 'act'));
      if (act) continue;
      const kind = l.channel === 'presence' ? (l.confidence_kind === 'known_from_film' ? 'presence_film' : 'presence_lines') : 'event';
      const poss = allV.some((v) => v.tags.some((t) => t.v3 === id && t.level === 'possible'));
      const cancelled = allV.some((v) => (v.cancelled || []).some((c) => sc && c.id && (c.id === id || tags && false)));
      const neighbour = nb.some((v) => v.tags.some((t) => t.v3 === id && t.level === 'act'));
      const why = poss ? 'possible_0.40-0.70' : neighbour ? 'act_in_neighbour_scene(+-60s)' : 'absent_below_0.40';
      const k = `${kind} / ${why}`; cls[k] = (cls[k] || 0) + 1;
      byItem[`${id}:${why.split('_')[0]}`] = (byItem[`${id}:${why.split('_')[0]}`] || 0) + 1;
    }
  }
  const miss = Object.values(cls).reduce((a, b) => a + b, 0);
  console.log(`\n${slug}: ${miss} of ${total} baseline tags on flag-overlapped baseline scenes are not act-level in v4`);
  for (const [k, v] of Object.entries(cls).sort((a, b) => b[1] - a[1])) console.log(`  ${String(v).padStart(3)} ${k}`);
  console.log('  top items:', Object.entries(byItem).sort((a, b) => b[1] - a[1]).slice(0, 14).map((e) => e.join(' ')).join(', '));
}
