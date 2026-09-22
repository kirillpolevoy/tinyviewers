// Taxonomy v3, reduced to the one thing this app needs from it: id → the words a person reads.
//
// A recording stores probabilities against ids — `shark`, `unseen_threat`, `sev57`. The analysis
// page shows those probabilities, so it needs the labels; the film pages never do, because the
// database already carries a parent-facing `short_label` beside every asserted row.
//
// This is a copy of the labels in experiments/trigger-scan/taxonomy-v3.js, on purpose. That file is
// an ES module in another project with its own lifecycle, full of question text, criteria, weights
// and age-band tuning — none of which belongs in a browser bundle — and importing across the two
// trees would tie this app's build to a directory it does not own. The copy is 72 short strings,
// and the recording names its taxonomy version (`meta.taxonomy`), so a v4 recording arriving
// against v3 labels is visible rather than silent: see `unknownLabelIds`.
//
// An id with no label here is shown as its id. That is the honest fallback: the page never invents
// words for a question it does not recognise.

export const TAXONOMY_VERSION = 'v3';

/** Layer A — what is in the scene, regardless of threat or tone. */
export const PRESENCE_LABELS: Record<string, string> = {
  monster_creature: 'Monster or strange creature',
  ghost_spirit: 'Ghost or spirit',
  reanimated_dead: 'Something dead brought back to life',
  skeleton_corpse: 'Skeleton or dead body',
  shark: 'Shark',
  spider_insect: 'Spider or insect',
  snake_reptile: 'Snake or reptile',
  large_predator: 'Large predatory animal',
  rodent_bat: 'Rat, mouse or bat',
  clown_doll_puppet: 'Clown, doll or puppet',
  robot_machine_being: 'Robot or machine creature',
  witch_magic_villain: 'Witch, sorcerer or dark magic',
  alien: 'Alien',
  scary_appearance: 'Someone who looks frightening',
  gun: 'Gun',
  blade_weapon: 'Knife, sword or other weapon',
  fire: 'Fire',
  explosion: 'Explosion or bomb',
  storm_lightning: 'Storm or lightning',
  deep_dark_water: 'Deep or dark water',
  heights: 'Dangerous height',
  darkness: 'Darkness',
  needle_medical: 'Needle or medical procedure',
  hospital_illness: 'Hospital or seriously ill person',
  blood_wound: 'Blood or an open wound',
  vehicle_crash: 'Vehicle out of control or crashing',
  cage_net_trap: 'Cage, net or trap',
  graveyard_funeral: 'Graveyard or funeral',
  dangerous_machine: 'Dangerous machinery or electricity',
};

/** Layer B — what is happening to the characters right now. */
export const EVENT_LABELS: Record<string, string> = {
  chased: 'Someone is being chased',
  attacked: 'Someone is being attacked',
  weapon_used: 'A weapon is used on someone',
  falling: 'Someone is falling',
  drowning: 'Someone cannot breathe',
  caught_in_hazard: 'Someone is caught in a hazard',
  vehicle_accident: 'A vehicle crash is happening',
  battle: 'A battle or attack on many people',
  captured: 'Someone is being caught',
  trapped_struggling: 'Someone is trapped and struggling',
  injured: 'Someone is hurt',
  dies: 'Someone dies',
  believed_dead: 'Someone believes a loved one just died',
  parent_death_learned: 'A child loses a parent',
  grieving: 'Someone is mourning',
  child_taken: 'A child is taken from a parent',
  child_lost: 'A child and parent are separated and calling out',
  abandoned: 'Someone is sent away or left behind',
  family_in_danger: 'A family member is in danger',
  parents_fighting: 'A child’s parents are fighting',
  rages_at_child: 'An adult rages at a child',
  threatens_harm: 'Someone threatens to hurt someone',
  bullying: 'Someone is mocked or excluded',
  discrimination: 'Someone is treated badly for who they are',
  caregiver_cruelty: 'A caregiver is cruel to a child',
  betrayal: 'A trusted adult turns on a child',
  transformation: 'Someone changes into something frightening',
  nightmare: 'A nightmare or frightening vision',
  unseen_threat: 'Something unseen is near',
  jump_scare: 'A sudden startle',
  terrified: 'Someone is terrified',
  sobbing_despair: 'Someone is crying or despairing',
  animal_cruelty: 'An animal is mistreated',
  animal_in_danger: 'An animal is in danger',
  dangerous_act: 'A child does something dangerous',
  runs_away: 'A child runs away or goes off with a stranger',
  slapstick_violence: 'Violence played for laughs',
};

/** Layer C — the four 0–3 scores. These are scores, not probabilities, and are shown as such. */
export const SCORE_LABELS: Record<string, string> = {
  threat: 'Physical danger',
  distress: 'Character upset',
  sev57: 'Severity, ages 5–7',
  sev810: 'Severity, ages 8–10',
};

/** The order the four scores are shown in: the two readings first, then the two age bands. */
export const SCORE_ORDER = ['threat', 'distress', 'sev57', 'sev810'] as const;

export type Channel = 'presence' | 'mention' | 'event';

/**
 * The words for one answer. `mention` reuses the presence ids — the same thing, only talked about —
 * so it is labelled from the same table with the difference said out loud, rather than duplicating
 * twenty-seven strings that would then have to be kept in step.
 */
export function labelFor(channel: Channel, id: string): string {
  if (channel === 'event') return EVENT_LABELS[id] ?? id;
  const noun = PRESENCE_LABELS[id];
  if (!noun) return id;
  return channel === 'mention' ? `${noun} (talked about)` : noun;
}

/**
 * Ids in a recording that this table has no words for. Nothing calls it on a page; it exists so a
 * test fails the day a recording is made against a taxonomy this file has not caught up with,
 * instead of the page quietly printing `robot_machine_being` at a parent.
 */
export function unknownLabelIds(ids: { channel: Channel; id: string }[]): string[] {
  const missing = new Set<string>();
  for (const { channel, id } of ids) {
    const table = channel === 'event' ? EVENT_LABELS : PRESENCE_LABELS;
    if (!table[id]) missing.add(id);
  }
  return [...missing].sort();
}
