#!/usr/bin/env node
// Round-6 VERIFIER: recompute the split-gate failure on frozen / zootopia from the saved attempt-1 output
// (round6/out/<slug>.attempt1.json) and the error files (frozen-config and rescue): longest scene (dialogue
// bounds, gate.js definition: end cue end - start cue start), its cue range and start minute, the share of
// music-note cues in it, and the longest scene with the credits tail excluded. Writes counts only (no cue text).
// `--show` prints cue texts of the long scene to the terminal for a manual look (never stored).
import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
import { parseSrt } from '../../../srt.js';
const V10 = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..'); const TS = path.resolve(V10, '..');
const rj = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const r3 = (x) => Math.round(x * 1000) / 1000;
const show = process.argv.includes('--show');
const out = {};
for (const slug of ['frozen', 'zootopia']) {
  const cues = parseSrt(fs.readFileSync(path.join(TS, 'data', `${slug}.srt`), 'utf8'));
  const st = (c) => c.startMs ?? c.start_ms; const en = (c) => c.endMs ?? c.end_ms;
  const a1 = rj(path.join(V10, 'round6', 'out', `${slug}.attempt1.json`)).data.scenes;
  const mins = a1.map((s) => ({ start_cue: s.start_cue, end_cue: s.end_cue, min: r3((en(cues[s.end_cue - 1]) - st(cues[s.start_cue - 1])) / 60000), start_min: r3(st(cues[s.start_cue - 1]) / 60000) }));
  const top = [...mins].sort((x, y) => y.min - x.min).slice(0, 3);
  const L = top[0]; const sc = cues.slice(L.start_cue - 1, L.end_cue);
  const music = sc.filter((c) => /♪|♫|#/.test(c.text)).length;
  const lastIdx = mins.indexOf(L) === mins.length - 1;
  const fc = rj(path.join(V10, 'round6', 'out', 'frozen-config', `${slug}.segments.error.json`));
  const rs = rj(path.join(V10, 'out10', `${slug}.segments.error.json`));
  const gates = (e) => e.attempts.map((x) => ({ attempt: x.attempt, mode: x.mode, pass: x.gate?.pass ?? null, failed: x.gate?.failed ?? x.error ?? null, cost: x.cost_usd, aligned: x.gate?.jev?.metrics?.aligned_share ?? null }));
  out[slug] = { cues: cues.length, film_min: r3(en(cues.at(-1)) / 60000), attempt1_scenes: a1.length, longest3: top, longest_is_last_scene: lastIdx, long_scene_cues: sc.length, long_scene_music_cues: music, second_longest_min: top[1].min,
    frozen_config_attempts: gates(fc), rescue_attempts: gates(rs), frozen_config_sonnet: fc.sonnet_spent_usd, rescue_sonnet: rs.sonnet_spent_usd };
  if (show) { console.log(`--- ${slug} long scene L${L.start_cue}-L${L.end_cue} (${L.min} min from ${L.start_min}); last cues of previous scene:`); for (const c of cues.slice(L.start_cue - 4, L.start_cue - 1)) console.log(`  [prev] ${(st(c) / 60000).toFixed(2)} ${c.text.replace(/\n/g, ' / ').slice(0, 60)}`); for (const c of sc.filter((_, i) => i % 6 === 0)) console.log(`  ${(st(c) / 60000).toFixed(2)} ${c.text.replace(/\n/g, ' / ').slice(0, 60)}`); }
}
fs.writeFileSync(path.join(V10, 'verify', 'r6', 'out', 'segfail.json'), JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 1));
