#!/usr/bin/env node
// v10 END-TO-END REPLAY (dev only; no model calls, no network, $0). Runs one dev film through the REAL v10
// classify.js (planning, request bodies, reservation, unpacking) with a replay `post` that answers every
// request from STORED answers instead of Jev, then the real sonnet merge and select.js CLI. It checks that the
// pipeline code runs end to end and that its flags equal the post-hoc estimate's (eval/posthoc.mjs), which
// reads the same stored answers without going through classify.
//   Jev-set keys   assemble/score-lib.mjs flat answers (tournament + v9; lint-fixed keys = PROXY of the original)
//   v9-kept keys   v9/out/<slug>.jev.r1.json (m, fpl, fps, mod, s, kind)
//   Sonnet         v9/out/<slug>.sonnetq.r1.json restricted to split.json's Sonnet ids, re-labelled with the v10
//                  prompt version so select.js accepts it (replay: true in the file)
// Everything is written under the scratch dir given as V10_OUT (never out10/).
//   V10_OUT=<abs scratch dir> node dev/replay-e2e.mjs <slug>
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { run as classify } from '../classify.js';
import { loadData } from '../assemble/score-lib.mjs';
import { loadSplit } from '../split.js';
import { SONNET_Q_VERSION, promptHash } from '../sonnet-questions.js';
import { outDir } from '../env.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const V10 = path.resolve(here, '..');
const slug = process.argv[2] ?? 'nemo';
const OUT = outDir();
if (!process.env.V10_OUT || path.resolve(OUT) === path.join(V10, 'out10')) { console.error('set V10_OUT to a scratch dir'); process.exit(2); }
const rj = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const V9OUT = path.resolve(V10, '..', 'v9', 'out');
fs.copyFileSync(path.join(V9OUT, `${slug}.segments.json`), path.join(OUT, `${slug}.segments.json`));

const DATA = loadData({ fix: 'proxy' })[slug];
const v9 = rj(path.join(V9OUT, `${slug}.jev.r1.json`));
const v9by = new Map(v9.scenes.map((s) => [s.id, s.answers]));
const flatBy = new Map(DATA.scenes.map((s) => [s.id, s.a]));
// the replay post needs to know which scene a body belongs to: its state text contains the scene's lines
const seg = rj(path.join(OUT, `${slug}.segments.json`));
const missing = new Set();
let calls = 0;
const lineOf = (body) => JSON.stringify(body.state?.scene?.lines?.[0] ?? body.state?.scene?.summary ?? '');
const sceneByFirst = new Map();
{
  const { parseSrt } = await import('../../srt.js');
  const cues = parseSrt(fs.readFileSync(path.resolve(V10, '..', 'data', `${slug}.srt`), 'utf8'));
  for (const s of seg.scenes) sceneByFirst.set(JSON.stringify(`L${s.start_cue}| ${cues[s.start_cue - 1].text}`), s.id);
}
// classify builds `back` per request; recover it by re-planning (same pure function, same order)
const { planScene } = await import('../classify.js');
const { filmItems } = await import('../questions.js');
const { parseSrt } = await import('../../srt.js');
const cues = parseSrt(fs.readFileSync(path.resolve(V10, '..', 'data', `${slug}.srt`), 'utf8'));
const items = filmItems(seg);
const backByBody = new Map();
for (const scene of seg.scenes) for (const r of planScene({ seg, scene, cues: cues.slice(scene.start_cue - 1, scene.end_cue), items }).reqs) backByBody.set(JSON.stringify(r.body), { scene: scene.id, back: r.back });

async function post(body) {
  calls += 1;
  const hit = backByBody.get(JSON.stringify(body));
  if (!hit) throw new Error('replay: unknown request body');
  const flat = flatBy.get(hit.scene); const a9 = v9by.get(hit.scene) ?? {};
  const answers = {};
  for (const [qk, { key, kind }] of Object.entries(hit.back)) {
    if (kind === 'jev') { if (flat[key] === undefined) missing.add(key.replace(/#.*@/, '#…@')); answers[qk] = { noul: flat[key] ?? 0 }; continue; }
    if (key === 'kind') { answers[qk] = a9.kind; continue; }
    const ch = key.slice(0, key.indexOf('.')); const id = key.slice(key.indexOf('.') + 1);
    const v = a9[ch]?.[id];
    answers[qk] = ch === 's' ? { score: v.score, confidence: v.confidence, probabilities: v.probabilities } : { noul: v ?? 0 };
  }
  return { json: { model: 'replay', answers, usage: { input_tokens: 0, output_tokens: 0 } }, attempts: [{ status: 200, ms: 0 }], latencyMs: 0 };
}

const r = await classify({ slug, runId: 'r1', cap: 1, post });
// Sonnet: v9's stored answers for the v10 Sonnet ids only
const split = loadSplit();
const son9 = rj(path.join(V9OUT, `${slug}.sonnetq.r1.json`));
const keep = new Set(split.sonnet_asked);
const scenes = Object.fromEntries(Object.entries(son9.scenes).map(([id, row]) => [id, Object.fromEntries(Object.entries(row).filter(([q]) => keep.has(q)))]));
fs.writeFileSync(path.join(OUT, `${slug}.sonnetq.r1.json`), JSON.stringify({ ...son9, replay: true, replay_note: 'v9 stored Sonnet answers restricted to the v10 Sonnet ids; NOT a v10 Sonnet run', version: SONNET_Q_VERSION, prompt_sha256_12: promptHash(split.sonnet_asked), split: { file: 'split.json', sha256_12: split.sha256_12, sonnet_asked: split.sonnet_asked, sonnet_used: split.sonnet_used }, scenes }, null, 2));
const sel = spawnSync(process.execPath, [path.join(V10, 'select.js'), slug, '--run', 'r1'], { cwd: V10, encoding: 'utf8', env: process.env });
if (sel.status !== 0) { console.error(sel.stderr); process.exit(1); }
const tags = rj(path.join(OUT, `${slug}.tags.r1.json`));
const ph = rj(path.join(V10, 'eval', 'out', 'posthoc.json'));
console.log(`classify: ${r.scenes_done}/${r.scenes_total} scenes, ${r.requests} requests (${calls} replayed), complete ${r.complete}, jev questions ${r.question_set.jev_questions}`);
console.log(`jev-set keys asked but absent from the stored answers (answered 0): ${missing.size ? [...missing].join(', ') : 'none'}`);
console.log(sel.stdout.split('\n').slice(0, 3).join('\n'));
const f = tags.scenes.filter((s) => s.flagged);
const pf = ph.per_film.find((x) => x.slug === slug);
console.log(`flagged through classify + select CLI: ${f.length}; post-hoc v10 estimate: ${pf.flagged.v10}`);
const reasons = {}; for (const s of f) for (const x of s.flag_reasons) reasons[x.id] = (reasons[x.id] ?? 0) + 1;
const same = JSON.stringify(Object.entries(reasons).sort()) === JSON.stringify(Object.entries(pf.reason_counts.v10).sort());
console.log(`flag reason counts identical to the post-hoc: ${same}${same ? '' : `\n  replay ${JSON.stringify(reasons)}\n  posthoc ${JSON.stringify(pf.reason_counts.v10)}`}`);
