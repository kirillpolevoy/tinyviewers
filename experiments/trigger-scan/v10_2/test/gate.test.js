// node --test test/  -- the v7 segmentation validity gate (gate.js, check-split.js): code checks, Jev
// request shapes, verdict folding, the retry's overlapping-halves merge, and the thresholds against
// the saved round-2 checks (when present: out/ is git-ignored).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { codeMetrics, evaluate, gateResult, alignmentBody, boundaryBody, boundaryWindow, probePositions, alignVerdict, boundaryVerdict, jevMetrics, auc, halves, mergeHalves, mergeCast, mergeDangers, lineText, hms } from '../gate.js';
import { planSplitCheck, runSplitCheck, checkSegmentation, foldIntoSegments, perScene, withIds, loadGateCfg, modelScenesOf } from '../check-split.js';
import { budget } from '../budget.js';
import { assertCoverage } from '../validate.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const CFG = loadGateCfg();

// 600 cues, one every 6 s (a 60-minute film); a 20 s silence before every 20th cue
const cues = [];
let t = 0;
for (let i = 1; i <= 600; i++) { t += i % 20 === 1 && i > 1 ? 20000 : 2000; cues.push({ index: i, startMs: t, endMs: t + 4000, text: `line ${i}` }); t += 4000; }
const scenesEvery = (k) => Array.from({ length: 600 / k }, (_, i) => ({ start_cue: i * k + 1, end_cue: (i + 1) * k, sentences: [{ text: `s${i}`, cites: [`L${i * k + 2}`, 'W1'] }] }));

test('codeMetrics: a clean split has no outside cites, overshoot, repairs or drops', () => {
  const { metrics: m, covered } = codeMetrics(scenesEvery(20), cues, { wCount: 3, tCount: 2 });
  assert.equal(m.scenes, 30);
  assert.equal(m.cited_outside_share, 0);
  assert.equal(m.overshoot_cues, 0);
  assert.equal(m.repaired_share, 0);
  assert.equal(m.dropped_share, 0);
  const filmMin = cues[599].endMs / 60000;
  assert.equal(m.scenes_per_10_min, Math.round((30 / filmMin) * 10 * 1000) / 1000);
  assertCoverage(covered, 600);
  assert.ok(evaluate(m, CFG.code).every((r) => r.pass), JSON.stringify(evaluate(m, CFG.code).filter((r) => !r.pass)));
});

test('codeMetrics: the round-2 Wild Robot failure shape trips every code check', () => {
  // few long scenes, boundaries at round numbers, cue numbers past the last line, cites in other scenes
  const broken = [
    { start_cue: 1, end_cue: 150, sentences: [{ text: 'a', cites: ['L300', 'L310'] }, { text: 'b', cites: ['L5'] }] },
    { start_cue: 151, end_cue: 400, sentences: [{ text: 'c', cites: ['L500'] }] },
    { start_cue: 401, end_cue: 560, sentences: [{ text: 'd', cites: ['L100'] }, { text: 'e', cites: ['L402'] }] },
    { start_cue: 561, end_cue: 700, sentences: [{ text: 'f', cites: ['L100'] }] },
    { start_cue: 701, end_cue: 800, sentences: [{ text: 'g', cites: ['L200'] }] },
  ];
  const { metrics: m } = codeMetrics(broken, cues, { wCount: 3, tCount: 2 });
  assert.equal(m.overshoot_cues, 200);
  assert.equal(m.invalid_scenes, 2);
  assert.ok(m.cited_outside_share > 0.5);
  assert.ok(m.dropped_share > 0.5);
  const failed = evaluate(m, CFG.code).filter((r) => !r.pass).map((r) => r.id).sort();
  assert.deepEqual(failed, ['cited_outside_share', 'dropped_share', 'max_scene_minutes', 'overshoot_cues', 'repaired_share', 'scenes_per_10_min']);
});

