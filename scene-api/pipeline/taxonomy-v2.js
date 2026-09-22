// COPY of experiments/trigger-scan/taxonomy-v2.js as of commit 5fe8fb5, byte for byte below this line.
// The experiment keeps its own copy as the historical record; see pipeline/README.md.
// Universal attribute set for ages 5-10 (any film), validated against the fright-reaction literature
// and existing rating systems; sources and reasoning in ATTRIBUTES-RESEARCH.md.
//
// Two layers: parent-facing GROUPS, and narrow present-tense ATTRIBUTES the model answers per beat.
// Each attribute: [id, group, question about P, `no` boundary, weight 5-7, weight 8-10, legacy category]
//   weights: 3 high, 2 medium, 1 low (how much this matters for that age band, per the research)
//   `textBlind: true` = mostly invisible to subtitles; a yes is useful, a no means nothing.
//   legacy = the v1 category id, used only to score against the Finding Nemo reference list.

export const RETOLD = 'A character describing something that happened earlier, or that might happen, is a no.';

export const GROUPS = {
  peril: 'Peril',
  creatures: 'Scary creatures & imagery',
  violence: 'Violence',
  death: 'Death & loss',
  separation: 'Separation & family',
  injury: 'Injury & medical',
  captivity: 'Captivity',
  eerie: 'Dark, eerie & startle',
  hostility: 'Hostility & cruelty',
  distress: 'Character distress',
  animals: 'Animals',
  copyable: 'Copyable risk', // an imitation harm, not a fright harm: reported separately
  sound: 'Sound cues', // from hearing-impaired captions only
};

const A = (id, group, question, no, w57, w810, legacy, extra = {}) => ({ id, group, question, no, weights: { '5-7': w57, '8-10': w810 }, legacy, ...extra });

