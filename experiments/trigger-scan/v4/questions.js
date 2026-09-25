// Taxonomy v4 — the Jev question set for SCENE-level units.
//
// Unit: one scene from out/<slug>.segments.json (Sonnet splits the whole film into all its scenes and
// writes a neutral summary). Jev classifies EVERY scene; code (select.js) picks tags and flags.
// Jev writes no text.
//
// State per request (see stateFor):
//   { film: {title, year}, cast: [...], scene: {id, setting, summary, lines: ['L01| ...']} }
//
// What changed from taxonomy-v3.js, and why (docs.typesafe.ai, read 2026-09-24; AUDIT.md):
//   1. PRESENCE is asked twice per item, once against `scene.lines` (dialogue + SDH sound captions)
//      and once against `scene.summary` (may include what is SEEN, from the segmenter's film
//      knowledge). Same noun, different state path, so every tag carries its evidence source.
//      57% of Sonnet's current presence tags come from film knowledge, not lines; this makes that
//      split visible per tag instead of hidden.
//   2. MENTION is a separate one-condition Noul ("do the characters talk about X in the lines?").
//      v3 asked "talked about WHILE NOT there" — two conditions in one Noul (Noul page: "Ask one
//      yes/no question per Noul ... ask two Nouls and combine them in code"). select.js derives
//      "mentioned only" = mention high AND both presence channels low.
//   3. EVENTS: one condition each, present tense ("in this scene"). Every v3 bundle that joined two
//      propositions is split into separate ids that map back to the same v3 id (e.g. child_lost ->
//      child_separated + parent_searching; bullying -> mocked + excluded; sobbing_despair -> crying +
//      despair; injured -> injured + unconscious; transformation -> transforms + possessed). Victims
//      and agents are named by relationship ("a child", "their parent") and `cast` in state says who
//      is a child, a parent, a talking animal or an animal, instead of the question presupposing that
//      someone is in danger (v3's child_victim / animal_victim did).
//   4. A CHOICE for the kind of creature, with an explicit `none` and an `other_animal` option. The
//      documented pattern (cookbooks/classification_using_confidence): when the Choice's confidence
//      is below 0.9, report the parent level instead of the specific one. select.js uses it to gate
//      the specific creature tags (shark, large predator, monster) — the barracuda/pelican -> shark
//      error was Jev guessing "shark" for an unnamed sea creature.
//   5. SEVERITY is five single-dimension Scores whose levels are concrete situations (Score page:
//      "Describe situations, not degrees", "Keep each Score question to one dimension"). v3's sev57 /
//      sev810 bundled content type, duration and predicted reaction into one level. Per-age weights
//      live in thresholds.json (patterns/composite-scoring).
//   6. MODIFIERS (retold, imagined, comic, child in trouble) are Nouls about the whole scene; code
//      applies them (cancels event flags, scales severity). They never cancel presence: a monster in
//      a dream is still a monster on screen.
//
// Every presence/event item keeps `v3` (the taxonomy-v3 id it maps to) and `group` (one of the 13
// parent-facing groups), so output can be compared with the current database tags. New ids that
// have no v3 equivalent at all: none. `v2` is kept where the loader's TEMPORARY_V2_MAPPING asked
// for a v4 id of its own (loved_one_dies, pet_animal_dies).
//
// Question ids never reach the model (API page); everything the model needs is in the text.
//
// v4.0 -> v4.1 (after one run on the 6-scene Nemo fixture; literal-reading fixes, jaggedness #1):
//   pet_dies       "a pet or an animal that cannot talk" fired 0.72 on Coral (a talking clownfish):
//                  Jev read "animal" literally. Now "a pet" only.
//   scary_appearance fired 0.90 on classmates asking about Nemo's small fin ("disfigured"). Now
//                  "frightened or disgusted by how somebody looks", with a small-difference no-case.
//   jump_scare     fired 0.86/0.93 on "(GASPS)" captions (news, a comic gasp). Now "something
//                  frightening suddenly appears or happens"; a gasp at news or a joke is a no.
//   parent_searching fired 0.78 on a parent calling a child who was playing nearby. No-case added.
//   large_predator my v4.0 excluded fish, which left the barracuda with no presence item at all
//                  (Sonnet's presence pass calls it large_predator). Predatory fish now included;
//                  sharks stay separate; kindGate accepts other_fish.
// v4.1 -> v4.2: m.large_predator fired 0.97 on the opening scene, which names no predator (also
//                  0.97 with a lines-only state, so not leakage). Mention questions now carry the
//                  item's `def` like presence does, and large_predator has a mention no-case.
// v4.2 -> v4.3: the v4.2 fix did not work (0.97 -> 0.83), so the diagnosis was wrong. The real cause:
//                  cue 20 says the kids will "see a whale", and Jev counts a whale as a large
//                  predatory animal (its kind Choice picks `whale` for that scene too). Whales and
//                  dolphins are now an explicit no for large_predator.
// Six scenes are not evidence of accuracy; these fixes remove misreadings, they are not tuning.

