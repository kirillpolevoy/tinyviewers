// node --test test/  — select.js is pure; synthetic Jev answers in classify.js's unpacked shape.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { selectScene, selectRun, sceneTags, filmContext, skipFor, loadPolicy } from '../select.js';
import { PRESENCE, EVENTS, SCORES, MODIFIERS } from '../questions.js';

const cfg = loadPolicy();

/** Score answer at an exact level (all probability on it). */
const at = (level, top) => ({ score: level, top, confidence: 1, probabilities: Object.fromEntries(Array.from({ length: top + 1 }, (_, i) => [String(i), i === level ? 1 : 0])) });

/** All-quiet answers, then overrides like {'pl.shark': 0.9, 's.danger': 3}. */
function answers(over = {}, kind = { choice: 'none', confidence: 1 }) {
  const a = { pl: {}, ps: {}, m: {}, e: {}, mod: {}, s: {}, kind: { ...kind, probabilities: {} }, fpl: {}, fps: {}, fe: {} };
  for (const p of PRESENCE) { a.pl[p.id] = 0; a.ps[p.id] = 0; if (p.mention) a.m[p.id] = 0; }
  for (const e of EVENTS) a.e[e.id] = 0;
  for (const m of Object.keys(MODIFIERS)) a.mod[m] = 0;
  for (const [id, s] of Object.entries(SCORES)) a.s[id] = at(0, s.levels.length - 1);
  for (const [k, v] of Object.entries(over)) {
    const [ch, id] = [k.slice(0, k.indexOf('.')), k.slice(k.indexOf('.') + 1)];
    if (ch === 's') a.s[id] = typeof v === 'number' ? at(v, SCORES[id].levels.length - 1) : v;
    else if (a[ch] === null) continue;
    else a[ch][id] = v;
  }
  return a;
}
const tag = (r, id) => r.tags.find((t) => t.id === id);
const reasons = (r) => r.flag_reasons.map((x) => x.id);

const ITEMS = [
  { entity: 'C01', name: 'Vera', id: 'C01_present', type: 'presence', group: 'creatures_figures', label: 'Vera' },
  { entity: 'C01', name: 'Vera', id: 'C01_threatens', type: 'threatens', group: 'hostility', label: 'Vera threatens someone', weights: { '5-7': 3, '8-10': 3 }, cancel: { retold: true, imagined: true }, moment: 'Vera threatens, chases, or attacks someone' },
  { entity: 'C02', name: 'Lou', id: 'C02_in_danger', type: 'child_in_danger', group: 'peril', label: 'Lou in danger', weights: { '5-7': 3, '8-10': 2 }, cancel: { retold: true, imagined: true }, moment: 'Lou is in danger' },
];

test('calm scene: no tags, not flagged, severity 0', () => {
  const r = selectScene(answers(), cfg);
  assert.equal(r.flagged, false);
  assert.equal(r.tags.length, 0);
  assert.equal(r.severity['5-7'].level, 0);
  assert.equal(r.skip, undefined);
});

test('comic screams: a scream is a tag and never flags; fear flags only with danger present', () => {
  const r = selectScene(answers({ 'e.screams': 0.95, 's.laughs': 3 }), cfg);
  assert.equal(tag(r, 'screams').level, 'act');
  assert.equal(r.flagged, false);
  assert.equal(r.modifiers.comic.on, true);
  const fearNoDanger = selectScene(answers({ 'e.afraid_for_safety': 0.9, 's.danger': 1 }), cfg);
  assert.equal(fearNoDanger.flagged, false, 'fear with no danger here stays a tag');
  assert.equal(tag(fearNoDanger, 'afraid_for_safety').level, 'act');
  const fearDanger = selectScene(answers({ 'e.afraid_for_safety': 0.9, 's.danger': 3 }), cfg);
  assert.deepEqual(reasons(fearDanger), ['afraid_for_safety']);
});

