#!/usr/bin/env node
// Verifier: sensitivity of the reference-key scores to plausible mapping and labelling errors.
// Read-only on everything; writes only verify/out/sens.json (numbers and ids, no text).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as L from '../../../../scene-api/load.js';
import { scoreKey, union, total, inter } from '../refscore.js';

const V6 = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TS = path.resolve(V6, '..');
const FILMS = ['nemo', 'monsters-inc', 'lion-king', 'frankenweenie', 'wild-robot'];
const readJson = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));

const ctx = await L.openExperiment(TS);
const v2map = L.buildV2Map(ctx.taxonomy);
const vocabIds = new Set(L.buildVocabulary(ctx.taxonomy).items.map((i) => i.id));

// Verifier's judgement of debatable should_flag labels under the user's policy (audit, not a model).
const RELABEL = {
  nemo: { R38: 'tag_only', R37: 'tag_only', R60: 'tag_only', R35: false },
  'monsters-inc': { R12: 'tag_only', R11: 'tag_only', R04: 'tag_only' },
  'lion-king': {},
  frankenweenie: { R43: false, R73: false, R66: false },
  'wild-robot': { R42: false, R105: false, R117: false, R56: false, R92: true },
};

let seed = 12345;
const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };

const out = {};
for (const slug of FILMS) {
  const key = readJson(path.join(TS, 'refs', `${slug}.key.json`));
  const tags = readJson(path.join(V6, 'out', `${slug}.tags.r1.json`));
  const flagged = tags.scenes.filter((s) => s.flagged);
  const v6 = flagged.flatMap((s) => (s.skip?.spans ?? []).map((x) => [x.start_ms, x.end_ms]));
  const v6scenes = flagged.map((s) => [s.start_ms, s.end_ms]);
  const inputs = L.readFilmInputs(slug, ctx);
  const built = L.buildFilmFrom(inputs, { srt: ctx.srt, v2map, vocabIds });
  const db = built.scenes.map((s) => [s.start_ms, s.end_ms]);
  const mk = (items) => ({ ...key, items });
  const sc = (k, skip) => { const r = scoreKey(k, skip); return { rec: r.recall_items.found, of: r.recall_items.of, mom: r.recall_moments.found, momOf: r.recall_moments.of, tag: `${r.tag_only.flagged}/${r.tag_only.items}`, prec: r.precision_proxy_ref_only, min: r.skip_minutes }; };
  const both = (k) => ({ v6: sc(k, v6), db: sc(k, db), v6scenes: sc(k, v6scenes) });
  const res = {};
  res.base = both(key);
  // gap window instead of strict span
  res.gap = both(mk(key.items.map((i) => (i.mappable ? { ...i, start_ms: i.gap_start_ms ?? i.start_ms, end_ms: i.gap_end_ms ?? i.end_ms } : i))));
  // pure shifts
  for (const d of [-30, -15, 15, 30]) res[`shift${d}`] = both(mk(key.items.map((i) => (i.mappable ? { ...i, start_ms: i.start_ms + d * 1000, end_ms: i.end_ms + d * 1000 } : i))));
  // wordless items get a 20 s lead (action before the bracketing cue)
  res.wordless_lead20 = both(mk(key.items.map((i) => (i.mappable && i.wordless ? { ...i, start_ms: i.start_ms - 20000 } : i))));
  // drop low confidence
  res.conf_ge_075 = both(mk(key.items.map((i) => (i.mappable && i.map_confidence < 0.75 ? { ...i, mappable: false } : i))));
  // spans over 90 s truncated to the first 90 s (over-wide items like Nemo R15)
  res.cap90s = both(mk(key.items.map((i) => (i.mappable && i.end_ms - i.start_ms > 90000 ? { ...i, end_ms: i.start_ms + 90000 } : i))));
  // relabel debatable items
  const rl = RELABEL[slug] ?? {};
  res.relabel = both(mk(key.items.map((i) => (i.id in rl ? { ...i, should_flag: rl[i.id] } : i))));
  // per source
  for (const src of ['kids_in_mind', 'plugged_in', 'common_sense_media']) {
    const its = key.items.filter((i) => i.source === src);
    if (its.length) res[`only_${src}`] = both(mk(its));
  }
  // random jitter +-30 s per item, 300 sims: v6 - db recall difference
  const diffs = [];
  const precD = [];
  for (let k = 0; k < 300; k++) {
    const its = key.items.map((i) => { if (!i.mappable) return i; const d = (rnd() * 60 - 30) * 1000; const e = (rnd() * 60 - 30) * 1000; const s = i.start_ms + d; return { ...i, start_ms: s, end_ms: Math.max(s, i.end_ms + e) }; });
    const a = sc(mk(its), v6); const b = sc(mk(its), db);
    diffs.push(a.rec - b.rec); precD.push(a.prec - b.prec);
  }
  diffs.sort((a, b) => a - b); precD.sort((a, b) => a - b);
  const q = (arr, p) => arr[Math.floor(p * (arr.length - 1))];
  res.jitter30 = { recall_diff_v6_minus_db: { p05: q(diffs, 0.05), p50: q(diffs, 0.5), p95: q(diffs, 0.95), share_v6_ge_db: diffs.filter((x) => x >= 0).length / diffs.length }, prec_diff: { p05: +q(precD, 0.05).toFixed(3), p50: +q(precD, 0.5).toFixed(3), p95: +q(precD, 0.95).toFixed(3), share_v6_ge_db: precD.filter((x) => x >= 0).length / precD.length } };
  // precision proxy variants: overlap with should_flag===true items only, and with gap windows of true items
  const pv = (skip, pred, gap) => { const U = union(skip); const R = union(key.items.filter((i) => i.mappable && pred(i)).map((i) => (gap ? [i.gap_start_ms, i.gap_end_ms] : [i.start_ms, i.end_ms]))); return +(inter(U, R) / total(U)).toFixed(3); };
  res.precision_variants = {
    any_item: { v6: pv(v6, () => true), db: pv(db, () => true) },
    true_only: { v6: pv(v6, (i) => i.should_flag === true), db: pv(db, (i) => i.should_flag === true) },
    true_only_gap: { v6: pv(v6, (i) => i.should_flag === true, true), db: pv(db, (i) => i.should_flag === true, true) },
    ref_minutes_any: +(total(union(key.items.filter((i) => i.mappable).map((i) => [i.start_ms, i.end_ms]))) / 60000).toFixed(2),
    ref_minutes_true: +(total(union(key.items.filter((i) => i.mappable && i.should_flag === true).map((i) => [i.start_ms, i.end_ms]))) / 60000).toFixed(2),
  };
  // matched-budget comparison: trim to equal minutes is not possible without ranking; report recall per skip minute
  res.recall_per_min = { v6: +(res.base.v6.rec / res.base.v6.min).toFixed(3), db: +(res.base.db.rec / res.base.db.min).toFixed(3) };
  // label and mapping stats
  const m = key.items.filter((i) => i.mappable);
  res.stats = {
    items: key.items.length, mapped: m.length, unmappable_true: key.items.filter((i) => !i.mappable && i.should_flag === true).length,
    wordless_share_mapped: +(m.filter((i) => i.wordless).length / m.length).toFixed(2),
    median_span_s: (() => { const a = m.map((i) => (i.end_ms - i.start_ms) / 1000).sort((x, y) => x - y); return a[Math.floor(a.length / 2)]; })(),
    spans_over_90s: m.filter((i) => i.end_ms - i.start_ms > 90000).map((i) => `${i.id}:${Math.round((i.end_ms - i.start_ms) / 1000)}s`),
    conf_lt_075_true: m.filter((i) => i.map_confidence < 0.75 && i.should_flag === true).map((i) => i.id),
    labels: { true: key.items.filter((i) => i.should_flag === true).length, tag_only: key.items.filter((i) => i.should_flag === 'tag_only').length, false: key.items.filter((i) => i.should_flag === false).length },
    policy_markers: { villain: key.items.filter((i) => i.policy?.villain_threat).map((i) => i.id), child: key.items.filter((i) => i.policy?.child_terrified).map((i) => i.id), comic: key.items.filter((i) => i.policy?.comic_peril).map((i) => `${i.id}:${i.should_flag}`) },
    cluster_label_conflicts: (() => {
      const byId = new Map(key.items.map((i) => [i.id, i]));
      const c = [];
      for (const i of key.items) for (const o of i.same_moment_as ?? []) { const j = byId.get(o); if (j && j.should_flag !== i.should_flag) c.push(`${i.id}(${i.should_flag})~${o}(${j.should_flag})`); }
      return c;
    })(),
  };
  // DTDD topics with zero votes that are still scored yes/no
  const dt = (key.film_level ?? []).filter((x) => x.source === 'doesthedogdie');
  res.dtdd = { topics: dt.length, answered: dt.filter((x) => x.answer === 'yes' || x.answer === 'no').length, zero_votes_answered: dt.filter((x) => (x.answer === 'yes' || x.answer === 'no') && ((x.votes?.yes ?? 0) + (x.votes?.no ?? 0)) === 0).length, sample: dt.slice(0, 1).map((x) => ({ answer: x.answer, votes: x.votes })) };
  out[slug] = res;
}
fs.writeFileSync(path.join(V6, 'verify', 'out', 'sens.json'), JSON.stringify(out, null, 1));
for (const [slug, r] of Object.entries(out)) {
  console.log(`\n=== ${slug}`);
  for (const k of Object.keys(r)) {
    if (['jitter30', 'precision_variants', 'stats', 'dtdd', 'recall_per_min'].includes(k)) { console.log(k, JSON.stringify(r[k])); continue; }
    const x = r[k];
    console.log(`${k.padEnd(24)} v6 ${x.v6.rec}/${x.v6.of} mom ${x.v6.mom}/${x.v6.momOf} tag ${x.v6.tag} p ${x.v6.prec} | db ${x.db.rec}/${x.db.of} mom ${x.db.mom}/${x.db.momOf} tag ${x.db.tag} p ${x.db.prec} | v6scenes ${x.v6scenes.rec}`);
  }
}
