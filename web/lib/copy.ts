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

/**
 * Whether "Watch it work" is linked — the navigation entry and Home's link both. On since the
 * Jev-first pipeline shipped; this one switch takes it out of the header and Home's footer again.
 */
export const WATCH_LINKED = true;

// One way in. The library is the search: it holds every film and filters as a parent types, so a
// separate Search page would have been the same page with fewer films on it. No "Add a movie"
// entry: adding lives inside the library, where a search that misses turns into the ask.
export const NAV: readonly { href: string; label: string }[] = [
  { href: '/library', label: 'Library' },
  ...(WATCH_LINKED ? [{ href: '/watch', label: 'Watch it work' }] : []),
];

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
  /** Shown only when `WATCH_LINKED` is on. */
  watchLink: 'Watch it work →',
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
  /** Under the list, closed until asked for: the way to add a film that is not in it. */
  addHeadline: 'Can’t find your film?',
  addAction: 'Add a film',
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
  ageControlLabel: 'Your child’s age',
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
  verdictWords: 'scenes to know about',
  verdictWordsOne: 'scene to know about',
  /** The breakdown when every scene is at one level: the level, not the count a second time. */
  breakdownAll: (word: string, n: number) =>
    n === 1 ? `${word}`.charAt(0).toUpperCase() + `${word}`.slice(1) : n === 2 ? `Both ${word}` : `All ${word}`,
  timelineHint: 'Tap a marker to jump to that scene.',
  /** On a phone the markers are a picture, not controls: the rows below are the way in. */
  timelineHintPhone: 'Tap a scene below for details and skip times.',
  rowsHint: 'Tap a scene for details and skip times.',
  /**
   * A scene with no title that passed its checks is named by where it starts: its reasons are shown
   * beside it, never stitched into a title that reads like a summary of what happens.
   */
  untitledScene: (time: string) => `Scene starting at ${time}`,
  bandsSame: 'These scenes have the same ratings for both age groups.',
  showingScene: (time: string) => `Showing the scene at ${time}.`,
  /** A mark that stands for several scenes sat close together: tapped, the list is those scenes. */
  showingScenes: (n: number, from: string, to: string) => `Showing the ${n} scenes from ${from} to ${to}.`,
  markerGroupLabel: (n: number, from: string, to: string, strongest: string) =>
    `${n} scenes close together, ${from} to ${to}; the strongest is ${String(strongest).toLowerCase()}`,
  showAll: 'Show all →',
  /** With a filter on, the way back from one scene is to the filtered list, and it says so. */
  showMatching: 'Back to matching scenes →',
  allClear: (time: string) => `This guide lists no scenes after ${time}.`,
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
  readyLine: (readyAt: string, endsAround: string) => `Skip from ${readyAt} to about ${endsAround}.`,
  readyNote: 'These times include a margin before and after the scene. Timing can vary by edition.',
  /** Above a scene's reasons: why it is in the guide at all, shown even when there is no description. */
  whyLabel: 'Why it’s included',
  /** The individual checks behind the grouped reasons ("The Giant and Hogarth in danger"), one tap away. */
  whyChecks: 'The checks behind these reasons',
  /** Above the scene's other plain-word tags, when both are shown. */
  tagsLabel: 'Also in this scene',
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
    'This guide uses the film’s subtitles, cast list and plot summary to identify scenes that may scare or upset a child: when it happens, what happens, and how strong it is for ages 5–7 and 8–10.',
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
 * "Watch it work" — the one corner of the site where the engines are named. A parent page says
 * "scenes"; this page says Jev and Sonnet, because which of the two did what is what a visitor came
 * to see. Everything it claims is read off a live run: the counters, the tiles and the cost are the
 * API's, and nothing is replayed.
 *
 * Written for a parent who has never heard of Jev. It says, on every screen: what they are watching
 * (in one line), that it is the real step that builds a film's page (not a showcase), that Sonnet's
 * slow reading was done earlier and does not run again, and that a run changes nothing on the page.
 */
/** A sentence ending in a film title: no second full stop after 'Monsters, Inc.' */
const endWith = (title: string) => (/[.!?]$/.test(title) ? title : `${title}.`);

