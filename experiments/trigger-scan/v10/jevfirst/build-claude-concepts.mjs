// Builds v10/jevfirst/claude-concepts.json: JEV-FIRST phrasings for every concept of the v9 question set
// (v9/questions.js PRESENCE + mention + EVENTS + derived jump_scare + modifiers, film-specific templates,
// v9/sonnet-questions.js / split.json sonnet_asked). No model calls. Run: node build-claude-concepts.mjs
//
// Shared trap sentences are constants so every no-criterion Jev sees is written out literally.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PRESENCE, EVENTS, DERIVED, MODIFIERS } from '../../v9/questions.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const split = JSON.parse(fs.readFileSync(path.join(here, '../../v9/split.json'), 'utf8'));

// ---- shared trap no-cases (literal, checkable in the lines or summary) ----
const TOLD = 'Telling about it, remembering it, planning it, or warning that it might happen is a no.';
const SONG = 'A sung line that only describes it is a no.';
const GAME = 'A game, a race, a sport, practice, or pretend play is a no.';
const LAUGHOFF = 'A bump, fall, or hit that the characters laugh off or joke about in the next lines is a no.';
const FRIENDLY = 'A friendly or comic creature that talks, helps, plays, or sings with the characters is a no.';
const SETTING = 'Magic, spirits, or an afterlife that are only the world the story takes place in are a no.';
const FIGURE = 'A figure of speech is a no.';
const COUGH = 'A cough, sneeze, hiccup, gasp, or a choke on food that passes at once is a no.';
const TEASE = 'Teasing between friends that both laugh at right after is a no.';
const NOISE = 'A sound many things could make (a hum, a buzz, a clank, a thud) is a no unless the lines show what made it.';
const nameNo = (w) => `A name or nickname that only contains or sounds like ${w} (for example a character called Boo) is a no.`;
const j = (...s) => s.filter(Boolean).join(' ');

// flag_use vocabulary
const PHYS = 'flag (strong physical event, policy act 0.70); becomes a tag when the comic gate, the retold gate, or the imagined gate is on for the scene';
const LOSS = 'flag (loss event); comedy never cancels it, the imagined gate does; retellings are excluded inside the question';
const POL1 = 'flag (user policy 1: explicit villain threat); only the imagined gate cancels it, never comedy or songs';
const POL2 = 'flag (user policy 2: child terrified or crying); no gate cancels it except a pretend game named in the question';
const TAG = 'tag only (never flags alone)';

const C = [];
// c(id(s), concept text, group, flag_use, evidence, phrasings, sonnet_fallback)
function c(ids, concept, group, flag_use, evidence, phrasings, sonnet_fallback) {
  const idl = Array.isArray(ids) ? ids : [ids];
  C.push({ ids: idl, concept: `${idl.join(' + ')}: ${concept}`, group, flag_use, evidence, phrasings, sonnet_fallback });
}
// p(id, state, question, yes, no, combine)
const p = (id, state, question, yes_criteria, no_criteria, combine) => ({ id, state, question, yes_criteria, no_criteria, combine });

// =====================================================================================
// CREATURES AND FIGURES (presence)
// =====================================================================================
c('monster_creature', 'a monster (made-up creature) is in the scene', 'creatures_figures',
  `${TAG}; supplies creature identity to creature_threat (flag path) and the kind tag`,
  'Best presence question: HO 11/16 at 0.7 (69%), AUC 0.86 (highest of 93), recall 40%; r5 5 hit / 2 miss. Wording already fixed it once: v3a->v3b "not an ordinary animal and not a person" cut Nemo 24->0 and Wild Robot 57->0 (TAXONOMY-V3.md). Keep the v3b noun; add the afterlife and insult traps from r5.',
  [
    p('monster_creature.a', 'L', 'Do `scene.lines` show that a monster is in this scene?',
      'A made-up creature that is not a real-world animal, not a person, not a ghost, and not a robot speaks, is spoken to, or is seen or heard (a roar caption with "What is that thing?"). A dragon, an ogre, a demon, a giant crab, a lava monster count. Friendly, funny and frightening ones all count.',
      j('A real-world animal is a no, even if it is big, dangerous, or talks.', 'An insult such as "you little monster" is a no.', 'The skeleton people of an afterlife are a no.', TOLD, SONG),
      'OR: monster_creature = max(a, b).'),
    p('monster_creature.b', 'S', 'Does `scene.summary` say that a monster or a made-up creature is in this scene?',
      'The summary names a made-up creature that is there now: a dragon, an ogre, a demon, a giant crab, a lava monster, a sea monster. Friendly, funny and frightening ones all count.',
      j('A real-world animal is a no, even if it is big, dangerous, or talks.', 'A person in a costume or a mask is a no.', 'The skeleton people of an afterlife are a no.', 'A creature only talked about is a no.'),
      'OR with a.'),
  ],
  'Is a monster or other made-up creature (not a real animal, not a person) in this scene?');

c('ghost_spirit', 'a ghost or spirit appears or acts in the scene', 'creatures_figures',
  `${TAG} for b; c feeds the physical flag (it is a creature attack by a spirit) under the comic / retold / imagined gates`,
  'HO 8/32 at 0.7 (25%, least-reliable list), AUC 0.565: fires on afterlife SETTINGS (coco, book-of-life Land of the Remembered; r5 misses book-of-life S032, S033). But it also caught real moments: round-5 R29 "slithering ghosts carry a captive frog" (P&F S027) and R37 (book-of-life S035) were lost when it was cut (v9/narrow/out/rescore.log). Wording fixed it before: v3a->v3b name exclusion took the Boo misfires 7->0 while Mufasa stayed 3/3. So split presence into two single events: a spirit of the dead APPEARS to a living person (Mufasa, Gramma Tala S044), and spirits/shadows ATTACK or CARRY OFF someone.',
  [
    p('ghost_spirit.a', 'S', 'Does `scene.summary` say that the ghost or spirit of someone who died appears to a living character?',
      'The summary says a dead character\'s ghost or spirit appears, speaks to, or is seen by someone who is alive ("his father\'s spirit appears in the clouds", "Gramma Tala\'s spirit appears to comfort her").',
      j(SETTING, 'A dead character living as an ordinary resident of a land of the dead is a no.', nameNo('a ghost word'), 'Someone in a costume or a sheet is a no.', TOLD),
      'OR: ghost_spirit (tag) = max(a, b, c).'),
    p('ghost_spirit.b', 'L', 'Do `scene.lines` show a ghost or spirit being seen or heard in this scene?',
      'A character speaks to or reacts to a ghost or spirit that is there now ("It\'s a ghost!", "Father?" answered from the sky), or a sound caption names a ghost or spirit (GHOST WAILING).',
      j(SETTING, nameNo('a ghost word'), 'Shouting "Boo!" to startle someone is a no.', 'Someone in a costume is a no.', TOLD, SONG),
      'OR with a, c.'),
    p('ghost_spirit.c', 'S', 'Does `scene.summary` say that ghosts, spirits, shadows, or demons attack, grab, or carry off a character?',
      'The summary says spirits, shadow creatures, or demons attack, seize, drag, or carry off a character now ("Shadow demons attack the group", "ghosts carry off the frog").',
      j('Spirits that only talk, dance, help, or celebrate are a no.', SETTING, TOLD),
      'c also counts as creature_threat (physical flag, same gates).'),
  ],
  'Does a ghost or spirit appear to a living character, or frighten, attack, or carry off a character, in this scene (not spirits who are simply the people of an afterlife setting)?');

c('reanimated_dead', 'a dead person or animal is brought back to life', 'creatures_figures', TAG,
  'HO 0/1, dev 10/30 (33%), r5 0 hit / 2 miss (book-of-life S032 "Maria passed away... One snake bite merely put her in a trance... Alive", S043): the v9 noun fires on "only thought dead" and on the afterlife. Ask for the one event (someone who WAS dead is ALIVE again) in the summary, and the spoken form separately.',
  [
    p('reanimated_dead.a', 'S', 'Does `scene.summary` say that a character who had died is brought back to life in this scene?',
      'The summary says a dead person or animal comes back to life or is revived by science or magic now (a dead dog brought back with lightning, a corpse rising).',
      j('A character who was only thought to be dead, was in a trance, or wakes up is a no.', 'A dead character who lives on in an afterlife is a no.', 'A character who returns to a land of the living but was never dead is a no.', TOLD),
      'OR: reanimated_dead = max(a, b).'),
    p('reanimated_dead.b', 'L', 'Does a character in `scene.lines` say that someone who had died is alive again because they were brought back?',
      '"It\'s alive!", "You brought him back!", "He came back from the dead!" said about someone who had died.',
      j('"She\'s alive!" about someone who was only asleep, fainted, or in a trance is a no.', 'A reunion with someone thought lost is a no.', FIGURE, SONG),
      'OR with a.'),
  ],
  'Is a dead person or animal really brought back to life in this scene (not someone who was only thought dead)?');

c('skeleton_bones', 'a skeleton, skull, or bones are seen', 'creatures_figures', TAG,
  'Text-blind item: HO 1/2, r5 2 hit / 0 miss. Main trap: skeleton people are the SETTING of coco and book-of-life. Ask for loose bones / a skeleton as an object or a find.',
  [
    p('skeleton_bones.a', 'S', 'Does `scene.summary` say that a skeleton, a skull, or bones are found or seen in this scene?',
      'The summary says characters find, see, or touch bones, a skull, or a skeleton lying there, or a skeletal creature appears.',
      j('The skeleton people who are the ordinary characters of an afterlife are a no.', 'A Halloween costume or decoration is a no.', 'A bone given to a dog as food is a no.', TOLD),
      'OR: skeleton_bones = max(a, b).'),
    p('skeleton_bones.b', 'L', 'Do `scene.lines` show characters looking at a skeleton, a skull, or bones that are there?',
      '"Look, bones!", "Is that a skull?", a caption naming bones rattling next to a reaction.',
      j('"Bone-tired", "funny bone", "bone to pick" and other figures of speech are a no.', 'The skeleton people of an afterlife talking normally are a no.', TOLD, SONG),
      'OR with a.'),
  ],
  'Is a skeleton, a skull, or loose bones shown in this scene (not the skeleton people of an afterlife setting)?');

c('dead_body', 'the dead body of a person or animal is seen', 'creatures_figures',
  `${TAG}; also feeds dies (a body described = a death seen)`,
  'HO 0 fires, AUC 0.725; dev 6/14 (43%); Sonnet v3 40%. The TypeSafe decomposition example itself: death = "says someone died" OR "a body is described" OR "stops moving and others react". A character who LOOKS dead to the others (book-of-life S028 "Maria appears dead") is what upsets a child, so it counts; a game of playing dead does not.',
  [
    p('dead_body.a', 'S', 'Does `scene.summary` say that a character lies dead, appears dead, or that someone finds a body?',
      'The summary says a person or animal lies dead, is found dead, appears dead to the others, or characters stand over a body.',
      j('Someone asleep, resting, or knocked out who the others know is alive is a no.', 'Pretending to be dead in a game or a trick is a no.', 'A dead character living in an afterlife is a no.', TOLD),
      'OR: dead_body = max(a, b); dies uses it as one of its OR terms.'),
    p('dead_body.b', 'L', 'Do `scene.lines` show characters reacting to a body lying in front of them that does not move?',
      '"He\'s not breathing", "Is she dead?", "Wake up! Please wake up!" with no answer, "Dad? Get up."',
      j('A character who wakes up and answers in the next lines is a no.', 'Playing dead as a trick or a game is a no.', FIGURE, TOLD),
      'OR with a.'),
  ],
  'Is the dead body of a person or animal (or a character who appears dead to the others) shown in this scene?');

c('shark', 'a shark is there', 'creatures_figures', `${TAG}; kind Choice veto kept (a confident other kind moves the tag to animal_creature)`,
  'HO 0 fires; dev 4/6. v6 removed test-film species; the name trap ("shark" in a nickname) stays.',
  [
    p('shark.a', 'L', 'Do `scene.lines` show that a shark is in this scene?',
      'A character sees, speaks to, or flees a shark that is there now, or a caption names it.',
      j('A different kind of fish or sea animal is a no.', nameNo('"shark"'), '"Card shark" and "loan shark" are a no.', TOLD, SONG),
      'OR: shark = max(a, b), then the kind Choice veto.'),
    p('shark.b', 'S', 'Does `scene.summary` say that a shark is in this scene?',
      'The summary names a shark that is there now, friendly or not.',
      j('A different kind of fish or sea animal is a no.', 'A shark only talked about is a no.'),
      'OR with a.'),
  ],
  'Is a shark in this scene?');

c('spider_insect', 'a spider (or a swarm of stinging insects) is there', 'creatures_figures', TAG,
  'HO 0/1, dev 0/5, r5 0 hit / 1 miss (P&F S024: the friendly firefly Ray, p 0.84 on the lines). "Spider or insect" bundles a phobia object with every friendly insect character. Split: a spider (the phobia tag), and a swarm or stinging insects (the only insect case parents flag).',
  [
    p('spider_insect.a', 'S', 'Does `scene.summary` say that a spider is in this scene?',
      'The summary names a spider that is there now, friendly or not.',
      j('Any other bug is a no.', 'A spider only talked about is a no.'),
      'spider tag = a. insect_swarm tag = b. spider_insect (v9 id) = max(a, b).'),
    p('spider_insect.b', 'LS', 'In `scene`, does a swarm of bees, wasps, ants, or other stinging insects surround or attack a character?',
      'The lines or summary show many stinging insects on or around a character now (a BUZZING caption with "Bees! Run!", "They\'re stinging me!").',
      j('A single friendly insect character (a firefly, a cricket, a ladybug) is a no.', NOISE, TOLD, SONG),
      'b at act also counts as creature_threat.'),
  ],
  'Is a spider, or a swarm of stinging insects, in this scene?');

c('snake_reptile', 'a snake is there', 'creatures_figures', TAG,
  'HO 1/8 (13%, least-reliable list), AUC 0.691: "snake or lizard" fires on friendly lizard sidekicks. r5 2 hit / 0 miss on real snakes (book-of-life Xibalba\'s snake). Narrow to a snake; a pet lizard is a no.',
  [
    p('snake_reptile.a', 'S', 'Does `scene.summary` say that a snake is in this scene?',
      'The summary names a snake or serpent that is there now (it bites, coils, hisses, is carried).',
      j('A lizard, chameleon, turtle, or frog is a no.', 'A snake only talked about is a no.'),
      'OR: snake = max(a, b).'),
    p('snake_reptile.b', 'L', 'Do `scene.lines` show that a snake is in this scene?',
      '"Snake!", "It bit me!" after a HISSING caption, a character speaking to a snake.',
      j('A lizard, chameleon, or other small pet is a no.', '"You snake" as an insult is a no.', NOISE, TOLD, SONG),
      'OR with a.'),
  ],
  'Is a snake in this scene?');

