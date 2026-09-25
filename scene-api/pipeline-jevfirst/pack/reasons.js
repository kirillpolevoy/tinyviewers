#!/usr/bin/env node
// v8 fix (c): every FLAGGED scene tells parents WHY, in a sentence that states the flagged event.
//
//   node reasons.js <slug> [--run r1] [--cap 0.01] [--dry] [--final-held-out-run]
//   node reasons.js <slug> --measure <outDir>   (score another run's flagged scenes the same way, e.g.
//                                                ../v7/out: writes <out>/before/<slug>.reasons.<run>.json)
//   node reasons.js <slug> --repick [--measure <outDir>]   (offline: re-pick from saved answers)
//
// Round-3 finding: 9/20 Up and 3/15 Iron Giant flagged scenes had no verified summary, and a flagged
// scene could show parents only an unrelated harmless sentence (Iron Giant S039, flagged for the
// military attack, kept only 'The Giant reunites with Hogarth...').
//
// Per flagged scene, one Jev request (jev-1.13.0): state {film:{title}, sentences: the scene's
// VERIFIED, judgement-free summary sentences (accept.js)}, one Noul per (flag reason k, sentence j):
// "Does sentences[j] say that <the reason's moment clause>?" (the clause moments.js searches for).
// Code picks the WHY:
//   1 the sentence with the highest p over the scene's reasons, when p >= reasons.min_p
//     -> { source: 'verified_sentence', text, states: reason id, p }
//   2 else a plain generated line naming the top one or two flag reasons (rankReasons: concrete events
//     by concern group before a general mood; parentPhrase), never an unrelated sentence
//     -> { source: 'generated', text: 'Heads-up: a loved one dies; a character dies.' }
// No request when the scene has no verified sentence (the fallback applies). Writes
// <out>/<slug>.reasons.<run>.json; select.js attaches `why` to each flagged scene.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { budget } from './budget.js';
import { key, outDir, heldOutGate } from './env.js';
import { record } from './ledger.js';
import { sizeRequest, runJobs, MAX_CONCURRENCY } from './jev-client.js';
import { ITEMS, MODEL, verifiedSentences } from './questions.js';
import { clauseFor } from './moments.js';
import { MORTAL_BY_REASON } from './mortal.js';

const here = path.dirname(fileURLToPath(import.meta.url));
export const REASONS_VERSION = 'reasons-v8.0';
const r3 = (x) => Math.round(x * 1000) / 1000;

// Plain phrases for the generated fallback ("Heads-up: <phrase>."). Every flag-capable universal id is
// listed (test/reasons.test.js checks policy.flag against this table); film-specific items build theirs
// from the item's name.
export const PARENT_PHRASE = {
  // strong events
  chased: 'a character is chased', attacked: 'a character is attacked', falls: 'a character falls from a dangerous height',
  nearly_falls: 'a character hangs over a dangerous drop', cannot_breathe: 'a character cannot breathe',
  caught_in_hazard: 'a character is caught in a dangerous place', vehicle_accident: 'a vehicle crashes',
  child_in_danger: 'a child is in danger', creature_threat: 'an animal or creature threatens someone',
  weapon_used: 'a weapon is used on someone', battle: 'a big fight breaks out', captured: 'a character is captured',
  swallowed: 'a character is swallowed', badly_hurt: 'a character is badly hurt', dies: 'a character dies',
  loved_one_dies: 'a loved one dies', pet_dies: 'a pet dies', believed_dead: 'someone is thought to have died',
  parent_death_learned: 'a child learns a parent has died', child_taken: 'a child is taken from their family',
  child_separated: 'a child is separated from their parent', caregiver_cruelty: 'a grown-up is cruel to a child',
  animal_cruelty: 'an animal is hurt on purpose', afraid_for_safety: 'characters are afraid for their safety',
  threatens_harm: 'a character threatens to hurt someone', plots_harm: 'a character plans to hurt someone',
  child_frightened: 'a child is frightened or crying',
  crying: 'a child cries', // v10.1 rule 2: flags only when a child is involved (select.js childInvolved)
  // presence, always
  skeleton_bones: 'skeletons or bones are shown', dead_body: 'a dead body is shown', blood_wound: 'blood or a wound is shown',
  dark_magic: 'dark magic is used', graveyard_funeral: 'a graveyard or funeral is shown',
  // presence with danger
  reanimated_dead: 'the dead come back to life', ghost_spirit: 'a ghost appears', scary_appearance: 'a frightening figure appears',
  fire: 'a dangerous fire', explosion: 'an explosion', storm: 'a dangerous storm', heights: 'danger at a great height',
  dangerous_machine: 'a dangerous machine', vehicle_crash: 'a vehicle crash', gun: 'a gun is used or pointed',
  blade_weapon: 'a blade is used as a weapon', restraints: 'a character is tied up', cage_net_trap: 'a character is caught in a cage, net or trap',
  needle_medical: 'a needle is used',
  // creature presence with a creature threat
  monster_creature: 'a monster threatens someone', shark: 'a shark threatens someone', large_predator: 'a large predator threatens someone',
  spider_insect: 'spiders or insects threaten someone', snake_reptile: 'a snake or reptile threatens someone',
  rodent_bat: 'rats or bats threaten someone', animal_creature: 'an animal threatens someone',
};

