# Tournament candidates per concept (top 8 by: passes the owner rule, then Wilson lower bound)

Columns: candidate id, threshold, all-film precision, recall, magic-film precision, failing clauses. Full wording of every pooled question: pool.json; every candidate at every threshold: results.json all_candidates.

## monster_creature (creatures_figures) -> sonnet

Best: C:monster_creature.b@S @0.8: Does `scene.summary` say that a monster or a made-up creature is in this scene?

| candidate | t | precision | recall | magic | fails | wording |
|---|---|---|---|---|---|---|
| C:monster_creature.b@S | 0.8 | 15/30 = 50% | 24/135 = 18% | 1/1 = 100% | precision 50% < 70% | Does `scene.summary` say that a monster or a made-up creature is in this scene? |
| C:pruned@0.8:monster_creature | 0.8 | 15/30 = 50% | 24/135 = 18% | 1/1 = 100% | precision 50% < 70% | OR of Claude phrasings kept by the prune rule at 0.8: monster_creature.b@S |
| V:monster_creature | 0.6 | 40/125 = 32% | 68/135 = 50% | 10/13 = 77% | precision 32% < 70% | v9 wording (monster_creature) |
| A:monster_creature.a@S | 0.6 | 21/60 = 35% | 41/135 = 30% | 5/5 = 100% | precision 35% < 70% | Does `scene.summary` identify a monster as present in the depicted scene? |
| C:monster_creature.b@S | 0.6 | 20/58 = 34% | 43/135 = 32% | 4/4 = 100% | precision 34% < 70% | Does `scene.summary` say that a monster or a made-up creature is in this scene? |
| C:monster_creature.b@S | 0.7 | 17/48 = 35% | 33/135 = 24% | 1/1 = 100% | precision 35% < 70% | Does `scene.summary` say that a monster or a made-up creature is in this scene? |
| A:monster_creature.a@S | 0.7 | 18/53 = 34% | 33/135 = 24% | 2/2 = 100% | precision 34% < 70% | Does `scene.summary` identify a monster as present in the depicted scene? |
| A:monster_creature.a@S | 0.8 | 16/46 = 35% | 26/135 = 19% | 2/2 = 100% | precision 35% < 70% | Does `scene.summary` identify a monster as present in the depicted scene? |

## ghost_spirit (creatures_figures) -> jev

Best: C:or:ghost_spirit @0.8: OR of Claude ghost_spirit.a, ghost_spirit.b, ghost_spirit.c

| candidate | t | precision | recall | magic | fails | wording |
|---|---|---|---|---|---|---|
| C:or:ghost_spirit | 0.8 | 7/8 = 88% | 8/135 = 6% | 5/6 = 83% | passes | OR of Claude ghost_spirit.a, ghost_spirit.b, ghost_spirit.c |
| C:ghost_spirit.b@Lnl | 0.8 | 6/7 = 86% | 5/135 = 4% | 4/5 = 80% | passes | Do `scene.lines` show a ghost or spirit being seen or heard in this scene? |
| A:ghost_spirit.a@S | 0.8 | 3/3 = 100% | 8/135 = 6% | 2/2 = 100% | 3 fires < 4 | Does `scene.summary` identify a ghost or spirit as present in the depicted scene? |
| A:pruned@0.8:ghost_spirit | 0.8 | 3/3 = 100% | 8/135 = 6% | 2/2 = 100% | 3 fires < 4 | OR of Astra phrasings kept by the prune rule at 0.8: ghost_spirit.a@S |
| C:or:ghost_spirit | 0.6 | 11/18 = 61% | 17/135 = 13% | 8/14 = 57% | precision 61% < 70%; magic films 57% < 60% | OR of Claude ghost_spirit.a, ghost_spirit.b, ghost_spirit.c |
| C:or:ghost_spirit | 0.7 | 7/11 = 64% | 8/135 = 6% | 5/9 = 56% | precision 64% < 70%; magic films 56% < 60% | OR of Claude ghost_spirit.a, ghost_spirit.b, ghost_spirit.c |
| C:ghost_spirit.c@S | 0.6 | 2/2 = 100% | 5/135 = 4% | 1/1 = 100% | 2 fires < 4 | Does `scene.summary` say that ghosts, spirits, shadows, or demons attack, grab, or carry off a character? |
| C:ghost_spirit.b@Lnl | 0.6 | 9/16 = 56% | 12/135 = 9% | 7/13 = 54% | precision 56% < 70%; magic films 54% < 60% | Do `scene.lines` show a ghost or spirit being seen or heard in this scene? |

## reanimated_dead (creatures_figures) -> sonnet

Best: V:reanimated_dead @0.6: v9 wording (reanimated_dead)

| candidate | t | precision | recall | magic | fails | wording |
|---|---|---|---|---|---|---|
| V:reanimated_dead | 0.6 | 13/45 = 29% | 25/135 = 19% | 2/8 = 25% | precision 29% < 70%; magic films 25% < 60% | v9 wording (reanimated_dead) |
| V:reanimated_dead | 0.8 | 8/25 = 32% | 14/135 = 10% | 0/2 = 0% | precision 32% < 70%; magic films 0% < 60% | v9 wording (reanimated_dead) |
| V:reanimated_dead | 0.7 | 10/35 = 29% | 19/135 = 14% | 0/3 = 0% | precision 29% < 70%; magic films 0% < 60% | v9 wording (reanimated_dead) |
| A:reanimated_dead.a.present@S | 0.6 | 3/7 = 43% | 7/135 = 5% | 0/1 = 0% | precision 43% < 70%; magic films 0% < 60% | Does `scene.summary` identify a present character as a reanimated corpse? |
| A:reanimated_dead.a.present@max | 0.6 | 3/9 = 33% | 7/135 = 5% | 0/1 = 0% | precision 33% < 70%; magic films 0% < 60% | max over channels: Does {lines/summary} identify a present character as a reanimated corpse? |
| C:reanimated_dead.a@S | 0.7 | 2/5 = 40% | 7/135 = 5% | 0/1 = 0% | precision 40% < 70%; magic films 0% < 60% | Does `scene.summary` say that a character who had died is brought back to life in this scene? |
| A:bundle:reanimated_dead | 0.6 | 3/11 = 27% | 7/135 = 5% | 0/1 = 0% | precision 27% < 70%; magic films 0% < 60% | Astra reanimated_dead: ((1) OR (2)) over reanimated_dead.a.return, reanimated_dead.a.present |
| C:reanimated_dead.a@S | 0.6 | 2/6 = 33% | 7/135 = 5% | 0/1 = 0% | precision 33% < 70%; magic films 0% < 60% | Does `scene.summary` say that a character who had died is brought back to life in this scene? |

## skeleton_bones (creatures_figures) -> jev

Best: V:skeleton_bones @0.7: v9 wording (skeleton_bones)

| candidate | t | precision | recall | magic | fails | wording |
|---|---|---|---|---|---|---|
| V:skeleton_bones | 0.7 | 4/5 = 80% | 8/135 = 6% | 3/4 = 75% | passes | v9 wording (skeleton_bones) |
| V:skeleton_bones | 0.8 | 3/4 = 75% | 7/135 = 5% | 3/4 = 75% | passes | v9 wording (skeleton_bones) |
| C:skeleton_bones.a@S | 0.6 | 2/2 = 100% | 4/135 = 3% | 1/1 = 100% | 2 fires < 4 | Does `scene.summary` say that a skeleton, a skull, or bones are found or seen in this scene? |
| C:skeleton_bones.a@S | 0.7 | 2/2 = 100% | 4/135 = 3% | 1/1 = 100% | 2 fires < 4 | Does `scene.summary` say that a skeleton, a skull, or bones are found or seen in this scene? |
| C:skeleton_bones.a@S | 0.8 | 2/2 = 100% | 4/135 = 3% | 1/1 = 100% | 2 fires < 4 | Does `scene.summary` say that a skeleton, a skull, or bones are found or seen in this scene? |
| A:skeleton_bones.a@S | 0.6 | 2/2 = 100% | 4/135 = 3% | 1/1 = 100% | 2 fires < 4 | Does `scene.summary` explicitly describe a skeleton or exposed bones in the depicted scene? |
| A:skeleton_bones.a@S | 0.7 | 2/2 = 100% | 4/135 = 3% | 1/1 = 100% | 2 fires < 4 | Does `scene.summary` explicitly describe a skeleton or exposed bones in the depicted scene? |
| A:skeleton_bones.a@S | 0.8 | 2/2 = 100% | 4/135 = 3% | 1/1 = 100% | 2 fires < 4 | Does `scene.summary` explicitly describe a skeleton or exposed bones in the depicted scene? |

## dead_body (creatures_figures) -> sonnet

Best: A:dead_body.a@S @0.8: Does `scene.summary` explicitly identify a body present in this scene as a corpse?

| candidate | t | precision | recall | magic | fails | wording |
|---|---|---|---|---|---|---|
| A:dead_body.a@S | 0.8 | 2/4 = 50% | 6/135 = 4% | 0 fires | precision 50% < 70% | Does `scene.summary` explicitly identify a body present in this scene as a corpse? |
| A:pruned@0.8:dead_body | 0.8 | 2/4 = 50% | 6/135 = 4% | 0 fires | precision 50% < 70% | OR of Astra phrasings kept by the prune rule at 0.8: dead_body.a@S |
| C:dead_body.a@S | 0.6 | 3/9 = 33% | 7/135 = 5% | 0/1 = 0% | precision 33% < 70%; magic films 0% < 60% | Does `scene.summary` say that a character lies dead, appears dead, or that someone finds a body? |
| V:dead_body | 0.7 | 4/14 = 29% | 10/135 = 7% | 0 fires | precision 29% < 70% | v9 wording (dead_body) |
| A:dead_body.a@max | 0.6 | 4/15 = 27% | 8/135 = 6% | 1/3 = 33% | precision 27% < 70%; magic films 33% < 60% | max over channels: Does {lines/summary} explicitly identify a body present in this scene as a corpse? |
| A:bundle:dead_body | 0.6 | 4/15 = 27% | 8/135 = 6% | 1/3 = 33% | precision 27% < 70%; magic films 33% < 60% | Astra dead_body: (1) over dead_body.a |
| C:dead_body.a@S | 0.7 | 2/6 = 33% | 6/135 = 4% | 0/1 = 0% | precision 33% < 70%; magic films 0% < 60% | Does `scene.summary` say that a character lies dead, appears dead, or that someone finds a body? |
| A:dead_body.a@S | 0.6 | 2/6 = 33% | 6/135 = 4% | 0/1 = 0% | precision 33% < 70%; magic films 0% < 60% | Does `scene.summary` explicitly identify a body present in this scene as a corpse? |

## shark (creatures_figures) -> jev

Best: A:shark.a@L @0.7: Does `scene.lines` identify an animal present in this scene as a shark?

| candidate | t | precision | recall | magic | fails | wording |
|---|---|---|---|---|---|---|
| A:shark.a@L | 0.6 | 5/6 = 83% | 4/135 = 3% | 0 fires | passes | Does `scene.lines` identify an animal present in this scene as a shark? |
| A:shark.a@L | 0.7 | 5/6 = 83% | 4/135 = 3% | 0 fires | passes | Does `scene.lines` identify an animal present in this scene as a shark? |
| A:shark.a@max | 0.6 | 5/6 = 83% | 4/135 = 3% | 0 fires | passes | max over channels: Does {lines/summary} identify an animal present in this scene as a shark? |
| A:shark.a@max | 0.7 | 5/6 = 83% | 4/135 = 3% | 0 fires | passes | max over channels: Does {lines/summary} identify an animal present in this scene as a shark? |
| A:bundle:shark | 0.6 | 5/6 = 83% | 4/135 = 3% | 0 fires | passes | Astra shark: (1) over shark.a |
| A:bundle:shark | 0.7 | 5/6 = 83% | 4/135 = 3% | 0 fires | passes | Astra shark: (1) over shark.a |
| C:shark.b@S | 0.6 | 3/4 = 75% | 3/135 = 2% | 0 fires | passes | Does `scene.summary` say that a shark is in this scene? |
| C:shark.b@S | 0.7 | 3/4 = 75% | 3/135 = 2% | 0 fires | passes | Does `scene.summary` say that a shark is in this scene? |

## spider_insect (creatures_figures) -> sonnet

Best: A:spider_insect.a@L @0.6: Does `scene.lines` explicitly identify a spider or insect present in this scene?

| candidate | t | precision | recall | magic | fails | wording |
|---|---|---|---|---|---|---|
| A:spider_insect.a@L | 0.6 | 1/8 = 13% | 2/135 = 1% | 1/4 = 25% | precision 13% < 70%; magic films 25% < 60% | Does `scene.lines` explicitly identify a spider or insect present in this scene? |
| V:spider_insect | 0.8 | 1/8 = 13% | 2/135 = 1% | 1/3 = 33% | precision 13% < 70%; magic films 33% < 60% | v9 wording (spider_insect) |
| A:spider_insect.a@max | 0.6 | 1/9 = 11% | 2/135 = 1% | 1/5 = 20% | precision 11% < 70%; magic films 20% < 60% | max over channels: Does {lines/summary} explicitly identify a spider or insect present in this scene? |
| A:bundle:spider_insect | 0.6 | 1/9 = 11% | 2/135 = 1% | 1/5 = 20% | precision 11% < 70%; magic films 20% < 60% | Astra spider_insect: (1) over spider_insect.a |
| V:spider_insect | 0.7 | 1/9 = 11% | 2/135 = 1% | 1/3 = 33% | precision 11% < 70%; magic films 33% < 60% | v9 wording (spider_insect) |
| V:spider_insect | 0.6 | 1/11 = 9% | 2/135 = 1% | 1/3 = 33% | precision 9% < 70%; magic films 33% < 60% | v9 wording (spider_insect) |
| C:spider_insect.b@LSnl | 0.6 | 0/1 = 0% | 0/135 = 0% | 0 fires | 1 fires < 4; precision 0% < 70% | In `scene`, does a swarm of bees, wasps, ants, or other stinging insects surround or attack a character? |
| C:spider_insect.b@LSnl | 0.7 | 0/1 = 0% | 0/135 = 0% | 0 fires | 1 fires < 4; precision 0% < 70% | In `scene`, does a swarm of bees, wasps, ants, or other stinging insects surround or attack a character? |

## snake_reptile (creatures_figures) -> jev

Best: A:snake_reptile.a@max @0.7: max over channels: Does {lines/summary} explicitly identify a snake or lizard present in this scene?

| candidate | t | precision | recall | magic | fails | wording |
|---|---|---|---|---|---|---|
| A:snake_reptile.a@max | 0.6 | 3/4 = 75% | 10/135 = 7% | 2/2 = 100% | passes | max over channels: Does {lines/summary} explicitly identify a snake or lizard present in this scene? |
| A:snake_reptile.a@max | 0.7 | 3/4 = 75% | 10/135 = 7% | 2/2 = 100% | passes | max over channels: Does {lines/summary} explicitly identify a snake or lizard present in this scene? |
| A:bundle:snake_reptile | 0.6 | 3/4 = 75% | 10/135 = 7% | 2/2 = 100% | passes | Astra snake_reptile: (1) over snake_reptile.a |
| A:bundle:snake_reptile | 0.7 | 3/4 = 75% | 10/135 = 7% | 2/2 = 100% | passes | Astra snake_reptile: (1) over snake_reptile.a |
| A:snake_reptile.a@max | 0.8 | 2/2 = 100% | 7/135 = 5% | 2/2 = 100% | 2 fires < 4 | max over channels: Does {lines/summary} explicitly identify a snake or lizard present in this scene? |
| A:bundle:snake_reptile | 0.8 | 2/2 = 100% | 7/135 = 5% | 2/2 = 100% | 2 fires < 4 | Astra snake_reptile: (1) over snake_reptile.a |
| A:snake_reptile.a@L | 0.6 | 2/3 = 67% | 6/135 = 4% | 1/1 = 100% | 3 fires < 4; precision 67% < 70% | Does `scene.lines` explicitly identify a snake or lizard present in this scene? |
| A:snake_reptile.a@L | 0.7 | 2/3 = 67% | 6/135 = 4% | 1/1 = 100% | 3 fires < 4; precision 67% < 70% | Does `scene.lines` explicitly identify a snake or lizard present in this scene? |

## large_predator (creatures_figures) -> sonnet

Best: V:large_predator @0.6: v9 wording (large_predator)

| candidate | t | precision | recall | magic | fails | wording |
|---|---|---|---|---|---|---|
| V:large_predator | 0.6 | 27/78 = 35% | 43/135 = 32% | 5/8 = 63% | precision 35% < 70% | v9 wording (large_predator) |
| V:large_predator | 0.7 | 15/49 = 31% | 29/135 = 21% | 4/7 = 57% | precision 31% < 70%; magic films 57% < 60% | v9 wording (large_predator) |
| C:or:large_predator | 0.6 | 14/53 = 26% | 26/135 = 19% | 6/10 = 60% | precision 26% < 70% | OR of Claude large_predator.a, large_predator.b |
| C:large_predator.b@Lnl | 0.6 | 10/36 = 28% | 22/135 = 16% | 6/10 = 60% | precision 28% < 70% | Do `scene.lines` show that a large hunting animal is in this scene? |
| V:large_predator | 0.8 | 9/34 = 26% | 13/135 = 10% | 2/5 = 40% | precision 26% < 70%; magic films 40% < 60% | v9 wording (large_predator) |
| A:large_predator.a@max | 0.7 | 7/35 = 20% | 16/135 = 12% | 3/6 = 50% | precision 20% < 70%; magic films 50% < 60% | max over channels: Does {lines/summary} explicitly identify a large wild predatory animal present in this scene? |
| A:bundle:large_predator | 0.7 | 7/35 = 20% | 16/135 = 12% | 3/6 = 50% | precision 20% < 70%; magic films 50% < 60% | Astra large_predator: (1) over large_predator.a |
| C:or:large_predator | 0.7 | 7/36 = 19% | 13/135 = 10% | 2/5 = 40% | precision 19% < 70%; magic films 40% < 60% | OR of Claude large_predator.a, large_predator.b |

## rodent_bat (creatures_figures) -> sonnet

Best: A:rodent_bat.a@max @0.6: max over channels: Does {lines/summary} explicitly identify a rat, mouse, or bat present in this scene?

| candidate | t | precision | recall | magic | fails | wording |
|---|---|---|---|---|---|---|
| C:rodent_bat.a@S | 0.6 | 2/2 = 100% | 6/135 = 4% | 0 fires | 2 fires < 4 | Does `scene.summary` say that a rat, a mouse, or a bat is in this scene? |
| C:rodent_bat.a@S | 0.7 | 2/2 = 100% | 6/135 = 4% | 0 fires | 2 fires < 4 | Does `scene.summary` say that a rat, a mouse, or a bat is in this scene? |
| C:rodent_bat.a@S | 0.8 | 2/2 = 100% | 6/135 = 4% | 0 fires | 2 fires < 4 | Does `scene.summary` say that a rat, a mouse, or a bat is in this scene? |
| A:rodent_bat.a@S | 0.6 | 2/2 = 100% | 6/135 = 4% | 0 fires | 2 fires < 4 | Does `scene.summary` explicitly identify a rat, mouse, or bat present in this scene? |
| A:rodent_bat.a@S | 0.7 | 2/2 = 100% | 6/135 = 4% | 0 fires | 2 fires < 4 | Does `scene.summary` explicitly identify a rat, mouse, or bat present in this scene? |
| C:pruned@0.6:rodent_bat | 0.6 | 2/2 = 100% | 6/135 = 4% | 0 fires | 2 fires < 4 | OR of Claude phrasings kept by the prune rule at 0.6: rodent_bat.a@S |
| C:pruned@0.7:rodent_bat | 0.7 | 2/2 = 100% | 6/135 = 4% | 0 fires | 2 fires < 4 | OR of Claude phrasings kept by the prune rule at 0.7: rodent_bat.a@S |
| C:pruned@0.8:rodent_bat | 0.8 | 2/2 = 100% | 6/135 = 4% | 0 fires | 2 fires < 4 | OR of Claude phrasings kept by the prune rule at 0.8: rodent_bat.a@S |

## clown (creatures_figures) -> sonnet

Best: V:clown @0.6: v9 wording (clown)

| candidate | t | precision | recall | magic | fails | wording |
|---|---|---|---|---|---|---|
| V:clown | 0.7 | 1/1 = 100% | 2/135 = 1% | 0 fires | 1 fires < 4 | v9 wording (clown) |
| V:clown | 0.6 | 2/4 = 50% | 3/135 = 2% | 0 fires | precision 50% < 70% | v9 wording (clown) |
| C:clown.a@LSnl | 0.6 | 0 fires | 0/135 = 0% | 0 fires | 0 fires < 4; precision - < 70% | In `scene`, is a person dressed or made up as a clown there? |
| C:clown.a@LSnl | 0.7 | 0 fires | 0/135 = 0% | 0 fires | 0 fires < 4; precision - < 70% | In `scene`, is a person dressed or made up as a clown there? |
| C:clown.a@LSnl | 0.8 | 0 fires | 0/135 = 0% | 0 fires | 0 fires < 4; precision - < 70% | In `scene`, is a person dressed or made up as a clown there? |
| A:clown.a@L | 0.6 | 0 fires | 0/135 = 0% | 0 fires | 0 fires < 4; precision - < 70% | Does `scene.lines` describe a clown performer present in this scene? |
| A:clown.a@L | 0.7 | 0 fires | 0/135 = 0% | 0 fires | 0 fires < 4; precision - < 70% | Does `scene.lines` describe a clown performer present in this scene? |
| A:clown.a@L | 0.8 | 0 fires | 0/135 = 0% | 0 fires | 0 fires < 4; precision - < 70% | Does `scene.lines` describe a clown performer present in this scene? |

## doll_puppet (creatures_figures) -> sonnet

Best: A:doll_puppet.a@L @0.6: Does `scene.lines` identify a doll, puppet, or mannequin present in this scene?

| candidate | t | precision | recall | magic | fails | wording |
|---|---|---|---|---|---|---|
| C:doll_puppet.a@LSnl | 0.6 | 0/3 = 0% | 0/135 = 0% | 0/1 = 0% | 3 fires < 4; precision 0% < 70%; magic films 0% < 60% | In `scene`, is a doll, a puppet, or a mannequin there? |
| C:doll_puppet.a@LSnl | 0.7 | 0/2 = 0% | 0/135 = 0% | 0/1 = 0% | 2 fires < 4; precision 0% < 70%; magic films 0% < 60% | In `scene`, is a doll, a puppet, or a mannequin there? |
| A:doll_puppet.a@L | 0.6 | 0/4 = 0% | 0/135 = 0% | 0/1 = 0% | precision 0% < 70%; magic films 0% < 60% | Does `scene.lines` identify a doll, puppet, or mannequin present in this scene? |
| A:doll_puppet.a@L | 0.7 | 0/2 = 0% | 0/135 = 0% | 0/1 = 0% | 2 fires < 4; precision 0% < 70%; magic films 0% < 60% | Does `scene.lines` identify a doll, puppet, or mannequin present in this scene? |
| A:doll_puppet.a@L | 0.8 | 0/1 = 0% | 0/135 = 0% | 0 fires | 1 fires < 4; precision 0% < 70% | Does `scene.lines` identify a doll, puppet, or mannequin present in this scene? |
| A:doll_puppet.a@max | 0.6 | 0/4 = 0% | 0/135 = 0% | 0/1 = 0% | precision 0% < 70%; magic films 0% < 60% | max over channels: Does {lines/summary} identify a doll, puppet, or mannequin present in this scene? |
| A:doll_puppet.a@max | 0.7 | 0/2 = 0% | 0/135 = 0% | 0/1 = 0% | 2 fires < 4; precision 0% < 70%; magic films 0% < 60% | max over channels: Does {lines/summary} identify a doll, puppet, or mannequin present in this scene? |
| A:doll_puppet.a@max | 0.8 | 0/1 = 0% | 0/135 = 0% | 0 fires | 1 fires < 4; precision 0% < 70% | max over channels: Does {lines/summary} identify a doll, puppet, or mannequin present in this scene? |

