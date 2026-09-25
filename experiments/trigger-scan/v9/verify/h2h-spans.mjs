#!/usr/bin/env node
// Round-4 VERIFIER: spot-check v8 skip spans on wordless peaks against the SRT (terminal only; prints
// cue timings and at most the first 4 words of a cue). No model calls.
//   node verify/h2h-spans.mjs <slug>:<itemId> ...
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSrt } from '../../srt.js';

const V8 = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TS = path.resolve(V8, '..');
const rj = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const t = (ms) => { const s = Math.round(ms / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
const ovl = (spans, a, b) => spans.reduce((x, [p, q]) => x + Math.max(0, Math.min(q, b) - Math.max(p, a)), 0);

for (const arg of process.argv.slice(2)) {
  const [slug, id] = arg.split(':');
  const key = rj(path.join(TS, 'refs', `${slug}.key.json`));
  const it = key.items.find((i) => i.id === id);
  const tags = rj(path.join(V8, 'out', `${slug}.tags.r1.json`));
  const cues = parseSrt(fs.readFileSync(path.join(TS, 'data', `${slug}.srt`), 'utf8'));
  const sc = tags.scenes.find((s) => it.start_ms < s.end_ms && it.end_ms > s.start_ms);
  const all = tags.scenes.filter((s) => s.flagged).flatMap((s) => s.skip.spans.map((x) => [x.start_ms, x.end_ms]));
  const shareIn = ovl(all, it.start_ms, it.end_ms) / Math.max(1, it.end_ms - it.start_ms);
  console.log(`\n== ${slug} ${id} should_flag=${it.should_flag} wordless=${it.wordless} item ${t(it.start_ms)}-${t(it.end_ms)} gap ${t(it.gap_start_ms)}-${t(it.gap_end_ms)} cues ${it.cue_range}`);
  console.log(`   scene ${sc.id} ${t(sc.start_ms)}-${t(sc.end_ms)} flagged=${sc.flagged} reasons=${(sc.flag_reasons ?? []).map((r) => r.id).join(',')} whole=${sc.whole_span}`);
  for (const x of sc.skip?.spans ?? []) console.log(`   skip ${t(x.start_ms)}-${t(x.end_ms)} ${JSON.stringify(Object.fromEntries(Object.entries(x).filter(([k]) => !k.endsWith('_ms'))))}`);
  console.log(`   share of item inside ALL v8 skips: ${shareIn.toFixed(3)} (>=0.8 covered)`);
  const lo = it.start_ms - 45000; const hi = it.end_ms + 45000;
  let prev = null;
  for (const c of cues.filter((c) => c.endMs >= lo && c.startMs <= hi)) {
    const gap = prev ? Math.round((c.startMs - prev.endMs) / 1000) : 0;
    const inItem = c.endMs >= it.start_ms && c.startMs <= it.end_ms ? '*' : ' ';
    const inSkip = ovl(all, c.startMs, c.endMs) > 0 ? 'S' : '.';
    const words = c.text.replace(/\s+/g, ' ').split(' ').slice(0, 4).join(' ');
    console.log(`   ${inItem}${inSkip} #${c.index ?? c.id} ${t(c.startMs)}-${t(c.endMs)}${gap >= 8 ? `  [silence ${gap}s before]` : ''}  ${words}`);
    prev = c;
  }
}
