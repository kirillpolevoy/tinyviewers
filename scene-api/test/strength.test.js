import { test } from 'node:test';
import assert from 'node:assert/strict';
import { strengthOf, reasonLevels } from '../pipeline-jevfirst/strength.js';

const scene = (ids, modifiers = {}) => ({ flagged: true, flag_reasons: ids.map((id) => ({ id })), modifiers });

test('a scene takes the level of its strongest reason, per band', () => {
  assert.deepEqual(strengthOf(scene(['afraid_for_safety', 'chased'])), { '5-7': 2, '8-10': 1 });
  assert.deepEqual(strengthOf(scene(['chased', 'weapon_used'])), { '5-7': 3, '8-10': 2 });
  assert.deepEqual(strengthOf(scene(['loved_one_dies'])), { '5-7': 3, '8-10': 3 });
  assert.deepEqual(strengthOf(scene(['crying'])), { '5-7': 1, '8-10': 1 });
});

test('film-specific reasons and unknown ids read as danger', () => {
  assert.deepEqual(reasonLevels('C04_in_danger'), [2, 1]);
  assert.deepEqual(reasonLevels('D02_endangers'), [2, 1]);
  assert.deepEqual(reasonLevels('something_new'), [2, 1]);
});

test('comic, retold or imagined scenes are at most 1; flagged scenes at least 1', () => {
  assert.deepEqual(strengthOf(scene(['weapon_used'], { comic: { on: true } })), { '5-7': 1, '8-10': 1 });
  assert.deepEqual(strengthOf(scene(['dies'], { retold: { on: true } })), { '5-7': 1, '8-10': 1 });
  assert.deepEqual(strengthOf(scene([])), { '5-7': 1, '8-10': 1 });
});

test('a scene that is not flagged has no level', () => {
  assert.deepEqual(strengthOf({ flagged: false, flag_reasons: [{ id: 'dies' }] }), { '5-7': null, '8-10': null });
});
