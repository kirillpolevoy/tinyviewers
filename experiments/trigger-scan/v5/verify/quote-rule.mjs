// 9-gram check: model-written stored text vs the film's subtitle words. Prints counts only.
import fs from 'node:fs';
import { parseSrt } from '../../srt.js';
const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9' ]+/g, ' ').replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
for (const slug of ['nemo', 'monsters-inc', 'lion-king']) {
  const cues = parseSrt(fs.readFileSync(`../data/${slug}.srt`, 'utf8'));
  const words = norm(cues.map((c) => c.text).join(' '));
  const g = new Set(); for (let i = 0; i + 9 <= words.length; i++) g.add(words.slice(i, i + 9).join(' '));
  const seg = JSON.parse(fs.readFileSync(`out/${slug}.segments.json`, 'utf8'));
  const strings = [];
  for (const s of seg.scenes) { strings.push(s.setting, s.summary, ...s.sentences.map((x) => x.text)); }
  for (const c of seg.cast) strings.push(c.name, ...(c.aliases ?? []), c.disposition_note ?? '');
  for (const d of seg.dangers) strings.push(d.name, d.note ?? '');
  const rawObj = JSON.parse(fs.readFileSync(`out/${slug}.segments.raw.json`, 'utf8'));
  const walk = (o) => { if (typeof o === 'string') strings.push(o); else if (o && typeof o === 'object') Object.values(o).forEach(walk); };
  walk(rawObj);
  const claims = JSON.parse(fs.readFileSync(`out/${slug}.claims.json`, 'utf8'));
  for (const c of claims.claims) strings.push(c.claim);
  let hits = 0;
  for (const s of strings) { const w = norm(s); for (let i = 0; i + 9 <= w.length; i++) if (g.has(w.slice(i, i + 9).join(' '))) { hits++; break; } }
  console.log(slug, 'model strings', strings.length, 'with a >8-word transcript run:', hits);
}
