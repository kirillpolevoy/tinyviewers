#!/usr/bin/env node
// SCORECARD: "When Jev asks questions about a scene, how well does it answer them?"
// Pure code over files already on disk: no model calls, no network, no database writes, no edits
// outside v8/scorecard/. The live DB for the dev films is rebuilt read-only from local files through
// scene-api/load.js (as v8/compare.js does); the held-out films use baseline/out/<slug>.built.json.
//
//   node v8/scorecard/score.mjs            -> v8/scorecard/scorecard.json + scorecard.md
//
// METHOD (also written into the outputs):
//  Key items: refs/<slug>.key.json items with source != 'codex-rules' and human_written != false, mapped
//    (mappable, finite start/end), with >= 1 category in the 13 v3 groups. Window = the item's gap window
//    [min(start, gap_start), max(end, gap_end)] (refscore.js gapKey). A scene "overlaps" an item when the
//    scene span and the window share > 0 ms. codex-rules items (model-written) are scored apart.
//  (1) Group recall: an item with category G is ANSWERED by a system when a scene overlapping its
//    window carries a tag in G. Jev = act-level tags of out/<slug>.tags.r1.json (after modifier
//    cancellation and the kind veto), incl. film-specific threat / child-in-danger / danger tags under
//    their own group; film-specific PRESENCE tags are excluded (who is on screen, not a concern, as in
//    compare.js; their groups are arbitrary, e.g. a protagonist under 'hostility'). Live = asserted
//    presence/event labels (mention channel excluded) mapped to groups via taxonomy-v3 BY_ID, as
//    compare.js does. Recall = answered / items with G. Reported for all mapped items (any
//    should_flag) and for should_flag === true only.
//  (2) Group precision (strict proxy): of the scenes carrying G, the share overlapping >= 1 key item
//    whose categories include G. Keys are incomplete (parent guides list notable moments, not every
//    scene where e.g. a character is in peril), so a correct tag on an unlisted moment counts as wrong:
//    the proxy is a LOWER bound, hardest on PRESENCE questions (keys list events, not every scene a
//    ghost or a witch is on screen). It also favours the live system: its scenes are longer (about
//    2-2.6 min vs 1.1-2.4 for Jev) and PRE-SELECTED (they cover only 19-46% of the runtime; Jev tiles
//    the whole film), so every live scene is already a likely hit. The base rate (share of ALL the
//    system's scenes that overlap a G item), lift = precision / base rate, the share of the film
//    tagged G and the share of G-tagged minutes inside G item windows are given alongside.
//    Group mapping caveat: Jev's child_in_danger is filed under 'peril' but its v3 id
//    family_in_danger is a 'separation' item in taxonomy-v3, which the live labels use.
//  (3) Per Jev QUESTION (each universal presence/event/derived item and each film-specific template):
//    raw probability per scene = presence max(pl, ps); event e.<id>; jump_scare min(appears_suddenly,
//    startled); film presence max(fpl, fps); film events fe.<id>. A question FIRES in a scene at
//    threshold t when p >= t and select.js did not cancel it (retold / imagined / comic modifiers,
//    scene-level) or veto it (kind gate). At t = 0.7 this reproduces the act tags (checked below).
//    recall = key items in the question's group caught by that question / items in the group;
//    precision proxy = fired scenes overlapping an item in the group / fired scenes; AUC = P(p on a
//    scene overlapping a G item > p on a scene overlapping none); missed items' best p histogram.
//    Live comparison: live asserted label with the question's v3 id (same_v3) or any label in G on an
//    overlapping live scene.
//  (4) DTDD: topics with a yes/no crowd majority; refscore.js dtddTargets maps a topic to specific tag
//    ids ('tags', headline) or, failing that, to its v3 groups ('groups', coarse). Jev says yes when any
//    scene carries a matching act tag; live when any asserted label matches (Jev ids -> v3 via
//    questions.js ITEMS). Grouped by the topic's first category.
//  (5) Held-out (tangled, coco, how-to-train-your-dragon) is primary; the 7 dev films (used to tune v8)
//    are reported apart. Reliability ranking: questions firing >= 3 times at 0.7 on the held-out films,
//    by Wilson 95% lower bound of the precision proxy (most) / upper bound (least); film:presence and
//    the animal_creature kind-veto parent are not ranked. Live on the dev films = 6 films (up has no
//    live scene file); Jev pooled dev numbers include up.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as T3 from '../../taxonomy-v3.js';
import * as L from '../../../../scene-api/load.js';
import { ITEMS, PRESENCE, EVENTS, DERIVED } from '../questions.js';
import { dtddTargets, union, inter, total } from '../refscore.js';
import { TS, DEV_FILMS } from '../env.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const V8 = path.resolve(HERE, '..');
const OUT = path.join(V8, 'out');
const HELD = ['tangled', 'coco', 'how-to-train-your-dragon'];
const DEV = [...DEV_FILMS];
const TH = [0.5, 0.6, 0.7, 0.8];
const ACT = 0.7;
const GROUPS = ['creatures_figures', 'objects_hazards', 'peril', 'violence', 'death', 'separation', 'injury', 'captivity', 'eerie', 'hostility', 'distress', 'animals', 'copyable'];
const G13 = new Set(GROUPS);
const POLICY = JSON.parse(fs.readFileSync(path.join(V8, 'policy.json'), 'utf8'));

