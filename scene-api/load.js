#!/usr/bin/env node
// Builds the scene database from the saved outputs of experiments/trigger-scan and writes it to
// DATABASE_URL.
//
//   DATABASE_URL=postgres://... node load.js                 # all six films
//   DATABASE_URL=postgres://... node load.js --film nemo     # one film
//   node load.js --dry-run                                   # build the rows, print the report, write nothing
//
// Nothing here calls a model. Every number comes from a file already on disk or from parsing the
// SRT with the experiment's own parser. No subtitle text is written to the database except the
// three anchor quotes per track (<= 12 words each).

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { applySchema, pgAdapter, guardPool, root } from './lib/db.js';
import { invalidateVocabularyCache } from './lib/data.js';
// The one thing the loader borrows from the pipeline: its error type, so that `ensureVocabulary`
// below can refuse a live run with a code the job row can carry. errors.js imports nothing.
import { fail } from './pipeline/errors.js';

export const SLUGS = ['nemo', 'lion-king', 'iron-giant', 'monsters-inc', 'frankenweenie', 'wild-robot'];

export const DEFAULT_EXPERIMENT_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../experiments/trigger-scan',
);

// taxonomy-v2 ids with no successor anywhere in taxonomy-v3.js. Rather than drop them, they are
// folded into the nearest v3 event and the thing v3 cannot yet say is kept in scene_labels.detail.
// TEMPORARY: taxonomy v4 should give `loved_one_dies` and `pet_animal_dies` ids of their own.
// A v2 id that is neither mapped nor listed here is a hard error.
export const TEMPORARY_V2_MAPPING = {
  loved_one_dies: { to: 'dies', detail: 'a loved one' },
  pet_animal_dies: { to: 'dies', detail: 'a pet or animal' },
};

// A Jev per-beat probability at or above this is served as "possibly present", never as present.
export const JEV_POSSIBLE = 0.7;

// Words a parent is likely to type that the generated label/id keys do not already cover.
//
// NOTE 1: the broad words a parent uses for "any frightening creature" — monster, creature, beast
// — deliberately do NOT appear here. They resolve to the whole creatures_figures GROUP (see
// BROAD_TERMS in lib/match.js), because a parent who says "monsters" does not mean the narrow
// taxonomy item that excludes every animal.
//
// NOTE 2: an everyday word that could mean more than one item is listed under EVERY item it could
// mean, and the matcher returns all of them. "shot" is the case that caught us: it was filed only
// under needle_medical, so presence=shot on The Iron Giant — a film in which a deer is shot with a
// rifle — answered "nothing matched" while presence=gun returned three scenes. Over-matching shows
// a parent a scene they did not need to see; under-matching hides one they did. Over-match.
const EXTRA_ALIASES = {
  monster_creature: ['strange creature', 'bogeyman'],
  ghost_spirit: ['ghost', 'ghosts', 'spirit', 'haunting', 'haunted'],
  reanimated_dead: ['zombie', 'undead', 'brought back to life', 'resurrection'],
  skeleton_corpse: ['skeleton', 'bones', 'corpse', 'dead body'],
  shark: ['sharks', 'jaws'],
  spider_insect: ['spider', 'spiders', 'bug', 'bugs', 'insect', 'creepy crawly'],
  snake_reptile: ['snake', 'snakes', 'lizard', 'reptile'],
  large_predator: ['wolf', 'lion', 'bear', 'tiger', 'crocodile', 'predator', 'big cat', 'hyena', 'hunted by an animal'],
  rodent_bat: ['rat', 'rats', 'mouse', 'mice', 'bat', 'bats'],
  clown_doll_puppet: ['clown', 'doll', 'puppet', 'mask', 'mannequin', 'dummy'],
  robot_machine_being: ['robot', 'robots', 'machine'],
  witch_magic_villain: ['witch', 'wizard', 'magic', 'curse', 'sorcerer'],
  alien: ['aliens', 'extraterrestrial', 'ufo'],
  scary_appearance: ['scary face', 'ugly', 'disfigured', 'scary looking'],
  // 'shot'/'shooting'/'fired' are shared with needle_medical and weapon_used on purpose.
  gun: ['guns', 'firearm', 'rifle', 'pistol', 'shooting', 'shot', 'shots', 'fired', 'gunfire', 'gunshot'],
  blade_weapon: ['knife', 'knives', 'sword', 'axe', 'weapon', 'blade', 'stabbing'],
  // 'fire' is this item's id; 'fired' belongs to guns, so it is deliberately NOT here.
  fire: ['fires', 'burning', 'flames', 'flame', 'on fire', 'blaze'],
  explosion: ['explosions', 'bomb', 'blast', 'blown up'],
  storm_lightning: ['storm', 'thunder', 'lightning', 'tornado', 'flood'],
  deep_dark_water: ['water', 'deep water', 'ocean', 'drowning water', 'sea', 'underwater'],
  heights: ['height', 'cliff', 'ledge', 'high up', 'long drop', 'falling from a height'],
  darkness: ['dark', 'the dark', 'pitch black', 'night', 'cant see'],
  // 'shot' is also a gunshot; 'needle'/'injection' are unambiguous.
  needle_medical: ['needle', 'needles', 'injection', 'shot', 'shots', 'syringe', 'dentist', 'jab', 'vaccine'],
  hospital_illness: ['hospital', 'doctor', 'illness', 'sick', 'nurse'],
  // 'blood' is also the everyday word for an injury; 'wound' is shared with the `injured` event.
  blood_wound: ['blood', 'bleeding', 'bloody', 'wound', 'wounded', 'gore', 'cut'],
  vehicle_crash: ['car crash', 'crash', 'plane crash', 'train crash', 'car accident'],
  cage_net_trap: ['cage', 'caged', 'net', 'trap', 'trapped', 'tied up', 'locked in', 'locked up'],
  graveyard_funeral: ['graveyard', 'cemetery', 'grave', 'funeral', 'tomb', 'burial'],
  dangerous_machine: ['machinery', 'saw', 'blades', 'electricity', 'electrocution'],
  chased: ['chase', 'chasing', 'being chased', 'hunted'],
  attacked: ['attack', 'attacks', 'mauled', 'bitten'],
  // The event side of the shared shooting words.
  weapon_used: ['shot', 'shots', 'shot at', 'shooting', 'fired', 'stabbed', 'gun fired'],
  falling: ['fall', 'falls', 'falling off', 'falling from a height'],
  drowning: ['drown', 'drowns', 'cannot breathe', 'suffocating', 'underwater'],
  caught_in_hazard: ['stuck in fire', 'caught in a flood', 'caught in machinery', 'on fire'],
  vehicle_accident: ['car accident', 'crashes', 'crash'],
  battle: ['war', 'battles', 'bombing'],
  captured: ['caught', 'captured', 'netted', 'kidnapped', 'caged', 'trapped'],
  trapped_struggling: ['trapped', 'trap', 'swallowed', 'buried', 'locked up', 'locked in'],
  injured: ['hurt', 'injury', 'wounded', 'wound', 'stung', 'burned', 'bitten', 'cut'],
  dies: ['death', 'dying', 'killed', 'someone dies'],
  believed_dead: ['thinks someone died', 'presumed dead'],
  parent_death_learned: ['parent dies', 'mum dies', 'dad dies', 'loses a parent'],
  grieving: ['mourning', 'grief', 'sad about a death'],
  child_taken: ['kidnapping', 'taken', 'abducted', 'snatched'],
  child_lost: ['lost child', 'separated', 'calling for mum', 'missing child'],
  abandoned: ['abandonment', 'left behind', 'sent away'],
  family_in_danger: ['family in trouble'],
  parents_fighting: ['parents arguing', 'divorce'],
  rages_at_child: ['shouting at a child', 'yelling'],
  threatens_harm: ['threat', 'threats', 'threatening'],
  bullying: ['bully', 'bullies', 'mocked', 'teasing', 'excluded'],
  discrimination: ['racism', 'prejudice'],
  caregiver_cruelty: ['abuse', 'cruel parent', 'neglect'],
  betrayal: ['betrayed', 'tricked'],
  transformation: ['turns into a monster', 'possessed'],
  nightmare: ['nightmares', 'bad dream'],
  unseen_threat: ['something watching', 'being followed'],
  jump_scare: ['jump scares', 'startle', 'sudden scare'],
  terrified: ['terror', 'panic', 'screaming', 'scared'],
  sobbing_despair: ['crying', 'sobbing', 'despair'],
  animal_cruelty: ['animal abuse', 'hurting an animal'],
  animal_in_danger: ['animal in trouble', 'pet in danger'],
  dangerous_act: ['dare', 'risky behaviour', 'copyable'],
  runs_away: ['running away', 'stranger danger'],
  slapstick_violence: ['funny violence', 'slapstick', 'cartoon violence'],
};

