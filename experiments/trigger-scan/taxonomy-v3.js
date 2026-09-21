// Taxonomy v3 — three separate layers, after CODEX-REVIEW.md finding 6.
//
// v2 asked "is a dangerous monster threatening a character who is there with it?" and used that as the
// answer to the parent's question "which scenes have monsters?". Those are different questions. In
// Monsters, Inc. almost every character is a monster and almost none of them are threatening anyone;
// Mufasa's ghost was excluded from `ghost_supernatural` because Simba is not frightened by it, although
// a five-year-old might be. v3 splits the three things that were tangled together:
//
//   Layer A  PRESENCE   what is in the scene, regardless of threat or tone
//   Layer B  EVENTS     what is happening to the characters right now
//   Layer C  SEVERITY   how bad it is, plus the modifiers that change how A and B should be read
//
// Rules that follow from the split:
//   - Presence is true for friendly, comic, imagined-on-screen and threatening instances alike.
//   - Presence is false when the thing is only talked about; that case is captured separately by the
//     parallel `mention` channel (same ids, see MENTION_QUESTION).
//   - The retold / imagined veto applies to EVENTS only. It must never erase a presence label:
//     a monster in a dream sequence is still a monster a child sees on screen.
//
// Every item carries:
//   id, layer, group, label (parent-facing), question (P = the beat path, e.g. `beats[2].lines`),
//   no (optional false-boundary written into Noul criteria), weights for the two age bands
//   (3 high / 2 medium / 1 low, from ATTRIBUTES-RESEARCH.md), textBlind, and v2 (the taxonomy-v2
//   attribute ids this replaces, so old reference lists can still be partly reused).
//
// textBlind = subtitles usually cannot see this. A `yes` is informative; a `no` means nothing.
// Jev reads subtitle lines and nothing else: a creature that nobody names and nobody reacts to is
// invisible to it. That limit is a property of the input, not of the model.

// ---------------------------------------------------------------------------------------------
// Shared criteria
// ---------------------------------------------------------------------------------------------

// Yes-side for every presence question: tone and intent are explicitly irrelevant.
// Kept short on purpose — these two strings are repeated once per presence question per beat, and
// question text is what the request is billed on.
export const PRESENT_YES =
  'It is there in the scene now: seen, heard, or reacted to by the characters. Friendly, comic, imaginary, dreamed and dangerous all count.';

// No-side for every presence question.
export const PRESENT_NO =
  'Only being talked about - remembered, warned about, planned, or used as a comparison - while it is not there, is a no.';

// The event-layer boundary carried over from v2.
export const RETOLD = 'A character describing something that happened earlier, or that might happen, is a no.';

export const PRESENCE_QUESTION = (noun) => `In P, is ${noun} there in the scene?`;
export const MENTION_QUESTION = (noun) => `In P, is ${noun} talked about while not being there in the scene?`;
export const MENTION_NO = 'If it is there in the scene, the answer is no. If these lines do not bring it up at all, the answer is no.';

// ---------------------------------------------------------------------------------------------
// Parent-facing groups
// ---------------------------------------------------------------------------------------------

export const GROUPS = {
  // Layer A
  creatures_figures: 'Creatures & figures on screen',
  objects_hazards: 'Objects, places & hazards on screen',
  // Layer B
  peril: 'Peril',
  violence: 'Violence',
  death: 'Death & loss',
  separation: 'Separation & family',
  injury: 'Injury & medical',
  captivity: 'Captivity',
  eerie: 'Eerie & startle',
  hostility: 'Hostility & cruelty',
  distress: 'Character distress',
  animals: 'Animals',
  copyable: 'Copyable risk', // an imitation harm, not a fright harm: reported beside the scare score
  // Layer C
  severity: 'Severity',
  modifier: 'Modifiers',
};

// ---------------------------------------------------------------------------------------------
// LAYER A — PRESENCE
// ---------------------------------------------------------------------------------------------
// `noun` builds both the presence question and the parallel mention question. A few items need a
// custom `question` because the template reads badly; those set `mention: false` where a "talked
// about but absent" reading makes no sense.

