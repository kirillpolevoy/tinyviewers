// node --test test/  -- v8 unified acceptance rule (accept.js) and fix (b), wordless fill (fill.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import { acceptSentence, applyUnified } from '../accept.js';
import { wordlessScenes, anchorsOf, orderWindow, validateScene, fillPlacement, foldFill, neighbourBody, SCHEMA } from '../fill.js';
import { ruleOf } from '../refold.js';
import { loadPolicy } from '../select.js';
import { transcriptGrams } from '../validate.js';

const cfg = loadPolicy();
const rule = ruleOf(cfg);
const claim = (s, c = 0, verdict = s >= 0.5 ? 'supports' : 'says_nothing') => ({ verdict, probabilities: { supports: s, contradicts: c, says_nothing: 1 - s - c } });

test('policy: claim precedence (the calibrated rule); the split check neither promotes nor vetoes', () => {
  assert.equal(rule.precedence, 'claim');
  assert.equal(rule.split_promotes, false);
  assert.equal(rule.split_vetoes, false);
});

test('acceptSentence: the claim check decides; a split "supported" never promotes an unverified claim', () => {
  assert.deepEqual(acceptSentence(claim(0.8), null, rule), { status: 'verified', by: 'claim' });
  assert.deepEqual(acceptSentence(claim(0.4), { p_supports: 1, p_contradicts: 0 }, rule), { status: 'unverified', by: null });
  assert.deepEqual(acceptSentence(claim(0.8), { p_supports: 0, p_contradicts: 0.9 }, rule), { status: 'verified', by: 'claim' });
  assert.equal(acceptSentence(claim(0.1, 0.8, 'contradicts'), null, rule).status, 'contradicted');
});

test('acceptSentence: with the switches on (calibration candidates), split promotes / vetoes', () => {
  const on = { ...rule, split_promotes: true, split_vetoes: true, split_min: 0.9, claim_floor: 0.5, split_contradicts_max: 0.5 };
  assert.equal(acceptSentence(claim(0.6), { p_supports: 0.95, p_contradicts: 0 }, on).by, 'claim+split');
  assert.equal(acceptSentence(claim(0.9), { p_supports: 0.1, p_contradicts: 0.6 }, on).status, 'contradicted');
});

test('applyUnified: statuses, Wikipedia placement, fill placement, summaries rebuilt', () => {
  const seg = { scenes: [{ id: 'S001', sentences: [
    { text: 'A.', cites: ['L1'], check: { ...claim(0.9), status: 'verified' } },
    { text: 'B.', cites: ['W2'], check: { ...claim(0.9), status: 'verified', placement: { choice: 'cannot_tell', probabilities: { fits: 0.2, conflicts: 0.1, cannot_tell: 0.7 } } } },
    { text: 'C.', cites: ['W3'], fill: { placed: true }, check: { ...claim(0.95), status: 'verified' } },
    { text: 'D.', cites: ['W4'], fill: { placed: false }, check: { ...claim(0.95), status: 'verified' } },
    { text: 'E scary.', cites: ['L2'], judgement_words: ['scary'], check: { ...claim(0.9), status: 'verified' } },
  ] }] };
  const n = applyUnified(seg, new Map([['S001', [null, null, null, null, null]]]), rule);
  assert.deepEqual(seg.scenes[0].sentences.map((x) => x.check.status), ['verified', 'unplaced', 'verified', 'unplaced', 'verified']);
  assert.equal(seg.scenes[0].summary, 'A. C.');
  assert.equal(n.verified, 3);
});

// ---- fill ----
const cue = (index, s, e, text) => ({ index, startMs: s * 1000, endMs: e * 1000, text });
const cues = [cue(1, 0, 2, 'Hello there my friend'), cue(2, 3, 5, 'How are you today'), cue(3, 10, 12, '(MUSIC)'), cue(4, 200, 202, 'Good morning'), cue(5, 203, 205, 'Time to go now')];
const seg = { film: { title: 'T' }, scenes: [
  { id: 'S001', start_cue: 1, end_cue: 2, start_ms: 0, end_ms: 5000, sentences: [{ text: 'x', cites: ['L1', 'W1'], check: { status: 'verified' } }], summary: 'x' },
  { id: 'S002', start_cue: 3, end_cue: 3, start_ms: 10000, end_ms: 12000, sentences: [], summary: '' },
  { id: 'S003', start_cue: 4, end_cue: 5, start_ms: 200000, end_ms: 205000, sentences: [{ text: 'y', cites: ['L4', 'W5'], check: { status: 'verified' } }], summary: 'y' },
] };

