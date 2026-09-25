// Why a scene is on the list, grouped as a parent would say it (lib/reasons.ts).

import test from 'node:test';
import assert from 'node:assert/strict';
import { dangerPhrase, filmReason, groupReasons, nameContext, plainHazard, shortName, type TagLike } from '../lib/reasons';

// The Iron Giant's S007, as the v10.4 pipeline tags it (real run output, trimmed to what grouping reads).
const S007: (TagLike & { by: string[] })[] = [
  { label: 'Weapon used', category: null, rule: 'strong_event', by: ['sonnet'] },
  { label: 'The Iron Giant in danger', category: 'Character in danger', rule: 'film_child_in_danger', by: ['jev'] },
  { label: 'Caught in danger', category: null, rule: 'strong_event', by: ['jev'] },
  { label: 'Hogarth Hughes in danger', category: 'Character in danger', rule: 'film_child_in_danger', by: ['jev'] },
  { label: 'Child in danger', category: null, rule: 'strong_event', by: ['jev'] },
  { label: 'Power substation electrocution endangers someone', category: 'Dangerous situation', rule: 'film_danger', by: ['jev'] },
  { label: 'Dangerous machinery', category: null, rule: 'presence_with_danger', by: ['jev'] },
  {
    label: 'Afraid for safety',
    category: null,
    rule: 'strong_event+cooccur',
    with: ['The Iron Giant in danger', 'Caught in danger', 'Hogarth Hughes in danger'],
    by: ['jev'],
  },
];
const IRON_GIANT = nameContext([
  { title: 'Hogarth finds the Giant in danger', description: 'Hogarth later returns and saves the Giant from being electrocuted.' },
  { title: 'Mansley threatens and interrogates Hogarth', description: null },
]);

test('overlapping reasons fold into a few, each named the way a parent would say it; no check is dropped', () => {
  const groups = groupReasons(S007, IRON_GIANT);
  assert.deepEqual(
    groups.map((g) => g.label),
    ['Weapon used', 'The Giant and Hogarth in danger', 'Danger from electricity'],
  );
  assert.deepEqual(groups[1].items.map((t) => t.label), ['The Iron Giant in danger', 'Hogarth Hughes in danger', 'Child in danger', 'Afraid for safety']);
  // Caught in a dangerous force or place: with one named danger, it is that danger's check.
  assert.deepEqual(groups[2].items.map((t) => t.label), ['Caught in danger', 'Power substation electrocution endangers someone', 'Dangerous machinery']);
  assert.equal(groups.flatMap((g) => g.items).length, S007.length);
  assert.deepEqual(groups.map((g) => g.category), ['Weapon used', 'Character in danger', 'Dangerous situation']);
});

test('a guide stored without rules or categories groups the same way, by the labels alone', () => {
  const stored = S007.map(({ label }) => ({ label }));
  const groups = groupReasons(stored, IRON_GIANT);
  assert.deepEqual(
    groups.map((g) => g.label).sort(),
    ['Danger from electricity', 'The Giant and Hogarth in danger', 'Weapon used'],
  );
  // "Afraid for safety" never counts alone: without its partners named, it goes with the scene's leading reason.
  assert.deepEqual(groupReasons([{ label: 'Caught in danger' }, { label: 'Crashing vehicle' }, { label: 'Afraid for safety' }]).map((g) => [g.label, g.items.length]), [
    ['Caught in danger', 2],
    ['Crashing vehicle', 1],
  ]);
});

test('general reasons alone: "Child in danger" anchors its repeats, a fall family folds under its strongest', () => {
  const groups = groupReasons([
    { label: 'Child in danger', rule: 'strong_event' },
    { label: 'Deadly fall', rule: 'mortal_question' },
    { label: 'Falling', rule: 'strong_event' },
    { label: 'Caught in danger', rule: 'strong_event' },
    { label: 'Nearly falls', rule: 'strong_event' },
    { label: 'Afraid for safety', rule: 'strong_event+cooccur', with: ['Child in danger'] },
  ]);
  assert.deepEqual(groups.map((g) => [g.label, g.category, g.items.map((t) => t.label)]), [
    ['Child in danger', 'Child in danger', ['Child in danger', 'Caught in danger', 'Afraid for safety']],
    ['Deadly fall', 'Deadly fall', ['Deadly fall', 'Falling', 'Nearly falls']],
  ]);
  // Nothing to fold: every reason stands as it is, in the pipeline's order.
  assert.deepEqual(groupReasons([{ label: 'Chased' }, { label: 'Weapon used' }]).map((g) => g.label), ['Chased', 'Weapon used']);
  assert.deepEqual(groupReasons([]), []);
});