## mask (creatures_figures) -> jev

Best: V:mask @0.7: v9 wording (mask)

| candidate | t | precision | recall | magic | fails | wording |
|---|---|---|---|---|---|---|
| V:mask | 0.7 | 4/5 = 80% | 7/135 = 5% | 1/1 = 100% | passes | v9 wording (mask) |
| V:mask | 0.8 | 3/3 = 100% | 7/135 = 5% | 1/1 = 100% | 3 fires < 4 | v9 wording (mask) |
| V:mask | 0.6 | 4/6 = 67% | 7/135 = 5% | 1/1 = 100% | precision 67% < 70% | v9 wording (mask) |
| C:mask.a@S | 0.6 | 0 fires | 0/135 = 0% | 0 fires | 0 fires < 4; precision - < 70% | Does `scene.summary` say that someone in this scene wears a mask over their face? |
| C:mask.a@S | 0.7 | 0 fires | 0/135 = 0% | 0 fires | 0 fires < 4; precision - < 70% | Does `scene.summary` say that someone in this scene wears a mask over their face? |
| C:mask.a@S | 0.8 | 0 fires | 0/135 = 0% | 0 fires | 0 fires < 4; precision - < 70% | Does `scene.summary` say that someone in this scene wears a mask over their face? |
| A:mask.a@L | 0.6 | 0 fires | 0/135 = 0% | 0 fires | 0 fires < 4; precision - < 70% | Does `scene.lines` explicitly state that a character is wearing a mask over their face? |
| A:mask.a@L | 0.7 | 0 fires | 0/135 = 0% | 0 fires | 0 fires < 4; precision - < 70% | Does `scene.lines` explicitly state that a character is wearing a mask over their face? |

## robot_machine_being (creatures_figures) -> sonnet

Best: V:robot_machine_being @0.6: v9 wording (robot_machine_being)

| candidate | t | precision | recall | magic | fails | wording |
|---|---|---|---|---|---|---|
| V:robot_machine_being | 0.6 | 7/97 = 7% | 12/135 = 9% | 0 fires | precision 7% < 70% | v9 wording (robot_machine_being) |
| C:robot_machine_being.a@LSnl | 0.6 | 5/86 = 6% | 4/135 = 3% | 0 fires | precision 6% < 70% | In `scene`, is a robot or a machine that moves and acts by itself there? |
| A:robot_machine_being.a@max | 0.7 | 5/86 = 6% | 4/135 = 3% | 0 fires | precision 6% < 70% | max over channels: Does {lines/summary} identify a robot or machine character present in this scene? |
| A:bundle:robot_machine_being | 0.7 | 5/86 = 6% | 4/135 = 3% | 0 fires | precision 6% < 70% | Astra robot_machine_being: (1) over robot_machine_being.a |
| V:robot_machine_being | 0.7 | 5/90 = 6% | 5/135 = 4% | 0 fires | precision 6% < 70% | v9 wording (robot_machine_being) |
| A:robot_machine_being.a@max | 0.6 | 5/93 = 5% | 4/135 = 3% | 0 fires | precision 5% < 70% | max over channels: Does {lines/summary} identify a robot or machine character present in this scene? |
| A:bundle:robot_machine_being | 0.6 | 5/93 = 5% | 4/135 = 3% | 0 fires | precision 5% < 70% | Astra robot_machine_being: (1) over robot_machine_being.a |
| C:robot_machine_being.a@LSnl | 0.8 | 4/75 = 5% | 3/135 = 2% | 0 fires | precision 5% < 70% | In `scene`, is a robot or a machine that moves and acts by itself there? |

## witch_sorcerer (creatures_figures) -> jev

Best: V:witch_sorcerer @0.8: v9 wording (witch_sorcerer)

| candidate | t | precision | recall | magic | fails | wording |
|---|---|---|---|---|---|---|
| V:witch_sorcerer | 0.8 | 3/4 = 75% | 5/135 = 4% | 3/3 = 100% | passes | v9 wording (witch_sorcerer) |
| V:witch_sorcerer | 0.7 | 4/11 = 36% | 6/135 = 4% | 3/4 = 75% | precision 36% < 70% | v9 wording (witch_sorcerer) |
| V:witch_sorcerer | 0.6 | 5/17 = 29% | 9/135 = 7% | 3/4 = 75% | precision 29% < 70% | v9 wording (witch_sorcerer) |
| C:witch_sorcerer.b@Lnl | 0.8 | 2/5 = 40% | 8/135 = 6% | 1/1 = 100% | precision 40% < 70% | Do `scene.lines` show a character casting a spell, reading a fortune, or doing magic in front of others? |
| C:or:witch_sorcerer | 0.8 | 2/5 = 40% | 8/135 = 6% | 1/1 = 100% | precision 40% < 70% | OR of Claude witch_sorcerer.a, witch_sorcerer.b |
| C:witch_sorcerer.b@Lnl | 0.7 | 2/6 = 33% | 8/135 = 6% | 1/1 = 100% | precision 33% < 70% | Do `scene.lines` show a character casting a spell, reading a fortune, or doing magic in front of others? |
| C:or:witch_sorcerer | 0.7 | 2/6 = 33% | 8/135 = 6% | 1/1 = 100% | precision 33% < 70% | OR of Claude witch_sorcerer.a, witch_sorcerer.b |
| C:witch_sorcerer.b@Lnl | 0.6 | 2/10 = 20% | 8/135 = 6% | 1/1 = 100% | precision 20% < 70% | Do `scene.lines` show a character casting a spell, reading a fortune, or doing magic in front of others? |

## dark_magic (creatures_figures) -> jev

Best: V:dark_magic @0.8: v9 wording (dark_magic)

| candidate | t | precision | recall | magic | fails | wording |
|---|---|---|---|---|---|---|
| V:dark_magic | 0.8 | 10/14 = 71% | 24/135 = 18% | 5/7 = 71% | passes | v9 wording (dark_magic) |
| V:dark_magic | 0.6 | 22/38 = 58% | 50/135 = 37% | 16/23 = 70% | precision 58% < 70% | v9 wording (dark_magic) |
| V:dark_magic | 0.7 | 17/32 = 53% | 42/135 = 31% | 12/19 = 63% | precision 53% < 70% | v9 wording (dark_magic) |
| A:pruned@0.6:dark_magic | 0.6 | 8/14 = 57% | 30/135 = 22% | 4/7 = 57% | precision 57% < 70%; magic films 57% < 60% | OR of Astra phrasings kept by the prune rule at 0.6: dark_magic.a.change@L, dark_magic.a.change@S, dark_magic.a.hurt@L, dark_magic.a.hurt@S, dark_magic.a.bind@... |
| A:dark_magic.a.change@max | 0.6 | 7/12 = 58% | 26/135 = 19% | 3/5 = 60% | precision 58% < 70% | max over channels: Does {lines/summary} state that magic changes a character's body during this scene? |
| A:dark_magic.a.change@L | 0.6 | 5/8 = 63% | 14/135 = 10% | 3/5 = 60% | precision 63% < 70% | Does `scene.lines` state that magic changes a character's body during this scene? |
| A:bundle:dark_magic | 0.6 | 4/6 = 67% | 13/135 = 10% | 2/4 = 50% | precision 67% < 70%; magic films 50% < 60% | Astra dark_magic: ((((1) AND (2)) OR (3)) OR (4)) over dark_magic.a.change, dark_magic.a.forced, dark_magic.a.hurt, dark_magic.a.bind |
| A:dark_magic.a.change@max | 0.7 | 5/10 = 50% | 18/135 = 13% | 2/4 = 50% | precision 50% < 70%; magic films 50% < 60% | max over channels: Does {lines/summary} state that magic changes a character's body during this scene? |

## alien (creatures_figures) -> sonnet

Best: C:alien.a@LSnl @0.6: In `scene`, is a being from outer space there?

| candidate | t | precision | recall | magic | fails | wording |
|---|---|---|---|---|---|---|
| C:alien.a@LSnl | 0.6 | 3/26 = 12% | 3/135 = 2% | 0 fires | precision 12% < 70% | In `scene`, is a being from outer space there? |
| C:alien.a@LSnl | 0.7 | 2/18 = 11% | 2/135 = 1% | 0 fires | precision 11% < 70% | In `scene`, is a being from outer space there? |
| C:alien.a@LSnl | 0.8 | 1/12 = 8% | 2/135 = 1% | 0 fires | precision 8% < 70% | In `scene`, is a being from outer space there? |
| A:alien.a@L | 0.6 | 0 fires | 0/135 = 0% | 0 fires | 0 fires < 4; precision - < 70% | Does `scene.lines` identify a being from outer space as present in this scene? |
| A:alien.a@L | 0.7 | 0 fires | 0/135 = 0% | 0 fires | 0 fires < 4; precision - < 70% | Does `scene.lines` identify a being from outer space as present in this scene? |
| A:alien.a@L | 0.8 | 0 fires | 0/135 = 0% | 0 fires | 0 fires < 4; precision - < 70% | Does `scene.lines` identify a being from outer space as present in this scene? |
| A:alien.a@S | 0.6 | 0 fires | 0/135 = 0% | 0 fires | 0 fires < 4; precision - < 70% | Does `scene.summary` identify a being from outer space as present in this scene? |
| A:alien.a@S | 0.7 | 0 fires | 0/135 = 0% | 0 fires | 0 fires < 4; precision - < 70% | Does `scene.summary` identify a being from outer space as present in this scene? |

## scary_appearance (creatures_figures) -> sonnet

Best: V:scary_appearance @0.6: v9 wording (scary_appearance)

| candidate | t | precision | recall | magic | fails | wording |
|---|---|---|---|---|---|---|
| C:scary_appearance.a@S | 0.6 | 3/3 = 100% | 13/135 = 10% | 1/1 = 100% | 3 fires < 4 | Does `scene.summary` describe how a character or creature looks as frightening, monstrous, skeletal, or hideous? |
| C:pruned@0.6:scary_appearance | 0.6 | 3/3 = 100% | 13/135 = 10% | 1/1 = 100% | 3 fires < 4 | OR of Claude phrasings kept by the prune rule at 0.6: scary_appearance.a@S |
| C:scary_appearance.a@S | 0.7 | 2/2 = 100% | 6/135 = 4% | 1/1 = 100% | 2 fires < 4 | Does `scene.summary` describe how a character or creature looks as frightening, monstrous, skeletal, or hideous? |
| C:pruned@0.7:scary_appearance | 0.7 | 2/2 = 100% | 6/135 = 4% | 1/1 = 100% | 2 fires < 4 | OR of Claude phrasings kept by the prune rule at 0.7: scary_appearance.a@S |
| V:scary_appearance | 0.6 | 23/51 = 45% | 42/135 = 31% | 7/15 = 47% | precision 45% < 70%; magic films 47% < 60% | v9 wording (scary_appearance) |
| V:scary_appearance | 0.7 | 13/31 = 42% | 29/135 = 21% | 5/10 = 50% | precision 42% < 70%; magic films 50% < 60% | v9 wording (scary_appearance) |
| C:scary_appearance.a@S | 0.8 | 1/1 = 100% | 3/135 = 2% | 1/1 = 100% | 1 fires < 4 | Does `scene.summary` describe how a character or creature looks as frightening, monstrous, skeletal, or hideous? |
| V:scary_appearance | 0.8 | 7/22 = 32% | 19/135 = 14% | 2/5 = 40% | precision 32% < 70%; magic films 40% < 60% | v9 wording (scary_appearance) |

## gun (objects_hazards) -> sonnet

Best: C:gun.a@LSnl @0.6: In `scene`, does a character hold or fire a gun?

Sonnet (gun) @0.7: 3/9 = 33%, recall 5/158 = 3%, magic 1/2 = 50%; @0.6: 3/9 = 33%

| candidate | t | precision | recall | magic | fails | wording |
|---|---|---|---|---|---|---|
| C:gun.a@LSnl | 0.8 | 2/3 = 67% | 4/158 = 3% | 1/1 = 100% | 3 fires < 4; precision 67% < 70% | In `scene`, does a character hold or fire a gun? |
| C:gun.a@LSnl | 0.6 | 4/9 = 44% | 6/158 = 4% | 1/1 = 100% | precision 44% < 70% | In `scene`, does a character hold or fire a gun? |
| V:gun | 0.6 | 4/9 = 44% | 6/158 = 4% | 1/2 = 50% | precision 44% < 70%; magic films 50% < 60% | v9 wording (gun) |
| C:gun.a@LSnl | 0.7 | 3/6 = 50% | 5/158 = 3% | 1/1 = 100% | precision 50% < 70% | In `scene`, does a character hold or fire a gun? |
| V:gun | 0.7 | 3/7 = 43% | 5/158 = 3% | 1/2 = 50% | precision 43% < 70%; magic films 50% < 60% | v9 wording (gun) |
| A:gun.a@L | 0.7 | 2/6 = 33% | 4/158 = 3% | 1/2 = 50% | precision 33% < 70%; magic films 50% < 60% | Does `scene.lines` explicitly identify a firearm present in this scene? |
| A:gun.a@L | 0.8 | 2/6 = 33% | 4/158 = 3% | 1/2 = 50% | precision 33% < 70%; magic films 50% < 60% | Does `scene.lines` explicitly identify a firearm present in this scene? |
| A:gun.a@max | 0.7 | 2/6 = 33% | 4/158 = 3% | 1/2 = 50% | precision 33% < 70%; magic films 50% < 60% | max over channels: Does {lines/summary} explicitly identify a firearm present in this scene? |

## blade_weapon (objects_hazards) -> jev

Best: A:blade_weapon.a@L @0.7: Does `scene.lines` explicitly identify a bladed weapon present in this scene?

Sonnet (blade_weapon) @0.7: 7/13 = 54%, recall 9/158 = 6%, magic 1/1 = 100%; @0.6: 10/17 = 59%

| candidate | t | precision | recall | magic | fails | wording |
|---|---|---|---|---|---|---|
| A:blade_weapon.a@L | 0.8 | 6/8 = 75% | 8/158 = 5% | 1/1 = 100% | passes | Does `scene.lines` explicitly identify a bladed weapon present in this scene? |
| A:blade_weapon.a@L | 0.7 | 7/10 = 70% | 9/158 = 6% | 1/1 = 100% | passes | Does `scene.lines` explicitly identify a bladed weapon present in this scene? |
| V:blade_weapon | 0.6 | 7/10 = 70% | 9/158 = 6% | 1/1 = 100% | passes | v9 wording (blade_weapon) |
| V:blade_weapon | 0.7 | 7/10 = 70% | 9/158 = 6% | 1/1 = 100% | passes | v9 wording (blade_weapon) |
| A:blade_weapon.a@max | 0.8 | 6/9 = 67% | 8/158 = 5% | 1/1 = 100% | precision 67% < 70% | max over channels: Does {lines/summary} explicitly identify a bladed weapon present in this scene? |
| A:bundle:blade_weapon | 0.8 | 6/9 = 67% | 8/158 = 5% | 1/1 = 100% | precision 67% < 70% | Astra blade_weapon: (1) over blade_weapon.a |
| V:blade_weapon | 0.8 | 6/9 = 67% | 8/158 = 5% | 1/1 = 100% | precision 67% < 70% | v9 wording (blade_weapon) |
| A:blade_weapon.a@max | 0.7 | 7/11 = 64% | 9/158 = 6% | 1/1 = 100% | precision 64% < 70% | max over channels: Does {lines/summary} explicitly identify a bladed weapon present in this scene? |

## fire (objects_hazards) -> jev

Best: A:fire.a@max @0.6: max over channels: Does {lines/summary} explicitly describe flames burning in this scene?

Sonnet (fire) @0.7: 6/12 = 50%, recall 7/158 = 4%, magic 0/1 = 0%; @0.6: 7/14 = 50%

| candidate | t | precision | recall | magic | fails | wording |
|---|---|---|---|---|---|---|
| A:fire.a@max | 0.7 | 5/5 = 100% | 8/158 = 5% | 1/1 = 100% | passes | max over channels: Does {lines/summary} explicitly describe flames burning in this scene? |
| A:fire.a@max | 0.8 | 5/5 = 100% | 8/158 = 5% | 1/1 = 100% | passes | max over channels: Does {lines/summary} explicitly describe flames burning in this scene? |
| A:bundle:fire | 0.7 | 5/5 = 100% | 8/158 = 5% | 1/1 = 100% | passes | Astra fire: (1) over fire.a |
| A:bundle:fire | 0.8 | 5/5 = 100% | 8/158 = 5% | 1/1 = 100% | passes | Astra fire: (1) over fire.a |
| A:fire.a@max | 0.6 | 6/7 = 86% | 9/158 = 6% | 1/1 = 100% | passes | max over channels: Does {lines/summary} explicitly describe flames burning in this scene? |
| A:bundle:fire | 0.6 | 6/7 = 86% | 9/158 = 6% | 1/1 = 100% | passes | Astra fire: (1) over fire.a |
| A:fire.a@L | 0.6 | 4/5 = 80% | 8/158 = 5% | 1/1 = 100% | passes | Does `scene.lines` explicitly describe flames burning in this scene? |
| A:fire.a@L | 0.7 | 3/3 = 100% | 7/158 = 4% | 1/1 = 100% | 3 fires < 4 | Does `scene.lines` explicitly describe flames burning in this scene? |

## explosion (objects_hazards) -> sonnet

Best: A:explosion.a@max @0.6: max over channels: Does {lines/summary} explicitly describe an explosion occurring in this scene?

Sonnet (explosion) @0.7: 5/8 = 63%, recall 6/158 = 4%, magic 3/3 = 100%; @0.6: 6/9 = 67%

| candidate | t | precision | recall | magic | fails | wording |
|---|---|---|---|---|---|---|
| A:explosion.a@max | 0.6 | 8/12 = 67% | 14/158 = 9% | 4/5 = 80% | precision 67% < 70% | max over channels: Does {lines/summary} explicitly describe an explosion occurring in this scene? |
| A:bundle:explosion | 0.6 | 8/12 = 67% | 14/158 = 9% | 4/5 = 80% | precision 67% < 70% | Astra explosion: (1) over explosion.a |
| C:explosion.a@LSnl | 0.6 | 6/9 = 67% | 10/158 = 6% | 3/3 = 100% | precision 67% < 70% | In `scene`, does something explode? |
| A:explosion.a@L | 0.6 | 7/11 = 64% | 13/158 = 8% | 4/5 = 80% | precision 64% < 70% | Does `scene.lines` explicitly describe an explosion occurring in this scene? |
| A:explosion.a@max | 0.7 | 7/11 = 64% | 11/158 = 7% | 3/4 = 75% | precision 64% < 70% | max over channels: Does {lines/summary} explicitly describe an explosion occurring in this scene? |
| A:bundle:explosion | 0.7 | 7/11 = 64% | 11/158 = 7% | 3/4 = 75% | precision 64% < 70% | Astra explosion: (1) over explosion.a |
| A:explosion.a@S | 0.6 | 2/2 = 100% | 3/158 = 2% | 0 fires | 2 fires < 4 | Does `scene.summary` explicitly describe an explosion occurring in this scene? |
| A:explosion.a@S | 0.7 | 2/2 = 100% | 3/158 = 2% | 0 fires | 2 fires < 4 | Does `scene.summary` explicitly describe an explosion occurring in this scene? |

## storm (objects_hazards) -> sonnet

Best: V:pl.storm@L @0.8: Do `scene.lines` show that a storm is in this scene?

Sonnet (storm) @0.7: 12/29 = 41%, recall 16/158 = 10%, magic 1/5 = 20%; @0.6: 14/33 = 42%

| candidate | t | precision | recall | magic | fails | wording |
|---|---|---|---|---|---|---|
| V:pl.storm@L | 0.8 | 8/21 = 38% | 11/158 = 7% | 1/4 = 25% | precision 38% < 70%; magic films 25% < 60% | Do `scene.lines` show that a storm is in this scene? |
| V:storm | 0.8 | 8/21 = 38% | 11/158 = 7% | 1/4 = 25% | precision 38% < 70%; magic films 25% < 60% | v9 wording (storm) |
| C:storm.a@Lnl | 0.6 | 9/25 = 36% | 12/158 = 8% | 1/4 = 25% | precision 36% < 70%; magic films 25% < 60%; precision 36% < Sonnet 41% - 5 | Does a sound caption in `scene.lines` name thunder, lightning, or a howling or roaring wind? |
| C:storm.a@Lnl | 0.7 | 9/25 = 36% | 12/158 = 8% | 1/4 = 25% | precision 36% < 70%; magic films 25% < 60%; precision 36% < Sonnet 41% - 5 | Does a sound caption in `scene.lines` name thunder, lightning, or a howling or roaring wind? |
| C:storm.a@Lnl | 0.8 | 9/25 = 36% | 12/158 = 8% | 1/4 = 25% | precision 36% < 70%; magic films 25% < 60%; precision 36% < Sonnet 41% - 5 | Does a sound caption in `scene.lines` name thunder, lightning, or a howling or roaring wind? |
| C:or:storm | 0.8 | 9/25 = 36% | 12/158 = 8% | 1/4 = 25% | precision 36% < 70%; magic films 25% < 60%; precision 36% < Sonnet 41% - 5 | OR of Claude storm.a, storm.b |
| C:or:storm | 0.6 | 9/26 = 35% | 12/158 = 8% | 1/4 = 25% | precision 35% < 70%; magic films 25% < 60%; precision 35% < Sonnet 41% - 5 | OR of Claude storm.a, storm.b |
| C:or:storm | 0.7 | 9/26 = 35% | 12/158 = 8% | 1/4 = 25% | precision 35% < 70%; magic films 25% < 60%; precision 35% < Sonnet 41% - 5 | OR of Claude storm.a, storm.b |

## deep_dark_water (objects_hazards) -> sonnet

Best: V:pl.deep_dark_water@L @0.8: Do `scene.lines` show that deep or open water a character could sink or drown in is in this scene?

Sonnet (deep_dark_water) @0.7: 9/15 = 60%, recall 17/158 = 11%, magic 0 fires; @0.6: 10/18 = 56%

