// Every parent-facing string on the site, in one place.
//
// The wording is owned by the copy decks in experiments/trigger-scan (v3 wins where it speaks, v2
// covers what v3 marks unchanged) plus the owner's final Home copy. Changing a line here is the
// whole change: no page carries its own literal text.
//
// Nothing on a parent page may mention an engine, a probability, a confidence, a review status or
// anything "possibly present". That rule lives in the data layer too; here it means the vocabulary
// of this file stays plain.

export const SITE_NAME = 'Tiny Viewers';

// One way in. The library is the search: it holds every film and filters as a parent types, so a
// separate Search page would have been the same page with fewer films on it.
export const NAV = [
  { href: '/library', label: 'Library' },
  // No "Add a movie" entry: adding lives inside the library, where a search that misses turns into
  // the ask. /add redirects there.
  //
  // No "Watch it work" entry either, for now. What /watch runs live is the subtitle fetch and Jev's
  // beat screening, and Jev's answers do not reach a scene guide (Sonnet reads the subtitles on its
  // own; the Jev labels are stored unasserted and never shown). A page that shows off a pass the
  // product does not use is the thing the owner asked not to have. The route still exists; it comes
  // back into the navigation when the stages it shows are the ones that build the film page.
] as const;

/** Home. The headline is two lines; "that" is the emphasised word inside the pen circle. */
export const HOME = {
  eyebrow: 'Scene guides for kids’ movies · ages 5–10',
  headlineLine1Before: 'Every kids’ movie has ',
  headlineEmphasis: 'that',
  headlineLine1After: ' scene.',
  headlineLine2: 'We’ll tell you when.',
  searchLabel: 'Movie title',
  searchPlaceholder: 'Tonight’s movie',
  searchButton: 'Check my movie',
  /** The one value line, directly under the field. */
  valueLine: 'Every scary or sad scene, when it happens, and what’s in it.',
  browseLink: 'Browse the library →',
  /** The peek card's marks are for one age band; it names it rather than leave the numbers bare. */
  peekBand: 'ages 5–7',
} as const;

/** Library. */
export const LIBRARY = {
  title: 'Film library',
  intro: 'Pick one for a heads-up on the tricky bits.',
  rowAction: 'See scenes →',
  justAdded: 'Just added',
  emptyHeadline: 'The library is empty. For now.',
  emptyBody: 'Scene guides land here as soon as they’re saved.',
  /** The legend above the rows says which age band the marks are drawn for. */
  legendBand: 'Ages 5–7',
  /** Read after the count on a row, so the strengths are not only a picture. */
  rowBreakdown: (parts: string[]) => (parts.length ? `: ${parts.join(', ')}` : ''),
  /** Announced (and, if the row is slow to arrive, shown) when an add run finishes. */
  added: (title: string) => `${title} is in the library now.`,
  addedLink: 'See its scene guide →',
} as const;

/** "18 scenes" on a library row. One scene is a scene. */
export function sceneCountLabel(n: number): string {
  return n === 1 ? '1 scene' : `${n} scenes`;
}

/** The library's search field, and what it says when nothing in the library matches. */
export const SEARCH = {
  fieldLabel: 'Movie title',
  placeholder: 'Tonight’s movie',
  noMatchHeadline: 'Not in the library. Yet.',
  noMatchBody: 'Check the spelling, or try the full title.',
} as const;

/**
 * The live count beside the library's search field, read out by a screen reader as the parent
 * types. One film is a film, not "1 films"; an unfiltered shelf is counted, not "matched".
 */
export function libraryCount(shown: number, total: number): string {
  if (shown === 0) return 'No film matches';
  if (shown === total) return shown === 1 ? '1 film' : `${shown} films`;
  return shown === 1 ? '1 film matches' : `${shown} films match`;
}