// One to three plain words per item, for the tag list under a scene title on a parent page. The
// full `label` is a sentence ("Someone believes a loved one just died"); six of those side by side
// are unreadable, so every presence and event item also carries the short form a parent scans.
//
// Rules: 1-3 words, sentence case, no jargon, no engine words, and no punctuation beyond a hyphen.
// Every id in taxonomy-v3 PRESENCE and EVENTS must appear here — a missing one is a hard error, so
// a taxonomy addition cannot quietly reach a scene row with a sentence for a tag. Modifiers have
// none: they never appear in a row's tag list.
const SHORT_LABELS = {
  // presence · creatures and figures
  monster_creature: 'Monster',
  ghost_spirit: 'Ghost',
  reanimated_dead: 'Undead',
  skeleton_corpse: 'Skeleton',
  shark: 'Shark',
  spider_insect: 'Spider or insect',
  snake_reptile: 'Snake',
  large_predator: 'Big predator',
  rodent_bat: 'Rats or bats',
  clown_doll_puppet: 'Clown or doll',
  robot_machine_being: 'Robot',
  witch_magic_villain: 'Witch or magic',
  alien: 'Alien',
  scary_appearance: 'Scary-looking character',
  // presence · objects and hazards
  gun: 'Gun',
  blade_weapon: 'Weapon',
  fire: 'Fire',
  explosion: 'Explosions',
  storm_lightning: 'Storm',
  deep_dark_water: 'Deep water',
  heights: 'High places',
  darkness: 'Darkness',
  needle_medical: 'Needles and medical',
  hospital_illness: 'Hospital or illness',
  blood_wound: 'Blood',
  vehicle_crash: 'Crash',
  cage_net_trap: 'Cage or trap',
  graveyard_funeral: 'Graveyard',
  dangerous_machine: 'Machinery',
  // events · peril and violence
  chased: 'Chase',
  attacked: 'Attack',
  weapon_used: 'Weapon used',
  falling: 'A fall',
  drowning: 'Cannot breathe',
  caught_in_hazard: 'Caught in danger',
  vehicle_accident: 'Crash happens',
  battle: 'Battle',
  // events · captivity and injury
  captured: 'Caught',
  trapped_struggling: 'Trapped',
  injured: 'Someone hurt',
  // events · death
  dies: 'Someone dies',
  believed_dead: 'Thought dead',
  parent_death_learned: 'Parent dies',
  grieving: 'Grief',
  // events · separation
  child_taken: 'Child taken',
  child_lost: 'Child lost',
  abandoned: 'Left behind',
  family_in_danger: 'Family in danger',
  parents_fighting: 'Parents fighting',
  // events · hostility
  rages_at_child: 'Adult rages',
  threatens_harm: 'Threats',
  bullying: 'Teasing',
  discrimination: 'Singled out',
  caregiver_cruelty: 'Cruel caregiver',
  betrayal: 'Betrayal',
  // events · eerie
  transformation: 'Transformation',
  nightmare: 'Nightmare',
  unseen_threat: 'Something unseen',
  jump_scare: 'Sudden scare',
  // events · distress
  terrified: 'Panic',
  sobbing_despair: 'Crying',
  // events · animals
  animal_cruelty: 'Animal mistreated',
  animal_in_danger: 'Animal in danger',
  // events · copyable
  dangerous_act: 'Risky act',
  runs_away: 'Runs away',
  slapstick_violence: 'Comic violence',
};

export { SHORT_LABELS };

// ------------------------------------------------------------------------------------------------
// Reading the experiment
// ------------------------------------------------------------------------------------------------

const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));

export async function openExperiment(dir = DEFAULT_EXPERIMENT_DIR) {
  const need = (p) => {
    const full = path.join(dir, p);
    if (!fs.existsSync(full)) throw new Error(`missing ${full} — point --experiment-dir at experiments/trigger-scan`);
    return full;
  };
  const srt = await import(pathToFileURL(need('srt.js')).href);
  const taxonomy = await import(pathToFileURL(need('taxonomy-v3.js')).href);
  const films = readJson(need('films.json'));
  const tracksMeta = fs.existsSync(path.join(dir, 'data/tracks.json')) ? readJson(path.join(dir, 'data/tracks.json')) : {};
  return { dir, srt, taxonomy, films, tracksMeta };
}

