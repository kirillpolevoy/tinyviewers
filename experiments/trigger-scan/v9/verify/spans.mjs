#!/usr/bin/env node
// Verifier: held-out moment spans vs the SRT. Prints to terminal only (nothing stored).
//   node verify/spans.mjs <slug> <sceneId> [--text]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSrt } from '../../srt.js';

const V8 = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TS = path.resolve(V8, '..');
const [slug, sid] = process.argv.slice(2);
const showText = process.argv.includes('--text');
const cues = parseSrt(fs.readFileSync(path.join(TS, 'data', `${slug}.srt`), 'utf8'));
const tags = JSON.parse(fs.readFileSync(path.join(V8, 'out', `${slug}.tags.r1.json`), 'utf8'));
const mom = JSON.parse(fs.readFileSync(path.join(V8, 'out', `${slug}.moments.r1.json`), 'utf8'));
const key = JSON.parse(fs.readFileSync(path.join(TS, 'refs', `${slug}.key.json`), 'utf8'));
const s = tags.scenes.find((x) => x.id === sid);
const t = (ms) => new Date(ms).toISOString().slice(11, 19);
const cueAt = (ms) => cues.findIndex((c) => c.endMs >= ms) + 1;
console.log(`${slug} ${sid} cues ${s.start_cue}-${s.end_cue} ${t(s.start_ms)}-${t(s.end_ms)} flagged=${s.flagged} reasons=${(s.flag_reasons ?? []).map((r) => r.id).join(',')}`);
const spans = s.skip?.spans ?? [];
for (const sp of spans) console.log(`  skip ${t(sp.start_ms)}-${t(sp.end_ms)} (${((sp.end_ms - sp.start_ms) / 1000).toFixed(0)} s) ~ cues ${cueAt(sp.start_ms)}-${cueAt(sp.end_ms)}`);
const m = mom.scenes?.[sid];
if (m) console.log('  moments entry:', JSON.stringify(m).slice(0, 1500));
const inScene = key.items.filter((i) => i.mappable && Number.isFinite(i.start_ms) && i.start_ms < s.end_ms && i.end_ms > s.start_ms);
for (const i of inScene) {
  const ov = spans.reduce((a, sp) => a + Math.max(0, Math.min(sp.end_ms, i.end_ms) - Math.max(sp.start_ms, i.start_ms)), 0);
  console.log(`  key ${i.id} ${i.source} flag=${i.should_flag} ${t(i.start_ms)}-${t(i.end_ms)} cues ${i.cue_range} covered ${(ov / Math.max(1, i.end_ms - i.start_ms)).toFixed(2)} :: ${i.text}`);
}
if (showText) for (let n = s.start_cue; n <= s.end_cue; n++) { const c = cues[n - 1]; const inSkip = spans.some((sp) => c.startMs < sp.end_ms && c.endMs > sp.start_ms); console.log(`   ${inSkip ? '*' : ' '} L${n} ${t(c.startMs)} ${c.text.replace(/\n/g, ' ')}`); }