import { GROUPS, BY_ID as V3 } from '../taxonomy-v3.js';

export const VERSION = 'v4.3';
export const MODEL = 'jev-1.13.0';

// ---------------------------------------------------------------------------------------------
// Shared criteria (repeated once per question, so kept short: question text is billed).
// ---------------------------------------------------------------------------------------------

export const PL_YES = 'The lines show it is there now: a character sees it, speaks to it, touches it, or reacts to it, or a sound caption describes it. Friendly, comic, imagined and dangerous ones all count.';
export const PL_NO = 'The lines only talk about it (remember it, warn about it, plan for it, compare something to it), or do not show it at all.';
export const PS_YES = 'The summary says it is there in the scene: seen, met, heard, or acted on. Friendly, comic, imagined and dangerous ones all count.';
export const PS_NO = 'The summary only has characters talk about it, or does not describe it.';
export const M_YES = 'A line names it or clearly refers to it, whether or not it is there.';
export const M_NO = 'No line refers to it.';
export const RETOLD = 'A character telling about something that happened earlier or elsewhere, or that might happen, is a no.';

// ---------------------------------------------------------------------------------------------
// PRESENCE — "is <noun> in this scene?" One noun per item.
// def:     appended to the yes-criterion (what counts as this thing)
// noExtra: appended to the no-criterion (boundary cases found in v3's hand check)
// mentionNo: appended to the mention no-criterion
// kindGate: Choice options that agree with this item (select.js gates the tag on the Choice)
// weights: 1-3 per age band, copied from v3 where the id exists (ATTRIBUTES-RESEARCH.md)
// ---------------------------------------------------------------------------------------------

const P = (id, v3, group, label, noun, w57, w810, extra = {}) => ({
  id, v3, group, label, noun, weights: { '5-7': w57, '8-10': w810 },
  mention: extra.mention !== false, textBlind: extra.textBlind ?? false, ...extra,
});

