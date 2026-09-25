#!/usr/bin/env node
// Builds v10/distill/claude-proposal.json: the Claude proposal for a DISTILLED question set.
// Pure data + a coverage check (every current question in v9/questions.js must be decided). No model calls.
//
// Evidence abbreviations used in `evidence` strings:
//   HO   = round-4 held-out films (tangled, coco, how-to-train-your-dragon), v8/scorecard/scorecard.md
//          "Per question (Jev)" table, fires and precision proxy at 0.7 (hits = round(prec x fires)).
//   dev  = round-4 dev films (7), same table in the DEV section.
//   r5   = round 5 (v9, held-out book-of-life, princess-and-the-frog, moana), v9/round5/fp-reasons.mjs
//          reason tally "hit/miss" over flagged scenes (a scene is a hit when its skip holds >= 50% of a
//          should_flag key item; reasons co-occur, so a reason's hit can be carried by another reason).
//   r5sh = round-5 shadow Jev-vs-Sonnet per question, v9/round5/out/shadow-split.json (fires / hits).
//   stageB = v9/split.json groups_stage_b (Jev vs Sonnet on the round-4 keys, v9.1 split decision).
//   narrow = v9/narrow/jev-set.json (rule: HO precision >= 0.75 on >= 4 fires).
import fs from 'node:fs';
import path from 'node:path';
import { PRESENCE, EVENTS, MODIFIERS, SCORES } from '../../v9/questions.js';

const HERE = path.dirname(new URL(import.meta.url).pathname);
const OUT = path.join(HERE, 'claude-proposal.json');

// ---------------------------------------------------------------------------------------------
// Shared no-case sentences: the known traps, written as LITERAL forms a reader can see in the lines.
// Each Jev question repeats only the ones that apply (question text is billed per scene).
// ---------------------------------------------------------------------------------------------
const T = {
  told: 'A character telling about it, remembering it, planning it, warning about it, or imagining it is a no.',
  song: 'A sung line (marked with a music sign) that describes it is a no, unless the spoken lines or sound captions around the song show it happening.',
  game: 'A game, sport, race, dance, practice, or pretend play is a no.',
  laughOff: 'A tumble, bonk, or pratfall that the characters laugh at or shrug off in the next lines is a no.',
  friendly: 'A friendly or comic creature that plays, helps, talks, jokes, or sings with the characters is a no, even if it is big or scary-looking.',
  setting: 'Magic or an afterlife that is only the world the story is set in is a no.',
  figure: 'A figure of speech is a no.',
};
const join = (...p) => p.filter(Boolean).join(' ');

// Scene-level Sonnet gates referenced by the Jev code rules.
const GATE = 'physical gate: flags only when Sonnet sn.played_for_laughs < act AND sn.told_not_happening < act AND sn.dream_or_pretend < act (code)';

