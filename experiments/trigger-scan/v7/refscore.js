// Scoring against the HUMAN-WRITTEN reference key (refs/<slug>.key.json). Pure code, no I/O.
//
// The key (built blind to the pipeline by refs/): IMDb Parents Guide / Kids-In-Mind moments mapped to
// subtitle cues by an independent model (Codex), and DoesTheDogDie topic votes as film-level items.
// It is for SCORING ONLY: nothing here may feed Sonnet, Jev, the question set or the policy.
//
// Moment items: { id, source, text, categories: [v3 groups], policy: {villain_threat, child_terrified,
// comic_peril}, should_flag: true | false | 'tag_only', same_moment_as: [ids], mappable, start_ms,
// end_ms, ... }. Film-level: { id, source, text, answer: 'yes'|'no' (DTDD), votes, categories, ... }.
//
// Metrics (the same functions score v6 and the live DB, so they can be compared):
//   recall          should_flag === true mapped items; FOUND when >= 50% of the item's span lies inside
//                   the skip spans (a zero-length span: its point inside). Also per MOMENT: items linked
//                   by same_moment_as form one moment, found when any mapped member is found.
//   tag-only        should_flag === 'tag_only' mapped items (comic peril): 'flagged' when >= 50% inside
//                   the skip spans; the target is 0.
//   precision proxy share of skip minutes that overlap a mapped should_flag === true item (ref_only), or,
//                   when given, such an item or a live-DB scene (ref_or_live_db). Skipping a comic
//                   (tag_only) or should_flag:false moment is NOT counted as correct: those minutes are
//                   reported apart as a cost (skip_minutes_over_non_flag_items). The pre-fix definition
//                   (overlap with ANY mapped item) is kept as precision_proxy_any_item for comparison.
//   window          'strict' scores the item span start_ms..end_ms; 'gap' the tolerance window
//                   gap_start_ms..gap_end_ms (to the neighbouring cues; for wordless action).
//   sensitivity     recall and precision under shifts of every item by -30/-15/+15/+30 s, and under 300
//                   seeded random moves of each item's start and end by up to 30 s (sensitivity()).
//   verdict         compareSystems(): a difference counts only when it holds on the conservative
//                   recall (min of strict and gap) AND in >= 95% of the jitter runs; otherwise a tie.
//   unmappable      items with mappable false: reported apart, never counted as misses.
//   DTDD agreement  per topic with answer yes/no whose WHOLE question maps to specific v6 tags
//                   (DTDD_TAGS): v6 says yes when any scene has one of them at act level. Other topics
//                   are unscored; a coarse v3-group fallback is reported apart.

export const FOUND_SHARE = 0.5;

/** Union of [start,end] pairs (ms), merged. */
export function union(spans) {
  const s = spans.filter((x) => x && Number.isFinite(x[0]) && Number.isFinite(x[1]) && x[1] >= x[0]).map((x) => [x[0], x[1]]).sort((a, b) => a[0] - b[0]);
  const out = [];
  for (const [a, b] of s) {
    const last = out[out.length - 1];
    if (last && a <= last[1]) last[1] = Math.max(last[1], b); else out.push([a, b]);
  }
  return out;
}
export const total = (u) => u.reduce((s, [a, b]) => s + (b - a), 0);
export function inter(u1, u2) {
  let t = 0;
  for (const [a, b] of u1) for (const [c, d] of u2) t += Math.max(0, Math.min(b, d) - Math.max(a, c));
  return t;
}

/** Share of [start,end] inside the union u (a point: 1 when inside, else 0). */
export function shareInside(start, end, u) {
  if (end <= start) return u.some(([a, b]) => start >= a && start <= b) ? 1 : 0;
  return inter([[start, end]], u) / (end - start);
}

const isMapped = (it) => it.mappable && Number.isFinite(it.start_ms) && Number.isFinite(it.end_ms);

/** The key with every mapped item's span replaced by its gap window (tolerance for wordless action). */
export function gapKey(key) {
  return { ...key, items: (key.items ?? []).map((it) => (isMapped(it) && Number.isFinite(it.gap_start_ms) && Number.isFinite(it.gap_end_ms) ? { ...it, start_ms: Math.min(it.start_ms, it.gap_start_ms), end_ms: Math.max(it.end_ms, it.gap_end_ms) } : it)) };
}
export const withWindow = (key, window) => (window === 'gap' ? gapKey(key) : key);

