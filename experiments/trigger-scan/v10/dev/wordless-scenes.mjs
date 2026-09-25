#!/usr/bin/env node
// Dev-only (fix b): scenes with little dialogue (< 3 dialogue cues per minute over the scene's
// extended bounds, policy scene_bounds) per dev film: sentences / verified, Wikipedia cites, flag,
// and every mapped key item (>= 50% inside the scene) with whether the skip covers it. Ids and
// numbers only.
//   node dev/wordless-scenes.mjs [outDir=out] [films]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSrt } from '../../srt.js';
import { union, shareInside } from '../refscore.js';
import { isCaptionOnly } from '../spans.js';
const here = path.dirname(fileURLToPath(import.meta.url));
const V8 = path.resolve(here, '..');
const TS = path.resolve(V8, '..');
const OUT = path.resolve(V8, process.argv[2] ?? 'out');
const films = (process.argv[3] ?? 'nemo,monsters-inc,lion-king,frankenweenie,wild-robot,iron-giant,up').split(',');
const t = (ms) => { const s = Math.round(ms / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
for (const slug of films) {
  const tags = JSON.parse(fs.readFileSync(path.join(OUT, `${slug}.tags.r1.json`), 'utf8'));
  const seg = JSON.parse(fs.readFileSync(path.join(OUT, `${slug}.segments.json`), 'utf8'));
  const key = JSON.parse(fs.readFileSync(path.join(V8, 'out', 'refs-human', `${slug}.key.json`), 'utf8'));
  const cues = parseSrt(fs.readFileSync(path.join(TS, 'data', `${slug}.srt`), 'utf8'));
  const U = union(tags.scenes.filter((s) => s.flagged).flatMap((s) => (s.skip?.spans ?? []).map((x) => [x.start_ms, x.end_ms])));
  const items = key.items.filter((i) => i.mappable && Number.isFinite(i.start_ms));
  console.log(`\n=== ${slug}`);
  for (const s of tags.scenes) {
    const sc = cues.slice(s.start_cue - 1, s.end_cue);
    const min = (s.end_ms - s.start_ms) / 60000;
    const dpm = sc.filter((c) => !isCaptionOnly(c.text)).length / min;
    if (dpm >= 3) continue;
    const ss = seg.scenes.find((x) => x.id === s.id);
    const inside = items.filter((i) => shareInside(i.start_ms, i.end_ms, [[s.start_ms, s.end_ms]]) >= 0.5);
    console.log(`${s.id} ${t(s.start_ms)}-${t(s.end_ms)} (${min.toFixed(1)} min, ${sc.length} cues, ${dpm.toFixed(1)}/min) ${s.flagged ? 'FLAG ' + s.flag_reasons.map((r) => r.id).join(',') : 'no flag'} | sentences ${ss.sentences.length} verified ${ss.sentences.filter((x) => x.check?.status === 'verified').length} W ${[...new Set(ss.sentences.flatMap((x) => x.cites.filter((c) => c[0] === 'W')))].join(',') || '-'} | key ${inside.map((i) => `${i.id}${i.should_flag === true ? '*' : i.should_flag === 'tag_only' ? '~' : ''}:${shareInside(i.start_ms, i.end_ms, U).toFixed(2)}`).join(' ') || '-'}`);
  }
}
