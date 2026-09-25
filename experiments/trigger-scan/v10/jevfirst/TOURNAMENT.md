# Phrasing tournament: Jev-first rewrites vs v9 wording vs Sonnet

Generated 2026-09-25T00:30:12.922Z by `v10/jevfirst/tournament/score.mjs` + `report.mjs`. Full numbers: `tournament/results.json`; every candidate per concept: `tournament/CANDIDATES.md`.

## What ran

- Jev (jev-1.13.0) answered **every pooled phrasing on every scene of the 13 seen films** (nemo, monsters-inc, lion-king, frankenweenie, wild-robot, iron-giant, up, tangled, coco, how-to-train-your-dragon, book-of-life, princess-and-the-frog, moana): 4794 requests, 36,573,699 billed input tokens, **$1.5361** of the $2.00 cap (ledger: `tournament/ledger.jsonl`; every request reserved its worst case first; 0 errors, 0 over-reservations after the pilot fix).
- Pool: 478 questions per scene before film instantiation: Claude's 166 scorable phrasings (all 173 minus mention / retold / imagined / film-presence), Astra's bundles split into their numbered sub-Nouls with every `{source}` sub asked on lines AND summary (287 questions), and the v9 wording as a control (25 questions for the 19 ids v9 gave to Sonnet; the other v9 ids reuse v9's own Jev answers: same wording, states and scenes). No identical wording occurred across sources, so dedupe removed nothing.
- Segmentation, verified summaries, cast and dangers: v9/out/<slug>.segments.json (unchanged). Sonnet: its stored v9 answers (v9/out/<slug>.sonnetq.r1.json), which exist only for the 43 split.json sonnet_asked ids.
- 1003 candidates scored (singles, Astra subs max over channels, Claude combine bundles, Astra combine bundles, OR-of-all, Claude's own prune-then-OR rule, v9 control) x thresholds 0.6 / 0.7 / 0.8.

## Headline

|  | v9 (split.json) | after this tournament (owner rule as briefed) |
|---|---|---|
| Jev share, v9 ids + 3 film templates | 73/92 (79%) | 26/92 (28%) |
| Jev share, 88 scored concepts | 69 Jev, 1 mixed, 18 Sonnet | 26 Jev, 62 Sonnet |

Why the 62 non-Jev concepts went to Sonnet. Most of them did not lose to Sonnet: they missed the absolute bar (precision >= 0.70 on >= 4 fires, and >= 0.60 on the magic films).

| reason | concepts | which |
|---|---|---|
| Sonnet never asked; Jev below the absolute bar | 26 | monster_creature, reanimated_dead, dead_body, spider_insect, large_predator, rodent_bat, clown, doll_puppet, robot_machine_being, alien, scary_appearance, injured, badly_hurt, rages_at_child, possessed, nightmare, unseen_threat, appears_suddenly, afraid_for_safety, screams, dangerous_act, runs_away, goes_with_stranger, slapstick, comic_peril, film:threatens |
| rule passed | 26 | ghost_spirit, skeleton_bones, shark, snake_reptile, mask, witch_sorcerer, dark_magic, blade_weapon, fire, dangerous_machine, chased, attacked, falls, nearly_falls, cannot_breathe, caught_in_hazard, child_in_danger, creature_threat, battle, loved_one_dies, pet_dies, transforms, animal_cruelty, animal_in_danger, film:child_in_danger, film:danger |
| Jev ties/beats Sonnet (within 5 pts) but Jev below the absolute bar | 18 | gun, explosion, storm, deep_dark_water, heights, darkness, seriously_ill, believed_dead, grieving, child_separated, parent_searching, family_in_danger, threatens_harm, plots_harm, mocked, excluded, betrayal, child_frightened |
| thin evidence: Sonnet < 4 fires; Jev below the absolute bar | 8 | needle_medical, medical_care, blood_wound, swallowed, parent_death_learned, child_taken, parents_argue, discrimination |
| Sonnet (>= 4 fires) beats every Jev candidate beyond tolerance | 10 | vehicle_crash, captured, graveyard_funeral, weapon_used, trapped, dies, abandoned, caregiver_cruelty, crying, despair |

Read against Sonnet only (drop the absolute bar, keep the 5-point comparison): Sonnet is measurably better (>= 4 fires, beyond tolerance) on **10** concepts. Jev passes or ties Sonnet on 44. The remaining 34 have no usable Sonnet measurement (never asked, or < 4 fires). The owner column below applies the rule as briefed. This paragraph is only a reading of it.

Where the winning Jev phrasing came from (26 Jev-owned concepts): Claude 10, v9 wording 12, Astra 4.
Sonnet itself meets the same absolute bar on only 4 of the 41 concepts it was ever asked (vehicle_crash, weapon_used, dies, loved_one_dies).

## Per-concept table

Best = the Jev candidate the owner rule selects (highest recall among passing candidates); when none passes, the candidate with the highest Wilson lower bound on >= 4 fires. Precision = hits / fires, a lower bound (keys list notable moments only). Recall = key items of the concept group caught / key items in the group (all 13 films). Magic = coco + book-of-life + princess-and-the-frog. lift = precision / chance precision (circular shift); kappa = chance-corrected recall. Sonnet at 0.7 (its flag threshold).

| concept | group | v9 -> now | best Jev (source @ t) | wording | Jev precision | Jev recall | magic precision | lift / kappa | Sonnet precision | Sonnet recall | why |
|---|---|---|---|---|---|---|---|---|---|---|---|
| monster_creature | creatures_figures | jev -> **sonnet** | Claude single @0.8 | Does `scene.summary` say that a monster or a made-up creature is in this scene? | 15/30 = 50% | 24/135 = 18% | 1/1 = 100% | 1.8 / 0.10 | never asked | - | Sonnet never asked; Jev below the absolute bar: precision 50% < 70% |
| ghost_spirit | creatures_figures | jev -> **jev** | Claude or_all @0.8 | OR of Claude ghost_spirit.a, ghost_spirit.b, ghost_spirit.c | 7/8 = 88% | 8/135 = 6% | 5/6 = 83% | 4.7 / 0.04 | never asked | - | passes |
| reanimated_dead | creatures_figures | jev -> **sonnet** | v9 wording v9 @0.6 | v9 wording (reanimated_dead) | 13/45 = 29% | 25/135 = 19% | 2/8 = 25% | 1.1 / 0.02 | never asked | - | Sonnet never asked; Jev below the absolute bar: precision 29% < 70%; magic films 25% < 60% |
| skeleton_bones | creatures_figures | jev -> **jev** | v9 wording v9 @0.7 | v9 wording (skeleton_bones) | 4/5 = 80% | 8/135 = 6% | 3/4 = 75% | 3.6 / 0.04 | never asked | - | passes |
| dead_body | creatures_figures | jev -> **sonnet** | Astra single @0.8 | Does `scene.summary` explicitly identify a body present in this scene as a corpse? | 2/4 = 50% | 6/135 = 4% | 0 fires | 2.1 / 0.03 | never asked | - | Sonnet never asked; Jev below the absolute bar: precision 50% < 70% |
| shark | creatures_figures | jev -> **jev** | Astra single @0.7 | Does `scene.lines` identify an animal present in this scene as a shark? | 5/6 = 83% | 4/135 = 3% | 0 fires | 3.6 / 0.02 | never asked | - | passes |
| spider_insect | creatures_figures | jev -> **sonnet** | Astra single @0.6 | Does `scene.lines` explicitly identify a spider or insect present in this scene? | 1/8 = 13% | 2/135 = 1% | 1/4 = 25% | 0.8 / -0.00 | never asked | - | Sonnet never asked; Jev below the absolute bar: precision 13% < 70%; magic films 25% < 60% |
| snake_reptile | creatures_figures | jev -> **jev** | Astra single @0.7 | max over channels: Does {lines/summary} explicitly identify a snake or lizard present in this scene? | 3/4 = 75% | 10/135 = 7% | 2/2 = 100% | 3.2 / 0.06 | never asked | - | passes |
| large_predator | creatures_figures | jev -> **sonnet** | v9 wording v9 @0.6 | v9 wording (large_predator) | 27/78 = 35% | 43/135 = 32% | 5/8 = 63% | 2.0 / 0.22 | never asked | - | Sonnet never asked; Jev below the absolute bar: precision 35% < 70% |
| rodent_bat | creatures_figures | jev -> **sonnet** | Astra single @0.6 | max over channels: Does {lines/summary} explicitly identify a rat, mouse, or bat present in this scene? | 3/6 = 50% | 7/135 = 5% | 0 fires | 3.0 / 0.03 | never asked | - | Sonnet never asked; Jev below the absolute bar: precision 50% < 70% |
| clown | creatures_figures | jev -> **sonnet** | v9 wording v9 @0.6 | v9 wording (clown) | 2/4 = 50% | 3/135 = 2% | 0 fires | 2.3 / 0.01 | never asked | - | Sonnet never asked; Jev below the absolute bar: precision 50% < 70% |
| doll_puppet | creatures_figures | jev -> **sonnet** | Astra single @0.6 | Does `scene.lines` identify a doll, puppet, or mannequin present in this scene? | 0/4 = 0% | 0/135 = 0% | 0/1 = 0% | 0.0 / -0.01 | never asked | - | Sonnet never asked; Jev below the absolute bar: precision 0% < 70%; magic films 0% < 60% |
| mask | creatures_figures | jev -> **jev** | v9 wording v9 @0.7 | v9 wording (mask) | 4/5 = 80% | 7/135 = 5% | 1/1 = 100% | 3.4 / 0.04 | never asked | - | passes |
| robot_machine_being | creatures_figures | jev -> **sonnet** | v9 wording v9 @0.6 | v9 wording (robot_machine_being) | 7/97 = 7% | 12/135 = 9% | 0 fires | 1.7 / 0.05 | never asked | - | Sonnet never asked; Jev below the absolute bar: precision 7% < 70% |
| witch_sorcerer | creatures_figures | jev -> **jev** | v9 wording v9 @0.8 | v9 wording (witch_sorcerer) | 3/4 = 75% | 5/135 = 4% | 3/3 = 100% | 3.0 / 0.02 | never asked | - | passes |
| dark_magic | creatures_figures | jev -> **jev** | v9 wording v9 @0.8 | v9 wording (dark_magic) | 10/14 = 71% | 24/135 = 18% | 5/7 = 71% | 3.2 / 0.13 | never asked | - | passes |
| alien | creatures_figures | jev -> **sonnet** | Claude single @0.6 | In `scene`, is a being from outer space there? | 3/26 = 12% | 3/135 = 2% | 0 fires | 2.1 / 0.01 | never asked | - | Sonnet never asked; Jev below the absolute bar: precision 12% < 70% |
| scary_appearance | creatures_figures | jev -> **sonnet** | v9 wording v9 @0.6 | v9 wording (scary_appearance) | 23/51 = 45% | 42/135 = 31% | 7/15 = 47% | 2.2 / 0.20 | never asked | - | Sonnet never asked; Jev below the absolute bar: precision 45% < 70%; magic films 47% < 60% |
| gun | objects_hazards | jev -> **sonnet** | Claude single @0.6 | In `scene`, does a character hold or fire a gun? | 4/9 = 44% | 6/158 = 4% | 1/1 = 100% | 2.7 / 0.03 | 3/9 = 33% | 5/158 = 3% | Jev ties/beats Sonnet (within 5 pts) but Jev below the absolute bar: precision 44% < 70% |
| blade_weapon | objects_hazards | jev -> **jev** | Astra single @0.7 | Does `scene.lines` explicitly identify a bladed weapon present in this scene? | 7/10 = 70% | 9/158 = 6% | 1/1 = 100% | 2.4 / 0.03 | 7/13 = 54% | 9/158 = 6% | passes |
| fire | objects_hazards | jev -> **jev** | Astra single @0.6 | max over channels: Does {lines/summary} explicitly describe flames burning in this scene? | 6/7 = 86% | 9/158 = 6% | 1/1 = 100% | 2.3 / 0.03 | 6/12 = 50% | 7/158 = 4% | passes |
| explosion | objects_hazards | jev -> **sonnet** | Astra single @0.6 | max over channels: Does {lines/summary} explicitly describe an explosion occurring in this scene? | 8/12 = 67% | 14/158 = 9% | 4/5 = 80% | 2.8 / 0.07 | 5/8 = 63% | 6/158 = 4% | Jev ties/beats Sonnet (within 5 pts) but Jev below the absolute bar: precision 67% < 70% |
| storm | objects_hazards | sonnet -> **sonnet** | v9 wording single @0.8 | Do `scene.lines` show that a storm is in this scene? | 8/21 = 38% | 11/158 = 7% | 1/4 = 25% | 1.4 / 0.01 | 12/29 = 41% | 16/158 = 10% | Jev ties/beats Sonnet (within 5 pts) but Jev below the absolute bar: precision 38% < 70%; magic films 25% < 60% |
| deep_dark_water | objects_hazards | sonnet -> **sonnet** | v9 wording single @0.8 | Do `scene.lines` show that deep or open water a character could sink or drown in is in this scene? | 3/5 = 60% | 11/158 = 7% | 0 fires | 2.5 / 0.06 | 9/15 = 60% | 17/158 = 11% | Jev ties/beats Sonnet (within 5 pts) but Jev below the absolute bar: precision 60% < 70% |
| heights | objects_hazards | sonnet -> **sonnet** | Claude or_all @0.6 | OR of Claude heights.a, heights.b | 3/5 = 60% | 5/158 = 3% | 0 fires | 3.1 / 0.02 | 9/24 = 38% | 12/158 = 8% | Jev ties/beats Sonnet (within 5 pts) but Jev below the absolute bar: precision 60% < 70% |
| darkness | objects_hazards | sonnet -> **sonnet** | Astra single @0.7 | Does `scene.lines` explicitly state that the characters' immediate surroundings are dark? | 2/4 = 50% | 6/158 = 4% | 1/2 = 50% | 3.5 / 0.03 | 2/4 = 50% | 5/158 = 3% | Jev ties/beats Sonnet (within 5 pts) but Jev below the absolute bar: precision 50% < 70%; magic films 50% < 60% |
| needle_medical | objects_hazards | sonnet -> **sonnet** | Astra single @0.6 | Does `scene.lines` explicitly describe a medical or dental instrument being used on a patient? | 0/2 = 0% | 0/158 = 0% | 0 fires | 0.0 / -0.00 | 0/2 = 0% | 0/158 = 0% | thin evidence: Sonnet < 4 fires; Jev below the absolute bar: 2 fires < 4; precision 0% < 70% |
| medical_care | objects_hazards | jev -> **sonnet** | v9 wording v9 @0.7 | v9 wording (medical_care) | 2/5 = 40% | 2/158 = 1% | 0 fires | 1.3 / 0.00 | 0/3 = 0% | 0/158 = 0% | thin evidence: Sonnet < 4 fires; Jev below the absolute bar: precision 40% < 70% |
| seriously_ill | objects_hazards | jev -> **sonnet** | v9 wording v9 @0.6 | v9 wording (seriously_ill) | 5/23 = 22% | 7/158 = 4% | 2/5 = 40% | 1.0 / 0.00 | 1/5 = 20% | 1/158 = 1% | Jev ties/beats Sonnet (within 5 pts) but Jev below the absolute bar: precision 22% < 70%; magic films 40% < 60% |
| blood_wound | objects_hazards | jev -> **sonnet** | Claude single @0.6 | In `scene`, is a character bleeding or does a character have an open wound? | 2/4 = 50% | 3/158 = 2% | 0 fires | 2.0 / 0.01 | 2/3 = 67% | 3/158 = 2% | thin evidence: Sonnet < 4 fires; Jev below the absolute bar: precision 50% < 70%; precision 50% < Sonnet 67% - 5 |
| vehicle_crash | peril | jev -> **sonnet** | v9 wording v9 @0.6 | v9 wording (vehicle_crash) | 5/8 = 63% | 14/270 = 5% | 0 fires | 2.3 / 0.04 | 5/6 = 83% (partial ids) | 9/270 = 3% | Sonnet (>= 4 fires) beats every Jev candidate beyond tolerance: precision 63% < 70%; precision 63% < Sonnet 83% - 5 |
| captured | captivity | mixed -> **sonnet** | Claude single @0.8 | Does `scene.summary` say that a character is captured, kidnapped, taken prisoner, or locked up? | 7/11 = 64% | 7/58 = 12% | 0/1 = 0% | 5.7 / 0.10 | 22/43 = 51% | 28/58 = 48% | Sonnet (>= 4 fires) beats every Jev candidate beyond tolerance: precision 64% < 70%; magic films 0% < 60%; recall 12% < Sonnet 48% - 5 |
| graveyard_funeral | objects_hazards | sonnet -> **sonnet** | Astra single @0.6 | Does `scene.lines` explicitly describe a grave, tomb, or graveyard at the scene's location? | 0/4 = 0% | 0/158 = 0% | 0 fires | 0.0 / -0.01 | 2/4 = 50% | 3/158 = 2% | Sonnet (>= 4 fires) beats every Jev candidate beyond tolerance: precision 0% < 70%; precision 0% < Sonnet 50% - 5 |
| dangerous_machine | objects_hazards | jev -> **jev** | v9 wording v9 @0.8 | v9 wording (dangerous_machine) | 10/14 = 71% | 17/158 = 11% | 0 fires | 2.4 / 0.06 | 5/8 = 63% | 8/158 = 5% | passes |
| chased | peril | jev -> **jev** | Claude single @0.6 | Does `scene.summary` say that a character is chased, pursued, hunted, or flees from someone? | 14/19 = 74% | 29/270 = 11% | 2/3 = 67% | 2.4 / 0.07 | never asked | - | passes |
| attacked | peril | jev -> **jev** | Claude single @0.7 | Does a sound caption or line in `scene.lines` show a blow landing on a character, followed by a cry of pain or a plea? | 8/10 = 80% | 13/270 = 5% | 4/5 = 80% | 2.7 / 0.03 | never asked | - | passes |
| falls | peril | jev -> **jev** | v9 wording v9 @0.8 | v9 wording (falls) | 3/4 = 75% | 7/270 = 3% | 0 fires | 3.5 / 0.02 | never asked | - | passes |
| nearly_falls | peril | jev -> **jev** | Claude single @0.6 | Does a character in `scene.lines` shout to hold on or not let go while someone hangs over a drop? | 7/10 = 70% | 9/270 = 3% | 1/1 = 100% | 2.3 / 0.01 | never asked | - | passes |
| cannot_breathe | peril | jev -> **jev** | v9 wording v9 @0.6 | v9 wording (cannot_breathe) | 9/9 = 100% | 13/270 = 5% | 2/2 = 100% | 3.1 / 0.03 | never asked | - | passes |
| caught_in_hazard | peril | jev -> **jev** | v9 wording v9 @0.6 | v9 wording (caught_in_hazard) | 34/41 = 83% | 62/270 = 23% | 4/4 = 100% | 2.6 / 0.16 | never asked | - | passes |
| child_in_danger | peril | jev -> **jev** | Claude single @0.8 | In `scene`, is a child in physical danger? | 27/38 = 71% | 47/270 = 17% | 2/3 = 67% | 2.4 / 0.11 | never asked | - | passes |
| creature_threat | peril | jev -> **jev** | v9 wording v9 @0.6 | v9 wording (creature_threat) | 49/66 = 74% | 111/270 = 41% | 8/13 = 62% | 2.2 / 0.31 | never asked | - | passes |
| weapon_used | violence | sonnet -> **sonnet** | v9 wording single @0.6 | In `scene`, is a weapon used against a character, such as fired, swung, or thrown at them? | 11/17 = 65% | 29/202 = 14% | 3/3 = 100% | 2.7 / 0.11 | 20/27 = 74% | 46/202 = 23% | Sonnet (>= 4 fires) beats every Jev candidate beyond tolerance: precision 65% < 70%; precision 65% < Sonnet 74% - 5; recall 14% < Sonnet 23% - 5 |
| battle | violence | jev -> **jev** | v9 wording v9 @0.6 | v9 wording (battle) | 25/32 = 78% | 52/202 = 26% | 8/9 = 89% | 2.4 / 0.19 | never asked | - | passes |
| trapped | captivity | sonnet -> **sonnet** | Astra single @0.6 | Does `scene.summary` explicitly state that a physical barrier prevents a character from leaving their location? | 7/11 = 64% | 8/58 = 14% | 0/2 = 0% | 4.2 / 0.11 | 12/34 = 35% | 15/58 = 26% | Sonnet (>= 4 fires) beats every Jev candidate beyond tolerance: precision 64% < 70%; magic films 0% < 60%; recall 14% < Sonnet 26% - 5 |
| swallowed | captivity | sonnet -> **sonnet** | v9 wording single @0.6 | In `scene`, is a character swallowed or held inside a creature's mouth? | 3/5 = 60% | 4/58 = 7% | 0/1 = 0% | 3.5 / 0.05 | 2/2 = 100% | 3/58 = 5% | thin evidence: Sonnet < 4 fires; Jev below the absolute bar: precision 60% < 70%; magic films 0% < 60%; precision 60% < Sonnet 100% - 5 |
| injured | injury | jev -> **sonnet** | Claude or_all @0.7 | OR of Claude injured.a, injured.b | 21/42 = 50% | 38/82 = 46% | 6/9 = 67% | 4.4 / 0.42 | never asked | - | Sonnet never asked; Jev below the absolute bar: precision 50% < 70% |
| badly_hurt | injury | jev -> **sonnet** | v9 wording v9 @0.7 | v9 wording (badly_hurt) | 7/17 = 41% | 15/82 = 18% | 3/3 = 100% | 4.3 / 0.16 | never asked | - | Sonnet never asked; Jev below the absolute bar: precision 41% < 70% |
| dies | death | sonnet -> **sonnet** | Claude bundle @0.7 | Claude combine: max(a, b, dead_body) OR (c if max(a, b, seriously_ill.a) >= 0.4) | 17/23 = 74% | 34/133 = 26% | 2/3 = 67% | 4.1 / 0.22 | 9/10 = 90% | 26/133 = 20% | Sonnet (>= 4 fires) beats every Jev candidate beyond tolerance: precision 74% < Sonnet 90% - 5 |
| loved_one_dies | death | jev -> **jev** | v9 wording v9 @0.7 | v9 wording (loved_one_dies) | 9/12 = 75% | 20/133 = 15% | 4/4 = 100% | 4.2 / 0.13 | 8/10 = 80% | 18/133 = 14% | passes |
| pet_dies | death | jev -> **jev** | Claude or_all @0.6 | OR of Claude pet_dies.a, pet_dies.b | 3/4 = 75% | 6/133 = 5% | 0 fires | 3.7 / 0.04 | 2/3 = 67% | 2/133 = 2% | passes |
| believed_dead | death | jev -> **sonnet** | v9 wording v9 @0.6 | v9 wording (believed_dead) | 19/42 = 45% | 41/133 = 31% | 7/13 = 54% | 2.3 / 0.23 | 9/22 = 41% | 15/133 = 11% | Jev ties/beats Sonnet (within 5 pts) but Jev below the absolute bar: precision 45% < 70%; magic films 54% < 60% |
| parent_death_learned | death | jev -> **sonnet** | v9 wording v9 @0.6 | v9 wording (parent_death_learned) | 3/5 = 60% | 8/133 = 6% | 0 fires | 7.4 / 0.05 | 2/3 = 67% | 4/133 = 3% | thin evidence: Sonnet < 4 fires; Jev below the absolute bar: precision 60% < 70%; precision 60% < Sonnet 67% - 5 |
| grieving | death | jev -> **sonnet** | v9 wording v9 @0.8 | v9 wording (grieving) | 13/28 = 46% | 22/133 = 17% | 6/12 = 50% | 2.4 / 0.11 | 9/29 = 31% | 19/133 = 14% | Jev ties/beats Sonnet (within 5 pts) but Jev below the absolute bar: precision 46% < 70%; magic films 50% < 60% |
| child_taken | separation | sonnet -> **sonnet** | Claude bundle @0.8 | Claude combine: max(a, b) (c is a threat flag) | 3/6 = 50% | 3/34 = 9% | 0/1 = 0% | 7.6 / 0.07 | 2/3 = 67% | 3/34 = 9% | thin evidence: Sonnet < 4 fires; Jev below the absolute bar: precision 50% < 70%; magic films 0% < 60%; precision 50% < Sonnet 67% - 5 |
| child_separated | separation | jev -> **sonnet** | Claude or_all @0.8 | OR of Claude child_separated.a, child_separated.b | 3/4 = 75% | 5/34 = 15% | 0/1 = 0% | 12.8 / 0.14 | 2/15 = 13% | 2/34 = 6% | Jev ties/beats Sonnet (within 5 pts) but Jev below the absolute bar: magic films 0% < 60% |
| parent_searching | separation | jev -> **sonnet** | v9 wording v9 @0.8 | v9 wording (parent_searching) | 3/6 = 50% | 4/34 = 12% | 1/1 = 100% | 5.8 / 0.09 | 2/13 = 15% | 2/34 = 6% | Jev ties/beats Sonnet (within 5 pts) but Jev below the absolute bar: precision 50% < 70% |
| abandoned | separation | sonnet -> **sonnet** | v9 wording single @0.8 | In `scene`, is a character left behind or sent away by someone they depend on? | 4/17 = 24% | 6/34 = 18% | 1/2 = 50% | 3.8 / 0.14 | 3/9 = 33% | 5/34 = 15% | Sonnet (>= 4 fires) beats every Jev candidate beyond tolerance: precision 24% < 70%; magic films 50% < 60%; precision 24% < Sonnet 33% - 5 |
| family_in_danger | separation | sonnet -> **sonnet** | Claude single @0.8 | Does a character in `scene.lines` hear or say that a member of their family is in danger right now? | 3/8 = 38% | 5/34 = 15% | 2/2 = 100% | 8.8 / 0.13 | 4/32 = 13% | 7/34 = 21% | Jev ties/beats Sonnet (within 5 pts) but Jev below the absolute bar: precision 38% < 70%; recall 15% < Sonnet 21% - 5 |
| parents_argue | separation | jev -> **sonnet** | Astra single @0.7 | Does the supplied evidence identify the two arguing characters as parents of the same child? | 0/4 = 0% | 0/34 = 0% | 0/2 = 0% | 0.0 / -0.01 | 1/1 = 100% | 1/34 = 3% | thin evidence: Sonnet < 4 fires; Jev below the absolute bar: precision 0% < 70%; magic films 0% < 60%; precision 0% < Sonnet 100% - 5 |
| rages_at_child | hostility | jev -> **sonnet** | v9 wording v9 @0.7 | v9 wording (rages_at_child) | 12/19 = 63% | 14/79 = 18% | 5/9 = 56% | 4.2 / 0.14 | never asked | - | Sonnet never asked; Jev below the absolute bar: precision 63% < 70%; magic films 56% < 60% |
| threatens_harm | hostility | sonnet -> **sonnet** | Astra bundle @0.6 | Astra threatens_harm: (((1) OR (2)) OR (3)) over threatens_harm.a.kill, threatens_harm.a.hurt, threatens_harm.a.summary | 17/52 = 33% | 23/79 = 29% | 3/6 = 50% | 3.9 / 0.23 | 17/84 = 20% | 22/79 = 28% | Jev ties/beats Sonnet (within 5 pts) but Jev below the absolute bar: precision 33% < 70%; magic films 50% < 60% |
| plots_harm | hostility | jev -> **sonnet** | Claude single @0.6 | Does a character in `scene.lines` say out loud that they plan to kill or hurt someone? | 11/40 = 28% | 13/79 = 16% | 2/5 = 40% | 3.0 / 0.11 | 7/28 = 25% | 7/79 = 9% | Jev ties/beats Sonnet (within 5 pts) but Jev below the absolute bar: precision 28% < 70%; magic films 40% < 60% |
| mocked | hostility | jev -> **sonnet** | v9 wording v9 @0.7 | v9 wording (mocked) | 20/67 = 30% | 27/79 = 34% | 9/17 = 53% | 2.7 / 0.25 | 9/31 = 29% | 14/79 = 18% | Jev ties/beats Sonnet (within 5 pts) but Jev below the absolute bar: precision 30% < 70%; magic films 53% < 60% |
| excluded | hostility | jev -> **sonnet** | Claude single @0.8 | Does `scene.summary` say that a character is left out, shunned, or turned away by others on purpose? | 5/8 = 63% | 8/79 = 10% | 1/1 = 100% | 5.1 / 0.09 | 1/4 = 25% | 4/79 = 5% | Jev ties/beats Sonnet (within 5 pts) but Jev below the absolute bar: precision 63% < 70% |
| discrimination | hostility | jev -> **sonnet** | v9 wording v9 @0.8 | v9 wording (discrimination) | 3/6 = 50% | 5/79 = 6% | 0/2 = 0% | 6.2 / 0.06 | 0/1 = 0% | 0/79 = 0% | thin evidence: Sonnet < 4 fires; Jev below the absolute bar: precision 50% < 70%; magic films 0% < 60% |
| caregiver_cruelty | hostility | sonnet -> **sonnet** | v9 wording single @0.8 | In `scene`, is a parent or caregiver cruel to a child in their care? | 3/5 = 60% | 5/79 = 6% | 1/1 = 100% | 3.4 / 0.05 | 9/14 = 64% | 12/79 = 15% | Sonnet (>= 4 fires) beats every Jev candidate beyond tolerance: precision 60% < 70%; recall 6% < Sonnet 15% - 5 |
| betrayal | hostility | jev -> **sonnet** | Claude single @0.8 | Does a character in `scene.lines` accuse someone they trusted of lying or betraying them? | 3/6 = 50% | 3/79 = 4% | 2/4 = 50% | 3.6 / 0.03 | 7/22 = 32% | 7/79 = 9% | Jev ties/beats Sonnet (within 5 pts) but Jev below the absolute bar: precision 50% < 70%; magic films 50% < 60%; recall 4% < Sonnet 9% - 5 |
| transforms | eerie | jev -> **jev** | Claude or_all @0.6 | OR of Claude transforms.a, transforms.b | 10/13 = 77% | 21/83 = 25% | 5/5 = 100% | 3.0 / 0.21 | never asked | - | passes |
| possessed | eerie | jev -> **sonnet** | Astra single @0.7 | Does `scene.lines` explicitly state that a character resists another being's control of their body? | 1/8 = 13% | 1/83 = 1% | 0/3 = 0% | 1.2 / -0.00 | never asked | - | Sonnet never asked; Jev below the absolute bar: precision 13% < 70%; magic films 0% < 60% |
| nightmare | eerie | jev -> **sonnet** | Claude single @0.6 | Does a character in `scene.lines` wake up frightened or say they just had a bad dream? | 0/3 = 0% | 0/83 = 0% | 0 fires | 0.0 / -0.00 | never asked | - | Sonnet never asked; Jev below the absolute bar: 3 fires < 4; precision 0% < 70% |
| unseen_threat | eerie | jev -> **sonnet** | Astra single @0.7 | Does a character say that someone or something is nearby but cannot be seen? | 4/8 = 50% | 7/83 = 8% | 1/1 = 100% | 4.9 / 0.07 | never asked | - | Sonnet never asked; Jev below the absolute bar: precision 50% < 70% |
| appears_suddenly | eerie | jev -> **sonnet** | v9 wording v9 @0.8 | v9 jump_scare = min(appears_suddenly, startled) | 5/14 = 36% | 12/83 = 14% | 2/3 = 67% | 2.3 / 0.11 | never asked | - | Sonnet never asked; Jev below the absolute bar: precision 36% < 70% |
| child_frightened | distress | sonnet -> **sonnet** | Claude single @0.6 | Does `scene.summary` say that a child is frightened, terrified, crying, or in tears? | 3/7 = 43% | 5/78 = 6% | 0 fires | 3.2 / 0.05 | 17/82 = 21% | 23/78 = 29% | Jev ties/beats Sonnet (within 5 pts) but Jev below the absolute bar: precision 43% < 70%; recall 6% < Sonnet 29% - 5 |
| afraid_for_safety | distress | jev -> **sonnet** | v9 wording v9 @0.7 | v9 wording (afraid_for_safety) | 42/237 = 18% | 45/78 = 58% | 7/36 = 19% | 1.4 / 0.27 | never asked | - | Sonnet never asked; Jev below the absolute bar: precision 18% < 70%; magic films 19% < 60% |
| screams | distress | jev -> **sonnet** | v9 wording v9 @0.8 | v9 wording (screams) | 34/167 = 20% | 38/78 = 49% | 12/49 = 24% | 1.6 / 0.27 | never asked | - | Sonnet never asked; Jev below the absolute bar: precision 20% < 70%; magic films 24% < 60% |
| crying | distress | sonnet -> **sonnet** | Astra single @0.6 | Does a line explicitly identify someone as crying right now? | 7/22 = 32% | 8/78 = 10% | 2/7 = 29% | 2.3 / 0.06 | 9/29 = 31% | 13/78 = 17% | Sonnet (>= 4 fires) beats every Jev candidate beyond tolerance: precision 32% < 70%; magic films 29% < 60%; recall 10% < Sonnet 17% - 5 |
| despair | distress | sonnet -> **sonnet** | v9 wording single @0.6 | In `scene`, does a character give up hope? | 5/36 = 14% | 7/78 = 9% | 2/8 = 25% | 1.1 / 0.02 | 12/34 = 35% | 15/78 = 19% | Sonnet (>= 4 fires) beats every Jev candidate beyond tolerance: precision 14% < 70%; magic films 25% < 60%; precision 14% < Sonnet 35% - 5; recall 9% < Sonnet 19% - 5 |
| animal_cruelty | animals | jev -> **jev** | Claude single @0.6 | Does `scene.summary` say that a character hits, kicks, traps, or hurts an animal on purpose? | 4/4 = 100% | 10/259 = 4% | 0 fires | 2.1 / 0.02 | never asked | - | passes |
| animal_in_danger | animals | jev -> **jev** | v9 wording v9 @0.7 | v9 wording (animal_in_danger) | 26/34 = 76% | 54/259 = 21% | 5/6 = 83% | 2.4 / 0.14 | never asked | - | passes |
| dangerous_act | copyable | jev -> **sonnet** | Astra single @0.6 | Does the supplied evidence explicitly identify a bodily-injury risk from that action? | 3/5 = 60% | 4/44 = 9% | 1/1 = 100% | 5.6 / 0.08 | never asked | - | Sonnet never asked; Jev below the absolute bar: precision 60% < 70% |
| runs_away | copyable | jev -> **sonnet** | Claude or_all @0.7 | OR of Claude runs_away.a, runs_away.b | 1/5 = 20% | 1/44 = 2% | 0/2 = 0% | 8.0 / 0.02 | never asked | - | Sonnet never asked; Jev below the absolute bar: precision 20% < 70%; magic films 0% < 60% |
| goes_with_stranger | copyable | jev -> **sonnet** | v9 wording v9 @0.7 | v9 wording (goes_with_stranger) | 1/6 = 17% | 1/44 = 2% | 0/2 = 0% | 4.8 / 0.02 | never asked | - | Sonnet never asked; Jev below the absolute bar: precision 17% < 70%; magic films 0% < 60% |
| slapstick | copyable | jev -> **sonnet** | v9 wording v9 @0.7 | v9 wording (slapstick) | 9/59 = 15% | 13/44 = 30% | 0/16 = 0% | 2.4 / 0.22 | never asked | - | Sonnet never asked; Jev below the absolute bar: precision 15% < 70%; magic films 0% < 60% |
| comic_peril | copyable | jev -> **sonnet** | v9 wording v9 @0.6 | v9 wording (comic_peril) | 9/69 = 13% | 11/44 = 25% | 1/17 = 6% | 2.2 / 0.17 | never asked | - | Sonnet never asked; Jev below the absolute bar: precision 13% < 70%; magic films 6% < 60% |
| film:threatens | per film item | jev -> **sonnet** | Claude single @0.7 | Does a line in `scene.lines` said to <name>'s face beg <name> to stop or not hurt them? | 2/5 = 40% | 3/79 = 4% | 1/2 = 50% | 4.7 / 0.03 | never asked | - | Sonnet never asked; Jev below the absolute bar: precision 40% < 70%; magic films 50% < 60% |
| film:child_in_danger | per film item | jev -> **jev** | Claude single @0.8 | In `scene`, is <name> in physical danger? | 25/35 = 71% | 46/221 = 21% | 2/3 = 67% | 2.3 / 0.14 | never asked | - | passes |
| film:danger | per film item | jev -> **jev** | Claude single @0.7 | In `scene`, does <danger> attack, hit, or get used against a character? | 13/18 = 72% | 22/421 = 5% | 4/4 = 100% | 3.3 / 0.04 | never asked | - | passes |

## Did the rewrites beat the v9 wording?

Comparing each source's best candidate per concept (pass the rule first, then precision on >= 4 fires, then recall): a rewrite (Claude or Astra) is better on **48** concepts, the v9 wording on **33**, tie on 7. Many v9 wins come from the threshold: the old question at 0.8 instead of 0.7.

| concept | v9 wording best | Claude best | Astra best | better |
|---|---|---|---|---|
| monster_creature | 40/125 = 32%, R 50% @0.6 | 15/30 = 50%, R 18% @0.8 | 21/60 = 35%, R 30% @0.6 | rewrite |
| ghost_spirit | 20/44 = 45%, R 23% @0.8 | 7/8 = 88%, R 6% @0.8 pass | 17/36 = 47%, R 19% @0.7 | rewrite |
| reanimated_dead | 13/45 = 29%, R 19% @0.6 | 2/5 = 40%, R 5% @0.7 | 3/7 = 43%, R 5% @0.6 | rewrite |
| skeleton_bones | 4/5 = 80%, R 6% @0.7 pass | 2/2 = 100%, R 3% @0.6 | 3/5 = 60%, R 4% @0.6 | v9 |
| dead_body | 4/14 = 29%, R 7% @0.7 | 3/9 = 33%, R 5% @0.6 | 2/4 = 50%, R 4% @0.8 | rewrite |
| shark | 4/6 = 67%, R 2% @0.6 | 3/4 = 75%, R 2% @0.6 pass | 5/6 = 83%, R 3% @0.6 pass | rewrite |
| spider_insect | 1/8 = 13%, R 1% @0.8 | 0/1 = 0%, R 0% @0.6 | 1/8 = 13%, R 1% @0.6 | tie |
| snake_reptile | 3/12 = 25%, R 7% @0.8 | 2/4 = 50%, R 5% @0.6 | 3/4 = 75%, R 7% @0.6 pass | rewrite |
| large_predator | 27/78 = 35%, R 32% @0.6 | 14/53 = 26%, R 19% @0.6 | 7/35 = 20%, R 12% @0.7 | v9 |
| rodent_bat | 3/7 = 43%, R 5% @0.6 | 3/6 = 50%, R 5% @0.8 | 3/6 = 50%, R 5% @0.6 | rewrite |
| clown | 2/4 = 50%, R 2% @0.6 | 0 fires, R 0% @0.6 | 0 fires, R 0% @0.6 | v9 |
| doll_puppet | 0/7 = 0%, R 0% @0.6 | 0/3 = 0%, R 0% @0.6 | 0/4 = 0%, R 0% @0.6 | tie |
| mask | 4/5 = 80%, R 5% @0.7 pass | 0 fires, R 0% @0.6 | 0 fires, R 0% @0.6 | v9 |
| robot_machine_being | 7/97 = 7%, R 9% @0.6 | 5/86 = 6%, R 3% @0.6 | 5/86 = 6%, R 3% @0.7 | v9 |
| witch_sorcerer | 3/4 = 75%, R 4% @0.8 pass | 2/5 = 40%, R 6% @0.8 | 0 fires, R 0% @0.6 | v9 |
| dark_magic | 10/14 = 71%, R 18% @0.8 pass | 1/4 = 25%, R 2% @0.6 | 8/14 = 57%, R 22% @0.6 | v9 |
| alien | 0 fires, R 0% @0.6 | 3/26 = 12%, R 2% @0.6 | 0 fires, R 0% @0.6 | rewrite |
| scary_appearance | 23/51 = 45%, R 31% @0.6 | 3/7 = 43%, R 6% @0.7 | 1/4 = 25%, R 1% @0.6 | v9 |
| gun | 4/9 = 44%, R 4% @0.6 | 4/9 = 44%, R 4% @0.6 | 2/6 = 33%, R 3% @0.7 | tie |
| blade_weapon | 7/10 = 70%, R 6% @0.6 pass | 4/7 = 57%, R 3% @0.6 | 7/10 = 70%, R 6% @0.7 pass | tie |
| fire | 6/9 = 67%, R 4% @0.8 | 2/2 = 100%, R 2% @0.6 | 6/7 = 86%, R 6% @0.6 pass | rewrite |
| explosion | 7/12 = 58%, R 8% @0.6 | 6/9 = 67%, R 6% @0.6 | 8/12 = 67%, R 9% @0.6 | rewrite |
| storm | 8/21 = 38%, R 7% @0.8 | 9/25 = 36%, R 8% @0.6 | 8/23 = 35%, R 7% @0.6 | v9 |
| deep_dark_water | 3/5 = 60%, R 7% @0.8 | 1/3 = 33%, R 1% @0.6 | 4/11 = 36%, R 4% @0.6 | v9 |
| heights | 8/29 = 28%, R 8% @0.6 | 3/5 = 60%, R 3% @0.6 | 2/3 = 67%, R 3% @0.6 | rewrite |
| darkness | 4/15 = 27%, R 5% @0.6 | 2/3 = 67%, R 3% @0.6 | 2/4 = 50%, R 4% @0.7 | rewrite |
| needle_medical | 0/2 = 0%, R 0% @0.6 | 0/1 = 0%, R 0% @0.6 | 0/2 = 0%, R 0% @0.6 | tie |
| medical_care | 2/5 = 40%, R 1% @0.7 | 0/2 = 0%, R 0% @0.6 | 0/2 = 0%, R 0% @0.6 | v9 |
| seriously_ill | 5/23 = 22%, R 4% @0.6 | 0/9 = 0%, R 0% @0.6 | 0/4 = 0%, R 0% @0.6 | v9 |
| blood_wound | 2/4 = 50%, R 2% @0.6 | 2/4 = 50%, R 2% @0.6 | 1/2 = 50%, R 1% @0.6 | tie |
| vehicle_crash | 5/8 = 63%, R 5% @0.6 | 1/3 = 33%, R 0% @0.6 | 0/1 = 0%, R 0% @0.6 | v9 |
| captured | 20/44 = 45%, R 43% @0.6 | 7/11 = 64%, R 12% @0.8 | 4/6 = 67%, R 7% @0.6 | rewrite |
| graveyard_funeral | 1/2 = 50%, R 1% @0.6 | 0/2 = 0%, R 0% @0.6 | 0/4 = 0%, R 0% @0.6 | rewrite |
| dangerous_machine | 10/14 = 71%, R 11% @0.8 pass | 5/7 = 71%, R 6% @0.7 pass | 2/3 = 67%, R 3% @0.6 | v9 |
| chased | 42/61 = 69%, R 32% @0.6 | 14/19 = 74%, R 11% @0.6 pass | 6/7 = 86%, R 4% @0.6 pass | rewrite |
| attacked | 25/38 = 66%, R 21% @0.6 | 8/10 = 80%, R 5% @0.7 pass | 8/13 = 62%, R 6% @0.7 | rewrite |
| falls | 3/4 = 75%, R 3% @0.8 pass | 3/4 = 75%, R 3% @0.6 pass | 3/4 = 75%, R 3% @0.8 pass | tie |
| nearly_falls | 5/6 = 83%, R 3% @0.6 pass | 7/10 = 70%, R 3% @0.6 pass | 0/2 = 0%, R 0% @0.6 | v9 |
| cannot_breathe | 9/9 = 100%, R 5% @0.6 pass | 0/1 = 0%, R 0% @0.6 | 0/1 = 0%, R 0% @0.6 | v9 |
| caught_in_hazard | 34/41 = 83%, R 23% @0.6 pass | 6/7 = 86%, R 4% @0.6 pass | 3/4 = 75%, R 2% @0.8 pass | rewrite |
| child_in_danger | 18/20 = 90%, R 14% @0.8 pass | 27/38 = 71%, R 17% @0.8 pass | 17/23 = 74%, R 11% @0.7 pass | v9 |
| creature_threat | 49/66 = 74%, R 41% @0.6 pass | 42/59 = 71%, R 35% @0.6 pass | 33/43 = 77%, R 29% @0.6 pass | rewrite |
| weapon_used | 11/17 = 65%, R 14% @0.6 | 3/6 = 50%, R 4% @0.6 | 3/4 = 75%, R 4% @0.8 | rewrite |
| battle | 25/32 = 78%, R 26% @0.6 pass | 13/16 = 81%, R 16% @0.6 pass | 4/5 = 80%, R 3% @0.6 pass | rewrite |
| trapped | 11/37 = 30%, R 22% @0.6 | 4/8 = 50%, R 9% @0.7 | 7/11 = 64%, R 14% @0.6 | rewrite |
| swallowed | 3/5 = 60%, R 7% @0.6 | 2/4 = 50%, R 5% @0.6 | 2/4 = 50%, R 5% @0.7 | v9 |
| injured | 14/30 = 47%, R 33% @0.7 | 21/42 = 50%, R 46% @0.7 | 10/18 = 56%, R 22% @0.6 | rewrite |
| badly_hurt | 7/17 = 41%, R 18% @0.7 | 5/12 = 42%, R 13% @0.6 | 1/5 = 20%, R 2% @0.6 | v9 |
| dies | 9/11 = 82%, R 15% @0.6 | 17/23 = 74%, R 26% @0.7 | 7/13 = 54%, R 7% @0.6 | v9 |
| loved_one_dies | 9/12 = 75%, R 15% @0.7 pass | 3/7 = 43%, R 4% @0.8 | 5/6 = 83%, R 8% @0.6 | v9 |
| pet_dies | 2/3 = 67%, R 2% @0.6 | 3/4 = 75%, R 5% @0.6 pass | 0/3 = 0%, R 0% @0.6 | rewrite |
| believed_dead | 19/42 = 45%, R 31% @0.6 | 6/21 = 29%, R 9% @0.6 | 2/8 = 25%, R 2% @0.6 | v9 |
| parent_death_learned | 3/5 = 60%, R 6% @0.6 | 3/6 = 50%, R 6% @0.6 | 1/4 = 25%, R 1% @0.6 | v9 |
| grieving | 13/28 = 46%, R 17% @0.8 | 7/14 = 50%, R 8% @0.6 | 3/10 = 30%, R 5% @0.7 | rewrite |
| child_taken | 5/13 = 38%, R 24% @0.6 | 3/6 = 50%, R 9% @0.8 | 1/4 = 25%, R 3% @0.7 | rewrite |
| child_separated | 3/12 = 25%, R 21% @0.6 | 3/4 = 75%, R 15% @0.8 | 1/2 = 50%, R 3% @0.6 | rewrite |
| parent_searching | 3/6 = 50%, R 12% @0.8 | 3/11 = 27%, R 12% @0.8 | 2/12 = 17%, R 9% @0.7 | v9 |
| abandoned | 4/17 = 24%, R 18% @0.8 | 2/7 = 29%, R 9% @0.7 | 0/2 = 0%, R 0% @0.6 | rewrite |
| family_in_danger | 3/10 = 30%, R 12% @0.7 | 3/8 = 38%, R 15% @0.8 | 4/27 = 15%, R 12% @0.6 | rewrite |
| parents_argue | 0/1 = 0%, R 0% @0.6 | 0 fires, R 0% @0.6 | 0/4 = 0%, R 0% @0.7 | rewrite |
| rages_at_child | 12/19 = 63%, R 18% @0.7 | 6/10 = 60%, R 10% @0.8 | 6/16 = 38%, R 10% @0.6 | v9 |
| threatens_harm | 9/28 = 32%, R 18% @0.8 | 15/52 = 29%, R 28% @0.6 | 17/52 = 33%, R 29% @0.6 | rewrite |
| plots_harm | 14/60 = 23%, R 23% @0.6 | 11/40 = 28%, R 16% @0.6 | 10/38 = 26%, R 18% @0.6 | rewrite |
| mocked | 20/67 = 30%, R 34% @0.7 | 10/40 = 25%, R 18% @0.7 | 10/38 = 26%, R 18% @0.8 | v9 |
| excluded | 7/14 = 50%, R 14% @0.8 | 5/8 = 63%, R 10% @0.8 | 4/9 = 44%, R 5% @0.6 | rewrite |
| discrimination | 3/6 = 50%, R 6% @0.8 | 2/7 = 29%, R 5% @0.6 | 3/8 = 38%, R 6% @0.6 | v9 |
| caregiver_cruelty | 3/5 = 60%, R 6% @0.8 | 1/1 = 100%, R 1% @0.6 | 2/2 = 100%, R 5% @0.6 | v9 |
| betrayal | 10/31 = 32%, R 15% @0.6 | 3/6 = 50%, R 4% @0.8 | 1/3 = 33%, R 1% @0.6 | rewrite |
| transforms | 3/7 = 43%, R 8% @0.6 | 10/13 = 77%, R 25% @0.6 pass | 6/6 = 100%, R 16% @0.6 pass | rewrite |
| possessed | 1/27 = 4%, R 1% @0.6 | 1/1 = 100%, R 2% @0.6 | 1/8 = 13%, R 1% @0.7 | rewrite |
| nightmare | 1/2 = 50%, R 1% @0.6 | 0/3 = 0%, R 0% @0.6 | 0 fires, R 0% @0.6 | v9 |
| unseen_threat | 16/82 = 20%, R 30% @0.7 | 7/27 = 26%, R 17% @0.6 | 4/8 = 50%, R 8% @0.7 | rewrite |
| appears_suddenly | 5/14 = 36%, R 14% @0.8 | 48/238 = 20%, R 71% @0.8 | 6/28 = 21%, R 10% @0.6 | v9 |
| child_frightened | 22/96 = 23%, R 36% @0.6 | 3/7 = 43%, R 6% @0.6 | 3/10 = 30%, R 4% @0.6 | rewrite |
| afraid_for_safety | 42/237 = 18%, R 58% @0.7 | 13/61 = 21%, R 21% @0.6 | 1/45 = 2%, R 1% @0.6 | rewrite |
| screams | 34/167 = 20%, R 49% @0.8 | 26/135 = 19%, R 36% @0.6 | 25/134 = 19%, R 35% @0.6 | v9 |
| crying | 8/34 = 24%, R 12% @0.6 | 12/52 = 23%, R 17% @0.6 | 7/22 = 32%, R 10% @0.6 | rewrite |
| despair | 5/36 = 14%, R 9% @0.6 | 1/4 = 25%, R 1% @0.7 | 0/7 = 0%, R 0% @0.6 | rewrite |
| animal_cruelty | 8/10 = 80%, R 7% @0.6 | 4/4 = 100%, R 4% @0.6 pass | 2/4 = 50%, R 2% @0.6 | rewrite |
| animal_in_danger | 26/34 = 76%, R 21% @0.7 pass | 25/35 = 71%, R 17% @0.6 pass | 14/20 = 70%, R 12% @0.6 pass | v9 |
| dangerous_act | 6/27 = 22%, R 18% @0.7 | 3/38 = 8%, R 7% @0.6 | 3/5 = 60%, R 9% @0.6 | rewrite |
| runs_away | 0/6 = 0%, R 0% @0.6 | 1/5 = 20%, R 2% @0.7 | 1/3 = 33%, R 2% @0.6 | rewrite |
| goes_with_stranger | 1/6 = 17%, R 2% @0.7 | 0/11 = 0%, R 0% @0.7 | 0/3 = 0%, R 0% @0.6 | v9 |
| slapstick | 9/59 = 15%, R 30% @0.7 | 0/10 = 0%, R 0% @0.6 | 2/7 = 29%, R 9% @0.7 | rewrite |
| comic_peril | 9/69 = 13%, R 25% @0.6 | 1/7 = 14%, R 2% @0.8 | 4/27 = 15%, R 11% @0.8 | rewrite |
| film:threatens | 7/59 = 12%, R 10% @0.6 | 2/5 = 40%, R 4% @0.7 | 2/6 = 33%, R 3% @0.8 | rewrite |
| film:child_in_danger | 29/45 = 64%, R 27% @0.8 | 25/35 = 71%, R 21% @0.8 pass | 15/21 = 71%, R 11% @0.7 pass | rewrite |
| film:danger | 28/46 = 61%, R 12% @0.8 | 13/18 = 72%, R 5% @0.7 pass | 12/16 = 75%, R 5% @0.7 pass | rewrite |

## The four fuzzy questions on the magic/afterlife films

Round 5 found these misfiring on magic or afterlife settings. Below, every candidate of the concept at each threshold: magic-film fires, and overall precision / recall.

### dark_magic

| candidate | t | magic films | all films | recall |
|---|---|---|---|---|
| A:bundle:dark_magic | 0.7 | 1/2 = 50% | 2/3 = 67% | 4% |
| A:bundle:dark_magic | 0.8 | 0 fires | 1/1 = 100% | 2% |
| A:dark_magic.a.change@L | 0.7 | 2/4 = 50% | 3/5 = 60% | 7% |
| A:dark_magic.a.change@L | 0.8 | 1/3 = 33% | 1/3 = 33% | 3% |
| A:dark_magic.a.change@max | 0.7 | 2/4 = 50% | 5/10 = 50% | 13% |
| A:dark_magic.a.change@max | 0.8 | 1/3 = 33% | 3/7 = 43% | 9% |
| A:dark_magic.a.change@S | 0.7 | 0/1 = 0% | 3/7 = 43% | 8% |
| A:dark_magic.a.change@S | 0.8 | 0/1 = 0% | 2/5 = 40% | 6% |
| A:dark_magic.a.forced@L | 0.7 | 3/10 = 30% | 5/28 = 18% | 7% |
| A:dark_magic.a.forced@L | 0.8 | 2/9 = 22% | 3/18 = 17% | 5% |
| A:dark_magic.a.forced@max | 0.7 | 4/12 = 33% | 8/42 = 19% | 10% |
| A:dark_magic.a.forced@max | 0.8 | 3/11 = 27% | 4/23 = 17% | 6% |
| A:dark_magic.a.forced@S | 0.7 | 1/3 = 33% | 3/18 = 17% | 2% |
| A:dark_magic.a.forced@S | 0.8 | 1/3 = 33% | 1/7 = 14% | 1% |
| A:dark_magic.a.hurt@L | 0.7 | 0/1 = 0% | 0/1 = 0% | 0% |
| A:dark_magic.a.hurt@max | 0.7 | 0/1 = 0% | 0/1 = 0% | 0% |
| C:dark_magic.c@Lnl | 0.7 | 0 fires | 0/1 = 0% | 0% |
| C:or:dark_magic | 0.7 | 0 fires | 0/1 = 0% | 0% |
| V:dark_magic | 0.7 | 12/19 = 63% | 17/32 = 53% | 31% |
| V:dark_magic | 0.8 | 5/7 = 71% | 10/14 = 71% | 18% |

### ghost_spirit

| candidate | t | magic films | all films | recall |
|---|---|---|---|---|
| A:bundle:ghost_spirit | 0.7 | 15/34 = 44% | 17/36 = 47% | 19% |
| A:bundle:ghost_spirit | 0.8 | 10/23 = 43% | 11/24 = 46% | 14% |
| A:ghost_spirit.a@L | 0.7 | 13/30 = 43% | 15/32 = 47% | 14% |
| A:ghost_spirit.a@L | 0.8 | 8/21 = 38% | 9/22 = 41% | 9% |
| A:ghost_spirit.a@max | 0.7 | 15/34 = 44% | 17/36 = 47% | 19% |
| A:ghost_spirit.a@max | 0.8 | 10/23 = 43% | 11/24 = 46% | 14% |
| A:ghost_spirit.a@S | 0.7 | 2/4 = 50% | 3/5 = 60% | 6% |
| A:ghost_spirit.a@S | 0.8 | 2/2 = 100% | 3/3 = 100% | 6% |
| C:ghost_spirit.a@S | 0.7 | 0 fires | 1/1 = 100% | 1% |
| C:ghost_spirit.a@S | 0.8 | 0 fires | 1/1 = 100% | 1% |
| C:ghost_spirit.b@Lnl | 0.7 | 4/8 = 50% | 6/10 = 60% | 4% |
| C:ghost_spirit.b@Lnl | 0.8 | 4/5 = 80% | 6/7 = 86% | 4% |
| C:ghost_spirit.c@S | 0.7 | 1/1 = 100% | 1/1 = 100% | 2% |
| C:ghost_spirit.c@S | 0.8 | 1/1 = 100% | 1/1 = 100% | 2% |
| C:or:ghost_spirit | 0.7 | 5/9 = 56% | 7/11 = 64% | 6% |
| C:or:ghost_spirit | 0.8 | 5/6 = 83% | 7/8 = 88% | 6% |
| V:ghost_spirit | 0.7 | 21/50 = 42% | 23/56 = 41% | 27% |
| V:ghost_spirit | 0.8 | 18/41 = 44% | 20/44 = 45% | 23% |

### believed_dead

| candidate | t | magic films | all films | recall |
|---|---|---|---|---|
| A:believed_dead.a.summary@S | 0.7 | 0/1 = 0% | 0/4 = 0% | 0% |
| A:believed_dead.a.summary@S | 0.8 | 0 fires | 0/2 = 0% | 0% |
| A:believed_dead.a.words@L | 0.7 | 1/3 = 33% | 1/6 = 17% | 1% |
| A:believed_dead.a.words@L | 0.8 | 1/2 = 50% | 1/4 = 25% | 1% |
| A:bundle:believed_dead | 0.7 | 1/3 = 33% | 1/9 = 11% | 1% |
| A:bundle:believed_dead | 0.8 | 1/2 = 50% | 1/6 = 17% | 1% |
| C:believed_dead.a@Lnl | 0.7 | 1/3 = 33% | 1/4 = 25% | 1% |
| C:believed_dead.a@Lnl | 0.8 | 1/3 = 33% | 1/4 = 25% | 1% |
| C:believed_dead.b@S | 0.7 | 1/3 = 33% | 5/17 = 29% | 8% |
| C:believed_dead.b@S | 0.8 | 1/3 = 33% | 2/13 = 15% | 2% |
| C:or:believed_dead | 0.7 | 1/4 = 25% | 5/18 = 28% | 8% |
| C:or:believed_dead | 0.8 | 1/4 = 25% | 2/14 = 14% | 2% |
| V:believed_dead | 0.7 | 5/10 = 50% | 14/32 = 44% | 21% |
| V:believed_dead | 0.8 | 5/7 = 71% | 8/17 = 47% | 11% |

### afraid_for_safety

| candidate | t | magic films | all films | recall |
|---|---|---|---|---|
| A:afraid_for_safety.a.summary@S | 0.7 | 0 fires | 0/8 = 0% | 0% |
| A:afraid_for_safety.a.summary@S | 0.8 | 0 fires | 0/4 = 0% | 0% |
| A:afraid_for_safety.a.words@L | 0.7 | 0/3 = 0% | 0/32 = 0% | 0% |
| A:afraid_for_safety.a.words@L | 0.8 | 0/2 = 0% | 0/19 = 0% | 0% |
| A:bundle:afraid_for_safety | 0.7 | 0/3 = 0% | 0/37 = 0% | 0% |
| A:bundle:afraid_for_safety | 0.8 | 0/2 = 0% | 0/22 = 0% | 0% |
| C:afraid_for_safety.a@Lnl | 0.7 | 1/9 = 11% | 11/51 = 22% | 18% |
| C:afraid_for_safety.a@Lnl | 0.8 | 1/8 = 13% | 8/42 = 19% | 12% |
| C:afraid_for_safety.b@Lnl | 0.7 | 1/8 = 13% | 5/36 = 14% | 10% |
| C:afraid_for_safety.b@Lnl | 0.8 | 1/4 = 25% | 5/27 = 19% | 10% |
| C:afraid_for_safety.c@Lnl | 0.7 | 4/16 = 25% | 5/29 = 17% | 8% |
| C:afraid_for_safety.c@Lnl | 0.8 | 4/14 = 29% | 5/24 = 21% | 8% |
| C:bundle:afraid_for_safety | 0.7 | 3/21 = 14% | 15/87 = 17% | 27% |
| C:bundle:afraid_for_safety | 0.8 | 3/17 = 18% | 13/72 = 18% | 22% |
| C:or:afraid_for_safety | 0.7 | 6/27 = 22% | 18/97 = 19% | 32% |
| C:or:afraid_for_safety | 0.8 | 6/21 = 29% | 16/79 = 20% | 27% |
| V:afraid_for_safety | 0.7 | 7/36 = 19% | 42/237 = 18% | 58% |
| V:afraid_for_safety | 0.8 | 7/26 = 27% | 26/164 = 16% | 35% |

## The 8 moments the round-5 narrow cut lost

| moment | key text | key groups | rewrites firing >= 0.7 in that scene, in a key group |
|---|---|---|---|
| book-of-life S024 R10 | Small, sharp-toothed banditos raid a village, stealing chickens and jewelry as men flee screaming and nuns pr... | creatures_figures, peril, hostility, distress, animals | C:screams.a 0.98, C:plots_harm.a 0.98, A:screams.a.caption 0.97, C:chased.a 0.89, A:threatens_harm.a.hurt 0.89, C:attacked.a 0.81 |
| book-of-life S040 R17 | A giant skeletal bull with glowing eyes, teeth and spikes charges a male ghost, who falls; flames engulf the ... | creatures_figures, animals, peril, objects_hazards | C:creature_threat.c 0.78 |
| book-of-life S035 R37 | The ghost man escapes three enormous glowing wooden balls while navigating a maze. | peril, objects_hazards | none >= 0.7 |
| princess-and-the-frog S027 R29 | Slithering ghosts carry a captive frog through the swamp in their claws. | creatures_figures, captivity, peril, eerie | C:startled.a 0.93, C:appears_suddenly.a 0.74 |
| princess-and-the-frog S040 R42 | An alligator brings the dying firefly to the two frogs and explains that a man crushed him. | injury, death, animals | C:badly_hurt.b 0.96, C:injured.a 0.93, A:injured.a.words 0.79 |
| princess-and-the-frog S011 R72 | The Shadow Man uses sinister magic to transform Naveen into a frog. | eerie, creatures_figures | C:witch_sorcerer.b 0.83 |
| moana S016 R35 | A granddaughter weeps beside her dying grandmother, then leaves; the grandmother's death is implied. | death, distress, separation | C:dies.b 0.97, C:loved_one_dies.b 0.96, C:crying.a 0.89, A:family_in_danger.a.relation 0.83, A:loved_one_dies.a.family 0.73 |
| moana S024 R40 | A man tells a girl he will strike her down. | hostility, peril | C:threatens_harm.a 0.92 |

R29 (princess-and-the-frog S027) has no verified summary sentence, so every summary-channel phrasing is unasked there. From the lines, only the startle / sudden-appearance phrasings reach 0.7 (eerie). The peril, captivity, creature and ghost phrasings all stay below 0.6 (e.g. ghost_spirit.b 0.10, creature_threat.a 0.37, captured.a 0.18, afraid_for_safety.c 0.56). R37 (book-of-life S035) gets no fire in its key groups (peril, objects_hazards): afraid_for_safety.a 0.93 and transforms.b 0.90 fire there, but under other groups.

## Caveats

- **Selection on seen films.** All 13 films were used to write or tune earlier rounds, and the best of dozens of candidates x 3 thresholds is picked on the same data. The winners' numbers are optimistic. This round picks candidates to freeze; it is not a held-out test.
- **Precision is a lower bound.** A correct fire on a moment the parent guides did not list counts as wrong. This hits presence questions hardest (keys list events, not every scene a monster is on screen). The absolute 0.70 bar therefore sends most presence concepts to "Sonnet" even though Sonnet was never asked them.
- **Group-level hits.** As in the v8 scorecard, a fire counts as a hit when it overlaps any key item in the concept's group (a fire question is right on a knife item). Narrow concepts get loose credit on precision and tiny recall denominators; Sonnet is scored the same way.
- **Raw answers, no gates.** No retold / imagined / comic gate and no kind veto is applied to either model. Claude's bundle rules are applied inside the concept (e.g. dies uses dead_body and seriously_ill; afraid_for_safety.c uses v9's danger Score).
- **Astra instantiation.** Astra's entity slots ({C}, {A}, {D} ...) meant code to bind them to characters. With no per-character enumeration they were written as generic referents ("a character", "a child" plus the verified children list where Astra gated on verified_child). Three relational sub-Nouls were reworded to be answerable per scene, and parent_death_learned (3) was folded into the words "their parent". See ASTRA_SUBST / ASTRA_TEXT in pool.mjs.
- **Film templates.** Film presence was not re-asked. Claude's film_threatens bundle uses v9's fpl/fps presence answers. Claude's [N] name states were realised as the name (plus verified aliases) in the question text, as v9 did.
- **Sonnet** is compared at 0.7 only (0.8 is identical for its probability map). It was asked 43 ids; a concept whose ids were only partly asked is marked "partial ids". Sonnet saw the v9 context state; Jev saw the minimal states.
- **Lyric removal** found almost nothing to remove: these subtitle files rarely mark songs (no music sign in most SRTs).