const rj = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const r3 = (x) => (x == null || Number.isNaN(x) ? null : Math.round(x * 1000) / 1000);
const div = (a, b) => (b ? r3(a / b) : null);
const groupOfV3 = (id) => T3.BY_ID[id]?.group ?? null;
const overlaps = (s, w) => (w[1] > w[0] ? Math.min(s.end_ms, w[1]) - Math.max(s.start_ms, w[0]) > 0 : w[0] >= s.start_ms && w[0] <= s.end_ms);
function wilson(k, n, z = 1.96) {
  if (!n) return [null, null];
  const p = k / n; const d = 1 + (z * z) / n; const c = p + (z * z) / (2 * n); const m = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return [r3((c - m) / d), r3((c + m) / d)];
}
function auc(pos, neg) {
  if (!pos.length || !neg.length) return null;
  let s = 0;
  for (const a of pos) for (const b of neg) s += a > b ? 1 : a === b ? 0.5 : 0;
  return r3(s / (pos.length * neg.length));
}
const quant = (arr, q) => { if (!arr.length) return null; const a = [...arr].sort((x, y) => x - y); return r3(a[Math.floor(q * (a.length - 1))]); };
const dist = (a) => ({ n: a.length, p10: quant(a, 0.1), p50: quant(a, 0.5), p90: quant(a, 0.9), mean: a.length ? r3(a.reduce((x, y) => x + y, 0) / a.length) : null });

// ---- live DB for the dev films (read-only, local files) ------------------------------------------
const ctx = await L.openExperiment(TS);
const v2map = L.buildV2Map(ctx.taxonomy);
const vocabIds = new Set(L.buildVocabulary(ctx.taxonomy).items.map((i) => i.id));
function liveFor(slug) {
  let built; let source;
  try {
    if (HELD.includes(slug)) { built = rj(path.join(V8, 'baseline', 'out', `${slug}.built.json`)); source = `v8/baseline/out/${slug}.built.json`; }
    else { const inputs = L.readFilmInputs(slug, ctx); built = L.buildFilmFrom(inputs, { srt: ctx.srt, v2map, vocabIds }); source = `load.js: ${inputs.sceneSourceFile} + ${inputs.presenceSourceFile}`; }
  } catch (err) { return { error: err.message, scenes: [] }; }
  const scenes = built.scenes.map((s) => {
    const v3 = built.labels.filter((l) => l.scene_id === s.id && l.asserted && l.channel !== 'mention').map((l) => l.vocabulary_id);
    return { id: s.id.split(':').pop(), start_ms: s.start_ms, end_ms: s.end_ms, v3: new Set(v3), groups: new Set(v3.map(groupOfV3).filter(Boolean)) };
  });
  return { source, scenes };
}

// ---- Jev (v8) --------------------------------------------------------------------------------------
const KIND_GATE = Object.fromEntries(PRESENCE.filter((p) => p.kindGate).map((p) => [p.id, p.kindGate]));
// universal question catalogue
const UNIVERSAL = [
  ...PRESENCE.map((p) => ({ q: p.id, layer: 'presence', group: p.group, v3: p.v3 })),
  ...EVENTS.map((e) => ({ q: e.id, layer: 'event', group: e.group, v3: e.v3 })),
  ...Object.values(DERIVED).map((d) => ({ q: d.id, layer: 'derived', group: d.group, v3: d.v3 })),
  { q: 'animal_creature', layer: 'kind_veto_parent', group: POLICY.parent_tag.group, v3: null },
];
const UQ = Object.fromEntries(UNIVERSAL.map((u) => [u.q, u]));

function jevFor(slug) {
  const tags = rj(path.join(OUT, `${slug}.tags.r1.json`));
  const jev = rj(path.join(OUT, `${slug}.jev.r1.json`));
  const byId = new Map(jev.scenes.map((s) => [s.id, s]));
  const filmItems = new Map((jev.film_items ?? []).map((it) => [it.id, it]));
  const mismatch = [];
  const scenes = tags.scenes.map((s) => {
    const a = byId.get(s.id)?.answers ?? {};
    const hasSummary = a.ps !== null && a.ps !== undefined;
    const cancelled = new Set((s.cancelled ?? []).map((c) => c.id));
    const kind = a.kind;
    const vetoKind = (id) => KIND_GATE[id] && kind && kind.choice !== 'none' && kind.confidence >= POLICY.kind_confidence && !KIND_GATE[id].includes(kind.choice);
    // instances: one per question in this scene: { key (question id or film item id), q (catalogue key), group, v3, p, blocked }
    const inst = [];
    for (const p of PRESENCE) {
      const pr = Math.max(a.pl?.[p.id] ?? 0, hasSummary ? a.ps?.[p.id] ?? 0 : 0);
      inst.push({ key: p.id, q: p.id, group: p.group, v3: p.v3, p: pr, blocked: vetoKind(p.id) });
    }
    const vetoedP = PRESENCE.filter((p) => vetoKind(p.id)).map((p) => Math.max(a.pl?.[p.id] ?? 0, hasSummary ? a.ps?.[p.id] ?? 0 : 0));
    inst.push({ key: 'animal_creature', q: 'animal_creature', group: POLICY.parent_tag.group, v3: null, p: vetoedP.length ? Math.max(...vetoedP) : 0, blocked: false });
    for (const e of EVENTS) { const p = a.e?.[e.id]; if (p === undefined) continue; inst.push({ key: e.id, q: e.id, group: e.group, v3: e.v3, p, blocked: cancelled.has(e.id) }); }
    for (const d of Object.values(DERIVED)) inst.push({ key: d.id, q: d.id, group: d.group, v3: d.v3, p: Math.min(...d.from.map((f) => a.e?.[f] ?? 0)), blocked: false });
    for (const [id, it] of filmItems) {
      if (it.type === 'presence') inst.push({ key: id, q: `film:${it.type}`, film: true, group: it.group, v3: it.v3 ?? null, p: Math.max(a.fpl?.[id] ?? 0, hasSummary ? a.fps?.[id] ?? 0 : 0), blocked: false, concern: false });
      else { const p = a.fe?.[id]; if (p === undefined) continue; inst.push({ key: id, q: `film:${it.type}`, film: true, group: it.group, v3: it.v3 ?? null, p, blocked: cancelled.has(id) }); }
    }
    for (const x of inst) if (x.concern === undefined) x.concern = true;
    const act = (s.tags ?? []).filter((t) => t.level === 'act');
    const concernAct = act.filter((t) => !(t.film_specific && t.type === 'presence'));
    // reconstruction check at 0.7
    const rec = new Set(inst.filter((x) => x.p >= ACT && !x.blocked).map((x) => x.key));
    const off = new Set(act.map((t) => t.id));
    for (const k of rec) if (!off.has(k)) mismatch.push(`${s.id}:${k}+`);
    for (const k of off) if (!rec.has(k)) mismatch.push(`${s.id}:${k}-`);
    return { id: s.id, start_ms: s.start_ms, end_ms: s.end_ms, groups: new Set(concernAct.map((t) => t.group)), inst };
  });
  return { scenes, film_items: [...filmItems.values()].map((it) => ({ id: it.id, type: it.type, group: it.group })), reconstruction_mismatches: mismatch };
}
const groupsAt = (scene, t) => new Set(scene.inst.filter((x) => x.concern && !x.blocked && x.p >= t).map((x) => x.group));

