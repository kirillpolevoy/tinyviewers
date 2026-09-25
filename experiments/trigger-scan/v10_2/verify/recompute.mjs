#!/usr/bin/env node
// VERIFIER (round 8, recompute). Independent re-implementation of the round-8 headline numbers for v10.2 (as run,
// out102/<slug>.tags.r1.json) and live (round8/live/<slug>.built.json) on incredibles, big-hero-6, brave, per film and
// pooled. No import of refscore.js, parent-checks.js, headtohead.mjs, bar.mjs, who-flags.mjs or diag-ungated.mjs.
// Only fill.js wordlessScenes is imported (the wordless-scene REGIONS, a definition, not a score).
// No model calls, no network, writes only verify/out/recompute.json.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSrt } from '../../srt.js';
import { wordlessScenes } from '../fill.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const V = path.resolve(here, '..');
const TS = path.resolve(V, '..');
const rj = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const r3 = (x) => Math.round(x * 1000) / 1000;
const FILMS = ['incredibles', 'big-hero-6', 'brave'];
const POLICY = rj(path.join(V, 'policy.json'));
const pre = rj(path.join(TS, 'v10', 'prereg-tierA-gating.json'));
const TIER_A = new Set(pre.tierA_jev_concepts); const SON = new Set(pre.sonnet_concepts);
const split = rj(path.join(V, 'split.json'));
const c9 = new Map(Object.entries(split.concepts).flatMap(([c, d]) => (d.v9_ids ?? []).map((id) => [id, c])));

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
  const ok = (i) => frac(i.start_ms, i.end_ms, U) >= 0.5;
  const refU = merge(pos.map((i) => [i.start_ms, i.end_ms]));
  const tagOnly = its.filter((i) => i.should_flag === 'tag_only');
  const pol = (k) => { const p = pos.filter((i) => i.policy?.[k]); return `${p.filter(ok).length}/${p.length}`; };
  return {
    found: pos.filter(ok).length, of: pos.length, skip_min: r3(len(U) / 60000), prec: len(U) ? r3(overlap(U, refU) / len(U)) : null,
    tag_only: `${tagOnly.filter(ok).length}/${tagOnly.length}`, human_villain: pol('villain_threat'), human_child: pol('child_terrified'),
    wordless_all: window === 'strict' ? { n: pos.filter((i) => i.wordless).length, covered: pos.filter((i) => i.wordless && frac(i.start_ms, i.end_ms, U) >= 0.8).length } : null,
    missed: pos.filter((i) => !ok(i)).map((i) => i.id),
  };
}

// jitter: same seeded LCG (seed 12345), 300 runs, +-30 s on each MAPPED item's start then end, strict window, own code
function jitter(items, skipA, skipB, runs = 300, maxMs = 30000, seed = 12345) {
  let x = seed; const rnd = () => { x = (x * 1103515245 + 12345) % 2147483648; return x / 2147483648; };
  const UA = merge(skipA); const UB = merge(skipB);
  const quick = (its, U) => { const pos = its.filter((i) => mapped(i) && i.should_flag === true); const f = pos.filter((i) => frac(i.start_ms, i.end_ms, U) >= 0.5).length; const ref = merge(pos.map((i) => [i.start_ms, i.end_ms])); return { f, p: len(U) ? r3(overlap(U, ref) / len(U)) : 0 }; };
  let rg = 0, rl = 0, pg = 0, pl = 0;
  for (let n = 0; n < runs; n++) {
    const its = items.map((i) => { if (!mapped(i)) return i; const s = i.start_ms + (rnd() * 2 - 1) * maxMs; const e = i.end_ms + (rnd() * 2 - 1) * maxMs; return { ...i, start_ms: s, end_ms: Math.max(s, e) }; });
    const a = quick(its, UA); const b = quick(its, UB);
    if (a.f > b.f) rg++; if (a.f < b.f) rl++;
    const d = r3(a.p - b.p); if (d > 0) pg++; if (d < 0) pl++;
  }
  return { recall_a_gt_b: r3(rg / runs), recall_a_lt_b: r3(rl / runs), prec_a_gt_b: r3(pg / runs), prec_a_lt_b: r3(pl / runs) };
}
function verdict(aS, aG, bS, bG, j) {
  const ca = Math.min(aS.found, aG.found), cb = Math.min(bS.found, bG.found);
  const rec = ca > cb && j.recall_a_gt_b >= 0.95 ? 'v10.2' : cb > ca && j.recall_a_lt_b >= 0.95 ? 'live' : 'tie';
  const prec = aS.prec > bS.prec && aG.prec > bG.prec && j.prec_a_gt_b >= 0.95 ? 'v10.2' : aS.prec < bS.prec && aG.prec < bG.prec && j.prec_a_lt_b >= 0.95 ? 'live' : 'tie';
  return { cons_recall: `${ca} vs ${cb} of ${aS.of}`, strict_recall: `${aS.found} vs ${bS.found}`, gap_recall: `${aG.found} vs ${bG.found}`, recall: rec, prec, ca, cb };
}

