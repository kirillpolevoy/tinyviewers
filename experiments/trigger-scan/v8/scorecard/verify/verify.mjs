// Independent re-computation of the held-out group scorecard (does NOT import score.mjs).
// Offline: reads refs/*.key.json, v8/out/*.tags.r1.json, v8/out/*.jev.r1.json, v8/baseline/out/*.built.json.
// Writes only v8/scorecard/verify/verify.json (+ prints tables).
import fs from 'fs';
import path from 'path';
import * as T3 from '../../../taxonomy-v3.js';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../..');
const FILMS = ['tangled', 'coco', 'how-to-train-your-dragon'];
const GROUPS = ['creatures_figures', 'objects_hazards', 'peril', 'violence', 'death', 'separation', 'injury', 'captivity', 'eerie', 'hostility', 'distress', 'animals', 'copyable'];
const J = (p) => JSON.parse(fs.readFileSync(path.join(ROOT, p), 'utf8'));
const V3G = (id) => T3.BY_ID[id]?.group;
const ov = (a0, a1, b0, b1) => Math.min(a1, b1) - Math.max(a0, b0) > 0;
const pct = (n, d) => (d ? Math.round((100 * n) / d) + '%' : '-');

// ---------- loaders ----------
function loadKey(slug, { strictWindow = false } = {}) {
  const k = J(`refs/${slug}.key.json`);
  const human = [], codex = [];
  for (const it of k.items) {
    if (!it.mappable || !Number.isFinite(it.start_ms) || !Number.isFinite(it.end_ms)) continue;
    const cats = (it.categories || []).filter((c) => GROUPS.includes(c));
    if (!cats.length) continue;
    const w0 = strictWindow ? it.start_ms : Math.min(it.start_ms, it.gap_start_ms ?? it.start_ms);
    const w1 = strictWindow ? it.end_ms : Math.max(it.end_ms, it.gap_end_ms ?? it.end_ms);
    const rec = { id: it.id, cats, sf: it.should_flag === true, w0, w1, same: it.same_moment_as || [] };
    if (it.source === 'codex-rules' || it.human_written === false) codex.push(rec); else human.push(rec);
  }
  return { human, codex };
}

// mapping: 'as_scored' = Jev tag.group; 'v3' = taxonomy group of tag.v3 when defined (both systems in one vocabulary)
function loadJev(slug, { mapping = 'as_scored', spans = 'tiled' } = {}) {
  const t = J(`v8/out/${slug}.tags.r1.json`);
  return t.scenes.map((s) => {
    const tags = s.tags.filter((g) => g.level === 'act' && !(g.film_specific && g.type === 'presence'));
    const groups = new Set();
    const ids = new Set();
    for (const g of tags) {
      let grp = g.group;
      if (mapping === 'v3' && g.v3 && V3G(g.v3)) grp = V3G(g.v3);
      if (mapping === 'danger_peril') { // both: family_in_danger counted as peril, film dangers peril
        if (g.v3 === 'family_in_danger' || g.v3 === 'caught_in_hazard') grp = 'peril';
      }
      groups.add(grp);
      ids.add(g.film_specific ? 'film:' + g.type : g.id);
    }
    const a = spans === 'lines' ? s.line_start_ms : s.start_ms;
    const b = spans === 'lines' ? s.line_end_ms : s.end_ms;
    return { id: s.id, a, b, groups, ids };
  });
}
function loadLive(slug, { mapping = 'as_scored', dropKnownFromFilm = false } = {}) {
  const t = J(`v8/baseline/out/${slug}.built.json`);
  return t.scenes.map((s) => {
    const labs = t.labels.filter((l) => l.scene_id === s.id && l.asserted && l.channel !== 'mention' && !(dropKnownFromFilm && l.confidence_kind === 'known_from_film'));
    const groups = new Set();
    const ids = new Set();
    for (const l of labs) {
      let grp = V3G(l.vocabulary_id);
      if (mapping === 'danger_peril' && l.vocabulary_id === 'family_in_danger') grp = 'peril';
      if (grp) groups.add(grp);
      ids.add(l.vocabulary_id);
    }
    return { id: s.id, a: s.start_ms, b: s.end_ms, groups, ids };
  });
}
function filmLen(slug) {
  const t = J(`v8/out/${slug}.tags.r1.json`);
  return Math.max(...t.scenes.map((s) => s.end_ms));
}

