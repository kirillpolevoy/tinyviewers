// Question set v6 — two layers of Jev questions per SCENE, and the states they are asked against.
//
// v6 changes (round-1 verified causes, lettered as in the round-2 brief):
//   (a) threats flag: e.threatens_harm now asks for a threat to KILL or HURT; a new e.plots_harm asks
//       whether someone plans or orders a killing or hurting (a villain's song about killing,
//       henchmen ordered to kill). Neither is cancelled by the comic or retold modifiers (policy).
//   (b) e.child_frightened: "is a child frightened or crying?" (the user's policy: flags without
//       physical danger). The child is identified from verified cast OR the lines / summary.
//   comic peril: e.comic_peril ("is a character put in danger in a way that is played for laughs?");
//       code turns physical events into
//       tags when it is on together with the laughs Score (select.js), so comic peril never flags.
//   (d) aliases: only verified aliases reach also_called, question wording and cast matching
//       (aliases.js); names are matched whole, never through common words.
//   (e) 'threatens' film questions are generated only for villain / threat dispositions; a 'changes'
//       arc or a frightening look alone gets a presence tag, never a threat question.
//   (f) ONE sound-caption rule (PL_YES / PL_NO): a caption counts when it names the thing; a sound
//       many things could make (a hum, a buzz, a beep, a clank) does not by itself. The contradictory
//       dangerous_machine exception is gone.
//   reanimated_dead: 'only thought to be dead' and waking up are a no (v5 fired on a reunion).
//
// Unit: one scene of out/<slug>.segments.json (segments v2 contract: every summary sentence and every
// cast/danger claim is cited and claim-checked). Jev classifies EVERY scene; select.js (pure code)
// picks tags, flags and severity. Jev writes no text.
//
// LAYER 1, UNIVERSAL — the same questions for every film. No test-film entity is named anywhere in
// this layer (test/questions.test.js scans every string against a deny list).
// LAYER 2, FILM-SPECIFIC — generated in code (filmItems) from the film's verified cast and dangers.
// Only claims that passed the claim check produce threat questions. Every generated item carries
// the universal group it maps back to.
//
// TWO REQUESTS PER SCENE (evidence-source fix, v4 verifier finding 9: the lines channel was
// contaminated by summary and cast notes sitting in the same state):
//   lines   state = { film: {title}, scene: {lines} }                      -> pl.*, m.*, fpl.*
//   context state = { film, cast (present or mentioned, verified fields only), dangers (verified),
//                     scene: {summary (verified sentences only), setting, lines} }
//                                                                           -> ps.*, e.*, mod.*, s.*, kind, fps.*, fe.*
//
// What changed from v4.3 and why (v4 verifier findings, numbered as in the round-1 brief):
//   (2) e.terrified bundled "terrified, panicking or screaming": split into e.afraid_for_safety (can
//       flag) and e.screams (a tag, never flags). Comic screams no longer read as fear.
//   (3) monster_creature: presence now means "a monster is there, friendly or not" (definition and
//       criteria agree); whether a creature threatens anyone is a separate event (e.creature_threat)
//       and the kind Choice. Cast notes no longer label anyone a monster: cast fields reach Jev only
//       when verified.
//   (4) e.parent_searching narrowed to searching IN this scene, and it never flags (select policy).
//   (5) pl.dangerous_machine: a sound caption alone is a no unless the lines show the machine acting
//       on a character.
//   (6) jump_scare was three conditions: now e.appears_suddenly and e.startled; code derives the
//       jump_scare tag from both (it never flags on its own).
//   (7) retold: the modifier is now one condition ("is a character telling about events at another
//       time or place") and code cancels physical events only when it is on AND the danger Score puts
//       most of its mass on "nobody in danger / danger only talked about". imagined: one condition.
//   (8) mod.comic was a degree asked as a Noul: now s.laughs, a Score over how much of the scene is
//       jokes. Resolution: no presupposition ("the characters who were in trouble") and no
//       not-applicable level. The severity content term is capped in policy.json.
//   (9) evidence-source fix: see the two requests above.
//  (10) Kind Choice: "Which kind of animal or creature threatens or attacks a character?" with an
//       explicit 'none' option, not "the most dangerous-looking".
//  (13) species and names that came from the test films (clownfish, barracuda, anglerfish, a short
//       fin, a fish tank, a character named Boo, whale-specific no-cases) are gone; the criteria use
//       general classes instead.
//   (1) and (11) are code: the narrow flag policy lives in policy.json / select.js, the moment finder
//       in moments.js.
//
// Question ids never reach the model; everything it needs is in the text.

import { GROUPS, BY_ID as V3 } from '../taxonomy-v3.js';
import { usableAliases, mentionOf } from './aliases.js';

export const VERSION = 'v6.0';
export const MODEL = 'jev-1.13.0';

// ---------------------------------------------------------------------------------------------
// Shared criteria (repeated once per question, so short: question text is billed).
// ---------------------------------------------------------------------------------------------

// (f) one caption rule for every presence item on the lines channel
export const PL_YES = 'The lines show it is there now: a character sees it, speaks to it, touches it, or reacts to it, or a sound caption names it. Friendly, funny, imagined and dangerous ones all count.';
export const PL_NO = 'The lines only talk about it (remember it, warn about it, plan for it, compare something to it), or do not show it at all. A sound caption of a noise that many things could make (a hum, a buzz, a beep, a click, a clank) is a no unless the lines show what made it.';
export const PS_YES = 'The summary says it is there in the scene: seen, met, heard, or acted on. Friendly, funny, imagined and dangerous ones all count.';
export const PS_NO = 'The summary only has characters talk about it, or does not describe it.';
export const M_YES = 'A line names it or clearly refers to it, whether or not it is there.';
export const M_NO = 'No line refers to it.';
export const RETOLD = 'A character telling about something that happened earlier or elsewhere, or that might happen, is a no.';

// ---------------------------------------------------------------------------------------------
// PRESENCE — "is <noun> in this scene?" One noun per item, asked on two channels.
//   creature: presence of a creature; select.js flags it only when a creature threatens (policy)
//   kindGate: kind-Choice options that agree with this item (shark / large_predator only)
// ---------------------------------------------------------------------------------------------

const P = (id, v3, group, label, noun, w57, w810, extra = {}) => ({
  id, v3, group, label, noun, weights: { '5-7': w57, '8-10': w810 },
  mention: extra.mention !== false, textBlind: extra.textBlind ?? false, ...extra,
});

