// Single source of truth for every arm (Jev, Claude, gold list, report).
// `question` / `yes` / `no` are written literally on purpose: Jev answers the words, not the intent.

export const AUDIENCE = 'a 5-year-old child';

export const CATEGORIES = [
  {
    id: 'peril_chase',
    label: 'Peril / chase',
    question: 'During these lines, is a character in immediate physical danger: being chased, attacked, caught in a hazard, or about to be hurt or killed?',
    yes: 'A character is actively fleeing, under attack, or facing an imminent threat to life or safety right now.',
    no: 'No one is in danger right now; danger is only remembered, imagined, warned about, or joked about.',
  },
  {
    id: 'predator_creature',
    label: 'Scary creature / predator',
    question: 'During these lines, does a frightening creature (a predator, monster, or menacing animal) threaten, stalk, or try to eat a character?',
    yes: 'A predator or menacing creature is present and is a threat to a character.',
    no: 'No threatening creature is present; any large or toothy animals here are friendly or harmless.',
  },
  {
    id: 'death_loss',
    label: 'Death / loss',
    question: 'Do these lines show or strongly imply that a character dies, has died, or is believed to be dead, or show a character grieving a death?',
    yes: 'A death, an apparent death, or grief over a death happens in these lines.',
    no: 'Nobody dies or is mourned; death appears only as a figure of speech or a joke.',
  },
  {
    id: 'separation_abandonment',
    label: 'Separation / abandonment',
    question: 'During these lines, is a child forcibly taken from a parent, lost and unable to find a parent, or is a character abandoned or sent away by a companion they depend on?',
    yes: 'A child and parent are being separated against their will, or a character is being left behind or rejected by someone they depend on.',
    no: 'No one is being separated or abandoned. Ordinary goodbyes such as a school drop-off, a child going off to play, or characters simply being in different places do not count.',
  },
  {
    id: 'injury_pain',
    label: 'Injury / pain',
    question: 'During these lines, is a character physically hurt, stung, wounded, bleeding, sick, or knocked unconscious?',
    yes: 'A character suffers a physical injury, visible pain, or loss of consciousness.',
    no: 'No one is physically hurt; at most there is harmless slapstick.',
  },
  {
    id: 'captivity_confinement',
    label: 'Captivity / trapped',
    question: 'During these lines, is a character captured, caged, netted, swallowed, or otherwise trapped and unable to escape?',
    yes: 'A character is held captive or stuck somewhere against their will and wants to get out.',
    no: 'No one is trapped or captured in these lines.',
  },
  {
    id: 'darkness_unknown',
    label: 'Darkness / eerie place',
    question: 'Do these lines take place somewhere dark, deep, or eerie that frightens the characters, or do characters say they are afraid of what they cannot see?',
    yes: 'The characters are in a dark or eerie place and are frightened by it.',
    no: 'The setting is not dark or eerie, or the characters are not frightened by it.',
  },
  {
    id: 'shouting_aggression',
    label: 'Shouting / aggression',
    question: 'During these lines, does a character yell angrily at, threaten, bully, or intimidate another character?',
    yes: 'A character is hostile toward another: angry yelling, threats, bullying, or intimidation.',
    no: 'Speech is friendly, playful, excited, or merely loud without hostility. A parent or teacher calling out to children or telling them off in an everyday way does not count.',
  },
  {
    id: 'emotional_distress',
    label: 'Emotional distress',
    question: 'During these lines, does a character show strong negative emotion: panic, terror, crying, despair, or heartbreak?',
    yes: 'A main character is visibly panicking, screaming in terror, sobbing, despairing, or heartbroken.',
    no: 'Emotions are calm or positive, or at most nervousness, fussing, embarrassment, teasing, annoyance, or comic exasperation. A baby crying in the background does not count.',
  },
  {
    id: 'imitable_risk',
    label: 'Risky behaviour a child could copy',
    question: 'During these lines, does a child character deliberately do something dangerous or defy a safety rule set by a parent?',
    yes: 'A child character knowingly disobeys a safety warning or takes a dangerous dare.',
    no: 'No child character deliberately does anything dangerous or defies a safety rule.',
  },
  {
    id: 'loud_sudden_sound',
    label: 'Loud / sudden sound (inferred)',
    inferred: true,
    question: 'Do these lines contain a caption or dialogue indicating a sudden loud noise, such as an explosion, crash, scream, roar, alarm, or bang?',
    yes: 'A caption or spoken line indicates a sudden loud noise happens.',
    no: 'Nothing indicates a sudden loud noise. Laughter, crying, gasps, sighs, singing, music, and ordinary speech do not count.',
  },
  {
    id: 'flashing_light_inferred',
    label: 'Flashing / bright light (inferred)',
    inferred: true,
    question: 'Do these lines contain a caption or dialogue indicating bright flashes, explosions, lightning, electrical sparks, or flickering light?',
    yes: 'A caption or spoken line indicates a bright flash, explosion, lightning, sparks, or flickering light.',
    no: 'Nothing in these lines indicates flashing or suddenly bright light.',
  },
];

export const CATEGORY_IDS = CATEGORIES.map((c) => c.id);

export const SEVERITY_QUESTION = `How frightening or upsetting would these lines be for ${AUDIENCE} watching the movie?`;

// Ordered levels, index = severity 0..3. Each level stands on its own.
export const SEVERITY_LEVELS = [
  'None: calm, funny, or everyday conversation; nothing here would frighten or upset a 5-year-old.',
  'Mild: a brief tense, sad, or startling moment that resolves quickly; most 5-year-olds would not be bothered.',
  'Moderate: sustained danger, fear, or sadness; a sensitive 5-year-old may be scared or want a parent close.',
  'Strong: an intense threat to life, a death, a terrifying creature attack, or deep grief; likely to frighten or upset most 5-year-olds.',
];
