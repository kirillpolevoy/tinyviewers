// Verifier's independent re-scoring (no model calls). Own interval code; does not import refscore.js.
// Adds: chance baselines (cyclic shift of each system's own skip spans), equal-minute comparison
// (v6 flagged scenes ranked by severity, cut to the live DB's minutes), gap-window sensitivity,
// moment-level (deduplicated) recall. Writes verify/out/score.json (git-ignored).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as L from '../../../../scene-api/load.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const V6 = path.resolve(HERE, '..');
const TS = path.resolve(V6, '..');
const OUT = path.join(V6, 'out');
const FILMS = (process.argv[2] ?? 'frankenweenie,wild-robot,nemo,monsters-inc,lion-king').split(',');
const rj = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const r3 = (x) => (x == null ? null : Math.round(x * 1000) / 1000);

function U(sp) {
  const s = sp.filter((x) => x[1] > x[0]).map((x) => [x[0], x[1]]).sort((a, b) => a[0] - b[0]);
  const o = [];
  for (const [a, b] of s) { const l = o[o.length - 1]; if (l && a <= l[1]) l[1] = Math.max(l[1], b); else o.push([a, b]); }
  return o;
}
const len = (u) => u.reduce((t, [a, b]) => t + b - a, 0);
function ov(u, a, b) { let t = 0; for (const [c, d] of u) t += Math.max(0, Math.min(b, d) - Math.max(a, c)); return t; }
const inside = (u, a, b) => (b > a ? ov(u, a, b) / (b - a) : u.some(([c, d]) => a >= c && a <= d) ? 1 : 0);

// seeded PRNG
let seed = 12345;
const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);

const ctx = await L.openExperiment(TS);
const v2map = L.buildV2Map(ctx.taxonomy);
const vocabIds = new Set(L.buildVocabulary(ctx.taxonomy).items.map((i) => i.id));

function srtEnd(slug) {
  const t = fs.readFileSync(path.join(TS, 'data', `${slug}.srt`), 'utf8');
  const m = [...t.matchAll(/(\d\d):(\d\d):(\d\d)[,.](\d{3})\s*-->\s*(\d\d):(\d\d):(\d\d)[,.](\d{3})/g)];
  const last = m[m.length - 1];
  return ((+last[5] * 60 + +last[6]) * 60 + +last[7]) * 1000 + +last[8];
}

function clusters(items) {
  const p = new Map(items.map((i) => [i.id, i.id]));
  const f = (x) => { while (p.get(x) !== x) x = p.get(x); return x; };
  for (const i of items) for (const o of i.same_moment_as ?? []) if (p.has(o)) p.set(f(i.id), f(o));
  const g = new Map();
  for (const i of items) { const r = f(i.id); if (!g.has(r)) g.set(r, []); g.get(r).push(i); }
  return [...g.values()];
}

function score(key, skipU, { gap = false } = {}) {
  const mapped = key.items.filter((i) => i.mappable && Number.isFinite(i.start_ms));
  const span = (i) => (gap ? [i.gap_start_ms ?? i.start_ms, i.gap_end_ms ?? i.end_ms] : [i.start_ms, i.end_ms]);
  const found = (i) => inside(skipU, ...span(i)) >= 0.5;
  const sf = mapped.filter((i) => i.should_flag === true);
  const to = mapped.filter((i) => i.should_flag === 'tag_only');
  const nf = mapped.filter((i) => i.should_flag === false);
  const cl = clusters(key.items).filter((c) => c.some((i) => i.should_flag === true) && c.some((i) => i.mappable && Number.isFinite(i.start_ms)));
  const clFound = cl.filter((c) => c.filter((i) => i.mappable && Number.isFinite(i.start_ms)).some(found));
  const refU = U(mapped.map((i) => [i.start_ms, i.end_ms]));
  const sfU = U(sf.map((i) => [i.start_ms, i.end_ms]));
  const sk = len(skipU);
  return {
    skip_min: r3(sk / 60000),
    recall_items: `${sf.filter(found).length}/${sf.length}`, recall_items_n: sf.filter(found).length, sf_n: sf.length,
    recall_moments: `${clFound.length}/${cl.length}`, recall_moments_n: clFound.length, mom_n: cl.length,
    tag_only_in_skip: `${to.filter(found).length}/${to.length}`,
    should_not_flag_in_skip: `${nf.filter(found).length}/${nf.length}`,
    precision_any_ref: sk ? r3(ov2(skipU, refU) / sk) : null,
    precision_should_flag_ref: sk ? r3(ov2(skipU, sfU) / sk) : null,
    missed: sf.filter((i) => !found(i)).map((i) => i.id),
  };
}
function ov2(a, b) { let t = 0; for (const [x, y] of b) t += ov(a, x, y); return t; }