export const PRESENCE = [
  // --- creatures and figures
  P('monster_creature', 'monster_creature', 'creatures_figures', 'Monster', 'a monster', 3, 1, {
    def: 'A monster here is a frightening creature that is not an ordinary animal and not a person.',
    noExtra: 'An ordinary animal (a fish, bird, insect, or mammal) is a no, even if it is dangerous or talks. A robot or machine is a no.',
    kindGate: ['monster'],
  }),
  P('ghost_spirit', 'ghost_spirit', 'creatures_figures', 'Ghost', 'a ghost or spirit', 3, 2, {
    def: 'This includes the spirit of someone who has died.',
    noExtra: 'A character shouting "boo", or a character named Boo, is a no.',
    mentionNo: 'A character named Boo, or someone shouting "boo", is a no.',
  }),
  P('reanimated_dead', 'reanimated_dead', 'creatures_figures', 'Undead', 'a dead person or animal brought back to life', 3, 2),
  P('skeleton_bones', 'skeleton_corpse', 'creatures_figures', 'Skeleton', 'a skeleton or bones', 3, 2, { textBlind: true }),
  P('dead_body', 'skeleton_corpse', 'creatures_figures', 'Dead body', 'the dead body of a person or animal', 3, 2, {
    noExtra: 'Someone asleep, unconscious, or pretending to be dead is a no.',
  }),
  P('shark', 'shark', 'creatures_figures', 'Shark', 'a shark', 3, 2, {
    noExtra: 'A different animal (a barracuda, an eel, an anglerfish, a whale, a bird, a big cat) is a no. The word "shark" inside a name or nickname is a no.',
    mentionNo: 'The word "shark" inside a name or nickname is a no.',
    kindGate: ['shark'],
  }),
  P('spider_insect', 'spider_insect', 'creatures_figures', 'Spider or insect', 'a spider or insect', 3, 2, { textBlind: true }),
  P('snake_reptile', 'snake_reptile', 'creatures_figures', 'Snake', 'a snake or lizard', 3, 2, { textBlind: true }),
  P('large_predator', 'large_predator', 'creatures_figures', 'Big predator', 'a large predatory animal', 3, 2, {
    def: 'Such as a wolf, a lion, a hyena, a bear, a big cat, a crocodile, an eagle, or a predatory fish such as a barracuda or an anglerfish.',
    noExtra: 'A shark is a no here (it has its own question). A whale or dolphin is a no. Small or harmless animals are a no.',
    mentionNo: 'A shark is a no here. A whale or dolphin is a no. Ordinary fish, pets, and small animals are a no.',
    kindGate: ['big_cat_hyena', 'wolf_dog', 'bear', 'reptile', 'bird', 'other_fish'],
  }),
  P('rodent_bat', 'rodent_bat', 'creatures_figures', 'Rats or bats', 'a rat, mouse or bat', 2, 1, { textBlind: true }),
  P('clown', 'clown_doll_puppet', 'creatures_figures', 'Clown', 'a clown', 3, 2, { textBlind: true, noExtra: 'A clownfish is a no.', mentionNo: 'A clownfish is a no.' }),
  P('doll_puppet', 'clown_doll_puppet', 'creatures_figures', 'Doll or puppet', 'a doll, puppet or mannequin', 3, 2, { textBlind: true }),
  P('mask', 'clown_doll_puppet', 'creatures_figures', 'Mask', 'a mask worn over a face', 3, 2, { textBlind: true, mention: false }),
  P('robot_machine_being', 'robot_machine_being', 'creatures_figures', 'Robot', 'a robot or a machine that acts like a living thing', 2, 1),
  P('witch_sorcerer', 'witch_magic_villain', 'creatures_figures', 'Witch or sorcerer', 'a witch, wizard or sorcerer', 3, 1),
  P('dark_magic', 'witch_magic_villain', 'creatures_figures', 'Dark magic', 'frightening magic or a curse', 3, 1),
  P('alien', 'alien', 'creatures_figures', 'Alien', 'an alien from outer space', 3, 1, {
    noExtra: 'A person, an animal, or any being that belongs to the world the story is set in is a no, even if others call it a thing.',
  }),
  P('scary_appearance', 'scary_appearance', 'creatures_figures', 'Scary looks', null, 3, 1, {
    mention: false,
    textBlind: true,
    pl: 'Do `scene.lines` show characters frightened or disgusted by how somebody looks?',
    ps: 'Does `scene.summary` describe somebody whose appearance is frightening or grotesque?',
    noExtra: 'A small difference in body, such as a short fin, a scar, or a limp, is a no.',
  }),

  // --- objects, places and hazards
  P('gun', 'gun', 'objects_hazards', 'Gun', 'a gun', 2, 3),
  P('blade_weapon', 'blade_weapon', 'objects_hazards', 'Knife or sword', 'a knife, sword, axe, spear or other bladed weapon', 2, 3),
  P('fire', 'fire', 'objects_hazards', 'Fire', 'fire', 3, 3, { noExtra: 'A person being "fired" from a job, or "fire away", is a no.', mentionNo: 'A person being "fired" from a job, or "fire away", is a no.' }),
  P('explosion', 'explosion', 'objects_hazards', 'Explosion', 'an explosion', 3, 3),
  P('storm', 'storm_lightning', 'objects_hazards', 'Storm', 'a storm', 3, 2, { def: 'Thunder, lightning, a gale, or a tornado.' }),
  P('deep_dark_water', 'deep_dark_water', 'objects_hazards', 'Deep water', 'deep or open water a character could sink or drown in', 2, 2, { textBlind: true, mention: false }),
  P('heights', 'heights', 'objects_hazards', 'Heights', 'a dangerous height', 3, 2, { def: 'A cliff, a ledge, a rooftop, or a long drop.', textBlind: true }),
  P('darkness', 'darkness', 'objects_hazards', 'Darkness', null, 3, 1, {
    mention: false,
    pl: 'Do `scene.lines` show that it is dark where the characters are, so they cannot see well?',
    ps: 'Does `scene.summary` say that it is dark where the characters are, so they cannot see well?',
  }),
  P('needle_medical', 'needle_medical', 'objects_hazards', 'Needles', "a needle, injection, or dentist's or surgeon's instrument", 2, 2, {
    noExtra: 'Tools or machines not being used on a patient are a no.',
  }),
  P('medical_care', 'hospital_illness', 'objects_hazards', 'Doctors or hospital', 'a doctor, nurse or vet treating a patient', 2, 3, { def: 'A hospital ward counts.' }),
  P('seriously_ill', 'hospital_illness', 'objects_hazards', 'Serious illness', 'a seriously ill person or animal', 2, 3),
  P('blood_wound', 'blood_wound', 'objects_hazards', 'Blood', 'blood or an open wound', 2, 3, { textBlind: true }),
  P('vehicle_crash', 'vehicle_crash', 'objects_hazards', 'Crashing vehicle', 'a vehicle that is crashing or out of control', 2, 3, { mention: false }),
  P('cage_net_trap', 'cage_net_trap', 'objects_hazards', 'Cage, net or trap', 'a cage, net or trap', 2, 2, {
    noExtra: 'A fish tank or aquarium that characters live in is a no.',
  }),
  P('restraints', 'cage_net_trap', 'objects_hazards', 'Tied up', 'ropes, chains or straps tying somebody up', 2, 2, { mention: false, textBlind: true }),
  P('graveyard_funeral', 'graveyard_funeral', 'objects_hazards', 'Graveyard or funeral', 'a graveyard, grave, tomb or funeral', 3, 2),
  P('dangerous_machine', 'dangerous_machine', 'objects_hazards', 'Dangerous machinery', 'dangerous machinery or live electricity', 2, 2, {
    def: 'Blades, saws, gears, crushers, or high-voltage wires.',
    textBlind: true,
  }),
];

