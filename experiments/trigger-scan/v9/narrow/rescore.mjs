#!/usr/bin/env node
// NARROW-JEV RESCORE (offline: no model calls, no network; reads frozen v9 files, writes only narrow/out/).
//
// Question from the user: did Jev work on its set of questions? Test: restrict Jev to the questions it had
// PROVEN on round 4 (narrow/jev-set.json, written before any round-5 number was looked at), hand every other
// contested question to Sonnet's stored answer (assigned or shadow), and drop every never-asked-of-Sonnet
// question outside the set from flagging (tag-only). Then re-select, re-span from the stored moments and
// score with the round-5 head-to-head method against LIVE and against FROZEN v9.
//
//   node narrow/rescore.mjs            -> narrow/out/rescore.json (+ a table on stdout)
//
// Routing per variant (jev-set.json):
//   sonnetQs = split.sonnet_asked minus (jev_set questions Jev has a stored round-5 answer for)
//              -> merge.js mergeAnswers(..., used = sonnetQs): Sonnet's p (unlisted = 0.05) replaces Jev's
//   jevKeep  = jev_set questions Jev answered in round 5
//   policy   = policy.json with flag.strong_events / flag.presence tiers filtered to sonnetQs + jevKeep,
//              film_specific_types = [] (film templates were never asked of Sonnet and none is in the set)
//   Scores / modifiers / kind / film-level context: unchanged (Jev), as in v9.
// Selection: select.js selectRun (the frozen code path) with that policy and routing.
// Moments:   moments.js respanScenes (the frozen offline re-span): a flagged scene reuses the stored per-clause
//            answers for the reasons that still flag; a scene v9 never flagged, or a scene with a reason whose
//            clause was never asked, falls back to the whole scene (counted).
// Scoring:   the round-5 headtohead.mjs functions: scoreKey strict/gap, sensitivity (300 seeded jitter runs),
//            compareSystems, wordless peaks (in-flagged + all), wordless scenes, tag-only (comic) items skipped.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSrt } from '../../srt.js';
import { TS } from '../env.js';
import { ITEMS } from '../questions.js';
import { loadSplit } from '../split.js';
import { loadPolicy, selectRun } from '../select.js';
import { respanScenes, clauseFor } from '../moments.js';
import { scoreKey, sensitivity, compareSystems, union, shareInside, inter } from '../refscore.js';
import { checkWordlessPeaks, checkWordlessScenes, WORDLESS_SHARE } from '../parent-checks.js';
import { wordlessScenes } from '../fill.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const V9 = path.resolve(here, '..');
const OUT9 = path.join(V9, 'out');
const LIVE = path.join(V9, 'round5', 'live');
const NOUT = path.join(here, 'out');
fs.mkdirSync(NOUT, { recursive: true });
const FILMS = ['book-of-life', 'princess-and-the-frog', 'moana'];
const rj = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const r3 = (x) => (x == null || Number.isNaN(x) ? null : Math.round(x * 1000) / 1000);
const POLICY = loadPolicy();
const SPLIT = loadSplit();
const JEVSET = rj(path.join(here, 'jev-set.json'));
const VARIANTS = { narrow: JEVSET.jev_set, narrow_ge3: JEVSET.sensitivity_variant.jev_set };

// ---- routing + policy ------------------------------------------------------------------------------
const jevAnswers = (run, q) => run.scenes.some((s) => s.answers && (s.answers.e?.[q] !== undefined || s.answers.pl?.[q] !== undefined));
const flaggable = (cfg) => new Set([...cfg.flag.strong_events, ...cfg.flag.presence.always, ...cfg.flag.presence.with_danger, ...cfg.flag.presence.with_creature_threat]);

