#!/usr/bin/env node
// ROUND 8 BAR (evaluation only, no model calls): v10_1/round7/bar7.mjs's bar, applied to v10.2 as run (the tier-A gate
// is inside v10.2's select.js, so there is no offline variant) vs live on the three fresh films, per film and pooled.
// Inputs (round8/out): headtohead.json, descriptions.json (judge.mjs), reasons-truth.json (judge-reasons.mjs),
// who-flags.json. Criteria (pooled), unchanged from round 7:
//   1 recall      conservative recall >= live and jitter verdict not 'live'
//   2 precision   jitter verdict (300 seeded runs, 95% bar) not 'live'
//   3 skip        <= 1.15 x live
//   4 wordless    wordless-peak coverage (all mapped should_flag wordless items) >= live
//   5 text        accurate share of shown v10.2 texts >= live's (judged texts only), 0 uncited or unverified shown text
//                 (whyCheck), 0 FALSE code-built reasons (truth judge)
// Also reported: no-text share and placeholder ('Flagged scene') titles, rules 1/2 (human policy items and the
// model-written codex-rules items kept apart; 'clean' = not played for laughs, not audit-false), rule 3 (tag_only
// items skipped; fewer is better), Jev share and who-flags.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const rj = (f) => JSON.parse(fs.readFileSync(path.join(here, 'out', f), 'utf8'));
const r3 = (x) => (x == null ? null : Math.round(x * 1000) / 1000);
const V = ['accurate', 'partly', 'wrong', 'generic', 'missing'];
const d = rj('descriptions.json'); const truth = rj('reasons-truth.json'); const h = rj('headtohead.json'); const w = rj('who-flags.json');

