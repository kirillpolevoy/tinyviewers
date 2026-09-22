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
  { href: '/watch', label: 'Watch it work' },
] as const;

/** Home. The headline is two lines; "that" is the emphasised word inside the pen circle. */
export const HOME = {
  eyebrow: 'Scene guides for kids’ movies · ages 5–10',
  headlineLine1Before: 'Every kids’ movie has ',
  headlineEmphasis: 'that',
  headlineLine1After: ' scene.',
  headlineLine2: 'We’ll tell you when.',
  subhead:
    'Look up a movie. See every scary or sad scene, when it happens, and what’s in it.',
  searchLabel: 'Movie title',
  searchPlaceholder: 'Tonight’s movie',
  searchButton: 'Check my movie',
  peekCaption: 'the shark shows up here',
  libraryInvitationLead: 'Still choosing?',
  libraryInvitationLink: 'Browse the library.',
  shelfSignOff: 'Skip the scares. Keep the joy.',
  bandHeadline: 'Fast answers. Then the big picture.',
  bandBody:
    'Watch the questions zip across a film, then see the scenes take shape — a real run, replayed at the speed it happened.',
  bandButton: 'Watch it work',
} as const;

/** Library. */
export const LIBRARY = {
  title: 'Film library',
  intro: 'The films are lined up. Pick one for a heads-up on the tricky bits.',
  stripNote:
    'The strip under each title shows where the strongest scenes sit; taller means stronger for ages 5–7.',
  cardMicrocopy: 'Scene notes inside.',
  cardAction: 'See scenes',
  emptyHeadline: 'An empty shelf. For now.',
  emptyBody: 'Scene guides land here as soon as they’re saved.',
} as const;

/** The library's search field, and what it says when nothing on the shelf matches. */
export const SEARCH = {
  fieldLabel: 'Movie title',
  placeholder: 'Tonight’s movie',
  noMatchHeadline: 'Not on our shelf. Yet.',
  noMatchBody: 'Check the spelling, or try the full title.',
  noMatchAction: 'Add this movie',
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
  listHeading: 'Here’s what’s coming up.',
  showDetails: 'Show details',
  hideDetails: 'Hide details',
  beReadyAt: 'Be ready at',
  sceneEndsAround: 'Scene ends around',
  // TODO(phase 4): the feedback controls are not rendered in this phase — there is nowhere to send
  // an answer yet, and a control that silently discards one is worse than none. The wording stays
  // here so wiring it up is a component change, not a copy decision.
  feedbackPrompt: 'Was this right?',
  feedbackYes: 'Yes',
  feedbackOff: 'Something is off',
  filterDisclosure: 'Narrow the list',
  filterPrompt: 'Got something in mind? Find those scenes.',
  filterRule: 'Show scenes with any of these.',
  groupPresence: 'What is in it',
  groupEvents: 'What happens',
  applyFilters: 'Apply filters',
  clearFilters: 'Clear filters',
  crossLink: 'See how this was worked out',
  crossLinkNote: 'Opens this film’s recorded analysis.',
  timelineStart: '0:00:00',
  posterPlaceholder: 'poster — to come',
} as const;

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
  headline: 'First the clues. Then the scenes.',
  // Two passes, not one handing off to the other. Jev screens every beat; Sonnet reads the whole
  // transcript itself and writes the scene list without seeing an answer of Jev's. The page shows
  // one against the other, which is the interesting part and also the true one.
  intro:
    'Jev puts 103 questions to every beat of a film and answers them at System One speed. Sonnet reads the whole transcript on its own and writes the scene list. Below: real runs, replayed at the speed they happened, with Jev’s flags beside Sonnet’s scenes.',
  shelfHeading: 'Runs on the shelf',
  shelfNote: 'Every number on these pages came out of the run. Nothing here is animated from a guess.',
  play: 'Watch this run',
  replay: 'Replay',
  replaying: 'Replaying…',
  // The replay page. What finishes here is Jev's pass and only Jev's pass — Sonnet's reading of the
  // transcript is not in this recording, and its seconds and cents are not in these counters. The
  // headline says so rather than calling this the whole run.
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
  backToRuns: 'All recorded runs',
  backToLibrary: 'Browse the library',
  noRecording: 'No run is recorded for this film yet.',
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