| candidate | t | precision | recall | magic | fails | wording |
|---|---|---|---|---|---|---|
| V:pl.deep_dark_water@L | 0.8 | 3/5 = 60% | 11/158 = 7% | 0 fires | precision 60% < 70% | Do `scene.lines` show that deep or open water a character could sink or drown in is in this scene? |
| V:deep_dark_water | 0.8 | 3/5 = 60% | 11/158 = 7% | 0 fires | precision 60% < 70% | v9 wording (deep_dark_water) |
| V:ps.deep_dark_water@V9C | 0.6 | 1/1 = 100% | 4/158 = 3% | 0 fires | 1 fires < 4; recall 3% < Sonnet 11% - 5 | Does `scene.summary` say that deep or open water a character could sink or drown in is in this scene? |
| V:ps.deep_dark_water@V9C | 0.7 | 1/1 = 100% | 4/158 = 3% | 0 fires | 1 fires < 4; recall 3% < Sonnet 11% - 5 | Does `scene.summary` say that deep or open water a character could sink or drown in is in this scene? |
| V:ps.deep_dark_water@V9C | 0.8 | 1/1 = 100% | 4/158 = 3% | 0 fires | 1 fires < 4; recall 3% < Sonnet 11% - 5 | Does `scene.summary` say that deep or open water a character could sink or drown in is in this scene? |
| V:pl.deep_dark_water@L | 0.7 | 5/12 = 42% | 14/158 = 9% | 0 fires | precision 42% < 70%; precision 42% < Sonnet 60% - 5 | Do `scene.lines` show that deep or open water a character could sink or drown in is in this scene? |
| V:deep_dark_water | 0.7 | 5/12 = 42% | 14/158 = 9% | 0 fires | precision 42% < 70%; precision 42% < Sonnet 60% - 5 | v9 wording (deep_dark_water) |
| A:deep_dark_water.a@L | 0.6 | 4/11 = 36% | 6/158 = 4% | 0 fires | precision 36% < 70%; precision 36% < Sonnet 60% - 5; recall 4% < Sonnet 11% - 5 | Does `scene.lines` explicitly place a character in or directly over deep or open water? |

## heights (objects_hazards) -> sonnet

Best: C:or:heights @0.6: OR of Claude heights.a, heights.b

Sonnet (heights) @0.7: 9/24 = 38%, recall 12/158 = 8%, magic 2/2 = 100%; @0.6: 11/33 = 33%

| candidate | t | precision | recall | magic | fails | wording |
|---|---|---|---|---|---|---|
| C:or:heights | 0.8 | 3/3 = 100% | 5/158 = 3% | 0 fires | 3 fires < 4 | OR of Claude heights.a, heights.b |
| C:heights.b@Lnl | 0.6 | 2/2 = 100% | 3/158 = 2% | 0 fires | 2 fires < 4; recall 2% < Sonnet 8% - 5 | Does a character in `scene.lines` say not to look down or that it is a long way down? |
| C:heights.b@Lnl | 0.7 | 2/2 = 100% | 3/158 = 2% | 0 fires | 2 fires < 4; recall 2% < Sonnet 8% - 5 | Does a character in `scene.lines` say not to look down or that it is a long way down? |
| C:heights.b@Lnl | 0.8 | 2/2 = 100% | 3/158 = 2% | 0 fires | 2 fires < 4; recall 2% < Sonnet 8% - 5 | Does a character in `scene.lines` say not to look down or that it is a long way down? |
| C:or:heights | 0.6 | 3/5 = 60% | 5/158 = 3% | 0 fires | precision 60% < 70% | OR of Claude heights.a, heights.b |
| C:or:heights | 0.7 | 3/5 = 60% | 5/158 = 3% | 0 fires | precision 60% < 70% | OR of Claude heights.a, heights.b |
| A:heights.a@max | 0.6 | 2/3 = 67% | 4/158 = 3% | 0 fires | 3 fires < 4; precision 67% < 70%; recall 3% < Sonnet 8% - 5 | max over channels: Does {lines/summary} explicitly place a character beside or above a long drop? |
| A:bundle:heights | 0.6 | 2/3 = 67% | 4/158 = 3% | 0 fires | 3 fires < 4; precision 67% < 70%; recall 3% < Sonnet 8% - 5 | Astra heights: (1) over heights.a |

## darkness (objects_hazards) -> sonnet

Best: A:darkness.a@L @0.7: Does `scene.lines` explicitly state that the characters' immediate surroundings are dark?

Sonnet (darkness) @0.7: 2/4 = 50%, recall 5/158 = 3%, magic 0 fires; @0.6: 4/6 = 67%

| candidate | t | precision | recall | magic | fails | wording |
|---|---|---|---|---|---|---|
| C:darkness.b@Lnl | 0.6 | 2/3 = 67% | 5/158 = 3% | 0 fires | 3 fires < 4; precision 67% < 70% | Does a character in `scene.lines` say they cannot see because it is dark? |
| C:or:darkness | 0.6 | 2/3 = 67% | 5/158 = 3% | 0 fires | 3 fires < 4; precision 67% < 70% | OR of Claude darkness.a, darkness.b |
| A:darkness.a@L | 0.7 | 2/4 = 50% | 6/158 = 4% | 1/2 = 50% | precision 50% < 70%; magic films 50% < 60% | Does `scene.lines` explicitly state that the characters' immediate surroundings are dark? |
| A:darkness.a@L | 0.8 | 2/4 = 50% | 6/158 = 4% | 1/2 = 50% | precision 50% < 70%; magic films 50% < 60% | Does `scene.lines` explicitly state that the characters' immediate surroundings are dark? |
| A:darkness.a@max | 0.7 | 2/4 = 50% | 6/158 = 4% | 1/2 = 50% | precision 50% < 70%; magic films 50% < 60% | max over channels: Does {lines/summary} explicitly state that the characters' immediate surroundings are dark? |
| A:darkness.a@max | 0.8 | 2/4 = 50% | 6/158 = 4% | 1/2 = 50% | precision 50% < 70%; magic films 50% < 60% | max over channels: Does {lines/summary} explicitly state that the characters' immediate surroundings are dark? |
| A:bundle:darkness | 0.7 | 2/4 = 50% | 6/158 = 4% | 1/2 = 50% | precision 50% < 70%; magic films 50% < 60% | Astra darkness: (1) over darkness.a |
| A:bundle:darkness | 0.8 | 2/4 = 50% | 6/158 = 4% | 1/2 = 50% | precision 50% < 70%; magic films 50% < 60% | Astra darkness: (1) over darkness.a |

## needle_medical (objects_hazards) -> sonnet

Best: A:needle_medical.a@L @0.6: Does `scene.lines` explicitly describe a medical or dental instrument being used on a patient?

Sonnet (needle_medical) @0.7: 0/2 = 0%, recall 0/158 = 0%, magic 0 fires; @0.6: 0/2 = 0%

| candidate | t | precision | recall | magic | fails | wording |
|---|---|---|---|---|---|---|
| A:needle_medical.a@L | 0.6 | 0/2 = 0% | 0/158 = 0% | 0 fires | 2 fires < 4; precision 0% < 70% | Does `scene.lines` explicitly describe a medical or dental instrument being used on a patient? |
| V:pl.needle_medical@L | 0.6 | 0/2 = 0% | 0/158 = 0% | 0 fires | 2 fires < 4; precision 0% < 70% | Do `scene.lines` show that a needle, an injection, or a medical or dental instrument is in this scene? |
| A:needle_medical.a@max | 0.6 | 0/2 = 0% | 0/158 = 0% | 0 fires | 2 fires < 4; precision 0% < 70% | max over channels: Does {lines/summary} explicitly describe a medical or dental instrument being used on a patient? |
| A:bundle:needle_medical | 0.6 | 0/2 = 0% | 0/158 = 0% | 0 fires | 2 fires < 4; precision 0% < 70% | Astra needle_medical: (1) over needle_medical.a |
| V:needle_medical | 0.6 | 0/2 = 0% | 0/158 = 0% | 0 fires | 2 fires < 4; precision 0% < 70% | v9 wording (needle_medical) |
| C:needle_medical.a@LSnl | 0.6 | 0/1 = 0% | 0/158 = 0% | 0 fires | 1 fires < 4; precision 0% < 70% | In `scene`, is a needle, an injection, or a medical or dental instrument used on a patient? |
| C:needle_medical.a@LSnl | 0.7 | 0/1 = 0% | 0/158 = 0% | 0 fires | 1 fires < 4; precision 0% < 70% | In `scene`, is a needle, an injection, or a medical or dental instrument used on a patient? |
| C:needle_medical.a@LSnl | 0.8 | 0/1 = 0% | 0/158 = 0% | 0 fires | 1 fires < 4; precision 0% < 70% | In `scene`, is a needle, an injection, or a medical or dental instrument used on a patient? |

## medical_care (objects_hazards) -> sonnet

Best: V:medical_care @0.7: v9 wording (medical_care)

Sonnet (medical_care) @0.7: 0/3 = 0%, recall 0/158 = 0%, magic 0 fires; @0.6: 0/3 = 0%

| candidate | t | precision | recall | magic | fails | wording |
|---|---|---|---|---|---|---|
| V:medical_care | 0.7 | 2/5 = 40% | 2/158 = 1% | 0 fires | precision 40% < 70% | v9 wording (medical_care) |
| V:medical_care | 0.6 | 2/6 = 33% | 2/158 = 1% | 0 fires | precision 33% < 70% | v9 wording (medical_care) |
| V:medical_care | 0.8 | 1/3 = 33% | 1/158 = 1% | 0 fires | 3 fires < 4; precision 33% < 70% | v9 wording (medical_care) |
| C:medical_care.a@LSnl | 0.6 | 0/2 = 0% | 0/158 = 0% | 0 fires | 2 fires < 4; precision 0% < 70% | In `scene`, does a doctor, nurse, healer, or vet treat a patient? |
| C:medical_care.a@LSnl | 0.7 | 0/2 = 0% | 0/158 = 0% | 0 fires | 2 fires < 4; precision 0% < 70% | In `scene`, does a doctor, nurse, healer, or vet treat a patient? |
| C:medical_care.a@LSnl | 0.8 | 0/2 = 0% | 0/158 = 0% | 0 fires | 2 fires < 4; precision 0% < 70% | In `scene`, does a doctor, nurse, healer, or vet treat a patient? |
| A:medical_care.a.treatment@L | 0.6 | 0/2 = 0% | 0/158 = 0% | 0 fires | 2 fires < 4; precision 0% < 70% | Does `scene.lines` describe a healthcare worker treating a patient now? |
| A:medical_care.a.treatment@L | 0.7 | 0/2 = 0% | 0/158 = 0% | 0 fires | 2 fires < 4; precision 0% < 70% | Does `scene.lines` describe a healthcare worker treating a patient now? |

## seriously_ill (objects_hazards) -> sonnet

Best: V:seriously_ill @0.6: v9 wording (seriously_ill)

Sonnet (seriously_ill) @0.7: 1/5 = 20%, recall 1/158 = 1%, magic 0 fires; @0.6: 2/6 = 33%

| candidate | t | precision | recall | magic | fails | wording |
|---|---|---|---|---|---|---|
| V:seriously_ill | 0.6 | 5/23 = 22% | 7/158 = 4% | 2/5 = 40% | precision 22% < 70%; magic films 40% < 60% | v9 wording (seriously_ill) |
| V:seriously_ill | 0.8 | 3/12 = 25% | 5/158 = 3% | 1/2 = 50% | precision 25% < 70%; magic films 50% < 60% | v9 wording (seriously_ill) |
| V:seriously_ill | 0.7 | 3/15 = 20% | 5/158 = 3% | 1/3 = 33% | precision 20% < 70%; magic films 33% < 60% | v9 wording (seriously_ill) |
| C:seriously_ill.b@Lnl | 0.7 | 0/2 = 0% | 0/158 = 0% | 0 fires | 2 fires < 4; precision 0% < 70%; precision 0% < Sonnet 20% - 5 | Does a character in `scene.lines` say that someone here is very sick or does not have long to live? |
| C:seriously_ill.b@Lnl | 0.8 | 0/2 = 0% | 0/158 = 0% | 0 fires | 2 fires < 4; precision 0% < 70%; precision 0% < Sonnet 20% - 5 | Does a character in `scene.lines` say that someone here is very sick or does not have long to live? |
| A:seriously_ill.a.dying@L | 0.6 | 0/1 = 0% | 0/158 = 0% | 0 fires | 1 fires < 4; precision 0% < 70%; precision 0% < Sonnet 20% - 5 | Does `scene.lines` explicitly describe a character as dying from an illness now? |
| A:seriously_ill.a.dying@S | 0.6 | 0/1 = 0% | 0/158 = 0% | 0 fires | 1 fires < 4; precision 0% < 70%; precision 0% < Sonnet 20% - 5 | Does `scene.summary` explicitly describe a character as dying from an illness now? |
| A:seriously_ill.a.dying@S | 0.7 | 0/1 = 0% | 0/158 = 0% | 0 fires | 1 fires < 4; precision 0% < 70%; precision 0% < Sonnet 20% - 5 | Does `scene.summary` explicitly describe a character as dying from an illness now? |

## blood_wound (objects_hazards) -> sonnet

Best: C:blood_wound.a@LSnl @0.6: In `scene`, is a character bleeding or does a character have an open wound?

Sonnet (blood_wound) @0.7: 2/3 = 67%, recall 3/158 = 2%, magic 0 fires; @0.6: 6/8 = 75%

| candidate | t | precision | recall | magic | fails | wording |
|---|---|---|---|---|---|---|
| C:blood_wound.a@LSnl | 0.8 | 2/2 = 100% | 3/158 = 2% | 0 fires | 2 fires < 4 | In `scene`, is a character bleeding or does a character have an open wound? |
| C:blood_wound.a@LSnl | 0.7 | 2/3 = 67% | 3/158 = 2% | 0 fires | 3 fires < 4; precision 67% < 70% | In `scene`, is a character bleeding or does a character have an open wound? |
| V:blood_wound | 0.7 | 2/3 = 67% | 3/158 = 2% | 0 fires | 3 fires < 4; precision 67% < 70% | v9 wording (blood_wound) |
| V:blood_wound | 0.8 | 2/3 = 67% | 3/158 = 2% | 0 fires | 3 fires < 4; precision 67% < 70% | v9 wording (blood_wound) |
| C:blood_wound.a@LSnl | 0.6 | 2/4 = 50% | 3/158 = 2% | 0 fires | precision 50% < 70%; precision 50% < Sonnet 67% - 5 | In `scene`, is a character bleeding or does a character have an open wound? |
| V:blood_wound | 0.6 | 2/4 = 50% | 3/158 = 2% | 0 fires | precision 50% < 70%; precision 50% < Sonnet 67% - 5 | v9 wording (blood_wound) |
| A:blood_wound.a.blood@L | 0.6 | 1/2 = 50% | 2/158 = 1% | 0 fires | 2 fires < 4; precision 50% < 70%; precision 50% < Sonnet 67% - 5 | Does `scene.lines` explicitly describe visible blood in this scene? |
| A:blood_wound.a.blood@L | 0.7 | 1/2 = 50% | 2/158 = 1% | 0 fires | 2 fires < 4; precision 50% < 70%; precision 50% < Sonnet 67% - 5 | Does `scene.lines` explicitly describe visible blood in this scene? |

## vehicle_crash (peril) -> sonnet

Best: V:vehicle_crash @0.6: v9 wording (vehicle_crash)

Sonnet (vehicle_crash) @0.7: 5/6 = 83%, recall 9/270 = 3%, magic 0 fires; @0.6: 6/7 = 86%

| candidate | t | precision | recall | magic | fails | wording |
|---|---|---|---|---|---|---|
| V:vehicle_crash | 0.6 | 5/8 = 63% | 14/270 = 5% | 0 fires | precision 63% < 70%; precision 63% < Sonnet 83% - 5 | v9 wording (vehicle_crash) |
| V:or:vehicle_crash | 0.6 | 5/8 = 63% | 14/270 = 5% | 0 fires | precision 63% < 70%; precision 63% < Sonnet 83% - 5 | v9 max(vehicle_crash, vehicle_accident) |
| V:vehicle_accident | 0.6 | 2/3 = 67% | 4/270 = 1% | 0 fires | 3 fires < 4; precision 67% < 70%; precision 67% < Sonnet 83% - 5 | v9 wording (vehicle_accident) |
| V:vehicle_accident | 0.7 | 1/1 = 100% | 2/270 = 1% | 0 fires | 1 fires < 4 | v9 wording (vehicle_accident) |
| V:vehicle_crash | 0.7 | 2/4 = 50% | 4/270 = 1% | 0 fires | precision 50% < 70%; precision 50% < Sonnet 83% - 5 | v9 wording (vehicle_crash) |
| V:or:vehicle_crash | 0.7 | 2/4 = 50% | 4/270 = 1% | 0 fires | precision 50% < 70%; precision 50% < Sonnet 83% - 5 | v9 max(vehicle_crash, vehicle_accident) |
| C:vehicle_crash.a@Lnl | 0.6 | 1/2 = 50% | 1/270 = 0% | 1/1 = 100% | 2 fires < 4; precision 50% < 70%; precision 50% < Sonnet 83% - 5 | Does a sound caption or a line in `scene.lines` show a vehicle crashing right now? |
| C:or:vehicle_crash | 0.6 | 1/3 = 33% | 1/270 = 0% | 1/1 = 100% | 3 fires < 4; precision 33% < 70%; precision 33% < Sonnet 83% - 5 | OR of Claude vehicle_crash.a, vehicle_crash.b |

## captured (captivity) -> sonnet

Best: C:captured.b@S @0.8: Does `scene.summary` say that a character is captured, kidnapped, taken prisoner, or locked up?

Sonnet (cage_net_trap, restraints, captured) @0.7: 22/43 = 51%, recall 28/58 = 48%, magic 3/7 = 43%; @0.6: 23/49 = 47%

| candidate | t | precision | recall | magic | fails | wording |
|---|---|---|---|---|---|---|
| C:captured.b@S | 0.8 | 7/11 = 64% | 7/58 = 12% | 0/1 = 0% | precision 64% < 70%; magic films 0% < 60%; recall 12% < Sonnet 48% - 5 | Does `scene.summary` say that a character is captured, kidnapped, taken prisoner, or locked up? |
| C:pruned@0.8:captured | 0.8 | 7/11 = 64% | 7/58 = 12% | 0/1 = 0% | precision 64% < 70%; magic films 0% < 60%; recall 12% < Sonnet 48% - 5 | OR of Claude phrasings kept by the prune rule at 0.8: captured.b@S |
| C:captured.b@S | 0.6 | 9/16 = 56% | 9/58 = 16% | 1/3 = 33% | precision 56% < 70%; magic films 33% < 60%; recall 16% < Sonnet 48% - 5 | Does `scene.summary` say that a character is captured, kidnapped, taken prisoner, or locked up? |
| C:pruned@0.6:captured | 0.6 | 9/16 = 56% | 9/58 = 16% | 1/3 = 33% | precision 56% < 70%; magic films 33% < 60%; recall 16% < Sonnet 48% - 5 | OR of Claude phrasings kept by the prune rule at 0.6: captured.b@S |
| V:e.captured@V9C | 0.6 | 20/44 = 45% | 25/58 = 43% | 3/9 = 33% | precision 45% < 70%; magic films 33% < 60%; precision 45% < Sonnet 51% - 5; recall 43% < Sonnet 48% - 5 | In `scene`, is a character caught and held against their will? |
| V:captured | 0.6 | 20/44 = 45% | 25/58 = 43% | 3/9 = 33% | precision 45% < 70%; magic films 33% < 60%; precision 45% < Sonnet 51% - 5; recall 43% < Sonnet 48% - 5 | v9 wording (captured) |
| V:or:captured | 0.6 | 22/51 = 43% | 27/58 = 47% | 3/11 = 27% | precision 43% < 70%; magic films 27% < 60%; precision 43% < Sonnet 51% - 5 | v9 max(cage_net_trap, restraints, captured) |
| V:e.captured@V9C | 0.7 | 16/35 = 46% | 19/58 = 33% | 3/8 = 38% | precision 46% < 70%; magic films 38% < 60%; precision 46% < Sonnet 51% - 5; recall 33% < Sonnet 48% - 5 | In `scene`, is a character caught and held against their will? |

## graveyard_funeral (objects_hazards) -> sonnet

Best: A:graveyard_funeral.a.place@L @0.6: Does `scene.lines` explicitly describe a grave, tomb, or graveyard at the scene's location?

Sonnet (graveyard_funeral) @0.7: 2/4 = 50%, recall 3/158 = 2%, magic 0 fires; @0.6: 2/4 = 50%

| candidate | t | precision | recall | magic | fails | wording |
|---|---|---|---|---|---|---|
| V:pl.graveyard_funeral@L | 0.6 | 1/2 = 50% | 2/158 = 1% | 0 fires | 2 fires < 4; precision 50% < 70% | Do `scene.lines` show that a graveyard, grave, tomb or funeral is in this scene? |
| V:pl.graveyard_funeral@L | 0.7 | 1/2 = 50% | 2/158 = 1% | 0 fires | 2 fires < 4; precision 50% < 70% | Do `scene.lines` show that a graveyard, grave, tomb or funeral is in this scene? |
| V:pl.graveyard_funeral@L | 0.8 | 1/2 = 50% | 2/158 = 1% | 0 fires | 2 fires < 4; precision 50% < 70% | Do `scene.lines` show that a graveyard, grave, tomb or funeral is in this scene? |
| V:graveyard_funeral | 0.6 | 1/2 = 50% | 2/158 = 1% | 0 fires | 2 fires < 4; precision 50% < 70% | v9 wording (graveyard_funeral) |
| V:graveyard_funeral | 0.7 | 1/2 = 50% | 2/158 = 1% | 0 fires | 2 fires < 4; precision 50% < 70% | v9 wording (graveyard_funeral) |
| V:graveyard_funeral | 0.8 | 1/2 = 50% | 2/158 = 1% | 0 fires | 2 fires < 4; precision 50% < 70% | v9 wording (graveyard_funeral) |
| C:graveyard_funeral.b@Lnl | 0.6 | 0/2 = 0% | 0/158 = 0% | 0 fires | 2 fires < 4; precision 0% < 70%; precision 0% < Sonnet 50% - 5 | Do `scene.lines` show characters at a grave or a funeral? |
| C:graveyard_funeral.b@Lnl | 0.7 | 0/2 = 0% | 0/158 = 0% | 0 fires | 2 fires < 4; precision 0% < 70%; precision 0% < Sonnet 50% - 5 | Do `scene.lines` show characters at a grave or a funeral? |

## dangerous_machine (objects_hazards) -> jev

Best: V:dangerous_machine @0.8: v9 wording (dangerous_machine)

Sonnet (dangerous_machine) @0.7: 5/8 = 63%, recall 8/158 = 5%, magic 0 fires; @0.6: 5/9 = 56%

| candidate | t | precision | recall | magic | fails | wording |
|---|---|---|---|---|---|---|
| V:dangerous_machine | 0.8 | 10/14 = 71% | 17/158 = 11% | 0 fires | passes | v9 wording (dangerous_machine) |
| C:dangerous_machine.a@LSnl | 0.7 | 5/7 = 71% | 9/158 = 6% | 0 fires | passes | In `scene`, do moving machine parts or live electricity reach a character? |
| C:dangerous_machine.a@LSnl | 0.8 | 3/4 = 75% | 5/158 = 3% | 0 fires | passes | In `scene`, do moving machine parts or live electricity reach a character? |
| V:dangerous_machine | 0.6 | 15/26 = 58% | 24/158 = 15% | 0 fires | precision 58% < 70% | v9 wording (dangerous_machine) |
| V:dangerous_machine | 0.7 | 13/22 = 59% | 22/158 = 14% | 0 fires | precision 59% < 70% | v9 wording (dangerous_machine) |
| C:dangerous_machine.a@LSnl | 0.6 | 6/10 = 60% | 10/158 = 6% | 0 fires | precision 60% < 70% | In `scene`, do moving machine parts or live electricity reach a character? |
| A:dangerous_machine.a.mechanism@L | 0.6 | 2/3 = 67% | 4/158 = 3% | 0 fires | 3 fires < 4; precision 67% < 70% | Does `scene.lines` describe exposed cutting, crushing, or trapping machinery operating here? |
| A:dangerous_machine.a.mechanism@max | 0.6 | 2/3 = 67% | 4/158 = 3% | 0 fires | 3 fires < 4; precision 67% < 70% | max over channels: Does {lines/summary} describe exposed cutting, crushing, or trapping machinery operating here? |

