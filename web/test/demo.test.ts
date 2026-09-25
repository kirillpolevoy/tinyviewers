// Watch it work: the pure rules the live board is drawn from, and the add card's Jev-first rows.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  claimKept,
  claimOutcome,
  countLabel,
  cutDoubted,
  cutPositions,
  flaggedBreakdown,
  formatCost,
  formatRunTime,
  isRunLive,
  latest,
  pickState,
  runRefusal,
  sceneNumber,
  stageShare,
  tileHeightPx,
  tileKind,
  normalizeRun,
  feedScene,
  whyTags,
  whyLine,
  answeredBy,
  passesLine,
  formatAnswer,
  sameness,
  resultStrength,
  runInLibrary,
  reasonChips,
  flaggedHeading,
  growingCount,
  formatRunCost,
  compareLine,
  failedLead,
  checkedTitle,
  runActivity,
  type DemoRun,
  type DemoScene,
} from '../lib/demo';
import { addPhase, mergeSteps, parentSteps, type JobStep } from '../lib/job';
import { startPoll, type Answer } from '../lib/poll';
import { ADD, DEMO_LIVE, ruleSentence } from '../lib/copy';

const scene = (over: Partial<DemoScene>): DemoScene => ({
  id: 'S001',
  start_ms: 0,
  end_ms: 1000,
  state: 'answered',
  flagged: false,
  strength_5_7: null,
  strength_8_10: null,
  ...over,
});

const run = (over: Partial<DemoRun> = {}): DemoRun => ({
  status: 'running',
  started_at: null,
  elapsed_ms: 0,
  cost_usd: 0,
  stages: {
    split_check: { done: 0, total: 0, doubtful: 0 },
    classify: { done: 0, total: 0, answers: 0 },
    claims: { done: 0, total: 0, supported: 0, unsupported: 0, contradicted: 0, final: null },
    moments: { done: 0, total: 0 },
  },
  scenes: [],
  feed: [],
  ...over,
});

test('a tile shows only what the run has said, and a flagged scene without a strength is not a zero', () => {
  assert.equal(tileKind(scene({ state: 'pending' }), '5-7'), 'pending');
  assert.equal(tileKind(scene({ state: 'asking' }), '5-7'), 'asking');
  // Answered but not flagged: clear. The strength the API might send for it does not make it flagged.
  assert.equal(tileKind(scene({ strength_5_7: 3 }), '5-7'), 'clear');
  assert.equal(tileKind(scene({ flagged: true, strength_5_7: 2 }), '5-7'), 'flagged');
  assert.equal(tileKind(scene({ flagged: true, strength_5_7: 2, strength_8_10: null }), '8-10'), 'unrated');
  // Unrated is drawn the height of an unflagged tile, never as a level-0 bar.
  assert.equal(tileHeightPx('unrated', null), tileHeightPx('clear', null));
  assert.ok(tileHeightPx('flagged', 3) > tileHeightPx('flagged', 1));
});

test('the cuts are every scene start but the first, in film order whatever order they arrive in', () => {
  const scenes = [scene({ id: 'b', start_ms: 500 }), scene({ id: 'a', start_ms: 0 }), scene({ id: 'c', start_ms: 900 })];
  assert.deepEqual(cutPositions(scenes), [500, 900]);
  assert.deepEqual(sceneNumber(scenes, 'c'), { n: 3, of: 3 });
  assert.equal(sceneNumber(scenes, 'nope'), null);
});

test('counts before the API has said how many are a dash, not "0 / 0", and never pass the total', () => {
  assert.equal(countLabel({ done: 0, total: 0 }), '—');
  assert.equal(countLabel({ done: 7, total: 50 }), '7 / 50');
  assert.equal(countLabel({ done: 60, total: 50 }), '50 / 50');
  assert.equal(stageShare({ done: 0, total: 0 }), 0);
  assert.equal(stageShare({ done: 25, total: 50 }), 0.5);
});