test('possible band (0.40-0.70) never flags; weak events never flag', () => {
  const r = selectScene(answers({ 'e.attacked': 0.65, 'e.parent_searching': 0.95, 'e.crying': 0.9, 'e.mocked': 0.9, 's.danger': 4 }), cfg);
  assert.equal(tag(r, 'attacked').level, 'possible');
  assert.equal(r.flagged, false);
  const s = selectScene(answers({ 'e.attacked': 0.75 }), cfg);
  assert.deepEqual(reasons(s), ['attacked']);
});

test('friendly presences never flag: a monster or shark flags only with a creature threat', () => {
  const friendly = selectScene(answers({ 'pl.monster_creature': 0.95, 'ps.monster_creature': 0.95, 'ps.shark': 0.9 }), cfg);
  assert.equal(tag(friendly, 'monster_creature').source, 'both');
  assert.equal(tag(friendly, 'shark').source, 'summary');
  assert.equal(friendly.flagged, false);
  const threat = selectScene(answers({ 'pl.monster_creature': 0.95, 'e.creature_threat': 0.9 }, { choice: 'monster', confidence: 0.95 }), cfg);
  assert.deepEqual(reasons(threat).sort(), ['creature_threat', 'monster_creature']);
  // robot never flags, even at 0.99
  assert.equal(selectScene(answers({ 'pl.robot_machine_being': 0.99 }), cfg).flagged, false);
  // macabre presence flags on sight; hazards need the danger Score
  assert.deepEqual(reasons(selectScene(answers({ 'pl.dead_body': 0.9 }), cfg)), ['dead_body']);
  assert.equal(selectScene(answers({ 'pl.fire': 0.9, 's.danger': 1 }), cfg).flagged, false);
  assert.deepEqual(reasons(selectScene(answers({ 'pl.fire': 0.9, 's.danger': 2 }), cfg)), ['fire']);
});

test('kind gate: a confident different species moves shark to the parent tag; none never vetoes', () => {
  const r = selectScene(answers({ 'pl.shark': 0.9 }, { choice: 'other_fish', confidence: 0.95 }), cfg);
  assert.equal(tag(r, 'shark'), undefined);
  assert.equal(tag(r, 'animal_creature').detail[0], 'other_fish');
  const n = selectScene(answers({ 'pl.shark': 0.9 }, { choice: 'none', confidence: 0.99 }), cfg);
  assert.equal(tag(n, 'shark').level, 'act');
  const unsure = selectScene(answers({ 'pl.shark': 0.9 }, { choice: 'other_fish', confidence: 0.5 }), cfg);
  assert.equal(tag(unsure, 'shark').level, 'act');
});

test('retold cancels physical events only when the danger Score says the danger is not here', () => {
  const told = selectScene(answers({ 'e.attacked': 0.9, 'mod.retold': 0.97, 's.danger': 1 }), cfg);
  assert.equal(told.flagged, false);
  assert.deepEqual(told.cancelled.map((c) => [c.id, c.by]), [['attacked', ['retold']]]);
  const happening = selectScene(answers({ 'e.attacked': 0.9, 'mod.retold': 0.97, 's.danger': 4 }), cfg);
  assert.deepEqual(reasons(happening), ['attacked']);
  // policy v5.1: a scene that only partly retells the past (retold 0.9 < 0.95) keeps its live events
  assert.deepEqual(reasons(selectScene(answers({ 'e.attacked': 0.9, 'mod.retold': 0.9, 's.danger': 1 }), cfg)), ['attacked']);
  // believed_dead has no retold cancel: the belief happens now
  assert.deepEqual(reasons(selectScene(answers({ 'e.believed_dead': 0.9, 'mod.retold': 0.97, 's.danger': 0 }), cfg)), ['believed_dead']);
});

