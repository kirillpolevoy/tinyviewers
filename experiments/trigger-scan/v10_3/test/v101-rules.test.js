// v10.1 fixes 3 and 4: rule 2 (a child crying flags) and rule 3 (comedy cancels 'thought dead').
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSrt } from '../../srt.js';
import { loadPolicy, selectScene, selectRun, withJevThresholds, childInvolved } from '../select.js';
import { loadSplit } from '../split.js';
import { EVENTS } from '../questions.js';
import { scenesToAsk, CHILD_CRY_Q } from '../childcry.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const V101 = path.resolve(here, '..');
const TS = path.resolve(V101, '..');
const POLICY = loadPolicy(path.join(V101, 'policy.json'));
// v10.2: the policy layer without the tier-A gate (the gate: test/v102-gate.test.js). Sonnet ids are answered by
// Sonnet (byOf), as select.js's selectRun passes them.
const UNGATED = (() => { const c = structuredClone(POLICY); delete c.flag.gating; return c; })();
const CFG = withJevThresholds(UNGATED);
const base = (extra = {}) => ({ c: {}, e: {}, s: { laughs: { score: 0 }, danger: { score: 0 } }, mod: {}, ...extra });
const rj = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));

test('rule 2 (v10.2): Sonnet crying at act flags only when Jev says the one who cries is a child; a cast child present is not enough', () => {
  assert.ok(POLICY.flag.strong_events.includes('crying'));
  assert.deepEqual(POLICY.flag.requires.crying, { child: { jev_min: 0.5 } });
  const kid = selectScene(base({ e: { crying: 0.8 }, x: { crying_child: 0.77 } }), CFG);
  assert.equal(kid.flagged, true);
  assert.deepEqual(kid.flag_reasons.map((r) => [r.id, r.rule, r.child]), [['crying', 'strong_event', 'jev_child']]);
  const adult = selectScene(base({ e: { crying: 0.8 }, x: { crying_child: 0.2 } }), CFG);
  assert.equal(adult.flagged, false, 'an adult crying stays a tag');
  assert.ok(adult.tags.some((t) => t.id === 'crying' && t.level === 'act'));
  assert.equal(selectScene(base({ e: { crying: 0.6 }, x: { crying_child: 0.99 } }), CFG).flagged, false, 'crying below act never flags');
  // v10.1's route (a) -- a verified cast child's presence tag at act -- no longer flags (Zootopia S005, Stu's sob)
  const items = [{ id: 'C01_present', entity: 'C01', type: 'presence', why: 'child', name: 'Kid', label: 'Kid', group: 'people' }];
  const cast = selectScene(base({ e: { crying: 0.8 }, fpl: { C01_present: 0.9 }, x: { crying_child: 0.27 } }), CFG, { items });
  assert.equal(cast.flagged, false);
  const noAnswer = selectScene(base({ e: { crying: 0.8 }, fpl: { C01_present: 0.9 } }), CFG, { items });
  assert.equal(noAnswer.flagged, false, 'no Jev child answer: a tag');
  assert.equal(childInvolved({ jev_min: 0.5 }, { x: { crying_child: 0.5 } }, []), 'jev_child');
});
test('rule 2: the child question is asked only where Sonnet crying is at act, never on credits scenes', () => {
  assert.equal(CHILD_CRY_Q.type, 'noul');
  const seg = { scenes: [{ id: 'S001', start_cue: 1, end_cue: 2 }, { id: 'S002', start_cue: 3, end_cue: 4 }] };
  const cues = [1, 2, 3, 4].map((i) => ({ index: i, startMs: i * 1000, endMs: i * 1000 + 500, text: `Hi ${i}.` }));
  const sonnet = { scenes: { S001: { crying: { p: 0.8 } }, S002: { crying: { p: 0.35 } } } };
  assert.deepEqual(scenesToAsk({ seg, sonnet, cues, act: 0.7 }), [{ id: 'S001', p: 0.8 }]);
});

test('rule 3: comedy (the laughs Score at comic.on_at) cancels believed_dead; without jokes it still flags', () => {
  assert.deepEqual(EVENTS.find((e) => e.id === 'believed_dead').cancel, { comic: true });
  const prank = selectScene(base({ c: { believed_dead: 0.8 }, s: { laughs: { score: 2.57 }, danger: { score: 0 } } }), CFG);
  assert.equal(prank.flagged, false);
  assert.deepEqual(prank.cancelled.map((c) => [c.id, c.by.join()]), [['believed_dead', 'comic']]);
  const real = selectScene(base({ c: { believed_dead: 0.8 }, s: { laughs: { score: 0.5 }, danger: { score: 1 } } }), CFG);
  assert.deepEqual(real.flag_reasons.map((r) => r.id), ['believed_dead']);
  // real deaths are never cancelled by comedy
  const dies = selectScene(base({ c: { dies: 0.9 }, s: { laughs: { score: 2.8 }, danger: { score: 1 } } }), CFG);
  assert.deepEqual(dies.flag_reasons.map((r) => r.id), ['dies']);
});

// Good Dinosaur (dev since v10.1) through the full v10.1 select path on its round-6 v10 answers
const GD = path.join(TS, 'v10', 'out10');
const CC = path.join(V101, '..', 'v10_1', 'out101', 'dev', 'good-dinosaur.childcry.r1.json');
test('Good Dinosaur: S021 (Arlo crying for his dead father) now flags; S008 (Buck\'s prank) no longer does', { skip: !fs.existsSync(CC) && 'run childcry.js good-dinosaur --in ../v10/out10 first' }, () => {
  const run = rj(path.join(GD, 'good-dinosaur.jev.r1.json'));
  const sonnet = rj(path.join(GD, 'good-dinosaur.sonnetq.r1.json'));
  const cues = parseSrt(fs.readFileSync(path.join(TS, 'data', 'good-dinosaur.srt'), 'utf8'));
  const out = selectRun(run, POLICY, { cues, sonnet, used: loadSplit().sonnet_used, childcry: rj(CC) });
  const s21 = out.scenes.find((s) => s.id === 'S021');
  assert.equal(s21.flagged, true);
  assert.deepEqual(s21.flag_reasons.map((r) => [r.id, r.by, r.child]), [['crying', 'sonnet', 'jev_child']]);
  const s8 = out.scenes.find((s) => s.id === 'S008');
  assert.equal(s8.flagged, false);
  assert.ok(s8.cancelled.some((c) => c.id === 'believed_dead' && c.by.includes('comic')));
  // v10 (no rule changes) flagged S008 and not S021 on the same answers
  const v10 = rj(path.join(GD, 'good-dinosaur.tags.r1.json'));
  assert.equal(v10.scenes.find((s) => s.id === 'S008').flagged, true);
  assert.equal(v10.scenes.find((s) => s.id === 'S021').flagged, false);
});
