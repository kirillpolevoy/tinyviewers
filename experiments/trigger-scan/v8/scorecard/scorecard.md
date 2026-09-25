# Jev question scorecard (v8 vs live Sonnet, human keys)

## Method

```
METHOD (also written into the outputs):
 Key items: refs/<slug>.key.json items with source != 'codex-rules' and human_written != false, mapped
   (mappable, finite start/end), with >= 1 category in the 13 v3 groups. Window = the item's gap window
   [min(start, gap_start), max(end, gap_end)] (refscore.js gapKey). A scene "overlaps" an item when the
   scene span and the window share > 0 ms. codex-rules items (model-written) are scored apart.
 (1) Group recall: an item with category G is ANSWERED by a system when a scene overlapping its
   window carries a tag in G. Jev = act-level tags of out/<slug>.tags.r1.json (after modifier
   cancellation and the kind veto), incl. film-specific threat / child-in-danger / danger tags under
   their own group; film-specific PRESENCE tags are excluded (who is on screen, not a concern, as in
   compare.js; their groups are arbitrary, e.g. a protagonist under 'hostility'). Live = asserted
   presence/event labels (mention channel excluded) mapped to groups via taxonomy-v3 BY_ID, as
   compare.js does. Recall = answered / items with G. Reported for all mapped items (any
   should_flag) and for should_flag === true only.
 (2) Group precision (strict proxy): of the scenes carrying G, the share overlapping >= 1 key item
   whose categories include G. Keys are incomplete (parent guides list notable moments, not every
   scene where e.g. a character is in peril), so a correct tag on an unlisted moment counts as wrong:
   the proxy is a LOWER bound, hardest on PRESENCE questions (keys list events, not every scene a
   ghost or a witch is on screen). It also favours the live system: its scenes are longer (about
   2-2.6 min vs 1.1-2.4 for Jev) and PRE-SELECTED (they cover only 19-46% of the runtime; Jev tiles
   the whole film), so every live scene is already a likely hit. The base rate (share of ALL the
   system's scenes that overlap a G item), lift = precision / base rate, the share of the film
   tagged G and the share of G-tagged minutes inside G item windows are given alongside.
   Group mapping caveat: Jev's child_in_danger is filed under 'peril' but its v3 id
   family_in_danger is a 'separation' item in taxonomy-v3, which the live labels use.
 (3) Per Jev QUESTION (each universal presence/event/derived item and each film-specific template):
   raw probability per scene = presence max(pl, ps); event e.<id>; jump_scare min(appears_suddenly,
   startled); film presence max(fpl, fps); film events fe.<id>. A question FIRES in a scene at
   threshold t when p >= t and select.js did not cancel it (retold / imagined / comic modifiers,
   scene-level) or veto it (kind gate). At t = 0.7 this reproduces the act tags (checked below).
   recall = key items in the question's group caught by that question / items in the group;
   precision proxy = fired scenes overlapping an item in the group / fired scenes; AUC = P(p on a
   scene overlapping a G item > p on a scene overlapping none); missed items' best p histogram.
   Live comparison: live asserted label with the question's v3 id (same_v3) or any label in G on an
   overlapping live scene.
 (4) DTDD: topics with a yes/no crowd majority; refscore.js dtddTargets maps a topic to specific tag
   ids ('tags', headline) or, failing that, to its v3 groups ('groups', coarse). Jev says yes when any
   scene carries a matching act tag; live when any asserted label matches (Jev ids -> v3 via
   questions.js ITEMS). Grouped by the topic's first category.
 (5) Held-out (tangled, coco, how-to-train-your-dragon) is primary; the 7 dev films (used to tune v8)
   are reported apart. Reliability ranking: questions firing >= 3 times at 0.7 on the held-out films,
   by Wilson 95% lower bound of the precision proxy (most) / upper bound (least); film:presence and
   the animal_creature kind-veto parent are not ranked. Live on the dev films = 6 films (up has no
   live scene file); Jev pooled dev numbers include up.
```

## Coverage

| film | split | human mapped items | of which should_flag | human unmapped | codex-rules mapped | DTDD topics | Jev scenes | Jev min/scene | live scenes | live min/scene | live share of film | act-tag reconstruction mismatches |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| tangled | held-out | 75 | 41 | 21 | 9 | 145 | 70 | 1.342 | 16 | 2.592 | 43% | 0 |
| coco | held-out | 46 | 24 | 16 | 11 | 145 | 56 | 1.765 | 12 | 1.586 | 19% | 0 |
| how-to-train-your-dragon | held-out | 42 | 20 | 24 | 13 | 145 | 40 | 2.441 | 17 | 2.601 | 45% | 0 |
| nemo | dev | 66 | 42 | 9 | 0 | 167 | 62 | 1.509 | 30 | 0.985 | 32% | 0 |
| monsters-inc | dev | 19 | 12 | 0 | 0 | 146 | 78 | 1.09 | 16 | 1.765 | 33% | 0 |
| lion-king | dev | 24 | 16 | 11 | 0 | 173 | 51 | 1.721 | 12 | 1.925 | 26% | 0 |
| frankenweenie | dev | 52 | 39 | 37 | 0 | 145 | 60 | 1.384 | 15 | 2.613 | 46% | 0 |
| wild-robot | dev | 64 | 40 | 34 | 0 | 146 | 74 | 1.373 | 17 | 2.699 | 45% | 0 |
| iron-giant | dev | 11 | 7 | 10 | 13 | 145 | 45 | 1.749 | 13 | 2.306 | 38% | 0 |
| up | dev | 42 | 26 | 29 | 22 | 144 | 54 | 1.791 | n/a (missing scene file /Users/kpolevoy/toddler-movies/experiments/trigger-scan/runs-v3/sonnet-alone-up.json) | - | - | 0 |

## HELD-OUT (tangled, coco, how-to-train-your-dragon)

### Group recall / precision proxy (Jev act tags vs live labels)

| group | items | Jev recall | live recall | Jev recall sf | live recall sf | Jev tagged scenes | Jev prec | Jev base | Jev lift | live tagged scenes | live prec | live base | live lift | Jev film share | live film share | Jev min-prec | live min-prec |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| creatures_figures | 25 | 76% | 56% | 79% | 71% | 68 | 29% | 17% | 1.74 | 32 | 38% | 36% | 1.053 | 43% | 24% | 12% | 14% |
| objects_hazards | 33 | 58% | 61% | 56% | 78% | 26 | 50% | 18% | 2.762 | 31 | 39% | 29% | 1.339 | 18% | 28% | 12% | 19% |
| peril | 55 | 67% | 73% | 70% | 74% | 34 | 68% | 24% | 2.877 | 26 | 77% | 56% | 1.383 | 27% | 26% | 27% | 35% |
| violence | 69 | 33% | 23% | 42% | 36% | 14 | 93% | 30% | 3.149 | 9 | 89% | 53% | 1.668 | 12% | 9% | 28% | 37% |
| death | 38 | 42% | 42% | 58% | 67% | 16 | 38% | 18% | 2.072 | 8 | 75% | 27% | 2.809 | 12% | 5% | 12% | 41% |
| separation | 11 | 36% | 18% | 80% | 40% | 14 | 29% | 7% | 4.333 | 5 | 40% | 11% | 3.604 | 9% | 3% | 13% | 7% |
| injury | 20 | 40% | 30% | 73% | 55% | 9 | 22% | 10% | 2.313 | 2 | 50% | 20% | 2.5 | 5% | 3% | 16% | 5% |
| captivity | 22 | 41% | 55% | 40% | 60% | 14 | 43% | 11% | 3.763 | 10 | 80% | 27% | 2.996 | 10% | 11% | 14% | 19% |
| eerie | 24 | 54% | 38% | 43% | 43% | 48 | 23% | 12% | 1.908 | 11 | 55% | 22% | 2.455 | 29% | 8% | 8% | 15% |
| hostility | 30 | 57% | 30% | 80% | 30% | 42 | 33% | 16% | 2.043 | 13 | 54% | 24% | 2.205 | 26% | 9% | 12% | 11% |
| distress | 17 | 53% | 59% | 63% | 75% | 63 | 13% | 11% | 1.176 | 21 | 33% | 18% | 1.871 | 39% | 21% | 7% | 14% |
| animals | 16 | 0% | 0% | 0% | 0% | 7 | 0% | 10% | 0 | 0 | - | 13% | - | 7% | 0% | 0% | - |
| copyable | 9 | 67% | 11% | - | - | 20 | 20% | 5% | 4.167 | 3 | 33% | 7% | 4.97 | 16% | 2% | 4% | 26% |
| ALL | 369 | 49% | 42% | 57% | 57% | 375 | 33% | - | - | 171 | 53% | - | - | - | - | - | - |

sf = should_flag === true items only. Live recall on the dev films excludes up (no live baseline); Jev pooled includes it.

### Per film, ALL groups (micro)

| film | items | Jev recall | live recall | Jev prec | live prec |
|---|---|---|---|---|---|
| tangled | 166 | 52% | 49% | 34% | 56% |
| coco | 101 | 48% | 32% | 28% | 48% |
| how-to-train-your-dragon | 102 | 44% | 40% | 38% | 52% |

### Jev group threshold sweep (recall / precision proxy / tagged scenes)

| group | @0.5 | @0.6 | @0.7 | @0.8 |
|---|---|---|---|---|
| creatures_figures | 92% / 28% / 92 | 88% / 31% / 78 | 76% / 29% / 68 | 72% / 40% / 47 |
| objects_hazards | 70% / 38% / 42 | 58% / 45% / 29 | 58% / 50% / 26 | 46% / 53% / 19 |
| peril | 78% / 46% / 61 | 76% / 55% / 47 | 67% / 68% / 34 | 53% / 74% / 23 |
| violence | 46% / 74% / 23 | 42% / 89% / 18 | 33% / 93% / 14 | 30% / 91% / 11 |
| death | 61% / 38% / 32 | 42% / 30% / 20 | 42% / 38% / 16 | 26% / 44% / 9 |
| separation | 55% / 15% / 34 | 36% / 17% / 23 | 36% / 29% / 14 | 36% / 50% / 8 |
| injury | 55% / 33% / 15 | 50% / 25% / 12 | 40% / 22% / 9 | 40% / 33% / 6 |
| captivity | 55% / 39% / 23 | 50% / 42% / 19 | 41% / 43% / 14 | 27% / 33% / 12 |
| eerie | 100% / 19% / 97 | 100% / 22% / 82 | 54% / 23% / 48 | 33% / 35% / 23 |
| hostility | 87% / 31% / 75 | 77% / 32% / 62 | 57% / 33% / 42 | 47% / 44% / 25 |
| distress | 82% / 14% / 97 | 71% / 14% / 80 | 53% / 13% / 63 | 35% / 13% / 48 |
| animals | 31% / 12% / 25 | 13% / 14% / 14 | 0% / 0% / 7 | 0% / 0% / 1 |
| copyable | 100% / 14% / 52 | 89% / 17% / 35 | 67% / 20% / 20 | 33% / 7% / 14 |
| ALL | 68% / 27% / 668 | 60% / 30% / 519 | 49% / 33% / 375 | 39% / 39% / 246 |