// The jev v3 presence run for a slug: runs-v3/*jev-v3-layers-<slug>*v3b.json
export function findJevRun(dir, slug) {
  const runs = path.join(dir, 'runs-v3');
  if (!fs.existsSync(runs)) return null;
  const hits = fs.readdirSync(runs)
    .filter((f) => f.includes(`jev-v3-layers-${slug}`) && f.includes('v3b') && f.endsWith('.json'))
    .sort();
  return hits.length ? path.join(runs, hits[hits.length - 1]) : null;
}

// The per-scene Claude presence run (run-sonnet-presence.js), when it has been produced.
export function findPresenceRun(dir, slug) {
  const file = path.join(dir, 'runs-v3', `sonnet-presence-${slug}.json`);
  return fs.existsSync(file) ? file : null;
}

// The recorded Jev run a "Watch it work" replay plays back (record-jev-run.js), and the excerpt file
// beside it. The excerpts are git-ignored, so they are optional: a film can have a recording and no
// excerpts, and the page has to work without them.
export function findRecording(dir, slug) {
  const file = path.join(dir, 'recordings', `${slug}.jev.json`);
  if (!fs.existsSync(file)) return null;
  const excerptFile = path.join(dir, 'recordings', `${slug}.excerpts.json`);
  return {
    recording: readJson(file),
    excerpts: fs.existsSync(excerptFile) ? readJson(excerptFile) : null,
  };
}

export function sceneSourceFor(dir, slug) {
  if (slug === 'nemo') {
    return { file: path.join(dir, 'scenes.nemo.grounded.json'), second: null, script: 'build-scenes.js --synopsis data/nemo.context.json' };
  }
  const file = path.join(dir, 'runs-v3', `sonnet-alone-${slug}.json`);
  const second = path.join(dir, 'runs-v3', `sonnet-alone-${slug}-r2.json`);
  return { file, second: fs.existsSync(second) ? second : null, script: 'run-sonnet-alone.js' };
}

// ------------------------------------------------------------------------------------------------
// Anchors
// ------------------------------------------------------------------------------------------------

