#!/usr/bin/env node
// Round-6 BAR (evaluation only, no model calls): reads round6/out/headtohead.json and
// round6/out/descriptions.json and applies the round-5 bar, pooled over the held-out films:
//   1 recall      conservative recall v10 >= live, and the jitter verdict is not 'live'
//   2 precision   not worse: the jitter verdict (300 seeded runs, 95% bar) is not 'live'
//   3 skip        v10 skip minutes <= 1.15 x live
//   4 wordless    wordless-peak coverage (all mapped should_flag wordless items) v10 >= live
//   5 text        share of flagged-scene parent texts judged accurate v10 >= live, AND 0 v10 texts or titles
//                 from uncited memory (whyCheck: every shown sentence/title cited to its scene and
//                 Jev-verified, everything else code-built)
// Also: rules 1/2 recall vs codex-rules items (all / clean) per system. Writes round6/out/bar.json.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const rj = (f) => JSON.parse(fs.readFileSync(path.join(here, 'out', f), 'utf8'));
const h = rj('headtohead.json'); const d = rj('descriptions.json');
const P = h.pooled; const V = P.verdict;
const n = (t) => Object.entries(t).filter(([k]) => k !== 'missing').reduce((a, [, v]) => a + v, 0);
const share = (t) => (n(t) ? t.accurate / n(t) : null);
const r3 = (x) => (x == null ? null : Math.round(x * 1000) / 1000);
const wl = (sys) => h.films.reduce((a, f) => a + f.parent[sys].i_wordless_peaks_all.covered, 0);
const wlN = h.films.reduce((a, f) => a + f.parent.v10.i_wordless_peaks_all.n, 0);
const uncited = h.films.flatMap((f) => f.parent.v10.iii_why.uncited_or_unverified.map((x) => `${f.slug}:${x}`));
const mism = h.films.flatMap((f) => f.parent.v10.iii_why.mismatched.map((x) => `${f.slug}:${x}`));
const rules = (sys) => { const k = sys === 'v10' ? 'v10_skip' : 'live'; const s = (g) => h.films.reduce((a, f) => a + f.rules_1_2.recall[g][k], 0); const N = (g) => h.films.reduce((a, f) => a + f.rules_1_2.recall[g].n, 0); return { all: `${s('all')}/${N('all')}`, clean: `${s('clean')}/${N('clean')}`, villain_threat: `${s('villain_threat')}/${N('villain_threat')}`, child_terrified: `${s('child_terrified')}/${N('child_terrified')}`, clean_child: `${s('clean_child')}/${N('clean_child')}` }; };
const bar = {
  recall: { v10: V.conservative_recall.a, live: V.conservative_recall.b, of: V.conservative_recall.of, jitter_verdict: V.recall === 'A' ? 'v10' : V.recall === 'B' ? 'live' : 'tie', pass: V.conservative_recall.a >= V.conservative_recall.b && V.recall !== 'B' },
  precision: { v10: `${P.v10.strict.precision}/${P.v10.gap.precision}`, live: `${P.live.strict.precision}/${P.live.gap.precision}`, jitter_verdict: V.precision === 'A' ? 'v10' : V.precision === 'B' ? 'live' : 'tie', share_v10_lt_live: P.sensitivity.precision.share_a_lt_b, pass: V.precision !== 'B' },
  skip_minutes: { v10: P.v10.strict.skip_minutes, live: P.live.strict.skip_minutes, ratio: r3(P.v10.strict.skip_minutes / P.live.strict.skip_minutes), pass: P.v10.strict.skip_minutes <= 1.15 * P.live.strict.skip_minutes },
  wordless_peaks: { v10: `${wl('v10')}/${wlN}`, live: `${wl('live')}/${wlN}`, pass: wl('v10') >= wl('live') },
  descriptions: { v10: d.pooled.v10_text, live: d.pooled.live_text, v10_accurate_share: r3(share(d.pooled.v10_text)), live_accurate_share: r3(share(d.pooled.live_text)), v10_uncited_memory: uncited.length, v10_uncited_list: uncited, v10_text_mismatch: mism, pass: share(d.pooled.v10_text) >= share(d.pooled.live_text) && uncited.length === 0 },
};
bar.all_pass = Object.values(bar).every((x) => x.pass);
const perFilm = h.films.map((f) => {
  const dj = d.per_film.find((x) => x.slug === f.slug);
  return { slug: f.slug, recall: `v10 ${f.verdict.conservative_recall.a} / live ${f.verdict.conservative_recall.b} of ${f.verdict.conservative_recall.of}`, recall_verdict: f.verdict.recall, precision: `v10 ${f.v10.strict.precision}/${f.v10.gap.precision} live ${f.live.strict.precision}/${f.live.gap.precision}`, precision_verdict: f.verdict.precision, jitter_precision_v10_lt_live: f.sensitivity.precision.share_a_lt_b, skip: `v10 ${f.v10.strict.skip_minutes} live ${f.live.strict.skip_minutes}`, wordless: `v10 ${f.parent.v10.i_wordless_peaks_all.covered}/${f.parent.v10.i_wordless_peaks_all.n} live ${f.parent.live.i_wordless_peaks_all.covered}/${f.parent.live.i_wordless_peaks_all.n}`, descriptions: dj ? { v10_text: dj.v10_text, live_text: dj.live_text, v10_title: dj.v10_title, live_title: dj.live_title } : null, why_sources: { described: f.parent.v10.iii_why.described, described_plus_reason: f.parent.v10.iii_why.described_plus_reason, plain_reason: f.parent.v10.iii_why.plain_reason }, rules_recall: f.rules_1_2.recall, cost: f.cost_usd };
});
const out = { generated_at: new Date().toISOString(), freeze: h.freeze, bar, rules_1_2_pooled: { v10: rules('v10'), live: rules('live') }, titles: { v10: d.pooled.v10_title, live: d.pooled.live_title }, per_film: perFilm };
fs.writeFileSync(path.join(here, 'out', 'bar.json'), JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 1));
