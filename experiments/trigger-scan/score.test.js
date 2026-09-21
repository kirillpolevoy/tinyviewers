// node --test score.test.js
// Small synthetic fixtures proving the properties the old scorers lacked.
import test from 'node:test';
import assert from 'node:assert/strict';
import { scoreFilm, summariseGrid, headline, baselineWholeFilm, baselineNothing, baselineRandomMatched, matchProfile, mulberry32, poolResults } from './score.js';

const LABELS = ['a', 'b', 'c', 'd', 'e'];
const FILM_MS = 600_000; // 10 minutes, 120 bins of 5 s
// two reference scenes, one label each; 100 s of reference in a 600 s film
const REFERENCE = [
  { id: 'G1', startMs: 60_000, endMs: 120_000, labels: ['a'], visualOnly: [], severity: { '5-7': 3, '8-10': 2 } },
  { id: 'G2', startMs: 300_000, endMs: 340_000, labels: ['b'], visualOnly: [], severity: { '5-7': 2, '8-10': 2 } },
];
const CONTROLS = [{ id: 'K1', startMs: 450_000, endMs: 500_000 }];
const run = (predictions, options) => scoreFilm({ film: 'fixture', filmEndMs: FILM_MS, labelIds: LABELS, reference: REFERENCE, controls: CONTROLS, predictions, options });

test('a prediction exactly matching the reference scores 1.0', () => {
  const preds = REFERENCE.map((g) => ({ startMs: g.startMs, endMs: g.endMs, labels: g.labels }));
  const g = summariseGrid(run(preds).grid[0].perLabel, LABELS);
  assert.equal(g.micro.precision, 1);
  assert.equal(g.micro.recall, 1);
  assert.equal(g.micro.f1, 1);
  assert.equal(g.macro.f1, 1);
  const h = headline(run(preds));
  assert.equal(h.sceneRecall, 1);
  assert.equal(h.shareInsideRef, 1);
  assert.equal(h.refPerPrediction, 1);
});

test('the whole-film / every-label baseline scores badly and loses to the exact predictor', () => {
  const exact = run(REFERENCE.map((g) => ({ startMs: g.startMs, endMs: g.endMs, labels: g.labels })));
  const whole = run(baselineWholeFilm(FILM_MS, LABELS));
  const hw = headline(whole);
  const he = headline(exact);
  // it finds everything, but that is the only thing it wins
  assert.equal(hw.sceneRecall, 1);
  assert.ok(hw.labelPrecision < 0.05, `label precision ${hw.labelPrecision}`);
  assert.ok(hw.labelF1 < 0.1, `label F1 ${hw.labelF1}`);
  assert.ok(hw.labelF1 < he.labelF1);
  assert.ok(hw.macroF1 < he.macroF1);
  // and the overreach report exposes it
  assert.equal(hw.flaggedMin, 10);
  assert.ok(hw.shareInsideRef < 0.2);
  assert.equal(hw.refPerPrediction, 2);
  assert.equal(hw.maxRefPerPrediction, 2);
  assert.equal(hw.controlsHit, 1);
  // and it cannot hide behind a coverage threshold either: every reference scene is "found"
  // only because breadth is free, which the overreach numbers above make visible.
  assert.equal(whole.detection['0.5'].found, 2);
});

test('nothing flagged scores zero recall and is not rewarded', () => {
  const h = headline(run(baselineNothing()));
  assert.equal(h.sceneRecall, 0);
  assert.equal(h.labelRecall, 0);
  assert.equal(h.labelF1, 0);
  assert.equal(h.flaggedMin, 0);
  assert.equal(h.controlsHit, 0);
});

test('two far-apart false predictions count as two, not one', () => {
  const one = run([{ startMs: 0, endMs: 20_000, labels: ['a'] }]);
  const two = run([{ startMs: 0, endMs: 20_000, labels: ['a'] }, { startMs: 400_000, endMs: 420_000, labels: ['a'] }]);
  assert.equal(one.grid[0].perLabel.a.fp, 4); // 20 s = 4 bins of 5 s
  assert.equal(two.grid[0].perLabel.a.fp, 8); // exactly twice, although they are adjacent array elements
});

test('predicting the same label everywhere is worse than predicting it only where it belongs', () => {
  const right = run([{ startMs: 60_000, endMs: 120_000, labels: ['a'] }]);
  const everywhere = run([{ startMs: 0, endMs: FILM_MS, labels: ['a'] }]);
  assert.ok(summariseGrid(everywhere.grid[0].perLabel, LABELS).micro.f1 < summariseGrid(right.grid[0].perLabel, LABELS).micro.f1);
});