c('large_predator', 'a large predatory animal is there', 'creatures_figures', `${TAG}; kind Choice veto kept`,
  'HO 1/2, dev 5/30 (17%), r5 3 hit / 1 miss (P&F S024 the friendly alligator Louis). As a presence tag a friendly alligator IS an alligator; the miss is only harmful when presence flags, which this set never does. Threat goes to creature_threat.',
  [
    p('large_predator.a', 'S', 'Does `scene.summary` say that a large hunting animal is in this scene?',
      'The summary names a wild animal big enough to hurt a person that hunts other animals, there now: a big cat, a wolf, a bear, a crocodile or alligator, an eagle, a large hunting fish. Friendly ones count.',
      j('A shark is a no here (its own question).', 'A pet, a farm animal, or a small animal is a no.', 'An animal only talked about is a no.'),
      'OR: large_predator = max(a, b), then the kind Choice veto.'),
    p('large_predator.b', 'L', 'Do `scene.lines` show that a large hunting animal is in this scene?',
      'Characters see, speak to, or run from a big cat, wolf, bear, crocodile, or eagle that is there now, or a caption names one (WOLF HOWLING next to a reaction).',
      j('A shark is a no here.', 'A pet or small animal is a no.', nameNo('an animal'), NOISE, TOLD, SONG),
      'OR with a.'),
  ],
  'Is a large predatory animal (big cat, wolf, bear, crocodile, eagle) in this scene?');

c('rodent_bat', 'a rat, mouse, or bat is there', 'creatures_figures', TAG,
  'Text-blind item: HO 1/2, dev 2/5. Summary is the only channel that can see it.',
  [
    p('rodent_bat.a', 'S', 'Does `scene.summary` say that a rat, a mouse, or a bat is in this scene?',
      'The summary names a rat, mouse, or bat there now, friendly or not.',
      j('An animal only talked about is a no.', '"Rat" as an insult is a no.'),
      'rodent_bat = max(a, b).'),
    p('rodent_bat.b', 'L', 'Do `scene.lines` show that a rat, a mouse, or a bat is in this scene?',
      '"A rat!", "Bats!", a SQUEAKING caption next to a reaction to the animal.',
      j('"You rat" or "dirty rat" as an insult is a no.', NOISE, TOLD, SONG),
      'OR with a.'),
  ],
  'Is a rat, mouse, or bat in this scene?');

c('clown', 'a clown is there', 'creatures_figures', TAG,
  'HO 0 fires, dev 1/1. Text-blind; the trap is "clown" in an animal or name (clownfish).',
  [
    p('clown.a', 'LS', 'In `scene`, is a person dressed or made up as a clown there?',
      'The lines or summary show a clown there now (a circus clown, a party clown, someone in clown make-up).',
      j('An animal or a name that only contains the word "clown" is a no.', '"Stop clowning around" and "you clown" are a no.', TOLD),
      'clown = a.'),
  ],
  'Is a clown (a person in clown costume or make-up) in this scene?');

c('doll_puppet', 'a doll, puppet, or mannequin is there', 'creatures_figures', TAG,
  'HO 0/1, dev 0/2. Text-blind; a toy character that talks (a toy hero) is the trap.',
  [
    p('doll_puppet.a', 'LS', 'In `scene`, is a doll, a puppet, or a mannequin there?',
      'The lines or summary show a doll, puppet, marionette, or mannequin there now.',
      j('A toy that is one of the talking characters of the story is a no.', '"Puppet" meaning someone controlled by another is a no.', TOLD),
      'doll_puppet = a.'),
  ],
  'Is a doll, puppet, or mannequin in this scene?');

c('mask', 'someone wears a mask over their face', 'creatures_figures', TAG,
  'HO 0 fires, dev 4/4 (100%). Visual; summary is the channel.',
  [
    p('mask.a', 'S', 'Does `scene.summary` say that someone in this scene wears a mask over their face?',
      'The summary says a character wears or puts on a mask or helmet that hides the face.',
      j('Face paint, a party hat, or glasses are a no.', 'A mask only hanging on a wall or talked about is a no.'),
      'mask = a.'),
  ],
  'Does someone wear a mask over their face in this scene?');

c('robot_machine_being', 'a robot or a machine that acts like a living thing is there', 'creatures_figures', TAG,
  'HO 0 fires, AUC 0.652; dev 5/90 (6%) because robots are the protagonists of wild-robot / iron-giant (film-level). Presence stays a tag; film_level (>= 60% of scenes) already turns it into film context.',
  [
    p('robot_machine_being.a', 'LS', 'In `scene`, is a robot or a machine that moves and acts by itself there?',
      'The lines or summary show a robot, android, or thinking machine there now, friendly or not.',
      j('An ordinary vehicle, appliance, or tool is a no.', '"You sound like a robot" is a no.', TOLD),
      'robot_machine_being = a.'),
  ],
  'Is a robot or a machine that acts like a living thing in this scene?');

c('witch_sorcerer', 'a witch, wizard, or sorcerer is there', 'creatures_figures', TAG,
  'HO 1/10 (10%, least-reliable list), AUC 0.447 (below chance): the noun fires whenever magic is talked about (P&F S020 "Mama Odie, the voodoo queen of the bayou" talked about, not there). Ask for a named practitioner who is PRESENT; the magic act is harmful_magic.',
  [
    p('witch_sorcerer.a', 'S', 'Does `scene.summary` name a character in this scene as a witch, wizard, sorcerer, voodoo practitioner, or other magic user?',
      'The summary calls a character who is there now a witch, wizard, sorcerer, witch doctor, voodoo man or queen, or says they cast spells.',
      j('A magic user only talked about by others is a no.', '"You\'re a wizard at this" is a no.', 'A costume is a no.'),
      'witch_sorcerer = max(a, film presence of a cast member whose verified kind or note says witch / sorcerer).'),
    p('witch_sorcerer.b', 'L', 'Do `scene.lines` show a character casting a spell, reading a fortune, or doing magic in front of others?',
      'A line or caption shows magic being done now: an incantation, "Abracadabra" with an effect, a fortune read with cards, a potion poured.',
      j('A stage magic trick for fun is a no.', 'Magic only talked about is a no.', SONG),
      'b alone is a no; witch_sorcerer.b AND a mention of a magic-user word in the scene (code) raises the tag to possible.'),
  ],
  'Is a witch, wizard, or sorcerer present in this scene?');

c('dark_magic', 'magic or a curse is used to harm or change a character', 'creatures_figures',
  'flag through b / c only when they reach act (a curse or spell ON a character\'s body is a physical event under the comic / retold / imagined gates); a is a tag',
  'HO 2/8 (25%); r5 10 hit / 10 miss, the sole reason in book-of-life S007 and S036 (Candle Maker, magic as SETTING), P&F S015/S020 (spell talked about), moana S015 (the "darkness" blight). BUT cutting it lost R72 "the Shadow Man uses sinister magic to transform Naveen into a frog" (P&F S011) and contributed to R42 / R37 (v9/narrow/out/rescore.log). "Frightening magic" is a degree judgement; replace it with the one observable act the user named: magic used ON another character\'s body.',
  [
    p('dark_magic.a', 'S', 'Does `scene.summary` say that a character uses magic, a spell, a curse, or a potion on another character\'s body?',
      'The summary says a character changes, freezes, puts to sleep, shrinks, binds, or hurts another character by magic now ("transforms Naveen into a frog using a talisman", "casts a spell on her").',
      j(SETTING, 'Magic that only lights up, flies, glows, or decorates is a no.', 'Magic that heals someone is a no.', 'Magic only talked about, planned, or explained is a no.', 'A fortune reading is a no.', TOLD),
      'harmful_magic = max(a, b, c). a or b at act flags under the physical gates; the tag harmful_magic replaces dark_magic.'),
    p('dark_magic.b', 'L', 'Does a character in `scene.lines` cry out that magic is being done to their body right now?',
      '"What\'s happening to me?", "I can\'t move!", "You turned me into a frog!" said as it happens, or a caption of a spell hitting someone.',
      j('A character telling about a spell cast in an earlier scene is a no.', FIGURE, SONG),
      'OR with a, c.'),
    p('dark_magic.c', 'L', 'Does a character in `scene.lines` say a curse or spell out loud at another character?',
      'An incantation or curse aimed at someone present ("I curse you", "Sleep until...", words of a spell followed by a caption of its effect).',
      j('Magic words for a party trick, a joke, or a game are a no.', 'A curse only talked about ("the curse of the island") is a no.', 'Darkness, blight, or rot in nature is a no.', SONG),
      'OR with a, b.'),
  ],
  'Is a spell, curse, or dark magic used on a character in this scene to harm, change, or control them (not magic that is only the world of the story)?');

c('alien', 'an alien from outer space is there', 'creatures_figures', TAG,
  '0 fires HO and dev. Wording fixed it before: v3a->v3b "an alien from outer space" + native-beings exclusion cut the Boo misfire 28->0 while Iron Giant held at 15.',
  [
    p('alien.a', 'LS', 'In `scene`, is a being from outer space there?',
      'The lines or summary show a creature or robot from another planet there now.',
      j('A person, an animal, or any being that belongs to the world the story is set in is a no, even if others call it a thing or "it".', nameNo('"alien"'), '"Illegal alien" and "that is alien to me" are a no.', TOLD),
      'alien = a.'),
  ],
  'Is an alien from outer space in this scene?');

c('scary_appearance', 'somebody with a frightening or grotesque appearance is seen', 'creatures_figures', TAG,
  'Narrow-set member: HO 3/4 (75%), AUC 0.845; r5 4 hit / 1 miss, narrow r5 fires 12 right 6 (50%). The v9 lines form asks for a reaction to looks (emotion + visual); split into the described look (summary) and the spoken reaction to a first sight.',
  [
    p('scary_appearance.a', 'S', 'Does `scene.summary` describe how a character or creature looks as frightening, monstrous, skeletal, or hideous?',
      'The summary gives a frightening look: glowing eyes, huge teeth, spikes, rotting, skeletal, burning, made of shadow.',
      j('A cute, round, or funny look is a no.', 'A small difference in someone\'s body, a scar, or a limp is a no.'),
      'OR: scary_appearance = max(a, b).'),
    p('scary_appearance.b', 'L', 'Does a character in `scene.lines` react to the first sight of someone with fear or disgust about their looks?',
      '"What is that thing?", "You\'re hideous!", "Ew!" with a scream at someone\'s face, "Don\'t look at me!"',
      j('Disgust at food, a smell, or a kiss is a no.', TEASE, TOLD),
      'OR with a.'),
  ],
  'Is somebody with a frightening or grotesque appearance seen in this scene?');

// =====================================================================================
// OBJECTS, PLACES, HAZARDS (presence)
// =====================================================================================
c('gun', 'a gun is there', 'objects_hazards', `${TAG}; flags through weapon_used`,
  'HO 0 fires, AUC 0.695; dev 2/5; r5sh Jev 2 fires 1 hit vs Sonnet 2 / 1 (tie).',
  [
    p('gun.a', 'LS', 'In `scene`, does a character hold or fire a gun?',
      'A GUNSHOT or GUN COCKING caption, "He\'s got a gun!", "Drop your weapon!", or the summary says a character carries or fires a gun.',
      j('A toy gun or water pistol is a no.', 'A camera "shot", a "shot" of medicine, "give it a shot", and "Fire!" as a cheer are a no.', 'A cannon is a no here.', TOLD),
      'gun = a.'),
  ],
  'Does a character hold or fire a gun in this scene?');

c('blade_weapon', 'a knife, sword, axe, spear, or other blade is held as a weapon', 'objects_hazards', `${TAG}; flags through weapon_used`,
  'Narrow-set member: HO 6/7 (86%), AUC 0.71; r5 1 hit / 0 miss. Keep the noun; add the kitchen / toy traps.',
  [
    p('blade_weapon.a', 'LS', 'In `scene`, does a character hold a sword, knife, axe, spear, or other blade as a weapon?',
      'A blade drawn, held at someone, or carried to a fight now (a SWORD UNSHEATHING caption, "Drop the knife!", "En garde!").',
      j('A kitchen knife used for cooking, cutlery at a meal, or a tool used for work is a no.', 'A blade on a wall or in a shop is a no.', 'A toy or wooden sword in a game is a no.', '"Cut it out" is a no.', TOLD),
      'blade_weapon = a.'),
  ],
  'Does a character hold a sword, knife, axe, spear, or other blade as a weapon in this scene?');

c('fire', 'a dangerous fire is burning', 'objects_hazards', `${TAG}; the scene flags through caught_in_hazard`,
  'Narrow-set member: HO 4/4 (100%); r5 0 hit / 1 miss (moana S049 lava fight; r5sh Jev 2 fires 0 hits vs Sonnet 3 / 1). Candle trap from book-of-life (Candle Maker, S036 p 0.60).',
  [
    p('fire.a', 'LS', 'In `scene`, is something on fire that should not be burning?',
      'Flames spreading or something burning now: a building, a forest, a ship, a character\'s clothes (a FLAMES CRACKLING caption, "Fire!" meaning flames, "The house is burning!"). Lava counts.',
      j('Candles, lanterns, torches, a campfire, a fireplace, a stove, or fireworks burning as they should are a no.', 'A magic glow is a no.', '"Fired" from a job, "fire away", or "Fire!" as an order to shoot are a no.', TOLD, SONG),
      'fire = a.'),
  ],
  'Is something dangerously on fire in this scene?');

c('explosion', 'an explosion happens', 'objects_hazards', `${TAG}; the scene flags through caught_in_hazard or weapon_used`,
  'Narrow-set member: HO 4/4 (100%), dev 1/4; r5 1 hit / 0 miss.',
  [
    p('explosion.a', 'LS', 'In `scene`, does something explode?',
      'An EXPLOSION, BOOM, or BLAST caption, a bomb or cannon going off, or the summary says something explodes or blows up.',
      j('Fireworks at a celebration are a no.', 'A magic puff of smoke or a pop is a no.', 'A character saying "boom" or making an explosion noise is a no.', '"My head is going to explode" is a no.', TOLD, SONG),
      'explosion = a.'),
  ],
  'Does something explode in this scene?');