/** "Adding a movie": the passcoded flow on /watch, and the live job page it leads to. */
export const ADD = {
  heading: 'Add a movie',
  // The two live runs so far took 25–50 s and 9–13¢ on a 26-minute film. A feature is several times
  // the subtitles and several times the beats, so it is minutes and tens of cents. "About a minute
  // and a few cents" was the short film's figure quoted as everybody's.
  lead: 'Give it a title or an IMDb link. A short film takes under a minute; a feature a few minutes. Tens of cents.',
  filmLabel: 'Title or IMDb link',
  filmPlaceholder: 'The one you could not find',
  passcodeLabel: 'Passcode',
  submit: 'Find it',
  finding: 'Looking it up…',
  starting: 'Starting the run…',
  candidatesHeading: 'Which one?',
  choose: 'Analyse this one',
  openExisting: 'Already on the shelf → open it',
  noCandidates: 'Nothing came back for that. Try the full title, or paste the IMDb link.',
  offHeadline: 'Adding is switched off',
  offBody: 'No passcode is configured, so nothing new can be started right now.',
  // Not the same thing, and the page used to say the first when it meant the second: a status read
  // that failed knows nothing about the passcode. "Switched off" is a fact about the deployment;
  // this is a fact about right now.
  unknownHeadline: 'Can’t tell right now',
  unknownBody: 'The analysis service is not answering, so the form is put away until it does.',
  runningNow: 'A film is being analysed right now',
  runningLink: 'watch it',
  // Refusals. One plain sentence each, and a way onward where there is one.
  wrongPasscode: 'That passcode is not right.',
  busy: 'A film is already being analysed. One at a time, so the timings stay honest.',
  exists: 'That one is already on the shelf.',
  unreachable: 'The analyser is not answering. Try again in a minute.',
  badRequest: 'That did not look like a title or an IMDb link.',
  // A 429 is two different refusals wearing one status code, and telling a fumbled passcode that
  // the day's budget is spent sends the reader to wait until tomorrow for a ten-minute problem.
  tooManyAttempts: 'Too many wrong passcodes from here. Give it ten minutes.',
  tooLong: 'That is far more text than a title or a link. Trim it down.',
  // The live job page. The headline is whichever of these the job is doing right now, so it keeps
  // up with the poll instead of still saying "Analysing" over a finished run.
  jobHeading: 'Analysing',
  jobQueued: 'Waiting its turn',
  jobDone: 'That one is done.',
  jobFailed: 'That run did not finish.',
  // A reload while the API is down used to land on "this page missed its cue", which tells the
  // reader their run never existed. It exists; we cannot ask about it. Different news, and only one
  // of the two is worth pressing a button over.
  jobUnreachableHeadline: 'Can’t reach the analysis service',
  jobUnreachableBody:
    'The run may well still be going — we just can’t ask about it right now. Try again in a minute.',
  jobUnreachableRetry: 'Try again',
  stepsHeading: 'Steps',
  // A job that has not made a single model call already carries $1.70, because that is what the
  // budget has put aside for it — a ceiling, not a bill. Calling it "170¢ so far" was money
  // presented as spent, and the figure then *dropped* when the run reconciled, which is not a thing
  // spending does. While it is live the page names the reserve; only a finished run has a total.
  costReserved: (usd: number) => `up to $${usd.toFixed(2)} set aside`,
  costTotal: 'in total',
  queued: 'Waiting to start.',
  scenesFound: (n: number) => (n === 1 ? '1 scene found' : `${n} scenes found`),
  openFilm: 'See the scene list',
  failedHeadline: 'That run did not finish.',
  failNoSubtitles: 'No subtitles could be found for that film, and subtitles are all this reads.',
  failSubtitleQuota: 'The subtitle service has had enough of us for today. Try again tomorrow.',
  failTimedOut: 'The run took longer than it is allowed to and was stopped.',
  failGeneric: 'Something went wrong on our side.',
} as const;

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