export const ATTRIBUTES = [
  A('chased', 'peril', 'In P, is a character being chased or hunted at this moment?', RETOLD, 3, 3, 'peril_chase'),
  A('fall_from_height', 'peril', 'In P, is a character falling, or about to fall, from a dangerous height?', RETOLD, 3, 3, 'peril_chase'),
  A('drowning', 'peril', 'In P, is a character drowning, held under water, or unable to breathe?', RETOLD, 3, 3, 'peril_chase'),
  A('in_hazard', 'peril', 'In P, is a character caught in a physical hazard at this moment, such as a net, a machine, a strong current, or a collapsing place?', RETOLD, 3, 3, 'peril_chase'),
  A('vehicle_crash', 'peril', 'In P, does a vehicle crash or is a character about to be hit by a vehicle?', RETOLD, 2, 3, 'peril_chase'),
  A('fire_disaster', 'peril', 'In P, are characters caught in a fire, flood, storm, earthquake, or other natural disaster?', RETOLD, 3, 3, 'peril_chase'),

  A('monster_threatens', 'creatures', 'In P, is a dangerous animal or monster threatening a character who is there with it?', `${RETOLD} A friendly animal is a no.`, 3, 2, 'predator_creature'),
  A('scary_looking', 'creatures', 'In P, do characters react to how frightening, ugly, or strange another character looks?', null, 3, 1, 'predator_creature', { textBlind: true }),
  A('ghost_supernatural', 'creatures', 'In P, does a ghost, demon, witch, curse, or other supernatural force threaten or frighten a character?', RETOLD, 3, 2, 'predator_creature'),
  A('corpses_undead', 'creatures', 'In P, do characters come across a skeleton, a dead body, or the undead?', RETOLD, 3, 2, 'predator_creature'),
  A('transformation', 'creatures', 'In P, does a familiar character change into something frightening, or become possessed or controlled?', null, 3, 2, 'predator_creature'),
  A('phobia_animals', 'creatures', 'In P, do spiders, snakes, insects, rats, bats, or sharks appear close to a character?', RETOLD, 3, 2, 'predator_creature'),
  A('uncanny_figures', 'creatures', 'In P, does a clown, doll, toy, puppet, mask, or statue behave in a frightening way?', null, 3, 2, 'predator_creature'),

  A('physical_violence', 'violence', 'In P, does one character hit, kick, bite, or physically attack another?', `${RETOLD} Playful roughhousing is a no.`, 2, 2, 'peril_chase'),
  A('blade_weapon', 'violence', 'In P, is a knife, sword, or other weapon that is not a gun used or pointed at a character?', RETOLD, 2, 3, 'peril_chase'),
  A('guns_shooting', 'violence', 'In P, is a gun fired or pointed at a character?', RETOLD, 2, 3, 'peril_chase'),
  A('blood_wounds', 'violence', 'In P, do characters mention blood, a wound, or a body part being injured?', null, 2, 3, 'injury_pain', { textBlind: true }),
  A('war_mass_violence', 'violence', 'In P, is there a battle, a bombing, or an attack on many people at once?', RETOLD, 2, 3, 'peril_chase'),

  A('dies_now', 'death', 'In P, does a character die or get killed at this moment?', RETOLD, 3, 3, 'death_loss'),
  A('parent_dies', 'death', 'In P, does a child learn or see that their parent or caregiver has died?', 'A parent who died long before the story is a no.', 3, 3, 'death_loss'),
  A('loved_one_dies', 'death', 'In P, does a character learn or see that a sibling, friend, or other loved one has died?', 'A death long before the story is a no.', 3, 3, 'death_loss'),
  A('pet_animal_dies', 'death', 'In P, does a pet or another animal die?', RETOLD, 3, 3, 'death_loss'),
  A('believed_dead', 'death', 'In P, does a character believe that someone close to them has just died?', '"I\'m dead" as a figure of speech is a no.', 3, 3, 'death_loss'),
  A('grieving', 'death', 'In P, is a character mourning someone they have lost, or at a funeral or grave?', null, 2, 3, 'death_loss'),

  A('child_taken', 'separation', 'In P, is a child being kidnapped or taken away from a parent at this moment?', 'A parent telling others that their child was taken earlier is a no. A school drop-off is a no.', 3, 3, 'separation_abandonment'),
  A('child_lost', 'separation', 'In P, is a child alone and calling for a parent, or a parent desperately calling for a missing child?', RETOLD, 3, 3, 'separation_abandonment'),
  A('abandoned', 'separation', 'In P, is a character told to leave, left behind, or sent away by someone they depend on?', 'An ordinary goodbye is a no.', 3, 3, 'separation_abandonment'),
  A('family_in_danger', 'separation', 'In P, does a character learn that a family member is in danger, missing, or seriously ill?', null, 2, 3, 'separation_abandonment'),
  A('parents_fighting', 'separation', 'In P, do a child\'s parents argue bitterly with each other, or talk about separating?', null, 2, 2, 'shouting_aggression'),

  A('serious_injury', 'injury', 'In P, is a character physically hurt, stung, burned, or wounded at this moment?', `${RETOLD} Harmless slapstick is a no.`, 2, 3, 'injury_pain'),
  A('unconscious', 'injury', 'In P, does a character collapse, pass out, or lie unresponsive?', RETOLD, 2, 3, 'injury_pain'),
  A('serious_illness', 'injury', 'In P, is a character seriously ill or dying of an illness?', null, 2, 3, 'injury_pain'),
  A('needles_hospital', 'injury', 'In P, does a character face a needle, surgery, a dentist\'s drill, or a frightening medical procedure?', null, 2, 2, 'injury_pain'),
  A('disfigured_body', 'injury', 'In P, do characters react to a body that is disfigured, distorted, or missing a part?', null, 3, 1, 'injury_pain', { textBlind: true }),

  A('captured', 'captivity', 'In P, is a character being caught, caged, netted, bagged, or tied up at this moment?', RETOLD, 2, 2, 'captivity_confinement'),
  A('sealed_in', 'captivity', 'In P, is a character swallowed, buried, locked in, or stuck somewhere and struggling to get out?', 'Characters who live in a tank or cage and are calmly talking or planning are a no.', 3, 2, 'captivity_confinement'),

  A('pitch_dark', 'eerie', 'In P, do characters say that it is dark or that they cannot see, and sound afraid?', null, 3, 1, 'darkness_unknown'),
  A('unseen_threat', 'eerie', 'In P, do characters sense that something they cannot see is near them or following them?', null, 3, 2, 'darkness_unknown'),
  A('nightmare', 'eerie', 'In P, is a character having a nightmare or a frightening vision?', null, 2, 2, 'darkness_unknown'),
  A('jump_scare', 'eerie', 'In P, does something suddenly startle a character so that they scream or gasp?', null, 3, 2, 'loud_sudden_sound', { textBlind: true }),

  A('adult_rages_at_child', 'hostility', 'In P, is an adult yelling at a child in anger?', 'Urgent or worried shouting without anger is a no.', 3, 2, 'shouting_aggression'),
  A('threatens_harm', 'hostility', 'In P, does a character threaten to harm another character?', null, 2, 2, 'shouting_aggression'),
  A('bullying', 'hostility', 'In P, is a character being mocked, humiliated, or deliberately left out by others?', 'Friendly teasing between friends is a no.', 2, 3, 'shouting_aggression'),
  A('discrimination', 'hostility', 'In P, is a character insulted or treated badly because of their race, body, disability, or where they come from?', null, 1, 3, 'shouting_aggression'),
  A('caregiver_cruelty', 'hostility', 'In P, does a parent or caregiver hurt, lock up, starve, or cruelly neglect a child?', null, 3, 3, 'shouting_aggression'),
  A('betrayal', 'hostility', 'In P, does an adult a child trusts trick or turn against that child?', null, 2, 2, 'shouting_aggression'),

  A('terrified', 'distress', 'In P, is a character panicking or screaming in terror?', null, 3, 3, 'emotional_distress'),
  A('sobbing_despair', 'distress', 'In P, is a character crying, pleading, or giving up hope?', 'A baby crying in the background is a no.', 3, 3, 'emotional_distress'),

  A('animal_cruelty', 'animals', 'In P, does a character deliberately hurt or mistreat an animal?', RETOLD, 3, 3, 'injury_pain'),
  A('animal_in_danger', 'animals', 'In P, is an animal trapped, hunted, hurt, or crying out in fear?', `${RETOLD} In a film where the characters are animals, answer only for animals that cannot speak.`, 3, 2, 'peril_chase'),

  A('dangerous_act', 'copyable', 'In P, does a child do something dangerous that an adult has just told them not to do, or take a dangerous dare?', null, 3, 2, 'imitable_risk'),
  A('runs_away', 'copyable', 'In P, does a child run away from home or go off with a stranger?', null, 3, 2, 'imitable_risk'),
  A('funny_violence', 'copyable', 'In P, does a character hurt someone in a way that is played for laughs and that a child could copy?', null, 3, 2, 'imitable_risk'),
];