export const PRESENCE = [
  // --- creatures and figures
  P('monster_creature', 'monster_creature', 'creatures_figures', 'Monster', 'a monster', 3, 1, {
    creature: true,
    def: 'A monster here is a made-up creature that is not a real-world animal, not a person, and not a robot. Friendly, funny and frightening monsters all count.',
    noExtra: 'A real-world animal is a no, even if it is big, dangerous, or talks.',
    moment: 'a monster is there',
  }),
  P('ghost_spirit', 'ghost_spirit', 'creatures_figures', 'Ghost', 'a ghost or spirit', 3, 2, {
    def: 'This includes the spirit of someone who has died.',
    noExtra: 'A name, nickname, or exclamation that only sounds like a ghost word is a no. Someone in a costume pretending to be a ghost is a no.',
    mentionNo: 'A name, nickname, or exclamation that only sounds like a ghost word is a no.',
    moment: 'a ghost or spirit is there',
  }),
  P('reanimated_dead', 'reanimated_dead', 'creatures_figures', 'Undead', 'a dead person or animal brought back to life', 3, 2, {
    noExtra: 'A character who was only thought to be dead, or who wakes up or recovers, is a no.',
    moment: 'a dead person or animal is brought back to life',
  }),
  P('skeleton_bones', 'skeleton_corpse', 'creatures_figures', 'Skeleton', 'a skeleton or bones', 3, 2, { textBlind: true, moment: 'a skeleton or bones are seen' }),
  P('dead_body', 'skeleton_corpse', 'creatures_figures', 'Dead body', 'the dead body of a person or animal', 3, 2, {
    noExtra: 'Someone asleep, unconscious, or pretending to be dead is a no.',
    moment: 'the dead body of a person or animal is seen',
  }),
  P('shark', 'shark', 'creatures_figures', 'Shark', 'a shark', 3, 2, {
    creature: true,
    noExtra: 'A different kind of fish or sea animal is a no. The word "shark" inside a name or nickname is a no.',
    mentionNo: 'The word "shark" inside a name or nickname is a no.',
    kindGate: ['shark'],
    moment: 'a shark is there',
  }),
  P('spider_insect', 'spider_insect', 'creatures_figures', 'Spider or insect', 'a spider or insect', 3, 2, { textBlind: true, creature: true, moment: 'a spider or insect is there' }),
  P('snake_reptile', 'snake_reptile', 'creatures_figures', 'Snake', 'a snake or lizard', 3, 2, { textBlind: true, creature: true, moment: 'a snake or lizard is there' }),
  P('large_predator', 'large_predator', 'creatures_figures', 'Big predator', 'a large predatory animal', 3, 2, {
    creature: true,
    def: 'A wild animal that hunts other animals and is big enough to hurt a person, such as a big cat, a wolf, a bear, a crocodile, a large bird of prey, or a large hunting fish.',
    noExtra: 'A shark is a no here (it has its own question). A large animal that does not hunt, a pet, or a small animal is a no.',
    mentionNo: 'A shark is a no here. A large animal that does not hunt, a pet, or a small animal is a no.',
    kindGate: ['land_predator', 'reptile', 'bird', 'other_fish'],
    moment: 'a large predatory animal is there',
  }),
  P('rodent_bat', 'rodent_bat', 'creatures_figures', 'Rats or bats', 'a rat, mouse or bat', 2, 1, { textBlind: true, creature: true, moment: 'a rat, mouse or bat is there' }),
  P('clown', 'clown_doll_puppet', 'creatures_figures', 'Clown', 'a clown', 3, 2, {
    textBlind: true,
    noExtra: 'An animal or a name that only contains the word "clown" is a no.',
    mentionNo: 'An animal or a name that only contains the word "clown" is a no.',
    moment: 'a clown is there',
  }),
  P('doll_puppet', 'clown_doll_puppet', 'creatures_figures', 'Doll or puppet', 'a doll, puppet or mannequin', 3, 2, { textBlind: true, moment: 'a doll, puppet or mannequin is there' }),
  P('mask', 'clown_doll_puppet', 'creatures_figures', 'Mask', 'a mask worn over a face', 3, 2, { textBlind: true, mention: false, moment: 'someone wears a mask over their face' }),
  P('robot_machine_being', 'robot_machine_being', 'creatures_figures', 'Robot', 'a robot or a machine that acts like a living thing', 2, 1, { moment: 'a robot is there' }),
  P('witch_sorcerer', 'witch_magic_villain', 'creatures_figures', 'Witch or sorcerer', 'a witch, wizard or sorcerer', 3, 1, { moment: 'a witch, wizard or sorcerer is there' }),
  P('dark_magic', 'witch_magic_villain', 'creatures_figures', 'Dark magic', 'frightening magic or a curse', 3, 1, { moment: 'frightening magic or a curse is used' }),
  P('alien', 'alien', 'creatures_figures', 'Alien', 'an alien from outer space', 3, 1, {
    noExtra: 'A person, an animal, or any being that belongs to the world the story is set in is a no, even if others call it a thing.',
    moment: 'an alien is there',
  }),
  P('scary_appearance', 'scary_appearance', 'creatures_figures', 'Scary looks', null, 3, 1, {
    mention: false,
    textBlind: true,
    pl: 'Do `scene.lines` show characters frightened or disgusted by how somebody looks?',
    ps: 'Does `scene.summary` describe somebody whose appearance is frightening or grotesque?',
    noExtra: "A small difference in someone's body, or a limp, is a no.",
    moment: 'somebody with a frightening or grotesque appearance is seen',
  }),

  // --- objects, places and hazards
  P('gun', 'gun', 'objects_hazards', 'Gun', 'a gun', 2, 3, { moment: 'a gun is there' }),
  P('blade_weapon', 'blade_weapon', 'objects_hazards', 'Knife or sword', 'a knife, sword, axe, spear or other bladed weapon', 2, 3, { moment: 'a bladed weapon is there' }),
  P('fire', 'fire', 'objects_hazards', 'Fire', 'fire', 3, 3, {
    hazard: true,
    noExtra: 'A person being "fired" from a job, or "fire away", is a no.',
    mentionNo: 'A person being "fired" from a job, or "fire away", is a no.',
    moment: 'a fire is burning',
  }),
  P('explosion', 'explosion', 'objects_hazards', 'Explosion', 'an explosion', 3, 3, { hazard: true, moment: 'an explosion happens' }),
  P('storm', 'storm_lightning', 'objects_hazards', 'Storm', 'a storm', 3, 2, { hazard: true, def: 'Thunder, lightning, a gale, a blizzard, or a tornado.', moment: 'a storm is raging' }),
  P('deep_dark_water', 'deep_dark_water', 'objects_hazards', 'Deep water', 'deep or open water a character could sink or drown in', 2, 2, { textBlind: true, mention: false, hazard: true, moment: 'a character is in deep water' }),
  P('heights', 'heights', 'objects_hazards', 'Heights', 'a dangerous height', 3, 2, { def: 'A cliff, a ledge, a rooftop, or a long drop.', textBlind: true, hazard: true, moment: 'a character is at a dangerous height' }),
  P('darkness', 'darkness', 'objects_hazards', 'Darkness', null, 3, 1, {
    mention: false,
    // one condition (v4 bundled "dark" with "so they cannot see well")
    pl: 'Do `scene.lines` show that it is dark where the characters are?',
    ps: 'Does `scene.summary` say that it is dark where the characters are?',
    moment: 'it is dark where the characters are',
  }),
  P('needle_medical', 'needle_medical', 'objects_hazards', 'Needles', "a needle, an injection, or a medical or dental instrument", 2, 2, {
    noExtra: 'Tools or machines not being used on a patient are a no.',
    moment: 'a needle or medical instrument is used',
  }),
  P('medical_care', 'hospital_illness', 'objects_hazards', 'Doctors or hospital', 'a doctor, nurse or vet treating a patient', 2, 3, { def: 'A hospital ward counts.', moment: 'a patient is treated' }),
  P('seriously_ill', 'hospital_illness', 'objects_hazards', 'Serious illness', 'a seriously ill person or animal', 2, 3, { moment: 'a seriously ill person or animal is seen' }),
  P('blood_wound', 'blood_wound', 'objects_hazards', 'Blood', 'blood or an open wound', 2, 3, { textBlind: true, moment: 'blood or an open wound is seen' }),
  P('vehicle_crash', 'vehicle_crash', 'objects_hazards', 'Crashing vehicle', 'a vehicle that is crashing or out of control', 2, 3, { mention: false, hazard: true, moment: 'a vehicle crashes or goes out of control' }),
  P('cage_net_trap', 'cage_net_trap', 'objects_hazards', 'Cage, net or trap', 'a cage, net or trap', 2, 2, {
    noExtra: 'A home or enclosure where characters normally live and are cared for is a no.',
    moment: 'a cage, net or trap is there',
  }),
  P('restraints', 'cage_net_trap', 'objects_hazards', 'Tied up', 'ropes, chains or straps tying somebody up', 2, 2, { mention: false, textBlind: true, moment: 'somebody is tied up' }),
  P('graveyard_funeral', 'graveyard_funeral', 'objects_hazards', 'Graveyard or funeral', 'a graveyard, grave, tomb or funeral', 3, 2, { moment: 'a graveyard, grave or funeral is seen' }),
  P('dangerous_machine', 'dangerous_machine', 'objects_hazards', 'Dangerous machinery', 'dangerous machinery or live electricity', 2, 2, {
    hazard: true,
    // v6 (f): the caption rule lives in PL_YES / PL_NO for every item; the definition says what is dangerous
    def: 'Machinery or live electricity that could hurt a character: blades, saws, gears, crushers, or high-voltage wires.',
    noExtra: 'Ordinary lights, doors, appliances, and vehicles are a no.',
    moment: 'dangerous machinery or live electricity acts on a character',
  }),
];