## chased (peril) -> jev

Best: C:chased.c@S @0.6: Does `scene.summary` say that a character is chased, pursued, hunted, or flees from someone?

| candidate | t | precision | recall | magic | fails | wording |
|---|---|---|---|---|---|---|
| C:chased.c@S | 0.6 | 14/19 = 74% | 29/270 = 11% | 2/3 = 67% | passes | Does `scene.summary` say that a character is chased, pursued, hunted, or flees from someone? |
| A:chased.a@S | 0.6 | 6/7 = 86% | 10/270 = 4% | 0 fires | passes | Does `scene.summary` explicitly describe one character pursuing another to catch them during this scene? |
| A:pruned@0.6:chased | 0.6 | 6/7 = 86% | 10/270 = 4% | 0 fires | passes | OR of Astra phrasings kept by the prune rule at 0.6: chased.a@S |
| A:chased.a@S | 0.7 | 5/6 = 83% | 7/270 = 3% | 0 fires | passes | Does `scene.summary` explicitly describe one character pursuing another to catch them during this scene? |
| A:pruned@0.7:chased | 0.7 | 5/6 = 83% | 7/270 = 3% | 0 fires | passes | OR of Astra phrasings kept by the prune rule at 0.7: chased.a@S |
| A:chased.a@S | 0.8 | 4/5 = 80% | 6/270 = 2% | 0 fires | passes | Does `scene.summary` explicitly describe one character pursuing another to catch them during this scene? |
| V:chased | 0.6 | 42/61 = 69% | 87/270 = 32% | 8/13 = 62% | precision 69% < 70% | v9 wording (chased) |
| V:chased | 0.7 | 33/51 = 65% | 74/270 = 27% | 6/10 = 60% | precision 65% < 70% | v9 wording (chased) |

## attacked (peril) -> jev

Best: C:attacked.b@Lnl @0.7: Does a sound caption or line in `scene.lines` show a blow landing on a character, followed by a cry of pain or a plea?

| candidate | t | precision | recall | magic | fails | wording |
|---|---|---|---|---|---|---|
| C:attacked.b@Lnl | 0.8 | 4/4 = 100% | 7/270 = 3% | 2/2 = 100% | passes | Does a sound caption or line in `scene.lines` show a blow landing on a character, followed by a cry of pain or a plea? |
| C:pruned@0.8:attacked | 0.8 | 4/4 = 100% | 7/270 = 3% | 2/2 = 100% | passes | OR of Claude phrasings kept by the prune rule at 0.8: attacked.b@Lnl |
| C:attacked.b@Lnl | 0.7 | 8/10 = 80% | 13/270 = 5% | 4/5 = 80% | passes | Does a sound caption or line in `scene.lines` show a blow landing on a character, followed by a cry of pain or a plea? |
| V:attacked | 0.6 | 25/38 = 66% | 58/270 = 21% | 9/13 = 69% | precision 66% < 70% | v9 wording (attacked) |
| V:attacked | 0.7 | 15/23 = 65% | 38/270 = 14% | 6/8 = 75% | precision 65% < 70% | v9 wording (attacked) |
| C:or:attacked | 0.7 | 12/19 = 63% | 21/270 = 8% | 5/6 = 83% | precision 63% < 70% | OR of Claude attacked.a, attacked.b |
| V:attacked | 0.8 | 11/18 = 61% | 27/270 = 10% | 5/7 = 71% | precision 61% < 70% | v9 wording (attacked) |
| A:attacked.a@max | 0.7 | 8/13 = 62% | 16/270 = 6% | 1/1 = 100% | precision 62% < 70% | max over channels: Does {lines/summary} explicitly describe a character directing a physical attack at another character now? |

## falls (peril) -> jev

Best: V:falls @0.8: v9 wording (falls)

| candidate | t | precision | recall | magic | fails | wording |
|---|---|---|---|---|---|---|
| A:falls.a@max | 0.8 | 3/4 = 75% | 7/270 = 3% | 0 fires | passes | max over channels: Does {lines/summary} explicitly describe a character falling from a cliff, roof, bridge, tree, or another long drop? |
| A:bundle:falls | 0.8 | 3/4 = 75% | 7/270 = 3% | 0 fires | passes | Astra falls: (1) over falls.a |
| C:or:falls | 0.6 | 3/4 = 75% | 7/270 = 3% | 0 fires | passes | OR of Claude falls.a, falls.b |
| C:or:falls | 0.7 | 3/4 = 75% | 7/270 = 3% | 0 fires | passes | OR of Claude falls.a, falls.b |
| C:or:falls | 0.8 | 3/4 = 75% | 7/270 = 3% | 0 fires | passes | OR of Claude falls.a, falls.b |
| V:falls | 0.8 | 3/4 = 75% | 7/270 = 3% | 0 fires | passes | v9 wording (falls) |
| V:falls | 0.6 | 4/6 = 67% | 8/270 = 3% | 0 fires | precision 67% < 70% | v9 wording (falls) |
| V:falls | 0.7 | 4/6 = 67% | 8/270 = 3% | 0 fires | precision 67% < 70% | v9 wording (falls) |

## nearly_falls (peril) -> jev

Best: C:nearly_falls.a@Lnl @0.6: Does a character in `scene.lines` shout to hold on or not let go while someone hangs over a drop?

| candidate | t | precision | recall | magic | fails | wording |
|---|---|---|---|---|---|---|
| C:nearly_falls.a@Lnl | 0.7 | 5/6 = 83% | 6/270 = 2% | 0 fires | passes | Does a character in `scene.lines` shout to hold on or not let go while someone hangs over a drop? |
| C:or:nearly_falls | 0.7 | 5/6 = 83% | 6/270 = 2% | 0 fires | passes | OR of Claude nearly_falls.a, nearly_falls.b |
| V:nearly_falls | 0.6 | 5/6 = 83% | 8/270 = 3% | 1/1 = 100% | passes | v9 wording (nearly_falls) |
| C:nearly_falls.a@Lnl | 0.6 | 7/10 = 70% | 9/270 = 3% | 1/1 = 100% | passes | Does a character in `scene.lines` shout to hold on or not let go while someone hangs over a drop? |
| C:or:nearly_falls | 0.6 | 7/10 = 70% | 9/270 = 3% | 1/1 = 100% | passes | OR of Claude nearly_falls.a, nearly_falls.b |
| C:nearly_falls.a@Lnl | 0.8 | 3/4 = 75% | 4/270 = 1% | 0 fires | passes | Does a character in `scene.lines` shout to hold on or not let go while someone hangs over a drop? |
| C:or:nearly_falls | 0.8 | 3/4 = 75% | 4/270 = 1% | 0 fires | passes | OR of Claude nearly_falls.a, nearly_falls.b |
| C:nearly_falls.b@S | 0.6 | 1/1 = 100% | 2/270 = 1% | 0 fires | 1 fires < 4 | Does `scene.summary` say that a character dangles, hangs from a ledge, or nearly falls? |

## cannot_breathe (peril) -> jev

Best: V:cannot_breathe @0.6: v9 wording (cannot_breathe)

| candidate | t | precision | recall | magic | fails | wording |
|---|---|---|---|---|---|---|
| V:cannot_breathe | 0.6 | 9/9 = 100% | 13/270 = 5% | 2/2 = 100% | passes | v9 wording (cannot_breathe) |
| V:cannot_breathe | 0.7 | 8/8 = 100% | 12/270 = 4% | 2/2 = 100% | passes | v9 wording (cannot_breathe) |
| V:cannot_breathe | 0.8 | 7/7 = 100% | 9/270 = 3% | 2/2 = 100% | passes | v9 wording (cannot_breathe) |
| C:cannot_breathe.a@Lnl | 0.6 | 0/1 = 0% | 0/270 = 0% | 0 fires | 1 fires < 4; precision 0% < 70% | Does a character in `scene.lines` say that someone cannot breathe or is drowning right now? |
| C:cannot_breathe.a@Lnl | 0.7 | 0/1 = 0% | 0/270 = 0% | 0 fires | 1 fires < 4; precision 0% < 70% | Does a character in `scene.lines` say that someone cannot breathe or is drowning right now? |
| C:cannot_breathe.a@Lnl | 0.8 | 0/1 = 0% | 0/270 = 0% | 0 fires | 1 fires < 4; precision 0% < 70% | Does a character in `scene.lines` say that someone cannot breathe or is drowning right now? |
| A:cannot_breathe.a.words@L | 0.6 | 0/1 = 0% | 0/270 = 0% | 0 fires | 1 fires < 4; precision 0% < 70% | Does a character literally say that someone cannot breathe right now? |
| A:cannot_breathe.a.words@L | 0.7 | 0/1 = 0% | 0/270 = 0% | 0 fires | 1 fires < 4; precision 0% < 70% | Does a character literally say that someone cannot breathe right now? |

## caught_in_hazard (peril) -> jev

Best: V:caught_in_hazard @0.6: v9 wording (caught_in_hazard)

| candidate | t | precision | recall | magic | fails | wording |
|---|---|---|---|---|---|---|
| V:caught_in_hazard | 0.6 | 34/41 = 83% | 62/270 = 23% | 4/4 = 100% | passes | v9 wording (caught_in_hazard) |
| V:caught_in_hazard | 0.7 | 21/26 = 81% | 42/270 = 16% | 2/2 = 100% | passes | v9 wording (caught_in_hazard) |
| V:caught_in_hazard | 0.8 | 14/18 = 78% | 24/270 = 9% | 1/1 = 100% | passes | v9 wording (caught_in_hazard) |
| C:or:caught_in_hazard | 0.6 | 6/7 = 86% | 11/270 = 4% | 1/1 = 100% | passes | OR of Claude caught_in_hazard.a, caught_in_hazard.b |
| C:caught_in_hazard.a@S | 0.6 | 3/4 = 75% | 5/270 = 2% | 1/1 = 100% | passes | Does `scene.summary` say that a character is caught in a fire, a flood, rushing water, a storm, a collapse, an avalanche, or lava? |
| C:caught_in_hazard.a@S | 0.7 | 3/4 = 75% | 5/270 = 2% | 1/1 = 100% | passes | Does `scene.summary` say that a character is caught in a fire, a flood, rushing water, a storm, a collapse, an avalanche, or lava? |
| A:caught_in_hazard.a.machine@S | 0.8 | 3/4 = 75% | 6/270 = 2% | 0 fires | passes | Does `scene.summary` describe machinery catching a character's body now? |
| A:caught_in_hazard.a.machine@max | 0.8 | 3/4 = 75% | 6/270 = 2% | 0 fires | passes | max over channels: Does {lines/summary} describe machinery catching a character's body now? |

## child_in_danger (peril) -> jev

Best: C:child_in_danger.a@LSnlC @0.8: In `scene`, is a child in physical danger?

| candidate | t | precision | recall | magic | fails | wording |
|---|---|---|---|---|---|---|
| V:child_in_danger | 0.8 | 18/20 = 90% | 39/270 = 14% | 2/2 = 100% | passes | v9 wording (child_in_danger) |
| C:child_in_danger.a@LSnlC | 0.8 | 27/38 = 71% | 47/270 = 17% | 2/3 = 67% | passes | In `scene`, is a child in physical danger? |
| A:child_in_danger.a.hazard@LC | 0.7 | 16/21 = 76% | 29/270 = 11% | 1/1 = 100% | passes | Does `scene.lines` explicitly describe an active physical hazard acting on a child now? |
| A:child_in_danger.a.hazard@max | 0.7 | 17/23 = 74% | 30/270 = 11% | 1/1 = 100% | passes | max over channels: Does {lines/summary} explicitly describe an active physical hazard acting on a child now? |
| A:child_in_danger.a.attack@LC | 0.7 | 5/6 = 83% | 11/270 = 4% | 2/2 = 100% | passes | Does `scene.lines` describe a child being physically attacked now? |
| A:child_in_danger.a.hazard@SC | 0.7 | 4/5 = 80% | 7/270 = 3% | 0 fires | passes | Does `scene.summary` explicitly describe an active physical hazard acting on a child now? |
| A:child_in_danger.a.hazard@SC | 0.6 | 5/7 = 71% | 8/270 = 3% | 0 fires | passes | Does `scene.summary` explicitly describe an active physical hazard acting on a child now? |
| A:child_in_danger.a.attack@max | 0.7 | 5/7 = 71% | 11/270 = 4% | 2/2 = 100% | passes | max over channels: Does {lines/summary} describe a child being physically attacked now? |

## creature_threat (peril) -> jev

Best: V:creature_threat @0.6: v9 wording (creature_threat)

| candidate | t | precision | recall | magic | fails | wording |
|---|---|---|---|---|---|---|
| V:creature_threat | 0.8 | 28/34 = 82% | 72/270 = 27% | 6/8 = 75% | passes | v9 wording (creature_threat) |
| V:creature_threat | 0.7 | 38/48 = 79% | 86/270 = 32% | 8/11 = 73% | passes | v9 wording (creature_threat) |
| V:creature_threat | 0.6 | 49/66 = 74% | 111/270 = 41% | 8/13 = 62% | passes | v9 wording (creature_threat) |
| A:creature_threat.a.attack@max | 0.6 | 33/43 = 77% | 79/270 = 29% | 7/8 = 88% | passes | max over channels: Does {lines/summary} describe an animal or creature physically attacking another character now? |
| C:creature_threat.b@S | 0.6 | 15/18 = 83% | 38/270 = 14% | 2/2 = 100% | passes | Does `scene.summary` say that an animal or creature attacks, hunts, or chases a character? |
| A:creature_threat.a.attack@max | 0.7 | 19/24 = 79% | 45/270 = 17% | 2/2 = 100% | passes | max over channels: Does {lines/summary} describe an animal or creature physically attacking another character now? |
| C:pruned@0.6:creature_threat | 0.6 | 39/54 = 72% | 88/270 = 33% | 10/13 = 77% | passes | OR of Claude phrasings kept by the prune rule at 0.6: creature_threat.a@LSnl, creature_threat.b@S |
| C:creature_threat.a@LSnl | 0.6 | 37/51 = 73% | 84/270 = 31% | 10/13 = 77% | passes | In `scene`, does an animal or creature attack, bite, grab, or charge at a character? |

## weapon_used (violence) -> sonnet

Best: V:e.weapon_used@V9C @0.6: In `scene`, is a weapon used against a character, such as fired, swung, or thrown at them?

Sonnet (weapon_used) @0.7: 20/27 = 74%, recall 46/202 = 23%, magic 4/5 = 80%; @0.6: 25/34 = 74%

| candidate | t | precision | recall | magic | fails | wording |
|---|---|---|---|---|---|---|
| V:e.weapon_used@V9C | 0.6 | 11/17 = 65% | 29/202 = 14% | 3/3 = 100% | precision 65% < 70%; precision 65% < Sonnet 74% - 5; recall 14% < Sonnet 23% - 5 | In `scene`, is a weapon used against a character, such as fired, swung, or thrown at them? |
| V:weapon_used | 0.6 | 11/17 = 65% | 29/202 = 14% | 3/3 = 100% | precision 65% < 70%; precision 65% < Sonnet 74% - 5; recall 14% < Sonnet 23% - 5 | v9 wording (weapon_used) |
| V:e.weapon_used@V9C | 0.7 | 6/9 = 67% | 15/202 = 7% | 1/1 = 100% | precision 67% < 70%; precision 67% < Sonnet 74% - 5; recall 7% < Sonnet 23% - 5 | In `scene`, is a weapon used against a character, such as fired, swung, or thrown at them? |
| V:weapon_used | 0.7 | 6/9 = 67% | 15/202 = 7% | 1/1 = 100% | precision 67% < 70%; precision 67% < Sonnet 74% - 5; recall 7% < Sonnet 23% - 5 | v9 wording (weapon_used) |
| V:e.weapon_used@V9C | 0.8 | 5/8 = 63% | 14/202 = 7% | 1/1 = 100% | precision 63% < 70%; precision 63% < Sonnet 74% - 5; recall 7% < Sonnet 23% - 5 | In `scene`, is a weapon used against a character, such as fired, swung, or thrown at them? |
| V:weapon_used | 0.8 | 5/8 = 63% | 14/202 = 7% | 1/1 = 100% | precision 63% < 70%; precision 63% < Sonnet 74% - 5; recall 7% < Sonnet 23% - 5 | v9 wording (weapon_used) |
| A:weapon_used.a@max | 0.8 | 3/4 = 75% | 9/202 = 4% | 0 fires | recall 4% < Sonnet 23% - 5 | max over channels: Does {lines/summary} explicitly describe a weapon being fired, swung, or thrown at a character now? |
| A:bundle:weapon_used | 0.8 | 3/4 = 75% | 9/202 = 4% | 0 fires | recall 4% < Sonnet 23% - 5 | Astra weapon_used: (1) over weapon_used.a |

## battle (violence) -> jev

Best: V:battle @0.6: v9 wording (battle)

| candidate | t | precision | recall | magic | fails | wording |
|---|---|---|---|---|---|---|
| V:battle | 0.7 | 20/21 = 95% | 41/202 = 20% | 7/7 = 100% | passes | v9 wording (battle) |
| V:battle | 0.8 | 13/13 = 100% | 27/202 = 13% | 6/6 = 100% | passes | v9 wording (battle) |
| V:battle | 0.6 | 25/32 = 78% | 52/202 = 26% | 8/9 = 89% | passes | v9 wording (battle) |
| C:battle.a@LSnl | 0.6 | 13/16 = 81% | 33/202 = 16% | 4/5 = 80% | passes | In `scene`, are many characters fighting each other at the same time? |
| C:battle.a@LSnl | 0.7 | 8/9 = 89% | 21/202 = 10% | 3/4 = 75% | passes | In `scene`, are many characters fighting each other at the same time? |
| C:battle.a@LSnl | 0.8 | 4/4 = 100% | 7/202 = 3% | 3/3 = 100% | passes | In `scene`, are many characters fighting each other at the same time? |
| A:battle.a@max | 0.6 | 4/5 = 80% | 7/202 = 3% | 3/3 = 100% | passes | max over channels: Does {lines/summary} explicitly describe opposing groups physically fighting during this scene? |
| A:bundle:battle | 0.6 | 4/5 = 80% | 7/202 = 3% | 3/3 = 100% | passes | Astra battle: (1) over battle.a |

## trapped (captivity) -> sonnet

Best: A:trapped.a@S @0.6: Does `scene.summary` explicitly state that a physical barrier prevents a character from leaving their location?

Sonnet (trapped) @0.7: 12/34 = 35%, recall 15/58 = 26%, magic 1/4 = 25%; @0.6: 13/37 = 35%

| candidate | t | precision | recall | magic | fails | wording |
|---|---|---|---|---|---|---|
| A:trapped.a@S | 0.6 | 7/11 = 64% | 8/58 = 14% | 0/2 = 0% | precision 64% < 70%; magic films 0% < 60%; recall 14% < Sonnet 26% - 5 | Does `scene.summary` explicitly state that a physical barrier prevents a character from leaving their location? |
| A:pruned@0.6:trapped | 0.6 | 7/11 = 64% | 8/58 = 14% | 0/2 = 0% | precision 64% < 70%; magic films 0% < 60%; recall 14% < Sonnet 26% - 5 | OR of Astra phrasings kept by the prune rule at 0.6: trapped.a@S |
| A:trapped.a@S | 0.8 | 3/4 = 75% | 3/58 = 5% | 0 fires | recall 5% < Sonnet 26% - 5 | Does `scene.summary` explicitly state that a physical barrier prevents a character from leaving their location? |
| A:trapped.a@max | 0.8 | 3/4 = 75% | 3/58 = 5% | 0 fires | recall 5% < Sonnet 26% - 5 | max over channels: Does {lines/summary} explicitly state that a physical barrier prevents a character from leaving their location? |
| A:bundle:trapped | 0.8 | 3/4 = 75% | 3/58 = 5% | 0 fires | recall 5% < Sonnet 26% - 5 | Astra trapped: (1) over trapped.a |
| A:trapped.a@S | 0.7 | 4/6 = 67% | 4/58 = 7% | 0/1 = 0% | precision 67% < 70%; magic films 0% < 60%; recall 7% < Sonnet 26% - 5 | Does `scene.summary` explicitly state that a physical barrier prevents a character from leaving their location? |
| A:trapped.a@max | 0.7 | 4/7 = 57% | 4/58 = 7% | 0/2 = 0% | precision 57% < 70%; magic films 0% < 60%; recall 7% < Sonnet 26% - 5 | max over channels: Does {lines/summary} explicitly state that a physical barrier prevents a character from leaving their location? |
| A:bundle:trapped | 0.7 | 4/7 = 57% | 4/58 = 7% | 0/2 = 0% | precision 57% < 70%; magic films 0% < 60%; recall 7% < Sonnet 26% - 5 | Astra trapped: (1) over trapped.a |

## swallowed (captivity) -> sonnet

Best: V:e.swallowed@V9C @0.6: In `scene`, is a character swallowed or held inside a creature's mouth?

Sonnet (swallowed) @0.7: 2/2 = 100%, recall 3/58 = 5%, magic 0 fires; @0.6: 2/3 = 67%

| candidate | t | precision | recall | magic | fails | wording |
|---|---|---|---|---|---|---|
| C:swallowed.a@LSnl | 0.7 | 2/2 = 100% | 3/58 = 5% | 0 fires | 2 fires < 4 | In `scene`, is a character swallowed, or held inside a creature's mouth or stomach? |
| V:e.swallowed@V9C | 0.6 | 3/5 = 60% | 4/58 = 7% | 0/1 = 0% | precision 60% < 70%; magic films 0% < 60%; precision 60% < Sonnet 100% - 5 | In `scene`, is a character swallowed or held inside a creature's mouth? |
| V:swallowed | 0.6 | 3/5 = 60% | 4/58 = 7% | 0/1 = 0% | precision 60% < 70%; magic films 0% < 60%; precision 60% < Sonnet 100% - 5 | v9 wording (swallowed) |
| V:e.swallowed@V9C | 0.7 | 2/3 = 67% | 3/58 = 5% | 0/1 = 0% | 3 fires < 4; precision 67% < 70%; magic films 0% < 60%; precision 67% < Sonnet 100% - 5 | In `scene`, is a character swallowed or held inside a creature's mouth? |
| V:swallowed | 0.7 | 2/3 = 67% | 3/58 = 5% | 0/1 = 0% | 3 fires < 4; precision 67% < 70%; magic films 0% < 60%; precision 67% < Sonnet 100% - 5 | v9 wording (swallowed) |
| C:swallowed.a@LSnl | 0.8 | 1/1 = 100% | 2/58 = 3% | 0 fires | 1 fires < 4 | In `scene`, is a character swallowed, or held inside a creature's mouth or stomach? |
| A:swallowed.a.ingested@L | 0.6 | 1/1 = 100% | 1/58 = 2% | 0 fires | 1 fires < 4 | Does `scene.lines` state that a creature swallows a character during this scene? |
| A:swallowed.a.ingested@L | 0.7 | 1/1 = 100% | 1/58 = 2% | 0 fires | 1 fires < 4 | Does `scene.lines` state that a creature swallows a character during this scene? |

## injured (injury) -> sonnet

