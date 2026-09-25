#!/usr/bin/env node
// Round-4 VERIFIER: independent freeze + held-out isolation check (no model calls, prints no text content).
//  1. sha256 of every file in out/freeze.json vs now; mtime of each vs frozen_at.
//  2. import closure of run-film.js (and every stage script it spawns) vs the frozen list.
//  3. held-out timeline: key files / srt final mtimes vs freeze and vs first v8/baseline held-out output.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const V8 = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TS = path.resolve(V8, '..');
const fz = JSON.parse(fs.readFileSync(path.join(V8, 'out', 'freeze.json'), 'utf8'));
const frozenAt = Date.parse(fz.frozen_at);
const sha = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const iso = (ms) => new Date(ms).toISOString();

const rows = Object.entries(fz.files).map(([rel, h]) => {
  const f = path.resolve(V8, rel); const st = fs.statSync(f);
  return { rel, match: sha(f) === h, mtime: iso(st.mtimeMs), modified_after_freeze: st.mtimeMs > frozenAt };
});

// closure: static imports + scripts named in run-film.js (spawned stages)
function closure(entries) {
  const seen = new Set(); const q = entries.map((e) => path.resolve(V8, e));
  while (q.length) {
    const f = q.pop(); if (seen.has(f) || !fs.existsSync(f)) continue; seen.add(f);
    const src = fs.readFileSync(f, 'utf8');
    for (const m of src.matchAll(/(?:import|export)[^'"]*?from\s+['"](\.[^'"]+)['"]|import\(\s*['"](\.[^'"]+)['"]\s*\)/g)) q.push(path.resolve(path.dirname(f), m[1] ?? m[2]));
    // JSON files read by name
    for (const m of src.matchAll(/['"]([\w-]+\.json)['"]/g)) { const p = path.resolve(path.dirname(f), m[1]); if (fs.existsSync(p) && p.startsWith(V8) && !p.includes('/out/')) seen.add(p); }
  }
  return [...seen];
}
const rf = fs.readFileSync(path.join(V8, 'run-film.js'), 'utf8');
const spawned = [...rf.matchAll(/['"]([\w-]+\.js)['"]/g)].map((m) => m[1]).filter((x) => fs.existsSync(path.join(V8, x)));
const cl = closure(['run-film.js', ...spawned]);
const frozenAbs = new Set(Object.keys(fz.files).map((r) => path.resolve(V8, r)));
const notFrozen = cl.filter((f) => !frozenAbs.has(f)).map((f) => path.relative(V8, f));

// timeline
const HELD = ['tangled', 'coco', 'how-to-train-your-dragon'];
const mt = (f) => (fs.existsSync(f) ? fs.statSync(f).mtimeMs : null);
const bt = (f) => (fs.existsSync(f) ? fs.statSync(f).birthtimeMs : null);
const timeline = {};
for (const s of HELD) {
  const keyFiles = [`refs/${s}.key.json`, `data/${s}.srt`, `refs/${s}.film.json`, 'refs/audits.json'].map((r) => path.join(TS, r));
  const v8Out = fs.readdirSync(path.join(V8, 'out')).filter((f) => f.startsWith(`${s}.`)).map((f) => path.join(V8, 'out', f));
  const liveOut = fs.readdirSync(path.join(V8, 'baseline', 'out')).filter((f) => f.startsWith(`${s}.`)).map((f) => path.join(V8, 'baseline', 'out', f));
  const lastKey = Math.max(...keyFiles.map(mt).filter(Boolean));
  const firstV8 = Math.min(...v8Out.map(bt)); const firstLive = Math.min(...liveOut.map(bt));
  const srcDir = path.join(V8, 'sources');
  const src = fs.existsSync(srcDir) ? fs.readdirSync(srcDir).filter((f) => f.startsWith(s)).map((f) => path.join(srcDir, f)) : [];
  timeline[s] = {
    key_inputs_last_modified: iso(lastKey), freeze: fz.frozen_at,
    first_v8_output: iso(firstV8), first_live_output: iso(firstLive),
    v8_sources_first: src.length ? iso(Math.min(...src.map(bt))) : null,
    keys_final_before_any_pipeline_output: lastKey < Math.min(firstV8, firstLive),
    v8_outputs_after_freeze: firstV8 > frozenAt && (src.length ? Math.min(...src.map(bt)) > frozenAt : true),
  };
}
// any v8 dev output touched after freeze? (should not matter, but report)
const devTouched = fs.readdirSync(path.join(V8, 'out')).filter((f) => !HELD.some((s) => f.startsWith(`${s}.`)) && /\.(json)$/.test(f) && fs.statSync(path.join(V8, 'out', f)).mtimeMs > frozenAt);
console.log(JSON.stringify({
  frozen_at: fz.frozen_at, n: rows.length, all_match: rows.every((r) => r.match), mismatched: rows.filter((r) => !r.match).map((r) => r.rel),
  modified_after_freeze: rows.filter((r) => r.modified_after_freeze).map((r) => r.rel), latest_frozen_mtime: rows.map((r) => r.mtime).sort().at(-1),
  closure_size: cl.length, closure_not_frozen: notFrozen, timeline, dev_outputs_touched_after_freeze: devTouched,
}, null, 1));
