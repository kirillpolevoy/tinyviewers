#!/usr/bin/env node
// Round-5 VERIFIER: (a) 9-consecutive-word transcript overlap in every stored model string for the held-out
// films (v9 describe / why / tags parent text, v9 segment summaries, the Codex judge notes, live scene
// titles/descriptions); (b) wordless-scene regions check (ii) using fill.js's region definition.
import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
import { parseSrt } from '../../../srt.js';
import { wordlessScenes } from '../../fill.js';
import { loadPolicy } from '../../select.js';
const V9 = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..'); const TS = path.resolve(V9, '..');
const rj = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const words = (s) => s.toLowerCase().replace(/<[^>]+>/g, ' ').replace(/[^a-z0-9'\s]/g, ' ').replace(/'/g, '').split(/\s+/).filter(Boolean);
const N = 9;
const strings = (o, out = []) => { if (typeof o === 'string') { if (o.split(/\s+/).length >= N) out.push(o); } else if (Array.isArray(o)) o.forEach((x) => strings(x, out)); else if (o && typeof o === 'object') Object.values(o).forEach((x) => strings(x, out)); return out; };
const desc = rj(path.join(V9, 'round5', 'out', 'descriptions.json'));
const res = {};
for (const slug of ['book-of-life', 'princess-and-the-frog', 'moana']) {
  const cues = parseSrt(fs.readFileSync(path.join(TS, 'data', `${slug}.srt`), 'utf8'));
  const tw = words(cues.map((c) => c.text).join(' '));
  const grams = new Set(); for (let i = 0; i + N <= tw.length; i++) grams.add(tw.slice(i, i + N).join(' '));
  const hits = (arr) => arr.filter((s) => { const w = words(s); for (let i = 0; i + N <= w.length; i++) if (grams.has(w.slice(i, i + N).join(' '))) return true; return false; });
  const t = rj(path.join(V9, 'out', `${slug}.tags.r1.json`));
  const v9s = [...strings(rj(path.join(V9, 'out', `${slug}.describe.r1.json`)).scenes), ...strings(rj(path.join(V9, 'out', `${slug}.why.r1.json`)).scenes), ...strings(t.scenes.map((s) => s.why)), ...strings(rj(path.join(V9, 'out', `${slug}.segments.json`)).scenes.map((s) => [s.summary, (s.sentences ?? []).map((x) => x.text)]))];
  const judge = strings(desc.per_film.find((x) => x.slug === slug).rows.map((r) => r.why));
  const built = rj(path.join(V9, 'round5', 'live', `${slug}.built.json`));
  const live = strings(built.scenes.map((s) => [s.title, s.description]));
  const seg = rj(path.join(V9, 'out', `${slug}.segments.json`));
  const wl = wordlessScenes(seg, cues, loadPolicy());
  const key = rj(path.join(TS, 'refs', `${slug}.key.json`)); const human = key.items.filter((i) => i.source !== 'codex-rules' && i.mappable && Number.isFinite(i.start_ms) && i.should_flag === true);
  const inter = (a, b, c, d) => Math.max(0, Math.min(b, d) - Math.max(a, c));
  const inWl = human.filter((i) => wl.some((r) => (i.end_ms > i.start_ms ? inter(i.start_ms, i.end_ms, r.start_ms, r.end_ms) / (i.end_ms - i.start_ms) : (i.start_ms >= r.start_ms && i.start_ms <= r.end_ms ? 1 : 0)) >= 0.5));
  res[slug] = { v9_strings: v9s.length, v9_hits: hits(v9s).length, judge_strings: judge.length, judge_hits: hits(judge).length, live_strings: live.length, live_hits: hits(live).length, wordless_regions: wl.map((r) => r.id), should_flag_items_in_wordless: inWl.map((i) => i.id) };
}
console.log(JSON.stringify(res, null, 1));
fs.writeFileSync(path.join(V9, 'verify', 'r5', 'out', 'quote-and-wordless.json'), JSON.stringify(res, null, 2));
