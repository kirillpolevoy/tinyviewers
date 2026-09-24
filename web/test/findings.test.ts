// The film page's findings card, timeline and rows: the pure rules under FilmFindings.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
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
  assert.equal(FILM.readyLine('0:19:00', '0:22:35'), 'Be ready at 0:19:00 · ends around 0:22:35');
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

test('no parent-facing add copy describes beats or Jev’s screening', () => {
  const lines = [ADD.readingBody('Coco'), ADD.queuedBody('Coco'), ADD.finishingBody, ...Object.values(ADD.stepLabels)];
  for (const line of lines) assert.doesNotMatch(line, /beat|jev|screen/i, line);
  // Queued says it is waiting; it does not claim to be reading.
  assert.doesNotMatch(ADD.queuedHeadline('Coco'), /reading/i);
});

test('the navigation no longer offers the Watch page, and the Watch copy makes no guide-building claim', async () => {
  const { NAV, WATCH } = await import('../lib/copy');
  assert.deepEqual(NAV.map((n) => n.href), ['/library']);
  assert.doesNotMatch(WATCH.intro, /same steps that build/);
  assert.doesNotMatch(WATCH.recordedLead('1 May 2026'), /used up/);
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
