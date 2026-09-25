#!/usr/bin/env node
// Dev-only (fix a): every mapped should_flag key item marked wordless that lies inside a FLAGGED scene
// (>= 50% of its span inside the flagged scene's bounds): how much of it the skip covers, and the
// silence structure around it (the cue gaps it sits in). Prints numbers and ids only.
//   node dev/wordless-peaks.mjs [outDir=out] [films]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSrt } from '../../srt.js';
import { union, inter, shareInside } from '../refscore.js';
import { isCaptionOnly } from '../spans.js';
const here = path.dirname(fileURLToPath(import.meta.url));
const V8 = path.resolve(here, '..');
const TS = path.resolve(V8, '..');
const OUT = path.resolve(V8, process.argv[2] ?? 'out');
const films = (process.argv[3] ?? 'nemo,monsters-inc,lion-king,frankenweenie,wild-robot,iron-giant,up').split(',');
const t = (ms) => { const s = Math.round(ms / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
for (const slug of films) {
  const tags = JSON.parse(fs.readFileSync(path.join(OUT, `${slug}.tags.r1.json`), 'utf8'));
  const key = JSON.parse(fs.readFileSync(path.join(V8, 'out', 'refs-human', `${slug}.key.json`), 'utf8'));
  const cues = parseSrt(fs.readFileSync(path.join(TS, 'data', `${slug}.srt`), 'utf8'));
  const flagged = tags.scenes.filter((s) => s.flagged);
  const U = union(flagged.flatMap((s) => (s.skip?.spans ?? []).map((x) => [x.start_ms, x.end_ms])));
  const items = key.items.filter((i) => i.mappable && Number.isFinite(i.start_ms) && i.should_flag === true && i.wordless);
  let n = 0, ok = 0;
  const rows = [];
  for (const it of items) {
    const sc = flagged.find((s) => shareInside(it.start_ms, it.end_ms, [[s.start_ms, s.end_ms]]) >= 0.5);
    if (!sc) continue;
    n++;
    const share = shareInside(it.start_ms, it.end_ms, U);
    if (share >= 0.8) ok++;
    // biggest cue gap overlapping the item
    const gaps = [];
    for (let i = 1; i < cues.length; i++) { const a = cues[i - 1].endMs, b = cues[i].startMs; if (b - a >= 5000 && b > it.start_ms && a < it.end_ms) gaps.push(`${cues[i - 1].index}|${cues[i].index} ${t(a)}-${t(b)} (${Math.round((b - a) / 1000)}s)`); }
    const spans = (sc.skip?.spans ?? []).map((x) => `${t(x.start_ms)}-${t(x.end_ms)}${x.lead_in ? 'L' : ''}`).join(' ');
    rows.push(`${share >= 0.8 ? '  ok ' : ' MISS'} ${it.id} ${t(it.start_ms)}-${t(it.end_ms)} (${Math.round((it.end_ms - it.start_ms) / 1000)}s) share ${share.toFixed(2)} scene ${sc.id} ${t(sc.start_ms)}-${t(sc.end_ms)} [${sc.skip?.method}] skip ${spans} | gaps ${gaps.join('; ') || '-'} | ${String(it.text).slice(0, 60)}`);
  }
  console.log(`\n=== ${slug}: wordless should_flag items in flagged scenes ${ok}/${n} >= 80% in skip`);
  rows.forEach((r) => console.log(r));
}
