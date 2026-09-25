#!/usr/bin/env node
// Builds out/fixture.segments.json: a HAND-MADE segments-v2 fixture of six real Monsters, Inc. scenes
// (cue ranges from v4's segmentation), for developing classify/select/moments without Sonnet.
//
// Everything below was written by hand (Claude, not Sonnet) from the subtitle lines and the
// Wikipedia plot sentences in sources/monsters-inc.json. The `check` verdicts are HAND labels in the
// claim-check shape, NOT outputs of the Jev claim check; a few are deliberately says_nothing or
// contradicts so the code paths that drop unverified claims are exercised. Summary sentences quote
// at most a few transcript words.
//
//   node verify/make-fixture.js
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSrt } from '../../srt.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const V5 = path.resolve(here, '..');
const src = JSON.parse(fs.readFileSync(path.join(V5, 'sources', 'monsters-inc.json'), 'utf8'));
const cues = parseSrt(fs.readFileSync(path.resolve(V5, '..', 'data', 'monsters-inc.srt'), 'utf8'));

const ok = (confidence = 0.9) => ({ verdict: 'supports', confidence, by: 'hand (fixture)' });
const nothing = (confidence = 0.6) => ({ verdict: 'says_nothing', confidence, by: 'hand (fixture)' });
const contra = (confidence = 0.95) => ({ verdict: 'contradicts', confidence, by: 'hand (fixture)' });

const cast = [
  { id: 'C01', name: 'James P. "Sulley" Sullivan', tmdb: 'T1', aliases: ['Sulley', 'Mr. Sullivan', 'Kitty'], kind: 'creature', is_child: false, looks_frightening: true, disposition: 'ally', disposition_note: 'Top scarer who looks after the girl', group: 'creatures_figures',
    cites: { kind: ['W2', 'W5'], is_child: ['W5'], looks_frightening: ['W14'], disposition: ['W11', 'W13', 'W20'] },
    check: { kind: ok(0.9), is_child: ok(0.85), looks_frightening: nothing(0.55), disposition: ok(0.93) } },
  { id: 'C02', name: 'Mike Wazowski', tmdb: 'T2', aliases: ['Mike', 'Wazowski', 'Mikey'], kind: 'creature', is_child: false, looks_frightening: 'unknown', disposition: 'ally', disposition_note: "Sulley's best friend and assistant", group: 'none',
    cites: { kind: ['W7'], is_child: ['W7'], looks_frightening: [], disposition: ['W7', 'W13'] },
    check: { kind: nothing(0.6), is_child: ok(0.82), disposition: ok(0.9) } },
  { id: 'C03', name: 'Boo', tmdb: 'T3', aliases: ['the girl'], kind: 'child', is_child: true, looks_frightening: false, disposition: 'unknown', disposition_note: '', group: 'peril',
    cites: { kind: ['W6', 'T3'], is_child: ['W6'], looks_frightening: [], disposition: [] },
    check: { kind: ok(0.95), is_child: ok(0.97), looks_frightening: nothing(0.5) } },
  { id: 'C04', name: 'Randall Boggs', tmdb: 'T4', aliases: ['Randall'], kind: 'creature', is_child: false, looks_frightening: 'unknown', disposition: 'villain', disposition_note: 'Rival scarer who kidnaps to force screams', group: 'creatures_figures',
    cites: { kind: ['W5'], is_child: ['W5'], looks_frightening: [], disposition: ['W12', 'W22'] },
    check: { kind: nothing(0.55), is_child: ok(0.85), disposition: ok(0.96) } },
  { id: 'C05', name: 'Henry J. Waternoose', tmdb: 'T5', aliases: ['Waternoose'], kind: 'unknown', is_child: false, looks_frightening: 'unknown', disposition: 'villain', disposition_note: 'Company head secretly working with Randall', group: 'hostility',
    cites: { kind: [], is_child: ['W4'], looks_frightening: [], disposition: ['W16', 'W17', 'W26'] },
    check: { is_child: ok(0.85), disposition: ok(0.95) } },
  { id: 'C06', name: 'Fungus', tmdb: 'T9', aliases: ['Jeff Fungus'], kind: 'unknown', is_child: false, looks_frightening: 'unknown', disposition: 'threat', disposition_note: "Randall's assistant who guards the captive", group: 'none',
    cites: { kind: [], is_child: [], looks_frightening: [], disposition: ['L1444', 'L1445'] },
    check: { disposition: nothing(0.5) } },
  { id: 'C07', name: 'Abominable Snowman', tmdb: 'T8', aliases: ['Yeti'], kind: 'creature', is_child: false, looks_frightening: true, disposition: 'ally', disposition_note: 'Takes the banished pair to his lair', group: 'creatures_figures',
    cites: { kind: ['W18'], is_child: [], looks_frightening: ['W18'], disposition: ['W18'] },
    check: { kind: ok(0.85), looks_frightening: nothing(0.5), disposition: ok(0.88) } },
];

