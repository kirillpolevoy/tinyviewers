// Step 4 helper: print mapped cues for a sample of key items so a reader can check the mapping.
// Prints subtitle text to the terminal only; nothing is written to disk.
//
//   node refs/audit.js <slug> [id...]     (default sample: 3 mappable items spread across the film)

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSrt, formatTime } from '../srt.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const [slug, ...ids] = process.argv.slice(2);
const key = JSON.parse(fs.readFileSync(path.join(here, `${slug}.key.json`), 'utf8'));
const cues = parseSrt(fs.readFileSync(path.resolve(here, '..', 'data', `${slug}.srt`), 'utf8'));

let pick;
if (ids.length) pick = ids.map((id) => key.items.find((i) => i.id === id));
else {
  // Deterministic spread: flagged, mappable items sorted by time; take the first, middle and last.
  const m = key.items.filter((i) => i.mappable && i.should_flag === true).sort((a, b) => a.start_ms - b.start_ms);
  pick = [m[0], m[Math.floor(m.length / 2)], m[m.length - 1]].filter(Boolean);
}
for (const it of pick) {
  console.log(`\n=== ${it.id} [${it.source}] ${it.text}`);
  console.log(`    ${it.time} cues ${it.cue_range} conf ${it.map_confidence} wordless ${it.wordless} :: ${it.map_note}`);
  if (!it.mappable) continue;
  const [a, b] = it.cue_range;
  for (let i = Math.max(1, a - 2); i <= Math.min(cues.length, b + 2); i++) {
    const c = cues[i - 1];
    console.log(`${i >= a && i <= b ? '  >' : '   '} ${i} ${formatTime(c.startMs)} ${c.text}`);
  }
}