// ---------------------------------------------------------------------------------------------
// EVENTS — what happens to characters in this scene. One condition each.
// cancel: which scene-level modifiers cancel this event's flag in code (never its raw answer).
// ---------------------------------------------------------------------------------------------

const PHYSICAL = { retold: true, imagined: true };
const E = (id, v3, group, label, q, no, w57, w810, extra = {}) => ({
  id, v3, group, label, q, no, weights: { '5-7': w57, '8-10': w810 }, cancel: extra.cancel ?? {}, ...extra,
});

export const EVENTS = [
  // peril
  E('chased', 'chased', 'peril', 'Chased', 'In `scene`, is a character chased or hunted?', RETOLD, 3, 3, { cancel: PHYSICAL }),
  E('attacked', 'attacked', 'peril', 'Attacked', 'In `scene`, does a character physically attack another character?', `${RETOLD} Playful roughhousing is a no.`, 3, 3, { cancel: { ...PHYSICAL, comic: true } }),
  E('falls', 'falling', 'peril', 'Falling', 'In `scene`, does a character fall from a dangerous height?', RETOLD, 3, 3, { cancel: PHYSICAL }),
  E('nearly_falls', 'falling', 'peril', 'Nearly falls', 'In `scene`, is a character slipping or hanging on at the edge of a dangerous drop?', RETOLD, 3, 3, { cancel: PHYSICAL }),
  E('cannot_breathe', 'drowning', 'peril', 'Cannot breathe', 'In `scene`, is a character unable to breathe, for example drowning, choking, or out of air?', RETOLD, 3, 3, { cancel: PHYSICAL }),
  E('caught_in_hazard', 'caught_in_hazard', 'peril', 'Caught in danger', 'In `scene`, is a character caught in a dangerous force or place, such as a fire, a flood, a strong current, a machine, or a collapsing building?', RETOLD, 3, 3, { cancel: PHYSICAL }),
  E('vehicle_accident', 'vehicle_accident', 'peril', 'Vehicle crash', 'In `scene`, does a vehicle crash?', RETOLD, 2, 3, { cancel: PHYSICAL }),
  // violence
  E('weapon_used', 'weapon_used', 'violence', 'Weapon used', 'In `scene`, is a weapon used against a character, such as fired, swung, or thrown at them?', RETOLD, 2, 3, { cancel: PHYSICAL }),
  E('battle', 'battle', 'violence', 'Battle', 'In `scene`, is there a fight or battle involving many characters at once?', RETOLD, 2, 3, { cancel: PHYSICAL }),
  // captivity
  E('captured', 'captured', 'captivity', 'Captured', 'In `scene`, is a character caught and taken or held against their will?', `${RETOLD} A character who already lives in a tank or cage and is not newly caught is a no.`, 2, 2, { cancel: PHYSICAL }),
  E('trapped', 'trapped_struggling', 'captivity', 'Trapped', 'In `scene`, is a character stuck somewhere they cannot get out of?', 'Characters calmly going about their day in a tank, a cage, or a home are a no.', 3, 2, { cancel: PHYSICAL }),
  E('swallowed', 'trapped_struggling', 'captivity', 'Swallowed', "In `scene`, is a character swallowed or held inside a creature's mouth?", RETOLD, 3, 2, { cancel: PHYSICAL }),
  // injury
  E('injured', 'injured', 'injury', 'Hurt', 'In `scene`, is a character physically hurt?', `${RETOLD} Harmless slapstick where nobody is really hurt is a no.`, 2, 3, { cancel: PHYSICAL }),
  E('unconscious', 'injured', 'injury', 'Knocked out', 'In `scene`, is a character knocked unconscious or lying still and unresponsive?', `${RETOLD} Sleeping, or pretending, is a no.`, 2, 3, { cancel: PHYSICAL }),
  // death & loss
  E('dies', 'dies', 'death', 'Someone dies', 'In `scene`, does a character die or get killed?', `${RETOLD} Pretending to be dead is a no.`, 3, 3, { cancel: PHYSICAL }),
  E('loved_one_dies', 'dies', 'death', 'A loved one dies', "In `scene`, does a character's family member or close friend die?", RETOLD, 3, 3, { cancel: PHYSICAL, v2: 'loved_one_dies' }),
  E('pet_dies', 'dies', 'death', 'A pet dies', 'In `scene`, does a pet die?', RETOLD, 3, 3, { cancel: PHYSICAL, v2: 'pet_animal_dies' }),
  E('believed_dead', 'believed_dead', 'death', 'Thought dead', 'In `scene`, does a character believe that someone close to them has just died?', '"I\'m dead" as a figure of speech is a no. Remembering a death from long ago is a no.', 3, 3),
  E('parent_death_learned', 'parent_death_learned', 'death', 'Loses a parent', 'In `scene`, does a child see or learn that their parent has died?', 'A parent who died long before the story is a no.', 3, 3),
  E('grieving', 'grieving', 'death', 'Grief', 'In `scene`, is a character grieving someone who has died?', null, 2, 3),
  // separation & family
  E('child_taken', 'child_taken', 'separation', 'Child taken', 'In `scene`, is a child taken away from their parent?', 'A parent telling others that their child was taken earlier is a no. A school drop-off is a no.', 3, 3, { cancel: { retold: true, imagined: true } }),
  E('child_separated', 'child_lost', 'separation', 'Child lost', 'In `scene`, is a child separated from their parent and unable to find them?', RETOLD, 3, 3, { cancel: { retold: true, imagined: true } }),
  E('parent_searching', 'child_lost', 'separation', 'Parent searching', 'In `scene`, is a parent searching for their missing child?', `${RETOLD} A parent calling a child who is nearby, playing, or in trouble for mischief is a no.`, 3, 3, { cancel: { retold: true } }),
  E('abandoned', 'abandoned', 'separation', 'Left behind', 'In `scene`, is a character left behind or sent away by someone they depend on?', 'An ordinary goodbye is a no.', 3, 3),
  E('family_in_danger', 'family_in_danger', 'separation', 'Family in danger', 'In `scene`, does a character see or learn that a member of their family is in danger?', null, 2, 3),
  E('parents_argue', 'parents_fighting', 'separation', 'Parents fighting', "In `scene`, do a child's parents argue angrily with each other?", null, 2, 2),
  // hostility
  E('rages_at_child', 'rages_at_child', 'hostility', 'Yelling at a child', 'In `scene`, does an adult yell at a child in anger?', 'Urgent or worried shouting without anger is a no.', 3, 2, { cancel: { comic: true } }),
  E('threatens_harm', 'threatens_harm', 'hostility', 'Threats', 'In `scene`, does a character threaten to hurt another character?', null, 2, 2, { cancel: { comic: true } }),
  // NOTE: mocked/excluded are deliberately NOT cancelled by the comic modifier (v3 cancelled
  // bullying). Mockery is often played for laughs in the film and still hurtful to the child it
  // targets; the false-criterion already excludes friendly teasing. AUDIT: Jev was weaker than
  // Sonnet on bullying, so we do not remove more of its recall.
  E('mocked', 'bullying', 'hostility', 'Mocked', 'In `scene`, is a character mocked or humiliated by others?', 'Friendly teasing between friends is a no.', 2, 3),
  E('excluded', 'bullying', 'hostility', 'Left out', 'In `scene`, is a character deliberately left out by others?', null, 2, 3),
  E('discrimination', 'discrimination', 'hostility', 'Prejudice', 'In `scene`, is a character insulted or treated badly because of their race, body, disability, or where they come from?', null, 1, 3),
  E('caregiver_cruelty', 'caregiver_cruelty', 'hostility', 'Cruel caregiver', 'In `scene`, is a parent or caregiver cruel to a child in their care?', null, 3, 3),
  E('betrayal', 'betrayal', 'hostility', 'Betrayal', 'In `scene`, does an adult whom a child trusts trick or turn against that child?', null, 2, 2),
  // eerie & startle
  E('transforms', 'transformation', 'eerie', 'Transformation', 'In `scene`, does a character change into something frightening?', null, 3, 2),
  E('possessed', 'transformation', 'eerie', 'Possessed', "In `scene`, is a character possessed or controlled against their will?", null, 3, 2),
  E('nightmare', 'nightmare', 'eerie', 'Nightmare', 'In `scene`, does a character have a nightmare or a frightening vision?', null, 2, 2),
  E('unseen_threat', 'unseen_threat', 'eerie', 'Something unseen', 'In `scene`, do characters sense that something they cannot see is near them or following them?', null, 3, 2, { cancel: { retold: true } }),
  E('jump_scare', 'jump_scare', 'eerie', 'Sudden startle', 'In `scene`, does something frightening suddenly appear or happen, making a character jump or scream?', 'A gasp of surprise at news, or at something funny, is a no.', 3, 2),
  // character distress
  E('terrified', 'terrified', 'distress', 'Terror', 'In `scene`, is a character terrified, panicking or screaming in fear?', null, 3, 3),
  E('crying', 'sobbing_despair', 'distress', 'Crying', 'In `scene`, is a character crying?', 'A baby crying in the background is a no.', 3, 3),
  E('despair', 'sobbing_despair', 'distress', 'Giving up hope', 'In `scene`, does a character give up hope?', null, 3, 3),
  // animals
  E('animal_cruelty', 'animal_cruelty', 'animals', 'Animal mistreated', 'In `scene`, does a character deliberately hurt or mistreat an animal?', RETOLD, 3, 3, { cancel: PHYSICAL }),
  E('animal_in_danger', 'animal_in_danger', 'animals', 'Animal in danger', 'In `scene`, is an animal that cannot talk in danger?', `${RETOLD} \`cast\` role "animal" marks animals that cannot talk; talking animals are a no.`, 3, 2, { cancel: PHYSICAL }),
  // copyable risk
  E('dangerous_act', 'dangerous_act', 'copyable', 'Risky stunt', 'In `scene`, does a child deliberately do something dangerous?', null, 3, 2),
  E('runs_away', 'runs_away', 'copyable', 'Runs away', 'In `scene`, does a child run away from home?', null, 3, 2),
  E('goes_with_stranger', 'runs_away', 'copyable', 'Goes with a stranger', 'In `scene`, does a child go off with a stranger?', null, 3, 2),
  // not cancelled by comic: being played for laughs is the point of this item
  E('slapstick', 'slapstick_violence', 'copyable', 'Slapstick', 'In `scene`, does a character get hit or hurt in a way that is played for laughs?', null, 3, 2),
];