test('wordlessScenes: < 3 dialogue cues per minute over the extended bounds (captions do not count), >= 30 s', () => {
  const w = wordlessScenes(seg, cues, cfg);
  assert.deepEqual(w.map((x) => x.id), ['S002']);
  assert.equal(w[0].end_ms, 200000);
});

test('orderWindow: strictly between the neighbouring anchors, minus W anchored elsewhere', () => {
  const anchors = anchorsOf(seg);
  assert.deepEqual(anchors, [{ w: 1, scene: 0 }, { w: 5, scene: 2 }]);
  assert.deepEqual(orderWindow(1, anchors, 8), { bounds: [1, 5], candidates: [2, 3, 4] });
  // no anchor after: up to the last W-sentence; an anchor elsewhere is excluded
  assert.deepEqual(orderWindow(1, [{ w: 1, scene: 0 }, { w: 3, scene: 0 }], 5).candidates, [4, 5]);
});

test('validateScene: only window W and own lines, needs a W cite, 25 words, quote rule, judgement words', () => {
  const ctx = { start_cue: 3, end_cue: 3, window: [1, 5], candidates: [2, 3, 4] };
  const grams = transcriptGrams(['one two three four five six seven eight nine ten'], 9);
  const r = validateScene({ sentences: [
    { text: 'Ok event.', cites: ['W2', 'L3', 'L1'] },
    { text: 'Outside window.', cites: ['W5'] },
    { text: 'A sad thing happens.', cites: ['W3'] },
    { text: 'one two three four five six seven eight nine ten', cites: ['W4'] },
  ] }, ctx, { nCues: 5, wCount: 8, tCount: 0, grams });
  assert.deepEqual(r.kept[0].cites, ['W2', 'L3']);
  assert.equal(r.kept[0].cites_dropped, 1);
  assert.deepEqual(r.rejected, [{ why: 'no_w_cite_in_window', n: 1 }]);
  assert.deepEqual(r.kept[1].judgement_words, ['sad']);
  assert.ok(r.kept[2].quote_violations?.length === 1 && r.kept[2].text.includes('…'));
});

test('fillPlacement: neighbour test decides at neighbour_min; own-line conflicts are recorded, not gating', () => {
  assert.equal(cfg.fill.neighbour_min, 0.8);
  assert.equal(cfg.fill.own_lines_gate, false);
  const own = { probabilities: { conflicts: 0.7 } };
  assert.equal(fillPlacement({ own, neighbour: { probabilities: { neither: 0.85 } } }, cfg).placed, true);
  assert.equal(fillPlacement({ own, neighbour: { probabilities: { neither: 0.79 } } }, cfg).placed, false);
  assert.equal(fillPlacement({ own, neighbour: { probabilities: { neither: 0.9 } } }, { ...cfg, fill: { ...cfg.fill, own_lines_gate: true } }).placed, false);
});

test('foldFill replaces earlier fill sentences (idempotent) and marks them', () => {
  const fill = { scenes: [{ id: 'S002', window: [1, 5], sentences: [{ text: 'z', cites: ['W3'], placement: { placed: true }, check: { status: 'verified' } }] }] };
  const once = foldFill(seg, fill);
  const twice = foldFill(once, fill);
  assert.equal(twice.scenes[1].sentences.length, 1);
  assert.equal(twice.scenes[1].sentences[0].fill.placed, true);
  assert.equal(seg.scenes[1].sentences.length, 0, 'input not mutated');
});

test('neighbourBody: one Choice before / after / neither over the lines around the scene; schema asks per-W decisions', () => {
  const b = neighbourBody({ film: { title: 'T' }, event: 'e', before: ['L1 x'], after: ['L4 y'] });
  assert.deepEqual(Object.keys(b.questions.shown.criteria), ['before', 'after', 'neither']);
  assert.deepEqual(Object.keys(b.state), ['film', 'event', 'lines_before', 'lines_after']);
  assert.ok(SCHEMA.properties.scenes.items.required.includes('decisions'));
});