test('the feed is read newest first, one kind at a time', () => {
  const feed = [
    { kind: 'claim' as const, text: 'a', verdict: 'supported', at_ms: 1 },
    { kind: 'cut' as const, text: 'x', verdict: 'doubtful', at_ms: 2 },
    { kind: 'claim' as const, text: 'b', verdict: 'dropped', at_ms: 3 },
  ];
  assert.deepEqual(latest(feed, 'claim', 4).map((f) => f.text), ['b', 'a']);
  assert.equal(claimKept('supported'), true);
  assert.equal(claimKept('dropped'), false);
  assert.equal(claimKept(null), false);
  // Not checked is its own news, not "left out".
  assert.equal(claimOutcome('verified'), 'kept');
  assert.equal(claimOutcome('unsupported'), 'left');
  assert.equal(claimOutcome('contradicted'), 'left');
  assert.equal(claimOutcome('no_answer'), 'unchecked');
  assert.equal(claimOutcome(null), 'unchecked');
  assert.equal(cutDoubted('doubtful'), true);
  assert.equal(cutDoubted('real_cut'), false);
});

test('a run is polled while queued or running, and not after', () => {
  assert.equal(isRunLive('queued'), true);
  assert.equal(isRunLive('running'), true);
  assert.equal(isRunLive('done'), false);
  assert.equal(isRunLive('failed'), false);
});

test('the picker says each reason a check cannot start as its own news', () => {
  const film = { slug: 'f', title: 'F', year: 2000, poster: null, scene_count: 1, cut_count: 0, sentence_count: 1, in_library: true };
  const open = { spent_today_usd: 0.1, cap_usd: 2, available: true };
  assert.equal(pickState(null, open), 'down');
  assert.equal(pickState([film], null), 'down');
  assert.equal(pickState([], open), 'empty');
  assert.equal(pickState([film], { ...open, available: false }), 'cap');
  assert.equal(pickState([film], { ...open, available: false, reason: 'daily_cap' }), 'cap');
  // busy is a minute's wait, not the day's budget (Astra's reproduction); switched off is its own news
  assert.equal(pickState([film], { ...open, available: false, reason: 'busy', busy: true }), 'busy');
  assert.equal(pickState([film], { ...open, available: false, reason: 'not_configured' }), 'off');
  assert.equal(pickState([film], open), 'live');
  // An explicit reason beats the busy flag: a spent budget or a switched-off site is not "try again in a
  // minute" just because the slots are also full (Astra's reproduction, code review row 12).
  assert.equal(pickState([film], { ...open, available: false, reason: 'daily_cap', busy: true }), 'cap');
  assert.equal(pickState([film], { ...open, available: false, reason: 'not_configured', busy: true }), 'off');
  // No reason given: the flag still says busy.
  assert.equal(pickState([film], { ...open, available: false, busy: true }), 'busy');
});

test('a refused run: the per-visitor limit is not mistaken for the day’s budget', () => {
  assert.equal(runRefusal(429, { error_code: 'too_many_runs' }).kind, 'too_many');
  assert.equal(runRefusal(429, { error_code: 'daily_cap' }).kind, 'cap');
  assert.equal(runRefusal(409, { error_code: 'busy' }).kind, 'busy');
  assert.equal(runRefusal(404, {}).kind, 'not_ready');
  assert.equal(runRefusal(409, { error_code: 'not_ready' }).kind, 'not_ready');
  assert.equal(runRefusal(502, {}).kind, 'unreachable');
});

test('the finished breakdown keeps "not checked" apart from every level', () => {
  const r = run({
    status: 'done',
    scenes: [
      scene({ id: 'a', flagged: true, strength_5_7: 3 }),
      scene({ id: 'b', flagged: true, strength_5_7: 3 }),
      scene({ id: 'c', flagged: true, strength_5_7: null }),
    ],
    result: {
      flagged: ['a', 'b', 'c'].map((id) => ({
        scene_id: id, start_ms: 0, end_ms: 1, title: null, description: null, reasons: [], strength: 0,
      })),
      compare: null,
    },
  });
  // The scene's own null wins over the result's 0: a missing strength is never read as a zero.
  assert.deepEqual(flaggedBreakdown(r, '5-7'), [{ value: 3, count: 2 }, { value: null, count: 1 }]);
});

test('time and money are the API’s numbers, and an unknown one is a dash', () => {
  assert.equal(formatRunTime(9840), '9.8 s');
  assert.equal(formatRunTime(125_000), '2 min 05 s');
  assert.equal(formatRunTime(null), '—');
  assert.equal(formatCost(0.0213), '2.1¢');
  assert.equal(formatCost(1.2), '$1.20');
  assert.equal(formatCost(null), '—');
});