### Question overview (film:presence and animal_creature excluded)

| questions | fired_at_0_7 | never_fired_at_0_7 | fired_with_lift_gt_1 | fired_with_precision_ge_0_5 | auc_questions_with_ge_5_positive_scenes | auc_median | auc_ge_0_7 | auc_ge_0_8 | auc_lt_0_6 |
|---|---|---|---|---|---|---|---|---|---|
| 93 | 74 | 19 | 58 | 36 | 93 | 0.672 | 36 | 10 | 23 |

### Per question (Jev) with live comparison

rec/prec at 0.5, 0.6, 0.7, 0.8; fires = scenes (film items: scene x item) where the question fires; AUC = scenes overlapping a group item vs the rest; missed 0.5-0.7 = key items missed at 0.7 whose best p is in [0.5, 0.7); live v3 = live label with the same v3 id.

| question | group | items | fires@.7 | rate@.7 | rec .5/.6/.7/.8 | prec .5/.6/.7/.8 | base | lift@.7 | AUC | p50 pos/neg | missed | missed 0.5-0.7 | unique@.7 | live v3 rec | live grp rec | Jev-caught also live v3 | live v3 prec | live v3 fires |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| alien | creatures_figures | 25 | 0 | 0% | 0% 0% 0% 0% | - - - - | 17% | - | 0.535 | 0.01/0.01 | 25 | 0 | 0 | 0% | 56% | 0/0 | - | 0 |
| animal_creature | creatures_figures | 25 | 7 | 4% | 24% 24% 24% 12% | 78% 78% 86% 100% | 17% | 5.071 | 0.644 | 0/0 | 19 | 0 | 0 | - | 56% | - | - | - |
| clown | creatures_figures | 25 | 0 | 0% | 0% 0% 0% 0% | 0% - - - | 17% | - | 0.649 | 0.02/0.02 | 25 | 0 | 0 | 0% | 56% | 0/0 | - | 0 |
| dark_magic | creatures_figures | 25 | 8 | 5% | 24% 20% 16% 16% | 39% 33% 25% 40% | 17% | 1.479 | 0.505 | 0.05/0.06 | 21 | 2 | 0 | 0% | 56% | 0/4 | 0% | 7 |
| dead_body | creatures_figures | 25 | 0 | 0% | 4% 0% 0% 0% | 100% - - - | 17% | - | 0.725 | 0.06/0.03 | 25 | 1 | 0 | 16% | 56% | 0/0 | 40% | 10 |
| doll_puppet | creatures_figures | 25 | 1 | 1% | 0% 0% 0% 0% | 0% 0% 0% 0% | 17% | 0 | 0.533 | 0.04/0.03 | 25 | 0 | 0 | 0% | 56% | 0/0 | - | 0 |
| ghost_spirit | creatures_figures | 25 | 32 | 19% | 24% 24% 24% 24% | 24% 26% 25% 33% | 17% | 1.479 | 0.565 | 0.02/0.02 | 19 | 0 | 1 | 0% | 56% | 0/6 | - | 0 |
| large_predator | creatures_figures | 25 | 2 | 1% | 24% 12% 4% 4% | 50% 60% 50% 100% | 17% | 2.959 | 0.554 | 0.04/0.02 | 24 | 5 | 0 | 4% | 56% | 1/1 | 100% | 1 |
| mask | creatures_figures | 25 | 0 | 0% | 0% 0% 0% 0% | 0% 0% - - | 17% | - | 0.642 | 0.03/0.02 | 25 | 0 | 0 | 0% | 56% | 0/0 | - | 0 |
| monster_creature | creatures_figures | 25 | 16 | 10% | 52% 40% 40% 36% | 63% 67% 69% 77% | 17% | 4.071 | 0.86 | 0.53/0.04 | 15 | 3 | 2 | 36% | 56% | 8/10 | 69% | 13 |
| reanimated_dead | creatures_figures | 25 | 1 | 1% | 0% 0% 0% 0% | 0% 0% 0% - | 17% | 0 | 0.59 | 0.03/0.03 | 25 | 0 | 0 | 4% | 56% | 0/0 | 50% | 2 |
| robot_machine_being | creatures_figures | 25 | 0 | 0% | 4% 0% 0% 0% | 50% - - - | 17% | - | 0.652 | 0.07/0.05 | 25 | 1 | 0 | 0% | 56% | 0/0 | - | 0 |
| rodent_bat | creatures_figures | 25 | 2 | 1% | 4% 4% 4% 4% | 33% 50% 50% 50% | 17% | 2.959 | 0.604 | 0.03/0.03 | 24 | 0 | 0 | 0% | 56% | 0/1 | 0% | 1 |
| scary_appearance | creatures_figures | 25 | 4 | 2% | 48% 36% 20% 16% | 69% 64% 75% 100% | 17% | 4.438 | 0.845 | 0.34/0.05 | 20 | 7 | 0 | 12% | 56% | 3/5 | 33% | 3 |
| shark | creatures_figures | 25 | 0 | 0% | 0% 0% 0% 0% | - - - - | 17% | - | 0.388 | 0.01/0.01 | 25 | 0 | 0 | 0% | 56% | 0/0 | - | 0 |
| skeleton_bones | creatures_figures | 25 | 2 | 1% | 12% 8% 4% 4% | 27% 33% 50% 100% | 17% | 2.959 | 0.671 | 0.05/0.03 | 24 | 2 | 0 | 16% | 56% | 1/1 | 40% | 10 |
| snake_reptile | creatures_figures | 25 | 8 | 5% | 12% 12% 12% 12% | 13% 13% 13% 20% | 17% | 0.74 | 0.691 | 0.04/0.02 | 22 | 0 | 0 | 0% | 56% | 0/3 | - | 0 |
| spider_insect | creatures_figures | 25 | 1 | 1% | 0% 0% 0% 0% | 0% 0% 0% - | 17% | 0 | 0.598 | 0.02/0.02 | 25 | 0 | 0 | 0% | 56% | 0/0 | - | 0 |
| witch_sorcerer | creatures_figures | 25 | 10 | 6% | 16% 16% 4% 0% | 11% 14% 10% 0% | 17% | 0.592 | 0.447 | 0.02/0.03 | 24 | 3 | 1 | 0% | 56% | 0/1 | 0% | 7 |
| blade_weapon | objects_hazards | 33 | 7 | 4% | 24% 24% 24% 15% | 75% 75% 86% 80% | 18% | 4.735 | 0.71 | 0.05/0.02 | 25 | 0 | 4 | 36% | 61% | 3/8 | 44% | 9 |
| blood_wound | objects_hazards | 33 | 2 | 1% | 12% 6% 6% 6% | 50% 50% 50% 50% | 18% | 2.762 | 0.629 | 0.03/0.02 | 31 | 2 | 1 | 3% | 61% | 0/2 | 20% | 5 |
| cage_net_trap | objects_hazards | 33 | 1 | 1% | 12% 0% 0% 0% | 25% 0% 0% 0% | 18% | 0 | 0.622 | 0.06/0.04 | 33 | 4 | 0 | 21% | 61% | 0/0 | 10% | 10 |
| dangerous_machine | objects_hazards | 33 | 1 | 1% | 15% 9% 6% 0% | 100% 100% 100% - | 18% | 5.525 | 0.773 | 0.03/0.02 | 31 | 3 | 1 | 0% | 61% | 0/2 | - | 0 |
| darkness | objects_hazards | 33 | 2 | 1% | 12% 12% 12% 12% | 33% 50% 50% 100% | 18% | 2.762 | 0.666 | 0.08/0.06 | 29 | 0 | 0 | 46% | 61% | 4/4 | 47% | 17 |
| deep_dark_water | objects_hazards | 33 | 2 | 1% | 12% 12% 12% 12% | 50% 50% 50% 100% | 18% | 2.762 | 0.625 | 0.03/0.02 | 29 | 0 | 0 | 21% | 61% | 4/4 | 100% | 1 |
| explosion | objects_hazards | 33 | 4 | 2% | 21% 21% 21% 21% | 100% 100% 100% 100% | 18% | 5.525 | 0.711 | 0.03/0.02 | 26 | 0 | 1 | 9% | 61% | 2/7 | 100% | 3 |
| fire | objects_hazards | 33 | 4 | 2% | 12% 12% 12% 9% | 57% 80% 100% 100% | 18% | 5.525 | 0.647 | 0.04/0.02 | 29 | 0 | 0 | 12% | 61% | 2/4 | 57% | 7 |
| graveyard_funeral | objects_hazards | 33 | 0 | 0% | 0% 0% 0% 0% | - - - - | 18% | - | 0.473 | 0.01/0.02 | 33 | 0 | 0 | 3% | 61% | 0/0 | 100% | 1 |
| gun | objects_hazards | 33 | 0 | 0% | 0% 0% 0% 0% | - - - - | 18% | - | 0.695 | 0.03/0.02 | 33 | 0 | 0 | 0% | 61% | 0/0 | - | 0 |
| heights | objects_hazards | 33 | 3 | 2% | 9% 0% 0% 0% | 18% 0% 0% 0% | 18% | 0 | 0.622 | 0.1/0.04 | 33 | 3 | 0 | 24% | 61% | 0/0 | 67% | 9 |
| medical_care | objects_hazards | 33 | 0 | 0% | 0% 0% 0% 0% | - - - - | 18% | - | 0.419 | 0.01/0.01 | 33 | 0 | 0 | 0% | 61% | 0/0 | - | 0 |
| needle_medical | objects_hazards | 33 | 0 | 0% | 0% 0% 0% 0% | - - - - | 18% | - | 0.531 | 0.02/0.02 | 33 | 0 | 0 | 0% | 61% | 0/0 | - | 0 |
| restraints | objects_hazards | 33 | 2 | 1% | 6% 0% 0% 0% | 33% 0% 0% 0% | 18% | 0 | 0.561 | 0.03/0.03 | 33 | 2 | 0 | 21% | 61% | 0/0 | 10% | 10 |
| seriously_ill | objects_hazards | 33 | 5 | 3% | 12% 6% 6% 6% | 29% 17% 20% 33% | 18% | 1.105 | 0.431 | 0.04/0.04 | 31 | 2 | 2 | 0% | 61% | 0/2 | - | 0 |
| storm | objects_hazards | 33 | 0 | 0% | 0% 0% 0% 0% | - - - - | 18% | - | 0.618 | 0.02/0.02 | 33 | 0 | 0 | 0% | 61% | 0/0 | - | 0 |
| vehicle_crash | objects_hazards | 33 | 0 | 0% | 3% 0% 0% 0% | 50% 0% - - | 18% | - | 0.687 | 0.03/0.02 | 33 | 1 | 0 | 21% | 61% | 0/0 | 100% | 1 |
| attacked | peril | 55 | 9 | 5% | 27% 26% 18% 14% | 41% 46% 56% 50% | 24% | 2.366 | 0.757 | 0.18/0.07 | 45 | 5 | 2 | 51% | 73% | 6/10 | 74% | 19 |
| cannot_breathe | peril | 55 | 2 | 1% | 6% 6% 6% 6% | 67% 100% 100% 100% | 24% | 4.255 | 0.672 | 0.08/0.05 | 52 | 0 | 0 | 9% | 73% | 1/3 | 100% | 1 |
| caught_in_hazard | peril | 55 | 3 | 2% | 16% 16% 11% 6% | 83% 100% 100% 100% | 24% | 4.255 | 0.838 | 0.19/0.06 | 49 | 3 | 0 | 26% | 73% | 6/6 | 73% | 11 |
| chased | peril | 55 | 6 | 4% | 38% 22% 13% 13% | 52% 54% 50% 60% | 24% | 2.128 | 0.749 | 0.25/0.08 | 48 | 14 | 6 | 42% | 73% | 7/7 | 73% | 15 |
| child_in_danger | peril | 55 | 13 | 8% | 31% 31% 27% 13% | 77% 81% 85% 100% | 24% | 3.6 | 0.782 | 0.2/0.1 | 40 | 2 | 0 | 0% | 73% | 0/15 | 0% | 1 |
| creature_threat | peril | 55 | 7 | 4% | 33% 29% 16% 13% | 69% 69% 86% 100% | 24% | 3.647 | 0.757 | 0.25/0.07 | 46 | 9 | 0 | 51% | 73% | 7/9 | 74% | 19 |
| falls | peril | 55 | 1 | 1% | 9% 6% 6% 6% | 100% 100% 100% 100% | 24% | 4.255 | 0.821 | 0.09/0.04 | 52 | 2 | 3 | 27% | 73% | 3/3 | 100% | 7 |
| nearly_falls | peril | 55 | 0 | 0% | 4% 4% 0% 0% | 100% 100% - - | 24% | - | 0.796 | 0.08/0.04 | 55 | 2 | 0 | 27% | 73% | 0/0 | 100% | 7 |
| vehicle_accident | peril | 55 | 1 | 1% | 4% 4% 4% 0% | 100% 100% 100% - | 24% | 4.255 | 0.67 | 0.05/0.03 | 53 | 0 | 2 | 0% | 73% | 0/2 | - | 0 |
| battle | violence | 69 | 8 | 5% | 26% 26% 19% 17% | 83% 91% 100% 100% | 30% | 3.39 | 0.776 | 0.12/0.04 | 56 | 5 | 13 | 6% | 23% | 4/13 | 100% | 2 |
| weapon_used | violence | 69 | 4 | 2% | 19% 19% 13% 12% | 80% 80% 75% 67% | 30% | 2.542 | 0.823 | 0.15/0.05 | 60 | 4 | 9 | 17% | 23% | 5/9 | 86% | 7 |
| believed_dead | death | 38 | 2 | 1% | 42% 29% 13% 13% | 88% 100% 100% 100% | 18% | 5.525 | 0.717 | 0.17/0.07 | 33 | 11 | 3 | 11% | 42% | 3/5 | 50% | 4 |
| dies | death | 38 | 3 | 2% | 18% 18% 18% 13% | 100% 100% 100% 100% | 18% | 5.525 | 0.74 | 0.12/0.06 | 31 | 0 | 4 | 34% | 42% | 4/7 | 80% | 5 |
| grieving | death | 38 | 8 | 5% | 24% 11% 11% 5% | 24% 18% 25% 25% | 18% | 1.381 | 0.651 | 0.13/0.04 | 34 | 5 | 0 | 26% | 42% | 0/4 | 80% | 5 |
| loved_one_dies | death | 38 | 1 | 1% | 21% 5% 5% 5% | 75% 100% 100% 100% | 18% | 5.525 | 0.691 | 0.13/0.08 | 36 | 6 | 0 | 34% | 42% | 0/2 | 80% | 5 |
| parent_death_learned | death | 38 | 0 | 0% | 0% 0% 0% 0% | - - - - | 18% | - | 0.615 | 0.07/0.05 | 38 | 0 | 0 | 0% | 42% | 0/0 | - | 0 |
| pet_dies | death | 38 | 0 | 0% | 0% 0% 0% 0% | - - - - | 18% | - | 0.591 | 0.05/0.05 | 38 | 0 | 0 | 34% | 42% | 0/0 | 80% | 5 |
| abandoned | separation | 11 | 10 | 6% | 9% 9% 9% 9% | 5% 6% 10% 25% | 7% | 1.515 | 0.678 | 0.34/0.15 | 10 | 0 | 1 | 9% | 18% | 1/1 | 100% | 1 |
| child_separated | separation | 11 | 0 | 0% | 18% 18% 0% 0% | 50% 100% - - | 7% | - | 0.813 | 0.15/0.06 | 11 | 2 | 0 | 0% | 18% | 0/0 | 0% | 1 |
| child_taken | separation | 11 | 1 | 1% | 9% 9% 9% 9% | 100% 100% 100% 100% | 7% | 15.152 | 0.689 | 0.17/0.11 | 10 | 0 | 1 | 9% | 18% | 1/1 | 33% | 3 |
| family_in_danger | separation | 11 | 2 | 1% | 9% 9% 9% 9% | 13% 25% 50% 50% | 7% | 7.576 | 0.73 | 0.1/0.06 | 10 | 0 | 0 | 9% | 18% | 0/1 | 100% | 1 |
| parent_searching | separation | 11 | 1 | 1% | 36% 18% 18% 18% | 50% 50% 100% 100% | 7% | 15.152 | 0.798 | 0.1/0.04 | 9 | 2 | 1 | 0% | 18% | 0/2 | 0% | 1 |
| parents_argue | separation | 11 | 0 | 0% | 0% 0% 0% 0% | 0% - - - | 7% | - | 0.784 | 0.04/0.02 | 11 | 0 | 0 | 0% | 18% | 0/0 | - | 0 |
| badly_hurt | injury | 20 | 6 | 4% | 40% 40% 40% 40% | 33% 29% 33% 40% | 10% | 3.469 | 0.839 | 0.16/0.05 | 12 | 0 | 0 | 30% | 30% | 6/8 | 50% | 2 |
| injured | injury | 20 | 8 | 5% | 55% 50% 40% 40% | 31% 30% 25% 33% | 10% | 2.604 | 0.807 | 0.3/0.09 | 12 | 3 | 0 | 30% | 30% | 6/8 | 50% | 2 |
| captured | captivity | 22 | 10 | 6% | 55% 41% 32% 18% | 47% 46% 50% 38% | 11% | 4.386 | 0.817 | 0.37/0.09 | 15 | 5 | 5 | 55% | 55% | 7/7 | 80% | 10 |
| swallowed | captivity | 22 | 1 | 1% | 0% 0% 0% 0% | 0% 0% 0% - | 11% | 0 | 0.427 | 0.03/0.04 | 22 | 0 | 0 | 18% | 55% | 0/0 | 100% | 2 |
| trapped | captivity | 22 | 4 | 2% | 23% 18% 18% 18% | 36% 50% 50% 50% | 11% | 4.386 | 0.704 | 0.22/0.12 | 18 | 1 | 2 | 18% | 55% | 2/4 | 100% | 2 |
| appears_suddenly | eerie | 24 | 10 | 6% | 25% 13% 13% 8% | 18% 18% 30% 33% | 12% | 2.5 | 0.683 | 0.36/0.24 | 21 | 3 | 0 | 13% | 38% | 2/3 | 43% | 7 |
| jump_scare | eerie | 24 | 10 | 6% | 25% 13% 13% 8% | 19% 20% 30% 33% | 12% | 2.5 | 0.693 | 0.36/0.23 | 21 | 3 | 0 | 13% | 38% | 2/3 | 43% | 7 |
| nightmare | eerie | 24 | 0 | 0% | 0% 0% 0% 0% | - - - - | 12% | - | 0.578 | 0.04/0.03 | 24 | 0 | 0 | 0% | 38% | 0/0 | - | 0 |
| possessed | eerie | 24 | 4 | 2% | 8% 8% 0% 0% | 11% 13% 0% 0% | 12% | 0 | 0.484 | 0.1/0.1 | 24 | 2 | 0 | 25% | 38% | 0/0 | 75% | 4 |
| startled | eerie | 24 | 41 | 25% | 96% 96% 50% 29% | 21% 26% 24% 35% | 12% | 2.033 | 0.765 | 0.69/0.44 | 12 | 11 | 7 | 13% | 38% | 3/12 | 43% | 7 |
| transforms | eerie | 24 | 0 | 0% | 13% 0% 0% 0% | 50% - - - | 12% | - | 0.625 | 0.08/0.07 | 24 | 3 | 0 | 25% | 38% | 0/0 | 75% | 4 |
| unseen_threat | eerie | 24 | 14 | 8% | 33% 21% 21% 8% | 23% 17% 29% 33% | 12% | 2.383 | 0.725 | 0.4/0.17 | 19 | 3 | 1 | 4% | 38% | 0/5 | 100% | 1 |
| betrayal | hostility | 30 | 10 | 6% | 40% 30% 23% 13% | 37% 39% 50% 67% | 16% | 3.067 | 0.724 | 0.36/0.14 | 23 | 5 | 1 | 3% | 30% | 0/7 | 25% | 4 |
| caregiver_cruelty | hostility | 30 | 11 | 7% | 30% 27% 20% 10% | 33% 35% 36% 50% | 16% | 2.233 | 0.717 | 0.27/0.07 | 24 | 3 | 0 | 10% | 30% | 2/6 | 75% | 4 |
| discrimination | hostility | 30 | 2 | 1% | 0% 0% 0% 0% | 0% 0% 0% - | 16% | 0 | 0.61 | 0.07/0.06 | 30 | 0 | 0 | 0% | 30% | 0/0 | - | 0 |
| excluded | hostility | 30 | 11 | 7% | 23% 17% 7% 7% | 25% 21% 18% 50% | 16% | 1.117 | 0.713 | 0.33/0.19 | 28 | 5 | 1 | 0% | 30% | 0/2 | - | 0 |
| mocked | hostility | 30 | 13 | 8% | 57% 47% 27% 13% | 46% 46% 46% 50% | 16% | 2.834 | 0.743 | 0.52/0.2 | 22 | 9 | 2 | 0% | 30% | 0/8 | - | 0 |
| plots_harm | hostility | 30 | 7 | 4% | 20% 20% 17% 13% | 33% 56% 57% 60% | 16% | 3.503 | 0.661 | 0.13/0.07 | 25 | 1 | 0 | 13% | 30% | 1/5 | 50% | 8 |
| rages_at_child | hostility | 30 | 8 | 5% | 33% 30% 23% 13% | 44% 54% 63% 50% | 16% | 3.834 | 0.744 | 0.33/0.09 | 23 | 3 | 1 | 17% | 30% | 4/7 | 75% | 4 |
| threatens_harm | hostility | 30 | 5 | 3% | 17% 17% 17% 17% | 36% 44% 80% 80% | 16% | 4.908 | 0.688 | 0.15/0.08 | 25 | 0 | 0 | 13% | 30% | 1/5 | 50% | 8 |
| afraid_for_safety | distress | 17 | 42 | 25% | 59% 47% 47% 18% | 13% 14% 17% 13% | 11% | 1.546 | 0.62 | 0.43/0.34 | 9 | 2 | 3 | 41% | 59% | 6/8 | 33% | 12 |
| child_frightened | distress | 17 | 8 | 5% | 18% 18% 12% 0% | 11% 18% 13% 0% | 11% | 1.157 | 0.587 | 0.11/0.08 | 15 | 1 | 0 | 41% | 59% | 2/2 | 33% | 12 |
| crying | distress | 17 | 8 | 5% | 18% 12% 12% 12% | 25% 20% 25% 25% | 11% | 2.315 | 0.578 | 0.08/0.07 | 15 | 1 | 0 | 29% | 59% | 1/2 | 40% | 10 |
| despair | distress | 17 | 3 | 2% | 35% 29% 6% 6% | 42% 50% 33% 100% | 11% | 3.083 | 0.752 | 0.4/0.14 | 16 | 5 | 0 | 29% | 59% | 1/1 | 40% | 10 |
| screams | distress | 17 | 36 | 22% | 47% 41% 35% 24% | 14% 13% 14% 15% | 11% | 1.287 | 0.571 | 0.33/0.25 | 11 | 2 | 1 | 41% | 59% | 4/6 | 33% | 12 |
| animal_cruelty | animals | 16 | 1 | 1% | 0% 0% 0% 0% | 0% 0% 0% - | 10% | 0 | 0.629 | 0.05/0.04 | 16 | 0 | 0 | 0% | 0% | 0/0 | - | 0 |
| animal_in_danger | animals | 16 | 6 | 4% | 31% 13% 0% 0% | 13% 15% 0% 0% | 10% | 0 | 0.633 | 0.29/0.16 | 16 | 5 | 0 | 0% | 0% | 0/0 | - | 0 |
| comic_peril | copyable | 9 | 1 | 1% | 67% 22% 0% 0% | 17% 20% 0% - | 5% | 0 | 0.801 | 0.46/0.21 | 9 | 6 | 0 | 0% | 11% | 0/0 | 0% | 1 |
| dangerous_act | copyable | 9 | 9 | 5% | 22% 22% 22% 0% | 9% 14% 22% 0% | 5% | 4.625 | 0.635 | 0.16/0.12 | 7 | 0 | 2 | 11% | 11% | 1/2 | 100% | 1 |
| goes_with_stranger | copyable | 9 | 2 | 1% | 0% 0% 0% 0% | 0% 0% 0% 0% | 5% | 0 | 0.574 | 0.09/0.09 | 9 | 0 | 0 | 0% | 11% | 0/0 | 0% | 1 |
| runs_away | copyable | 9 | 2 | 1% | 11% 11% 0% 0% | 14% 25% 0% 0% | 5% | 0 | 0.683 | 0.12/0.09 | 9 | 1 | 0 | 0% | 11% | 0/0 | 0% | 1 |
| slapstick | copyable | 9 | 9 | 5% | 67% 56% 44% 33% | 17% 18% 22% 17% | 5% | 4.625 | 0.781 | 0.31/0.11 | 5 | 2 | 4 | 0% | 11% | 0/4 | 0% | 1 |
| film:child_in_danger | per film item | 55 | 17 | 10% | 36% 29% 29% 24% | 47% 65% 71% 82% | 24% | 3.004 | 0.735 | 0.36/0.17 | 39 | 4 | 1 | 0% | 73% | 0/16 | 0% | 1 |
| film:danger | per film item | 110 | 21 | 13% | 32% 22% 17% 6% | 54% 53% 52% 33% | 43% | 1.224 | 0.595 | 0.34/0.3 | 91 | 16 | 7 | 17% | 54% | 6/19 | 91% | 11 |
| film:presence | per film item | 42 | 108 | 65% | 69% 69% 64% 62% | 22% 23% 21% 23% | 24% | 0.884 | 0.681 | 0.95/0.8 | 15 | 2 | 0 | - | 41% | - | - | - |
| film:threatens | per film item | 30 | 9 | 5% | 10% 10% 7% 7% | 19% 20% 22% 25% | 16% | 1.362 | 0.609 | 0.08/0.07 | 28 | 1 | 0 | 13% | 30% | 1/2 | 50% | 8 |