/** The parent phrase for one flag reason (film-specific items from their name / type). */
export function parentPhrase(reason, items = []) {
  const it = items.find((x) => x.id === reason.id);
  if (it) {
    if (it.type === 'threatens') return `${it.name} threatens, chases or attacks someone`;
    if (it.type === 'child_in_danger') return `${it.name} is in danger`;
    if (it.type === 'danger') return `${it.name} puts someone in danger`;
  }
  return PARENT_PHRASE[reason.id] ?? MORTAL_BY_REASON[reason.id]?.phrase ?? ITEMS[reason.id]?.moment ?? String(reason.label ?? reason.id).toLowerCase();
}

// Which reasons a generated line names first: concrete events before a general mood. Group order, then
// the 5-7 weight, then p; afraid_for_safety (a character's fear, the vaguest) always last.
export const GROUP_ORDER = ['death', 'violence', 'peril', 'captivity', 'injury', 'separation', 'hostility', 'animals', 'creatures_figures', 'objects_hazards', 'eerie', 'distress', 'copyable'];
const LAST = new Set(['afraid_for_safety']);

/** Flag reasons ranked for a generated line (most concrete and severe first). */
export function rankReasons(reasons, items = []) {
  const it = (r) => items.find((x) => x.id === r.id);
  const group = (r) => it(r)?.group ?? r.group ?? ITEMS[r.id]?.group ?? 'eerie';
  const w = (r) => it(r)?.weights?.['5-7'] ?? ITEMS[r.id]?.weights?.['5-7'] ?? MORTAL_BY_REASON[r.id]?.weights?.['5-7'] ?? 0;
  const g = (r) => (LAST.has(r.id) ? 99 : GROUP_ORDER.indexOf(group(r)) < 0 ? 50 : GROUP_ORDER.indexOf(group(r)));
  return [...reasons].sort((a, b) => g(a) - g(b) || w(b) - w(a) || (b.p ?? 0) - (a.p ?? 0));
}
export const topReason = (reasons, items = []) => rankReasons(reasons, items)[0] ?? null;

/** 'Heads-up: <phrase>.' naming the top reason, and a second one when it adds a different phrase. */
export const generatedWhy = (reasons, items = [], max = 2) => {
  const ranked = rankReasons(reasons, items);
  if (!ranked.length) return null;
  const phrases = [];
  const ids = [];
  for (const r of ranked) {
    // a leading article of a generated name reads as a common noun inside the line ('the military assault')
    const ph = parentPhrase(r, items).replace(/^(The|A|An) /, (m) => m.toLowerCase());
    if (phrases.includes(ph)) continue;
    phrases.push(ph); ids.push(r.id);
    if (phrases.length >= max) break;
  }
  return { source: 'generated', text: `Heads-up: ${phrases.join('; ')}.`, reasons: ids };
};