test('the Watch copy says what a parent gets, that it is the real step, and that Sonnet ran earlier', () => {
  // What the parent gets comes first, then what to tap.
  assert.match(DEMO_LIVE.intro, /scenes that may scare or upset a child/);
  assert.match(DEMO_LIVE.intro, /Jev, a small, fast AI/);
  assert.match(DEMO_LIVE.realStep, /also used to build our film guides/);
  assert.match(DEMO_LIVE.realStep, /leaves the saved guide unchanged/);
  assert.equal(DEMO_LIVE.jobs.length, 3);
  assert.match(DEMO_LIVE.before, /Those results are reused here/);
  assert.match(DEMO_LIVE.sonnetBody(40), /this check only calls Jev/);
  // Never a promise of completeness, and never that the AI watches the film.
  assert.match(DEMO_LIVE.sourcesNote, /does not watch the film/);
  assert.match(DEMO_LIVE.sourcesNote, /may be missed/);
  // The finished numbers are Jev's part only, and say so.
  assert.match(DEMO_LIVE.numbersNote, /Sonnet’s earlier reading and writing are not included/);
  // Being left out is not being false.
  assert.match(DEMO_LIVE.job3Body, /does not mean a sentence is false/);
  // No promised duration: how long a run takes is the API's measurement, shown after it.
  assert.doesNotMatch(DEMO_LIVE.intro, /\d/);
  assert.doesNotMatch(ADD.askBody + ADD.readingBody('X') + ADD.queuedBody('X') + ADD.finishingBody, /minute/);
  // The film-specific child-in-danger rule never calls a character a child.
  assert.doesNotMatch(ruleSentence('film_child_in_danger'), /child/);
});

test('a run before its first write is drawn as dashes, never as finished zeros', () => {
  const r = normalizeRun({ status: 'queued', stages: null, elapsed_ms: 0, cost_usd: 0 });
  assert.equal(countLabel(r.stages.split_check), '—');
  assert.deepEqual(r.scenes, []);
  assert.deepEqual(r.feed, []);
  assert.equal(normalizeRun({ status: 'nonsense' }).status, 'queued');
  // The API's numbers are kept as they are.
  const live = normalizeRun({ status: 'running', stages: { classify: { done: 3, total: 40, answers: 420 } } });
  assert.deepEqual(live.stages.classify, { done: 3, total: 40, answers: 420 });
  assert.deepEqual(live.stages.moments, { done: 0, total: 0 });
});

test('an answered scene is neither on the list nor off it until the rules have run', () => {
  assert.equal(tileKind(scene({ flagged: null }), '5-7'), 'answered');
  assert.equal(tileKind(scene({ flagged: false }), '5-7'), 'clear');
});

test('a feed item is placed by its scene, never by when it landed', () => {
  assert.equal(feedScene({ kind: 'cut', text: 'Cut before S012 at 0:12:03', verdict: 'confirmed', at_ms: 812 }), 'S012');
  assert.equal(feedScene({ kind: 'scene', text: 'x', verdict: null, at_ms: 1, scene: 'S003' }), 'S003');
  assert.equal(feedScene({ kind: 'claim', text: 'Nemo is taken.', verdict: 'verified', at_ms: 1 }), null);
});

test('why a scene is on the list: the pipeline’s tags, or its reasons read as tags', () => {
  const tags = [
    { label: 'Child in danger', by: ['jev' as const], p: 0.88, rule: 'strong_event', question: 'Is a child in physical danger?', act: 0.8 },
  ];
  assert.deepEqual(whyTags({ why: { line: 'Child in danger', tags }, reasons: [] }), tags);
  const fallback = whyTags({
    reasons: [
      { label: 'Crying', by: 'sonnet', p: 0.8 },
      { label: 'crying', by: 'jev', p: 0.9 },
      { label: 'Chased', by: 'jev', p: 0.7 },
    ],
  });
  assert.deepEqual(fallback.map((t) => [t.label, t.by]), [['Crying', ['sonnet', 'jev']], ['Chased', ['jev']]]);
  assert.equal(whyLine({ reasons: [{ label: 'A', by: 'jev', p: 1 }, { label: 'B', by: 'jev', p: 1 }] }), 'A · B');
  assert.deepEqual(answeredBy({ why: { line: '', tags }, reasons: [] }), { jev: true, sonnet: false });
  assert.equal(passesLine({ p: 0.88, act: 0.8 }), true);
  assert.equal(passesLine({ p: 0.5, act: 0.8 }), false);
  assert.equal(passesLine({ p: 0.8, act: null }), null);
  assert.equal(formatAnswer(0.8), '0.80');
  assert.equal(formatAnswer(null), '—');
});

