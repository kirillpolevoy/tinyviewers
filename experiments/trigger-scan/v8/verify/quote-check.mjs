// v8: longest run of consecutive SRT words in any stored string of v8's NEW model outputs (fill.js
// Sonnet output and sentences, reasons.js whys, the folded segments, tags) for every dev film, and in
// the labels folder (Codex notes). Prints counts only. Run from v8/: node verify/quote-check.mjs
import fs from 'node:fs';
import { parseSrt } from '../../srt.js';
const norm = (s) => s.toLowerCase().replace(/<[^>]+>/g, ' ').replace(/[^a-z0-9' ]+/g, ' ').split(/\s+/).filter(Boolean);
const films = ['nemo', 'monsters-inc', 'lion-king', 'frankenweenie', 'wild-robot', 'iron-giant', 'up'];
let total = 0;
for (const slug of films) {
  const words = norm(parseSrt(fs.readFileSync(`../data/${slug}.srt`, 'utf8')).map((c) => c.text).join(' '));
  const N = 9; const grams = new Set(); for (let i = 0; i + N <= words.length; i++) grams.add(words.slice(i, i + N).join(' '));
  const files = [`out/${slug}.fill.json`, `out/${slug}.reasons.r1.json`, `out/${slug}.segments.json`, `out/${slug}.tags.r1.json`].filter((f) => fs.existsSync(f));
  let viol = 0; let strings = 0;
  const walk = (v, f, where) => { if (typeof v === 'string') { strings++; const w = norm(v); for (let i = 0; i + N <= w.length; i++) if (grams.has(w.slice(i, i + N).join(' '))) { viol++; console.log('  9-gram hit in', f, where); break; } } else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) walk(x, f, k); };
  for (const f of files) walk(JSON.parse(fs.readFileSync(f, 'utf8')), f, '');
  if (fs.existsSync('labels/sentence-labels.json')) walk(JSON.parse(fs.readFileSync('labels/sentence-labels.json', 'utf8')), 'labels/sentence-labels.json', '');
  if (fs.existsSync('labels/why-audit.json')) walk(JSON.parse(fs.readFileSync('labels/why-audit.json', 'utf8')), 'labels/why-audit.json', '');
  total += viol;
  console.log(slug, 'files', files.length, 'strings', strings, 'strings with >= 9 consecutive SRT words:', viol);
}
console.log('total violations', total);
