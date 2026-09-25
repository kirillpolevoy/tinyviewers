#!/usr/bin/env node
// v10.3 fix (a): MORTAL-DANGER QUESTIONS (Jev).
//
// Round 8: the tier-A gate turned two of The Incredibles' worst moments into tags only -- S005 (a man jumps from a
// building to end his life) and S006 (a bomb stuck to a child's cape, then a train explosion). Both scenes held only
// tier-C afraid_for_safety and tier-B threat / appearance reasons; S006 had no explosion tag at all (no line captions
// the blast: "There's a bomb!" and the beeping are all the lines say). v10.3 asks Jev SPECIFIC, observable questions
// -- one condition each, with the trap no-cases spelled out (comedy, games, dreams, retellings, songs) -- on every
// non-credits scene. Which of them flag is decided by policy.json flag.mortal (only phrasings that measured tier A on
// the 19 seen films, dev/mortal.mjs); a kept question's reason passes the tier-A gate like the rule-1 question.
//
//   node mortal.js <slug> [--run r1] [--cap 0.02] [--in <dir>] [--dev] [--dry] [--final-held-out-run]
// --dev (dev measurement only): ask EVERY candidate question in both states (L = the scene's lines; LS = setting +
// verified summary + lines) instead of only the policy's questions in their chosen state.
// --in: read <slug>.segments.json from <dir> (default: the output directory).
// Writes <out>/<slug>.mortal.<run>.json: scenes { id: { <question>@<state>: p } }; select.js reads the policy's
// questions as answers.x.mortal_<question>.
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

const here = path.dirname(fileURLToPath(import.meta.url));
export const MORTAL_VERSION = 'mortal-v10.3.0';
export const RESERVE_FIXED_TOK = 1500;
export const STATES = ['L', 'LS'];

const NO_TRAPS = 'A fall, jump or blast played for laughs (a cartoon bump, a pratfall, a harmless tumble), a game or sport, a dream or daydream, a story, memory or plan told about it without it happening in this scene, and a song about it are a no.';

/**
 * The candidate questions (Noul, one condition each). `reason` = the flag reason a kept question adds (select.js):
 * its label, group (for chips and the tier-A test), the moment clause moments.js searches for, the parent phrase
 * describe.js is told the scene was flagged for, and its severity content weights.
 */
export const MORTAL_QS = {
  // the task's phrasing: jump or fall toward death, or a suicide attempt
  deadly_fall: {
    type: 'noul',
    instructions: 'In `scene`, does a character jump or fall toward their death, or try to end their life?',
    criteria: {
      true: 'In this scene a character jumps, falls, is dropped or is thrown from a height that could kill them (a building, a cliff, a bridge, the sky), or a character tries to kill themselves, whether or not they are saved in time.',
      false: `Nobody falls or jumps from a deadly height and nobody tries to end their life in this scene. Flying, gliding, climbing, a short fall that could not kill, and a jump into water or onto something soft for fun are a no. ${NO_TRAPS}`,
    },
  },
  // the fall alone (no suicide clause)
  fall_height: {
    type: 'noul',
    instructions: 'In `scene`, does a character fall or jump from a height that could kill them?',
    criteria: {
      true: 'In this scene a character falls, jumps, is dropped or is thrown from a height that could kill them (a building, a cliff, a bridge, a tree top, the sky), whether or not they are caught in time.',
      false: `Nobody falls or jumps from a deadly height in this scene. Flying, gliding, climbing, a short fall that could not kill, and a jump into water or onto something soft for fun are a no. ${NO_TRAPS}`,
    },
  },
  // the suicide attempt alone
  ends_life: {
    type: 'noul',
    instructions: 'In `scene`, does a character try to kill themselves?',
    criteria: {
      true: 'In this scene a character deliberately tries to end their own life (for example jumping from a building to die), whether or not someone stops them.',
      false: `Nobody tries to end their own life in this scene. Risking one's life to save someone, a dangerous stunt, and saying "I could just die" as a figure of speech are a no. ${NO_TRAPS}`,
    },
  },
  // the task's phrasing: a character stuck with a bomb about to go off
  bomb_on_character: {
    type: 'noul',
    instructions: 'In `scene`, is a character tied to, stuck with, or holding a bomb or explosive that is about to go off?',
    criteria: {
      true: 'In this scene a bomb, explosive or ticking device is tied to, stuck on, held by, or right next to a character and is about to explode (a countdown, beeping, a lit fuse, or someone shouting that there is a bomb).',
      false: `No bomb or explosive is on or next to a character in this scene, or it is only talked about, planned, or far away from everyone. Fireworks, a toy, and someone "exploding" with anger are a no. ${NO_TRAPS}`,
    },
  },
  // the explosion that hits people (S006's train blast is in no line)
  blast_near_character: {
    type: 'noul',
    instructions: 'In `scene`, does a bomb or explosive go off close to a character?',
    criteria: {
      true: 'In this scene a bomb, explosive, missile or blast goes off (or is shown about to go off) close enough to a character to hurt or kill them.',
      false: `Nothing explodes near a character in this scene. Fireworks, a toy, a blast only talked about or planned, a blast far from everyone, and someone "exploding" with anger are a no. ${NO_TRAPS}`,
    },
  },
};

