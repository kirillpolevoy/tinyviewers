// node --test test/  -- v10: the Jev set (jev-set.js), its lint, its combine rules and the split.
//   * every Jev question v10 asks is ONE question with ONE condition, explicit YES and NO criteria, no
//     presupposition / degree / indirection (lint.js), and names no seen-film entity;
//   * every question is the exact wording that was measured (tournament pool, v9 builder) or the declared
//     lint-fix of one (assemble/fixrun/fixes.mjs), never an untracked edit;
//   * bundles combine as stated (combine.js semantics; the dies / threat / jump-scare / film bundles);
//   * the split: every v9 id has exactly one owner, Sonnet is asked exactly its ids, and select.js reads a
//     Jev id from the combined answer at its own threshold and a Sonnet id from Sonnet.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { lintNoul, DENY } from '../lint.js';
import { evalExpr, keysOf, show } from '../combine.js';
import {
  JEV_QUESTIONS, JEV_CONCEPTS, JEV_THRESHOLDS, JEV_TARGET_IDS, TEMPLATE_TYPE, jevQuestions, conceptAnswers, instantiateTemplate, statesFor, filmItems,
  buildQuestions, PRESENCE, EVENTS, DERIVED, KIND, MODIFIERS, SCORES, ITEMS,
} from '../questions.js';
import { loadSplit } from '../split.js';
import { SONNET_OWNED_IDS, questionBlock } from '../sonnet-questions.js';
import { selectScene, withJevThresholds, withConcepts, loadPolicy } from '../select.js';
import { mergeAnswers } from '../merge.js';
import { buildFixes } from '../../v10/assemble/fixrun/fixes.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const V10 = path.resolve(here, '..');
const TS = path.resolve(V10, '..');
const SLOTS = ['<name>', '<danger>', '<villain>', '<child>', '{NAME}', '{DANGER}'];
const FILMS = ['nemo', 'monsters-inc', 'lion-king', 'frankenweenie', 'wild-robot', 'iron-giant', 'up', 'tangled', 'coco', 'how-to-train-your-dragon', 'book-of-life', 'princess-and-the-frog', 'moana'];
const POOL_FILE = path.join(TS, 'v10', 'jevfirst', 'tournament', 'pool.json');
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const mentions = (hay, w) => new RegExp(`(^|[^a-zà-ÿ])${esc(w)}([^a-zà-ÿ]|$)`, 'i').test(hay);

// ---- lint ---------------------------------------------------------------------------------------------
test('lint.js: catches each rule it claims to', () => {
  const ok = { instructions: 'Does a character in `scene.lines` say that someone has died?', criteria: { true: 'A line says a character of the story has just died.', false: 'A joke, a song, or a death long ago is a no.' } };
  assert.deepEqual(lintNoul(ok), []);
  assert.ok(lintNoul({ ...ok, criteria: { false: 'x' } }).includes('yes_criteria'));
  assert.ok(lintNoul({ ...ok, criteria: { true: 'x' } }).includes('no_criteria'));
  assert.ok(lintNoul({ ...ok, instructions: 'Is a character hit? Is it bad?' }).includes('one_question'));
  assert.ok(lintNoul({ ...ok, instructions: 'Does a blow land on a character, followed by a cry of pain?' }).includes('one_condition'));
  assert.ok(lintNoul({ ...ok, instructions: 'Does a character shout while someone hangs over a drop?' }).includes('one_condition'));
  assert.ok(lintNoul({ ...ok, instructions: 'Is a character chased and does the chaser catch them?' }).includes('one_condition'));
  assert.ok(lintNoul({ ...ok, instructions: 'Do the two arguing characters have a child?' }).includes('no_presupposition'));
  assert.ok(lintNoul({ ...ok, instructions: 'Is a character badly hurt?' }).includes('no_degree'));
  assert.ok(lintNoul({ ...ok, instructions: 'Would a young viewer find this scene scary?' }).includes('no_indirection'));
  assert.ok(lintNoul({ ...ok, criteria: { ...ok.criteria, true: '"Nemo! Nemo!"' } }).some((f) => f.startsWith('no_entity')));
  // a list of synonyms joined by "or" is one condition
  assert.deepEqual(lintNoul({ ...ok, instructions: 'Does `scene.summary` say that a character is chased, pursued, hunted, or flees from someone?' }), []);
});

test('every Jev question v10 asks passes the lint: one question, one condition, explicit yes and no criteria, no presupposition / degree / indirection / seen-film entity', () => {
  const bad = Object.entries(JEV_QUESTIONS).map(([k, d]) => [k, lintNoul(d.q, { slots: SLOTS })]).filter(([, f]) => f.length);
  assert.deepEqual(bad, []);
});

