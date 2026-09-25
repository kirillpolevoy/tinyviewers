// The film page's findings card, timeline and rows: the pure rules under FilmFindings.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MARK_PX,
  MARK_PX_NARROW,
  MARK_GAP_PX,
  clusterMarkers,
  markWidthPx,
  formatRuntime,
  lastSceneEndMs,
  markerHeightPx,
  mergedFacets,
  severityTone,
  strengthBreakdown,
  strengthWord,
  visibleScenes,
} from '../lib/scenes';
import type { Scene, SceneTag } from '../lib/scenes';
import { ADD, FILM, formatElapsed, sceneCountLabel } from '../lib/copy';
import type { StepStatus } from '../lib/job';

const tag = (id: string, channel: SceneTag['channel'] = 'presence'): SceneTag => ({ id, label: id, channel });

const scene = (over: Partial<Scene> & { id: string }): Scene => ({
  startMs: 0,
  endMs: 1000,
  title: 'A scene',
  description: null,
  severity57: null,
  severity810: null,
  tags: [],
  ...over,
});

const SCENES = [
  scene({ id: 'a', startMs: 1000, endMs: 5000, severity57: 3, severity810: 2, tags: [tag('shark'), tag('chased', 'event')] }),
  scene({ id: 'b', startMs: 9000, endMs: 12_000, severity57: 2, severity810: 1, tags: [tag('shark')] }),
  scene({ id: 'c', startMs: 20_000, endMs: 30_000, severity57: 0, severity810: 0, tags: [tag('dark')] }),
  scene({ id: 'd', startMs: 40_000, endMs: 41_000, severity57: null, severity810: 3, tags: [] }),
];

test('the breakdown recomputes per band, strongest first, and leaves empty levels out', () => {
  assert.deepEqual(
    strengthBreakdown(SCENES, '5-7').map((e) => `${e.count} ${e.word}`),
    ['1 very strong', '1 strong', '1 low', '1 not checked'],
  );
  assert.deepEqual(
    strengthBreakdown(SCENES, '8-10').map((e) => `${e.count} ${e.word}`),
    ['1 very strong', '1 strong', '1 mild', '1 low'],
  );
});

test('a missing rating is "Not checked" and dust — never counted, drawn or worded as a zero', () => {
  assert.equal(strengthWord(null), 'Not checked');
  assert.equal(strengthWord(0), 'Low');
  assert.equal(strengthWord(3), 'Very strong');
  assert.equal(severityTone(null), 'dust');
  assert.equal(severityTone(0), 'mint');
  const low = strengthBreakdown(SCENES, '5-7').find((e) => e.value === 0);
  assert.equal(low?.count, 1, 'the not-checked scene is not a low one');
});

test('timeline markers get taller with strength; not checked is the shortest', () => {
  assert.deepEqual([null, 0, 1, 2, 3].map((v) => markerHeightPx(v)), [12, 12, 20, 32, 46]);
});

test('the chips are one group: both channels merged, counted once per scene, most common first', () => {
  assert.deepEqual(
    mergedFacets(SCENES).map((f) => `${f.id}:${f.count}`),
    ['shark:2', 'chased:1', 'dark:1'],
  );
});

test('a tapped marker narrows the list to its scene; otherwise chips filter; the band never does', () => {
  assert.deepEqual(visibleScenes(SCENES, { selectedSceneId: 'b', tags: [] }).map((s) => s.id), ['b']);
  assert.deepEqual(visibleScenes(SCENES, { selectedSceneId: null, tags: ['shark'] }).map((s) => s.id), ['a', 'b']);
  assert.deepEqual(visibleScenes(SCENES, { selectedSceneId: null, tags: [] }).length, 4);
  // A selection that no longer exists falls back to the filtered list rather than to nothing.
  assert.deepEqual(visibleScenes(SCENES, { selectedSceneId: 'gone', tags: ['dark'] }).map((s) => s.id), ['c']);
});

