// The four data endpoints, as plain async functions of (db, params) -> body. The files under
// api/ are thin Vercel-shaped wrappers around these, and the tests call them directly.

import { badRequest, notFound, str, list, int, bool, checkParams } from './http.js';
import * as q from './data.js';
import { matchTerm, matchTerms, matchGroup, suggest, BROAD_TERMS, BROAD_NOTE } from './match.js';
import {
  formatHms, parseClock, offsetFromOneAnchor, mappingFromTwoAnchors, implausibleMapping, IDENTITY,
} from './time.js';
import { caveats, bandFor, shapeScene, POSSIBLE_THRESHOLD } from './present.js';

export const SCENE_LIMIT_DEFAULT = 100;
export const SCENE_LIMIT_MAX = 300;
export const NEAR_MISS_FLOOR = 0.4;

// ------------------------------------------------------------------------------------------------
// GET /api/films
// ------------------------------------------------------------------------------------------------

export async function films(db, rawQuery = {}) {
  const query = checkParams(rawQuery, 'films');
  const term = str(query, 'q', { max: 120 });
  const limit = int(query, 'limit', { min: 1, max: 100, fallback: 25 });
  const rows = await q.searchFilms(db, term, limit);
  return {
    query: term,
    count: rows.length,
    films: rows.map((r) => ({
      slug: r.slug, title: r.title, year: r.year, imdb_id: r.imdb_id,
      scene_count: r.scene_count,
      detail: `/api/films/${r.slug}`,
      scenes: `/api/films/${r.slug}/scenes`,
    })),
    note: rows.length === 0
      ? 'No film matched. This database covers only a handful of films; call /api/films with no q to see all of them.'
      : 'This database covers only the films listed here. A film that is absent has not been analysed, which says nothing about its content.',
  };
}

// ------------------------------------------------------------------------------------------------
// GET /api/films/{slug}
// ------------------------------------------------------------------------------------------------

export async function film(db, slug, rawQuery = {}) {
  const query = checkParams(rawQuery, 'film');
  if (!slug) throw badRequest('A film slug is required, e.g. /api/films/nemo.');
  const f = await q.requireFilm(db, slug);
  const track = await q.getTrack(db, f.id);
  if (!track) throw notFound(`"${slug}" exists but has no analysed subtitle track.`);
  const [anchors, runs, sceneCount, platforms, histogram, reviewedCount, confirmed] = await Promise.all([
    q.getAnchors(db, track.id),
    q.getRuns(db, f.id),
    q.countScenes(db, f.id),
    q.listPlatforms(db, track.id),
    q.getSeverityHistogram(db, f.id),
    q.countReviewedScenes(db, f.id),
    db.query('select count(*)::int as n from scenes where film_id = $1 and confirmed_by_second_run is true', [f.id]),
  ]);

  return {
    film: { slug: f.slug, title: f.title, year: f.year, imdb_id: f.imdb_id },
    track: {
      id: track.id,
      source: track.source,
      release_label: track.release_label,
      release_note: track.release_label
        ? 'All timestamps below belong to this release.'
        : 'The exact release of this subtitle file was not recorded; only the sha256 identifies it. Calibrate with an anchor line before quoting a time.',
      language: track.language,
      has_sound_captions: track.has_sound_captions,
      sound_caption_note: track.has_sound_captions
        ? 'This track has sound captions such as (GASPS), so some wordless moments are visible to the analysis.'
        : 'This track has no sound captions, so wordless moments — a roar, a crash, a scream with no dialogue — were invisible to the analysis.',
      cue_count: track.cue_count,
      subtitle_end: formatHms(Number(track.duration_ms)),
      subtitle_end_ms: Number(track.duration_ms),
      sha256: track.sha256,
    },
    anchors: {
      how_to_use: 'Ask the parent to play the film and note the clock time when one of these lines is spoken, then call /api/films/{slug}/scenes with anchor_cue=<cue_id>&observed_at=<what they saw>. Pass the early and late anchor together (comma separated, in the same order) to also correct for a different playback speed.',
      lines: anchors.map((a) => ({ cue_id: a.cue_id, position: a.position, our_time: formatHms(Number(a.start_ms)), our_time_ms: Number(a.start_ms), quote: a.quote })),
    },
    calibration_platforms: {
      available: platforms,
      note: platforms.length
        ? 'Pass platform=<one of these> instead of anchors.'
        : 'No platform offsets have been measured yet, so the platform parameter will fail for this film. Use anchor_cue + observed_at.',
    },
    counts: {
      scenes: sceneCount,
      scenes_confirmed_by_second_run: confirmed.rows[0].n,
      scenes_human_reviewed: reviewedCount,
      scenes_by_severity_5_7: histogram,
    },
    analysis_runs: runs.map((r) => ({
      role: r.role, model: r.model, taxonomy_version: r.taxonomy_version, script: r.script,
      started_at: r.started_at, cost_usd: r.cost_usd === null ? null : Number(r.cost_usd), source_file: r.source_file,
    })),
    caveats: caveats({ film: f, track, runs, sceneCount, reviewedCount }),
    scenes_url: `/api/films/${f.slug}/scenes`,
  };
}