// ---------------------------------------------------------------------------------------------
// EVENTS — what happens to characters in this scene. One condition each.
//   cancel: which modifiers cancel this event's flag in code (never its raw answer)
//   moment: clause used by moments.js ("the moment when <moment>")
// ---------------------------------------------------------------------------------------------

// Physical events: cancelled (made tags) by a retelling, a dream or pretend game, or comic peril.
const PHYSICAL = { retold: true, imagined: true, comic_peril: true };
// Death, loss and separation are not undone by jokes around them: comic peril does not cancel them.
const LOSS = { retold: true, imagined: true };
const E = (id, v3, group, label, q, no, w57, w810, extra = {}) => ({
  id, v3, group, label, q, no, weights: { '5-7': w57, '8-10': w810 }, cancel: extra.cancel ?? {}, ...extra,
});

export const EVENTS = [
  // peril
  E('chased', 'chased', 'peril', 'Chased', 'In `scene`, is a character chased or hunted?', `${RETOLD} A playful chase in a game is a no.`, 3, 3, { cancel: PHYSICAL, moment: 'a character is chased or hunted' }),
  E('attacked', 'attacked', 'peril', 'Attacked', 'In `scene`, does a character physically attack another character?', `${RETOLD} Playful roughhousing is a no.`, 3, 3, { cancel: PHYSICAL, moment: 'a character physically attacks another character' }),
  E('falls', 'falling', 'peril', 'Falling', 'In `scene`, does a character fall from a dangerous height?', RETOLD, 3, 3, { cancel: PHYSICAL, moment: 'a character falls from a dangerous height' }),
  E('nearly_falls', 'falling', 'peril', 'Nearly falls', 'In `scene`, is a character hanging on at the edge of a dangerous drop?', RETOLD, 3, 3, { cancel: PHYSICAL, moment: 'a character hangs on at the edge of a dangerous drop' }),
  E('cannot_breathe', 'drowning', 'peril', 'Cannot breathe', 'In `scene`, is a character unable to breathe, for example drowning, choking, or out of air?', RETOLD, 3, 3, { cancel: PHYSICAL, moment: 'a character cannot breathe' }),
  E('caught_in_hazard', 'caught_in_hazard', 'peril', 'Caught in danger', 'In `scene`, is a character caught in a dangerous force or place, such as a fire, a flood, fast water, a storm, a machine, or a collapsing building?', RETOLD, 3, 3, { cancel: PHYSICAL, moment: 'a character is caught in a dangerous force or place' }),
  E('vehicle_accident', 'vehicle_accident', 'peril', 'Vehicle crash', 'In `scene`, does a vehicle crash?', RETOLD, 2, 3, { cancel: PHYSICAL, moment: 'a vehicle crashes' }),
  E('child_in_danger', 'family_in_danger', 'peril', 'Child in danger', 'In `scene`, is a child in physical danger?', `${RETOLD} \`cast\` says who is a child.`, 3, 2, { cancel: PHYSICAL, moment: 'a child is in physical danger' }),
  E('creature_threat', 'attacked', 'peril', 'Creature threatens', 'In `scene`, does an animal or creature threaten or attack a character?', `${RETOLD} Scaring someone as a job, a prank, or a game is a no. People and machines are a no here.`, 3, 2, { cancel: PHYSICAL, moment: 'an animal or creature threatens or attacks a character' }),
  // violence
  E('weapon_used', 'weapon_used', 'violence', 'Weapon used', 'In `scene`, is a weapon used against a character, such as fired, swung, or thrown at them?', RETOLD, 2, 3, { cancel: PHYSICAL, moment: 'a weapon is used against a character' }),
  E('battle', 'battle', 'violence', 'Battle', 'In `scene`, is there a fight involving many characters at once?', RETOLD, 2, 3, { cancel: PHYSICAL, moment: 'many characters fight at once' }),
  // captivity
  E('captured', 'captured', 'captivity', 'Captured', 'In `scene`, is a character caught and held against their will?', `${RETOLD} A character who already lives in a home or enclosure and is not newly caught is a no.`, 2, 2, { cancel: PHYSICAL, moment: 'a character is caught and held against their will' }),
  E('trapped', 'trapped_struggling', 'captivity', 'Trapped', 'In `scene`, is a character stuck somewhere they cannot get out of?', 'Characters calmly going about their day in a home or enclosure are a no.', 3, 2, { cancel: PHYSICAL, moment: 'a character is stuck somewhere they cannot get out of' }),
  E('swallowed', 'trapped_struggling', 'captivity', 'Swallowed', "In `scene`, is a character swallowed or held inside a creature's mouth?", RETOLD, 3, 2, { cancel: PHYSICAL, moment: "a character is swallowed or held inside a creature's mouth" }),
  // injury
  E('injured', 'injured', 'injury', 'Hurt', 'In `scene`, is a character physically hurt?', `${RETOLD} Harmless slapstick where nobody is really hurt is a no.`, 2, 3, { cancel: PHYSICAL, moment: 'a character is physically hurt' }),
  E('badly_hurt', 'injured', 'injury', 'Badly hurt', 'In `scene`, is a character badly hurt, for example bleeding, knocked out, or unable to move?', `${RETOLD} Sleeping, pretending, or a bump that is over at once is a no.`, 3, 3, { cancel: PHYSICAL, moment: 'a character is badly hurt' }),
  // death & loss
  E('dies', 'dies', 'death', 'Someone dies', 'In `scene`, does a character die or get killed?', `${RETOLD} Pretending to be dead is a no.`, 3, 3, { cancel: LOSS, moment: 'a character dies or is killed' }),
  E('loved_one_dies', 'dies', 'death', 'A loved one dies', "In `scene`, does a character's family member or close friend die?", RETOLD, 3, 3, { cancel: LOSS, v2: 'loved_one_dies', moment: "a character's family member or close friend dies" }),
  E('pet_dies', 'dies', 'death', 'A pet dies', 'In `scene`, does a pet die?', RETOLD, 3, 3, { cancel: LOSS, v2: 'pet_animal_dies', moment: 'a pet dies' }),
  E('believed_dead', 'believed_dead', 'death', 'Thought dead', 'In `scene`, does a character believe that someone close to them has just died?', '"I\'m dead" as a figure of speech is a no. Remembering a death from long ago is a no.', 3, 3, { moment: 'a character believes someone close to them has just died' }),
  E('parent_death_learned', 'parent_death_learned', 'death', 'Loses a parent', 'In `scene`, does a child see or learn that their parent has died?', 'A parent who died long before the story is a no.', 3, 3, { moment: 'a child learns that their parent has died' }),
  E('grieving', 'grieving', 'death', 'Grief', 'In `scene`, is a character grieving someone who has died?', null, 2, 3, { moment: 'a character grieves someone who has died' }),
  // separation & family
  E('child_taken', 'child_taken', 'separation', 'Child taken', 'In `scene`, is a child taken away from their parent or carer?', 'A parent telling others that their child was taken earlier is a no. A school drop-off is a no.', 3, 3, { cancel: LOSS, moment: 'a child is taken away from their parent or carer' }),
  E('child_separated', 'child_lost', 'separation', 'Child lost', 'In `scene`, is a child separated from their parent or carer and unable to find them?', RETOLD, 3, 3, { cancel: LOSS, moment: 'a child is separated from their parent or carer' }),
  E('parent_searching', 'child_lost', 'separation', 'Parent searching', 'In `scene`, is a parent searching for their missing child?', `${RETOLD} A parent who is travelling, talking, or resting without searching in this scene is a no. A parent calling a child who is nearby is a no.`, 3, 3, { cancel: { retold: true }, moment: 'a parent searches for their missing child' }),
  E('abandoned', 'abandoned', 'separation', 'Left behind', 'In `scene`, is a character left behind or sent away by someone they depend on?', 'An ordinary goodbye is a no.', 3, 3, { moment: 'a character is left behind or sent away' }),
  E('family_in_danger', 'family_in_danger', 'separation', 'Family in danger', 'In `scene`, does a character learn that a member of their family is in danger?', null, 2, 3, { moment: 'a character learns that a family member is in danger' }),
  E('parents_argue', 'parents_fighting', 'separation', 'Parents fighting', "In `scene`, do a child's parents argue angrily with each other?", null, 2, 2, { moment: "a child's parents argue angrily" }),
  // hostility
  E('rages_at_child', 'rages_at_child', 'hostility', 'Yelling at a child', 'In `scene`, does an adult yell at a child in anger?', 'Urgent or worried shouting without anger is a no.', 3, 2, { cancel: { comic: true }, moment: 'an adult yells at a child in anger' }),
  // (a) user policy: an explicit threat to kill or hurt flags even with no physical action. Not cancelled
  // by comic (a comic villain's threat is still a threat) or by the scene-level retold modifier (the
  // question itself excludes retellings, so a threat spoken in the scene stands).
  E('threatens_harm', 'threatens_harm', 'hostility', 'Threat to kill or hurt', 'In `scene`, does a character threaten to kill or hurt another character?', 'A joke or figure of speech between friends, teasing, or a pretend threat in a game is a no. A warning about a danger is a no. A character telling about a threat made at another time is a no.', 3, 2, { cancel: { imagined: true }, moment: 'a character threatens to kill or hurt another character' }),
  E('plots_harm', 'threatens_harm', 'hostility', 'Plan or order to kill or hurt', 'In `scene`, does a character plan or order the killing or hurting of another character?', 'Planning a prank, a game, a trick, or an escape is a no. A character telling about a plan made at another time is a no.', 3, 2, { cancel: { imagined: true }, moment: 'a character plans or orders the killing or hurting of another character' }),
  E('mocked', 'bullying', 'hostility', 'Mocked', 'In `scene`, is a character mocked or humiliated by others?', 'Friendly teasing between friends is a no.', 2, 3, { moment: 'a character is mocked or humiliated' }),
  E('excluded', 'bullying', 'hostility', 'Left out', 'In `scene`, is a character deliberately left out by others?', null, 2, 3, { moment: 'a character is deliberately left out' }),
  E('discrimination', 'discrimination', 'hostility', 'Prejudice', 'In `scene`, is a character insulted or treated badly because of their race, body, disability, or where they come from?', null, 1, 3, { moment: 'a character is treated badly because of who they are' }),
  E('caregiver_cruelty', 'caregiver_cruelty', 'hostility', 'Cruel caregiver', 'In `scene`, is a parent or caregiver cruel to a child in their care?', null, 3, 3, { moment: 'a caregiver is cruel to a child' }),
  E('betrayal', 'betrayal', 'hostility', 'Betrayal', 'In `scene`, does an adult whom a child trusts turn against that child?', null, 2, 2, { moment: 'a trusted adult turns against a child' }),
  // eerie & startle
  E('transforms', 'transformation', 'eerie', 'Transformation', 'In `scene`, does a character change into something frightening?', null, 3, 2, { moment: 'a character changes into something frightening' }),
  E('possessed', 'transformation', 'eerie', 'Possessed', 'In `scene`, is a character controlled by someone else against their will?', null, 3, 2, { moment: 'a character is controlled against their will' }),
  E('nightmare', 'nightmare', 'eerie', 'Nightmare', 'In `scene`, does a character have a nightmare?', null, 2, 2, { moment: 'a character has a nightmare' }),
  E('unseen_threat', 'unseen_threat', 'eerie', 'Something unseen', 'In `scene`, do characters sense that something they cannot see is near them?', null, 3, 2, { cancel: { retold: true }, moment: 'characters sense something unseen near them' }),
  // v4 jump_scare bundled three conditions; select.js derives jump_scare from these two
  E('appears_suddenly', 'jump_scare', 'eerie', 'Sudden appearance', 'In `scene`, does a creature or thing appear suddenly and without warning in front of a character?', 'Someone arriving normally, or being expected, is a no.', 2, 1, { moment: 'something appears suddenly in front of a character' }),
  E('startled', 'jump_scare', 'eerie', 'Startled', 'In `scene`, is a character startled?', 'A gasp at news, or at a joke, is a no.', 2, 1, { moment: 'a character is startled' }),
  // character distress (v4 e.terrified split: only afraid_for_safety can flag)
  // (b) user policy: a child terrified or crying flags even with no physical danger. One question; the
  // child may be identified from verified cast (is_child) OR from the lines / summary.
  E('child_frightened', 'terrified', 'distress', 'Child frightened or crying', 'In `scene`, is a child frightened or crying?', 'A child laughing, playing, or pretending to be scared is a no. A grown-up who is frightened or crying is a no. A character telling about a time a child was frightened is a no.', 3, 3, {
    yes: 'A child is a young character: `cast` marks them as a child, or the lines or summary show they are young (called a kid, a baby, a son or daughter, a toddler, a cub, or similar). The child screams in fright, trembles, begs, sobs, or cries.',
    cancel: {},
    moment: 'a child is frightened or crying',
  }),
  E('afraid_for_safety', 'terrified', 'distress', 'Afraid for safety', "In `scene`, is a character afraid for their own safety or someone else's safety?", 'Being nervous about a social situation, a test, or getting into trouble is a no. Pretending to be afraid is a no.', 3, 3, { cancel: PHYSICAL, moment: 'a character is afraid for their own or someone else\'s safety' }),
  E('screams', 'terrified', 'distress', 'Screaming', 'In `scene`, does a character scream?', null, 2, 1, { moment: 'a character screams' }),
  E('crying', 'sobbing_despair', 'distress', 'Crying', 'In `scene`, is a character crying?', 'A baby crying in the background is a no.', 3, 3, { moment: 'a character cries' }),
  E('despair', 'sobbing_despair', 'distress', 'Giving up hope', 'In `scene`, does a character give up hope?', null, 3, 3, { moment: 'a character gives up hope' }),
  // animals
  E('animal_cruelty', 'animal_cruelty', 'animals', 'Animal mistreated', 'In `scene`, does a character deliberately hurt or mistreat an animal?', RETOLD, 3, 3, { cancel: LOSS, moment: 'a character deliberately hurts an animal' }),
  E('animal_in_danger', 'animal_in_danger', 'animals', 'Animal in danger', 'In `scene`, is an animal that does not talk in danger?', `${RETOLD} Characters who talk are a no.`, 3, 2, { cancel: PHYSICAL, moment: 'an animal that does not talk is in danger' }),
  // copyable risk
  E('dangerous_act', 'dangerous_act', 'copyable', 'Risky stunt', 'In `scene`, does a child deliberately do something dangerous?', null, 3, 2, { moment: 'a child deliberately does something dangerous' }),
  E('runs_away', 'runs_away', 'copyable', 'Runs away', 'In `scene`, does a child run away from home?', null, 3, 2, { moment: 'a child runs away from home' }),
  E('goes_with_stranger', 'runs_away', 'copyable', 'Goes with a stranger', 'In `scene`, does a child go off with a stranger?', null, 3, 2, { moment: 'a child goes off with a stranger' }),
  E('slapstick', 'slapstick_violence', 'copyable', 'Slapstick', 'In `scene`, does a character get hit or hurt in a way that is played for laughs?', null, 3, 2, { moment: 'a character is hit or hurt for laughs' }),
  // comic peril (user policy: tag only). select.js turns it into a modifier together with s.laughs.
  E('comic_peril', 'slapstick_violence', 'copyable', 'Comic peril', 'In `scene`, is a character put in danger in a way that is played for laughs?', 'Real danger that a character is frightened of is a no, even when there are jokes around it. A scene where nobody is in danger is a no.', 2, 1, { moment: 'a character is put in danger in a way that is played for laughs' }),
];

