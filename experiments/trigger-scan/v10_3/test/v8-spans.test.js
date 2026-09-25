// node --test test/  -- v8 fix (a): spans extend over adjacent wordless peaks (spans.js wordlessEdge).
import test from 'node:test';
import assert from 'node:assert/strict';
import { wordlessEdge, spanFromLines, unionSpans } from '../spans.js';
import { loadPolicy } from '../select.js';

const cfg = loadPolicy();
const EXT = cfg.wordless.extend;
const cue = (index, s, e, text) => ({ index, startMs: s * 1000, endMs: e * 1000, text });

test('policy: the extension the dev films chose (60 s, 70% silence, a 10 s silence)', () => {
  assert.deepEqual({ max_ms: EXT.max_ms, min_silence_share: EXT.min_silence_share, big_gap_ms: EXT.big_gap_ms }, { max_ms: 60000, min_silence_share: 0.7, big_gap_ms: 10000 });
});

// Iron Giant deer layout: dialogue, then a 33 s silence (the shot), a quiet line, the begin line cries out
const deer = [
  cue(667, 3041, 3043, 'Hey, look!'), cue(668, 3044, 3046, 'It is a deer.'), cue(669, 3046, 3047, 'Deer? Shh.'), cue(670, 3048, 3049, 'Let us get closer.'),
  cue(671, 3082, 3085, 'Hmm. Well, I guess he decided to...'), cue(672, 3093, 3096, "It's the monster!"), cue(673, 3099, 3100, 'Oh, no.'), cue(674, 3108, 3110, "It's dead."),
];

test('begin edge walks back over the silence before a quiet line when the begin line reacts (deer)', () => {
  const r = wordlessEdge('begin', deer, 5, EXT, {});
  // the FARTHEST qualifying point within 60 s: back over the 33 s silence and the three short lines
  // before it (the stretch L667 end .. L672 is still 86% silent), to the end of L667
  assert.equal(r.start_ms, 3043000);
  assert.equal(r.from_index, 668);
  assert.ok(r.start_ms <= 3049000, 'the whole 33 s silence is covered');
});

test('begin edge stops where the stretch stops being mostly silent', () => {
  const talky = [cue(1, 0, 2.5, 'a'), cue(2, 3, 5.5, 'b'), cue(3, 6, 8.5, 'c'), cue(4, 9, 11.5, 'd'), cue(5, 12, 14.5, 'e'), cue(6, 30, 32, 'Look out!')];
  const r = wordlessEdge('begin', talky, 5, EXT, {});
  // 30 s edge: back to 8.5 s the stretch is 21.5 s with 5 s of cues (77% silent); one more line makes
  // it 24.5 s with 7.5 s of cues (69%), below the 70% floor
  assert.equal(r.start_ms, 8500);
});

test('begin edge does not walk over dense dialogue', () => {
  const dense = Array.from({ length: 10 }, (_, i) => cue(i + 1, i * 3, i * 3 + 2.5, 'we talk and talk here'));
  assert.equal(wordlessEdge('begin', dense, 9, EXT, {}), null);
  assert.equal(wordlessEdge('end', dense, 0, EXT, {}), null);
});

test('begin edge needs a reaction: a long silence before calm talk is not extended', () => {
  const calm = [cue(1, 0, 2, 'so we went home'), cue(2, 30, 32, 'and then we had dinner')];
  assert.equal(wordlessEdge('begin', calm, 1, EXT, {}), null);
});

// Up storm layout: the end line, then captions and yells separated by long silences
const storm = [
  cue(288, 1593, 1595, "There's a storm coming. It's starting to get scary."), cue(289, 1595, 1598, "We're gonna get blown to bits!"),
  cue(290, 1598, 1600, '(THUNDER RUMBLES)'), cue(291, 1600, 1602, '- What are you doing over there? - Look.'), cue(292, 1605, 1607, '(WIND HOWLING)'),
  cue(293, 1614, 1616, 'See? Cumulonimbus.'), cue(294, 1632, 1633, '(YELLS)'), cue(295, 1635, 1638, '(YELLING)'), cue(296, 1652, 1653, 'My pack!'),
];

test('end edge runs over the captions and yells of a wordless storm, farthest qualifying cue, + pad', () => {
  const r = wordlessEdge('end', storm, 1, EXT, { sceneEndMs: 1658000, padMs: 5000 });
  assert.equal(r.to_index, 296);
  assert.equal(r.end_ms, 1658000); // L296 end + 5 s, clamped to the scene end
});

test('the walk is bounded by max_ms from the edge line', () => {
  const r = wordlessEdge('end', storm, 1, { ...EXT, max_ms: 30000 }, { sceneEndMs: 1700000 });
  assert.ok(r === null || r.to_index <= 293, 'nothing past 30 s');
});

test('spanFromLines applies the extension and marks it; unionSpans keeps the mark', () => {
  const lineIds = storm.map((c) => `L${c.index}`);
  const cuesById = new Map(storm.map((c) => [`L${c.index}`, c]));
  const scene = { start_ms: 1591000, end_ms: 1658000 };
  const noExt = { ...cfg, wordless: { ...cfg.wordless, extend: null } };
  const a = spanFromLines(0, 1, lineIds, cuesById, scene, noExt);
  const b = spanFromLines(0, 1, lineIds, cuesById, scene, cfg);
  assert.equal(a.end_ms, 1603000);
  assert.equal(b.end_ms, 1658000);
  assert.deepEqual(b.wordless, { end_to: 'L296' });
  assert.equal(unionSpans([b])[0].wordless, true);
});