test('evaluate / gateResult: min and max limits; no Jev layer = fail unless jev_optional', () => {
  const rows = evaluate({ a: 1, b: 5, c: null }, { a: { max: 1 }, b: { min: 6 }, c: { max: 1 }, _about: 'x' });
  assert.deepEqual(rows.map((r) => [r.id, r.pass]), [['a', true], ['b', false], ['c', false]]);
  const cfg = { code: { a: { max: 1 } }, jev: { j: { min: 0.5 } } };
  assert.equal(gateResult({ a: 1 }, { j: 0.6 }, cfg).pass, true);
  assert.equal(gateResult({ a: 1 }, { j: 0.4 }, cfg).pass, false);
  assert.deepEqual(gateResult({ a: 1 }, null, cfg).failed, ['jev check not run']);
  assert.equal(gateResult({ a: 1 }, null, { ...cfg, jev_optional: true }).pass, true);
});

test('Jev request shapes: alignment = one Choice per sentence over the scene lines; boundary = one Noul', () => {
  const lines = cues.slice(0, 3).map(lineText);
  assert.equal(lines[0], `L1 [${hms(2000)}] line 1`);
  const a = alignmentBody({ film: { title: 'F' }, lines, sentences: ['one', 'two'] });
  assert.equal(a.model, 'jev-1.13.0');
  assert.deepEqual(a.state, { film: { title: 'F' }, scene: { lines }, summary: ['one', 'two'] });
  assert.deepEqual(Object.keys(a.questions), ['a0', 'a1']);
  assert.equal(a.questions.a1.type, 'choice');
  assert.deepEqual(Object.keys(a.questions.a1.criteria), ['supports', 'contradicts', 'says_nothing']);
  assert.match(a.questions.a1.instructions, /summary\[1\]/);
  const w = boundaryWindow(cues, 100, CFG.window_lines);
  assert.equal(w.length, 2 * CFG.window_lines);
  assert.match(w[CFG.window_lines], /^L100 /, 'the asked line opens the second half of the window');
  assert.equal(boundaryWindow(cues, 2, 6).length, 7, 'clipped at the film start');
  const b = boundaryBody({ film: { title: 'F' }, window: w, at: 100 });
  assert.equal(b.questions.boundary.type, 'noul');
  assert.match(b.questions.boundary.instructions, /new scene start at line L100/);
  assert.deepEqual(Object.keys(b.questions.boundary.criteria), ['true', 'false']);
});

test('probePositions: the largest silences inside scenes, away from the edges, one per every_min', () => {
  const scenes = withIds([{ start_cue: 1, end_cue: 100 }, { start_cue: 101, end_cue: 110 }]);
  const p = probePositions(scenes, cues, { every_min: 2, min_gap_ms: 0, min_lines: 8, min_per_scene: 1 });
  assert.ok(p.every((x) => x.scene === 'S001'), 'a 10-cue scene is too short for a probe');
  const minutes = (cues[99].endMs - cues[0].startMs) / 60000;
  assert.equal(p.length, Math.floor(minutes / 2), `${p.length} probes in a ${minutes.toFixed(1)} min scene`);
  assert.deepEqual(p.filter((x) => (x.at - 1) % 20 === 0).map((x) => x.at), [21, 41, 61, 81], 'the 20 s silences are picked first');
  for (let i = 1; i < p.length; i++) assert.ok(p[i].at - p[i - 1].at >= 8, 'probes >= min_lines apart');
  assert.ok(p.every((x) => x.at >= 9 && x.at <= 93));
});

