// node --test test/  — question generation (universal + film-specific) and the two request states.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildQuestions, questionCounts, filmItems, filmQuestions, linesState, contextState, verified, verifiedField,
  verifiedSentences, castView, PRESENCE, EVENTS, SCORES, KIND, MODIFIERS, DERIVED, GROUPS, ITEMS, FILM_CAP,
} from '../questions.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const policy = JSON.parse(fs.readFileSync(path.join(here, '..', 'policy.json'), 'utf8'));

// Entities of the three test films (Finding Nemo, Monsters, Inc., and the held-out The Lion King), plus
// the test-film species/objects v4 wrote into its criteria. Written from general knowledge; no held-out
// source was opened. Universal questions must contain none of them.
const DENY = [
  'nemo', 'marlin', 'dory', 'coral', 'gill', 'bruce', 'crush', 'squirt', 'darla', 'nigel', 'bloat', 'peach', 'mr. ray', 'sydney', 'dentist',
  'sulley', 'sullivan', 'mike', 'wazowski', 'boo', 'randall', 'waternoose', 'celia', 'roz', 'fungus', 'yeti', 'kitty', 'scream extractor', 'monstropolis', 'door vault', 'cda',
  'simba', 'mufasa', 'scar', 'nala', 'timon', 'pumbaa', 'rafiki', 'zazu', 'sarabi', 'shenzi', 'banzai', 'pride rock', 'stampede', 'wildebeest', 'hyena', 'lion', 'elephant graveyard',
  'clownfish', 'barracuda', 'anglerfish', 'jellyfish', 'pelican', 'seagull', 'whale', 'fish tank', 'aquarium', 'short fin', 'sock', 'gator', 'alligator', 'snow cone',
];
const texts = (obj) => JSON.stringify(obj).toLowerCase();
const mentions = (hay, word) => new RegExp(`(^|[^a-z])${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z]|$)`).test(hay);

test('universal layer names no test-film entity (deny list), including the held-out film', () => {
  const all = texts({ q: buildQuestions(), DERIVED, KIND, MODIFIERS, SCORES, moments: Object.values(ITEMS).map((i) => i.moment) });
  const hits = DENY.filter((w) => mentions(all, w));
  assert.deepEqual(hits, []);
});

test('counts: universal questions split across the two requests', () => {
  const c = questionCounts(buildQuestions());
  assert.equal(c.generated, 0);
  assert.equal(c.pl, PRESENCE.length);
  assert.equal(c.ps, PRESENCE.length);
  assert.equal(c.e, EVENTS.length);
  assert.equal(c.kind, 1);
  assert.equal(c.total, c.universal);
});

test('wording fixes: terrified split, jump_scare split, darkness one condition, machine captions, resolution, kind', () => {
  const ids = EVENTS.map((e) => e.id);
  assert.ok(!ids.includes('terrified') && ids.includes('afraid_for_safety') && ids.includes('screams'));
  assert.ok(!/scream/i.test(EVENTS.find((e) => e.id === 'afraid_for_safety').q));
  assert.ok(policy.flag.strong_events.includes('afraid_for_safety'));
  assert.ok(!policy.flag.strong_events.includes('screams'), 'screaming alone must never flag');
  assert.ok(!ids.includes('jump_scare') && ids.includes('appears_suddenly') && ids.includes('startled'));
  assert.deepEqual(DERIVED.jump_scare.from, ['appears_suddenly', 'startled']);
  assert.ok(!policy.flag.strong_events.includes('parent_searching'), 'parent_searching never flags');
  const q = buildQuestions();
  assert.ok(!/cannot see|so they/i.test(q['pl.darkness'].instructions));
  assert.match(q['pl.dangerous_machine'].criteria.false, /sound caption/i);
  assert.doesNotMatch(q['ps.dangerous_machine'].criteria.false, /sound caption/i);
  // monster presence: friendly counts in the definition and nothing in the no-criterion excludes friendly
  assert.match(q['pl.monster_creature'].criteria.true, /Friendly, funny and frightening monsters all count/);
  assert.doesNotMatch(q['pl.monster_creature'].criteria.false, /friendly/i);
  // resolution: no presupposition, no not-applicable level
  assert.doesNotMatch(SCORES.resolution.q, /who were in trouble/);
  assert.ok(SCORES.resolution.levels.every((l) => !/nobody was in trouble|not apply|n\/a/i.test(l)));
  // comic is a Score now, not a Noul modifier
  assert.ok(!('comic' in MODIFIERS) && 'laughs' in SCORES);
  assert.ok(!/most of/i.test(MODIFIERS.retold.q));
  // kind: threatens-or-attacks with an explicit none
  assert.match(KIND.q, /threatens or attacks/);
  assert.ok('none' in KIND.options);
  assert.doesNotMatch(KIND.q, /dangerous-looking/);
});