/** Moments: clusters of items joined by same_moment_as (union-find over ids). */
export function momentClusters(items) {
  const parent = new Map(items.map((it) => [it.id, it.id]));
  const find = (x) => { while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x))); x = parent.get(x); } return x; };
  for (const it of items) for (const o of it.same_moment_as ?? []) if (o && parent.has(o)) parent.set(find(it.id), find(o));
  const groups = new Map();
  for (const it of items) { const r = find(it.id); if (!groups.has(r)) groups.set(r, []); groups.get(r).push(it); }
  return [...groups.values()];
}

const flagOf = (cluster) => (cluster.some((i) => i.should_flag === true) ? true : cluster.some((i) => i.should_flag === 'tag_only') ? 'tag_only' : false);

/**
 * Score one set of skip spans against a key.
 *   key:        the parsed key file
 *   skip:       [[start,end],...] the system's skip spans (merged or not)
 *   liveDb:     optional [[start,end],...] live-DB scene spans (for the combined precision proxy)
 * Returns numbers plus per-item rows (id, found share) for explanation.
 */
export function scoreKey(key0, skip, { liveDb = null, window = 'strict' } = {}) {
  const key = withWindow(key0, window);
  const U = union(skip);
  const items = key.items ?? [];
  const mapped = items.filter(isMapped);
  const row = (it) => ({ id: it.id, source: it.source, should_flag: it.should_flag, categories: it.categories ?? [], policy: it.policy ?? {}, start_ms: it.start_ms, end_ms: it.end_ms, share_in_skip: Math.round(shareInside(it.start_ms, it.end_ms, U) * 1000) / 1000 });
  const rows = mapped.map(row);
  const pick = (f) => rows.filter((r) => r.should_flag === f);
  const found = (r) => r.share_in_skip >= FOUND_SHARE;
  const flagItems = pick(true);
  const tagOnly = pick('tag_only');
  const notFlag = pick(false);

  // moments (same_moment_as clusters); only clusters with at least one mapped member count
  const byId = new Map(rows.map((r) => [r.id, r]));
  const clusters = momentClusters(items).map((c) => ({ ids: c.map((i) => i.id), should_flag: flagOf(c), mapped: c.filter(isMapped).map((i) => byId.get(i.id)) })).filter((c) => c.mapped.length);
  const flagMoments = clusters.filter((c) => c.should_flag === true);

  // precision counts only should_flag === true items; comic / false items are a separate cost
  const spanOf = (it) => [it.start_ms, it.end_ms];
  const refU = union(mapped.filter((it) => it.should_flag === true).map(spanOf));
  const anyU = union(mapped.map(spanOf));
  const tagU = union(mapped.filter((it) => it.should_flag === 'tag_only').map(spanOf));
  const falseU = union(mapped.filter((it) => it.should_flag === false).map(spanOf));
  const skipMs = total(U);
  const withDb = liveDb ? union([...refU, ...union(liveDb)]) : refU;
  const skipNotTrue = subtract(U, refU); // skip time not over any should_flag item
  const policyRecall = (k) => {
    const rs = flagItems.filter((r) => r.policy?.[k]);
    return { n: rs.length, found: rs.filter(found).length };
  };
  return {
    items_total: items.length,
    mapped: mapped.length,
    unmappable: items.filter((it) => !isMapped(it)).map((it) => ({ id: it.id, source: it.source, should_flag: it.should_flag, categories: it.categories ?? [], wordless: it.wordless ?? null })),
    should_flag_items: flagItems.length,
    recall_items: { found: flagItems.filter(found).length, of: flagItems.length, share: flagItems.length ? round(flagItems.filter(found).length / flagItems.length) : null },
    recall_moments: { found: flagMoments.filter((c) => c.mapped.some(found)).length, of: flagMoments.length, share: flagMoments.length ? round(flagMoments.filter((c) => c.mapped.some(found)).length / flagMoments.length) : null },
    recall_by_policy: { villain_threat: policyRecall('villain_threat'), child_terrified: policyRecall('child_terrified') },
    tag_only: { items: tagOnly.length, flagged: tagOnly.filter(found).length, not_flagged: tagOnly.filter((r) => !found(r)).length, flagged_ids: tagOnly.filter(found).map((r) => r.id) },
    should_not_flag_items_skipped: { items: notFlag.length, skipped: notFlag.filter(found).length },
    skip_minutes: round(skipMs / 60000),
    window,
    precision_proxy_ref_only: skipMs ? round(inter(U, refU) / skipMs) : null,
    precision_proxy_any_item: skipMs ? round(inter(U, anyU) / skipMs) : null,
    skip_minutes_over_non_flag_items: { tag_only: round(inter(skipNotTrue, tagU) / 60000), should_flag_false: round(inter(skipNotTrue, subtract(falseU, tagU)) / 60000), note: 'skip minutes over comic (tag_only) or should_flag:false items and over no should_flag item: a cost, not a hit' },
    precision_proxy_ref_or_live_db: liveDb ? (skipMs ? round(inter(U, withDb) / skipMs) : null) : null,
    found_should_flag_per_skip_minute: skipMs ? round(flagItems.filter(found).length / (skipMs / 60000)) : null,
    missed: flagItems.filter((r) => !found(r)),
    found: flagItems.filter(found).map((r) => r.id),
    rows,
  };
}

