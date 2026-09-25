// v10.3 fix (e): the 8-word quotation rule counts hyphenated words as their parts and checks both spellings.
import test from 'node:test';
import assert from 'node:assert/strict';
import { transcriptGrams, enforceQuoteRule, longestQuoteRun, quoteWords } from '../validate.js';

test('round-8 bug: a hyphenated word counts as two words (9 shared words is a violation)', () => {
  const grams = transcriptGrams(['Reports of a high-speed pursuit between police and armed gunmen, heading south.'], 9);
  const t = 'A high-speed pursuit between police and armed gunmen breaks out downtown.';
  assert.equal(longestQuoteRun(t, grams), 9); // high speed pursuit between police and armed gunmen
  const q = enforceQuoteRule(t, grams);
  assert.equal(q.violations.length, 1);
  assert.equal(q.violations[0].words, 9);
  assert.ok(!q.text.includes('gunmen'));
});
test('hyphen on one side only still matches (split spelling)', () => {
  const grams = transcriptGrams(['a high speed pursuit between police and armed gunmen'], 9);
  assert.equal(enforceQuoteRule('Then a high-speed pursuit between police and armed gunmen ends.', grams).violations.length, 1);
  const g2 = transcriptGrams(['the high-speed pursuit between police and armed gunmen'], 9);
  assert.equal(enforceQuoteRule('Then the high speed pursuit between police and armed gunmen ends.', g2).violations.length, 1);
});
test('joined spelling: "highspeed" in the text vs "high-speed" in the cue', () => {
  const grams = transcriptGrams(['one two three highspeed four five six seven eight nine'], 9);
  assert.equal(enforceQuoteRule('one two three high-speed four five six seven eight', grams).violations.length, 1);
});
test('em dash between words splits them', () => {
  assert.deepEqual(quoteWords('stop—there is').words.map((x) => x.w), ['stop', 'there', 'is']);
  const grams = transcriptGrams(['no stop there is a bomb on the train now'], 9);
  assert.equal(enforceQuoteRule('He yells no—stop there is a bomb on the train', grams).violations.length, 1);
});
test('8 shared words (hyphen split) still pass', () => {
  const grams = transcriptGrams(['high-speed pursuit between police and armed men'], 9);
  assert.equal(longestQuoteRun('A high-speed pursuit between police and armed men', grams), 0);
  assert.equal(enforceQuoteRule('A high-speed pursuit between police and armed men', grams).violations.length, 0);
});
test('dialogue dashes and sound captions do not create words', () => {
  assert.deepEqual(quoteWords('- Hey! - (GASPS) Wait').words.map((x) => x.w), ['hey', 'gasps', 'wait']);
});
