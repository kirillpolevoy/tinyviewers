// v10.3 fixes: (a) mortal-danger questions, (b) afraid_for_safety only with a tier-A event, (c) the span bridge,
// (d) the second describe attempt's selection and merge. (e) is test/v103-quote.test.js.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadPolicy, selectScene, withJevThresholds, conceptMap, mortalReasons, tierAEvents, passesGate } from '../select.js';
import { loadSplit } from '../split.js';
import { MORTAL_QS, MORTAL_REASONS, MORTAL_BY_REASON, plannedAsks } from '../mortal.js';
import { lintNoul } from '../lint.js';
import { clauseFor } from '../moments.js';
import { parentPhrase, rankReasons } from '../reasons.js';
import { bridgeSpans } from '../bridge.js';
import { retryScenes, mergeWhy, titleScenes, SYSTEM2, SYSTEM3 } from '../describe2.js';
import { FROZEN_FILES } from '../env.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const POLICY = loadPolicy(path.join(here, '..', 'policy.json'));
const CFG = withJevThresholds(POLICY);
const SPLIT = loadSplit();
const CMAP = conceptMap(SPLIT);
const SONNET = new Set(SPLIT.sonnet_used);
const byOf = (id) => (SONNET.has(id) ? 'sonnet' : 'jev');
const base = (extra = {}) => ({ c: {}, e: {}, s: { laughs: { score: 0 }, danger: { score: 3 } }, mod: {}, ...extra });
const scene = (answers, opts = {}) => selectScene(answers, CFG, { byOf, conceptByV9: CMAP, ...opts });

// ---- (a) ----------------------------------------------------------------------------------------------------
test('(a) the policy keeps only the measured questions (dev/mortal.mjs), ends_life is not kept', () => {
  const kept = POLICY.flag.mortal.questions.map((q) => `${q.q}@${q.state}:${q.t}`);
  assert.deepEqual(kept, ['deadly_fall@LS:0.7', 'fall_height@LS:0.7', 'bomb_on_character@L:0.6', 'blast_near_character@LS:0.6']);
  assert.deepEqual(plannedAsks(POLICY), { LS: ['deadly_fall', 'fall_height', 'blast_near_character'], L: ['bomb_on_character'] });
});
test('(a) every mortal question is a single-condition Noul with trap no-cases, and passes the v10 question lint', () => {
  for (const [k, q] of Object.entries(MORTAL_QS)) {
    assert.equal(q.type, 'noul');
    assert.match(q.instructions, /^In `scene`, /);
    for (const trap of ['laughs', 'game', 'dream', 'story', 'song']) assert.ok(q.criteria.false.includes(trap), `${k} lacks the ${trap} no-case`);
    assert.deepEqual(lintNoul(q), [], `${k} fails the question lint`);
  }
});
test('(a) a kept question at its threshold adds its reason, which passes the gate; below it nothing', () => {
  const s = scene(base({ x: { 'mortal_bomb_on_character@L': 0.87 } }));
  assert.equal(s.flagged, true);
  assert.deepEqual(s.flag_reasons.map((r) => [r.id, r.rule, r.by]), [['bomb_danger', 'mortal_question', 'jev']]);
  assert.equal(passesGate(s.flag_reasons[0], CFG.flag.gating, CMAP), true);
  assert.deepEqual(s.tags.filter((t) => t.id === 'bomb_danger').map((t) => [t.layer, t.level]), [['event', 'act']]);
  assert.equal(scene(base({ x: { 'mortal_bomb_on_character@L': 0.59 } })).flagged, false);
  // a state the policy does not keep does not count
  assert.equal(scene(base({ x: { 'mortal_bomb_on_character@LS': 0.99, 'mortal_ends_life@LS': 0.99 } })).flagged, false);
  // two questions of one reason -> one reason with the higher p
  const f = scene(base({ x: { 'mortal_deadly_fall@LS': 0.72, 'mortal_fall_height@LS': 0.9 } }));
  assert.deepEqual(f.flag_reasons.map((r) => [r.id, r.p]), [['deadly_fall', 0.9]]);
});
test('(a) retold / imagined cancel a mortal reason; comedy does not (the wording excludes it)', () => {
  const imagined = base({ x: { 'mortal_fall_height@LS': 0.9 }, mod: { imagined: 0.95 } });
  assert.equal(scene(imagined).flagged, false);
  const comic = base({ x: { 'mortal_fall_height@LS': 0.9 }, c: { comic_peril: 0.95 }, s: { laughs: { score: 3 }, danger: { score: 1 } } });
  assert.deepEqual(scene(comic).flag_reasons.map((r) => r.id), ['deadly_fall']);
  assert.deepEqual(mortalReasons({ x: { 'mortal_fall_height@LS': 0.9 } }, { flag: { mortal: { enabled: false } } }, {}), []);
});
test('(a) mortal reasons have a moment clause, a parent phrase, a group and severity weights', () => {
  for (const r of Object.values(MORTAL_REASONS)) {
    assert.ok(clauseFor({ id: r.id }, []).length > 10);
    assert.equal(parentPhrase({ id: r.id }), MORTAL_BY_REASON[r.id].phrase);
    assert.equal(r.group, 'peril');
    assert.equal(r.weights['5-7'], 3);
  }
  assert.equal(rankReasons([{ id: 'chased', group: 'peril', p: 0.7 }, { id: 'bomb_danger', group: 'peril', p: 0.8 }])[0].id, 'bomb_danger');
});

