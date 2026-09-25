// node --test validate.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { repairCoverage, assertCoverage, clampWords, transcriptGrams, enforceQuoteRule, judgementWords } from './validate.js';

test('clean coverage needs no repair', () => {
  const { scenes, repairs } = repairCoverage([{ start_cue: 1, end_cue: 3 }, { start_cue: 4, end_cue: 10 }], 10);
  assert.equal(repairs.length, 0);
  assertCoverage(scenes, 10);
});

test('gaps, overlaps, nesting, invalid, head and tail are repaired and reported', () => {
  const input = [
    { start_cue: 3, end_cue: 5, t: 'a' },   // head gap 1-2
    { start_cue: 8, end_cue: 12, t: 'b' },  // gap 6-7
    { start_cue: 10, end_cue: 15, t: 'c' }, // overlap 10-12
    { start_cue: 13, end_cue: 14, t: 'd' }, // nested in c
    { start_cue: 20, end_cue: 18, t: 'e' }, // invalid
    { start_cue: 16, end_cue: 19, t: 'f' }, // tail 20
  ];
  const { scenes, repairs } = repairCoverage(input, 20);
  assertCoverage(scenes, 20);
  assert.deepEqual(scenes.map((s) => [s.t, s.start_cue, s.end_cue]), [['a', 1, 7], ['b', 8, 12], ['c', 13, 15], ['f', 16, 20]]);
  assert.deepEqual(repairs.map((r) => r.kind).sort(), ['dropped_invalid', 'dropped_nested', 'gap_filled', 'head_extended', 'overlap_trimmed', 'tail_extended']);
});

test('clampWords prefers a sentence end', () => {
  const t = 'One two three four five. Six seven eight nine ten eleven twelve.';
  assert.deepEqual(clampWords(t, 8), { text: 'One two three four five.', trimmed: true });
  assert.equal(clampWords('a b c', 5).trimmed, false);
});

test('quote rule: 9+ shared words are shortened, 8 are allowed', () => {
  const grams = transcriptGrams(['(GASPS) I promise I will never let anything', 'happen to you, Nemo.'], 9);
  const ok = enforceQuoteRule('He says I promise I will never let anything bad', grams);
  assert.equal(ok.violations.length, 0); // 7 shared words then diverges
  const bad = enforceQuoteRule('Marlin swears: "I promise I will never let anything happen to you, Nemo."', grams);
  assert.equal(bad.violations.length, 1);
  assert.equal(bad.violations[0].words, 11);
  assert.equal(bad.text, 'Marlin swears: "I promise I will never…');
});

test('judgement words are detected, character reactions are not', () => {
  assert.deepEqual(judgementWords('A scary shark; Marlin is scared.'), ['scary']);
});