// ---- gate / guard / rule-2 invariants (own concept mapping from split.json + prereg lists) ----
function conceptOf(r, items) { const it = items.find((x) => x.id === r.id); return it ? `film:${it.type}` : c9.get(r.id) ?? r.id; }
function invariants(slug, tags) {
  const items = tags.film_items ?? [];
  const cc = rj(path.join(V, 'out102', `${slug}.childcry.r1.json`)).scenes;
  const rs = rj(path.join(V, 'out102', `${slug}.resolve.r1.json`)).scenes;
  const G = POLICY.flag.resolution_guard;
  const bad = [];
  for (const s of tags.scenes) {
    for (const r of s.flag_reasons ?? []) {
      const c = conceptOf(r, items);
      const ok = r.by === 'sonnet' ? SON.has(c) : r.by === 'jev' ? TIER_A.has(c) : false;
      if (!ok) bad.push(`${s.id}:${r.id}/${r.by}->${c} flags but is not tier-A/Sonnet`);
      if (r.rule === 'rule1_question') bad.push(`${s.id}: rule1 reason present although disabled`);
      if (r.id === 'crying') { const p = cc[s.id]?.p_child; if (!(p >= 0.5)) bad.push(`${s.id}: crying flags with p_child ${p}`); }
      if (r.by === 'sonnet' && G.cancels[r.id]) { const g = rs[s.id]?.guard ?? {}; const fire = G.cancels[r.id].filter((q) => g[q] >= G.min_p); if (fire.length) bad.push(`${s.id}:${r.id} flags although guard ${fire} >= ${G.min_p}`); }
    }
    for (const r of s.gated_reasons ?? []) { const c = conceptOf(r, items); const passes = r.by === 'sonnet' ? SON.has(c) : TIER_A.has(c); if (passes) bad.push(`${s.id}:${r.id}/${r.by}->${c} gated although it passes`); }
    for (const r of s.guard_cancelled ?? []) { const g = rs[s.id]?.guard ?? {}; if (!(G.cancels[r.id] ?? []).some((q) => g[q] >= G.min_p)) bad.push(`${s.id}:${r.id} guard-cancelled without a guard answer >= min_p`); }
    if (s.flagged !== ((s.flag_reasons ?? []).length > 0)) bad.push(`${s.id}: flagged != has reasons`);
  }
  const gatedOnly = tags.scenes.filter((s) => !s.flagged && (s.gated_reasons ?? []).length).map((s) => `${s.id}:${s.gated_reasons.map((r) => `${r.id}(${conceptOf(r, items)})`).join('+')}`);
  const guardOnly = tags.scenes.filter((s) => !s.flagged && (s.guard_cancelled ?? []).length && !(s.gated_reasons ?? []).length).map((s) => s.id);
  const guardAny = tags.scenes.filter((s) => (s.guard_cancelled ?? []).length).map((s) => `${s.id}${s.flagged ? '(still flagged)' : ''}`);
  const crying = tags.scenes.filter((s) => (s.flag_reasons ?? []).some((r) => r.id === 'crying')).map((s) => `${s.id}:p_child ${cc[s.id]?.p_child}`);
  const rule1 = tags.scenes.filter((s) => (s.flag_reasons ?? []).some((r) => r.rule === 'rule1_question')).length;
  return { violations: bad, gated_only_scenes: gatedOnly, guard_only_scenes: guardOnly, guard_cancelled_in: guardAny, crying_flags: crying, rule1_reason_scenes: rule1 };
}

function whoFlags(slug, tags, items) {
  const pos = items.filter(mapped);
  return tags.scenes.filter((s) => s.flagged).map((s) => {
    const U = merge((s.skip?.spans ?? []).map((x) => [x.start_ms, x.end_ms]));
    const hit = pos.some((i) => i.should_flag === true && frac(i.start_ms, i.end_ms, U) >= 0.5);
    const by = s.flag_reasons.every((r) => r.by === 'jev') ? 'jev' : s.flag_reasons.every((r) => r.by === 'sonnet') ? 'sonnet' : 'both';
    return { slug, id: s.id, hit, by, nj: s.flag_reasons.filter((r) => r.by === 'jev').length, n: s.flag_reasons.length, cry: s.flag_reasons.some((r) => r.id === 'crying' && r.by === 'sonnet') };
  });
}