test('all clear after the latest end, not the last row', () => {
  const outOfOrder = [scene({ id: 'x', startMs: 0, endMs: 50_000 }), scene({ id: 'y', startMs: 10_000, endMs: 20_000 })];
  assert.equal(lastSceneEndMs(outOfOrder), 50_000);
  assert.equal(lastSceneEndMs([]), 0);
});

test('runtime reads as hours and minutes', () => {
  assert.equal(formatRuntime(5_280_000), '1 h 28 min');
  assert.equal(formatRuntime(26 * 60_000), '26 min');
});

test('the copy counts things properly', () => {
  assert.equal(sceneCountLabel(1), '1 scene');
  assert.equal(sceneCountLabel(18), '18 scenes');
  assert.equal(FILM.filterShowing(6, 18), 'Showing 6 of 18 scenes.');
  assert.equal(FILM.filterShowing(18, 18), 'Showing all 18 scenes.');
  assert.equal(FILM.readyLine('0:19:00', '0:22:35'), 'Skip from 0:19:00 to about 0:22:35.');
  assert.equal(ADD.stepLine('Reading the film for scenes'), 'Reading the film for scenes…');
});

test('the live add card says how long the run has been going, in whole seconds', () => {
  assert.equal(formatElapsed(0), '0 s');
  assert.equal(formatElapsed(42_900), '42 s');
  assert.equal(formatElapsed(60_000), '1 min 00 s');
  assert.equal(formatElapsed(185_400), '3 min 05 s');
  // A clock skew between the API's hosts must not read as negative time.
  assert.equal(formatElapsed(-500), '0 s');
  assert.equal(ADD.elapsedLine(185_400), '3 min 05 s so far');
});

test('every step state the API can report has a word, not just a colour', () => {
  const states: StepStatus[] = ['pending', 'running', 'done', 'failed'];
  for (const state of states) assert.ok(ADD.stepState[state].length > 0, state);
});

test('no parent-facing copy says "shelf"', async () => {
  const copy = await import('../lib/copy');
  const strings: string[] = [];
  const walk = (value: unknown) => {
    if (typeof value === 'string') strings.push(value);
    else if (typeof value === 'function') {
      const fn = value as (...args: unknown[]) => unknown;
      const out = fn.length === 0 ? fn() : fn(...Array.from({ length: fn.length }, () => 1));
      walk(out);
    } else if (value && typeof value === 'object') Object.values(value).forEach(walk);
  };
  Object.values(copy).forEach(walk);
  const offenders = strings.filter((s) => /shelf/i.test(s));
  assert.deepEqual(offenders, []);
});

// ---- honesty fixes from the round-3 review -------------------------------------------------------

test('the add card lists only the steps that build the guide, in the page’s words', async () => {
  const { parentSteps } = await import('../lib/job');
  const mk = (id: string) => ({ id, label: `api ${id}`, status: 'pending' as const, started_ms: null, ended_ms: null, detail: null });
  const shown = parentSteps(['subtitles', 'jev', 'scenes', 'presence', 'excerpts', 'ingest', 'toString', 'new-stage'].map(mk));
  assert.deepEqual(shown.map((s) => s.id), ['subtitles', 'scenes', 'presence', 'ingest']);
  assert.equal(shown[3].label, 'Saving the scene guide');
});

test('no parent-facing add copy describes beats or screening', () => {
  // The Jev-first rows name Jev and Sonnet on purpose (owner-approved); the retired beat screening
  // is still never described to a parent.
  const lines = [
    ADD.readingBody('Coco'),
    ADD.queuedBody('Coco'),
    ADD.finishingBody,
    ADD.sonnetReadingBody('Coco'),
    ADD.checkingBody('Coco'),
    ...Object.values(ADD.stepLabels),
    ...Object.values(ADD.stepPace),
  ];
  for (const line of lines) assert.doesNotMatch(line, /beat|screen/i, line);
  // Queued says it is waiting; it does not claim to be reading.
  assert.doesNotMatch(ADD.queuedHeadline('Coco'), /reading/i);
});