test('imagined cancels physical events and film threats; comic cancels only yelling (v6: never a threat)', () => {
  const dream = selectScene(answers({ 'e.chased': 0.9, 'fe.C01_threatens': 0.9, 'mod.imagined': 0.85 }), cfg, { items: ITEMS });
  assert.equal(dream.flagged, false);
  assert.deepEqual(dream.cancelled.map((c) => c.id).sort(), ['C01_threatens', 'chased']);
  const comic = selectScene(answers({ 'e.threatens_harm': 0.9, 'e.rages_at_child': 0.9, 'e.attacked': 0.9, 's.laughs': 3 }), cfg);
  assert.deepEqual(comic.cancelled.map((c) => c.id), ['rages_at_child']);
  assert.deepEqual(reasons(comic).sort(), ['attacked', 'threatens_harm']);
});

test('user policy (1): a threat or plan to kill or hurt flags with no physical action; comic and retold never cancel it', () => {
  assert.deepEqual(reasons(selectScene(answers({ 'e.threatens_harm': 0.85 }), cfg)), ['threatens_harm']);
  assert.deepEqual(reasons(selectScene(answers({ 'e.plots_harm': 0.85 }), cfg)), ['plots_harm']);
  // a comic villain, in a scene that also retells the past, danger only talked about
  const r = selectScene(answers({ 'e.threatens_harm': 0.9, 'e.plots_harm': 0.8, 'e.comic_peril': 0.9, 's.laughs': 3, 'mod.retold': 0.99, 's.danger': 0 }), cfg);
  assert.deepEqual(reasons(r).sort(), ['plots_harm', 'threatens_harm']);
  assert.equal(r.modifiers.retold.on, true);
  assert.equal(r.modifiers.comic_peril.on, true);
  // film-specific villain threat: not cancelled by retold (v5 carried cancel: retold) or comic peril
  const f = selectScene(answers({ 'fe.C01_threatens': 0.8, 'mod.retold': 0.99, 's.danger': 0, 'e.comic_peril': 0.9, 's.laughs': 3 }), cfg, { items: ITEMS });
  assert.deepEqual(reasons(f), ['C01_threatens']);
  // the possible band never flags
  assert.equal(selectScene(answers({ 'e.threatens_harm': 0.6 }), cfg).flagged, false);
});

test('user policy (2): a child frightened or crying flags with no danger; an adult\'s fear needs danger', () => {
  const child = selectScene(answers({ 'e.child_frightened': 0.8, 's.danger': 0, 's.laughs': 3, 'e.comic_peril': 0.9 }), cfg);
  assert.deepEqual(reasons(child), ['child_frightened']);
  assert.equal(selectScene(answers({ 'e.afraid_for_safety': 0.9, 's.danger': 1 }), cfg).flagged, false);
  assert.equal(selectScene(answers({ 'e.crying': 0.95 }), cfg).flagged, false, 'crying alone (anyone) is a tag');
});