### DTDD topics, specific tag mapping, by kind (topic first category)

| kind | topics | crowd yes | Jev agree | Jev tp/tn/fp/fn | live agree | live tp/tn/fp/fn | Jev=live |
|---|---|---|---|---|---|---|---|
| captivity | 3 | 2 | 2/3 | 2/0/1/0 | 2/3 | 2/0/1/0 | 3/3 |
| creatures_figures | 20 | 1 | 15/20 | 1/14/5/0 | 17/20 | 0/17/2/1 | 16/20 |
| death | 18 | 9 | 12/18 | 7/5/4/2 | 9/18 | 6/3/6/3 | 11/18 |
| distress | 6 | 4 | 4/6 | 4/0/2/0 | 4/6 | 4/0/2/0 | 6/6 |
| eerie | 3 | 1 | 1/3 | 1/0/2/0 | 1/3 | 1/0/2/0 | 3/3 |
| injury | 6 | 1 | 5/6 | 1/4/1/0 | 5/6 | 1/4/1/0 | 6/6 |
| objects_hazards | 6 | 2 | 5/6 | 2/3/1/0 | 6/6 | 2/4/0/0 | 5/6 |
| peril | 3 | 0 | 1/3 | 0/1/2/0 | 2/3 | 0/2/1/0 | 2/3 |
| separation | 6 | 4 | 6/6 | 4/2/0/0 | 4/6 | 2/2/0/2 | 4/6 |
| violence | 3 | 0 | 2/3 | 0/2/1/0 | 1/3 | 0/1/2/0 | 2/3 |
| ALL | 74 | 24 | 53/74 | 22/31/19/2 | 51/74 | 18/33/17/6 | 58/74 |