// ---- key ----------------------------------------------------------------------------------------------
function keyFor(slug) {
  const k = rj(path.join(TS, 'refs', `${slug}.key.json`));
  const prep = (i) => {
    const cats = (i.categories ?? []).filter((c) => G13.has(c));
    const w0 = Number.isFinite(i.gap_start_ms) ? Math.min(i.start_ms, i.gap_start_ms) : i.start_ms;
    const w1 = Number.isFinite(i.gap_end_ms) ? Math.max(i.end_ms, i.gap_end_ms) : i.end_ms;
    return { id: i.id, source: i.source, should_flag: i.should_flag, marker: i.marker ?? null, cats, w: [w0, w1] };
  };
  const mapped = (i) => i.mappable && Number.isFinite(i.start_ms) && Number.isFinite(i.end_ms);
  const human = k.items.filter((i) => i.source !== 'codex-rules' && i.human_written !== false);
  const codex = k.items.filter((i) => i.source === 'codex-rules' || i.human_written === false);
  return {
    items_total: k.items.length, human_total: human.length, codex_total: codex.length,
    human: human.filter(mapped).map(prep).filter((i) => i.cats.length),
    human_unmapped: human.filter((i) => !mapped(i)).length,
    codex: codex.filter(mapped).map(prep).filter((i) => i.cats.length),
    dtdd: (k.film_level ?? []).filter((x) => x.source === 'doesthedogdie' && (x.answer === 'yes' || x.answer === 'no')),
  };
}

// ---- load every film -------------------------------------------------------------------------------
const FILMS = {};
for (const slug of [...HELD, ...DEV]) {
  const key = keyFor(slug);
  const jev = jevFor(slug);
  const live = liveFor(slug);
  const filmEnd = Math.max(...jev.scenes.map((s) => s.end_ms));
  FILMS[slug] = { slug, held_out: HELD.includes(slug), key, jev, live, filmEnd };
}

// ---- (1)(2) group metrics -------------------------------------------------------------------------------
// counts for one film, one system (scenes with .groups), one item list
function groupCounts(items, scenes, filmEnd) {
  const out = {};
  for (const G of GROUPS) {
    const its = items.filter((i) => i.cats.includes(G));
    const itsTrue = its.filter((i) => i.should_flag === true);
    const answered = (i) => scenes.some((s) => s.groups.has(G) && overlaps(s, i.w));
    const tagged = scenes.filter((s) => s.groups.has(G));
    const hitScene = (s) => its.some((i) => overlaps(s, i.w));
    const tagU = union(tagged.map((s) => [s.start_ms, s.end_ms]));
    const itemU = union(its.map((i) => i.w));
    out[G] = {
      items: its.length, answered: its.filter(answered).length,
      items_sf: itsTrue.length, answered_sf: itsTrue.filter(answered).length,
      tagged_scenes: tagged.length, tagged_hit: tagged.filter(hitScene).length,
      scenes: scenes.length, scenes_hit: scenes.filter(hitScene).length,
      tagged_ms: total(tagU), tagged_in_item_ms: inter(tagU, itemU), film_ms: filmEnd,
    };
  }
  return out;
}
function addCounts(acc, c) { for (const G of GROUPS) { acc[G] ??= {}; for (const [k, v] of Object.entries(c[G])) acc[G][k] = (acc[G][k] ?? 0) + v; } return acc; }
function finishGroups(c) {
  const rows = {};
  const tot = {};
  for (const G of GROUPS) {
    const x = c[G];
    for (const [k, v] of Object.entries(x)) if (k !== 'film_ms' && k !== 'scenes') tot[k] = (tot[k] ?? 0) + v;
    const prec = div(x.tagged_hit, x.tagged_scenes); const base = div(x.scenes_hit, x.scenes);
    rows[G] = {
      items: x.items, recall: div(x.answered, x.items), answered: x.answered,
      items_should_flag: x.items_sf, recall_should_flag: div(x.answered_sf, x.items_sf),
      tagged_scenes: x.tagged_scenes, precision_proxy: prec, base_rate: base, lift: prec != null && base ? r3(prec / base) : null,
      tagged_share_of_film: div(x.tagged_ms, x.film_ms), minute_precision: div(x.tagged_in_item_ms, x.tagged_ms),
    };
  }
  rows.ALL = { items: tot.items, recall: div(tot.answered, tot.items), answered: tot.answered, items_should_flag: tot.items_sf, recall_should_flag: div(tot.answered_sf, tot.items_sf), tagged_scenes: tot.tagged_scenes, precision_proxy: div(tot.tagged_hit, tot.tagged_scenes), note: 'micro-average over (item, group) and (scene, group) pairs' };
  return rows;
}
function groupTable(slugs, sys, { t = null, itemsOf = (f) => f.key.human } = {}) {
  const acc = {};
  const per = {};
  for (const slug of slugs) {
    const f = FILMS[slug];
    let scenes;
    if (sys === 'jev') scenes = t == null ? f.jev.scenes : f.jev.scenes.map((s) => ({ ...s, groups: groupsAt(s, t) }));
    else { if (f.live.error) continue; scenes = f.live.scenes; }
    const c = groupCounts(itemsOf(f), scenes, f.filmEnd);
    addCounts(acc, c);
    per[slug] = finishGroups(c);
  }
  return { pooled: Object.keys(acc).length ? finishGroups(acc) : null, per_film: per };
}

