#!/usr/bin/env node
// v10.1 RULE 2, THE CRYING HALF (Jev). The user's policy: "a child character terrified OR CRYING flags even
// without physical danger". v10's Jev child_frightened concept covers terrified; crying is Sonnet-owned
// (split.json) and was a tag only, so a child sobbing for a dead parent (Good Dinosaur S021) never flagged.
//
// v10.1 flags crying when (select.js flag.requires.crying):
//   Sonnet's crying answer is at act (the concept's own threshold)  AND  a child is involved:
//     (a) a verified cast child's film presence tag is at act in the scene (questions.js filmItems why 'child'), or
//     (b) Jev says the one who cries is a child: ONE Noul per scene whose crying is at act, asked here in the
//         LSC state (verified child names + setting + verified summary + lines; questions.js statesFor).
// This script asks (b) and writes <out>/<slug>.childcry.<run>.json; select.js reads it as answers.x.crying_child.
//
//   node childcry.js <slug> [--run r1] [--cap 0.01] [--in <dir>] [--dry] [--final-held-out-run]
// --in: read <slug>.segments.json and <slug>.sonnetq.<run>.json from <dir> (default: the output directory).
// Money: every request reserves its worst case first (jev-client sizeRequest, 3x estimate + fixed overhead);
// --cap is per film for this script.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSrt } from '../srt.js';
import { budget } from './budget.js';
import { key, outDir, heldOutGate } from './env.js';
import { record } from './ledger.js';
import { sizeRequest, runJobs, usd, MAX_CONCURRENCY } from './jev-client.js';
import { statesFor, MODEL } from './questions.js';
import { creditsSceneIds } from './credits.js';
import { P_UNLISTED } from './sonnet-questions.js';

const here = path.dirname(fileURLToPath(import.meta.url));
export const CHILDCRY_VERSION = 'childcry-v10.1.0';
export const RESERVE_FIXED_TOK = 1500;

/** The Jev question: is the one who cries a child? (Noul) */
export const CHILD_CRY_Q = {
  type: 'noul',
  instructions: 'In `scene`, is the character who cries or sobs a child? `children` names the film\'s child characters; a young animal character counts as a child.',
  criteria: {
    true: 'The one crying in this scene is a child: one of `children`, or a character the scene shows to be young (a kid, a boy, a girl, a baby, a cub, a chick, a young son or daughter).',
    false: 'Only grown-ups cry in this scene, or nobody cries in it.',
  },
};

/** Sonnet's crying probability of one scene row (sonnetq.js), P_UNLISTED when absent. */
export const cryingP = (row) => (row ? row.crying?.p ?? P_UNLISTED : null);

/** Scenes whose Sonnet crying answer is at act: [{ id, p }], credits scenes excluded. Pure. */
export function scenesToAsk({ seg, sonnet, cues, act, creditsCfg = {} }) {
  const credits = creditsSceneIds(seg.scenes, cues, creditsCfg).ids;
  return seg.scenes.filter((s) => !credits.has(s.id)).map((s) => ({ id: s.id, p: cryingP(sonnet.scenes?.[s.id]) })).filter((x) => x.p != null && x.p >= act);
}

/** One request body for a scene (LSC state). */
export function childCryBody({ seg, scene, cues }) {
  const { states } = statesFor({ seg, scene, cues: cues.slice(scene.start_cue - 1, scene.end_cue) });
  return { model: MODEL, state: states.LSC, questions: { child: CHILD_CRY_Q } };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2);
  const slug = argv.find((a) => !a.startsWith('--') && !['--run', '--cap', '--in'].includes(argv[argv.indexOf(a) - 1]));
  const opt = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
  if (!slug) { console.error('usage: node childcry.js <slug> [--run r1] [--cap 0.01] [--in <dir>] [--dry]'); process.exit(2); }
  heldOutGate(slug);
  const runId = opt('run', 'r1');
  const OUT = outDir();
  const IN = path.resolve(opt('in', OUT));
  const policy = JSON.parse(fs.readFileSync(path.join(here, 'policy.json'), 'utf8'));
  const act = policy.overrides?.['e.crying']?.act ?? policy.act;
  const seg = JSON.parse(fs.readFileSync(path.join(IN, `${slug}.segments.json`), 'utf8'));
  const sonnet = JSON.parse(fs.readFileSync(path.join(IN, `${slug}.sonnetq.${runId}.json`), 'utf8'));
  const cues = parseSrt(fs.readFileSync(path.resolve(here, '..', 'data', `${seg.film.slug}.srt`), 'utf8'));
  const ask = scenesToAsk({ seg, sonnet, cues, act, creditsCfg: policy.credits ?? {} });
  const byId = new Map(seg.scenes.map((s) => [s.id, s]));
  const jobs = ask.map((x) => {
    const body = childCryBody({ seg, scene: byId.get(x.id), cues });
    const sz = sizeRequest(body, `childcry:${x.id}`, { reserveXEst: 3.0 });
    return { body, est: sz.est, reserveUsd: sz.reserveUsd + usd(RESERVE_FIXED_TOK), meta: { id: x.id, label: `childcry:${x.id}` } };
  });
  const CAP = Number(opt('cap', '0.01'));
  const reserve = jobs.reduce((a, j) => a + j.reserveUsd, 0);
  console.log(`${slug}: ${ask.length} scenes with crying at act (>= ${act}); ${jobs.length} Jev requests, worst case $${reserve.toFixed(6)} (cap $${CAP})`);
  if (argv.includes('--dry')) process.exit(0);
  const wallet = budget(CAP);
  const r = jobs.length ? await runJobs(jobs, { key: key('TYPESAFE_API_KEY'), budget: wallet, concurrency: MAX_CONCURRENCY }) : { results: [], stopped: null };
  if (wallet.spent > 0) record(slug, { script: 'childcry.js', kind: 'jev', usd: wallet.spent, note: `${CHILDCRY_VERSION} ${jobs.length} requests` });
  const bad = r.results.filter((x) => !x.ok);
  if (bad.length) { console.error(`childcry: ${bad.length} requests failed (${bad[0].skipped ?? bad[0].error})`); process.exit(5); }
  const scenes = {};
  for (const x of r.results) {
    const p = Number(x.json.answers?.child?.noul);
    if (!Number.isFinite(p)) { console.error(`childcry: ${x.meta.id} has no noul`); process.exit(5); }
    scenes[x.meta.id] = { crying_p: ask.find((a) => a.id === x.meta.id).p, p_child: Math.round(p * 1000) / 1000 };
  }
  const out = { film: seg.film, version: CHILDCRY_VERSION, run: runId, model: MODEL, question: CHILD_CRY_Q, crying_act: act, run_at: new Date().toISOString(), requests: jobs.length, cost_usd: +wallet.spent.toFixed(8), input_dir: path.relative(here, IN), scenes };
  const file = path.join(OUT, `${slug}.childcry.${runId}.json`);
  fs.writeFileSync(file, JSON.stringify(out, null, 2));
  console.log(`  ${Object.entries(scenes).map(([id, v]) => `${id} child ${v.p_child}`).join(', ') || 'none'}; $${out.cost_usd} -> ${path.relative(here, file)}`);
}
