# Taxonomy v3: presence, events, severity

Written 2026-09-21 for workstream 2 of `WORKPLAN.md`, after finding 6 of `CODEX-REVIEW.md`.
Code: `taxonomy-v3.js`. Runner: `run-jev-v3.js`. Output: `runs-v3/*-jev-v3-layers-*.json`.

## The problem v3 fixes

A parent asks *"which scenes have monsters?"*. Taxonomy v2 asked Jev *"is a dangerous monster
threatening a character who is there with it?"*. Those are not the same question, and the gap
produced two opposite errors at once:

- In **Monsters, Inc.** nearly every character is a monster and almost none of them is threatening
  anybody. v2 answered "no monsters" for most of the film.
- In **The Lion King** the reference list deliberately excluded Mufasa's ghost from
  `ghost_supernatural` "because Simba is not frightened", while admitting a child might be.

v3 stores three things separately, and only lets code combine them:

| Layer | Question it answers | Count |
|---|---|---|
| **A — Presence** | What is in the scene, regardless of threat or tone | 29 items |
| **B — Events** | What is happening to the characters right now | 37 items |
| **C — Severity & modifiers** | How bad it is, and how A and B should be read | 4 Scores + 6 modifiers |

103 questions per beat in total.

### The three rules that follow

1. **Presence is true for friendly, comic, ordinary, imagined and threatening instances alike.**
   Sulley is a monster while he is making a child laugh. Mufasa's ghost is a ghost while Simba is
   glad to see him. The yes-criterion says so in as many words:

   > It is there in the scene now: seen, heard, or reacted to by the characters. Friendly, comic,
   > imaginary, dreamed and dangerous all count.

2. **Presence is false when the thing is only talked about.** "Maybe while I'm at school, I'll see
   a shark" is not a shark on screen.

3. **The retold / imagined veto applies to events only, never to presence** (`EVENTS_CANCELLED_WHEN_RETOLD`).
   A monster in a dream sequence is still a monster a child watches; a chase in a dream is not a
   chase happening to anybody.

### How "mentioned only" is handled

Every presence item that can sensibly be talked about in its absence (27 of 29) gets a **second,
parallel Noul with the same id** on the `mention` channel:

- presence: `In P, is <noun> there in the scene?`
- mention: `In P, is <noun> talked about while not being there in the scene?`
  (false boundary: *"If it is there in the scene, the answer is no. If these lines do not bring it
  up, the answer is no."*)

The two channels are stored side by side and never merged by the runner. In the six-film run they
behave as designed: 401 presence hits and 147 mention hits at p ≥ 0.7, and only **2 beats out of
1391 × 29** fired both. Examples from *Finding Nemo*:

| Lines | presence | mention |
|---|---|---|
| "Maybe while I'm at school, I'll see a shark" | 0.08 | **0.95** |
| "He's been battling sharks and jellyfish" (Nemo hears the story) | 0.14 | **0.73** |
| "I am a nice shark, not a mindless eating machine" (Bruce's meeting) | **0.94** | 0.18 |

`scary_appearance` and `darkness` have no mention question: they are phrased as reactions and
states, not as objects, so "talked about while absent" is not meaningful for them.

## Layer A — Presence (29 items)

Weights are `5-7 / 8-10`, 3 = high, 2 = medium, 1 = low, from `ATTRIBUTES-RESEARCH.md`.
`text-blind` = subtitles usually cannot see this; a yes is informative, a no means nothing.
Every question is a Noul whose false-criterion is the shared boundary
*"Only being talked about — remembered, warned about, planned, or used as a comparison — while it is
not there, is a no."*, plus the item-specific exclusions listed after the table.

The list was chosen from what parents actually search for: DoesTheDogDie's category list, the MPA
"scary images" descriptor, and the Common Sense Media 5-7 / 8-9 criteria (sources in
`ATTRIBUTES-RESEARCH.md`).

| id | group | parent-facing label | Jev question (`P` = beat path) | 5-7 / 8-10 | text-blind | v2 |
|---|---|---|---|---|---|---|
| `monster_creature` | Creatures & figures | Monster or strange creature | In P, is a monster: a frightening creature that is not an ordinary animal and not a person there in the scene? | 3 / 1 |  | `monster_threatens` |
| `ghost_spirit` | Creatures & figures | Ghost or spirit | In P, is a ghost, a spirit, or the soul of someone who has died there in the scene? | 3 / 2 |  | `ghost_supernatural` |
| `reanimated_dead` | Creatures & figures | Something dead brought back to life | In P, is a dead person or a dead animal that has been brought back to life there in the scene? | 3 / 2 |  | `corpses_undead`, `transformation` |
| `skeleton_corpse` | Creatures & figures | Skeleton or dead body | In P, is a skeleton, bones, or a dead body there in the scene? | 3 / 2 | yes | `corpses_undead` |
| `shark` | Creatures & figures | Shark | In P, is a shark there in the scene? | 3 / 2 |  | `phobia_animals` |
| `spider_insect` | Creatures & figures | Spider or insect | In P, is a spider, an insect, or another crawling bug there in the scene? | 3 / 2 | yes | `phobia_animals` |
| `snake_reptile` | Creatures & figures | Snake or reptile | In P, is a snake or a lizard there in the scene? | 3 / 2 | yes | `phobia_animals` |
| `large_predator` | Creatures & figures | Large predatory animal | In P, is a large predatory animal such as a wolf, a lion, a bear, a big cat, a crocodile, or a bird of prey there in the scene? | 3 / 2 |  | `phobia_animals`, `monster_threatens` |
| `rodent_bat` | Creatures & figures | Rat, mouse or bat | In P, is a rat, a mouse, or a bat there in the scene? | 2 / 1 | yes | `phobia_animals` |
| `clown_doll_puppet` | Creatures & figures | Clown, doll or puppet | In P, is a clown, a doll, a puppet, a mannequin, or a mask worn over a face there in the scene? | 3 / 2 | yes | `uncanny_figures` |
| `robot_machine_being` | Creatures & figures | Robot or machine creature | In P, is a robot or a machine that moves and acts like a living thing there in the scene? | 2 / 1 |  | — |
| `witch_magic_villain` | Creatures & figures | Witch, sorcerer or dark magic | In P, is a witch, a wizard, a sorcerer, a curse, or someone using frightening magic there in the scene? | 3 / 1 |  | `ghost_supernatural` |
| `alien` | Creatures & figures | Alien | In P, is an alien from outer space there in the scene? | 3 / 1 |  | — |
| `scary_appearance` | Creatures & figures | Someone who looks frightening | In P, do the characters react to how frightening, ugly, strange, or disfigured somebody looks? | 3 / 1 | yes | `scary_looking`, `disfigured_body` |
| `gun` | Objects & hazards | Gun | In P, is a gun or another firearm there in the scene? | 2 / 3 |  | `guns_shooting` |
| `blade_weapon` | Objects & hazards | Knife, sword or other weapon | In P, is a knife, a sword, an axe, a spear, or another bladed weapon there in the scene? | 2 / 3 |  | `blade_weapon` |
| `fire` | Objects & hazards | Fire | In P, is fire or something burning there in the scene? | 3 / 3 |  | `fire_disaster` |
| `explosion` | Objects & hazards | Explosion or bomb | In P, is an explosion or a bomb there in the scene? | 3 / 3 |  | `fire_disaster`, `war_mass_violence` |
| `storm_lightning` | Objects & hazards | Storm or lightning | In P, is a storm, thunder, lightning, a tornado, or a flood there in the scene? | 3 / 2 |  | `fire_disaster` |
| `deep_dark_water` | Objects & hazards | Deep or dark water | In P, is deep, dark, or open water that a character could sink into there in the scene? | 2 / 2 | yes | `drowning` |
| `heights` | Objects & hazards | Dangerous height | In P, is a dangerous height such as a cliff, a ledge, a rooftop, or a long drop there in the scene? | 3 / 2 | yes | `fall_from_height` |
| `darkness` | Objects & hazards | Darkness | In P, is it dark where the characters are, so that they cannot see well? | 3 / 1 |  | `pitch_dark` |
| `needle_medical` | Objects & hazards | Needle or medical procedure | In P, is a needle, an injection, a surgical instrument, or a dentist's drill there in the scene? | 2 / 2 |  | `needles_hospital` |
| `hospital_illness` | Objects & hazards | Hospital or seriously ill person | In P, is a hospital, a doctor or nurse treating somebody, or a seriously ill patient there in the scene? | 2 / 3 |  | `serious_illness`, `needles_hospital` |
| `blood_wound` | Objects & hazards | Blood or an open wound | In P, is blood or an open wound there in the scene? | 2 / 3 | yes | `blood_wounds` |
| `vehicle_crash` | Objects & hazards | Vehicle out of control or crashing | In P, is a car, truck, train, boat, or aircraft that is crashing or out of control there in the scene? | 2 / 3 |  | `vehicle_crash` |
| `cage_net_trap` | Objects & hazards | Cage, net or trap | In P, is a cage, a net, a trap, ropes tying somebody up, or a locked room holding somebody in there in the scene? | 2 / 2 |  | `captured`, `sealed_in` |
| `graveyard_funeral` | Objects & hazards | Graveyard or funeral | In P, is a graveyard, a tomb, a grave, or a funeral there in the scene? | 3 / 2 |  | `grieving` |
| `dangerous_machine` | Objects & hazards | Dangerous machinery or electricity | In P, is dangerous machinery such as blades, saws, gears, or high-voltage electricity there in the scene? | 2 / 2 | yes | `in_hazard` |

### Item-specific exclusions (`noExtra`)

Each of these was added after reading the first run's hits by hand; see "What the hand-check changed".

| id | added to the false-criterion |
|---|---|
| `monster_creature` | An ordinary animal - a fish, bird, insect, or mammal - is a no, even if it is dangerous and even if it talks. A machine or a robot is a no. |
| `ghost_spirit` | A character shouting "boo" to startle somebody, or a character whose name is Boo, is a no. |
| `shark` | A different predator - a barracuda, an eel, a whale, a bird, a big cat - is a no. The word "shark" used inside somebody's name or nickname is a no. |
| `alien` | A person, an animal, or any being that belongs to the world this story is set in is a no, even when the other characters find it unfamiliar or call it a thing. |
| `needle_medical` | Tools or machinery that are not being used to treat a patient are a no. |

## Layer B — Events (37 items)

Carried over from `taxonomy-v2.js`. Everything in v2 that was really "is X on screen" moved to
layer A; `unconscious` folded into `injured`. Each question keeps its v2 `no` boundary, most of
them the shared *"A character describing something that happened earlier, or that might happen,
is a no."*

| id | group | parent-facing label | Jev question | 5-7 / 8-10 | v2 |
|---|---|---|---|---|---|
| `chased` | Peril | Someone is being chased | In P, is a character being chased or hunted at this moment? | 3 / 3 | `chased` |
| `attacked` | Peril | Someone is being attacked | In P, does one character hit, bite, claw, or physically attack another at this moment? | 3 / 3 | `physical_violence`, `monster_threatens` |
| `falling` | Peril | Someone is falling | In P, is a character falling, or about to fall, from a dangerous height? | 3 / 3 | `fall_from_height` |
| `drowning` | Peril | Someone cannot breathe | In P, is a character drowning, held under water, or unable to breathe? | 3 / 3 | `drowning` |
| `caught_in_hazard` | Peril | Someone is caught in a hazard | In P, is a character caught in a fire, a flood, a strong current, a machine, or a collapsing place at this moment? | 3 / 3 | `in_hazard`, `fire_disaster` |
| `vehicle_accident` | Peril | A vehicle crash is happening | In P, does a vehicle crash, or is a character about to be hit by one? | 2 / 3 | `vehicle_crash` |
| `weapon_used` | Violence | A weapon is used on someone | In P, is a weapon fired at, swung at, or pointed at a character? | 2 / 3 | `guns_shooting`, `blade_weapon` |
| `battle` | Violence | A battle or attack on many people | In P, is there a battle, a bombing, or an attack on many people at once? | 2 / 3 | `war_mass_violence` |
| `captured` | Captivity | Someone is being caught | In P, is a character being caught, caged, netted, bagged, or tied up at this moment? | 2 / 2 | `captured` |
| `trapped_struggling` | Captivity | Someone is trapped and struggling | In P, is a character swallowed, buried, locked in, or stuck somewhere and struggling to get out? | 3 / 2 | `sealed_in` |
| `injured` | Injury & medical | Someone is hurt | In P, is a character physically hurt, stung, burned, wounded, or knocked unconscious at this moment? | 2 / 3 | `serious_injury`, `unconscious` |
| `dies` | Death & loss | Someone dies | In P, does a character die or get killed at this moment? | 3 / 3 | `dies_now` |
| `believed_dead` | Death & loss | Someone believes a loved one just died | In P, does a character believe that someone close to them has just died? | 3 / 3 | `believed_dead` |
| `parent_death_learned` | Death & loss | A child loses a parent | In P, does a child see or learn that their parent or caregiver has died? | 3 / 3 | `parent_dies` |
| `grieving` | Death & loss | Someone is mourning | In P, is a character mourning someone they have lost, or at a funeral or a grave? | 2 / 3 | `grieving` |
| `child_taken` | Separation & family | A child is taken from a parent | In P, is a child being kidnapped or taken away from a parent at this moment? | 3 / 3 | `child_taken` |
| `child_lost` | Separation & family | A child and parent separated, calling out | In P, is a child alone and calling for a parent, or a parent desperately calling for a missing child? | 3 / 3 | `child_lost` |
| `abandoned` | Separation & family | Someone is sent away or left behind | In P, is a character told to leave, left behind, or sent away by someone they depend on? | 3 / 3 | `abandoned` |
| `family_in_danger` | Separation & family | A family member is in danger | In P, does a character learn that a family member is in danger, missing, or seriously ill? | 2 / 3 | `family_in_danger` |
| `parents_fighting` | Separation & family | A child's parents are fighting | In P, do a child's parents argue bitterly with each other, or talk about separating? | 2 / 2 | `parents_fighting` |
| `rages_at_child` | Hostility & cruelty | An adult rages at a child | In P, is an adult yelling at a child in anger? | 3 / 2 | `adult_rages_at_child` |
| `threatens_harm` | Hostility & cruelty | Someone threatens to hurt someone | In P, does a character threaten to harm another character? | 2 / 2 | `threatens_harm` |
| `bullying` | Hostility & cruelty | Someone is mocked or excluded | In P, is a character being mocked, humiliated, or deliberately left out by others? | 2 / 3 | `bullying` |
| `discrimination` | Hostility & cruelty | Someone is treated badly for who they are | In P, is a character insulted or treated badly because of their race, body, disability, or where they come from? | 1 / 3 | `discrimination` |
| `caregiver_cruelty` | Hostility & cruelty | A caregiver is cruel to a child | In P, does a parent or caregiver hurt, lock up, starve, or cruelly neglect a child? | 3 / 3 | `caregiver_cruelty` |
| `betrayal` | Hostility & cruelty | A trusted adult turns on a child | In P, does an adult a child trusts trick or turn against that child? | 2 / 2 | `betrayal` |
| `transformation` | Eerie & startle | Someone changes into something frightening | In P, does a familiar character change into something frightening, or become possessed or controlled? | 3 / 2 | `transformation` |
| `nightmare` | Eerie & startle | A nightmare or frightening vision | In P, is a character having a nightmare or a frightening vision? | 2 / 2 | `nightmare` |
| `unseen_threat` | Eerie & startle | Something unseen is near | In P, do characters sense that something they cannot see is near them or following them? | 3 / 2 | `unseen_threat` |
| `jump_scare` | Eerie & startle | A sudden startle | In P, does something suddenly startle a character so that they scream or gasp? | 3 / 2 | `jump_scare` (text-blind) |
| `terrified` | Character distress | Someone is terrified | In P, is a character panicking or screaming in terror? | 3 / 3 | `terrified` |
| `sobbing_despair` | Character distress | Someone is crying or despairing | In P, is a character crying, pleading, or giving up hope? | 3 / 3 | `sobbing_despair` |
| `animal_cruelty` | Animals | An animal is mistreated | In P, does a character deliberately hurt or mistreat an animal? | 3 / 3 | `animal_cruelty` |
| `animal_in_danger` | Animals | An animal is in danger | In P, is an animal trapped, hunted, hurt, or crying out in fear? | 3 / 2 | `animal_in_danger` |
| `dangerous_act` | Copyable risk | A child does something dangerous | In P, does a child do something dangerous that an adult has just told them not to do, or take a dangerous dare? | 3 / 2 | `dangerous_act` |
| `runs_away` | Copyable risk | A child runs away or goes off with a stranger | In P, does a child run away from home or go off with a stranger? | 3 / 2 | `runs_away` |
| `slapstick_violence` | Copyable risk | Violence played for laughs | In P, does a character hurt someone in a way that is played for laughs and that a child could copy? | 3 / 2 | `funny_violence` |

## Layer C — Severity and modifiers

Four Scores, each on one dimension, each level a concrete situation (the Score page's rule):

| id | label | instructions | levels (0 → 3) |
|---|---|---|---|
| `threat` | Physical danger | How much physical danger are the characters in during P? | Nobody is in any danger · A danger is talked about or hinted at but is not present · A character is in real danger but not harmed: chased, cornered, or trapped · A character is attacked, seriously hurt, swallowed, or appears to die |
| `distress` | Character upset | How upset are the characters during P? | Characters are calm, joking, or happy · A character is worried, annoyed, or sad but composed · A character is frightened, crying, or pleading · A character is screaming in terror or grieving a death |
| `sev57` | Severity, ages 5-7 (experimental) | Which situation best describes what happens in P? | Calm or funny talk · A brief scare or short moment of worry that is over within these lines · A character is chased, trapped, lost, in the dark, or crying, continuing through these lines · A creature attacks, a child is taken from a parent, or someone dies or appears to die |
| `sev810` | Severity, ages 8-10 (experimental) | Which situation best describes what happens in P? | Calm or funny talk · Danger or sadness that is make-believe, played for laughs, or over within these lines · A character is really hurt, humiliated, or in danger continuing through these lines · Someone dies or appears to die, a child is taken from a parent, or a family member is in serious danger |

`sev57` / `sev810` are kept but marked experimental: `AUDIT.md` found them coarse (error 0.70 against
the reference severities, scores bunched between 1.4 and 2.5).

Six modifier Nouls, unchanged from v2 except `recounting` → `retold`:

| id | label | Jev question | v2 |
|---|---|---|---|
| `retold` | Being retold | In P, is a character telling others about events that happened at another time or in another place? | `recounting` |
| `imagined` | Imagined or dreamed | In P, is the frightening thing only imagined, dreamed, or pretended by a character? | `imagined` |
| `comic` | Played for laughs | Is the exchange in P played as a joke? | `joking` |
| `child_victim` | The one in trouble is a child | In P, is the character in danger or in distress a child? | `child_victim` |
| `animal_victim` | The one in trouble is an animal | In P, is the character in danger or in distress an animal or a pet? | `animal_victim` |
| `reassured` | Comforted or rescued | In P, is a frightened or hurt character comforted, rescued, or told that they are safe? | `reassured` |

### Composition (code only, never the model)

- `EVENTS_CANCELLED_WHEN_RETOLD` — 16 event ids in the peril / violence / captivity / injury /
  animals groups plus `child_taken`, `child_lost`, `dies`. **No presence item is ever in this set**
  (asserted: the intersection with `PRESENCE` is empty).
- `EVENTS_CANCELLED_WHEN_COMIC` — `threatens_harm`, `rages_at_child`, `attacked`, `bullying`.
- The runner applies **neither**: `run-jev-v3.js` stores every raw probability. Vetoes, thresholds
  and weights belong downstream, where they can be changed without re-running inference.

## What changed from v2, and why

| Change | Why |
|---|---|
| Presence split out as its own layer, indifferent to threat and tone | `CODEX-REVIEW.md` finding 6. "Which scenes have monsters?" ≠ "is a monster threatening someone?" |
| The retold/imagined veto restricted to events | v2's veto could erase a frightening depiction. A dreamed monster is still on screen. |
| `mention` as a parallel channel with the same ids | v2 had one global `recounting` modifier for a whole beat; it cannot say *which* thing was only talked about. |
| 12 v2 attributes that were really presence moved to layer A | `monster_threatens`, `phobia_animals`, `corpses_undead`, `uncanny_figures`, `scary_looking`, `blood_wounds`, `needles_hospital`, `serious_illness`, `disfigured_body`, `pitch_dark`, `fire_disaster`, `war_mass_violence` |
| `phobia_animals` split into 6 (`shark`, `spider_insect`, `snake_reptile`, `large_predator`, `rodent_bat`, plus `alien`) | "Animals" cannot replace a child-specific shark or spider filter (`CODEX-REVIEW.md`: collapsing labels "mechanically forgives distinctions"). |
| New items with no v2 ancestor | `robot_machine_being`, `alien`, `reanimated_dead`, `storm_lightning`, `heights`, `deep_dark_water`, `cage_net_trap`, `graveyard_funeral`, `dangerous_machine`, `explosion`, `vehicle_crash` |
| `unconscious` folded into `injured`; `sound` group dropped | Codex nit: `sound` had no attributes. Loud captions are kept as a per-beat `loudCaption` number instead. |
| Every item keeps a `v2` mapping | Old reference lists (`gold/*.json`) stay partly usable. |

## What the hand-check changed

The first run (`--label v3a`) was read by hand against the subtitles of **Finding Nemo, The Lion King,
Monsters, Inc. and The Wild Robot** — those four are now development films for presence, not test
films. (For *The Iron Giant* and *Frankenweenie* only the per-item hit counts were looked at, not the
lines.) One round of wording fixes followed, and all six films were re-run as `--label v3b`.

| Misfire found in v3a | Fix | v3a → v3b |
|---|---|---|
| `monster_creature` fired on any talking animal: 24 beats in *Finding Nemo* (jellyfish, whale, tank fish), 57 in *The Wild Robot* (raccoons) | noun tightened to "a frightening creature that is not an ordinary animal and not a person"; exclusion for ordinary animals, machines and robots | Nemo 24 → **0**, Wild Robot 57 → **0**, Monsters Inc 111 → **46** (all 6 sampled still correct) |
| `ghost_spirit` fired on every beat containing "Boo!" in *Monsters, Inc.* — 7 of 7 false | exclusion for "boo" as a shout or a name | Monsters Inc 7 → **0**; Lion King's Mufasa scenes unchanged at **3/3** |
| `alien` fired on Boo, a human child called "it", 28 times | noun narrowed to "an alien from outer space"; exclusion for beings native to the story's world | Monsters Inc 28 → **0**; Iron Giant unchanged at 15 |
| `shark` fired on a barracuda, a pelican, and the nickname "Sharkbait" | exclusion for other predators and for the word inside a name | Nemo 11 → 9; 2 of 5 false hits removed, 1 true hit also lost |
| `needle_medical` fired on the CDA decontamination drills | exclusion for tools not used on a patient | Monsters Inc 2 → **1** |

## What subtitles cannot see

Jev reads subtitle lines and nothing else. A creature that nobody names and nobody reacts to is
invisible to it. This is a property of the input, not of the model, and it is not fixable by better
wording. Verified by grepping the tracks:

| Item | Evidence |
|---|---|
| The fishing-net climax of *Finding Nemo* | the word "net" never appears; the scene is "Swim down! Swim down!". `cage_net_trap` correctly scores 0 there and `deep_dark_water` scores 0.87 instead. |
| The Pride Rock fire in *The Lion King* | the only "fire" strings in the track are "Fire away", "you're fired" and "fireflies". `fire` = 0 for the whole film. |
| Zazu's cage in *The Lion King* | "cage" never appears in the track. |
| Randall's restraint chair in *Monsters, Inc.* | no "cage", "strap" or "tied" in the track. |
| Anything appearance-based | `scary_appearance`, `blood_wound`, `skeleton_corpse`, `spider_insect`, `snake_reptile`, `rodent_bat`, `clown_doll_puppet`, `heights`, `deep_dark_water`, `dangerous_machine` are flagged `textBlind`. |
| Flashing lights | not inferable from captions at all (`ATTRIBUTES-RESEARCH.md`, ITU-R BT.1702). No v3 item claims it. |

Two consequences for the product:

1. **A `no` from a text-blind presence item means "not assessed", not "absent".** Any connector or
   filter must distinguish the two, as `CODEX-REVIEW.md` recommends.
2. **Recall is structurally low even where precision is high.** In *The Lion King*, lions are on
   screen in most of the film but `large_predator` fires on 36 of 209 beats: the beats where a lion
   is named or roars. Presence from subtitles is a *high-precision, low-recall* signal. Rolling
   beats up to scenes, and taking "present anywhere in the scene" as the scene's label, recovers
   much of that; comparing raw beat counts to a video annotation would not be meaningful.

## Runs

```
node run-jev-v3.js --all --label v3b        # all six films
node run-jev-v3.js --film nemo --limit 3    # smoke test, first three windows
```

One request per subtitle window; a window's questions are split across several requests when the
estimated size approaches the 64k-token limit (`TOKEN_CEILING = 44_000` estimated at 3.2 chars per
token, which measured ~1.6× conservative against the returned `input_tokens`). Each run file records
`calls`, `windowsSplitIntoSeveralRequests` and `largestEstimatedRequestTokens`.

| Film | beats | windows split | input tokens | cost | wall |
|---|---|---|---|---|---|
| Finding Nemo | 247 | 17 of 60 | 2,017,012 | $0.0847 | 5.2 s |
| The Lion King | 209 | 15 of 54 | 1,700,800 | $0.0714 | 3.5 s |
| The Iron Giant | 168 | 11 of 49 | 1,365,965 | $0.0574 | 3.2 s |
| Monsters, Inc. | 315 | 39 of 50 | 2,585,724 | $0.1086 | 7.8 s |
| Frankenweenie | 181 | 10 of 56 | 1,481,288 | $0.0622 | 5.3 s |
| The Wild Robot | 271 | 25 of 68 | 2,210,458 | $0.0928 | 6.0 s |
| **total** | **1391** | | **11,361,247** | **$0.4772** | 31 s |

## Known defects

- The `monster_creature` question interpolates its noun into the template without a rewrite, so it
  reads *"is a monster: a frightening creature that is not an ordinary animal and not a person there
  in the scene?"* — ungrammatical. It behaved correctly anyway (Nemo 0, Wild Robot 0, Monsters Inc
  46/46 sampled correct), so it was left alone rather than spending a second tuning round on it.
  Give it an explicit `question` override in the next revision.
- Jev is not fully deterministic: `blood_wound` in *Finding Nemo* scored 0.75 on the "Am I bleeding?"
  beat in `v3a` and below 0.70 in `v3b`, with no wording change to that item. Borderline hits move
  between runs; act on 0.7+ only for items with a wide margin, or average two runs.

## For the annotator writing `gold-v3/<slug>.json`

- Label **presence** per beat exactly as the question reads: the thing is *there in the scene*,
  friendly or not, dangerous or not, dreamed or not. Do not ask whether anybody is frightened.
- Label presence from **the video**, not the subtitles. The point of the reference list is to measure
  how much of what is on screen the subtitles carry.
- Record "only talked about" against the same id on a separate `mention` field, not as presence.
- Events keep v2's rule: present tense, happening now, in these lines.
- The Codex review found a v2 reference violation to avoid repeating: Zazu was labelled `captured`
  while *already* in the cage. In v3 that is `cage_net_trap` presence (yes) and `captured` event (no).