test('user policy (3): comic peril (three literal signals) turns physical peril into tags; never deaths or a child\'s fear', () => {
  const on = answers({ 'e.chased': 0.9, 'e.caught_in_hazard': 0.8, 'pl.heights': 0.9, 'e.comic_peril': 0.8, 's.laughs': 2, 's.danger': 2 });
  const r = selectScene(on, cfg);
  assert.equal(r.modifiers.comic_peril.on, true);
  assert.equal(r.flagged, false);
  assert.deepEqual(r.cancelled.map((c) => c.id).sort(), ['caught_in_hazard', 'chased']);
  assert.ok(tag(r, 'comic_peril'), 'comic peril itself is a tag');
  // any one signal missing: the peril flags as before
  assert.deepEqual(reasons(selectScene(answers({ 'e.chased': 0.9, 'e.comic_peril': 0.8, 's.laughs': 1, 's.danger': 2 }), cfg)), ['chased']);
  assert.deepEqual(reasons(selectScene(answers({ 'e.chased': 0.9, 'e.comic_peril': 0.6, 's.laughs': 3, 's.danger': 2 }), cfg)), ['chased']);
  assert.deepEqual(reasons(selectScene(answers({ 'e.chased': 0.9, 'e.comic_peril': 0.9, 's.laughs': 3, 's.danger': 3 }), cfg)), ['chased'], 'danger >= 2.5 is real peril');
  // deaths and a child's fear are never comic
  assert.deepEqual(reasons(selectScene(answers({ 'e.dies': 0.9, 'e.child_frightened': 0.9, 'e.comic_peril': 0.9, 's.laughs': 3, 's.danger': 2 }), cfg)).sort(), ['child_frightened', 'dies']);
  // slapstick is a tag only
  assert.equal(selectScene(answers({ 'e.slapstick': 0.95, 's.laughs': 3 }), cfg).flagged, false);
  // film child-in-danger is physical: comic peril cancels it
  assert.equal(selectScene(answers({ 'fe.C02_in_danger': 0.9, 'e.comic_peril': 0.9, 's.laughs': 3, 's.danger': 2 }), cfg, { items: ITEMS }).flagged, false);
});

test('film-specific: threat / child in danger flag; villain presence alone is a tag', () => {
  const present = selectScene(answers({ 'fpl.C01_present': 0.95 }), cfg, { items: ITEMS });
  assert.equal(present.flagged, false);
  assert.equal(present.film_tags[0].id, 'C01_present');
  assert.equal(present.film_tags[0].source, 'lines');
  const threat = selectScene(answers({ 'fpl.C01_present': 0.95, 'fe.C01_threatens': 0.85, 'fe.C02_in_danger': 0.8, 's.danger': 3 }), cfg, { items: ITEMS });
  assert.deepEqual(reasons(threat).sort(), ['C01_threatens', 'C02_in_danger']);
  assert.ok(threat.flag_reasons.every((x) => x.film_specific));
  // policy v5.1: a film-specific child-in-danger item needs the danger Score >= 2
  const calm = selectScene(answers({ 'fe.C02_in_danger': 0.8, 's.danger': 1 }), cfg, { items: ITEMS });
  assert.equal(calm.flagged, false);
  assert.ok(calm.film_tags.some((t) => t.id === 'C02_in_danger'));
});

test('v6: no dangerous_machine stopgap (one caption rule in questions.js); ghosts and the undead need danger (friendly presences never flag)', () => {
  assert.equal(cfg.flag.requires.dangerous_machine, undefined);
  assert.deepEqual(reasons(selectScene(answers({ 'pl.dangerous_machine': 0.9, 's.danger': 3 }), cfg)), ['dangerous_machine']);
  assert.equal(selectScene(answers({ 'pl.dangerous_machine': 0.9, 's.danger': 1 }), cfg).flagged, false);
  for (const id of ['reanimated_dead', 'ghost_spirit']) {
    assert.equal(selectScene(answers({ [`pl.${id}`]: 0.9, 's.danger': 1 }), cfg).flagged, false, `${id} alone`);
    assert.deepEqual(reasons(selectScene(answers({ [`pl.${id}`]: 0.9, 's.danger': 3 }), cfg)), [id]);
  }
  assert.deepEqual(reasons(selectScene(answers({ 'pl.dead_body': 0.9 }), cfg)), ['dead_body'], 'macabre sights still flag on sight');
});