test('verdicts and film metrics: alignment share, unaligned scenes, boundary AUC, candidates', () => {
  assert.deepEqual(alignVerdict({ choice: 'supports', probabilities: { supports: 0.8, contradicts: 0.1 } }, CFG), { choice: 'supports', p_supports: 0.8, p_contradicts: 0.1, supported: true });
  assert.equal(boundaryVerdict(0.9, CFG), 'confirmed');
  assert.equal(boundaryVerdict(0.1, CFG), 'merge_candidate');
  assert.equal(boundaryVerdict(0.3, CFG), 'uncertain');
  assert.equal(auc([0.9, 0.8], [0.1, 0.2]), 1);
  assert.equal(auc([0.1], [0.9]), 0);
  assert.equal(auc([0.5], [0.5]), 0.5);
  assert.equal(auc([], [1]), null);
  const m = jevMetrics({
    alignment: [{ scene: 'S001', sentences: [{ supported: true }, { supported: false }] }, { scene: 'S002', sentences: [{ supported: false }] }],
    boundaries: [{ scene: 'S002', at: 50, p: 0.9 }, { scene: 'S003', at: 90, p: 0.1 }],
    probes: [{ scene: 'S001', at: 20, p: 0.2 }, { scene: 'S003', at: 120, p: 0.85 }],
  }, 60, CFG);
  assert.equal(m.aligned_share, 0.333);
  assert.deepEqual(m.scenes_unaligned, ['S002']);
  assert.equal(m.unaligned_scene_share, 0.5);
  assert.equal(m.boundary_auc, 0.5);
  assert.deepEqual(m.merge_candidates, ['L90']);
  assert.deepEqual(m.split_candidates, ['L120']);
  assert.equal(m.split_candidates_per_hour, 1);
});

// a fake Jev: alignment supports every sentence of even scenes; a boundary is a change when its cue is
// a multiple-of-20 start (the silences), probes never are
const fakePost = async (body) => {
  const answers = {};
  for (const [k, q] of Object.entries(body.questions)) {
    if (q.type === 'choice') answers[k] = { choice: 'supports', confidence: 0.9, probabilities: { supports: 0.9, contradicts: 0.05, says_nothing: 0.05 } };
    else { const at = Number(q.instructions.match(/line L(\d+)/)[1]); answers[k] = { noul: (at - 1) % 20 === 0 && !body.state.probe ? 0.9 : 0.1 }; }
  }
  return { json: { model: 'jev-1.13.0', answers, usage: { input_tokens: 1000, output_tokens: 10 } }, attempts: [{ status: 200, ms: 5 }], latencyMs: 5 };
};

test('runSplitCheck / checkSegmentation with a fake Jev: a clean split passes, spend is reserved and settled, verdicts fold into the segments', async () => {
  const jobs = planSplitCheck({ film: { title: 'F' }, scenes: withIds(scenesEvery(20)), cues, cfg: CFG });
  assert.equal(jobs.filter((j) => j.meta.kind === 'align').length, 30);
  assert.equal(jobs.filter((j) => j.meta.kind === 'boundary').length, 29);
  assert.ok(jobs.every((j) => j.reserveUsd > 0));
  const wallet = budget(0.05);
  const chk = await checkSegmentation({ film: { title: 'F' }, modelScenes: scenesEvery(20), cues, ctx: { wCount: 3, tCount: 2 }, cfg: CFG, wallet, post: fakePost });
  assert.equal(chk.jev.metrics.aligned_share, 1);
  assert.equal(chk.jev.run.cost_usd, +(chk.jev.run.requests * 1000 * 0.042 / 1e6).toFixed(6));
  assert.equal(wallet.reserved, 0);
  assert.ok(Math.abs(wallet.spent - chk.jev.run.cost_usd) < 1e-9);
  assert.equal(chk.pass, chk.failed.length === 0);
  const seg = { scenes: withIds(scenesEvery(20)).map((s) => ({ id: s.id, start_cue: s.start_cue, end_cue: s.end_cue })) };
  assert.equal(foldIntoSegments(seg, chk, { attempt: 1 }), 30);
  assert.equal(seg.split_check.attempt, 1);
  assert.equal(seg.split_check.jev.alignment, undefined, 'per-scene verdicts live on the scenes, not twice');
  assert.equal(seg.scenes[1].split_check.boundary_before.at, 'L21');
  assert.equal(seg.scenes[1].split_check.alignment.supported, 1);
  assert.throws(() => foldIntoSegments({ scenes: [{ start_cue: 1, end_cue: 5 }] }, chk), /only 0\/1/);
  assert.ok(Object.keys(perScene(chk)).length === 30);
});