/** The flag reason each question adds when policy.flag.mortal keeps it (select.js mortalReasons). */
export const MORTAL_REASONS = {
  deadly_fall: { id: 'deadly_fall', label: 'Deadly fall', group: 'peril', moment: 'a character jumps or falls toward their death, or tries to end their life', phrase: 'a character jumps or falls toward their death', weights: { '5-7': 3, '8-10': 3 } },
  fall_height: { id: 'deadly_fall', label: 'Deadly fall', group: 'peril', moment: 'a character falls or jumps from a height that could kill them', phrase: 'a character falls from a deadly height', weights: { '5-7': 3, '8-10': 3 } },
  ends_life: { id: 'ends_life', label: 'Tries to end their life', group: 'peril', moment: 'a character tries to kill themselves', phrase: 'a character tries to end their life', weights: { '5-7': 3, '8-10': 3 } },
  bomb_on_character: { id: 'bomb_danger', label: 'Bomb danger', group: 'peril', moment: 'a character is stuck with or holding a bomb that is about to go off', phrase: 'a character is caught with a bomb about to go off', weights: { '5-7': 3, '8-10': 3 } },
  blast_near_character: { id: 'bomb_danger', label: 'Bomb danger', group: 'peril', moment: 'a bomb or explosive goes off close to a character', phrase: 'a bomb goes off near a character', weights: { '5-7': 3, '8-10': 3 } },
};
/** Reason id -> its metadata (the first question that names it). */
export const MORTAL_BY_REASON = Object.fromEntries(Object.values(MORTAL_REASONS).reverse().map((r) => [r.id, r]));

