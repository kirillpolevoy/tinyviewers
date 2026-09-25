import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mildSignals, mildRows } from '../pipeline-jevfirst/stages/ingest.js';

const tag = (id, p = 0.9, layer = 'event') => ({ id, label: id, level: 'act', layer, p, by: 'jev' });
const scene = (id, o = {}) => ({ id, start_ms: 1000, end_ms: 5000, flagged: false, tags: [], gated_reasons: [], ...o });

test('an unflagged scene with a strong scare or sadness event is mild; presence alone is not', () => {
  assert.deepEqual(mildSignals(scene('S1', { tags: [tag('appears_suddenly'), tag('screams')] })).map((x) => x.id), ['appears_suddenly', 'screams']);
  assert.deepEqual(mildSignals(scene('S2', { tags: [tag('monster_creature', 0.99, 'presence'), tag('darkness', 0.99, 'presence')] })), []);
});

test('startled, screaming and afraid-for-safety never add a scene on their own', () => {
  assert.deepEqual(mildSignals(scene('S3', { tags: [tag('startled'), tag('screams'), tag('afraid_for_safety')] })), []);
});

test('event tags need p >= 0.75; gated reasons count as they are', () => {
  assert.deepEqual(mildSignals(scene('S4', { tags: [tag('chased', 0.6)] })), []);
  assert.deepEqual(mildSignals(scene('S5', { gated_reasons: [{ id: 'threatens_harm', label: 'Threat', p: 0.6, by: 'jev' }] })).map((x) => x.id), ['threatens_harm']);
});

test('flagged scenes and credits are never mild', () => {
  assert.deepEqual(mildSignals(scene('S6', { flagged: true, tags: [tag('chased')] })), []);
  assert.deepEqual(mildSignals(scene('S7', { kind: { choice: 'credits' }, tags: [tag('chased')] })), []);
});

test('a mild row is level 1 for both bands, lists its signals and shows only checked summary sentences', () => {
  const tags = { scenes: [scene('S1', { tags: [tag('crying')] })] };
  const segments = [{ id: 'S1', sentences: [
    { text: 'A child cries at the gate.', check: { status: 'verified' } },
    { text: 'Unsupported sentence.', check: { status: 'unverified', probabilities: { supports: 0.2, contradicts: 0.1 } } },
  ] }];
  const [row] = mildRows(tags, segments);
  assert.equal(row.severity_5_7, 1);
  assert.equal(row.severity_8_10, 1);
  assert.equal(row.mild, true);
  assert.equal(row.why_line, 'crying');
  assert.equal(row.description, 'A child cries at the gate.');
});

test('a scene in the end credits is never mild', () => {
  const tags = { scenes: [scene('S9', { tags: [tag('screams'), tag('appears_suddenly')] })] };
  assert.deepEqual(mildRows(tags, [{ id: 'S9', credits: true, sentences: [] }]), []);
});