Best: C:or:injured @0.7: OR of Claude injured.a, injured.b

| candidate | t | precision | recall | magic | fails | wording |
|---|---|---|---|---|---|---|
| C:or:injured | 0.7 | 21/42 = 50% | 38/82 = 46% | 6/9 = 67% | precision 50% < 70% | OR of Claude injured.a, injured.b |
| C:injured.a@Lnl | 0.7 | 16/31 = 52% | 30/82 = 37% | 5/8 = 63% | precision 52% < 70% | Does a character in `scene.lines` cry out in pain or say that someone is hurt? |
| C:or:injured | 0.8 | 15/29 = 52% | 30/82 = 37% | 5/7 = 71% | precision 52% < 70% | OR of Claude injured.a, injured.b |
| A:bundle:injured | 0.6 | 10/18 = 56% | 18/82 = 22% | 4/5 = 80% | precision 56% < 70% | Astra injured: ((1) OR (2)) over injured.a.summary, injured.a.words |
| A:bundle:injured | 0.7 | 9/16 = 56% | 17/82 = 21% | 3/4 = 75% | precision 56% < 70% | Astra injured: ((1) OR (2)) over injured.a.summary, injured.a.words |
| C:or:injured | 0.6 | 27/61 = 44% | 44/82 = 54% | 6/14 = 43% | precision 44% < 70%; magic films 43% < 60% | OR of Claude injured.a, injured.b |
| C:injured.a@Lnl | 0.8 | 11/21 = 52% | 23/82 = 28% | 4/6 = 67% | precision 52% < 70% | Does a character in `scene.lines` cry out in pain or say that someone is hurt? |
| A:bundle:injured | 0.8 | 6/10 = 60% | 14/82 = 17% | 2/2 = 100% | precision 60% < 70% | Astra injured: ((1) OR (2)) over injured.a.summary, injured.a.words |

## badly_hurt (injury) -> sonnet

Best: V:badly_hurt @0.7: v9 wording (badly_hurt)

| candidate | t | precision | recall | magic | fails | wording |
|---|---|---|---|---|---|---|
| V:badly_hurt | 0.7 | 7/17 = 41% | 15/82 = 18% | 3/3 = 100% | precision 41% < 70% | v9 wording (badly_hurt) |
| V:badly_hurt | 0.6 | 9/24 = 38% | 19/82 = 23% | 3/6 = 50% | precision 38% < 70%; magic films 50% < 60% | v9 wording (badly_hurt) |
| C:badly_hurt.b@Lnl | 0.7 | 2/3 = 67% | 3/82 = 4% | 1/1 = 100% | 3 fires < 4; precision 67% < 70% | Does a character in `scene.lines` say that someone here is badly hurt or will not wake up? |
| C:badly_hurt.b@Lnl | 0.8 | 2/3 = 67% | 3/82 = 4% | 1/1 = 100% | 3 fires < 4; precision 67% < 70% | Does a character in `scene.lines` say that someone here is badly hurt or will not wake up? |
| C:pruned@0.7:badly_hurt | 0.7 | 2/3 = 67% | 3/82 = 4% | 1/1 = 100% | 3 fires < 4; precision 67% < 70% | OR of Claude phrasings kept by the prune rule at 0.7: badly_hurt.b@Lnl |
| C:pruned@0.8:badly_hurt | 0.8 | 2/3 = 67% | 3/82 = 4% | 1/1 = 100% | 3 fires < 4; precision 67% < 70% | OR of Claude phrasings kept by the prune rule at 0.8: badly_hurt.b@Lnl |
| C:or:badly_hurt | 0.6 | 5/12 = 42% | 11/82 = 13% | 1/1 = 100% | precision 42% < 70% | OR of Claude badly_hurt.a, badly_hurt.b |
| C:badly_hurt.a@S | 0.6 | 4/10 = 40% | 10/82 = 12% | 0 fires | precision 40% < 70% | Does `scene.summary` say that a character is badly hurt, knocked out, bleeding, crushed, or cannot get up? |

## dies (death) -> sonnet

Best: C:bundle:dies @0.7: Claude combine: max(a, b, dead_body) OR (c if max(a, b, seriously_ill.a) >= 0.4)

Sonnet (dies) @0.7: 9/10 = 90%, recall 26/133 = 20%, magic 5/5 = 100%; @0.6: 9/10 = 90%

| candidate | t | precision | recall | magic | fails | wording |
|---|---|---|---|---|---|---|
| C:bundle:dies | 0.7 | 17/23 = 74% | 34/133 = 26% | 2/3 = 67% | precision 74% < Sonnet 90% - 5 | Claude combine: max(a, b, dead_body) OR (c if max(a, b, seriously_ill.a) >= 0.4) |
| V:e.dies@V9C | 0.6 | 9/11 = 82% | 20/133 = 15% | 4/4 = 100% | precision 82% < Sonnet 90% - 5 | In `scene`, does a character die or get killed? |
| V:dies | 0.6 | 9/11 = 82% | 20/133 = 15% | 4/4 = 100% | precision 82% < Sonnet 90% - 5 | v9 wording (dies) |
| V:e.dies@V9C | 0.7 | 8/10 = 80% | 18/133 = 14% | 3/3 = 100% | precision 80% < Sonnet 90% - 5; recall 14% < Sonnet 20% - 5 | In `scene`, does a character die or get killed? |
| V:dies | 0.7 | 8/10 = 80% | 18/133 = 14% | 3/3 = 100% | precision 80% < Sonnet 90% - 5; recall 14% < Sonnet 20% - 5 | v9 wording (dies) |
| C:bundle:dies | 0.6 | 19/30 = 63% | 39/133 = 29% | 3/5 = 60% | precision 63% < 70%; precision 63% < Sonnet 90% - 5 | Claude combine: max(a, b, dead_body) OR (c if max(a, b, seriously_ill.a) >= 0.4) |
| C:or:dies | 0.7 | 14/21 = 67% | 28/133 = 21% | 2/3 = 67% | precision 67% < 70%; precision 67% < Sonnet 90% - 5 | OR of Claude dies.a, dies.b, dies.c |
| C:dies.b@S | 0.6 | 8/11 = 73% | 22/133 = 17% | 2/2 = 100% | precision 73% < Sonnet 90% - 5 | Does `scene.summary` say that a character dies, is killed, or is dying in this scene? |

## loved_one_dies (death) -> jev

Best: V:loved_one_dies @0.7: v9 wording (loved_one_dies)

Sonnet (loved_one_dies) @0.7: 8/10 = 80%, recall 18/133 = 14%, magic 5/5 = 100%; @0.6: 9/11 = 82%

| candidate | t | precision | recall | magic | fails | wording |
|---|---|---|---|---|---|---|
| V:loved_one_dies | 0.7 | 9/12 = 75% | 20/133 = 15% | 4/4 = 100% | passes | v9 wording (loved_one_dies) |
| A:loved_one_dies.a.family@LS | 0.6 | 5/6 = 83% | 10/133 = 8% | 3/3 = 100% | recall 8% < Sonnet 14% - 5 | Does the supplied evidence explicitly identify the character who dies in this scene as another character's family member? |
| V:loved_one_dies | 0.6 | 13/22 = 59% | 32/133 = 24% | 6/9 = 67% | precision 59% < 70%; precision 59% < Sonnet 80% - 5 | v9 wording (loved_one_dies) |
| A:loved_one_dies.a.death@S | 0.6 | 3/4 = 75% | 7/133 = 5% | 1/1 = 100% | recall 5% < Sonnet 14% - 5 | Does `scene.summary` explicitly state that a character dies during this scene? |
| V:loved_one_dies | 0.8 | 3/5 = 60% | 6/133 = 5% | 1/1 = 100% | precision 60% < 70%; precision 60% < Sonnet 80% - 5; recall 5% < Sonnet 14% - 5 | v9 wording (loved_one_dies) |
| A:loved_one_dies.a.family@LS | 0.7 | 2/3 = 67% | 2/133 = 2% | 1/1 = 100% | 3 fires < 4; precision 67% < 70%; precision 67% < Sonnet 80% - 5; recall 2% < Sonnet 14% - 5 | Does the supplied evidence explicitly identify the character who dies in this scene as another character's family member? |
| C:bundle:loved_one_dies | 0.8 | 3/7 = 43% | 5/133 = 4% | 1/2 = 50% | precision 43% < 70%; magic films 50% < 60%; precision 43% < Sonnet 80% - 5; recall 4% < Sonnet 14% - 5 | Claude combine: max(a, b) AND dies >= 0.4 |
| C:or:loved_one_dies | 0.8 | 3/7 = 43% | 5/133 = 4% | 1/2 = 50% | precision 43% < 70%; magic films 50% < 60%; precision 43% < Sonnet 80% - 5; recall 4% < Sonnet 14% - 5 | OR of Claude loved_one_dies.a, loved_one_dies.b |

## pet_dies (death) -> jev

Best: C:or:pet_dies @0.6: OR of Claude pet_dies.a, pet_dies.b

Sonnet (pet_dies) @0.7: 2/3 = 67%, recall 2/133 = 2%, magic 0 fires; @0.6: 2/3 = 67%

| candidate | t | precision | recall | magic | fails | wording |
|---|---|---|---|---|---|---|
| C:or:pet_dies | 0.6 | 3/4 = 75% | 6/133 = 5% | 0 fires | passes | OR of Claude pet_dies.a, pet_dies.b |
| A:pet_dies.a.death@S | 0.6 | 2/2 = 100% | 3/133 = 2% | 0 fires | 2 fires < 4 | Does `scene.summary` explicitly state that an animal dies during this scene? |
| A:pet_dies.a.death@S | 0.7 | 2/2 = 100% | 3/133 = 2% | 0 fires | 2 fires < 4 | Does `scene.summary` explicitly state that an animal dies during this scene? |
| A:pet_dies.a.death@S | 0.8 | 2/2 = 100% | 3/133 = 2% | 0 fires | 2 fires < 4 | Does `scene.summary` explicitly state that an animal dies during this scene? |
| C:pet_dies.a@S | 0.6 | 2/3 = 67% | 4/133 = 3% | 0 fires | 3 fires < 4; precision 67% < 70% | Does `scene.summary` say that a pet dies or is killed? |
| C:or:pet_dies | 0.7 | 2/3 = 67% | 3/133 = 2% | 0 fires | 3 fires < 4; precision 67% < 70% | OR of Claude pet_dies.a, pet_dies.b |
| V:pet_dies | 0.6 | 2/3 = 67% | 2/133 = 2% | 0 fires | 3 fires < 4; precision 67% < 70% | v9 wording (pet_dies) |
| C:pet_dies.b@Lnl | 0.6 | 1/1 = 100% | 2/133 = 2% | 0 fires | 1 fires < 4 | Does a character in `scene.lines` say that their pet has just died? |

## believed_dead (death) -> sonnet

Best: V:believed_dead @0.6: v9 wording (believed_dead)

Sonnet (believed_dead) @0.7: 9/22 = 41%, recall 15/133 = 11%, magic 2/5 = 40%; @0.6: 10/27 = 37%

| candidate | t | precision | recall | magic | fails | wording |
|---|---|---|---|---|---|---|
| V:believed_dead | 0.6 | 19/42 = 45% | 41/133 = 31% | 7/13 = 54% | precision 45% < 70%; magic films 54% < 60% | v9 wording (believed_dead) |
| V:believed_dead | 0.7 | 14/32 = 44% | 28/133 = 21% | 5/10 = 50% | precision 44% < 70%; magic films 50% < 60% | v9 wording (believed_dead) |
| V:believed_dead | 0.8 | 8/17 = 47% | 14/133 = 11% | 5/7 = 71% | precision 47% < 70% | v9 wording (believed_dead) |
| C:or:believed_dead | 0.6 | 6/21 = 29% | 12/133 = 9% | 1/4 = 25% | precision 29% < 70%; magic films 25% < 60%; precision 29% < Sonnet 41% - 5 | OR of Claude believed_dead.a, believed_dead.b |
| C:believed_dead.b@S | 0.6 | 5/17 = 29% | 10/133 = 8% | 1/3 = 33% | precision 29% < 70%; magic films 33% < 60%; precision 29% < Sonnet 41% - 5 | Does `scene.summary` say that a character thinks, believes, or is told that someone is dead? |
| C:believed_dead.b@S | 0.7 | 5/17 = 29% | 10/133 = 8% | 1/3 = 33% | precision 29% < 70%; magic films 33% < 60%; precision 29% < Sonnet 41% - 5 | Does `scene.summary` say that a character thinks, believes, or is told that someone is dead? |
| C:or:believed_dead | 0.7 | 5/18 = 28% | 10/133 = 8% | 1/4 = 25% | precision 28% < 70%; magic films 25% < 60%; precision 28% < Sonnet 41% - 5 | OR of Claude believed_dead.a, believed_dead.b |
| C:believed_dead.a@Lnl | 0.6 | 2/8 = 25% | 3/133 = 2% | 1/3 = 33% | precision 25% < 70%; magic films 33% < 60%; precision 25% < Sonnet 41% - 5; recall 2% < Sonnet 11% - 5 | Does a character in `scene.lines` cry out or say that someone they love is dead? |

## parent_death_learned (death) -> sonnet

Best: V:parent_death_learned @0.6: v9 wording (parent_death_learned)

Sonnet (parent_death_learned) @0.7: 2/3 = 67%, recall 4/133 = 3%, magic 0 fires; @0.6: 2/3 = 67%

| candidate | t | precision | recall | magic | fails | wording |
|---|---|---|---|---|---|---|
| V:parent_death_learned | 0.6 | 3/5 = 60% | 8/133 = 6% | 0 fires | precision 60% < 70%; precision 60% < Sonnet 67% - 5 | v9 wording (parent_death_learned) |
| C:bundle:parent_death_learned | 0.6 | 2/3 = 67% | 7/133 = 5% | 0 fires | 3 fires < 4; precision 67% < 70% | Claude combine: max(a, b AND dies >= 0.4) |
| C:parent_death_learned.b@LnlC | 0.7 | 1/1 = 100% | 3/133 = 2% | 0 fires | 1 fires < 4 | Does a young character in `scene.lines` call out to their mother or father who does not answer, or say their parent is dead? |
| C:parent_death_learned.b@LnlC | 0.8 | 1/1 = 100% | 3/133 = 2% | 0 fires | 1 fires < 4 | Does a young character in `scene.lines` call out to their mother or father who does not answer, or say their parent is dead? |
| C:or:parent_death_learned | 0.6 | 3/6 = 50% | 8/133 = 6% | 1/1 = 100% | precision 50% < 70%; precision 50% < Sonnet 67% - 5 | OR of Claude parent_death_learned.a, parent_death_learned.b |
| C:parent_death_learned.b@LnlC | 0.6 | 2/4 = 50% | 4/133 = 3% | 1/1 = 100% | precision 50% < 70%; precision 50% < Sonnet 67% - 5 | Does a young character in `scene.lines` call out to their mother or father who does not answer, or say their parent is dead? |
| V:parent_death_learned | 0.7 | 2/4 = 50% | 7/133 = 5% | 0 fires | precision 50% < 70%; precision 50% < Sonnet 67% - 5 | v9 wording (parent_death_learned) |
| C:parent_death_learned.a@SC | 0.6 | 1/2 = 50% | 4/133 = 3% | 0 fires | 2 fires < 4; precision 50% < 70%; precision 50% < Sonnet 67% - 5 | Does `scene.summary` say that a child's mother or father dies, or that a child learns their parent has died? |

## grieving (death) -> sonnet

Best: V:grieving @0.8: v9 wording (grieving)

Sonnet (grieving) @0.7: 9/29 = 31%, recall 19/133 = 14%, magic 5/11 = 45%; @0.6: 12/36 = 33%

| candidate | t | precision | recall | magic | fails | wording |
|---|---|---|---|---|---|---|
| C:grieving.a@S | 0.7 | 2/2 = 100% | 6/133 = 5% | 1/1 = 100% | 2 fires < 4; recall 5% < Sonnet 14% - 5 | Does `scene.summary` say that a character grieves, mourns, or weeps over someone who has died? |
| C:grieving.a@S | 0.8 | 2/2 = 100% | 6/133 = 5% | 1/1 = 100% | 2 fires < 4; recall 5% < Sonnet 14% - 5 | Does `scene.summary` say that a character grieves, mourns, or weeps over someone who has died? |
| C:pruned@0.7:grieving | 0.7 | 2/2 = 100% | 6/133 = 5% | 1/1 = 100% | 2 fires < 4; recall 5% < Sonnet 14% - 5 | OR of Claude phrasings kept by the prune rule at 0.7: grieving.a@S |
| C:pruned@0.8:grieving | 0.8 | 2/2 = 100% | 6/133 = 5% | 1/1 = 100% | 2 fires < 4; recall 5% < Sonnet 14% - 5 | OR of Claude phrasings kept by the prune rule at 0.8: grieving.a@S |
| V:grieving | 0.8 | 13/28 = 46% | 22/133 = 17% | 6/12 = 50% | precision 46% < 70%; magic films 50% < 60% | v9 wording (grieving) |
| C:bundle:grieving | 0.6 | 7/14 = 50% | 11/133 = 8% | 2/5 = 40% | precision 50% < 70%; magic films 40% < 60%; recall 8% < Sonnet 14% - 5 | Claude combine: max(a, b, crying.a AND (dies OR believed_dead) >= 0.4) |
| C:bundle:grieving | 0.7 | 6/12 = 50% | 10/133 = 8% | 2/5 = 40% | precision 50% < 70%; magic films 40% < 60%; recall 8% < Sonnet 14% - 5 | Claude combine: max(a, b, crying.a AND (dies OR believed_dead) >= 0.4) |
| V:grieving | 0.7 | 14/40 = 35% | 24/133 = 18% | 7/15 = 47% | precision 35% < 70%; magic films 47% < 60% | v9 wording (grieving) |

## child_taken (separation) -> sonnet

Best: C:bundle:child_taken @0.8: Claude combine: max(a, b) (c is a threat flag)

Sonnet (child_taken) @0.7: 2/3 = 67%, recall 3/34 = 9%, magic 0 fires; @0.6: 2/5 = 40%

| candidate | t | precision | recall | magic | fails | wording |
|---|---|---|---|---|---|---|
| C:child_taken.a@SC | 0.6 | 1/1 = 100% | 1/34 = 3% | 0 fires | 1 fires < 4; recall 3% < Sonnet 9% - 5 | Does `scene.summary` say that a child is taken, kidnapped, stolen, or carried off from their parent or carer? |
| C:child_taken.a@SC | 0.7 | 1/1 = 100% | 1/34 = 3% | 0 fires | 1 fires < 4; recall 3% < Sonnet 9% - 5 | Does `scene.summary` say that a child is taken, kidnapped, stolen, or carried off from their parent or carer? |
| C:child_taken.a@SC | 0.8 | 1/1 = 100% | 1/34 = 3% | 0 fires | 1 fires < 4; recall 3% < Sonnet 9% - 5 | Does `scene.summary` say that a child is taken, kidnapped, stolen, or carried off from their parent or carer? |
| A:child_taken.a.carried@SC | 0.6 | 1/1 = 100% | 1/34 = 3% | 0 fires | 1 fires < 4; recall 3% < Sonnet 9% - 5 | Does `scene.summary` describe someone forcibly carrying a child away from their caregiver now? |
| A:child_taken.a.abducted@SC | 0.6 | 1/1 = 100% | 1/34 = 3% | 0 fires | 1 fires < 4; recall 3% < Sonnet 9% - 5 | Does `scene.summary` explicitly state that a child is abducted during this scene? |
| A:child_taken.a.abducted@SC | 0.7 | 1/1 = 100% | 1/34 = 3% | 0 fires | 1 fires < 4; recall 3% < Sonnet 9% - 5 | Does `scene.summary` explicitly state that a child is abducted during this scene? |
| A:child_taken.a.abducted@SC | 0.8 | 1/1 = 100% | 1/34 = 3% | 0 fires | 1 fires < 4; recall 3% < Sonnet 9% - 5 | Does `scene.summary` explicitly state that a child is abducted during this scene? |
| C:pruned@0.6:child_taken | 0.6 | 1/1 = 100% | 1/34 = 3% | 0 fires | 1 fires < 4; recall 3% < Sonnet 9% - 5 | OR of Claude phrasings kept by the prune rule at 0.6: child_taken.a@SC |

## child_separated (separation) -> sonnet

Best: C:or:child_separated @0.8: OR of Claude child_separated.a, child_separated.b

Sonnet (child_separated) @0.7: 2/15 = 13%, recall 2/34 = 6%, magic 0/2 = 0%; @0.6: 2/16 = 13%

| candidate | t | precision | recall | magic | fails | wording |
|---|---|---|---|---|---|---|
| C:or:child_separated | 0.8 | 3/4 = 75% | 5/34 = 15% | 0/1 = 0% | magic films 0% < 60% | OR of Claude child_separated.a, child_separated.b |
| C:or:child_separated | 0.7 | 3/5 = 60% | 5/34 = 15% | 0/1 = 0% | precision 60% < 70%; magic films 0% < 60% | OR of Claude child_separated.a, child_separated.b |
| C:child_separated.a@SC | 0.8 | 2/3 = 67% | 2/34 = 6% | 0/1 = 0% | 3 fires < 4; precision 67% < 70%; magic films 0% < 60% | Does `scene.summary` say that a child is lost, alone, or cannot find their parent or carer? |
| C:child_separated.b@LnlC | 0.7 | 1/1 = 100% | 3/34 = 9% | 0 fires | 1 fires < 4 | Does a young character in `scene.lines` call for their mother, father, or carer who does not answer? |
| C:child_separated.b@LnlC | 0.8 | 1/1 = 100% | 3/34 = 9% | 0 fires | 1 fires < 4 | Does a young character in `scene.lines` call for their mother, father, or carer who does not answer? |
| A:child_separated.a.summary@SC | 0.6 | 1/1 = 100% | 1/34 = 3% | 0 fires | 1 fires < 4 | Does `scene.summary` explicitly state that a child is lost from their caregiver? |
| A:child_separated.a.summary@SC | 0.7 | 1/1 = 100% | 1/34 = 3% | 0 fires | 1 fires < 4 | Does `scene.summary` explicitly state that a child is lost from their caregiver? |
| A:bundle:child_separated | 0.7 | 1/1 = 100% | 1/34 = 3% | 0 fires | 1 fires < 4 | Astra child_separated: ((1) OR (2)) over child_separated.a.words, child_separated.a.summary |

## parent_searching (separation) -> sonnet

Best: V:parent_searching @0.8: v9 wording (parent_searching)

Sonnet (parent_searching) @0.7: 2/13 = 15%, recall 2/34 = 6%, magic 0/3 = 0%; @0.6: 2/13 = 15%