test('every flag rule has its own sentence, and an unknown one is not guessed at', () => {
  for (const rule of ['strong_event', 'mortal_question', 'presence', 'presence_with_danger', 'presence_with_creature_threat', 'film_child_in_danger', 'film_threatens', 'film_danger']) {
    assert.notEqual(ruleSentence(rule), ruleSentence(null), rule);
  }
  assert.match(ruleSentence('strong_event+cooccur', ['Child in danger']), /only because the scene also has: Child in danger/);
  assert.equal(ruleSentence('something_new'), ruleSentence(null));
});

test('"same as the saved guide?" is yes only when every scene of each is in the other, one to one', () => {
  assert.deepEqual(sameness({ both: 13, only_run: 0, only_guide: 0, guide_scenes: 13 }, true), { kind: 'same', scenes: 13 });
  assert.deepEqual(sameness({ both: 11, only_run: 1, only_guide: 2 }, true), { kind: 'differs', both: 11, onlyRun: 1, onlyGuide: 2, guide: 13 });
  // counts that disagree are never "the same", whatever the matches say
  assert.equal(sameness({ both: 1, only_run: 0, only_guide: 0, guide_scenes: 1, run_scenes: 2 }, true).kind, 'differs');
  // "Not in the library" only when that is CONFIRMED; not knowing is its own answer.
  assert.deepEqual(sameness(null, false), { kind: 'none' });
  assert.deepEqual(sameness(null, null), { kind: 'unknown' });
  assert.deepEqual(sameness(null, true), { kind: 'unknown' });
});

test('the run names its film: the run’s own library answer beats the list, and unknown stays unknown', () => {
  const listed = { slug: 'iron-giant', title: 'The Iron Giant', year: 1999, poster: null, scene_count: 40, cut_count: 39, sentence_count: 99, in_library: true };
  assert.equal(runInLibrary({ result: { flagged: [], compare: null, in_library: false }, film: null }, listed), false);
  assert.equal(runInLibrary({ result: null, film: { slug: 'x', title: 'X', year: null, in_library: true } }, null), true);
  assert.equal(runInLibrary({ result: null, film: null }, listed), true);
  assert.equal(runInLibrary({ result: null, film: null }, null), null);
});

test('a list row shows at most three stable reasons, and a scene without a title is named by where it starts', () => {
  const f = {
    scene_id: 'S1', start_ms: 60_000, end_ms: 90_000, title: null, description: null, strength: 3,
    reasons: [],
    why: { line: '', tags: [
      { label: 'The Iron Giant in danger', category: 'Character in danger', by: ['jev' as const], p: 0.9, rule: 'film_child_in_danger' },
      { label: 'Hogarth Hughes in danger', category: 'Character in danger', by: ['jev' as const], p: 0.9, rule: 'film_child_in_danger' },
      { label: 'Weapon used', by: ['jev' as const], p: 0.9, rule: 'strong_event' },
      { label: 'Battle', by: ['jev' as const], p: 0.9, rule: 'strong_event' },
      { label: 'Captured', by: ['sonnet' as const], p: null, rule: 'strong_event' },
    ] },
  };
  assert.deepEqual(reasonChips(f), { chips: ['Character in danger', 'Weapon used', 'Battle'], more: 1 });
  // Never the reasons stitched into a title (it would read like a summary of what happens).
  assert.equal(flaggedHeading(f), 'Scene starting at 0:01:00');
  assert.equal(flaggedHeading({ ...f, title: 'Flagged scene' }), 'Scene starting at 0:01:00');
  assert.equal(flaggedHeading({ ...f, start_ms: 653_376 }), 'Scene starting at 0:10:53');
  assert.equal(flaggedHeading({ ...f, title: 'The Giant is shot at' }), 'The Giant is shot at');
  assert.equal(checkedTitle(f), null);
  assert.equal(checkedTitle({ title: ' Flagged scene ' }), null);
  assert.equal(checkedTitle({ title: 'The Giant is shot at' }), 'The Giant is shot at');
});

