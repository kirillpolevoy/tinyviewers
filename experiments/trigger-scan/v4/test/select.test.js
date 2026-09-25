// node --test test/  — select.js is pure; these build synthetic Jev answers and check the policy.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { selectScene, selectRun, filmChips, thresholdsFor, loadConfig } from '../select.js';
import { buildQuestions, questionCounts, PRESENCE, EVENTS, SCORES, KIND, castForScene, stateFor } from '../questions.js';
import { checkSegments, unpackAnswers, planScene } from '../classify.js';

const cfg = loadConfig();

/** All-zero answers in classify.js's unpacked shape, then overrides like {'pl.shark': 0.9}. */
function answers(over = {}, kind = { choice: 'none', confidence: 1 }) {
  const a = { pl: {}, ps: {}, m: {}, e: {}, mod: {}, s: {}, kind: { ...kind, probabilities: {} } };
  for (const p of PRESENCE) { a.pl[p.id] = 0; a.ps[p.id] = 0; if (p.mention) a.m[p.id] = 0; }
  for (const e of EVENTS) a.e[e.id] = 0;
  for (const m of ['retold', 'imagined', 'comic', 'child_in_trouble']) a.mod[m] = 0;
  for (const [id, s] of Object.entries(SCORES)) a.s[id] = { score: 0, top: s.levels.length - 1, confidence: 1, probabilities: {}, mode: 0 };
  for (const [k, v] of Object.entries(over)) {
    const [ch, id] = k.split('.');
    if (ch === 's') a.s[id].score = v; else a[ch][id] = v;
  }
  return a;
}
const tag = (r, id) => r.tags.find((t) => t.id === id);

test('calm scene: no tags, not flagged, severity 0', () => {
  const r = selectScene(answers(), cfg);
  assert.equal(r.flagged, false);
  assert.equal(r.tags.length, 0);
  assert.equal(r.severity['5-7'].level, 0);
  assert.equal(r.severity['8-10'].level, 0);
});

test('presence source: lines, summary, both; possible band; film knowledge marker', () => {
  const r = selectScene(answers({ 'pl.fire': 0.8, 'ps.gun': 0.9, 'pl.explosion': 0.75, 'ps.explosion': 0.72, 'pl.storm': 0.5 }), cfg, { known_from_film: true });
  assert.equal(tag(r, 'fire').source, 'lines');
  assert.equal(tag(r, 'gun').source, 'summary');
  assert.equal(tag(r, 'gun').from_film_knowledge, true);
  assert.equal(tag(r, 'fire').from_film_knowledge, undefined);
  assert.equal(tag(r, 'explosion').source, 'both');
  assert.equal(tag(r, 'storm').level, 'possible');
  assert.deepEqual(r.flag_reasons.sort(), ['explosion', 'fire', 'gun']);
});

test('tags are ranked: act before possible, then by probability', () => {
  const r = selectScene(answers({ 'pl.fire': 0.71, 'e.chased': 0.95, 'pl.storm': 0.69, 'e.crying': 0.45 }), cfg);
  assert.deepEqual(r.tags.map((t) => t.id), ['chased', 'fire', 'storm', 'crying']);
});

test('mention-only requires both presence channels below band_low', () => {
  const r1 = selectScene(answers({ 'm.shark': 0.99 }), cfg);
  assert.deepEqual(r1.mentioned_only.map((m) => m.id), ['shark']);
  assert.equal(r1.flagged, false, 'mention never flags');
  const r2 = selectScene(answers({ 'm.shark': 0.99, 'pl.shark': 0.5 }, { choice: 'shark', confidence: 0.95 }), cfg);
  assert.equal(r2.mentioned_only.length, 0);
});

test('friendly / setting presences never flag on their own', () => {
  const r = selectScene(answers({ 'pl.deep_dark_water': 0.95, 'ps.robot_machine_being': 0.99, 'pl.darkness': 0.9 }), cfg);
  assert.equal(r.tags.length, 3);
  assert.equal(r.flagged, false);
});