// ---- (3) per question --------------------------------------------------------------------------------
function questionTable(slugs) {
  // A question = a universal item (one instance per film) or a film-specific template (all of that
  // film's generated items of that type; each instance carries its own group). Per scene and threshold
  // t the question FIRES when any unblocked instance has p >= t; the scene is a hit when it overlaps a
  // key item whose categories include the group of a fired instance. A key item is in the question's
  // denominator when its categories include the group of any instance; it is CAUGHT at t when an
  // overlapping scene has a fired instance whose group is in the item's categories.
  const Q = {};
  const get = (q, meta) => (Q[q] ??= { q, ...meta, items: 0, caught: Object.fromEntries(TH.map((t) => [t, 0])), fires: Object.fromEntries(TH.map((t) => [t, 0])), fires_hit: Object.fromEntries(TH.map((t) => [t, 0])), scene_slots: 0, scene_slots_hit: 0, pos_p: [], neg_p: [], missed_best_p: [], unique: 0, live_v3_caught: 0, live_group_caught: 0, jev_caught_live_v3_too: 0, jev_caught_live_group_too: 0, live_v3_only: 0, live_v3_fires: 0, live_v3_fires_hit: 0, live_scenes: 0, films: new Set(), instances: 0 });
  for (const slug of slugs) {
    const f = FILMS[slug];
    const items = f.key.human;
    const scenes = f.jev.scenes;
    const live = f.live.error ? null : f.live.scenes;
    // question -> instances meta
    const qs = new Map();
    for (const s of scenes) for (const x of s.inst) {
      if (!qs.has(x.q)) qs.set(x.q, { film: !!x.film, inst: new Map() });
      qs.get(x.q).inst.set(x.key, { group: x.group, v3: x.v3 });
    }
    // unique: which questions catch (item, G) at ACT (concern questions only)
    const catchers = new Map();
    for (const s of scenes) for (const x of s.inst) if (x.concern && !x.blocked && x.p >= ACT) for (const i of items) if (i.cats.includes(x.group) && overlaps(s, i.w)) { const k = `${i.id}|${x.group}`; if (!catchers.has(k)) catchers.set(k, new Set()); catchers.get(k).add(x.q); }
    for (const [q, meta] of qs) {
      const groups = new Set([...meta.inst.values()].map((m) => m.group));
      const v3s = new Set([...meta.inst.values()].map((m) => m.v3).filter((v) => v != null));
      const row = get(q, meta.film ? { layer: 'film_template', group: 'per film item', v3: null } : { layer: UQ[q]?.layer, group: [...groups][0], v3: [...v3s][0] ?? null });
      row.films.add(slug); row.instances += meta.inst.size; if (v3s.size) row.has_v3 = true;
      const its = items.filter((i) => i.cats.some((g) => groups.has(g)));
      row.items += its.length;
      // per scene: this question's unblocked instances
      const per = scenes.map((s) => ({ s, xs: s.inst.filter((x) => x.q === q).map((x) => ({ group: x.group, p: x.blocked ? 0 : x.p })) }));
      for (const { s, xs } of per) {
        const pmax = xs.length ? Math.max(...xs.map((x) => x.p)) : 0;
        const pos = its.some((i) => overlaps(s, i.w));
        (pos ? row.pos_p : row.neg_p).push(pmax);
        row.scene_slots += 1; if (pos) row.scene_slots_hit += 1;
        for (const t of TH) {
          const fired = xs.filter((x) => x.p >= t);
          if (!fired.length) continue;
          row.fires[t] += 1;
          const fg = new Set(fired.map((x) => x.group));
          if (its.some((i) => overlaps(s, i.w) && i.cats.some((g) => fg.has(g)))) row.fires_hit[t] += 1;
        }
      }
      for (const i of its) {
        const cats = i.cats.filter((g) => groups.has(g));
        const ps = per.filter(({ s }) => overlaps(s, i.w)).flatMap(({ xs }) => xs.filter((x) => cats.includes(x.group)).map((x) => x.p));
        const best = ps.length ? Math.max(...ps) : 0;
        for (const t of TH) if (best >= t) row.caught[t] += 1;
        if (best < ACT) row.missed_best_p.push(best);
        const jevCaught = best >= ACT;
        if (jevCaught && cats.some((g) => { const c = catchers.get(`${i.id}|${g}`); return c && c.size === 1 && c.has(q); })) row.unique += 1;
        if (live) {
          const lv = live.filter((s) => overlaps(s, i.w));
          const lvV3 = v3s.size > 0 && lv.some((s) => [...v3s].some((v) => s.v3.has(v)));
          const lvG = lv.some((s) => cats.some((g) => s.groups.has(g)));
          if (lvV3) row.live_v3_caught += 1;
          if (lvG) row.live_group_caught += 1;
          if (jevCaught && lvV3) row.jev_caught_live_v3_too += 1;
          if (jevCaught && lvG) row.jev_caught_live_group_too += 1;
          if (!jevCaught && lvV3) row.live_v3_only += 1;
        }
      }
      if (live && v3s.size) {
        row.live_scenes += live.length;
        for (const s of live) if ([...v3s].some((v) => s.v3.has(v))) { row.live_v3_fires += 1; if (its.some((i) => overlaps(s, i.w))) row.live_v3_fires_hit += 1; }
      }
    }
  }
  const out = [];
  for (const row of Object.values(Q)) {
    const base = div(row.scene_slots_hit, row.scene_slots);
    const at = Object.fromEntries(TH.map((t) => [t, { recall: div(row.caught[t], row.items), caught: row.caught[t], fires: row.fires[t], fire_rate: div(row.fires[t], row.scene_slots), precision_proxy: div(row.fires_hit[t], row.fires[t]) }]));
    const [lo, hi] = wilson(row.fires_hit[ACT], row.fires[ACT]);
    const mb = row.missed_best_p;
    const hasV3 = row.has_v3;
    out.push({
      question: row.q, layer: row.layer, group: row.group, v3: row.v3, films: row.films.size, instances: row.instances, key_items_in_group: row.items,
      at, base_rate: base, lift_at_0_7: at[ACT].precision_proxy != null && base ? r3(at[ACT].precision_proxy / base) : null,
      precision_wilson_0_7: { lo, hi }, auc: auc(row.pos_p, row.neg_p),
      p_on_scenes_overlapping_group_items: dist(row.pos_p), p_on_other_scenes: dist(row.neg_p),
      missed_items_best_p: { n: mb.length, lt_0_4: mb.filter((p) => p < 0.4).length, '0_4_to_0_5': mb.filter((p) => p >= 0.4 && p < 0.5).length, '0_5_to_0_6': mb.filter((p) => p >= 0.5 && p < 0.6).length, '0_6_to_0_7': mb.filter((p) => p >= 0.6 && p < 0.7).length },
      unique_catches_0_7: row.unique,
      live: {
        same_v3_recall: hasV3 && row.live_scenes ? div(row.live_v3_caught, row.items) : null, same_group_recall: div(row.live_group_caught, row.items),
        of_jev_caught_live_same_v3_too: hasV3 ? `${row.jev_caught_live_v3_too}/${row.caught[ACT]}` : null, of_jev_caught_live_group_too: `${row.jev_caught_live_group_too}/${row.caught[ACT]}`,
        live_same_v3_catches_jev_missed: hasV3 ? row.live_v3_only : null,
        live_same_v3_fires: hasV3 ? row.live_v3_fires : null, live_same_v3_precision_proxy: hasV3 ? div(row.live_v3_fires_hit, row.live_v3_fires) : null, live_scenes: row.live_scenes,
      },
    });
  }
  const order = (r) => [GROUPS.indexOf(r.group) < 0 ? 99 : GROUPS.indexOf(r.group), r.question];
  return out.sort((a, b) => { const [ga, qa] = order(a); const [gb, qb] = order(b); return ga - gb || qa.localeCompare(qb); });
}

