#!/usr/bin/env node
// v10.2 RESOLUTION GUARD (fix 3) and the RULE-1 QUESTION (optional; policy flag.rule1_question) -- Jev.
//
// Round 7: Sonnet-owned captured / weapon_used / crying flagged resolution and celebration scenes (Frozen S054 the
// thaw celebration, S055 Hans arrested; Zootopia S033 / S046 arrests). v10.2 asks Jev specific, observable
// questions -- ONE condition each -- on every scene where one of those Sonnet answers is at act:
//   arrest     "is a villain arrested, handcuffed, or led away as a prisoner?"
//   celebrate  "do the characters celebrate together?"
//   reunion    "are characters reunited with someone they had been apart from?"
// select.js (policy.flag.resolution_guard) cancels the Sonnet reasons its rule names when a guard answer is at
// its threshold. The rule and threshold were chosen on the 16 seen films (dev/guard.mjs), see policy.json.
//
// Rule 1 (villain threats): v10's Jev threatens_harm / plots_harm / film threatens concepts are tier B / C and never
// flag under the tier-A gate. The RULE-1 QUESTION "does a character say that they will kill or hurt another
// character?" is asked on every classified scene ONLY when policy.flag.rule1_question.enabled (it is enabled only if
// it measured tier A on the seen films, dev/rule1.mjs). --r1 asks it regardless (dev measurement only).
//
//   node resolve.js <slug> [--run r1] [--cap 0.02] [--in <dir>] [--r1] [--guard] [--dry] [--final-held-out-run]
// --in: read <slug>.segments.json and <slug>.sonnetq.<run>.json from <dir> (default: the output directory).
// Writes <out>/<slug>.resolve.<run>.json: scenes { id: { guard?: { arrest, celebrate, reunion }, r1? } }; select.js
// reads it as answers.x.guard_<q> and answers.x.r1_threat.
// Money: every request reserves its worst case first (jev-client sizeRequest, 3x estimate + fixed overhead).
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
export const RESOLVE_VERSION = 'resolve-v10.2.0';
export const RESERVE_FIXED_TOK = 1500;

/** The guard questions (Noul, one condition each; LS state: setting + verified summary + lines). */
export const GUARD_QS = {
  arrest: {
    type: 'noul',
    instructions: 'In `scene`, is a villain arrested, handcuffed, or led away as a prisoner?',
    criteria: {
      true: 'A bad character (a villain, a crook, a schemer) is arrested, handcuffed, locked up, or taken away as a prisoner by police, guards, or the heroes in this scene.',
      false: 'Nobody is arrested or taken prisoner in this scene, or the one who is caught, tied up, caged, locked up, or carried off is a hero, a child, an animal, or someone who did nothing wrong.',
    },
  },
  celebrate: {
    type: 'noul',
    instructions: 'In `scene`, do the characters celebrate together?',
    criteria: {
      true: 'Characters celebrate in this scene: they cheer for good news, dance, throw a party, or hug in joy.',
      false: 'Nobody celebrates in this scene, or the only cheering is for a fight, a hunt, a capture, or someone getting hurt.',
    },
  },
  reunion: {
    type: 'noul',
    instructions: 'In `scene`, are characters reunited with someone they had been apart from?',
    criteria: {
      true: 'Characters who were apart (lost, separated, sent away, or thought to be dead) find each other again and are together in this scene.',
      false: 'Nobody comes back together in this scene, or characters only meet again as enemies.',
    },
  },
};
/** The rule-1 question (Noul, one condition; L state: the scene's lines). */
export const R1_Q = {
  type: 'noul',
  instructions: 'In `scene`, does a character say that they will kill or hurt another character?',
  criteria: {
    true: 'One of the lines is a character saying that they, or their side, will kill, hurt, or destroy another character (for example "I will kill you" or "we will destroy him"), including in a song.',
    false: 'No line says this. Jokes and teasing said in fun, threats against objects or places, warnings about a danger, and talk about hunting food do not count.',
  },
};

/** Sonnet ids a guard may cancel (the concepts round 7 saw firing on resolution scenes). */
export const GUARDED_IDS = ['captured', 'cage_net_trap', 'restraints', 'weapon_used', 'crying'];
const pOf = (row, id) => (row ? row[id]?.p ?? P_UNLISTED : null);