function shift(u, d, end) {
  const o = [];
  for (const [a, b] of u) {
    let s = (a + d) % end, e = s + (b - a);
    if (e <= end) o.push([s, e]); else { o.push([s, end]); o.push([0, e - end]); }
  }
  return U(o);
}
function chance(key, skipU, end, n = 500) {
  const r = [], m = [], p = [];
  for (let k = 0; k < n; k++) {
    const s = score(key, shift(skipU, Math.floor(rnd() * end), end));
    r.push(s.recall_items_n); m.push(s.recall_moments_n); p.push(s.precision_should_flag_ref);
  }
  const mean = (x) => x.reduce((a, b) => a + b, 0) / x.length;
  const q = (x, f) => [...x].sort((a, b) => a - b)[Math.floor(f * (x.length - 1))];
  return { recall_items_mean: r3(mean(r)), recall_items_p95: q(r, 0.95), recall_moments_mean: r3(mean(m)), precision_sf_mean: r3(mean(p)) };
}

const result = {};
for (const slug of FILMS) {
  const key = rj(path.join(TS, 'refs', `${slug}.key.json`));
  const tags = rj(path.join(OUT, `${slug}.tags.r1.json`));
  const end = srtEnd(slug);
  const flagged = tags.scenes.filter((s) => s.flagged);
  const v6U = U(flagged.flatMap((s) => (s.skip?.spans ?? []).map((x) => [x.start_ms, x.end_ms])));
  const v6ScU = U(flagged.map((s) => [s.start_ms, s.end_ms]));
  const inputs = L.readFilmInputs(slug, ctx);
  const built = L.buildFilmFrom(inputs, { srt: ctx.srt, v2map, vocabIds });
  const dbU = U(built.scenes.map((s) => [s.start_ms, s.end_ms]));

  // equal-minute: v6 flagged scenes' skip spans ranked by severity (then max flag p), cut at live-DB minutes
  const sev = (s) => [s.severity?.['5-7']?.score ?? 0, Math.max(0, ...(s.flag_reasons ?? []).map((r) => r.p ?? 0))];
  const ranked = [...flagged].sort((a, b) => { const x = sev(a), y = sev(b); return y[0] - x[0] || y[1] - x[1]; });
  const budget = len(dbU);
  let acc = [];
  for (const s of ranked) {
    const next = U([...acc, ...(s.skip?.spans ?? []).map((x) => [x.start_ms, x.end_ms])]);
    if (len(next) > budget * 1.02) continue;
    acc = next;
  }
  result[slug] = {
    held_out: !!key.held_out,
    film_min: r3(end / 60000),
    ref_should_flag_share_of_film: r3(len(U(key.items.filter((i) => i.mappable && i.should_flag === true && Number.isFinite(i.start_ms)).map((i) => [i.start_ms, i.end_ms]))) / end),
    ref_any_share_of_film: r3(len(U(key.items.filter((i) => i.mappable && Number.isFinite(i.start_ms)).map((i) => [i.start_ms, i.end_ms]))) / end),
    v6_skip: score(key, v6U), v6_skip_gapwindow: score(key, v6U, { gap: true }), v6_flagged_scenes: score(key, v6ScU),
    live_db: score(key, dbU), live_db_gapwindow: score(key, dbU, { gap: true }),
    v6_cut_to_live_db_minutes: score(key, acc),
    chance_v6_skip: chance(key, v6U, end), chance_live_db: chance(key, dbU, end),
    severity_example: sev(ranked[0]), severity_raw_example: ranked[0]?.severity,
  };
}
fs.mkdirSync(path.join(HERE, 'out'), { recursive: true });
fs.writeFileSync(path.join(HERE, 'out', 'score.json'), JSON.stringify(result, null, 1));
for (const [f, r] of Object.entries(result)) {
  const l = (n, s) => console.log(`  ${n.padEnd(22)} skip ${String(s.skip_min).padStart(6)}m items ${s.recall_items.padStart(5)} mom ${s.recall_moments.padStart(5)} tagonly ${s.tag_only_in_skip} notflag ${s.should_not_flag_in_skip} prec(any) ${s.precision_any_ref} prec(sf) ${s.precision_should_flag_ref}`);
  console.log(`${f}${r.held_out ? ' [HELD OUT]' : ''} film ${r.film_min}m; should_flag ref covers ${r.ref_should_flag_share_of_film} of film, any ref ${r.ref_any_share_of_film}`);
  l('v6 skip', r.v6_skip); l('v6 skip (gap window)', r.v6_skip_gapwindow); l('v6 flagged scenes', r.v6_flagged_scenes);
  l('live DB', r.live_db); l('live DB (gap window)', r.live_db_gapwindow); l('v6 cut to DB minutes', r.v6_cut_to_live_db_minutes);
  console.log(`  chance v6 (shifted)    items mean ${r.chance_v6_skip.recall_items_mean} p95 ${r.chance_v6_skip.recall_items_p95}; prec(sf) ${r.chance_v6_skip.precision_sf_mean}`);
  console.log(`  chance DB (shifted)    items mean ${r.chance_live_db.recall_items_mean} p95 ${r.chance_live_db.recall_items_p95}; prec(sf) ${r.chance_live_db.precision_sf_mean}`);
  console.log(`  missed v6: ${r.v6_skip.missed.join(',')} | missed DB: ${r.live_db.missed.join(',')} | sev ex ${JSON.stringify(r.severity_raw_example)}`);
}
