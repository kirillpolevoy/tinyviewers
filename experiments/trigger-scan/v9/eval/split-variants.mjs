#!/usr/bin/env node
// SENSITIVITY of the split decision (evaluation only; pure code, no model calls). Re-selects every
// dev film under alternative splits from answers already on disk -- Jev: v8's saved answers (every
// question; the trim drift is ~0.3% of answers crossing 0.7, dev/trim-drift.mjs), Sonnet: v9's
// sonnetq answers (every contested question) -- and scores flags on the human keys.
// Skip = WHOLE flagged scenes (with the wordless lead-in) for EVERY variant, because moment spans exist
// only for the flag reasons that were actually run; so absolute recall / precision differ from
// eval/v8-v9.mjs, but the variants are compared on equal terms.
//   none      v8: Jev answers everything
//   decided   split.json (one-count tolerance, thin -> group)
//   strict    zero tolerance (every stage-B question where Jev is worse on either metric -> Sonnet)
//   group     stage-B group verdicts applied to every asked question of the group
//   asked     all 43 contested questions -> Sonnet
//   node eval/split-variants.mjs  -> out/eval/split-variants.json
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSrt } from '../../srt.js';
import { selectRun, loadPolicy } from '../select.js';
import { scoreKey, sensitivity, compareSystems } from '../refscore.js';
import { ITEMS } from '../questions.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const V9 = path.resolve(here, '..'); const TS = path.resolve(V9, '..');
const rj = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const FILMS = ['nemo', 'monsters-inc', 'lion-king', 'frankenweenie', 'wild-robot', 'iron-giant', 'up', 'tangled', 'coco', 'how-to-train-your-dragon'];
const cfg = loadPolicy();
const split = rj(path.join(V9, 'split.json'));
const B = rj(path.join(V9, 'split', 'stage-b.json'));
const asked = split.sonnet_asked;
const strict = asked.filter((q) => !split.evidence[q].thin ? split.evidence[q].strict_verdict === 'sonnet' : split.assign[q] === 'sonnet');
const group = asked.filter((q) => B.groups[ITEMS[q].group] && split.groups_stage_b[ITEMS[q].group].model === 'sonnet');
const VARIANTS = { none: [], decided: split.sonnet_used, strict, group, asked };

const pool = Object.fromEntries(Object.keys(VARIANTS).map((v) => [v, { skip: [], flagged: 0, sonnet_only: 0 }]));
const items = [];
FILMS.forEach((slug, k) => {
  const off = k * 1e8;
  const run = rj(path.join(TS, 'v8', 'out', `${slug}.jev.r1.json`));
  const sonnet = rj(path.join(V9, 'out', `${slug}.sonnetq.r1.json`));
  const cues = parseSrt(fs.readFileSync(path.join(TS, 'data', `${slug}.srt`), 'utf8'));
  for (const [v, used] of Object.entries(VARIANTS)) {
    const out = selectRun(run, cfg, { cues, sonnet, used });
    const fl = out.scenes.filter((s) => s.flagged);
    pool[v].flagged += fl.length;
    pool[v].sonnet_only += fl.filter((s) => s.flag_reasons.every((r) => used.includes(r.id))).length;
    pool[v].skip.push(...fl.flatMap((s) => s.skip.spans.map((x) => [x.start_ms + off, x.end_ms + off])));
  }
  const key = rj(path.join(TS, 'refs', `${slug}.key.json`));
  const pid = (id) => `${slug}:${id}`;
  for (const it of key.items.filter((i) => i.source !== 'codex-rules')) { const o = { ...it, id: pid(it.id), same_moment_as: (it.same_moment_as ?? []).map(pid) }; for (const f of ['start_ms', 'end_ms', 'gap_start_ms', 'gap_end_ms']) if (Number.isFinite(it[f])) o[f] = it[f] + off; items.push(o); }
});
const K = { items, film_level: [] };
const res = {};
for (const [v, p] of Object.entries(pool)) {
  const s = scoreKey(K, p.skip); const g = scoreKey(K, p.skip, { window: 'gap' });
  res[v] = { sonnet_questions: VARIANTS[v].length, flagged: p.flagged, flagged_only_by_sonnet: p.sonnet_only, recall: `${Math.min(s.recall_items.found, g.recall_items.found)}/${s.recall_items.of}`, precision_strict: s.precision_proxy_ref_only, precision_gap: g.precision_proxy_ref_only, skip_minutes: s.skip_minutes, tag_only_flagged: `${s.tag_only.flagged}/${s.tag_only.items}` };
}
// decided vs each other variant (jitter verdict)
const cmp = {};
for (const v of ['none', 'strict', 'group', 'asked']) {
  const a = pool.decided.skip; const b = pool[v].skip;
  const sens = sensitivity(K, a, b);
  const vv = compareSystems({ aStrict: scoreKey(K, a), aGap: scoreKey(K, a, { window: 'gap' }), bStrict: scoreKey(K, b), bGap: scoreKey(K, b, { window: 'gap' }), sens });
  cmp[`decided_vs_${v}`] = { recall: vv.recall, precision: vv.precision, conservative_recall: vv.conservative_recall, jitter_recall_decided_gt: sens.recall_diff_a_minus_b.share_a_gt_b, jitter_recall_decided_lt: sens.recall_diff_a_minus_b.share_a_lt_b, jitter_precision_decided_gt: sens.precision_diff_a_minus_b.share_a_gt_b, jitter_precision_decided_lt: sens.precision_diff_a_minus_b.share_a_lt_b };
}
const out = { generated_at: new Date().toISOString(), note: 'whole-scene skips for every variant (see header)', variants: Object.fromEntries(Object.entries(VARIANTS).map(([k, v]) => [k, v])), results: res, compare: cmp };
fs.mkdirSync(path.join(V9, 'out', 'eval'), { recursive: true });
fs.writeFileSync(path.join(V9, 'out', 'eval', 'split-variants.json'), JSON.stringify(out, null, 2));
for (const [v, r] of Object.entries(res)) console.log(`${v.padEnd(8)} ${JSON.stringify(r)}`);
for (const [k, c] of Object.entries(cmp)) console.log(`${k.padEnd(18)} ${JSON.stringify(c)}`);