test('the comparison with the saved guide is one line by the count', () => {
  assert.equal(compareLine(sameness({ both: 11, only_run: 0, only_guide: 0, guide_scenes: 11, run_scenes: 11 }, true), 11), 'The saved guide lists the same 11 scenes.');
  assert.equal(compareLine(sameness({ both: 1, only_run: 0, only_guide: 0 }, true), 1), 'The saved guide lists the same scene.');
  assert.equal(
    compareLine(sameness({ both: 8, only_run: 1, only_guide: 0, guide_scenes: 8, run_scenes: 9 }, true), 9),
    'Compared with the saved guide: 1 extra scene, none missing.',
  );
  assert.equal(
    compareLine(sameness({ both: 6, only_run: 0, only_guide: 2, guide_scenes: 8, run_scenes: 6 }, true), 6),
    'Compared with the saved guide: no extra scenes, 2 missing.',
  );
  assert.equal(
    compareLine(sameness({ both: 6, only_run: 3, only_guide: 2, guide_scenes: 8, run_scenes: 9 }, true), 9),
    'Compared with the saved guide: 3 extra scenes, 2 missing.',
  );
  // Nothing matched apart but the counts differ: said as the two counts, never "no extra, none missing".
  assert.equal(compareLine(sameness({ both: 8, only_run: 0, only_guide: 0, guide_scenes: 8, run_scenes: 9 }, true), 9), 'This check lists 9 scenes; the saved guide lists 8.');
  assert.equal(compareLine(sameness(null, false), 3), DEMO_LIVE.sameNone);
  assert.equal(compareLine(sameness(null, null), 3), DEMO_LIVE.sameUnknown);
});

test('a failed run says which of Jev’s jobs it could not finish, in plain words', () => {
  assert.equal(
    failedLead({ stage: 'segment_build', error_code: 'split_check_failed' }),
    'Jev could not finish checking the scene breaks. The saved guide has not changed.',
  );
  assert.equal(failedLead({ stage: 'classify', error_code: 'jev_answers_failed' }), 'Jev could not finish answering its questions about the scenes. The saved guide has not changed.');
  assert.equal(failedLead({ stage: 'check_describe2', error_code: 'jev_check_failed' }), 'Jev could not finish checking the scene descriptions. The saved guide has not changed.');
  // The stage is missing (an older API): the error code says which job.
  assert.equal(failedLead({ error_code: 'split_check_failed' }), 'Jev could not finish checking the scene breaks. The saved guide has not changed.');
  // Not Jev's failure (ours, a timeout, an unknown code): said generally, never blamed on Jev.
  assert.equal(failedLead({ stage: 'classify', error_code: 'internal' }), DEMO_LIVE.failedBody);
  assert.equal(failedLead({ stage: 'moments', error_code: 'timed_out' }), DEMO_LIVE.failedBody);
  assert.equal(failedLead({}), DEMO_LIVE.failedBody);
  // No pipeline words: "cut" is the API's word, not a parent's.
  assert.doesNotMatch(failedLead({ stage: 'segment_build', error_code: 'split_check_failed' }), /\bcut\b/);
});

test('the scene view leads with the reasons, not a claim about which AI put the scene in', () => {
  assert.equal(DEMO_LIVE.whyLead, 'This scene is listed for the reasons below. Each reason shows which AI supplied the answer.');
  assert.equal(DEMO_LIVE.questionCount(167, 1), 'Jev answered 167 questions about this scene; this reason uses one of them.');
  assert.equal(DEMO_LIVE.questionCount(1234, 2), 'Jev answered 1,234 questions about this scene; this reason uses 2 of them.');
  assert.equal(DEMO_LIVE.questionCount(167, 0), 'Jev answered 167 questions about this scene.');
  assert.equal(DEMO_LIVE.droppedWord, 'Not supported by cited lines');
});

test('a count that can still grow is never a fraction until the check has finished', () => {
  const noun = (n: number) => `${n} sentences checked`;
  assert.equal(growingCount({ done: 191, total: 208 }, false, noun), '191 sentences checked');
  assert.equal(growingCount({ done: 208, total: 208 }, true, noun), '208 / 208');
  assert.equal(growingCount({ done: 0, total: 0 }, false, noun), '—');
});

test('a measured cost and an upper bound are never mixed up', () => {
  assert.equal(formatRunCost({ cost_usd: 0.021, cost_uncertain_usd: null }), '2.1¢');
  assert.equal(formatRunCost({ cost_usd: 0.021, cost_uncertain_usd: 0.004 }), '2.1¢ (up to 2.5¢)');
});