function routing(run, set) {
  const jevHas = set.filter((q) => jevAnswers(run, q));
  const jevNo = set.filter((q) => !jevAnswers(run, q));
  const jevKeep = new Set(jevHas);
  const sonnetQs = SPLIT.sonnet_asked.filter((q) => !jevKeep.has(q));
  const allowed = new Set([...sonnetQs, ...jevKeep]);
  const cfg = structuredClone(POLICY);
  const before = flaggable(cfg);
  cfg.flag.strong_events = cfg.flag.strong_events.filter((q) => allowed.has(q));
  for (const t of ['always', 'with_danger', 'with_creature_threat']) cfg.flag.presence[t] = cfg.flag.presence[t].filter((q) => allowed.has(q));
  cfg.flag.film_specific_types = [];
  const after = flaggable(cfg);
  return {
    cfg, sonnetQs, jevKeep: [...jevKeep],
    report: {
      jev_answers: [...jevKeep],
      in_set_but_no_jev_answer_so_sonnet: jevNo,
      sonnet_answers: sonnetQs,
      sonnet_assigned_in_v9: sonnetQs.filter((q) => SPLIT.sonnet_used.includes(q)),
      sonnet_shadow_now_used: sonnetQs.filter((q) => SPLIT.shadow.includes(q)),
      contested_moved_to_jev_or_kept: SPLIT.sonnet_asked.filter((q) => jevKeep.has(q)),
      dropped_from_flagging_tag_only: [...before].filter((q) => !after.has(q)).sort(),
      dropped_film_specific_types: POLICY.flag.film_specific_types,
      flaggable_now: [...after].sort(),
    },
  };
}

// ---- per-scene provenance / holds ------------------------------------------------------------------
const byOf = (s) => { const b = new Set(s.flag_reasons.map((r) => r.by)); return b.size === 2 ? 'both' : b.has('sonnet') ? 'sonnet_only' : 'jev_only'; };
const spansOf = (s) => (s.skip?.spans ?? []).map((x) => [x.start_ms, x.end_ms]);
const gapWin = (i) => [Number.isFinite(i.gap_start_ms) ? Math.min(i.start_ms, i.gap_start_ms) : i.start_ms, Number.isFinite(i.gap_end_ms) ? Math.max(i.end_ms, i.gap_end_ms) : i.end_ms];
function holds(scene, sfItems) {
  const U = union(spansOf(scene));
  const strict = sfItems.filter((i) => inter(U, [[i.start_ms, i.end_ms]]) > 0 || (i.end_ms <= i.start_ms && shareInside(i.start_ms, i.end_ms, U) > 0));
  const gap = sfItems.filter((i) => { const w = gapWin(i); return inter(U, [w]) > 0 || (w[1] <= w[0] && shareInside(w[0], w[1], U) > 0); });
  const found = sfItems.filter((i) => shareInside(i.start_ms, i.end_ms, U) >= 0.5);
  return { strict: strict.length > 0, gap: gap.length > 0, found: found.map((i) => i.id) };
}
function provenance(flagged, sfItems) {
  const o = {};
  for (const k of ['jev_only', 'sonnet_only', 'both']) o[k] = { scenes: 0, hold_sf_strict: 0, hold_sf_gap: 0, skip_min: 0, sf_items_found: 0 };
  for (const s of flagged) {
    const k = byOf(s); const h = holds(s, sfItems);
    o[k].scenes++; if (h.strict) o[k].hold_sf_strict++; if (h.gap) o[k].hold_sf_gap++; o[k].skip_min += (s.skip?.ms ?? 0) / 60000; o[k].sf_items_found += h.found.length;
  }
  for (const k of Object.keys(o)) o[k].skip_min = r3(o[k].skip_min);
  return o;
}

