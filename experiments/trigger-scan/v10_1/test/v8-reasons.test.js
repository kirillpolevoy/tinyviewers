// node --test test/  -- v8 fix (c): every flagged scene states why (reasons.js), select.js attaches it,
// the incremental moments planner, and the parent checks.
import test from 'node:test';
import assert from 'node:assert/strict';
import { PARENT_PHRASE, parentPhrase, rankReasons, generatedWhy, planReasons, pickWhy } from '../reasons.js';
import { scenesNeedingMoments } from '../moments.js';
import { checkWordlessPeaks, checkWordlessScenes, checkWhy } from '../parent-checks.js';
import { loadPolicy, selectRun } from '../select.js';

const cfg = loadPolicy();

test('every flag-capable universal id has a plain parent phrase', () => {
  const f = cfg.flag;
  const ids = [...f.strong_events, ...f.presence.always, ...f.presence.with_danger, ...f.presence.with_creature_threat];
  assert.deepEqual(ids.filter((id) => !PARENT_PHRASE[id]), []);
});

test('film-specific reasons are named from the item', () => {
  const items = [{ id: 'C01_threatens', type: 'threatens', name: 'Scar' }, { id: 'C02_in_danger', type: 'child_in_danger', name: 'Nemo' }, { id: 'D01_endangers', type: 'danger', name: 'the net' }];
  assert.equal(parentPhrase({ id: 'C01_threatens' }, items), 'Scar threatens, chases or attacks someone');
  assert.equal(parentPhrase({ id: 'C02_in_danger' }, items), 'Nemo is in danger');
  assert.equal(parentPhrase({ id: 'D01_endangers' }, items), 'the net puts someone in danger');
});

test('rankReasons: concrete events by concern group first, a character\'s fear last', () => {
  const r = rankReasons([{ id: 'afraid_for_safety', p: 0.99 }, { id: 'chased', p: 0.7 }, { id: 'loved_one_dies', p: 0.71 }]);
  assert.deepEqual(r.map((x) => x.id), ['loved_one_dies', 'chased', 'afraid_for_safety']);
});

test('generatedWhy: "Heads-up: ..." naming up to two distinct reasons', () => {
  assert.deepEqual(generatedWhy([{ id: 'afraid_for_safety' }, { id: 'loved_one_dies' }, { id: 'dies' }]), { source: 'generated', text: 'Heads-up: a loved one dies; a character dies.', reasons: ['loved_one_dies', 'dies'] });
  assert.equal(generatedWhy([]), null);
});

const scene = { id: 'S009' };
const reasons = [{ id: 'dies', p: 0.9 }, { id: 'afraid_for_safety', p: 0.8 }];

test('planReasons: one Noul per (reason, sentence); no request without a verified sentence', () => {
  const p = planReasons({ film: { title: 'T' }, scene, sentences: ['A deer is shot.', 'They walk home.'], reasons, items: [], cfg });
  assert.deepEqual(Object.keys(p.body.questions), ['r0.s0', 'r0.s1', 'r1.s0', 'r1.s1']);
  assert.equal(planReasons({ film: { title: 'T' }, scene, sentences: [], reasons, items: [], cfg }), null);
});

test('pickWhy: the stating sentence at >= min_p, else the generated line -- never an unrelated sentence', () => {
  const p = planReasons({ film: { title: 'T' }, scene, sentences: ['A deer is shot.', 'They walk home.'], reasons, items: [], cfg });
  const yes = pickWhy(p, { 'r0.s0': { noul: 0.93 }, 'r0.s1': { noul: 0.01 }, 'r1.s0': { noul: 0.4 }, 'r1.s1': { noul: 0.1 } }, { reasons, items: [], cfg });
  assert.deepEqual(yes.why, { source: 'verified_sentence', text: 'A deer is shot.', states: 'dies', p: 0.93, sentence: 0 });
  assert.equal(cfg.reasons.min_p, 0.6);
  const no = pickWhy(p, { 'r0.s0': { noul: 0.59 }, 'r0.s1': { noul: 0.01 }, 'r1.s0': { noul: 0.4 }, 'r1.s1': { noul: 0.1 } }, { reasons, items: [], cfg });
  assert.equal(no.why.source, 'generated');
  assert.equal(no.why.text, 'Heads-up: a character dies; characters are afraid for their safety.');
  assert.equal(pickWhy(null, null, { reasons, items: [], cfg }).why.source, 'generated');
});

