#!/usr/bin/env node
// DEV ONLY (budget): for films where v9 does not re-run Jev's classify, seed out/<slug>.jev.r1.json from
// v8's saved answers (v8 asked Jev EVERY question on the same scenes with the same wording), keeping
// only the questions split.json gives Jev (the Sonnet-assigned ones are removed, as a trimmed v9
// request would not have asked them), and seed out/<slug>.moments.r1.json from v8's so moments.js
// --incremental asks only scenes whose flag reasons changed. v8 files are read, never written.
// Trimming drift is measured on the films that DO re-run classify (dev/trim-drift.mjs).
//   node dev/seed-from-v8.mjs nemo monsters-inc ...
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadSplit } from '../split.js';
import { PRESENCE } from '../questions.js';
const here = path.dirname(fileURLToPath(import.meta.url));
const V8OUT = path.resolve(here, '../../v8/out');
const OUT = path.resolve(here, '../out');
const split = loadSplit();
const PRES = new Set(PRESENCE.map((p) => p.id));
for (const slug of process.argv.slice(2)) {
  const j = JSON.parse(fs.readFileSync(path.join(V8OUT, `${slug}.jev.r1.json`), 'utf8'));
  let removed = 0;
  for (const s of j.scenes) {
    if (!s.answers) continue;
    for (const q of split.sonnet_used) {
      if (PRES.has(q)) { for (const ch of ['pl', 'ps']) if (s.answers[ch] && q in s.answers[ch]) { delete s.answers[ch][q]; removed++; } }
      else if (s.answers.e && q in s.answers.e) { delete s.answers.e[q]; removed++; }
    }
  }
  j.reused_from = { file: `../v8/out/${slug}.jev.r1.json`, note: 'v8 answers (every question asked); Sonnet-assigned questions removed per split.json', split_sha256_12: split.sha256_12, removed_answers: removed, seeded_at: new Date().toISOString() };
  fs.writeFileSync(path.join(OUT, `${slug}.jev.r1.json`), JSON.stringify(j, null, 2));
  const m = path.join(V8OUT, `${slug}.moments.r1.json`);
  if (fs.existsSync(m)) fs.copyFileSync(m, path.join(OUT, `${slug}.moments.r1.json`));
  console.log(`${slug}: seeded jev (${removed} Sonnet-assigned answers removed)${fs.existsSync(m) ? ' + moments' : ''}`);
}