// ---------- scoring ----------
// hit rule: 'overlap' (any ms), 'mid' (scene contains window midpoint), 'half' (>=50% of window inside tagged G scenes)
function answered(item, G, scenes, rule) {
  const tg = scenes.filter((s) => s.groups.has(G));
  if (rule === 'overlap') return tg.some((s) => ov(s.a, s.b, item.w0, item.w1));
  const mid = (item.w0 + item.w1) / 2;
  if (rule === 'mid') return tg.some((s) => s.a <= mid && mid < s.b);
  // half: union coverage of the window
  const segs = tg.map((s) => [Math.max(s.a, item.w0), Math.min(s.b, item.w1)]).filter(([x, y]) => y > x).sort((p, q) => p[0] - q[0]);
  let cov = 0, cur = -Infinity;
  for (const [x, y] of segs) { const x2 = Math.max(x, cur); if (y > x2) { cov += y - x2; cur = y; } }
  return cov >= 0.5 * (item.w1 - item.w0);
}
function score(items, scenes, G, rule = 'overlap') {
  const its = items.filter((i) => i.cats.includes(G));
  const hit = its.filter((i) => answered(i, G, scenes, rule)).length;
  const sfIts = its.filter((i) => i.sf);
  const sfHit = sfIts.filter((i) => answered(i, G, scenes, rule)).length;
  const tagged = scenes.filter((s) => s.groups.has(G));
  const good = tagged.filter((s) => its.some((i) => ov(s.a, s.b, i.w0, i.w1))).length;
  const base = scenes.filter((s) => its.some((i) => ov(s.a, s.b, i.w0, i.w1))).length;
  // time-weighted precision: tagged ms inside union of G windows / tagged ms
  let tms = 0, ims = 0;
  for (const s of tagged) {
    tms += s.b - s.a;
    const segs = its.map((i) => [Math.max(s.a, i.w0), Math.min(s.b, i.w1)]).filter(([x, y]) => y > x).sort((p, q) => p[0] - q[0]);
    let cur = -Infinity; for (const [x, y] of segs) { const x2 = Math.max(x, cur); if (y > x2) { ims += y - x2; cur = y; } }
  }
  return { n: its.length, hit, sfN: sfIts.length, sfHit, tagged: tagged.length, good, all: scenes.length, base, tms, ims };
}
// circular-shift null: move the whole tag pattern by offset o (wrapping) and rescore. Keeps scene lengths & tagged share.
function shiftScenes(scenes, o, L) {
  const out = [];
  for (const s of scenes) {
    let a = s.a + o, b = s.b + o;
    if (a >= L) { a -= L; b -= L; }
    if (b <= L) out.push({ ...s, a, b });
    else { out.push({ ...s, a, b: L }); out.push({ ...s, a: 0, b: b - L }); }
  }
  return out;
}
function nullScore(itemsByFilm, scenesByFilm, G, K = 400) {
  if (G === 'ALL') { let h = 0, n = 0, g = 0, t = 0; for (const X of GROUPS) { const r = nullScore(itemsByFilm, scenesByFilm, X, K); h += r._hit; n += r._n; g += r._good; t += r._tagged; } return { recall: h / n, prec: g / t, _hit: h, _n: n, _good: g, _tagged: t }; }
  let hit = 0, n = 0, good = 0, tagged = 0;
  for (const slug of Object.keys(itemsByFilm)) {
    const L = filmLen(slug);
    for (let k = 0; k < K; k++) {
      const o = ((k + 0.5) / K) * L;
      const r = score(itemsByFilm[slug], shiftScenes(scenesByFilm[slug], o, L), G);
      hit += r.hit / K; n += r.n / K; good += r.good / K; tagged += r.tagged / K;
    }
  }
  return { recall: n ? hit / n : null, prec: tagged ? good / tagged : null, _hit: hit, _n: n, _good: good, _tagged: tagged };
}
function add(a, b) { const o = { ...a }; for (const k of Object.keys(b)) o[k] = (o[k] || 0) + b[k]; return o; }
function pooled(itemsByFilm, scenesByFilm, G, rule) {
  let acc = {};
  for (const slug of Object.keys(itemsByFilm)) acc = add(acc, score(itemsByFilm[slug], scenesByFilm[slug], G, rule));
  return acc;
}