// ---------------------------------------------------------------------------------------------
// MODIFIERS — scene-level Nouls applied in code.
// ---------------------------------------------------------------------------------------------

export const MODIFIERS = {
  retold: {
    label: 'Mostly retold',
    q: 'Is most of `scene` a character telling others about events that happened at another time or place?',
    no: 'A scene where the events happen in front of us is a no, even if someone also mentions the past.',
  },
  imagined: {
    label: 'Dream or pretend',
    q: 'Is `scene` a dream, a daydream, or a game of pretend rather than real events in the story?',
    no: null,
  },
  comic: {
    label: 'Played for laughs',
    q: 'Is `scene` played as comedy, with the characters clearly joking?',
    no: null,
  },
  child_in_trouble: {
    label: 'A child is in trouble',
    q: 'In `scene`, is a child in danger, hurt, lost, or frightened? `cast` says who is a child.',
    no: null,
  },
};

// ---------------------------------------------------------------------------------------------
// SEVERITY — single-dimension Scores; levels are situations. Weighted per age band in code.
// ---------------------------------------------------------------------------------------------

export const SCORES = {
  danger: {
    label: 'Physical danger',
    q: 'How much physical danger is any character in during `scene`?',
    levels: [
      'Nobody is in any danger.',
      'A danger is only talked about, remembered, or warned about; it is not here.',
      'A danger is close by, but nobody is caught or hurt: a predator nearby, a risky place, a near miss.',
      'A character is chased, cornered, trapped, or swept away by a danger.',
      'A character is attacked, badly hurt, or appears to be killed.',
    ],
  },
  harm: {
    label: 'How badly hurt',
    q: 'How badly is any character physically hurt during `scene`?',
    levels: [
      'Nobody is hurt.',
      'A small bump, sting, or tumble that is over at once.',
      'A character is hurt enough to cry out, limp, or need help.',
      'A character is badly hurt: bleeding, knocked unconscious, or unable to move.',
      'A character is killed.',
    ],
  },
  distress: {
    label: 'Character upset',
    q: 'How upset are the characters during `scene`?',
    levels: [
      'Calm, joking, or happy.',
      'Worried, annoyed, or a little sad, but composed.',
      'Frightened, crying, or pleading.',
      'Screaming in terror, or grieving a death.',
    ],
  },
  share: {
    label: 'How much of the scene',
    q: 'How much of `scene` is taken up by danger, fighting, or grief?',
    levels: [
      'None of it: nothing dangerous, violent, or sad happens.',
      'A brief moment in an otherwise calm scene.',
      'About half of the scene.',
      'Most or all of the scene.',
    ],
  },
  resolution: {
    label: 'How it ends',
    q: 'How does `scene` end for the characters who were in trouble?',
    levels: [
      'Nobody was in trouble in this scene.',
      'The trouble is over: they are safe and calm, or comforted, by the end.',
      'They are out of danger but still frightened or sad at the end.',
      'The trouble is not over: at the end they are still in danger, lost, or hurt.',
    ],
  },
};