// ---------------------------------------------------------------------------------------------
// JEV — very narrow, single-condition, answerable in seconds from the scene's lines and sound
// captions (plus the verified summary where stated). Owner jev.
//   state: the ONLY fields sent. lines = numbered subtitle lines incl. sound captions;
//          summary = verified summary sentences; children = verified is_child names of the film.
// ---------------------------------------------------------------------------------------------
const JEV = [
  {
    id: 'j.battle', replaces: ['battle'], group: 'violence', state: ['lines', 'summary'],
    question: 'In `scene`, are many characters fighting each other at the same time?',
    yes: 'The lines, sound captions, or summary show a fight between groups happening now: battle cries, orders to charge or attack, clashing weapons, several characters struck or falling.',
    no: join('Two characters fighting alone is a no.', T.game, 'A food fight or pillow fight is a no.', 'A battle that is told about, remembered, planned, painted, acted in a play, or sung about is a no.'),
    flag_use: `flag (strong event); ${GATE}`,
    evidence: 'narrow set member. HO 8/8 right (100%, Wilson lo 0.676, best-ranked), dev 6/7 (86%), r5 Jev reason 6 hit / 0 miss. Unchanged condition; only the no-cases are made literal.',
  },
  {
    id: 'j.weapon_at_character', replaces: ['weapon_used'], group: 'violence', state: ['lines', 'summary'],
    question: 'In `scene`, is a weapon fired, swung, or thrown at a character?',
    yes: 'A line, sound caption, or the summary shows a gun, bow, spear, sword, axe, knife, bomb, or cannon used against a character now: a shot, a swing, a throw, a strike (a gunshot caption with someone shot at, "He is shooting at us!", "Fire!" followed by shots).',
    no: join('A weapon that is only carried, shown, polished, sold, or pointed without being used is a no.', 'Shooting or throwing at targets or practice dummies is a no.', 'A toy, water pistol, pillow, or snowball is a no.', T.told),
    flag_use: `flag (strong event); ${GATE}`,
    evidence: 'narrow set member. HO 3/4 (75%), dev 2/4 (50%). Honest caveat: stageB violence favoured Sonnet (caught 29/147 vs 11/147, precision 0.72 vs 0.63) and r5 Sonnet weapon_used was 8 hit / 1 miss. Kept for Jev because it is a literal observable act; it must beat Sonnet on the next held-out round or go back to Sonnet.',
  },
  {
    id: 'j.hits_character', replaces: ['attacked'], group: 'peril', state: ['lines', 'summary'],
    question: 'In `scene`, does one character hit, kick, bite, choke, or throw down another character?',
    yes: 'A line, sound caption, or the summary shows the blow made now (a punch or thud caption with a cry of pain, "Let go of me!", "Stop, you are hurting me!").',
    no: join('A hug, tickle, high five, playful shove, or wrestling in a game is a no.', T.laughOff, 'An animal or monster attacking is a no here (it is asked separately).', T.told),
    flag_use: `flag (strong event); ${GATE}`,
    evidence: 'Not in the narrow set: HO 5/9 (56%), dev 4/8 (50%), but r5 Jev reason 5 hit / 0 miss. Narrowed from "physically attack" (degree + intent) to named body actions; kept because peril stage A Jev recall 0.729 vs live 0.724 and the r5 misses are all elsewhere. Trial.',
  },
  {
    id: 'j.creature_attacks', replaces: ['creature_threat'], group: 'peril', state: ['lines', 'summary'],
    question: 'In `scene`, does an animal or creature attack or try to catch a character?',
    yes: 'A line, sound caption, or the summary shows it biting, clawing, grabbing, charging, lunging at, swallowing, or chasing a character now (a roar caption while someone runs or screams, "It is coming for us!", "Run!").',
    no: join(T.friendly, 'Growling or roaring with no move toward a character is a no.', 'A person, robot, or machine is a no here.', 'A creature scaring someone as a job, a prank, or a game is a no.', T.told),
    flag_use: `flag (strong event); ${GATE}. Also triggers the j.kind Choice.`,
    evidence: 'narrow set member. HO 6/7 (86%), dev 22/27 (82%), r5 9 hit / 4 miss; the misses include princess-and-the-frog S024 (bayou with the friendly alligator: spider_insect, large_predator, creature_threat all fired) and moana S048/S049. "Threaten" (a judgement) is dropped for "attack or try to catch" (an act); the friendly-creature no-case targets S024.',
  },
  {
    id: 'j.chased', replaces: ['chased'], group: 'peril', state: ['lines', 'summary'],
    question: 'In `scene`, is a character running away from someone who is trying to catch them?',
    yes: 'The lines, sound captions, or summary show a pursuit happening now ("Get them!", "After him!", "They are following us!", running-footsteps captions with shouting).',
    no: join('Tag, a race, hide-and-seek, or chasing a ball or a pet for fun is a no.', 'A chase where the chaser keeps slipping or bumping into things while the characters joke through it is a no.', T.told, T.song),
    flag_use: `flag (strong event); ${GATE}`,
    evidence: 'Not in the narrow set: HO 3/6 (50%), dev 22/34 (65%), r5 7 hit / 3 miss (princess-and-the-frog S016, S024; moana S048). Kept for Jev because pursuit is audible in the lines; precision is expected from the literal no-cases plus the Sonnet comic gate. Trial.',
  },
  {
    id: 'j.caught_in_hazard', replaces: ['caught_in_hazard', 'dangerous_machine'], group: 'peril', state: ['lines', 'summary'],
    question: 'In `scene`, is a character caught in fire, rushing water, a storm, a collapse, or a machine right now?',
    yes: 'The lines, sound captions, or summary show a character inside or under the force now: flames around them, swept by a wave or current, hit by wind, lightning, or falling rock, a building or cave collapsing on them, pulled into moving machinery ("The ship is going down!", "The cave is collapsing!", "I cannot swim!").',
    no: join('The force only nearby, seen from a safe place, or over before the characters arrive is a no.', 'Ordinary rain, a candle, a campfire, a stove, a bath, or a swim for fun is a no.', T.setting, T.told, T.song),
    flag_use: `flag (strong event); ${GATE}. The only path by which fire, explosion, storm, and machinery flag.`,
    evidence: 'narrow_ge3 member. HO 3/3 (100%), dev 16/21 (76%), r5 3 hit / 0 miss. dangerous_machine presence (HO 1/1, dev 12/21, 57%; asks "could hurt", a hypothetical) is folded in as "pulled into moving machinery".',
  },
  {
    id: 'j.falls', replaces: ['falls'], group: 'peril', state: ['lines', 'summary'],
    question: 'In `scene`, does a character fall from a height?',
    yes: 'The lines, sound captions, or summary show a character falling off a cliff, roof, tree, bridge, ship, or out of the sky now (a scream as they fall then a splash or thud, "She is falling!", "Catch him!").',
    no: join('Tripping, slipping, or tumbling on flat ground or onto a bed, floor, or pile is a no.', 'Jumping on purpose into water for fun, diving, gliding, or flying is a no.', T.laughOff, T.told),
    flag_use: `flag (strong event); ${GATE}`,
    evidence: 'HO 1/1, dev 2/4, r5 1 hit / 0 miss, AUC 0.821 HO. Thin but literal and audible. Trial.',
  },
  {
    id: 'j.hangs_over_drop', replaces: ['nearly_falls'], group: 'peril', state: ['lines'],
    question: 'In `scene`, is a character hanging on to keep from falling from a height?',
    yes: 'The lines show a character dangling from a ledge, rope, branch, or edge ("Hold on!", "Do not let go!", "Grab my hand!", "I am slipping!").',
    no: join('Climbing or swinging for fun with nobody worried about falling is a no.', '"Hold on" meaning "wait" is a no.', T.told),
    flag_use: `flag (strong event); ${GATE}`,
    evidence: 'HO 0 fires (2 items missed at 0.5-0.7), dev 1/2, AUC 0.796 HO. Weakest keeper: the cue phrases are verbal, which is why it stays with Jev on the lines only. Drop after the next round if it does not fire usefully.',
  },
  {
    id: 'j.cannot_breathe', replaces: ['cannot_breathe'], group: 'peril', state: ['lines', 'summary'],
    question: 'In `scene`, is a character unable to breathe?',
    yes: 'The lines, sound captions, or summary show a character drowning or stuck underwater, being choked or strangled, trapped in smoke, or out of air now (gasping or choking captions with "He cannot breathe!", "Help, I am drowning!").',
    no: join('A cough, sneeze, hiccup, or choke on food or drink that clears at once or is a gag is a no.', 'Being out of breath from running, singing, laughing, or excitement is a no.', 'Holding breath on purpose to swim or hide is a no.', '"You take my breath away" and other figures of speech are a no.', T.told),
    flag_use: `flag (strong event); ${GATE}`,
    evidence: 'HO 2/2, dev 5/5 (100%), r5 0 hit / 1 miss: book-of-life S021 (mariachi friends\' comic serenade scene, a comic cough, p 0.92). The cough/gag no-case is written for exactly that miss.',
  },
  {
    id: 'j.child_in_danger', replaces: ['child_in_danger', 'film:child_in_danger'], group: 'peril', state: ['lines', 'summary', 'children'],
    question: 'In `scene`, is a child in physical danger?',
    yes: 'A child (a name in `children`, or a character the lines call a kid, baby, son, daughter, little girl, or little boy) is attacked, chased, falling, caught in fire, water, or a storm, or held by a creature or villain now.',
    no: join('A child playing, pretending, or being told off is a no.', 'A child worried about a grown-up who is in danger is a no.', 'A grown-up in danger is a no.', T.laughOff, T.told, T.song),
    flag_use: `flag (strong event); ${GATE}`,
    evidence: 'narrow set member. HO 11/13 (85%), dev 20/32 (63%), r5 3 hit / 2 miss. The film-specific template (<name> in danger) is weaker (HO 12/17, 71%; dev 26/52, 50%; r5 C01 3/2) and asks the same thing per name: dropped, the verified children list moves into this question\'s state instead.',
  },
  {
    id: 'j.threat_words', replaces: ['threatens_harm', 'film:threatens'], group: 'hostility', state: ['lines'],
    question: 'In `scene`, does a character say they will kill, hurt, or eat another character?',
    yes: 'A line spoken or sung in the scene is the speaker\'s own threat to kill, hurt, eat, or destroy someone ("I will kill you", "You will pay for this with your life", "I am going to eat you"). A villain\'s song about killing someone counts.',
    no: join('A figure of speech ("Mom is going to kill me", "I will kill you if you are late", "you are toast") is a no.', 'A warning that someone else or something else could hurt them is a no.', 'Teasing between friends or family who then laugh is a no.', 'A threat in a game or a play is a no.', 'Telling about a threat made earlier is a no.'),
    flag_use: 'flag (user policy 1: explicit villain threat) when j.threat_words >= act AND Sonnet sn.threat_meant >= act AND sn.dream_or_pretend < act. Never cancelled by comedy or songs (policy 1).',
    evidence: 'narrow set member on HO (4/5, 80%) but dev 5/31 (16%): the dev false fires are the joke/figure-of-speech cases, which is interpretation. So the literal half (were the words said?) is Jev, the meaning half (was it meant?) is Sonnet. v9 gave the whole question to Sonnet (split v9.1); r5 Sonnet threatens_harm 12 hit / 6 miss; rules villain_threat v9 22/22. film:threatens (bundled threaten + chase + attack per villain) was the weakest template (HO 2/9, 22%; dev 2/22, 9%; r5 6/3): dropped, its acts are covered by j.threat_words, j.order_to_harm, j.hits_character, j.creature_attacks, and attribution by j.present.<C>.',
  },
  {
    id: 'j.order_to_harm', replaces: ['plots_harm (order part)'], group: 'hostility', state: ['lines'],
    question: 'In `scene`, does a character order others to kill, hurt, or seize another character?',
    yes: 'A line gives the order now to henchmen, soldiers, or creatures ("Get him!", "Seize them!", "Kill it!", "Attack!", "Finish them off!", "Bring me her heart").',
    no: join('An order to fetch, find, or bring someone back unharmed is a no.', 'Coaching in a game, sport, or practice is a no.', 'A joke order between friends is a no.', 'Telling about an order given earlier is a no.'),
    flag_use: 'flag (user policy 1: henchmen ordered to kill) under the same code rule as j.threat_words (needs Sonnet sn.threat_meant).',
    evidence: 'plots_harm was HO 4/7 (57%), dev 4/32 (13%), r5 4 hit / 3 miss; r5sh Jev 7 fires 2 hits vs Sonnet 3 fires 2 hits (Sonnet verdict). The "plans" half (a scheme, interpretation) goes to Sonnet sn.plots_harm; only the spoken ORDER, a literal line, stays with Jev.',
  },
  {
    id: 'j.fire_burning', replaces: ['fire'], group: 'objects_hazards', state: ['lines', 'summary'],
    question: 'In `scene`, is something on fire that should not be burning?',
    yes: 'The lines, sound captions, or summary show flames spreading or something on fire now: a building, forest, ship, or a character\'s clothes (a crackling-flames caption, "Fire!" meaning flames, "The house is burning!"). Lava counts.',
    no: join('Candles, lanterns, torches, a campfire, a fireplace, a stove, or fireworks burning as they should are a no.', 'Magic glow or light is a no.', '"Fired" from a job, "fire away", or "Fire!" as an order to shoot is a no.', T.told, T.song),
    flag_use: 'tag only (never flags alone); the scene flags through j.caught_in_hazard.',
    evidence: 'narrow set member. HO 4/4 (100%), dev 2/4, r5 0 hit / 1 miss (moana S049, lava fight; r5sh Jev 2 fires 0 hits). Candle no-case added for the book-of-life Candle Maker scenes.',
  },
  {
    id: 'j.explosion', replaces: ['explosion'], group: 'objects_hazards', state: ['lines', 'summary'],
    question: 'In `scene`, does something explode?',
    yes: 'An explosion, boom, or blast caption, a bomb or cannon going off, or "It is going to blow!" followed by a blast.',
    no: join('Fireworks at a celebration are a no.', 'A magic puff of smoke, a pop, or a "boom" in a song or a joke is a no.', '"My head is going to explode" and other figures of speech are a no.', T.told),
    flag_use: 'tag only; the scene flags through j.caught_in_hazard or j.weapon_at_character.',
    evidence: 'narrow set member. HO 4/4 (100%), dev 1/4 (25%), r5 1 hit / 0 miss. The dev misses are why it no longer flags alone.',
  },
  {
    id: 'j.blade_drawn', replaces: ['blade_weapon'], group: 'objects_hazards', state: ['lines', 'summary'],
    question: 'In `scene`, does a character hold a sword, knife, axe, spear, or other blade as a weapon?',
    yes: 'The lines, sound captions, or summary show a blade drawn or held at someone now (a sword-unsheathing caption, "Drop the knife!", "En garde!").',
    no: join('A kitchen knife used for cooking, cutlery at a meal, a blade hanging on a wall or in a shop, or a tool used for work is a no.', 'A toy or wooden sword in a game is a no.', '"Cut it out" is a no.', T.told),
    flag_use: 'tag only; flags through j.weapon_at_character.',
    evidence: 'narrow set member. HO 6/7 (86%), dev 0/2, r5 1 hit / 0 miss.',
  },
  {
    id: 'j.gun_present', replaces: ['gun'], group: 'objects_hazards', state: ['lines', 'summary'],
    question: 'In `scene`, does a character hold or fire a gun?',
    yes: 'A gunshot or gun-cocking caption, "He has a gun!", "Drop your weapon!", or the summary says a character carries or fires a gun.',
    no: join('A toy gun or water pistol is a no.', 'A camera "shot", a "shot" of medicine or a drink, or "give it a shot" is a no.', 'A cannon is a no here.', T.told),
    flag_use: 'tag only; flags through j.weapon_at_character.',
    evidence: 'HO 0 fires, dev 2/5 (40%), r5 1 hit / 0 miss, r5sh Jev 2 fires 1 hit vs Sonnet 2 fires 1 hit (tie). Kept only because it is a literal noun parents filter on; cheap tag.',
  },
  {
    id: 'j.monster_present', replaces: ['monster_creature'], group: 'creatures_figures', state: ['lines', 'summary'],
    question: 'In `scene`, is a monster there?',
    yes: 'A made-up creature that is not a real-world animal, not a person, not a ghost or skeleton person, and not a robot is seen, heard, or spoken to now (a dragon, an ogre, a giant crab monster, a lava demon). Friendly, funny, and frightening ones all count.',
    no: join('A real-world animal, even a big, talking, or dangerous one, is a no.', 'A person in a costume or a mask is a no.', 'A monster only talked about, drawn, told in a story, or sung about is a no.', 'An insult such as "you little monster" is a no.'),
    flag_use: 'tag only; flags only together with j.creature_attacks in the same scene.',
    evidence: 'Best-ranked presence question: HO 11/16 (69%), AUC 0.86 (highest of all 93), dev 14/79 (18%, but the presence proxy is a lower bound: keys list events, not every scene a friendly monster is on screen), r5 5 hit / 2 miss. The ghost/skeleton-person exclusion targets the afterlife films.',
  },
  {
    id: 'j.vehicle_crash', replaces: ['vehicle_accident', 'vehicle_crash'], group: 'peril', state: ['lines', 'summary'],
    question: 'In `scene`, does a vehicle crash?',
    yes: 'A car, cart, train, boat, ship, or aircraft hits something or wrecks now (a crash caption, screeching then a crash, "We are going to crash!" followed by an impact, "The ship hit the rocks!").',
    no: join('Bumper cars or a toy vehicle is a no.', 'A gentle bump against a dock or a wall is a no.', '"Crash" meaning to sleep, to turn up at a party, or a computer crash is a no.', T.told),
    flag_use: `flag (strong event); ${GATE}`,
    evidence: 'vehicle_accident HO 1/1, dev 0 fires; vehicle_crash presence HO 0 fires, dev 1/3. Two questions about one event merged into one. Thin; rare in these films. Trial.',
  },
  {
    id: 'j.kind', replaces: ['kind', 'shark', 'large_predator', 'spider_insect', 'snake_reptile', 'rodent_bat'], group: 'creatures_figures', state: ['lines', 'summary'], type: 'choice',
    question: 'Which kind of animal or creature attacks or tries to catch a character in `scene`? (asked only when j.creature_attacks >= act)',
    yes: 'Options as v9 KIND: shark / other_fish / sea_mammal / bird / land_predator / reptile / spider_insect / rodent_bat / other_animal / monster / none.',
    no: '"none" when only people, robots, or machines attack, or nobody does.',
    flag_use: 'tag only (the species tag on an attack scene: shark, large_predator, snake_reptile, spider_insect, rodent_bat); the flag itself comes from j.creature_attacks.',
    evidence: 'The kind-veto parent animal_creature was HO 6/7 (86%). The per-species presence Nouls were among the least reliable: snake_reptile HO 1/8 (13%, least-reliable list), spider_insect HO 0/1 dev 0/5 r5 0/1, large_predator HO 1/2 dev 5/30 (17%), shark HO 0 fires dev 4/6, rodent_bat HO 1/2 dev 2/5. Asking kind only when an attack is already established is one literal hop, not a free-standing presence judgement.',
  },
  {
    id: 'j.present.<C>', replaces: ['film:presence'], group: 'creatures_figures | hostility (per character)', state: ['lines', 'summary', 'name + verified aliases'], film: true,
    question: 'In `scene`, is <name> there (speaking, spoken to, or seen by others)?',
    yes: 'The lines or summary show <name> there now: <name> speaks, is spoken to, or is seen or heard by others.',
    no: 'The lines or summary only talk about <name>, remember <name>, or do not mention <name>.',
    flag_use: 'context only (never flags). Generated for verified villain / threat dispositions only. Used by code for the parent-facing "why" (who threatens) and as a tag.',
    evidence: 'film:presence HO 108 fires, recall 64%; precision (21%) is not meaningful for who-is-on-screen. One question per villain instead of the v9 two (fpl + fps): the lines/summary channel split added cost without a measured gain.',
  },
  {
    id: 'j.danger_attacks.<D>', replaces: ['film:danger'], group: 'peril (objects_hazards for objects)', state: ['lines', 'summary', 'danger name'], film: true,
    question: 'In `scene`, does <danger> attack or hit a character? (creature_group dangers) / In `scene`, is <danger> used against a character? (object dangers)',
    yes: 'The lines, sound captions, or summary show <danger> acting on a character now: attacking, biting, grabbing, striking, or being fired, thrown, or swung at them.',
    no: join('<danger> only seen, nearby, talked about, or feared is a no.', T.friendly, T.told, T.song),
    flag_use: `flag; ${GATE}. Generated ONLY for verified dangers of kind creature_group or object; place and situation dangers (a reef, a deadline, a debt, a blight) get no question: the universal events cover them.`,
    evidence: 'film:danger HO 11/21 (52%), dev 24/45 (53%), r5 D* reasons 12 hit / 1 miss (the miss: princess-and-the-frog D02 "Alligators in the bayou" in S024, the friendly-alligator scene). v9 bundled "used on OR puts in danger" (a judgement); narrowed to one act. Round-5 dangers show why places/situations are cut: moana D01 "the reef and open ocean", princess-and-the-frog D05 "Mardi Gras wedding deadline".',
  },
];

