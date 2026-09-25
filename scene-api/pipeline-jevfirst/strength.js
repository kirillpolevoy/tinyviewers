// Strength per age band, from what happens in the scene: each flag reason maps to the level whose
// definition on the film page (web/lib/copy.ts, "What the levels mean") describes it, and the scene
// takes its strongest reason. It replaces the v10.4 composite for the stored level, which was never
// calibrated and put most flagged scenes at 3 (Monsters, Inc. 14 of 17, Room on the Broom 4 of 4).
//
//   ages 5-7:  3 an attack, a child taken, or someone dying or seeming to die
//              2 chasing, being trapped or lost, or lasting fear
//              1 brief scare, worry, or sadness
//   ages 8-10: 3 someone dies or seems to die, a child is taken, or family is in serious danger
//              2 lasting danger, injury, or humiliation
//              1 brief, pretend, or comic danger or sadness
//
// A comic, retold or imagined scene is at most 1. A flagged scene is at least 1. Pure; the frozen pack
// (select.js) is untouched and its composite stays in the scene's severity for reference.

const LEVELS = [
  // [5-7, 8-10], reason ids (split.json concepts and their v9 ids, plus the mortal-danger reasons)
  [[3, 3], ['dies', 'loved_one_dies', 'pet_dies', 'believed_dead', 'parent_death_learned', 'dead_body', 'child_taken', 'family_in_danger']],
  [[3, 2], ['attacked', 'weapon_used', 'battle', 'swallowed', 'badly_hurt']],
  [[2, 2], ['injured', 'blood_wound', 'child_in_danger', 'caregiver_cruelty', 'rages_at_child', 'animal_cruelty']],
  [[2, 1], [
    'chased', 'trapped', 'captured', 'cage_net_trap', 'restraints', 'falls', 'nearly_falls', 'deadly_fall', 'cannot_breathe',
    'caught_in_hazard', 'creature_threat', 'threatens_harm', 'plots_harm', 'vehicle_crash', 'vehicle_accident', 'fire', 'explosion',
    'bomb_danger', 'storm', 'deep_dark_water', 'heights', 'dangerous_machine', 'animal_in_danger', 'dangerous_act', 'child_separated',
    'parent_searching', 'abandoned', 'runs_away', 'goes_with_stranger', 'unseen_threat', 'possessed', 'gun', 'blade_weapon',
    'child_frightened', 'seriously_ill',
  ]],
  [[1, 2], ['mocked', 'excluded', 'discrimination']],
  [[1, 1], [
    'crying', 'despair', 'grieving', 'graveyard_funeral', 'afraid_for_safety', 'screams', 'appears_suddenly', 'startled', 'nightmare',
    'transforms', 'darkness', 'betrayal', 'parents_argue', 'needle_medical', 'medical_care', 'monster_creature', 'ghost_spirit',
    'reanimated_dead', 'skeleton_bones', 'shark', 'spider_insect', 'snake_reptile', 'large_predator', 'rodent_bat', 'clown',
    'doll_puppet', 'mask', 'robot_machine_being', 'witch_sorcerer', 'dark_magic', 'alien', 'scary_appearance', 'slapstick', 'comic_peril',
  ]],
];

export const REASON_LEVELS = new Map(LEVELS.flatMap(([levels, ids]) => ids.map((id) => [id, levels])));

/** A film-specific reason (C01_in_danger, D02_endangers, T01_threatens): a named character or danger. */
const FILM_ITEM = /_(in_danger|endangers|threatens)$/;
/** Anything not listed: danger-like, the page's middle words. */
const DEFAULT = [2, 1];

export function reasonLevels(id) {
  if (REASON_LEVELS.has(id)) return REASON_LEVELS.get(id);
  if (FILM_ITEM.test(String(id))) return [2, 1];
  return DEFAULT;
}

const cappedByModifiers = (m = {}) => Boolean(m.comic?.on || m.comic_peril?.on || m.retold?.on || m.imagined?.on);

/** { '5-7': 0..3, '8-10': 0..3 } for one scene of select's output; null levels for a scene not flagged. */
export function strengthOf(scene) {
  if (!scene?.flagged) return { '5-7': null, '8-10': null };
  let young = 1;
  let older = 1;
  for (const r of scene.flag_reasons ?? []) {
    const [a, b] = reasonLevels(r.id);
    young = Math.max(young, a);
    older = Math.max(older, b);
  }
  if (cappedByModifiers(scene.modifiers)) {
    young = Math.min(young, 1);
    older = Math.min(older, 1);
  }
  return { '5-7': young, '8-10': older };
}