| candidate | t | precision | recall | magic | fails | wording |
|---|---|---|---|---|---|---|
| A:parent_searching.a@S | 0.8 | 1/1 = 100% | 1/34 = 3% | 0 fires | 1 fires < 4 | Does `scene.summary` explicitly describe a parent actively searching for their missing child during this scene? |
| A:pruned@0.8:parent_searching | 0.8 | 1/1 = 100% | 1/34 = 3% | 0 fires | 1 fires < 4 | OR of Astra phrasings kept by the prune rule at 0.8: parent_searching.a@S |
| V:parent_searching | 0.8 | 3/6 = 50% | 4/34 = 12% | 1/1 = 100% | precision 50% < 70% | v9 wording (parent_searching) |
| V:parent_searching | 0.7 | 3/10 = 30% | 4/34 = 12% | 1/1 = 100% | precision 30% < 70% | v9 wording (parent_searching) |
| C:parent_searching.a@Lnl | 0.8 | 3/11 = 27% | 4/34 = 12% | 1/2 = 50% | precision 27% < 70%; magic films 50% < 60% | Does a parent in `scene.lines` call out a missing child's name or ask others if they have seen their child? |
| C:or:parent_searching | 0.8 | 3/14 = 21% | 4/34 = 12% | 1/2 = 50% | precision 21% < 70%; magic films 50% < 60% | OR of Claude parent_searching.a, parent_searching.b |
| C:parent_searching.a@Lnl | 0.7 | 3/16 = 19% | 4/34 = 12% | 1/2 = 50% | precision 19% < 70%; magic films 50% < 60% | Does a parent in `scene.lines` call out a missing child's name or ask others if they have seen their child? |
| A:parent_searching.a@S | 0.6 | 1/3 = 33% | 1/34 = 3% | 0 fires | 3 fires < 4; precision 33% < 70% | Does `scene.summary` explicitly describe a parent actively searching for their missing child during this scene? |

## abandoned (separation) -> sonnet

Best: V:e.abandoned@V9C @0.8: In `scene`, is a character left behind or sent away by someone they depend on?

Sonnet (abandoned) @0.7: 3/9 = 33%, recall 5/34 = 15%, magic 1/1 = 100%; @0.6: 4/18 = 22%

| candidate | t | precision | recall | magic | fails | wording |
|---|---|---|---|---|---|---|
| A:abandoned.a.left@S | 0.6 | 1/1 = 100% | 2/34 = 6% | 0 fires | 1 fires < 4; recall 6% < Sonnet 15% - 5 | Does `scene.summary` explicitly state that a caregiver deliberately leaves someone who depends on them without care? |
| A:abandoned.a.left@S | 0.7 | 1/1 = 100% | 2/34 = 6% | 0 fires | 1 fires < 4; recall 6% < Sonnet 15% - 5 | Does `scene.summary` explicitly state that a caregiver deliberately leaves someone who depends on them without care? |
| V:e.abandoned@V9C | 0.8 | 4/17 = 24% | 6/34 = 18% | 1/2 = 50% | precision 24% < 70%; magic films 50% < 60%; precision 24% < Sonnet 33% - 5 | In `scene`, is a character left behind or sent away by someone they depend on? |
| V:abandoned | 0.8 | 4/17 = 24% | 6/34 = 18% | 1/2 = 50% | precision 24% < 70%; magic films 50% < 60%; precision 24% < Sonnet 33% - 5 | v9 wording (abandoned) |
| C:abandoned.b@S | 0.8 | 1/2 = 50% | 2/34 = 6% | 1/1 = 100% | 2 fires < 4; precision 50% < 70%; recall 6% < Sonnet 15% - 5 | Does `scene.summary` say that a character is abandoned, left behind, or sent away by a parent, carer, or owner? |
| C:abandoned.b@S | 0.7 | 2/7 = 29% | 3/34 = 9% | 1/1 = 100% | precision 29% < 70%; recall 9% < Sonnet 15% - 5 | Does `scene.summary` say that a character is abandoned, left behind, or sent away by a parent, carer, or owner? |
| V:e.abandoned@V9C | 0.7 | 5/32 = 16% | 7/34 = 21% | 1/6 = 17% | precision 16% < 70%; magic films 17% < 60%; precision 16% < Sonnet 33% - 5 | In `scene`, is a character left behind or sent away by someone they depend on? |
| V:abandoned | 0.7 | 5/32 = 16% | 7/34 = 21% | 1/6 = 17% | precision 16% < 70%; magic films 17% < 60%; precision 16% < Sonnet 33% - 5 | v9 wording (abandoned) |

## family_in_danger (separation) -> sonnet

Best: C:family_in_danger.a@Lnl @0.8: Does a character in `scene.lines` hear or say that a member of their family is in danger right now?

Sonnet (family_in_danger) @0.7: 4/32 = 13%, recall 7/34 = 21%, magic 1/9 = 11%; @0.6: 8/41 = 20%

| candidate | t | precision | recall | magic | fails | wording |
|---|---|---|---|---|---|---|
| C:family_in_danger.b@S | 0.6 | 1/1 = 100% | 1/34 = 3% | 0 fires | 1 fires < 4; recall 3% < Sonnet 21% - 5 | Does `scene.summary` say that a character learns a family member is in danger, captured, or hurt? |
| C:pruned@0.6:family_in_danger | 0.6 | 1/1 = 100% | 1/34 = 3% | 0 fires | 1 fires < 4; recall 3% < Sonnet 21% - 5 | OR of Claude phrasings kept by the prune rule at 0.6: family_in_danger.b@S |
| C:family_in_danger.a@Lnl | 0.8 | 3/8 = 38% | 5/34 = 15% | 2/2 = 100% | precision 38% < 70%; recall 15% < Sonnet 21% - 5 | Does a character in `scene.lines` hear or say that a member of their family is in danger right now? |
| C:or:family_in_danger | 0.8 | 3/8 = 38% | 5/34 = 15% | 2/2 = 100% | precision 38% < 70%; recall 15% < Sonnet 21% - 5 | OR of Claude family_in_danger.a, family_in_danger.b |
| C:or:family_in_danger | 0.6 | 5/19 = 26% | 6/34 = 18% | 2/4 = 50% | precision 26% < 70%; magic films 50% < 60% | OR of Claude family_in_danger.a, family_in_danger.b |
| V:e.family_in_danger@V9C | 0.7 | 3/10 = 30% | 4/34 = 12% | 2/3 = 67% | precision 30% < 70%; recall 12% < Sonnet 21% - 5 | In `scene`, does a character learn that a member of their family is in danger? |
| V:family_in_danger | 0.7 | 3/10 = 30% | 4/34 = 12% | 2/3 = 67% | precision 30% < 70%; recall 12% < Sonnet 21% - 5 | v9 wording (family_in_danger) |
| C:family_in_danger.a@Lnl | 0.7 | 3/11 = 27% | 5/34 = 15% | 2/2 = 100% | precision 27% < 70%; recall 15% < Sonnet 21% - 5 | Does a character in `scene.lines` hear or say that a member of their family is in danger right now? |

## parents_argue (separation) -> sonnet

Best: A:parents_argue.a.parents@LS @0.7: Does the supplied evidence identify the two arguing characters as parents of the same child?

Sonnet (parents_argue) @0.7: 1/1 = 100%, recall 1/34 = 3%, magic 1/1 = 100%; @0.6: 1/1 = 100%

| candidate | t | precision | recall | magic | fails | wording |
|---|---|---|---|---|---|---|
| A:parents_argue.a.parents@LS | 0.7 | 0/4 = 0% | 0/34 = 0% | 0/2 = 0% | precision 0% < 70%; magic films 0% < 60%; precision 0% < Sonnet 100% - 5 | Does the supplied evidence identify the two arguing characters as parents of the same child? |
| V:parents_argue | 0.6 | 0/1 = 0% | 0/34 = 0% | 0 fires | 1 fires < 4; precision 0% < 70%; precision 0% < Sonnet 100% - 5 | v9 wording (parents_argue) |
| A:parents_argue.a.parents@LS | 0.6 | 0/5 = 0% | 0/34 = 0% | 0/2 = 0% | precision 0% < 70%; magic films 0% < 60%; precision 0% < Sonnet 100% - 5 | Does the supplied evidence identify the two arguing characters as parents of the same child? |
| C:parents_argue.a@S | 0.6 | 0 fires | 0/34 = 0% | 0 fires | 0 fires < 4; precision - < 70% | Does `scene.summary` say that a child's parents argue or shout at each other? |
| C:parents_argue.a@S | 0.7 | 0 fires | 0/34 = 0% | 0 fires | 0 fires < 4; precision - < 70% | Does `scene.summary` say that a child's parents argue or shout at each other? |
| C:parents_argue.a@S | 0.8 | 0 fires | 0/34 = 0% | 0 fires | 0 fires < 4; precision - < 70% | Does `scene.summary` say that a child's parents argue or shout at each other? |
| C:parents_argue.b@Lnl | 0.6 | 0 fires | 0/34 = 0% | 0 fires | 0 fires < 4; precision - < 70% | Do `scene.lines` show a mother and father shouting at each other? |
| C:parents_argue.b@Lnl | 0.7 | 0 fires | 0/34 = 0% | 0 fires | 0 fires < 4; precision - < 70% | Do `scene.lines` show a mother and father shouting at each other? |

## rages_at_child (hostility) -> sonnet

Best: V:rages_at_child @0.7: v9 wording (rages_at_child)

| candidate | t | precision | recall | magic | fails | wording |
|---|---|---|---|---|---|---|
| V:rages_at_child | 0.7 | 12/19 = 63% | 14/79 = 18% | 5/9 = 56% | precision 63% < 70%; magic films 56% < 60% | v9 wording (rages_at_child) |
| V:rages_at_child | 0.6 | 16/30 = 53% | 19/79 = 24% | 7/14 = 50% | precision 53% < 70%; magic films 50% < 60% | v9 wording (rages_at_child) |
| C:or:rages_at_child | 0.8 | 6/10 = 60% | 8/79 = 10% | 3/5 = 60% | precision 60% < 70% | OR of Claude rages_at_child.a, rages_at_child.b |
| C:or:rages_at_child | 0.7 | 9/18 = 50% | 11/79 = 14% | 4/8 = 50% | precision 50% < 70%; magic films 50% < 60% | OR of Claude rages_at_child.a, rages_at_child.b |
| C:or:rages_at_child | 0.6 | 9/19 = 47% | 11/79 = 14% | 4/9 = 44% | precision 47% < 70%; magic films 44% < 60% | OR of Claude rages_at_child.a, rages_at_child.b |
| C:rages_at_child.a@LnlC | 0.8 | 4/7 = 57% | 6/79 = 8% | 2/4 = 50% | precision 57% < 70%; magic films 50% < 60% | Does an adult in `scene.lines` shout angry words at a child? |
| C:rages_at_child.a@LnlC | 0.7 | 7/15 = 47% | 9/79 = 11% | 3/7 = 43% | precision 47% < 70%; magic films 43% < 60% | Does an adult in `scene.lines` shout angry words at a child? |
| V:rages_at_child | 0.8 | 5/10 = 50% | 7/79 = 9% | 3/6 = 50% | precision 50% < 70%; magic films 50% < 60% | v9 wording (rages_at_child) |

## threatens_harm (hostility) -> sonnet

Best: A:bundle:threatens_harm @0.6: Astra threatens_harm: (((1) OR (2)) OR (3)) over threatens_harm.a.kill, threatens_harm.a.hurt, threatens_harm.a.summary

Sonnet (threatens_harm) @0.7: 17/84 = 20%, recall 22/79 = 28%, magic 5/16 = 31%; @0.6: 22/126 = 17%

| candidate | t | precision | recall | magic | fails | wording |
|---|---|---|---|---|---|---|
| A:bundle:threatens_harm | 0.6 | 17/52 = 33% | 23/79 = 29% | 3/6 = 50% | precision 33% < 70%; magic films 50% < 60% | Astra threatens_harm: (((1) OR (2)) OR (3)) over threatens_harm.a.kill, threatens_harm.a.hurt, threatens_harm.a.summary |
| A:bundle:threatens_harm | 0.7 | 13/38 = 34% | 18/79 = 23% | 3/5 = 60% | precision 34% < 70%; recall 23% < Sonnet 28% - 5 | Astra threatens_harm: (((1) OR (2)) OR (3)) over threatens_harm.a.kill, threatens_harm.a.hurt, threatens_harm.a.summary |
| A:bundle:threatens_harm | 0.8 | 10/28 = 36% | 14/79 = 18% | 3/3 = 100% | precision 36% < 70%; recall 18% < Sonnet 28% - 5 | Astra threatens_harm: (((1) OR (2)) OR (3)) over threatens_harm.a.kill, threatens_harm.a.hurt, threatens_harm.a.summary |
| A:threatens_harm.a.hurt@L | 0.7 | 12/36 = 33% | 18/79 = 23% | 2/4 = 50% | precision 33% < 70%; magic films 50% < 60%; recall 23% < Sonnet 28% - 5 | Does a character explicitly threaten bodily injury to another character in the current spoken or sung lines? |
| A:threatens_harm.a.kill@L | 0.6 | 11/33 = 33% | 17/79 = 22% | 2/3 = 67% | precision 33% < 70%; recall 22% < Sonnet 28% - 5 | Does a character explicitly threaten to kill another character in the current spoken or sung lines? |
| A:threatens_harm.a.hurt@L | 0.6 | 15/49 = 31% | 22/79 = 28% | 2/5 = 40% | precision 31% < 70%; magic films 40% < 60% | Does a character explicitly threaten bodily injury to another character in the current spoken or sung lines? |
| A:threatens_harm.a.hurt@L | 0.8 | 9/26 = 35% | 14/79 = 18% | 2/2 = 100% | precision 35% < 70%; recall 18% < Sonnet 28% - 5 | Does a character explicitly threaten bodily injury to another character in the current spoken or sung lines? |
| C:or:threatens_harm | 0.6 | 15/52 = 29% | 22/79 = 28% | 3/7 = 43% | precision 29% < 70%; magic films 43% < 60% | OR of Claude threatens_harm.a, threatens_harm.b, threatens_harm.c |

## plots_harm (hostility) -> sonnet

Best: C:plots_harm.c@L @0.6: Does a character in `scene.lines` say out loud that they plan to kill or hurt someone?

Sonnet (plots_harm) @0.7: 7/28 = 25%, recall 7/79 = 9%, magic 3/5 = 60%; @0.6: 8/33 = 24%

| candidate | t | precision | recall | magic | fails | wording |
|---|---|---|---|---|---|---|
| C:plots_harm.c@L | 0.6 | 11/40 = 28% | 13/79 = 16% | 2/5 = 40% | precision 28% < 70%; magic films 40% < 60% | Does a character in `scene.lines` say out loud that they plan to kill or hurt someone? |
| A:plots_harm.a.plan@L | 0.6 | 10/38 = 26% | 14/79 = 18% | 3/4 = 75% | precision 26% < 70% | Does a character explicitly state a plan to kill or physically injure another character in the current lines? |
| A:plots_harm.a.order@L | 0.6 | 6/20 = 30% | 9/79 = 11% | 1/1 = 100% | precision 30% < 70% | Does a character explicitly order someone to kill or physically injure another character in the current lines? |
| V:plots_harm | 0.6 | 14/60 = 23% | 18/79 = 23% | 5/13 = 38% | precision 23% < 70%; magic films 38% < 60% | v9 wording (plots_harm) |
| A:bundle:plots_harm | 0.6 | 12/53 = 23% | 15/79 = 19% | 4/5 = 80% | precision 23% < 70% | Astra plots_harm: (((1) OR (2)) OR (3)) over plots_harm.a.order, plots_harm.a.plan, plots_harm.a.summary |
| V:plots_harm | 0.7 | 10/46 = 22% | 12/79 = 15% | 3/8 = 38% | precision 22% < 70%; magic films 38% < 60% | v9 wording (plots_harm) |
| A:plots_harm.a.plan@L | 0.7 | 6/26 = 23% | 10/79 = 13% | 0 fires | precision 23% < 70% | Does a character explicitly state a plan to kill or physically injure another character in the current lines? |
| A:bundle:plots_harm | 0.8 | 6/26 = 23% | 7/79 = 9% | 1/1 = 100% | precision 23% < 70% | Astra plots_harm: (((1) OR (2)) OR (3)) over plots_harm.a.order, plots_harm.a.plan, plots_harm.a.summary |

## mocked (hostility) -> sonnet

Best: V:mocked @0.7: v9 wording (mocked)

Sonnet (mocked) @0.7: 9/31 = 29%, recall 14/79 = 18%, magic 3/5 = 60%; @0.6: 13/45 = 29%

| candidate | t | precision | recall | magic | fails | wording |
|---|---|---|---|---|---|---|
| V:mocked | 0.7 | 20/67 = 30% | 27/79 = 34% | 9/17 = 53% | precision 30% < 70%; magic films 53% < 60% | v9 wording (mocked) |
| V:mocked | 0.8 | 12/36 = 33% | 15/79 = 19% | 3/5 = 60% | precision 33% < 70% | v9 wording (mocked) |
| V:mocked | 0.6 | 28/106 = 26% | 35/79 = 44% | 13/29 = 45% | precision 26% < 70%; magic films 45% < 60% | v9 wording (mocked) |
| A:mocked.a.insult@L | 0.8 | 10/38 = 26% | 14/79 = 18% | 3/7 = 43% | precision 26% < 70%; magic films 43% < 60% | Does a character directly call a character a degrading name in the current dialogue? |
| A:bundle:mocked | 0.8 | 11/43 = 26% | 15/79 = 19% | 3/8 = 38% | precision 26% < 70%; magic films 38% < 60% | Astra mocked: ((1) OR (2)) over mocked.a.insult, mocked.a.ridicule |
| A:bundle:mocked | 0.7 | 16/69 = 23% | 21/79 = 27% | 3/10 = 30% | precision 23% < 70%; magic films 30% < 60%; precision 23% < Sonnet 29% - 5 | Astra mocked: ((1) OR (2)) over mocked.a.insult, mocked.a.ridicule |
| A:mocked.a.insult@L | 0.7 | 15/64 = 23% | 20/79 = 25% | 3/9 = 33% | precision 23% < 70%; magic films 33% < 60%; precision 23% < Sonnet 29% - 5 | Does a character directly call a character a degrading name in the current dialogue? |
| A:mocked.a.insult@L | 0.6 | 18/82 = 22% | 23/79 = 29% | 5/12 = 42% | precision 22% < 70%; magic films 42% < 60%; precision 22% < Sonnet 29% - 5 | Does a character directly call a character a degrading name in the current dialogue? |

## excluded (hostility) -> sonnet

Best: C:excluded.b@S @0.8: Does `scene.summary` say that a character is left out, shunned, or turned away by others on purpose?

Sonnet (excluded) @0.7: 1/4 = 25%, recall 4/79 = 5%, magic 0 fires; @0.6: 1/7 = 14%

| candidate | t | precision | recall | magic | fails | wording |
|---|---|---|---|---|---|---|
| C:excluded.b@S | 0.8 | 5/8 = 63% | 8/79 = 10% | 1/1 = 100% | precision 63% < 70% | Does `scene.summary` say that a character is left out, shunned, or turned away by others on purpose? |
| C:pruned@0.8:excluded | 0.8 | 5/8 = 63% | 8/79 = 10% | 1/1 = 100% | precision 63% < 70% | OR of Claude phrasings kept by the prune rule at 0.8: excluded.b@S |
| C:excluded.b@S | 0.7 | 6/11 = 55% | 9/79 = 11% | 1/1 = 100% | precision 55% < 70% | Does `scene.summary` say that a character is left out, shunned, or turned away by others on purpose? |
| C:pruned@0.7:excluded | 0.7 | 6/11 = 55% | 9/79 = 11% | 1/1 = 100% | precision 55% < 70% | OR of Claude phrasings kept by the prune rule at 0.7: excluded.b@S |
| V:excluded | 0.8 | 7/14 = 50% | 11/79 = 14% | 1/3 = 33% | precision 50% < 70%; magic films 33% < 60% | v9 wording (excluded) |
| C:excluded.b@S | 0.6 | 6/13 = 46% | 9/79 = 11% | 1/1 = 100% | precision 46% < 70% | Does `scene.summary` say that a character is left out, shunned, or turned away by others on purpose? |
| C:or:excluded | 0.8 | 13/35 = 37% | 16/79 = 20% | 4/5 = 80% | precision 37% < 70% | OR of Claude excluded.a, excluded.b |
| C:excluded.a@Lnl | 0.8 | 10/30 = 33% | 13/79 = 16% | 3/4 = 75% | precision 33% < 70% | Does a character in `scene.lines` tell someone they cannot join, play, or come along? |

## discrimination (hostility) -> sonnet

Best: V:discrimination @0.8: v9 wording (discrimination)

Sonnet (discrimination) @0.7: 0/1 = 0%, recall 0/79 = 0%, magic 0/1 = 0%; @0.6: 1/4 = 25%

| candidate | t | precision | recall | magic | fails | wording |
|---|---|---|---|---|---|---|
| V:discrimination | 0.8 | 3/6 = 50% | 5/79 = 6% | 0/2 = 0% | precision 50% < 70%; magic films 0% < 60% | v9 wording (discrimination) |
| A:bundle:discrimination | 0.6 | 3/8 = 38% | 5/79 = 6% | 0/2 = 0% | precision 38% < 70%; magic films 0% < 60% | Astra discrimination: ((1) OR (2)) over discrimination.a.words, discrimination.a.summary |
| A:discrimination.a.summary@S | 0.6 | 2/5 = 40% | 4/79 = 5% | 0 fires | precision 40% < 70% | Does `scene.summary` explicitly state that a character is mistreated because of one of those traits? |
| V:discrimination | 0.7 | 3/12 = 25% | 5/79 = 6% | 0/3 = 0% | precision 25% < 70%; magic films 0% < 60% | v9 wording (discrimination) |
| C:discrimination.a@LSnl | 0.6 | 2/7 = 29% | 4/79 = 5% | 0/2 = 0% | precision 29% < 70%; magic films 0% < 60% | In `scene`, is a character insulted or refused because of their race, skin, body size, disability, looks, or where they come from? |
| V:discrimination | 0.6 | 3/15 = 20% | 5/79 = 6% | 0/4 = 0% | precision 20% < 70%; magic films 0% < 60% | v9 wording (discrimination) |
| A:discrimination.a.words@L | 0.6 | 1/3 = 33% | 1/79 = 1% | 0/2 = 0% | 3 fires < 4; precision 33% < 70%; magic films 0% < 60% | Does a line explicitly give a character's race, body, disability, or origin as the reason for insulting or excluding them? |
| A:discrimination.a.words@L | 0.7 | 1/3 = 33% | 1/79 = 1% | 0/2 = 0% | 3 fires < 4; precision 33% < 70%; magic films 0% < 60% | Does a line explicitly give a character's race, body, disability, or origin as the reason for insulting or excluding them? |

## caregiver_cruelty (hostility) -> sonnet

Best: V:e.caregiver_cruelty@V9C @0.8: In `scene`, is a parent or caregiver cruel to a child in their care?

Sonnet (caregiver_cruelty) @0.7: 9/14 = 64%, recall 12/79 = 15%, magic 4/4 = 100%; @0.6: 11/20 = 55%