// ---------------------------------------------------------------------------------------------
// SONNET — interpretation of meaning, tone, emotion, or story context. Sonnet reads the whole film
// from verified sources only (subtitles, TMDB cast, Wikipedia plot) and answers per scene with citations.
// ---------------------------------------------------------------------------------------------
const S = (id, replaces, group, question, flag_use, evidence, yes = '', no = '') => ({ id, replaces, group, question, flag_use, evidence, yes, no });
const SONNET = [
  // --- scene-level gates (context) that the Jev code rules use
  S('sn.played_for_laughs', ['comic_peril', 'slapstick', 's.laughs'], 'copyable',
    'Is the danger, fighting, or hurt in this scene played for laughs, so a young viewer would read it as a gag rather than a threat?',
    'context gate: cancels the Jev physical flags (user policy 3: comic peril is a tag only). Also the slapstick / comic-peril TAG.',
    'comic_peril HO 0/1, dev 2/8 (25%); slapstick HO 2/9 (22%), dev 7/33 (21%). Tone is interpretation. The v9 comic gate needed three Jev signals combined in code (comic_peril Noul + laughs Score + danger Score cap) and still let the book-of-life S021 serenade flag.',
    'The scene is built as comedy: characters bounce back unhurt, clown, joke through it.', 'Real danger that a character is frightened of is a no, even with jokes around it.'),
  S('sn.told_not_happening', ['mod.retold'], 'context',
    'Are the dangerous events of this scene only told about, remembered, sung about, or planned, rather than happening on screen now?',
    'context gate: cancels the Jev physical flags.',
    'v9 needed mod.retold at 0.95 plus danger-Score mass >= 0.80 to stop a literal Noul cancelling live events (policy _retold_change_v5_1: Nemo S013, S020, MI S043). Whether a story-within-the-story is "now" is story context.'),
  S('sn.dream_or_pretend', ['mod.imagined', 'nightmare'], 'eerie',
    'Is this scene a dream, nightmare, daydream, vision, or game of pretend?',
    'context gate: cancels Jev physical flags and threats (policy: a dream or pretend game cancels threats). nightmare = this AND the dream frightens the dreamer: tag.',
    'nightmare HO 0 fires, dev 0/1. Knowing a scene is a dream needs story context.'),
  S('sn.threat_meant', ['threatens_harm (meaning part)', 'plots_harm (order meaning)'], 'hostility',
    'When a character in this scene says they will kill, hurt, or eat someone, or orders it, is it meant seriously (a villain or a real threat), not a joke, tease, or empty bluster?',
    'gate for j.threat_words / j.order_to_harm (user policy 1). A villain\'s song about killing = yes.',
    'threatens_harm dev 5/31 (16%) under Jev: the joke/figure cases. v9 already gave threatens_harm to Sonnet (split v9.1); r5 Sonnet 12/6, rules villain_threat 22/22.'),
  S('sn.plots_harm', ['plots_harm (plan part)'], 'hostility',
    'Does a character in this scene make or reveal a plan to kill or hurt another character?',
    'flag (policy 1) when sn.threat_meant also holds.',
    'plots_harm dev 4/32 (13%), r5 Jev 4/3; r5sh Sonnet 3 fires 2 hits vs Jev 7 fires 2 hits (Sonnet verdict).'),
  // --- policy 2 and distress
  S('sn.child_frightened', ['child_frightened'], 'distress',
    'Is a child in this scene frightened or crying?',
    'flag (user policy 2), not cancelled by comedy.',
    'Jev HO 1/8 (13%), dev 13/57 (23%): an emotion question, near chance. Already Sonnet in v9 (r5 Sonnet 4 hit / 0 miss); rules child_terrified 10/19 for both systems, so still the weakest policy rule.'),
  S('sn.crying', ['crying'], 'distress', 'Is a character crying in this scene?', 'tag / context.', 'Jev HO 2/8, dev 2/11. Already Sonnet (v9).'),
  S('sn.despair', ['despair'], 'distress', 'Does a character give up hope in this scene?', 'tag.', 'Jev HO 1/3, dev 0/11. Already Sonnet (v9).'),
  S('sn.afraid_for_safety', ['afraid_for_safety'], 'distress',
    'Is a character afraid for their own or someone else\'s safety in this scene?',
    'context only (no longer flags). The physical events it co-occurs with flag on their own.',
    'Jev HO 7/42 (17%, least-reliable list), dev 26/144 (18%), r5 Jev 23 hit / 10 miss and the sole reason in moana S037 and S047.'),
  S('sn.jump_scare', ['appears_suddenly', 'startled', 'jump_scare'], 'eerie',
    'Does something frightening appear suddenly and startle a character in this scene?',
    'tag.',
    'startled HO 10/41 (24%, least-reliable list), dev 18/120 (15%); appears_suddenly HO 3/10, dev 6/29. Startle is a reaction; one Sonnet question replaces the three Jev items.'),
  S('sn.unseen_threat', ['unseen_threat'], 'eerie', 'Do characters in this scene sense something they cannot see near them?', 'tag.', 'Jev HO 4/14 (29%), dev 8/52 (15%).'),
  S('sn.transforms', ['transforms'], 'eerie', 'Is a character changed into something else against their will in this scene?', 'tag.', 'Jev HO 0 fires, dev 2/3. "Frightening" is judgement; princess-and-the-frog and book-of-life transformations are story context.'),
  S('sn.possessed', ['possessed'], 'eerie', 'Is a character controlled by someone else against their will in this scene?', 'tag.', 'Jev HO 0/4, dev 0/6.'),
  // --- supernatural (the round-5 setting trap)
  S('sn.harmful_magic', ['dark_magic', 'witch_sorcerer'], 'creatures_figures',
    'Is a spell, curse, or dark magic used to harm or threaten a character in this scene (not magic that is only the world of the story)?',
    'flag (was presence tier "always"); witch/sorcerer is a cast tag from Sonnet\'s verified cast kind.',
    'dark_magic HO 2/8 (25%), dev 3/4, r5 10 hit / 10 miss and the sole reason in book-of-life S007, S036 (Candle Maker), S038, princess-and-the-frog S015, S020, moana S015: it fired on magic as the setting. witch_sorcerer HO 1/10 (10%, least-reliable list).'),
  S('sn.ghost_haunting', ['ghost_spirit'], 'creatures_figures',
    'Does a ghost or spirit frighten or threaten a character in this scene (not spirits who are simply the people of an afterlife setting)?',
    'flag only with danger; ghost presence is a cast tag.',
    'Jev HO 8/32 (25%, least-reliable list), r5 4 hit / 2 miss (book-of-life S032, S033: the Land of the Remembered).'),
  S('sn.reanimated_dead', ['reanimated_dead'], 'creatures_figures', 'Is a dead person or animal brought back to life in this scene?', 'tag; flags only with a Jev physical event.', 'Jev HO 0/1, dev 10/30 (33%), r5 0 hit / 2 miss (book-of-life S032, S043).'),
  S('sn.cast_figures', ['skeleton_bones', 'alien', 'robot_machine_being', 'clown', 'doll_puppet', 'mask', 'scary_appearance'], 'creatures_figures',
    'Per scene: which verified cast members of these kinds are there: skeleton, alien, robot, clown, doll or puppet, masked figure, frightening-looking?',
    'tags only (never flag). Kind comes from Sonnet\'s verified cast fields (kind, looks_frightening); presence per scene from Sonnet\'s cited scene cast.',
    'skeleton_bones HO 1/2, dev 1/1 (text-blind; skeleton people are the setting of coco and book-of-life); alien 0 fires anywhere; robot_machine_being dev 5/90 (6%); clown HO 0, dev 1/1; doll_puppet HO 0/1, dev 0/2; mask HO 0 fires, dev 4/4; scary_appearance HO 3/4, dev 6/16 (38%), r5 4/1 (in the narrow set, but it asks for a fright/disgust reaction to looks: emotion plus a visual). All visual; Jev cannot see.'),
  S('sn.animal_phobia_tags', ['shark', 'large_predator', 'snake_reptile', 'spider_insect', 'rodent_bat'], 'creatures_figures',
    'Per scene: is a shark, a large predator, a snake or lizard, a spider or insect, or a rat, mouse, or bat there (friendly ones too)?',
    'tags only, for parents who filter on a phobia. The attack-scene species tag comes from Jev j.kind.',
    'See j.kind: the Jev per-species presence Nouls were unreliable (snake HO 1/8, large_predator dev 5/30) and three are text-blind.'),
  // --- objects and hazards (visual or story context)
  S('sn.storm', ['storm'], 'objects_hazards', 'Is there a storm in this scene?', 'tag; flags through j.caught_in_hazard.', 'Jev HO 0 fires, dev 7/18 (39%). Already Sonnet (v9); r5 Sonnet 2/0.'),
  S('sn.deep_dark_water', ['deep_dark_water'], 'objects_hazards', 'Is a character in deep or open water they could sink in?', 'tag.', 'Jev HO 1/2, dev 1/6. Already Sonnet (v9).'),
  S('sn.heights', ['heights'], 'objects_hazards', 'Is a character at a dangerous height?', 'tag; flags through j.falls / j.hangs_over_drop.', 'Jev HO 0/3, dev 4/15. Already Sonnet (v9); r5 Sonnet 2/0.'),
  S('sn.darkness', ['darkness'], 'objects_hazards', 'Is it dark where the characters are?', 'tag.', 'Jev HO 1/2, dev 1/8. Already Sonnet (v9).'),
  S('sn.needle_medical', ['needle_medical', 'medical_care'], 'objects_hazards', 'Is a patient treated, or a needle or medical instrument used on someone, in this scene?', 'tag.', 'needle HO 0 fires, dev 0/1; medical_care HO 0 fires, dev 2/5.'),
  S('sn.seriously_ill', ['seriously_ill'], 'objects_hazards', 'Is a person or animal seriously ill in this scene?', 'tag.', 'Jev HO 1/5 (20%), dev 2/9; r5 Jev 2 fires 0 hits.'),
  S('sn.blood_wound', ['blood_wound'], 'injury', 'Is blood or an open wound shown?', 'tag.', 'Jev HO 1/2, dev 1/1, text-blind (visual).'),
  S('sn.graveyard_funeral', ['graveyard_funeral', 'dead_body'], 'death', 'Is there a funeral, a grave, or the dead body of a person or animal in this scene?', 'tag (dead body flags with sn.dies).', 'graveyard HO 0 fires, dev 1/2 (already Sonnet v9); dead_body HO 0 fires, dev 6/14 (43%). Afterlife settings make these context-dependent.'),
  // --- captivity (stageB favoured Sonnet)
  S('sn.captured', ['captured', 'cage_net_trap', 'restraints'], 'captivity', 'Is a character caught and held against their will (caged, netted, tied up, locked in) in this scene?', 'flag.', 'stageB captivity Sonnet caught 32/48 vs Jev 19/48, precision 0.44 vs 0.35. captured Jev HO 5/10, dev 6/17; cage_net_trap HO 0/1, dev 3/5, r5 Jev 2/1; restraints HO 0/2.'),
  S('sn.trapped', ['trapped', 'swallowed'], 'captivity', 'Is a character stuck somewhere they cannot get out of, including inside a creature?', 'flag.', 'trapped Jev HO 2/4, dev 5/17; swallowed HO 0/1, dev 2/3. Already Sonnet (v9).'),
  // --- injury
  S('sn.badly_hurt', ['badly_hurt'], 'injury', 'Is a character badly hurt in this scene (bleeding, knocked out, unable to move), not a gag?', 'flag.', 'Jev HO 2/6 (33%), dev 2/7 (29%); r5 4/0 but always alongside other reasons. Hurt-vs-gag is tone.'),
  S('sn.injured', ['injured'], 'injury', 'Is a character really hurt in this scene (not a gag)?', 'tag.', 'Jev HO 2/8 (25%), dev 8/17.'),
  // --- death (stageB favoured Sonnet; the afterlife trap)
  S('sn.dies', ['dies', 'loved_one_dies', 'pet_dies'], 'death', 'Does a character really die or get killed in this scene? If so, is it a family member or close friend of another character, or a pet?', 'flag; relation and pet as tags.', 'dies Jev HO 3/3, dev 3/5; already Sonnet (v9), r5 Sonnet 2/0; stageB death Sonnet caught 38/94 vs Jev 29/94, precision 0.39 vs 0.29. loved_one_dies Jev HO 1/1, dev 4/7, r5sh Jev 4/4 vs Sonnet 3/3: Jev did well, but the relation is story context and the event is the same death.'),
  S('sn.believed_dead', ['believed_dead'], 'death', 'Does a character in this scene believe that someone close to them has just died (when they have not)?', 'flag.', 'Jev HO 2/2, dev 6/19 (32%), r5 5 hit / 5 miss incl. a comic serenade (book-of-life S019); r5sh verdict Sonnet.'),
  S('sn.parent_death_learned', ['parent_death_learned'], 'death', 'Does a child in this scene see or learn that their parent has died?', 'flag.', 'Jev HO 0 fires, dev 2/4. Story context (who is whose parent, when).'),
  S('sn.grieving', ['grieving'], 'death', 'Is a character grieving someone who has died?', 'tag.', 'Jev HO 2/8, dev 6/23, r5sh Jev 6/9 vs Sonnet 4/7. Emotion; afterlife films (coco, book-of-life) blur it.'),
  // --- separation (story context)
  S('sn.child_taken', ['child_taken'], 'separation', 'Is a child taken away from their parent or carer in this scene?', 'flag.', 'Jev HO 1/1, dev 1/5. Already Sonnet (v9).'),
  S('sn.child_separated', ['child_separated', 'parent_searching'], 'separation', 'Is a child separated from their parent or carer in this scene, or a parent searching for a missing child?', 'flag (separated), tag (searching).', 'child_separated Jev HO 0 fires, dev 1/4; parent_searching HO 1/1, dev 2/9 (22%).'),
  S('sn.abandoned', ['abandoned'], 'separation', 'Is a character left behind or sent away by someone they depend on?', 'tag.', 'Jev HO 1/10 (10%, least-reliable list), dev 1/14. Already Sonnet (v9).'),
  S('sn.family_in_danger', ['family_in_danger'], 'separation', 'Does a character learn in this scene that a family member is in danger?', 'tag.', 'Jev HO 1/2, dev 1/7. Already Sonnet (v9).'),
  S('sn.parents_argue', ['parents_argue'], 'separation', 'Do a child\'s parents argue angrily in this scene?', 'tag.', '0 fires HO and dev.'),
  // --- hostility (social interpretation)
  S('sn.rages_at_child', ['rages_at_child'], 'hostility', 'Does an adult shout at a child in anger in this scene?', 'tag.', 'Jev HO 5/8 (63%), dev 1/3. Anger is emotion; a caption shows shouting, not anger.'),
  S('sn.mocked_excluded', ['mocked', 'excluded'], 'hostility', 'Is a character mocked, humiliated, or deliberately left out by others?', 'tag.', 'mocked Jev HO 6/13, dev 9/40, r5sh Sonnet verdict (Jev 5/13 vs Sonnet 3/6); excluded HO 2/11, dev 5/17.'),
  S('sn.discrimination', ['discrimination'], 'hostility', 'Is a character treated badly because of their race, body, disability, or where they come from?', 'tag.', 'Jev HO 0/2, dev 3/7, r5 Jev 0/3.'),
  S('sn.caregiver_cruelty', ['caregiver_cruelty'], 'hostility', 'Is a parent or caregiver cruel to a child in their care?', 'flag.', 'Jev HO 4/11 (36%). Already Sonnet (v9); r5 Sonnet 3 hit / 0 miss.'),
  S('sn.betrayal', ['betrayal'], 'hostility', 'Does an adult whom a child trusts turn against that child?', 'tag.', 'Jev HO 5/10, dev 0/6.'),
  // --- animals and copyable behaviour
  S('sn.animal_harm', ['animal_cruelty', 'animal_in_danger'], 'animals', 'Is an animal that does not talk hurt, mistreated, or in danger in this scene?', 'flag (cruelty), tag (danger).', 'animal_in_danger Jev dev 19/20 (95%) but HO 0/6 (least-reliable list): the "does not talk" condition needs story context. animal_cruelty HO 0/1, dev 3/3.'),
  S('sn.copyable', ['dangerous_act', 'runs_away', 'goes_with_stranger'], 'copyable', 'Does a child deliberately do something dangerous, run away from home, or go off with a stranger?', 'tags.', 'dangerous_act Jev HO 2/9, dev 2/14; runs_away HO 0/2; goes_with_stranger HO 0/2.'),
];

