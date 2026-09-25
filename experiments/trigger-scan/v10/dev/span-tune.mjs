#!/usr/bin/env node
// Dev-only span tuning (goal B). No model calls. For each dev film and each candidate span rule
// (overrides of policy.json moments / wordless), re-span the flagged scenes offline from the SAVED
// moment answers (<out>/<slug>.moments.r1.json, v7 format) and score the skip against the dev
// reference key (refscore.js, the same functions compare.js uses) and the live DB (scene-api/load.js,
// read-only). Flags are held fixed (<out>/<slug>.tags.r1.json).
//
//   node dev/span-tune.mjs [--films a,b] [--out out]     -> out/dev/span-tune.json + a table
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSrt } from '../../srt.js';
import * as L from '../../../../scene-api/load.js';
import { loadPolicy, selectRun } from '../select.js';
import { respanScenes } from '../moments.js';
import { scoreKey, sensitivity, union, total, inter } from '../refscore.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const V8 = path.resolve(here, '..');
const TS = path.resolve(V8, '..');
const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const FILMS = opt('films', 'nemo,monsters-inc,lion-king,frankenweenie,wild-robot').split(',');
const OUT = path.resolve(V8, opt('out', 'out'));
const readJson = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const r3 = (x) => (x == null ? null : Math.round(x * 1000) / 1000);
const deepMerge = (a, b) => { const o = structuredClone(a); for (const [k, v] of Object.entries(b)) o[k] = v && typeof v === 'object' && !Array.isArray(v) ? deepMerge(o[k] ?? {}, v) : v; return o; };

import { VARIANTS } from './span-variants.mjs';

const ctx = await L.openExperiment(TS);
const v2map = L.buildV2Map(ctx.taxonomy);
const vocabIds = new Set(L.buildVocabulary(ctx.taxonomy).items.map((i) => i.id));
const dbSpans = (slug) => L.buildFilmFrom(L.readFilmInputs(slug, ctx), { srt: ctx.srt, v2map, vocabIds }).scenes.map((s) => [s.start_ms, s.end_ms]);

function score(key, skip, db) {
  const s = scoreKey(key, skip, { liveDb: db });
  const g = scoreKey(key, skip, { liveDb: db, window: 'gap' });
  const sens = sensitivity(key, skip, db);
  return {
    skip_min: s.skip_minutes, recall_strict: s.recall_items.found, recall_gap: g.recall_items.found, recall_cons: Math.min(s.recall_items.found, g.recall_items.found), of: s.recall_items.of,
    moments: `${s.recall_moments.found}/${s.recall_moments.of}`, prec_strict: s.precision_proxy_ref_only, prec_gap: g.precision_proxy_ref_only, tag_only: `${s.tag_only.flagged}/${s.tag_only.items}`, tag_only_n: s.tag_only.flagged,
    jitter_recall_p05_p95: [sens.recall_diff_a_minus_b.p05, sens.recall_diff_a_minus_b.p95], share_ge_db: sens.recall_diff_a_minus_b.share_a_ge_b,
  };
}

const out = {};
const base = loadPolicy();
for (const slug of FILMS) {
  const key = readJson(path.join(TS, 'refs', `${slug}.key.json`));
  const db = dbSpans(slug);
  const dbMin = total(union(db)) / 60000;
  const run = readJson(path.join(OUT, `${slug}.jev.r1.json`));
  const saved = readJson(path.join(OUT, `${slug}.moments.r1.json`));
  const cues = parseSrt(fs.readFileSync(path.join(TS, 'data', `${slug}.srt`), 'utf8'));
  const rows = {};
  // before: round 2 as run (v6/out tags r1 spans)
  const v6tags = readJson(path.join(TS, 'v6', 'out', `${slug}.tags.r1.json`));
  const v6skip = v6tags.scenes.filter((s) => s.flagged).flatMap((s) => (s.skip?.spans ?? []).map((x) => [x.start_ms, x.end_ms]));
  rows.round2_as_run = score(key, v6skip, db);
  rows.live_db = score(key, db, db);
  for (const [name, ov] of Object.entries(VARIANTS)) {
    const cfg = deepMerge(base, ov);
    const tags0 = selectRun(run, cfg, { cues });
    const scenes = name === 'flagged_whole_scenes' ? {} : respanScenes({ tags: tags0, saved, cues, items: run.film_items ?? [], cfg });
    const tags = name === 'flagged_whole_scenes' ? tags0 : selectRun(run, cfg, { moments: { scenes }, cues });
    const skip = tags.scenes.filter((s) => s.flagged).flatMap((s) => (s.skip?.spans ?? []).map((x) => [x.start_ms, x.end_ms]));
    const methods = Object.values(scenes).reduce((m, x) => ({ ...m, [x.method]: (m[x.method] ?? 0) + 1 }), {});
    rows[name] = { ...score(key, skip, db), methods };
  }
  out[slug] = { live_db_min: r3(dbMin), target_min: r3(dbMin * 1.1), rows };
  console.log(`\n=== ${slug}: live DB ${dbMin.toFixed(1)} min (target <= ${(dbMin * 1.1).toFixed(1)}); key should_flag mapped ${rows.live_db.of}`);
  console.log('  variant'.padEnd(40), 'skip  rec s/g/cons  moments  prec s/g   tag  jitter(v-db p05..p95, share>=db) methods');
  for (const [n, r] of Object.entries(rows)) console.log(`  ${n.padEnd(38)} ${String(r.skip_min).padStart(6)}  ${r.recall_strict}/${r.recall_gap}/${r.recall_cons} of ${r.of}  ${r.moments.padEnd(7)} ${r.prec_strict}/${r.prec_gap}  ${r.tag_only}  ${r.jitter_recall_p05_p95.join('..')} ${r.share_ge_db} ${r.methods ? JSON.stringify(r.methods) : ''}`);
}
fs.mkdirSync(path.join(OUT, 'dev'), { recursive: true });
fs.writeFileSync(path.join(OUT, 'dev', 'span-tune.json'), JSON.stringify({ generated_at: new Date().toISOString(), variants: VARIANTS, films: out }, null, 1));
