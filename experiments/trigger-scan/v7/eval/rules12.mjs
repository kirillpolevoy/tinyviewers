#!/usr/bin/env node
// Round-3 evaluation only (not pipeline, not frozen): policy rules 1 (villain threat) and 2 (child
// terrified) on the held-out films, scored against the key's Codex rule items (refs/<slug>.key.json,
// source 'codex-rules', human_written false). No model calls. Writes out/eval/rules12.json.
//   precision: of v7 scenes flagged ONLY by rule-1/2 reasons (compare.js definition), the share whose
//              skip spans (or, looser, scene span) contain >= 50% of a Codex rule item
//   recall:    Codex rule items >= 50% inside v7 skip spans / flagged scenes / live-DB scenes
// Variants: all items; marker-matched; 'clean' = excluding played_for_laughs items and the two items
// the key builder's audit judged rule-false (iron-giant C02, up C07).
import fs from 'node:fs';
import path from 'node:path';
import * as L from '../../../../scene-api/load.js';
import { V7, TS } from '../env.js';
import { union, shareInside } from '../refscore.js';

const OUT = path.join(V7, 'out');
const FILMS = (process.argv[2] ?? 'iron-giant,up').split(',');
const AUDIT_FALSE = new Set(['iron-giant:C02', 'up:C07']);
const R1 = (id) => ['threatens_harm', 'plots_harm'].includes(id) || /_threatens$/.test(id);
const R2 = (id) => id === 'child_frightened';
const hms = (ms) => new Date(ms).toISOString().slice(11, 19);
const ctx = await L.openExperiment(TS);
const v2map = L.buildV2Map(ctx.taxonomy);
const vocabIds = new Set(L.buildVocabulary(ctx.taxonomy).items.map((i) => i.id));
const liveDb = (slug) => { try { const b = L.buildFilmFrom(L.readFilmInputs(slug, ctx), { srt: ctx.srt, v2map, vocabIds }); return b.scenes.map((s) => [s.start_ms, s.end_ms]); } catch { return null; } };

