#!/usr/bin/env node
// Round-7 BAR (evaluation only, no model calls). round6/bar.mjs's bar, applied to v10.1 as-run and to the
// pre-registered tier-A gated variant, pooled over (a) the unseen pair frozen+zootopia (the decision set) and
// (b) all three films incl. good-dinosaur (SEEN/dev). Inputs (round7/out): h2h-<set>[-tierA].json
// (headtohead.mjs), descriptions.json (judge.mjs), who-flags-<set>[-tierA].json, tierA-gating.json.
//   1 recall      conservative recall >= live and jitter verdict not 'live'
//   2 precision   jitter verdict (300 seeded runs, 95% bar) not 'live'
//   3 skip        <= 1.15 x live
//   4 wordless    wordless-peak coverage (all mapped should_flag wordless items) >= live
//   5 text        accurate share of shown v10.1 texts >= live's (round-6 formula: judged texts only), 0 uncited
//                 or unverified shown text (whyCheck), 0 FALSE code-built reasons (judge 'wrong' on a
//                 'Flagged because <phrase>.' clause or a plain title)
// Also rules 1/2 (codex-rules recall), rule 3 (comic-peril tag_only items skipped: fewer is better), Jev share.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const rj = (f) => JSON.parse(fs.readFileSync(path.join(here, 'out', f), 'utf8'));
const r3 = (x) => (x == null ? null : Math.round(x * 1000) / 1000);
const V = ['accurate', 'partly', 'wrong', 'generic', 'missing'];
const d = rj('descriptions.json');
// judge.mjs's prompt labels every code-built reason 'generic' (true or not), so FALSE code-built reasons come from
// judge-reasons.mjs (true / false / unclear against the scene's lines and the plot).
const truth = rj('reasons-truth.json');

function descFor(films, keepScene) {
  const rows = d.per_film.filter((f) => films.includes(f.slug)).flatMap((f) => f.rows.map((r) => ({ ...r, slug: f.slug })));
  const v = rows.filter((r) => r.sys === 'v10' && keepScene(r.slug, r.scene));
  const tally = (list) => Object.fromEntries(V.map((k) => [k, list.filter((x) => (x.verdict ?? 'missing') === k).length]));
  const n = (t) => t.accurate + t.partly + t.wrong + t.generic;
  const vt = tally(v.filter((x) => x.kind === 'text')); const lt = tally(rows.filter((x) => x.sys === 'live' && x.kind === 'text'));
  const code = v.filter((x) => x.code_built);
  const tr = truth.per_film.filter((f) => films.includes(f.slug)).flatMap((f) => f.rows.map((r) => ({ ...r, slug: f.slug }))).filter((r) => keepScene(r.slug, r.scene));
  const tt = Object.fromEntries(['true', 'false', 'unclear'].map((k) => [k, tr.filter((x) => x.verdict === k).length]));
  return {
    v101_text: vt, live_text: lt, v101_title: tally(v.filter((x) => x.kind === 'title')), live_title: tally(rows.filter((x) => x.sys === 'live' && x.kind === 'title')),
    v101_accurate_share: r3(vt.accurate / n(vt)), live_accurate_share: r3(lt.accurate / n(lt)),
    code_built_reasons_desc_judge: tally(code), code_built_truth: tt, false_code_built: tr.filter((x) => x.verdict === 'false').map((x) => `${x.slug}:${x.scene} [${x.kind}] ${x.text}`),
    partly_code_built: code.filter((x) => x.verdict === 'partly').map((x) => `${x.slug}:${x.scene} [${x.kind}] ${x.text}`),
  };
}