const round = (x) => Math.round(x * 1000) / 1000;

/** u1 minus u2 (both unions). */
export function subtract(u1, u2) {
  const out = [];
  for (const [a0, b0] of u1) {
    let a = a0;
    for (const [c, d] of u2) {
      if (d <= a || c >= b0) continue;
      if (c > a) out.push([a, Math.min(c, b0)]);
      a = Math.max(a, d);
      if (a >= b0) break;
    }
    if (a < b0) out.push([a, b0]);
  }
  return out;
}

// ---- mapping-error sensitivity and the A-vs-B verdict ---------------------------------------------
// The key's times come from Codex mapping advisories onto subtitle cues; 58-79% of mapped items are
// wordless and bracketed by neighbouring cues, so a few seconds of mapping error can decide an item.
export const JITTER = { runs: 300, max_ms: 30000, seed: 12345, shifts_s: [-30, -15, 15, 30] };

function lcg(seed) { let x = seed; return () => { x = (x * 1103515245 + 12345) % 2147483648; return x / 2147483648; }; }
const quant = (arr, p) => { const a = [...arr].sort((x, y) => x - y); return a[Math.floor(p * (a.length - 1))]; };
const moveItems = (key, f) => ({ ...key, items: (key.items ?? []).map((it) => (isMapped(it) ? f(it) : it)) });

/**
 * Recall (strict span) and precision (should_flag items, strict span) of two systems A and B under
 * whole-key shifts and seeded per-item jitter. Deterministic for a given seed.
 */
export function sensitivity(key, skipA, skipB, { runs = JITTER.runs, maxMs = JITTER.max_ms, seed = JITTER.seed, shifts = JITTER.shifts_s } = {}) {
  const sc = (k, skip) => { const r = scoreKey(k, skip); return { rec: r.recall_items.found, prec: r.precision_proxy_ref_only }; };
  const shift = {};
  for (const d of shifts) {
    const k = moveItems(key, (it) => ({ ...it, start_ms: it.start_ms + d * 1000, end_ms: it.end_ms + d * 1000 }));
    const a = sc(k, skipA); const b = sc(k, skipB);
    shift[`${d > 0 ? '+' : ''}${d}s`] = { a_recall: a.rec, b_recall: b.rec, a_precision: a.prec, b_precision: b.prec };
  }
  const rnd = lcg(seed);
  const dRec = []; const dPrec = [];
  for (let n = 0; n < runs; n++) {
    const k = moveItems(key, (it) => { const s = it.start_ms + (rnd() * 2 - 1) * maxMs; const e = it.end_ms + (rnd() * 2 - 1) * maxMs; return { ...it, start_ms: s, end_ms: Math.max(s, e) }; });
    const a = sc(k, skipA); const b = sc(k, skipB);
    dRec.push(a.rec - b.rec); dPrec.push((a.prec ?? 0) - (b.prec ?? 0));
  }
  const dist = (d, r) => ({ p05: r(quant(d, 0.05)), p50: r(quant(d, 0.5)), p95: r(quant(d, 0.95)), min: r(Math.min(...d)), max: r(Math.max(...d)), share_a_gt_b: round(d.filter((x) => x > 0).length / d.length), share_a_ge_b: round(d.filter((x) => x >= 0).length / d.length), share_a_lt_b: round(d.filter((x) => x < 0).length / d.length) });
  return { runs, max_shift_s: maxMs / 1000, seed, shifts: shift, recall_diff_a_minus_b: dist(dRec, (x) => x), precision_diff_a_minus_b: dist(dPrec, round) };
}