/** Film page. */
export const FILM = {
  ageControlLabel: 'Strength for',
  scaleDisclosure: 'What the levels mean',
  scaleLead: 'A low rating can still include your child’s fear.',
  ageFourNote: 'For a 4-year-old, use 5–7; expect some scenes to feel stronger.',
  // The rail beside the poster.
  factYear: 'Year',
  // No "Runtime" fact: the only length we store is where the subtitles end, which is not the film's
  // running time (credits and silent scenes come after it). It returns when the true runtime is
  // stored separately.
  factImdb: 'IMDb',
  // We store the film's IMDb id, not its rating, so the rail links to the page rather than quote a
  // number we do not have.
  imdbLink: 'Open →',
  // The findings card. The count is the big number; this is the words beside it.
  verdictWords: 'scenes parents should know about',
  verdictWordsOne: 'scene parents should know about',
  timelineHint: 'Tap a marker to jump to that scene.',
  showingScene: (time: string) => `Showing the scene at ${time}.`,
  showAll: 'Show all →',
  /** With a filter on, the way back from one scene is to the filtered list, and it says so. */
  showMatching: 'Back to matching scenes →',
  allClear: (time: string) => `Nothing flagged after ${time}.`,
  // The filter: one chip group, applied the moment a chip is pressed.
  filterTitle: 'Filter scenes',
  filterOn: (n: number) => ` · ${n} on`,
  filterLegend: 'Show scenes with any of these',
  filterShowing: (shown: number, total: number) =>
    shown === total ? `Showing all ${total} scenes.` : `Showing ${shown} of ${total} scenes.`,
  clearFilters: 'Clear filters',
  /** On a phone the list is a long way below the chips: a jump to it, once a filter is on. */
  viewMatching: (n: number) => (n === 1 ? 'View the matching scene ↓' : `View ${n} matching scenes ↓`),
  /** On a phone the synopsis shows its first sentence; the rest is one tap away. */
  overviewMore: 'Read the rest',
  /** Only ever seen with JavaScript off, where the chips cannot apply themselves. */
  filterApplyNoScript: 'Show these scenes',
  // One scene row, opened.
  readyLine: (readyAt: string, endsAround: string) => `Be ready at ${readyAt} · ends around ${endsAround}`,
  // TODO(phase 4): the feedback controls are not rendered in this phase — there is nowhere to send
  // an answer yet, and a control that silently discards one is worse than none. The wording stays
  // here so wiring it up is a component change, not a copy decision.
  feedbackPrompt: 'Was this right?',
  feedbackYes: 'Yes',
  feedbackOff: 'Something is off',
  // "How this guide was made": what the guide is built from and what that cannot see, under the
  // scene list. It replaces a link to the Watch page, which showed a pass that does not build it.
  aboutTitle: 'How this guide was made',
  aboutSource:
    'We read the film’s subtitles and list each scene in them that could scare or upset a child: when it happens, what happens, and how strong it is for ages 5–7 and 8–10.',
  aboutLimitSpeechOnly:
    'Subtitles cannot see, and these ones only carry speech. A scare that is only shown, or only heard, can be missed.',
  aboutLimitCaptions:
    'These subtitles caption sounds as well as speech, so many sound-only moments are covered. A scare that is only shown can still be missed.',
  aboutTiming: (release: string | null) =>
    release
      ? `Times follow one subtitle release (${release}). Another edition or streaming version can run a little earlier or later.`
      : 'Times follow one subtitle release. Another edition or streaming version can run a little earlier or later.',
  aboutAges:
    'Children under 5 are not rated. If you use the 5–7 marks for a younger child, expect some scenes to feel stronger.',
  posterPlaceholder: 'poster — to come',
  posterPlaceholderShort: 'to come',
} as const;

/** The breakdown under the verdict: "3 very strong". Lower case, because it follows a number. */
export const STRENGTH_WORDS_LOWER = ['low', 'mild', 'strong', 'very strong'] as const;
export const NOT_CHECKED_LOWER = 'not checked';

/** The three kinds of nothing, kept apart on purpose. */
export const EMPTY = {
  noMatchesHeadline: 'No matches',
  noMatchesBody: 'Clear filters to see all scenes.',
  noScenesHeadline: 'No scenes found',
  noScenesBody: 'No scenes found in the subtitles.',
  notCheckedHeadline: 'Not checked',
  notCheckedBody: 'The subtitles cannot tell us.',
} as const;

/** The strength scale: one mark, four levels, two bands. */
export const STRENGTH_WORDS = ['Low', 'Mild', 'Strong', 'Very strong'] as const;