| candidate | t | precision | recall | magic | fails | wording |
|---|---|---|---|---|---|---|
| A:bundle:caregiver_cruelty | 0.6 | 2/2 = 100% | 4/79 = 5% | 1/1 = 100% | 2 fires < 4; recall 5% < Sonnet 15% - 5 | Astra caregiver_cruelty: (((1) OR (2)) OR (3)) over caregiver_cruelty.a.insult, caregiver_cruelty.a.hit, caregiver_cruelty.a.deprive |
| A:bundle:caregiver_cruelty | 0.7 | 2/2 = 100% | 4/79 = 5% | 1/1 = 100% | 2 fires < 4; recall 5% < Sonnet 15% - 5 | Astra caregiver_cruelty: (((1) OR (2)) OR (3)) over caregiver_cruelty.a.insult, caregiver_cruelty.a.hit, caregiver_cruelty.a.deprive |
| V:e.caregiver_cruelty@V9C | 0.8 | 3/5 = 60% | 5/79 = 6% | 1/1 = 100% | precision 60% < 70%; recall 6% < Sonnet 15% - 5 | In `scene`, is a parent or caregiver cruel to a child in their care? |
| V:caregiver_cruelty | 0.8 | 3/5 = 60% | 5/79 = 6% | 1/1 = 100% | precision 60% < 70%; recall 6% < Sonnet 15% - 5 | v9 wording (caregiver_cruelty) |
| V:e.caregiver_cruelty@V9C | 0.6 | 8/21 = 38% | 11/79 = 14% | 2/4 = 50% | precision 38% < 70%; magic films 50% < 60%; precision 38% < Sonnet 64% - 5 | In `scene`, is a parent or caregiver cruel to a child in their care? |
| V:caregiver_cruelty | 0.6 | 8/21 = 38% | 11/79 = 14% | 2/4 = 50% | precision 38% < 70%; magic films 50% < 60%; precision 38% < Sonnet 64% - 5 | v9 wording (caregiver_cruelty) |
| C:caregiver_cruelty.b@LnlC | 0.6 | 1/1 = 100% | 1/79 = 1% | 0 fires | 1 fires < 4; recall 1% < Sonnet 15% - 5 | Does a parent or carer in `scene.lines` tell the child in their care they are worthless or will never be free? |
| C:caregiver_cruelty.b@LnlC | 0.7 | 1/1 = 100% | 1/79 = 1% | 0 fires | 1 fires < 4; recall 1% < Sonnet 15% - 5 | Does a parent or carer in `scene.lines` tell the child in their care they are worthless or will never be free? |

## betrayal (hostility) -> sonnet

Best: C:betrayal.b@Lnl @0.8: Does a character in `scene.lines` accuse someone they trusted of lying or betraying them?

Sonnet (betrayal) @0.7: 7/22 = 32%, recall 7/79 = 9%, magic 3/9 = 33%; @0.6: 8/27 = 30%

| candidate | t | precision | recall | magic | fails | wording |
|---|---|---|---|---|---|---|
| C:betrayal.b@Lnl | 0.8 | 3/6 = 50% | 3/79 = 4% | 2/4 = 50% | precision 50% < 70%; magic films 50% < 60%; recall 4% < Sonnet 9% - 5 | Does a character in `scene.lines` accuse someone they trusted of lying or betraying them? |
| V:betrayal | 0.6 | 10/31 = 32% | 12/79 = 15% | 5/9 = 56% | precision 32% < 70%; magic films 56% < 60% | v9 wording (betrayal) |
| C:betrayal.b@Lnl | 0.6 | 5/13 = 38% | 5/79 = 6% | 2/5 = 40% | precision 38% < 70%; magic films 40% < 60% | Does a character in `scene.lines` accuse someone they trusted of lying or betraying them? |
| V:betrayal | 0.7 | 6/19 = 32% | 8/79 = 10% | 4/6 = 67% | precision 32% < 70% | v9 wording (betrayal) |
| C:betrayal.b@Lnl | 0.7 | 4/11 = 36% | 4/79 = 5% | 2/5 = 40% | precision 36% < 70%; magic films 40% < 60% | Does a character in `scene.lines` accuse someone they trusted of lying or betraying them? |
| C:or:betrayal | 0.8 | 3/8 = 38% | 3/79 = 4% | 2/4 = 50% | precision 38% < 70%; magic films 50% < 60%; recall 4% < Sonnet 9% - 5 | OR of Claude betrayal.a, betrayal.b |
| C:or:betrayal | 0.6 | 5/19 = 26% | 5/79 = 6% | 2/5 = 40% | precision 26% < 70%; magic films 40% < 60%; precision 26% < Sonnet 32% - 5 | OR of Claude betrayal.a, betrayal.b |
| C:or:betrayal | 0.7 | 4/15 = 27% | 4/79 = 5% | 2/5 = 40% | precision 27% < 70%; magic films 40% < 60%; precision 27% < Sonnet 32% - 5 | OR of Claude betrayal.a, betrayal.b |

## transforms (eerie) -> jev

Best: C:or:transforms @0.6: OR of Claude transforms.a, transforms.b

| candidate | t | precision | recall | magic | fails | wording |
|---|---|---|---|---|---|---|
| A:transforms.a.body@max | 0.6 | 6/6 = 100% | 13/83 = 16% | 2/2 = 100% | passes | max over channels: Does {lines/summary} explicitly describe a character's body changing form during this scene? |
| A:transforms.a.body@S | 0.6 | 5/5 = 100% | 9/83 = 11% | 1/1 = 100% | passes | Does `scene.summary` explicitly describe a character's body changing form during this scene? |
| C:or:transforms | 0.8 | 7/8 = 88% | 15/83 = 18% | 3/3 = 100% | passes | OR of Claude transforms.a, transforms.b |
| C:transforms.b@Lnl | 0.8 | 4/4 = 100% | 10/83 = 12% | 3/3 = 100% | passes | Does a character in `scene.lines` react to their own body changing right now? |
| C:or:transforms | 0.6 | 10/13 = 77% | 21/83 = 25% | 5/5 = 100% | passes | OR of Claude transforms.a, transforms.b |
| C:or:transforms | 0.7 | 8/10 = 80% | 17/83 = 20% | 3/3 = 100% | passes | OR of Claude transforms.a, transforms.b |
| C:transforms.a@S | 0.6 | 5/6 = 83% | 8/83 = 10% | 1/1 = 100% | passes | Does `scene.summary` say that a character is turned into, or changes into, a different creature or thing? |
| C:transforms.a@S | 0.7 | 5/6 = 83% | 8/83 = 10% | 1/1 = 100% | passes | Does `scene.summary` say that a character is turned into, or changes into, a different creature or thing? |

## possessed (eerie) -> sonnet

Best: A:possessed.a.resistance@L @0.7: Does `scene.lines` explicitly state that a character resists another being's control of their body?

| candidate | t | precision | recall | magic | fails | wording |
|---|---|---|---|---|---|---|
| C:possessed.a@LSnl | 0.6 | 1/1 = 100% | 2/83 = 2% | 1/1 = 100% | 1 fires < 4 | In `scene`, is a character made to move or act by someone else's magic or control, against their will? |
| A:possessed.a.resistance@L | 0.7 | 1/8 = 13% | 1/83 = 1% | 0/3 = 0% | precision 13% < 70%; magic films 0% < 60% | Does `scene.lines` explicitly state that a character resists another being's control of their body? |
| A:possessed.a.resistance@max | 0.7 | 1/8 = 13% | 1/83 = 1% | 0/3 = 0% | precision 13% < 70%; magic films 0% < 60% | max over channels: Does {lines/summary} explicitly state that a character resists another being's control of their body? |
| A:possessed.a.resistance@L | 0.6 | 1/15 = 7% | 1/83 = 1% | 0/4 = 0% | precision 7% < 70%; magic films 0% < 60% | Does `scene.lines` explicitly state that a character resists another being's control of their body? |
| A:possessed.a.resistance@max | 0.6 | 1/15 = 7% | 1/83 = 1% | 0/4 = 0% | precision 7% < 70%; magic films 0% < 60% | max over channels: Does {lines/summary} explicitly state that a character resists another being's control of their body? |
| V:possessed | 0.6 | 1/27 = 4% | 1/83 = 1% | 0/5 = 0% | precision 4% < 70%; magic films 0% < 60% | v9 wording (possessed) |
| A:possessed.a.control@L | 0.6 | 0/3 = 0% | 0/83 = 0% | 0/2 = 0% | 3 fires < 4; precision 0% < 70%; magic films 0% < 60% | Does `scene.lines` explicitly state that another being controls a character's bodily movements? |
| A:possessed.a.resistance@L | 0.8 | 0/6 = 0% | 0/83 = 0% | 0/3 = 0% | precision 0% < 70%; magic films 0% < 60% | Does `scene.lines` explicitly state that a character resists another being's control of their body? |

## nightmare (eerie) -> sonnet

Best: C:nightmare.b@Lnl @0.6: Does a character in `scene.lines` wake up frightened or say they just had a bad dream?

| candidate | t | precision | recall | magic | fails | wording |
|---|---|---|---|---|---|---|
| V:nightmare | 0.6 | 1/2 = 50% | 1/83 = 1% | 0 fires | 2 fires < 4; precision 50% < 70% | v9 wording (nightmare) |
| C:nightmare.b@Lnl | 0.6 | 0/3 = 0% | 0/83 = 0% | 0 fires | 3 fires < 4; precision 0% < 70% | Does a character in `scene.lines` wake up frightened or say they just had a bad dream? |
| C:or:nightmare | 0.6 | 0/3 = 0% | 0/83 = 0% | 0 fires | 3 fires < 4; precision 0% < 70% | OR of Claude nightmare.a, nightmare.b |
| C:nightmare.b@Lnl | 0.7 | 0/2 = 0% | 0/83 = 0% | 0 fires | 2 fires < 4; precision 0% < 70% | Does a character in `scene.lines` wake up frightened or say they just had a bad dream? |
| C:or:nightmare | 0.7 | 0/2 = 0% | 0/83 = 0% | 0 fires | 2 fires < 4; precision 0% < 70% | OR of Claude nightmare.a, nightmare.b |
| C:nightmare.b@Lnl | 0.8 | 0/1 = 0% | 0/83 = 0% | 0 fires | 1 fires < 4; precision 0% < 70% | Does a character in `scene.lines` wake up frightened or say they just had a bad dream? |
| C:or:nightmare | 0.8 | 0/1 = 0% | 0/83 = 0% | 0 fires | 1 fires < 4; precision 0% < 70% | OR of Claude nightmare.a, nightmare.b |
| V:nightmare | 0.7 | 0/1 = 0% | 0/83 = 0% | 0 fires | 1 fires < 4; precision 0% < 70% | v9 wording (nightmare) |

## unseen_threat (eerie) -> sonnet

Best: A:unseen_threat.a.presence@L @0.7: Does a character say that someone or something is nearby but cannot be seen?

| candidate | t | precision | recall | magic | fails | wording |
|---|---|---|---|---|---|---|
| A:unseen_threat.a.presence@L | 0.7 | 4/8 = 50% | 7/83 = 8% | 1/1 = 100% | precision 50% < 70% | Does a character say that someone or something is nearby but cannot be seen? |
| A:unseen_threat.a.presence@L | 0.6 | 4/11 = 36% | 7/83 = 8% | 1/2 = 50% | precision 36% < 70%; magic films 50% < 60% | Does a character say that someone or something is nearby but cannot be seen? |
| C:unseen_threat.a@Lnl | 0.6 | 7/27 = 26% | 14/83 = 17% | 1/6 = 17% | precision 26% < 70%; magic films 17% < 60% | Does a character in `scene.lines` ask who is there or say they hear something they cannot see? |
| V:unseen_threat | 0.7 | 16/82 = 20% | 25/83 = 30% | 6/20 = 30% | precision 20% < 70%; magic films 30% < 60% | v9 wording (unseen_threat) |
| C:unseen_threat.a@Lnl | 0.8 | 4/16 = 25% | 11/83 = 13% | 1/3 = 33% | precision 25% < 70%; magic films 33% < 60% | Does a character in `scene.lines` ask who is there or say they hear something they cannot see? |
| C:unseen_threat.a@Lnl | 0.7 | 5/22 = 23% | 12/83 = 14% | 1/4 = 25% | precision 23% < 70%; magic films 25% < 60% | Does a character in `scene.lines` ask who is there or say they hear something they cannot see? |
| V:unseen_threat | 0.8 | 7/36 = 19% | 14/83 = 17% | 2/10 = 20% | precision 19% < 70%; magic films 20% < 60% | v9 wording (unseen_threat) |
| A:unseen_threat.a.presence@L | 0.8 | 1/2 = 50% | 2/83 = 2% | 1/1 = 100% | 2 fires < 4; precision 50% < 70% | Does a character say that someone or something is nearby but cannot be seen? |

## appears_suddenly (eerie) -> sonnet

Best: V:jump_scare @0.8: v9 jump_scare = min(appears_suddenly, startled)

| candidate | t | precision | recall | magic | fails | wording |
|---|---|---|---|---|---|---|
| V:jump_scare | 0.8 | 5/14 = 36% | 12/83 = 14% | 2/3 = 67% | precision 36% < 70% | v9 jump_scare = min(appears_suddenly, startled) |
| C:startled.a@Lnl | 0.8 | 48/238 = 20% | 59/83 = 71% | 20/79 = 25% | precision 20% < 70%; magic films 25% < 60% | Does a sound caption in `scene.lines` show a character gasping, yelping, or screaming in surprise? |
| C:or:appears_suddenly | 0.8 | 48/238 = 20% | 59/83 = 71% | 20/79 = 25% | precision 20% < 70%; magic films 25% < 60% | OR of Claude appears_suddenly.a, startled.a |
| V:startled | 0.8 | 23/103 = 22% | 32/83 = 39% | 9/20 = 45% | precision 22% < 70%; magic films 45% < 60% | v9 wording (startled) |
| C:bundle:appears_suddenly | 0.7 | 6/19 = 32% | 10/83 = 12% | 3/7 = 43% | precision 32% < 70%; magic films 43% < 60% | Claude combine: jump_scare = min(appears_suddenly.a, startled.a) |
| V:or:appears_suddenly | 0.8 | 23/105 = 22% | 32/83 = 39% | 9/20 = 45% | precision 22% < 70%; magic films 45% < 60% | v9 max(appears_suddenly, startled) |
| C:bundle:appears_suddenly | 0.6 | 14/58 = 24% | 21/83 = 25% | 6/18 = 33% | precision 24% < 70%; magic films 33% < 60% | Claude combine: jump_scare = min(appears_suddenly.a, startled.a) |
| C:startled.a@Lnl | 0.7 | 52/275 = 19% | 62/83 = 75% | 21/93 = 23% | precision 19% < 70%; magic films 23% < 60% | Does a sound caption in `scene.lines` show a character gasping, yelping, or screaming in surprise? |

## child_frightened (distress) -> sonnet

Best: C:child_frightened.c@SC @0.6: Does `scene.summary` say that a child is frightened, terrified, crying, or in tears?

Sonnet (child_frightened) @0.7: 17/82 = 21%, recall 23/78 = 29%, magic 2/6 = 33%; @0.6: 24/109 = 22%

| candidate | t | precision | recall | magic | fails | wording |
|---|---|---|---|---|---|---|
| C:child_frightened.c@SC | 0.6 | 3/7 = 43% | 5/78 = 6% | 0 fires | precision 43% < 70%; recall 6% < Sonnet 29% - 5 | Does `scene.summary` say that a child is frightened, terrified, crying, or in tears? |
| C:child_frightened.c@SC | 0.7 | 3/7 = 43% | 5/78 = 6% | 0 fires | precision 43% < 70%; recall 6% < Sonnet 29% - 5 | Does `scene.summary` say that a child is frightened, terrified, crying, or in tears? |
| V:e.child_frightened@V9C | 0.6 | 22/96 = 23% | 28/78 = 36% | 5/14 = 36% | precision 23% < 70%; magic films 36% < 60% | In `scene`, is a child frightened or crying? |
| V:child_frightened | 0.6 | 22/96 = 23% | 28/78 = 36% | 5/14 = 36% | precision 23% < 70%; magic films 36% < 60% | v9 wording (child_frightened) |
| C:child_frightened.a@LnlC | 0.6 | 8/29 = 28% | 13/78 = 17% | 1/3 = 33% | precision 28% < 70%; magic films 33% < 60%; recall 17% < Sonnet 29% - 5 | Does a young character in `scene.lines` say they are scared or beg for help or for their parent? |
| C:child_frightened.a@LnlC | 0.8 | 5/17 = 29% | 8/78 = 10% | 0/2 = 0% | precision 29% < 70%; magic films 0% < 60%; recall 10% < Sonnet 29% - 5 | Does a young character in `scene.lines` say they are scared or beg for help or for their parent? |
| V:e.child_frightened@V9C | 0.7 | 15/72 = 21% | 20/78 = 26% | 2/7 = 29% | precision 21% < 70%; magic films 29% < 60% | In `scene`, is a child frightened or crying? |
| V:child_frightened | 0.7 | 15/72 = 21% | 20/78 = 26% | 2/7 = 29% | precision 21% < 70%; magic films 29% < 60% | v9 wording (child_frightened) |

## afraid_for_safety (distress) -> sonnet

Best: V:afraid_for_safety @0.7: v9 wording (afraid_for_safety)

| candidate | t | precision | recall | magic | fails | wording |
|---|---|---|---|---|---|---|
| V:afraid_for_safety | 0.7 | 42/237 = 18% | 45/78 = 58% | 7/36 = 19% | precision 18% < 70%; magic films 19% < 60% | v9 wording (afraid_for_safety) |
| C:afraid_for_safety.a@Lnl | 0.6 | 13/61 = 21% | 16/78 = 21% | 2/11 = 18% | precision 21% < 70%; magic films 18% < 60% | Does a character in `scene.lines` shout a warning to run, hide, or get away from a danger that is here? |
| C:or:afraid_for_safety | 0.8 | 16/79 = 20% | 21/78 = 27% | 6/21 = 29% | precision 20% < 70%; magic films 29% < 60% | OR of Claude afraid_for_safety.a, afraid_for_safety.b, afraid_for_safety.c |
| C:afraid_for_safety.a@Lnl | 0.7 | 11/51 = 22% | 14/78 = 18% | 1/9 = 11% | precision 22% < 70%; magic films 11% < 60% | Does a character in `scene.lines` shout a warning to run, hide, or get away from a danger that is here? |
| C:or:afraid_for_safety | 0.6 | 21/115 = 18% | 27/78 = 35% | 7/30 = 23% | precision 18% < 70%; magic films 23% < 60% | OR of Claude afraid_for_safety.a, afraid_for_safety.b, afraid_for_safety.c |
| C:or:afraid_for_safety | 0.7 | 18/97 = 19% | 25/78 = 32% | 6/27 = 22% | precision 19% < 70%; magic films 22% < 60% | OR of Claude afraid_for_safety.a, afraid_for_safety.b, afraid_for_safety.c |
| V:afraid_for_safety | 0.6 | 44/282 = 16% | 48/78 = 62% | 8/44 = 18% | precision 16% < 70%; magic films 18% < 60% | v9 wording (afraid_for_safety) |
| C:bundle:afraid_for_safety | 0.6 | 18/103 = 17% | 23/78 = 29% | 4/23 = 17% | precision 17% < 70%; magic films 17% < 60% | Claude combine: max(a, b, c AND v9 danger Score >= 2) |

## screams (distress) -> sonnet

Best: V:screams @0.8: v9 wording (screams)

| candidate | t | precision | recall | magic | fails | wording |
|---|---|---|---|---|---|---|
| V:screams | 0.8 | 34/167 = 20% | 38/78 = 49% | 12/49 = 24% | precision 20% < 70%; magic films 24% < 60% | v9 wording (screams) |
| C:screams.a@Lnl | 0.6 | 26/135 = 19% | 28/78 = 36% | 10/46 = 22% | precision 19% < 70%; magic films 22% < 60% | Does a sound caption in `scene.lines` say that someone screams or shrieks? |
| V:screams | 0.7 | 37/207 = 18% | 44/78 = 56% | 13/56 = 23% | precision 18% < 70%; magic films 23% < 60% | v9 wording (screams) |
| V:screams | 0.6 | 43/250 = 17% | 50/78 = 64% | 15/61 = 25% | precision 17% < 70%; magic films 25% < 60% | v9 wording (screams) |
| C:screams.a@Lnl | 0.7 | 25/134 = 19% | 27/78 = 35% | 10/46 = 22% | precision 19% < 70%; magic films 22% < 60% | Does a sound caption in `scene.lines` say that someone screams or shrieks? |
| A:screams.a.caption@L | 0.6 | 25/134 = 19% | 27/78 = 35% | 10/46 = 22% | precision 19% < 70%; magic films 22% < 60% | Does a sound caption explicitly describe a character screaming? |
| A:bundle:screams | 0.6 | 25/134 = 19% | 27/78 = 35% | 10/46 = 22% | precision 19% < 70%; magic films 22% < 60% | Astra screams: ((1) OR (2)) over screams.a.caption, screams.a.summary |
| C:screams.a@Lnl | 0.8 | 24/132 = 18% | 26/78 = 33% | 10/45 = 22% | precision 18% < 70%; magic films 22% < 60% | Does a sound caption in `scene.lines` say that someone screams or shrieks? |

## crying (distress) -> sonnet

Best: A:crying.a.dialogue@L @0.6: Does a line explicitly identify someone as crying right now?

Sonnet (crying) @0.7: 9/29 = 31%, recall 13/78 = 17%, magic 3/12 = 25%; @0.6: 11/40 = 28%

| candidate | t | precision | recall | magic | fails | wording |
|---|---|---|---|---|---|---|
| A:crying.a.dialogue@L | 0.6 | 7/22 = 32% | 8/78 = 10% | 2/7 = 29% | precision 32% < 70%; magic films 29% < 60%; recall 10% < Sonnet 17% - 5 | Does a line explicitly identify someone as crying right now? |
| A:crying.a.caption@L | 0.8 | 8/27 = 30% | 9/78 = 12% | 2/8 = 25% | precision 30% < 70%; magic films 25% < 60%; recall 12% < Sonnet 17% - 5 | Does a sound caption explicitly describe a character crying or sobbing? |
| A:bundle:crying | 0.8 | 8/27 = 30% | 9/78 = 12% | 2/8 = 25% | precision 30% < 70%; magic films 25% < 60%; recall 12% < Sonnet 17% - 5 | Astra crying: (((1) OR (2)) OR (3)) over crying.a.caption, crying.a.summary, crying.a.dialogue |
| A:crying.a.caption@L | 0.7 | 8/30 = 27% | 9/78 = 12% | 2/8 = 25% | precision 27% < 70%; magic films 25% < 60%; recall 12% < Sonnet 17% - 5 | Does a sound caption explicitly describe a character crying or sobbing? |
| A:bundle:crying | 0.7 | 8/30 = 27% | 9/78 = 12% | 2/8 = 25% | precision 27% < 70%; magic films 25% < 60%; recall 12% < Sonnet 17% - 5 | Astra crying: (((1) OR (2)) OR (3)) over crying.a.caption, crying.a.summary, crying.a.dialogue |
| C:or:crying | 0.6 | 12/52 = 23% | 13/78 = 17% | 3/15 = 20% | precision 23% < 70%; magic films 20% < 60%; precision 23% < Sonnet 31% - 5 | OR of Claude crying.a, crying.b, crying.c |
| C:or:crying | 0.7 | 10/42 = 24% | 11/78 = 14% | 2/13 = 15% | precision 24% < 70%; magic films 15% < 60%; precision 24% < Sonnet 31% - 5 | OR of Claude crying.a, crying.b, crying.c |
| A:crying.a.caption@L | 0.6 | 8/32 = 25% | 9/78 = 12% | 2/8 = 25% | precision 25% < 70%; magic films 25% < 60%; precision 25% < Sonnet 31% - 5; recall 12% < Sonnet 17% - 5 | Does a sound caption explicitly describe a character crying or sobbing? |

## despair (distress) -> sonnet

Best: V:e.despair@V9C @0.6: In `scene`, does a character give up hope?

Sonnet (despair) @0.7: 12/34 = 35%, recall 15/78 = 19%, magic 4/10 = 40%; @0.6: 15/56 = 27%