export const STATES_CRITERIA = (clause) => ({
  true: `The sentence says that ${clause}, in any words.`,
  false: 'The sentence does not say this happens: it is about something else, only hints at it, or has it only talked about.',
});

/** One request for a flagged scene: a Noul per (reason, sentence). null when there is no sentence. */
export function planReasons({ film, scene, sentences, reasons, items, cfg }) {
  const picked = reasons.slice(0, cfg.moments.max_reasons);
  if (!sentences.length || !picked.length) return null;
  const clauses = picked.map((r) => clauseFor(r, items));
  const questions = {};
  clauses.forEach((c, k) => sentences.forEach((_, j) => { questions[`r${k}.s${j}`] = { type: 'noul', instructions: `Does \`sentences[${j}]\` say that ${c}?`, criteria: STATES_CRITERIA(c) }; }));
  const body = { model: MODEL, state: { film: { title: film.title }, sentences }, questions };
  return { scene: scene.id, reasons: picked.map((r) => r.id), clauses, sentences, body, ...sizeRequest(body, `${scene.id}/reasons`, { reserveXEst: 3.0 }) };
}

/** The why from a request's answers (or the fallback). */
export function pickWhy(plan, answers, { reasons, items, cfg }) {
  const minP = cfg.reasons.min_p;
  let best = null;
  const matrix = [];
  if (plan && answers) {
    plan.reasons.forEach((id, k) => plan.sentences.forEach((text, j) => {
      const p = Number(answers[`r${k}.s${j}`]?.noul) || 0;
      matrix.push({ reason: id, sentence: j, p: r3(p) });
      if (!best || p > best.p) best = { reason: id, sentence: j, p };
    }));
  }
  if (best && best.p >= minP) return { why: { source: 'verified_sentence', text: plan.sentences[best.sentence], states: best.reason, p: r3(best.p), sentence: best.sentence }, matrix };
  return { why: generatedWhy(reasons, items), matrix, ...(best ? { best_p: r3(best.p) } : {}) };
}