test('film templates: instantiation only fills the slots (question: name + verified aliases; criteria: the name), once per generated item of the right type, for the 13 seen films', () => {
  let n = 0;
  for (const slug of FILMS) {
    const seg = JSON.parse(fs.readFileSync(path.join(TS, 'v9', 'out', `${slug}.segments.json`), 'utf8'));
    const items = filmItems(seg);
    for (const x of jevQuestions(seg, items).filter((q) => q.item)) {
      const it = items.find((i) => i.id === x.item);
      const tk = x.key.replace(x.item, '{item}');
      assert.equal(TEMPLATE_TYPE[tk], it.type, `${slug} ${x.key}`);
      const tmpl = JEV_QUESTIONS[tk].q;
      const neutral = instantiateTemplate(tmpl, { ...it, name: 'Pat', entity: null }, { cast: [] });
      assert.deepEqual(lintNoul(neutral), [], `${slug} ${x.key}`);
      assert.ok(x.q.instructions.includes(it.name) && !/<name>|<danger>|\{NAME\}/.test(JSON.stringify(x.q)), `${slug} ${x.key}`);
      n += 1;
    }
  }
  assert.ok(n > 0);
});

test('no seen-film entity in any universal v10 string (Jev set, Sonnet block, labels, moments, Scores, kind, modifiers)', () => {
  const universal = JSON.stringify({
    jev: Object.fromEntries(Object.entries(JEV_QUESTIONS).map(([k, d]) => [k, d.q])),
    sonnet: questionBlock(SONNET_OWNED_IDS), DERIVED, KIND, MODIFIERS, SCORES,
    moments: Object.values(ITEMS).map((i) => i.moment),
  }).toLowerCase();
  let hay = universal;
  for (const s of SLOTS) hay = hay.split(s.toLowerCase()).join(' ');
  assert.deepEqual(DENY.filter((w) => mentions(hay, w)), []);
});

// ---- measured wording --------------------------------------------------------------------------------
test('every Jev question is the measured wording, or the declared lint-fix of a measured wording', () => {
  const { pool } = JSON.parse(fs.readFileSync(POOL_FILE, 'utf8'));
  const byKey = new Map(pool.map((x) => [`${x.src}:${x.sub}${x.film ? '#{item}' : ''}@${x.state}`, x]));
  const v9 = buildQuestions({ channels: ['pl', 'ps', 'e'] });
  const fixes = new Map(buildFixes().map((f) => [f.key, f]));
  for (const [k, d] of Object.entries(JEV_QUESTIONS)) {
    if (d.fix_of) {
      const f = fixes.get(k);
      assert.ok(f, `${k}: no declared fix`);
      assert.equal(f.fixes, d.fix_of);
      assert.deepEqual(d.q, { type: 'noul', ...f.q, type: 'noul' }, `${k}: differs from fixes.mjs`);
      assert.equal(f.state, d.state);
      const orig = d.fix_of.startsWith('V:') ? v9[d.fix_of.slice(2, d.fix_of.lastIndexOf('@'))] : byKey.get(d.fix_of)?.q;
      assert.ok(orig, `${k}: fixed from an unknown wording ${d.fix_of}`);
      assert.equal(d.q.instructions, orig.instructions.replace('sorcerer, voodoo practitioner, or other magic user?', 'sorcerer, or other magic user?'), `${k}: the lint fix changed the question text`);
      continue;
    }
    if (k.startsWith('V:')) {
      const v = v9[k.slice(2, k.lastIndexOf('@'))];
      assert.ok(v, `${k}: not a v9 question`);
      assert.deepEqual({ i: d.q.instructions, t: d.q.criteria.true, f: d.q.criteria.false }, { i: v.instructions, t: v.criteria?.true, f: v.criteria?.false }, `${k}: not v9's wording`);
      assert.equal(d.state, k.endsWith('@L') ? 'L' : 'V9C');
      continue;
    }
    const x = byKey.get(k);
    assert.ok(x, `${k}: not a tournament phrasing`);
    assert.deepEqual({ i: d.q.instructions, t: d.q.criteria.true, f: d.q.criteria.false }, { i: x.q.instructions, t: x.q.criteria.true, f: x.q.criteria.false }, `${k}: not the tournament wording`);
    assert.equal(d.state, x.state);
  }
});

