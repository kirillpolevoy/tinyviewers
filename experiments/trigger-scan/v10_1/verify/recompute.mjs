#!/usr/bin/env node
// VERIFIER (round 7, recompute). Independent re-implementation of the headline numbers: no import of refscore.js,
// parent-checks.js, headtohead.mjs, tierA.mjs or who-flags.mjs. No model calls, no network, no writes outside
// verify/out/. Reads: refs/<slug>.key.json, v10.1 tags (out101 / round7/gd-out), live built (v10/round6/live),
// prereg-tierA-gating.json. Writes verify/out/recompute.json.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const V101 = path.resolve(here, '..');
const TS = path.resolve(V101, '..');
const rj = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const outFor = (slug) => (slug === 'good-dinosaur' ? (process.env.VERIFY_GD_DIR ? path.resolve(process.env.VERIFY_GD_DIR) : path.join(V101, 'round7', 'gd-out')) : path.join(V101, 'out101'));
const LIVE = path.join(TS, 'v10', 'round6', 'live');
const pre = rj(path.join(TS, 'v10', 'prereg-tierA-gating.json'));
const TIER_A = new Set(pre.tierA_jev_concepts); const SON = new Set(pre.sonnet_concepts);
const r3 = (x) => Math.round(x * 1000) / 1000;

// ---- interval math (own) ----
function merge(sp) {
  const s = sp.filter(([a, b]) => Number.isFinite(a) && Number.isFinite(b) && b >= a).map((x) => [...x]).sort((x, y) => x[0] - y[0]);
  const o = [];
  for (const [a, b] of s) { if (o.length && a <= o[o.length - 1][1]) o[o.length - 1][1] = Math.max(o[o.length - 1][1], b); else o.push([a, b]); }
  return o;
}
const len = (u) => u.reduce((t, [a, b]) => t + b - a, 0);
function overlap(u1, u2) { let t = 0, i = 0, j = 0; while (i < u1.length && j < u2.length) { const a = Math.max(u1[i][0], u2[j][0]); const b = Math.min(u1[i][1], u2[j][1]); if (b > a) t += b - a; if (u1[i][1] < u2[j][1]) i++; else j++; } return t; }
const frac = (s, e, u) => (e <= s ? (u.some(([a, b]) => s >= a && s <= b) ? 1 : 0) : overlap([[s, e]], u) / (e - s));

const mapped = (i) => i.mappable && Number.isFinite(i.start_ms) && Number.isFinite(i.end_ms);
const gapped = (i) => (Number.isFinite(i.gap_start_ms) && Number.isFinite(i.gap_end_ms) ? { ...i, start_ms: Math.min(i.start_ms, i.gap_start_ms), end_ms: Math.max(i.end_ms, i.gap_end_ms) } : i);

function score(items, skip, window) {
  const its = items.filter(mapped).map((i) => (window === 'gap' ? gapped(i) : i));
  const U = merge(skip);
  const pos = its.filter((i) => i.should_flag === true);
  const found = pos.filter((i) => frac(i.start_ms, i.end_ms, U) >= 0.5);
  const refU = merge(pos.map((i) => [i.start_ms, i.end_ms]));
  const tagOnly = its.filter((i) => i.should_flag === 'tag_only');
  return {
    found: found.length, of: pos.length, skip_min: r3(len(U) / 60000), prec: len(U) ? r3(overlap(U, refU) / len(U)) : null,
    tag_only_skipped: tagOnly.filter((i) => frac(i.start_ms, i.end_ms, U) >= 0.5).length, tag_only_n: tagOnly.length,
    wordless: { n: its.filter((i) => i.should_flag === true && i.wordless).length, covered: window === 'strict' ? its.filter((i) => i.should_flag === true && i.wordless && frac(i.start_ms, i.end_ms, U) >= 0.8).length : null },
    missed: pos.filter((i) => frac(i.start_ms, i.end_ms, U) < 0.5).map((i) => i.id),
  };
}

// jitter: same seeded LCG and draw order as the round-7 method (documented in refscore.js), own code
function jitter(items, skipA, skipB, runs = 300, maxMs = 30000, seed = 12345) {
  let x = seed; const rnd = () => { x = (x * 1103515245 + 12345) % 2147483648; return x / 2147483648; };
  const UA = merge(skipA); const UB = merge(skipB);
  const quick = (its, U) => { const pos = its.filter((i) => mapped(i) && i.should_flag === true); const f = pos.filter((i) => frac(i.start_ms, i.end_ms, U) >= 0.5).length; const ref = merge(pos.map((i) => [i.start_ms, i.end_ms])); return { f, p: len(U) ? r3(overlap(U, ref) / len(U)) : 0 }; };
  let rg = 0, rl = 0, pg = 0, pl = 0;
  for (let n = 0; n < runs; n++) {
    const its = items.map((i) => { if (!mapped(i)) return i; const s = i.start_ms + (rnd() * 2 - 1) * maxMs; const e = i.end_ms + (rnd() * 2 - 1) * maxMs; return { ...i, start_ms: s, end_ms: Math.max(s, e) }; });
    const a = quick(its, UA); const b = quick(its, UB);
    if (a.f > b.f) rg++; if (a.f < b.f) rl++;
    const d = a.p - b.p; if (d > 0) pg++; if (d < 0) pl++;
  }
  return { recall_a_gt_b: r3(rg / runs), recall_a_lt_b: r3(rl / runs), prec_a_gt_b: r3(pg / runs), prec_a_lt_b: r3(pl / runs) };
}

