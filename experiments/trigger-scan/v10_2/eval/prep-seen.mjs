#!/usr/bin/env node
// v10.2 SEEN-FILM TEXT RUN, step 1 (no model calls): the v10.2 flags of the 16 seen films (select.js with the tier-A
// gate, rule 2 and the resolution guard, over the stored answers of eval/seen-lib.mjs + the guard answers in
// out102/dev), with skip spans from the stored moment answers (moments.js respanScenes; a reason the stored run never
// asked -> the whole scene), written as a v10.2 run directory out102/seen/ that describe.js and check-describe.js
// read (V102_OUT=out102/seen): <slug>.segments.json and <slug>.jev.r1.json copied from the stored run,
// <slug>.tags.r1.json = the v10.2 selection. Step 2 = describe.js + check-describe.js per film; step 3 =
// eval/seen.mjs (scores, attaches the why).
//   node eval/prep-seen.mjs
import fs from 'node:fs';
import path from 'node:path';
import * as S102 from '../select.js';
import { loadSplit } from '../split.js';
import { FILMS, loadFilm, runSystem, resolveFile, rj, V102 } from './seen-lib.mjs';

const SPLIT = loadSplit();
const POLICY = S102.loadPolicy(path.join(V102, 'policy.json'));
const OUT = path.join(V102, 'out102', 'seen');
fs.mkdirSync(OUT, { recursive: true });
for (const slug of FILMS) {
  const F = loadFilm(slug);
  const r = runSystem(F, S102, POLICY, { used: SPLIT.sonnet_used, resolve: rj(resolveFile(slug)), split: SPLIT });
  for (const f of [`${slug}.segments.json`, `${slug}.jev.r1.json`]) fs.copyFileSync(path.join(F.dir, f), path.join(OUT, f));
  const tags = { ...r.tags, seen_run: { note: 'v10.2 select over the stored answers (eval/prep-seen.mjs); skip spans respanned from stored moment answers', from: path.relative(V102, F.dir) } };
  fs.writeFileSync(path.join(OUT, `${slug}.tags.r1.json`), JSON.stringify(tags, null, 2));
  console.log(`${slug}: flagged ${r.flagged.length}/${r.tags.scenes.length}; gated-only ${r.tags.summary.gated_only_scenes.length}, guard-only ${r.tags.summary.guard_only_scenes.length}`);
}