const SOUND_CAPTION = /[[(][^)\]]{1,60}[\])]/;
const MUSIC = /[#♪]/;
const SPEAKER = /^\s*-?\s*[A-Z][A-Z'’. ]{1,20}:/;

export function isAnchorCandidate(cue, counts) {
  const t = cue.text;
  if (MUSIC.test(t)) return false;              // song lyric
  if (SOUND_CAPTION.test(t)) return false;      // (GASPS), [door slams]
  if (SPEAKER.test(t)) return false;            // "FINK: Oh, no."
  if (t.trimStart().startsWith('-')) return false; // two speakers merged into one cue
  if (!/[a-z]/.test(t)) return false;           // all caps, usually a caption or a sign
  if (/["“”]/.test(t)) return false;            // awkward to quote back
  const words = t.split(/\s+/).filter(Boolean);
  if (words.length < 4 || words.length > 12) return false;
  return counts.get(anchorKey(t)) === 1;        // must be unique in the film
}

export const anchorKey = (text) => text.toLowerCase().replace(/[^a-z0-9 ]+/g, '').replace(/\s+/g, ' ').trim();

// Three anchors at roughly 5% / 50% / 90% of the track, searching outwards from each target.
export function pickAnchors(cues) {
  const counts = new Map();
  for (const c of cues) counts.set(anchorKey(c.text), (counts.get(anchorKey(c.text)) ?? 0) + 1);
  const duration = cues[cues.length - 1].endMs;
  const used = new Set();
  const out = [];
  for (const [position, fraction] of [['early', 0.05], ['middle', 0.5], ['late', 0.9]]) {
    const target = duration * fraction;
    let best = 0;
    for (let i = 0; i < cues.length; i++) {
      if (Math.abs(cues[i].startMs - target) < Math.abs(cues[best].startMs - target)) best = i;
    }
    let found = null;
    for (let d = 0; d < cues.length && !found; d++) {
      for (const i of [best + d, best - d]) {
        if (i < 0 || i >= cues.length || used.has(i)) continue;
        if (isAnchorCandidate(cues[i], counts)) { found = i; break; }
      }
    }
    if (found === null) continue;
    used.add(found);
    out.push({ position, cue_id: cues[found].id, cue_index: cues[found].index, start_ms: cues[found].startMs, quote: cues[found].text });
  }
  return out;
}

// ------------------------------------------------------------------------------------------------
// Vocabulary
// ------------------------------------------------------------------------------------------------

export function buildVocabulary(taxonomy) {
  const groups = Object.entries(taxonomy.GROUPS).map(([id, label]) => ({ id, label, layer: null }));
  const byGroupLayer = new Map();
  const items = [];
  for (const item of [...taxonomy.PRESENCE, ...taxonomy.EVENTS]) {
    byGroupLayer.set(item.group, item.layer);
    const short = SHORT_LABELS[item.id];
    if (!short) {
      throw new Error(`no short_label for taxonomy item "${item.id}" — add one to SHORT_LABELS in load.js`);
    }
    items.push({
      id: item.id,
      layer: item.layer,
      group_id: item.group,
      label: item.label,
      short_label: short,
      text_blind: !!item.textBlind,
      taxonomy_version: 'v3',
      aliases: EXTRA_ALIASES[item.id] ?? [],
    });
  }
  for (const [id, m] of Object.entries(taxonomy.MODIFIERS)) {
    items.push({ id: `modifier_${id}`, layer: 'modifier', group_id: 'modifier', label: m.label, short_label: null, text_blind: false, taxonomy_version: 'v3', aliases: [] });
  }
  for (const g of groups) g.layer = byGroupLayer.get(g.id) ?? (g.id === 'modifier' || g.id === 'severity' ? 'other' : 'event');
  return { groups, items };
}

// v2 attribute id -> v3 ids, from the `v2` arrays in taxonomy-v3.js.
export function buildV2Map(taxonomy) {
  const map = new Map();
  for (const item of [...taxonomy.PRESENCE, ...taxonomy.EVENTS]) {
    for (const v2 of item.v2 ?? []) {
      if (!map.has(v2)) map.set(v2, []);
      map.get(v2).push(item);
    }
  }
  return map;
}

// ------------------------------------------------------------------------------------------------
// Building one film's rows
// ------------------------------------------------------------------------------------------------

const overlapMs = (aStart, aEnd, bStart, bEnd) => Math.max(0, Math.min(aEnd, bEnd) - Math.max(aStart, bStart));

/**
 * Everything one film's rows are built from, gathered off disk.
 *
 * It exists so `buildFilmFrom` never touches the file system. The loader reads the experiment's
 * outputs; the live pipeline (scene-api/pipeline) hands the same five things over in memory, having
 * just produced them. Both then go through exactly one piece of mapping code, which is the point:
 * a film added live must land in the database the same shape as a film loaded from a file, or the
 * API is answering two different questions depending on where a row came from.
 *
 * @returns {{
 *   slug: string, meta: object, srtText: string, releaseLabel: string|null,
 *   sceneRun: object, sceneScript: string, sceneSourceFile: string|null,
 *   r2Scenes: Array|null,
 *   presenceRun: object|null, presenceScript: string, presenceSourceFile: string|null,
 *   jevRun: object|null, jevScript: string, jevSourceFile: string|null,
 * }}
 */
export function readFilmInputs(slug, { dir, films, tracksMeta }) {
  const meta = films[slug];
  if (!meta) throw new Error(`${slug} is not in films.json`);

  const srtPath = path.join(dir, 'data', `${slug}.srt`);
  if (!fs.existsSync(srtPath)) throw new Error(`missing ${srtPath}`);

  const sceneSrc = sceneSourceFor(dir, slug);
  if (!fs.existsSync(sceneSrc.file)) throw new Error(`missing scene file ${sceneSrc.file}`);
  const sceneRun = readJson(sceneSrc.file);

  const presencePath = findPresenceRun(dir, slug);
  const jevPath = findJevRun(dir, slug);

  return {
    slug,
    meta,
    srtText: fs.readFileSync(srtPath, 'utf8'),
    releaseLabel: slug === 'nemo'
      ? (sceneRun.release?.subtitle_track ?? tracksMeta.sdh?.release ?? null)
      : null,
    sceneRun,
    sceneScript: sceneSrc.script,
    sceneSourceFile: path.relative(dir, sceneSrc.file),
    r2Scenes: sceneSrc.second ? readJson(sceneSrc.second).scenes ?? [] : null,
    presenceRun: presencePath ? readJson(presencePath) : null,
    presenceScript: 'run-sonnet-presence.js',
    presenceSourceFile: presencePath ? path.relative(dir, presencePath) : null,
    jevRun: jevPath ? readJson(jevPath) : null,
    jevScript: 'run-jev-v3.js',
    jevSourceFile: jevPath ? path.relative(dir, jevPath) : null,
  };
}

export function buildFilm(slug, ctx) {
  return buildFilmFrom(readFilmInputs(slug, ctx), ctx);
}

export function buildFilmFrom(inputs, ctx) {
  const { srt, v2map, vocabIds } = ctx;
  const {
    slug, meta, srtText, releaseLabel, sceneRun, sceneScript, sceneSourceFile, r2Scenes,
    presenceRun, presenceScript, presenceSourceFile, jevRun, jevScript, jevSourceFile,
  } = inputs;
  const report = {
    slug,
    temporary_v2_mapping: {},
    presence_only_v2_superseded: {},
    scenes_without_jev_beats: [],
    scenes_without_presence_run: [],
    notes: [],
  };

  // --- track ---
  const cues = srt.parseSrt(srtText);
  const sha256 = crypto.createHash('sha256').update(srtText).digest('hex');
  const soundCaptionCount = cues.filter((c) => SOUND_CAPTION.test(c.text)).length;

  const movie = sceneRun.movie ?? {};
  const trackId = `${slug}:opensubtitles`;
  if (!releaseLabel) report.notes.push('release label not recorded for this subtitle file; only the sha256 identifies it');

  const track = {
    id: trackId,
    film_id: slug,
    source: 'opensubtitles',
    release_label: releaseLabel,
    language: 'en',
    has_sound_captions: soundCaptionCount >= 20,
    cue_count: cues.length,
    duration_ms: cues[cues.length - 1].endMs,
    sha256,
  };

  const film = {
    id: slug,
    slug,
    title: meta.title ?? movie.title ?? slug,
    year: meta.year ?? movie.year ?? null,
    imdb_id: meta.imdb_id ?? movie.imdb_id ?? null,
    // Both filled in by loadAll when TMDB_API_KEY is in the environment; null otherwise, and the
    // UI draws its labelled placeholder and shows no synopsis. Never a guessed or constructed URL,
    // and never a synopsis written here: the words are TMDB's or there are none.
    poster_url: null,
    overview: null,
  };

  const anchors = pickAnchors(cues).map((a) => ({ id: `${trackId}:${a.position}`, track_id: trackId, ...a }));
  if (anchors.length < 3) report.notes.push(`only ${anchors.length} anchors met the rules`);

  // --- runs ---
  const runs = [];
  const labellerId = `${slug}:labeller`;
  runs.push({
    id: labellerId,
    film_id: slug,
    track_id: trackId,
    role: 'labeller',
    model: sceneRun.model ?? sceneRun.analysis_run?.labeller ?? 'claude-sonnet-5',
    taxonomy_version: sceneRun.taxonomy ?? sceneRun.analysis_run?.taxonomy ?? 'taxonomy-v2',
    script: sceneScript,
    started_at: sceneRun.started_at ?? sceneRun.analysis_run?.started_at ?? null,
    cost_usd: sceneRun.cost_usd ?? sceneRun.analysis_run?.cost_usd?.labeller ?? null,
    source_file: sceneSourceFile,
  });
  if (sceneRun.analysis_run?.detector) {
    runs.push({
      id: `${slug}:finder`,
      film_id: slug,
      track_id: trackId,
      role: 'finder',
      model: sceneRun.analysis_run.detector,
      taxonomy_version: sceneRun.analysis_run.taxonomy ?? null,
      script: 'run-jev-v3.js',
      started_at: sceneRun.analysis_run.started_at ?? null,
      cost_usd: sceneRun.analysis_run.cost_usd?.detector ?? null,
      source_file: sceneRun.analysis_run.detector_run ?? null,
    });
  }

  // --- presence, from Claude, one call per scene: the authority for what is in a scene ---
  let presenceByScene = new Map();
  let presenceModel = null;
  if (!presenceRun) {
    report.notes.push('no sonnet-presence run found: nothing in this film is asserted present; run experiments/trigger-scan/run-sonnet-presence.js --film ' + slug);
  } else {
    presenceModel = presenceRun.model ?? 'claude-sonnet-5';
    presenceByScene = new Map((presenceRun.scenes ?? []).map((s) => [s.id, s]));
    runs.push({
      id: `${slug}:presence`,
      film_id: slug,
      track_id: trackId,
      role: 'presence',
      model: presenceModel,
      taxonomy_version: presenceRun.taxonomy ?? 'v3',
      script: presenceScript,
      started_at: presenceRun.startedAt ?? null,
      cost_usd: presenceRun.cost_usd ?? null,
      source_file: presenceSourceFile,
    });
  }

  // --- the Jev v3 beat run: kept as a second opinion, never as an assertion ---
  let beats = [];
  if (!jevRun) {
    report.notes.push('no jev-v3 v3b run found: no second opinion on presence for this film');
  } else {
    beats = jevRun.beats ?? [];
    runs.push({
      id: `${slug}:presence-screen`,
      film_id: slug,
      track_id: trackId,
      role: 'presence',
      model: jevRun.model ?? 'jev-1.13.0',
      taxonomy_version: jevRun.taxonomy ?? 'v3',
      script: jevScript,
      started_at: jevRun.startedAt ?? null,
      cost_usd: jevRun.costUsd ?? null,
      source_file: jevSourceFile,
    });
  }

  // --- second run, for confirmation ---
  const r2 = r2Scenes;

  // --- scenes and labels ---
  const cueById = new Map(cues.map((c) => [c.id, c]));
  const scenes = [];
  const labels = [];
  let labelSeq = 0;
  // One row per (scene, item, channel, source). `sourceTag` keeps the primary key readable.
  const pushLabel = (sceneId, vocabularyId, channel, source, sourceTag, extra = {}) => {
    if (!vocabIds.has(vocabularyId)) throw new Error(`vocabulary id ${vocabularyId} is not in taxonomy v3`);
    labels.push({
      id: `${sceneId}:${channel}:${vocabularyId}:${sourceTag}`,
      scene_id: sceneId,
      vocabulary_id: vocabularyId,
      channel,
      source,
      probability: extra.probability ?? null,
      asserted: !!extra.asserted,
      confidence_kind: extra.confidence_kind ?? null,
      detail: extra.detail ?? null,
      review_status: 'unreviewed',
    });
    labelSeq += 1;
  };

  for (const sc of sceneRun.scenes) {
    const id = `${slug}:${sc.id}`;
    if (!cueById.has(sc.start_cue) || !cueById.has(sc.end_cue)) {
      report.notes.push(`scene ${sc.id} names cues (${sc.start_cue}..${sc.end_cue}) that are not in the track; skipped`);
      continue;
    }
    if (!(sc.end_ms > sc.start_ms)) {
      report.notes.push(`scene ${sc.id} has end_ms <= start_ms; skipped`);
      continue;
    }

    let confirmed = null;
    if (r2) {
      const dur = sc.end_ms - sc.start_ms;
      const best = r2.reduce((m, o) => Math.max(m, overlapMs(sc.start_ms, sc.end_ms, o.start_ms, o.end_ms)), 0);
      confirmed = best >= dur / 2;
    }

    scenes.push({
      id,
      film_id: slug,
      track_id: trackId,
      run_id: labellerId,
      start_ms: sc.start_ms,
      end_ms: sc.end_ms,
      start_cue: sc.start_cue,
      end_cue: sc.end_cue,
      title: sc.title,
      severity_5_7: sc.severity?.['5-7'] ?? null,
      severity_8_10: sc.severity?.['8-10'] ?? null,
      confirmed_by_second_run: confirmed,
      text_visibility: sc.text_visibility ?? null,
      review_status: 'unreviewed',
      description: sc.description ?? null,
    });

    // --- EVENTS: v2 attribute ids from the scene labeller, through taxonomy-v3's `v2` arrays ---
    const labeller = sceneRun.model ?? sceneRun.analysis_run?.labeller ?? 'claude-sonnet-5';
    const eventDetails = new Map(); // v3 event id -> the details v3 has no id for
    const events = new Set();
    for (const attr of sc.attributes ?? []) {
      const temp = TEMPORARY_V2_MAPPING[attr.id];
      if (temp) {
        // No v3 successor yet. Fold into the nearest event and keep what is lost in `detail`.
        report.temporary_v2_mapping[attr.id] = (report.temporary_v2_mapping[attr.id] ?? 0) + 1;
        events.add(temp.to);
        const have = eventDetails.get(temp.to) ?? [];
        if (!have.includes(temp.detail)) eventDetails.set(temp.to, [...have, temp.detail]);
        continue;
      }
      const targets = v2map.get(attr.id) ?? [];
      if (!targets.length) {
        throw new Error(`taxonomy-v2 attribute "${attr.id}" (scene ${id}) has no taxonomy-v3 successor and no entry in TEMPORARY_V2_MAPPING — add one before loading`);
      }
      const eventTargets = targets.filter((t) => t.layer === 'event');
      if (eventTargets.length) {
        for (const e of eventTargets) events.add(e.id);
        continue;
      }
      // Presence-only v2 ids. Presence now comes from its own per-scene run, so these add nothing
      // and are only reported.
      report.presence_only_v2_superseded[attr.id] = (report.presence_only_v2_superseded[attr.id] ?? 0) + 1;
    }
    for (const eventId of events) {
      pushLabel(id, eventId, 'event', labeller, 'labeller', {
        asserted: true,
        detail: eventDetails.get(eventId)?.join('; ') ?? null,
      });
    }

    // --- PRESENCE, asserted: the per-scene Claude run ---
    const asserted = { presence: new Set(), mention: new Set() };
    const p = presenceByScene.get(sc.id);
    if (p) {
      for (const item of p.present ?? []) {
        if (!vocabIds.has(item.id) || asserted.presence.has(item.id)) continue;
        asserted.presence.add(item.id);
        pushLabel(id, item.id, 'presence', presenceModel, 'scene', {
          asserted: true,
          confidence_kind: item.confidence === 'known_from_film' ? 'known_from_film' : 'stated_in_lines',
        });
      }
      for (const itemId of p.talked_about_only ?? []) {
        if (!vocabIds.has(itemId) || asserted.presence.has(itemId) || asserted.mention.has(itemId)) continue;
        asserted.mention.add(itemId);
        pushLabel(id, itemId, 'mention', presenceModel, 'scene', { asserted: true, confidence_kind: 'stated_in_lines' });
      }
    } else if (presenceRun) {
      // There IS a presence run and this scene is not in it. That is not an error: the presence
      // stage's cost cap can stop part-way through a film, and the line above used to name a
      // variable that has not existed since this function took its inputs as values — so the first
      // film to hit the cap crashed here with a ReferenceError instead of recording the gap. A
      // scene with no presence result simply asserts nothing; the API already reads that as
      // "not assessed" rather than "not there".
      report.scenes_without_presence_run.push(sc.id);
    }

    // --- PRESENCE, second opinion: max Jev probability over the beats overlapping this scene ---
    // Never asserted. The API serves these as "possibly present", and marks the ones that agree
    // with the per-scene run.
    const mine = beats.filter((b) => b.startMs < sc.end_ms && b.endMs > sc.start_ms);
    if (beats.length && !mine.length) report.scenes_without_jev_beats.push(sc.id);
    for (const channel of ['presence', 'mention']) {
      const maxByItem = new Map();
      for (const b of mine) {
        for (const [itemId, prob] of Object.entries(b[channel] ?? {})) {
          if (!vocabIds.has(itemId)) continue;
          maxByItem.set(itemId, Math.max(maxByItem.get(itemId) ?? 0, prob));
        }
      }
      for (const [itemId, prob] of maxByItem) {
        pushLabel(id, itemId, channel, 'jev-1.13.0', 'beats', { probability: prob, asserted: false });
      }
    }
  }

  report.counts = {
    scenes: scenes.length,
    labels: labelSeq,
    asserted_presence: labels.filter((l) => l.channel === 'presence' && l.asserted).length,
    known_from_film: labels.filter((l) => l.confidence_kind === 'known_from_film').length,
    asserted_mentions: labels.filter((l) => l.channel === 'mention' && l.asserted).length,
    events: labels.filter((l) => l.channel === 'event').length,
    anchors: anchors.length,
    beats: beats.length,
    cues: cues.length,
  };
  return { film, track, anchors, runs, scenes, labels, report };
}

// ------------------------------------------------------------------------------------------------
// Posters and synopses
// ------------------------------------------------------------------------------------------------

// TMDB's find endpoint takes an IMDb id directly, so no title guessing is involved: either the id
// resolves to exactly one film and we store what that one record says, or we store null.
export const TMDB_IMAGE_BASE = 'https://image.tmdb.org/t/p/w500';

/** One TMDB lookup may hold the loader up for this long, headers and body together. */
export const POSTER_TIMEOUT_MS = 6000;

/** Nothing about a film is invented here. Both fields are null unless TMDB said them. */
const NO_TMDB_META = { poster_url: null, overview: null };

/**
 * The two things we take from TMDB about a film, in one request: its poster and the synopsis a
 * parent reads under the title.
 *
 * @param {string|null} imdbId
 * @param {{ apiKey?: string|null, fetchImpl?: typeof fetch, timeoutMs?: number }} [opts]
 * @returns {Promise<{ poster_url: string|null, overview: string|null }>} both null for every way
 *   the lookup can fail: no key, no imdb id, a non-OK response, a film with neither, a malformed
 *   body, a thrown request, or a server that never finishes answering. Either field can also come
 *   back null on its own when the record has one and not the other. This is decoration and
 *   context; it never fails a load, and it never hangs one either.
 *
 * The deadline covers the response AND reading its body. `fetch` resolves as soon as the headers
 * arrive, so a signal passed only to the request still leaves `res.json()` free to wait forever on
 * a body that never ends — which is how a six-film load turns into a hang. The AbortController is
 * therefore not cleared until the body has been parsed.
 */
export async function fetchTmdbMeta(
  imdbId,
  { apiKey = null, fetchImpl = globalThis.fetch, timeoutMs = POSTER_TIMEOUT_MS } = {},
) {
  if (!imdbId || !apiKey || typeof fetchImpl !== 'function') return { ...NO_TMDB_META };
  const url = `https://api.themoviedb.org/3/find/${encodeURIComponent(imdbId)}`
    + `?external_source=imdb_id&api_key=${encodeURIComponent(apiKey)}`;
  const controller = new AbortController();
  const deadline = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, { signal: controller.signal });
    if (!res?.ok) return { ...NO_TMDB_META };
    // Still inside the deadline: aborting the controller rejects this too.
    const body = await res.json();
    const hit = body?.movie_results?.[0];
    const p = hit?.poster_path;
    const o = typeof hit?.overview === 'string' ? hit.overview.trim() : '';
    return {
      poster_url: typeof p === 'string' && p.startsWith('/') ? `${TMDB_IMAGE_BASE}${p}` : null,
      // TMDB returns '' for a film it has no synopsis for. An empty paragraph is not a synopsis.
      overview: o.length ? o : null,
    };
  } catch {
    // Includes the AbortError the deadline raises.
    return { ...NO_TMDB_META };
  } finally {
    clearTimeout(deadline);
  }
}

/** The poster on its own, for callers (and tests) that only want that one field. */
export async function fetchPosterUrl(imdbId, opts = {}) {
  return (await fetchTmdbMeta(imdbId, opts)).poster_url;
}

// The api key is read from the environment and passed on; it is never logged, and the URL that
// carries it is never printed.
export async function attachPoster(film, opts = {}) {
  const meta = await fetchTmdbMeta(film.imdb_id, opts);
  film.poster_url = meta.poster_url;
  film.overview = meta.overview;
  return film;
}

// ------------------------------------------------------------------------------------------------
// Writing
// ------------------------------------------------------------------------------------------------

const cols = (row) => Object.keys(row);

async function insertRows(tx, table, rows, { chunk = 400 } = {}) {
  if (!rows.length) return;
  const keys = cols(rows[0]);
  for (let i = 0; i < rows.length; i += chunk) {
    const slice = rows.slice(i, i + chunk);
    const params = [];
    const values = slice.map((row) => {
      const ph = keys.map((k) => { params.push(row[k]); return `$${params.length}`; });
      return `(${ph.join(',')})`;
    });
    await tx.query(`insert into ${table} (${keys.join(',')}) values ${values.join(',')}`, params);
  }
}

/**
 * Replace the site-wide vocabulary from a taxonomy snapshot. LOADER ONLY.
 *
 * Every existing label, short label, alias, grouping and taxonomy version is overwritten from the
 * snapshot passed in. That is the right behaviour for the loader — the whole point of running it is
 * that the files on disk are the truth — and exactly the wrong behaviour for a film being added
 * live, which used to call this on its way past and quietly reverted every hand-corrected label on
 * the site to whatever pipeline/taxonomy-v3.js says. See `ensureVocabulary` for that path.
 */
export async function writeVocabulary(db, taxonomy) {
  const { groups, items } = buildVocabulary(taxonomy);
  // The API caches these rows in module scope; if the loader runs in the same process (server.js
  // --pglite does exactly that) the cache must not outlive the write.
  invalidateVocabularyCache(db);
  await db.withTransaction(async (tx) => {
    for (const g of groups) {
      await tx.query(
        `insert into groups (id, label, layer) values ($1,$2,$3)
         on conflict (id) do update set label = excluded.label, layer = excluded.layer`,
        [g.id, g.label, g.layer],
      );
    }
    for (const v of items) {
      await tx.query(
        `insert into vocabulary (id, layer, group_id, label, short_label, text_blind, taxonomy_version, aliases)
         values ($1,$2,$3,$4,$5,$6,$7,$8)
         on conflict (id) do update set layer = excluded.layer, group_id = excluded.group_id,
           label = excluded.label, short_label = excluded.short_label,
           text_blind = excluded.text_blind,
           taxonomy_version = excluded.taxonomy_version, aliases = excluded.aliases`,
        [v.id, v.layer, v.group_id, v.label, v.short_label, v.text_blind, v.taxonomy_version, v.aliases],
      );
    }
  });
  return { groups: groups.length, items: items.length };
}

/**
 * Make sure every vocabulary row a live film's labels point at exists, and change nothing else.
 *
 * Adding a film needs the foreign keys to resolve on a database the loader has never run against;
 * it does not need, and must not have, the right to rewrite the vocabulary the whole site filters
 * by. So: insert what is missing, leave what is there, and refuse outright if the rows that are
 * there came from a different taxonomy version than the one this pipeline is labelling with —
 * because then the ids mean something else and a silent insert would be the real damage.
 *
 * Takes a transaction rather than a db: it runs inside the caller's, so a film that fails to write
 * does not leave half a vocabulary behind. The cache in lib/data.js is keyed on the db object, so
 * the CALLER invalidates it after the commit — `tx` is a different object and would not match.
 *
 * @returns {Promise<{ inserted: number, taxonomyVersion: string }>}
 * @throws {PipelineError} `vocabulary_mismatch`
 */
export async function ensureVocabulary(tx, taxonomy) {
  const { groups, items } = buildVocabulary(taxonomy);
  const version = items[0]?.taxonomy_version ?? null;

  const { rows: stored } = await tx.query(
    'select distinct taxonomy_version from vocabulary where taxonomy_version is not null',
  );
  const other = stored.map((r) => r.taxonomy_version).filter((v) => v !== version);
  if (other.length) {
    throw fail(
      'vocabulary_mismatch',
      `This database's scene vocabulary is ${other.join(', ')} and this pipeline labels with ${version}, so the labels would not mean the same thing. Reload the vocabulary before adding films.`,
    );
  }

  let inserted = 0;
  for (const g of groups) {
    await tx.query('insert into groups (id, label, layer) values ($1,$2,$3) on conflict (id) do nothing', [g.id, g.label, g.layer]);
  }
  for (const v of items) {
    const res = await tx.query(
      `insert into vocabulary (id, layer, group_id, label, short_label, text_blind, taxonomy_version, aliases)
       values ($1,$2,$3,$4,$5,$6,$7,$8) on conflict (id) do nothing`,
      [v.id, v.layer, v.group_id, v.label, v.short_label, v.text_blind, v.taxonomy_version, v.aliases],
    );
    inserted += res?.rowCount ?? res?.affectedRows ?? 0;
  }
  return { inserted, taxonomyVersion: version };
}

/**
 * The recorded Jev run for one film, for the "Watch it work" replay.
 *
 * It is written separately from `writeFilm` and AFTER it, because deleting the film cascades to
 * `recordings` — a rewrite that put the recording first would delete it again a moment later.
 *
 * `recorded_at` comes from the recording's own `meta.started_at`, not from now(): the row records
 * when the run happened, and re-loading the same file must not move that date.
 */
export async function writeRecordingRows(tx, filmId, { recording, excerpts = null } = {}) {
  await tx.query(
    `insert into recordings (film_id, recording, excerpts, recorded_at) values ($1, $2, $3, $4)
     on conflict (film_id) do update set recording = excluded.recording,
       excerpts = excluded.excerpts, recorded_at = excluded.recorded_at`,
    [
      filmId,
      JSON.stringify(recording),
      excerpts === null || excerpts === undefined ? null : JSON.stringify(excerpts),
      recording?.meta?.started_at ?? null,
    ],
  );
}

export const writeRecording = (db, filmId, payload) => writeRecordingRows(db, filmId, payload);

/**
 * One film's rows, inside somebody else's transaction.
 *
 * `replace: true` deletes the film first, which cascades to tracks, anchors, runs, scenes and
 * labels. That is the LOADER's contract — re-running it over the experiment outputs is meant to
 * rewrite what is there — and it is the wrong contract for a live run, where the film that happens
 * to be sitting on this slug belongs to somebody else. Live ingestion passes `replace: false` and
 * takes the unique-violation instead.
 */
export async function writeFilmRows(tx, built, { replace = true } = {}) {
  if (replace) await tx.query('delete from films where id = $1', [built.film.id]);
  await insertRows(tx, 'films', [built.film]);
  await insertRows(tx, 'tracks', [built.track]);
  await insertRows(tx, 'anchors', built.anchors);
  await insertRows(tx, 'analysis_runs', built.runs);
  await insertRows(tx, 'scenes', built.scenes);
  await insertRows(tx, 'scene_labels', built.labels);
}

/** Replaces one film's rows. The loader's path; see `writeFilmRows`. */
export async function writeFilm(db, built) {
  await db.withTransaction((tx) => writeFilmRows(tx, built, { replace: true }));
}

export async function loadAll(db, {
  slugs = SLUGS,
  experimentDir = DEFAULT_EXPERIMENT_DIR,
  dryRun = false,
  tmdbApiKey = process.env.TMDB_API_KEY ?? null,
  fetchImpl = globalThis.fetch,
  timeoutMs = POSTER_TIMEOUT_MS,
} = {}) {
  const exp = await openExperiment(experimentDir);
  const { items } = buildVocabulary(exp.taxonomy);
  const ctx = {
    dir: exp.dir,
    srt: exp.srt,
    films: exp.films,
    tracksMeta: exp.tracksMeta,
    v2map: buildV2Map(exp.taxonomy),
    vocabIds: new Set(items.map((i) => i.id)),
  };
  if (!dryRun) {
    await applySchema(db);
    await writeVocabulary(db, exp.taxonomy);
  }
  const reports = [];
  let posters = 0;
  let overviews = 0;
  let recordings = 0;
  let excerptFiles = 0;
  for (const slug of slugs) {
    const built = buildFilm(slug, ctx);
    if (tmdbApiKey) {
      await attachPoster(built.film, { apiKey: tmdbApiKey, fetchImpl, timeoutMs });
      if (built.film.poster_url) posters += 1;
      else built.report.notes.push('no poster came back from TMDB for this film');
      if (built.film.overview) overviews += 1;
      else built.report.notes.push('no synopsis came back from TMDB for this film');
    }
    if (!dryRun) await writeFilm(db, built);
    // The recording is optional: a film without one simply has no "Watch it work" page.
    const rec = findRecording(exp.dir, slug);
    if (rec) {
      recordings += 1;
      if (rec.excerpts) excerptFiles += 1;
      else built.report.notes.push('recording has no excerpt file beside it (recordings/<slug>.excerpts.json is git-ignored); the replay works, the beat lines do not');
      built.report.counts_recording = {
        beats: rec.recording?.beats?.length ?? 0,
        flagged: rec.recording?.thresholds?.flagged_beats ?? 0,
        excerpt_beats: rec.excerpts ? Object.keys(rec.excerpts).length : 0,
      };
      if (!dryRun) await writeRecording(db, built.film.id, rec);
    } else {
      built.report.notes.push('no recording found: this film has no "Watch it work" replay; run experiments/trigger-scan/record-jev-run.js --film ' + slug);
    }
    reports.push(built.report);
  }
  return { reports, vocabulary: items.length, posters, overviews, postersLookedUp: !!tmdbApiKey, recordings, excerptFiles };
}

export function formatReport(reports) {
  const lines = [];
  const pad = '                 ';
  for (const r of reports) {
    const c = r.counts;
    lines.push(`${r.slug.padEnd(14)} scenes ${String(c.scenes).padStart(3)}  present ${String(c.asserted_presence).padStart(3)} (${c.known_from_film} known_from_film)  talked-about ${String(c.asserted_mentions).padStart(2)}  events ${String(c.events).padStart(3)}  rows ${String(c.labels).padStart(5)}  anchors ${c.anchors}  cues ${c.cues}`);
    if (r.counts_recording) {
      const cr = r.counts_recording;
      lines.push(`${pad}recording: ${cr.beats} beats, ${cr.flagged} flagged, excerpts for ${cr.excerpt_beats}`);
    }
    for (const n of r.notes) lines.push(`${pad}note: ${n}`);
    for (const [id, n] of Object.entries(r.temporary_v2_mapping)) {
      const t = TEMPORARY_V2_MAPPING[id];
      lines.push(`${pad}TEMPORARY MAPPING: taxonomy-v2 "${id}" x${n} has no v3 successor -> event "${t.to}" with detail "${t.detail}" (taxonomy v4 should give it an id)`);
    }
    for (const [id, n] of Object.entries(r.presence_only_v2_superseded)) lines.push(`${pad}presence-only v2 id "${id}" x${n} not used: presence now comes from the per-scene run`);
    if (r.scenes_without_jev_beats.length) lines.push(`${pad}scenes with no overlapping Jev beat: ${r.scenes_without_jev_beats.join(', ')}`);
    if (r.scenes_without_presence_run.length) lines.push(`${pad}scenes missing from the presence run: ${r.scenes_without_presence_run.join(', ')}`);
  }
  return lines.join('\n');
}

// ------------------------------------------------------------------------------------------------
// CLI
// ------------------------------------------------------------------------------------------------

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const argv = process.argv.slice(2);
  const arg = (name) => { const i = argv.indexOf(`--${name}`); return i === -1 ? null : argv[i + 1]; };
  const dryRun = argv.includes('--dry-run');
  const slugs = arg('film') ? [arg('film')] : SLUGS;
  const experimentDir = arg('experiment-dir') ?? DEFAULT_EXPERIMENT_DIR;

  let db = null;
  if (!dryRun) {
    if (!process.env.DATABASE_URL) {
      console.error('DATABASE_URL is not set. Use --dry-run to build and report without writing.');
      process.exit(1);
    }
    const { default: pg } = await import('pg');
    const url = process.env.DATABASE_URL;
    db = pgAdapter(guardPool(new pg.Pool({
      connectionString: url,
      ssl: /neon\.tech|sslmode=require/.test(url) ? { rejectUnauthorized: false } : undefined,
    }), 'load'));
  }
  const started = Date.now();
  const { reports, vocabulary, posters, overviews, postersLookedUp, recordings, excerptFiles } = await loadAll(db ?? { withTransaction: async () => {}, exec: async () => {}, query: async () => ({ rows: [] }) }, { slugs, experimentDir, dryRun });
  console.log(formatReport(reports));
  console.log(`\nvocabulary items: ${vocabulary}`);
  console.log(`recordings: ${recordings} of ${slugs.length} films (${excerptFiles} with excerpts)`);
  console.log(postersLookedUp
    ? `posters from TMDB: ${posters} of ${slugs.length}\nsynopses from TMDB: ${overviews} of ${slugs.length}`
    : 'posters and synopses: TMDB_API_KEY is not set, so poster_url and overview are null (the UI draws a placeholder and shows no synopsis)');
  console.log(dryRun ? '\nDRY RUN — nothing was written.' : `\nwritten to DATABASE_URL in ${((Date.now() - started) / 1000).toFixed(1)}s`);
  console.log(`schema: ${path.join(root, 'schema.sql')}`);
  if (db) await db.end();
}