const P = (id, group, label, noun, w57, w810, v2, extra = {}) => ({
  id,
  layer: 'presence',
  group,
  label,
  noun,
  question: extra.question ?? PRESENCE_QUESTION(noun),
  yes: PRESENT_YES,
  // `noExtra` is an item-specific exclusion appended to the shared no-boundary. Each one below was
  // added after reading the first run's hits by hand (see TAXONOMY-V3.md, "What the hand-check changed").
  no: extra.noExtra ? `${PRESENT_NO} ${extra.noExtra}` : PRESENT_NO,
  mention: extra.mention !== false,
  mentionQuestion: extra.mention === false ? null : MENTION_QUESTION(noun),
  weights: { '5-7': w57, '8-10': w810 },
  textBlind: extra.textBlind ?? false,
  v2,
  ...extra,
});

export const PRESENCE = [
  // --- creatures and figures -------------------------------------------------------------------
  P('monster_creature', 'creatures_figures', 'Monster or strange creature',
    'a monster: a frightening creature that is not an ordinary animal and not a person', 3, 1, ['monster_threatens'],
    { noExtra: 'An ordinary animal - a fish, bird, insect, or mammal - is a no, even if it is dangerous and even if it talks. A machine or a robot is a no.' }),
  P('ghost_spirit', 'creatures_figures', 'Ghost or spirit',
    'a ghost, a spirit, or the soul of someone who has died', 3, 2, ['ghost_supernatural'],
    { noExtra: 'A character shouting "boo" to startle somebody, or a character whose name is Boo, is a no.' }),
  P('reanimated_dead', 'creatures_figures', 'Something dead brought back to life',
    'a dead person or a dead animal that has been brought back to life', 3, 2, ['corpses_undead', 'transformation']),
  P('skeleton_corpse', 'creatures_figures', 'Skeleton or dead body',
    'a skeleton, bones, or a dead body', 3, 2, ['corpses_undead'], { textBlind: true }),
  P('shark', 'creatures_figures', 'Shark',
    'a shark', 3, 2, ['phobia_animals'],
    { noExtra: 'A different predator - a barracuda, an eel, a whale, a bird, a big cat - is a no. The word "shark" used inside somebody\'s name or nickname is a no.' }),
  P('spider_insect', 'creatures_figures', 'Spider or insect',
    'a spider, an insect, or another crawling bug', 3, 2, ['phobia_animals'], { textBlind: true }),
  P('snake_reptile', 'creatures_figures', 'Snake or reptile',
    'a snake or a lizard', 3, 2, ['phobia_animals'], { textBlind: true }),
  P('large_predator', 'creatures_figures', 'Large predatory animal',
    'a large predatory animal such as a wolf, a lion, a bear, a big cat, a crocodile, or a bird of prey', 3, 2, ['phobia_animals', 'monster_threatens']),
  P('rodent_bat', 'creatures_figures', 'Rat, mouse or bat',
    'a rat, a mouse, or a bat', 2, 1, ['phobia_animals'], { textBlind: true }),
  P('clown_doll_puppet', 'creatures_figures', 'Clown, doll or puppet',
    'a clown, a doll, a puppet, a mannequin, or a mask worn over a face', 3, 2, ['uncanny_figures'], { textBlind: true }),
  P('robot_machine_being', 'creatures_figures', 'Robot or machine creature',
    'a robot or a machine that moves and acts like a living thing', 2, 1, []),
  P('witch_magic_villain', 'creatures_figures', 'Witch, sorcerer or dark magic',
    'a witch, a wizard, a sorcerer, a curse, or someone using frightening magic', 3, 1, ['ghost_supernatural']),
  P('alien', 'creatures_figures', 'Alien',
    'an alien from outer space', 3, 1, [],
    { noExtra: 'A person, an animal, or any being that belongs to the world this story is set in is a no, even when the other characters find it unfamiliar or call it a thing.' }),
  P('scary_appearance', 'creatures_figures', 'Someone who looks frightening',
    null, 3, 1, ['scary_looking', 'disfigured_body'], {
      question: 'In P, do the characters react to how frightening, ugly, strange, or disfigured somebody looks?',
      mention: false,
      textBlind: true,
    }),

  // --- objects, places and hazards ---------------------------------------------------------------
  P('gun', 'objects_hazards', 'Gun',
    'a gun or another firearm', 2, 3, ['guns_shooting']),
  P('blade_weapon', 'objects_hazards', 'Knife, sword or other weapon',
    'a knife, a sword, an axe, a spear, or another bladed weapon', 2, 3, ['blade_weapon']),
  P('fire', 'objects_hazards', 'Fire',
    'fire or something burning', 3, 3, ['fire_disaster']),
  P('explosion', 'objects_hazards', 'Explosion or bomb',
    'an explosion or a bomb', 3, 3, ['fire_disaster', 'war_mass_violence']),
  P('storm_lightning', 'objects_hazards', 'Storm or lightning',
    'a storm, thunder, lightning, a tornado, or a flood', 3, 2, ['fire_disaster']),
  P('deep_dark_water', 'objects_hazards', 'Deep or dark water',
    'deep, dark, or open water that a character could sink into', 2, 2, ['drowning'], { textBlind: true }),
  P('heights', 'objects_hazards', 'Dangerous height',
    'a dangerous height such as a cliff, a ledge, a rooftop, or a long drop', 3, 2, ['fall_from_height'], { textBlind: true }),
  P('darkness', 'objects_hazards', 'Darkness',
    null, 3, 1, ['pitch_dark'], {
      question: 'In P, is it dark where the characters are, so that they cannot see well?',
      mention: false,
    }),
  P('needle_medical', 'objects_hazards', 'Needle or medical procedure',
    "a needle, an injection, a surgical instrument, or a dentist's drill", 2, 2, ['needles_hospital'],
    { noExtra: 'Tools or machinery that are not being used to treat a patient are a no.' }),
  P('hospital_illness', 'objects_hazards', 'Hospital or seriously ill person',
    'a hospital, a doctor or nurse treating somebody, or a seriously ill patient', 2, 3, ['serious_illness', 'needles_hospital']),
  P('blood_wound', 'objects_hazards', 'Blood or an open wound',
    'blood or an open wound', 2, 3, ['blood_wounds'], { textBlind: true }),
  P('vehicle_crash', 'objects_hazards', 'Vehicle out of control or crashing',
    'a car, truck, train, boat, or aircraft that is crashing or out of control', 2, 3, ['vehicle_crash']),
  P('cage_net_trap', 'objects_hazards', 'Cage, net or trap',
    'a cage, a net, a trap, ropes tying somebody up, or a locked room holding somebody in', 2, 2, ['captured', 'sealed_in']),
  P('graveyard_funeral', 'objects_hazards', 'Graveyard or funeral',
    'a graveyard, a tomb, a grave, or a funeral', 3, 2, ['grieving']),
  P('dangerous_machine', 'objects_hazards', 'Dangerous machinery or electricity',
    'dangerous machinery such as blades, saws, gears, or high-voltage electricity', 2, 2, ['in_hazard'], { textBlind: true }),
];