// ---------------------------------------------------------------------------------------------
// CHOICE — kind of creature. Explicit none and other options; fallback to parent in code.
// ---------------------------------------------------------------------------------------------

export const KIND = {
  q: 'Which kind is the most dangerous-looking animal or creature that appears in `scene`?',
  options: {
    shark: 'A shark.',
    other_fish: 'A fish or sea creature that is not a shark or a whale, such as a barracuda, an eel, an anglerfish, a jellyfish, or a piranha.',
    whale: 'A whale or a dolphin.',
    bird: 'A bird, such as a pelican, a seagull, an eagle, or an owl.',
    big_cat_hyena: 'A lion, a tiger, a leopard, another big cat, or a hyena.',
    wolf_dog: 'A wolf, a fox, or a dog.',
    bear: 'A bear.',
    reptile: 'A snake, a lizard, or a crocodile.',
    spider_insect: 'A spider, an insect, or another bug.',
    rodent_bat: 'A rat, a mouse, or a bat.',
    other_animal: 'Another real-world animal that is not listed here.',
    monster: 'A monster or made-up creature that is not a real-world animal.',
    none: 'No animal or creature appears; only people, robots, or objects.',
  },
};

// ---------------------------------------------------------------------------------------------
// Building the questions
// ---------------------------------------------------------------------------------------------