function rulesCodex(fullKey, skip, live, slug) {
  const items = fullKey.items.filter((i) => i.source === 'codex-rules' && mapped(i));
  const audits = rj(path.join(TS, 'refs', 'audits.json'));
  const auditRows = Array.isArray(fullKey.audit) ? fullKey.audit : (audits[slug] ?? []);
  const auditFalse = new Set(auditRows.filter((a) => a.rule_applies === false).map((a) => a.id));
  const clean = (i) => !i.played_for_laughs && !auditFalse.has(i.id);
  const U = merge(skip), L = merge(live);
  const r = (p) => ({ n: p.length, v: p.filter((i) => frac(i.start_ms, i.end_ms, U) >= 0.5).length, live: p.filter((i) => frac(i.start_ms, i.end_ms, L) >= 0.5).length });
  return { villain: r(items.filter((i) => i.marker === 'villain_threat')), child: r(items.filter((i) => i.marker === 'child_terrified')), clean_child: r(items.filter((i) => clean(i) && i.marker === 'child_terrified')), all: r(items), clean: r(items.filter(clean)), audit_false: [...auditFalse] };
}

function wordlessSceneScore(items, regions, skip) {
  const U = merge(skip); let n = 0, f = 0;
  for (const it of items.filter((i) => mapped(i) && i.should_flag === true)) {
    const sc = regions.find((s) => frac(it.start_ms, it.end_ms, [[s.start_ms, s.end_ms]]) >= 0.5);
    if (!sc) continue; n++; if (frac(it.start_ms, it.end_ms, U) >= 0.5) f++;
  }
  return { n, found: f };
}

function text(tags, built) {
  const fl = tags.scenes.filter((s) => s.flagged);
  const noText = fl.filter((s) => !(s.why?.text && s.why.text.trim())).map((s) => s.id);
  const placeholder = fl.filter((s) => s.why?.title === 'Flagged scene' || !s.why?.title).map((s) => s.id);
  const sources = fl.reduce((o, s) => ((o[s.why?.source ?? 'none'] = (o[s.why?.source ?? 'none'] ?? 0) + 1), o), {});
  const titleSources = fl.reduce((o, s) => ((o[s.why?.title_source ?? 'none'] = (o[s.why?.title_source ?? 'none'] ?? 0) + 1), o), {});
  const codeBuilt = fl.filter((s) => /Flagged because/.test(s.why?.text ?? '') || ['plain_reason', 'described+reason'].includes(s.why?.source) || /plain|code/.test(s.why?.title_source ?? '')).map((s) => s.id);
  return { flagged: fl.length, no_text: noText, placeholder_title: placeholder, sources, title_sources: titleSources, code_built: codeBuilt, shown_text_ids: fl.filter((s) => s.why?.text).map((s) => s.id), shown_title_ids: fl.filter((s) => s.why?.title && s.why.title !== 'Flagged scene').map((s) => s.id), live_desc: built.scenes.filter((s) => s.description && s.description.trim()).length, live_titles: built.scenes.filter((s) => s.title && s.title.trim()).length, live_scenes: built.scenes.length };
}