// ---- CLI -------------------------------------------------------------------------------------------------
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2);
  const slug = argv.find((a) => !a.startsWith('--') && !['--run', '--cap', '--measure'].includes(argv[argv.indexOf(a) - 1]));
  const opt = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
  if (!slug) { console.error('usage: node reasons.js <slug> [--run r1] [--cap 0.01] [--dry] [--measure <outDir>]'); process.exit(2); }
  heldOutGate(slug);
  const cfg = JSON.parse(fs.readFileSync(path.join(here, 'policy.json'), 'utf8'));
  const runId = opt('run', 'r1');
  const measure = opt('measure', null);
  const IN = measure ? path.resolve(here, measure) : outDir();
  const tags = JSON.parse(fs.readFileSync(path.join(IN, `${slug}.tags.${runId}.json`), 'utf8'));
  const seg = JSON.parse(fs.readFileSync(path.join(IN, `${slug}.segments.json`), 'utf8'));
  // the run's full film items (with their moment clauses; the tags file keeps a short form)
  const items = JSON.parse(fs.readFileSync(path.join(IN, `${slug}.jev.${runId}.json`), 'utf8')).film_items ?? [];
  const flagged = tags.scenes.filter((s) => s.flagged);
  const plans = flagged.map((s) => {
    const sentences = verifiedSentences(seg.scenes.find((x) => x.id === s.id));
    return { s, sentences, plan: planReasons({ film: seg.film, scene: s, sentences, reasons: s.flag_reasons, items, cfg }) };
  });
  if (argv.includes('--repick')) {
    // offline: re-pick every why from the SAVED answers (matrix) under the current policy; no calls
    const dir = measure ? path.join(outDir(), 'before') : outDir();
    const file = path.join(dir, `${slug}.reasons.${runId}.json`);
    const prev = JSON.parse(fs.readFileSync(file, 'utf8'));
    for (const { s, sentences, plan } of plans) {
      const old = prev.scenes[s.id];
      if (!old) throw new Error(`--repick: ${s.id} has no saved answers`);
      const answers = plan ? Object.fromEntries((old.matrix ?? []).map((m) => [`r${plan.reasons.indexOf(m.reason)}.s${m.sentence}`, { noul: m.p }])) : null;
      if (plan && (old.matrix ?? []).some((m) => plan.reasons.indexOf(m.reason) < 0 || m.sentence >= sentences.length)) throw new Error(`--repick: ${s.id} saved answers do not match the current reasons / sentences`);
      prev.scenes[s.id] = { ...old, ...pickWhy(plan, answers, { reasons: s.flag_reasons, items, cfg }) };
      if (!prev.scenes[s.id].best_p) delete prev.scenes[s.id].best_p;
    }
    const n = Object.values(prev.scenes);
    Object.assign(prev, { policy: cfg.reasons, repicked_at: new Date().toISOString(), why_from_sentence: n.filter((x) => x.why?.source === 'verified_sentence').length, why_generated: n.filter((x) => x.why?.source === 'generated').length });
    fs.writeFileSync(file, JSON.stringify(prev, null, 2));
    console.log(`${slug}${measure ? ' (before)' : ''}: repicked at min_p ${cfg.reasons.min_p}: from a sentence ${prev.why_from_sentence}/${n.length}, generated ${prev.why_generated}`);
    process.exit(0);
  }
  const jobs = plans.filter((p) => p.plan).map((p) => ({ body: p.plan.body, est: p.plan.est, reserveUsd: p.plan.reserveUsd, meta: { id: p.s.id, label: `${p.s.id}/reasons` } }));
  console.log(`${slug}${measure ? ` (measure ${measure})` : ''}: ${flagged.length} flagged scenes, ${jobs.length} with verified sentences (requests), reserve $${jobs.reduce((a, j) => a + j.reserveUsd, 0).toFixed(5)}`);
  if (argv.includes('--dry')) process.exit(0);
  const wallet = budget(Number(opt('cap', '0.01')));
  const { results, stopped } = jobs.length ? await runJobs(jobs, { key: key('TYPESAFE_API_KEY'), budget: wallet, concurrency: MAX_CONCURRENCY }) : { results: [], stopped: null };
  if (wallet.spent > 0) record(slug, { script: measure ? 'reasons.js --measure' : 'reasons.js', kind: 'jev', usd: wallet.spent, note: `${REASONS_VERSION} ${jobs.length} requests${measure ? ` on ${measure}` : ''}` });
  const failed = results.filter((r) => !r.ok);
  if (failed.length) { console.error(`Jev: ${failed.length} failed (${failed[0].skipped ?? failed[0].error})${stopped ? `; ${stopped.reason}` : ''}`); process.exit(5); }
  const byId = new Map(results.map((r) => [r.meta.id, r]));
  const scenes = {};
  for (const { s, sentences, plan } of plans) {
    const res = byId.get(s.id);
    const w = pickWhy(plan, res?.json?.answers ?? null, { reasons: s.flag_reasons, items, cfg });
    scenes[s.id] = { reasons: s.flag_reasons.map((r) => r.id), sentences: sentences.length, ...w, ...(res ? { request: { input_tokens: res.record.input_tokens, cost_usd: res.record.cost_usd } } : {}) };
  }
  const n = Object.values(scenes);
  const out = { film: seg.film, version: REASONS_VERSION, run: runId, model: MODEL, policy: cfg.reasons, measured_on: measure ?? null, run_at: new Date().toISOString(), requests: results.length, cost_usd: +wallet.spent.toFixed(6), flagged: n.length, why_from_sentence: n.filter((x) => x.why?.source === 'verified_sentence').length, why_generated: n.filter((x) => x.why?.source === 'generated').length, no_sentence: n.filter((x) => !x.sentences).length, scenes };
  const dir = measure ? path.join(outDir(), 'before') : outDir();
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${slug}.reasons.${runId}.json`), JSON.stringify(out, null, 2));
  console.log(`  why from a verified sentence ${out.why_from_sentence}/${out.flagged}, generated ${out.why_generated} (${out.no_sentence} with no verified sentence), $${out.cost_usd}`);
}