c('storm', 'a storm is raging', 'objects_hazards', `${TAG}; flags through caught_in_hazard`,
  'Jev HO 0 fires, dev 7/18 (39%); v9 gave it to Sonnet (r5 Sonnet 2 hit / 0 miss). The v9 noun is a whole-scene judgement; split into the two things that are literally present in subtitles: storm sound captions, and the summary naming the storm.',
  [
    p('storm.a', 'L', 'Does a sound caption in `scene.lines` name thunder, lightning, or a howling or roaring wind?',
      'THUNDER RUMBLING, THUNDERCLAP, LIGHTNING CRACKS, WIND HOWLING, WAVES CRASHING in a gale.',
      j('A gentle breeze, a rain patter, or a character saying "whoosh" is a no.', 'A thunder of hooves or applause is a no.', NOISE),
      'OR: storm = max(a, b).'),
    p('storm.b', 'S', 'Does `scene.summary` say there is a storm, a hurricane, a tornado, a blizzard, or huge waves in this scene?',
      'The summary names the storm or its force as happening now.',
      j('"Brainstorm", "storm off", "take by storm" are a no.', 'A storm only talked about or coming later is a no.'),
      'OR with a.'),
  ],
  'Is there a storm in this scene?');

c('deep_dark_water', 'a character is in deep water they could sink in', 'objects_hazards', `${TAG}; flags through caught_in_hazard / cannot_breathe`,
  'Jev HO 1/2, dev 1/6; Sonnet (v9 owner) v3 1/1. The v9 noun asks "could sink or drown" (a hypothetical); ask where the character literally is, and the spoken distress.',
  [
    p('deep_dark_water.a', 'S', 'Does `scene.summary` say that a character is in the sea, a river, or a lake, or falls or is thrown into it?',
      'The summary says a character swims, sinks, is swept away, dives, or goes overboard into deep water now.',
      j('A bath, a pool at play, a puddle, or a boat ride with nobody in the water is a no.', 'Sea creatures who live in the sea are a no.', TOLD),
      'OR: deep_dark_water = max(a, b).'),
    p('deep_dark_water.b', 'L', 'Does a character in `scene.lines` say they are sinking, going under, or cannot swim?',
      '"I can\'t swim!", "Man overboard!", "She\'s going under!", "Help, I\'m sinking!"',
      j('"Sink or swim" as a figure of speech is a no.', 'A ship "sinking" in a board game is a no.', TOLD, SONG),
      'OR with a.'),
  ],
  'Is a character in deep or open water they could sink in?');

c('heights', 'a character is at a dangerous height', 'objects_hazards', `${TAG}; flags through falls / nearly_falls`,
  'Jev HO 0/3, dev 4/15; Sonnet (v9 owner) r5 2 hit / 0 miss. The v9 noun fired on flying and hills; ask for the edge of a drop and its spoken signs.',
  [
    p('heights.a', 'S', 'Does `scene.summary` say that a character is at the edge of a cliff, a ledge, a rooftop, a tower top, or a high branch?',
      'The summary puts a character on or at the edge of a high place with a long drop below now.',
      j('Flying on purpose (on a dragon, a bird, a plane) with nobody at risk of falling is a no.', 'A hill, stairs, or a balcony nobody is near the edge of is a no.', TOLD),
      'OR: heights = max(a, b).'),
    p('heights.b', 'L', 'Does a character in `scene.lines` say not to look down or that it is a long way down?',
      '"Don\'t look down!", "It\'s a long way down", "I\'m afraid of heights", "Careful, it\'s a big drop."',
      j('"Don\'t look down on me" meaning scorn is a no.', TOLD, SONG),
      'OR with a.'),
  ],
  'Is a character at a dangerous height (the edge of a cliff, ledge, rooftop)?');

c('darkness', 'it is dark where the characters are', 'objects_hazards', TAG,
  'Jev HO 1/2, dev 1/8; Sonnet (v9 owner) v3 47% of 17. Keep one condition per channel; add the spoken sign.',
  [
    p('darkness.a', 'S', 'Does `scene.summary` say that it is dark, night-time in an unlit place, or pitch black where the characters are?',
      'The summary places the scene in darkness now (a dark cave, a forest at night, a power cut).',
      j('A "dark" mood, dark colours, or a dark lord are a no.', 'A lit room at night is a no.'),
      'OR: darkness = max(a, b).'),
    p('darkness.b', 'L', 'Does a character in `scene.lines` say they cannot see because it is dark?',
      '"It\'s so dark", "I can\'t see a thing", "Who turned out the lights?", "Light a torch!"',
      j('"I can\'t see what you mean" is a no.', 'Talk about "the darkness" as an evil or a blight is a no.', TOLD, SONG),
      'OR with a.'),
  ],
  'Is it dark where the characters are in this scene?');

c('needle_medical', 'a needle, injection, or medical instrument is used on someone', 'objects_hazards', TAG,
  '0 fires HO; dev 0/1; Sonnet (v9 owner) 0 fires. Rare; keep one literal act.',
  [
    p('needle_medical.a', 'LS', 'In `scene`, is a needle, an injection, or a medical or dental instrument used on a patient?',
      'A shot given, stitches, a drill at the dentist, a thermometer or stethoscope on a patient now ("This will only sting a little").',
      j('Tools or machines not used on a patient are a no.', 'A sewing needle is a no.', '"A shot" of a drink or a photo is a no.', TOLD),
      'needle_medical = a.'),
  ],
  'Is a needle, injection, or medical instrument used on someone in this scene?');

c('medical_care', 'a patient is treated by a doctor, nurse, healer, or vet', 'objects_hazards', TAG,
  'HO 0 fires, dev 2/5.',
  [
    p('medical_care.a', 'LS', 'In `scene`, does a doctor, nurse, healer, or vet treat a patient?',
      'The lines or summary show a patient being examined, bandaged, or treated now, or a hospital ward.',
      j('A friend putting on a plaster after a small scrape is a no.', 'Healing magic in a magic world is a no.', TOLD),
      'medical_care = a.'),
  ],
  'Is a patient treated by a doctor, nurse, healer, or vet in this scene?');

c('seriously_ill', 'a seriously ill or dying person or animal is seen', 'objects_hazards',
  `${TAG}; a at act together with dies.b feeds dies (a dying character)`,
  'HO 1/5 (20%), dev 2/9; r5sh Jev 2 fires 0 hits vs Sonnet 1 / 0. But the grandmother\'s deathbed (moana S016, R35 lost in the narrow cut) had ps.seriously_ill 0.98 / pl 0.90: the literal "ill or dying" is right there. Trap: slang and small ailments.',
  [
    p('seriously_ill.a', 'S', 'Does `scene.summary` say that a character is gravely ill, dying, or too sick to get up?',
      'The summary says a character is gravely or seriously ill, dying, bedridden, or collapses from illness now ("falls gravely ill").',
      j('A cold, a cough, a tummy ache, or feeling queasy is a no.', 'Faking being sick is a no.', TOLD),
      'OR: seriously_ill = max(a, b).'),
    p('seriously_ill.b', 'L', 'Does a character in `scene.lines` say that someone here is very sick or does not have long to live?',
      '"She\'s very sick", "He doesn\'t have long", "The fever is getting worse", said about someone in the scene.',
      j('"That\'s sick!" meaning great, "sick of it" meaning tired of it, and seasickness jokes are a no.', COUGH, TOLD, SONG),
      'OR with a.'),
  ],
  'Is a person or animal in this scene seriously ill or dying?');

c('blood_wound', 'blood or an open wound is seen', 'objects_hazards', TAG,
  'HO 1/2, dev 1/1; text-blind. Trap: "blood" as family.',
  [
    p('blood_wound.a', 'LS', 'In `scene`, is a character bleeding or does a character have an open wound?',
      '"You\'re bleeding!", a cut, a gash, a wound being bandaged, or the summary says a character bleeds.',
      j('"Blood" meaning family or royalty ("royal blood", "bad blood") is a no.', 'A drop of blood used in a spell or a vial is a no.', 'A scraped knee that is laughed off is a no.', TOLD),
      'blood_wound = a.'),
  ],
  'Is blood or an open wound shown in this scene?');

c(['vehicle_crash', 'vehicle_accident'], 'a vehicle crashes or goes out of control', 'peril', PHYS,
  'vehicle_accident HO 1/1 (100%), dev 0 fires; vehicle_crash presence HO 0 fires, dev 1/3; r5 Sonnet 1 / 1. Two ids for one event; one question per channel.',
  [
    p('vehicle_crash.a', 'L', 'Does a sound caption or a line in `scene.lines` show a vehicle crashing right now?',
      'A CRASH or TIRES SCREECHING caption with a car, cart, train, boat, ship, or plane, "We\'re going to crash!" followed by an impact, "The ship hit the rocks!"',
      j('Bumper cars or a toy vehicle is a no.', '"Crash" meaning to sleep, to gatecrash, or a computer crash is a no.', 'A plate or a person crashing into something is a no here.', TOLD, SONG),
      'OR: vehicle_crash = max(a, b); the v9 ids vehicle_accident and vehicle_crash both read it.'),
    p('vehicle_crash.b', 'S', 'Does `scene.summary` say that a vehicle crashes, wrecks, overturns, or goes out of control?',
      'The summary says a car, cart, train, boat, ship, or aircraft crashes or runs out of control now.',
      j('A bumpy but safe landing is a no.', TOLD),
      'OR with a.'),
  ],
  'Does a vehicle crash or go out of control in this scene?');

c(['cage_net_trap', 'restraints', 'captured'], 'a character is caught and held so they cannot leave', 'captivity', PHYS,
  'captured Jev HO 5/10 (50%), AUC 0.817; cage_net_trap HO 0/1, dev 3/5, r5 Jev 2 hit / 1 miss (P&F S034); restraints HO 0/2. v9 gave captured to Sonnet (stageB Sonnet 32/48 vs Jev 19/48; r5 Sonnet 5 / 1). Jev-first: the user\'s example is ONE physical condition ("locked in, tied up, or held so they cannot leave"); the summary word "captured" and the spoken plea "Let me go!" are two more literal signals. cage / restraints tags become the physical kind of the hold.',
  [
    p('captured.a', 'LS', 'In `scene`, is a character locked in, tied up, or held so they cannot leave?',
      'The lines or summary show a character inside a locked cage, a net, a trap, a jar, or a cell, or tied with rope, chains, or straps, or gripped by a captor, now.',
      j('A pet or animal living in its normal home, tank, or pen and cared for is a no.', 'A seatbelt, a harness for flying, or a pet on a lead on a walk is a no.', 'A hug is a no.', GAME, TOLD),
      'captured = max(a, b, c); a is also the tag cage_net_trap (cage / net / trap / jar) or restraints (rope / chain / strap) by one kind Choice asked only when a >= act.'),
    p('captured.b', 'S', 'Does `scene.summary` say that a character is captured, kidnapped, taken prisoner, or locked up?',
      'The summary says a character is caught, seized, imprisoned, caged, or netted now.',
      j('"Captured her heart" and other figures of speech are a no.', GAME, TOLD),
      'OR with a, c.'),
    p('captured.c', 'L', 'Does a character in `scene.lines` beg to be let go or let out?',
      '"Let me go!", "Let me out!", "Put me down!", "Untie me!", said by someone being held.',
      j('"Let it go" as a song or advice is a no.', 'A child asking to be put down from a playful hug is a no.', TEASE, SONG),
      'OR with a, b.'),
  ],
  'Is a character caught and held against their will (caged, netted, tied up, locked in) in this scene?');

c('graveyard_funeral', 'a graveyard, grave, tomb, or funeral is seen', 'objects_hazards', TAG,
  'Jev HO 0 fires, AUC 0.473; Sonnet (v9 owner) 1/1. Literal place names; the afterlife city is not a graveyard.',
  [
    p('graveyard_funeral.a', 'S', 'Does `scene.summary` say this scene is at a graveyard, a grave, a tomb, or a funeral?',
      'The summary names a cemetery, graveyard, grave, tomb, burial, memorial service, or funeral happening or visited now.',
      j('A land of the dead that is the world of the story is a no.', 'A grave only talked about is a no.'),
      'OR: graveyard_funeral = max(a, b).'),
    p('graveyard_funeral.b', 'L', 'Do `scene.lines` show characters at a grave or a funeral?',
      '"Here lies...", "We are gathered here to remember...", a character speaking to a grave or laying flowers on it.',
      j('"Graveyard shift", "dead tired", and "over my dead body" are a no.', TOLD, SONG),
      'OR with a.'),
  ],
  'Is there a graveyard, grave, tomb, or funeral in this scene?');

c('dangerous_machine', 'dangerous machinery or live electricity acts on a character', 'objects_hazards', `${TAG}; the flag path is caught_in_hazard (machine)`,
  'HO 1/1 (100%), AUC 0.773; dev 12/21 (57%). The v9 definition asks "could hurt" (a hypothetical). Ask for the machine or the current reaching a character.',
  [
    p('dangerous_machine.a', 'LS', 'In `scene`, do moving machine parts or live electricity reach a character?',
      'A character is pulled toward blades, saws, gears, crushers, or a conveyor, or is shocked by live wires or a lightning machine now (ELECTRICITY CRACKLING with "Aah!").',
      j('Ordinary lights, doors, appliances, and vehicles working normally are a no.', 'A machine only running in the background is a no.', NOISE, TOLD),
      'dangerous_machine = a; a at act also sets caught_in_hazard.'),
  ],
  'Does dangerous machinery or live electricity act on a character in this scene?');

// =====================================================================================
// MENTION channel (m.*)
// =====================================================================================
c('mention (m.<presence id>)', 'characters talk about a presence item that is not necessarily there', 'all presence groups',
  'context only ("mentioned_only" list; never flags, never a tag)',
  'm.* never flags (select.js writes only a mentioned_only list) and is excluded from the scorecard; kept only because it is the cheapest way to tell a parent "they talk about a shark but none appears". One template, the presence item\'s own name traps.',
  [
    p('mention.a', 'L', 'Do the characters talk about <noun> in `scene.lines`?',
      'A line names or clearly refers to <noun>, whether or not it is there.',
      j('<the presence item\'s own name / idiom traps, e.g. "fired" from a job for fire, a character called Boo for ghost>.', 'A sung line is a no.'),
      'mentioned_only(<id>) = mention.a >= act AND presence(<id>) < band_low.'),
  ],
  'Do the characters talk about <noun> in this scene?');

