#!/usr/bin/env node
// VERIFIER: own quoting check. Every string in the round-7 stored outputs (held-out pipeline files, the fresh Good Dinosaur
// run, the round-7 judge files) is scanned for a run of 9+ consecutive words that also occurs in the film's subtitles.
// Strings that are copies of subtitle cue text carried in the data (fields named text/line on cue objects) are counted
// apart: the rule is about model text. Prints counts and file/field of hits only (never the words). Writes verify/out/quote9.json.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSrt } from '../../srt.js';
const here = path.dirname(fileURLToPath(import.meta.url));
const V101 = path.resolve(here, '..'); const TS = path.resolve(V101, '..');
const N = 9;
const norm = (s) => s.toLowerCase().replace(/<[^>]+>/g, ' ').replace(/[^a-z0-9' ]+/g, ' ').replace(/'/g, '').split(/\s+/).filter(Boolean);
function grams(slug) {
  const cues = parseSrt(fs.readFileSync(path.join(TS, 'data', `${slug}.srt`), 'utf8'));
  const words = norm(cues.map((c) => c.text.replace(/\([^)]*\)/g, ' ').replace(/^[A-Z0-9 ]+:/, ' ')).join(' '));
  const g = new Set(); for (let i = 0; i + N <= words.length; i++) g.add(words.slice(i, i + N).join(' '));
  return g;
}
function* strings(o, p = '') { if (typeof o === 'string') yield [p, o]; else if (Array.isArray(o)) for (let i = 0; i < o.length; i++) yield* strings(o[i], `${p}[]`); else if (o && typeof o === 'object') for (const [k, v] of Object.entries(o)) yield* strings(v, `${p}.${k}`); }
const files = [];
for (const slug of ['frozen', 'zootopia']) for (const f of fs.readdirSync(path.join(V101, 'out101')).filter((f) => f.startsWith(`${slug}.`) && f.endsWith('.json'))) files.push([slug, path.join(V101, 'out101', f)]);
for (const f of fs.readdirSync(path.join(V101, 'round7', 'gd-out')).filter((f) => f.endsWith('.json'))) files.push(['good-dinosaur', path.join(V101, 'round7', 'gd-out', f)]);
for (const f of ['descriptions.json', 'reasons-truth.json']) files.push(['*', path.join(V101, 'round7', 'out', f)]);
const G = { frozen: grams('frozen'), zootopia: grams('zootopia'), 'good-dinosaur': grams('good-dinosaur') };
const res = { n_strings: 0, hits: [], hits_in_cue_copy_fields: 0 };
for (const [slug, f] of files) {
  const j = JSON.parse(fs.readFileSync(f, 'utf8'));
  for (const [p, s] of strings(j)) {
    const w = norm(s); if (w.length < N) continue; res.n_strings++;
    const gs = slug === '*' ? Object.values(G) : [G[slug]];
    let hit = false; for (let i = 0; i + N <= w.length && !hit; i++) { const k = w.slice(i, i + N).join(' '); if (gs.some((g) => g.has(k))) hit = true; }
    if (hit) { if (/\.(lines|cues)\[\]\.(text|t)$|\.cue_text$|\.srt/.test(p)) res.hits_in_cue_copy_fields++; else res.hits.push(`${path.relative(V101, f)} ${p}`); }
  }
}
res.distinct_hit_fields = [...new Set(res.hits.map((h) => h.replace(/\[\]/g, '')))];
fs.writeFileSync(path.join(here, 'out', 'quote9.json'), JSON.stringify(res, null, 2));
console.log(JSON.stringify({ n_strings: res.n_strings, hits: res.hits.length, cue_copy: res.hits_in_cue_copy_fields, fields: res.distinct_hit_fields.slice(0, 30) }, null, 1));