test('v6: generated danger items need the danger Score >= 2; scenes cover the gaps; no drop_generated stopgap', () => {
  const items = [...ITEMS, { entity: 'D01', name: 'the drought', id: 'D01_endangers', type: 'danger', group: 'peril', label: 'the drought endangers someone', weights: { '5-7': 3, '8-10': 3 }, moment: 'x' }];
  assert.equal(selectScene(answers({ 'fe.D01_endangers': 0.9, 's.danger': 1 }), cfg, { items }).flagged, false);
  assert.deepEqual(reasons(selectScene(answers({ 'fe.D01_endangers': 0.9, 's.danger': 3 }), cfg, { items })), ['D01_endangers']);
  assert.equal(cfg.film_specific.drop_generated, undefined);
  const run = { film: { slug: 'x' }, run: 'r1', film_items: items, scenes: [
    { id: 'S001', start_cue: 1, end_cue: 2, start_ms: 5000, end_ms: 20000, answers: answers({ 'e.chased': 0.9 }) },
    { id: 'S002', start_cue: 3, end_cue: 4, start_ms: 30000, end_ms: 40000, answers: answers() },
  ] };
  const out = selectRun(run, cfg);
  assert.deepEqual([out.scenes[0].start_ms, out.scenes[0].end_ms, out.scenes[0].line_start_ms, out.scenes[0].line_end_ms], [0, 30000, 5000, 20000]);
  assert.deepEqual([out.scenes[1].start_ms, out.scenes[1].end_ms], [30000, 40000]);
});

test('v6: whole-scene skips extend back over a silence before a first line that reacts to action (<= 60 s)', () => {
  const cues = [
    { index: 1, startMs: 1000, endMs: 3000, text: 'Hello there.' },
    { index: 2, startMs: 4000, endMs: 6000, text: 'Nice day.' },
    { index: 3, startMs: 50000, endMs: 51000, text: '(SCREAMS)' },
    { index: 4, startMs: 52000, endMs: 54000, text: 'Help me!' },
  ];
  const run = { film: { slug: 'x' }, run: 'r1', scenes: [
    { id: 'S001', start_cue: 1, end_cue: 2, start_ms: 1000, end_ms: 6000, answers: answers() },
    { id: 'S002', start_cue: 3, end_cue: 4, start_ms: 50000, end_ms: 54000, answers: answers({ 'e.attacked': 0.9 }) },
  ] };
  const out = selectRun(run, cfg, { cues });
  assert.deepEqual(out.scenes[1].skip.spans.map((x) => [x.start_ms, x.end_ms]), [[6000, 54000]], 'back to the end of the previous line (44 s of silence)');
  const quiet = structuredClone(cues); quiet[2].text = 'So anyway.';
  assert.deepEqual(selectRun(run, cfg, { cues: quiet }).scenes[1].skip.spans.map((x) => [x.start_ms, x.end_ms]), [[50000, 54000]], 'no reaction: no lead-in');
});

test('summary channel missing (no verified sentence): presence source is lines only', () => {
  const a = answers({ 'pl.fire': 0.9, 'fpl.C01_present': 0.9 });
  a.ps = null; a.fps = null;
  const r = selectScene(a, cfg, { items: ITEMS });
  assert.equal(tag(r, 'fire').source, 'lines');
  assert.equal(tag(r, 'fire').p_summary, undefined);
  assert.equal(tag(r, 'C01_present').source, 'lines');
});

test('jump_scare is derived from both halves and never flags', () => {
  assert.equal(tag(selectScene(answers({ 'e.appears_suddenly': 0.9 }), cfg), 'jump_scare'), undefined);
  const r = selectScene(answers({ 'e.appears_suddenly': 0.9, 'e.startled': 0.8 }), cfg);
  assert.equal(tag(r, 'jump_scare').p, 0.8);
  assert.equal(r.flagged, false);
});