export const STRENGTH_TABLE = [
  {
    mark: 0,
    word: 'Low',
    band57: 'Little upset in the dialogue.',
    band810: 'Little upset in the dialogue.',
  },
  {
    mark: 1,
    word: 'Mild',
    band57: 'Brief scare, worry, or sadness.',
    band810: 'Brief, pretend, or comic danger or sadness.',
  },
  {
    mark: 2,
    word: 'Strong',
    band57: 'Chasing, being trapped or lost, or lasting fear.',
    band810: 'Lasting danger, injury, or humiliation.',
  },
  {
    mark: 3,
    word: 'Very strong',
    band57: 'An attack, a child taken, or someone dying or seeming to die.',
    band810:
      'Someone dies or seems to die, a child is taken, or family is in serious danger.',
  },
] as const;

/**
 * "Watch it work" — the dark instrument register, and the one corner of the site where the engines
 * are named. A parent page says "scenes"; this page says Jev, Sonnet, tokens and cents, because
 * that is what a visitor came here to see. Everything it claims is read off a recording or a job.
 */
export const WATCH = {
  headline: 'Watch Jev read a film, live.',
  // Every run on /watch is live: the visitor picks a film and the first steps of the real analysis
  // run on it there and then — which steps is the scene API's decision (pipeline/stages.js), so
  // nothing here names them. It changes nothing about the film's own page, which a parent reads.
  intro:
    'Pick any film and two steps run on it, live: fetching its subtitles, then Jev screening every beat. Jev’s answers are an experiment — the scene guides do not use them yet; Sonnet writes those from the subtitles on its own. What you see is the run that just happened, at the speed it happened. It changes nothing on the film’s page.',
  shelfHeading: 'Films in the library',
  shelfNote: 'Their subtitles are already stored, so a run starts straight away.',
  play: 'Run it live',
  replay: 'Replay',
  replaying: 'Replaying…',
  // What finishes here is Jev's pass and only Jev's pass — Sonnet's reading of the transcript is
  // not in this run, and its seconds and cents are not in these counters. The headline says so
  // rather than calling this the whole analysis.
  runningHeadline: 'Jev is reading the film.',
  finishedHeadline: 'Jev has read the film.',
  requestLogHeading: 'Requests',
  requestLogNote: 'Eight at a time, in film order. They come back when they come back.',
  beatStripHeading: 'Beats',
  beatStripNote: 'One square per beat, in film order. It fills in as the answers land; a filled square is a flagged beat.',
  beatPrompt: 'Pick a lit square to see what Jev said about it.',
  beatAnswersHeading: 'What Jev said',
  beatScoresHeading: 'How bad it is',
  beatLinesHeading: 'The lines it read',
  scenesHeading: 'What Sonnet made of it',
  scenesNote:
    'The same scene list the film page shows. Sonnet wrote it from the whole transcript, not from the answers above — the two passes are independent, which is why it is worth watching them agree.',
  noScenesYet: 'No scenes are saved for this film yet.',
  toFilmList: 'See the finished scene list',
  backToRuns: 'Pick another film',
  backToLibrary: 'Browse the library',
  noRecording: 'No run is recorded for this film yet.',
  // The recorded run, which is now only the fallback for a day whose live budget is spent. It has
  // to say plainly that it is a recording: the rest of this page's claim is "this just happened".
  recordedEyebrow: 'A recording, not a live run',
  recordedLead: (date: string) =>
    `This is a recording of Jev’s run from ${date}, replayed at the speed it happened.`,
  // Counter labels. Short, because they sit under a number that is changing.
  elapsed: 'Elapsed',
  inFlight: 'In flight',
  done: 'Answered',
  beatsKnown: 'Beats known',
  beatsFlagged: 'Flagged',
  tokensIn: 'Tokens in',
  tokensOut: 'Tokens out',
  cost: 'Cost',
  confidence: 'confidence',
} as const;

/**
 * The live run on /watch: the picker, the run page it leads to, and every refusal on the way. One
 * plain sentence each, as everywhere else. None of it names a stage: which part of the analysis is
 * public is the scene API's decision, and the steps themselves come labelled from its job.
 */