// ---- per-question table (scorecard method: fire = act tag not cancelled; right = fired scene overlaps a
// human key item of the question's group, gap window; catch = group item overlapped by a firing scene) ----
function questionRows(scenes, qs, humanItems, sfItems, by) {
  const out = {};
  for (const q of qs) {
    const g = ITEMS[q]?.group;
    const its = humanItems.filter((i) => (i.categories ?? []).includes(g));
    const fired = scenes.filter((s) => (s.tags ?? []).some((t) => t.id === q && t.level === 'act' && (!by || t.by === by)));
    const ov = (s, i) => { const w = gapWin(i); return Math.min(s.end_ms, w[1]) - Math.max(s.start_ms, w[0]) > 0; };
    const right = fired.filter((s) => its.some((i) => ov(s, i)));
    const caught = its.filter((i) => fired.some((s) => ov(s, i)));
    const asReason = scenes.filter((s) => s.flagged && s.flag_reasons.some((r) => r.id === q));
    const reasonHold = asReason.filter((s) => holds(s, sfItems).strict);
    out[q] = { group: g, fires: fired.length, right: right.length, precision: fired.length ? r3(right.length / fired.length) : null, catches: caught.length, group_items: its.length, flag_reason_scenes: asReason.length, flag_reason_scenes_holding_sf: reasonHold.length, fired_scenes: fired.map((s) => s.id) };
  }
  return out;
}

const brief = (s) => ({ recall: `${s.recall_items.found}/${s.recall_items.of}`, precision: s.precision_proxy_ref_only, skip_minutes: s.skip_minutes, comic_tag_only_skipped: `${s.tag_only.flagged}/${s.tag_only.items}`, should_flag_false_skipped: `${s.should_not_flag_items_skipped.skipped}/${s.should_not_flag_items_skipped.items}` });
function allWordless(key, skip) {
  const U = union(skip);
  const rows = key.items.filter((i) => i.mappable && Number.isFinite(i.start_ms) && i.should_flag === true && i.wordless).map((i) => ({ id: i.id, share: r3(shareInside(i.start_ms, i.end_ms, U)) }));
  return { n: rows.length, covered: rows.filter((r) => r.share >= WORDLESS_SHARE).length };
}
function versus(key, A, B) {
  const aS = scoreKey(key, A); const aG = scoreKey(key, A, { window: 'gap' });
  const bS = scoreKey(key, B); const bG = scoreKey(key, B, { window: 'gap' });
  const sens = sensitivity(key, A, B);
  const v = compareSystems({ aStrict: aS, aGap: aG, bStrict: bS, bGap: bG, sens });
  return { recall: v.recall, precision: v.precision, overall: v.overall, conservative_recall: v.conservative_recall, precision_strict: v.precision_strict, precision_gap: v.precision_gap, jitter: { recall_a_gt_b: sens.recall_diff_a_minus_b.share_a_gt_b, recall_a_lt_b: sens.recall_diff_a_minus_b.share_a_lt_b, recall_p05_p95: [sens.recall_diff_a_minus_b.p05, sens.recall_diff_a_minus_b.p95], precision_a_gt_b: sens.precision_diff_a_minus_b.share_a_gt_b, precision_a_lt_b: sens.precision_diff_a_minus_b.share_a_lt_b, precision_p05_p95: [sens.precision_diff_a_minus_b.p05, sens.precision_diff_a_minus_b.p95] } };
}
function systemScore(key, skip, flaggedScenes, wl) {
  const S = scoreKey(key, skip); const G = scoreKey(key, skip, { window: 'gap' });
  return { strict: brief(S), gap: brief(G), conservative_recall: Math.min(S.recall_items.found, G.recall_items.found), of: S.recall_items.of, found: S.found, wordless_peaks_all: allWordless(key, skip), wordless_peaks_in_flagged: checkWordlessPeaks(key, flaggedScenes, skip), wordless_scenes: checkWordlessScenes(key, wl, skip), _S: S, _G: G };
}

