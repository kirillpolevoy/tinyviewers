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
    items.push({
      id: item.id,
      layer: item.layer,
      group_id: item.group,
      label: item.label,
      text_blind: !!item.textBlind,
      taxonomy_version: 'v3',
      aliases: EXTRA_ALIASES[item.id] ?? [],
    });
  }
  for (const [id, m] of Object.entries(taxonomy.MODIFIERS)) {
    items.push({ id: `modifier_${id}`, layer: 'modifier', group_id: 'modifier', label: m.label, text_blind: false, taxonomy_version: 'v3', aliases: [] });
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

export function buildFilm(slug, ctx) {
  const { dir, srt, films, tracksMeta, v2map, vocabIds } = ctx;
  const report = {
    slug,
    temporary_v2_mapping: {},
    presence_only_v2_superseded: {},
    scenes_without_jev_beats: [],
    scenes_without_presence_run: [],
    notes: [],
  };

  const meta = films[slug];
  if (!meta) throw new Error(`${slug} is not in films.json`);

  // --- track ---
  const srtPath = path.join(dir, 'data', `${slug}.srt`);
  if (!fs.existsSync(srtPath)) throw new Error(`missing ${srtPath}`);
  const raw = fs.readFileSync(srtPath, 'utf8');
  const cues = srt.parseSrt(raw);
  const sha256 = crypto.createHash('sha256').update(raw).digest('hex');
  const soundCaptionCount = cues.filter((c) => SOUND_CAPTION.test(c.text)).length;

  const sceneSrc = sceneSourceFor(dir, slug);
  if (!fs.existsSync(sceneSrc.file)) throw new Error(`missing scene file ${sceneSrc.file}`);
  const sceneRun = readJson(sceneSrc.file);
  const movie = sceneRun.movie ?? {};

  const trackId = `${slug}:opensubtitles`;
  const releaseLabel = slug === 'nemo'
    ? (sceneRun.release?.subtitle_track ?? tracksMeta.sdh?.release ?? null)
    : null;
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
    script: sceneSrc.script,
    started_at: sceneRun.started_at ?? sceneRun.analysis_run?.started_at ?? null,
    cost_usd: sceneRun.cost_usd ?? sceneRun.analysis_run?.cost_usd?.labeller ?? null,
    source_file: path.relative(dir, sceneSrc.file),
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
  const presencePath = findPresenceRun(dir, slug);
  let presenceByScene = new Map();
  let presenceModel = null;
  if (!presencePath) {
    report.notes.push('no sonnet-presence run found: nothing in this film is asserted present; run experiments/trigger-scan/run-sonnet-presence.js --film ' + slug);
  } else {
    const run = readJson(presencePath);
    presenceModel = run.model ?? 'claude-sonnet-5';
    presenceByScene = new Map((run.scenes ?? []).map((s) => [s.id, s]));
    runs.push({
      id: `${slug}:presence`,
      film_id: slug,
      track_id: trackId,
      role: 'presence',
      model: presenceModel,
      taxonomy_version: run.taxonomy ?? 'v3',
      script: 'run-sonnet-presence.js',
      started_at: run.startedAt ?? null,
      cost_usd: run.cost_usd ?? null,
      source_file: path.relative(dir, presencePath),
    });
  }

  // --- the Jev v3 beat run: kept as a second opinion, never as an assertion ---
  const jevPath = findJevRun(dir, slug);
  let beats = [];
  if (!jevPath) {
    report.notes.push('no jev-v3 v3b run found: no second opinion on presence for this film');
  } else {
    const jev = readJson(jevPath);
    beats = jev.beats ?? [];
    runs.push({
      id: `${slug}:presence-screen`,
      film_id: slug,
      track_id: trackId,
      role: 'presence',
      model: jev.model ?? 'jev-1.13.0',
      taxonomy_version: jev.taxonomy ?? 'v3',
      script: 'run-jev-v3.js',
      started_at: jev.startedAt ?? null,
      cost_usd: jev.costUsd ?? null,
      source_file: path.relative(dir, jevPath),
    });
  }

  // --- second run, for confirmation ---
  const r2 = sceneSrc.second ? readJson(sceneSrc.second).scenes ?? [] : null;

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
    } else if (presencePath) {
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
        `insert into vocabulary (id, layer, group_id, label, text_blind, taxonomy_version, aliases)
         values ($1,$2,$3,$4,$5,$6,$7)
         on conflict (id) do update set layer = excluded.layer, group_id = excluded.group_id,
           label = excluded.label, text_blind = excluded.text_blind,
           taxonomy_version = excluded.taxonomy_version, aliases = excluded.aliases`,
        [v.id, v.layer, v.group_id, v.label, v.text_blind, v.taxonomy_version, v.aliases],
      );
    }
  });
  return { groups: groups.length, items: items.length };
}

// Replaces one film's rows. Deleting the film cascades to tracks, anchors, runs, scenes, labels.
export async function writeFilm(db, built) {
  await db.withTransaction(async (tx) => {
    await tx.query('delete from films where id = $1', [built.film.id]);
    await insertRows(tx, 'films', [built.film]);
    await insertRows(tx, 'tracks', [built.track]);
    await insertRows(tx, 'anchors', built.anchors);
    await insertRows(tx, 'analysis_runs', built.runs);
    await insertRows(tx, 'scenes', built.scenes);
    await insertRows(tx, 'scene_labels', built.labels);
  });
}

export async function loadAll(db, { slugs = SLUGS, experimentDir = DEFAULT_EXPERIMENT_DIR, dryRun = false } = {}) {
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
  for (const slug of slugs) {
    const built = buildFilm(slug, ctx);
    if (!dryRun) await writeFilm(db, built);
    reports.push(built.report);
  }
  return { reports, vocabulary: items.length };
}

export function formatReport(reports) {
  const lines = [];
  const pad = '                 ';
  for (const r of reports) {
    const c = r.counts;
    lines.push(`${r.slug.padEnd(14)} scenes ${String(c.scenes).padStart(3)}  present ${String(c.asserted_presence).padStart(3)} (${c.known_from_film} known_from_film)  talked-about ${String(c.asserted_mentions).padStart(2)}  events ${String(c.events).padStart(3)}  rows ${String(c.labels).padStart(5)}  anchors ${c.anchors}  cues ${c.cues}`);
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
  const { reports, vocabulary } = await loadAll(db ?? { withTransaction: async () => {}, exec: async () => {}, query: async () => ({ rows: [] }) }, { slugs, experimentDir, dryRun });
  console.log(formatReport(reports));
  console.log(`\nvocabulary items: ${vocabulary}`);
  console.log(dryRun ? '\nDRY RUN — nothing was written.' : `\nwritten to DATABASE_URL in ${((Date.now() - started) / 1000).toFixed(1)}s`);
  console.log(`schema: ${path.join(root, 'schema.sql')}`);
  if (db) await db.end();
}