test('every presence id is in exactly one policy list; every strong event exists', () => {
  const pr = policy.flag.presence;
  for (const p of PRESENCE) {
    const lists = ['always', 'with_danger', 'with_creature_threat'].filter((k) => pr[k].includes(p.id)).concat(p.id in policy.flag.never ? ['never'] : []);
    assert.equal(lists.length, 1, `${p.id} is in ${lists.join(',') || 'no list'}`);
  }
  for (const id of policy.flag.strong_events) assert.ok(EVENTS.find((e) => e.id === id), id);
  for (const item of Object.values(ITEMS)) assert.ok(item.moment, item.id);
});

// ---- film-specific layer ----------------------------------------------------------------------------

const ok = (confidence = 0.9) => ({ verdict: 'supports', confidence });
const member = (id, name, fields, check) => ({ id, name, aliases: [], kind: 'unknown', is_child: 'unknown', looks_frightening: 'unknown', disposition: 'unknown', disposition_note: '', group: 'none', ...fields, check });

test('verified(): the citation-check acceptance rule and the other accepted shapes', () => {
  assert.equal(verified({ verdict: 'supports', confidence: 0.8 }), true);
  assert.equal(verified({ verdict: 'supports', confidence: 0.79 }), false);
  assert.equal(verified({ verdict: 'says_nothing', confidence: 0.99 }), false);
  assert.equal(verified({ verdict: 'contradicts', confidence: 0.99 }), false);
  assert.equal(verified({ accepted: true }), true);
  assert.equal(verified({ status: 'verified' }), true);
  assert.equal(verified({ status: 'unverified', verdict: 'supports', confidence: 1 }), false);
  assert.equal(verified(undefined), false);
  // per-field and whole-entity checks
  assert.equal(verifiedField({ disposition: 'villain', check: { disposition: ok() } }, 'disposition'), 'villain');
  assert.equal(verifiedField({ disposition: 'villain', check: ok() }, 'disposition'), 'villain');
  assert.equal(verifiedField({ disposition: 'villain', check: { kind: ok() } }, 'disposition'), 'unknown');
  assert.equal(verifiedField({ disposition: 'villain' }, 'disposition'), 'unknown');
});

test('filmItems: only verified claims generate questions; unknown/unverified roles get no threat question', () => {
  const seg = {
    cast: [
      member('C01', 'Villainous Vera', { disposition: 'villain', aliases: ['Vera'] }, { disposition: ok() }),
      member('C02', 'Unverified Uma', { disposition: 'villain' }, { disposition: { verdict: 'says_nothing', confidence: 0.9 } }),
      member('C03', 'Little Lou', { is_child: true }, { is_child: ok() }),
      member('C04', 'Scary Sam', { looks_frightening: true, disposition: 'ally' }, { looks_frightening: ok(), disposition: ok() }),
      member('C05', 'Contradicted Cal', { disposition: 'threat' }, { disposition: { verdict: 'contradicts', confidence: 0.95 } }),
      member('C06', 'Unknown Una', {}, {}),
      member('C07', 'Low Lee', { disposition: 'threat' }, { disposition: ok(0.6) }),
    ],
    dangers: [
      { id: 'D01', name: 'the grinder', kind: 'machine', check: ok() },
      { id: 'D02', name: 'the pit', kind: 'place', check: { verdict: 'says_nothing', confidence: 0.7 } },
    ],
  };
  const items = filmItems(seg);
  const ids = items.map((i) => i.id);
  assert.deepEqual(ids, ['C01_present', 'C01_threatens', 'C03_present', 'C03_in_danger', 'D01_endangers', 'C04_present', 'C04_threatens']);
  for (const it of items) assert.ok(GROUPS[it.group], `${it.id} group ${it.group}`);
  const q = filmQuestions(items);
  assert.equal(Object.keys(q).length, 10); // 3 presence x 2 channels + 4 events
  assert.match(q['fe.C01_threatens'].instructions, /Villainous Vera \(also called Vera\) threaten, chase, or attack someone/);
  assert.match(q['fe.C03_in_danger'].instructions, /Little Lou is in danger|is Little Lou in danger/);
  assert.match(q['fe.D01_endangers'].instructions, /the grinder/);
  assert.equal(questionCounts(q).generated, 10);
});

