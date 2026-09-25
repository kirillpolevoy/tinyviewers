// Regression tests for bugs fixed in the run+compare phase.
import test from 'node:test';
import assert from 'node:assert/strict';
import { contextState, verifiedSetting, verifiedSentences } from '../questions.js';

const ok = { verdict: 'supports', confidence: 0.9, status: 'verified' };
const seg = { film: { title: 'A Film', year: 2000 }, cast: [], dangers: [] };
const cues = [{ index: 10, text: 'Hello.' }];

test('unverified setting never reaches the context state', () => {
  const scene = { id: 'S001', setting: 'a cave', setting_cites: ['L10'], setting_check: { verdict: 'says_nothing', confidence: 0.9, status: 'unverified' }, sentences: [] };
  assert.equal(verifiedSetting(scene), 'unknown');
  assert.equal(contextState({ seg, scene, cues }).state.scene.setting, 'unknown');
  const good = { ...scene, setting_check: ok };
  assert.equal(contextState({ seg, scene: good, cues }).state.scene.setting, 'a cave');
  assert.equal(verifiedSetting({ ...scene, setting: 'unknown', setting_check: ok }), 'unknown');
});

test('a verified sentence with judgement words stays out of the summary Jev sees', () => {
  const scene = { id: 'S001', setting: 'unknown', sentences: [{ text: 'A sad goodbye.', check: ok, judgement_words: ['sad'] }, { text: 'Two fish talk.', check: ok }] };
  assert.deepEqual(verifiedSentences(scene), ['Two fish talk.']);
  assert.equal(contextState({ seg, scene, cues }).state.scene.summary, 'Two fish talk.');
});