// Asked once per beat; they change how the attributes above are read, in code.
export const MODIFIERS = {
  recounting: 'In P, is a character telling others about events that happened earlier?',
  imagined: 'In P, is the frightening thing only imagined, dreamed, or pretended by a character?',
  joking: 'Is the exchange in P played as a joke?',
  child_victim: 'In P, is the character in danger or in distress a child?',
  animal_victim: 'In P, is the character in danger or in distress an animal or a pet?',
  everyday_setting: 'Do the events in P take place somewhere ordinary, such as a home, a bedroom, or a school?',
  could_really_happen: 'Could the danger in P happen in real life, without magic or imaginary creatures?',
  reassured: 'In P, is a frightened or hurt character comforted, rescued, or told that they are safe?',
};

export const THREAT_LEVELS = ['Nobody is in any danger.', 'A danger is talked about or hinted at but is not present.', 'A character is in real danger but not harmed: chased, cornered, or trapped.', 'A character is attacked, seriously hurt, swallowed, or appears to die.'];
export const DISTRESS_LEVELS = ['Characters are calm, joking, or happy.', 'A character is worried, annoyed, or sad but composed.', 'A character is frightened, crying, or pleading.', 'A character is screaming in terror or grieving a death.'];

// Present-event attributes that a retelling or a dream cancels.
export const CANCELLED_WHEN_RETOLD = new Set(ATTRIBUTES.filter((a) => ['peril', 'violence', 'captivity', 'injury', 'animals'].includes(a.group) || ['monster_threatens', 'phobia_animals', 'child_taken', 'child_lost'].includes(a.id)).map((a) => a.id));
