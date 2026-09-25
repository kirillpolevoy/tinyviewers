#!/usr/bin/env node
// v10.2 SEEN-FILM MEASUREMENT (16 films, IN-SAMPLE and labelled: v10.2 was designed on these films; not a test).
// Pure code over stored answers (no model calls). Systems, all re-selected from the SAME stored answers:
//   live     the live pipeline's scenes (every live scene is its skip); 15 films (up has no live baseline)
//   v101     v10.1 as it would run (v10_1/select.js + v10_1/policy.json)
//   v101g    v10.1 + the pre-registered tier-A gate applied offline (v10/prereg-tierA-gating.json), round 7's variant
//   v102     v10.2 (select.js: tier-A gate, rule 2, resolution guard) = out102/seen/<slug>.tags.r1.json's flags,
//            with the v10.2 parent text (out102/seen/<slug>.why.r1.json: describe.js + check-describe.js run on them)
// Skip spans for every system: moments.js respanScenes over the stored moment answers (a reason the stored run never
// asked -> the whole scene), so the systems differ only by their flags.
// Metrics (refscore.js, round-7 definitions): conservative recall (min of strict / gap window) of mapped should_flag
// human items, should_flag precision proxy (strict / gap), skip minutes, wordless should_flag items covered (>= 80%),
// rules 1/2 recall on the clean codex-rules items, rule 3 = tag_only (comic) items skipped, Jev share of flag
// reasons, jitter verdicts (300 runs, 95%). TEXT (v102 and v101g): flagged scenes with no text, with a generic title
// ('Flagged scene' or a code-built plain title), and -- from eval/judge-seen.mjs / eval/judge-reasons-seen.mjs when
// present -- the blind Codex judge's accurate share and FALSE code-built reasons.
//   node eval/seen.mjs [films]  -> eval/out/seen.json + a table
import fs from 'node:fs';
import path from 'node:path';
import * as S101 from '../../v10_1/select.js';
import * as S102 from '../select.js';
import { loadSplit } from '../split.js';
import { FILMS as ALL, loadFilm, runSystem, sys, versus, rules12, allWordless, sceneHit, pool, liveFor, resolveFile, whyFile101, rj, V102, V101, TS } from './seen-lib.mjs';

const FILMS = (process.argv[2] ?? ALL.join(',')).split(',');
const SPLIT = loadSplit();
const P101 = S101.loadPolicy(path.join(V101, 'policy.json'));
const P102 = S102.loadPolicy(path.join(V102, 'policy.json'));
const pre = rj(path.join(TS, 'v10', 'prereg-tierA-gating.json'));
const TIER_A = new Set(pre.tierA_jev_concepts); const SON = new Set(pre.sonnet_concepts);
const CMAP = S102.conceptMap(SPLIT);
const SEEN = path.join(V102, 'out102', 'seen');
// SEEN_WHY_DIR: read v10.2's why files from another directory (out102/seen/why2 = the code-built-reasons-ON variant);
// SEEN_VARIANT names the output (eval/out/seen[.<variant>].json) and the judge files it reads
const WHY_DIR = process.env.SEEN_WHY_DIR ? path.resolve(process.env.SEEN_WHY_DIR) : SEEN;
const VARIANT = process.env.SEEN_VARIANT ? `.${process.env.SEEN_VARIANT}` : '';
const r3 = (x) => (x == null || Number.isNaN(x) ? null : Math.round(x * 1000) / 1000);
const PAIR = ['frozen', 'zootopia'];
const R7 = ['frozen', 'zootopia', 'good-dinosaur'];

function textStats(flagged) {
  const n = flagged.length;
  const noText = flagged.filter((s) => !s.why?.text).map((s) => s.id);
  const generic = flagged.filter((s) => !s.why || s.why.title_source !== 'sonnet_verified').map((s) => s.id);
  const placeholder = flagged.filter((s) => !s.why || s.why.title_source === 'none').map((s) => s.id);
  return { flagged: n, no_text: noText.length, no_text_share: n ? r3(noText.length / n) : null, generic_title: generic.length, generic_title_share: n ? r3(generic.length / n) : null, placeholder_title: placeholder.length, no_text_ids: noText, generic_title_ids: generic };
}
const jevShare = (flagged) => { const rs = flagged.flatMap((s) => s.flag_reasons); const j = rs.filter((r) => r.by === 'jev').length; return { reasons: rs.length, jev: j, share: rs.length ? r3(j / rs.length) : null, scenes_only_sonnet: flagged.filter((s) => s.flag_reasons.every((r) => r.by === 'sonnet')).length }; };

