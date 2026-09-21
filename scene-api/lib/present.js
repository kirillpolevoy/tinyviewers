// Shaping database rows into the JSON an assistant reads, plus the honesty block that has to
// travel with every answer.

import { formatHms, applyMapping, IDENTITY } from './time.js';

export const TAXONOMY_VERSION = 'v3';

// Facts about how these rows were produced. They are not decoration: an assistant that repeats a
// scene list to a parent without them is overselling it.
export function caveats({ film, track, runs, sceneCount, reviewedCount, filtered = false }) {
  return {
    // Careful: this must never be read as "the list in this response is complete". It is a
    // statement about the FILM, and a filtered or paged response is a subset of it.
    complete_for_this_film: `Our analysis of this subtitle track produced ${sceneCount} scenes for ${film.title} in total, and that set is complete rather than a sample: if a moment is not among those ${sceneCount}, our analysis did not flag it.${filtered ? ' The scenes in THIS response are the subset matching the filters and paging you asked for — see counts.matching for how many matched in all, and counts.returned for how many came back.' : ''}`,
    derived_from_subtitles_only: 'Every scene was found by reading the subtitle file and nothing else. No one and nothing watched the picture. Purely visual frights (a sudden face, a dark shape, blood on screen), flashing or strobing light, and loud scoring with no dialogue are NOT covered and can be missed entirely.',
    machine_generated: `Titles, descriptions, severities and labels were written by language models (${[...new Set(runs.map((r) => r.model))].join(', ') || 'unknown'}), not by a person.`,
    human_review: reviewedCount > 0
      ? `${reviewedCount} of ${sceneCount} scenes have review_status other than "unreviewed". Trust a scene only as far as its review_status says.`
      : 'No scene in this film has been checked by a human. Every scene carries review_status "unreviewed". Say so to the parent.',
    missing_label_is_not_absence: 'A label that is absent means "our analysis did not assert it", never "it is not in the scene". Each scene carries a not_assessed list of the things subtitles are blind to; for those, absence tells you nothing at all.',
    how_sure_we_are: 'Each scene sorts what it knows into four buckets, and they do not mean the same thing. present = a per-scene judgement says it is there, with evidence "stated_in_lines" (the dialogue shows it) or "known_from_film" (the model says it is on screen from knowing the film, which our own data does not corroborate). possibly_present = only a cheap per-beat screener leaned that way; it over-flags badly, so treat it as a lead. talked_about_only = in the dialogue but not in the scene. not_assessed = nobody could look.',
    timestamps_belong_to_one_release: `All times are on the clock of the subtitle track "${track?.release_label ?? track?.id}" (${track?.cue_count ?? '?'} cues, ends at ${formatHms(Number(track?.duration_ms ?? 0))}). Another release of ${film.title} can be shifted by tens of seconds and, between NTSC and PAL, run about 4% faster. Calibrate before quoting a time: see the calibration section of /api/openapi.json.`,
    severity_scale: 'severity_5_7 and severity_8_10 run 0 (nothing) to 3 (a creature attacks someone, a child is taken from a parent, someone dies or appears to die). They are one model\'s judgement of a subtitle passage, not a rating from any board.',
    confirmation: 'confirmed_by_second_run is true when an independent second pass over the same subtitles found an overlapping scene, false when it did not, and null when no second pass was run for this film. It is a consistency check, not a correctness check.',
  };
}

export function bandFor(ageParam) {
  // Returns { band, note }.
  if (ageParam === null || ageParam === undefined) return { band: '5-7', note: null, defaulted: true };
  const raw = String(ageParam).trim().toLowerCase();
  if (raw === '5-7' || raw === '5_7') return { band: '5-7', note: null };
  if (raw === '8-10' || raw === '8_10') return { band: '8-10', note: null };
  if (/^\d{1,2}$/.test(raw)) {
    const age = Number(raw);
    if (age < 5) {
      return {
        band: '5-7',
        note: `This database has severity bands for ages 5-7 and 8-10 only. Age ${age} was answered with the 5-7 band, which is the closest we have — it is very likely to UNDERSTATE how frightening a scene is for a child of ${age}. Tell the parent that.`,
      };
    }
    if (age <= 7) return { band: '5-7', note: null };
    if (age <= 10) return { band: '8-10', note: null };
    return { band: '8-10', note: `Age ${age} was answered with the 8-10 band, the oldest we have.` };
  }
  return { band: null, note: null, invalid: true };
}

// A per-beat detector probability at or above this is worth reporting as "possibly present".
export const POSSIBLE_THRESHOLD = 0.7;

const round2 = (p) => (p === null || p === undefined ? null : Math.round(Number(p) * 100) / 100);

