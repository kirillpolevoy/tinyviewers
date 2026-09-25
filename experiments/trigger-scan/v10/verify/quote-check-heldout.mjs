// Round-4 head-to-head: longest run of consecutive SRT words in every stored string of both systems'
// outputs on the three held-out films (v8 out/<slug>.{fill,reasons.r1,segments,tags.r1,moments.r1,jev.r1}.json
// and live baseline/out/<slug>.{scenes,presence,built}.json). A hit = 9 or more consecutive words shared
// with the whole transcript (joined across cues, stricter than the live pipeline's per-cue 8-word rule).
// Prints counts and file/field names only. Run from v8/: node verify/quote-check-heldout.mjs
import fs from 'node:fs';
import { parseSrt } from '../../srt.js';
const norm = (s) => s.toLowerCase().replace(/<[^>]+>/g, ' ').replace(/[^a-z0-9' ]+/g, ' ').split(/\s+/).filter(Boolean);
let total = 0;
for (const slug of ['tangled', 'coco', 'how-to-train-your-dragon']) {
  const words = norm(parseSrt(fs.readFileSync(`../data/${slug}.srt`, 'utf8')).map((c) => c.text).join(' '));
  const N = 9; const grams = new Set(); for (let i = 0; i + N <= words.length; i++) grams.add(words.slice(i, i + N).join(' '));
  const files = [`out/${slug}.fill.json`, `out/${slug}.reasons.r1.json`, `out/${slug}.segments.json`, `out/${slug}.tags.r1.json`, `out/${slug}.moments.r1.json`, `out/${slug}.jev.r1.json`, `baseline/out/${slug}.scenes.json`, `baseline/out/${slug}.presence.json`, `baseline/out/${slug}.built.json`].filter((f) => fs.existsSync(f));
  let viol = 0; let strings = 0;
  const walk = (v, f, where) => { if (typeof v === 'string') { strings++; const w = norm(v); for (let i = 0; i + N <= w.length; i++) if (grams.has(w.slice(i, i + N).join(' '))) { viol++; console.log('  9-gram hit in', f, where); break; } } else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) walk(x, f, k); };
  for (const f of files) walk(JSON.parse(fs.readFileSync(f, 'utf8')), f, '');
  total += viol;
  console.log(slug, 'files', files.length, 'strings', strings, 'strings with >= 9 consecutive SRT words:', viol);
}
console.log('total violations', total);