export const DECISIVE_SHARE = 0.95;

/**
 * Verdict for system A vs B on one key. strict/gap: scoreKey results for each system in each window;
 * sens: sensitivity(key, A, B). A recall difference counts only when the conservative recall (the
 * lower of strict and gap, per system) differs AND the same side wins in >= 95% of jitter runs. A
 * precision difference counts only when strict and gap agree AND >= 95% of jitter runs agree.
 */
export function compareSystems({ aStrict, aGap, bStrict, bGap, sens }) {
  const consA = Math.min(aStrict.recall_items.found, aGap.recall_items.found);
  const consB = Math.min(bStrict.recall_items.found, bGap.recall_items.found);
  const rd = sens.recall_diff_a_minus_b;
  const recall = consA > consB && rd.share_a_gt_b >= DECISIVE_SHARE ? 'A' : consB > consA && rd.share_a_lt_b >= DECISIVE_SHARE ? 'B' : 'tie';
  const ps = aStrict.precision_proxy_ref_only - bStrict.precision_proxy_ref_only;
  const pg = aGap.precision_proxy_ref_only - bGap.precision_proxy_ref_only;
  const pd = sens.precision_diff_a_minus_b;
  const precision = ps > 0 && pg > 0 && pd.share_a_gt_b >= DECISIVE_SHARE ? 'A' : ps < 0 && pg < 0 && pd.share_a_lt_b >= DECISIVE_SHARE ? 'B' : 'tie';
  const overall = recall === 'tie' && precision === 'tie' ? 'tie'
    : recall !== 'B' && precision !== 'B' ? 'A'
    : recall !== 'A' && precision !== 'A' ? 'B'
    : 'mixed';
  return {
    recall, precision, overall,
    conservative_recall: { a: consA, b: consB, of: aStrict.recall_items.of },
    recall_strict: { a: aStrict.recall_items.found, b: bStrict.recall_items.found },
    recall_gap: { a: aGap.recall_items.found, b: bGap.recall_items.found },
    precision_strict: { a: aStrict.precision_proxy_ref_only, b: bStrict.precision_proxy_ref_only },
    precision_gap: { a: aGap.precision_proxy_ref_only, b: bGap.precision_proxy_ref_only },
    skip_minutes: { a: aStrict.skip_minutes, b: bStrict.skip_minutes },
    rule: `recall: conservative (min of strict, gap) differs and >= ${DECISIVE_SHARE * 100}% of jitter runs agree; precision: strict and gap agree and >= ${DECISIVE_SHARE * 100}% of jitter runs agree; else tie`,
  };
}