test('the result’s strength is read in either shape the API sends', () => {
  assert.equal(resultStrength({ '5_7': 3, '8_10': 2 }, '8-10'), 2);
  assert.equal(resultStrength({ '5_7': 3, '8_10': null }, '8-10'), null);
  assert.equal(resultStrength(1, '5-7'), 1);
  assert.equal(resultStrength(null, '5-7'), null);
});

// ---- the add card, Jev-first ---------------------------------------------------------------------

const step = (id: string, status: JobStep['status'], over: Partial<JobStep> = {}): JobStep => ({
  id, label: `api ${id}`, status, started_ms: null, ended_ms: null, detail: null, ...over,
});

const JEVFIRST = ['subtitles', 'sources', 'segment', 'split_check', 'claims', 'classify', 'sonnetq', 'moments', 'describe', 'check_describe', 'ingest'];

test('the Jev-first run is listed in a parent’s words, with its internal stages as one step each', () => {
  const rows = parentSteps(JEVFIRST.map((id) => step(id, 'pending')));
  assert.deepEqual(rows.map((r) => r.label), [
    'Finding the subtitles',
    'Reading the plot summary and the cast list',
    'Reading the subtitles and dividing the film into scenes',
    'Checking scene breaks and descriptions',
    'Checking each scene for danger, fear and sadness',
    'Finding where to skip',
    'Writing and checking scene descriptions',
    'Saving the scene guide',
  ]);
  // No engine in a row's words; who does it is said beside the row.
  for (const r of rows) assert.doesNotMatch(r.label, /Jev|Sonnet/);
  assert.deepEqual(ADD.stepWho.questions, ['Jev', 'Sonnet']);
});

test('the v10.4 stage names land in the same rows, and a step stays running until its last stage ends', () => {
  const V104 = ['subtitles', 'sources', 'segment', 'claims', 'fill', 'refold', 'classify', 'sonnetq', 'childcry', 'resolve', 'mortal', 'select1', 'moments', 'describe', 'checkdesc', 'describe2', 'checkdesc2', 'titles', 'checkdesc3', 'mergetext', 'select3', 'ingest'];
  const rows = parentSteps(V104.map((id, i) => step(id, i <= 8 ? 'done' : 'pending', { started_ms: i <= 8 ? i : null, ended_ms: i <= 8 ? i + 1 : null })));
  assert.deepEqual(rows.map((r) => r.id), ['subtitles', 'sources', 'segment', 'check', 'questions', 'moments', 'describe', 'ingest']);
  // classify, sonnetq and childcry are done; resolve and mortal are not: the questions row is still going.
  assert.equal(rows.find((r) => r.id === 'questions')!.status, 'running');
  assert.equal(rows.find((r) => r.id === 'check')!.status, 'done');
});

test('the shared row is running from the first stage’s start until the second ends', () => {
  const a = step('describe', 'done', { started_ms: 10, ended_ms: 40, detail: '17 described' });
  assert.equal(mergeSteps(a, step('check_describe', 'pending')).status, 'running');
  assert.equal(mergeSteps(a, step('check_describe', 'pending')).detail, '17 described');
  const both = mergeSteps(a, step('check_describe', 'done', { started_ms: 40, ended_ms: 45, detail: '31 checked' }));
  assert.equal(both.status, 'done');
  assert.equal(both.started_ms, 10);
  assert.equal(both.ended_ms, 45);
  assert.equal(both.detail, '31 checked');
  assert.equal(mergeSteps(step('describe', 'pending'), step('check_describe', 'pending')).status, 'pending');
  assert.equal(mergeSteps(a, step('check_describe', 'failed')).status, 'failed');
});

test('the card’s lead follows the one slow stretch: Sonnet reading, then the quick stages', () => {
  const at = (running: number) =>
    JEVFIRST.map((id, i) => step(id, i < running ? 'done' : i === running ? 'running' : 'pending'));
  assert.equal(addPhase({ status: 'queued', steps: at(0) }), 'waiting');
  assert.equal(addPhase({ status: 'running', steps: at(2) }), 'sonnet-reading');
  assert.equal(addPhase({ status: 'running', steps: at(5) }), 'checking');
  // The live pipeline has no segment stage and keeps its own lead.
  assert.equal(addPhase({ status: 'running', steps: [step('subtitles', 'done'), step('scenes', 'running')] }), 'reading');
  // Slow is said where it is slow, and only there.
  assert.match(ADD.stepPace.segment, /slow/);
  // No promised durations: this run has not measured them.
  for (const line of Object.values(ADD.stepPace)) assert.doesNotMatch(line, /\d|minute|second/);
});

