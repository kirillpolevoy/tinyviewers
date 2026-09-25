#!/usr/bin/env node
// Round-6 VERIFIER: did the live baseline run scene-api/pipeline unmodified? Walks the import closure of the
// modules round6/run-live.mjs imports, and for each file reports git state vs HEAD, mtime vs the first live
// call, and sha256. Also checks the live outputs' recorded model / cost caps. No model calls.
import fs from 'node:fs'; import path from 'node:path'; import crypto from 'node:crypto'; import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const V10 = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const ROOT = path.resolve(V10, '..', '..', '..');
const API = path.join(ROOT, 'scene-api');
const entries = ['pipeline/scenes.js', 'pipeline/presence.js', 'pipeline/srt.js', 'pipeline/taxonomy-v3.js', 'load.js'].map((f) => path.join(API, f));
const seen = new Set();
function walk(p) {
  if (seen.has(p) || !fs.existsSync(p)) return; seen.add(p);
  const src = fs.readFileSync(p, 'utf8');
  for (const m of src.matchAll(/(?:import[^'"]*from\s*|import\s*\(\s*)['"](\.{1,2}\/[^'"]+)['"]/g)) walk(path.resolve(path.dirname(p), m[1]));
}
entries.forEach(walk);
const T_LIVE = '2026-09-25T01:36:00Z';
const rows = [...seen].map((p) => {
  const rel = path.relative(ROOT, p);
  const st = execSync(`git -C ${JSON.stringify(ROOT)} status --porcelain -- ${JSON.stringify(rel)}`).toString().trim();
  const mt = fs.statSync(p).mtime.toISOString();
  return { file: rel, git: st || 'clean', mtime: mt, changed_after_live_start: mt > T_LIVE, sha256_12: crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex').slice(0, 12) };
});
const scenes = fs.readFileSync(path.join(API, 'pipeline', 'scenes.js'), 'utf8');
const presence = fs.readFileSync(path.join(API, 'pipeline', 'presence.js'), 'utf8');
const caps = { scenes: scenes.match(/COST_CAP_USD\s*=\s*[^;\n]+/)?.[0], presence: presence.match(/COST_CAP_USD\s*=\s*[^;\n]+/)?.[0], scenes_model: scenes.match(/MODEL\s*=\s*[^;\n]+/)?.[0] ?? null, presence_model: presence.match(/MODEL\s*=\s*[^;\n]+/)?.[0] ?? null };
const live = Object.fromEntries(['frozen', 'zootopia', 'good-dinosaur'].map((s) => { const r = JSON.parse(fs.readFileSync(path.join(V10, 'round6', 'live', `${s}.scenes.json`), 'utf8')); const p = JSON.parse(fs.readFileSync(path.join(V10, 'round6', 'live', `${s}.presence.json`), 'utf8')); return [s, { scenes_model: r.model ?? null, scenes_cost: r.cost_usd, presence_model: p.model ?? null, presence_cost: p.cost_usd, scenes: r.scenes.length }]; }));
const out = { files: rows, any_dirty: rows.filter((r) => r.git !== 'clean'), any_changed_after_live_start: rows.filter((r) => r.changed_after_live_start), caps, live };
fs.writeFileSync(path.join(V10, 'verify', 'r6', 'out', 'live-check.json'), JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 1));
