#!/usr/bin/env node
// ROUND 7 copy of verify/quote.mjs: frozen/zootopia outputs in out101, round7/gd-out, round7/tierA, round7/out, labels/codex/r7-*.answer.json.
// v10.1 QUOTE CHECK: 9-consecutive-word transcript overlap in every string stored by v10.1 (out101/**/*.json,
// dev/out/*.json, eval/out/*.json, labels/codex/v101*.answer.json). Model text must never quote more than 8
// consecutive transcript words. Reports counts and the JSON path of each hit, never the text. No model calls.
// Strings copied VERBATIM from v10 inputs (segments, claims, fill, jev, sonnetq copies) are checked too.
import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
import { parseSrt } from '../../srt.js';
const V101 = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'); const TS = path.resolve(V101, '..');
const words = (s) => s.toLowerCase().replace(/<[^>]+>/g, ' ').replace(/[^a-z0-9'\s]/g, ' ').replace(/'/g, '').split(/\s+/).filter(Boolean);
const N = 9;
const FILMS = ['frozen', 'zootopia', 'good-dinosaur'];
const grams = {};
for (const s of FILMS) { const tw = words(parseSrt(fs.readFileSync(path.join(TS, 'data', `${s}.srt`), 'utf8')).map((c) => c.text).join(' ')); grams[s] = new Set(); for (let i = 0; i + N <= tw.length; i++) grams[s].add(tw.slice(i, i + N).join(' ')); }
const hit = (str, g) => { const w = words(str); for (let i = 0; i + N <= w.length; i++) if (g.has(w.slice(i, i + N).join(' '))) return true; return false; };
function walk(o, p, out) { if (typeof o === 'string') { if (o.split(/\s+/).length >= N) out.push([p, o]); } else if (Array.isArray(o)) o.forEach((x, i) => walk(x, `${p}[${i}]`, out)); else if (o && typeof o === 'object') for (const [k, v] of Object.entries(o)) walk(v, `${p}.${k}`, out); return out; }
const files = [];
const add = (dir, pred = () => true) => { if (!fs.existsSync(dir)) return; for (const x of fs.readdirSync(dir)) { const p = path.join(dir, x); if (fs.statSync(p).isDirectory()) add(p, pred); else if (/\.json$/.test(x) && pred(x)) files.push(p); } };
add(path.join(V101, 'out101'), (x) => /^(frozen|zootopia)\./.test(x)); add(path.join(V101, 'round7', 'gd-out')); add(path.join(V101, 'round7', 'tierA'));
add(path.join(V101, 'round7', 'out'));
add(path.join(V101, 'labels', 'codex'), (x) => x.startsWith('r7-') && x.endsWith('.answer.json'));
// verbatim-copied inputs and replay of v10 files are exempt from 'model text' only if identical to their v10 source
const res = { files: files.length, strings: 0, hits: [] };
for (const f of files) {
  const rel = path.relative(V101, f); const slug = FILMS.find((s) => path.basename(f).includes(s)) ?? null;
  let j; try { j = JSON.parse(fs.readFileSync(f, 'utf8')); } catch { continue; }
  const strs = walk(j, '', []); res.strings += strs.length;
  for (const [p, s] of strs) { const gs = slug ? [grams[slug]] : Object.values(grams); if (gs.some((g) => hit(s, g))) res.hits.push(`${rel}${p}`); }
}

fs.writeFileSync(path.join(V101, 'round7', 'out', 'quote.json'), JSON.stringify(res, null, 2));
console.log(JSON.stringify({ files: res.files, strings: res.strings, hits: res.hits.length, sample: res.hits.slice(0, 30) }, null, 1));