function verdict(aS, aG, bS, bG, j) {
  const ca = Math.min(aS.found, aG.found), cb = Math.min(bS.found, bG.found);
  const rec = ca > cb && j.recall_a_gt_b >= 0.95 ? 'v10.1' : cb > ca && j.recall_a_lt_b >= 0.95 ? 'live' : 'tie';
  const prec = aS.prec > bS.prec && aG.prec > bG.prec && j.prec_a_gt_b >= 0.95 ? 'v10.1' : aS.prec < bS.prec && aG.prec < bG.prec && j.prec_a_lt_b >= 0.95 ? 'live' : 'tie';
  return { cons_recall: `${ca} vs ${cb} of ${aS.of}`, recall: rec, prec, ca, cb };
}

// ---- tier-A gating, own implementation from the prereg file ----
// rulesBack: sensitivity for the ship recommendation's step 3 (tier-B rule concepts threatens_harm, plots_harm,
// child_frightened and film 'threatens' items allowed to flag again). Not pre-registered; dev+held-out, reported as such.
const RULE_BACK = new Set(['threatens_harm', 'plots_harm', 'child_frightened', 'film:threatens']);
function gate(tags, { strictSonnetList, rulesBack = false }) {
  const fi = tags.film_items ?? [];
  const concept = (r) => { const it = fi.find((x) => x.id === r.id); return it ? `film:${it.type}` : r.id; };
  const ok = (r) => (r.by === 'sonnet' ? (!strictSonnetList || SON.has(r.id)) : r.by === 'jev' && (TIER_A.has(concept(r)) || (rulesBack && RULE_BACK.has(concept(r)))));
  return tags.scenes.map((s) => {
    if (!s.flagged) return s;
    const kept = s.flag_reasons.filter(ok);
    return kept.length ? { ...s, flag_reasons: kept } : { ...s, flagged: false, flag_reasons: [], skip: null };
  });
}

const liveOf = (slug) => rj(path.join(LIVE, `${slug}.built.json`)).scenes.map((s) => [s.start_ms, s.end_ms]);
const spansOf = (scenes) => scenes.filter((s) => s.flagged).flatMap((s) => (s.skip?.spans ?? []).map((x) => [x.start_ms, x.end_ms]));

function rules(fullKey, slug, skip, live) {
  const items = fullKey.items.filter((i) => i.source === 'codex-rules' && mapped(i));
  const U = merge(skip), L = merge(live);
  const r = (m) => { const p = items.filter((i) => i.marker === m); return { n: p.length, v: p.filter((i) => frac(i.start_ms, i.end_ms, U) >= 0.5).length, live: p.filter((i) => frac(i.start_ms, i.end_ms, L) >= 0.5).length }; };
  return { villain: r('villain_threat'), child: r('child_terrified') };
}

function whoFlags(slug, scenes, items) {
  const pos = items.filter((i) => mapped(i));
  const rows = scenes.filter((s) => s.flagged).map((s) => {
    const U = merge((s.skip?.spans ?? []).map((x) => [x.start_ms, x.end_ms]));
    const hit = pos.some((i) => i.should_flag === true && frac(i.start_ms, i.end_ms, U) >= 0.5);
    const by = s.flag_reasons.every((r) => r.by === 'jev') ? 'jev' : s.flag_reasons.every((r) => r.by === 'sonnet') ? 'sonnet' : 'both';
    return { slug, id: s.id, hit, by, nj: s.flag_reasons.filter((r) => r.by === 'jev').length, n: s.flag_reasons.length };
  });
  return rows;
}

const FILMS = ['frozen', 'zootopia', 'good-dinosaur'];
const data = {};
for (const slug of FILMS) {
  const fullKey = rj(path.join(TS, 'refs', `${slug}.key.json`));
  const items = fullKey.items.filter((i) => i.source !== 'codex-rules');
  const tags = rj(path.join(outFor(slug), `${slug}.tags.r1.json`));
  data[slug] = { fullKey, items, variants: { asrun: tags.scenes, gated: gate(tags, { strictSonnetList: false }), gated_strict_prereg_list: gate(tags, { strictSonnetList: true }), gated_rules_back: gate(tags, { strictSonnetList: false, rulesBack: true }) }, live: liveOf(slug) };
}