const films = [];
for (const slug of FILMS) {
  const F = loadFilm(slug);
  const live = await liveFor(slug);
  const a = runSystem(F, S101, P101, { used: SPLIT.sonnet_used });
  const gate = (r) => (r.by === 'sonnet' ? SON.has(S102.conceptOf(r, F.items, CMAP)) : TIER_A.has(S102.conceptOf(r, F.items, CMAP)));
  const g = runSystem(F, S101, P101, { used: SPLIT.sonnet_used, gate });
  const b = runSystem(F, S102, P102, { used: SPLIT.sonnet_used, resolve: rj(resolveFile(slug)), split: SPLIT });
  // v10.2 flags must be the flags describe / check-describe ran on
  const seenTags = rj(path.join(SEEN, `${slug}.tags.r1.json`));
  const same = JSON.stringify(seenTags.scenes.filter((s) => s.flagged).map((s) => [s.id, s.flag_reasons.map((r) => r.id)])) === JSON.stringify(b.flagged.map((s) => [s.id, s.flag_reasons.map((r) => r.id)]));
  if (!same) throw new Error(`${slug}: out102/seen tags differ from the v10.2 selection now (re-run eval/prep-seen.mjs and the text run)`);
  const why102 = rj(path.join(WHY_DIR, `${slug}.why.r1.json`));
  for (const s of b.flagged) { const w = why102.scenes[s.id]; s.why = w && w.reasons.join() === s.flag_reasons.map((r) => r.id).join() ? w.why : null; }
  // v10.1 text for the gated variant (round-7 offline rule: a kept scene keeps its v10.1 text)
  const why101 = fs.existsSync(whyFile101(slug)) ? rj(whyFile101(slug)) : null;
  for (const s of g.flagged) s.why = why101?.scenes?.[s.id]?.why ?? null;
  const liveSkip = live.scenes ? live.scenes.map((x) => [x.start_ms, x.end_ms]) : null;
  const key = F.key;
  const row = {
    slug, scenes: F.seg.scenes.length, live_source: live.src ?? `none (${live.error})`,
    flagged: { v101: a.flagged.length, v101g: g.flagged.length, v102: b.flagged.length, live: live.scenes?.length ?? null },
    systems: { v101: sys(key, a.skip), v101g: sys(key, g.skip), v102: sys(key, b.skip), ...(liveSkip ? { live: sys(key, liveSkip) } : {}) },
    wordless: { v101: allWordless(key, a.skip), v101g: allWordless(key, g.skip), v102: allWordless(key, b.skip), ...(liveSkip ? { live: allWordless(key, liveSkip) } : {}) },
    rules_1_2: { v101: rules12(F.fullKey, a.skip, slug), v101g: rules12(F.fullKey, g.skip, slug), v102: rules12(F.fullKey, b.skip, slug), ...(liveSkip ? { live: rules12(F.fullKey, liveSkip, slug) } : {}) },
    jev_share: { v101: jevShare(a.flagged), v101g: jevShare(g.flagged), v102: jevShare(b.flagged) },
    text: { v102: textStats(b.flagged), v101g: textStats(g.flagged), v101g_scenes_without_v101_text_file: why101 ? g.flagged.filter((s) => !why101.scenes?.[s.id]).map((s) => s.id) : 'no file' },
    v102_vs_v101g: { unflagged: g.flagged.filter((s) => !b.flagged.some((x) => x.id === s.id)).map((s) => { const t = b.tags.scenes.find((x) => x.id === s.id); const h = sceneHit(key, s); return `${s.id}${h.hit ? ' HIT' : ''}${h.tag_only ? ' (tag_only)' : ''} ${t.guard_cancelled?.length ? `guard:${t.guard_cancelled.map((r) => r.id).join('+')}` : ''}${(t.flag_reasons ?? []).length === 0 && !t.guard_cancelled?.length ? `rule2/other:${s.flag_reasons.map((r) => r.id).join('+')}` : ''}`.trim(); }), newly: b.flagged.filter((s) => !g.flagged.some((x) => x.id === s.id)).map((s) => s.id) },
    ...(liveSkip ? { v102_vs_live: versus(key, b.skip, liveSkip), v101g_vs_live: versus(key, g.skip, liveSkip) } : {}),
    v102_vs_v101g_jitter: versus(key, b.skip, g.skip),
    guard_cancelled: b.tags.scenes.filter((s) => s.guard_cancelled?.length).map((s) => `${s.id}${s.flagged ? '' : ' (unflagged)'} ${s.guard_cancelled.map((r) => `${r.id}(${r.by_guard.join('+')})`).join(' ')}`),
  };
  films.push({ row, F, skip: { v101: a.skip, v101g: g.skip, v102: b.skip, ...(liveSkip ? { live: liveSkip } : {}) }, key, flagged: { v101: a.flagged, v101g: g.flagged, v102: b.flagged } });
}