// =====================================================================================
// PERIL (events)
// =====================================================================================
c('chased', 'a character is chased or hunted', 'peril', PHYS,
  'HO 3/6 (50%), AUC 0.749, but 14 of 48 missed items sat at 0.5-0.7 (a recall problem); dev 22/34 (65%); r5 7 hit / 3 miss (P&F S016, S024; moana S048). Split the pursuit into what is SAID: the chaser\'s shout, the fleeing character\'s shout, and the summary verb.',
  [
    p('chased.a', 'L', 'Does a character in `scene.lines` shout to catch or go after someone who is getting away?',
      '"Get him!", "After them!", "Don\'t let her escape!", "Stop, thief!", "There they are, get them!"',
      j('Tag, a race, hide-and-seek, or chasing a ball or a pet for fun is a no.', '"Go get \'em" as encouragement is a no.', TOLD, SONG),
      'chased = max(a, b, c); a also feeds plots_harm only when the order is to seize / hurt (not here).'),
    p('chased.b', 'L', 'Does a character in `scene.lines` say that someone or something is coming after them right now?',
      '"They\'re after us!", "It\'s following us!", "Run, it\'s coming!", "Faster, they\'re catching up!"',
      j('"Chase your dreams" is a no.', GAME, LAUGHOFF, TOLD, SONG),
      'OR with a, c.'),
    p('chased.c', 'S', 'Does `scene.summary` say that a character is chased, pursued, hunted, or flees from someone?',
      'The summary says someone chases, pursues, or hunts a character, or a character flees or escapes from a pursuer, now.',
      j(GAME, TOLD),
      'OR with a, b.'),
  ],
  'Is a character chased or hunted in this scene?');

c('attacked', 'a character physically attacks another character', 'peril', PHYS,
  'HO 5/9 (56%), AUC 0.757; dev 4/8; r5 5 hit / 0 miss. "Physically attack" bundles intent and degree; ask for the named body actions and the spoken blow.',
  [
    p('attacked.a', 'S', 'Does `scene.summary` say that one character hits, kicks, grabs, strikes, or attacks another character?',
      'The summary says a character attacks, punches, knocks down, strangles, or wrestles another character against their will now.',
      j('A hug, a tickle, a high five, or a playful shove is a no.', 'Sparring, training, or a sport is a no.', 'An animal or monster attacking is a no here (creature_threat).', TOLD),
      'attacked = max(a, b).'),
    p('attacked.b', 'L', 'Does a sound caption or line in `scene.lines` show a blow landing on a character, followed by a cry of pain or a plea?',
      'A PUNCH, THUD, or GRUNTS caption with "Ow!", "Let go of me!", "Stop, you\'re hurting him!"',
      j(LAUGHOFF, 'A slap-fight or pillow fight played for laughs is a no.', GAME, NOISE, TOLD, SONG),
      'OR with a.'),
  ],
  'Does a character physically attack another character in this scene?');

c('falls', 'a character falls from a dangerous height', 'peril', PHYS,
  'HO 1/1, AUC 0.821; dev 2/4; r5 1 hit / 0 miss. Thin but literal.',
  [
    p('falls.a', 'L', 'Do `scene.lines` show a character falling from a height right now?',
      'A scream while falling then a SPLASH or THUD caption, "She\'s falling!", "Catch him!", "Nooo!" as someone drops.',
      j('Tripping or tumbling on flat ground, onto a bed, or into a pile is a no.', 'Jumping on purpose into water for fun, diving, gliding, or flying is a no.', LAUGHOFF, TOLD, SONG),
      'falls = max(a, b).'),
    p('falls.b', 'S', 'Does `scene.summary` say that a character falls or is thrown off something high?',
      'The summary says a character falls off a cliff, roof, tree, bridge, ship, or out of the sky now.',
      j('"Falls in love", "falls asleep", "falls behind" are a no.', TOLD),
      'OR with a.'),
  ],
  'Does a character fall from a dangerous height in this scene?');

c('nearly_falls', 'a character hangs on at the edge of a drop', 'peril', PHYS,
  'HO 0 fires, AUC 0.796 (2 items at 0.5-0.7); dev 1/2. The cue phrases are verbal, so the lines carry it.',
  [
    p('nearly_falls.a', 'L', 'Does a character in `scene.lines` shout to hold on or not let go while someone hangs over a drop?',
      '"Hold on!", "Don\'t let go!", "Grab my hand!", "I\'m slipping!", "I can\'t hold on!"',
      j('"Hold on" meaning "wait a moment" is a no.', 'Climbing or swinging for fun with nobody worried is a no.', TOLD, SONG),
      'nearly_falls = max(a, b).'),
    p('nearly_falls.b', 'S', 'Does `scene.summary` say that a character dangles, hangs from a ledge, or nearly falls?',
      'The summary says a character hangs, dangles, clings to an edge, or is caught just before falling now.',
      j(TOLD),
      'OR with a.'),
  ],
  'Is a character hanging on at the edge of a dangerous drop in this scene?');

c('cannot_breathe', 'a character cannot breathe (drowning, choking, strangled, out of air)', 'peril', PHYS,
  'HO 2/2, dev 5/5 (100%); r5 0 hit / 1 miss: book-of-life S021, the mariachi serenade with a (CHOKING) (COUGHING) caption, p 0.92. The cough/choke trap is written for exactly that miss.',
  [
    p('cannot_breathe.a', 'L', 'Does a character in `scene.lines` say that someone cannot breathe or is drowning right now?',
      '"He\'s not breathing!", "I can\'t breathe!", "She\'s drowning!", "Get it off my neck!"',
      j(COUGH, 'Being out of breath from running, singing, or laughing is a no.', 'Holding breath on purpose to swim or hide is a no.', '"You take my breath away" and "breathtaking" are a no.', TOLD, SONG),
      'cannot_breathe = max(a, b). A (CHOKING)/(COUGHING) caption alone is never enough.'),
    p('cannot_breathe.b', 'S', 'Does `scene.summary` say that a character is drowning, choking, strangled, smothered, or trapped without air?',
      'The summary names the loss of breath as happening now.',
      j(COUGH, TOLD),
      'OR with a.'),
  ],
  'Is a character unable to breathe (drowning, choking, strangled, out of air) in this scene?');

c('caught_in_hazard', 'a character is caught in fire, water, storm, collapse, or a machine', 'peril',
  `${PHYS}; the only flag path for fire, explosion, storm, deep water, and machinery`,
  'narrow_ge3 member: HO 3/3 (100%), AUC 0.838; dev 16/21 (76%); r5 3 hit / 0 miss. Split into summary and spoken channels; list forces literally.',
  [
    p('caught_in_hazard.a', 'S', 'Does `scene.summary` say that a character is caught in a fire, a flood, rushing water, a storm, a collapse, an avalanche, or lava?',
      'The summary puts a character inside or under the force now: flames around them, swept by a wave or current, a building or cave collapsing on them, pulled into machinery.',
      j('The force only nearby, seen from a safe place, or over before the characters arrive is a no.', 'Ordinary rain, a candle, a campfire, a bath, or a swim for fun is a no.', SETTING, TOLD),
      'caught_in_hazard = max(a, b).'),
    p('caught_in_hazard.b', 'L', 'Does a character in `scene.lines` shout that a fire, water, storm, or collapse is hitting them right now?',
      '"We\'re on fire!", "The ship is sinking!", "The cave is collapsing!", "The water\'s rising!", "Hold on, the wave!"',
      j('A fire drill, a game, or a warning about what might happen later is a no.', FIGURE, TOLD, SONG),
      'OR with a.'),
  ],
  'Is a character caught in a dangerous force or place (fire, flood, storm, collapse, machine) in this scene?');

c('child_in_danger', 'a child is in physical danger', 'peril', PHYS,
  'narrow-set member: HO 11/13 (85%, 2nd most reliable), AUC 0.782; dev 20/32 (63%); r5 3 hit / 2 miss (moana S048/S049). The wording works; keep it and add the identification and the traps, plus the per-name template (HO 12/17, 71%) as a second channel.',
  [
    p('child_in_danger.a', 'LSC', 'In `scene`, is a child in physical danger?',
      'A child (a name in `children`, or a character the lines call a kid, baby, son, daughter, little girl, or little boy) is attacked, chased, falling, caught in fire, water, or a storm, or held by a creature or villain now.',
      j('A child playing, pretending, or being told off is a no.', 'A child worried about a grown-up who is in danger is a no.', 'A grown-up in danger is a no.', LAUGHOFF, TOLD, SONG),
      'child_in_danger = max(a, film child_in_danger.<C> for every verified child in the scene).'),
  ],
  'Is a child in physical danger in this scene?');

c('creature_threat', 'an animal or creature attacks or tries to catch a character', 'peril',
  `${PHYS}; also triggers the kind Choice (species tags)`,
  'narrow-set member: HO 6/7 (86%), AUC 0.757; dev 22/27 (82%); r5 9 hit / 4 miss, incl. P&F S024 (bayou with the friendly alligator Louis) and moana S048/S049 (Te Ka). "Threaten" is a judgement; ask for the attack act, plus a two-signal composite (roar caption AND a spoken warning) for wordless attacks like moana S047 "(ROARING) ... No! Heihei!".',
  [
    p('creature_threat.a', 'LS', 'In `scene`, does an animal or creature attack, bite, grab, or charge at a character?',
      'The lines, captions, or summary show it biting, clawing, grabbing, charging, lunging at, swallowing, or chasing a character now ("It\'s coming for us!", a ROAR caption as someone screams "Run!").',
      j(FRIENDLY, 'Growling or roaring with no move toward a character is a no.', 'A person, a robot, or a machine is a no here.', 'Scaring someone as a job, a prank, or a game is a no.', TOLD, SONG),
      'creature_threat = max(a, b, ghost_spirit.c, spider_insect.b, film danger_attacks.<D> for creature dangers) OR (c AND afraid_for_safety.a).'),
    p('creature_threat.b', 'S', 'Does `scene.summary` say that an animal or creature attacks, hunts, or chases a character?',
      'The summary names the creature\'s attack or pursuit as happening now ("Te Ka attacks", "the dragon chases them").',
      j(FRIENDLY, TOLD),
      'OR with a.'),
    p('creature_threat.c', 'L', 'Does a sound caption in `scene.lines` name an animal or creature roaring, growling, snarling, or hissing?',
      'ROARING, GROWLING, SNARLING, HISSING, a named creature\'s roar (TE KA ROARING).',
      j('A cat purring, a dog barking playfully, or a character imitating a roar in play is a no.', NOISE),
      'c alone is a tag; c AND afraid_for_safety.a (a spoken warning to run) at act counts as an attack.'),
  ],
  'Does an animal or creature threaten or attack a character in this scene?');

// =====================================================================================
// VIOLENCE
// =====================================================================================
c('weapon_used', 'a weapon is used against a character', 'violence', PHYS,
  'HO 3/4 (75%), AUC 0.823 (best violence AUC); dev 2/4. v9 gave it to Sonnet (stageB Sonnet 29/147 vs Jev 11/147; r5 Sonnet 8 hit / 1 miss). It is the most observable violence act there is (gunshot / clash captions); give Jev two literal channels and let the next held-out round decide.',
  [
    p('weapon_used.a', 'L', 'Does a sound caption or line in `scene.lines` show a weapon being fired, swung, or thrown at a character right now?',
      'GUNSHOT, ARROW WHOOSHES, SWORDS CLASHING, CANNON FIRING captions with a character as the target, "He\'s shooting at us!", "Fire!" followed by shots.',
      j('Shooting or throwing at targets or practice dummies is a no.', 'A toy, a water pistol, a pillow, or a snowball is a no.', 'A weapon only carried, shown, or polished is a no.', TOLD, SONG),
      'weapon_used = max(a, b).'),
    p('weapon_used.b', 'S', 'Does `scene.summary` say that a character shoots, stabs, swings, or throws a weapon at another character?',
      'The summary names a gun, bow, spear, sword, axe, knife, bomb, or cannon used against a character now.',
      j(GAME, TOLD),
      'OR with a.'),
  ],
  'Is a weapon used against a character (fired, swung, or thrown at them) in this scene?');

c('battle', 'many characters fight at once', 'violence', PHYS,
  'Most reliable question: HO 8/8 (100%, Wilson lo 0.676), dev 6/7, r5 6 hit / 0 miss. Unchanged condition; literal traps only.',
  [
    p('battle.a', 'LS', 'In `scene`, are many characters fighting each other at the same time?',
      'The lines, captions, or summary show a fight between groups now: battle cries, orders to charge, clashing weapons, several characters struck or falling.',
      j('Two characters fighting alone is a no.', GAME, 'A food fight or pillow fight is a no.', 'A battle told about, painted, acted in a play, or sung about is a no.'),
      'battle = a.'),
  ],
  'Is there a fight involving many characters at once in this scene?');

// =====================================================================================
// CAPTIVITY (captured is merged above)
// =====================================================================================
c('trapped', 'a character is stuck somewhere they cannot get out of', 'captivity', `tag (v9: not a strong event); trapped.a at act also counts as captured when a captor is named`,
  'Jev HO 2/4 (50%), AUC 0.704; dev 5/17; v9 gave it to Sonnet. The failure is "stuck" as a mood; ask for the failed escape and the spoken "We\'re trapped!".',
  [
    p('trapped.a', 'L', 'Does a character in `scene.lines` say they are trapped, stuck, or cannot get out?',
      '"We\'re trapped!", "I\'m stuck!", "There\'s no way out!", "The door won\'t open!"',
      j('Stuck in a boring job, stuck on a puzzle, or "stuck with you" is a no.', 'Characters calmly going about their day at home is a no.', LAUGHOFF, TOLD, SONG),
      'trapped = max(a, b).'),
    p('trapped.b', 'S', 'Does `scene.summary` say that a character is trapped in a place they cannot get out of?',
      'The summary says a character is stuck in a pit, a collapsed cave, a sinking ship, a locked room, ice, or a web now.',
      j(TOLD),
      'OR with a.'),
  ],
  'Is a character stuck somewhere they cannot get out of in this scene?');

c('swallowed', 'a character is swallowed or held in a creature\'s mouth', 'captivity', PHYS,
  'HO 0/1, AUC 0.427; dev 2/3; v9 gave it to Sonnet. Rare; literal only.',
  [
    p('swallowed.a', 'LS', 'In `scene`, is a character swallowed, or held inside a creature\'s mouth or stomach?',
      'The lines or summary show a creature swallowing a character or a character inside its mouth or belly now ("It ate him!", "We\'re inside a whale!").',
      j('Eating food is a no.', '"Eat my words" or "swallow your pride" is a no.', 'A threat to eat someone is a no here (threatens_harm).', TOLD, SONG),
      'swallowed = a.'),
  ],
  'Is a character swallowed or held inside a creature\'s mouth in this scene?');