| candidate | t | precision | recall | magic | fails | wording |
|---|---|---|---|---|---|---|
| V:e.despair@V9C | 0.6 | 5/36 = 14% | 7/78 = 9% | 2/8 = 25% | precision 14% < 70%; magic films 25% < 60%; precision 14% < Sonnet 35% - 5; recall 9% < Sonnet 19% - 5 | In `scene`, does a character give up hope? |
| V:despair | 0.6 | 5/36 = 14% | 7/78 = 9% | 2/8 = 25% | precision 14% < 70%; magic films 25% < 60%; precision 14% < Sonnet 35% - 5; recall 9% < Sonnet 19% - 5 | v9 wording (despair) |
| C:despair.b@S | 0.7 | 1/4 = 25% | 1/78 = 1% | 1/1 = 100% | precision 25% < 70%; precision 25% < Sonnet 35% - 5; recall 1% < Sonnet 19% - 5 | Does `scene.summary` say that a character despairs, loses hope, or gives up? |
| C:or:despair | 0.6 | 3/23 = 13% | 3/78 = 4% | 2/6 = 33% | precision 13% < 70%; magic films 33% < 60%; precision 13% < Sonnet 35% - 5; recall 4% < Sonnet 19% - 5 | OR of Claude despair.a, despair.b |
| C:or:despair | 0.7 | 2/15 = 13% | 2/78 = 3% | 1/4 = 25% | precision 13% < 70%; magic films 25% < 60%; precision 13% < Sonnet 35% - 5; recall 3% < Sonnet 19% - 5 | OR of Claude despair.a, despair.b |
| C:despair.b@S | 0.6 | 1/5 = 20% | 1/78 = 1% | 1/1 = 100% | precision 20% < 70%; precision 20% < Sonnet 35% - 5; recall 1% < Sonnet 19% - 5 | Does `scene.summary` say that a character despairs, loses hope, or gives up? |
| C:despair.a@Lnl | 0.6 | 2/21 = 10% | 2/78 = 3% | 1/5 = 20% | precision 10% < 70%; magic films 20% < 60%; precision 10% < Sonnet 35% - 5; recall 3% < Sonnet 19% - 5 | Does a character in `scene.lines` say they give up or that there is no hope left? |
| V:e.despair@V9C | 0.7 | 2/22 = 9% | 2/78 = 3% | 1/3 = 33% | precision 9% < 70%; magic films 33% < 60%; precision 9% < Sonnet 35% - 5; recall 3% < Sonnet 19% - 5 | In `scene`, does a character give up hope? |

## animal_cruelty (animals) -> jev

Best: C:animal_cruelty.a@S @0.6: Does `scene.summary` say that a character hits, kicks, traps, or hurts an animal on purpose?

| candidate | t | precision | recall | magic | fails | wording |
|---|---|---|---|---|---|---|
| C:animal_cruelty.a@S | 0.6 | 4/4 = 100% | 10/259 = 4% | 0 fires | passes | Does `scene.summary` say that a character hits, kicks, traps, or hurts an animal on purpose? |
| C:pruned@0.6:animal_cruelty | 0.6 | 4/4 = 100% | 10/259 = 4% | 0 fires | passes | OR of Claude phrasings kept by the prune rule at 0.6: animal_cruelty.a@S |
| V:animal_cruelty | 0.6 | 8/10 = 80% | 17/259 = 7% | 1/2 = 50% | magic films 50% < 60% | v9 wording (animal_cruelty) |
| V:animal_cruelty | 0.7 | 5/6 = 83% | 9/259 = 3% | 1/2 = 50% | magic films 50% < 60% | v9 wording (animal_cruelty) |
| C:or:animal_cruelty | 0.6 | 6/9 = 67% | 14/259 = 5% | 0 fires | precision 67% < 70% | OR of Claude animal_cruelty.a, animal_cruelty.b |
| V:animal_cruelty | 0.8 | 2/2 = 100% | 4/259 = 2% | 0 fires | 2 fires < 4 | v9 wording (animal_cruelty) |
| C:or:animal_cruelty | 0.7 | 3/5 = 60% | 8/259 = 3% | 0 fires | precision 60% < 70% | OR of Claude animal_cruelty.a, animal_cruelty.b |
| C:animal_cruelty.a@S | 0.7 | 1/1 = 100% | 4/259 = 2% | 0 fires | 1 fires < 4 | Does `scene.summary` say that a character hits, kicks, traps, or hurts an animal on purpose? |

## animal_in_danger (animals) -> jev

Best: V:animal_in_danger @0.7: v9 wording (animal_in_danger)

| candidate | t | precision | recall | magic | fails | wording |
|---|---|---|---|---|---|---|
| V:animal_in_danger | 0.8 | 13/14 = 93% | 29/259 = 11% | 1/1 = 100% | passes | v9 wording (animal_in_danger) |
| V:animal_in_danger | 0.7 | 26/34 = 76% | 54/259 = 21% | 5/6 = 83% | passes | v9 wording (animal_in_danger) |
| C:animal_in_danger.a@S | 0.6 | 17/21 = 81% | 29/259 = 11% | 2/2 = 100% | passes | Does `scene.summary` say that a pet, farm animal, or wild animal is in danger, trapped, hunted, or hurt? |
| C:animal_in_danger.a@S | 0.7 | 14/17 = 82% | 25/259 = 10% | 1/1 = 100% | passes | Does `scene.summary` say that a pet, farm animal, or wild animal is in danger, trapped, hunted, or hurt? |
| A:animal_in_danger.a.hazard@max | 0.6 | 11/13 = 85% | 25/259 = 10% | 1/1 = 100% | passes | max over channels: Does {lines/summary} explicitly describe a physical hazard acting on an animal that does not talk now? |
| A:animal_in_danger.a.hazard@L | 0.6 | 5/5 = 100% | 10/259 = 4% | 1/1 = 100% | passes | Does `scene.lines` explicitly describe a physical hazard acting on an animal that does not talk now? |
| C:or:animal_in_danger | 0.6 | 25/35 = 71% | 45/259 = 17% | 3/3 = 100% | passes | OR of Claude animal_in_danger.a, animal_in_danger.b |
| C:or:animal_in_danger | 0.7 | 18/25 = 72% | 33/259 = 13% | 1/1 = 100% | passes | OR of Claude animal_in_danger.a, animal_in_danger.b |

## dangerous_act (copyable) -> sonnet

Best: A:dangerous_act.a.risk@LSC @0.6: Does the supplied evidence explicitly identify a bodily-injury risk from that action?

| candidate | t | precision | recall | magic | fails | wording |
|---|---|---|---|---|---|---|
| A:dangerous_act.a.risk@LSC | 0.6 | 3/5 = 60% | 4/44 = 9% | 1/1 = 100% | precision 60% < 70% | Does the supplied evidence explicitly identify a bodily-injury risk from that action? |
| A:pruned@0.6:dangerous_act | 0.6 | 3/5 = 60% | 4/44 = 9% | 1/1 = 100% | precision 60% < 70% | OR of Astra phrasings kept by the prune rule at 0.6: dangerous_act.a.risk@LSC |
| A:dangerous_act.a.action@max | 0.8 | 2/3 = 67% | 3/44 = 7% | 0 fires | 3 fires < 4; precision 67% < 70% | max over channels: Does {lines/summary} describe a child performing a risky physical action now? |
| A:dangerous_act.a.action@SC | 0.8 | 1/1 = 100% | 2/44 = 5% | 0 fires | 1 fires < 4 | Does `scene.summary` describe a child performing a risky physical action now? |
| A:dangerous_act.a.choice@LC | 0.7 | 1/1 = 100% | 1/44 = 2% | 1/1 = 100% | 1 fires < 4 | Does `scene.lines` explicitly state that the child chooses to perform that action? |
| A:dangerous_act.a.choice@LC | 0.8 | 1/1 = 100% | 1/44 = 2% | 1/1 = 100% | 1 fires < 4 | Does `scene.lines` explicitly state that the child chooses to perform that action? |
| A:dangerous_act.a.choice@max | 0.8 | 1/1 = 100% | 1/44 = 2% | 1/1 = 100% | 1 fires < 4 | max over channels: Does {lines/summary} explicitly state that the child chooses to perform that action? |
| A:pruned@0.7:dangerous_act | 0.7 | 3/7 = 43% | 4/44 = 9% | 1/1 = 100% | precision 43% < 70% | OR of Astra phrasings kept by the prune rule at 0.7: dangerous_act.a.action@LC, dangerous_act.a.choice@LC, dangerous_act.a.risk@LSC |

## runs_away (copyable) -> sonnet

Best: C:or:runs_away @0.7: OR of Claude runs_away.a, runs_away.b

| candidate | t | precision | recall | magic | fails | wording |
|---|---|---|---|---|---|---|
| C:runs_away.b@LnlC | 0.8 | 1/1 = 100% | 1/44 = 2% | 0 fires | 1 fires < 4 | Does a young character in `scene.lines` say they are running away or leaving home? |
| A:runs_away.a.leaves@LC | 0.6 | 1/1 = 100% | 1/44 = 2% | 0 fires | 1 fires < 4 | Does `scene.lines` explicitly describe a child leaving home during this scene? |
| A:runs_away.a.leaves@LC | 0.7 | 1/1 = 100% | 1/44 = 2% | 0 fires | 1 fires < 4 | Does `scene.lines` explicitly describe a child leaving home during this scene? |
| C:runs_away.b@LnlC | 0.7 | 1/2 = 50% | 1/44 = 2% | 0 fires | 2 fires < 4; precision 50% < 70% | Does a young character in `scene.lines` say they are running away or leaving home? |
| C:runs_away.b@LnlC | 0.6 | 1/3 = 33% | 1/44 = 2% | 0 fires | 3 fires < 4; precision 33% < 70% | Does a young character in `scene.lines` say they are running away or leaving home? |
| A:runs_away.a.leaves@max | 0.6 | 1/3 = 33% | 1/44 = 2% | 0/1 = 0% | 3 fires < 4; precision 33% < 70%; magic films 0% < 60% | max over channels: Does {lines/summary} explicitly describe a child leaving home during this scene? |
| A:runs_away.a.leaves@max | 0.7 | 1/3 = 33% | 1/44 = 2% | 0/1 = 0% | 3 fires < 4; precision 33% < 70%; magic films 0% < 60% | max over channels: Does {lines/summary} explicitly describe a child leaving home during this scene? |
| C:or:runs_away | 0.8 | 1/3 = 33% | 1/44 = 2% | 0/2 = 0% | 3 fires < 4; precision 33% < 70%; magic films 0% < 60% | OR of Claude runs_away.a, runs_away.b |

## goes_with_stranger (copyable) -> sonnet

Best: V:goes_with_stranger @0.7: v9 wording (goes_with_stranger)

| candidate | t | precision | recall | magic | fails | wording |
|---|---|---|---|---|---|---|
| V:goes_with_stranger | 0.7 | 1/6 = 17% | 1/44 = 2% | 0/2 = 0% | precision 17% < 70%; magic films 0% < 60% | v9 wording (goes_with_stranger) |
| V:goes_with_stranger | 0.6 | 1/7 = 14% | 1/44 = 2% | 0/2 = 0% | precision 14% < 70%; magic films 0% < 60% | v9 wording (goes_with_stranger) |
| C:goes_with_stranger.b@LnlC | 0.7 | 0/11 = 0% | 0/44 = 0% | 0/2 = 0% | precision 0% < 70%; magic films 0% < 60% | Does someone the child does not know invite the child in `scene.lines` to come with them? |
| C:or:goes_with_stranger | 0.7 | 0/11 = 0% | 0/44 = 0% | 0/2 = 0% | precision 0% < 70%; magic films 0% < 60% | OR of Claude goes_with_stranger.a, goes_with_stranger.b |
| C:goes_with_stranger.a@SC | 0.6 | 0/3 = 0% | 0/44 = 0% | 0 fires | 3 fires < 4; precision 0% < 70% | Does `scene.summary` say that a child goes off with someone they have just met? |
| C:goes_with_stranger.b@LnlC | 0.6 | 0/17 = 0% | 0/44 = 0% | 0/3 = 0% | precision 0% < 70%; magic films 0% < 60% | Does someone the child does not know invite the child in `scene.lines` to come with them? |
| A:goes_with_stranger.a.leaves@LC | 0.6 | 0/3 = 0% | 0/44 = 0% | 0/1 = 0% | 3 fires < 4; precision 0% < 70%; magic films 0% < 60% | Does `scene.lines` describe a child leaving a location together with someone now? |
| A:goes_with_stranger.a.leaves@max | 0.6 | 0/3 = 0% | 0/44 = 0% | 0/1 = 0% | 3 fires < 4; precision 0% < 70%; magic films 0% < 60% | max over channels: Does {lines/summary} describe a child leaving a location together with someone now? |

## slapstick (copyable) -> sonnet

Best: V:slapstick @0.7: v9 wording (slapstick)

| candidate | t | precision | recall | magic | fails | wording |
|---|---|---|---|---|---|---|
| V:slapstick | 0.7 | 9/59 = 15% | 13/44 = 30% | 0/16 = 0% | precision 15% < 70%; magic films 0% < 60% | v9 wording (slapstick) |
| A:slapstick.a.impact@max | 0.7 | 2/7 = 29% | 4/44 = 9% | 0 fires | precision 29% < 70% | max over channels: Does {lines/summary} explicitly describe a character being hit or taking a pratfall? |
| V:slapstick | 0.6 | 12/86 = 14% | 15/44 = 34% | 0/20 = 0% | precision 14% < 70%; magic films 0% < 60% | v9 wording (slapstick) |
| A:slapstick.a.impact@S | 0.7 | 1/3 = 33% | 3/44 = 7% | 0 fires | 3 fires < 4; precision 33% < 70% | Does `scene.summary` explicitly describe a character being hit or taking a pratfall? |
| A:slapstick.a.impact@max | 0.6 | 3/20 = 15% | 5/44 = 11% | 0/4 = 0% | precision 15% < 70%; magic films 0% < 60% | max over channels: Does {lines/summary} explicitly describe a character being hit or taking a pratfall? |
| A:slapstick.a.impact@S | 0.6 | 1/4 = 25% | 3/44 = 7% | 0 fires | precision 25% < 70% | Does `scene.summary` explicitly describe a character being hit or taking a pratfall? |
| A:pruned@0.7:slapstick | 0.7 | 1/4 = 25% | 3/44 = 7% | 0/1 = 0% | precision 25% < 70%; magic films 0% < 60% | OR of Astra phrasings kept by the prune rule at 0.7: slapstick.a.impact@S, slapstick.a.gag@S, slapstick.a.recovery@L, slapstick.a.recovery@S |
| A:slapstick.a.impact@L | 0.7 | 1/5 = 20% | 1/44 = 2% | 0 fires | precision 20% < 70% | Does `scene.lines` explicitly describe a character being hit or taking a pratfall? |

## comic_peril (copyable) -> sonnet

Best: V:comic_peril @0.6: v9 wording (comic_peril)

| candidate | t | precision | recall | magic | fails | wording |
|---|---|---|---|---|---|---|
| V:comic_peril | 0.6 | 9/69 = 13% | 11/44 = 25% | 1/17 = 6% | precision 13% < 70%; magic films 6% < 60% | v9 wording (comic_peril) |
| A:comic_peril.a.peril@max | 0.8 | 4/27 = 15% | 5/44 = 11% | 1/6 = 17% | precision 15% < 70%; magic films 17% < 60% | max over channels: Does {lines/summary} explicitly describe a character exposed to a physical hazard in this incident? |
| A:comic_peril.a.peril@max | 0.7 | 7/60 = 12% | 9/44 = 20% | 1/9 = 11% | precision 12% < 70%; magic films 11% < 60% | max over channels: Does {lines/summary} explicitly describe a character exposed to a physical hazard in this incident? |
| A:comic_peril.a.peril@max | 0.6 | 10/97 = 10% | 14/44 = 32% | 1/15 = 7% | precision 10% < 70%; magic films 7% < 60% | max over channels: Does {lines/summary} explicitly describe a character exposed to a physical hazard in this incident? |
| A:comic_peril.a.peril@L | 0.6 | 8/78 = 10% | 10/44 = 23% | 0/12 = 0% | precision 10% < 70%; magic films 0% < 60% | Does `scene.lines` explicitly describe a character exposed to a physical hazard in this incident? |
| A:comic_peril.a.peril@L | 0.7 | 5/46 = 11% | 6/44 = 14% | 0/7 = 0% | precision 11% < 70%; magic films 0% < 60% | Does `scene.lines` explicitly describe a character exposed to a physical hazard in this incident? |
| A:comic_peril.a.peril@S | 0.8 | 2/12 = 17% | 3/44 = 7% | 1/2 = 50% | precision 17% < 70%; magic films 50% < 60% | Does `scene.summary` explicitly describe a character exposed to a physical hazard in this incident? |
| V:comic_peril | 0.7 | 2/14 = 14% | 3/44 = 7% | 0/4 = 0% | precision 14% < 70%; magic films 0% < 60% | v9 wording (comic_peril) |

## film:threatens (per film item) -> sonnet

Best: C:film_threatens.b@L @0.7: Does a line in `scene.lines` said to <name>'s face beg <name> to stop or not hurt them?

| candidate | t | precision | recall | magic | fails | wording |
|---|---|---|---|---|---|---|
| C:film_threatens.b@L | 0.7 | 2/5 = 40% | 3/79 = 4% | 1/2 = 50% | precision 40% < 70%; magic films 50% < 60% | Does a line in `scene.lines` said to <name>'s face beg <name> to stop or not hurt them? |
| C:film_threatens.b@L | 0.6 | 2/6 = 33% | 3/79 = 4% | 1/2 = 50% | precision 33% < 70%; magic films 50% < 60% | Does a line in `scene.lines` said to <name>'s face beg <name> to stop or not hurt them? |
| A:pruned@0.8:film:threatens | 0.8 | 2/6 = 33% | 2/79 = 3% | 1/1 = 100% | precision 33% < 70% | OR of Astra phrasings kept by the prune rule at 0.8: fe.threatens.a.pursuit@L, fe.threatens.a.pursuit@S, fe.threatens.a.attack@L, fe.threatens.a.attack@S |
| A:fe.threatens.a.pursuit@S | 0.8 | 1/2 = 50% | 1/79 = 1% | 1/1 = 100% | 2 fires < 4; precision 50% < 70% | Does `scene.summary` explicitly describe {NAME} pursuing someone to capture them now? |
| A:fe.threatens.a.pursuit@L | 0.6 | 3/12 = 25% | 4/79 = 5% | 1/1 = 100% | precision 25% < 70% | Does `scene.lines` explicitly describe {NAME} pursuing someone to capture them now? |
| A:bundle:fe.threatens | 0.8 | 3/13 = 23% | 4/79 = 5% | 1/2 = 50% | precision 23% < 70%; magic films 50% < 60% | Astra fe.threatens: (((1) OR (2)) OR (3)) over fe.threatens.a.words, fe.threatens.a.pursuit, fe.threatens.a.attack |
| C:or:film:threatens | 0.7 | 4/20 = 20% | 5/79 = 6% | 2/3 = 67% | precision 20% < 70% | OR of Claude film_threatens.a, .b |
| C:or:film:threatens | 0.6 | 4/22 = 18% | 5/79 = 6% | 2/3 = 67% | precision 18% < 70% | OR of Claude film_threatens.a, .b |

## film:child_in_danger (per film item) -> jev

Best: C:film_child_in_danger.a@LSnl @0.8: In `scene`, is <name> in physical danger?

| candidate | t | precision | recall | magic | fails | wording |
|---|---|---|---|---|---|---|
| A:fe.in_danger.a.attack@L | 0.7 | 7/7 = 100% | 10/221 = 5% | 1/1 = 100% | passes | Does `scene.lines` explicitly describe {NAME} being physically attacked now? |
| C:film_child_in_danger.a@LSnl | 0.8 | 25/35 = 71% | 46/221 = 21% | 2/3 = 67% | passes | In `scene`, is <name> in physical danger? |
| A:pruned@0.7:film:child_in_danger | 0.7 | 14/18 = 78% | 23/221 = 10% | 1/1 = 100% | passes | OR of Astra phrasings kept by the prune rule at 0.7: fe.in_danger.a.attack@L, fe.in_danger.a.attack@S, fe.in_danger.a.capture@S, fe.in_danger.a.hazard@L, fe.in... |
| A:fe.in_danger.a.attack@max | 0.7 | 7/8 = 88% | 10/221 = 5% | 1/1 = 100% | passes | max over channels: Does {lines/summary} explicitly describe {NAME} being physically attacked now? |
| A:bundle:fe.in_danger | 0.7 | 15/21 = 71% | 24/221 = 11% | 1/1 = 100% | passes | Astra fe.in_danger: (((1) OR (2)) OR (3)) over fe.in_danger.a.attack, fe.in_danger.a.capture, fe.in_danger.a.hazard |
| A:fe.in_danger.a.attack@L | 0.6 | 8/11 = 73% | 12/221 = 5% | 1/1 = 100% | passes | Does `scene.lines` explicitly describe {NAME} being physically attacked now? |
| A:fe.in_danger.a.hazard@max | 0.7 | 8/11 = 73% | 17/221 = 8% | 1/1 = 100% | passes | max over channels: Does {lines/summary} explicitly describe an active physical hazard acting on {NAME} now? |
| A:fe.in_danger.a.hazard@S | 0.6 | 3/4 = 75% | 6/221 = 3% | 0 fires | passes | Does `scene.summary` explicitly describe an active physical hazard acting on {NAME} now? |

## film:danger (per film item) -> jev

Best: C:film_danger.a@LSnl @0.7: In `scene`, does <danger> attack, hit, or get used against a character?

| candidate | t | precision | recall | magic | fails | wording |
|---|---|---|---|---|---|---|
| A:fe.endangers.a.contact@L | 0.7 | 7/8 = 88% | 13/421 = 3% | 1/1 = 100% | passes | Does `scene.lines` explicitly describe {DANGER} physically acting on a character now? |
| C:film_danger.a@LSnl | 0.8 | 9/11 = 82% | 18/421 = 4% | 2/2 = 100% | passes | In `scene`, does <danger> attack, hit, or get used against a character? |
| A:fe.endangers.a.contact@max | 0.7 | 12/16 = 75% | 20/421 = 5% | 3/3 = 100% | passes | max over channels: Does {lines/summary} explicitly describe {DANGER} physically acting on a character now? |
| C:film_danger.a@LSnl | 0.7 | 13/18 = 72% | 22/421 = 5% | 4/4 = 100% | passes | In `scene`, does <danger> attack, hit, or get used against a character? |
| A:fe.endangers.a.contact@max | 0.8 | 7/10 = 70% | 12/421 = 3% | 2/2 = 100% | passes | max over channels: Does {lines/summary} explicitly describe {DANGER} physically acting on a character now? |
| A:fe.endangers.a.contact@S | 0.8 | 5/7 = 71% | 10/421 = 2% | 1/1 = 100% | passes | Does `scene.summary` explicitly describe {DANGER} physically acting on a character now? |
| A:bundle:fe.endangers | 0.8 | 3/4 = 75% | 4/421 = 1% | 1/1 = 100% | passes | Astra fe.endangers: (((1) AND (2)) OR (3)) over fe.endangers.a.contact, fe.endangers.a.harm, fe.endangers.a.proximity |
| V:film:danger | 0.8 | 28/46 = 61% | 49/421 = 12% | 10/17 = 59% | precision 61% < 70%; magic films 59% < 60% | v9 fe.<id> (danger) |

