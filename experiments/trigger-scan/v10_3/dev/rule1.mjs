#!/usr/bin/env node
// v10.2 RULE-1 QUESTION MEASUREMENT (16 seen films, IN-SAMPLE; the Jev answers resolve.js --r1 wrote to out102/dev;
// no model calls). "In `scene`, does a character say that they will kill or hurt another character?"
// TIER-A TEST (written before this script was first run; the tournament's tier-A rule, split.json):
//   the tournament method (v10/assemble/score-lib.mjs evalFilm): a scene FIRES at t when p >= t; it is a HIT when it
//   overlaps a human key item whose categories include the concept's group ('hostility', as threatens_harm);
//   precision = hits / fires; recall = hostility items overlapped by a firing scene / hostility items.
//   Tier A = precision >= 0.70 on >= 4 fires, and >= 0.60 on the magic films (coco, book-of-life,
//   princess-and-the-frog) when it fires there. Thresholds tried: 0.6, 0.7, 0.8 (the tournament's grid); the lowest
//   passing one is used. If none passes, the question is NOT used (policy flag.rule1_question.enabled false).
// Also reported (not part of the test): the same numbers for v10's tier-B threatens_harm (combined Jev answer at its
// 0.6 threshold) on the 13 tournament films -- a check that this reproduces the tournament's 17/52 -- and recall of
// the clean codex-rules villain_threat items by the firing scenes.
//   node dev/rule1.mjs -> dev/out/rule1.json + a table
import fs from 'node:fs';
import path from 'node:path';
import { withConcepts } from '../select.js';
import { FILMS as F13 } from '../../v10/assemble/score-lib.mjs';
import { FILMS, loadFilm, resolveFile, rj, V102, TS } from '../eval/seen-lib.mjs';

const G13 = new Set(['creatures_figures', 'objects_hazards', 'peril', 'violence', 'death', 'separation', 'injury', 'captivity', 'eerie', 'hostility', 'distress', 'animals', 'copyable']);
const MAGIC = ['coco', 'book-of-life', 'princess-and-the-frog'];
const GROUP = 'hostility';
const overlaps = (s, w) => Math.min(s.end_ms, w[1]) - Math.max(s.start_ms, w[0]) > 0;
function keyItems(fullKey) {
  return fullKey.items.filter((i) => i.source !== 'codex-rules' && i.human_written !== false && i.mappable && Number.isFinite(i.start_ms) && Number.isFinite(i.end_ms))
    .map((i) => ({ id: i.id, cats: (i.categories ?? []).filter((c) => G13.has(c)), w: [Number.isFinite(i.gap_start_ms) ? Math.min(i.start_ms, i.gap_start_ms) : i.start_ms, Number.isFinite(i.gap_end_ms) ? Math.max(i.end_ms, i.gap_end_ms) : i.end_ms] }))
    .filter((i) => i.cats.length);
}
const films = FILMS.map((slug) => {
  const f = loadFilm(slug);
  const rv = rj(resolveFile(slug));
  const scenes = f.seg.scenes.map((s) => {
    const row = f.rows.find((r) => r.id === s.id);
    const c = row?.answers ? withConcepts(row.answers, f.items).c ?? {} : {};
    return { id: s.id, start_ms: s.start_ms, end_ms: s.end_ms, r1: rv.scenes?.[s.id]?.r1 ?? null, th: c.threatens_harm ?? null };
  });
  const auditFalse = new Set((rj(path.join(TS, 'refs', 'audits.json'))[slug] ?? []).filter((a) => a.rule_applies === false).map((a) => a.id));
  const villain = f.fullKey.items.filter((i) => i.source === 'codex-rules' && i.marker === 'villain_threat' && i.mappable && Number.isFinite(i.start_ms) && !i.played_for_laughs && !auditFalse.has(i.id));
  return { slug, scenes, items: keyItems(f.fullKey), villain };
});
function evalQ(get, t, list) {
  let fires = 0; let hits = 0; let items = 0; const caught = new Set(); let vN = 0; const vCaught = new Set(); let vFires = 0;
  const fired = [];
  for (const F of list) {
    const grp = F.items.filter((i) => i.cats.includes(GROUP)); items += grp.length; vN += F.villain.length;
    for (const s of F.scenes) {
      const p = get(s); if (p == null || p < t) continue;
      fires++;
      const ov = grp.filter((i) => overlaps(s, i.w));
      if (ov.length) hits++;
      ov.forEach((i) => caught.add(`${F.slug}:${i.id}`));
      const vv = F.villain.filter((i) => overlaps(s, [i.start_ms, i.end_ms])); if (vv.length) vFires++;
      vv.forEach((i) => vCaught.add(`${F.slug}:${i.id}`));
      fired.push(`${F.slug}:${s.id}${ov.length ? '' : ' (miss)'}`);
    }
  }
  const r3 = (x) => Math.round(x * 1000) / 1000;
  return { t, fires, hits, precision: fires ? r3(hits / fires) : null, recall: `${caught.size}/${items}`, recall_p: items ? r3(caught.size / items) : null, villain_items_overlapped: `${vCaught.size}/${vN}`, villain_precision: fires ? r3(vFires / fires) : null, fired };
}
const rows = [];
for (const t of [0.6, 0.7, 0.8]) {
  const all = evalQ((s) => s.r1, t, films);
  const magic = evalQ((s) => s.r1, t, films.filter((F) => MAGIC.includes(F.slug)));
  const tierA = all.fires >= 4 && all.precision >= 0.7 && (magic.fires === 0 || magic.precision >= 0.6);
  rows.push({ question: 'r1', t, all, magic: { fires: magic.fires, hits: magic.hits, precision: magic.precision }, tier_a: tierA });
}
const check = evalQ((s) => s.th, 0.6, films.filter((F) => F13.includes(F.slug)));
const th16 = evalQ((s) => s.th, 0.6, films);
const pick = rows.find((r) => r.tier_a) ?? null;
const out = { generated_at: new Date().toISOString(), label: 'DEV-ONLY, IN-SAMPLE (16 seen films): rule-1 question vs the tournament tier-A rule', rows, v10_threatens_harm_13_films_at_06: { fires: check.fires, hits: check.hits, precision: check.precision, recall: check.recall }, v10_threatens_harm_16_films_at_06: { fires: th16.fires, hits: th16.hits, precision: th16.precision, recall: th16.recall, villain_items_overlapped: th16.villain_items_overlapped }, decision: pick ? { enabled: true, min_p: pick.t } : { enabled: false } };
fs.mkdirSync(path.join(V102, 'dev', 'out'), { recursive: true });
fs.writeFileSync(path.join(V102, 'dev', 'out', 'rule1.json'), JSON.stringify(out, null, 2));
console.log(out.label);
for (const r of rows) console.log(`r1 @${r.t}: fires ${r.all.fires} hits ${r.all.hits} precision ${r.all.precision} recall ${r.all.recall} | magic ${r.magic.hits}/${r.magic.fires} | villain items ${r.all.villain_items_overlapped} (villain prec ${r.all.villain_precision}) | TIER A ${r.tier_a}`);
console.log(`check: v10 threatens_harm @0.6 on the 13 tournament films ${check.hits}/${check.fires} (tournament: 17/52), recall ${check.recall}; 16 films ${th16.hits}/${th16.fires} villain ${th16.villain_items_overlapped}`);
console.log(`DECISION: ${JSON.stringify(out.decision)}`);
for (const r of rows) console.log(`  fired @${r.t}: ${r.all.fired.join(', ')}`);