// ---- run -------------------------------------------------------------------------------------------
const films = [];
const pool = { items: [], live: [], v9: [], asked: {}, variants: Object.fromEntries(Object.keys(VARIANTS).map((v) => [v, []])) };
const reproduce = [];
FILMS.forEach((slug, k) => {
  const off = k * 1e8;
  const fullKey = rj(path.join(TS, 'refs', `${slug}.key.json`));
  const key = { ...fullKey, items: fullKey.items.filter((i) => i.source !== 'codex-rules') };
  const mapped = (i) => i.mappable && Number.isFinite(i.start_ms) && Number.isFinite(i.end_ms);
  const humanItems = key.items.filter((i) => i.human_written !== false && mapped(i));
  const sfItems = key.items.filter((i) => mapped(i) && i.should_flag === true);
  const run = rj(path.join(OUT9, `${slug}.jev.r1.json`));
  const sonnet = rj(path.join(OUT9, `${slug}.sonnetq.r1.json`));
  const saved = rj(path.join(OUT9, `${slug}.moments.r1.json`));
  const frozen = rj(path.join(OUT9, `${slug}.tags.r1.json`));
  const seg = rj(path.join(OUT9, `${slug}.segments.json`));
  const cues = parseSrt(fs.readFileSync(path.join(TS, 'data', `${slug}.srt`), 'utf8'));
  const built = rj(path.join(LIVE, `${slug}.built.json`));
  const items = run.film_items ?? [];
  const wl = wordlessScenes(seg, cues, POLICY);

  // 0. harness check: the frozen v9 routing through this exact path must reproduce the frozen tags + skips
  const rep = selectRun(run, POLICY, { cues, sonnet, used: SPLIT.sonnet_used });
  const repSp = respanScenes({ tags: rep, saved, cues, items, cfg: POLICY });
  const sig = (sc) => sc.filter((s) => s.flagged).map((s) => `${s.id}:${s.flag_reasons.map((r) => r.id).join('+')}`).join(' ');
  const frozenSkipMs = frozen.scenes.filter((s) => s.flagged).reduce((a, s) => a + (s.skip?.ms ?? 0), 0);
  const repSkipMs = Object.values(repSp).reduce((a, m) => a + m.skip_ms, 0);
  const spanDiff = frozen.scenes.filter((s) => s.flagged).filter((s) => JSON.stringify(spansOf(s)) !== JSON.stringify((repSp[s.id]?.spans ?? []).map((x) => [x.start_ms, x.end_ms]))).map((s) => s.id);
  reproduce.push({ slug, flags_identical: sig(rep.scenes) === sig(frozen.scenes), frozen_skip_min: r3(frozenSkipMs / 60000), respan_skip_min: r3(repSkipMs / 60000), scenes_with_different_spans: spanDiff });

  // frozen v9 + live
  const v9Flagged = frozen.scenes.filter((s) => s.flagged);
  const v9Skip = v9Flagged.flatMap(spansOf);
  const liveScenes = built.scenes.map((s) => ({ id: s.id.split(':').pop(), start_ms: s.start_ms, end_ms: s.end_ms }));
  const liveSkip = liveScenes.map((s) => [s.start_ms, s.end_ms]);
  const v9Sys = systemScore(key, v9Skip, v9Flagged, wl);
  const liveSys = systemScore(key, liveSkip, liveScenes, wl);

  const film = { slug, key: { human_items: key.items.length, should_flag_mapped: v9Sys.of }, live: strip(liveSys), v9: { ...strip(v9Sys), flagged: v9Flagged.length, provenance: provenance(v9Flagged, sfItems) }, variants: {} };
  for (const [vname, set] of Object.entries(VARIANTS)) {
    const R = routing(run, set);
    const sel = selectRun(run, R.cfg, { cues, sonnet, used: R.sonnetQs });
    const v9Ids = new Set(v9Flagged.map((s) => s.id));
    // PRIMARY moments rule = the frozen moments.js respanScenes as is: reuse the stored per-clause answers
    // for the reasons that still flag; the WHOLE scene when the scene was never flagged by v9 (no stored
    // answer) or when one of its top policy.moments.max_reasons reasons has a clause v9's moments call never
    // asked (v9 asked at most 6 distinct clauses per scene) -- the same fallback the brief sets for a newly
    // flagged scene, applied per reason, so a reason that still flags is never left without a span.
    // SENSITIVITY 'asked_only': use only the asked clauses and ignore unasked reasons (whole scene only when
    // none was asked) -- a LOWER bound on skip minutes that under-skips (it leaves still-firing reasons with
    // no span).
    const askedOf = (id) => new Set((saved.scenes?.[id]?.answers ?? []).map((a) => a.clause));
    const narrowedTags = { ...sel, scenes: sel.scenes.map((s) => {
      if (!s.flagged || !saved.scenes?.[s.id]?.answers) return s;
      const asked = askedOf(s.id);
      const keep = s.flag_reasons.filter((r) => asked.has(clauseFor(r, items)));
      return keep.length ? { ...s, flag_reasons: keep, _unasked: s.flag_reasons.filter((r) => !asked.has(clauseFor(r, items))).map((r) => r.id) } : s;
    }) };
    const sp = respanScenes({ tags: sel, saved, cues, items, cfg: R.cfg });
    const spAsked = respanScenes({ tags: narrowedTags, saved, cues, items, cfg: R.cfg });
    const mom = { reused_stored_moments: 0, whole_scene_newly_flagged: [], whole_scene_reason_not_asked: [], whole_scene_as_in_v9: [] };
    for (const s of sel.scenes.filter((x) => x.flagged)) {
      const m = sp[s.id];
      const ns = narrowedTags.scenes.find((x) => x.id === s.id);
      s.skip = { method: m.method, spans: m.spans, ms: m.skip_ms };
      if (!v9Ids.has(s.id)) mom.whole_scene_newly_flagged.push(s.id);
      else if (/^reason_not_asked/.test(m.why ?? '')) mom.whole_scene_reason_not_asked.push(`${s.id} (unasked: ${(ns._unasked ?? s.flag_reasons.map((r) => r.id)).join('+')})`);
      else if (m.method === 'whole_scene') mom.whole_scene_as_in_v9.push(s.id);
      else mom.reused_stored_moments++;
    }
    const flagged = sel.scenes.filter((s) => s.flagged);
    const skip = flagged.flatMap(spansOf);
    const skipAsked = flagged.flatMap((s) => spAsked[s.id].spans.map((x) => [x.start_ms, x.end_ms]));
    (pool.asked[vname] ??= []).push(...skipAsked.map(([a, b]) => [a + off, b + off]));
    const stS = scoreKey(key, skipAsked); const stG = scoreKey(key, skipAsked, { window: 'gap' });
    const askedOnly = { conservative_recall: Math.min(stS.recall_items.found, stG.recall_items.found), precision: `${stS.precision_proxy_ref_only}/${stG.precision_proxy_ref_only}`, skip_minutes: stS.skip_minutes, comic_skipped: `${stS.tag_only.flagged}/${stS.tag_only.items}`, vs_live: versus(key, skipAsked, liveSkip).overall, vs_v9: versus(key, skipAsked, v9Skip).overall };
    const sys = systemScore(key, skip, flagged, wl);
    const nIds = new Set(flagged.map((s) => s.id));
    film.variants[vname] = {
      routing: R.report,
      ...strip(sys),
      flagged: flagged.length,
      flag_changes_vs_v9: { dropped: v9Flagged.filter((s) => !nIds.has(s.id)).map((s) => `${s.id}(${s.flag_reasons.map((r) => r.id).join('+')})`), added: flagged.filter((s) => !v9Ids.has(s.id)).map((s) => `${s.id}(${s.flag_reasons.map((r) => `${r.id}${r.by === 'sonnet' ? '{S}' : ''}`).join('+')})`) },
      moments: { ...mom, whole_scene_fallback_total: mom.whole_scene_newly_flagged.length + mom.whole_scene_reason_not_asked.length },
      sensitivity_asked_only_spans: askedOnly,
      recall_changes_vs_v9: { lost: v9Sys.found.filter((x) => !sys.found.includes(x)), gained: sys.found.filter((x) => !v9Sys.found.includes(x)) },
      lost_item_trace: v9Sys.found.filter((x) => !sys.found.includes(x)).map((id) => {
        const it = sfItems.find((i) => i.id === id);
        const vs = v9Flagged.find((sc) => shareInside(it.start_ms, it.end_ms, union(spansOf(sc))) > 0);
        const ns = vs && flagged.find((sc) => sc.id === vs.id);
        const U = union(skip);
        return { id, text: (it.text ?? '').slice(0, 90), v9_scene: vs?.id ?? null, v9_reasons: vs?.flag_reasons.map((r) => `${r.id}${r.by === 'sonnet' ? '{S}' : ''}`) ?? [], narrow_status: !vs ? '-' : ns ? `still flagged (${ns.flag_reasons.map((r) => `${r.id}${r.by === 'sonnet' ? '{S}' : ''}`).join('+')}), span shrank: share in narrow skip ${r3(shareInside(it.start_ms, it.end_ms, U))}` : 'scene no longer flagged' };
      }),
      vs_live: versus(key, skip, liveSkip),
      vs_v9: versus(key, skip, v9Skip),
      provenance: provenance(flagged, sfItems),
      jev_questions: questionRows(sel.scenes, R.jevKeep, humanItems, sfItems, 'jev'),
      sonnet_on_same_contested_questions: questionRows(selectRun(run, POLICY, { cues, sonnet, used: SPLIT.sonnet_asked }).scenes, R.jevKeep.filter((q) => SPLIT.sonnet_asked.includes(q)), humanItems, sfItems, 'sonnet'),
      flag_reason_counts: flagged.flatMap((s) => s.flag_reasons.map((r) => `${r.id}${r.by === 'sonnet' ? '{S}' : ''}`)).reduce((o, x) => ((o[x] = (o[x] ?? 0) + 1), o), {}),
      _skip: skip, _scenes: sel.scenes,
    };
    pool.variants[vname].push(...skip.map(([a, b]) => [a + off, b + off]));
  }
  film.v9.vs_live = versus(key, v9Skip, liveSkip);
  // frozen v9: per flag reason (who answered it), scenes it flags, scenes it flags ALONE, and how many hold a should_flag item
  film.v9.reason_table = {};
  for (const s of v9Flagged) {
    const h = holds(s, sfItems).strict;
    for (const r of s.flag_reasons) {
      const k = `${r.id}${r.by === 'sonnet' ? '{S}' : ''}`;
      const o = (film.v9.reason_table[k] ??= { by: r.by, scenes: 0, holding_sf: 0, sole_reason_scenes: 0, sole_holding_sf: 0 });
      o.scenes++; if (h) o.holding_sf++;
      if (s.flag_reasons.length === 1) { o.sole_reason_scenes++; if (h) o.sole_holding_sf++; }
    }
  }
  // dropped v9 scenes (narrow): what they held
  film.v9.dropped_by_narrow = (film.variants.narrow.flag_changes_vs_v9.dropped).map((d) => {
    const id = d.split('(')[0]; const s = v9Flagged.find((x) => x.id === id); const h = holds(s, sfItems);
    return { scene: d, by: byOf(s), holds_sf_strict: h.strict, sf_items_found_in_v9: h.found, skip_min: r3((s.skip?.ms ?? 0) / 60000) };
  });
  pool.v9.push(...v9Skip.map(([a, b]) => [a + off, b + off]));
  pool.live.push(...liveSkip.map(([a, b]) => [a + off, b + off]));
  const pid = (id) => `${slug}:${id}`;
  for (const it of key.items) {
    const o = { ...it, id: pid(it.id), same_moment_as: (it.same_moment_as ?? []).map(pid) };
    for (const f of ['start_ms', 'end_ms', 'gap_start_ms', 'gap_end_ms']) if (Number.isFinite(it[f])) o[f] = it[f] + off;
    pool.items.push(o);
  }
  films.push(film);
});
function strip(sys) { const { _S, _G, found, ...rest } = sys; return rest; }