// ---------- dedup clusters (same_moment_as) ----------
function dedupe(items) {
  const byId = Object.fromEntries(items.map((i) => [i.id, i]));
  const par = Object.fromEntries(items.map((i) => [i.id, i.id]));
  const f = (x) => (par[x] === x ? x : (par[x] = f(par[x])));
  for (const i of items) for (const j of i.same) if (byId[j]) par[f(i.id)] = f(j);
  const cl = {};
  for (const i of items) (cl[f(i.id)] ||= []).push(i);
  return Object.values(cl);
}
function clusterRecall(items, scenes, G) {
  const cls = dedupe(items).filter((c) => c.some((i) => i.cats.includes(G)));
  const hit = cls.filter((c) => c.filter((i) => i.cats.includes(G)).some((i) => answered(i, G, scenes, 'overlap'))).length;
  return { n: cls.length, hit };
}

// ---------- run ----------
const variants = {
  as_scored: { jev: { mapping: 'as_scored' }, live: { mapping: 'as_scored' }, key: {} },
  v3_mapping: { jev: { mapping: 'v3' }, live: { mapping: 'as_scored' }, key: {} },
  danger_as_peril_both: { jev: { mapping: 'danger_peril' }, live: { mapping: 'danger_peril' }, key: {} },
  strict_window: { jev: { mapping: 'as_scored' }, live: { mapping: 'as_scored' }, key: { strictWindow: true } },
  jev_line_spans: { jev: { mapping: 'as_scored', spans: 'lines' }, live: { mapping: 'as_scored' }, key: {} },
  live_no_known_from_film: { jev: { mapping: 'as_scored' }, live: { mapping: 'as_scored', dropKnownFromFilm: true }, key: {} },
};
const out = { method: {}, variants: {}, per_film: {}, footprint: {}, dedup: {}, null: {}, questions: {}, codex: {}, coverage: {} };
const load = (v) => {
  const I = {}, Jv = {}, Lv = {}, C = {};
  for (const f of FILMS) { const k = loadKey(f, v.key); I[f] = k.human; C[f] = k.codex; Jv[f] = loadJev(f, v.jev); Lv[f] = loadLive(f, v.live); }
  return { I, Jv, Lv, C };
};
for (const [name, v] of Object.entries(variants)) {
  const { I, Jv, Lv } = load(v);
  const rows = {};
  let J0 = {}, L0 = {};
  for (const G of GROUPS) {
    for (const rule of ['overlap', 'mid', 'half']) {
      const j = pooled(I, Jv, G, rule), l = pooled(I, Lv, G, rule);
      rows[G] ||= {};
      rows[G][rule] = { j, l };
      if (rule === 'overlap') { J0 = add(J0, j); L0 = add(L0, l); }
      else { rows.ALL ||= {}; }
    }
  }
  rows.ALL = { overlap: { j: J0, l: L0 } };
  for (const rule of ['mid', 'half']) { let a = {}, b = {}; for (const G of GROUPS) { a = add(a, rows[G][rule].j); b = add(b, rows[G][rule].l); } rows.ALL[rule] = { j: a, l: b }; }
  out.variants[name] = rows;
}
// base data for further checks
const base = load(variants.as_scored);
const v3d = load(variants.v3_mapping);
for (const f of FILMS) {
  const L = filmLen(f);
  const cov = (sc) => sc.reduce((s, x) => s + (x.b - x.a), 0);
  out.coverage[f] = {
    film_min: +(L / 60000).toFixed(1), jev_scenes: base.Jv[f].length, jev_min_per_scene: +(cov(base.Jv[f]) / base.Jv[f].length / 60000).toFixed(2),
    live_scenes: base.Lv[f].length, live_min_per_scene: +(cov(base.Lv[f]) / base.Lv[f].length / 60000).toFixed(2), live_share: pct(cov(base.Lv[f]), L),
    human_items: base.I[f].length, item_group_pairs: base.I[f].reduce((s, i) => s + i.cats.length, 0), mean_window_s: +(base.I[f].reduce((s, i) => s + (i.w1 - i.w0), 0) / base.I[f].length / 1000).toFixed(1),
  };
  let J0 = {}, L0 = {};
  for (const G of GROUPS) { J0 = add(J0, score(base.I[f], base.Jv[f], G)); L0 = add(L0, score(base.I[f], base.Lv[f], G)); }
  out.per_film[f] = { items: J0.n, jev_recall: pct(J0.hit, J0.n), live_recall: pct(L0.hit, L0.n), jev_prec: pct(J0.good, J0.tagged), live_prec: pct(L0.good, L0.tagged) };
}
// circular-shift null (as_scored and v3 mapping)
for (const [nm, d] of [['as_scored', base], ['v3_mapping', v3d]]) {
  out.null[nm] = {};
  for (const G of [...GROUPS, 'ALL']) out.null[nm][G] = { jev: nullScore(d.I, d.Jv, G), live: nullScore(d.I, d.Lv, G) };
}
// live-footprint decomposition: items whose window overlaps ANY live scene (i.e. live could have labelled them)
{
  const inFp = {}, outFp = {};
  for (const f of FILMS) {
    inFp[f] = base.I[f].filter((i) => base.Lv[f].some((s) => ov(s.a, s.b, i.w0, i.w1)));
    outFp[f] = base.I[f].filter((i) => !base.Lv[f].some((s) => ov(s.a, s.b, i.w0, i.w1)));
  }
  for (const [nm, I] of [['inside_live_footprint', inFp], ['outside_live_footprint', outFp]]) {
    out.footprint[nm] = {};
    let J0 = {}, L0 = {};
    for (const G of GROUPS) {
      const j = pooled(I, base.Jv, G), l = pooled(I, base.Lv, G);
      out.footprint[nm][G] = { n: j.n, jev: pct(j.hit, j.n), live: pct(l.hit, l.n) };
      J0 = add(J0, j); L0 = add(L0, l);
    }
    out.footprint[nm].ALL = { n: J0.n, jev: pct(J0.hit, J0.n), live: pct(L0.hit, L0.n), jev_sf: pct(J0.sfHit, J0.sfN), live_sf: pct(L0.sfHit, L0.sfN) };
  }
}
// dedup
{
  let a = { n: 0, hj: 0, hl: 0 };
  for (const G of GROUPS) {
    let n = 0, hj = 0, hl = 0;
    for (const f of FILMS) { const j = clusterRecall(base.I[f], base.Jv[f], G), l = clusterRecall(base.I[f], base.Lv[f], G); n += j.n; hj += j.hit; hl += l.hit; }
    out.dedup[G] = { clusters: n, jev: pct(hj, n), live: pct(hl, n) };
    a.n += n; a.hj += hj; a.hl += hl;
  }
  out.dedup.ALL = { clusters: a.n, jev: pct(a.hj, a.n), live: pct(a.hl, a.n) };
}
// codex-rules items (model-written), group recall
{
  let J0 = {}, L0 = {};
  for (const G of GROUPS) { J0 = add(J0, pooled(base.C, base.Jv, G)); L0 = add(L0, pooled(base.C, base.Lv, G)); }
  out.codex = { items: FILMS.reduce((s, f) => s + base.C[f].length, 0), pairs: J0.n, jev: pct(J0.hit, J0.n), live: pct(L0.hit, L0.n) };
}
// per-question (act-level tag ids; film-specific pooled by template type)
{
  const qs = {};
  for (const f of FILMS) {
    const tg = J(`v8/out/${f}.tags.r1.json`);
    for (const s of tg.scenes) { const seen = new Set(); for (const g of s.tags) if (g.level === 'act' && !(g.film_specific && g.type === 'presence')) {
      const q = g.film_specific ? 'film:' + g.type : g.id;
      if (seen.has(q)) { const its = base.I[f].filter((i) => i.cats.includes(g.group) && ov(s.start_ms, s.end_ms, i.w0, i.w1)); for (const i of its) qs[q].caught.add(f + ':' + i.id); continue; } // one fire per scene per template
      seen.add(q);
      (qs[q] ||= { group: g.group, fires: 0, good: 0, caught: new Set() });
      const its = base.I[f].filter((i) => i.cats.includes(g.group) && ov(s.start_ms, s.end_ms, i.w0, i.w1));
      qs[q].fires++; if (its.length) qs[q].good++;
      for (const i of its) qs[q].caught.add(f + ':' + i.id);
    } }
  }
  const nG = {}; for (const G of GROUPS) nG[G] = FILMS.reduce((s, f) => s + base.I[f].filter((i) => i.cats.includes(G)).length, 0);
  for (const [q, r] of Object.entries(qs)) out.questions[q] = { group: r.group, fires: r.fires, prec: pct(r.good, r.fires), caught: `${r.caught.size}/${nG[r.group] ?? '?'}` };
}
// AUC for selected questions from raw jev probabilities (scene = jev tiled scene; positive = overlaps an item in the question's group)
{
  const pick = { screams: ['e', 'distress'], afraid_for_safety: ['e', 'distress'], startled: ['e', 'eerie'], child_frightened: ['e', 'distress'], crying: ['e', 'distress'], battle: ['e', 'violence'], monster_creature: ['p', 'creatures_figures'], child_in_danger: ['e', 'peril'], creature_threat: ['e', 'peril'], weapon_used: ['e', 'violence'], witch_sorcerer: ['p', 'creatures_figures'], ghost_spirit: ['p', 'creatures_figures'] };
  out.auc = {};
  for (const [q, [kind, G]] of Object.entries(pick)) {
    const pos = [], neg = [];
    for (const f of FILMS) {
      const jv = J(`v8/out/${f}.jev.r1.json`), tg = J(`v8/out/${f}.tags.r1.json`);
      const span = Object.fromEntries(tg.scenes.map((s) => [s.id, s]));
      for (const s of jv.scenes) {
        const a = s.answers; if (!a) continue;
        const p = kind === 'e' ? a.e?.[q] : Math.max(a.pl?.[q] ?? 0, a.ps?.[q] ?? 0);
        if (p == null) continue;
        const sp = span[s.id];
        (base.I[f].some((i) => i.cats.includes(G) && ov(sp.start_ms, sp.end_ms, i.w0, i.w1)) ? pos : neg).push(p);
      }
    }
    let w = 0; for (const x of pos) for (const y of neg) w += x > y ? 1 : x === y ? 0.5 : 0;
    out.auc[q] = { group: G, pos: pos.length, neg: neg.length, auc: +(w / (pos.length * neg.length)).toFixed(3) };
  }
}
fs.writeFileSync(path.join(ROOT, 'v8/scorecard/verify/verify.json'), JSON.stringify(out, (k, v) => (v instanceof Set ? [...v] : v), 1));