// Derived in code, never asked (select.js): jump_scare = min(appears_suddenly, startled).
export const DERIVED = {
  jump_scare: { id: 'jump_scare', v3: 'jump_scare', group: 'eerie', label: 'Sudden startle', from: ['appears_suddenly', 'startled'], weights: { '5-7': 3, '8-10': 2 }, moment: 'something frightening appears suddenly' },
};

// ---------------------------------------------------------------------------------------------
// MODIFIERS — scene-level Nouls applied in code. One condition each.
// ---------------------------------------------------------------------------------------------

export const MODIFIERS = {
  retold: {
    label: 'Told as a story',
    q: 'In `scene`, is a character telling others about events that happened at another time or place?',
    no: 'Characters talking about what is happening in front of them right now is a no.',
  },
  imagined: {
    label: 'Dream or pretend',
    q: 'Are the events of `scene` a dream, a daydream, or a game of pretend?',
    no: null,
  },
};

// ---------------------------------------------------------------------------------------------
// SEVERITY and TONE — single-dimension Scores; levels are situations. Weighted per age band in code.
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
      'Frightened for their safety, crying, or pleading.',
      'Terrified for their life, or grieving a death.',
    ],
  },
  share: {
    label: 'How much of the scene',
    q: 'How much of `scene` is taken up by danger, fighting, or grief?',
    levels: [
      'None of the scene: nothing dangerous, violent, or sad happens.',
      'A brief moment in an otherwise calm scene.',
      'About half of the scene.',
      'Most or all of the scene.',
    ],
  },
  // v4 finding 8: no presupposition, no not-applicable level. A calm scene is simply level 0.
  resolution: {
    label: 'How it ends',
    q: 'How safe are the characters at the end of `scene`?',
    levels: [
      'Everyone is safe and calm at the end.',
      'Everyone is out of danger at the end, but someone is still frightened, sad, or worried.',
      'At the end someone is still in danger, trapped, lost, or hurt.',
    ],
  },
  // v4 mod.comic was a degree asked as a yes/no; it is a Score now and never part of severity's base.
  laughs: {
    label: 'Played for laughs',
    q: 'How much of `scene` is jokes, gags, or clowning around?',
    levels: [
      'None of the scene is jokes or clowning around.',
      'A joke or two in an otherwise serious or ordinary scene.',
      'About half of the scene is jokes or gags.',
      'Nearly all of the scene is jokes, gags, or clowning around.',
    ],
  },
};