// ------------------------------------------------------------------------------------------------
// Calibration
// ------------------------------------------------------------------------------------------------

async function resolveCalibration(db, track, query) {
  const platform = str(query, 'platform', { max: 60 });
  const anchorCues = list(query, 'anchor_cue', { maxItems: 2 });
  const observed = list(query, 'observed_at', { maxItems: 2 });

  if (platform && (anchorCues.length || observed.length)) {
    throw badRequest('Use either platform or anchor_cue+observed_at, not both.');
  }

  if (platform) {
    const m = await q.getTimeMapping(db, track.id, platform);
    if (!m) {
      const available = await q.listPlatforms(db, track.id);
      throw badRequest(
        available.length
          ? `No measured time mapping for platform "${platform}". Measured platforms: ${available.join(', ')}.`
          : `No time mappings have been measured for this film yet, so platform="${platform}" cannot be used. Ask the parent to note the clock time of one of the anchor lines from /api/films/${track.film_id} and pass anchor_cue + observed_at instead.`,
        { available },
      );
    }
    return {
      mapping: { offset_ms: Number(m.offset_ms), scale: Number(m.scale) },
      calibration: {
        applied: true, method: 'platform', platform: m.platform,
        offset_ms: Number(m.offset_ms), scale: Number(m.scale),
        measured_how: m.measured_how, confidence: m.confidence,
      },
    };
  }

  if (!anchorCues.length && !observed.length) {
    return {
      mapping: { ...IDENTITY },
      calibration: {
        applied: false,
        method: 'none',
        why: 'No calibration was requested, so player_time is the same as track_time.',
        how_to: `Times are only exact for the subtitle release named in /api/films/${track.film_id}. To pin them to what the parent is watching, ask them for the clock time of one anchor line and pass anchor_cue=<cue_id>&observed_at=<h:mm:ss>. Two anchors (comma separated) also correct a different playback speed.`,
      },
    };
  }

  if (anchorCues.length !== observed.length) {
    throw badRequest(`anchor_cue has ${anchorCues.length} value(s) but observed_at has ${observed.length}. Give one observed_at per anchor_cue, in the same order.`);
  }
  if (anchorCues.length > 2) throw badRequest('At most two anchors can be used.');

  const resolved = [];
  for (let i = 0; i < anchorCues.length; i++) {
    const anchor = await q.getAnchorByCue(db, track.id, anchorCues[i]);
    if (!anchor) {
      const all = await q.getAnchors(db, track.id);
      throw badRequest(
        `"${anchorCues[i]}" is not an anchor line for this film.`,
        { anchors: all.map((a) => ({ cue_id: a.cue_id, position: a.position, our_time: formatHms(Number(a.start_ms)), quote: a.quote })) },
      );
    }
    const ms = parseClock(observed[i]);
    if (ms === null) throw badRequest(`observed_at "${observed[i]}" is not a time. Use seconds (e.g. 186.5) or H:MM:SS (e.g. 0:03:06).`);
    if (ms < 0) throw badRequest(`observed_at "${observed[i]}" is negative.`);
    resolved.push({ anchor, observedMs: ms });
  }

  // Arithmetic cannot tell a right anchor from a wrong one. A parent who reads the clock against
  // the middle line while telling us it was the late one produces a perfectly valid mapping that
  // starts the film an hour before it begins. Check the mapping against the track before using it.
  const guard = (mapping, used) => {
    const why = implausibleMapping(mapping, Number(track.duration_ms));
    if (!why) return;
    throw badRequest(
      `Those observations do not describe a real copy of this film: ${why}. Ask the parent to check they timed the anchor line you named, and that they read the position on the player's clock rather than the time remaining.`,
      {
        anchors_you_used: used.map((r) => ({
          cue_id: r.anchor.cue_id,
          quote: r.anchor.quote,
          our_time: formatHms(Number(r.anchor.start_ms)),
          you_said_they_heard_it_at: formatHms(r.observedMs),
        })),
        film_length_on_our_track: formatHms(Number(track.duration_ms)),
      },
    );
  };

  if (resolved.length === 1) {
    const [{ anchor, observedMs }] = resolved;
    const mapping = offsetFromOneAnchor(Number(anchor.start_ms), observedMs);
    guard(mapping, resolved);
    return {
      mapping,
      calibration: {
        applied: true,
        method: 'one_anchor',
        offset_ms: mapping.offset_ms,
        scale: 1,
        anchors_used: [{ cue_id: anchor.cue_id, quote: anchor.quote, our_time: formatHms(Number(anchor.start_ms)), their_time: formatHms(observedMs) }],
        assumption: 'One anchor can only find a constant shift. It assumes both releases run at the same speed; a PAL transfer does not, so the error grows across the film. Use two anchors far apart if the parent can give them.',
      },
    };
  }

  const [a, b] = resolved;
  const out = mappingFromTwoAnchors(Number(a.anchor.start_ms), a.observedMs, Number(b.anchor.start_ms), b.observedMs);
  if (out.error) throw badRequest(out.error);
  guard(out, resolved);
  const drift = (out.scale - 1) * 100;
  return {
    mapping: out,
    calibration: {
      applied: true,
      method: 'two_anchors',
      offset_ms: out.offset_ms,
      scale: Number(out.scale.toFixed(6)),
      speed_note: Math.abs(out.scale - 1) < 0.001
        ? 'The two releases run at the same speed; only the start differs.'
        : `Their copy runs ${Math.abs(drift).toFixed(1)}% ${drift > 0 ? 'slower' : 'faster'} than ours (${out.scale.toFixed(4)}x). A 4% difference is the usual NTSC/PAL frame-rate change.`,
      anchors_used: resolved.map((r) => ({ cue_id: r.anchor.cue_id, quote: r.anchor.quote, our_time: formatHms(Number(r.anchor.start_ms)), their_time: formatHms(r.observedMs) })),
    },
  };
}