// ---- (4) DTDD --------------------------------------------------------------------------------------------
function dtddTable(slugs) {
  const rows = [];
  for (const slug of slugs) {
    const f = FILMS[slug];
    const jIds = new Set(f.jev.scenes.flatMap((s) => s.inst.filter((x) => !x.blocked && x.p >= ACT).map((x) => x.key)));
    const jGroups = new Set(f.jev.scenes.flatMap((s) => [...s.groups]));
    const live = f.live.error ? null : f.live.scenes;
    const lV3 = live ? new Set(live.flatMap((s) => [...s.v3])) : null;
    const lGroups = live ? new Set(live.flatMap((s) => [...s.groups])) : null;
    for (const t of f.key.dtdd) {
      const tg = dtddTargets(t);
      if (tg.kind === 'groups' && !tg.ids.length) continue;
      const jev = tg.kind === 'tags' ? tg.ids.some((id) => jIds.has(id)) : tg.ids.some((g) => jGroups.has(g));
      const lv = !live ? null : tg.kind === 'tags' ? tg.ids.some((id) => lV3.has(ITEMS[id]?.v3 ?? id)) : tg.ids.some((g) => lGroups.has(g));
      rows.push({ film: slug, id: t.id, kind: (t.categories ?? [])[0] ?? 'none', target: tg.kind, target_ids: tg.ids.join('|'), crowd: t.answer, margin: t.votes?.margin ?? null, jev: jev ? 'yes' : 'no', live: lv == null ? null : lv ? 'yes' : 'no' });
    }
  }
  const agg = (rs) => {
    const c = (sys, a, v) => rs.filter((r) => r.crowd === a && r[sys] === v).length;
    const withLive = rs.filter((r) => r.live != null);
    return {
      topics: rs.length, crowd_yes: rs.filter((r) => r.crowd === 'yes').length,
      jev_agree: rs.filter((r) => r.jev === r.crowd).length, jev_tp: c('jev', 'yes', 'yes'), jev_tn: c('jev', 'no', 'no'), jev_fp: c('jev', 'no', 'yes'), jev_fn: c('jev', 'yes', 'no'),
      live_topics: withLive.length, live_agree: withLive.filter((r) => r.live === r.crowd).length, live_tp: c('live', 'yes', 'yes'), live_tn: c('live', 'no', 'no'), live_fp: c('live', 'no', 'yes'), live_fn: c('live', 'yes', 'no'),
      jev_live_same: withLive.filter((r) => r.jev === r.live).length,
    };
  };
  const byKind = (rs) => { const o = {}; for (const k of [...new Set(rs.map((r) => r.kind))].sort()) o[k] = agg(rs.filter((r) => r.kind === k)); o.ALL = agg(rs); return o; };
  const spec = rows.filter((r) => r.target === 'tags');
  const coarse = rows.filter((r) => r.target === 'groups');
  // per target (specific topics): which tag ids drive the answers
  const byTarget = {};
  for (const r of spec) { byTarget[r.target_ids] ??= []; byTarget[r.target_ids].push(r); }
  return {
    specific_by_kind: byKind(spec), coarse_group_fallback_by_kind: byKind(coarse),
    specific_by_target: Object.fromEntries(Object.entries(byTarget).map(([k, rs]) => [k, agg(rs)])),
    specific_rows: spec.map(({ film, id, kind, target_ids, crowd, margin, jev, live }) => ({ film, id, kind, target_ids, crowd, margin, jev, live })),
  };
}