// ---- (b) ----------------------------------------------------------------------------------------------------
test('(b) afraid_for_safety alone stays a tag (gated), as in v10.2', () => {
  const s = scene(base({ c: { afraid_for_safety: 0.95 } }));
  assert.equal(s.flagged, false);
  assert.deepEqual(s.gated_reasons.map((r) => r.id), ['afraid_for_safety']);
});
test('(b) with a tier-A event at act (chased) it flags with it, marked cooccur', () => {
  const s = scene(base({ c: { afraid_for_safety: 0.95, chased: 0.95 } }));
  assert.deepEqual(s.flag_reasons.map((r) => r.id).sort(), ['afraid_for_safety', 'chased']);
  const a = s.flag_reasons.find((r) => r.id === 'afraid_for_safety');
  assert.deepEqual(a.cooccur, ['chased']);
  assert.match(a.rule, /\+cooccur$/);
});
test('(b) a tier-B/C event (threatens_harm) or a Sonnet concept is not a tier-A event; a mortal reason is', () => {
  assert.equal(scene(base({ c: { afraid_for_safety: 0.95, threatens_harm: 0.95 } })).flagged, false);
  const withSonnet = scene(base({ c: { afraid_for_safety: 0.95 }, e: { captured: 0.95 } }));
  assert.deepEqual(withSonnet.flag_reasons.map((r) => r.id), ['captured']);
  const withMortal = scene(base({ c: { afraid_for_safety: 0.95 }, x: { 'mortal_bomb_on_character@L': 0.9 } }));
  assert.deepEqual(withMortal.flag_reasons.map((r) => r.id).sort(), ['afraid_for_safety', 'bomb_danger']);
});
test('(b) a tier-A event that is film-level context does not count', () => {
  const tags = [{ id: 'chased', layer: 'event', level: 'act' }];
  assert.deepEqual(tierAEvents(tags, CFG.flag.gating, CMAP, [], new Set(['chased'])), []);
  assert.deepEqual(tierAEvents(tags, CFG.flag.gating, CMAP, [], new Set()), ['chased']);
  assert.deepEqual(tierAEvents([{ id: 'chased', layer: 'event', level: 'possible' }], CFG.flag.gating, CMAP, [], new Set()), []);
});