// One scene, in both timelines, with its labels grouped the way a parent's question splits.
//
// Four states, and the difference between them is the whole point:
//   present            a per-scene judgement says it is there
//   possibly_present   only the per-beat screener leaned that way; it over-flags, so this is a lead
//   talked_about_only  in the dialogue, not in the scene
//   not_assessed       subtitles are blind to it and nobody looked; absence means nothing
export function shapeScene(scene, labels, textBlindIds, mapping) {
  const mine = labels.filter((l) => l.scene_id === scene.id);

  const shape = (l, extra = {}) => ({
    id: l.vocabulary_id,
    label: l.label,
    group: l.group_id,
    group_label: l.group_label,
    source: l.source,
    review_status: l.review_status,
    ...(l.detail ? { detail: l.detail } : {}),
    ...extra,
  });

  // Anything the per-beat screener leaned towards, by channel, for cross-referencing.
  const screener = { presence: new Map(), mention: new Map() };
  for (const l of mine) {
    if (l.asserted || l.channel === 'event' || l.probability === null) continue;
    screener[l.channel]?.set(l.vocabulary_id, Number(l.probability));
  }

  const assertedIn = (channel) => mine.filter((l) => l.channel === channel && l.asserted);

  const presence = assertedIn('presence').map((l) => {
    const p = screener.presence.get(l.vocabulary_id);
    return shape(l, {
      evidence: l.confidence_kind ?? 'stated_in_lines',
      evidence_meaning: l.confidence_kind === 'known_from_film'
        ? 'the model says this is on screen from knowing the film; the subtitles do not show it'
        : 'the subtitle lines of this scene show it',
      both_sources_agree: p !== undefined && p >= POSSIBLE_THRESHOLD,
      ...(p === undefined ? {} : { screener_probability: round2(p) }),
    });
  });
  const presentIds = new Set(presence.map((x) => x.id));

  const talkedAbout = assertedIn('mention')
    .filter((l) => !presentIds.has(l.vocabulary_id))
    .map((l) => {
      const p = screener.mention.get(l.vocabulary_id);
      return shape(l, { both_sources_agree: p !== undefined && p >= POSSIBLE_THRESHOLD });
    });
  const mentionIds = new Set(talkedAbout.map((x) => x.id));

  const events = assertedIn('event').map((l) => shape(l, { probability: null }));

  // Screener-only leads. Text-blind items are excluded: a per-beat guess about something the
  // subtitles cannot see is not a lead, it is noise.
  const possible = (channel, exclude) => mine
    .filter((l) => l.channel === channel && !l.asserted && !l.text_blind
      && l.probability !== null && Number(l.probability) >= POSSIBLE_THRESHOLD
      && !exclude.has(l.vocabulary_id))
    .map((l) => shape(l, {
      probability: round2(l.probability),
      note: 'only the per-beat screener suggests this, and it over-flags. Treat it as a lead to check, not as a fact.',
    }))
    .sort((a, b) => b.probability - a.probability);

  const possiblyPresent = possible('presence', presentIds);
  const possiblyTalkedAbout = possible('mention', new Set([...presentIds, ...mentionIds, ...possiblyPresent.map((x) => x.id)]));

  // "Assessed" means somebody decided whether the thing is IN the scene. A mention label says the
  // dialogue brought it up while it was NOT there, which settles nothing about whether it is on
  // screen — so a mention must not quietly remove a text-blind item from not_assessed.
  const labelledIds = new Set(mine.filter((l) => l.asserted && l.channel !== 'mention').map((l) => l.vocabulary_id));
  const notAssessed = textBlindIds
    .filter((v) => !labelledIds.has(v.id))
    .map((v) => ({ id: v.id, label: v.label, why: 'subtitles usually cannot see this; no label here means unknown, not absent' }));

  const start = Number(scene.start_ms);
  const end = Number(scene.end_ms);
  const out = {
    id: scene.id,
    title: scene.title,
    description: scene.description,
    track_time: {
      start_ms: start,
      end_ms: end,
      start: formatHms(start),
      end: formatHms(end),
      duration_s: Math.round((end - start) / 100) / 10,
    },
    start_cue: scene.start_cue,
    end_cue: scene.end_cue,
    severity: { '5-7': scene.severity_5_7, '8-10': scene.severity_8_10 },
    present: presence,
    possibly_present: possiblyPresent,
    talked_about_only: talkedAbout,
    possibly_talked_about: possiblyTalkedAbout,
    events,
    not_assessed: notAssessed,
    confirmed_by_second_run: scene.confirmed_by_second_run,
    review_status: scene.review_status,
    text_visibility: scene.text_visibility,
  };

  const calibrated = mapping && (mapping.offset_ms !== 0 || mapping.scale !== 1);
  if (calibrated) {
    // A plausible mapping can still put the very first scene a few seconds before zero when the
    // parent's copy trims a logo. A negative clock time is meaningless to them, so it is pinned to
    // the start of the film and the pinning is declared. Wildly negative mappings never reach here
    // — resolveCalibration rejects them with a 400.
    const raw = { start: applyMapping(start, mapping), end: applyMapping(end, mapping) };
    const pinned = raw.start < 0 || raw.end < 0;
    const s = Math.max(0, raw.start);
    const e = Math.max(0, raw.end);
    out.player_time = {
      start_ms: s,
      end_ms: e,
      start: formatHms(s),
      end: formatHms(e),
      ...(pinned ? { note: 'the calibration put this scene slightly before the start of their copy, so it is pinned to 0:00:00' } : {}),
    };
  } else {
    out.player_time = { ...out.track_time, note: 'no calibration was requested or none was needed, so this is the same as track_time' };
  }
  return out;
}

export const identityMapping = () => ({ ...IDENTITY });
