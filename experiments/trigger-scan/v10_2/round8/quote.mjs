#!/usr/bin/env node
// ROUND 8 QUOTE CHECK (copy of v10_1/round7/quote.mjs; paths only): 9-consecutive-word transcript overlap in every string
// stored by round 8 -- out102/<fresh slug>.* (v10.2 pipeline outputs), round8/live (live pipeline outputs, reported
// separately), round8/out, labels/codex/r8-*.answer.json. Model text must never quote more than 8 consecutive transcript
// words. Reports counts and the JSON path of each hit, never the text. No model calls.
import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
import { parseSrt } from '../../srt.js';
const V102 = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'); const TS = path.resolve(V102, '..');
const words = (s) => s.toLowerCase().replace(/<[^>]+>/g, ' ').replace(/[^a-z0-9'\s]/g, ' ').replace(/'/g, '').split(/\s+/).filter(Boolean);
const N = 9;
const FILMS = ['incredibles', 'big-hero-6', 'brave'];
const grams = {};
for (const s of FILMS) { const tw = words(parseSrt(fs.readFileSync(path.join(TS, 'data', `${s}.srt`), 'utf8')).map((c) => c.text).join(' ')); grams[s] = new Set(); for (let i = 0; i + N <= tw.length; i++) grams[s].add(tw.slice(i, i + N).join(' ')); }
const hit = (str, g) => { const w = words(str); for (let i = 0; i + N <= w.length; i++) if (g.has(w.slice(i, i + N).join(' '))) return true; return false; };
function walk(o, p, out) { if (typeof o === 'string') { if (o.split(/\s+/).length >= N) out.push([p, o]); } else if (Array.isArray(o)) o.forEach((x, i) => walk(x, `${p}[${i}]`, out)); else if (o && typeof o === 'object') for (const [k, v] of Object.entries(o)) walk(v, `${p}.${k}`, out); return out; }
function scan(files) {
  const res = { files: files.length, strings: 0, hits: [] };
  for (const f of files) {
    const rel = path.relative(V102, f); const slug = FILMS.find((s) => path.basename(f).includes(s)) ?? null;
    let j; try { j = JSON.parse(fs.readFileSync(f, 'utf8')); } catch { continue; }
    const strs = walk(j, '', []); res.strings += strs.length;
    for (const [p, s] of strs) { const gs = slug ? [grams[slug]] : Object.values(grams); if (gs.some((g) => hit(s, g))) res.hits.push(`${rel}${p}`); }
  }
  return res;
}
const list = (dir, pred = () => true, acc = []) => { if (!fs.existsSync(dir)) return acc; for (const x of fs.readdirSync(dir)) { const p = path.join(dir, x); if (fs.statSync(p).isDirectory()) list(p, pred, acc); else if (/\.json$/.test(x) && pred(x)) acc.push(p); } return acc; };
const v102 = scan([...list(path.join(V102, 'out102'), (x) => FILMS.some((s) => x.startsWith(`${s}.`))), ...list(path.join(V102, 'round8', 'out'), (x) => x !== 'quote.json'), ...list(path.join(V102, 'labels', 'codex'), (x) => x.startsWith('r8-') && x.endsWith('.answer.json'))]);
const live = scan(list(path.join(V102, 'round8', 'live')));
const res = { v102_and_eval: v102, live_pipeline_outputs: live };
fs.writeFileSync(path.join(V102, 'round8', 'out', 'quote.json'), JSON.stringify(res, null, 2));
console.log(JSON.stringify({ v102_and_eval: { files: v102.files, strings: v102.strings, hits: v102.hits.length, sample: v102.hits.slice(0, 30) }, live: { files: live.files, strings: live.strings, hits: live.hits.length, sample: live.hits.slice(0, 10) } }, null, 1));
