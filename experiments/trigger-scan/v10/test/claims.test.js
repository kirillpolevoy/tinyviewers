// node --test test/
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildClaims, strideBatches, batchBody, verdictOf, applyChecks, castClaim, evidenceText, tally, placementBody, statusOf, placementOutcome } from '../claims.js';

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

test('buildClaims: one ATOMIC claim per cited fact; cast fields carry the name cites; unknowns are not claims', () => {
  const cs = buildClaims(seg, src);
  assert.deepEqual(cs.map((c) => c.key), ['S001.s1', 'S001.s2', 'S001.s3', 'S001.setting', 'C01.name', 'C01.kind', 'C01.looks_frightening', 'C01.disposition', 'C01.note', 'D01', 'D01.note']);
  const s1 = cs.find((c) => c.key === 'S001.s1');
  assert.deepEqual(s1.evidence, ['L1 (subtitle line): Where is Nemo?']);
  // v6: the role is one fact, the note its own claim, the danger's existence apart from its note
  assert.equal(cs.find((c) => c.key === 'C01.disposition').claim, 'Marlin helps the main characters.');
  assert.equal(cs.find((c) => c.key === 'C01.note').claim, 'About Marlin: searches for his son.');
  assert.equal(cs.find((c) => c.key === 'D01').claim, 'In this film, the whale is a danger to characters.');
  assert.equal(cs.find((c) => c.key === 'D01.note').claim, 'About the whale in this film: swallows Marlin and Dory.');
  // entity link: the kind claim cites W1, and its evidence also carries the name's T1
  assert.deepEqual(cs.find((c) => c.key === 'C01.kind').evidence_ids, ['W1', 'T1']);
  assert.equal(cs.find((c) => c.key === 'C01.looks_frightening').claim, 'Marlin looks harmless.');
  assert.equal(castClaim({ name: 'X', kind: 'other' }, 'kind'), null);
  assert.equal(castClaim({ name: 'X', disposition: 'villain' }, 'disposition'), 'X is a villain who works against the main characters.');
  assert.equal(castClaim({ name: 'X', disposition: 'unknown', disposition_note: 'n' }, 'note'), null);
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

test('verdictOf: the policy rule on p(supports) / p(contradicts); a low-probability contradiction is not a drop', () => {
  const rule = { min_supports: 0.7, max_contradicts: 0.15, contradict_min: 0.5 };
  assert.equal(verdictOf({ choice: 'supports', confidence: 0.74, probabilities: { supports: 0.83, contradicts: 0.01, says_nothing: 0.16 } }, rule).status, 'verified'); // v5 rejected this (Waternoose 0.74)
  assert.equal(verdictOf({ choice: 'supports', confidence: 0.51, probabilities: { supports: 0.67, contradicts: 0.01, says_nothing: 0.32 } }, rule).status, 'unverified'); // a labelled memory error
  assert.equal(verdictOf({ choice: 'supports', confidence: 0.9, probabilities: { supports: 0.8, contradicts: 0.18, says_nothing: 0.02 } }, rule).status, 'unverified');
  assert.equal(verdictOf({ choice: 'contradicts', confidence: 0.15, probabilities: { contradicts: 0.43, supports: 0.3, says_nothing: 0.27 } }, rule).status, 'unverified'); // v5 dropped it
  assert.equal(verdictOf({ choice: 'contradicts', confidence: 0.36, probabilities: { contradicts: 0.57, supports: 0.01, says_nothing: 0.42 } }, rule).status, 'contradicted');
  assert.equal(verdictOf({ choice: 'says_nothing', confidence: 0.99, probabilities: {} }, rule).status, 'unverified');
  // without probabilities the chosen verdict's confidence stands in
  assert.equal(verdictOf({ choice: 'supports', confidence: 0.8, probabilities: {} }, rule).status, 'verified');
  assert.equal(statusOf({ verdict: 'supports', confidence: 0.69 }, rule), 'unverified');
});

test('placement: Wikipedia-only needs fits; lines + Wikipedia is unplaced only when the lines conflict', () => {
  const rule = { min_supports: 0.7, max_contradicts: 0.15, contradict_min: 0.5 };
  assert.equal(placementOutcome({ choice: 'fits', confidence: 0.6, probabilities: { fits: 0.75, conflicts: 0.05, cannot_tell: 0.2 } }, true, rule), 'placed');
  assert.equal(placementOutcome({ choice: 'cannot_tell', confidence: 0.6, probabilities: { fits: 0.3, conflicts: 0.1, cannot_tell: 0.6 } }, true, rule), 'unplaced');
  assert.equal(placementOutcome({ choice: 'cannot_tell', confidence: 0.6, probabilities: { fits: 0.3, conflicts: 0.1, cannot_tell: 0.6 } }, false, rule), 'placed');
  assert.equal(placementOutcome({ choice: 'conflicts', confidence: 0.6, probabilities: { fits: 0.1, conflicts: 0.7, cannot_tell: 0.2 } }, false, rule), 'unplaced');
  assert.equal(placementOutcome(undefined, true, rule), 'unplaced');
  const mixed = { ...seg, scenes: [{ ...seg.scenes[0], sentences: [{ text: 'Marlin meets someone.', cites: ['L1', 'W1'] }] }, seg.scenes[1]] };
  const out = applyChecks(mixed, { 'S001.s1': verdictOf({ choice: 'supports', confidence: 0.9, probabilities: {} }, rule) }, { 'S001.s1': { choice: 'conflicts', confidence: 0.8, probabilities: { conflicts: 0.8 } } }, rule).seg;
  assert.equal(out.scenes[0].sentences[0].check.status, 'unplaced');
  assert.equal(out.scenes[0].summary, '');
});

test('aliases are claims: cited or code-found evidence plus the name cites; common-word aliases are refused unchecked', () => {
  const s2 = { cues: [{ text: 'Hey, Marty!' }, { text: 'Your Majesty.' }, { text: 'Go, Marty.' }], W: src.W, T: [{ character: 'Marlin "Marty"', voice: true }] };
  const withAliases = { ...seg, cast: [{ ...seg.cast[0], tmdb: 'T1', aliases: ['Marty', 'Your Majesty', 'the kid', { name: 'Mr. Finn', cites: ['L2'] }, 'Nowhere Name'] }] };
  const cs = buildClaims(withAliases, s2);
  const al = cs.filter((c) => c.target.type === 'alias');
  assert.deepEqual(al.map((c) => c.key), ['C01.alias1', 'C01.alias4']);
  assert.equal(al[0].claim, 'Marlin is also called Marty.');
  assert.deepEqual(al[0].cites, ['T1', 'L1', 'L3']); // code-found: the TMDB entry + lines containing the alias, then the name cites
  assert.equal(al[0].target.cites_found_by_code, true);
  assert.deepEqual(al[1].cites, ['L2', 'T1']);
  assert.deepEqual(cs.refused_aliases.map((r) => `${r.key} ${r.why}`), ['C01.alias2 only_common_words', 'C01.alias3 only_common_words', 'C01.alias5 no_cite']);
  // fold: each alias gets its own check; an alias with no answer is 'unchecked'
  const rule = { min_supports: 0.7, max_contradicts: 0.15, contradict_min: 0.5 };
  const out = applyChecks(withAliases, { 'C01.alias1': verdictOf({ choice: 'supports', confidence: 0.9, probabilities: {} }, rule) }, {}, rule).seg;
  assert.deepEqual(out.cast[0].aliases.map((a) => `${a.name}:${a.check.status}`), ['Marty:verified', 'Your Majesty:unchecked', 'the kid:unchecked', 'Mr. Finn:unchecked', 'Nowhere Name:unchecked']);
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

test('run phase: an unverified name that cites its TMDB entry takes the TMDB name, verified by code', async () => {
  const { adoptTmdbNames } = await import('../claims.js');
  const seg = { cast: [
    { id: 'C01', name: 'Henry J. Waternoose', tmdb: 'T2', cites: { name: ['L5', 'T2'] } },
    { id: 'C02', name: 'Sully', tmdb: 'T1', cites: { name: ['T1'] } },
    { id: 'C03', name: 'Boss', tmdb: 'T2', cites: { name: ['L9'] } },
    { id: 'C04', name: 'Kid', tmdb: 'T3', cites: { name: ['T3'] } },
  ] };
  const src = { T: [{ character: 'Sullivan' }, { character: 'Waternoose' }, { character: 'Little Girl' }] };
  const unv = () => ({ verdict: 'says_nothing', confidence: 0.6, probabilities: { says_nothing: 0.62, supports: 0.38 }, status: 'unverified' });
  const checks = { 'C01.name': unv(), 'C02.name': { ...unv(), status: 'verified' }, 'C03.name': unv(), 'C04.name': unv() };
  const done = adoptTmdbNames(seg, src, checks);
  assert.deepEqual(done.map((d) => d.key), ['C01.name']);
  assert.equal(seg.cast[0].name, 'Waternoose');
  assert.equal(seg.cast[0].name_unverified, 'Henry J. Waternoose');
  assert.equal(checks['C01.name'].status, 'verified');
  assert.equal(checks['C01.name'].code_verified, 'tmdb_name');
  assert.equal(seg.cast[1].name, 'Sully'); // already verified: untouched
  assert.equal(checks['C03.name'].status, 'unverified'); // TMDB entry not cited for the name
  assert.equal(checks['C04.name'].status, 'unverified'); // TMDB string only common words
});
