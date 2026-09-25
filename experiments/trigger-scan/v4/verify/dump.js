// Verifier helper: per v4 scene, overlap with baseline + act tags. Prints to stdout only.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as L from '../../../../scene-api/load.js';
const here = path.dirname(fileURLToPath(import.meta.url));
const V4 = path.resolve(here, '..');
const TS = path.resolve(V4, '..');
const slug = process.argv[2]; const run = process.argv[3] || 'r1'; const mode = process.argv[4] || 'v4';
const ctx = await L.openExperiment(TS);
const v2map = L.buildV2Map(ctx.taxonomy);
const vocabIds = new Set(L.buildVocabulary(ctx.taxonomy).items.map((i) => i.id));
const inputs = L.readFilmInputs(slug, ctx);
const built = L.buildFilmFrom(inputs, { srt: ctx.srt, v2map, vocabIds });
const base = built.scenes.map((s) => ({ id: s.id.split(':').pop(), title: s.title, s: s.start_ms, e: s.end_ms, sev: [s.severity_5_7, s.severity_8_10],
  tags: built.labels.filter((l) => l.scene_id === s.id && l.asserted && l.channel !== 'mention').map((l) => l.vocabulary_id + (l.channel === 'presence' ? (l.confidence_kind === 'known_from_film' ? '[film]' : '[lines]') : '')) }));
const tags = JSON.parse(fs.readFileSync(path.join(V4, 'out', `${slug}.tags.${run}.json`)));
const seg = JSON.parse(fs.readFileSync(path.join(V4, 'out', `${slug}.segments.json`)));
const segBy = new Map(seg.scenes.map((s) => [s.id, s]));
const ov = (a0, a1, b0, b1) => Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));
const t = (ms) => { const s = Math.round(ms / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
if (mode === 'base') { for (const b of base) console.log(`${b.id} ${t(b.s)}-${t(b.e)} sev${b.sev} ${b.title} :: ${b.tags.join(', ')}`); process.exit(0); }
for (const [i, s] of tags.scenes.entries()) {
  const next = tags.scenes[i + 1]; const ee = next ? next.start_ms : s.end_ms;
  const hits = base.filter((b) => ov(s.start_ms, ee, b.s, b.e) > 0).map((b) => `${b.id}(${Math.round(100 * ov(s.start_ms, ee, b.s, b.e) / (ee - s.start_ms))}%)`);
  const g = segBy.get(s.id);
  const act = s.tags.filter((x) => x.level === 'act').map((x) => `${x.id}${x.layer === 'presence' ? '/' + x.source[0] : ''}:${x.p}`);
  const mods = Object.entries(s.modifiers || {}).filter(([, v]) => v.p >= 0.5).map(([k, v]) => `${k}:${v.p}`);
  console.log(`\n${s.id} ${t(s.start_ms)}-${t(ee)} cues${s.start_cue}-${s.end_cue} ${s.flagged ? 'FLAG' : 'calm'} sev${s.severity?.['5-7']?.level}/${s.severity?.['8-10']?.level} kff=${g.known_from_film} base=[${hits.join(' ')}] mods=[${mods}]`);
  console.log(`  ${g.summary}`);
  console.log(`  act: ${act.join(', ')}`);
  if (s.cancelled?.length) console.log(`  cancelled: ${JSON.stringify(s.cancelled)}`);
}