test('runSplitCheck: a budget too small stops dispatch and throws (nothing half-checked is accepted)', async () => {
  await assert.rejects(runSplitCheck({ film: { title: 'F' }, scenes: withIds(scenesEvery(20)), cues, cfg: CFG, wallet: budget(0.00001), post: fakePost }), /requests failed/);
});

test('halves + mergeHalves: overlap, agreed cut, one-half cut, midpoint; the merge covers every cue once', () => {
  const h = halves(1798, 40);
  assert.deepEqual(h, { mid: 899, overlap: 40, a: [1, 939], b: [859, 1798] });
  const A = [{ start_cue: 1, end_cue: 500 }, { start_cue: 501, end_cue: 880 }, { start_cue: 881, end_cue: 939 }];
  const B = [{ start_cue: 859, end_cue: 880 }, { start_cue: 881, end_cue: 1200 }, { start_cue: 1201, end_cue: 1798 }];
  const m = mergeHalves(A, B, h);
  assert.equal(m.cut, 881);
  assert.equal(m.how, 'agreed_boundary');
  assertCoverage(m.scenes, 1798);
  assert.deepEqual(m.scenes.map((s) => s.part), ['A', 'A', 'B', 'B']);
  const m2 = mergeHalves([{ start_cue: 1, end_cue: 900 }, { start_cue: 901, end_cue: 939 }], [{ start_cue: 859, end_cue: 1798 }], h);
  assert.equal(m2.how, 'one_half_boundary');
  assert.equal(m2.cut, 901);
  assertCoverage(m2.scenes, 1798);
  const m3 = mergeHalves([{ start_cue: 1, end_cue: 939 }], [{ start_cue: 859, end_cue: 1798 }], h);
  assert.equal(m3.how, 'midpoint');
  assert.equal(m3.cut, 899);
  assertCoverage(m3.scenes, 1798);
});

test('mergeCast / mergeDangers: B adds only members A lacks (same TMDB id or name)', () => {
  const a = [{ name: 'Roz', tmdb: 'T1' }, { name: 'Fink', tmdb: '' }];
  const b = [{ name: 'ROZ', tmdb: '' }, { name: 'Rozzum', tmdb: 'T1' }, { name: 'Brightbill', tmdb: 'T2' }, { name: 'fink ', tmdb: '' }];
  assert.deepEqual(mergeCast(a, b).map((c) => c.name), ['Roz', 'Fink', 'Brightbill']);
  assert.deepEqual(mergeDangers([{ name: 'Storm' }], [{ name: 'storm' }, { name: 'Fire' }]).map((d) => d.name), ['Storm', 'Fire']);
});

test('modelScenesOf: v6 raw {data} and v7 raw {attempts} files', () => {
  assert.deepEqual(modelScenesOf({ data: { scenes: [1] } }), [1]);
  assert.deepEqual(modelScenesOf({ attempts: [{ scenes: [1] }, { scenes: [2], accepted: true }] }), [2]);
  assert.throws(() => modelScenesOf({}), /neither/);
});

test('round-2 regression (dev films, when out/ has the saved checks): four splits pass, round-2 wild-robot fails', () => {
  const OUT = path.join(here, '..', 'out');
  const want = { nemo: true, 'monsters-inc': true, 'lion-king': true, frankenweenie: true, 'wild-robot': false };
  let seen = 0;
  for (const [slug, pass] of Object.entries(want)) {
    const f = path.join(OUT, `${slug}.splitcheck.r2.json`);
    if (!fs.existsSync(f)) continue;
    seen++;
    const c = JSON.parse(fs.readFileSync(f, 'utf8'));
    assert.equal(gateResult(c.code.metrics, c.jev.metrics, CFG).pass, pass, `${slug} under the current split_gate`);
  }
  if (!seen) test.skip?.('no saved round-2 checks');
});