const dangers = [
  { id: 'D01', name: 'the scream extractor', kind: 'machine', note: 'Machine built to force screams from captives', group: 'objects_hazards', cites: ['W12', 'L1410'], check: ok(0.95) },
  { id: 'D02', name: 'the door vault', kind: 'place', note: 'Huge storage of doors where a chase happens', group: 'peril', cites: ['W21'], check: ok(0.84) },
  { id: 'D03', name: 'the garbage compactor', kind: 'machine', note: 'Crushes garbage into cubes', group: 'objects_hazards', cites: ['L1277'], check: nothing(0.5) },
  { id: 'D04', name: 'banishment to the human world', kind: 'situation', note: 'Being sent through a door to a remote place', group: 'separation', cites: ['W17', 'W23'], check: ok(0.9) },
];

const S = (text, cites, check) => ({ text, cites, check });
const scenes = [
  { id: 'S005', start_cue: 218, end_cue: 248, setting: 'company lobby', sentences: [
    S('Sulley arrives at work and several coworkers greet him by name.', ['L220', 'L222', 'L225', 'W5'], ok(0.9)),
    S('Two young fans wish Sulley luck, and Mike sends them away.', ['L235', 'L237', 'L238'], ok(0.86)),
  ] },
  { id: 'S017', start_cue: 587, end_cue: 647, setting: "a child's bedroom behind a door", sentences: [
    S('Sulley steps through a door and calls out to check whether anyone is there.', ['L589', 'L592', 'W6'], ok(0.9)),
    S('A toddler girl follows Sulley around the room while he yells and tries to get away from her.', ['L601', 'L605', 'L609', 'W7'], ok(0.84)),
    S('The girl calls Sulley "Kitty" and he tells her to stay back.', ['L633', 'L635'], ok(0.95)),
    S('Sulley returns the girl safely to her bedroom.', ['W7'], contra(0.93)),
  ] },
  { id: 'S032', start_cue: 1265, end_cue: 1310, setting: 'factory garbage area', sentences: [
    S('Mike looks at a cube of garbage and fears the girl was crushed inside it.', ['L1277', 'L1280'], ok(0.82)),
    S('The girl turns up unharmed, and Sulley says how worried he was.', ['L1287', 'L1288', 'L1289', 'L1291'], ok(0.92)),
    S('Laughter makes the lights buzz and bulbs shatter, and some small children cry.', ['L1300', 'L1301', 'L1302', 'L1304'], ok(0.86)),
  ] },
  { id: 'S036', start_cue: 1400, end_cue: 1461, setting: "Randall's hidden workshop", sentences: [
    S('Mike is held in front of a large machine moving toward him and begs to be let go.', ['L1405', 'L1407', 'L1416'], ok(0.88)),
    S('Randall presents the machine as the scream extractor.', ['L1409', 'L1410', 'W12'], ok(0.95)),
    S('The machine starts and Mike shouts for help.', ['L1417', 'L1424', 'L1425'], ok(0.93)),
    S('Randall had captured Mike by mistake and plans to force screams from kidnapped children.', ['W12', 'L1445'], ok(0.9)),
    S('The machine stops working and Mike is gone when Randall looks for him.', ['L1428', 'L1432', 'L1455', 'L1458'], ok(0.81)),
  ] },
  { id: 'S043', start_cue: 1707, end_cue: 1716, setting: 'a snowy mountainside', sentences: [
    S('Wind howls across a snowy mountainside in the Himalayas.', ['L1707', 'L1714', 'W17'], ok(0.85)),
    S('Sulley pushes through a blizzard toward a village below.', ['W19', 'L1713'], nothing(0.6)),
  ] },
  { id: 'S049', start_cue: 1981, end_cue: 1996, setting: 'a house in the human world', sentences: [
    S('A boy tells his mother a gator is in the house, and she goes after it with a shovel.', ['L1982', 'L1984', 'L1985', 'L1986'], ok(0.9)),
    S('Mike and Sulley praise the girl for beating Randall.', ['L1991', 'L1993', 'W22'], ok(0.86)),
    S('Randall is banished to the human world.', ['W23'], ok(0.95)),
  ] },
];

