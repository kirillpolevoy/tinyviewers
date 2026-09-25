#!/usr/bin/env node
// v8: re-classify ONLY the scenes whose verified summary changed since a run (fill.js / refold.js), and
// merge their answers into that run's file. The other scenes keep their saved answers (Jev is asked the
// same questions over the same state for them, so re-asking would only spend money).
//
//   node reclassify.js <slug> [--run r1] [--cap 0.05] [--dry] [--final-held-out-run]
//
// A scene is re-asked when its summary (verified sentences, the context request's scene.summary) differs
// from the one the run's answers were computed on (the run's segments file as it was: <out>/<slug>.
// segments.prefill.json when present). Writes <out>/<slug>.jev.<run>.json in place (first time: a copy
// <out>/<slug>.jev.<run>.pre-reclassify.json), with reclassified: [{id, at, cost_usd}] and the scene rows
// replaced. Spend goes to the ledger through classify.js's run().
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { outDir, heldOutGate } from './env.js';
import { run as classify } from './classify.js';
import { verifiedSentences } from './questions.js';

const here = path.dirname(fileURLToPath(import.meta.url));

/** Scene ids whose verified summary differs between two segments objects. */
export function changedSummaries(before, after) {
  const b = new Map(before.scenes.map((s) => [s.id, verifiedSentences(s).join(' ')]));
  return after.scenes.filter((s) => verifiedSentences(s).join(' ') !== (b.get(s.id) ?? null)).map((s) => s.id);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2);
  const slug = argv.find((a) => !a.startsWith('--') && !['--run', '--cap'].includes(argv[argv.indexOf(a) - 1]));
  const opt = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
  if (!slug) { console.error('usage: node reclassify.js <slug> [--run r1] [--cap 0.05] [--dry]'); process.exit(2); }
  heldOutGate(slug);
  const OUT = outDir();
  const runId = opt('run', 'r1');
  const runFile = path.join(OUT, `${slug}.jev.${runId}.json`);
  const pre = path.join(OUT, `${slug}.jev.${runId}.pre-reclassify.json`);
  if (!fs.existsSync(pre)) fs.copyFileSync(runFile, pre);
  const base = JSON.parse(fs.readFileSync(pre, 'utf8'));
  const segNow = JSON.parse(fs.readFileSync(path.join(OUT, `${slug}.segments.json`), 'utf8'));
  const prefill = path.join(OUT, `${slug}.segments.prefill.json`);
  const segThen = JSON.parse(fs.readFileSync(fs.existsSync(prefill) ? prefill : path.join(OUT, `${slug}.segments.json`), 'utf8'));
  const ids = changedSummaries(segThen, segNow);
  console.log(`${slug}: ${ids.length} scenes with a changed verified summary: ${ids.join(',') || 'none'}`);
  if (!ids.length || argv.includes('--dry')) {
    if (ids.length) console.log(JSON.stringify(await classify({ slug, runId: `${runId}-reclassify`, scenesWanted: ids, dryRun: true }), (k, v) => (k === 'film_items' ? undefined : v), 0).slice(0, 600));
    process.exit(0);
  }
  const r = await classify({ slug, runId: `${runId}-reclassify`, scenesWanted: ids, cap: Number(opt('cap', '0.05')) });
  if (!r.complete) { console.error(`reclassify incomplete: ${r.stopped?.reason ?? 'errors'}`); process.exit(1); }
  const byId = new Map(r.scenes.map((s) => [s.id, s]));
  const merged = { ...base, scenes: base.scenes.map((s) => (byId.has(s.id) ? { ...byId.get(s.id), reclassified_at: r.run_at } : s)), reclassified: [...(base.reclassified ?? []), ...ids.map((id) => ({ id, at: r.run_at, cost_usd: +(byId.get(id).requests.reduce((a, q) => a + (q.cost_usd ?? 0), 0)).toFixed(8) }))], reclassify_cost_usd: +((base.reclassify_cost_usd ?? 0) + r.cost_usd).toFixed(8), segments_file: path.relative(here, path.join(OUT, `${slug}.segments.json`)) };
  fs.writeFileSync(runFile, JSON.stringify(merged, null, 2));
  fs.rmSync(path.join(OUT, `${slug}.jev.${runId}-reclassify.json`), { force: true });
  console.log(`  re-asked ${ids.length} scenes, $${r.cost_usd.toFixed(6)} -> ${path.relative(here, runFile)}`);
}