function pooledFor(list, label) {
  const withLive = list.filter((f) => f.skip.live);
  const P = pool(list, ['v101', 'v101g', 'v102']);
  const PL = pool(withLive, ['v101g', 'v102', 'live']);
  const sum = (fn) => list.reduce((a, f) => a + fn(f), 0);
  const sumL = (fn) => withLive.reduce((a, f) => a + fn(f), 0);
  const frac = (sys, k) => `${sum((f) => f.row.rules_1_2[sys][k][0])}/${sum((f) => f.row.rules_1_2[sys][k][1])}`;
  const fracL = (sys, k) => `${sumL((f) => f.row.rules_1_2[sys][k][0])}/${sumL((f) => f.row.rules_1_2[sys][k][1])}`;
  const tx = (sys) => { const fl = list.flatMap((f) => f.flagged[sys]); return textStats(fl); };
  const js = (sys) => jevShare(list.flatMap((f) => f.flagged[sys]));
  return {
    label, films: list.map((f) => f.row.slug), films_with_live: withLive.map((f) => f.row.slug),
    all: { v101: sys(P.key, P.skips.v101), v101g: sys(P.key, P.skips.v101g), v102: sys(P.key, P.skips.v102), v102_vs_v101g: versus(P.key, P.skips.v102, P.skips.v101g), v102_vs_v101: versus(P.key, P.skips.v102, P.skips.v101) },
    with_live: withLive.length ? { v101g: sys(PL.key, PL.skips.v101g), v102: sys(PL.key, PL.skips.v102), live: sys(PL.key, PL.skips.live), v102_vs_live: versus(PL.key, PL.skips.v102, PL.skips.live), v101g_vs_live: versus(PL.key, PL.skips.v101g, PL.skips.live), skip_ratio_v102_live: r3(sys(PL.key, PL.skips.v102).skip_minutes / sys(PL.key, PL.skips.live).skip_minutes), wordless: Object.fromEntries(['v101g', 'v102', 'live'].map((s) => [s, `${sumL((f) => f.row.wordless[s].covered)}/${sumL((f) => f.row.wordless[s].n)}`])), rules_1_2: Object.fromEntries(['v101g', 'v102', 'live'].map((s) => [s, { villain: fracL(s, 'villain'), child: fracL(s, 'child') }])) } : null,
    wordless: Object.fromEntries(['v101', 'v101g', 'v102'].map((s) => [s, `${sum((f) => f.row.wordless[s].covered)}/${sum((f) => f.row.wordless[s].n)}`])),
    rules_1_2: Object.fromEntries(['v101', 'v101g', 'v102'].map((s) => [s, { villain: frac(s, 'villain'), child: frac(s, 'child') }])),
    jev_share: { v101: js('v101'), v101g: js('v101g'), v102: js('v102') },
    text: { v102: tx('v102'), v101g: tx('v101g') },
  };
}
const sets = [pooledFor(films, `all ${films.length} seen films`)];
const r7 = films.filter((f) => R7.includes(f.row.slug)); if (r7.length === 3) sets.push(pooledFor(r7, 'round-7 films (frozen, zootopia, good-dinosaur; v10.1 as-run answers)'));
const pr = films.filter((f) => PAIR.includes(f.row.slug)); if (pr.length === 2) sets.push(pooledFor(pr, 'round-7 pair (frozen, zootopia)'));
const dev13 = films.filter((f) => !R7.includes(f.row.slug)); if (dev13.length) sets.push(pooledFor(dev13, 'the 13 films of rounds 1-5 (stored tournament answers)'));
// Codex judge results, when present
const judgeF = path.join(V102, 'eval', 'out', `judge-seen${VARIANT}.json`); const truthF = path.join(V102, 'eval', 'out', `judge-reasons-seen${VARIANT}.json`);
const judge = fs.existsSync(judgeF) ? rj(judgeF) : null; const truth = fs.existsSync(truthF) ? rj(truthF) : null;
const out = { generated_at: new Date().toISOString(), label: 'DEV-ONLY, IN-SAMPLE (16 seen films; v10.2 was designed on them). Not a test.', policy_sha: null, per_film: films.map((f) => f.row), pooled: sets, judge: judge?.summary ?? null, reasons_truth: truth?.summary ?? null };
fs.mkdirSync(path.join(V102, 'eval', 'out'), { recursive: true });
fs.writeFileSync(path.join(V102, 'eval', 'out', `seen${VARIANT}.json`), JSON.stringify(out, null, 2));
const line = (n, s) => `  ${n.padEnd(6)} cons.recall ${String(s.conservative_recall).padStart(3)}/${s.of}  prec ${s.precision_strict}/${s.precision_gap}  skip ${s.skip_minutes} min  tag-only skipped ${s.tag_only_skipped}`;
console.log(out.label);
for (const f of films) {
  const r = f.row;
  console.log(`\n${r.slug}: flagged v101 ${r.flagged.v101} v101g ${r.flagged.v101g} v102 ${r.flagged.v102} live ${r.flagged.live ?? '-'}`);
  for (const k of ['v101', 'v101g', 'v102', 'live']) if (r.systems[k]) console.log(line(k, r.systems[k]));
  console.log(`  v102 unflagged vs v101g: ${r.v102_vs_v101g.unflagged.join(' | ') || '-'}; newly ${r.v102_vs_v101g.newly.join(',') || '-'}`);
  console.log(`  text v102 no-text ${r.text.v102.no_text}/${r.text.v102.flagged} generic title ${r.text.v102.generic_title} | v101g no-text ${r.text.v101g.no_text}/${r.text.v101g.flagged} generic ${r.text.v101g.generic_title}`);
}
for (const P of sets) {
  console.log(`\n=== POOLED ${P.label}`);
  for (const k of ['v101', 'v101g', 'v102']) console.log(line(k, P.all[k]));
  console.log(`  v102 vs v101g: recall ${P.all.v102_vs_v101g.recall} precision ${P.all.v102_vs_v101g.precision} ${JSON.stringify(P.all.v102_vs_v101g.jitter)}`);
  if (P.with_live) { console.log(`  with live (${P.films_with_live.length} films):`); for (const k of ['v101g', 'v102', 'live']) console.log(`  ${line(k, P.with_live[k])}`); console.log(`    v102 vs live: recall ${P.with_live.v102_vs_live.recall} precision ${P.with_live.v102_vs_live.precision} ${JSON.stringify(P.with_live.v102_vs_live.jitter)}; skip ratio ${P.with_live.skip_ratio_v102_live}; wordless ${JSON.stringify(P.with_live.wordless)}; rules ${JSON.stringify(P.with_live.rules_1_2)}`); }
  console.log(`  wordless ${JSON.stringify(P.wordless)}; rules 1/2 ${JSON.stringify(P.rules_1_2)}; jev share ${JSON.stringify(P.jev_share)}`);
  console.log(`  text v102 ${JSON.stringify({ ...P.text.v102, no_text_ids: undefined, generic_title_ids: undefined })} | v101g ${JSON.stringify({ ...P.text.v101g, no_text_ids: undefined, generic_title_ids: undefined })}`);
}
