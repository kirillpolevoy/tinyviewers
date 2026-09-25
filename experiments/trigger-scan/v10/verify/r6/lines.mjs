#!/usr/bin/env node
// Round-6 VERIFIER helper: print a scene's subtitle lines to the terminal (never stored) for manual
// description checks.  node verify/r6/lines.mjs <slug> <v10|live> <sceneId> [padSec]
import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
import { parseSrt } from '../../../srt.js';
const V10 = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..'); const TS = path.resolve(V10, '..');
const [slug, sys, id, pad = '0'] = process.argv.slice(2);
const rj = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const cues = parseSrt(fs.readFileSync(path.join(TS, 'data', `${slug}.srt`), 'utf8'));
let a, b;
if (sys === 'v10') { const s = rj(path.join(V10, 'out10', `${slug}.tags.r1.json`)).scenes.find((x) => x.id === id); a = s.start_ms; b = s.end_ms; console.log('V10', s.why?.title, '|', s.why?.text, '| reasons', s.flag_reasons.map((r) => r.id).join(',')); }
else { const s = rj(path.join(V10, 'round6', 'live', `${slug}.built.json`)).scenes.find((x) => x.id.split(':').pop() === id); a = s.start_ms; b = s.end_ms; console.log('LIVE', s.title, '|', s.description); }
a -= Number(pad) * 1000; b += Number(pad) * 1000;
console.log(`${slug} ${sys} ${id} ${(a / 60000).toFixed(2)}-${(b / 60000).toFixed(2)} min`);
for (const c of cues) { const st = c.startMs ?? c.start_ms; if (st >= a && st <= b) console.log(`${(st / 1000).toFixed(0)}s ${String(c.text).replace(/\n/g, ' / ')}`); }