// ---------------------------------------------------------------------------------------------
// LAYER B — EVENTS (present tense; what is happening to the characters right now)
// ---------------------------------------------------------------------------------------------
// Carried over from taxonomy-v2.js and trimmed: everything that was really "is X on screen"
// (monster_threatens, phobia_animals, corpses_undead, uncanny_figures, scary_looking,
// blood_wounds, needles_hospital, serious_illness, disfigured_body, pitch_dark, fire_disaster,
// war_mass_violence) moved to Layer A. `unconscious` folded into `injured`.

const E = (id, group, label, question, no, w57, w810, v2, extra = {}) => ({
  id,
  layer: 'event',
  group,
  label,
  question,
  no,
  weights: { '5-7': w57, '8-10': w810 },
  textBlind: extra.textBlind ?? false,
  v2,
  ...extra,
});

export const EVENTS = [
  E('chased', 'peril', 'Someone is being chased',
    'In P, is a character being chased or hunted at this moment?', RETOLD, 3, 3, ['chased']),
  E('attacked', 'peril', 'Someone is being attacked',
    'In P, does one character hit, bite, claw, or physically attack another at this moment?',
    `${RETOLD} Playful roughhousing is a no.`, 3, 3, ['physical_violence', 'monster_threatens']),
  E('weapon_used', 'violence', 'A weapon is used on someone',
    'In P, is a weapon fired at, swung at, or pointed at a character?', RETOLD, 2, 3, ['guns_shooting', 'blade_weapon']),
  E('falling', 'peril', 'Someone is falling',
    'In P, is a character falling, or about to fall, from a dangerous height?', RETOLD, 3, 3, ['fall_from_height']),
  E('drowning', 'peril', 'Someone cannot breathe',
    'In P, is a character drowning, held under water, or unable to breathe?', RETOLD, 3, 3, ['drowning']),
  E('caught_in_hazard', 'peril', 'Someone is caught in a hazard',
    'In P, is a character caught in a fire, a flood, a strong current, a machine, or a collapsing place at this moment?',
    RETOLD, 3, 3, ['in_hazard', 'fire_disaster']),
  E('vehicle_accident', 'peril', 'A vehicle crash is happening',
    'In P, does a vehicle crash, or is a character about to be hit by one?', RETOLD, 2, 3, ['vehicle_crash']),
  E('battle', 'violence', 'A battle or attack on many people',
    'In P, is there a battle, a bombing, or an attack on many people at once?', RETOLD, 2, 3, ['war_mass_violence']),

  E('captured', 'captivity', 'Someone is being caught',
    'In P, is a character being caught, caged, netted, bagged, or tied up at this moment?', RETOLD, 2, 2, ['captured']),
  E('trapped_struggling', 'captivity', 'Someone is trapped and struggling',
    'In P, is a character swallowed, buried, locked in, or stuck somewhere and struggling to get out?',
    'Characters who live in a tank or a cage and are calmly talking or planning are a no.', 3, 2, ['sealed_in']),

  E('injured', 'injury', 'Someone is hurt',
    'In P, is a character physically hurt, stung, burned, wounded, or knocked unconscious at this moment?',
    `${RETOLD} Harmless slapstick is a no.`, 2, 3, ['serious_injury', 'unconscious']),

  E('dies', 'death', 'Someone dies',
    'In P, does a character die or get killed at this moment?', RETOLD, 3, 3, ['dies_now']),
  E('believed_dead', 'death', 'Someone believes a loved one just died',
    'In P, does a character believe that someone close to them has just died?',
    '"I\'m dead" as a figure of speech is a no. Remembering a death from long ago is a no.', 3, 3, ['believed_dead']),
  E('parent_death_learned', 'death', 'A child loses a parent',
    'In P, does a child see or learn that their parent or caregiver has died?',
    'A parent who died long before the story is a no.', 3, 3, ['parent_dies']),
  E('grieving', 'death', 'Someone is mourning',
    'In P, is a character mourning someone they have lost, or at a funeral or a grave?', null, 2, 3, ['grieving']),

  E('child_taken', 'separation', 'A child is taken from a parent',
    'In P, is a child being kidnapped or taken away from a parent at this moment?',
    'A parent telling others that their child was taken earlier is a no. A school drop-off is a no.', 3, 3, ['child_taken']),
  E('child_lost', 'separation', 'A child and parent are separated and calling out',
    'In P, is a child alone and calling for a parent, or a parent desperately calling for a missing child?',
    RETOLD, 3, 3, ['child_lost']),
  E('abandoned', 'separation', 'Someone is sent away or left behind',
    'In P, is a character told to leave, left behind, or sent away by someone they depend on?',
    'An ordinary goodbye is a no.', 3, 3, ['abandoned']),
  E('family_in_danger', 'separation', 'A family member is in danger',
    'In P, does a character learn that a family member is in danger, missing, or seriously ill?', null, 2, 3, ['family_in_danger']),
  E('parents_fighting', 'separation', "A child's parents are fighting",
    "In P, do a child's parents argue bitterly with each other, or talk about separating?", null, 2, 2, ['parents_fighting']),

  E('rages_at_child', 'hostility', 'An adult rages at a child',
    'In P, is an adult yelling at a child in anger?', 'Urgent or worried shouting without anger is a no.', 3, 2, ['adult_rages_at_child']),
  E('threatens_harm', 'hostility', 'Someone threatens to hurt someone',
    'In P, does a character threaten to harm another character?', null, 2, 2, ['threatens_harm']),
  E('bullying', 'hostility', 'Someone is mocked or excluded',
    'In P, is a character being mocked, humiliated, or deliberately left out by others?',
    'Friendly teasing between friends is a no.', 2, 3, ['bullying']),
  E('discrimination', 'hostility', 'Someone is treated badly for who they are',
    'In P, is a character insulted or treated badly because of their race, body, disability, or where they come from?',
    null, 1, 3, ['discrimination']),
  E('caregiver_cruelty', 'hostility', 'A caregiver is cruel to a child',
    'In P, does a parent or caregiver hurt, lock up, starve, or cruelly neglect a child?', null, 3, 3, ['caregiver_cruelty']),
  E('betrayal', 'hostility', 'A trusted adult turns on a child',
    'In P, does an adult a child trusts trick or turn against that child?', null, 2, 2, ['betrayal']),

  E('transformation', 'eerie', 'Someone changes into something frightening',
    'In P, does a familiar character change into something frightening, or become possessed or controlled?', null, 3, 2, ['transformation']),
  E('nightmare', 'eerie', 'A nightmare or frightening vision',
    'In P, is a character having a nightmare or a frightening vision?', null, 2, 2, ['nightmare']),
  E('unseen_threat', 'eerie', 'Something unseen is near',
    'In P, do characters sense that something they cannot see is near them or following them?', null, 3, 2, ['unseen_threat']),
  E('jump_scare', 'eerie', 'A sudden startle',
    'In P, does something suddenly startle a character so that they scream or gasp?', null, 3, 2, ['jump_scare'], { textBlind: true }),

  E('terrified', 'distress', 'Someone is terrified',
    'In P, is a character panicking or screaming in terror?', null, 3, 3, ['terrified']),
  E('sobbing_despair', 'distress', 'Someone is crying or despairing',
    'In P, is a character crying, pleading, or giving up hope?', 'A baby crying in the background is a no.', 3, 3, ['sobbing_despair']),

  E('animal_cruelty', 'animals', 'An animal is mistreated',
    'In P, does a character deliberately hurt or mistreat an animal?', RETOLD, 3, 3, ['animal_cruelty']),
  E('animal_in_danger', 'animals', 'An animal is in danger',
    'In P, is an animal trapped, hunted, hurt, or crying out in fear?',
    `${RETOLD} In a film where the characters are animals, answer only for animals that cannot speak.`, 3, 2, ['animal_in_danger']),

  E('dangerous_act', 'copyable', 'A child does something dangerous',
    'In P, does a child do something dangerous that an adult has just told them not to do, or take a dangerous dare?',
    null, 3, 2, ['dangerous_act']),
  E('runs_away', 'copyable', 'A child runs away or goes off with a stranger',
    'In P, does a child run away from home or go off with a stranger?', null, 3, 2, ['runs_away']),
  E('slapstick_violence', 'copyable', 'Violence played for laughs',
    'In P, does a character hurt someone in a way that is played for laughs and that a child could copy?',
    null, 3, 2, ['funny_violence']),
];