test('filmItems: cap on generated questions, villains first', () => {
  const cast = Array.from({ length: 30 }, (_, i) => member(`C${String(i + 1).padStart(2, '0')}`, `Name${i}`, { disposition: i < 20 ? 'ally' : 'villain', is_child: i < 20 }, { disposition: ok(), is_child: ok() }));
  const items = filmItems({ cast, dangers: [] });
  const n = Object.keys(filmQuestions(items)).length;
  assert.ok(n <= FILM_CAP, `${n} > cap`);
  assert.ok(n >= FILM_CAP - 2);
  assert.equal(items[0].why, 'villain');
  assert.equal(items.filter((i) => i.why === 'villain').length, 20); // all 10 villains (2 items each) fit before children
});

// ---- states -------------------------------------------------------------------------------------------

const cues = [
  { index: 10, text: 'Vera, put that down!', startMs: 0, endMs: 1000 },
  { index: 11, text: '( machine whirring )', startMs: 1000, endMs: 2000 },
];
const scene = {
  id: 'S001', start_cue: 10, end_cue: 11, setting: 'a factory',
  sentences: [
    { text: 'Vera switches on a machine.', cites: ['L11'], check: ok() },
    { text: 'Vera laughs at a child.', cites: ['W3'], check: { verdict: 'says_nothing', confidence: 0.9 } },
  ],
  summary: 'Vera switches on a machine. Vera laughs at a child.',
};

test('lines state holds ONLY the film title and the lines; context state only verified text', () => {
  const ls = linesState({ film: { title: 'Film', year: 2000, slug: 'x' }, cues });
  assert.deepEqual(Object.keys(ls), ['film', 'scene']);
  assert.deepEqual(Object.keys(ls.film), ['title']);
  assert.deepEqual(Object.keys(ls.scene), ['lines']);
  assert.deepEqual(ls.scene.lines, ['L10| Vera, put that down!', 'L11| ( machine whirring )']);

  const seg = { film: { title: 'Film', year: 2000 }, cast: [member('C01', 'Vera', { disposition: 'villain', disposition_note: 'wants the machine', kind: 'person', looks_frightening: true }, { disposition: ok(), kind: { verdict: 'says_nothing', confidence: 1 } }), member('C02', 'Nobody Here', { disposition: 'ally' }, { disposition: ok() })], dangers: [{ id: 'D01', name: 'the grinder', kind: 'machine', check: ok() }, { id: 'D02', name: 'the pit', kind: 'place', check: {} }] };
  const { state, summaryEmpty } = contextState({ seg, scene, cues });
  assert.equal(summaryEmpty, false);
  assert.equal(state.scene.summary, 'Vera switches on a machine.'); // the says_nothing sentence is gone
  assert.equal(state.cast.length, 1); // only the character present or mentioned
  assert.deepEqual(state.cast[0], { name: 'Vera', kind: 'unknown', is_child: 'unknown', looks_frightening: 'unknown', disposition: 'villain', note: 'wants the machine' });
  assert.deepEqual(state.dangers.map((d) => d.name), ['the grinder']);
  assert.equal(verifiedSentences({ sentences: undefined, summary: 'unchecked text' }).length, 0);
  assert.equal(castView(member('C9', 'X', { disposition: 'villain', disposition_note: 'secret' }, {})).note, undefined);
});