### DTDD specific topics by target tag ids

| target ids | topics | crowd yes | Jev agree | Jev fp/fn | live agree | live fp/fn |
|---|---|---|---|---|---|---|
| abandoned | 3 | 3 | 3/3 | 0/0 | 1/3 | 0/2 |
| dies|pet_dies | 3 | 1 | 1/3 | 2/0 | 0/3 | 2/1 |
| pet_dies | 3 | 0 | 3/3 | 0/0 | 1/3 | 2/0 |
| spider_insect | 6 | 0 | 4/6 | 2/0 | 6/6 | 0/0 |
| snake_reptile | 2 | 0 | 1/2 | 1/0 | 2/2 | 0/0 |
| shark | 3 | 0 | 3/3 | 0/0 | 3/3 | 0/0 |
| child_taken | 3 | 1 | 3/3 | 0/0 | 3/3 | 0/0 |
| crying|child_frightened | 3 | 1 | 1/3 | 2/0 | 1/3 | 2/0 |
| dies | 6 | 4 | 4/6 | 2/0 | 2/6 | 2/2 |
| parent_death_learned|loved_one_dies | 6 | 4 | 4/6 | 0/2 | 6/6 | 0/0 |
| child_taken|captured | 3 | 2 | 2/3 | 1/0 | 2/3 | 1/0 |
| jump_scare|appears_suddenly | 3 | 1 | 1/3 | 2/0 | 1/3 | 2/0 |
| trapped|swallowed | 3 | 2 | 2/3 | 1/0 | 3/3 | 0/0 |
| possessed | 3 | 0 | 1/3 | 2/0 | 1/3 | 2/0 |
| clown | 3 | 0 | 3/3 | 0/0 | 3/3 | 0/0 |
| ghost_spirit | 3 | 1 | 3/3 | 0/0 | 2/3 | 0/1 |
| needle_medical | 3 | 0 | 3/3 | 0/0 | 3/3 | 0/0 |
| medical_care | 3 | 0 | 3/3 | 0/0 | 3/3 | 0/0 |
| cannot_breathe | 3 | 0 | 1/3 | 2/0 | 2/3 | 1/0 |
| screams | 3 | 3 | 3/3 | 0/0 | 3/3 | 0/0 |
| blood_wound | 3 | 1 | 2/3 | 1/0 | 2/3 | 1/0 |
| gun|weapon_used | 3 | 0 | 2/3 | 1/0 | 1/3 | 2/0 |

### DTDD coarse group fallback (topics with no specific mapping), by kind

| kind | topics | crowd yes | Jev agree | Jev fp/fn | live agree | live fp/fn |
|---|---|---|---|---|---|---|
| animals | 18 | 6 | 6/18 | 12/0 | 7/18 | 11/0 |
| captivity | 12 | 6 | 6/12 | 6/0 | 6/12 | 6/0 |
| creatures_figures | 12 | 1 | 1/12 | 11/0 | 1/12 | 11/0 |
| death | 63 | 8 | 8/63 | 55/0 | 8/63 | 55/0 |
| distress | 21 | 2 | 2/21 | 19/0 | 2/21 | 19/0 |
| eerie | 15 | 3 | 3/15 | 12/0 | 3/15 | 12/0 |
| hostility | 47 | 12 | 12/47 | 35/0 | 12/47 | 35/0 |
| injury | 83 | 10 | 10/83 | 73/0 | 32/83 | 48/3 |
| objects_hazards | 21 | 8 | 8/21 | 13/0 | 8/21 | 13/0 |
| peril | 36 | 7 | 7/36 | 29/0 | 7/36 | 29/0 |
| separation | 3 | 3 | 3/3 | 0/0 | 3/3 | 0/0 |
| violence | 30 | 3 | 3/30 | 27/0 | 3/30 | 27/0 |
| ALL | 361 | 69 | 69/361 | 292/0 | 92/361 | 266/3 |