// ---------------------------------------------------------------------------------------------
// LAYER C — SEVERITY AND MODIFIERS
// ---------------------------------------------------------------------------------------------

export const THREAT_LEVELS = [
  'Nobody is in any danger.',
  'A danger is talked about or hinted at but is not present.',
  'A character is in real danger but not harmed: chased, cornered, or trapped.',
  'A character is attacked, seriously hurt, swallowed, or appears to die.',
];

export const DISTRESS_LEVELS = [
  'Characters are calm, joking, or happy.',
  'A character is worried, annoyed, or sad but composed.',
  'A character is frightened, crying, or pleading.',
  'A character is screaming in terror or grieving a death.',
];

export const SEV_5_7_LEVELS = [
  'Calm or funny talk; nobody is scared, hurt, lost, or in danger.',
  'A brief scare, a loud surprise, or a short moment of worry or sadness that is over within these lines.',
  'A character is chased, trapped, lost, in the dark, or crying, and it continues through these lines.',
  'A creature attacks a character, a child is taken from a parent, or someone dies or appears to die.',
];

export const SEV_8_10_LEVELS = [
  'Calm or funny talk; nobody is scared, hurt, lost, or in danger.',
  'Danger or sadness that is make-believe, played for laughs, or over within these lines.',
  'A character is really hurt, humiliated, or in danger that continues through these lines.',
  'Someone dies or appears to die, a child is taken from a parent, or a family member is in serious danger.',
];