// ------------------------------------------------------------------------------------------------
// GET /api/films/{slug}/scenes
// ------------------------------------------------------------------------------------------------

export async function scenes(db, slug, rawQuery = {}) {
  const query = checkParams(rawQuery, 'scenes');
  if (!slug) throw badRequest('A film slug is required, e.g. /api/films/nemo/scenes.');
  const f = await q.requireFilm(db, slug);
  const [track, vocabulary, groups] = await Promise.all([
    q.getTrack(db, f.id), q.getVocabulary(db), q.getGroups(db),
  ]);
  if (!track) throw notFound(`"${slug}" exists but has no analysed subtitle track.`);

  // --- filters ---
  const presenceTerms = list(query, 'presence');
  const eventTerms = list(query, 'event');
  const groupTerms = list(query, 'group');

  // A word that names nothing in its own layer but names something in the other one is a mistake
  // worth naming, not a dead end.
  const otherLayer = (layer) => (layer === 'presence' ? 'event' : 'presence');
  const rejectUnmatched = (which, result) => {
    if (!result.unmatched.length) return;
    const term = result.unmatched[0];
    const elsewhere = matchTerm(term, vocabulary, { layer: otherLayer(which) });
    throw badRequest(
      elsewhere.ids.length
        ? `${which}: "${term}" is not something that can be present in a scene; it is a${which === 'presence' ? 'n' : ''} ${otherLayer(which)}. Use ${otherLayer(which)}=${elsewhere.ids.join(',')} instead.`
        : `${which}: no vocabulary item matches ${result.unmatched.map((t) => `"${t}"`).join(', ')}.`,
      {
        did_you_mean: suggest(term, vocabulary.filter((v) => v.layer === which)),
        vocabulary_url: '/api/vocabulary',
      },
    );
  };

  const presence = matchTerms(presenceTerms, vocabulary, { layer: 'presence' });
  rejectUnmatched('presence', presence);
  const events = matchTerms(eventTerms, vocabulary, { layer: 'event' });
  rejectUnmatched('event', events);

  // Broad words in `presence` (monsters, creatures) resolve to a group, not to an item.
  const groupIds = [...presence.groups, ...events.groups];
  for (const term of groupTerms) {
    const hit = matchGroup(term, groups);
    if (hit.id) { if (!groupIds.includes(hit.id)) groupIds.push(hit.id); continue; }
    throw badRequest(
      hit.error === 'ambiguous'
        ? `group: "${term}" matches ${hit.candidates.length} groups (${hit.candidates.join(', ')}). Name one exactly.`
        : `group: no group matches "${term}". A group is named by its id or its full label, not by a fragment of one.`,
      { groups: groups.map((g) => `${g.id} (${g.label})`) },
    );
  }

  const ageRaw = str(query, 'age', { max: 12 });
  const { band, note: ageNote, invalid } = bandFor(ageRaw);
  if (invalid) throw badRequest(`age "${ageRaw}" is not understood. Use 5-7, 8-10, or a plain number of years such as 4.`);

  // min_severity=0 is "anything at all", which must not become `severity >= 0` — that would drop
  // every scene whose severity for the chosen band is null.
  const minSeverityRaw = int(query, 'min_severity', { min: 0, max: 3, fallback: null });
  const minSeverity = minSeverityRaw === 0 ? null : minSeverityRaw;
  const onlyConfirmed = bool(query, 'only_confirmed', false);
  const includePossible = bool(query, 'include_possible', false);
  const limit = int(query, 'limit', { min: 1, max: SCENE_LIMIT_MAX, fallback: SCENE_LIMIT_DEFAULT });
  const offset = int(query, 'offset', { min: 0, max: 10_000, fallback: 0 });

  const { mapping, calibration } = await resolveCalibration(db, track, query);

  const filter = {
    filmId: f.id,
    presenceIds: presence.ids,
    eventIds: events.ids,
    groupIds,
    band,
    minSeverity,
    onlyConfirmed,
    includePossible,
    limit,
    offset,
  };
  const [rows, matching, total, runs, reviewed] = await Promise.all([
    q.findScenes(db, filter),
    q.countMatchingScenes(db, filter),
    q.countScenes(db, f.id),
    q.getRuns(db, f.id),
    q.countReviewedScenes(db, f.id),
  ]);
  const labels = await q.getLabels(db, rows.map((r) => r.id));
  const textBlind = vocabulary.filter((v) => v.text_blind);
  const shaped = rows.map((r) => shapeScene(r, labels, textBlind, mapping));

  const anyFilter = Boolean(presence.ids.length || events.ids.length || groupIds.length
    || minSeverity !== null || onlyConfirmed);

  const body = {
    film: { slug: f.slug, title: f.title, year: f.year },
    track: { id: track.id, release_label: track.release_label, cue_count: track.cue_count },
    filters_applied: {
      presence: presence.matched,
      event: events.matched,
      group: groupIds,
      age_band: band,
      age_band_note: ageNote,
      min_severity: minSeverityRaw,
      ...(minSeverityRaw === 0
        ? { min_severity_note: 'min_severity=0 means "no minimum", so no scene was dropped for its severity — including scenes whose severity we never scored.' }
        : {}),
      only_confirmed: onlyConfirmed,
      include_possible: includePossible,
      match_rule: includePossible
        ? `A scene matches on an asserted item OR on a per-beat screener probability of at least ${POSSIBLE_THRESHOLD} (the same items the response lists under possibly_present). The screener over-flags, so expect wrong hits.`
        : 'A scene matches only on items a per-scene judgement asserted. Add include_possible=true to also match the weaker screener leads listed under possibly_present.',
      combination: 'Filters of different kinds are combined with AND; several values of the same kind are combined with OR.',
    },
    calibration,
    counts: {
      returned: shaped.length,
      matching,
      scenes_in_film: total,
      limit,
      offset,
      ...(matching > shaped.length
        ? { more: `${matching - shaped.length} further scenes match these filters but were not returned; ask again with offset=${offset + shaped.length}.` }
        : {}),
    },
    scenes: shaped,
    caveats: caveats({
      film: f, track, runs, sceneCount: total, reviewedCount: reviewed,
      filtered: anyFilter || offset > 0 || matching > shaped.length,
    }),
  };

  if (onlyConfirmed) {
    const { rows: nulls } = await db.query('select count(*)::int as n from scenes where film_id = $1 and confirmed_by_second_run is null', [f.id]);
    if (nulls[0].n) {
      body.filters_applied.only_confirmed_note = `${nulls[0].n} of this film's ${total} scenes have confirmed_by_second_run = null because no second analysis pass was run for it. only_confirmed=true excludes them, so this list is shorter for a reason that is about our process, not about the film.`;
    }
  }

  // An empty result after a presence filter is the most misleading thing this API can return, so
  // say why, and show what nearly matched.
  if (!shaped.length && anyFilter) {
    body.nothing_matched = {
      meaning: `Nothing in this film's ${total} scenes matched. Our per-scene analysis asserted none of these things. That is not proof they never happen: see caveats.`,
    };
    // Everything the presence/group filters were asking about, as item ids.
    const inScope = new Set(presence.ids);
    if (groupIds.length) {
      for (const v of vocabulary) if (v.layer === 'presence' && groupIds.includes(v.group_id)) inScope.add(v.id);
    }
    if (inScope.size) {
      const scope = [...inScope];
      const { rows: near } = await db.query(
        `select l.vocabulary_id, v.label, max(l.probability) as p, count(*)::int as n
           from scene_labels l join vocabulary v on v.id = l.vocabulary_id
          where l.scene_id in (select id from scenes where film_id = $1)
            and l.channel = 'presence' and not l.asserted
            and l.vocabulary_id = any($2) and l.probability >= $3
          group by l.vocabulary_id, v.label order by p desc limit 10`,
        [f.id, scope, NEAR_MISS_FLOOR],
      );
      if (near.length) {
        body.nothing_matched.screener_leads = near.map((r) => ({
          id: r.vocabulary_id,
          label: r.label,
          scenes: r.n,
          highest_probability: Number(Number(r.p).toFixed(2)),
        }));
        body.nothing_matched.screener_leads_note = `These are per-beat screener probabilities, not assertions. ${near.some((r) => Number(r.p) >= POSSIBLE_THRESHOLD) ? `Re-run with include_possible=true to see the scenes behind the ones at ${POSSIBLE_THRESHOLD} or above.` : `None reach ${POSSIBLE_THRESHOLD}, so include_possible=true would not add anything either.`}`;
      }
      const { rows: mentions } = await db.query(
        `select distinct v.label from scene_labels l join vocabulary v on v.id = l.vocabulary_id
          where l.scene_id in (select id from scenes where film_id = $1)
            and l.channel = 'mention' and l.asserted and l.vocabulary_id = any($2)`,
        [f.id, scope],
      );
      if (mentions.length) body.nothing_matched.talked_about_somewhere = mentions.map((m) => m.label);
    }
  }
  return body;
}