### codex-rules items (model-written; NOT in the human score)

| marker | items | Jev any tag in item group | live any label in item group | Jev rule question fired |
|---|---|---|---|---|
| child_terrified | 26 | 22 | 12 | 9 |
| villain_threat | 7 | 7 | 6 | 6 |

## DEV (7 films; up has no live baseline)

### Group recall / precision proxy (Jev act tags vs live labels)

| group | items | Jev recall | live recall | Jev recall sf | live recall sf | Jev tagged scenes | Jev prec | Jev base | Jev lift | live tagged scenes | live prec | live base | live lift | Jev film share | live film share | Jev min-prec | live min-prec |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| creatures_figures | 46 | 96% | 73% | 98% | 74% | 226 | 16% | 10% | 1.49 | 71 | 24% | 18% | 1.366 | 51% | 30% | 8% | 10% |
| objects_hazards | 81 | 58% | 74% | 65% | 81% | 89 | 37% | 18% | 2.038 | 75 | 45% | 33% | 1.373 | 24% | 31% | 22% | 19% |
| peril | 136 | 76% | 72% | 78% | 77% | 100 | 60% | 27% | 2.214 | 58 | 64% | 43% | 1.494 | 25% | 26% | 34% | 30% |
| violence | 78 | 22% | 18% | 24% | 20% | 15 | 60% | 14% | 4.167 | 6 | 83% | 30% | 2.767 | 4% | 5% | 25% | 24% |
| death | 56 | 30% | 40% | 37% | 54% | 40 | 23% | 9% | 2.394 | 22 | 46% | 20% | 2.23 | 11% | 8% | 17% | 28% |
| separation | 13 | 54% | 46% | 70% | 50% | 35 | 11% | 2% | 4.75 | 19 | 21% | 7% | 3.103 | 9% | 5% | 6% | 11% |
| injury | 40 | 33% | 17% | 53% | 31% | 21 | 38% | 8% | 4.59 | 7 | 43% | 16% | 2.768 | 5% | 2% | 18% | 38% |
| captivity | 26 | 42% | 35% | 41% | 42% | 30 | 30% | 7% | 4.11 | 12 | 42% | 13% | 3.31 | 8% | 5% | 17% | 18% |
| eerie | 33 | 76% | 48% | 78% | 44% | 144 | 13% | 8% | 1.692 | 30 | 20% | 15% | 1.37 | 37% | 12% | 8% | 12% |
| hostility | 30 | 67% | 48% | 75% | 67% | 100 | 17% | 7% | 2.576 | 26 | 23% | 11% | 2.159 | 25% | 10% | 5% | 6% |
| distress | 41 | 83% | 54% | 96% | 57% | 201 | 16% | 10% | 1.529 | 72 | 22% | 18% | 1.269 | 49% | 27% | 5% | 8% |
| animals | 198 | 23% | 6% | 26% | 7% | 23 | 96% | 31% | 3.117 | 7 | 71% | 49% | 1.472 | 6% | 2% | 53% | 51% |
| copyable | 28 | 43% | 11% | 54% | 15% | 52 | 19% | 6% | 3.254 | 8 | 25% | 11% | 2.336 | 14% | 4% | 8% | 4% |
| ALL | 806 | 49% | 39% | 55% | 46% | 1076 | 25% | - | - | 413 | 36% | - | - | - | - | - | - |

sf = should_flag === true items only. Live recall on the dev films excludes up (no live baseline); Jev pooled includes it.

### Per film, ALL groups (micro)

| film | items | Jev recall | live recall | Jev prec | live prec |
|---|---|---|---|---|---|
| nemo | 207 | 41% | 38% | 39% | 44% |
| monsters-inc | 48 | 69% | 15% | 14% | 10% |
| lion-king | 72 | 44% | 46% | 13% | 29% |
| frankenweenie | 184 | 60% | 44% | 49% | 68% |
| wild-robot | 173 | 42% | 38% | 22% | 41% |
| iron-giant | 23 | 61% | 56% | 11% | 22% |
| up | 99 | 49% | - | 28% | - |

### Jev group threshold sweep (recall / precision proxy / tagged scenes)

| group | @0.5 | @0.6 | @0.7 | @0.8 |
|---|---|---|---|---|
| creatures_figures | 96% / 14% / 284 | 96% / 15% / 254 | 96% / 16% / 226 | 85% / 15% / 197 |
| objects_hazards | 69% / 28% / 156 | 64% / 32% / 118 | 58% / 37% / 89 | 48% / 42% / 65 |
| peril | 94% / 48% / 182 | 85% / 54% / 131 | 76% / 60% / 100 | 51% / 59% / 63 |
| violence | 44% / 50% / 38 | 35% / 56% / 27 | 22% / 60% / 15 | 15% / 67% / 9 |
| death | 41% / 21% / 75 | 39% / 25% / 56 | 30% / 23% / 40 | 18% / 27% / 22 |
| separation | 62% / 6% / 80 | 54% / 7% / 58 | 54% / 11% / 35 | 15% / 9% / 22 |
| injury | 53% / 35% / 40 | 35% / 35% / 29 | 33% / 38% / 21 | 20% / 42% / 12 |
| captivity | 73% / 29% / 55 | 65% / 35% / 43 | 42% / 30% / 30 | 35% / 37% / 19 |
| eerie | 91% / 10% / 252 | 91% / 12% / 196 | 76% / 13% / 144 | 61% / 16% / 77 |
| hostility | 77% / 12% / 166 | 70% / 15% / 123 | 67% / 17% / 100 | 50% / 17% / 71 |
| distress | 98% / 15% / 260 | 85% / 14% / 230 | 83% / 16% / 201 | 73% / 17% / 169 |
| animals | 58% / 67% / 88 | 37% / 80% / 49 | 23% / 96% / 23 | 15% / 100% / 14 |
| copyable | 50% / 9% / 132 | 43% / 11% / 88 | 43% / 19% / 52 | 21% / 13% / 23 |
| ALL | 69% / 22% / 1808 | 58% / 24% / 1402 | 49% / 25% / 1076 | 36% / 25% / 763 |

### Question overview (film:presence and animal_creature excluded)

| questions | fired_at_0_7 | never_fired_at_0_7 | fired_with_lift_gt_1 | fired_with_precision_ge_0_5 | auc_questions_with_ge_5_positive_scenes | auc_median | auc_ge_0_7 | auc_ge_0_8 | auc_lt_0_6 |
|---|---|---|---|---|---|---|---|---|---|
| 93 | 87 | 6 | 74 | 31 | 93 | 0.672 | 32 | 8 | 15 |

### Per question (Jev) with live comparison

rec/prec at 0.5, 0.6, 0.7, 0.8; fires = scenes (film items: scene x item) where the question fires; AUC = scenes overlapping a group item vs the rest; missed 0.5-0.7 = key items missed at 0.7 whose best p is in [0.5, 0.7); live v3 = live label with the same v3 id.