export const DEMO = {
  pickHeading: 'Pick a film',
  pickLead: 'One from the library, or any film at all — a title or an IMDb link.',
  searchLabel: 'Any film: a title or IMDb link',
  searchPlaceholder: 'Room on the Broom',
  find: 'Find it',
  finding: 'Looking it up…',
  candidatesHeading: 'Which one?',
  choose: 'Run it live',
  starting: 'Starting the run…',
  noCandidates: 'Nothing came back for that. Try the full title, or paste the IMDb link.',
  onShelf: 'In the library',
  budgetLine: (spent: number, cap: number) =>
    `$${spent.toFixed(2)} of $${cap.toFixed(2)} of live runs spent today.`,
  // Refusals.
  capHeadline: 'Today’s live runs are used up.',
  capBody:
    'Live runs have a daily budget, and today’s is spent. It resets tomorrow. Every film in the library has a recorded run you can watch instead — it is labelled as a recording.',
  watchRecording: 'Watch its recorded run instead',
  offHeadline: 'Live runs are switched off',
  offBody: 'This deployment is missing a key the analysis needs, so nothing can run live right now.',
  unknownBody: 'The analysis service is not answering, so live runs are put away until it does.',
  busy: 'Two live runs are already going. Try again in a moment.',
  tooManyRuns: 'That is a lot of runs from here. Give it ten minutes.',
  tooManyNewFilms:
    'Films we have not fetched subtitles for are limited to a couple every ten minutes. Pick one from the library, or give it ten minutes.',
  newFilmLimit:
    'Today’s allowance of new films is used up — each one costs a subtitle download. Films in the library still work.',
  tooManyLookups: 'That is a lot of lookups from here. Give it ten minutes.',
  badRequest: 'That did not look like a title or an IMDb link.',
  unreachable: 'The analyser is not answering. Try again in a minute.',
  // The run page.
  runQueued: 'Starting the run',
  runRunning: 'Running it now',
  runDone: 'That was a live run.',
  runFailed: 'That run did not finish.',
  stateQueued: 'Waiting to start.',
  /** The step that is running, as the API labels it. */
  stateRunning: (step: string) => `${step}…`,
  stateStarting: 'Starting…',
  stateDone: 'Done. Everything below is what it produced, at the speed it ran.',
  unchanged: 'Nothing about this film’s page changed: a live run is only ever shown, never saved over it.',
  notSaved: 'Nothing was saved: a live run is only ever shown. To put this film in the library, finish the analysis below.',
  toFilm: 'See the film’s scene list',
  runAgain: 'Run it again',
  another: 'Pick another film',
  // Carrying a run on into the library.
  finishHeading: 'This one is not in the library yet',
  finishBody:
    'Finish the analysis and it goes in the library. It carries on from this run — nothing it did is done again — through the steps still to go. A few minutes, tens of cents. It needs the passcode.',
  finishStillToGo: 'Still to go:',
  finishButton: 'Finish the analysis and add it to the library',
  finishing: 'Starting…',
  finishNotDone: 'That run has not finished yet, so there is nothing to carry on from.',
  finishNoSubtitles: 'The subtitles that run used are no longer stored. Start a new run.',
} as const;

/** The header line: what ran, how hard it was asked, how many at once. Every number from `meta`. */
export function engineLine(meta: {
  model: string;
  modelReported: string;
  questionsPerBeat: number;
  concurrency: number;
}): string {
  // The two model names differ only when the API served something other than what we asked for.
  // On that day the page says both, rather than quietly reporting the request as the answer.
  const model =
    meta.modelReported && meta.modelReported !== meta.model
      ? `${meta.model} (served ${meta.modelReported})`
      : meta.model;
  return `Jev ${model} — ${meta.questionsPerBeat} questions per beat — concurrency ${meta.concurrency}`;
}

/**
 * The finish line, once the last response has landed.
 *
 * Named, because every number in it is Jev's: the wall clock is the screening pass, the cents are
 * the screening pass, and Sonnet's reading of the transcript comes after all of them. "That was the
 * whole run" was a tidier sentence and a false one.
 */
export function finishLine(wall: string, requests: number, beats: number, cost: string): string {
  return `That was Jev’s pass: ${wall} · ${requests} requests · ${beats} beats · ${cost}`;
}

