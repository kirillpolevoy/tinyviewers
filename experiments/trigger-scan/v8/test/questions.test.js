// node --test test/  — question generation (universal + film-specific) and the two request states.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildQuestions, questionCounts, filmItems, filmQuestions, linesState, contextState, verified, verifiedField,
  verifiedSentences, castView, dangerView, castForScene, PRESENCE, EVENTS, SCORES, KIND, MODIFIERS, DERIVED, GROUPS, ITEMS, FILM_CAP,
} from '../questions.js';
import { aliasList, aliasProblem } from '../aliases.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const policy = JSON.parse(fs.readFileSync(path.join(here, '..', 'policy.json'), 'utf8'));

// Entities of the dev films (Finding Nemo, Monsters, Inc., The Lion King) and character names of the
// held-out films (Frankenweenie, The Wild Robot), plus the test-film species/objects v4 wrote into its
// criteria. Written from general knowledge; no held-out source, output or reference was opened.
// Universal questions must contain none of them.
const DENY = [
  'nemo', 'marlin', 'dory', 'coral', 'gill', 'bruce', 'crush', 'squirt', 'darla', 'nigel', 'bloat', 'peach', 'mr. ray', 'sydney', 'dentist',
  'sulley', 'sullivan', 'mike', 'wazowski', 'boo', 'randall', 'waternoose', 'celia', 'roz', 'fungus', 'yeti', 'kitty', 'scream extractor', 'monstropolis', 'door vault', 'cda',
  'simba', 'mufasa', 'scar', 'nala', 'timon', 'pumbaa', 'rafiki', 'zazu', 'sarabi', 'shenzi', 'banzai', 'pride rock', 'stampede', 'wildebeest', 'hyena', 'lion', 'elephant graveyard',
  'clownfish', 'barracuda', 'anglerfish', 'jellyfish', 'pelican', 'seagull', 'whale', 'fish tank', 'aquarium', 'short fin', 'sock', 'gator', 'alligator', 'snow cone',
  'frankenweenie', 'victor', 'sparky', 'frankenstein', 'rzykruski', 'van helsing', 'toshiaki', 'nassor', 'weird girl', 'mr. whiskers', 'new holland',
  'wild robot', 'rozzum', 'brightbill', 'fink', 'longneck', 'thorn', 'paddler', 'pinktail', 'vontra', 'gosling',
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

test('wording fixes: terrified split, jump_scare split, darkness one condition, ONE caption rule, resolution, kind', () => {
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
  // v6 (f): one caption rule for every lines-channel presence question, no per-item exception
  for (const p of PRESENCE) {
    const c = q[`pl.${p.id}`].criteria;
    if (!p.pl) assert.match(c.true, /a sound caption names it/, p.id);
    assert.match(c.false, /A sound caption of a noise that many things could make .* is a no unless the lines show what made it/, p.id);
    assert.equal(p.plNoExtra, undefined, `${p.id} has its own caption exception`);
    assert.doesNotMatch(q[`ps.${p.id}`].criteria.false, /sound caption/i);
  }
  // monster presence: friendly counts in the definition and nothing in the no-criterion excludes friendly
  assert.match(q['pl.monster_creature'].criteria.true, /Friendly, funny and frightening monsters all count/);
  assert.doesNotMatch(q['pl.monster_creature'].criteria.false, /friendly/i);
  // resolution: no presupposition, no not-applicable level
  assert.doesNotMatch(SCORES.resolution.q, /who were in trouble/);
  assert.ok(SCORES.resolution.levels.every((l) => !/nobody was in trouble|not apply|n\/a/i.test(l)));
  assert.ok(!('comic' in MODIFIERS) && 'laughs' in SCORES);
  assert.ok(!/most of/i.test(MODIFIERS.retold.q));
  assert.match(KIND.q, /threatens or attacks/);
  assert.ok('none' in KIND.options);
  assert.doesNotMatch(KIND.q, /dangerous-looking/);
  // reanimated: a character only thought dead is a no (v5 fired on a reunion)
  assert.match(q['pl.reanimated_dead'].criteria.false, /only thought to be dead/);
});

test('v6 events: threats, plans, a child frightened or crying, comic peril; one condition each, cancel sets per the user policy', () => {
  const q = buildQuestions();
  const ev = (id) => EVENTS.find((e) => e.id === id);
  assert.match(q['e.threatens_harm'].instructions, /threaten to kill or hurt/);
  assert.match(q['e.plots_harm'].instructions, /plan or order the killing or hurting/);
  assert.equal(q['e.child_frightened'].instructions, 'In `scene`, is a child frightened or crying?');
  assert.match(q['e.child_frightened'].criteria.true, /`cast` marks them as a child, or the lines or summary show they are young/);
  assert.match(q['e.child_frightened'].criteria.false, /A grown-up who is frightened or crying is a no/);
  assert.doesNotMatch(q['e.comic_peril'].instructions, /the danger/, 'no presupposition that danger exists');
  for (const id of ['threatens_harm', 'plots_harm']) assert.deepEqual(ev(id).cancel, { imagined: true }, `${id}: never cancelled by comic or retold`);
  assert.deepEqual(ev('child_frightened').cancel, {});
  for (const id of ['chased', 'attacked', 'caught_in_hazard', 'afraid_for_safety']) assert.equal(ev(id).cancel.comic_peril, true, id);
  for (const id of ['dies', 'loved_one_dies', 'child_taken', 'child_separated']) assert.ok(!ev(id).cancel.comic_peril, id);
  for (const id of ['threatens_harm', 'plots_harm', 'child_frightened']) assert.ok(policy.flag.strong_events.includes(id), id);
  assert.ok(!policy.flag.strong_events.includes('comic_peril') && !policy.flag.strong_events.includes('slapstick'), 'comic peril and slapstick are tags only');
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
const v = { status: 'verified' };
const nv = { status: 'unverified' };
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

test('filmItems: only verified claims generate questions; threats only for villain / threat roles', () => {
  const seg = {
    cast: [
      member('C01', 'Villainous Vera', { disposition: 'villain', aliases: [{ name: 'Vera V', cites: ['L1'], check: v }, { name: 'Veevee', cites: ['L2'], check: nv }] }, { disposition: ok() }),
      member('C02', 'Unverified Uma', { disposition: 'villain' }, { disposition: { verdict: 'says_nothing', confidence: 0.9 } }),
      member('C03', 'Little Lou', { is_child: true }, { is_child: ok() }),
      member('C04', 'Scary Sam', { looks_frightening: true, disposition: 'ally' }, { looks_frightening: ok(), disposition: ok() }),
      member('C05', 'Contradicted Cal', { disposition: 'threat' }, { disposition: { verdict: 'contradicts', confidence: 0.95 } }),
      member('C06', 'Unknown Una', {}, {}),
      member('C07', 'Low Lee', { disposition: 'threat' }, { disposition: ok(0.6) }),
      member('C08', 'Changing Gil', { disposition: 'changes' }, { disposition: ok() }),
      member('C09', 'Nameless Ned', { disposition: 'villain' }, { name: nv, disposition: ok() }),
    ],
    dangers: [
      { id: 'D01', name: 'the grinder', kind: 'machine', check: ok() },
      { id: 'D02', name: 'the pit', kind: 'place', check: { verdict: 'says_nothing', confidence: 0.7 } },
    ],
  };
  const items = filmItems(seg);
  const ids = items.map((i) => i.id);
  // v6 (e): no threat question for a 'changes' arc (Gil) or a frightening look alone (Sam: presence only);
  // an unverified name (Ned) generates nothing
  assert.deepEqual(ids, ['C01_present', 'C01_threatens', 'C03_present', 'C03_in_danger', 'D01_endangers', 'C04_present']);
  for (const it of items) assert.ok(GROUPS[it.group], `${it.id} group ${it.group}`);
  assert.deepEqual(items.find((i) => i.id === 'C01_threatens').cancel, { imagined: true });
  const q = filmQuestions(items);
  assert.equal(Object.keys(q).length, 9); // 3 presence x 2 channels + 3 events
  // only the verified alias reaches the wording
  assert.match(q['fe.C01_threatens'].instructions, /Villainous Vera \(also called Vera V\) threaten, chase, or attack someone/);
  assert.doesNotMatch(JSON.stringify(q), /Veevee/);
  assert.match(q['fe.C03_in_danger'].instructions, /is Little Lou in danger/);
  assert.match(q['fe.D01_endangers'].instructions, /the grinder/);
  assert.equal(questionCounts(q).generated, 9);
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

test('cast matching: whole names and verified aliases only; common-word aliases never match; proper tokens are case-sensitive', () => {
  const simba = member('C01', 'Simba', { aliases: [{ name: 'Your Majesty', cites: ['L1'], check: v }, { name: 'the king', cites: ['L2'], check: v }] }, {});
  const young = member('C02', 'Young Simba', { is_child: true }, { is_child: ok() });
  const boo = member('C03', 'Boo', { aliases: [{ name: 'the kid', cites: ['L3'], check: v }, { name: 'Mary', cites: ['L4'], check: v }] }, {});
  const celia = member('C04', 'Celia', { aliases: [{ name: 'Googley Bear', cites: ['L5'], check: nv }] }, {});
  const cast = [simba, young, boo, celia];
  const who = (lines) => castForScene(cast, '', lines).map((c) => c.id);
  assert.deepEqual(who(['Your Majesty, the king is here.']), [], "'Your Majesty' / 'the king' are refused (only common words)");
  assert.deepEqual(who(['Simba, come here!']), ['C01', 'C02'], "the proper token 'Simba' of 'Young Simba' still matches");
  assert.deepEqual(who(['Where is the kid?']), []);
  assert.deepEqual(who(['Boo! Did I scare you?']), ['C03']);
  assert.deepEqual(who(['He jumped out and said boo.']), [], "lower-case 'boo' is not the name");
  assert.deepEqual(who(['Here, Mary!']), ['C03'], 'a verified alias matches');
  assert.deepEqual(who(['My Googley Bear!']), [], 'an unverified alias never matches');
  assert.deepEqual(castView(boo).also_called, ['Mary']);
  assert.equal(castView(celia).also_called, undefined);
  assert.deepEqual(aliasList(simba).map((a) => a.problem), ['only_common_words', 'only_common_words']);
  assert.equal(aliasProblem('your', 'Simba'), 'single_common_word');
  assert.equal(aliasProblem('Mufasa', 'King Mufasa'), null);
});

test('context state: an unverified name never reaches Jev; the v6 note needs its own verified check', () => {
  const lines = [{ index: 1, text: 'Nora and Otto are here.', startMs: 0, endMs: 1000 }];
  const sc = { id: 'S1', start_cue: 1, end_cue: 1, setting: 'unknown', sentences: [] };
  const seg = { film: { title: 'F', year: 1 }, dangers: [], cast: [
    member('C01', 'Nora', { disposition: 'villain', disposition_note: 'steals the key' }, { name: v, disposition: v, note: nv }),
    member('C02', 'Otto', {}, { name: nv }),
  ] };
  const { state } = contextState({ seg, scene: sc, cues: lines });
  assert.deepEqual(state.cast, [{ name: 'Nora', kind: 'unknown', is_child: 'unknown', looks_frightening: 'unknown', disposition: 'villain' }]);
  seg.cast[0].check.note = v;
  assert.equal(contextState({ seg, scene: sc, cues: lines }).state.cast[0].note, 'steals the key');
  // a danger's note shows only when its own check passed
  assert.deepEqual(dangerView({ name: 'the pit', kind: 'place', note: 'swallows carts', note_check: nv }), { name: 'the pit', kind: 'place' });
});