| question | group | items | fires@.7 | rate@.7 | rec .5/.6/.7/.8 | prec .5/.6/.7/.8 | base | lift@.7 | AUC | p50 pos/neg | missed | missed 0.5-0.7 | unique@.7 | live v3 rec | live grp rec | Jev-caught also live v3 | live v3 prec | live v3 fires |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| alien | creatures_figures | 46 | 0 | 0% | 0% 0% 0% 0% | 0% - - - | 10% | - | 0.469 | 0.02/0.02 | 46 | 0 | 0 | 0% | 72% | 0/0 | - | 0 |
| animal_creature | creatures_figures | 46 | 1 | 0% | 15% 4% 4% 4% | 100% 100% 100% 100% | 10% | 9.615 | 0.567 | 0/0 | 44 | 5 | 0 | - | 72% | - | - | - |
| clown | creatures_figures | 46 | 1 | 0% | 7% 7% 4% 0% | 33% 50% 100% - | 10% | 9.615 | 0.686 | 0.04/0.02 | 44 | 1 | 2 | 0% | 72% | 0/2 | - | 0 |
| dark_magic | creatures_figures | 46 | 4 | 1% | 26% 26% 26% 26% | 67% 75% 75% 100% | 10% | 7.212 | 0.684 | 0.07/0.03 | 34 | 0 | 0 | 15% | 72% | 7/12 | 100% | 1 |
| dead_body | creatures_figures | 46 | 14 | 3% | 30% 26% 26% 9% | 28% 32% 43% 13% | 10% | 4.125 | 0.725 | 0.12/0.04 | 34 | 2 | 1 | 22% | 72% | 8/12 | 60% | 5 |
| doll_puppet | creatures_figures | 46 | 2 | 1% | 4% 0% 0% 0% | 11% 0% 0% 0% | 10% | 0 | 0.615 | 0.04/0.03 | 46 | 2 | 0 | 0% | 72% | 0/0 | - | 0 |
| ghost_spirit | creatures_figures | 46 | 2 | 1% | 2% 2% 2% 2% | 67% 67% 50% 100% | 10% | 4.808 | 0.653 | 0.04/0.02 | 45 | 0 | 1 | 2% | 72% | 1/1 | 100% | 1 |
| large_predator | creatures_figures | 46 | 30 | 7% | 46% 46% 20% 15% | 20% 25% 17% 17% | 10% | 1.606 | 0.619 | 0.15/0.07 | 37 | 12 | 2 | 11% | 72% | 4/9 | 20% | 15 |
| mask | creatures_figures | 46 | 4 | 1% | 11% 11% 11% 9% | 67% 80% 100% 100% | 10% | 9.615 | 0.583 | 0.02/0.02 | 41 | 0 | 0 | 0% | 72% | 0/5 | - | 0 |
| monster_creature | creatures_figures | 46 | 79 | 19% | 63% 52% 50% 48% | 21% 20% 18% 18% | 10% | 1.702 | 0.659 | 0.2/0.06 | 23 | 6 | 7 | 46% | 72% | 19/23 | 32% | 22 |
| reanimated_dead | creatures_figures | 46 | 30 | 7% | 46% 46% 39% 30% | 29% 31% 33% 39% | 10% | 3.202 | 0.656 | 0.07/0.03 | 28 | 3 | 1 | 39% | 72% | 15/18 | 63% | 8 |
| robot_machine_being | creatures_figures | 46 | 90 | 21% | 41% 26% 11% 7% | 9% 7% 6% 5% | 10% | 0.538 | 0.506 | 0.17/0.15 | 41 | 14 | 2 | 2% | 72% | 1/5 | 4% | 23 |
| rodent_bat | creatures_figures | 46 | 5 | 1% | 13% 13% 13% 9% | 40% 40% 40% 33% | 10% | 3.846 | 0.635 | 0.04/0.03 | 40 | 0 | 0 | 15% | 72% | 4/6 | 50% | 2 |
| scary_appearance | creatures_figures | 46 | 16 | 4% | 56% 41% 28% 20% | 36% 42% 38% 31% | 10% | 3.606 | 0.696 | 0.27/0.1 | 33 | 13 | 0 | 24% | 72% | 2/13 | 14% | 14 |
| shark | creatures_figures | 46 | 6 | 1% | 9% 7% 7% 7% | 56% 67% 67% 67% | 10% | 6.413 | 0.593 | 0.02/0.01 | 43 | 1 | 1 | 4% | 72% | 2/3 | 50% | 4 |
| skeleton_bones | creatures_figures | 46 | 1 | 0% | 4% 4% 2% 0% | 100% 100% 100% - | 10% | 9.615 | 0.724 | 0.03/0.02 | 45 | 1 | 1 | 22% | 72% | 0/1 | 60% | 5 |
| snake_reptile | creatures_figures | 46 | 3 | 1% | 0% 0% 0% 0% | 0% 0% 0% 0% | 10% | 0 | 0.582 | 0.02/0.02 | 46 | 0 | 0 | 0% | 72% | 0/0 | - | 0 |
| spider_insect | creatures_figures | 46 | 5 | 1% | 0% 0% 0% 0% | 0% 0% 0% 0% | 10% | 0 | 0.593 | 0.03/0.02 | 46 | 0 | 0 | 4% | 72% | 0/0 | 100% | 1 |
| witch_sorcerer | creatures_figures | 46 | 0 | 0% | 0% 0% 0% 0% | - - - - | 10% | - | 0.623 | 0.02/0.01 | 46 | 0 | 0 | 15% | 72% | 0/0 | 100% | 1 |
| blade_weapon | objects_hazards | 81 | 2 | 1% | 0% 0% 0% 0% | 0% 0% 0% 0% | 18% | 0 | 0.602 | 0.02/0.02 | 81 | 0 | 0 | 0% | 63% | 0/0 | - | 0 |
| blood_wound | objects_hazards | 81 | 1 | 0% | 1% 1% 1% 1% | 100% 100% 100% 100% | 18% | 5.495 | 0.608 | 0.02/0.02 | 80 | 0 | 0 | 1% | 63% | 1/1 | 67% | 3 |
| cage_net_trap | objects_hazards | 81 | 5 | 1% | 10% 5% 4% 3% | 64% 57% 60% 50% | 18% | 3.297 | 0.699 | 0.05/0.03 | 78 | 5 | 1 | 6% | 63% | 1/3 | 67% | 6 |
| dangerous_machine | objects_hazards | 81 | 21 | 5% | 30% 26% 25% 21% | 48% 54% 57% 71% | 18% | 3.137 | 0.683 | 0.07/0.03 | 61 | 4 | 13 | 12% | 63% | 9/20 | 70% | 10 |
| darkness | objects_hazards | 81 | 8 | 2% | 1% 1% 1% 0% | 8% 10% 13% 0% | 18% | 0.687 | 0.632 | 0.08/0.06 | 80 | 0 | 0 | 48% | 63% | 1/1 | 50% | 46 |
| deep_dark_water | objects_hazards | 81 | 6 | 1% | 10% 5% 3% 0% | 29% 23% 17% 0% | 18% | 0.918 | 0.596 | 0.03/0.02 | 79 | 6 | 0 | 5% | 63% | 2/2 | 50% | 6 |
| explosion | objects_hazards | 81 | 4 | 1% | 6% 6% 3% 3% | 33% 33% 25% 25% | 18% | 1.374 | 0.719 | 0.03/0.02 | 79 | 3 | 2 | 5% | 63% | 2/2 | 50% | 6 |
| fire | objects_hazards | 81 | 4 | 1% | 10% 7% 6% 6% | 63% 60% 50% 67% | 18% | 2.747 | 0.666 | 0.02/0.02 | 76 | 3 | 2 | 11% | 63% | 5/5 | 67% | 6 |
| graveyard_funeral | objects_hazards | 81 | 2 | 1% | 3% 3% 3% 3% | 25% 33% 50% 50% | 18% | 2.747 | 0.535 | 0.01/0.01 | 79 | 0 | 0 | 11% | 63% | 2/2 | 100% | 4 |
| gun | objects_hazards | 81 | 5 | 1% | 4% 4% 3% 1% | 33% 43% 40% 25% | 18% | 2.198 | 0.602 | 0.02/0.02 | 79 | 1 | 2 | 4% | 63% | 1/2 | 60% | 5 |
| heights | objects_hazards | 81 | 15 | 4% | 10% 9% 9% 5% | 21% 21% 27% 33% | 18% | 1.467 | 0.632 | 0.05/0.03 | 74 | 1 | 2 | 9% | 63% | 4/7 | 50% | 10 |
| medical_care | objects_hazards | 81 | 5 | 1% | 3% 3% 3% 1% | 29% 33% 40% 33% | 18% | 2.198 | 0.637 | 0.02/0.02 | 79 | 0 | 2 | 4% | 63% | 2/2 | 67% | 3 |
| needle_medical | objects_hazards | 81 | 1 | 0% | 0% 0% 0% 0% | 0% 0% 0% 0% | 18% | 0 | 0.607 | 0.02/0.02 | 81 | 0 | 0 | 0% | 63% | 0/0 | 0% | 1 |
| restraints | objects_hazards | 81 | 0 | 0% | 0% 0% 0% 0% | 0% 0% - - | 18% | - | 0.68 | 0.03/0.02 | 81 | 0 | 0 | 6% | 63% | 0/0 | 67% | 6 |
| seriously_ill | objects_hazards | 81 | 9 | 2% | 9% 5% 4% 4% | 23% 21% 22% 29% | 18% | 1.22 | 0.64 | 0.09/0.05 | 78 | 4 | 3 | 4% | 63% | 0/3 | 67% | 3 |
| storm | objects_hazards | 81 | 18 | 4% | 14% 12% 12% 11% | 35% 33% 39% 38% | 18% | 2.137 | 0.653 | 0.03/0.02 | 71 | 1 | 6 | 21% | 63% | 7/10 | 73% | 15 |
| vehicle_crash | objects_hazards | 81 | 3 | 1% | 5% 4% 3% 0% | 30% 33% 33% 0% | 18% | 1.83 | 0.692 | 0.04/0.02 | 79 | 2 | 0 | 6% | 63% | 0/2 | 75% | 8 |
| attacked | peril | 136 | 8 | 2% | 21% 15% 6% 4% | 59% 67% 50% 50% | 27% | 1.845 | 0.712 | 0.15/0.07 | 128 | 21 | 0 | 29% | 61% | 7/8 | 70% | 23 |
| cannot_breathe | peril | 136 | 5 | 1% | 8% 6% 6% 4% | 88% 100% 100% 100% | 27% | 3.69 | 0.731 | 0.07/0.04 | 128 | 3 | 0 | 1% | 61% | 1/8 | 100% | 1 |
| caught_in_hazard | peril | 136 | 21 | 5% | 42% 31% 25% 15% | 78% 76% 76% 73% | 27% | 2.812 | 0.781 | 0.27/0.07 | 102 | 23 | 11 | 43% | 61% | 21/34 | 77% | 31 |
| chased | peril | 136 | 34 | 8% | 45% 33% 31% 26% | 63% 67% 65% 71% | 27% | 2.387 | 0.744 | 0.28/0.11 | 94 | 19 | 5 | 32% | 61% | 23/42 | 77% | 22 |
| child_in_danger | peril | 136 | 32 | 8% | 46% 36% 27% 18% | 58% 58% 63% 86% | 27% | 2.306 | 0.744 | 0.27/0.13 | 100 | 26 | 0 | 8% | 61% | 7/36 | 55% | 11 |
| creature_threat | peril | 136 | 27 | 6% | 60% 46% 34% 27% | 74% 76% 82% 84% | 27% | 3.007 | 0.773 | 0.34/0.12 | 90 | 35 | 4 | 29% | 61% | 25/46 | 70% | 23 |
| falls | peril | 136 | 4 | 1% | 2% 2% 2% 2% | 40% 50% 50% 50% | 27% | 1.845 | 0.652 | 0.07/0.05 | 133 | 0 | 0 | 14% | 61% | 2/3 | 58% | 12 |
| nearly_falls | peril | 136 | 2 | 1% | 6% 6% 2% 2% | 57% 80% 50% 50% | 27% | 1.845 | 0.726 | 0.07/0.04 | 133 | 5 | 0 | 14% | 61% | 1/3 | 58% | 12 |
| vehicle_accident | peril | 136 | 0 | 0% | 2% 2% 0% 0% | 50% 50% - - | 27% | - | 0.532 | 0.04/0.04 | 136 | 2 | 0 | 3% | 61% | 0/0 | 75% | 4 |
| battle | violence | 78 | 7 | 2% | 35% 24% 18% 9% | 65% 67% 86% 100% | 14% | 5.951 | 0.786 | 0.16/0.05 | 64 | 13 | 12 | 13% | 15% | 6/14 | 100% | 2 |
| weapon_used | violence | 78 | 4 | 1% | 8% 8% 3% 3% | 43% 43% 50% 50% | 14% | 3.472 | 0.738 | 0.09/0.06 | 76 | 4 | 0 | 15% | 15% | 1/2 | 83% | 6 |
| believed_dead | death | 56 | 19 | 5% | 32% 30% 20% 4% | 27% 35% 32% 22% | 9% | 3.362 | 0.785 | 0.3/0.07 | 45 | 7 | 1 | 11% | 38% | 4/11 | 38% | 8 |
| dies | death | 56 | 5 | 1% | 20% 18% 11% 2% | 56% 67% 60% 50% | 9% | 6.383 | 0.829 | 0.15/0.06 | 50 | 5 | 2 | 27% | 38% | 6/6 | 55% | 11 |
| grieving | death | 56 | 23 | 5% | 34% 21% 18% 18% | 26% 24% 26% 40% | 9% | 2.777 | 0.718 | 0.16/0.05 | 46 | 9 | 1 | 16% | 38% | 4/10 | 42% | 12 |
| loved_one_dies | death | 56 | 7 | 2% | 20% 20% 20% 7% | 42% 40% 57% 50% | 9% | 6.074 | 0.767 | 0.23/0.09 | 45 | 0 | 0 | 27% | 38% | 11/11 | 55% | 11 |
| parent_death_learned | death | 56 | 4 | 1% | 14% 14% 13% 5% | 38% 60% 50% 50% | 9% | 5.319 | 0.619 | 0.06/0.05 | 49 | 1 | 0 | 13% | 38% | 7/7 | 100% | 1 |
| pet_dies | death | 56 | 1 | 0% | 4% 4% 2% 2% | 67% 67% 100% 100% | 9% | 10.638 | 0.84 | 0.13/0.06 | 55 | 1 | 0 | 27% | 38% | 1/1 | 55% | 11 |
| abandoned | separation | 13 | 14 | 3% | 15% 15% 15% 0% | 3% 5% 7% 0% | 2% | 2.958 | 0.633 | 0.22/0.15 | 11 | 0 | 2 | 0% | 46% | 0/2 | 0% | 5 |
| child_separated | separation | 13 | 4 | 1% | 39% 39% 23% 0% | 19% 18% 25% 0% | 2% | 10.417 | 0.646 | 0.09/0.09 | 10 | 2 | 3 | 0% | 46% | 0/3 | 0% | 3 |
| child_taken | separation | 13 | 5 | 1% | 15% 15% 8% 8% | 13% 22% 20% 33% | 2% | 8.333 | 0.846 | 0.3/0.12 | 12 | 1 | 0 | 15% | 46% | 1/1 | 33% | 3 |
| family_in_danger | separation | 13 | 7 | 2% | 39% 15% 15% 15% | 16% 10% 14% 14% | 2% | 5.958 | 0.775 | 0.31/0.05 | 11 | 3 | 0 | 46% | 46% | 2/2 | 36% | 11 |
| parent_searching | separation | 13 | 9 | 2% | 15% 15% 15% 15% | 8% 9% 22% 40% | 2% | 9.25 | 0.635 | 0.06/0.05 | 11 | 0 | 0 | 0% | 46% | 0/2 | 0% | 3 |
| parents_argue | separation | 13 | 0 | 0% | 0% 0% 0% 0% | - - - - | 2% | - | 0.648 | 0.02/0.02 | 13 | 0 | 0 | 0% | 46% | 0/0 | - | 0 |
| badly_hurt | injury | 40 | 7 | 2% | 20% 15% 5% 3% | 33% 36% 29% 25% | 8% | 3.446 | 0.811 | 0.2/0.06 | 38 | 6 | 0 | 13% | 13% | 1/2 | 43% | 7 |
| injured | injury | 40 | 17 | 4% | 50% 35% 33% 13% | 34% 36% 47% 50% | 8% | 5.675 | 0.847 | 0.4/0.11 | 27 | 7 | 8 | 13% | 13% | 4/13 | 43% | 7 |
| captured | captivity | 26 | 17 | 4% | 62% 50% 31% 23% | 36% 44% 35% 39% | 7% | 4.836 | 0.827 | 0.47/0.08 | 18 | 8 | 2 | 23% | 31% | 2/8 | 44% | 9 |
| swallowed | captivity | 26 | 3 | 1% | 15% 15% 12% 8% | 75% 75% 67% 100% | 7% | 9.137 | 0.743 | 0.09/0.05 | 23 | 1 | 1 | 12% | 31% | 0/3 | 50% | 4 |
| trapped | captivity | 26 | 17 | 4% | 27% 27% 27% 8% | 17% 24% 29% 29% | 7% | 4.027 | 0.781 | 0.31/0.1 | 19 | 0 | 1 | 12% | 31% | 1/7 | 50% | 4 |
| appears_suddenly | eerie | 33 | 29 | 7% | 67% 46% 33% 27% | 16% 17% 21% 30% | 8% | 2.654 | 0.67 | 0.5/0.29 | 22 | 11 | 0 | 39% | 42% | 8/11 | 20% | 25 |
| jump_scare | eerie | 33 | 28 | 7% | 67% 46% 30% 27% | 16% 17% 18% 30% | 8% | 2.295 | 0.675 | 0.5/0.28 | 23 | 12 | 0 | 39% | 42% | 8/10 | 20% | 25 |
| nightmare | eerie | 33 | 1 | 0% | 3% 3% 0% 0% | 50% 50% 0% 0% | 8% | 0 | 0.632 | 0.06/0.03 | 33 | 1 | 0 | 0% | 42% | 0/0 | - | 0 |
| possessed | eerie | 33 | 6 | 1% | 6% 0% 0% 0% | 9% 0% 0% 0% | 8% | 0 | 0.53 | 0.1/0.11 | 33 | 2 | 0 | 24% | 42% | 0/0 | 60% | 5 |
| startled | eerie | 33 | 120 | 28% | 88% 88% 76% 61% | 11% 13% 15% 19% | 8% | 1.923 | 0.7 | 0.71/0.52 | 8 | 4 | 8 | 39% | 42% | 12/25 | 20% | 25 |
| transforms | eerie | 33 | 3 | 1% | 27% 21% 15% 15% | 71% 60% 67% 100% | 8% | 8.551 | 0.694 | 0.13/0.08 | 28 | 4 | 0 | 24% | 42% | 5/5 | 60% | 5 |
| unseen_threat | eerie | 33 | 52 | 12% | 55% 46% 42% 27% | 12% 11% 15% 14% | 8% | 1.974 | 0.595 | 0.43/0.3 | 19 | 4 | 0 | 9% | 42% | 3/14 | 25% | 4 |
| betrayal | hostility | 30 | 6 | 1% | 7% 3% 0% 0% | 12% 11% 0% 0% | 7% | 0 | 0.626 | 0.15/0.1 | 30 | 2 | 0 | 3% | 33% | 0/0 | 14% | 7 |
| caregiver_cruelty | hostility | 30 | 0 | 0% | 3% 0% 0% 0% | 17% 0% - - | 7% | - | 0.663 | 0.08/0.06 | 30 | 1 | 0 | 0% | 33% | 0/0 | - | 0 |
| discrimination | hostility | 30 | 7 | 2% | 17% 17% 17% 17% | 23% 38% 43% 75% | 7% | 6.5 | 0.672 | 0.1/0.07 | 25 | 0 | 0 | 13% | 33% | 4/5 | 50% | 2 |
| excluded | hostility | 30 | 17 | 4% | 40% 30% 27% 23% | 21% 26% 29% 44% | 7% | 4.455 | 0.663 | 0.27/0.19 | 22 | 4 | 2 | 13% | 33% | 4/8 | 50% | 2 |
| mocked | hostility | 30 | 40 | 9% | 47% 43% 40% 33% | 14% 19% 23% 27% | 7% | 3.409 | 0.701 | 0.34/0.22 | 18 | 2 | 1 | 13% | 33% | 4/12 | 50% | 2 |
| plots_harm | hostility | 30 | 32 | 8% | 37% 30% 17% 7% | 14% 13% 13% 9% | 7% | 1.894 | 0.703 | 0.26/0.09 | 25 | 6 | 1 | 27% | 33% | 3/5 | 18% | 22 |
| rages_at_child | hostility | 30 | 3 | 1% | 7% 7% 3% 0% | 15% 40% 33% 0% | 7% | 5.045 | 0.61 | 0.17/0.08 | 29 | 1 | 1 | 3% | 33% | 0/1 | 100% | 1 |
| threatens_harm | hostility | 30 | 31 | 7% | 43% 37% 30% 27% | 16% 17% 16% 20% | 7% | 2.439 | 0.692 | 0.16/0.09 | 21 | 4 | 1 | 27% | 33% | 7/9 | 18% | 22 |
| afraid_for_safety | distress | 41 | 144 | 34% | 90% 76% 73% 46% | 17% 16% 18% 17% | 10% | 1.74 | 0.687 | 0.74/0.44 | 11 | 7 | 8 | 39% | 49% | 15/30 | 21% | 57 |
| child_frightened | distress | 41 | 57 | 13% | 63% 46% 39% 34% | 23% 23% 23% 22% | 10% | 2.192 | 0.713 | 0.34/0.13 | 25 | 10 | 0 | 39% | 49% | 13/16 | 21% | 57 |
| crying | distress | 41 | 11 | 3% | 15% 10% 5% 2% | 33% 29% 18% 14% | 10% | 1.75 | 0.675 | 0.13/0.08 | 39 | 4 | 0 | 17% | 49% | 1/2 | 24% | 21 |
| despair | distress | 41 | 11 | 3% | 0% 0% 0% 0% | 0% 0% 0% 0% | 10% | 0 | 0.54 | 0.14/0.11 | 41 | 0 | 0 | 17% | 49% | 0/0 | 24% | 21 |
| screams | distress | 41 | 113 | 27% | 85% 71% 61% 54% | 19% 18% 19% 22% | 10% | 1.788 | 0.722 | 0.63/0.29 | 16 | 10 | 4 | 39% | 49% | 14/25 | 21% | 57 |
| animal_cruelty | animals | 198 | 3 | 1% | 11% 6% 3% 2% | 90% 100% 100% 100% | 31% | 3.257 | 0.803 | 0.13/0.05 | 193 | 17 | 5 | 1% | 6% | 0/5 | 100% | 1 |
| animal_in_danger | animals | 198 | 20 | 5% | 51% 35% 20% 13% | 65% 79% 95% 100% | 31% | 3.094 | 0.806 | 0.43/0.21 | 158 | 60 | 40 | 5% | 6% | 5/40 | 67% | 6 |
| comic_peril | copyable | 28 | 8 | 2% | 36% 21% 11% 0% | 9% 10% 25% - | 6% | 4.237 | 0.6 | 0.36/0.26 | 25 | 7 | 1 | 7% | 11% | 0/3 | 33% | 3 |
| dangerous_act | copyable | 28 | 14 | 3% | 25% 14% 14% 14% | 15% 10% 14% 29% | 6% | 2.424 | 0.719 | 0.26/0.11 | 24 | 3 | 2 | 4% | 11% | 0/4 | 20% | 5 |
| goes_with_stranger | copyable | 28 | 3 | 1% | 4% 4% 4% 0% | 13% 25% 33% - | 6% | 5.644 | 0.465 | 0.06/0.07 | 27 | 0 | 0 | 0% | 11% | 0/1 | - | 0 |
| runs_away | copyable | 28 | 1 | 0% | 0% 0% 0% 0% | 0% 0% 0% - | 6% | 0 | 0.457 | 0.05/0.05 | 28 | 0 | 0 | 0% | 11% | 0/0 | - | 0 |
| slapstick | copyable | 28 | 33 | 8% | 36% 36% 32% 7% | 16% 20% 21% 6% | 6% | 3.593 | 0.69 | 0.3/0.12 | 19 | 1 | 6 | 7% | 11% | 2/9 | 33% | 3 |
| film:child_in_danger | per film item | 115 | 52 | 14% | 58% 48% 43% 28% | 43% 46% 50% 53% | 26% | 1.931 | 0.698 | 0.42/0.2 | 66 | 18 | 10 | 10% | 72% | 6/49 | 55% | 11 |
| film:danger | per film item | 196 | 45 | 11% | 34% 28% 18% 12% | 38% 45% 53% 64% | 34% | 1.591 | 0.618 | 0.39/0.33 | 160 | 31 | 8 | 39% | 54% | 23/36 | 81% | 31 |
| film:presence | per film item | 135 | 270 | 64% | 50% 47% 41% 39% | 15% 15% 14% 14% | 26% | 0.549 | 0.471 | 0.88/0.92 | 80 | 13 | 0 | - | 38% | - | - | - |
| film:threatens | per film item | 30 | 22 | 5% | 10% 10% 10% 7% | 5% 7% 9% 7% | 7% | 1.379 | 0.599 | 0.1/0.08 | 27 | 0 | 1 | 27% | 33% | 2/3 | 18% | 22 |