function barFor(set, variant) {
  const h = rj(`h2h-${set}${variant === 'tierA' ? '-tierA' : ''}.json`);
  const w = rj(`who-flags-${set}${variant === 'tierA' ? '-tierA' : ''}.json`);
  const films = h.films.map((f) => f.slug);
  const flaggedIds = new Map(films.map((s) => { const f = h.films.find((x) => x.slug === s); return [s, null]; }));
  // scenes flagged in this variant (tierA: from its tags)
  const flaggedSet = new Set(w.scenes.map((s) => `${s.slug}:${s.id}`));
  const desc = descFor(films, (slug, scene) => flaggedSet.has(`${slug}:${scene}`));
  const P = h.pooled; const VV = P.verdict;
  const wl = (sys) => h.films.reduce((a, f) => a + f.parent[sys].i_wordless_peaks_all.covered, 0);
  const wlN = h.films.reduce((a, f) => a + f.parent.v10.i_wordless_peaks_all.n, 0);
  const uncited = h.films.flatMap((f) => f.parent.v10.iii_why.uncited_or_unverified.map((x) => `${f.slug}:${x}`));
  const rules = (sys) => { const k = sys === 'v10' ? 'v10_skip' : 'live'; const s = (g) => h.films.reduce((a, f) => a + f.rules_1_2.recall[g][k], 0); const N = (g) => h.films.reduce((a, f) => a + f.rules_1_2.recall[g].n, 0); return { villain_threat: `${s('villain_threat')}/${N('villain_threat')}`, child_terrified: `${s('child_terrified')}/${N('child_terrified')}`, all: `${s('all')}/${N('all')}`, clean: `${s('clean')}/${N('clean')}` }; };
  const bar = {
    recall: { v101: VV.conservative_recall.a, live: VV.conservative_recall.b, of: VV.conservative_recall.of, jitter_verdict: VV.recall === 'A' ? 'v10.1' : VV.recall === 'B' ? 'live' : 'tie', pass: VV.conservative_recall.a >= VV.conservative_recall.b && VV.recall !== 'B' },
    precision: { v101: `${P.v10.strict.precision}/${P.v10.gap.precision}`, live: `${P.live.strict.precision}/${P.live.gap.precision}`, jitter_verdict: VV.precision === 'A' ? 'v10.1' : VV.precision === 'B' ? 'live' : 'tie', share_v101_lt_live: P.sensitivity.precision.share_a_lt_b, share_v101_gt_live: P.sensitivity.precision.share_a_gt_b, pass: VV.precision !== 'B' },
    skip_minutes: { v101: P.v10.strict.skip_minutes, live: P.live.strict.skip_minutes, ratio: r3(P.v10.strict.skip_minutes / P.live.strict.skip_minutes), pass: P.v10.strict.skip_minutes <= 1.15 * P.live.strict.skip_minutes },
    wordless_peaks: { v101: `${wl('v10')}/${wlN}`, live: `${wl('live')}/${wlN}`, pass: wl('v10') >= wl('live') },
    descriptions: { ...desc, uncited: uncited.length, uncited_list: uncited, pass: desc.v101_accurate_share >= desc.live_accurate_share && uncited.length === 0 && desc.false_code_built.length === 0 },
  };
  bar.all_pass = ['recall', 'precision', 'skip_minutes', 'wordless_peaks', 'descriptions'].every((k) => bar[k].pass);
  const perFilm = h.films.map((f) => ({
    slug: f.slug, gate: f.gate, scenes: f.scenes,
    recall: `v10.1 ${f.verdict.conservative_recall.a} / live ${f.verdict.conservative_recall.b} of ${f.verdict.conservative_recall.of}`, recall_verdict: f.verdict.recall,
    precision: `v10.1 ${f.v10.strict.precision}/${f.v10.gap.precision} live ${f.live.strict.precision}/${f.live.gap.precision}`, precision_verdict: f.verdict.precision,
    jitter_precision: { v101_gt_live: f.sensitivity.precision.share_a_gt_b, v101_lt_live: f.sensitivity.precision.share_a_lt_b },
    skip: { v101: f.v10.strict.skip_minutes, live: f.live.strict.skip_minutes },
    wordless: `v10.1 ${f.parent.v10.i_wordless_peaks_all.covered}/${f.parent.v10.i_wordless_peaks_all.n} live ${f.parent.live.i_wordless_peaks_all.covered}/${f.parent.live.i_wordless_peaks_all.n}`,
    rule3_tag_only_skipped: { v101: f.v10.strict.tag_only_flagged, live: f.live.strict.tag_only_flagged },
    rules_recall: f.rules_1_2.recall, why: f.parent.v10.iii_why, descriptions: descFor([f.slug], (slug, scene) => flaggedSet.has(`${slug}:${scene}`)),
    who_flags: w.per_film[f.slug], cost: f.cost_usd,
  }));
  return { set, variant, films, bar, rules_pooled: { v101: rules('v10'), live: rules('live') }, rule3_tag_only_skipped: { v101: P.v10.strict.tag_only_flagged, live: P.live.strict.tag_only_flagged }, who_flags: w.pooled, per_film: perFilm };
}
const out = { generated_at: new Date().toISOString(), freeze: rj('h2h-pair.json').freeze, results: [] };
for (const set of ['pair', 'all']) for (const variant of ['asrun', 'tierA']) out.results.push(barFor(set, variant));
fs.writeFileSync(path.join(here, 'out', 'bar7.json'), JSON.stringify(out, null, 2));
for (const r of out.results) {
  const b = r.bar;
  console.log(`\n== ${r.set} (${r.films.join('+')}) ${r.variant}: ALL_PASS ${b.all_pass}`);
  console.log(`  recall ${b.recall.v101} vs ${b.recall.live}/${b.recall.of} (${b.recall.jitter_verdict}) ${b.recall.pass}`);
  console.log(`  precision ${b.precision.v101} vs ${b.precision.live} (${b.precision.jitter_verdict}; v<l ${b.precision.share_v101_lt_live}) ${b.precision.pass}`);
  console.log(`  skip ${b.skip_minutes.v101} vs ${b.skip_minutes.live} (x${b.skip_minutes.ratio}) ${b.skip_minutes.pass}`);
  console.log(`  wordless ${b.wordless_peaks.v101} vs ${b.wordless_peaks.live} ${b.wordless_peaks.pass}`);
  console.log(`  desc v10.1 ${JSON.stringify(b.descriptions.v101_text)} (${b.descriptions.v101_accurate_share}) live ${JSON.stringify(b.descriptions.live_text)} (${b.descriptions.live_accurate_share}); uncited ${b.descriptions.uncited}; false code-built ${b.descriptions.false_code_built.length} ${JSON.stringify(b.descriptions.false_code_built)}; truth ${JSON.stringify(b.descriptions.code_built_truth)} ${b.descriptions.pass}`);
  console.log(`  rules ${JSON.stringify(r.rules_pooled)}; rule3 tag_only skipped ${JSON.stringify(r.rule3_tag_only_skipped)}; who ${JSON.stringify(r.who_flags)}`);
}