/**
 * "Adding a movie": the passcoded flow, which lives inside the library. A search that misses becomes
 * the ask; the ask becomes the live card; the live card becomes a row with a "Just added" chip.
 */
export const ADD = {
  // The ask.
  askHeadline: 'Not in the library. Yet.',
  askBody:
    'We can check it for you. We read the film’s subtitles and map every scary or sad scene. A feature takes a few minutes.',
  filmLabel: 'Title or IMDb link',
  passcodeLabel: 'Passcode',
  passcodeHelp: 'Adding is passcode-locked while the library is small. Ask us for yours.',
  submit: 'Check this movie',
  finding: 'Looking it up…',
  starting: 'Starting the run…',
  candidatesHeading: 'Which one?',
  choose: 'Check this one',
  openExisting: 'Already in the library → open it',
  noCandidates: 'Nothing came back for that. Try the full title, or paste the IMDb link.',
  /** A match with no IMDb id: subtitles are found by IMDb id, so this one cannot be checked. */
  noImdb: 'Can’t check this one: it has no IMDb record to find its subtitles by.',
  offHeadline: 'Adding is switched off',
  offBody: 'No passcode is configured, so nothing new can be started right now.',
  // Not the same thing, and the page used to say the first when it meant the second: a status read
  // that failed knows nothing about the passcode. "Switched off" is a fact about the deployment;
  // this is a fact about right now.
  unknownHeadline: 'Can’t tell right now',
  unknownBody: 'The analysis service is not answering, so the form is put away until it does.',
  unknownRetry: 'Check again',
  runningNow: 'A film is being read right now',
  runningLink: 'watch it',
  // Refusals. One plain sentence each, and a way onward where there is one.
  wrongPasscode: 'That passcode is not right.',
  busy: 'A film is already being read. One at a time, so the timings stay honest.',
  exists: 'That one is already in the library.',
  unreachable: 'The analyser is not answering. Try again in a minute.',
  badRequest: 'That did not look like a title or an IMDb link.',
  // A 429 is two different refusals wearing one status code, and telling a fumbled passcode that
  // the day's budget is spent sends the reader to wait until tomorrow for a ten-minute problem.
  tooManyAttempts: 'Too many wrong passcodes from here. Give it ten minutes.',
  tooLong: 'That is far more text than a title or a link. Trim it down.',
  // The live card.
  readingHeadline: (title: string) => `We’re reading ${title} now.`,
  readingBody: (title: string) =>
    `We’re building ${title}’s scene guide from its subtitles. It takes a few minutes, and you don’t have to wait here.`,
  // Before the API reports a step, nothing is being read yet, and the card does not say otherwise.
  queuedHeadline: (title: string) => `${title} is next.`,
  queuedBody: (title: string) =>
    `We’ll build ${title}’s scene guide from its subtitles as soon as the run starts. It takes a few minutes, and you don’t have to wait here.`,
  queued: 'Waiting to start.',
  /**
   * The steps a parent sees, by the API's step id, in their words. Only the steps whose output
   * reaches the film page are listed (see `parentSteps` in lib/job.ts); the others still run.
   */
  stepLabels: {
    subtitles: 'Finding the subtitles',
    scenes: 'Reading the subtitles for scenes',
    presence: 'Labelling what is in each scene',
    ingest: 'Saving the scene guide',
  } as Record<string, string>,
  /** The step that is running, as the API labels it — plain words, never an engine's name. */
  stepLine: (label: string) => `${label}…`,
  /**
   * Each step's state, in words beside it: the marker's colour is never the only way to tell a
   * finished step from one that has not started.
   */
  stepState: { pending: 'Not yet', running: 'Now', done: 'Done', failed: 'Failed' },
  /** How long the run has been going, as the API measured it on the last poll. */
  elapsedLine: (ms: number) => `${formatElapsed(ms)} so far`,
  /** The same figure once polls have stopped answering: it is the last one we heard, not a clock. */
  elapsedAtLastUpdate: (ms: number) => `${formatElapsed(ms)} at the last update`,
  // When the polls stop answering. The run may be fine; we just cannot hear about it.
  interruptedHeadline: 'Updates interrupted.',
  interruptedBody: 'The analysis may still be running — we just can’t reach it right now. Asking again does not start it twice.',
  lastUpdate: (time: string) => `Last update at ${time}.`,
  retryNow: 'Ask again now',
  jobMissing: 'We can’t find this run any more, so there is no news to show.',
  // A finish carries on a run whose beats were read on the Watch page: the reading is already done.
  finishingHeadline: (title: string) => `We’re finishing ${title} now.`,
  finishingBody:
    'Its subtitles were fetched in the run you watched. Now we build the scene guide from them. It takes a few minutes, and you don’t have to wait here.',
  checkingAdd: 'Checking whether adding is open…',
  meanwhile: 'Browse the library meanwhile →',
  jobDone: 'That one is done.',
  jobFailed: 'That run did not finish.',
  openFilm: 'See the scene list',
  // A reload while the API is down must not tell the reader their run never existed. It exists; we
  // cannot ask about it. Different news, and only one of the two is worth pressing a button over.
  jobUnreachableHeadline: 'Can’t reach the analysis service',
  jobUnreachableBody:
    'The run may well still be going — we just can’t ask about it right now. Try again in a minute.',
  jobUnreachableRetry: 'Try again',
  // Kept for the /watch run pages, which still show a job's steps and its money.
  jobHeading: 'Analysing',
  stepsHeading: 'Steps',
  costReserved: (usd: number) => `up to $${usd.toFixed(2)} set aside`,
  costTotal: 'in total',
  failNoSubtitles: 'No subtitles could be found for that film, and subtitles are all this reads.',
  // The scene pass finished and listed nothing. That is a result about these subtitles, not a
  // verdict that the film is gentle — and nothing was saved, so there is no guide to read.
  failNoScenes:
    'We read the subtitles and found no scenes to list, so nothing was added. That doesn’t mean the film has nothing scary in it — only that its subtitles gave us nothing to point to.',
  failSubtitleQuota: 'The subtitle service has had enough of us for today. Try again tomorrow.',
  failTimedOut: 'The run took longer than it is allowed to and was stopped.',
  failGeneric: 'Something went wrong on our side.',
  failedHeadline: 'That run did not finish.',
  tryAnother: 'Try another movie',
} as const;

