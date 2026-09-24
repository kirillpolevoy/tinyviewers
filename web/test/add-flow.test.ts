// The add flow, end to end in the library's own rules: an accepted POST becomes a queued card, the
// card is polled through running to done, the list is refreshed until the film is in it, and the
// film leads the list with its "Just added" chip while the URL goes back to plain /library. Then the
// two ways that sequence used to go wrong: a reload that catches the run just after it finished, and
// a refresh whose answer does not have the film yet.
//
// The React parts (LibraryShelf, AddLive) only carry these decisions out; the browser check for the
// whole thing is in the README's verification notes.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ARRIVAL_RETRY_MS,
  MAX_ARRIVAL_REFRESHES,
  addedFilm,
  arrivalStep,
  libraryHref,
  showsAsCard,
  withJustAdded,
} from '../lib/add-flow';
import { POLL_MS, startJobPoll, type PollAnswer } from '../lib/poll';
import { parentSteps, type Job, type JobStep } from '../lib/job';

const step = (id: string, status: JobStep['status'], label = id): JobStep => ({
  id,
  label,
  status,
  started_ms: null,
  ended_ms: null,
  detail: null,
});

const STAGES = ['subtitles', 'jev', 'scenes', 'presence', 'excerpts', 'ingest'];

const job = (status: Job['status'], running: number | null, slug: string | null = null): Job => ({
  id: 'job-coco',
  kind: 'add',
  status,
  step: running === null ? null : STAGES[running],
  steps: STAGES.map((id, i) =>
    step(id, status === 'done' || (running !== null && i < running) ? 'done' : i === running ? 'running' : 'pending'),
  ),
  film: { title: 'Coco', year: 2017, slug, poster_url: null, imdb_id: 'tt2380307' },
  cost_usd: null,
  error_code: null,
  error: null,
  recording_ready: false,
  scene_count: null,
  elapsed_ms: 1000,
  created_at: '',
  updated_at: '',
});

const LIBRARY = [{ slug: 'nemo' }, { slug: 'lion-king' }];

test('accepted → queued → running → done → refreshed row with "Just added" → plain URL', async () => {
  // 1. The POST was accepted: the card shows the queued job and the URL names it.
  const queued: Job = { ...job('queued', null), steps: [] };
  assert.equal(showsAsCard(queued), true);
  assert.equal(libraryHref('coco', queued.id), '/library?q=coco&job=job-coco');
  assert.equal(libraryHref('', queued.id), '/library?job=job-coco');

  // 2. The poll carries it through its steps to done, one answer at a time.
  const script: PollAnswer[] = [
    { kind: 'job', job: job('running', 0) },
    { kind: 'job', job: job('running', 2) },
    { kind: 'job', job: job('running', 5) },
    { kind: 'job', job: job('done', null, 'coco') },
  ];
  const seen: Job[] = [];
  const timers = {
    setTimeout: (fn: () => void) => {
      setImmediate(fn);
      return 0;
    },
    clearTimeout: () => {},
    now: () => 0,
  };
  await new Promise<void>((resolve) => {
    startJobPoll({
      job: queued,
      timers,
      fetchJob: async () => script.shift()!,
      onJob: (j) => {
        seen.push(j);
        if (j.status === 'done') setImmediate(resolve);
      },
      onHealth: () => {},
    });
  });
  assert.deepEqual(seen.map((j) => j.status), ['running', 'running', 'running', 'done']);
  assert.ok(POLL_MS > 0);

  // What the parent read on the way: only the steps that build the guide, in the page's words.
  assert.deepEqual(
    parentSteps(seen[1].steps).map((s) => `${s.label}:${s.status}`),
    [
      'Finding the subtitles:done',
      'Reading the subtitles for scenes:running',
      'Labelling what is in each scene:pending',
      'Saving the scene guide:pending',
    ],
  );

  // 3. Done names the film. The card goes; the film is chipped and the URL is plain again.
  const done = seen[seen.length - 1];
  const film = addedFilm(done);
  assert.deepEqual(film, { slug: 'coco', title: 'Coco' });
  assert.equal(showsAsCard(done), false);
  const chips = withJustAdded(['lion-king'], film!.slug);
  assert.deepEqual(chips, ['coco', 'lion-king']);
  assert.equal(libraryHref('', null), '/library');

  // 4. The list on screen predates the film: refresh at once. The refreshed list has it: done.
  assert.deepEqual(arrivalStep('coco', LIBRARY, 0), { kind: 'refresh', delayMs: 0 });
  const refreshed = [...LIBRARY, { slug: 'coco' }];
  assert.deepEqual(arrivalStep('coco', refreshed, 1), { kind: 'arrived' });
});

test('a reload that reads the library just before the film is written and the job just after', () => {
  // The page loaded with ?job= and the job already done; the film list it fetched a moment earlier
  // does not have the film. It must not be dropped: no card, but the same arrival as a live finish.
  const done = job('done', null, 'coco');
  assert.equal(showsAsCard(done), false, 'a finished run is not a card');
  assert.deepEqual(addedFilm(done), { slug: 'coco', title: 'Coco' }, 'but its film still has to land');
  assert.deepEqual(arrivalStep('coco', LIBRARY, 0), { kind: 'refresh', delayMs: 0 });
});

test('a refresh that comes back without the film is asked again, a few times, then left as a link', () => {
  assert.deepEqual(arrivalStep('coco', LIBRARY, 1), { kind: 'refresh', delayMs: ARRIVAL_RETRY_MS });
  assert.deepEqual(arrivalStep('coco', LIBRARY, 2), { kind: 'refresh', delayMs: ARRIVAL_RETRY_MS });
  assert.deepEqual(arrivalStep('coco', LIBRARY, MAX_ARRIVAL_REFRESHES), { kind: 'gave-up' });
});

test('a done job that names no film, and a failed one, stay on screen as cards', () => {
  assert.equal(showsAsCard(job('done', null, null)), true);
  assert.equal(showsAsCard({ ...job('failed', 2), error_code: 'no_scenes' }), true);
  assert.equal(addedFilm(job('failed', 2)), null);
  assert.equal(showsAsCard(null), false);
});

test('the chip list keeps each film once, newest first', () => {
  assert.deepEqual(withJustAdded(['coco', 'nemo'], 'coco'), ['coco', 'nemo']);
  assert.deepEqual(withJustAdded([], 'coco'), ['coco']);
});
