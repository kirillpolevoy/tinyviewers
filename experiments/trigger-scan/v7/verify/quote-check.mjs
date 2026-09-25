// Longest run of consecutive SRT words found in any stored string of held-out outputs. Prints counts only.
import fs from 'node:fs'; import path from 'node:path';
import { parseSrt } from '../../srt.js';
const norm = (s) => s.toLowerCase().replace(/<[^>]+>/g, ' ').replace(/[^a-z0-9' ]+/g, ' ').split(/\s+/).filter(Boolean);
for (const slug of ['iron-giant', 'up']) {
  const words = norm(parseSrt(fs.readFileSync(`../data/${slug}.srt`, 'utf8')).map((c) => c.text).join(' '));
  const N = 9; const grams = new Set(); for (let i = 0; i + N <= words.length; i++) grams.add(words.slice(i, i + N).join(' '));
  const files = fs.readdirSync('out').filter((f) => f.startsWith(slug + '.')).map((f) => 'out/' + f).concat(['out/eval/rules12.json', 'out/eval/explain.json', 'out/eval/summary.json']);
  let viol = 0; let strings = 0;
  const walk = (v, f) => { if (typeof v === 'string') { strings++; const w = norm(v); for (let i = 0; i + N <= w.length; i++) if (grams.has(w.slice(i, i + N).join(' '))) { viol++; console.log('  9-gram hit in', f); break; } } else if (v && typeof v === 'object') for (const x of Object.values(v)) walk(x, f); };
  for (const f of files) walk(JSON.parse(fs.readFileSync(f, 'utf8')), f);
  console.log(slug, 'files', files.length, 'strings', strings, 'strings with >=9 consecutive SRT words:', viol);
}