// ---- combine ----------------------------------------------------------------------------------------
test('combine.js: OR = max, AND = min, gates, Score gates, film items, folded subs, unasked = 0', () => {
  const a = { x: 0.9, y: 0.3, 'f#C01@L': 0.8, 'f#C02@L': 0.2 };
  assert.equal(evalExpr({ max: [{ q: 'x' }, { q: 'y' }] }, { a }), 0.9);
  assert.equal(evalExpr({ min: [{ q: 'x' }, { q: 'y' }] }, { a }), 0.3);
  assert.equal(evalExpr({ q: 'missing' }, { a }), 0);
  assert.equal(evalExpr({ gate: { q: 'y' }, at: 0.4, then: { q: 'x' } }, { a }), 0);
  assert.equal(evalExpr({ gate: { q: 'x' }, at: 0.4, then: { q: 'y' } }, { a }), 0.3);
  assert.equal(evalExpr({ score: 'danger', at: 2, then: { q: 'x' } }, { a, scores: { danger: 1.9 } }), 0);
  assert.equal(evalExpr({ score: 'danger', at: 2, then: { q: 'x' } }, { a, scores: { danger: 2.1 } }), 0.9);
  assert.equal(evalExpr({ min: [{ one: 1 }, { q: 'y' }] }, { a }), 0.3);
  const items = [{ id: 'C01', type: 'danger', group: 'creatures_figures' }, { id: 'C02', type: 'danger', group: 'peril' }];
  assert.equal(evalExpr({ each: { type: 'danger' }, of: { q: 'f#{item}@L' } }, { a, items }), 0.8);
  assert.equal(evalExpr({ each: { type: 'danger', group: 'peril' }, of: { q: 'f#{item}@L' } }, { a, items }), 0.2);
  assert.throws(() => evalExpr({ q: 'f#{item}@L' }, { a }), /needs a film item/);
  assert.equal(show({ max: [{ q: 'x' }, { gate: { q: 'y' }, at: 0.4, then: { q: 'z' } }] }), 'max(x, (z if y >= 0.4))');
});

const target = (concept, id) => JEV_CONCEPTS[concept].targets.find((t) => (t.id ?? t.type) === id);
// Since the measured lint-fix run (2026-09-25) decide.mjs picks C:dies.b@S alone for dies (the bundle with the
// measured C+:dies.a fell to 17/25 = 68% < the 70% tier-A bar); the bundle semantics are tested only while the
// bundle is the pick. The pick itself is checked against decisions.json by the test below.
const diesIsBundle = [...keysOf(JEV_CONCEPTS.dies.targets[0].expr)].length > 1;
test('bundles combine as stated: dies = max(death lines, death summary, dead body) with "stops breathing" counted only next to death evidence >= 0.4', { skip: !diesIsBundle && 'dies pick is a single phrasing, not the bundle (assemble/decisions.json)' }, () => {
  const t = target('dies', 'dies');
  const keys = [...keysOf(t.expr)];
  const k = (re) => keys.find((x) => re.test(x));
  const [lines, summ, body, gate, ill] = [k(/dies\.a@/), k(/dies\.b@/), k(/dead_body\.a@/), k(/dies\.c@/), k(/seriously_ill\.a@/)];
  assert.ok(lines && summ && body && gate && ill, keys.join(','));
  const p = (a) => conceptAnswers({ q: a }).c.dies;
  assert.equal(p({ [gate]: 0.95 }), 0, 'c alone does not count');
  assert.equal(p({ [gate]: 0.95, [ill]: 0.5 }), 0.95, 'c counts next to illness >= 0.4');
  assert.equal(p({ [gate]: 0.95, [lines]: 0.3 }), 0.3, 'c does not count below 0.4');
  assert.equal(p({ [summ]: 0.8, [lines]: 0.1 }), 0.8);
  assert.equal(p({ [body]: 0.72 }), 0.72);
  assert.equal(t.act, JEV_THRESHOLDS['c.dies']);
});

test('bundles combine as stated: the threat bundle is the OR of its three single-condition Nouls; jump_scare is the AND of its two halves; film concepts are per item', () => {
  const th = target('threatens_harm', 'threatens_harm');
  const tk = [...keysOf(th.expr)];
  assert.ok(tk.length >= 3);
  const one = conceptAnswers({ q: { [tk[0]]: 0.9 } }).c.threatens_harm;
  assert.equal(one, 0.9, 'any one sub fires the bundle (OR)');
  assert.equal(conceptAnswers({ q: Object.fromEntries(tk.map((k) => [k, 0.2])) }).c.threatens_harm, 0.2);
  const js = target('appears_suddenly', 'jump_scare');
  const jk = [...keysOf(js.expr)];
  assert.equal(jk.length, 2);
  assert.equal(conceptAnswers({ q: { [jk[0]]: 0.9, [jk[1]]: 0.3 } }).d.jump_scare, 0.3, 'AND = min');
  const fk = Object.keys(TEMPLATE_TYPE).find((k) => TEMPLATE_TYPE[k] === 'child_in_danger');
  const items = [{ id: 'C05_in_danger', type: 'child_in_danger', group: 'peril' }, { id: 'C06_in_danger', type: 'child_in_danger', group: 'peril' }];
  const cf = conceptAnswers({ q: { [fk.replace('{item}', 'C05_in_danger')]: 0.85 } }, items).cf;
  assert.deepEqual(cf, { C05_in_danger: 0.85, C06_in_danger: 0 });
});

