#!/usr/bin/env node
// Round-6 VERIFIER: 9-consecutive-word transcript overlap in every string stored by the round-6 run for the
// held-out films (out10/<slug>.*, round6/live/<slug>.*, round6/out/**.json, labels/codex/r6-*). Reports counts
// and the file / JSON path of each hit, never the text. No model calls.
import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
import { parseSrt } from '../../../srt.js';
const V10 = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..'); const TS = path.resolve(V10, '..');
const words = (s) => s.toLowerCase().replace(/<[^>]+>/g, ' ').replace(/[^a-z0-9'\s]/g, ' ').replace(/'/g, '').split(/\s+/).filter(Boolean);
const N = 9; const FILMS = ['frozen', 'zootopia', 'good-dinosaur'];
const grams = {};
for (const s of FILMS) { const tw = words(parseSrt(fs.readFileSync(path.join(TS, 'data', `${s}.srt`), 'utf8')).map((c) => c.text).join(' ')); grams[s] = new Set(); for (let i = 0; i + N <= tw.length; i++) grams[s].add(tw.slice(i, i + N).join(' ')); }
const hit = (str, g) => { const w = words(str); for (let i = 0; i + N <= w.length; i++) if (g.has(w.slice(i, i + N).join(' '))) return true; return false; };
function walk(o, p, out) { if (typeof o === 'string') { if (o.split(/\s+/).length >= N) out.push([p, o]); } else if (Array.isArray(o)) o.forEach((x, i) => walk(x, `${p}[${i}]`, out)); else if (o && typeof o === 'object') for (const [k, v] of Object.entries(o)) walk(v, `${p}.${k}`, out); return out; }
const files = [];
for (const d of ['out10', 'round6/live', 'round6/out', 'round6/out/frozen-config', 'labels/codex']) { const dir = path.join(V10, d); for (const x of fs.readdirSync(dir)) { const p = path.join(dir, x); if (!fs.statSync(p).isFile() || !/\.json$/.test(x)) continue; if (d === 'labels/codex' && !x.startsWith('r6-')) continue; if (d === 'out10' && !FILMS.some((s) => x.startsWith(`${s}.`))) continue; if (d === 'round6/live' && !FILMS.some((s) => x.startsWith(`${s}.`))) continue; files.push(p); } }
const res = { files: files.length, strings: 0, hits: [] };
for (const f of files) {
  const rel = path.relative(V10, f); const slug = FILMS.find((s) => path.basename(f).includes(s)) ?? null;
  let j; try { j = JSON.parse(fs.readFileSync(f, 'utf8')); } catch { continue; }
  const strs = walk(j, '', []); res.strings += strs.length;
  for (const [p, s] of strs) { const gs = slug ? [grams[slug]] : Object.values(grams); if (gs.some((g) => hit(s, g))) res.hits.push(`${rel}${p}`); }
}
fs.writeFileSync(path.join(V10, 'verify', 'r6', 'out', 'quote.json'), JSON.stringify(res, null, 2));
console.log(JSON.stringify({ files: res.files, strings: res.strings, hits: res.hits.length, sample: res.hits.slice(0, 30) }, null, 1));
