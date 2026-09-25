// Verifier: print cue text for a range to stdout (never stored).
import fs from 'node:fs';
import { parseSrt } from '../../srt.js';
const [slug, a, b] = process.argv.slice(2);
const cues = parseSrt(fs.readFileSync(new URL(`../../data/${slug}.srt`, import.meta.url), 'utf8'));
for (let i = Number(a); i <= Number(b); i++) { const c = cues[i - 1]; if (c) console.log(i, Math.round(c.startMs / 1000), (c.text || c.lines?.join(' ') || '').replace(/\n/g, ' ')); }