// ---------------------------------------------------------------------------------------------
// Kept outside the distillation (severity only), and dropped
// ---------------------------------------------------------------------------------------------
const KEPT_SEVERITY = [
  { id: 's.danger / s.harm / s.distress / s.share / s.resolution', replaces: ['s.danger', 's.harm', 's.distress', 's.share', 's.resolution'], owner: 'jev', group: 'all (severity)', flag_use: 'severity only. They NO LONGER gate any flag: the with_danger presence tier, the afraid_for_safety requirement, and the film_danger requirement are gone because presence items no longer flag alone and film dangers are narrowed to an act.', evidence: 'No per-Score evidence in the scorecard; out of scope for this distillation. Re-test separately (they are degree Scores, which is the right primitive, but distress is emotion).' },
];
const DROPPED = [
  { id: 'm.* (29 mention questions)', replaces: ['m.' + '*'], why: 'Never flag (select.js only writes a "mentioned_only" list) and the scorecard excludes the mention channel. 29 Nouls per scene for no measured value.' },
  { id: 'e.screams', replaces: ['screams'], why: 'Jev HO 5/36 (14%, least reliable of all), dev 21/113. A scream caption is found by a regex over sound captions in code (tag only); the fear behind it is Sonnet\'s sn.child_frightened / sn.afraid_for_safety.' },
  { id: 'pl/ps channel split', replaces: ['pl.*', 'ps.*'], why: 'Each kept presence item is one question on lines + summary instead of two channels combined by max(): the split doubled cost with no measured precision gain.' },
];