// =====================================================================================
// INJURY
// =====================================================================================
c('injured', 'a character is physically hurt', 'injury', 'tag (v9: not a strong event); feeds severity and badly_hurt',
  'HO 2/8 (25%), AUC 0.807; dev 8/17. The HO misses are pratfalls; ask for the cry of pain and the summary word.',
  [
    p('injured.a', 'L', 'Does a character in `scene.lines` cry out in pain or say that someone is hurt?',
      '"Ow, my leg!", "I\'m hurt", "He\'s hurt!", "It hurts!" after a fall or a blow.',
      j(LAUGHOFF, '"You hurt my feelings" is a no.', 'A small sting that passes at once is a no.', 'Pretending to be hurt is a no.', TOLD, SONG),
      'injured = max(a, b).'),
    p('injured.b', 'S', 'Does `scene.summary` say that a character is hurt, injured, wounded, or crushed?',
      'The summary names a physical injury happening or shown now.',
      j('A comic bonk that the summary calls a gag is a no.', TOLD),
      'OR with a.'),
  ],
  'Is a character really physically hurt in this scene (not a gag)?');

c('badly_hurt', 'a character is badly hurt (bleeding, knocked out, unable to move)', 'injury', PHYS,
  'HO 2/6 (33%), AUC 0.839; dev 2/7; r5 4 hit / 0 miss (P&F S040 "He\'s hurting awful bad", the dying firefly R42, lost in the narrow cut). Literal signs of severe harm.',
  [
    p('badly_hurt.a', 'S', 'Does `scene.summary` say that a character is badly hurt, knocked out, bleeding, crushed, or cannot get up?',
      'The summary names a severe injury now ("brings the badly hurt Ray", "lies unconscious").',
      j('Sleeping, fainting from a kiss, or a comic knock-out who pops up at once is a no.', TOLD),
      'badly_hurt = max(a, b).'),
    p('badly_hurt.b', 'L', 'Does a character in `scene.lines` say that someone here is badly hurt or will not wake up?',
      '"He\'s hurt bad", "He\'s hurting awful bad", "She won\'t wake up!", "He\'s not moving!", "Stay with me!"',
      j('A character who answers or gets up in the next lines is a no.', LAUGHOFF, TOLD, SONG),
      'OR with a.'),
  ],
  'Is a character badly hurt (bleeding, knocked out, unable to move) in this scene, not as a gag?');

// =====================================================================================
// DEATH AND LOSS
// =====================================================================================
c('dies', 'a character dies or is killed', 'death', LOSS,
  'Jev HO 3/3 (100%), AUC 0.74, dev 3/5 but recall 18%; v9 gave it to Sonnet (stageB death Sonnet 38/94 vs Jev 29/94; r5 Sonnet 2 / 0). The TypeSafe guidance decomposes exactly this concept: death = "says someone died" OR "a body is described" OR "stops moving and others react". The grandmother\'s death (moana S016, R35, lost in the narrow cut) is literally "urges Moana to find Maui before dying" in the summary.',
  [
    p('dies.a', 'L', 'Does a character in `scene.lines` say that someone in this story has just died or been killed?',
      '"He\'s dead", "She\'s gone", "Manolo passed away", "They killed him", said about a character of the story, about a death that happened now or just before this scene.',
      j('"I\'m dead", "we\'re dead soon", "you\'re dead meat", and "dead tired" are a no.', SONG, 'A death long ago (a grandparent remembered, a parent who died before the story) is a no.', 'A dead character who lives on in an afterlife is a no.', 'Playing dead is a no.'),
      'dies = max(a, b) OR (dead_body >= act) OR (c >= act AND max(a, b, seriously_ill.a) >= band_low).'),
    p('dies.b', 'S', 'Does `scene.summary` say that a character dies, is killed, or is dying in this scene?',
      'The summary says a character dies, is killed, dies of illness, or is dying ("before dying", "is killed by", "dies in his arms").',
      j('Hurt, asleep, unconscious, or only appearing dead is a no.', 'A death told as backstory is a no.', 'A character already dead in an afterlife is a no.'),
      'OR with a.'),
    p('dies.c', 'L', 'Does a character in `scene.lines` beg someone who does not answer to wake up or come back?',
      '"Dad? Dad, get up", "Please wake up!", "Don\'t leave me!", with no answer from that character in the lines that follow.',
      j('A character who answers, wakes, or moves in the next lines is a no.', 'Waking someone who is asleep in the morning is a no.', LAUGHOFF),
      'c confirms: counts only with another death signal at band_low or more.'),
  ],
  'Does a character die or get killed in this scene?');

c('loved_one_dies', 'a character\'s family member or close friend dies', 'death', LOSS,
  'Jev already wins here: HO 1/1, dev 4/7, r5 4 hit / 0 miss, r5sh Jev 4/4 vs Sonnet 3/3 (moana S016 p 0.76). v10 Sonnet-leaning draft moved it to Sonnet anyway; do not. Decompose the relation into the spoken form and the summary form.',
  [
    p('loved_one_dies.a', 'L', 'Does a character in `scene.lines` say that their own family member or close friend has just died?',
      '"My father is dead", "Mama\'s gone", "They killed my brother", or a caption of sobbing over a named parent, grandparent, child, sibling, partner, or best friend who has just died.',
      j('"I\'m dead" and other figures of speech are a no.', SONG, 'A death long ago remembered is a no.'),
      'loved_one_dies = max(a, b) AND dies >= band_low.'),
    p('loved_one_dies.b', 'S', 'Does `scene.summary` say that a character\'s parent, grandparent, child, sibling, partner, or close friend dies or is dying?',
      'The summary names the relation and the death ("Gramma Tala ... before dying", "his father is killed").',
      j('Only hurt, missing, or thought dead is a no here (believed_dead).', 'A death told as backstory is a no.'),
      'OR with a.'),
  ],
  'Does a character\'s family member or close friend die in this scene?');

c('pet_dies', 'a pet dies', 'death', LOSS,
  'HO 0 fires; frankenweenie (dev) is the case (Sparky); Sonnet v3 "dies" 80%. Two literal channels; the reanimation belongs to reanimated_dead.',
  [
    p('pet_dies.a', 'S', 'Does `scene.summary` say that a pet dies or is killed?',
      'The summary says a dog, cat, fish, bird, or other pet dies or is killed now.',
      j('A pet that is hurt but lives is a no.', 'A pet brought back to life is a no here.', TOLD),
      'pet_dies = max(a, b).'),
    p('pet_dies.b', 'L', 'Does a character in `scene.lines` say that their pet has just died?',
      '"Sparky\'s dead", "My dog is gone", "He didn\'t make it", said about a pet.',
      j('A "play dead" trick is a no.', 'A pet that is lost but alive is a no.', FIGURE, SONG, TOLD),
      'OR with a.'),
  ],
  'Does a pet die in this scene?');

c('believed_dead', 'a character believes someone close has just died', 'death', LOSS,
  'HO 2/2 (and 7/8 = 88% at 0.5, recall 42% at 0.5), AUC 0.717; dev 6/19; r5 5 hit / 5 miss, incl. book-of-life S019 (p 0.77: a comic "Creep" serenade, "Maria! (GASPS)", no death word at all) and S047; r5sh Jev 10 fires / 5 hits vs Sonnet 5 / 3. For a parent the upsetting moment is the same whether the death is real: ask for the SPOKEN announcement or the summary\'s "believed dead"; the gasp-only case is a no.',
  [
    p('believed_dead.a', 'L', 'Does a character in `scene.lines` cry out or say that someone they love is dead?',
      '"He\'s dead!", "No! Papa!" followed by sobbing, "Manolo passed away", "She\'s gone" about someone who seems to have just died.',
      j('A gasp or a shout of a name with no word about death is a no.', '"I\'m dead", "we\'re dead soon", and "you\'re dead meat" are a no.', SONG, 'A death long ago remembered is a no.', 'Greeting a dead relative in an afterlife is a no.'),
      'believed_dead = max(a, b); dies.a and believed_dead.a share wording on purpose (one spoken event).'),
    p('believed_dead.b', 'S', 'Does `scene.summary` say that a character thinks, believes, or is told that someone is dead?',
      'The summary says a character believes, is told, or learns that someone died, or that someone "appears dead" to them.',
      j('The summary only says someone is hurt, missing, or asleep is a no.', TOLD),
      'OR with a.'),
  ],
  'Does a character in this scene believe that someone close to them has just died?');

c('parent_death_learned', 'a child sees or learns that their parent has died', 'death', LOSS,
  'HO 0 fires; dev 2/4 (lion-king). Needs the child identity: state carries the verified `children` names.',
  [
    p('parent_death_learned.a', 'SC', 'Does `scene.summary` say that a child\'s mother or father dies, or that a child learns their parent has died?',
      'The summary names a young character (in `children`, or called a cub, kid, son, daughter) and the death of their parent now.',
      j('A parent who died before the story began is a no.', 'A parent who is only missing or hurt is a no.', TOLD),
      'parent_death_learned = max(a, b AND dies >= band_low).'),
    p('parent_death_learned.b', 'LC', 'Does a young character in `scene.lines` call out to their mother or father who does not answer, or say their parent is dead?',
      '"Dad? Dad, come on, get up", "Mom! Mommy!" with no answer, "My dad is dead."',
      j('A parent who answers or appears in the next lines is a no.', 'Calling a parent who is in the next room is a no.', GAME, SONG),
      'b needs a death signal (dies >= band_low).'),
  ],
  'Does a child see or learn that their parent has died in this scene?');

c('grieving', 'a character grieves someone who has died', 'death', TAG,
  'HO 2/8 (25%), AUC 0.651; dev 6/23; r5sh Jev 9 fires / 6 hits vs Sonnet 7 / 4 (Jev ahead). Emotion bundled with a death; decompose: crying caption AND a death signal, or the summary word "grieves / mourns".',
  [
    p('grieving.a', 'S', 'Does `scene.summary` say that a character grieves, mourns, or weeps over someone who has died?',
      'The summary says a character grieves, mourns, weeps for, or keeps vigil for a dead character now.',
      j('Sad about a lost game, a lost toy, or a break-up is a no.', 'Celebrating the dead at a festival is a no.', TOLD),
      'grieving = max(a, b, crying.a AND (dies OR believed_dead) >= band_low).'),
    p('grieving.b', 'L', 'Does a character in `scene.lines` say they miss someone who has died or wish that person were still alive?',
      '"I miss you, Papa", "I wish you were here", "Why did you have to go?" to or about a dead character.',
      j('Missing someone who is only away or asleep is a no.', SONG, 'Chatting happily with a dead relative in an afterlife is a no.'),
      'OR with a.'),
  ],
  'Is a character grieving someone who has died in this scene?');

// =====================================================================================
// SEPARATION AND FAMILY
// =====================================================================================
c('child_taken', 'a child is taken away from their parent or carer', 'separation', LOSS,
  'Jev HO 1/1 (100%), AUC 0.689; dev 1/5; v9 gave it to Sonnet. The user\'s own example of the shape: "Is a child told they will be hurt or taken away?" Three literal signals.',
  [
    p('child_taken.a', 'SC', 'Does `scene.summary` say that a child is taken, kidnapped, stolen, or carried off from their parent or carer?',
      'The summary names a young character (in `children`, or a baby, kid, son, daughter) taken away against the parent\'s or carer\'s will now.',
      j('A school drop-off, being carried to bed, or leaving with the parent\'s permission is a no.', 'A parent telling others that their child was taken earlier is a no.'),
      'child_taken = max(a, b); c at act also sets threatens_harm (policy 1).'),
    p('child_taken.b', 'L', 'Does a parent or carer in `scene.lines` cry out as their child is taken away?',
      '"Give her back!", "Put him down!", "My baby!", "Nemo!" shouted as the child is carried or swum off.',
      j('Calling a child who is nearby and answers is a no.', GAME, TOLD, SONG),
      'OR with a.'),
    p('child_taken.c', 'LC', 'Is a child in `scene.lines` told that they will be taken away from their home or family?',
      '"You\'re coming with me", "You\'ll never see your father again", "I\'m taking her", said to or about a child by someone who is not their carer.',
      j('A parent telling their own child they are going home or to bed is a no.', TEASE, GAME, TOLD),
      'c flags as a threat (policy 1) and tags child_taken as possible.'),
  ],
  'Is a child taken away from their parent or carer in this scene?');

c('child_separated', 'a child is separated from their parent or carer', 'separation', LOSS,
  'HO 0 fires, AUC 0.813 (2 items at 0.5-0.7), 50% at 0.5; dev 1/4. Good ranking, no fires: the literal call-with-no-answer is the missing signal.',
  [
    p('child_separated.a', 'SC', 'Does `scene.summary` say that a child is lost, alone, or cannot find their parent or carer?',
      'The summary names a young character separated from their parent or carer now ("Nemo is taken to a fish tank far from his father", "lost in the crowd").',
      j('A child who goes off to play and comes back is a no.', 'A child away at school or with a sitter is a no.', TOLD),
      'child_separated = max(a, b).'),
    p('child_separated.b', 'LC', 'Does a young character in `scene.lines` call for their mother, father, or carer who does not answer?',
      '"Mom? Dad? Where are you?", "Daddy!" with no answer, "I want my mom!"',
      j('A parent who answers in the next lines is a no.', 'Hide-and-seek is a no.', SONG, TOLD),
      'OR with a.'),
  ],
  'Is a child separated from their parent or carer and unable to find them in this scene?');

c('parent_searching', 'a parent searches for their missing child', 'separation', 'tag (never flags; select policy)',
  'HO 1/1 (100%), AUC 0.798; dev 2/9. Literal: calling the child\'s name, asking strangers.',
  [
    p('parent_searching.a', 'L', 'Does a parent in `scene.lines` call out a missing child\'s name or ask others if they have seen their child?',
      '"Have you seen my son?", "Nemo! Nemo!", "Where is my daughter?", "Has anyone seen a little boy?"',
      j('Calling a child who is nearby and answers is a no.', 'A parent travelling, talking, or resting without searching is a no.', TOLD, SONG),
      'parent_searching = max(a, b).'),
    p('parent_searching.b', 'S', 'Does `scene.summary` say that a parent searches or looks for their child?',
      'The summary says a parent searches, looks, or goes after their missing child now.',
      j(TOLD),
      'OR with a.'),
  ],
  'Is a parent searching for their missing child in this scene?');

c('abandoned', 'a character is left behind or sent away by someone they depend on', 'separation', 'tag (v9: not a strong event)',
  'HO 1/10 (10%, least-reliable list); dev 1/14; v9 gave it to Sonnet. "Depend on" is indirection and "left behind" is common in adventure plots. Ask for the spoken send-away and the summary word.',
  [
    p('abandoned.a', 'L', 'Does a character in `scene.lines` tell someone who depends on them to go away for good?',
      '"Run away and never return", "You\'re on your own", "I don\'t want you anymore", "Get out and don\'t come back", said by a parent, carer, owner, or guardian.',
      j('"Leave me alone" in a sulk is a no.', 'An ordinary goodbye or "see you tomorrow" is a no.', TEASE, SONG, TOLD),
      'abandoned = max(a, b).'),
    p('abandoned.b', 'S', 'Does `scene.summary` say that a character is abandoned, left behind, or sent away by a parent, carer, or owner?',
      'The summary names the carer and the leaving or sending away now.',
      j('Friends parting for the night or a trip together is a no.', 'Abandonment told as backstory is a no.'),
      'OR with a.'),
  ],
  'Is a character left behind or sent away by someone they depend on in this scene?');