export const DEMO_LIVE = {
  // --- pick a film ---------------------------------------------------------------------------------
  eyebrow: 'Watch it work',
  headline: 'Watch a film’s scenes get checked.',
  intro: 'See how we find the scenes in a film that may scare or upset a child.',
  realStep:
    'These live checks are also used to build our film guides. Running them here leaves the saved guide unchanged.',
  sourcesNote: 'The AI reads the subtitles, cast list and plot; it does not watch the film. Some moments may be missed.',
  howHeading: 'How it works',
  // What the visitor does, first: the page's job is to be tried, so the steps lead and the machinery follows.
  steps: [
    { title: 'Pick a film', body: 'Choose any film from the list below.' },
    { title: 'Watch Jev check it', body: 'Jev, a small, fast AI, checks every scene live. It takes about half a minute.' },
    { title: 'See what to know', body: 'The scenes that may upset a child, when they happen, and why each one is listed.' },
  ],
  behindLabel: 'Behind the scenes',
  jobsLabel: 'What Jev does',
  liveTag: 'Live, while you watch',
  beforeTag: 'Prepared earlier',
  afterTag: 'Then · rules pick the scenes',
  jobs: [
    { title: 'Checks every scene for danger and fear', body: 'A long list of yes-or-no questions per scene, like “Is a character in danger?”' },
    { title: 'Checks where scenes change', body: 'Is each break between two scenes a real change of place or time?' },
    { title: 'Checks the scene descriptions', body: 'Whether the subtitle lines each sentence cites support it.' },
  ],
  before:
    'Sonnet, a larger AI, already read the subtitles, cast list and plot. It divided the film into scenes, wrote descriptions and answered questions about meaning, such as death or grief. Those results are reused here.',
  after: 'Rules use Jev’s answers and Sonnet’s earlier answers to choose the scenes and their strength ratings.',
  pickHeading: 'Pick a film',
  pickNote: 'Sonnet has already prepared these films for checking.',
  ready: (scenes: number) => `${scenes} ${scenes === 1 ? 'scene' : 'scenes'} to check`,
  inLibrary: 'In the library',
  run: 'Watch this film’s check',
  starting: 'Starting…',
  openSaved: 'Open saved guide',
  budget: (spent: number, cap: number) =>
    `Today’s demo AI spending: $${spent.toFixed(2)} of the $${cap.toFixed(2)} daily budget.`,
  // The page's kinds of nothing, kept apart: the budget is used up, every slot is busy for a minute, live
  // checks are switched off here, the service is not answering, or no film is ready yet. Each is its own news.
  capHeadline: 'Today’s live checks are used up.',
  capBody: 'Today’s budget for live checks is used up. You can still read the saved guides.',
  busyHeadline: 'Both live checks are in use.',
  busyBody: 'Two checks are running right now. Try again in a minute.',
  offHeadline: 'Live checks are switched off here.',
  offBody: 'Live checks are switched off on this site right now. You can still read the saved guides.',
  refresh: 'Check again',
  downHeadline: 'Can’t reach the analysis service.',
  downBody: 'It isn’t answering, so live checks are put away until it does. Try again in a minute.',
  emptyHeadline: 'No film is ready for a live check yet.',
  emptyBody: 'A film needs Sonnet’s reading stored before Jev can check it, and none has one yet.',
  notReadyHeadline: 'That film isn’t ready.',
  notReadyBody: 'Sonnet’s reading of that film isn’t stored, so there is nothing for Jev to check yet.',
  busy: 'Both live checks are in use right now. Try again in a minute.',
  tooManyRuns: 'That is a lot of checks from here. Give it ten minutes.',
  retry: 'Try again',
  toLibrary: 'Browse the library',

  // --- the live run ----------------------------------------------------------------------------------
  runEyebrow: (title: string, year: number | null) => `Live check · ${title}${year ? ` (${year})` : ''}`,
  queuedHeadline: (title: string) => `Starting Jev on ${title}…`,
  runningHeadline: (title: string) => `Jev is checking ${endWith(title)}`,
  failedHeadline: 'This check stopped.',
  failedBody: 'This check stopped before it finished. The saved guide has not changed.',
  /** A failed run whose stage is known and whose failure was Jev's: `what` is the stage in plain words. */
  failedJev: (what: string) => `Jev could not finish ${what}. The saved guide has not changed.`,
  /** The demo stages, as `failedJev` says them (the run's `stage`, else its error code). */
  failedStage: {
    segment_build: 'checking the scene breaks',
    split_check: 'checking the scene breaks',
    claims: 'checking the scene descriptions',
    fill: 'checking the scene descriptions',
    refold: 'checking the scene descriptions',
    check_describe: 'checking the scene descriptions',
    check_describe2: 'checking the scene descriptions',
    check_describe3: 'checking the scene descriptions',
    mergetext: 'checking the scene descriptions',
    classify: 'answering its questions about the scenes',
    childcry: 'answering its questions about the scenes',
    resolve: 'answering its questions about the scenes',
    mortal: 'answering its questions about the scenes',
    moments: 'finding where to skip',
  } as Record<string, string>,
  failedDetails: 'What finished before the check stopped',
  startNew: 'Start a new check',
  runSub: 'Watch Jev check scene breaks, descriptions, and signs of danger or fear to help you decide what to skip.',
  /**
   * What Jev is doing right now, at the top of the board: the stage the API reports and the API's own
   * counts (lib/demo.ts runActivity). Never a count of our own while waiting for answers.
   */
  nowKey: 'Now',
  nowName: {
    starting: 'Starting the check',
    breaks: 'Checking scene breaks',
    descriptions: 'Checking descriptions',
    danger: 'Checking danger and fear',
    skip: 'Finding where to skip',
    choosing: 'Choosing the scenes to know about',
    waiting: 'Waiting for the next answers',
  } as Record<string, string>,
  /** The count after the step's name ("Checking descriptions · 127 sentences checked"). */
  nowBreaks: (done: number, total: number) => `${done} of ${total} checked`,
  nowDescriptions: (n: number) => `${n.toLocaleString('en-US')} ${n === 1 ? 'sentence' : 'sentences'} checked`,
  nowScenes: (n: number, total: number) => `${n} of ${total} scenes complete`,
  nowSep: ' · ',
  thisFilm: 'this film',
  boardLabel: 'Jev’s live check',
  elapsed: 'Time',
  scenesAnswered: 'Scenes checked',
  answers: 'Questions answered',
  sentencesChecked: 'Sentences checked',
  cost: 'AI cost so far',
  moreDetails: 'More details',
  viewScenes: 'View checked scenes',
  viewScenesNone: 'Scenes appear here as Jev answers them.',
  job1: 'Checks where scenes change',
  job1Body: 'Is each break between two scenes a real change of place or time?',
  doubtful: (n: number, finished: boolean) =>
    n === 0
      ? finished
        ? 'No scene change was uncertain.'
        : ''
      : n === 1
        ? '1 scene change was uncertain.'
        : `${n} scene changes were uncertain.`,
  uncertainMark: 'Uncertain scene change',
  cutKept: 'This check used the stored scene breaks as they are.',
  job2: 'Checks every scene for danger and fear',
  job2Body: 'Each block is a scene. It fills when answers arrive. Colours appear when the scene list is ready.',
  /** In "More details": the mean of the scenes' own question counts so far (it changes as answers land). */
  perSceneLabel: 'Questions per scene (average)',
  skipMeter: 'Finding where to skip',
  job3: 'Checks the descriptions',
  job3Body:
    'Jev checks whether the cited subtitle lines support each sentence. Sentences it cannot support are left out. These can include setting notes; being left out does not mean a sentence is false.',
  sentencesSoFar: (n: number) => `${n.toLocaleString('en-US')} ${n === 1 ? 'sentence' : 'sentences'} checked`,
  kept: 'Supported by cited lines',
  droppedWord: 'Not supported by cited lines',
  uncheckedWord: 'Not checked',
  finalKept: 'In the guide',
  finalLeft: 'Left out',
  noClaimsYet: 'Sentences appear here as Jev checks them.',
  noScenesYet: 'The scenes appear as Jev answers them.',
  sceneState: {
    pending: 'Waiting for answers',
    asking: 'Waiting for answers',
    answered: 'Answers received',
    clear: 'Not included',
    unrated: 'Included in the guide, strength not checked',
  } as Record<string, string>,
  sceneIncluded: (word: string) => `Included in the guide · ${word}`,
  legendIncluded: 'Included in the guide (colour = strength)',
  legendAsking: 'Being asked',
  tileLabel: (n: number, time: string, words: string) => `Scene ${n}, ${time}, ${words}`,
  sceneRow: (n: number, time: string) => `Scene ${n} · ${time}`,
  whyJevTitle: 'Why Jev does this part',
  whyJevBody:
    'In our tests against parent guides, Jev found scary moments about as well as a larger AI working alone. It is faster, cheaper and more consistent, though its answers can still vary between runs.',
  sonnetTitle: 'What Sonnet did earlier',
  sonnetBody: (scenes: number) =>
    `Sonnet divided the film into ${scenes} ${scenes === 1 ? 'scene' : 'scenes'}, wrote what happens in each, and answered the questions that take reading between the lines: a death, grief, a child lost or taken. None of that runs again here: this check only calls Jev.`,
  srDone: (title: string) => `Jev finished checking ${endWith(title)}`,

  // --- finished ------------------------------------------------------------------------------------
  doneEyebrow: (title: string) => `Live check · ${title} · finished`,
  doneIn: (title: string) => `Jev finished checking ${endWith(title)}`,
  numbersNote: 'These measurements cover Jev’s live check. Sonnet’s earlier reading and writing are not included.',
  numbersLabel: 'The check in numbers',
  numTime: 'Jev check time',
  numCost: 'Jev check cost',
  numScenes: 'Scenes to know about',
  // The comparison with the saved guide: one compact line by the count; what it means, under the list.
  sameYes: (n: number) => (n === 1 ? 'The saved guide lists the same scene.' : `The saved guide lists the same ${n} scenes.`),
  sameDiffers: (onlyRun: number, onlyGuide: number) => {
    const extra = onlyRun === 0 ? 'no extra scenes' : `${onlyRun} extra ${onlyRun === 1 ? 'scene' : 'scenes'}`;
    const missing = onlyGuide === 0 ? 'none missing' : `${onlyGuide} missing`;
    return `Compared with the saved guide: ${extra}, ${missing}.`;
  },
  /** The lists differ only in length (the API matched none apart): said as the two counts. */
  sameCounts: (run: number, guide: number) => `This check lists ${run} ${run === 1 ? 'scene' : 'scenes'}; the saved guide lists ${guide}.`,
  sameNone: 'This film isn’t in the library yet, so there is no saved guide to compare with.',
  sameUnknown: 'We couldn’t compare this check with the saved guide.',
  sameUnknownBody: 'The check finished, but we couldn’t load this film’s library details.',
  sameUnknownRetry: 'Try loading the film details again',
  sameMatchNote: 'This compares which scenes appear, not their descriptions or strength ratings.',
  /** The comparison line opens to name the scenes it counts. */
  onlyRun: 'Only in this check',
  onlyGuide: 'Only in the saved guide',
  onlyNone: 'None.',
  differsBody: 'AI answers can vary between runs, so two checks can list different scenes. The saved guide has not changed.',
  notInLibraryBody: 'Nothing from this check was saved.',
  /** The section after the scene list: what the comparison means, and the ways onward. */
  onwardLabel: 'After this check',
  checksHeading: 'Description checks',
  checksSummary: (kept: number, checked: number) =>
    `Scene summaries: ${kept} of ${checked} sentences were supported by their cited lines and kept.`,
  checksDescriptions: (withText: number, scenes: number) =>
    `Descriptions: ${withText} of ${scenes} ${scenes === 1 ? 'scene has' : 'scenes have'} a description that passed.`,
  checksNote: 'Sentences Jev could not support are left out. Being left out does not mean a sentence is false.',
  flaggedWords: (n: number) => (n === 1 ? 'scene to know about' : 'scenes to know about'),
  noFlaggedHeadline: 'No scenes flagged in this check',
  noFlaggedBody: 'None of the answers met a rule for adding a scene. Subtitles can miss scares, so this does not mean the film has none.',
  noResultBody: 'The check finished, but its list did not come back with it.',
  bandGroup: 'Your child’s age',
  band: { '5-7': 'Ages 5–7', '8-10': 'Ages 8–10' } as Record<string, string>,
  bandsSame: 'These scenes have the same ratings for both age groups.',
  openFilm: 'Open the film page',
  runAgain: 'Run the check again',
  seeResults: 'See the final scene analysis',
  openGuide: 'See the saved guide',
  another: 'Try another film',
  listHeading: 'Scenes to know about',
  listNote: 'Tap a scene for details and skip times.',
  moreReasons: (n: number) => `+${n} more`,
  howItWent: 'How the check went',

  // --- one scene up close --------------------------------------------------------------------------
  backToList: 'Back to scene list',
  backToLive: 'Back to live check',
  sceneEyebrow: (title: string, n: number, of: number) => `${title} · scene ${n} of ${of}`,
  strengthFor: (word: string, band: string) => `${word} for ${String(band).toLowerCase()}`,
  whatTitle: 'What happens',
  whatNote: 'Written by Sonnet. Jev checked each sentence against the subtitle lines it cites.',
  noWords: 'No description passed Jev’s check for this scene, so none is shown. “Why it’s included” still lists its reasons.',
  whyTitle: 'Why it’s included',
  whyLead: 'This scene is listed for the reasons below. Each reason shows which AI supplied the answer.',
  /** Inside a Jev reason's "How this was checked": the scene's question count, and how many this reason used. */
  questionCount: (asked: number, used: number) =>
    `Jev answered ${asked.toLocaleString('en-US')} questions about this scene` +
    (used === 0 ? '.' : used === 1 ? '; this reason uses one of them.' : `; this reason uses ${used} of them.`),
  /** Inside "How this was checked": the general category a film-specific reason is filed and filtered under. */
  categoryKey: 'Category',
  howChecked: 'How this was checked',
  /** A reason that groups several checks ("The Giant and Hogarth in danger"): each one is inside. */
  howCheckedMany: (n: number) => `How this was checked (${n} checks)`,
  asked: 'The question',
  askedMany: 'The questions',
  jevAnswered: 'Jev’s answer',
  sonnetAnswered: 'Sonnet’s answer',
  sonnetYes: 'Yes (answered earlier, when Sonnet read the film)',
  notChecked: 'Not checked',
  answerScore: 'Answer score',
  cutoff: (act: string) => `Cutoff for yes: ${act}`,
  /** Directly above the score bars, inside "How this was checked". */
  scoreNote: 'Scores show how strongly Jev answered yes. They do not predict how a child will react.',
  combinedAny: 'Jev was asked these questions; the highest answer counts.',
  combinedAll: 'Jev was asked these questions; every answer has to pass.',
  combinedGate: 'The second question counts only when the first one passes.',
  decided: 'counted',
  condition: 'condition',
  yesWord: 'Yes',
  theRule: 'Why this answer counts',
  whyNote: 'Jev and Sonnet supply the answers. Rules use those answers to choose which scenes appear.',
  skipTitle: 'Where to skip',
  skipNote: 'These times include a margin before and after the identified scene. Timing can vary by edition.',
  notFlagged: 'This check did not find a reason to include this scene. It may still contain something your child finds upsetting.',
  notAnswered: 'Jev hasn’t answered this scene yet.',
  waitForRules: 'Included in the guide. Why, and where to skip, appear when the check finishes.',
  waitAnswered: 'Answers received. The rules decide whether it is included once every scene is answered.',
  stoppedBeforeRules: 'Answers received, but the check stopped before the rules could decide whether it is included.',
  missingScene: 'This check has no scene by that name.',
} as const;