// ---------------------------------------------------------------------------------------------
// CHOICE — which kind of creature threatens. Explicit none. v4 asked for "the most dangerous-looking".
// ---------------------------------------------------------------------------------------------

export const KIND = {
  q: 'Which kind of animal or creature threatens or attacks a character in `scene`?',
  options: {
    none: 'No animal or creature threatens or attacks anyone in this scene; nobody does, or only people, robots, or machines do.',
    shark: 'A shark.',
    other_fish: 'A fish or another sea creature that is not a shark and not a sea mammal.',
    sea_mammal: 'A sea mammal, such as a dolphin or a seal.',
    bird: 'A bird.',
    land_predator: 'A large wild land animal that hunts, such as a big cat, a wolf, or a bear.',
    reptile: 'A snake, a lizard, or a crocodile.',
    spider_insect: 'A spider, an insect, or another bug.',
    rodent_bat: 'A rat, a mouse, or a bat.',
    other_animal: 'Another real-world animal not listed here, such as a pet or a farm animal.',
    monster: 'A monster or another made-up creature that is not a real-world animal.',
  },
};

// ---------------------------------------------------------------------------------------------
// FILM-SPECIFIC LAYER — generated from the verified cast and dangers of one film.
// ---------------------------------------------------------------------------------------------

export const FILM_CAP = 40;
export const ACCEPT_CONFIDENCE = 0.8; // legacy fallback only (a check with no status and no probabilities)