c('family_in_danger', 'a character learns that a family member is in danger', 'separation', TAG,
  'Jev HO 1/2, AUC 0.73; dev 1/7; v9 gave it to Sonnet.',
  [
    p('family_in_danger.a', 'L', 'Does a character in `scene.lines` hear or say that a member of their family is in danger right now?',
      '"Your father is in trouble!", "They\'ve got your sister!", "Mama is trapped!"',
      j('Worry about a test, a job, or being late is a no.', TOLD, SONG),
      'family_in_danger = max(a, b).'),
    p('family_in_danger.b', 'S', 'Does `scene.summary` say that a character learns a family member is in danger, captured, or hurt?',
      'The summary names the news and the family member.',
      j(TOLD),
      'OR with a.'),
  ],
  'Does a character learn in this scene that a member of their family is in danger?');

c('parents_argue', 'a child\'s parents argue angrily', 'separation', TAG,
  '0 fires HO and dev (AUC 0.784).',
  [
    p('parents_argue.a', 'S', 'Does `scene.summary` say that a child\'s parents argue or shout at each other?',
      'The summary names both parents (or a mother and father) arguing now.',
      j('A parent arguing with a child is a no here.', 'Friendly bickering that ends in laughs is a no.'),
      'parents_argue = max(a, b).'),
    p('parents_argue.b', 'L', 'Do `scene.lines` show a mother and father shouting at each other?',
      'Angry lines between two characters who call each other "your mother", "your father", "honey", or "dear", with shouting captions.',
      j(TEASE, SONG),
      'OR with a.'),
  ],
  'Do a child\'s parents argue angrily with each other in this scene?');

// =====================================================================================
// HOSTILITY
// =====================================================================================
c('rages_at_child', 'an adult yells at a child in anger', 'hostility', 'tag; cancelled by the comic gate (v9 cancel.comic)',
  'HO 5/8 (63%), AUC 0.744; dev 1/3. Anger is the judgement; ask for the angry words said to a child.',
  [
    p('rages_at_child.a', 'LC', 'Does an adult in `scene.lines` shout angry words at a child?',
      '"How dare you!", "Go to your room!", "You never listen!", "Get out of my sight!" said to a young character (in `children`, or called a kid, son, daughter).',
      j('Urgent or worried shouting to keep a child safe ("Get down!") is a no.', 'Calm telling off is a no.', TEASE, SONG),
      'rages_at_child = max(a, b).'),
    p('rages_at_child.b', 'SC', 'Does `scene.summary` say that an adult shouts at, scolds angrily, or loses their temper with a child?',
      'The summary names the adult\'s anger at a young character now.',
      j(TOLD),
      'OR with a.'),
  ],
  'Does an adult yell at a child in anger in this scene?');

c(['threatens_harm', 'film:threatens'], 'a character threatens to kill or hurt another character', 'hostility', POL1,
  'HO 4/5 (80%, narrow set), AUC 0.688, but dev 5/31 (16%): the dev false fires are idioms and friendly jokes. v9 gave it to Sonnet (r5 Sonnet 12 hit / 6 miss). Round-5 R40 "a man tells a girl he will strike her down" (moana S024: "Stop that. I will smite you! You wanna get smote?") was lost when the fuzzy dark_magic was cut; a literal "says they will hurt" catches it. film:threatens bundled threaten+chase+attack per villain (HO 2/9, 22%): replace with the universal wording attributed by film presence.',
  [
    p('threatens_harm.a', 'L', 'Does a character in `scene.lines` say they will kill, hurt, eat, or destroy another character?',
      '"I will kill you", "I will smite you", "You\'ll pay for this with your life", "I\'m going to eat you", "No one talks to me like that and survives". A villain\'s song about killing someone counts.',
      j('"Mom is going to kill me", "you\'re toast", "I could kill for a snack" and other figures of speech are a no.', 'A warning that something else could hurt them is a no.', TEASE, 'A threat in a game or a play is a no.', 'Telling about a threat made earlier is a no.'),
      'threatens_harm = max(a, b, c). Film: <C>_threatens = max(summary <C>_attacks, threatens_harm.a AND present.<C> >= act) (attribution in code, not in the question).'),
    p('threatens_harm.b', 'LC', 'Is a child in `scene.lines` told they will be hurt or taken away?',
      '"I\'ll hurt you", "You\'ll never see your family again", "I\'ll take you away", said to a young character by someone who is not joking with them.',
      j(TEASE, 'A parent warning of a normal punishment ("no dessert") is a no.', 'A warning about a danger ("the stove will burn you") is a no.', TOLD),
      'OR with a, c; b also tags child_taken as possible.'),
    p('threatens_harm.c', 'S', 'Does `scene.summary` say that a character threatens to kill or hurt someone?',
      'The summary says a character threatens, menaces, or vows to harm another character now.',
      j('A threat told about is a no.', 'Teasing is a no.'),
      'OR with a, b.'),
  ],
  'Does a character seriously threaten to kill or hurt another character in this scene (not a joke, idiom, or game)?');

c('plots_harm', 'a character plans or orders the killing or hurting of another character', 'hostility', POL1,
  'HO 4/7 (57%), dev 4/32 (13%); r5 4 hit / 3 miss; r5sh Jev 7 fires / 2 hits vs Sonnet 3 / 2. The plan half is a scheme (fuzzy), the ORDER half is a literal line; split, and give the plan its own literal summary form.',
  [
    p('plots_harm.a', 'L', 'Does a character in `scene.lines` order others to kill, hurt, or seize another character?',
      '"Get him!", "Seize them!", "Kill it!", "Attack!", "Finish them off!", "Bring me her heart."',
      j('An order to fetch or bring someone back unharmed is a no.', 'Coaching in a game, sport, or practice is a no.', TEASE, 'Telling about an order given earlier is a no.'),
      'plots_harm = max(a, b, c).'),
    p('plots_harm.b', 'S', 'Does `scene.summary` say that a character plans, plots, or orders someone\'s death or harm?',
      'The summary names a plan or order to kill, hurt, or get rid of a character.',
      j('Planning a prank, a trick, an escape, or a wedding is a no.', 'A plan told as backstory is a no.'),
      'OR with a, c.'),
    p('plots_harm.c', 'L', 'Does a character in `scene.lines` say out loud that they plan to kill or hurt someone?',
      '"Once he\'s out of the way, the throne is mine", "Tonight she dies", "We\'ll get rid of him for good." A villain\'s song about it counts.',
      j('A plan to beat someone in a game or a contest is a no.', TEASE, FIGURE),
      'OR with a, b.'),
  ],
  'Does a character plan or order the killing or hurting of another character in this scene?');

c('mocked', 'a character is mocked or humiliated', 'hostility', TAG,
  'HO 6/13 (46%), AUC 0.743; dev 9/40; r5sh Jev 13 fires / 5 hits vs Sonnet 6 / 3. The miss pattern is friendly banter; ask for the insult and the summary word.',
  [
    p('mocked.a', 'L', 'Does a character in `scene.lines` call another character an insulting name or laugh at their failure?',
      '"Loser!", "Freak!", "Useless!", "Look at him, ha ha!" aimed at a character who is hurt or embarrassed.',
      j(TEASE, 'A villain gloating about winning is a no here.', SONG, TOLD),
      'mocked = max(a, b).'),
    p('mocked.b', 'S', 'Does `scene.summary` say that a character is mocked, teased cruelly, laughed at, or humiliated?',
      'The summary names the mocking now.',
      j('Friendly teasing is a no.', TOLD),
      'OR with a.'),
  ],
  'Is a character mocked or humiliated by others in this scene?');

c('excluded', 'a character is deliberately left out', 'hostility', TAG,
  'HO 2/11 (18%), AUC 0.713; dev 5/17; r5sh Jev 6 / 2 vs Sonnet 0 / 0. Book-of-life S021 (p 0.83, "Except for you, Manolo") is literally right but not a parent concern; tag only.',
  [
    p('excluded.a', 'L', 'Does a character in `scene.lines` tell someone they cannot join, play, or come along?',
      '"You can\'t play with us", "Not you", "You\'re not invited", "Go away, this is for us."',
      j('A safety rule ("You\'re too young to come on the boat") is a no.', TEASE, SONG, TOLD),
      'excluded = max(a, b).'),
    p('excluded.b', 'S', 'Does `scene.summary` say that a character is left out, shunned, or turned away by others on purpose?',
      'The summary names the exclusion now.',
      j(TOLD),
      'OR with a.'),
  ],
  'Is a character deliberately left out by others in this scene?');

c('discrimination', 'a character is treated badly because of who they are', 'hostility', TAG,
  'HO 0/2, dev 3/7, r5 Jev 0 / 3 (P&F S020 p 0.61: "less toothy... without scaring them", a friend\'s joke about an alligator). One literal insult.',
  [
    p('discrimination.a', 'LS', 'In `scene`, is a character insulted or refused because of their race, skin, body size, disability, looks, or where they come from?',
      'An insult or refusal that names the trait ("We don\'t serve your kind", "Go back where you came from", "Fatty").',
      j('A friend\'s joke about someone\'s teeth or size that both laugh at is a no.', 'A monster or predator being feared for what it does is a no.', TOLD, SONG),
      'discrimination = a.'),
  ],
  'Is a character insulted or treated badly because of their race, body, disability, or where they come from?');

c('caregiver_cruelty', 'a parent or caregiver is cruel to a child in their care', 'hostility', 'flag (strong event, no comic cancel)',
  'Jev HO 4/11 (36%), AUC 0.717; v9 gave it to Sonnet (r5 Sonnet 3 hit / 0 miss, sole reason in 2 book-of-life scenes). "Cruel" is the judgement: ask for the cruel acts and words a parent or carer does to the child in their care.',
  [
    p('caregiver_cruelty.a', 'SC', 'Does `scene.summary` say that a parent or carer locks up, hits, starves, or threatens the child in their care?',
      'The summary names the carer and the act against the child in their care now.',
      j('A fair punishment (grounded, no dessert) is a no.', 'A carer protecting the child from danger is a no.', TOLD),
      'caregiver_cruelty = max(a, b).'),
    p('caregiver_cruelty.b', 'LC', 'Does a parent or carer in `scene.lines` tell the child in their care they are worthless or will never be free?',
      '"You\'re nothing without me", "You will never leave this tower", "No one could ever love you", said to a young character in their care.',
      j(TEASE, 'Stern safety rules said kindly are a no.', SONG, TOLD),
      'OR with a.'),
  ],
  'Is a parent or caregiver cruel to a child in their care in this scene?');

c('betrayal', 'an adult a child trusts turns against them', 'hostility', TAG,
  'HO 5/10 (50%), AUC 0.724; dev 0/6; r5sh Jev 3 / 2 vs Sonnet 4 / 1.',
  [
    p('betrayal.a', 'S', 'Does `scene.summary` say that a character betrays, tricks, or turns against someone who trusted them?',
      'The summary names the betrayal now ("reveals he was working for the villain", "hands her over").',
      j('A surprise party or a harmless prank is a no.', TOLD),
      'betrayal = max(a, b).'),
    p('betrayal.b', 'L', 'Does a character in `scene.lines` accuse someone they trusted of lying or betraying them?',
      '"You lied to me!", "I trusted you!", "You betrayed me!", "It was you all along!"',
      j(TEASE, SONG, TOLD),
      'OR with a.'),
  ],
  'Does someone a character trusts turn against them in this scene?');

// =====================================================================================
// EERIE AND STARTLE
// =====================================================================================
c('transforms', 'a character is changed into something else', 'eerie', 'tag; transforms.a at act with a magic signal also sets harmful_magic (dark_magic)',
  'HO 0 fires (13% recall / 50% precision at 0.5), dev 2/3. "Something frightening" is a degree; ask for the change itself. P&F S011 / S015 (frog transformations) are exactly this.',
  [
    p('transforms.a', 'S', 'Does `scene.summary` say that a character is turned into, or changes into, a different creature or thing?',
      'The summary says a character becomes an animal, a monster, stone, a shadow, or another creature now ("transforms Naveen into a frog", "she turns into a frog herself").',
      j('Changing clothes, a disguise, a costume, or growing up is a no.', '"Changes her mind" is a no.', 'A change told as backstory is a no.'),
      'transforms = max(a, b).'),
    p('transforms.b', 'L', 'Does a character in `scene.lines` react to their own body changing right now?',
      '"What\'s happening to me?", "I\'m a frog!", "Look at my hands!", said as the change happens.',
      j('Trying on clothes or a mask is a no.', FIGURE, SONG, TOLD),
      'OR with a.'),
  ],
  'Is a character changed into something else (by magic, a curse, or science) in this scene?');

c('possessed', 'a character is controlled by someone else against their will', 'eerie', TAG,
  'HO 0/4, dev 0/6. Literal loss of control only.',
  [
    p('possessed.a', 'LS', 'In `scene`, is a character made to move or act by someone else\'s magic or control, against their will?',
      'The lines or summary show a character hypnotised, puppeted, or possessed now ("I can\'t stop my feet!", "He\'s under a spell!").',
      j('Being persuaded, ordered, or bribed is a no.', 'A puppet show is a no.', GAME, TOLD),
      'possessed = a.'),
  ],
  'Is a character controlled by someone else against their will in this scene?');

c('nightmare', 'a character has a nightmare', 'eerie', 'tag; also sets the imagined gate for the scene',
  '0 fires HO; dev 0/1.',
  [
    p('nightmare.a', 'S', 'Does `scene.summary` say that a character has a nightmare or a bad dream?',
      'The summary names the bad dream happening in this scene.',
      j('A daydream or a happy dream is a no.', 'A "dream" meaning a wish is a no.'),
      'nightmare = max(a, b).'),
    p('nightmare.b', 'L', 'Does a character in `scene.lines` wake up frightened or say they just had a bad dream?',
      '"It was just a bad dream", "I had a nightmare", a character waking with a scream caption.',
      j('A nightmare told about from another night is a no.', FIGURE),
      'OR with a.'),
  ],
  'Does a character have a nightmare in this scene?');