const perFilm = {}; const pItems = []; const pA = []; const pB = []; const pD = []; const who = [];
FILMS.forEach((slug, k) => {
  const fullKey = rj(path.join(TS, 'refs', `${slug}.key.json`));
  const items = fullKey.items.filter((i) => i.source !== 'codex-rules');
  const tags = rj(path.join(V, 'out102', `${slug}.tags.r1.json`));
  const built = rj(path.join(V, 'round8', 'live', `${slug}.built.json`));
  const seg = rj(path.join(V, 'out102', `${slug}.segments.json`));
  const cues = parseSrt(fs.readFileSync(path.join(TS, 'data', `${slug}.srt`), 'utf8'));
  const A = tags.scenes.filter((s) => s.flagged).flatMap((s) => (s.skip?.spans ?? []).map((x) => [x.start_ms, x.end_ms]));
  const B = built.scenes.map((s) => [s.start_ms, s.end_ms]);
  const gatedOnly = tags.scenes.filter((s) => !s.flagged && (s.gated_reasons ?? []).length);
  const D = [...A, ...gatedOnly.map((s) => [s.start_ms, s.end_ms])];
  const aS = score(items, A, 'strict'), aG = score(items, A, 'gap'), bS = score(items, B, 'strict'), bG = score(items, B, 'gap');
  const dS = score(items, D, 'strict'), dG = score(items, D, 'gap');
  const j = jitter(items, A, B);
  const regions = wordlessScenes(seg, cues, POLICY);
  const wf = whoFlags(slug, tags, items); who.push(...wf);
  const nr = wf.reduce((a, r) => a + r.n, 0), nj = wf.reduce((a, r) => a + r.nj, 0);
  const w = (b) => { const x = wf.filter((r) => r.by === b); return `${x.filter((r) => r.hit).length}/${x.length}`; };
  perFilm[slug] = {
    human_items: items.length, mapped: items.filter(mapped).length, should_flag_mapped: aS.of,
    scenes: { v102: tags.scenes.length, v102_flagged: wf.length, live: built.scenes.length },
    v102: { strict: aS, gap: aG }, live: { strict: bS, gap: bG }, jitter: j, verdict: verdict(aS, aG, bS, bG, j),
    skip_ratio: r3(aS.skip_min / bS.skip_min),
    wordless_peaks: `${aS.wordless_all.covered}/${aS.wordless_all.n} vs ${bS.wordless_all.covered}/${bS.wordless_all.n}`,
    wordless_scenes: { regions: regions.length, v102: wordlessSceneScore(items, regions, A), live: wordlessSceneScore(items, regions, B) },
    rules_codex: rulesCodex(fullKey, A, B, slug),
    rule3_tag_only: `${aS.tag_only} vs ${bS.tag_only}`,
    jev_share: `${nj}/${nr} = ${r3(nj / nr)}`, who: { jev_only: w('jev'), sonnet_only: w('sonnet'), both: w('both') },
    sonnet_crying_scenes: `${wf.filter((r) => r.cry && r.hit).length} hit / ${wf.filter((r) => r.cry && !r.hit).length} miss`,
    invariants: invariants(slug, tags), text: text(tags, built),
    diag_ungated: { recall: `${Math.min(dS.found, dG.found)} vs ${Math.min(bS.found, bG.found)}`, skip: `${dS.skip_min} vs ${bS.skip_min}`, prec: `${dS.prec}/${dG.prec}` },
    v102_missed_live_found: aS.missed.filter((id) => !bS.missed.includes(id)),
  };
  const off = k * 1e8;
  for (const it of items) { const o = { ...it, id: `${slug}:${it.id}` }; for (const f of ['start_ms', 'end_ms', 'gap_start_ms', 'gap_end_ms']) if (Number.isFinite(it[f])) o[f] = it[f] + off; pItems.push(o); }
  pA.push(...A.map(([a, b]) => [a + off, b + off])); pB.push(...B.map(([a, b]) => [a + off, b + off])); pD.push(...D.map(([a, b]) => [a + off, b + off]));
});

