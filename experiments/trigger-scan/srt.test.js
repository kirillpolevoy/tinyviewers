// Run with: node --test experiments/trigger-scan/
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSrt, buildWindows, formatTime } from './srt.js';

const here = path.dirname(fileURLToPath(import.meta.url));

const SAMPLE = `1
00:00:01,000 --> 00:00:02,500
<i>Hello</i> there.

2
00:00:03,000 --> 00:00:04,000
Second line
continues here.

3
00:00:05,000 --> 00:00:06,000

4
00:02:10,000 --> 00:02:12,000
(THUNDER)
`;

test('parses cues, strips markup, joins lines, drops empty cues', () => {
  const cues = parseSrt(SAMPLE);
  assert.equal(cues.length, 3);
  assert.deepEqual(cues.map((c) => c.id), ['C0001', 'C0002', 'C0003']);
  assert.equal(cues[0].text, 'Hello there.');
  assert.equal(cues[1].text, 'Second line continues here.');
  assert.equal(cues[2].startMs, 130_000);
  assert.equal(formatTime(cues[2].startMs), '00:02:10');
});

function assertPartition(cues, windows) {
  assert.deepEqual(windows.flatMap((w) => w.cues.map((c) => c.id)), cues.map((c) => c.id));
  for (const w of windows) {
    assert.equal(w.startMs, w.cues[0].startMs);
    assert.equal(w.endMs, w.cues[w.cues.length - 1].endMs);
  }
}

test('windows contain every cue exactly once, in order', () => {
  const cues = Array.from({ length: 300 }, (_, i) => ({ id: `C${i}`, startMs: i * 4000 + (i % 25 === 0 ? 3500 : 0), endMs: i * 4000 + 2500, text: 'x' }))
    .map((c) => ({ ...c, endMs: Math.max(c.endMs, c.startMs + 500) }));
  const windows = buildWindows(cues);
  assertPartition(cues, windows);
  assert.ok(windows.every((w) => w.endMs - w.startMs <= 125_000));
});

for (const [track, expectedCues, lastCue] of [['db', 1984, '01:33:00'], ['sdh', 1575, '01:33:25']]) {
  const file = path.join(here, 'data', `nemo.${track}.srt`);
  test(`real ${track} track parses and windows cleanly`, { skip: !fs.existsSync(file) && 'run fetch-subtitles.js first' }, () => {
    const cues = parseSrt(fs.readFileSync(file, 'utf8'));
    assert.equal(cues.length, expectedCues);
    assert.equal(formatTime(cues[cues.length - 1].startMs), lastCue);
    assertPartition(cues, buildWindows(cues));
  });
}