test('retold cancels physical events, never presence; emotional events survive', () => {
  const r = selectScene(answers({ 'e.chased': 0.9, 'e.crying': 0.9, 'pl.monster_creature': 0.9, 'mod.retold': 0.85 }, { choice: 'monster', confidence: 0.97 }), cfg);
  assert.equal(tag(r, 'chased'), undefined);
  assert.deepEqual(r.cancelled.map((c) => [c.id, c.by]), [['chased', ['retold']]]);
  assert.ok(tag(r, 'crying'));
  assert.ok(tag(r, 'monster_creature'));
  assert.equal(r.flagged, true);
});

test('comic cancels threats and yelling but not mockery or slapstick', () => {
  const r = selectScene(answers({ 'e.threatens_harm': 0.9, 'e.rages_at_child': 0.9, 'e.mocked': 0.9, 'e.slapstick': 0.9, 'mod.comic': 0.8 }), cfg);
  assert.deepEqual(r.cancelled.map((c) => c.id).sort(), ['rages_at_child', 'threatens_harm']);
  assert.ok(tag(r, 'mocked'));
  assert.ok(tag(r, 'slapstick'));
});

test('imagined cancels the chase in a dream but not the nightmare itself', () => {
  const r = selectScene(answers({ 'e.chased': 0.9, 'e.nightmare': 0.9, 'mod.imagined': 0.9 }), cfg);
  assert.equal(tag(r, 'chased'), undefined);
  assert.ok(tag(r, 'nightmare'));
});

test('a modifier below modifier_act cancels nothing', () => {
  const r = selectScene(answers({ 'e.chased': 0.9, 'mod.retold': 0.69 }), cfg);
  assert.ok(tag(r, 'chased'));
  assert.equal(r.cancelled.length, 0);
});

test('kind gate: confident agreement keeps the specific tag', () => {
  const r = selectScene(answers({ 'pl.shark': 0.9 }, { choice: 'shark', confidence: 0.95 }), cfg);
  assert.equal(tag(r, 'shark').level, 'act');
  assert.equal(tag(r, 'shark').kind, 'shark');
  assert.equal(tag(r, 'animal_creature'), undefined);
});

test('kind gate: barracuda read as shark -> shark dropped, parent tag with the real kind', () => {
  const r = selectScene(answers({ 'pl.shark': 0.85 }, { choice: 'other_fish', confidence: 0.99 }), cfg);
  assert.equal(tag(r, 'shark'), undefined);
  assert.deepEqual(r.vetoed.map((v) => [v.id, v.reason, v.kind]), [['shark', 'kind_mismatch', 'other_fish']]);
  const p = tag(r, 'animal_creature');
  assert.equal(p.level, 'act');
  assert.deepEqual(p.detail, ['other_fish']);
  assert.equal(p.group, 'creatures_figures');
  assert.equal(r.flagged, true);
});

test('kind gate: unsure Choice -> parent tag at act, specific kept as possible', () => {
  const r = selectScene(answers({ 'ps.shark': 0.9 }, { choice: 'shark', confidence: 0.6 }), cfg);
  assert.equal(tag(r, 'shark').level, 'possible');
  assert.equal(tag(r, 'animal_creature').level, 'act');
  assert.deepEqual(tag(r, 'animal_creature').detail, ['shark?']);
});

test('kind gate: confident none drops the tag without a parent', () => {
  const r = selectScene(answers({ 'pl.monster_creature': 0.8 }, { choice: 'none', confidence: 0.95 }), cfg);
  assert.equal(tag(r, 'monster_creature'), undefined);
  assert.equal(tag(r, 'animal_creature'), undefined);
  assert.equal(r.flagged, false);
});

test('kind gate: several gated items share one parent tag; ungated items ignore the Choice', () => {
  const r = selectScene(answers({ 'pl.shark': 0.9, 'ps.large_predator': 0.8, 'pl.spider_insect': 0.9 }, { choice: 'monster', confidence: 0.95 }), cfg);
  assert.equal(r.tags.filter((t) => t.id === 'animal_creature').length, 1);
  assert.deepEqual(tag(r, 'animal_creature').from.sort(), ['large_predator', 'shark']);
  assert.ok(tag(r, 'spider_insect'));
});

test('per-question override changes only that question', () => {
  const c = { ...cfg, overrides: { 'pl.fire': { act: 0.9 } } };
  assert.equal(thresholdsFor(c, 'pl.fire').act, 0.9);
  assert.equal(thresholdsFor(c, 'ps.fire').act, cfg.act);
  const r = selectScene(answers({ 'pl.fire': 0.8, 'ps.fire': 0.1 }), c);
  assert.equal(tag(r, 'fire').level, 'possible');
});