// ---------- print ----------
const line = (G, r) => `${G.padEnd(18)} n=${String(r.j.n).padStart(3)}  Jev R ${pct(r.j.hit, r.j.n).padStart(4)} sf ${pct(r.j.sfHit, r.j.sfN).padStart(4)} P ${pct(r.j.good, r.j.tagged).padStart(4)} (${r.j.good}/${r.j.tagged}) base ${pct(r.j.base, r.j.all).padStart(4)} tP ${pct(r.j.ims, r.j.tms).padStart(4)} | live R ${pct(r.l.hit, r.l.n).padStart(4)} sf ${pct(r.l.sfHit, r.l.sfN).padStart(4)} P ${pct(r.l.good, r.l.tagged).padStart(4)} (${r.l.good}/${r.l.tagged}) base ${pct(r.l.base, r.l.all).padStart(4)} tP ${pct(r.l.ims, r.l.tms).padStart(4)}`;
for (const [name, rows] of Object.entries(out.variants)) {
  console.log(`\n=== ${name} (overlap rule) ===`);
  for (const G of [...GROUPS, 'ALL']) console.log(line(G, rows[G].overlap));
  if (name === 'as_scored' || name === 'v3_mapping') for (const rule of ['mid', 'half']) {
    console.log(`--- ${name} rule=${rule} ---`);
    for (const G of [...GROUPS, 'ALL']) { const r = rows[G][rule]; console.log(`${G.padEnd(18)} Jev R ${pct(r.j.hit, r.j.n).padStart(4)}  live R ${pct(r.l.hit, r.l.n).padStart(4)}`); }
  }
}
console.log('\ncoverage', out.coverage);
console.log('per_film', out.per_film);
console.log('\nnull (circular shift) as_scored / v3_mapping: recall & prec expected by chance');
for (const G of GROUPS) { const a = out.null.as_scored[G], b = out.null.v3_mapping[G]; const f = (x) => (x == null ? '-' : Math.round(100 * x) + '%'); console.log(`${G.padEnd(18)} Jev R0 ${f(a.jev.recall)} P0 ${f(a.jev.prec)} | live R0 ${f(a.live.recall)} P0 ${f(a.live.prec)} || v3map Jev R0 ${f(b.jev.recall)} P0 ${f(b.jev.prec)}`); }
console.log('\nchance-corrected (as_scored): R, R0 (circular-shift), kappa=(R-R0)/(1-R0); P, P0, P/P0; film share tagged');
{
  const d = base; const Ls = Object.fromEntries(FILMS.map((f) => [f, filmLen(f)]));
  const share = (sc, G) => { let t = 0, L = 0; for (const f of FILMS) { L += Ls[f]; for (const s of sc[f]) if (s.groups.has(G)) t += s.b - s.a; } return t / L; };
  out.chance = {};
  for (const G of [...GROUPS, 'ALL']) {
    const r = out.variants.as_scored[G].overlap, nj = out.null.as_scored[G].jev, nl = out.null.as_scored[G].live;
    const Rj = r.j.hit / r.j.n, Rl = r.l.hit / r.l.n, Pj = r.j.tagged ? r.j.good / r.j.tagged : null, Pl = r.l.tagged ? r.l.good / r.l.tagged : null;
    const k = (R, R0) => (R0 < 1 ? (R - R0) / (1 - R0) : null);
    const f2 = (x) => (x == null || !Number.isFinite(x) ? '-' : x.toFixed(2));
    const row = { jev: { R: Rj, R0: nj.recall, kappa: k(Rj, nj.recall), P: Pj, P0: nj.prec, Plift: Pj != null && nj.prec ? Pj / nj.prec : null, share: G === 'ALL' ? null : share(d.Jv, G) },
                  live: { R: Rl, R0: nl.recall, kappa: k(Rl, nl.recall), P: Pl, P0: nl.prec, Plift: Pl != null && nl.prec ? Pl / nl.prec : null, share: G === 'ALL' ? null : share(d.Lv, G) } };
    out.chance[G] = row;
    const q = (o) => `R ${f2(o.R)} R0 ${f2(o.R0)} k ${f2(o.kappa)} | P ${f2(o.P)} P0 ${f2(o.P0)} x${f2(o.Plift)} | share ${f2(o.share)}`;
    console.log(`${G.padEnd(18)} JEV ${q(row.jev)}  ||  LIVE ${q(row.live)}`);
  }
  fs.writeFileSync(path.join(ROOT, 'v8/scorecard/verify/verify.json'), JSON.stringify(out, (k, v) => (v instanceof Set ? [...v] : v), 1));
}
for (const G of ['peril','death','separation','violence','captivity','eerie','hostility','ALL']) { const r = out.variants.v3_mapping[G].overlap, n = out.null.v3_mapping[G].jev; const R = r.j.hit / r.j.n; console.log(`v3map ${G.padEnd(12)} Jev R ${R.toFixed(2)} R0 ${n.recall.toFixed(2)} k ${((R - n.recall) / (1 - n.recall)).toFixed(2)} P ${(r.j.good / r.j.tagged).toFixed(2)} P0 ${n.prec.toFixed(2)} x${(r.j.good / r.j.tagged / n.prec).toFixed(2)}`); }
console.log('\nfootprint', JSON.stringify(out.footprint, null, 0));
console.log('\ndedup', out.dedup);
console.log('\ncodex', out.codex);
console.log('\nquestions', Object.entries(out.questions).sort((a, b) => b[1].fires - a[1].fires).map(([q, r]) => `${q}(${r.group}) ${r.fires}f ${r.prec} caught ${r.caught}`).join('\n'));
console.log('\nauc', out.auc);