// ---- pooled ----------------------------------------------------------------------------------------
const pk = { items: pool.items, film_level: [] };
const sumF = (f) => films.reduce((a, x) => a + f(x), 0);
const pooledSys = (skip) => { const S = scoreKey(pk, skip); const G = scoreKey(pk, skip, { window: 'gap' }); return { strict: brief(S), gap: brief(G), conservative_recall: Math.min(S.recall_items.found, G.recall_items.found), of: S.recall_items.of }; };
const addProv = (list) => { const o = {}; for (const p of list) for (const [k, v] of Object.entries(p)) { o[k] ??= { scenes: 0, hold_sf_strict: 0, hold_sf_gap: 0, skip_min: 0, sf_items_found: 0 }; for (const f of Object.keys(v)) o[k][f] = r3(o[k][f] + v[f]); } return o; };
const wlSum = (get) => `${sumF((f) => get(f).covered ?? get(f).found)}/${sumF((f) => get(f).n)}`;
const pooled = {
  live: { ...pooledSys(pool.live), wordless_peaks_all: wlSum((f) => f.live.wordless_peaks_all), wordless_scenes: wlSum((f) => f.live.wordless_scenes) },
  v9: { ...pooledSys(pool.v9), wordless_peaks_all: wlSum((f) => f.v9.wordless_peaks_all), wordless_peaks_in_flagged: wlSum((f) => f.v9.wordless_peaks_in_flagged), wordless_scenes: wlSum((f) => f.v9.wordless_scenes), flagged: sumF((f) => f.v9.flagged), provenance: addProv(films.map((f) => f.v9.provenance)), vs_live: versus(pk, pool.v9, pool.live) },
  variants: {},
};
for (const v of Object.keys(VARIANTS)) {
  const V = (f) => f.variants[v];
  const qAgg = (field) => { const o = {}; for (const f of films) for (const [q, r] of Object.entries(V(f)[field])) { o[q] ??= { group: r.group, fires: 0, right: 0, catches: 0, group_items: 0, flag_reason_scenes: 0, flag_reason_scenes_holding_sf: 0 }; for (const x of ['fires', 'right', 'catches', 'group_items', 'flag_reason_scenes', 'flag_reason_scenes_holding_sf']) o[q][x] += r[x]; } for (const r of Object.values(o)) r.precision = r.fires ? r3(r.right / r.fires) : null; return o; };
  pooled.variants[v] = {
    ...pooledSys(pool.variants[v]),
    wordless_peaks_all: wlSum((f) => V(f).wordless_peaks_all), wordless_peaks_in_flagged: wlSum((f) => V(f).wordless_peaks_in_flagged), wordless_scenes: wlSum((f) => V(f).wordless_scenes),
    flagged: sumF((f) => V(f).flagged),
    moments: { reused_stored_moments: sumF((f) => V(f).moments.reused_stored_moments), whole_scene_newly_flagged: sumF((f) => V(f).moments.whole_scene_newly_flagged.length), whole_scene_reason_not_asked: sumF((f) => V(f).moments.whole_scene_reason_not_asked.length), whole_scene_as_in_v9: sumF((f) => V(f).moments.whole_scene_as_in_v9.length) },
    sensitivity_asked_only_spans: { ...pooledSys(pool.asked[v]), vs_live: versus(pk, pool.asked[v], pool.live), vs_v9: versus(pk, pool.asked[v], pool.v9) },
    provenance: addProv(films.map((f) => V(f).provenance)),
    vs_live: versus(pk, pool.variants[v], pool.live),
    vs_v9: versus(pk, pool.variants[v], pool.v9),
    jev_questions: qAgg('jev_questions'),
    sonnet_on_same_contested_questions: qAgg('sonnet_on_same_contested_questions'),
  };
}
for (const f of films) for (const v of Object.values(f.variants)) { delete v._skip; delete v._scenes; }
const result = { generated_at: new Date().toISOString(), offline: true, jev_set_file: 'narrow/jev-set.json', jev_set_written_at: JEVSET.written_at, harness_reproduces_frozen_v9: reproduce, films, pooled };
fs.writeFileSync(path.join(NOUT, 'rescore.json'), JSON.stringify(result, null, 2));

