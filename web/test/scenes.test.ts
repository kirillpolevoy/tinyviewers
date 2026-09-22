import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyFilters,
  buildFacets,
  countAtStrongest,
  endsAroundMs,
  filmHref,
  formatTime,
  markerLeftPct,
  markerShape,
  readBand,
  readListParam,
  readyAtMs,
  dedupe,
  filmPageModel,
  MAX_TAGS,
  severityFor,
  strengthDots,
  strengthLabel,
} from '../lib/scenes';
import type { Scene } from '../lib/scenes';

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

test('times are H:MM:SS, zero-padded, and hours are not padded', () => {
  assert.equal(formatTime(0), '0:00:00');
  assert.equal(formatTime(66_000), '0:01:06');
  assert.equal(formatTime(186_000), '0:03:06');
  assert.equal(formatTime(5_503_000), '1:31:43');
  assert.equal(formatTime(36_000_000), '10:00:00');
  // Sub-second remainders floor, so a range never reads as a second longer than it is.
  assert.equal(formatTime(1999), '0:00:01');
});

test('a padded time is never negative and never prints a minus sign', () => {
  // "Be ready at" is the start minus 30 s; the first scene of a film starts inside that window.
  assert.equal(readyAtMs(0), 0);
  assert.equal(readyAtMs(12_000), 0);
  assert.equal(readyAtMs(30_000), 0);
  assert.equal(readyAtMs(186_000), 156_000);
  assert.equal(formatTime(readyAtMs(0)), '0:00:00');
  assert.equal(formatTime(readyAtMs(5_000)), '0:00:00');
  for (const start of [0, 1, 999, 29_999, 30_001, 1_000_000]) {
    assert.doesNotMatch(formatTime(readyAtMs(start)), /-/, `start=${start}`);
  }
  // The design's worked example: 0:24:43 → be ready at 0:24:13, ends 0:25:39 → around 0:25:54.
  assert.equal(formatTime(readyAtMs(1_483_000)), '0:24:13');
  assert.equal(formatTime(endsAroundMs(1_539_000)), '0:25:54');
});

test('the strength mark maps the stored severity to one set of words per band', () => {
  const s = scene({ id: 'a', severity57: 3, severity810: 2 });
  assert.equal(severityFor(s, '5-7'), 3);
  assert.equal(severityFor(s, '8-10'), 2);
  assert.equal(strengthLabel(3), '3 · Very strong');
  assert.equal(strengthLabel(2), '2 · Strong');
  assert.equal(strengthLabel(1), '1 · Mild');
  assert.equal(strengthLabel(0), '0 · Low');
  assert.equal(strengthDots(0), 0);
  assert.equal(strengthDots(2), 2);
});

test('a missing severity is not checked, never a zero', () => {
  const s = scene({ id: 'a' });
  assert.equal(severityFor(s, '5-7'), null);
  assert.equal(strengthLabel(null), null);
  assert.equal(strengthDots(null), 0);
  // And the timeline draws it in the neutral tone rather than as a level-0 mark.
  assert.equal(markerShape(null).tone, 'grey');
  assert.equal(markerShape(0).tone, 'mint');
});

test('markers are positioned by start time and sized by strength', () => {
  assert.equal(markerLeftPct(0, 100_000), 0);
  assert.equal(markerLeftPct(50_000, 100_000), 50);
  assert.equal(markerLeftPct(100_000, 100_000), 100);
  // Out-of-range or unknown durations must not throw or escape the strip.
  assert.equal(markerLeftPct(200_000, 100_000), 100);
  assert.equal(markerLeftPct(5_000, 0), 0);
  assert.ok(markerShape(3).heightPct > markerShape(2).heightPct);
  assert.ok(markerShape(2).heightPct > markerShape(1).heightPct);
});

test('filters are built only from labels that occur in the film, counted by scene', () => {
  const shark = { id: 'shark', label: 'Shark', channel: 'presence' as const };
  const dark = { id: 'darkness', label: 'Darkness', channel: 'presence' as const };
  const chase = { id: 'chased', label: 'Chase', channel: 'event' as const };
  const scenes = [
    scene({ id: 'a', tags: [shark, dark, chase] }),
    scene({ id: 'b', tags: [dark, chase] }),
    // A label listed twice on one scene counts once.
    scene({ id: 'c', tags: [dark, dark] }),
  ];

  const presence = buildFacets(scenes, 'presence');
  assert.deepEqual(
    presence.map((f) => [f.id, f.count]),
    [
      ['darkness', 3],
      ['shark', 1],
    ],
  );
  const events = buildFacets(scenes, 'event');
  assert.deepEqual(
    events.map((f) => [f.id, f.count]),
    [['chased', 2]],
  );
  // A label that occurs nowhere in this film cannot be offered.
  assert.ok(!presence.some((f) => f.id === 'ghost_spirit'));
});

test('"any of these" filtering, and a stale or hand-edited URL cannot invent a chip', () => {
  const shark = { id: 'shark', label: 'Shark', channel: 'presence' as const };
  const chase = { id: 'chased', label: 'Chase', channel: 'event' as const };
  const scenes = [
    scene({ id: 'a', tags: [shark] }),
    scene({ id: 'b', tags: [chase] }),
    scene({ id: 'c', tags: [] }),
  ];
  assert.equal(applyFilters(scenes, []).length, 3);
  assert.deepEqual(
    applyFilters(scenes, ['shark']).map((s) => s.id),
    ['a'],
  );
  assert.deepEqual(
    applyFilters(scenes, ['shark', 'chased']).map((s) => s.id),
    ['a', 'b'],
  );
  assert.deepEqual(applyFilters(scenes, ['ghost_spirit']), []);

  // A repeated id is one filter; an id this film does not have is kept, so the page can say
  // "No matches" instead of silently showing everything.
  assert.deepEqual(dedupe(['shark', 'ghost_spirit', 'shark']), ['shark', 'ghost_spirit']);
  assert.deepEqual(applyFilters(scenes, dedupe(['ghost_spirit'])), []);
});

