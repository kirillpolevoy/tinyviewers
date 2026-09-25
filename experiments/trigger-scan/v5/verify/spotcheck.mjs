#!/usr/bin/env node
// Spot-check moment spans against the SRT. Writes verify/out/spotcheck.txt (contains subtitle text;
// git-ignored under verify/out/). Usage: node verify/spotcheck.mjs nemo:S042 monsters-inc:S040 ...
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSrt, formatTime } from '../../srt.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const V5 = path.resolve(here, '..');
const rd = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const lines = [];
for (const arg of process.argv.slice(2)) {
  const [slug, id] = arg.split(':');
  const cues = parseSrt(fs.readFileSync(path.join(V5, '..', 'data', `${slug}.srt`), 'utf8'));
  const tags = rd(path.join(V5, 'out', `${slug}.tags.r1.json`));
  const mom = rd(path.join(V5, 'out', `${slug}.moments.r1.json`));
  const seg = rd(path.join(V5, 'out', `${slug}.segments.json`));
  const s = tags.scenes.find((x) => x.id === id);
  const m = mom.scenes[id];
  const sg = seg.scenes.find((x) => x.id === id);
  lines.push(`\n===== ${slug} ${id} ${formatTime(s.start_ms)}-${formatTime(s.end_ms)} flagged=${s.flagged} reasons=${s.flag_reasons.map((r) => r.id).join(',')}`);
  lines.push(`summary sentences: ${sg.sentences.map((x) => `[${x.check?.status}] ${x.text}`).join(' || ')}`);
  lines.push(`method=${m?.method} why=${m?.why ?? ''} spans=${(m?.spans ?? []).map((x) => `${formatTime(x.start_ms)}-${formatTime(x.end_ms)}`).join(', ')}`);
  for (const p of m?.per_reason ?? []) lines.push(`  reason "${p.clause}" exists ${p.exists} begin ${p.begin?.line}(${p.begin?.p}) end ${p.end?.line}(${p.end?.p}) ${p.fallback ?? ''}`);
  const inSpan = (c) => (m?.spans ?? []).some((x) => c.endMs > x.start_ms && c.startMs < x.end_ms);
  for (const c of cues.slice(s.start_cue - 1, s.end_cue)) lines.push(`${inSpan(c) ? '##' : '  '} L${c.index} ${formatTime(c.startMs)} ${c.text}`);
}
fs.mkdirSync(path.join(here, 'out'), { recursive: true });
fs.writeFileSync(path.join(here, 'out', 'spotcheck.txt'), lines.join('\n'));
console.log('wrote verify/out/spotcheck.txt', lines.length, 'lines');