function evalSet(films, variant) {
  const perFilm = {}; const pItems = []; const pA = []; const pB = []; const who = [];
  films.forEach((slug, k) => {
    const d = data[slug]; const sc = d.variants[variant]; const A = spansOf(sc); const B = d.live;
    const aS = score(d.items, A, 'strict'), aG = score(d.items, A, 'gap'), bS = score(d.items, B, 'strict'), bG = score(d.items, B, 'gap');
    const j = jitter(d.items, A, B);
    perFilm[slug] = { flagged: sc.filter((s) => s.flagged).length, v: { strict: aS, gap: aG }, live: { strict: bS, gap: bG }, jitter: j, verdict: verdict(aS, aG, bS, bG, j), rules: rules(d.fullKey, slug, A, B) };
    const off = k * 1e8;
    for (const it of d.items) { const o = { ...it, id: `${slug}:${it.id}` }; for (const f of ['start_ms', 'end_ms', 'gap_start_ms', 'gap_end_ms']) if (Number.isFinite(it[f])) o[f] = it[f] + off; pItems.push(o); }
    pA.push(...A.map(([a, b]) => [a + off, b + off])); pB.push(...B.map(([a, b]) => [a + off, b + off]));
    who.push(...whoFlags(slug, sc, d.items));
  });
  const aS = score(pItems, pA, 'strict'), aG = score(pItems, pA, 'gap'), bS = score(pItems, pB, 'strict'), bG = score(pItems, pB, 'gap');
  const j = jitter(pItems, pA, pB);
  const v = verdict(aS, aG, bS, bG, j);
  const sumR = (k, s) => films.reduce((a, f) => a + perFilm[f].rules[k][s], 0);
  const w = (b) => { const x = who.filter((r) => r.by === b); return `${x.filter((r) => r.hit).length}/${x.length}`; };
  const nr = who.reduce((a, r) => a + r.n, 0), nj = who.reduce((a, r) => a + r.nj, 0);
  const pooled = {
    recall: v.cons_recall, recall_verdict: v.recall, prec: `${aS.prec}/${aG.prec} vs ${bS.prec}/${bG.prec}`, prec_verdict: v.prec, jitter: j,
    skip: `${aS.skip_min} vs ${bS.skip_min} (x${r3(aS.skip_min / bS.skip_min)})`, skip_pass: aS.skip_min <= 1.15 * bS.skip_min,
    wordless: `${aS.wordless.covered}/${aS.wordless.n} vs ${bS.wordless.covered}/${bS.wordless.n}`,
    rule1_villain: `${sumR('villain', 'v')}/${sumR('villain', 'n')} vs ${sumR('villain', 'live')}`, rule2_child: `${sumR('child', 'v')}/${sumR('child', 'n')} vs ${sumR('child', 'live')}`,
    rule3_tag_only_skipped: `${aS.tag_only_skipped}/${aS.tag_only_n} vs ${bS.tag_only_skipped}/${bS.tag_only_n}`,
    jev_share: `${nj}/${nr} = ${r3(nj / nr)}`, jev_only_right: w('jev'), sonnet_only_right: w('sonnet'), both_right: w('both'), flagged: who.length,
  };
  return { films, variant, pooled, perFilm };
}

const out = { generated_at: new Date().toISOString(), results: [] };
for (const films of [['frozen', 'zootopia'], FILMS]) for (const v of ['asrun', 'gated', 'gated_strict_prereg_list', 'gated_rules_back']) out.results.push(evalSet(films, v));
fs.mkdirSync(path.join(here, 'out'), { recursive: true });
fs.writeFileSync(path.join(here, 'out', process.env.VERIFY_GD_DIR ? 'recompute-gd-v10.json' : 'recompute.json'), JSON.stringify(out, null, 2));
for (const r of out.results) {
  console.log(`\n== ${r.films.join('+')} ${r.variant}`);
  console.log(' pooled', JSON.stringify(r.pooled));
  for (const [s, f] of Object.entries(r.perFilm)) console.log(`  ${s}: flagged ${f.flagged}; recall ${f.verdict.cons_recall} (${f.verdict.recall}); prec ${f.v.strict.prec}/${f.v.gap.prec} vs ${f.live.strict.prec}/${f.live.gap.prec} (${f.verdict.prec}; lt ${f.jitter.prec_a_lt_b} gt ${f.jitter.prec_a_gt_b}; rec gt ${f.jitter.recall_a_gt_b}); skip ${f.v.strict.skip_min} vs ${f.live.strict.skip_min}; wordless ${f.v.strict.wordless.covered}/${f.v.strict.wordless.n} vs ${f.live.strict.wordless.covered}; rules ${JSON.stringify(f.rules)}; tag_only ${f.v.strict.tag_only_skipped}/${f.v.strict.tag_only_n} vs ${f.live.strict.tag_only_skipped}`);
}