// ---- (c) ----------------------------------------------------------------------------------------------------
const S = (id, a, b, flagged, spans = null, method = 'moments') => ({ id, start_ms: a, end_ms: b, flagged, ...(flagged ? { skip: { method, spans: (spans ?? [[a, b]]).map(([x, y]) => ({ start_ms: x, end_ms: y })) } } : {}) });
const cue = (i, a, b, text) => ({ index: i, startMs: a, endMs: b, text });
test('(c) gap fill between adjacent flagged scenes when one skip reaches the boundary (Brave S061/S062 shape)', () => {
  const sc = [S('S061', 0, 62000, true, [[14000, 62000]]), S('S062', 62000, 130000, true, [[95000, 124000]])];
  const b = bridgeSpans(sc, { enabled: true, touch_ms: 3000, gap_max_ms: 45000, run_ms: 0 });
  assert.deepEqual(b.S061.added, [{ kind: 'gap_fill', start_ms: 62000, end_ms: 95000 }]);
  assert.deepEqual(b.S061.spans, [{ start_ms: 14000, end_ms: 95000 }]);
  // gap larger than the bound, or neither skip at the boundary -> nothing
  assert.equal(bridgeSpans(sc, { enabled: true, touch_ms: 3000, gap_max_ms: 30000, run_ms: 0 }).S061.added.length, 0);
  const inner = [S('A', 0, 62000, true, [[10000, 40000]]), S('B', 62000, 130000, true, [[80000, 90000]])];
  assert.equal(bridgeSpans(inner, { enabled: true, touch_ms: 3000, gap_max_ms: 45000, run_ms: 0 }).A.added.length, 0);
});
test('(c) run-on into an unflagged neighbour stops at the bound and at the first calm spoken line', () => {
  const sc = [S('S023', 0, 100000, true, [[40000, 100000]]), S('S024', 100000, 200000, false)];
  const cfg = { enabled: true, touch_ms: 3000, gap_max_ms: 45000, run_ms: 45000, run_methods: ['moments'] };
  assert.deepEqual(bridgeSpans(sc, cfg).S023.added, [{ kind: 'run_on', start_ms: 100000, end_ms: 145000 }]);
  const cues = [cue(1, 104000, 106000, '(SPLASH)'), cue(2, 108000, 109000, 'Help!'), cue(3, 120000, 123000, 'We should go home and rest now.')];
  assert.deepEqual(bridgeSpans(sc, { ...cfg, stop_at_speech: true }, cues).S023.added, [{ kind: 'run_on', start_ms: 100000, end_ms: 120000 }]);
  // whole-scene fallbacks are not run on (run_methods), disabled -> spans unchanged
  const whole = [S('X', 0, 100000, true, null, 'whole_scene'), S('Y', 100000, 200000, false)];
  assert.equal(bridgeSpans(whole, cfg).X.added.length, 0);
  assert.deepEqual(bridgeSpans(sc, { enabled: false }).S023.spans, [{ start_ms: 40000, end_ms: 100000 }]);
});
test('(c) run-back into an unflagged previous scene stops after its last calm spoken line', () => {
  const sc = [S('P', 0, 100000, false), S('Q', 100000, 200000, true, [[101000, 150000]])];
  const cues = [cue(1, 60000, 62000, 'That was a lovely dinner, thank you.'), cue(2, 80000, 81000, '(GASPS)')];
  const b = bridgeSpans(sc, { enabled: true, touch_ms: 3000, gap_max_ms: 45000, run_ms: 45000, stop_at_speech: true, run_methods: ['moments'] }, cues);
  assert.deepEqual(b.Q.added, [{ kind: 'run_back', start_ms: 62000, end_ms: 101000 }]);
});
test('(c) the policy bound is the one eval/bridge-select.mjs picked', () => {
  const b = POLICY.spans_bridge;
  assert.deepEqual({ enabled: b.enabled, touch_ms: b.touch_ms, gap_max_ms: b.gap_max_ms, run_ms: b.run_ms, stop_at_speech: b.stop_at_speech, run_methods: b.run_methods }, { enabled: true, touch_ms: 3000, gap_max_ms: 45000, run_ms: 45000, stop_at_speech: true, run_methods: ['moments'] });
});