test('select attaches why only to flagged scenes and only when the reasons match', () => {
  const answers = { e: { dies: 0.95 }, s: { danger: { score: 3, top: 4, probabilities: { 3: 1 } } }, mod: {}, pl: {}, ps: null };
  const run = { film: { slug: 't', title: 'T' }, run: 'r1', film_items: [], scenes: [{ id: 'S001', start_cue: 1, end_cue: 1, start_ms: 0, end_ms: 10000, answers }, { id: 'S002', start_cue: 2, end_cue: 2, start_ms: 10000, end_ms: 20000, answers: { e: {}, s: {}, mod: {}, pl: {}, ps: null } }] };
  const why = { source: 'generated', text: 'Heads-up: a character dies.' };
  const a = selectRun(run, cfg, { reasons: { scenes: { S001: { reasons: ['dies'], why } } } });
  assert.deepEqual(a.scenes[0].why, why);
  assert.equal('why' in a.scenes[1], false);
  const b = selectRun(run, cfg, { reasons: { scenes: { S001: { reasons: ['chased'], why } } } });
  assert.equal(b.scenes[0].why, null);
});

test('scenesNeedingMoments: never asked, or asked without a clause the current reasons need', () => {
  const tags = { scenes: [{ id: 'S001', flagged: true, flag_reasons: [{ id: 'dies' }] }, { id: 'S002', flagged: true, flag_reasons: [{ id: 'chased' }] }, { id: 'S003', flagged: true, flag_reasons: [{ id: 'dies' }] }, { id: 'S004', flagged: false, flag_reasons: [] }] };
  const saved = { scenes: { S002: { answers: [{ clause: 'a character dies or is killed' }] }, S003: { answers: [{ clause: 'a character dies or is killed' }] } } };
  assert.deepEqual(scenesNeedingMoments({ tags, saved, items: [], cfg }), ['S001', 'S002']);
});

test('parent checks (i) (ii) (iii) on a toy key', () => {
  const key = { items: [
    { id: 'R1', mappable: true, start_ms: 0, end_ms: 10000, should_flag: true, wordless: true },
    { id: 'R2', mappable: true, start_ms: 50000, end_ms: 60000, should_flag: true, wordless: false },
    { id: 'R3', mappable: true, start_ms: 50000, end_ms: 60000, should_flag: 'tag_only', wordless: true },
  ] };
  const flagged = [{ id: 'S1', start_ms: 0, end_ms: 20000 }];
  assert.deepEqual(checkWordlessPeaks(key, flagged, [[0, 8500]]), { n: 1, covered: 1, missed: [] });
  assert.deepEqual(checkWordlessPeaks(key, flagged, [[0, 7000]]), { n: 1, covered: 0, missed: ['R1@S1:0.7'] });
  assert.deepEqual(checkWordlessScenes(key, [{ id: 'S2', start_ms: 40000, end_ms: 70000 }], [[50000, 56000]]), { n: 1, found: 1, missed: [] });
  const w = checkWhy({ scenes: { S1: { sentences: 2, why: { source: 'generated' } }, S2: { sentences: 1, why: { source: 'verified_sentence' } }, S3: { sentences: 0, why: { source: 'generated' } } } }, ['S1', 'S2', 'S3'], { generatedCounts: false });
  assert.deepEqual([w.stated, w.generated, w.unrelated_only, w.nothing], [1, 0, 1, 1]);
});
