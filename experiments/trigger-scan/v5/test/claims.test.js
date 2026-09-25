// node --test test/
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildClaims, strideBatches, batchBody, verdictOf, applyChecks, castClaim, evidenceText, tally, placementBody } from '../claims.js';

const src = {
  cues: [{ text: 'Where is Nemo?' }, { text: '(WHALE MOANING)' }, { text: 'Let go!' }],
  W: [{ text: 'Marlin and Dory are consumed by a blue whale.' }],
  T: [{ character: 'Marlin', voice: true }],
};
const seg = {
  scenes: [
    { id: 'S001', start_cue: 1, end_cue: 3, setting: 'inside the whale', setting_cites: ['L2'], sentences: [
      { text: 'Someone asks where Nemo is.', cites: ['L1'] },
      { text: 'A whale swallows Marlin and Dory.', cites: ['W1'] },
      { text: 'A scary moment.', cites: ['L3'], judgement_words: ['scary'] },
    ] },
    { id: 'S002', start_cue: 4, end_cue: 4, setting: 'unknown', setting_cites: [], sentences: [] },
  ],
  cast: [{ id: 'C01', name: 'Marlin', kind: 'animal', is_child: 'unknown', looks_frightening: false, disposition: 'ally', disposition_note: 'searches for his son', cites: { name: ['T1'], kind: ['W1'], is_child: [], looks_frightening: ['L1'], disposition: ['W1'] } }],
  dangers: [{ id: 'D01', name: 'the whale', kind: 'creature_group', note: 'swallows Marlin and Dory', cites: ['W1'] }],
};

test('evidence strings carry the id and its source', () => {
  assert.equal(evidenceText('L2', src), 'L2 (subtitle line): (WHALE MOANING)');
  assert.equal(evidenceText('W1', src), 'W1 (Wikipedia plot sentence): Marlin and Dory are consumed by a blue whale.');
  assert.equal(evidenceText('T1', src), 'T1 (TMDB cast list entry): character "Marlin", a voice role');
});

test('buildClaims: one claim per cited fact, each with only its own evidence; unknowns are not claims', () => {
  const cs = buildClaims(seg, src);
  assert.deepEqual(cs.map((c) => c.key), ['S001.s1', 'S001.s2', 'S001.s3', 'S001.setting', 'C01.name', 'C01.kind', 'C01.looks_frightening', 'C01.disposition', 'D01']);
  const s1 = cs.find((c) => c.key === 'S001.s1');
  assert.deepEqual(s1.evidence, ['L1 (subtitle line): Where is Nemo?']);
  assert.equal(cs.find((c) => c.key === 'C01.disposition').claim, 'Marlin helps the main characters: searches for his son.');
  assert.equal(cs.find((c) => c.key === 'C01.looks_frightening').claim, 'Marlin looks harmless.');
  assert.equal(castClaim({ name: 'X', kind: 'other' }, 'kind'), null);
});

test('strideBatches spreads neighbours across batches and keeps every item once', () => {
  const b = strideBatches([0, 1, 2, 3, 4, 5, 6], 3);
  assert.deepEqual(b, [[0, 3, 6], [1, 4], [2, 5]]);
  assert.deepEqual(b.flat().sort(), [0, 1, 2, 3, 4, 5, 6]);
});

test('batchBody points each question at its own claims[i] paths', () => {
  const body = batchBody([{ claim: 'a', evidence: ['x'] }, { claim: 'b', evidence: ['y'] }]);
  assert.deepEqual(body.state, { claims: [{ claim: 'a', evidence: ['x'] }, { claim: 'b', evidence: ['y'] }] });
  assert.match(body.questions.r1.instructions, /`claims\[1\]\.evidence` relate to `claims\[1\]\.claim`/);
  assert.deepEqual(Object.keys(body.questions.r0.criteria), ['supports', 'contradicts', 'says_nothing']);
  assert.equal(placementBody('e', ['l']).state.event, 'e');
});

test('verdictOf: supports needs confidence >= 0.8; contradicts always drops', () => {
  assert.equal(verdictOf({ choice: 'supports', confidence: 0.8, probabilities: {} }).status, 'verified');
  assert.equal(verdictOf({ choice: 'supports', confidence: 0.79, probabilities: {} }).status, 'unverified');
  assert.equal(verdictOf({ choice: 'contradicts', confidence: 0.3, probabilities: {} }).status, 'contradicted');
  assert.equal(verdictOf({ choice: 'says_nothing', confidence: 0.99, probabilities: {} }).status, 'unverified');
});

test('applyChecks: summary = verified, placed, judgement-free sentences; contradicted fields become unknown', () => {
  const v = (choice, confidence = 0.95) => verdictOf({ choice, confidence, probabilities: {} });
  const checks = {
    'S001.s1': v('supports'), 'S001.s2': v('supports'), 'S001.s3': v('supports'), 'S001.setting': v('contradicts'),
    'C01.name': v('supports'), 'C01.kind': v('supports'), 'C01.looks_frightening': v('says_nothing'), 'C01.disposition': v('contradicts'),
    D01: v('contradicts'),
  };
  const { seg: out, dropped } = applyChecks(seg, checks, { 'S001.s2': { choice: 'cannot_tell', confidence: 0.6 } });
  const s = out.scenes[0];
  assert.equal(s.summary, 'Someone asks where Nemo is.'); // s2 unplaced, s3 has a judgement word
  assert.equal(s.sentences[1].check.status, 'unplaced');
  assert.equal(s.setting, 'unknown');
  assert.equal(out.cast[0].disposition, 'unknown');
  assert.equal(out.cast[0].disposition_note, '');
  assert.equal(out.cast[0].looks_frightening, false); // unverified is kept, marked
  assert.equal(out.cast[0].check.looks_frightening.status, 'unverified');
  assert.equal(out.dangers.length, 0);
  assert.deepEqual(dropped.map((d) => d.key), ['S001.setting', 'C01.disposition', 'D01']);
  assert.equal(seg.scenes[0].setting, 'inside the whale'); // input untouched
  const placed = applyChecks(seg, checks, { 'S001.s2': { choice: 'fits', confidence: 0.9 } }).seg;
  assert.equal(placed.scenes[0].summary, 'Someone asks where Nemo is. A whale swallows Marlin and Dory.');
  assert.equal(tally(checks).contradicted, 3);
});

test('evidenceIds adds neighbouring lines inside the scene only, then W and T', async () => {
  const { evidenceIds } = await import('../claims.js');
  assert.deepEqual(evidenceIds(['W2', 'L10', 'T1', 'L12'], { context: 2, range: [9, 13] }), ['L9', 'L10', 'L11', 'L12', 'L13', 'W2', 'T1']);
  assert.deepEqual(evidenceIds(['L1'], { context: 2, nCues: 2 }), ['L1', 'L2']);
  assert.deepEqual(evidenceIds(['L5', 'W1'], {}), ['L5', 'W1']);
});