// ---- (d) ----------------------------------------------------------------------------------------------------
test('(d) retry only flagged scenes whose first text or title failed', () => {
  const tags = { scenes: [{ id: 'A', flagged: true }, { id: 'B', flagged: true }, { id: 'C', flagged: true }, { id: 'D', flagged: false }] };
  const why = { scenes: { A: { why: { text: 'x', title_source: 'sonnet_verified' } }, B: { why: { text: null, title_source: 'none' } }, C: { why: { text: 'y', title_source: 'none' } } } };
  assert.deepEqual(retryScenes(tags, why), [{ id: 'B', need: ['text', 'title'] }, { id: 'C', need: ['title'] }]);
});
test('(d) merge: first attempt wins when verified; the second fills only what failed; nothing unchecked', () => {
  const w1 = { source: 'described_only', title: 'Flagged scene', title_source: 'none', text: 'First.', sentences: ['S1.d1'] };
  const w2 = { source: 'described_only', title: 'Nemo cries for help', title_source: 'sonnet_verified', text: 'Second.', sentences: ['S1.d1'] };
  const m = mergeWhy(w1, w2);
  assert.equal(m.text, 'First.'); assert.equal(m.text_attempt, 1);
  assert.equal(m.title, 'Nemo cries for help'); assert.equal(m.title_attempt, 2);
  const none = mergeWhy({ ...w1, text: null, sentences: [] }, { ...w2, text: null, title_source: 'none', title: 'Flagged scene', sentences: [] });
  assert.equal(none.text, null); assert.equal(none.title, 'Flagged scene'); assert.equal(none.title_source, 'none');
  const t2 = mergeWhy({ ...w1, text: null, sentences: [] }, w2);
  assert.equal(t2.text, 'Second.'); assert.equal(t2.text_attempt, 2); assert.deepEqual(t2.sentences, ['a2:S1.d1']);
  assert.equal(mergeWhy(w1, null).title_source, 'none');
});
test('(d) title pass: only scenes with a verified text and no verified title; its title is used last', () => {
  const tags = { scenes: [{ id: 'A', flagged: true }, { id: 'B', flagged: true }, { id: 'C', flagged: true }] };
  const chk = (key, final) => ({ key, text: key, cites: ['L1'], final });
  const why1 = { scenes: { A: { reasons: ['x'], why: { text: 'a', title_source: 'none' }, checked: [chk('A.d1', 'verified'), chk('A.d2', 'unverified')] }, B: { reasons: ['x'], why: { text: 'b', title_source: 'sonnet_verified', title: 't' }, checked: [] }, C: { reasons: ['x'], why: { text: null, title_source: 'none' }, checked: [] } } };
  const why2 = { scenes: { C: { reasons: ['x'], why: { text: 'c2', title_source: 'none', sentences: ['C.d1'] }, checked: [chk('C.d1', 'verified')] } } };
  assert.deepEqual(titleScenes(tags, why1, why2).map((x) => [x.id, x.confirmed.map((c) => c.text)]), [['A', ['A.d1']], ['C', ['C.d1']]]);
  const m = mergeWhy({ text: 'a', title_source: 'none', sentences: ['A.d1'] }, { text: null, title_source: 'sonnet_verified', title: 'T2' }, { title_source: 'sonnet_verified', title: 'T3' });
  assert.equal(m.title, 'T2'); assert.equal(m.title_attempt, 2);
  const m3 = mergeWhy({ text: 'a', title_source: 'none', sentences: ['A.d1'] }, null, { title_source: 'sonnet_verified', title: 'T3' });
  assert.equal(m3.title, 'T3'); assert.equal(m3.title_attempt, 3); assert.equal(m3.text, 'a');
  assert.match(SYSTEM3, /AT MOST 7 WORDS/); assert.match(SYSTEM3, /do NOT use your own knowledge or memory/);
});
test('(d) the retry prompt keeps the source rule and the no-memory rule', () => {
  assert.match(SYSTEM2, /Use ONLY the numbered sources/);
  assert.match(SYSTEM2, /Do NOT use your own knowledge or memory of this film/);
  assert.match(SYSTEM2, /at most eight words/);
});
test('freeze list covers the v10.3 files', () => {
  for (const f of ['mortal.js', 'describe2.js', 'bridge.js', 'select.js', 'policy.json', 'check-describe.js', 'validate.js', 'run-film.js']) assert.ok(FROZEN_FILES.includes(f), f);
});