// ---------------------------------------------------------------------------------------------
// Coverage check: every current question id is decided exactly somewhere
// ---------------------------------------------------------------------------------------------
const current = new Set([...PRESENCE.map((p) => p.id), ...EVENTS.map((e) => e.id), 'jump_scare', ...Object.keys(MODIFIERS).map((m) => `mod.${m}`), ...Object.keys(SCORES).map((s) => `s.${s}`), 'kind', 'film:presence', 'film:threatens', 'film:child_in_danger', 'film:danger']);
const base = (r) => r.replace(/ \(.*\)$/, '');
const covered = new Map();
for (const [owner, list] of [['jev', JEV], ['sonnet', SONNET], ['jev', KEPT_SEVERITY], ['drop', DROPPED]]) {
  for (const q of list) for (const r of q.replaces) { const b = base(r); if (!covered.has(b)) covered.set(b, new Set()); covered.get(b).add(`${owner}:${q.id}`); }
}
const missing = [...current].filter((id) => !covered.has(id));
if (missing.length) throw new Error(`undecided current questions: ${missing.join(', ')}`);
const decisions = [...current].map((id) => ({ current: id, owner: [...new Set([...covered.get(id)].map((x) => x.split(':')[0]))].join('+'), new_questions: [...covered.get(id)].map((x) => x.slice(x.indexOf(':') + 1)) }));