// ---- stdout ----------------------------------------------------------------------------------------
console.log('HARNESS CHECK (frozen v9 routing through this path):');
for (const r of reproduce) console.log(`  ${r.slug}: flags identical ${r.flags_identical}; skip frozen ${r.frozen_skip_min} min vs respan ${r.respan_skip_min}; scenes with different spans ${r.scenes_with_different_spans.join(',') || 'none'}`);
const line = (n, s) => `  ${n.padEnd(12)} cons recall ${s.conservative_recall}/${s.of}  strict ${s.strict.recall} gap ${s.gap.recall}  prec ${s.strict.precision}/${s.gap.precision}  skip ${s.strict.skip_minutes}  comic skipped ${s.strict.comic_tag_only_skipped}  wordless-all ${typeof s.wordless_peaks_all === 'string' ? s.wordless_peaks_all : `${s.wordless_peaks_all.covered}/${s.wordless_peaks_all.n}`}`;
const vs = (n, x) => `    ${n}: recall ${x.recall} precision ${x.precision} overall ${x.overall}; jitter rec a>b ${x.jitter.recall_a_gt_b} a<b ${x.jitter.recall_a_lt_b}; prec a>b ${x.jitter.precision_a_gt_b} a<b ${x.jitter.precision_a_lt_b}`;
for (const f of [...films, { slug: 'POOLED', live: pooled.live, v9: pooled.v9, variants: pooled.variants }]) {
  console.log(`\n=== ${f.slug}`);
  console.log(line('live', f.live)); console.log(line('v9', f.v9)); console.log(vs('v9 vs live', f.v9.vs_live));
  for (const [v, x] of Object.entries(f.variants)) {
    console.log(line(v, x)); console.log(vs(`${v} vs live`, x.vs_live)); console.log(vs(`${v} vs v9`, x.vs_v9));
    console.log(`    flagged ${x.flagged} (v9 ${f.v9.flagged}); moments ${JSON.stringify(x.moments)}`);
    console.log(`    asked-only-spans sensitivity ${JSON.stringify(x.sensitivity_asked_only_spans)}`);
    console.log(`    provenance ${JSON.stringify(x.provenance)}`);
    for (const t of x.lost_item_trace ?? []) console.log(`    LOST ${t.id} @${t.v9_scene} v9[${t.v9_reasons.join('+')}] -> ${t.narrow_status} | ${t.text}`);
    if (x.flag_changes_vs_v9) console.log(`    dropped ${x.flag_changes_vs_v9.dropped.join(' ') || '-'}\n    added ${x.flag_changes_vs_v9.added.join(' ') || '-'}\n    recall lost ${x.recall_changes_vs_v9.lost.join(',') || '-'} gained ${x.recall_changes_vs_v9.gained.join(',') || '-'}`);
    for (const [q, r] of Object.entries(x.jev_questions)) console.log(`    JEV ${q.padEnd(18)} fires ${r.fires} right ${r.right} prec ${r.precision} catches ${r.catches}/${r.group_items} reason-scenes ${r.flag_reason_scenes} holding-sf ${r.flag_reason_scenes_holding_sf}`);
    for (const [q, r] of Object.entries(x.sonnet_on_same_contested_questions)) console.log(`    SON ${q.padEnd(18)} fires ${r.fires} right ${r.right} prec ${r.precision} catches ${r.catches}/${r.group_items}`);
  }
  console.log(`    v9 provenance ${JSON.stringify(f.v9.provenance)}`);
  if (f.v9.reason_table) console.log(`    v9 reasons ${Object.entries(f.v9.reason_table).map(([k, o]) => `${k} ${o.holding_sf}/${o.scenes}${o.sole_reason_scenes ? ` sole ${o.sole_holding_sf}/${o.sole_reason_scenes}` : ''}`).join('; ')}`);
  if (f.v9.dropped_by_narrow) for (const d of f.v9.dropped_by_narrow) console.log(`    dropped ${d.scene} [${d.by}] holds_sf ${d.holds_sf_strict} found ${d.sf_items_found_in_v9.join(',') || '-'} skip ${d.skip_min}`);
}
console.log(`\nrouting (narrow, moana): ${JSON.stringify(films[2].variants.narrow.routing, null, 1)}`);