test('severity: content term capped (cannot pin a flagged scene to 3), flagged scenes are at least 1', () => {
  // strongest content (weight 3) with a mild scene: base ~0.26 -> level must stay below 3
  const mild = selectScene(answers({ 'e.dies': 0.9, 's.danger': 2, 's.distress': 1 }), cfg);
  assert.ok(mild.flagged);
  for (const b of ['5-7', '8-10']) {
    assert.ok(mild.severity[b].level < 3, `${b} level ${mild.severity[b].level}`);
    assert.ok(mild.severity[b].score - mild.severity[b].base <= cfg.severity.content_cap + 1e-9);
  }
  const minimal = selectScene(answers({ 'pl.dead_body': 0.9 }), cfg);
  assert.equal(minimal.severity['5-7'].level, 1);
  const worst = selectScene(answers({ 'e.attacked': 0.95, 's.danger': 4, 's.harm': 4, 's.distress': 3, 's.share': 3, 's.resolution': 2 }), cfg);
  assert.equal(worst.severity['5-7'].level, 3);
  assert.equal(worst.severity['8-10'].level, 3);
  // laughs is not part of the base
  const withLaughs = selectScene(answers({ 'e.attacked': 0.95, 's.danger': 4, 's.laughs': 1 }), cfg);
  const without = selectScene(answers({ 'e.attacked': 0.95, 's.danger': 4 }), cfg);
  assert.equal(withLaughs.severity['5-7'].base, without.severity['5-7'].base);
});

test('film-level context: an item at act in >= 60% of scenes cannot flag alone', () => {
  const run = { film: { slug: 'x' }, run: 't', question_set: {}, film_items: ITEMS, scenes: [] };
  for (let i = 0; i < 12; i++) {
    const over = { 'pl.monster_creature': 0.95, 'e.afraid_for_safety': i < 8 ? 0.9 : 0, 's.danger': 2 };
    if (i === 0) over['e.attacked'] = 0.9;
    run.scenes.push({ id: `S${String(i + 1).padStart(3, '0')}`, start_cue: i + 1, end_cue: i + 1, start_ms: i * 60000, end_ms: (i + 1) * 60000, answers: answers(over) });
  }
  const out = selectRun(run, cfg);
  assert.deepEqual(out.summary.film_level_notes.map((n) => n.id).sort(), ['afraid_for_safety', 'monster_creature']);
  assert.equal(out.summary.flagged, 1, 'only the scene with a non-context reason');
  assert.deepEqual(reasons(out.scenes[0]), ['attacked']);
  assert.deepEqual(out.scenes[0].context_reasons.map((x) => x.id), ['afraid_for_safety']);
  assert.equal(out.scenes[1].flagged, false);
  assert.ok(out.scenes[1].tags.find((t) => t.id === 'afraid_for_safety').film_level);
  assert.equal(out.summary.chips[0].group, 'peril');
  // fewer than min_scenes: no film-level context at all
  const small = { ...run, scenes: run.scenes.slice(0, 5) };
  assert.equal(selectRun(small, cfg).summary.film_level_notes.length, 0);
  assert.equal(filmContext([], cfg).notes.length, 0);
});

test('skip spans: moments when present, else the whole scene; none for unflagged scenes', () => {
  const scene = { id: 'S001', start_ms: 0, end_ms: 100000 };
  assert.equal(skipFor(scene, false, {}), null);
  assert.deepEqual(skipFor(scene, true, null), { method: 'whole_scene', spans: [{ start_ms: 0, end_ms: 100000 }], ms: 100000 });
  const m = { S001: { method: 'moments', spans: [{ start_ms: 10000, end_ms: 30000 }, { start_ms: 50000, end_ms: 60000 }] } };
  assert.equal(skipFor(scene, true, m).ms, 30000);
  const run = { film: {}, run: 't', scenes: [{ id: 'S001', start_cue: 1, end_cue: 2, start_ms: 0, end_ms: 100000, answers: answers({ 'e.chased': 0.9 }) }] };
  assert.equal(selectRun(run, cfg, { moments: { scenes: m } }).scenes[0].skip.ms, 30000);
  assert.equal(selectRun(run, cfg).summary.skip_ms, 100000);
});

test('sceneTags is pure: same answers, same tags', () => {
  const a = answers({ 'pl.fire': 0.8, 'e.chased': 0.9 });
  assert.deepEqual(sceneTags(a, cfg), sceneTags(structuredClone(a), cfg));
});