const out = {
  written_at: new Date().toISOString(),
  author: 'claude (proposal; Astra second opinion is a separate step)',
  source_question_set: 'v9/questions.js v6.0 + v9/split.json split-v9.1',
  principles: [
    'One condition per Jev Noul, answerable in seconds from WHAT IS SAID OR HEARD in the scene: subtitle lines and sound captions, plus the verified summary where stated (typesafe docs: model-jaggedness_jev-1.13 literal reading, indirection, bundled judgements; primitives_noul).',
    'Jev asks whether an act happened; Sonnet says what it means (comic or not, told or happening, meant or joking, dream or real, magic as setting or as an act). Code combines them.',
    'No-criteria name the known traps in LITERAL forms a reader can check in the lines (a laugh in the next line, a music-sign lyric, a cough that clears, a friendly creature that talks or helps), not as tone judgements.',
    'Presence of a thing never flags alone; only acts flag. Fire, explosion, blades, guns, monsters are tags that flag only through j.caught_in_hazard, j.weapon_at_character, or j.creature_attacks.',
    'State = only the fields each question needs (lines; summary; the verified children list; one name).',
    'Fewer, sharper: 18 Jev Nouls + 1 conditional Choice + 2 film templates per scene (v9 asked about 89 universal presence and event Nouls on two channels, 29 mention Nouls, 2 modifiers, 6 Scores, 1 Choice, and up to 40 film questions).',
  ],
  shared_trap_no_cases: T,
  code_rules: {
    physical_flag: 'A Jev physical event (j.battle, j.weapon_at_character, j.hits_character, j.creature_attacks, j.chased, j.caught_in_hazard, j.falls, j.hangs_over_drop, j.cannot_breathe, j.child_in_danger, j.vehicle_crash, j.danger_attacks.<D>) flags at p >= 0.70 unless Sonnet says sn.played_for_laughs, sn.told_not_happening, or sn.dream_or_pretend for the scene (then it is a tag; user policy 3).',
    threat_flag: 'j.threat_words OR j.order_to_harm at >= 0.70 AND sn.threat_meant, unless sn.dream_or_pretend. Comedy and songs never cancel it (user policy 1).',
    child_flag: 'sn.child_frightened flags on its own; comedy does not cancel it (user policy 2). j.child_in_danger flags under physical_flag.',
    presence_tags: 'j.fire_burning, j.explosion, j.blade_drawn, j.gun_present, j.monster_present, j.kind species tags and all Sonnet presence tags never flag alone.',
    song_detection: 'Lyric lines (music sign or #) are detected in code, not asked: spans.js widenOverSongs already does it; the Jev no-cases refer to them.',
    scream_caption: 'Scream / sob captions are found by a regex over sound captions (tag), replacing e.screams.',
  },
  flag_policy_map: {
    '(1) explicit villain threat = flag': ['j.threat_words', 'j.order_to_harm', 'sn.threat_meant', 'sn.plots_harm'],
    '(2) child terrified or crying = flag': ['sn.child_frightened'],
    '(3) comic peril = tag only': ['sn.played_for_laughs (gate on every Jev physical event)'],
  },
  jev: JEV,
  sonnet: SONNET,
  kept_outside_distillation: KEPT_SEVERITY,
  dropped: DROPPED,
  decisions,
  counts: { jev_nouls_universal: JEV.filter((q) => !q.film && q.type !== 'choice').length, jev_choice: 1, jev_film_templates: JEV.filter((q) => q.film).length, sonnet_questions: SONNET.length, current_decided: decisions.length },
  risks: [
    'Recall: dropping "threaten" from creature_attacks, "puts in danger" from film dangers, and afraid_for_safety as a flag will lose some should_flag items; the r5 Jev-only flags were right 10/25 (21.4 skip minutes in misses), so precision is the binding problem, but recall must be re-measured on held-out films.',
    'Seven Jev keepers are trials with thin evidence (hits_character, chased, falls, hangs_over_drop, vehicle_crash, gun_present, weapon_at_character vs Sonnet). Each needs >= 4 held-out fires at >= 0.75 precision next round or goes to Sonnet / drop.',
    'Everything moved to Sonnet increases Sonnet cost per film and its own error rate (r5 Sonnet threatens_harm 12 hit / 6 miss); the Sonnet questions need the same verified-sources-only and citation rules as v9 sonnetq.js.',
    'The literal no-cases were written against named round-4/5 misses; they must be checked on films that were not used to write them.',
  ],
};
fs.writeFileSync(OUT, JSON.stringify(out, null, 2) + '\n');
console.log(`wrote ${OUT}`);
console.log(JSON.stringify(out.counts));