/**
 * Each flag rule (select.js's `rule` codes), in one plain sentence. An unknown code gets the general
 * sentence rather than a guess at what it means.
 */
export function ruleSentence(rule: string | null | undefined, withLabels: string[] = []): string {
  switch (rule) {
    case 'strong_event':
      return 'A yes here is enough on its own to put a scene on the list.';
    case 'mortal_question':
      return 'A yes to this life-or-death question is enough on its own.';
    case 'presence':
      return 'Its being in the scene is enough on its own to put the scene on the list.';
    case 'presence_with_danger':
      return 'This counts when the scene is also dangerous.';
    case 'presence_with_creature_threat':
      return 'This counts when a creature is also threatening someone.';
    case 'film_child_in_danger':
      return 'This answer adds the scene to the guide because a character is in danger.';
    case 'film_threatens':
      return 'This answer adds the scene to the guide because the film’s villain or creature threatens someone.';
    case 'film_danger':
      return 'This answer adds the scene to the guide because one of the film’s dangers reaches someone.';
    case 'strong_event+cooccur':
      return withLabels.length
        ? `This adds a reason only because the scene also has: ${withLabels.join(', ')}.`
        : 'This adds a reason only alongside a stronger one in the same scene.';
    default:
      return 'One of the rules counts this answer.';
  }
}

