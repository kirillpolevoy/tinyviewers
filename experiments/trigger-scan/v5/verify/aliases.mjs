import fs from 'node:fs';
import { parseSrt } from '../../srt.js';
for (const slug of ['nemo', 'monsters-inc', 'lion-king']) {
  const seg = JSON.parse(fs.readFileSync(new URL(`../out/${slug}.segments.json`, import.meta.url)));
  const src = JSON.parse(fs.readFileSync(new URL(`../sources/${slug}.json`, import.meta.url)));
  const cues = parseSrt(fs.readFileSync(new URL(`../../data/${slug}.srt`, import.meta.url), 'utf8'));
  const hayL = cues.map((c) => c.text).join('\n').toLowerCase();
  const hayW = src.wikipedia.sentences.map((s) => s.text).join('\n').toLowerCase();
  const hayT = src.tmdb.cast.map((t) => t.character).join('\n').toLowerCase();
  for (const c of seg.cast) for (const a of c.aliases ?? []) {
    const k = a.toLowerCase();
    const where = [hayL.includes(k) && 'L', hayW.includes(k) && 'W', hayT.includes(k) && 'T'].filter(Boolean);
    console.log(slug, c.id, c.name, '| alias:', a, '| found in:', where.join('') || 'NONE');
  }
  // disposition_note / danger note words vs claim-check status
}