test('tolerance margin: edges are don\'t-care, and the margin is symmetric', () => {
  // a prediction 5 s past the end of the reference scene
  const over = [{ startMs: 60_000, endMs: 125_000, labels: ['a'] }];
  const at0 = run(over).grid[0].perLabel.a;
  const at5 = run(over).grid[5].perLabel.a;
  assert.equal(at0.fp, 1); // one bin beyond the reference edge is charged
  assert.equal(at0.fn, 0);
  assert.equal(at5.fp, 0); // with a 5 s margin it is forgiven
  assert.equal(at5.fn, 0);
  assert.equal(at5.refBins, 10); // core [65 s, 115 s] = 10 bins, down from 12
  assert.ok(at5.dontCare > 0);

  // symmetric: a prediction that stops 5 s short is forgiven the same way
  const short = [{ startMs: 65_000, endMs: 115_000, labels: ['a'] }];
  assert.equal(run(short).grid[0].perLabel.a.fn, 2);
  assert.equal(run(short).grid[5].perLabel.a.fn, 0);
});

test('a reference scene shorter than twice the margin disappears from that label', () => {
  const short = { id: 'G3', startMs: 60_000, endMs: 70_000, labels: ['a'], visualOnly: [], severity: 3 };
  const r = scoreFilm({ film: 'f', filmEndMs: FILM_MS, labelIds: LABELS, reference: [short], controls: [], predictions: [] });
  assert.equal(r.grid[0].perLabel.a.refBins, 2);
  assert.equal(r.grid[15].perLabel.a.refBins, 0); // no core survives a 15 s margin
  assert.ok(r.grid[15].perLabel.a.dontCare > 0);
});

test('visual-only reference labels become don\'t-care, not false positives, in text-only mode', () => {
  const ref = [{ id: 'G1', startMs: 60_000, endMs: 120_000, labels: ['a'], visualOnly: ['a'], severity: 1 }];
  const preds = [{ startMs: 60_000, endMs: 120_000, labels: ['a'] }];
  const all = scoreFilm({ film: 'f', filmEndMs: FILM_MS, labelIds: LABELS, reference: ref, predictions: preds });
  const text = scoreFilm({ film: 'f', filmEndMs: FILM_MS, labelIds: LABELS, reference: ref, predictions: preds, options: { textOnly: true } });
  assert.equal(all.grid[0].perLabel.a.tp, 12);
  assert.equal(text.grid[0].perLabel.a.tp, 0);
  assert.equal(text.grid[0].perLabel.a.fp, 0); // not charged for a label the subtitles cannot show
  assert.equal(text.grid[0].perLabel.a.dontCare, 12);
});

test('coverage thresholds stop a sliver of overlap from counting as a found scene', () => {
  const sliver = run([{ startMs: 115_000, endMs: 120_000, labels: ['a'] }]); // 5 s of a 60 s scene
  assert.equal(sliver.detection.any.found, 1);
  assert.equal(sliver.detection['0.25'].found, 0);
  assert.equal(sliver.detection['0.5'].found, 0);
});

test('calm-control overlap thresholds behave', () => {
  const r = run([{ startMs: 450_000, endMs: 458_000, labels: [] }]); // 8 s inside the control
  assert.equal(r.controls['0'].hit, 1);
  assert.equal(r.controls['5000'].hit, 1);
  assert.equal(r.controls['10000'].hit, 0);
});

test('severity agreement is computed on matched scenes only', () => {
  const preds = [{ startMs: 60_000, endMs: 120_000, labels: ['a'], severity: { '5-7': 2, '8-10': 2 } }];
  const r = run(preds);
  assert.equal(r.severity['5-7'].length, 1);
  assert.deepEqual(r.severity['5-7'][0], [3, 2]);
});

test('the random matched baseline is seeded and matches the flagged-time share it was given', () => {
  const analyzer = [
    { startMs: 55_000, endMs: 125_000, labels: ['a'] },
    { startMs: 295_000, endMs: 345_000, labels: ['b'] },
  ];
  const profile = matchProfile(analyzer, LABELS);
  const draw = (seed) => baselineRandomMatched({ filmEndMs: FILM_MS, profile, labelIds: LABELS, rng: mulberry32(seed) });
  assert.deepEqual(draw(1), draw(1));
  const flagged = headline(run(draw(7))).flaggedMin;
  assert.ok(flagged >= profile.targetFlaggedMs / 60000, 'random baseline flags at least the analyzer share');
  // and it must lose on labels to the analyzer it was matched to
  const real = headline(run(analyzer)).labelF1;
  const rand = [...Array(20)].map((_, i) => run(draw(100 + i)));
  const pooled = headline(poolResults(rand, { divideBy: 20 })).labelF1;
  assert.ok(pooled < real, `random ${pooled} should lose to analyzer ${real}`);
});

test('pooling sums counts across films', () => {
  const a = run([{ startMs: 60_000, endMs: 120_000, labels: ['a'] }]);
  const b = run([{ startMs: 60_000, endMs: 120_000, labels: ['a'] }]);
  const p = poolResults([a, b]);
  assert.equal(p.grid[0].perLabel.a.tp, 24);
  assert.equal(p.detection.any.refs, 4);
});