test('severity: monotone in the scores, raised by content, lowered by modifiers', () => {
  const mild = selectScene(answers({ 's.danger': 2, 's.distress': 1, 'e.chased': 0.8 }), cfg).severity;
  const bad = selectScene(answers({ 's.danger': 4, 's.harm': 3, 's.distress': 3, 's.share': 3, 's.resolution': 3, 'e.dies': 0.9 }), cfg).severity;
  const badComic = selectScene(answers({ 's.danger': 4, 's.harm': 3, 's.distress': 3, 's.share': 3, 's.resolution': 3, 'e.dies': 0.9, 'mod.comic': 0.9 }), cfg).severity;
  for (const b of ['5-7', '8-10']) {
    assert.ok(bad[b].score > mild[b].score, b);
    assert.ok(badComic[b].score < bad[b].score, b);
    assert.ok(bad[b].score <= 1 && bad[b].score >= 0);
  }
  assert.equal(bad['5-7'].level, 3);
  assert.deepEqual(badComic['5-7'].scaled_by, ['comic']);
});

test('severity: child_in_trouble lifts 5-7 only', () => {
  const base = selectScene(answers({ 's.danger': 3, 'e.chased': 0.9 }), cfg).severity;
  const kid = selectScene(answers({ 's.danger': 3, 'e.chased': 0.9, 'mod.child_in_trouble': 0.9 }), cfg).severity;
  assert.ok(kid['5-7'].score > base['5-7'].score);
  assert.equal(kid['8-10'].score, base['8-10'].score);
});

test('film chips count flagged scenes per group once, and skip unflagged/unclassified scenes', () => {
  const run = {
    film: { slug: 'x' }, run: 'r1', question_set: {},
    scenes: [
      { id: 'S001', start_ms: 0, end_ms: 1000, answers: answers({ 'e.chased': 0.9, 'e.attacked': 0.9 }) },
      { id: 'S002', start_ms: 1000, end_ms: 3000, answers: answers({ 'e.chased': 0.9, 'e.crying': 0.8 }) },
      { id: 'S003', start_ms: 3000, end_ms: 4000, answers: answers({ 'pl.deep_dark_water': 0.9, 'm.shark': 0.9 }) },
      { id: 'S004', skipped: 'cap' },
    ],
  };
  const out = selectRun(run, cfg);
  assert.equal(out.summary.flagged, 2);
  assert.equal(out.summary.flagged_ms, 3000);
  assert.equal(out.summary.unclassified, 1);
  const chip = (g) => out.summary.chips.find((c) => c.group === g)?.scenes;
  assert.equal(chip('peril'), 2, 'chased + attacked in one scene count once');
  assert.equal(chip('distress'), 1);
  assert.equal(chip('objects_hazards'), undefined, 'deep water alone did not flag S003');
  assert.equal(out.summary.tag_counts.chased, 2);
  assert.equal(out.summary.mentioned_only_counts.shark, 1);
  assert.deepEqual(filmChips([]).chips, []);
});

// ---- config and question-set invariants --------------------------------------------------------

test('every presence id is in exactly one of parents_care_presence / presence_not_flags', () => {
  const care = new Set(cfg.parents_care_presence);
  const not = new Set(Object.keys(cfg.presence_not_flags));
  for (const p of PRESENCE) assert.ok(care.has(p.id) !== not.has(p.id), p.id);
  for (const id of care) assert.ok(PRESENCE.some((p) => p.id === id) || id === cfg.parent_tag.id, `unknown care id ${id}`);
});

test('question set: counts, types, limits, and the none option', () => {
  const q = buildQuestions();
  const c = questionCounts(q);
  assert.equal(c.pl, PRESENCE.length);
  assert.equal(c.ps, PRESENCE.length);
  assert.equal(c.e, EVENTS.length);
  assert.equal(c.kind, 1);
  for (const [k, v] of Object.entries(q)) {
    assert.ok(['noul', 'score', 'choice'].includes(v.type), k);
    if (v.type === 'score') assert.ok(v.criteria.length >= 2 && v.criteria.length <= 10, k);
    if (v.type === 'noul' && k.startsWith('pl.')) assert.match(v.instructions, /`scene\.lines`/, k);
    if (v.type === 'noul' && k.startsWith('ps.')) assert.match(v.instructions, /`scene\.summary`/, k);
  }
  assert.ok('none' in KIND.options && 'other_animal' in KIND.options);
  const ids = [...PRESENCE, ...EVENTS].map((i) => i.id);
  assert.equal(new Set(ids).size, ids.length, 'ids unique across layers');
});