test('the generic poll stops on the first value that is not live', async () => {
  const seen: string[] = [];
  const answers: Answer<{ status: string }>[] = [
    { kind: 'value', value: { status: 'running' } },
    { kind: 'error' },
    { kind: 'value', value: { status: 'done' } },
  ];
  await new Promise<void>((resolve) => {
    startPoll<{ status: string }>({
      id: 'run-1',
      live: true,
      fetchOne: async () => answers.shift()!,
      isLive: (v) => v.status === 'running',
      onValue: (v) => {
        seen.push(v.status);
        if (v.status === 'done') setImmediate(resolve);
      },
      onHealth: () => {},
      timers: {
        setTimeout: (fn) => setImmediate(fn),
        clearTimeout: () => {},
        now: () => 0,
      },
    });
  });
  assert.deepEqual(seen, ['running', 'done']);
  assert.equal(answers.length, 0);
});

test('the board says what Jev is doing now: the API\'s stage and its own counts, nothing more', () => {
  const stages = run().stages;
  const scenes = [scene({ id: 'S1' }), scene({ id: 'S2', state: 'asking' }), scene({ id: 'S3', state: 'pending' })];
  assert.equal(runActivity(run({ status: 'queued' }))?.text, 'Starting the check');
  assert.equal(
    runActivity(run({ stage: 'segment_build', stages: { ...stages, split_check: { done: 15, total: 38, doubtful: 1 } } }))?.text,
    'Checking scene breaks · 15 of 38 checked',
  );
  // Nothing planned yet: the step, with no count of our own.
  assert.equal(runActivity(run({ stage: 'segment_build' }))?.text, 'Checking scene breaks');
  const claims = { ...stages.claims, done: 127, total: 208 };
  assert.equal(runActivity(run({ stage: 'claims', stages: { ...stages, claims } }))?.text, 'Checking descriptions · 127 sentences checked');
  assert.equal(runActivity(run({ stage: 'check_describe2', stages: { ...stages, claims } }))?.name, 'Checking descriptions');
  const danger = runActivity(run({ stage: 'classify', scenes }));
  assert.deepEqual([danger?.name, danger?.count], ['Checking danger and fear', '1 of 3 scenes complete']);
  assert.equal(runActivity(run({ stage: 'mortal', scenes }))?.key, 'danger');
  assert.equal(
    runActivity(run({ stage: 'moments', stages: { ...stages, moments: { done: 4, total: 12 } } }))?.text,
    'Finding where to skip · 4 of 12 scenes complete',
  );
  // Between stages (a hand-off), or a stage this page does not know: waiting, said as waiting.
  assert.equal(runActivity(run({ stage: null }))?.text, 'Waiting for the next answers');
  assert.equal(runActivity(run({ stage: 'something_new' }))?.key, 'waiting');
  // Finished or stopped: the board says nothing about now.
  assert.equal(runActivity(run({ status: 'done', stage: 'select3' })), null);
  assert.equal(runActivity(run({ status: 'failed', stage: 'classify' })), null);
});

test('a list row\'s chips fold overlapping reasons, as the scene view groups them', () => {
  const f = {
    reasons: [],
    why: { line: '', tags: [
      { label: 'Weapon used', by: ['sonnet' as const], p: 0.8, rule: 'strong_event' },
      { label: 'The Iron Giant in danger', category: 'Character in danger', by: ['jev' as const], p: 0.9, rule: 'film_child_in_danger' },
      { label: 'Caught in danger', by: ['jev' as const], p: 0.9, rule: 'strong_event' },
      { label: 'Child in danger', by: ['jev' as const], p: 0.9, rule: 'strong_event' },
      { label: 'Power substation electrocution endangers someone', category: 'Dangerous situation', by: ['jev' as const], p: 0.8, rule: 'film_danger' },
      { label: 'Dangerous machinery', by: ['jev' as const], p: 0.9, rule: 'presence_with_danger' },
      { label: 'Afraid for safety', by: ['jev' as const], p: 0.9, rule: 'strong_event+cooccur', with: ['Child in danger'] },
    ] },
  };
  assert.deepEqual(reasonChips(f), { chips: ['Weapon used', 'Character in danger', 'Dangerous situation'], more: 0 });
});
