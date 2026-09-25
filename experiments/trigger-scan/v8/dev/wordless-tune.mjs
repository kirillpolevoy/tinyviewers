#!/usr/bin/env node
// Dev-only tuning of fix (a), policy wordless.extend. No model calls. Flags held fixed (the saved
// <out>/<slug>.tags.r1.json flagged set); every flagged scene is re-spanned offline from its SAVED
// moment answers (moments.js respanScenes) under each variant, then scored on the dev human keys
// (out/refs-human) with refscore.js: conservative recall, should_flag-only precision (strict / gap),
// tag-only, skip minutes, and parent check (i) (wordless should_flag items inside flagged scenes with
// >= 80% of their span inside the skip).
//   node dev/wordless-tune.mjs [--films a,b] [--out out]   -> out/dev/wordless-tune.json
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSrt } from '../../srt.js';
import { loadPolicy, selectRun } from '../select.js';
import { respanScenes } from '../moments.js';
import { scoreKey, union, shareInside } from '../refscore.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const V8 = path.resolve(here, '..');
const TS = path.resolve(V8, '..');
const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const FILMS = opt('films', 'nemo,monsters-inc,lion-king,frankenweenie,wild-robot,iron-giant,up').split(',');
const OUT = path.resolve(V8, opt('out', 'out'));
const rj = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const deepMerge = (a, b) => { const o = structuredClone(a); for (const [k, v] of Object.entries(b)) o[k] = v && typeof v === 'object' && !Array.isArray(v) ? deepMerge(o[k] ?? {}, v) : v; return o; };

export function checkWordless(key, flaggedScenes, skip) {
  const U = union(skip);
  const rows = [];
  for (const it of key.items.filter((i) => i.mappable && Number.isFinite(i.start_ms) && i.should_flag === true && i.wordless)) {
    const sc = flaggedScenes.find((s) => shareInside(it.start_ms, it.end_ms, [[s.start_ms, s.end_ms]]) >= 0.5);
    if (!sc) continue;
    rows.push({ id: it.id, scene: sc.id, share: Math.round(shareInside(it.start_ms, it.end_ms, U) * 1000) / 1000 });
  }
  return { n: rows.length, ok: rows.filter((r) => r.share >= 0.8).length, miss: rows.filter((r) => r.share < 0.8) };
}

const E = (max_ms, min_silence_share, big_gap_ms) => ({ wordless: { extend: { max_ms, min_silence_share, big_gap_ms } } });
const VARIANTS = { v7_rule: {} };
for (const mx of [45000, 60000, 75000, 90000]) for (const sh of [0.5, 0.6, 0.7]) for (const g of [8000, 10000, 15000]) VARIANTS[`ext_${mx / 1000}_${sh}_${g / 1000}`] = E(mx, sh, g);

const base = loadPolicy();
delete base.wordless.extend;
const res = {};
const totals = {};
for (const slug of FILMS) {
  const key = rj(path.join(OUT, 'refs-human', `${slug}.key.json`));
  const run = rj(path.join(OUT, `${slug}.jev.r1.json`));
  const saved = rj(path.join(OUT, `${slug}.moments.r1.json`));
  const asrun = rj(path.join(OUT, `${slug}.tags.r1.json`));
  const cues = parseSrt(fs.readFileSync(path.join(TS, 'data', `${slug}.srt`), 'utf8'));
  const flaggedIds = new Set(asrun.scenes.filter((s) => s.flagged).map((s) => s.id));
  res[slug] = {};
  const score = (skip, flagged) => {
    const s = scoreKey(key, skip); const g = scoreKey(key, skip, { window: 'gap' });
    const w = checkWordless(key, flagged, skip);
    return { cons: Math.min(s.recall_items.found, g.recall_items.found), of: s.recall_items.of, prec_s: s.precision_proxy_ref_only, prec_g: g.precision_proxy_ref_only, tag: s.tag_only.flagged, skip: s.skip_minutes, wl_ok: w.ok, wl_n: w.n, wl_miss: w.miss.map((m) => `${m.id}:${m.share}`) };
  };
  const asrunSkip = asrun.scenes.filter((s) => s.flagged).flatMap((s) => (s.skip?.spans ?? []).map((x) => [x.start_ms, x.end_ms]));
  res[slug].as_run = score(asrunSkip, asrun.scenes.filter((s) => s.flagged));
  for (const [name, ov] of Object.entries(VARIANTS)) {
    const cfg = deepMerge(base, ov);
    const tags0 = selectRun(run, cfg, { cues });
    if (tags0.scenes.filter((s) => s.flagged).map((s) => s.id).join() !== [...flaggedIds].join()) throw new Error(`${slug}: flagged set differs from the saved tags`);
    const scenes = respanScenes({ tags: tags0, saved, cues, items: run.film_items ?? [], cfg });
    const tags = selectRun(run, cfg, { moments: { scenes }, cues });
    const flagged = tags.scenes.filter((s) => s.flagged);
    res[slug][name] = score(flagged.flatMap((s) => (s.skip?.spans ?? []).map((x) => [x.start_ms, x.end_ms])), flagged);
  }
}
for (const name of ['as_run', ...Object.keys(VARIANTS)]) {
  const t = { cons: 0, of: 0, tag: 0, skip: 0, wl_ok: 0, wl_n: 0, prec_s: 0, prec_g: 0 };
  for (const slug of FILMS) { const r = res[slug][name]; for (const k of ['cons', 'of', 'tag', 'skip', 'wl_ok', 'wl_n']) t[k] += r[k]; t.prec_s += r.prec_s / FILMS.length; t.prec_g += r.prec_g / FILMS.length; }
  totals[name] = { ...t, skip: +t.skip.toFixed(2), prec_s: +t.prec_s.toFixed(3), prec_g: +t.prec_g.toFixed(3) };
}
fs.mkdirSync(path.join(OUT, 'dev'), { recursive: true });
fs.writeFileSync(path.join(OUT, 'dev', 'wordless-tune.json'), JSON.stringify({ generated_at: new Date().toISOString(), variants: VARIANTS, totals, films: res }, null, 1));
console.log('variant'.padEnd(20), 'cons', 'tag', 'skip', 'wl(i)', 'prec s/g (mean)');
for (const [n, t] of Object.entries(totals)) console.log(n.padEnd(20), `${t.cons}/${t.of}`, t.tag, t.skip, `${t.wl_ok}/${t.wl_n}`, `${t.prec_s}/${t.prec_g}`);
if (argv.includes('--films-detail')) for (const slug of FILMS) { console.log(`\n${slug}`); for (const n of (opt('show', 'as_run,v7_rule')).split(',')) { const r = res[slug][n]; console.log(`  ${n.padEnd(20)} cons ${r.cons}/${r.of} prec ${r.prec_s}/${r.prec_g} tag ${r.tag} skip ${r.skip} wl ${r.wl_ok}/${r.wl_n} miss ${r.wl_miss.join(' ')}`); } }