/**
 * Was this claim verified by the claim check? check-claims.js writes a `status` computed with the
 * policy's claim_accept rule (v6: p(supports) >= 0.70 and p(contradicts) < 0.15, calibrated in
 * calibrate-claims.js). Accepted shapes: { status: 'verified' }, { accepted: true }; a legacy check
 * with neither falls back to verdict 'supports' at confidence >= ACCEPT_CONFIDENCE.
 */
export function verified(check, minConfidence = ACCEPT_CONFIDENCE) {
  if (!check || typeof check !== 'object') return false;
  if (check.accepted === true || check.status === 'verified') return true;
  if (check.accepted === false || check.status) return false;
  return check.verdict === 'supports' && Number(check.confidence) >= minConfidence;
}

/**
 * A cast/danger field's verified value, or 'unknown'. `check` may be per field
 * (check.disposition = {verdict, confidence, status}) or one check for the whole entity.
 */
export function verifiedField(entity, field, minConfidence = ACCEPT_CONFIDENCE) {
  const v = entity?.[field];
  if (v === undefined || v === null || v === 'unknown') return 'unknown';
  const c = entity.check?.[field] ?? (entity.check && ('verdict' in entity.check || 'accepted' in entity.check || 'status' in entity.check) ? entity.check : null);
  return verified(c, minConfidence) ? v : 'unknown';
}

/** Summary sentences that passed the check (the contract's `summary`, recomputed so nothing unverified leaks). */
export function verifiedSentences(scene, minConfidence = ACCEPT_CONFIDENCE) {
  if (!Array.isArray(scene.sentences)) return [];
  // judgement-word sentences are kept out of the contract's summary (check-claims applyChecks); same here
  return scene.sentences.filter((s) => verified(s.check, minConfidence) && !s.judgement_words?.length).map((s) => s.text);
}

/**
 * The scene setting Jev may see: only when its own claim check verified it (setting_check), else
 * 'unknown'. Segments without a setting_check (hand-made fixtures) keep their setting.
 */
export function verifiedSetting(scene) {
  if (!scene.setting || scene.setting === 'unknown') return 'unknown';
  if (!('setting_check' in scene)) return scene.setting_cites?.length === 0 ? 'unknown' : scene.setting;
  return verified(scene.setting_check) ? scene.setting : 'unknown';
}

/** Is the character's existence (the `name` claim) verified? Rows with no name check (fixtures) pass. */
export const nameVerified = (c) => !c.check || !('name' in c.check) || verified(c.check.name);

/** Verified aliases that may be shown and matched (aliases.js rules + a verified claim check). */
export const castAliases = (c) => usableAliases(c, verified);

/**
 * The disposition note Jev may see. v6 checks the note as its own claim (check.note); a legacy check
 * (no check.note) bundled note and disposition, so the note stands when the disposition does.
 */
function verifiedNote(c) {
  if (!c.disposition_note || verifiedField(c, 'disposition') === 'unknown') return null;
  if (c.check && 'note' in c.check) return verified(c.check.note) ? c.disposition_note : null;
  return c.disposition_note;
}

