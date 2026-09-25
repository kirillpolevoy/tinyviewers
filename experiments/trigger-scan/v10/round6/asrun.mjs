#!/usr/bin/env node
// Round-6 AS-RUN pooled score (evaluation only, no model calls). The frozen v10 produced no guide for frozen and
// zootopia (segmentation rejected by the split gate; exit 4), so v10's skip there is EMPTY (a parent adding
// the film through the passcode flow would get nothing). Same refscore functions and pooling as headtohead.mjs:
// conservative recall, should_flag precision strict+gap, 300 seeded jitter runs, 95% bar. Also live-only
// scores on the two films v10 could not run. Writes round6/out/asrun.json.
import fs from 'node:fs';
import path from 'node:path';
import { V8, TS, outDir } from '../env.js';
import { scoreKey, sensitivity, compareSystems, union, shareInside } from '../refscore.js';
import { WORDLESS_SHARE } from '../parent-checks.js';
const rj = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const FILMS = ['frozen', 'zootopia', 'good-dinosaur'];
const BASE = path.join(V8, 'round6', 'live');
const pool = { a: [], b: [], items: [] }; const films = [];
const allWordless = (key, skip) => { const U = union(skip); const rows = key.items.filter((i) => i.mappable && Number.isFinite(i.start_ms) && i.should_flag === true && i.wordless); return { n: rows.length, covered: rows.filter((i) => shareInside(i.start_ms, i.end_ms, U) >= WORDLESS_SHARE).length }; };
FILMS.forEach((slug, k) => {
  const off = k * 1e8;
  const full = rj(path.join(TS, 'refs', `${slug}.key.json`));
  const key = { ...full, items: full.items.filter((i) => i.source !== 'codex-rules') };
  const tf = path.join(outDir(), `${slug}.tags.r1.json`);
  const ran = fs.existsSync(tf);
  const aSkip = ran ? rj(tf).scenes.filter((s) => s.flagged).flatMap((s) => (s.skip?.spans ?? []).map((x) => [x.start_ms, x.end_ms])) : [];
  const bSkip = rj(path.join(BASE, `${slug}.built.json`)).scenes.map((s) => [s.start_ms, s.end_ms]);
  const bS = scoreKey(key, bSkip); const bG = scoreKey(key, bSkip, { window: 'gap' });
  const aS = scoreKey(key, aSkip, { liveDb: bSkip });
  const rules = full.items.filter((i) => i.source === 'codex-rules' && i.mappable && Number.isFinite(i.start_ms));
  const inU = (u) => (i) => shareInside(i.start_ms, i.end_ms, u) >= 0.5;
  films.push({ slug, v10_ran: ran, should_flag_mapped: bS.recall_items.of,
    live: { recall_strict: bS.recall_items.found, recall_gap: bG.recall_items.found, precision: `${bS.precision_proxy_ref_only}/${bG.precision_proxy_ref_only}`, skip_minutes: bS.skip_minutes, wordless: allWordless(key, bSkip), rules_villain: `${rules.filter((i) => i.marker === 'villain_threat').filter(inU(union(bSkip))).length}/${rules.filter((i) => i.marker === 'villain_threat').length}`, rules_child: `${rules.filter((i) => i.marker === 'child_terrified').filter(inU(union(bSkip))).length}/${rules.filter((i) => i.marker === 'child_terrified').length}` },
    v10: { recall_strict: aS.recall_items.found, skip_minutes: aS.skip_minutes, wordless: allWordless(key, aSkip) } });
  pool.a.push(...aSkip.map(([x, y]) => [x + off, y + off])); pool.b.push(...bSkip.map(([x, y]) => [x + off, y + off]));
  for (const it of key.items) { const o = { ...it, id: `${slug}:${it.id}`, same_moment_as: (it.same_moment_as ?? []).map((x) => `${slug}:${x}`) }; for (const f of ['start_ms', 'end_ms', 'gap_start_ms', 'gap_end_ms']) if (Number.isFinite(it[f])) o[f] = it[f] + off; pool.items.push(o); }
});
const pk = { items: pool.items, film_level: [] };
const PA = scoreKey(pk, pool.a, { liveDb: pool.b }); const PAg = scoreKey(pk, pool.a, { liveDb: pool.b, window: 'gap' });
const PB = scoreKey(pk, pool.b); const PBg = scoreKey(pk, pool.b, { window: 'gap' });
const sens = sensitivity(pk, pool.a, pool.b);
const verdict = compareSystems({ aStrict: PA, aGap: PAg, bStrict: PB, bGap: PBg, sens });
const out = { generated_at: new Date().toISOString(), note: 'v10 skip is empty on films whose segmentation was rejected (frozen config)', films,
  pooled: { v10: { recall: `${PA.recall_items.found}/${PA.recall_items.of}`, precision: `${PA.precision_proxy_ref_only}/${PAg.precision_proxy_ref_only}`, skip: PA.skip_minutes }, live: { recall: `${PB.recall_items.found}/${PB.recall_items.of}`, precision: `${PB.precision_proxy_ref_only}/${PBg.precision_proxy_ref_only}`, skip: PB.skip_minutes }, verdict: { recall: verdict.recall, precision: verdict.precision, overall: verdict.overall, conservative: verdict.conservative_recall }, jitter: { recall: sens.recall_diff_a_minus_b, precision: sens.precision_diff_a_minus_b } } };
fs.writeFileSync(path.join(V8, 'round6', 'out', 'asrun.json'), JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 1));