export const SEVERITY_SCORES = {
  threat: { label: 'Physical danger', instructions: 'How much physical danger are the characters in during P?', levels: THREAT_LEVELS },
  distress: { label: 'Character upset', instructions: 'How upset are the characters during P?', levels: DISTRESS_LEVELS },
  sev57: { label: 'Severity, ages 5-7', instructions: 'Which situation best describes what happens in P?', levels: SEV_5_7_LEVELS, experimental: true },
  sev810: { label: 'Severity, ages 8-10', instructions: 'Which situation best describes what happens in P?', levels: SEV_8_10_LEVELS, experimental: true },
};

export const MODIFIERS = {
  retold: { label: 'Being retold', question: 'In P, is a character telling others about events that happened at another time or in another place?', no: null, v2: ['recounting'] },
  imagined: { label: 'Imagined or dreamed', question: 'In P, is the frightening thing only imagined, dreamed, or pretended by a character?', no: null, v2: ['imagined'] },
  comic: { label: 'Played for laughs', question: 'Is the exchange in P played as a joke?', no: null, v2: ['joking'] },
  child_victim: { label: 'The one in trouble is a child', question: 'In P, is the character in danger or in distress a child?', no: null, v2: ['child_victim'] },
  animal_victim: { label: 'The one in trouble is an animal', question: 'In P, is the character in danger or in distress an animal or a pet?', no: null, v2: ['animal_victim'] },
  reassured: { label: 'Comforted or rescued', question: 'In P, is a frightened or hurt character comforted, rescued, or told that they are safe?', no: null, v2: ['reassured'] },
};