/** The cast row Jev sees: only verified field values; everything else 'unknown'. */
export function castView(c) {
  const aliases = castAliases(c);
  const note = verifiedNote(c);
  return {
    name: c.name,
    ...(aliases.length ? { also_called: aliases } : {}),
    kind: verifiedField(c, 'kind'),
    is_child: verifiedField(c, 'is_child'),
    looks_frightening: verifiedField(c, 'looks_frightening'),
    disposition: verifiedField(c, 'disposition'),
    ...(note ? { note } : {}),
  };
}

/** A danger Jev sees: its name when the danger claim is verified; the note only when its own check is. */
export function dangerView(d) {
  const noteOk = d.note && ('note_check' in d ? verified(d.note_check) : true);
  return { name: d.name, kind: d.kind, ...(noteOk ? { note: d.note } : {}) };
}

const nameList = (c) => {
  const extra = castAliases(c).filter((a) => a.toLowerCase() !== c.name.toLowerCase());
  return extra.length ? `${c.name} (also called ${extra.slice(0, 3).join(', ')})` : c.name;
};

const presenceGroup = (c) => (c.group && c.group !== 'none' && GROUPS[c.group] ? c.group : ['creature', 'animal', 'robot'].includes(verifiedField(c, 'kind')) ? 'creatures_figures' : 'hostility');
const dangerGroup = (d) => (d.group && d.group !== 'none' && GROUPS[d.group] ? d.group : d.kind === 'creature_group' ? 'creatures_figures' : d.kind === 'situation' ? 'peril' : 'objects_hazards');

// Cancel sets of the generated items. A villain's threat is never cancelled by retold or comic
// (user policy (1)); a dream or pretend game still cancels it. A child's or a danger's peril is
// physical: retold, imagined and comic peril cancel it.
export const FILM_CANCEL = {
  threatens: { imagined: true },
  child_in_danger: { retold: true, imagined: true, comic_peril: true },
  danger: { retold: true, imagined: true, comic_peril: true },
};

/**
 * Film-specific items from the verified cast and dangers, most important first, capped at `cap`
 * QUESTIONS (a presence item costs two questions: lines and summary channels).
 *
 * Who gets what (only verified claims count; 'unknown' and unverified values get nothing):
 *   villain or threat disposition           -> presence (2) + threatens (1)
 *   is_child true                           -> presence (2) + in danger (1)
 *   each verified danger                    -> used on / endangers (1)
 *   looks_frightening true (anyone else)    -> presence (2) only: a look is a tag, not a threat
 * A 'changes' or 'ally' arc generates nothing by itself (round-1 (e): 'Gill threatens someone').
 * Order: villains, threats, children, dangers, frightening-looking others. Characters whose name
 * claim is not verified get nothing.
 */
export function filmItems(seg, { cap = FILM_CAP } = {}) {
  const buckets = { villain: [], threat: [], child: [], danger: [], frightening: [] };
  for (const [ci, c0] of (seg.cast ?? []).entries()) {
    const c = c0.id ? c0 : { ...c0, id: `C${String(ci + 1).padStart(2, '0')}` }; // contract ids are C01..; tolerate a missing one
    if (!nameVerified(c)) continue;
    const disp = verifiedField(c, 'disposition');
    const child = verifiedField(c, 'is_child') === true;
    const scary = verifiedField(c, 'looks_frightening') === true;
    const who = nameList(c);
    const presence = { entity: c.id, name: c.name, type: 'presence', group: presenceGroup(c), label: c.name, who };
    if (disp === 'villain' || disp === 'threat') {
      buckets[disp].push([
        { ...presence, id: `${c.id}_present`, why: disp },
        { entity: c.id, name: c.name, id: `${c.id}_threatens`, type: 'threatens', why: disp, group: 'hostility', v3: 'threatens_harm', label: `${c.name} threatens someone`, who, weights: { '5-7': 3, '8-10': 3 }, cancel: FILM_CANCEL.threatens, moment: `${c.name} threatens, chases, or attacks someone` },
      ]);
    } else if (scary && !child) {
      buckets.frightening.push([{ ...presence, id: `${c.id}_present`, why: 'frightening' }]);
    }
    if (child) {
      buckets.child.push([
        { ...presence, id: `${c.id}_present`, why: 'child' },
        { entity: c.id, name: c.name, id: `${c.id}_in_danger`, type: 'child_in_danger', why: 'child', group: 'peril', v3: 'family_in_danger', label: `${c.name} in danger`, who, weights: { '5-7': 3, '8-10': 2 }, cancel: FILM_CANCEL.child_in_danger, moment: `${c.name} is in danger` },
      ]);
    }
  }
  for (const [di, d0] of (seg.dangers ?? []).entries()) {
    const d = d0.id ? d0 : { ...d0, id: `D${String(di + 1).padStart(2, '0')}` };
    if (!verified(d.check)) continue;
    buckets.danger.push([{ entity: d.id, name: d.name, id: `${d.id}_endangers`, type: 'danger', why: 'danger', danger_kind: d.kind, group: dangerGroup(d), v3: d.kind === 'machine' ? 'dangerous_machine' : 'caught_in_hazard', label: `${d.name} endangers someone`, who: d.name, weights: { '5-7': 3, '8-10': 3 }, cancel: FILM_CANCEL.danger, moment: `${d.name} is used on, or endangers, a character` }]);
  }
  const items = [];
  const seen = new Set();
  let questions = 0;
  for (const key of ['villain', 'threat', 'child', 'danger', 'frightening']) {
    for (const group of buckets[key]) {
      const fresh = group.filter((it) => !seen.has(it.id));
      const cost = fresh.reduce((n, it) => n + (it.type === 'presence' ? 2 : 1), 0);
      if (!fresh.length || questions + cost > cap) continue;
      for (const it of fresh) { items.push(it); seen.add(it.id); }
      questions += cost;
    }
  }
  return items;
}

