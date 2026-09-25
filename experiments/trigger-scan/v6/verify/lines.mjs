// print subtitle cues a..b for a film (for the verifier's reading; nothing stored)
import fs from 'node:fs';
const [slug, a, b] = process.argv.slice(2);
const t = fs.readFileSync(new URL(`../../data/${slug}.srt`, import.meta.url), 'utf8').replace(/\r/g, '');
for (const blk of t.split(/\n\n+/)) {
  const L = blk.split('\n'); const n = +L[0];
  if (n >= +a && n <= +b) console.log(n, L[1].slice(0, 12), '|', L.slice(2).join(' / '));
}
