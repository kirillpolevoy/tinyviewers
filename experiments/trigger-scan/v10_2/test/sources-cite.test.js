// node --test test/
import test from 'node:test';
import assert from 'node:assert/strict';
import { plotSection, splitSentences, numberSentences } from '../text.js';
import { tmdbCastRows } from '../sources.js';
import { checkCites, sourcesOf, gateCastMember, wikiSpread } from '../cite.js';

test('plotSection takes only the Plot section, with subsections, and never falls back', () => {
  const ex = 'Lead text.\n\n== Plot ==\nFirst para.\n=== Part two ===\nSecond para.\n\n== Cast ==\nNot plot.';
  assert.deepEqual(plotSection(ex), { heading: 'Plot', text: 'First para.\nSecond para.' });
  assert.equal(plotSection('Lead.\n\n== Cast ==\nx\n== Production ==\ny'), null);
  assert.equal(plotSection('== Synopsis ==\nA story.').text, 'A story.');
  assert.equal(plotSection('== Plot ==\n\n== Cast ==\nx'), null); // empty plot section is not a plot
});

test('splitSentences handles abbreviations, initials, quotes and company names', () => {
  const s = splitSentences('Mr. Ray takes the class out. Waternoose, CEO of Monsters, Inc. is worried. He tells Henry J. Waternoose "go have an adventure". Then they leave!\nNew para? Yes.');
  assert.deepEqual(s, [
    'Mr. Ray takes the class out.',
    'Waternoose, CEO of Monsters, Inc. is worried.',
    'He tells Henry J. Waternoose "go have an adventure".',
    'Then they leave!',
    'New para?',
    'Yes.',
  ]);
  assert.deepEqual(numberSentences(['a', 'b']), [{ id: 'W1', text: 'a' }, { id: 'W2', text: 'b' }]);
});

test('tmdbCastRows drops rows that name no character and splits off (voice)', () => {
  const { kept, dropped } = tmdbCastRows([
    { character: 'Marlin (voice)', name: 'A', order: 0 },
    { character: 'Additional Voices  (voice)', name: 'B', order: 1 },
    { character: '', name: 'C', order: 2 },
    { character: 'Dentist', name: 'D', order: 3 },
  ]);
  assert.equal(dropped, 2);
  assert.deepEqual(kept, [{ character: 'Marlin', actor: 'A', order: 0, voice: true }, { character: 'Dentist', actor: 'D', order: 3, voice: false }]);
});

const ctx = { nCues: 100, wCount: 10, tCount: 5 };

test('checkCites: ids must exist, L ids must be inside the scene, duplicates collapse', () => {
  const r = checkCites(['L5', 'l6', 'L6', 'W3', 'W11', 'T5', 'T6', 'L50', 'X1', 'L0'], { ...ctx, range: [1, 10] });
  assert.deepEqual(r.ok, ['L5', 'L6', 'W3', 'T5']);
  assert.deepEqual(r.rejected.map((x) => `${x.id}:${x.why}`), ['W11:unknown', 'T6:unknown', 'L50:outside_scene', 'X1:malformed', 'L0:malformed']);
  assert.deepEqual(checkCites(undefined, ctx), { ok: [], rejected: [] });
  assert.deepEqual(sourcesOf(['W1', 'L2']), ['lines', 'wikipedia']);
});

test('gateCastMember: an uncited field becomes unknown; an uncited name drops the member', () => {
  const base = {
    name: 'Randall', tmdb: 'T4', aliases: [], kind: 'creature', is_child: 'false', looks_frightening: 'true',
    disposition: 'villain', disposition_note: 'plots to kidnap children', group: 'hostility',
    cites: { name: [], kind: ['W1'], is_child: [], looks_frightening: ['W99'], disposition: ['W2', 'L3'] },
  };
  const g = gateCastMember(base, ctx);
  assert.equal(g.member.tmdb, 'T4');
  assert.deepEqual(g.member.cites.name, ['T4']); // TMDB entry supports existence
  assert.equal(g.member.kind, 'creature');
  assert.equal(g.member.is_child, 'unknown');
  assert.equal(g.member.looks_frightening, 'unknown'); // W99 does not exist
  assert.equal(g.member.disposition, 'villain');
  assert.deepEqual(g.demoted.sort(), ['is_child', 'looks_frightening']);
  assert.deepEqual(g.rejected, [{ field: 'looks_frightening', id: 'W99', why: 'unknown' }]);

  const none = gateCastMember({ ...base, tmdb: '', cites: { ...base.cites, name: [] } }, ctx);
  assert.equal(none.member, null);

  const unk = gateCastMember({ ...base, disposition: 'unknown', cites: { ...base.cites, name: ['L1'] } }, ctx);
  assert.equal(unk.member.disposition_note, ''); // no note without a disposition
  assert.deepEqual(unk.member.cites.disposition, []);
});

test('wikiSpread counts distinct scenes per W sentence', () => {
  const scenes = [
    { sentences: [{ cites: ['W1', 'L1'] }, { cites: ['W1'] }] },
    { sentences: [{ cites: ['W1', 'W2'] }] },
    { sentences: [{ cites: ['L9'] }] },
  ];
  const s = wikiSpread(scenes, 3);
  assert.deepEqual(s.perW, { W1: 2, W2: 1 });
  assert.deepEqual(s.uncited, ['W3']);
  assert.deepEqual(s.spread, [{ id: 'W1', scenes: 2 }]);
});