const result = {};
for (const slug of FILMS) {
  const key = JSON.parse(fs.readFileSync(path.join(TS, 'refs', `${slug}.key.json`), 'utf8'));
  const items = key.items.filter((i) => i.source === 'codex-rules' && i.mappable && Number.isFinite(i.start_ms));
  const clean = (i) => !i.played_for_laughs && !AUDIT_FALSE.has(`${slug}:${i.id}`);
  const tags = JSON.parse(fs.readFileSync(path.join(OUT, `${slug}.tags.r1.json`), 'utf8'));
  const flagged = tags.scenes.filter((s) => s.flagged);
  const spansOf = (s) => (s.skip?.spans ?? []).map((x) => [x.start_ms, x.end_ms]);
  const inside = (i, u) => shareInside(i.start_ms, i.end_ms, u) >= 0.5;
  const ruleOnly = flagged.filter((s) => s.flag_reasons.length && s.flag_reasons.every((r) => R1(r.id) || R2(r.id)));
  const rows = ruleOnly.map((s) => {
    const rule = s.flag_reasons.every((r) => R1(r.id)) ? 'villain_threat' : s.flag_reasons.every((r) => R2(r.id)) ? 'child_terrified' : 'both';
    const sk = union(spansOf(s)); const sc = [[s.start_ms, s.end_ms]];
    const hit = (pool, u) => pool.filter((i) => inside(i, u)).map((i) => i.id);
    const match = (i) => rule === 'both' || i.marker === rule;
    return {
      scene: s.id, time: `${hms(s.start_ms)}-${hms(s.end_ms)}`, rule, reasons: s.flag_reasons.map((r) => `${r.id}:${r.p}`), skip_s: Math.round((s.skip?.ms ?? 0) / 1000),
      items_in_skip: hit(items, sk), items_in_scene: hit(items, sc),
      matched_in_skip: hit(items.filter(match), sk), matched_in_scene: hit(items.filter(match), sc),
      clean_matched_in_skip: hit(items.filter((i) => match(i) && clean(i)), sk), clean_matched_in_scene: hit(items.filter((i) => match(i) && clean(i)), sc),
    };
  });
  const prec = (k) => `${rows.filter((r) => r[k].length).length}/${rows.length}`;
  const skipU = union(flagged.flatMap(spansOf));
  const flagU = union(flagged.map((s) => [s.start_ms, s.end_ms]));
  const db = liveDb(slug); const dbU = db ? union(db) : null;
  // rule-1/2 reasons anywhere among a flagged scene's reasons (not only rule-only scenes)
  const anyRule = flagged.filter((s) => s.flag_reasons.some((r) => R1(r.id) || R2(r.id))).map((s) => s.id);
  const rec = (pool) => ({ n: pool.length, in_v7_skip: pool.filter((i) => inside(i, skipU)).length, in_v7_flagged_scenes: pool.filter((i) => inside(i, flagU)).length, in_live_db: dbU ? pool.filter((i) => inside(i, dbU)).length : null });
  const itemRows = items.map((i) => ({ id: i.id, marker: i.marker, who: i.who, time: i.time, laughs: !!i.played_for_laughs, audit_false: AUDIT_FALSE.has(`${slug}:${i.id}`), in_v7_skip: inside(i, skipU), in_v7_flagged: inside(i, flagU), in_live_db: dbU ? inside(i, dbU) : null, v7_scene: tags.scenes.find((s) => i.start_ms >= s.start_ms && i.start_ms < s.end_ms)?.id ?? null }));
  result[slug] = {
    codex_rule_items: items.length, clean_items: items.filter(clean).length,
    v7_rule_only_scenes: rows.length, v7_scenes_with_any_rule_reason: anyRule.length,
    precision_rule_only: { any_item_in_skip: prec('items_in_skip'), any_item_in_scene: prec('items_in_scene'), marker_matched_in_skip: prec('matched_in_skip'), marker_matched_in_scene: prec('matched_in_scene'), clean_marker_matched_in_skip: prec('clean_matched_in_skip'), clean_marker_matched_in_scene: prec('clean_matched_in_scene') },
    recall: { all: rec(items), clean: rec(items.filter(clean)), villain_threat: rec(items.filter((i) => i.marker === 'villain_threat')), child_terrified: rec(items.filter((i) => i.marker === 'child_terrified')), clean_villain: rec(items.filter((i) => clean(i) && i.marker === 'villain_threat')), clean_child: rec(items.filter((i) => clean(i) && i.marker === 'child_terrified')) },
    rule_only_rows: rows, item_rows: itemRows,
  };
}
fs.mkdirSync(path.join(OUT, 'eval'), { recursive: true });
fs.writeFileSync(path.join(OUT, 'eval', 'rules12.json'), JSON.stringify(result, null, 2));
for (const [slug, r] of Object.entries(result)) {
  console.log(`\n== ${slug}: ${r.codex_rule_items} codex rule items (${r.clean_items} clean); v7 rule-only scenes ${r.v7_rule_only_scenes}, scenes with any rule-1/2 reason ${r.v7_scenes_with_any_rule_reason}`);
  console.log(' precision', JSON.stringify(r.precision_rule_only));
  console.log(' recall', JSON.stringify(r.recall));
  for (const x of r.rule_only_rows) console.log('  ', x.scene, x.time, x.rule, x.reasons.join(','), `skip ${x.skip_s}s`, 'skip:', x.items_in_skip.join(',') || '-', 'scene:', x.items_in_scene.join(',') || '-', 'clean-matched scene:', x.clean_matched_in_scene.join(',') || '-');
  for (const x of r.item_rows) console.log('   item', x.id, x.marker, x.time, x.laughs ? 'laughs' : '', x.audit_false ? 'AUDIT-FALSE' : '', 'v7skip', x.in_v7_skip, 'v7flag', x.in_v7_flagged, 'db', x.in_live_db, 'scene', x.v7_scene);
}