const join = (...parts) => parts.filter(Boolean).join(' ');

/**
 * All questions for one scene, keyed `<channel>.<id>`:
 *   pl.<id> presence from lines · ps.<id> presence from summary · m.<id> mention in lines
 *   e.<id> event · mod.<id> modifier · s.<id> score · kind (Choice)
 * `channels` limits which ones are built (used by --layout split).
 */
export function buildQuestions({ channels = ['pl', 'ps', 'm', 'e', 'mod', 's', 'kind'] } = {}) {
  const want = new Set(channels);
  const q = {};
  for (const p of PRESENCE) {
    if (want.has('pl')) q[`pl.${p.id}`] = { type: 'noul', instructions: p.pl ?? `Do \`scene.lines\` show that ${p.noun} is in this scene?`, criteria: { true: join(PL_YES, p.def), false: join(PL_NO, p.noExtra) } };
    if (want.has('ps')) q[`ps.${p.id}`] = { type: 'noul', instructions: p.ps ?? `Does \`scene.summary\` say that ${p.noun} is in this scene?`, criteria: { true: join(PS_YES, p.def), false: join(PS_NO, p.noExtra) } };
    if (want.has('m') && p.mention) q[`m.${p.id}`] = { type: 'noul', instructions: `Do the characters talk about ${p.noun} in \`scene.lines\`?`, criteria: { true: join(M_YES, p.def), false: join(M_NO, p.mentionNo) } };
  }
  if (want.has('e')) for (const e of EVENTS) q[`e.${e.id}`] = { type: 'noul', instructions: e.q, ...(e.no ? { criteria: { false: e.no } } : {}) };
  if (want.has('mod')) for (const [id, m] of Object.entries(MODIFIERS)) q[`mod.${id}`] = { type: 'noul', instructions: m.q, ...(m.no ? { criteria: { false: m.no } } : {}) };
  if (want.has('s')) for (const [id, s] of Object.entries(SCORES)) q[`s.${id}`] = { type: 'score', instructions: s.q, criteria: s.levels };
  if (want.has('kind')) q.kind = { type: 'choice', instructions: KIND.q, criteria: KIND.options };
  return q;
}