c('unseen_threat', 'characters sense something unseen near them', 'eerie', TAG,
  'HO 4/14 (29%), AUC 0.725; dev 8/52 (15%). Ask for the spoken sign.',
  [
    p('unseen_threat.a', 'L', 'Does a character in `scene.lines` ask who is there or say they hear something they cannot see?',
      '"Who\'s there?", "Did you hear that?", "Something\'s out there", "We\'re not alone."',
      j('Knocking at a door answered by a friend is a no.', 'Hide-and-seek is a no.', SONG, TOLD),
      'unseen_threat = a.'),
  ],
  'Do characters sense that something they cannot see is near them in this scene?');

c(['appears_suddenly', 'startled', 'jump_scare'], 'something frightening appears suddenly and startles a character (derived jump_scare)', 'eerie', 'tag (jump_scare = min(appears_suddenly, startled), never flags)',
  'appears_suddenly HO 3/10 (30%); startled HO 10/41 (24%, least-reliable list), dev 18/120. Both asked for a reaction; ask for the two literal pieces and keep the code min().',
  [
    p('appears_suddenly.a', 'L', 'Do `scene.lines` show something jumping out at a character without warning?',
      'A sudden ROAR or SHRIEK caption right before "Aah!", "Where did you come from?", something bursting out of water, a door, or the dark.',
      j('Someone arriving normally or being expected is a no.', nameNo('"boo"'), 'A surprise party is a no.', SONG),
      'appears_suddenly = a.'),
    p('startled.a', 'L', 'Does a sound caption in `scene.lines` show a character gasping, yelping, or screaming in surprise?',
      'GASPS, YELPS, SCREAMS, STARTLED SHOUT caption right after something happens.',
      j('A gasp at news, at a joke, or at something beautiful is a no.', 'A scream of excitement on a ride is a no.', NOISE),
      'startled = a; jump_scare = min(appears_suddenly.a, startled.a) in code.'),
  ],
  'Does something frightening appear suddenly and startle a character in this scene?');

// =====================================================================================
// DISTRESS
// =====================================================================================
c('child_frightened', 'a child is frightened or crying', 'distress', POL2,
  'Jev HO 1/8 (13%), dev 13/57 (23%), AUC 0.587: an emotion bundled with identifying the child (two hops). v9 gave it to Sonnet (r5 Sonnet 4 hit / 0 miss); rules child_terrified 10/19 for both systems, the weakest policy rule. Decompose into observable parts: the child\'s own words, the sound caption, the summary word, each with the verified `children` list in state so the child is not inferred.',
  [
    p('child_frightened.a', 'LC', 'Does a young character in `scene.lines` say they are scared or beg for help or for their parent?',
      '"I\'m scared", "Help me!", "Mommy!", "Daddy, where are you?", "Please don\'t hurt me", said by a character in `children` or one the lines call a kid, baby, or little one.',
      j('A child pretending to be scared in a game is a no.', 'A grown-up saying it is a no.', SONG, TOLD),
      'child_frightened = max(a, b, c) (flag, policy 2); comedy never cancels it.'),
    p('child_frightened.b', 'LC', 'Does a sound caption in `scene.lines` name a child crying, sobbing, whimpering, or screaming?',
      'CHILD CRYING, BABY WAILING, <child name> SOBS, a WHIMPERS caption on a line spoken by a young character.',
      j('A baby crying in the background with nobody reacting is a no.', 'Screams of fun on a ride or in a game are a no.', 'Laughing or giggling captions are a no.'),
      'OR with a, c.'),
    p('child_frightened.c', 'SC', 'Does `scene.summary` say that a child is frightened, terrified, crying, or in tears?',
      'The summary names a young character (in `children`, or a kid, cub, son, daughter) and their fear or tears now.',
      j('A child who is only surprised or startled for a moment is a no.', 'A child pretending to be scared is a no.', TOLD),
      'OR with a, b.'),
  ],
  'Is a child in this scene frightened or crying?');

c('afraid_for_safety', 'a character is afraid for their own or someone else\'s safety', 'distress',
  'flag only with the danger Score expected level >= 2 (v9 requires); physical gates apply',
  'Jev HO 7/42 (17%, least-reliable list), dev 26/144; r5 23 hit / 10 miss and the sole reason in moana S037 (Maui\'s song "We\'re dead soon") and S047. BUT cutting it lost R17 (book-of-life S040: roaring bull, PEOPLE SCREAMING, "Chakal is here!") and R29 (P&F S027: ghosts carry off the frog) (v9/narrow/out/rescore.log). The fear itself is the judgement; the spoken warning and plea are literal.',
  [
    p('afraid_for_safety.a', 'L', 'Does a character in `scene.lines` shout a warning to run, hide, or get away from a danger that is here?',
      '"Run!", "Look out!", "Get back!", "Hide!", "It\'s here!", "Chakal is here!" shouted as something arrives.',
      j('"Run along now" or "look out for each other" said calmly is a no.', GAME, SONG, TOLD),
      'afraid_for_safety = max(a, b, c AND danger Score >= 2); flags only when the danger Score expected level >= 2.'),
    p('afraid_for_safety.b', 'L', 'Does a character in `scene.lines` beg not to be hurt or cry for help?',
      '"Help!", "Please don\'t hurt me!", "Somebody help us!", "Save me!"',
      j('Asking for help with a chore or a puzzle is a no.', GAME, SONG, TOLD),
      'OR with a.'),
    p('afraid_for_safety.c', 'L', 'Does a sound caption in `scene.lines` show several people screaming or fleeing?',
      'PEOPLE SCREAMING, ALL SCREAMING, CROWD PANICKING, PEOPLE FLEEING.',
      j('A crowd cheering, laughing, or singing is a no.', 'Screams on a ride or at a party game are a no.', NOISE),
      'c counts only with the danger Score >= 2.'),
  ],
  'Is a character in this scene afraid for their own or someone else\'s safety?');

c('screams', 'a character screams', 'distress', 'tag only (never flags; supports afraid_for_safety.c)',
  'Least reliable of all: HO 5/36 (14%), dev 21/113. As a tag the literal caption is the right measure; its precision problem was that screams are not parent-guide items, not that Jev misread them.',
  [
    p('screams.a', 'L', 'Does a sound caption in `scene.lines` say that someone screams or shrieks?',
      'SCREAMS, SCREAMING, SHRIEKS, SHRIEKING caption.',
      j('Squealing with delight, whooping, or screaming on a ride is a no.', 'A scream inside a song is a no.'),
      'screams = a.'),
  ],
  'Does a character scream in this scene?');

c('crying', 'a character cries', 'distress', 'tag (a child crying flags through child_frightened; crying feeds grieving)',
  'Jev HO 2/8 (25%), AUC 0.578; dev 2/11; v9 gave it to Sonnet. Sobbing is literally captioned ((SOBBING) in book-of-life S033, moana S044); ask for the caption, the spoken "don\'t cry", and the summary word.',
  [
    p('crying.a', 'L', 'Does a sound caption in `scene.lines` say someone is crying, sobbing, weeping, or sniffling?',
      'CRYING, SOBBING, WEEPING, SNIFFLES, VOICE BREAKING caption.',
      j('Crying with laughter or a LAUGHING caption is a no.', '"Battle cry" and "cries out" meaning shouts are a no.', 'A baby crying in the background with nobody reacting is a no.'),
      'crying = max(a, b, c).'),
    p('crying.b', 'L', 'Does a character in `scene.lines` tell someone not to cry or ask why they are crying?',
      '"Don\'t cry", "Why are you crying?", "Stop crying", "It\'s okay, let it out."',
      j('"Don\'t cry wolf" and "for crying out loud" are a no.', SONG, TOLD),
      'OR with a, c.'),
    p('crying.c', 'S', 'Does `scene.summary` say that a character cries, weeps, sobs, or is in tears?',
      'The summary names the crying now.',
      j('Tears of joy at a wedding or a reunion are a no.', TOLD),
      'OR with a, b.'),
  ],
  'Is a character crying in this scene?');

c('despair', 'a character gives up hope', 'distress', TAG,
  'Jev HO 1/3 (33%), AUC 0.752, 35% recall at 0.5; dev 0/11; v9 gave it to Sonnet. Trap from book-of-life S021: comic romantic despair ("It\'s hopeless. I\'ve lost her to Joaquin").',
  [
    p('despair.a', 'L', 'Does a character in `scene.lines` say they give up or that there is no hope left?',
      '"It\'s hopeless", "I give up", "I can\'t do it", "It\'s over, we\'re finished", "Choose someone else."',
      j('Giving up on a game, a crush, a date, or a song is a no.', TEASE, SONG, TOLD),
      'despair = max(a, b).'),
    p('despair.b', 'S', 'Does `scene.summary` say that a character despairs, loses hope, or gives up?',
      'The summary names it ("Moana despairs... and loses hope").',
      j(TOLD),
      'OR with a.'),
  ],
  'Does a character give up hope in this scene?');

// =====================================================================================
// ANIMALS
// =====================================================================================
c('animal_cruelty', 'a character deliberately hurts or mistreats an animal', 'animals', LOSS,
  'HO 0/1, dev 3/3 (100%); r5 1 hit / 0 miss.',
  [
    p('animal_cruelty.a', 'S', 'Does `scene.summary` say that a character hits, kicks, traps, or hurts an animal on purpose?',
      'The summary names the act against an animal now (a hunter wounding a creature, a villain kicking a dog).',
      j('Catching a fish to eat, a vet treating an animal, or an animal fighting back in self-defence is a no.', 'A monster attacked while it attacks people is a no here.', TOLD),
      'animal_cruelty = max(a, b).'),
    p('animal_cruelty.b', 'L', 'Does a character in `scene.lines` beg someone to stop hurting an animal?',
      '"Leave him alone, you\'re hurting him!", "Stop, don\'t hit the dog!", "Let the bird go!"',
      j('An animal character that talks and is being teased in play is a no.', TEASE, SONG, TOLD),
      'OR with a.'),
  ],
  'Does a character deliberately hurt or mistreat an animal in this scene?');

c('animal_in_danger', 'an animal (not a talking character) is in danger', 'animals', 'tag (v9: not a strong event)',
  'dev 19/20 (95%) but HO 0/6 (least-reliable list): "does not talk" needs story context (moana S047 Heihei p 0.66 is literally right). Ask for pets and wild animals by name; code drops animals that are speaking cast members (verified kind = animal and the name speaks in the lines).',
  [
    p('animal_in_danger.a', 'S', 'Does `scene.summary` say that a pet, farm animal, or wild animal is in danger, trapped, hunted, or hurt?',
      'The summary names the animal and the danger now ("Heihei falls overboard", "the dog is hit by a car").',
      j('A talking animal character is a no here.', TOLD),
      'animal_in_danger = max(a, b), minus scenes where the animal is a speaking cast member (code).'),
    p('animal_in_danger.b', 'L', 'Does a character in `scene.lines` shout that a pet or animal is in danger?',
      '"Heihei, no!", "The puppy\'s drowning!", "Save the horse!"',
      j('A character joking that an animal will be dinner is a no.', SONG, TOLD),
      'OR with a.'),
  ],
  'Is an animal that does not talk in danger in this scene?');

// =====================================================================================
// COPYABLE RISK
// =====================================================================================
c('dangerous_act', 'a child deliberately does something dangerous', 'copyable', TAG,
  'HO 2/9 (22%), AUC 0.635; dev 2/14. Two literal channels: the summary act, and an adult\'s spoken stop.',
  [
    p('dangerous_act.a', 'SC', 'Does `scene.summary` say that a child climbs somewhere high, jumps off something, plays with fire, or goes into deep water on purpose?',
      'The summary names the young character and the risky act now.',
      j('A grown-up doing it is a no.', 'A child pushed or forced is a no (child_in_danger).', TOLD),
      'dangerous_act = max(a, b).'),
    p('dangerous_act.b', 'LC', 'Does someone in `scene.lines` tell a child to stop doing something dangerous right now?',
      '"Get down from there!", "Don\'t touch that!", "Come back from the edge!", said to a young character.',
      j('"Don\'t touch my stuff" is a no.', TEASE, SONG, TOLD),
      'OR with a.'),
  ],
  'Does a child deliberately do something dangerous in this scene?');

c('runs_away', 'a child runs away from home', 'copyable', TAG,
  'HO 0/2 (AUC 0.683).',
  [
    p('runs_away.a', 'SC', 'Does `scene.summary` say that a child runs away from home or sneaks away from their parent or carer?',
      'The summary names the young character leaving home or their carer without permission now.',
      j('A child sent on an errand is a no.', 'Running away from a monster is a no here (chased).', TOLD),
      'runs_away = max(a, b).'),
    p('runs_away.b', 'LC', 'Does a young character in `scene.lines` say they are running away or leaving home?',
      '"I\'m running away!", "I\'m never coming back!", "I\'m leaving and you can\'t stop me."',
      j(GAME, SONG, TOLD),
      'OR with a.'),
  ],
  'Does a child run away from home in this scene?');

c('goes_with_stranger', 'a child goes off with a stranger', 'copyable', TAG,
  'HO 0/2.',
  [
    p('goes_with_stranger.a', 'SC', 'Does `scene.summary` say that a child goes off with someone they have just met?',
      'The summary names the young character leaving with a person they did not know before this scene.',
      j('Going with a parent, a teacher, or a known friend is a no.', TOLD),
      'goes_with_stranger = max(a, b).'),
    p('goes_with_stranger.b', 'LC', 'Does someone the child does not know invite the child in `scene.lines` to come with them?',
      '"Come with me, little one", "Follow me, I\'ll show you", "Get in, I\'ll take you to your mom."',
      j('An invitation from a parent or known carer is a no.', SONG, TOLD),
      'OR with a.'),
  ],
  'Does a child go off with a stranger in this scene?');

c('slapstick', 'a character is hit or hurt for laughs', 'copyable', TAG,
  'HO 2/9 (22%), AUC 0.781; dev 7/33. As a TAG (never a flag) the literal bonk-then-laugh pattern is what parents filter on.',
  [
    p('slapstick.a', 'L', 'Does a crash, bonk, or thud in `scene.lines` get a laugh or a joke in the next lines?',
      'A CRASH, BONK, THUD, or GRUNTS caption followed by LAUGHING, "Nice one!", "I\'m okay!", or a punchline.',
      j('A blow followed by pain, crying, or someone asking for help is a no.', NOISE),
      'slapstick = max(a, b).'),
    p('slapstick.b', 'S', 'Does `scene.summary` say that a character is comically hit, falls over, or gets hurt as a joke?',
      'The summary uses a comic word for the hurt ("comically", "slapstick", "bumbling", "crashes into").',
      j('A serious injury is a no.', TOLD),
      'OR with a.'),
  ],
  'Does a character get hit or hurt in a way that is played for laughs in this scene?');