const aS = score(pItems, pA, 'strict'), aG = score(pItems, pA, 'gap'), bS = score(pItems, pB, 'strict'), bG = score(pItems, pB, 'gap');
const j = jitter(pItems, pA, pB); const v = verdict(aS, aG, bS, bG, j);
const dS = score(pItems, pD, 'strict'), dG = score(pItems, pD, 'gap'); const jd = jitter(pItems, pD, pB); const vd = verdict(dS, dG, bS, bG, jd);
const sum = (f) => FILMS.reduce((a, s) => a + f(perFilm[s]), 0);
const nr = who.reduce((a, r) => a + r.n, 0), nj = who.reduce((a, r) => a + r.nj, 0);
const w = (b) => { const x = who.filter((r) => r.by === b); return `${x.filter((r) => r.hit).length}/${x.length}`; };
const rc = (k2, s2) => sum((f) => f.rules_codex[k2][s2]);
const pooled = {
  recall: v.cons_recall, strict_recall: v.strict_recall, gap_recall: v.gap_recall, recall_verdict: v.recall, recall_pass: v.ca >= v.cb && v.recall !== 'live',
  prec: `${aS.prec}/${aG.prec} vs ${bS.prec}/${bG.prec}`, prec_verdict: v.prec, jitter: j,
  skip: `${aS.skip_min} vs ${bS.skip_min} (x${r3(aS.skip_min / bS.skip_min)})`, skip_pass: aS.skip_min <= 1.15 * bS.skip_min,
  wordless_peaks: `${aS.wordless_all.covered}/${aS.wordless_all.n} vs ${bS.wordless_all.covered}/${bS.wordless_all.n}`, wordless_pass: aS.wordless_all.covered >= bS.wordless_all.covered,
  wordless_scenes: `${sum((f) => f.wordless_scenes.v102.found)}/${sum((f) => f.wordless_scenes.v102.n)} vs ${sum((f) => f.wordless_scenes.live.found)}/${sum((f) => f.wordless_scenes.live.n)}`,
  rule1_human: `${aS.human_villain} vs ${bS.human_villain}`, rule2_human: `${aS.human_child} vs ${bS.human_child}`,
  rule1_codex: `${rc('villain', 'v')}/${rc('villain', 'n')} vs ${rc('villain', 'live')}`, rule2_codex: `${rc('child', 'v')}/${rc('child', 'n')} vs ${rc('child', 'live')}`, rule2_codex_clean: `${rc('clean_child', 'v')}/${rc('clean_child', 'n')} vs ${rc('clean_child', 'live')}`,
  rule3_tag_only: `${aS.tag_only} vs ${bS.tag_only}`,
  jev_share: `${nj}/${nr} = ${r3(nj / nr)}`, flagged: who.length, jev_only: w('jev'), sonnet_only: w('sonnet'), both: w('both'), needing_jev: who.filter((r) => r.by !== 'sonnet').length,
  sonnet_crying: `${who.filter((r) => r.cry && r.hit).length} hit / ${who.filter((r) => r.cry && !r.hit).length} miss`,
  no_text: `${sum((f) => f.text.no_text.length)}/${sum((f) => f.text.flagged)}`, placeholder_title: `${sum((f) => f.text.placeholder_title.length)}/${sum((f) => f.text.flagged)}`,
  code_built_shown: sum((f) => f.text.code_built.length),
  gated_only_scenes: sum((f) => f.invariants.gated_only_scenes.length), guard_only_scenes: FILMS.flatMap((s) => perFilm[s].invariants.guard_only_scenes.map((x) => `${s}:${x}`)),
  invariant_violations: sum((f) => f.invariants.violations.length),
  diag_ungated: { recall: vd.cons_recall, recall_verdict: vd.recall, prec: `${dS.prec}/${dG.prec} vs ${bS.prec}/${bG.prec}`, prec_verdict: vd.prec, skip: `${dS.skip_min} vs ${bS.skip_min} (x${r3(dS.skip_min / bS.skip_min)})`, jitter: jd },
};
const out = { generated_at: new Date().toISOString(), pooled, perFilm };
fs.writeFileSync(path.join(here, 'out', 'recompute.json'), JSON.stringify(out, null, 2));
console.log('POOLED', JSON.stringify(pooled, null, 1));
for (const [s, f] of Object.entries(perFilm)) {
  console.log(`\n== ${s}: key ${f.human_items} human, ${f.mapped} mapped, ${f.should_flag_mapped} should_flag; scenes ${JSON.stringify(f.scenes)}`);
  console.log(`  recall ${f.verdict.cons_recall} [strict ${f.verdict.strict_recall}, gap ${f.verdict.gap_recall}] (${f.verdict.recall}); prec ${f.v102.strict.prec}/${f.v102.gap.prec} vs ${f.live.strict.prec}/${f.live.gap.prec} (${f.verdict.prec}); jitter ${JSON.stringify(f.jitter)}`);
  console.log(`  skip ${f.v102.strict.skip_min} vs ${f.live.strict.skip_min} (x${f.skip_ratio}); wordless ${f.wordless_peaks}; wl scenes ${JSON.stringify(f.wordless_scenes)}; rule3 ${f.rule3_tag_only}; human rule1 ${f.v102.strict.human_villain} vs ${f.live.strict.human_villain}, rule2 ${f.v102.strict.human_child} vs ${f.live.strict.human_child}`);
  console.log(`  codex rules ${JSON.stringify(f.rules_codex)}`);
  console.log(`  jev share ${f.jev_share}; who ${JSON.stringify(f.who)}; sonnet crying ${f.sonnet_crying_scenes}`);
  console.log(`  invariants ${JSON.stringify(f.invariants)}`);
  console.log(`  text: flagged ${f.text.flagged}, no text ${f.text.no_text.length}, placeholder ${f.text.placeholder_title.length}, sources ${JSON.stringify(f.text.sources)}, title sources ${JSON.stringify(f.text.title_sources)}, code-built ${f.text.code_built.length}; live desc ${f.text.live_desc}/${f.text.live_scenes}, titles ${f.text.live_titles}`);
  console.log(`  diag ungated ${JSON.stringify(f.diag_ungated)}; v10.2 missed that live found: ${f.v102_missed_live_found.join(',')}`);
}