### DTDD topics, specific tag mapping, by kind (topic first category)

| kind | topics | crowd yes | Jev agree | Jev tp/tn/fp/fn | live agree | live tp/tn/fp/fn | Jev=live |
|---|---|---|---|---|---|---|---|
| captivity | 7 | 5 | 5/7 | 5/0/2/0 | 5/6 | 4/1/0/1 | 4/6 |
| creatures_figures | 53 | 11 | 44/53 | 8/36/6/3 | 35/46 | 3/32/3/8 | 32/46 |
| death | 41 | 25 | 35/41 | 22/13/3/3 | 28/35 | 22/6/7/0 | 26/35 |
| distress | 14 | 9 | 9/14 | 9/0/5/0 | 8/12 | 8/0/4/0 | 12/12 |
| eerie | 7 | 3 | 3/7 | 3/0/4/0 | 3/6 | 3/0/3/0 | 6/6 |
| injury | 14 | 5 | 11/14 | 2/9/0/3 | 10/12 | 2/8/1/1 | 11/12 |
| objects_hazards | 14 | 2 | 8/14 | 2/6/6/0 | 12/12 | 2/10/0/0 | 7/12 |
| peril | 7 | 2 | 4/7 | 0/4/1/2 | 3/6 | 0/3/1/2 | 6/6 |
| separation | 14 | 4 | 10/14 | 4/6/4/0 | 10/12 | 3/7/2/0 | 8/12 |
| violence | 7 | 2 | 6/7 | 2/4/1/0 | 5/6 | 1/4/1/0 | 6/6 |
| ALL | 178 | 68 | 135/178 | 57/78/32/11 | 119/153 | 48/71/22/12 | 118/153 |