/** Every non-credits scene. Pure. */
export function mortalScenes({ seg, cues, creditsCfg = {} }) {
  const credits = creditsSceneIds(seg.scenes, cues, creditsCfg).ids;
  return seg.scenes.filter((s) => !credits.has(s.id)).map((s) => s.id);
}
/** One request body for a scene in one state with the given questions. */
export function mortalBody({ seg, scene, cues, state, qs }) {
  const { states } = statesFor({ seg, scene, cues: cues.slice(scene.start_cue - 1, scene.end_cue) });
  const st = states[state];
  if (!st) return null;
  return { model: MODEL, state: st, questions: Object.fromEntries(qs.map((k) => [k, MORTAL_QS[k]])) };
}
/** What the pipeline asks: { state: [question ids] } from policy.flag.mortal (empty when disabled). */
export function plannedAsks(policy) {
  const m = policy.flag?.mortal;
  if (!m?.enabled) return {};
  const by = {};
  for (const q of m.questions ?? []) (by[q.state] ??= []).push(q.q);
  return by;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2);
  const slug = argv.find((a) => !a.startsWith('--') && !['--run', '--cap', '--in'].includes(argv[argv.indexOf(a) - 1]));
  const opt = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
  if (!slug) { console.error('usage: node mortal.js <slug> [--run r1] [--cap 0.02] [--in <dir>] [--dev] [--dry]'); process.exit(2); }
  heldOutGate(slug);
  const runId = opt('run', 'r1');
  const OUT = outDir();
  const IN = path.resolve(opt('in', OUT));
  const policy = JSON.parse(fs.readFileSync(path.join(here, 'policy.json'), 'utf8'));
  const dev = argv.includes('--dev');
  const asks = dev ? Object.fromEntries(STATES.map((s) => [s, Object.keys(MORTAL_QS)])) : plannedAsks(policy);
  const seg = JSON.parse(fs.readFileSync(path.join(IN, `${slug}.segments.json`), 'utf8'));
  const cues = parseSrt(fs.readFileSync(path.resolve(here, '..', 'data', `${seg.film.slug}.srt`), 'utf8'));
  const byId = new Map(seg.scenes.map((s) => [s.id, s]));
  const ids = Object.keys(asks).length ? mortalScenes({ seg, cues, creditsCfg: policy.credits ?? {} }) : [];
  const jobs = [];
  for (const id of ids) for (const [state, qs] of Object.entries(asks)) {
    const body = mortalBody({ seg, scene: byId.get(id), cues, state, qs });
    if (!body) continue; // no verified summary: the S-part of LS is empty -> statesFor still gives LS with an empty summary
    const sz = sizeRequest(body, `mortal:${id}@${state}`, { reserveXEst: 3.0 });
    jobs.push({ body, est: sz.est, reserveUsd: sz.reserveUsd + usd(RESERVE_FIXED_TOK), meta: { id, state, qs, label: `mortal:${id}@${state}` } });
  }
  const CAP = Number(opt('cap', '0.02'));
  const reserve = jobs.reduce((a, j) => a + j.reserveUsd, 0);
  console.log(`${slug}: mortal questions ${JSON.stringify(asks)} on ${ids.length} scenes; ${jobs.length} Jev requests, worst case $${reserve.toFixed(6)} (cap $${CAP})`);
  if (argv.includes('--dry')) process.exit(0);
  const wallet = budget(CAP);
  const r = jobs.length ? await runJobs(jobs, { key: key('TYPESAFE_API_KEY'), budget: wallet, concurrency: MAX_CONCURRENCY }) : { results: [], stopped: null };
  if (wallet.spent > 0) record(slug, { script: 'mortal.js', kind: 'jev', usd: wallet.spent, note: `${MORTAL_VERSION}${dev ? ' --dev' : ''} ${jobs.length} requests` });
  const bad = r.results.filter((x) => !x.ok);
  if (bad.length) { console.error(`mortal: ${bad.length} requests failed (${bad[0].skipped ?? bad[0].error})`); process.exit(5); }
  const scenes = {};
  const r3 = (x) => Math.round(x * 1000) / 1000;
  for (const x of r.results) {
    const a = x.json.answers ?? {};
    const s = (scenes[x.meta.id] ??= {});
    for (const q of x.meta.qs) { const p = Number(a[q]?.noul); if (!Number.isFinite(p)) throw new Error(`mortal: ${x.meta.id} has no ${q}`); s[`${q}@${x.meta.state}`] = r3(p); }
  }
  const out = { film: seg.film, version: MORTAL_VERSION, run: runId, model: MODEL, dev, asked: asks, questions: Object.fromEntries([...new Set(Object.values(asks).flat())].map((k) => [k, MORTAL_QS[k]])), run_at: new Date().toISOString(), requests: jobs.length, cost_usd: +wallet.spent.toFixed(8), input_dir: path.relative(here, IN), scenes };
  const file = path.join(OUT, `${slug}.mortal.${runId}.json`);
  fs.writeFileSync(file, JSON.stringify(out, null, 2));
  const hi = Object.entries(scenes).filter(([, v]) => Object.values(v).some((p) => p >= 0.6));
  console.log(`  ${hi.length} scenes with any answer >= 0.6: ${hi.map(([id, v]) => `${id} ${Object.entries(v).filter(([, p]) => p >= 0.6).map(([k, p]) => `${k} ${p}`).join(' ')}`).join(' | ') || '-'}; $${out.cost_usd} -> ${path.relative(here, file)}`);
}