test('Watch it work is linked from the navigation by the one switch', async () => {
  const { NAV, WATCH_LINKED } = await import('../lib/copy');
  assert.equal(WATCH_LINKED, true);
  assert.deepEqual(NAV.map((n) => n.href), ['/library', '/watch']);
});

test('a flagged scene says why even with no description, and never shows the placeholder title', async () => {
  const { parseWhy, sceneHeading, PLACEHOLDER_TITLE } = await import('../lib/scenes');
  const stored = { line: 'Creature threatens · Child in danger', tags: [{ label: 'Creature threatens', by: ['jev'] }, { label: 'Child in danger', by: ['jev'] }] };
  assert.deepEqual(parseWhy(stored), ['Creature threatens', 'Child in danger']);
  assert.deepEqual(parseWhy(JSON.stringify(stored)), ['Creature threatens', 'Child in danger']);
  assert.deepEqual(parseWhy('Chased · Fire'), ['Chased', 'Fire']);
  assert.deepEqual(parseWhy(['Fire', 'fire', ' ']), ['Fire']);
  // A guide built before v10.4 has no reasons stored: no chips, no error.
  assert.deepEqual(parseWhy(null), []);
  assert.deepEqual(parseWhy({ nonsense: 1 }), []);
  const base = { startMs: 60_000 };
  assert.equal(sceneHeading({ ...base, title: 'Sharks chase Marlin' }), 'Sharks chase Marlin');
  // No checked title: named by where it starts, never by its reasons stitched into a title.
  assert.equal(sceneHeading({ ...base, title: PLACEHOLDER_TITLE }), 'Scene starting at 0:01:00');
  assert.equal(sceneHeading({ startMs: 653_376, title: '  ' }), 'Scene starting at 0:10:53');
});

test('a scene pass that found nothing is its own sentence, not "something went wrong"', async () => {
  const { failureSentence } = await import('../lib/job');
  assert.equal(failureSentence('no_scenes', 'x'), ADD.failNoScenes);
  assert.doesNotMatch(ADD.failNoScenes, /went wrong/);
});

test('the phone synopsis splits after the first sentence, not inside "Dr."', async () => {
  const { splitFirstSentence } = await import('../lib/scenes');
  assert.deepEqual(splitFirstSentence('Nemo is taken. Marlin follows.'), ['Nemo is taken.', 'Marlin follows.']);
  assert.deepEqual(splitFirstSentence('Dr. Sherman takes Nemo. Marlin follows.'), ['Dr. Sherman takes Nemo.', 'Marlin follows.']);
  assert.deepEqual(splitFirstSentence('One sentence only.'), ['One sentence only.', '']);
  assert.deepEqual(splitFirstSentence('Home -- meeting sharks... and more'), ['Home -- meeting sharks... and more', '']);
});

test('the film page states the subtitle release its times follow, when it is known', () => {
  assert.match(FILM.aboutTiming('Coco.2017.1080p.WEB'), /Coco\.2017\.1080p\.WEB/);
  assert.doesNotMatch(FILM.aboutTiming(null), /\(\)/);
});

test('the open row gets every stored reason tag, in order, whatever shape the guide stored', async () => {
  const { parseWhyTags } = await import('../lib/scenes');
  const v104 = {
    line: 'Weapon used · The Iron Giant in danger',
    tags: [
      { label: 'Weapon used', category: null, ids: ['weapon_used'], by: ['sonnet'], p: 0.8, rule: 'strong_event' },
      { label: 'The Iron Giant in danger', category: 'Character in danger', ids: ['C01_in_danger'], by: ['jev'], p: 0.93, rule: 'film_child_in_danger' },
    ],
  };
  assert.deepEqual(parseWhyTags(v104), [
    { label: 'Weapon used', category: null, rule: 'strong_event' },
    { label: 'The Iron Giant in danger', category: 'Character in danger', rule: 'film_child_in_danger' },
  ]);
  assert.deepEqual(parseWhyTags(JSON.stringify(v104)).length, 2);
  // An older guide: labels only.
  assert.deepEqual(parseWhyTags({ tags: [{ label: 'Chased', by: ['jev'] }, { label: 'chased' }] }), [{ label: 'Chased', category: null, rule: null }]);
  assert.deepEqual(parseWhyTags('Chased · Fire').map((t) => t.label), ['Chased', 'Fire']);
  assert.deepEqual(parseWhyTags(null), []);
  assert.deepEqual(parseWhyTags({ nonsense: 1 }), []);
});