/**
 * "Adding a movie": the passcoded flow, which lives inside the library. A search that misses becomes
 * the ask; the ask becomes the live card; the live card becomes a row with a "Just added" chip.
 */
export const ADD = {
  // The ask.
  askHeadline: 'Not in the library. Yet.',
  askBody:
    'We can build a scene guide from the film’s subtitles, cast list and plot. It will list scenes that may scare or upset a child.',
  filmLabel: 'Title or IMDb link',
  passcodeLabel: 'Access code',
  passcodeHelp: 'You need an access code to add a film.',
  submit: 'Find this film',
  /** An IMDb link names exactly one film: the button builds its guide straight away. */
  submitExact: 'Build scene guide',
  finding: 'Looking it up…',
  starting: 'Starting the run…',
  candidatesHeading: 'Choose your film',
  choose: 'Build this film’s guide',
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
  wrongPasscode: 'That access code is not right.',
  busy: 'Another film is being checked. Please try again when it finishes.',
  exists: 'That one is already in the library.',
  unreachable: 'The analyser is not answering. Try again in a minute.',
  badRequest: 'That did not look like a title or an IMDb link.',
  // A 429 is two different refusals wearing one status code, and telling a fumbled passcode that
  // the day's budget is spent sends the reader to wait until tomorrow for a ten-minute problem.
  tooManyAttempts: 'Too many wrong access codes. Give it ten minutes.',
  tooLong: 'That is far more text than a title or a link. Trim it down.',
  // The live card.
  readingHeadline: (title: string) => `We’re reading ${title} now.`,
  readingBody: (title: string) =>
    `We’re building ${title}’s scene guide from its subtitles, cast list and plot. You can browse while we work. Return to the library to check progress.`,
  // Before the API reports a step, nothing is being read yet, and the card does not say otherwise.
  queuedHeadline: (title: string) => `${title} is next.`,
  queuedBody: (title: string) =>
    `We’ll build ${title}’s scene guide as soon as the run starts. You can browse while we work. Return to the library to check progress.`,
  // A rebuild: the film already has a guide, and it stays readable until the update replaces it.
  rebuildHeadline: (title: string) => `We’re updating ${title}’s guide.`,
  rebuildBody: 'You can use the current guide while the update runs.',
  rebuildQueuedHeadline: (title: string) => `${title}’s guide update is next.`,
  rebuildDone: (title: string) => `${title}’s guide is updated.`,
  guideUpdated: 'Guide updated',
  openGuide: 'Open scene guide',
  runLink: 'Follow the running check →',
  queued: 'Waiting to start.',
  /**
   * Which row of the card each API step is shown as. Only the steps whose output reaches the film
   * page have a row (see `parentSteps` in lib/job.ts); the others still run. Two Jev-first stages,
   * Sonnet's describing and Jev's check of it, share one row because a parent reads them as one.
   */
  stepRows: {
    // Both pipelines.
    subtitles: 'subtitles',
    ingest: 'ingest',
    // The live pipeline (ADD_PIPELINE=live).
    scenes: 'scenes',
    presence: 'presence',
    // The Jev-first pipeline (the default). Several internal stages are one step to a parent; the
    // ids cover the v10.4 stage names as well as the ones the scene API reports today.
    sources: 'sources',
    segment: 'segment',
    split_check: 'check',
    claims: 'check',
    fill: 'check',
    refold: 'check',
    classify: 'questions',
    sonnetq: 'questions',
    childcry: 'questions',
    resolve: 'questions',
    mortal: 'questions',
    moments: 'moments',
    describe: 'describe',
    check_describe: 'describe',
    checkdesc: 'describe',
    describe2: 'describe',
    checkdesc2: 'describe',
    titles: 'describe',
    checkdesc3: 'describe',
    mergetext: 'describe',
  } as Record<string, string>,
  /** The rows, in a parent's words: what is being done, not which engine does it. */
  stepLabels: {
    subtitles: 'Finding the subtitles',
    scenes: 'Reading the subtitles for scenes',
    presence: 'Labelling what is in each scene',
    sources: 'Reading the plot summary and the cast list',
    segment: 'Reading the subtitles and dividing the film into scenes',
    check: 'Checking scene breaks and descriptions',
    questions: 'Checking each scene for danger, fear and sadness',
    moments: 'Finding where to skip',
    describe: 'Writing and checking scene descriptions',
    ingest: 'Saving the scene guide',
  } as Record<string, string>,
  /**
   * Who does a row, beside it: the one place in the library that names the two models, because the
   * Watch page explains them and the card is where a parent sees them at work on a new film.
   */
  stepWho: {
    segment: ['Sonnet'],
    check: ['Jev'],
    questions: ['Jev', 'Sonnet'],
    moments: ['Jev'],
    describe: ['Sonnet', 'Jev'],
  } as Record<string, string[]>,
  /**
   * Said beside a row while it runs. Only the one slow step says so, without a duration: this run has
   * not measured it yet, and a promise of "a couple of minutes" would be ours, not the run's.
   */
  stepPace: {
    segment: 'This is the slow part.',
  } as Record<string, string>,
  /** Said once, above the rows, so the chips beside them are introduced. */
  whoNote: 'Sonnet and Jev are the two AIs doing this work.',
  /** How long a finished row took, as the API measured it. */
  stepTook: (ms: number) => formatElapsed(ms),
  // The Jev-first card's lead, by phase: the one slow stretch, then the quick ones after it.
  sonnetReadingBody: (title: string) =>
    `We’re reading ${title}’s subtitles, cast list and plot, and dividing it into scenes. That’s the slow part. You can browse while we work. Return to the library to check progress.`,
  checkingBody: (title: string) =>
    `${title} is divided into scenes. Now every scene is checked for danger, fear and sadness, and the ones to know about get a short description. You can browse while we work.`,
  /** The card's columns: the step list, and what the step running now is doing. */
  nowHeading: 'Now',
  completedSteps: (n: number) => (n === 1 ? '1 completed step' : `${n} completed steps`),
  stepMore: 'More details',
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
    'Its subtitles were fetched in the run you watched. Now we build the scene guide from them. You can browse while we work.',
  checkingAdd: 'Checking whether adding is open…',
  meanwhile: 'Browse the library meanwhile →',
  jobDone: 'That one is done.',
  jobFailed: 'That run did not finish.',
  openFilm: 'See the scene list',
  // A reload while the API is down must not tell the reader their run never existed. It exists; we
  // cannot ask about it. Different news, and only one of the two is worth pressing a button over.
  jobUnreachableHeadline: 'Can’t reach the analysis service',
  jobUnreachableBody: 'The check may still be running. This button checks its progress.',
  jobUnreachableRetry: 'Check for updates',
  // Kept for the /watch run pages, which still show a job's steps and its money.
  jobHeading: 'Analysing',
  stepsHeading: 'Steps',
  costReserved: (usd: number) => `up to $${usd.toFixed(2)} set aside`,
  costTotal: 'in total',
  failNoSubtitles: 'We couldn’t find subtitles for this film, so we couldn’t build its guide.',
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
