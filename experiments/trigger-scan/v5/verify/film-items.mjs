import fs from 'node:fs';
import { filmItems, verifiedField } from '../questions.js';
for (const slug of ['nemo', 'monsters-inc', 'lion-king']) {
  const seg = JSON.parse(fs.readFileSync(new URL(`../out/${slug}.segments.json`, import.meta.url)));
  const items = filmItems(seg);
  console.log(slug, items.filter((i) => i.type !== 'presence').map((i) => `${i.id}(${i.why}:${i.name})`).join(' | '));
  for (const c of seg.cast) console.log('   ', c.id, c.name, 'disp', c.disposition, '->', verifiedField(c, 'disposition'), 'child', c.is_child, '->', verifiedField(c, 'is_child'), 'aliases', JSON.stringify(c.aliases));
}