test('a mark can stand for several scenes: the list is those scenes', () => {
  assert.deepEqual(visibleScenes(SCENES, { selectedIds: ['a', 'b'], tags: [] }).map((s) => s.id), ['a', 'b']);
  // A selection wins over the chips, as one tapped scene always has.
  assert.deepEqual(visibleScenes(SCENES, { selectedIds: ['c', 'd'], tags: ['shark'] }).map((s) => s.id), ['c', 'd']);
  assert.deepEqual(visibleScenes(SCENES, { selectedIds: [], tags: ['shark'] }).map((s) => s.id), ['a', 'b']);
  assert.deepEqual(visibleScenes(SCENES, { selectedIds: ['gone'], tags: [] }).length, 4);
});

test('scenes too close to draw apart share one mark, as strong as the strongest', () => {
  type M = { id: string; pct: number; v: number | null };
  const marks: M[] = [
    { id: 'a', pct: 10, v: 1 },
    { id: 'b', pct: 11, v: 3 },
    { id: 'c', pct: 12.5, v: null },
    { id: 'd', pct: 30, v: 2 },
    { id: 'e', pct: 80, v: null },
    { id: 'f', pct: 81, v: null },
  ];
  const at = (m: M) => m.pct;
  const level = (m: M) => m.v;
  // 600 px wide: a mark and its gap are 2 % of the track, so a, b and c (each within 2 % of the last) are one.
  assert.equal(markWidthPx(600), MARK_PX);
  assert.equal(((MARK_PX + MARK_GAP_PX) / 600) * 100, 2);
  const on600 = clusterMarkers(marks, at, level, 600);
  assert.deepEqual(on600.map((c) => c.items.map((m) => m.id)), [['a', 'b', 'c'], ['d'], ['e', 'f']]);
  assert.deepEqual(on600.map((c) => [c.firstPct, c.lastPct, c.value]), [[10, 12.5, 3], [30, 30, 2], [80, 81, null]]);
  // A phone's narrow track draws narrower marks, so fewer scenes need to share one: 8 px is 2.67 % of 300.
  assert.equal(markWidthPx(300), MARK_PX_NARROW);
  assert.deepEqual(clusterMarkers(marks, at, level, 300).map((c) => c.items.map((m) => m.id)), [['a', 'b', 'c'], ['d'], ['e', 'f']]);
  const pair = (gap: number): M[] => [{ id: 'x', pct: 50, v: 1 }, { id: 'y', pct: 50 + gap, v: 2 }];
  assert.equal(clusterMarkers(pair(2.6), at, level, 300).length, 1);
  assert.equal(clusterMarkers(pair(2.7), at, level, 300).length, 2);
  // Wide enough, every scene has its own mark; not measured yet (0), the same, as the server draws it.
  assert.equal(clusterMarkers(marks, at, level, 3000).length, 6);
  assert.equal(markWidthPx(0), MARK_PX);
  assert.equal(clusterMarkers(marks, at, level, 0).length, 6);
  // Out of order in, film order out.
  assert.deepEqual(clusterMarkers([marks[3], marks[0]], at, level, 0).map((c) => c.items[0].id), ['a', 'd']);
});

test('a breakdown with every scene at one level says the level, not the count again', () => {
  assert.equal(FILM.breakdownAll('very strong', 11), 'All very strong');
  assert.equal(FILM.breakdownAll('strong', 2), 'Both strong');
  assert.equal(FILM.breakdownAll('mild', 1), 'Mild');
  assert.equal(FILM.verdictWords, 'scenes to know about');
});
