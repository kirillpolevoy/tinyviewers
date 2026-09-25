// v9: the question split, Sonnet's typed answers, the merge, and the parent-text rebuild. Pure code.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadSplit } from '../split.js';
import { PRESENCE, EVENTS, buildQuestions } from '../questions.js';
import { probOf, parseAnswers, questionDef, questionBlock, schemaFor, P_UNLISTED } from '../sonnet-questions.js';
import { mergeAnswers } from '../merge.js';
import { buildWhy, plainReason } from '../check-describe.js';
import { validateScene } from '../describe.js';
import { transcriptGrams } from '../validate.js';
import { worse } from '../split/decide.mjs';

test('split.json: every universal question is assigned; Sonnet-used questions are asked; Jev is not asked them', () => {
  const s = loadSplit();
  const all = [...PRESENCE.map((p) => p.id), ...EVENTS.map((e) => e.id)];
  assert.equal(Object.keys(s.assign).length, all.length);
  for (const q of s.sonnet_used) assert.ok(s.sonnet_asked.includes(q));
  const jevQ = buildQuestions({ presenceIds: s.jev_presence, eventIds: s.jev_events });
  for (const q of s.sonnet_used) {
    assert.equal(jevQ[`e.${q}`], undefined);
    assert.equal(jevQ[`pl.${q}`], undefined);
    assert.equal(jevQ[`ps.${q}`], undefined);
  }
  // mention questions are not part of the split
  for (const p of PRESENCE.filter((x) => x.mention)) assert.ok(jevQ[`m.${p.id}`]);
});

test('Sonnet answers map onto the policy thresholds: yes high/medium act, yes low possible, no below possible', () => {
  assert.equal(probOf({ a: 'yes', c: 'high' }) >= 0.7, true);
  assert.equal(probOf({ a: 'yes', c: 'medium' }) >= 0.7, true);
  const low = probOf({ a: 'yes', c: 'low' }); assert.ok(low >= 0.4 && low < 0.7);
  assert.ok(probOf({ a: 'no', c: 'low' }) < 0.4);
  assert.equal(probOf(undefined), P_UNLISTED);
});

test('parseAnswers: unknown ids ignored, duplicate question keeps the higher p, missing scenes reported', () => {
  const r = parseAnswers({ scenes: [{ id: 'S1', answers: [{ q: 'dies', a: 'no', c: 'low' }, { q: 'dies', a: 'yes', c: 'medium' }, { q: 'bogus', a: 'yes', c: 'high' }] }, { id: 'S9', answers: [] }] }, ['S1', 'S2'], ['dies', 'crying']);
  assert.equal(r.answers.S1.dies.p, 0.8);
  assert.deepEqual(r.missing, ['S2']);
  assert.equal(r.problems.length, 2);
});

test("question wording is Jev's, the retelling rule is stated once, and the schema is strict", () => {
  const d = questionDef('dies');
  assert.match(d.text, /does a character die or get killed/);
  assert.equal(d.retold, true);
  assert.match(questionBlock(['dies', 'crying']), /\[R\] on a question means/);
  const sch = schemaFor(['S1'], ['dies']);
  assert.equal(sch.properties.scenes.items.properties.answers.items.additionalProperties, false);
});

test("mergeAnswers puts Sonnet's p on events and on both presence channels; a missing scene is marked", () => {
  const jev = { pl: { gun: 0.1 }, ps: { gun: 0.2 }, e: { chased: 0.9 } };
  const m = mergeAnswers(jev, { dies: { a: 'yes', c: 'high', p: 0.95 }, storm: { a: 'yes', c: 'medium', p: 0.8 } }, ['dies', 'storm', 'crying']);
  assert.equal(m.e.dies, 0.95); assert.equal(m.e.crying, P_UNLISTED); assert.equal(m.pl.storm, 0.8); assert.equal(m.ps.storm, 0.8); assert.equal(m.e.chased, 0.9);
  assert.equal(m.by.dies, 'sonnet');
  const miss = mergeAnswers(jev, null, ['dies']);
  assert.equal(miss.sonnet_missing, true); assert.equal(miss.e.dies, undefined);
});

test('buildWhy: verified + states -> described; verified, none states -> + plain reason; none verified -> plain', () => {
  const reasons = [{ id: 'dies', group: 'death', p: 0.9 }];
  const s = [{ key: 'S1.d1', text: 'Hector dies.', final: 'verified' }, { key: 'S1.d2', text: 'Made up.', final: 'unverified' }];
  const a = buildWhy({ title: { text: 'Hector dies', final: 'verified' }, sentences: s, states: [{ reason: 'dies', sentence: 'S1.d1', p: 0.9 }], reasons, items: [], minP: 0.6 });
  assert.equal(a.source, 'described'); assert.equal(a.text, 'Hector dies.'); assert.equal(a.title, 'Hector dies');
  const b = buildWhy({ title: null, sentences: s, states: [{ reason: 'dies', sentence: 'S1.d1', p: 0.2 }], reasons, items: [], minP: 0.6 });
  assert.equal(b.source, 'described+reason'); assert.ok(b.text.endsWith(plainReason(reasons, [])));
  const c = buildWhy({ title: null, sentences: [s[1]], states: [], reasons, items: [], minP: 0.6 });
  assert.equal(c.source, 'plain_reason'); assert.equal(c.text, 'Flagged because a character dies.');
});

test('describe validateScene: cites outside the scene are dropped, uncited and judgement sentences rejected', () => {
  const ctx = { lines: [{ id: 'L5' }, { id: 'L6' }], w: [{ id: 'W2' }], t: [] };
  const grams = transcriptGrams(['hello there'], 9);
  const v = validateScene({ title: 'A fall', title_cites: ['L5'], sentences: [{ text: 'Ana falls.', cites: ['L5', 'L99'] }, { text: 'A scary moment.', cites: ['L6'] }, { text: 'No cites.', cites: ['W9'] }] }, ctx, grams);
  assert.equal(v.sentences.length, 1); assert.deepEqual(v.sentences[0].cites, ['L5']);
  assert.equal(v.rejected.length, 2);
  assert.equal(v.title.text, 'A fall');
});

test('split rule: one-count tolerance', () => {
  assert.deepEqual(worse({ caught: 13, hits: 5, fires: 8 }, { caught: 10, hits: 4, fires: 6 }), { recall: false, precision: false });
  assert.deepEqual(worse({ caught: 13, hits: 5, fires: 8 }, { caught: 21, hits: 7, fires: 7 }), { recall: true, precision: true });
  assert.deepEqual(worse({ caught: 0, hits: 0, fires: 0 }, { caught: 1, hits: 1, fires: 1 }), { recall: false, precision: false });
});