/** Scenes whose Sonnet answer for any guarded id is at act: [{ id, ids }], credits scenes excluded. Pure. */
export function guardScenes({ seg, sonnet, cues, act, creditsCfg = {}, ids = GUARDED_IDS }) {
  const credits = creditsSceneIds(seg.scenes, cues, creditsCfg).ids;
  return seg.scenes.filter((s) => !credits.has(s.id)).map((s) => {
    const row = sonnet.scenes?.[s.id];
    return { id: s.id, ids: ids.filter((id) => { const p = pOf(row, id); return p != null && p >= act(id); }) };
  }).filter((x) => x.ids.length);
}
/** Every non-credits scene (the rule-1 question). Pure. */
export function r1Scenes({ seg, cues, creditsCfg = {} }) {
  const credits = creditsSceneIds(seg.scenes, cues, creditsCfg).ids;
  return seg.scenes.filter((s) => !credits.has(s.id)).map((s) => s.id);
}
export function guardBody({ seg, scene, cues, qs = Object.keys(GUARD_QS) }) {
  const { states } = statesFor({ seg, scene, cues: cues.slice(scene.start_cue - 1, scene.end_cue) });
  return { model: MODEL, state: states.LS, questions: Object.fromEntries(qs.map((k) => [k, GUARD_QS[k]])) };
}
export function r1Body({ seg, scene, cues }) {
  const { states } = statesFor({ seg, scene, cues: cues.slice(scene.start_cue - 1, scene.end_cue) });
  return { model: MODEL, state: states.L, questions: { r1: R1_Q } };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2);
  const slug = argv.find((a) => !a.startsWith('--') && !['--run', '--cap', '--in'].includes(argv[argv.indexOf(a) - 1]));
  const opt = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
  if (!slug) { console.error('usage: node resolve.js <slug> [--run r1] [--cap 0.02] [--in <dir>] [--r1] [--dry]'); process.exit(2); }
  heldOutGate(slug);
  const runId = opt('run', 'r1');
  const OUT = outDir();
  const IN = path.resolve(opt('in', OUT));
  const policy = JSON.parse(fs.readFileSync(path.join(here, 'policy.json'), 'utf8'));
  const actOf = (id) => policy.overrides?.[`e.${id}`]?.act ?? policy.overrides?.[`pl.${id}`]?.act ?? policy.act;
  const askR1 = argv.includes('--r1') || policy.flag?.rule1_question?.enabled === true;
  const askGuard = argv.includes('--guard') || !!policy.flag?.resolution_guard;
  const seg = JSON.parse(fs.readFileSync(path.join(IN, `${slug}.segments.json`), 'utf8'));
  const sonnet = JSON.parse(fs.readFileSync(path.join(IN, `${slug}.sonnetq.${runId}.json`), 'utf8'));
  const cues = parseSrt(fs.readFileSync(path.resolve(here, '..', 'data', `${seg.film.slug}.srt`), 'utf8'));
  const byId = new Map(seg.scenes.map((s) => [s.id, s]));
  // the pipeline asks only the guard questions the policy uses, on scenes where an id they cancel is at act;
  // --guard (dev measurement) asks all three on every GUARDED_IDS scene
  const G = policy.flag?.resolution_guard ?? null;
  const gIds = argv.includes('--guard') || !G ? GUARDED_IDS : Object.keys(G.cancels);
  const gQs = argv.includes('--guard') || !G ? Object.keys(GUARD_QS) : [...new Set(Object.values(G.cancels).flat())];
  const gs = askGuard ? guardScenes({ seg, sonnet, cues, act: actOf, creditsCfg: policy.credits ?? {}, ids: gIds }) : [];
  const rs = askR1 ? r1Scenes({ seg, cues, creditsCfg: policy.credits ?? {} }) : [];
  const job = (kind, id, body) => { const sz = sizeRequest(body, `${kind}:${id}`, { reserveXEst: 3.0 }); return { body, est: sz.est, reserveUsd: sz.reserveUsd + usd(RESERVE_FIXED_TOK), meta: { kind, id, label: `${kind}:${id}` } }; };
  const jobs = [...gs.map((x) => job('guard', x.id, guardBody({ seg, scene: byId.get(x.id), cues, qs: gQs }))), ...rs.map((id) => job('r1', id, r1Body({ seg, scene: byId.get(id), cues })))];
  const CAP = Number(opt('cap', '0.02'));
  const reserve = jobs.reduce((a, j) => a + j.reserveUsd, 0);
  console.log(`${slug}: guard (${gQs.join(", ")}) on ${gs.length} scenes (Sonnet ${gIds.join("/")} at act), rule-1 question on ${rs.length} scenes; ${jobs.length} Jev requests, worst case $${reserve.toFixed(6)} (cap $${CAP})`);
  if (argv.includes('--dry')) process.exit(0);
  const wallet = budget(CAP);
  const r = jobs.length ? await runJobs(jobs, { key: key('TYPESAFE_API_KEY'), budget: wallet, concurrency: MAX_CONCURRENCY }) : { results: [], stopped: null };
  if (wallet.spent > 0) record(slug, { script: 'resolve.js', kind: 'jev', usd: wallet.spent, note: `${RESOLVE_VERSION} ${jobs.length} requests` });
  const bad = r.results.filter((x) => !x.ok);
  if (bad.length) { console.error(`resolve: ${bad.length} requests failed (${bad[0].skipped ?? bad[0].error})`); process.exit(5); }
  const scenes = {};
  const r3 = (x) => Math.round(x * 1000) / 1000;
  for (const x of r.results) {
    const a = x.json.answers ?? {};
    const s = (scenes[x.meta.id] ??= {});
    if (x.meta.kind === 'guard') {
      s.guard_ids = gs.find((g) => g.id === x.meta.id).ids;
      s.guard = Object.fromEntries(gQs.map((k) => { const p = Number(a[k]?.noul); if (!Number.isFinite(p)) throw new Error(`resolve: ${x.meta.id} has no ${k}`); return [k, r3(p)]; }));
    } else {
      const p = Number(a.r1?.noul); if (!Number.isFinite(p)) throw new Error(`resolve: ${x.meta.id} has no r1`);
      s.r1 = r3(p);
    }
  }
  const out = { film: seg.film, version: RESOLVE_VERSION, run: runId, model: MODEL, questions: { guard: Object.fromEntries(gQs.map((k) => [k, GUARD_QS[k]])), ...(askR1 ? { r1: R1_Q } : {}) }, asked: { guard: askGuard, r1: askR1 }, run_at: new Date().toISOString(), requests: jobs.length, cost_usd: +wallet.spent.toFixed(8), input_dir: path.relative(here, IN), scenes };
  const file = path.join(OUT, `${slug}.resolve.${runId}.json`);
  fs.writeFileSync(file, JSON.stringify(out, null, 2));
  console.log(`  ${Object.entries(scenes).filter(([, v]) => v.guard).map(([id, v]) => `${id} ${v.guard_ids.join('+')} ${Object.entries(v.guard).map(([k, p]) => `${k} ${p}`).join(' ')}`).join('\n  ') || 'no guard scenes'}; $${out.cost_usd} -> ${path.relative(here, file)}`);
}