// ---------------------------------------------------------------------------------------------
// Composition rules for code (never for the model)
// ---------------------------------------------------------------------------------------------

// The retold/imagined veto applies to EVENTS only, and never to presence. An imagined monster is
// still a monster on screen; an imagined chase is not a chase.
export const EVENTS_CANCELLED_WHEN_RETOLD = new Set(
  EVENTS.filter((e) => ['peril', 'violence', 'captivity', 'injury', 'animals'].includes(e.group)
    || ['child_taken', 'child_lost', 'dies'].includes(e.id)).map((e) => e.id),
);

// Events whose reading a joking tone cancels.
export const EVENTS_CANCELLED_WHEN_COMIC = new Set(['threatens_harm', 'rages_at_child', 'attacked', 'bullying']);

export const ALL_ITEMS = [...PRESENCE, ...EVENTS];
export const BY_ID = Object.fromEntries(ALL_ITEMS.map((i) => [i.id, i]));

export const COUNTS = {
  presence: PRESENCE.length,
  presenceWithMention: PRESENCE.filter((p) => p.mention).length,
  events: EVENTS.length,
  modifiers: Object.keys(MODIFIERS).length,
  severityScores: Object.keys(SEVERITY_SCORES).length,
  questionsPerBeat: PRESENCE.length + PRESENCE.filter((p) => p.mention).length + EVENTS.length
    + Object.keys(MODIFIERS).length + Object.keys(SEVERITY_SCORES).length,
};
