#!/usr/bin/env node
// Writes out/refs-human/<slug>.key.json: refs/<slug>.key.json without the 'codex-rules' items (the
// model-written rule items the key builder added in round 3). This is the HUMAN key v7's evaluation
// used (v7/out/eval/refs-human); v8 scores against it. Scoring input only; never read by the pipeline.
import fs from 'node:fs';
import path from 'node:path';
import { V8, TS, DEV_FILMS, outDir } from '../env.js';

const dir = path.join(outDir(), 'refs-human');
fs.mkdirSync(dir, { recursive: true });
const films = process.argv.slice(2).length ? process.argv.slice(2) : DEV_FILMS;
for (const slug of films) {
  const key = JSON.parse(fs.readFileSync(path.join(TS, 'refs', `${slug}.key.json`), 'utf8'));
  const items = key.items.filter((i) => i.source !== 'codex-rules');
  fs.writeFileSync(path.join(dir, `${slug}.key.json`), JSON.stringify({ ...key, items, human_only: { dropped_codex_rules: key.items.length - items.length } }, null, 2));
  console.log(`${slug}: ${items.length} human items (${key.items.length - items.length} codex-rules dropped) -> ${path.relative(V8, path.join(dir, `${slug}.key.json`))}`);
}