test('every concept expression and threshold equals the decision it was built from (assemble/decisions.json)', () => {
  const D = JSON.parse(fs.readFileSync(path.join(TS, 'v10', 'assemble', 'decisions.json'), 'utf8'));
  for (const d of D.decisions) {
    const c = JEV_CONCEPTS[d.concept];
    assert.equal(c.owner, d.owner, d.concept);
    if (d.owner !== 'jev') continue;
    const main = c.targets.find((t) => t.layer === 'film' || t.layer === 'derived' || t.id === d.v9_ids[0]);
    assert.deepEqual(main.expr, d.jev.expr, d.concept);
    assert.equal(main.act, d.jev.t, d.concept);
  }
});

// ---- split ------------------------------------------------------------------------------------------
test('split: every v9 id has exactly one owner; Sonnet is asked exactly its ids; no id is both a Jev target and a Sonnet id', () => {
  const s = loadSplit();
  const universal = [...PRESENCE.map((p) => p.id), ...EVENTS.map((e) => e.id)];
  for (const id of universal) assert.ok(['jev', 'sonnet'].includes(s.assign[id]), id);
  assert.deepEqual([...s.sonnet_asked].sort(), [...SONNET_OWNED_IDS].sort());
  assert.deepEqual([...s.sonnet_used].sort(), [...SONNET_OWNED_IDS].sort());
  assert.deepEqual(s.shadow, []);
  const jevT = new Set(JEV_TARGET_IDS);
  for (const id of SONNET_OWNED_IDS) assert.equal(jevT.has(id), false, id);
  for (const id of universal) assert.equal(s.assign[id] === 'jev', jevT.has(id), id);
  // Jev owns most of it (the brief: rely on Jev more)
  assert.ok(JEV_TARGET_IDS.length > SONNET_OWNED_IDS.length * 4);
  for (const [k, c] of Object.entries(s.concepts)) assert.ok(c.evidence?.tier, `${k}: no evidence`);
});

test('select (v10): a Jev id tags from its combined answer at its own threshold; a Sonnet id from Sonnet; both flag under the v9 policy', () => {
  const cfg = withJevThresholds(loadPolicy());
  const ch = target('caught_in_hazard', 'caught_in_hazard');
  const key = [...keysOf(ch.expr)][0];
  const at = ch.act;
  const base = { s: { danger: { score: 3, top: 4, probabilities: { 3: 1 } }, laughs: { score: 0, top: 3 } }, mod: { retold: 0, imagined: 0 }, m: {} };
  const hi = selectScene(withConcepts({ ...base, q: { [key]: at } }), cfg);
  assert.ok(hi.flag_reasons.some((r) => r.id === 'caught_in_hazard'), 'at the concept threshold: act, flags');
  const lo = selectScene(withConcepts({ ...base, q: { [key]: at - 0.01 } }), cfg);
  assert.ok(!lo.flag_reasons.some((r) => r.id === 'caught_in_hazard'), 'just below: no flag');
  // Sonnet id through merge.js, next to the Jev answers
  const merged = mergeAnswers(withConcepts({ ...base, q: {} }), { weapon_used: { a: 'yes', c: 'high', p: 0.95 } }, ['weapon_used']);
  const r = selectScene(merged, cfg);
  assert.ok(r.flag_reasons.some((x) => x.id === 'weapon_used'));
  assert.equal(merged.c.weapon_used, undefined, 'Jev never answers a Sonnet id');
});

test('statesFor: the minimal states the tournament used (lines only has no summary or cast; S is null without a verified summary)', () => {
  const seg = JSON.parse(fs.readFileSync(path.join(TS, 'v9', 'out', 'nemo.segments.json'), 'utf8'));
  const cues = [{ index: 1, text: 'Hello.' }, { index: 2, text: '♪ la la ♪' }, { index: 3, text: 'Look out!' }];
  const scene = { ...seg.scenes[0], sentences: [] };
  const { states, summaryEmpty } = statesFor({ seg, scene, cues });
  assert.equal(summaryEmpty, true);
  assert.equal(states.S, null);
  assert.deepEqual(Object.keys(states.L.scene), ['lines']);
  assert.equal(states.Lnl.scene.lines.length, 2, 'the lyric line is removed');
  assert.ok(Array.isArray(states.LSnlC.children));
  assert.ok('cast' in states.V9C);
});