// ------------------------------------------------------------------------------------------------
// GET /api/vocabulary
// ------------------------------------------------------------------------------------------------

export async function vocabulary(db, rawQuery = {}) {
  checkParams(rawQuery, 'vocabulary');
  const items = await q.getVocabulary(db);
  const groups = await q.getGroups(db);
  const byGroup = new Map(groups.map((g) => [g.id, { id: g.id, label: g.label, layer: g.layer, items: [] }]));
  for (const v of items) {
    if (v.layer === 'modifier') continue; // not filterable
    const g = byGroup.get(v.group_id);
    if (!g) continue;
    g.items.push({
      id: v.id,
      label: v.label,
      layer: v.layer,
      text_blind: v.text_blind,
      also_known_as: v.aliases,
      filter: v.layer === 'presence' ? `presence=${v.id}` : `event=${v.id}`,
    });
  }
  const used = [...byGroup.values()].filter((g) => g.items.length);
  return {
    taxonomy_version: items[0]?.taxonomy_version ?? 'v3',
    how_to_use: 'presence = what is in the scene (a shark, a needle, the dark) whether or not anything bad happens. event = what happens to the characters (chased, captured, someone dies). group = a whole family of either. Filter values are tolerant: "Sharks", "shark" and "needles" all work.',
    broad_words: {
      note: 'These everyday words are deliberately answered with a whole GROUP, not one item, because that is what a parent means by them. The response says so in filters_applied. To ask the narrow question instead, use the item id.',
      terms: Object.fromEntries(Object.entries(BROAD_TERMS).map(([term, group]) => [term, { group, means: BROAD_NOTE[group] }])),
      example: '"monsters" -> group creatures_figures, which includes monster_creature, shark, large_predator, ghost_spirit and the rest. presence=monster_creature asks only for the narrow item, which by definition excludes every ordinary animal.',
    },
    text_blind_meaning: 'text_blind items are things subtitles usually cannot see. A scene that does not carry one of them has NOT been cleared of it; it was never assessed. Those items come back in every scene\'s not_assessed list, and they are never offered as possibly_present.',
    counts: {
      groups: used.length,
      items: used.reduce((n, g) => n + g.items.length, 0),
      presence: items.filter((v) => v.layer === 'presence').length,
      event: items.filter((v) => v.layer === 'event').length,
      text_blind: items.filter((v) => v.text_blind).length,
      broad_words: Object.keys(BROAD_TERMS).length,
    },
    groups: used,
  };
}