for (const s of scenes) {
  s.start_ms = cues[s.start_cue - 1].startMs;
  s.end_ms = cues[s.end_cue - 1].endMs;
  for (const x of s.sentences) {
    for (const c of x.cites.filter((c) => c[0] === 'L')) {
      const n = Number(c.slice(1));
      if (n < s.start_cue || n > s.end_cue) throw new Error(`${s.id}: ${c} outside the scene`);
    }
    if (x.text.split(/\s+/).length > 25) throw new Error(`${s.id}: sentence over 25 words`);
  }
  s.summary = s.sentences.filter((x) => x.check.verdict === 'supports' && x.check.confidence >= 0.8).map((x) => x.text).join(' ');
  const used = new Set(s.sentences.flatMap((x) => x.cites.map((c) => c[0])));
  s.sources_used = [['L', 'lines'], ['W', 'wikipedia'], ['T', 'tmdb']].filter(([k]) => used.has(k)).map(([, v]) => v);
}

// Quote rule: no run of more than 8 consecutive transcript words in any stored text.
const norm = (w) => w.toLowerCase().replace(/[^a-z0-9']/g, '');
const grams = new Set();
const words = cues.map((c) => c.text.split(/\s+/).map(norm).filter(Boolean));
for (const ws of words) for (let i = 0; i + 9 <= ws.length; i++) grams.add(ws.slice(i, i + 9).join(' '));
for (const t of [...scenes.flatMap((s) => s.sentences.map((x) => x.text)), ...cast.map((c) => c.disposition_note), ...dangers.map((d) => d.note)]) {
  const ws = t.split(/\s+/).map(norm).filter(Boolean);
  for (let i = 0; i + 9 <= ws.length; i++) if (grams.has(ws.slice(i, i + 9).join(' '))) throw new Error(`quote rule: "${t}"`);
}

const out = {
  fixture: {
    partial: true,
    hand_made: true,
    note: 'HAND-MADE FIXTURE (not Sonnet output). Six real Monsters, Inc. scenes; cast, dangers, sentences and check verdicts written by hand by Claude from the subtitle lines and sources/monsters-inc.json. Checks are hand labels in the claim-check shape, several deliberately unverified. For code development only.',
  },
  film: { slug: 'monsters-inc', title: src.film.title, year: src.film.year, imdb_id: src.film.imdb_id, tmdb_id: src.film.tmdb_id },
  sources: {
    tmdb: { id: src.tmdb.id, fetched_at: src.tmdb.fetched_at },
    wikipedia: { title: src.wikipedia.title, revision_id: src.wikipedia.revision_id, url: src.wikipedia.url, fetched_at: src.wikipedia.fetched_at, sentence_count: src.wikipedia.sentences.length },
  },
  model: 'hand (fixture)',
  run_at: new Date().toISOString(),
  cost_usd: 0,
  cast,
  dangers,
  scenes,
};
const file = path.join(V5, 'out', 'fixture.segments.json');
fs.mkdirSync(path.dirname(file), { recursive: true });
fs.writeFileSync(file, JSON.stringify(out, null, 2));
console.log(file, `${scenes.length} scenes, ${cast.length} cast, ${dangers.length} dangers`);
