// node --test test/  — v6 wordless-action spans (spans.js). Synthetic cues only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { reactsToAction, beginMs, spanFromLines, wholeSceneSpan, songBlocks, widenOverSongs, sceneBounds, unionSpans } from '../spans.js';
import { loadPolicy } from '../select.js';

const cfg = loadPolicy();
const cue = (index, startS, endS, text) => ({ index, startMs: startS * 1000, endMs: endS * 1000, text });

test('reactsToAction: captions of reactions/impacts, cries of alarm, short exclamations; not ambient hums or plain talk', () => {
  for (const t of ['(SCREAMS)', '[gasps]', '( growling )', '(CRASH)', 'Help!', 'Look out!', 'Run! Run!', 'No!', 'Aah!', 'Simba!', '- Whoa! - Hey!']) assert.equal(reactsToAction(t), true, t);
  for (const t of ['(electrical humming)', '( machine whirring )', 'So what do you want for dinner?', 'Hello there.', '# La la la #', 'I told you before that we should go home now!']) assert.equal(reactsToAction(t), false, t);
});

test('lead-in: a reacting first line takes the silence before it, bounded at 60 s, never before the previous line', () => {
  const prev = cue(9, 10, 12, 'Okay.');
  const first = cue(10, 40, 41, '(SCREAMING)');
  assert.deepEqual(beginMs(first, prev, 40000, cfg), { start_ms: 12000, lead_in: true });
  const farPrev = cue(9, 10, 12, 'Okay.');
  const late = cue(10, 200, 201, 'Help!');
  assert.deepEqual(beginMs(late, farPrev, 200000, cfg), { start_ms: 140000, lead_in: true });
  // a gap under min_gap_ms is no lead-in; a plain line pads back 15 s, clamped to the floor
  assert.equal(beginMs(cue(10, 13, 14, 'Help!'), prev, 13000, cfg).lead_in, false);
  assert.deepEqual(beginMs(cue(10, 40, 41, 'Well then.'), prev, 30000, cfg), { start_ms: 30000, lead_in: false });
  // the film's first line: silence from 0
  assert.deepEqual(beginMs(cue(1, 30, 31, '(ROARS)'), null, 30000, cfg), { start_ms: 0, lead_in: true });
});

test('spanFromLines: the lead-in may cross the scene start into the previous scene\'s trailing gap; the trailing side is bounded', () => {
  // previous scene's last line ends at 100 s; this scene's lines start at 150 s (scene_bounds: previous scene owns 100-150 s)
  const cues = [cue(20, 150, 151, '(ROARING)'), cue(21, 152, 154, 'Get back!'), cue(22, 160, 162, 'It is gone.')];
  const byIndex = new Map([[19, cue(19, 98, 100, 'Good night.')], ...cues.map((c) => [c.index, c])]);
  const lineIds = cues.map((c) => `L${c.index}`);
  const byId = new Map(cues.map((c) => [`L${c.index}`, c]));
  const scene = { start_ms: 150000, end_ms: 300000 };
  const s = spanFromLines(0, 1, lineIds, byId, scene, cfg, byIndex);
  assert.deepEqual([s.start_ms, s.end_ms, s.lead_in], [100000, 159000, true]);
  // the span that ends at the scene's last line runs over the silence after it, at most 60 s
  const t = spanFromLines(2, 2, lineIds, byId, scene, cfg, byIndex);
  assert.equal(t.end_ms, 162000 + 60000);
  // whole-scene skip: the same lead-in at the scene's first line
  assert.deepEqual(wholeSceneSpan(scene, cues, cfg, byIndex), { start_ms: 100000, end_ms: 300000, lead_in: true });
  assert.deepEqual(wholeSceneSpan(scene, [cue(20, 150, 151, 'Morning.')], cfg, byIndex), { start_ms: 150000, end_ms: 300000, lead_in: false });
});

test('songs are one moment: a span that begins or ends inside a song covers the whole song', () => {
  const texts = ['Talk.', '# la #', '# la #', '# la #', 'Spoken one.', 'Spoken two.', '# la #', '# la #', '# la #', 'After song.', 'More talk.'];
  assert.deepEqual(songBlocks(texts, { min_lyric_lines: 6, max_gap_lines: 8 }), [[1, 8]]);
  assert.deepEqual(songBlocks(texts, { min_lyric_lines: 7, max_gap_lines: 8 }), [], 'too few lyric lines is not a song');
  assert.deepEqual(widenOverSongs(4, 5, texts, cfg), [1, 8]);
  assert.deepEqual(widenOverSongs(9, 10, texts, cfg), [9, 10], 'outside the song: unchanged');
  const cues = texts.map((t, i) => cue(i + 1, 10 * i, 10 * i + 2, t));
  const lineIds = cues.map((c) => `L${c.index}`);
  const s = spanFromLines(4, 5, lineIds, new Map(cues.map((c) => [`L${c.index}`, c])), { start_ms: 0, end_ms: 200000 }, cfg);
  assert.deepEqual([s.start_ms, s.end_ms], [10000 - 15000 < 0 ? 0 : 10000 - 15000, 82000 + 5000]);
});

test('scene bounds run to the next scene; union keeps the lead-in mark', () => {
  const b = sceneBounds([{ start_ms: 5000, end_ms: 9000 }, { start_ms: 20000, end_ms: 30000 }], cfg);
  assert.deepEqual(b.map((x) => [x.start_ms, x.end_ms, x.line_start_ms, x.line_end_ms]), [[0, 20000, 5000, 9000], [20000, 30000, 20000, 30000]]);
  assert.deepEqual(unionSpans([{ start_ms: 0, end_ms: 10, lead_in: true }, { start_ms: 5, end_ms: 20 }]), [{ start_ms: 0, end_ms: 20, lead_in: true }]);
});