export function questionCounts(questions = buildQuestions()) {
  const c = {};
  for (const k of Object.keys(questions)) {
    const ch = k.includes('.') ? k.slice(0, k.indexOf('.')) : k;
    c[ch] = (c[ch] ?? 0) + 1;
  }
  c.total = Object.keys(questions).length;
  return c;
}

// ---------------------------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------------------------

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const nameTokens = (name) => {
  const clean = name.replace(/^the\s+/i, '').trim();
  const toks = [clean, ...clean.split(/\s+/).filter((t) => t.length >= 3 && !/^(mr|mrs|ms|dr)\.?$/i.test(t))];
  return [...new Set(toks)];
};

/**
 * Cast members relevant to one scene: those whose name occurs in the summary or the lines, plus
 * whoever they are `related_to` (so "child of X" resolves). Falls back to the whole cast when
 * nobody matches. Jaggedness page: unrelated state is a distractor.
 */
export function castForScene(cast, summary, lineTexts) {
  const hay = `${summary}\n${lineTexts.join('\n')}`;
  const hit = (c) => nameTokens(c.name).some((t) => new RegExp(`\\b${escapeRe(t)}\\b`, 'i').test(hay));
  const picked = new Set(cast.filter(hit).map((c) => c.name));
  if (!picked.size) return cast;
  for (const c of cast) if (picked.has(c.name) && c.related_to) picked.add(c.related_to);
  return cast.filter((c) => picked.has(c.name));
}

/** Scene-local line ids (L01..) keep cue text; no timestamps (ablations: they changed nothing). */
export const linesFor = (cues) => cues.map((c, i) => `L${String(i + 1).padStart(2, '0')}| ${c.text}`);

export function stateFor({ film, cast, scene, cues, fullCast = false, include = ['summary', 'lines'] }) {
  const lines = linesFor(cues);
  const castUsed = fullCast ? cast : castForScene(cast, scene.summary ?? '', cues.map((c) => c.text));
  const s = { id: scene.id, setting: scene.setting };
  if (include.includes('summary')) s.summary = scene.summary;
  if (include.includes('lines')) s.lines = lines;
  return {
    state: {
      film: { title: film.title, year: film.year },
      cast: castUsed.map((c) => ({ name: c.name, role: c.role, ...(c.related_to ? { related_to: c.related_to } : {}), note: c.note })),
      scene: s,
    },
    castUsed: castUsed.map((c) => c.name),
  };
}

// ---------------------------------------------------------------------------------------------
// Self-check at import: every mapping must resolve. A typo here would silently break comparison.
// ---------------------------------------------------------------------------------------------

for (const item of [...PRESENCE, ...EVENTS]) {
  if (!V3[item.v3]) throw new Error(`questions.js: ${item.id} maps to unknown v3 id ${item.v3}`);
  if (!GROUPS[item.group]) throw new Error(`questions.js: ${item.id} has unknown group ${item.group}`);
  if (V3[item.v3].group !== item.group) throw new Error(`questions.js: ${item.id} group ${item.group} != v3 ${V3[item.v3].group}`);
}

export const ITEMS = Object.fromEntries([...PRESENCE.map((p) => [p.id, { ...p, layer: 'presence' }]), ...EVENTS.map((e) => [e.id, { ...e, layer: 'event' }])]);
export { GROUPS };