test('query parameters: repeated, comma-joined, missing, and the age band default', () => {
  assert.deepEqual(readListParam(undefined), []);
  assert.deepEqual(readListParam('shark'), ['shark']);
  assert.deepEqual(readListParam(['shark', 'chased']), ['shark', 'chased']);
  assert.deepEqual(readListParam('shark,chased'), ['shark', 'chased']);
  assert.deepEqual(readListParam(' shark , '), ['shark']);
  assert.equal(readBand(undefined), '5-7');
  assert.equal(readBand('8-10'), '8-10');
  assert.equal(readBand('nonsense'), '5-7');
  assert.equal(readBand(['8-10']), '8-10');
});

test('a film URL round-trips the band and the selection, and stays clean at the default', () => {
  assert.equal(filmHref('nemo', { band: '5-7', selected: [] }), '/film/nemo');
  assert.equal(filmHref('nemo', { band: '8-10', selected: [] }), '/film/nemo?age=8-10');
  assert.equal(
    filmHref('nemo', { band: '5-7', selected: ['shark', 'chased'] }),
    '/film/nemo?tag=shark&tag=chased',
  );
  const href = filmHref('nemo', { band: '8-10', selected: ['shark'] });
  const params = new URLSearchParams(href.split('?')[1]);
  assert.equal(readBand(params.get('age') ?? undefined), '8-10');
  assert.deepEqual(readListParam(params.getAll('tag')), ['shark']);
});

test('the age band changes the mark and the counts, never which scenes are listed', () => {
  const shark = { id: 'shark', label: 'Shark', channel: 'presence' as const };
  const chase = { id: 'chased', label: 'Chase', channel: 'event' as const };
  const scenes = [
    scene({ id: 'a', startMs: 1000, endMs: 2000, severity57: 3, severity810: 2, tags: [shark] }),
    scene({ id: 'b', startMs: 3000, endMs: 4000, severity57: 3, severity810: 3, tags: [shark, chase] }),
    scene({ id: 'c', startMs: 5000, endMs: 6000, severity57: 1, severity810: 0, tags: [chase] }),
    scene({ id: 'd', startMs: 7000, endMs: 8000, severity57: null, severity810: null, tags: [] }),
  ];

  // The page's own data function, with the two query strings the toggle produces. Comparing the
  // whole model, not two calls to the same helper: this is what /film/x?age=8-10 actually renders.
  for (const tag of [undefined, 'shark', 'chased', 'ghost_spirit']) {
    const five = filmPageModel(scenes, { age: '5-7', tag });
    const eight = filmPageModel(scenes, { age: '8-10', tag });

    assert.equal(five.band, '5-7');
    assert.equal(eight.band, '8-10');
    assert.deepEqual(
      eight.scenes.map((s) => s.id),
      five.scenes.map((s) => s.id),
      `the listed scenes must not depend on the band (tag=${tag})`,
    );
    assert.deepEqual([...eight.matching], [...five.matching]);
    // The filters offered are the film's labels, not the band's.
    assert.deepEqual(eight.presence, five.presence);
    assert.deepEqual(eight.events, five.events);
    assert.deepEqual(eight.selected, five.selected);
  }

  // What the band does change: the mark on a row, and the count of the strongest.
  assert.equal(strengthLabel(severityFor(scenes[0], '5-7')), '3 · Very strong');
  assert.equal(strengthLabel(severityFor(scenes[0], '8-10')), '2 · Strong');
  assert.equal(filmPageModel(scenes, { age: '5-7' }).strongest, 2);
  assert.equal(filmPageModel(scenes, { age: '8-10' }).strongest, 1);

  // And flipping the band in the URL leaves the selection byte-for-byte intact.
  const selected = ['shark', 'chased'];
  const five = new URLSearchParams(filmHref('nemo', { band: '5-7', selected }).split('?')[1] ?? '');
  const eight = new URLSearchParams(filmHref('nemo', { band: '8-10', selected }).split('?')[1] ?? '');
  assert.deepEqual(five.getAll('tag'), selected);
  assert.deepEqual(eight.getAll('tag'), selected);
  assert.equal(five.get('age'), null, 'the default band stays out of the URL');
  assert.equal(eight.get('age'), '8-10');
});

test('tag lists from the query string are deduplicated and bounded', () => {
  // A repeated parameter, a comma-joined one and a mixture all collapse the same way.
  assert.deepEqual(readListParam(['a', 'b', 'a', 'b,c']), ['a', 'b', 'c']);
  assert.deepEqual(dedupe(['a', 'a', 'b', 'a']), ['a', 'b']);

  // Untrusted input: a caller can send any number of tags. Everything downstream gets at most
  // MAX_TAGS, including the links this app writes.
  const many = Array.from({ length: 500 }, (_, i) => `tag${i}`);
  assert.equal(readListParam(many).length, MAX_TAGS);
  assert.equal(readListParam(many.join(',')).length, MAX_TAGS);
  assert.equal(dedupe(many).length, MAX_TAGS);
  const href = filmHref('nemo', { band: '5-7', selected: many });
  assert.equal(new URLSearchParams(href.split('?')[1]).getAll('tag').length, MAX_TAGS);

  // The cap keeps the order: the first MAX_TAGS asked for, not an arbitrary subset.
  assert.deepEqual(readListParam(many).slice(0, 3), ['tag0', 'tag1', 'tag2']);
});