// ---- codex-rules items (model-written, separate) ----------------------------------------------------
function codexTable(slugs) {
  const res = { by_marker: {}, groups: null };
  for (const slug of slugs) {
    const f = FILMS[slug];
    for (const i of f.key.codex) {
      const m = i.marker ?? 'none';
      const r = (res.by_marker[m] ??= { items: 0, jev_group: 0, live_group: 0, jev_rule_question: 0 });
      r.items += 1;
      if (f.jev.scenes.some((s) => overlaps(s, i.w) && i.cats.some((g) => s.groups.has(g)))) r.jev_group += 1;
      if (!f.live.error && f.live.scenes.some((s) => overlaps(s, i.w) && i.cats.some((g) => s.groups.has(g)))) r.live_group += 1;
      const qs = m === 'villain_threat' ? ['threatens_harm', 'plots_harm', 'film:threatens'] : m === 'child_terrified' ? ['child_frightened'] : [];
      if (f.jev.scenes.some((s) => overlaps(s, i.w) && s.inst.some((x) => qs.includes(x.q) && !x.blocked && x.p >= ACT))) r.jev_rule_question += 1;
    }
  }
  res.groups = groupTable(slugs, 'jev', { itemsOf: (f) => f.key.codex }).pooled;
  res.groups_live = groupTable(slugs.filter((s) => !FILMS[s].live.error), 'live', { itemsOf: (f) => f.key.codex }).pooled;
  return res;
}

// ---- assemble ---------------------------------------------------------------------------------------
function overview(qs) {
  const ranked = qs.filter((q) => q.question !== 'film:presence' && q.question !== 'animal_creature');
  const fired = ranked.filter((q) => q.at[ACT].fires > 0);
  const aucs = ranked.filter((q) => q.p_on_scenes_overlapping_group_items.n >= 5 && q.auc != null).map((q) => q.auc);
  return {
    questions: ranked.length, fired_at_0_7: fired.length, never_fired_at_0_7: ranked.length - fired.length,
    fired_with_lift_gt_1: fired.filter((q) => q.lift_at_0_7 != null && q.lift_at_0_7 > 1).length,
    fired_with_precision_ge_0_5: fired.filter((q) => q.at[ACT].precision_proxy >= 0.5).length,
    auc_questions_with_ge_5_positive_scenes: aucs.length, auc_median: quant(aucs, 0.5), auc_ge_0_7: aucs.filter((a) => a >= 0.7).length, auc_ge_0_8: aucs.filter((a) => a >= 0.8).length, auc_lt_0_6: aucs.filter((a) => a < 0.6).length,
  };
}
function setReport(slugs) {
  const sweep = Object.fromEntries(TH.map((t) => [t, groupTable(slugs, 'jev', { t }).pooled]));
  return {
    films: slugs,
    groups: { jev: groupTable(slugs, 'jev'), live: groupTable(slugs, 'live') },
    jev_group_threshold_sweep: sweep,
    questions: questionTable(slugs),
    question_overview: null,
    dtdd: dtddTable(slugs),
    codex_rules_items: codexTable(slugs),
  };
}
const coverage = Object.fromEntries(Object.values(FILMS).map((f) => [f.slug, {
  held_out: f.held_out, key_items: f.key.items_total, human_items: f.key.human_total, human_mapped_with_categories: f.key.human.length, human_unmapped: f.key.human_unmapped,
  human_mapped_should_flag_true: f.key.human.filter((i) => i.should_flag === true).length, codex_rules_items: f.key.codex_total, codex_mapped: f.key.codex.length, dtdd_yes_no_topics: f.key.dtdd.length,
  jev_scenes: f.jev.scenes.length, jev_mean_scene_min: r3(f.jev.scenes.reduce((a, s) => a + s.end_ms - s.start_ms, 0) / f.jev.scenes.length / 60000),
  live_scenes: f.live.error ? null : f.live.scenes.length, live_mean_scene_min: f.live.error ? null : r3(f.live.scenes.reduce((a, s) => a + s.end_ms - s.start_ms, 0) / f.live.scenes.length / 60000),
  live_share_of_film_in_scenes: f.live.error ? null : r3(total(union(f.live.scenes.map((s) => [s.start_ms, s.end_ms]))) / f.filmEnd),
  live_source: f.live.source ?? null, live_error: f.live.error ?? null,
  act_tag_reconstruction_mismatches: f.jev.reconstruction_mismatches.length, mismatch_examples: f.jev.reconstruction_mismatches.slice(0, 5),
}]));

const held = setReport(HELD);
const dev = setReport(DEV);
for (const R of [held, dev]) R.question_overview = overview(R.questions);

// reliability ranking (held-out, >= 3 fires at 0.7), with the dev numbers of the same question
const devQ = new Map(dev.questions.map((q) => [q.question, q]));
const brief = (q) => q && { question: q.question, group: q.group, fires: q.at[ACT].fires, precision_proxy: q.at[ACT].precision_proxy, wilson: q.precision_wilson_0_7, base_rate: q.base_rate, lift: q.lift_at_0_7, recall: q.at[ACT].recall, items: q.key_items_in_group, auc: q.auc };
const NOT_RANKED = new Set(['film:presence', 'animal_creature']); // who is on screen (group arbitrary); kind-veto parent (not a question)
const eligible = held.questions.filter((q) => q.at[ACT].fires >= 3 && !NOT_RANKED.has(q.question));
const most = [...eligible].sort((a, b) => b.precision_wilson_0_7.lo - a.precision_wilson_0_7.lo || b.at[ACT].fires - a.at[ACT].fires).slice(0, 8).map((q) => ({ held_out: brief(q), dev: brief(devQ.get(q.question)) }));
const least = [...eligible].sort((a, b) => a.precision_wilson_0_7.hi - b.precision_wilson_0_7.hi || b.at[ACT].fires - a.at[ACT].fires).slice(0, 8).map((q) => ({ held_out: brief(q), dev: brief(devQ.get(q.question)) }));