test('cast filter keeps named characters and whom they relate to, falls back to all', () => {
  const cast = [{ name: 'Marlin', role: 'parent', related_to: 'Nemo' }, { name: 'Nemo', role: 'child' }, { name: 'Bruce', role: 'talking_animal' }, { name: 'the barracuda', role: 'animal' }];
  assert.deepEqual(castForScene(cast, 'Marlin swims.', []).map((c) => c.name), ['Marlin', 'Nemo']);
  assert.deepEqual(castForScene(cast, 'A barracuda appears.', []).map((c) => c.name), ['the barracuda']);
  assert.equal(castForScene(cast, 'Fish swim.', ['Hello']).length, 4);
});

test('state carries no timestamps and uses scene-local line ids', () => {
  const { state } = stateFor({ film: { title: 'T', year: 1 }, cast: [], scene: { id: 'S001', setting: 's', summary: 'x' }, cues: [{ text: 'Hi', startMs: 5 }, { text: '(GASPS)', startMs: 9 }] });
  assert.deepEqual(state.scene.lines, ['L01| Hi', 'L02| (GASPS)']);
  assert.ok(!JSON.stringify(state).includes('startMs'));
});

// ---- classify.js pure helpers ------------------------------------------------------------------------

test('checkSegments: contiguity, coverage, fixture partial', () => {
  const seg = (scenes, extra = {}) => ({ film: { slug: 'x' }, cast: [], scenes: scenes.map(([a, b], i) => ({ id: `S${i}`, start_cue: a, end_cue: b, summary: '' })), ...extra });
  assert.doesNotThrow(() => checkSegments(seg([[1, 3], [4, 10]]), 10));
  assert.throws(() => checkSegments(seg([[1, 3], [5, 10]]), 10), /contiguous/);
  assert.throws(() => checkSegments(seg([[1, 3], [4, 9]]), 10), /cover/);
  assert.doesNotThrow(() => checkSegments(seg([[3, 5], [6, 9]], { fixture: { partial: true } }), 10));
  assert.throws(() => checkSegments(seg([[1, 11]]), 10), /SRT has 10/);
});

test('unpackAnswers maps every channel and fails on a missing answer', () => {
  const q = buildQuestions();
  const raw = {};
  for (const [k, v] of Object.entries(q)) {
    if (v.type === 'noul') raw[k] = { type: 'noul', noul: 0.5 };
    else if (v.type === 'score') raw[k] = { type: 'score', score: 1, confidence: 0.8, probabilities: { 0: 0.1, 1: 0.8, 2: 0.1 } };
    else raw[k] = { type: 'choice', choice: 'none', confidence: 1, probabilities: { none: 1 } };
  }
  const a = unpackAnswers(q, raw);
  assert.equal(a.pl.shark, 0.5);
  assert.equal(a.s.danger.mode, 1);
  assert.equal(a.kind.choice, 'none');
  delete raw['e.chased'];
  assert.throws(() => unpackAnswers(q, raw), /missing answer e\.chased/);
});

test('planScene: split layout sends each channel exactly once over three states', () => {
  const args = { film: { title: 'T', year: 1 }, cast: [], scene: { id: 'S1', setting: 's', summary: 'sum' }, cues: [{ text: 'Hi' }] };
  const single = planScene(args);
  const split = planScene({ ...args, layout: 'split' });
  assert.equal(single.length, 1);
  assert.equal(split.length, 3);
  const keys = split.flatMap((r) => Object.keys(r.body.questions)).sort();
  assert.deepEqual(keys, Object.keys(single[0].body.questions).sort());
  assert.equal(split[0].body.state.scene.summary, undefined);
  assert.equal(split[1].body.state.scene.lines, undefined);
  for (const r of [...single, ...split]) assert.ok(r.reserveUsd > 0 && r.body.model === 'jev-1.13.0');
});
