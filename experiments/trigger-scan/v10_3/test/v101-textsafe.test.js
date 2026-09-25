// v10.1 fix 2: parent text safety (textsafe.js, check-describe.js buildWhy).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseDirection, directionReversed, directionChoice, textAccepted, reasonClaim, reasonAtAct } from '../textsafe.js';
import { buildWhy } from '../check-describe.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const V101 = path.resolve(here, '..');
const POLICY = JSON.parse(fs.readFileSync(path.join(V101, 'policy.json'), 'utf8'));

test('direction: X <aggression verb> Y is parsed; passives are turned round; embedded / noun uses are skipped', () => {
  assert.deepEqual(parseDirection('The caveboy threatens to squeeze Arlo'), { agent: 'The caveboy', patient: 'Arlo', verb: 'threatens', passive: false });
  assert.deepEqual(parseDirection('Scar threatens to rip Simba apart'), { agent: 'Scar', patient: 'Simba', verb: 'threatens', passive: false });
  assert.deepEqual(parseDirection('Mike is captured by Randall\'s machine'), { agent: 'Randall\'s machine', patient: 'Mike', verb: 'captures', passive: true });
  assert.deepEqual(parseDirection('A storm strikes as Poppa hunts the critter'), { agent: 'Poppa', patient: 'the critter', verb: 'hunts', passive: false });
  assert.equal(parseDirection('Scar announces he plans to kill Mufasa and Simba.'), null, 'infinitive after a clause: no clean agent');
  assert.equal(parseDirection('Nemo leads the trapped fish to swim down.'), null, 'adjective use');
  assert.equal(parseDirection("Arlo's trap catches a growling feral child."), null, 'noun use');
  assert.equal(parseDirection('He attacks her.'), null, 'pronouns only');
  assert.equal(parseDirection('Momma helps free a stuck chick.'), null);
});
test('direction: rejected only when Jev favours the other direction', () => {
  assert.equal(directionReversed({ p_forward: 0.11, p_reverse: 0.64 }), true); // Good Dinosaur S017 title
  assert.equal(directionReversed({ p_forward: 0.48, p_reverse: 0.45 }), false); // Moana S022 title (accurate)
  assert.equal(directionReversed({ p_forward: 0.2, p_reverse: 0.02 }), false); // lines do not say: not reversed
  const q = directionChoice({ agent: 'The caveboy', patient: 'Arlo', verb: 'threatens' });
  assert.deepEqual(Object.keys(q.criteria), ['forward', 'reverse', 'neither']);
  assert.equal(q.criteria.reverse, 'Arlo threatens The caveboy.');
});
test('margin: titles, sentences and stated reasons need p(supports) >= 0.75 and p(contradicts) < 0.15', () => {
  assert.deepEqual(POLICY.text_safety.accept, { min_supports: 0.75, max_contradicts: 0.15 });
  const v = (s, c) => ({ probabilities: { supports: s, contradicts: c } });
  assert.equal(textAccepted(v(0.7, 0.01), POLICY.text_safety.accept), false, 'S017 title at exactly 0.70 no longer passes');
  assert.equal(textAccepted(v(0.75, 0.14), POLICY.text_safety.accept), true);
  assert.equal(textAccepted(v(0.9, 0.15), POLICY.text_safety.accept), false);
});
test('reason line: only reasons that passed their own claim check are written; none -> no invented text', () => {
  assert.equal(reasonClaim({ id: 'skeleton_bones' }, []), 'In this scene, skeletons or bones are shown.');
  assert.equal(reasonClaim({ id: 'storm' }, []), 'In this scene, there is a dangerous storm.');
  assert.equal(reasonAtAct({ id: 'x' }, [{ id: 'x', level: 'act' }]), true);
  assert.equal(reasonAtAct({ id: 'x' }, [{ id: 'x', level: 'possible' }]), false);
  const reasons = [{ id: 'skeleton_bones', group: 'objects_hazards', p: 0.87 }, { id: 'child_frightened', group: 'distress', p: 0.72 }];
  const sentences = [{ key: 'S007.d1', text: 'Arlo screams and struggles at his chores.', final: 'verified' }];
  const v10 = buildWhy({ title: null, sentences, states: [], reasons, items: [], minP: 0.6 });
  assert.match(v10.text, /skeletons or bones/, 'v10 wrote every reason');
  const w = buildWhy({ title: null, sentences, states: [], reasons, items: [], minP: 0.6, stated: ['child_frightened'] });
  assert.equal(w.source, 'described+reason');
  assert.doesNotMatch(w.text, /skeleton/);
  assert.match(w.text, /a child is frightened or crying/);
  assert.deepEqual(w.unstated_reasons, ['skeleton_bones']);
  const none = buildWhy({ title: { text: 'T', final: 'unverified' }, sentences: [], states: [], reasons, items: [], minP: 0.6, stated: [] });
  assert.deepEqual([none.source, none.title, none.text], ['no_verified_text', 'Flagged scene', null]);
  const only = buildWhy({ title: null, sentences, states: [], reasons, items: [], minP: 0.6, stated: [] });
  assert.deepEqual([only.source, only.text], ['described_only', 'Arlo screams and struggles at his chores.']);
});

// Good Dinosaur's round-6 blocking texts, re-checked by v10.1's check-describe.js on the same descriptions
const GD = path.join(V101, '..', 'v10_1', 'out101', 'dev', 'good-dinosaur.why.r1.json');
test('Good Dinosaur: S007 no longer claims bones, S026 / S029 no longer claim a weapon, S017 reversed title is gone', { skip: !fs.existsSync(GD) && 'run check-describe.js good-dinosaur --in ../v10/out10 first' }, () => {
  const w = JSON.parse(fs.readFileSync(GD, 'utf8')).scenes;
  assert.doesNotMatch(w.S007.why.text, /skeleton|bones/i);
  assert.ok(w.S007.reason_checks.find((r) => r.reason === 'skeleton_bones').pass === false);
  for (const id of ['S026', 'S029']) {
    assert.doesNotMatch(w[id].why.text ?? '', /weapon/i, id);
    assert.equal(w[id].reason_checks.find((r) => r.reason === 'weapon_used').pass, false, id);
  }
  assert.notEqual(w.S017.why.title, 'The caveboy threatens to squeeze Arlo');
  const t17 = w.S017.checked.find((c) => c.key === 'S017.title');
  assert.notEqual(t17.final, 'verified');
});
