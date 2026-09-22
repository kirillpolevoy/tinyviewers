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

export const NAV = [
  { href: '/search', label: 'Search' },
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
    'Watch questions zip across a film, then see the scenes take shape. The recorded run is coming.',
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
  emptyAction: 'Search',
} as const;

/** Search, by movie name only. */
export const SEARCH = {
  title: 'Find tonight’s film',
  fieldLabel: 'Movie title',
  placeholder: 'Tonight’s movie',
  button: 'Check my movie',
  emptySubmission: 'Give us a movie title.',
  resultsHeading: 'Here’s what turned up.',
  resultsInstruction: 'Pick the title and year you mean.',
  noMatchHeadline: 'Not on our shelf. Yet.',
  noMatchBody: 'Check the spelling, or try the full title.',
  noMatchAction: 'Watch it work',
  prompt: 'Type a movie title and we’ll show you its scenes.',
} as const;

/** Film page. */
export const FILM = {
  sourceAndTiming:
    'AI reads subtitles, not images. Times come from one release; your copy may run a few seconds earlier or later, or drift further.',
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

/** The phase-2 placeholder, in the analysis page's dark register. */
export const WATCH = {
  headline: 'First the clues. Then the scenes.',
  comingLine: 'The recorded run is coming. Nothing to play back here yet.',
  backToLibrary: 'Browse the library',
  toFilmList: 'See the finished scene list',
} as const;

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
  search: 'Search',
} as const;