/** "42 s", "3 min 05 s": whole seconds, because the figure only moves when the job is polled. */
export function formatElapsed(ms: number): string {
  const total = Math.floor(Math.max(0, ms) / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return m ? `${m} min ${String(s).padStart(2, '0')} s` : `${s} s`;
}

/**
 * The spending line under the add form. Real money, two decimals, no rounding up to a dollar.
 *
 * While a run is going, the day's figure is not all spending: the budget books that run's whole
 * ceiling against today the moment it is admitted, and gives back whatever it did not use when the
 * run ends. So the line says so, with the number, rather than letting a reader watch $1.70 appear
 * and then disappear and draw their own conclusions. `reserveUsd` is null when nothing is running —
 * and also when the API has not told us the figure, because a vague clause is worse than none.
 */
export function spentLine(spentUsd: number, capUsd: number, reserveUsd: number | null = null): string {
  const money = (n: number) => `$${n.toFixed(2)}`;
  const line = `${money(spentUsd)} of ${money(capUsd)} spent today`;
  return reserveUsd === null
    ? line
    : `${line} — includes ${money(reserveUsd)} set aside for the run in progress`;
}

/** The cap refusal, with the numbers that caused it. */
export function capLine(spentUsd: number, capUsd: number): string {
  return `Today's budget is spent: $${spentUsd.toFixed(2)} of $${capUsd.toFixed(2)}. It resets tomorrow.`;
}

/**
 * When the scene guides cannot be reached at all. Deliberately plain, and deliberately free of any
 * detail from the underlying error: a parent gets a sentence, the server log gets the stack.
 */
export const TROUBLE = {
  headline: 'The scene guides are having a moment.',
  body: 'We can’t reach the scene guides right now. Try again in a minute.',
  retry: 'Try again',
  library: 'Browse the library',
} as const;

/** Dead ends. */
export const NOT_FOUND = {
  headline: 'This page missed its cue.',
  body: 'We can’t find this page. Head to the library for the films and their scene guides.',
  library: 'Browse the library',
} as const;