c(['comic_peril', 'laughs (Score) gate'], 'danger played for laughs (the comic gate for policy 3)', 'copyable',
  'GATE: when on, physical events become tags (policy 3); it never cancels threats (policy 1), child fear (policy 2), or loss events',
  'comic_peril HO 0/1 (AUC 0.801, 67% recall at 0.5); dev 2/8. v9 needed comic_peril Noul + laughs Score + a danger cap and still let the book-of-life S021 serenade (cannot_breathe 0.92 on a cough) flag. The summary literally says "try comically" there; the aftermath "I\'m okay!" is literal too.',
  [
    p('comic_peril.a', 'L', 'After the danger in `scene.lines`, does the character who was in danger joke, laugh, or say they are fine?',
      '"I\'m okay!", "Nailed it!", "Ta-da!", a LAUGHING caption, or a punchline from that character right after the fall, bump, or scare.',
      j('A character who is hurt, crying, or calling for help after the danger is a no.', 'A joke by someone else while the character is still in danger is a no.', 'A scene where nobody is in danger is a no.'),
      'comic_gate = (a >= act OR b >= act) AND laughs Score >= 2 AND danger Score < 2.5 (v9 danger_max kept).'),
    p('comic_peril.b', 'S', 'Does `scene.summary` describe the danger or the trouble in this scene with a comic word?',
      '"comically", "slapstick", "bumbling", "hilariously", "clumsily" about the trouble a character is in.',
      j('A funny moment in a scene whose danger the summary tells straight is a no.'),
      'OR with a (then the Score conditions).'),
  ],
  'Is the danger, fighting, or hurt in this scene played for laughs, so a young viewer would read it as a gag rather than a threat?');

// =====================================================================================
// MODIFIERS (scene-level gates)
// =====================================================================================
c('retold (mod.retold)', 'the scene\'s dangerous events are only told about, not happening', 'modifier',
  'GATE: cancels physical events (and film child / danger items) when on; never cancels threats spoken in the scene',
  'v9 needed mod.retold at 0.95 plus danger-Score mass >= 0.80 because the literal Noul fired on any recollection in a long scene (Nemo S013/S020, MI S043 lost live events; policy _retold_change_v5_1). Every Jev-first event question above already excludes telling / remembering / planning INSIDE its criteria, so the gate is a safety net. Keep the two literal pieces.',
  [
    p('retold.a', 'L', 'Is a character in `scene.lines` telling others about something that happened at another time or place?',
      '"Once upon a time...", "Long ago...", "I remember when...", "Let me tell you what happened...", a story told to children.',
      j('Characters talking about what is happening in front of them right now is a no.', 'A plan for later is a no here.'),
      'retold_gate = max(a, b) >= 0.95 AND danger Score mass on levels 0-1 >= 0.80 (v9 rule kept).'),
    p('retold.b', 'S', 'Does `scene.summary` say that a character tells, narrates, recounts, or shows a story of past events?',
      'The summary frames the scene as a telling ("Gramma Tala narrates the myth", "Beth tells the kids").',
      j('A summary of events happening now is a no.'),
      'OR with a.'),
  ],
  'Are the dangerous events of this scene only told about, remembered, sung about, or planned, rather than happening on screen now?');

c('imagined (mod.imagined)', 'the scene is a dream, daydream, vision, or game of pretend', 'modifier',
  'GATE: cancels every flag including threats (v9 cancel sets)',
  'mod.imagined kept at modifier_act 0.70; nightmare HO 0 fires, dev 0/1. Literal waking line + summary frame.',
  [
    p('imagined.a', 'S', 'Does `scene.summary` say that the events of this scene are a dream, a daydream, a vision, a play, or a game of pretend?',
      'The summary frames the scene as imagined or staged ("dreams that...", "the children act out", "a vision shows").',
      j('A character\'s wish or ambition ("dreams of opening a restaurant") is a no.'),
      'imagined_gate = max(a, b) >= 0.70.'),
    p('imagined.b', 'L', 'Does a character in `scene.lines` wake up and say it was only a dream, or call the action a game or pretend?',
      '"It was just a dream", "Wake up, you were dreaming", "It\'s only pretend", "Let\'s play pirates."',
      j('"Dream on" and "a dream come true" are a no.', SONG),
      'OR with a.'),
  ],
  'Is this scene a dream, nightmare, daydream, vision, or game of pretend?');

// =====================================================================================
// FILM-SPECIFIC TEMPLATES (generated per film from verified cast and dangers)
// =====================================================================================
c('film:presence (fpl/fps.<C>_present)', '<name> is in the scene', 'per film item',
  'context only (attribution for threats; never flags)',
  'film:presence HO 108 fires, recall 64%; precision 21% is not meaningful for who is on screen. Kept as the ATTRIBUTION half of film threats, generated for verified villain / threat / child / frightening cast.',
  [
    p('film_presence.a', 'LN', 'Does <name> speak, get spoken to, or get seen by others in `scene.lines`?',
      'A line is said by <name> (speaker label) or to <name> by name or verified alias, or a character reacts to <name> being there.',
      j('The lines only talk about <name>, remember <name>, or do not mention <name>.', 'A common word that is part of the name is a no.'),
      'present.<C> = max(a, b).'),
    p('film_presence.b', 'SN', 'Does `scene.summary` say that <name> is in this scene?',
      'The summary has <name> there: seen, met, heard, or acting.',
      j('The summary only has characters talk about <name>.'),
      'OR with a.'),
  ],
  'Is <name> in this scene?');

c('film:threatens (fe.<C>_threatens)', '<villain> threatens, chases, or attacks someone', 'per film item', POL1,
  'film:threatens HO 2/9 (22%), dev 2/22 (9%), r5 C* 6 hit / 3 miss: the per-name question bundles three acts and asks Jev to attribute unlabelled subtitle lines to a speaker (indirection). Split: the act in the summary names the villain; the spoken threat comes from the universal threatens_harm.a and is attributed by film presence in code.',
  [
    p('film_threatens.a', 'SN', 'Does `scene.summary` say that <name> attacks, chases, captures, or threatens a character?',
      'The summary names <name> doing one of those to someone now.',
      j('<name> only talking, scheming alone, or being talked about is a no.', TOLD),
      '<C>_threatens = max(a, threatens_harm.a AND present.<C> >= act, plots_harm.a AND present.<C> >= act).'),
    p('film_threatens.b', 'LN', 'Does a line in `scene.lines` said to <name>\'s face beg <name> to stop or not hurt them?',
      '"Please, <name>, don\'t!", "Let her go, <name>!", "Stay away from us, <name>!"',
      j(TEASE, SONG, TOLD),
      'OR with a (attribution without speaker labels: the victim names the villain).'),
  ],
  'Does <name> threaten, chase, or attack someone in this scene?');

c('film:child_in_danger (fe.<C>_in_danger)', '<child> is in physical danger', 'per film item', PHYS,
  'HO 12/17 (71%), dev 26/52 (50%), r5 C01 3 hit / 2 miss. Keep; it is the per-name form of the second-most reliable universal question.',
  [
    p('film_child_in_danger.a', 'LSN', 'In `scene`, is <name> in physical danger?',
      '<name> is attacked, chased, falling, caught in fire, water, or a storm, or held by a creature or villain now.',
      j('<name> playing, pretending, or being told off is a no.', '<name> worried about someone else in danger is a no.', LAUGHOFF, TOLD, SONG),
      'child_in_danger (universal) = max(universal a, every <C>_in_danger).'),
  ],
  'Is <name> (a child) in physical danger in this scene?');

c('film:danger (fe.<D>_endangers)', '<danger> is used on, or attacks, a character', 'per film item', PHYS,
  'HO 11/21 (52%), dev 24/45 (53%), r5 D* 12 hit / 1 miss (P&F D02 "Alligators in the bayou" in S024, the friendly alligator). "Used on OR puts in danger" is a judgement; narrow to the act, and generate only for creature-group and object dangers (moana D01 "the reef and open ocean" and P&F D05 "Mardi Gras wedding deadline" are places / situations the universal events already cover).',
  [
    p('film_danger.a', 'LSN', 'In `scene`, does <danger> attack, hit, or get used against a character?',
      'The lines, captions, or summary show <danger> acting on a character now: biting, grabbing, striking, or being fired, thrown, or swung at them.',
      j('<danger> only seen, nearby, talked about, or feared is a no.', FRIENDLY, TOLD, SONG),
      '<D>_endangers = a; creature-group dangers also feed creature_threat.'),
  ],
  'Is <danger> used on a character, or does it attack a character, in this scene?');

// =====================================================================================
// write
// =====================================================================================
const v9ids = new Set([...PRESENCE.map((x) => x.id), ...EVENTS.map((x) => x.id), ...Object.keys(DERIVED)]);
const covered = new Set(C.flatMap((x) => x.ids));
const missing = [...v9ids].filter((id) => !covered.has(id));
if (missing.length) throw new Error(`uncovered v9 ids: ${missing.join(', ')}`);
const sonnetAsked = Array.isArray(split.sonnet_asked) ? split.sonnet_asked : Object.keys(split.sonnet_asked);
const sonnetMissing = sonnetAsked.filter((id) => !covered.has(id));
if (sonnetMissing.length) throw new Error(`uncovered sonnet_asked ids: ${sonnetMissing.join(', ')}`);
for (const k of Object.keys(MODIFIERS)) if (![...covered].some((id) => id.startsWith(k))) throw new Error(`modifier ${k} uncovered`);
for (const x of C) {
  if (!x.phrasings.length || x.phrasings.length > 3) throw new Error(`${x.concept}: ${x.phrasings.length} phrasings`);
  for (const ph of x.phrasings) for (const f of ['id', 'question', 'yes_criteria', 'no_criteria', 'combine']) if (!ph[f]) throw new Error(`${ph.id} missing ${f}`);
}

const out = {
  written_at: new Date().toISOString(),
  author: 'claude (Jev-first concept phrasings; no model calls)',
  user_goal: 'Rely on Jev MORE: specific, observable, single-condition questions about what is SAID or HEARD (lines, sound captions) or stated in the verified summary; Sonnet only as fallback.',
  source_question_set: 'v9/questions.js v6.0 (PRESENCE, mention m.*, EVENTS, DERIVED jump_scare, MODIFIERS), film templates (filmQuestions), v9/split.json split-v9.1 sonnet_asked (all covered).',
  evidence_keys: {
    HO: 'round-4 held-out (tangled, coco, how-to-train-your-dragon), v8/scorecard/scorecard.md per-question table: right fires / fires at 0.7 (precision proxy, a LOWER bound), AUC',
    dev: 'same table on the 7 dev films',
    r5: 'round 5 (book-of-life, princess-and-the-frog = P&F, moana) flag-reason tally hit / miss, v10/distill/round5-fp-reasons.txt',
    r5sh: 'round-5 shadow split, Jev fires / hits vs Sonnet, v9/round5/out/shadow-split.json',
    narrow: 'v9/narrow/out/rescore.json + rescore.log: moments lost when only the 9 precise Jev questions were kept (8 of 102)',
    v3b: 'TAXONOMY-V3.md v3a->v3b wording fixes (monster Nemo 24->0, ghost on Boo 7->0, alien on Boo 28->0)',
    typesafe: 'v4/verify/docs/model-jaggedness_jev-1.13.md (literal reading, indirection, bundled judgements: split into literal questions, combine in code), primitives_noul.md',
  },
  states: {
    L: 'lines request: { film.title, scene.lines } (numbered subtitle lines incl. sound captions). For non-threat event questions code removes lyric lines (a music sign, or the run of lines after a (SINGING) caption until the next caption or speaker label); threat questions (threatens_harm, plots_harm) keep them, because a villain\'s song about killing counts (policy 1).',
    S: 'summary request: { scene.summary } (verified sentences only) and the verified setting. Nothing else (minimal relevant state).',
    LS: 'lines + summary together (only for acts that are equally visible in either; v9 channel practice).',
    C: 'adds { children: verified is_child cast names + verified aliases } so "a child" is read, not inferred (removes one hop of indirection).',
    N: 'adds { name: the one cast member or danger + verified aliases }.',
  },
  shared_trap_no_cases: { TOLD, SONG, GAME, LAUGHOFF, FRIENDLY, SETTING, FIGURE, COUGH, TEASE, NOISE, NAME: nameNo('<the word>') },
  code_rules: {
    thresholds: 'unchanged: act 0.70 flags, band_low 0.40 possible (shown, never flags). Each phrasing has its own threshold override slot (policy overrides) but none is set before held-out evidence.',
    combine: 'Each concept = the combine rule on its phrasings (mostly max over channels; AND where a signal only confirms). Several narrow Nouls jointly stand for one concept (TypeSafe decomposition).',
    gates: 'comic_gate (policy 3), retold_gate, imagined_gate as defined in their concepts. Physical events become tags when a gate is on; loss events ignore comedy; threats and child fear ignore comedy and retold (policy 1, 2).',
    songs: 'Lyric lines are removed from the lines state for non-threat events (see states.L), so a sung "We\'re dead soon" (moana S037) or "I\'m a creep" (book-of-life S019) cannot reach a death or fear question.',
    presence_never_flags: 'Presence items are tags; they reach a flag only through an act (creature_threat, weapon_used, caught_in_hazard).',
    attribution: 'Film villain threats: universal spoken-threat Noul AND film presence of the villain (code), not a per-name question over unlabelled lines.',
  },
  selection_rule_next_round: 'Every phrasing is a Jev candidate. Measure each on held-out films against human keys at 0.7. A concept stays with Jev if its combined phrasings are not worse than Sonnet on recall and precision (split.json rule, one-count tolerance). A phrasing that fires >= 4 times at < 0.5 precision is dropped from its bundle; only when EVERY phrasing of a concept fails does its sonnet_fallback question go to Sonnet.',
  counts: {
    concepts: C.length,
    phrasings: C.reduce((n, x) => n + x.phrasings.length, 0),
    v9_ids_covered: `${[...v9ids].filter((i) => covered.has(i)).length}/${v9ids.size}`,
    sonnet_asked_covered: sonnetAsked.length,
  },
  concepts: C.map(({ ids, ...x }) => ({ ...x, v9_ids: ids })),
};
const file = path.join(here, 'claude-concepts.json');
fs.writeFileSync(file, JSON.stringify(out, null, 1) + '\n');
console.log(`wrote ${file}: ${out.counts.concepts} concepts, ${out.counts.phrasings} phrasings; v9 ids covered ${[...v9ids].filter((i) => covered.has(i)).length}/${v9ids.size}; sonnet_asked covered ${sonnetAsked.length}/${sonnetAsked.length}`);