const METHOD = (() => { const ls = fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n'); const a = ls.findIndex((l) => l.startsWith('// METHOD')); const b = ls.findIndex((l) => l.startsWith('import ')); return ls.slice(a, b).filter((l) => l.startsWith('//')).map((l) => l.replace(/^\/\/ ?/, '')).join('\n'); })();
const result = {
  generated_at: new Date().toISOString(), method: METHOD, thresholds: TH, act_threshold_in_policy: POLICY.act,
  coverage, held_out: held, dev, reliability: { rule: 'held-out questions with >= 3 fires at 0.7 (film:presence and the animal_creature kind-veto parent excluded); most = highest Wilson 95% lower bound of precision proxy; least = lowest upper bound', eligible: eligible.length, most, least },
};
fs.writeFileSync(path.join(HERE, 'scorecard.json'), JSON.stringify(result, (k, v) => (v instanceof Set ? [...v] : v), 2));

// ---- markdown --------------------------------------------------------------------------------------------
const f = (x) => (x == null ? '-' : typeof x === 'number' ? String(x) : x);
const pct = (x) => (x == null ? '-' : `${Math.round(x * 100)}%`);
const table = (head, rows) => [`| ${head.join(' | ')} |`, `|${head.map(() => '---').join('|')}|`, ...rows.map((r) => `| ${r.map(f).join(' | ')} |`)].join('\n');
const md = [];
md.push('# Jev question scorecard (v8 vs live Sonnet, human keys)\n');
md.push('## Method\n');
md.push('```\n' + METHOD + '\n```\n');
md.push('## Coverage\n');
md.push(table(['film', 'split', 'human mapped items', 'of which should_flag', 'human unmapped', 'codex-rules mapped', 'DTDD topics', 'Jev scenes', 'Jev min/scene', 'live scenes', 'live min/scene', 'live share of film', 'act-tag reconstruction mismatches'],
  Object.entries(coverage).map(([s, c]) => [s, c.held_out ? 'held-out' : 'dev', c.human_mapped_with_categories, c.human_mapped_should_flag_true, c.human_unmapped, c.codex_mapped, c.dtdd_yes_no_topics, c.jev_scenes, c.jev_mean_scene_min, c.live_scenes ?? `n/a (${c.live_error})`, c.live_mean_scene_min, pct(c.live_share_of_film_in_scenes), c.act_tag_reconstruction_mismatches])));
md.push('');
for (const [name, R] of [['HELD-OUT (tangled, coco, how-to-train-your-dragon)', held], ['DEV (7 films; up has no live baseline)', dev]]) {
  md.push(`## ${name}\n`);
  md.push('### Group recall / precision proxy (Jev act tags vs live labels)\n');
  const J = R.groups.jev.pooled; const Lv = R.groups.live.pooled;
  md.push(table(['group', 'items', 'Jev recall', 'live recall', 'Jev recall sf', 'live recall sf', 'Jev tagged scenes', 'Jev prec', 'Jev base', 'Jev lift', 'live tagged scenes', 'live prec', 'live base', 'live lift', 'Jev film share', 'live film share', 'Jev min-prec', 'live min-prec'],
    [...GROUPS, 'ALL'].map((G) => [G, J[G].items, pct(J[G].recall), pct(Lv?.[G]?.recall), pct(J[G].recall_should_flag), pct(Lv?.[G]?.recall_should_flag), J[G].tagged_scenes, pct(J[G].precision_proxy), pct(J[G].base_rate), J[G].lift, Lv?.[G]?.tagged_scenes, pct(Lv?.[G]?.precision_proxy), pct(Lv?.[G]?.base_rate), Lv?.[G]?.lift, pct(J[G].tagged_share_of_film), pct(Lv?.[G]?.tagged_share_of_film), pct(J[G].minute_precision), pct(Lv?.[G]?.minute_precision)])));
  md.push('\nsf = should_flag === true items only. Live recall on the dev films excludes up (no live baseline); Jev pooled includes it.\n');
  md.push('### Per film, ALL groups (micro)\n');
  md.push(table(['film', 'items', 'Jev recall', 'live recall', 'Jev prec', 'live prec'], R.films.map((s) => [s, R.groups.jev.per_film[s].ALL.items, pct(R.groups.jev.per_film[s].ALL.recall), pct(R.groups.live.per_film[s]?.ALL.recall), pct(R.groups.jev.per_film[s].ALL.precision_proxy), pct(R.groups.live.per_film[s]?.ALL.precision_proxy)])));
  md.push('\n### Jev group threshold sweep (recall / precision proxy / tagged scenes)\n');
  md.push(table(['group', ...TH.map((t) => `@${t}`)], [...GROUPS, 'ALL'].map((G) => [G, ...TH.map((t) => { const x = R.jev_group_threshold_sweep[t][G]; return `${pct(x.recall)} / ${pct(x.precision_proxy)} / ${x.tagged_scenes}`; })])));
  md.push('\n### Question overview (film:presence and animal_creature excluded)\n');
  md.push(table(Object.keys(R.question_overview), [Object.values(R.question_overview)]));
  md.push('\n### Per question (Jev) with live comparison\n');
  md.push('rec/prec at 0.5, 0.6, 0.7, 0.8; fires = scenes (film items: scene x item) where the question fires; AUC = scenes overlapping a group item vs the rest; missed 0.5-0.7 = key items missed at 0.7 whose best p is in [0.5, 0.7); live v3 = live label with the same v3 id.\n');
  md.push(table(['question', 'group', 'items', 'fires@.7', 'rate@.7', 'rec .5/.6/.7/.8', 'prec .5/.6/.7/.8', 'base', 'lift@.7', 'AUC', 'p50 pos/neg', 'missed', 'missed 0.5-0.7', 'unique@.7', 'live v3 rec', 'live grp rec', 'Jev-caught also live v3', 'live v3 prec', 'live v3 fires'],
    R.questions.filter((q) => q.key_items_in_group > 0 || q.at[0.5].fires > 0).map((q) => [q.question, q.group, q.key_items_in_group, q.at[ACT].fires, pct(q.at[ACT].fire_rate), TH.map((t) => pct(q.at[t].recall)).join(' '), TH.map((t) => pct(q.at[t].precision_proxy)).join(' '), pct(q.base_rate), q.lift_at_0_7, q.auc, `${f(q.p_on_scenes_overlapping_group_items.p50)}/${f(q.p_on_other_scenes.p50)}`, q.missed_items_best_p.n, q.missed_items_best_p['0_5_to_0_6'] + q.missed_items_best_p['0_6_to_0_7'], q.unique_catches_0_7, pct(q.live?.same_v3_recall), pct(q.live?.same_group_recall), q.live?.of_jev_caught_live_same_v3_too, pct(q.live?.live_same_v3_precision_proxy), q.live?.live_same_v3_fires])));
  md.push('\n### DTDD topics, specific tag mapping, by kind (topic first category)\n');
  const D = R.dtdd.specific_by_kind;
  md.push(table(['kind', 'topics', 'crowd yes', 'Jev agree', 'Jev tp/tn/fp/fn', 'live agree', 'live tp/tn/fp/fn', 'Jev=live'], Object.entries(D).map(([k, x]) => [k, x.topics, x.crowd_yes, `${x.jev_agree}/${x.topics}`, `${x.jev_tp}/${x.jev_tn}/${x.jev_fp}/${x.jev_fn}`, `${x.live_agree}/${x.live_topics}`, `${x.live_tp}/${x.live_tn}/${x.live_fp}/${x.live_fn}`, `${x.jev_live_same}/${x.live_topics}`])));
  md.push('\n### DTDD specific topics by target tag ids\n');
  md.push(table(['target ids', 'topics', 'crowd yes', 'Jev agree', 'Jev fp/fn', 'live agree', 'live fp/fn'], Object.entries(R.dtdd.specific_by_target).map(([k, x]) => [k, x.topics, x.crowd_yes, `${x.jev_agree}/${x.topics}`, `${x.jev_fp}/${x.jev_fn}`, `${x.live_agree}/${x.live_topics}`, `${x.live_fp}/${x.live_fn}`])));
  md.push('\n### DTDD coarse group fallback (topics with no specific mapping), by kind\n');
  md.push(table(['kind', 'topics', 'crowd yes', 'Jev agree', 'Jev fp/fn', 'live agree', 'live fp/fn'], Object.entries(R.dtdd.coarse_group_fallback_by_kind).map(([k, x]) => [k, x.topics, x.crowd_yes, `${x.jev_agree}/${x.topics}`, `${x.jev_fp}/${x.jev_fn}`, `${x.live_agree}/${x.live_topics}`, `${x.live_fp}/${x.live_fn}`])));
  md.push('\n### codex-rules items (model-written; NOT in the human score)\n');
  const C = R.codex_rules_items;
  md.push(table(['marker', 'items', 'Jev any tag in item group', 'live any label in item group', 'Jev rule question fired'], Object.entries(C.by_marker).map(([m, x]) => [m, x.items, x.jev_group, x.live_group, x.jev_rule_question])));
  md.push('');
}
md.push('## Reliability ranking (held-out, >= 3 fires at 0.7)\n');
const rk = (list) => table(['question', 'group', 'HO fires', 'HO prec', 'HO Wilson lo-hi', 'HO base', 'HO lift', 'HO recall', 'HO AUC', 'dev fires', 'dev prec', 'dev lift', 'dev recall', 'dev AUC'], list.map(({ held_out: h, dev: d }) => [h.question, h.group, h.fires, pct(h.precision_proxy), `${f(h.wilson.lo)}-${f(h.wilson.hi)}`, pct(h.base_rate), h.lift, pct(h.recall), h.auc, d?.fires, pct(d?.precision_proxy), d?.lift, pct(d?.recall), d?.auc]));
md.push('### Most reliable 8\n'); md.push(rk(most)); md.push('\n### Least reliable 8\n'); md.push(rk(least)); md.push('');
fs.writeFileSync(path.join(HERE, 'scorecard.md'), md.join('\n') + '\n');

// ---- console ----------------------------------------------------------------------------------------------
for (const [n, R] of [['HELD-OUT', held], ['DEV', dev]]) {
  const J = R.groups.jev.pooled.ALL; const Lv = R.groups.live.pooled?.ALL;
  console.log(`${n}: Jev recall ${J.recall} (${J.answered}/${J.items}) sf ${J.recall_should_flag}, prec ${J.precision_proxy}; live recall ${Lv?.recall} (${Lv?.answered}/${Lv?.items}) sf ${Lv?.recall_should_flag}, prec ${Lv?.precision_proxy}; DTDD specific Jev ${R.dtdd.specific_by_kind.ALL.jev_agree}/${R.dtdd.specific_by_kind.ALL.topics}, live ${R.dtdd.specific_by_kind.ALL.live_agree}/${R.dtdd.specific_by_kind.ALL.live_topics}`);
}
console.log('reconstruction mismatches', Object.fromEntries(Object.entries(coverage).map(([s, c]) => [s, c.act_tag_reconstruction_mismatches])));
console.log('most', most.map((x) => `${x.held_out.question} ${x.held_out.precision_proxy}(${x.held_out.fires})`).join(', '));
console.log('least', least.map((x) => `${x.held_out.question} ${x.held_out.precision_proxy}(${x.held_out.fires})`).join(', '));