test('two named dangers stay two reasons, and a repeat that could belong to either stays its own', () => {
  const groups = groupReasons([
    { label: 'Caught in danger', rule: 'strong_event' },
    { label: 'Tar flow endangers someone', rule: 'film_danger' },
    { label: 'Volcanic cataclysm endangers someone', rule: 'film_danger' },
  ]);
  assert.deepEqual(groups.map((g) => g.label), ['Caught in danger', 'Danger from tar flow', 'Danger from volcanic cataclysm']);
});

test('a named villain is its own reason, and "Creature threatens" folds into it when it is the only one', () => {
  const groups = groupReasons([
    { label: 'Tai Lung threatens someone', rule: 'film_threatens' },
    { label: 'Creature threatens', rule: 'strong_event' },
    { label: 'Weapon used', rule: 'strong_event' },
  ], 'Tai Lung escapes from prison.');
  assert.deepEqual(groups.map((g) => [g.label, g.items.length]), [['Tai Lung threatens someone', 2], ['Weapon used', 1]]);
});

test('film-specific or general: the rule and category decide, else the label must name someone', () => {
  assert.deepEqual(filmReason({ label: 'Hogarth Hughes in danger' }), { kind: 'person', name: 'Hogarth Hughes' });
  assert.equal(filmReason({ label: 'Child in danger' }), null);
  assert.equal(filmReason({ label: 'Animal in danger' }), null);
  assert.equal(filmReason({ label: 'Family in danger' }), null);
  assert.equal(filmReason({ label: 'Caught in danger' }), null);
  assert.deepEqual(filmReason({ label: 'Drought endangers someone' }), { kind: 'danger', name: 'Drought' });
  assert.deepEqual(filmReason({ label: 'baby Jack-Jack in danger', rule: 'film_child_in_danger' }), { kind: 'person', name: 'baby Jack-Jack' });
});

test('a name is shortened only to a word the film’s own text uses', () => {
  assert.equal(shortName('Hogarth Hughes', IRON_GIANT), 'Hogarth');
  assert.equal(shortName('The Iron Giant', IRON_GIANT), 'The Giant');
  assert.equal(shortName('Kent Mansley', IRON_GIANT), 'Mansley');
  assert.equal(shortName('Annie Hughes', IRON_GIANT), 'Annie Hughes');
  assert.equal(shortName('Mr. Ray', 'Mr. Ray takes the class out.'), 'Mr. Ray');
  assert.equal(shortName('The Gruffalo', 'The Gruffalo appears.'), 'The Gruffalo');
  assert.equal(shortName('James P. "Sulley" Sullivan', 'Sulley roars at Boo.'), 'Sulley');
  assert.equal(shortName('Ian Lightfoot', ''), 'Ian Lightfoot');
  // "Giantess" is not "Giant": a whole word only.
  assert.equal(shortName('The Iron Giant', 'The Giantess waves.'), 'The Iron Giant');
});

test('a danger reads after "Danger from", a proper noun keeping its capital', () => {
  assert.equal(dangerPhrase('Oncoming train', ''), 'oncoming train');
  assert.equal(dangerPhrase('The Curse/Dragon', ''), 'the Curse/Dragon');
  assert.equal(dangerPhrase("Tai Lung's escape/rampage", ''), "Tai Lung's escape/rampage");
  assert.equal(dangerPhrase('Kraken attack', 'the ship meets the Kraken, and Kraken attack'), 'Kraken attack');
  assert.equal(dangerPhrase('UFO crash', ''), 'UFO crash');
});

test('more than three characters are named two and a count', () => {
  const groups = groupReasons(
    ['Eep', 'Thunk', 'Sandy', 'Ugga'].map((n) => ({ label: `${n} in danger`, rule: 'film_child_in_danger' })),
  );
  assert.deepEqual(groups.map((g) => g.label), ['Eep, Thunk and 2 others in danger']);
});

test('an electrical hazard is named by the plain word, on both surfaces\' grouping', () => {
  assert.equal(dangerPhrase('Power substation electrocution', ''), 'electricity');
  assert.equal(plainHazard('Downed power lines'), 'electricity');
  assert.equal(plainHazard('High-voltage fence'), 'electricity');
  // Not every word that starts "electr" is a hazard of electricity.
  assert.equal(plainHazard('Electric eel'), null);
  assert.equal(plainHazard('Electro'), null);
  assert.equal(plainHazard('The nuclear missile'), null);
  // Two named dangers with the one plain word are one reason, holding both checks.
  const groups = groupReasons([
    { label: 'Power substation electrocution endangers someone', rule: 'film_danger' },
    { label: 'Downed power lines endangers someone', rule: 'film_danger' },
  ]);
  assert.deepEqual(groups.map((g) => [g.label, g.items.length]), [['Danger from electricity', 2]]);
});
