#!/usr/bin/env node
// Dev-only: which should_flag key items does a span variant lose against a baseline, and where are
// they? node dev/lost-items.mjs <slug> <variant> [baseline: round2|flagged_whole|live_db]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSrt } from '../../srt.js';
import * as L from '../../../../scene-api/load.js';
import { loadPolicy, selectRun } from '../select.js';
import { respanScenes } from '../moments.js';
import { scoreKey } from '../refscore.js';
const here = path.dirname(fileURLToPath(import.meta.url));
const V8 = path.resolve(here, '..'); const TS = path.resolve(V8, '..');
const [slug, variant, baseline = 'round2'] = process.argv.slice(2);
const { VARIANTS } = await import('./span-variants.mjs');
const readJson = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const deepMerge = (a, b) => { const o = structuredClone(a); for (const [k, v] of Object.entries(b)) o[k] = v && typeof v === 'object' && !Array.isArray(v) ? deepMerge(o[k] ?? {}, v) : v; return o; };
const key = readJson(path.join(TS, 'refs', `${slug}.key.json`));
const run = readJson(path.join(V8, 'out', `${slug}.jev.r1.json`));
const saved = readJson(path.join(V8, 'out', `${slug}.moments.r1.json`));
const cues = parseSrt(fs.readFileSync(path.join(TS, 'data', `${slug}.srt`), 'utf8'));
const cfg = deepMerge(loadPolicy(), VARIANTS[variant]);
const t0 = selectRun(run, cfg, { cues });
const tags = selectRun(run, cfg, { moments: { scenes: respanScenes({ tags: t0, saved, cues, items: run.film_items ?? [], cfg }) }, cues });
const skip = tags.scenes.filter((s) => s.flagged).flatMap((s) => s.skip.spans.map((x) => [x.start_ms, x.end_ms]));
let base;
if (baseline === 'round2') base = readJson(path.join(TS, 'v6', 'out', `${slug}.tags.r1.json`)).scenes.filter((s) => s.flagged).flatMap((s) => (s.skip?.spans ?? []).map((x) => [x.start_ms, x.end_ms]));
else if (baseline.startsWith('variant:')) {
  const c2 = deepMerge(loadPolicy(), VARIANTS[baseline.slice(8)]);
  const u0 = selectRun(run, c2, { cues });
  base = selectRun(run, c2, { moments: { scenes: respanScenes({ tags: u0, saved, cues, items: run.film_items ?? [], cfg: c2 }) }, cues }).scenes.filter((s) => s.flagged).flatMap((s) => s.skip.spans.map((x) => [x.start_ms, x.end_ms]));
} else if (baseline === 'flagged_whole') base = tags.scenes.filter((s) => s.flagged).map((s) => [s.start_ms, s.end_ms]);
else { const ctx = await L.openExperiment(TS); base = L.buildFilmFrom(L.readFilmInputs(slug, ctx), { srt: ctx.srt, v2map: L.buildV2Map(ctx.taxonomy), vocabIds: new Set(L.buildVocabulary(ctx.taxonomy).items.map((i) => i.id)) }).scenes.map((s) => [s.start_ms, s.end_ms]); }
for (const win of ['strict', 'gap']) {
  const a = scoreKey(key, skip, { window: win }); const b = scoreKey(key, base, { window: win });
  const fa = new Set(a.found); const fb = new Set(b.found);
  console.log(`${slug} ${variant} vs ${baseline} [${win}]: ${a.recall_items.found} vs ${b.recall_items.found}; skip ${a.skip_minutes} vs ${b.skip_minutes}`);
  for (const id of [...fb].filter((x) => !fa.has(x))) {
    const it = key.items.find((x) => x.id === id);
    const r = a.rows.find((x) => x.id === id);
    const home = tags.scenes.filter((s) => s.start_ms < it.end_ms && s.end_ms > it.start_ms);
    console.log(`  LOST ${id} ${(it.start_ms / 1000).toFixed(0)}-${(it.end_ms / 1000).toFixed(0)}s share ${r.share_in_skip} wordless ${it.wordless} | ${home.map((s) => `${s.id}${s.flagged ? `[F ${s.skip.method} ${s.skip.spans.map((x) => `${(x.start_ms / 1000).toFixed(0)}-${(x.end_ms / 1000).toFixed(0)}`).join(',')}; ${s.flag_reasons.map((q) => q.id).join('+')}]` : '[-]'}`).join(' ')}`);
  }
  for (const id of [...fa].filter((x) => !fb.has(x))) console.log(`  GAINED ${id}`);
}
