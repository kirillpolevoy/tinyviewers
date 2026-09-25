#!/usr/bin/env node
// Dev-only: per flagged scene, the spans a variant gives, each clause's span length and exists, and
// seconds over should_flag / tag_only key items. node dev/scene-spans.mjs <slug> <variant>
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSrt } from '../../srt.js';
import { loadPolicy, selectRun } from '../select.js';
import { respanScenes } from '../moments.js';
import { union, inter, total } from '../refscore.js';
import { VARIANTS } from './span-variants.mjs';
const here = path.dirname(fileURLToPath(import.meta.url));
const V8 = path.resolve(here, '..'); const TS = path.resolve(V8, '..');
const [slug, variant] = process.argv.slice(2);
const readJson = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const deepMerge = (a, b) => { const o = structuredClone(a); for (const [k, v] of Object.entries(b)) o[k] = v && typeof v === 'object' && !Array.isArray(v) ? deepMerge(o[k] ?? {}, v) : v; return o; };
const key = readJson(path.join(TS, 'refs', `${slug}.key.json`));
const mapped = key.items.filter((i) => i.mappable && Number.isFinite(i.start_ms));
const trueU = union(mapped.filter((i) => i.should_flag === true).map((i) => [i.start_ms, i.end_ms]));
const tagU = union(mapped.filter((i) => i.should_flag === 'tag_only').map((i) => [i.start_ms, i.end_ms]));
const run = readJson(path.join(V8, 'out', `${slug}.jev.r1.json`));
const saved = readJson(path.join(V8, 'out', `${slug}.moments.r1.json`));
const cues = parseSrt(fs.readFileSync(path.join(TS, 'data', `${slug}.srt`), 'utf8'));
const cfg = deepMerge(loadPolicy(), VARIANTS[variant]);
const t0 = selectRun(run, cfg, { cues });
const scenes = respanScenes({ tags: t0, saved, cues, items: run.film_items ?? [], cfg });
let tot = 0;
for (const s of t0.scenes.filter((x) => x.flagged)) {
  const m = scenes[s.id];
  const U = union(m.spans.map((x) => [x.start_ms, x.end_ms]));
  tot += total(U);
  const rows = (m.per_reason ?? []).map((r) => { const g = r.span ?? r.best_guess?.span; const len = g ? Math.round((g.end_ms - g.start_ms) / 1000) : '-'; return `${r.exists}:${len}s`; });
  console.log(`${s.id} ${m.method.padEnd(15)} skip ${String(Math.round(total(U) / 1000)).padStart(4)}s / scene ${Math.round((s.end_ms - s.start_ms) / 1000)}s  true ${Math.round(inter(U, trueU) / 1000)}s  tag ${Math.round(inter(U, tagU) / 1000)}s  clauses ${rows.join(' ')}  [${s.flag_reasons.map((r) => r.id).join(',')}]`);
}
console.log('total (sum per scene)', (tot / 60000).toFixed(2), 'min');