function descFor(films) {
  const rows = d.per_film.filter((f) => films.includes(f.slug)).flatMap((f) => f.rows.map((r) => ({ ...r, slug: f.slug })));
  const v = rows.filter((r) => r.sys === 'v10');
  const tally = (list) => Object.fromEntries(V.map((k) => [k, list.filter((x) => (x.verdict ?? 'missing') === k).length]));
  const n = (t) => t.accurate + t.partly + t.wrong + t.generic;
  const vt = tally(v.filter((x) => x.kind === 'text')); const lt = tally(rows.filter((x) => x.sys === 'live' && x.kind === 'text'));
  const tr = truth.per_film.filter((f) => films.includes(f.slug)).flatMap((f) => f.rows.map((r) => ({ ...r, slug: f.slug })));
  const nt = d.per_film.filter((f) => films.includes(f.slug)).map((f) => f.no_text);
  const flagged = nt.reduce((a, x) => a + x.flagged, 0); const noText = nt.reduce((a, x) => a + x.no_text.length, 0); const ph = nt.reduce((a, x) => a + x.placeholder_title.length, 0);
  const vTitle = tally(v.filter((x) => x.kind === 'title'));
  return {
    v102_text: vt, live_text: lt, v102_title: vTitle, live_title: tally(rows.filter((x) => x.sys === 'live' && x.kind === 'title')),
    v102_accurate_share: r3(vt.accurate / n(vt)), live_accurate_share: r3(lt.accurate / n(lt)),
    v102_title_accurate_share: r3(vTitle.accurate / n(vTitle)),
    flagged, no_text: `${noText}/${flagged}`, no_text_share: r3(noText / flagged), placeholder_title: `${ph}/${flagged}`, placeholder_title_share: r3(ph / flagged),
    generic_title_share_incl_judged_generic: r3((ph + vTitle.generic) / flagged),
    code_built_statements: tr.length, code_built_truth: Object.fromEntries(['true', 'false', 'unclear'].map((k) => [k, tr.filter((x) => x.verdict === k).length])),
    false_code_built: tr.filter((x) => x.verdict === 'false').map((x) => `${x.slug}:${x.scene} [${x.kind}] ${x.text}`),
    wrong_v102_texts: v.filter((x) => x.verdict === 'wrong').map((x) => `${x.slug}:${x.scene} [${x.kind}${x.source ? `/${x.source}` : ''}] ${x.text} -- ${x.why}`),
    wrong_live_texts: rows.filter((x) => x.sys === 'live' && x.verdict === 'wrong').length,
  };
}
const films = h.films.map((f) => f.slug);
const P = h.pooled; const VV = P.verdict;
const wl = (sys, list = h.films) => list.reduce((a, f) => a + f.parent[sys].i_wordless_peaks_all.covered, 0);
const wlN = (list = h.films) => list.reduce((a, f) => a + f.parent.v10.i_wordless_peaks_all.n, 0);
const uncited = h.films.flatMap((f) => f.parent.v10.iii_why.uncited_or_unverified.map((x) => `${f.slug}:${x}`));
const desc = descFor(films);
const rules = (sys, list = h.films) => {
  const k = sys === 'v10' ? 'v10_skip' : 'live';
  const s = (g) => list.reduce((a, f) => a + f.rules_1_2.recall[g][k], 0); const N = (g) => list.reduce((a, f) => a + f.rules_1_2.recall[g].n, 0);
  const pol = (g) => { const [a, b] = list.reduce((acc, f) => { const [x, y] = f[sys].strict[g].split('/').map(Number); return [acc[0] + x, acc[1] + y]; }, [0, 0]); return `${a}/${b}`; };
  return { human_villain_threat: pol('villain'), human_child_terrified: pol('child'), codex_villain_threat: `${s('villain_threat')}/${N('villain_threat')}`, codex_child_terrified: `${s('child_terrified')}/${N('child_terrified')}`, codex_clean_child: `${s('clean_child')}/${N('clean_child')}`, codex_all: `${s('all')}/${N('all')}`, codex_clean: `${s('clean')}/${N('clean')}` };
};
const bar = {
  recall: { v102: VV.conservative_recall.a, live: VV.conservative_recall.b, of: VV.conservative_recall.of, jitter_verdict: VV.recall === 'A' ? 'v10.2' : VV.recall === 'B' ? 'live' : 'tie', share_v102_gt_live: P.sensitivity.recall.share_a_gt_b, share_v102_lt_live: P.sensitivity.recall.share_a_lt_b, pass: VV.conservative_recall.a >= VV.conservative_recall.b && VV.recall !== 'B' },
  precision: { v102: `${P.v10.strict.precision}/${P.v10.gap.precision}`, live: `${P.live.strict.precision}/${P.live.gap.precision}`, jitter_verdict: VV.precision === 'A' ? 'v10.2' : VV.precision === 'B' ? 'live' : 'tie', share_v102_lt_live: P.sensitivity.precision.share_a_lt_b, share_v102_gt_live: P.sensitivity.precision.share_a_gt_b, pass: VV.precision !== 'B' },
  skip_minutes: { v102: P.v10.strict.skip_minutes, live: P.live.strict.skip_minutes, ratio: r3(P.v10.strict.skip_minutes / P.live.strict.skip_minutes), pass: P.v10.strict.skip_minutes <= 1.15 * P.live.strict.skip_minutes },
  wordless_peaks: { v102: `${wl('v10')}/${wlN()}`, live: `${wl('live')}/${wlN()}`, pass: wl('v10') >= wl('live') },
  text: { accurate_share_v102: desc.v102_accurate_share, accurate_share_live: desc.live_accurate_share, uncited: uncited.length, uncited_list: uncited, false_code_built: desc.false_code_built.length, pass: desc.v102_accurate_share >= desc.live_accurate_share && uncited.length === 0 && desc.false_code_built.length === 0 },
};
bar.all_pass = ['recall', 'precision', 'skip_minutes', 'wordless_peaks', 'text'].every((k) => bar[k].pass);
const perFilm = h.films.map((f) => ({
  slug: f.slug, gate: f.gate, scenes: f.scenes,
  recall: `v10.2 ${f.verdict.conservative_recall.a} / live ${f.verdict.conservative_recall.b} of ${f.verdict.conservative_recall.of}`, recall_verdict: f.verdict.recall === 'A' ? 'v10.2' : f.verdict.recall === 'B' ? 'live' : 'tie',
  jitter_recall: { v102_gt_live: f.sensitivity.recall.share_a_gt_b, v102_lt_live: f.sensitivity.recall.share_a_lt_b },
  precision: `v10.2 ${f.v10.strict.precision}/${f.v10.gap.precision} live ${f.live.strict.precision}/${f.live.gap.precision}`, precision_verdict: f.verdict.precision === 'A' ? 'v10.2' : f.verdict.precision === 'B' ? 'live' : 'tie',
  jitter_precision: { v102_gt_live: f.sensitivity.precision.share_a_gt_b, v102_lt_live: f.sensitivity.precision.share_a_lt_b },
  skip: { v102: f.v10.strict.skip_minutes, live: f.live.strict.skip_minutes, ratio: r3(f.v10.strict.skip_minutes / f.live.strict.skip_minutes) },
  wordless: `v10.2 ${f.parent.v10.i_wordless_peaks_all.covered}/${f.parent.v10.i_wordless_peaks_all.n} live ${f.parent.live.i_wordless_peaks_all.covered}/${f.parent.live.i_wordless_peaks_all.n}`,
  rules: { v102: rules('v10', [f]), live: rules('live', [f]) },
  rule3_tag_only_skipped: { v102: f.v10.strict.tag_only_flagged, live: f.live.strict.tag_only_flagged },
  why: { ...f.parent.v10.iii_why, missing: undefined }, text: descFor([f.slug]),
  who_flags: w.per_film[f.slug], cost: f.cost_usd, v102_missed: f.v10_missed, live_missed: f.live_missed,
}));
const out = { generated_at: new Date().toISOString(), freeze: h.freeze, films, bar, text: desc, rules_pooled: { v102: rules('v10'), live: rules('live') }, rule3_tag_only_skipped: { v102: P.v10.strict.tag_only_flagged, live: P.live.strict.tag_only_flagged }, who_flags: w.pooled, per_film: perFilm };
fs.writeFileSync(path.join(here, 'out', 'bar.json'), JSON.stringify(out, null, 2));
const b = bar;
console.log(`== POOLED ${films.join('+')}: ALL_PASS ${b.all_pass}`);
console.log(`  recall ${b.recall.v102} vs ${b.recall.live}/${b.recall.of} (${b.recall.jitter_verdict}; v>l ${b.recall.share_v102_gt_live} v<l ${b.recall.share_v102_lt_live}) ${b.recall.pass}`);
console.log(`  precision ${b.precision.v102} vs ${b.precision.live} (${b.precision.jitter_verdict}; v<l ${b.precision.share_v102_lt_live} v>l ${b.precision.share_v102_gt_live}) ${b.precision.pass}`);
console.log(`  skip ${b.skip_minutes.v102} vs ${b.skip_minutes.live} (x${b.skip_minutes.ratio}) ${b.skip_minutes.pass}`);
console.log(`  wordless ${b.wordless_peaks.v102} vs ${b.wordless_peaks.live} ${b.wordless_peaks.pass}`);
console.log(`  text ${JSON.stringify(desc.v102_text)} (${desc.v102_accurate_share}) live ${JSON.stringify(desc.live_text)} (${desc.live_accurate_share}); uncited ${b.text.uncited}; false code-built ${b.text.false_code_built} of ${desc.code_built_statements}; no text ${desc.no_text}; placeholder title ${desc.placeholder_title}; v102 titles ${JSON.stringify(desc.v102_title)} ${b.text.pass}`);
console.log(`  rules ${JSON.stringify(out.rules_pooled)}; rule3 ${JSON.stringify(out.rule3_tag_only_skipped)}; who ${JSON.stringify(out.who_flags)}`);
for (const f of perFilm) console.log(`  ${f.slug}: recall ${f.recall} (${f.recall_verdict}); prec ${f.precision} (${f.precision_verdict}); skip ${JSON.stringify(f.skip)}; wordless ${f.wordless}; text ${f.text.v102_accurate_share} vs ${f.text.live_accurate_share}, no text ${f.text.no_text}, placeholder ${f.text.placeholder_title}; rules ${JSON.stringify(f.rules)}; rule3 ${JSON.stringify(f.rule3_tag_only_skipped)}; jev share ${f.who_flags.reasons.jev_share}`);