/** Jev questions for the film-specific items. Keys: fpl.<id> (lines request), fps.<id> and fe.<id> (context request). */
export function filmQuestions(items, { channels = ['fpl', 'fps', 'fe'] } = {}) {
  const want = new Set(channels);
  const q = {};
  for (const it of items) {
    if (it.type === 'presence') {
      if (want.has('fpl')) q[`fpl.${it.id}`] = { type: 'noul', instructions: `Do \`scene.lines\` show that ${it.who} is in this scene?`, criteria: { true: `The lines show ${it.name} is there now: ${it.name} speaks, is spoken to, or is seen or heard by others.`, false: `The lines only talk about ${it.name}, or do not show ${it.name} at all.` } };
      if (want.has('fps')) q[`fps.${it.id}`] = { type: 'noul', instructions: `Does \`scene.summary\` say that ${it.who} is in this scene?`, criteria: { true: `The summary says ${it.name} is there: seen, met, heard, or acting.`, false: `The summary only has characters talk about ${it.name}, or does not mention ${it.name}.` } };
    } else if (want.has('fe')) {
      const instructions = it.type === 'threatens' ? `In \`scene\`, does ${it.who} threaten, chase, or attack someone?`
        : it.type === 'child_in_danger' ? `In \`scene\`, is ${it.who} in danger?`
          : `In \`scene\`, is ${it.who} used on a character, or does it put a character in danger?`;
      q[`fe.${it.id}`] = { type: 'noul', instructions, criteria: { false: RETOLD } };
    }
  }
  return q;
}

// ---------------------------------------------------------------------------------------------
// Building the universal questions
// ---------------------------------------------------------------------------------------------

const join = (...parts) => parts.filter(Boolean).join(' ');

/** Channels of the two requests. */
export const LINES_CHANNELS = ['pl', 'm', 'fpl'];
export const CONTEXT_CHANNELS = ['ps', 'e', 'mod', 's', 'kind', 'fps', 'fe'];

/**
 * Universal questions keyed `<channel>.<id>`:
 *   pl.<id> presence from lines · ps.<id> presence from summary · m.<id> mention in lines
 *   e.<id> event · mod.<id> modifier · s.<id> score · kind (Choice)
 */
export function buildQuestions({ channels = ['pl', 'ps', 'm', 'e', 'mod', 's', 'kind'] } = {}) {
  const want = new Set(channels);
  const q = {};
  for (const p of PRESENCE) {
    if (want.has('pl')) q[`pl.${p.id}`] = { type: 'noul', instructions: p.pl ?? `Do \`scene.lines\` show that ${p.noun} is in this scene?`, criteria: { true: join(PL_YES, p.def), false: join(PL_NO, p.noExtra, p.plNoExtra) } };
    if (want.has('ps')) q[`ps.${p.id}`] = { type: 'noul', instructions: p.ps ?? `Does \`scene.summary\` say that ${p.noun} is in this scene?`, criteria: { true: join(PS_YES, p.def), false: join(PS_NO, p.noExtra) } };
    if (want.has('m') && p.mention) q[`m.${p.id}`] = { type: 'noul', instructions: `Do the characters talk about ${p.noun} in \`scene.lines\`?`, criteria: { true: join(M_YES, p.def), false: join(M_NO, p.mentionNo) } };
  }
  if (want.has('e')) for (const e of EVENTS) q[`e.${e.id}`] = { type: 'noul', instructions: e.q, ...(e.no || e.yes ? { criteria: { ...(e.yes ? { true: e.yes } : {}), ...(e.no ? { false: e.no } : {}) } } : {}) };
  if (want.has('mod')) for (const [id, m] of Object.entries(MODIFIERS)) q[`mod.${id}`] = { type: 'noul', instructions: m.q, ...(m.no ? { criteria: { false: m.no } } : {}) };
  if (want.has('s')) for (const [id, s] of Object.entries(SCORES)) q[`s.${id}`] = { type: 'score', instructions: s.q, criteria: s.levels };
  if (want.has('kind')) q.kind = { type: 'choice', instructions: KIND.q, criteria: KIND.options };
  return q;
}

/** Counts per channel, and universal vs generated. */
export function questionCounts(questions) {
  const c = {};
  for (const k of Object.keys(questions)) {
    const ch = k.includes('.') ? k.slice(0, k.indexOf('.')) : k;
    c[ch] = (c[ch] ?? 0) + 1;
  }
  c.generated = (c.fpl ?? 0) + (c.fps ?? 0) + (c.fe ?? 0);
  c.universal = Object.keys(questions).length - c.generated;
  c.total = Object.keys(questions).length;
  return c;
}

// ---------------------------------------------------------------------------------------------
// States
// ---------------------------------------------------------------------------------------------

/**
 * Cast members mentioned in the scene's verified summary or its lines (aliases.js: whole names,
 * whole verified aliases, proper single tokens of the name; never common words). Members whose
 * name claim is not verified are left out. Empty when none.
 */
export function castForScene(cast, summary, lineTexts) {
  const hay = `${summary}\n${lineTexts.join('\n')}`;
  return (cast ?? []).filter((c) => nameVerified(c) && mentionOf(c, hay, castAliases(c)));
}

/** Numbered lines with the contract's global ids (L + 1-based cue index). No timestamps. */
export const linesFor = (cues) => cues.map((c) => `L${c.index}| ${c.text}`);

/** The lines request's state: ONLY the film title and the lines. */
export function linesState({ film, cues }) {
  return { film: { title: film.title }, scene: { lines: linesFor(cues) } };
}

/** The context request's state. Unverified sentences and unverified cast fields never reach it. */
export function contextState({ seg, scene, cues }) {
  const sentences = verifiedSentences(scene);
  const summary = sentences.join(' ');
  const lines = linesFor(cues);
  const cast = castForScene(seg.cast, summary, cues.map((c) => c.text));
  const dangers = (seg.dangers ?? []).filter((d) => verified(d.check));
  const state = {
    film: { title: seg.film.title, year: seg.film.year },
    cast: cast.map(castView),
    ...(dangers.length ? { dangers: dangers.map(dangerView) } : {}),
    scene: { setting: verifiedSetting(scene), summary, lines },
  };
  return { state, castUsed: cast.map((c) => c.id ?? c.name), summaryEmpty: !summary };
}

// ---------------------------------------------------------------------------------------------
// Self-check at import: every mapping must resolve.
// ---------------------------------------------------------------------------------------------

for (const item of [...PRESENCE, ...EVENTS, ...Object.values(DERIVED)]) {
  if (!V3[item.v3]) throw new Error(`questions.js: ${item.id} maps to unknown v3 id ${item.v3}`);
  if (!GROUPS[item.group]) throw new Error(`questions.js: ${item.id} has unknown group ${item.group}`);
  if (!item.moment) throw new Error(`questions.js: ${item.id} has no moment clause`);
}

export const ITEMS = Object.fromEntries([
  ...PRESENCE.map((p) => [p.id, { ...p, layer: 'presence' }]),
  ...EVENTS.map((e) => [e.id, { ...e, layer: 'event' }]),
  ...Object.values(DERIVED).map((d) => [d.id, { ...d, layer: 'derived' }]),
]);
export { GROUPS };