### DTDD specific topics by target tag ids

| target ids | topics | crowd yes | Jev agree | Jev fp/fn | live agree | live fp/fn |
|---|---|---|---|---|---|---|
| reanimated_dead | 2 | 0 | 2/2 | 0/0 | 2/2 | 0/0 |
| abandoned | 7 | 2 | 3/7 | 4/0 | 5/6 | 1/0 |
| dies|pet_dies | 7 | 5 | 5/7 | 1/1 | 6/6 | 0/0 |
| pet_dies | 7 | 1 | 7/7 | 0/0 | 2/6 | 4/0 |
| spider_insect | 14 | 6 | 12/14 | 1/1 | 4/12 | 2/6 |
| snake_reptile | 7 | 1 | 7/7 | 0/0 | 5/6 | 0/1 |
| shark | 7 | 1 | 7/7 | 0/0 | 6/6 | 0/0 |
| rodent_bat | 2 | 1 | 1/2 | 0/1 | 1/2 | 0/1 |
| child_taken | 7 | 2 | 7/7 | 0/0 | 5/6 | 1/0 |
| crying|child_frightened | 7 | 2 | 2/7 | 5/0 | 2/6 | 4/0 |
| dies | 13 | 10 | 10/13 | 1/2 | 11/11 | 0/0 |
| parent_death_learned|loved_one_dies | 14 | 9 | 13/14 | 1/0 | 9/12 | 3/0 |
| child_taken|captured | 7 | 5 | 5/7 | 2/0 | 5/6 | 0/1 |
| jump_scare|appears_suddenly | 7 | 3 | 3/7 | 4/0 | 3/6 | 3/0 |
| trapped|swallowed | 7 | 1 | 1/7 | 6/0 | 6/6 | 0/0 |
| possessed | 7 | 1 | 3/7 | 3/1 | 5/6 | 1/0 |
| clown | 7 | 0 | 6/7 | 1/0 | 6/6 | 0/0 |
| ghost_spirit | 7 | 1 | 6/7 | 1/0 | 6/6 | 0/0 |
| needle_medical | 7 | 1 | 7/7 | 0/0 | 6/6 | 0/0 |
| medical_care | 7 | 2 | 6/7 | 0/1 | 5/6 | 1/0 |
| cannot_breathe | 7 | 2 | 4/7 | 1/2 | 3/6 | 1/2 |
| screams | 7 | 7 | 7/7 | 0/0 | 6/6 | 0/0 |
| blood_wound | 7 | 3 | 5/7 | 0/2 | 5/6 | 0/1 |
| gun|weapon_used | 7 | 2 | 6/7 | 1/0 | 5/6 | 1/0 |

### DTDD coarse group fallback (topics with no specific mapping), by kind

| kind | topics | crowd yes | Jev agree | Jev fp/fn | live agree | live fp/fn |
|---|---|---|---|---|---|---|
| animals | 48 | 13 | 13/48 | 35/0 | 11/42 | 31/0 |
| captivity | 29 | 12 | 12/29 | 17/0 | 11/25 | 13/1 |
| creatures_figures | 33 | 2 | 2/33 | 31/0 | 2/29 | 27/0 |
| death | 149 | 21 | 21/149 | 128/0 | 28/128 | 100/0 |
| distress | 49 | 6 | 6/49 | 43/0 | 6/42 | 36/0 |
| eerie | 35 | 13 | 13/35 | 22/0 | 11/31 | 20/0 |
| hostility | 126 | 12 | 12/126 | 114/0 | 11/110 | 99/0 |
| injury | 200 | 24 | 24/200 | 176/0 | 44/173 | 126/3 |
| objects_hazards | 54 | 12 | 12/54 | 42/0 | 11/47 | 36/0 |
| peril | 84 | 19 | 19/84 | 65/0 | 18/72 | 54/0 |
| separation | 9 | 3 | 3/9 | 6/0 | 3/8 | 4/1 |
| violence | 72 | 9 | 9/72 | 63/0 | 9/62 | 53/0 |
| ALL | 888 | 146 | 146/888 | 742/0 | 165/769 | 599/5 |

### codex-rules items (model-written; NOT in the human score)

| marker | items | Jev any tag in item group | live any label in item group | Jev rule question fired |
|---|---|---|---|---|
| child_terrified | 18 | 17 | 3 | 13 |
| villain_threat | 17 | 17 | 8 | 14 |

## Reliability ranking (held-out, >= 3 fires at 0.7)

### Most reliable 8

| question | group | HO fires | HO prec | HO Wilson lo-hi | HO base | HO lift | HO recall | HO AUC | dev fires | dev prec | dev lift | dev recall | dev AUC |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| battle | violence | 8 | 100% | 0.676-1 | 30% | 3.39 | 19% | 0.776 | 7 | 86% | 5.951 | 18% | 0.786 |
| child_in_danger | peril | 13 | 85% | 0.578-0.957 | 24% | 3.6 | 27% | 0.782 | 32 | 63% | 2.306 | 27% | 0.744 |
| explosion | objects_hazards | 4 | 100% | 0.51-1 | 18% | 5.525 | 21% | 0.711 | 4 | 25% | 1.374 | 3% | 0.719 |
| fire | objects_hazards | 4 | 100% | 0.51-1 | 18% | 5.525 | 12% | 0.647 | 4 | 50% | 2.747 | 6% | 0.666 |
| blade_weapon | objects_hazards | 7 | 86% | 0.487-0.974 | 18% | 4.735 | 24% | 0.71 | 2 | 0% | 0 | 0% | 0.602 |
| creature_threat | peril | 7 | 86% | 0.487-0.974 | 24% | 3.647 | 16% | 0.757 | 27 | 82% | 3.007 | 34% | 0.773 |
| film:child_in_danger | per film item | 17 | 71% | 0.469-0.867 | 24% | 3.004 | 29% | 0.735 | 52 | 50% | 1.931 | 43% | 0.698 |
| monster_creature | creatures_figures | 16 | 69% | 0.444-0.858 | 17% | 4.071 | 40% | 0.86 | 79 | 18% | 1.702 | 50% | 0.659 |

### Least reliable 8

| question | group | HO fires | HO prec | HO Wilson lo-hi | HO base | HO lift | HO recall | HO AUC | dev fires | dev prec | dev lift | dev recall | dev AUC |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| screams | distress | 36 | 14% | 0.061-0.287 | 11% | 1.287 | 35% | 0.571 | 113 | 19% | 1.788 | 61% | 0.722 |
| afraid_for_safety | distress | 42 | 17% | 0.083-0.306 | 11% | 1.546 | 47% | 0.62 | 144 | 18% | 1.74 | 73% | 0.687 |
| animal_in_danger | animals | 6 | 0% | 0-0.39 | 10% | 0 | 0% | 0.633 | 20 | 95% | 3.094 | 20% | 0.806 |
| startled | eerie | 41 | 24% | 0.138-0.393 | 12% | 2.033 | 50% | 0.765 | 120 | 15% | 1.923 | 76% | 0.7 |
| witch_sorcerer | creatures_figures | 10 | 10% | 0.018-0.404 | 17% | 0.592 | 4% | 0.447 | 0 | - | - | 0% | 0.623 |
| abandoned | separation | 10 | 10% | 0.018-0.404 | 7% | 1.515 | 9% | 0.678 | 14 | 7% | 2.958 | 15% | 0.633 |
| ghost_spirit | creatures_figures | 32 | 25% | 0.133-0.421 | 17% | 1.479 | 24% | 0.565 | 2 | 50% | 4.808 | 2% | 0.653 |
| snake_reptile | creatures_figures | 8 | 13% | 0.022-0.471 | 17% | 0.74 | 12% | 0.691 | 3 | 0% | 0 | 0% | 0.582 |