// ---- DoesTheDogDie topics -------------------------------------------------------------------------
// DTDD asks very specific questions ('Does a pregnant person die?', 'Does the black guy die first?').
// Only WHOLE questions that v6's vocabulary can answer are scored, each against specific tag ids
// (anchored, case-insensitive); every other topic is 'unscored'. A coarse fallback on the topic's v3
// groups is reported apart (it marks almost every topic 'yes' and is not a headline number).
const Q = (re, ids) => [new RegExp(`^\\s*${re}\\s*\\??\\s*$`, 'i'), ids];
export const DTDD_TAGS = [
  Q('does someone die', ['dies']),
  Q('does an animal die', ['dies', 'pet_dies']),
  Q('does a pet die', ['pet_dies']),
  Q('does a (parent|family member) die', ['parent_death_learned', 'loved_one_dies']),
  Q('does a non-human character die', ['dies']),
  Q('is someone kidnapped', ['child_taken', 'captured']),
  Q('is (a child|an infant|a baby|a kid) (kidnapped|abducted)', ['child_taken']),
  Q('is a child abandoned by a parent', ['abandoned']),
  Q('(is a child|are children) separated from (a|their) parents?', ['child_separated']),
  Q('are there jump scares', ['jump_scare', 'appears_suddenly']),
  Q('is there a claustrophobic scene', ['trapped', 'swallowed']),
  Q('is someone (trapped|stuck) (somewhere|underground)', ['trapped']),
  Q('are there spiders', ['spider_insect']),
  Q('are there (bugs|insects)', ['spider_insect']),
  Q('are there snakes', ['snake_reptile']),
  Q('are there sharks', ['shark']),
  Q('are there clowns', ['clown']),
  Q('are there ghosts', ['ghost_spirit']),
  Q('are there zombies', ['reanimated_dead']),
  Q('are there skeletons', ['skeleton_bones']),
  Q('are there rats or mice', ['rodent_bat']),
  Q('are there bats', ['rodent_bat']),
  Q('are there dolls', ['doll_puppet']),
  Q('are needles/syringes used', ['needle_medical']),
  Q('is there a hospital scene', ['medical_care']),
  Q('is someone choked', ['cannot_breathe']),
  Q('does someone (suffocate|have trouble breathing)', ['cannot_breathe']),
  Q('is there screaming', ['screams']),
  Q('is there blood/gore', ['blood_wound']),
  Q('is there gun violence', ['gun', 'weapon_used']),
  Q('does a baby cry', ['crying', 'child_frightened']),
  Q('is there a (car|vehicle) crash', ['vehicle_accident', 'vehicle_crash']),
  Q('is there a dead body', ['dead_body']),
  Q('is there a (funeral|graveyard|cemetery)', ['graveyard_funeral']),
  Q('does someone have a nightmare', ['nightmare']),
  Q('is someone possessed', ['possessed']),
  Q('is there a storm', ['storm']),
  Q('is there a fire', ['fire']),
  Q('is there an explosion', ['explosion']),
  Q('is someone (bullied|mocked)', ['mocked']),
  Q('does someone fall from a height', ['falls']),
  Q('are there (large )?heights', ['heights', 'nearly_falls']),
  Q('is an animal (abused|hurt|mistreated)', ['animal_cruelty']),
  Q('is a child (abused|hit) by (a|their) parent', ['caregiver_cruelty']),
];

/** What a DTDD topic is checked against: { kind: 'tags', ids } or { kind: 'groups', ids } (coarse). */
export function dtddTargets(topic) {
  for (const [re, ids] of DTDD_TAGS) if (re.test(topic.text ?? '')) return { kind: 'tags', ids };
  return { kind: 'groups', ids: topic.categories ?? [] };
}

/**
 * DTDD agreement. `actTags` = every act-level tag of every classified scene ({id, group}); `toId`
 * maps the v6 tag ids of dtddTargets into actTags' id space (the live DB uses v3 ids).
 * Returns { topics, agree, tp, tn, fp, fn, rows }.
 */
export function dtddAgreement(key, actTags, { toId = (id) => id } = {}) {
  const ids = new Set(actTags.map((t) => t.id));
  const groups = new Set(actTags.map((t) => t.group).filter(Boolean));
  const topics = (key.film_level ?? []).filter((x) => x.source === 'doesthedogdie' && (x.answer === 'yes' || x.answer === 'no'));
  const rows = topics.map((t) => {
    const tg = dtddTargets(t);
    if (tg.kind === 'groups' && !tg.ids.length) return { id: t.id, text: t.text, answer: t.answer, target: tg, v6: null, agree: null };
    // toId maps a v6 tag id to the id space of actTags (identity for v6; v3 ids for the live DB)
    const v6 = tg.kind === 'tags' ? tg.ids.some((id) => ids.has(toId(id))) : tg.ids.some((g) => groups.has(g));
    return { id: t.id, text: t.text, answer: t.answer, margin: t.votes?.margin ?? null, target: tg, v6: v6 ? 'yes' : 'no', agree: (t.answer === 'yes') === v6 };
  });
  // headline: only topics with a specific tag mapping; the group fallback is coarse and reported apart
  const scored = rows.filter((r) => r.agree !== null && r.target.kind === 'tags');
  const coarse = rows.filter((r) => r.agree !== null && r.target.kind === 'groups');
  const c = (list, a, v) => list.filter((r) => r.answer === a && r.v6 === v).length;
  return {
    topics: topics.length, scored: scored.length, agree: scored.filter((r) => r.agree).length,
    tp: c(scored, 'yes', 'yes'), tn: c(scored, 'no', 'no'), fp: c(scored, 'no', 'yes'), fn: c(scored, 'yes', 'no'),
    unscored: topics.length - scored.length,
    coarse_groups: { scored: coarse.length, agree: coarse.filter((r) => r.agree).length, fp: c(coarse, 'no', 'yes'), fn: c(coarse, 'yes', 'no') },
    rows,
  };
}
