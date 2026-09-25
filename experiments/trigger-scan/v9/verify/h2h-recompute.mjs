#!/usr/bin/env node
// Round-4 VERIFIER: recompute the held-out head-to-head numbers (v8 vs live) with independent code.
// Shared with the pipeline only: ../../srt.js (parser), fill.js wordlessScenes (region definition, so
// both systems are scored on the same regions) and select.js loadPolicy, and refscore's DTDD_TAGS
// regex table (data only). Interval math, recall, moments, precision, jitter (re-implemented from the
// documented LCG spec), verdict rule, parent checks, rules and DTDD counting are written here.
// No model calls, no network. Prints JSON to stdout; writes verify/out/h2h-recompute.json (numbers only).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSrt } from '../../srt.js';
import { wordlessScenes } from '../fill.js';
import { loadPolicy } from '../select.js';
import { DTDD_TAGS } from '../refscore.js';
import { ITEMS } from '../questions.js';

const V8 = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TS = path.resolve(V8, '..');
const rj = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const r3 = (x) => (x == null ? null : Math.round(x * 1000) / 1000);
const FILMS = ['tangled', 'coco', 'how-to-train-your-dragon'];
const POLICY = loadPolicy();

// ---- own interval helpers ----
function merge(sp) {
  const s = sp.filter((x) => Number.isFinite(x[0]) && Number.isFinite(x[1]) && x[1] >= x[0]).map((x) => [x[0], x[1]]).sort((a, b) => a[0] - b[0]);
  const o = [];
  for (const x of s) { if (o.length && x[0] <= o.at(-1)[1]) o.at(-1)[1] = Math.max(o.at(-1)[1], x[1]); else o.push(x); }
  return o;
}
const len = (u) => u.reduce((a, [x, y]) => a + y - x, 0);
const ovl = (u, a, b) => u.reduce((t, [x, y]) => t + Math.max(0, Math.min(y, b) - Math.max(x, a)), 0);
const interUU = (u, v) => v.reduce((t, [a, b]) => t + ovl(u, a, b), 0);
const share = (u, a, b) => (b <= a ? (u.some(([x, y]) => a >= x && a <= y) ? 1 : 0) : ovl(u, a, b) / (b - a));
const isMapped = (i) => i.mappable && Number.isFinite(i.start_ms) && Number.isFinite(i.end_ms);
const gapWin = (i) => (Number.isFinite(i.gap_start_ms) && Number.isFinite(i.gap_end_ms) ? [Math.min(i.start_ms, i.gap_start_ms), Math.max(i.end_ms, i.gap_end_ms)] : [i.start_ms, i.end_ms]);

function moments(items) {
  const p = new Map(items.map((i) => [i.id, i.id]));
  const f = (x) => (p.get(x) === x ? x : (p.set(x, f(p.get(x))), p.get(x)));
  for (const i of items) for (const o of i.same_moment_as ?? []) if (p.has(o)) p.set(f(i.id), f(o));
  const g = new Map();
  for (const i of items) { const r = f(i.id); if (!g.has(r)) g.set(r, []); g.get(r).push(i); }
  return [...g.values()];
}

function score(items, skip, win = 'strict') {
  const U = merge(skip);
  const span = (i) => (win === 'gap' ? gapWin(i) : [i.start_ms, i.end_ms]);
  const mapped = items.filter(isMapped);
  const sh = new Map(mapped.map((i) => { const [a, b] = span(i); return [i.id, share(U, a, b)]; }));
  const found = (i) => sh.get(i.id) >= 0.5;
  const T = mapped.filter((i) => i.should_flag === true);
  const tag = mapped.filter((i) => i.should_flag === 'tag_only');
  const no = mapped.filter((i) => i.should_flag === false);
  const cl = moments(items).filter((c) => c.some(isMapped) && c.some((i) => i.should_flag === true));
  const refU = merge(T.map(span));
  const sk = len(U);
  return {
    recall: T.filter(found).length, of: T.length,
    mom: cl.filter((c) => c.filter(isMapped).some(found)).length, mom_of: cl.length,
    prec: sk ? r3(interUU(U, refU) / sk) : null, skip_min: r3(sk / 60000),
    tag: `${tag.filter(found).length}/${tag.length}`, false_skipped: `${no.filter(found).length}/${no.length}`,
    missed: T.filter((i) => !found(i)).map((i) => i.id),
  };
}

// jitter: own implementation of the documented rule (LCG seed 12345, 300 runs, +-30 s on each mapped
// item's start and end, end = max(start, end), strict window)
function lcg(seed) { let x = seed; return () => { x = (x * 1103515245 + 12345) % 2147483648; return x / 2147483648; }; }
function jitter(items, A, B, runs = 300) {
  const rnd = lcg(12345); const dR = []; const dP = [];
  for (let n = 0; n < runs; n++) {
    const moved = items.map((i) => { if (!isMapped(i)) return i; const s = i.start_ms + (rnd() * 2 - 1) * 30000; const e = i.end_ms + (rnd() * 2 - 1) * 30000; return { ...i, start_ms: s, end_ms: Math.max(s, e) }; });
    const a = score(moved, A); const b = score(moved, B);
    dR.push(a.recall - b.recall); dP.push((a.prec ?? 0) - (b.prec ?? 0));
  }
  const sh = (d, f) => r3(d.filter(f).length / d.length);
  const q = (d, p) => [...d].sort((x, y) => x - y)[Math.floor(p * (d.length - 1))];
  return { rec_gt: sh(dR, (x) => x > 0), rec_lt: sh(dR, (x) => x < 0), rec_p05: q(dR, 0.05), rec_p95: q(dR, 0.95), prec_gt: sh(dP, (x) => x > 0), prec_lt: sh(dP, (x) => x < 0) };
}
function verdict(aS, aG, bS, bG, j) {
  const cA = Math.min(aS.recall, aG.recall); const cB = Math.min(bS.recall, bG.recall);
  const rec = cA > cB && j.rec_gt >= 0.95 ? 'v8' : cB > cA && j.rec_lt >= 0.95 ? 'live' : 'tie';
  const ps = aS.prec - bS.prec; const pg = aG.prec - bG.prec;
  const prec = ps > 0 && pg > 0 && j.prec_gt >= 0.95 ? 'v8' : ps < 0 && pg < 0 && j.prec_lt >= 0.95 ? 'live' : 'tie';
  return { cons_v8: cA, cons_live: cB, recall: rec, precision: prec };
}

function dtdd(key, idSet, toId = (x) => x) {
  let agree = 0; let scored = 0; let fp = 0; let fn = 0;
  for (const t of key.film_level ?? []) {
    if (t.source !== 'doesthedogdie' || !['yes', 'no'].includes(t.answer)) continue;
    const m = DTDD_TAGS.find(([re]) => re.test(t.text ?? ''));
    if (!m) continue;
    scored++;
    const yes = m[1].some((id) => idSet.has(toId(id)));
    if (yes === (t.answer === 'yes')) agree++; else if (yes) fp++; else fn++;
  }
  return { agree, scored, fp, fn };
}
const ledger = (f) => { try { const l = rj(f); const s = (k) => l.entries.filter((e) => e.kind === k).reduce((a, e) => a + e.usd, 0); return { sonnet: r3(s('sonnet') * 1000) / 1000, jev: r3(s('jev') * 1000) / 1000, total: r3(l.entries.reduce((a, e) => a + e.usd, 0) * 1000) / 1000 }; } catch { return null; } };

const res = { films: {}, pooled: null };
const P = { items: [], v8: [], live: [], codex: [] };
const acc = { i_all_v8: 0, i_all_live: 0, i_all_n: 0, i_fl_v8: [0, 0], i_fl_live: [0, 0], ii_v8: 0, ii_live: 0, ii_n: 0, why_ok: 0, why_n: 0, why_ver: 0, why_gen: 0, dt_v8: [0, 0], dt_live: [0, 0], cx_v8: 0, cx_live: 0, cx_n: 0, cxc_v8: 0, cxc_live: 0, cxc_n: 0, tag_v8: [0, 0], tag_live: [0, 0] };
FILMS.forEach((slug, k) => {
  const off = k * 1e8;
  const key = rj(path.join(TS, 'refs', `${slug}.key.json`));
  const human = key.items.filter((i) => i.source !== 'codex-rules');
  const codex = key.items.filter((i) => i.source === 'codex-rules' && isMapped(i));
  const tags = rj(path.join(V8, 'out', `${slug}.tags.r1.json`));
  const seg = rj(path.join(V8, 'out', `${slug}.segments.json`));
  const built = rj(path.join(V8, 'baseline', 'out', `${slug}.built.json`));
  const cues = parseSrt(fs.readFileSync(path.join(TS, 'data', `${slug}.srt`), 'utf8'));
  const fl = tags.scenes.filter((s) => s.flagged);
  const v8 = fl.flatMap((s) => (s.skip?.spans ?? []).map((x) => [x.start_ms, x.end_ms]));
  const live = built.scenes.map((s) => [s.start_ms, s.end_ms]);
  // sanity: every skip span inside its scene
  const outside = fl.filter((s) => (s.skip?.spans ?? []).some((x) => x.start_ms < s.start_ms || x.end_ms > s.end_ms)).map((s) => s.id);
  const aS = score(human, v8); const aG = score(human, v8, 'gap'); const bS = score(human, live); const bG = score(human, live, 'gap');
  const j = jitter(human, v8, live);
  const v = verdict(aS, aG, bS, bG, j);
  // parent (i): all mapped should_flag wordless items >= 80% inside skip; and in-flagged-scene variant
  const wl = human.filter((i) => isMapped(i) && i.should_flag === true && i.wordless);
  const cov = (U, i) => share(U, i.start_ms, i.end_ms) >= 0.8;
  const Uv = merge(v8); const Ul = merge(live);
  const iAll = { n: wl.length, v8: wl.filter((i) => cov(Uv, i)).length, live: wl.filter((i) => cov(Ul, i)).length, v8_missed: wl.filter((i) => !cov(Uv, i)).map((i) => `${i.id}:${r3(share(Uv, i.start_ms, i.end_ms))}`) };
  const inScenes = (scs) => wl.filter((i) => scs.some((s) => share([[s.start_ms, s.end_ms]], i.start_ms, i.end_ms) >= 0.5));
  const fv = inScenes(fl); const fL = inScenes(built.scenes);
  const iFl = { v8: `${fv.filter((i) => cov(Uv, i)).length}/${fv.length}`, live: `${fL.filter((i) => cov(Ul, i)).length}/${fL.length}` };
  // (ii)
  const regions = wordlessScenes(seg, cues, POLICY);
  const inWl = human.filter((i) => isMapped(i) && i.should_flag === true && regions.some((r) => share([[r.start_ms, r.end_ms]], i.start_ms, i.end_ms) >= 0.5));
  const ii = { regions: regions.map((r) => r.id), n: inWl.length, v8: inWl.filter((i) => share(Uv, i.start_ms, i.end_ms) >= 0.5).length, live: inWl.filter((i) => share(Ul, i.start_ms, i.end_ms) >= 0.5).length };
  // (iii) why on every flagged scene (tags) and source split
  const why = { flagged: fl.length, with_text: fl.filter((s) => (s.why?.text ?? '').trim().length > 10).length, verified: fl.filter((s) => s.why?.source === 'verified_sentence').length, generated: fl.filter((s) => s.why?.source === 'generated').length, heads_up: fl.filter((s) => /^Heads-up:/.test(s.why?.text ?? '')).length };
  // claim check
  const sents = seg.scenes.flatMap((s) => s.sentences ?? []);
  const claim = { verified: sents.filter((x) => x.check?.status === 'verified').length, of: sents.length, scenes_with_summary: seg.scenes.filter((s) => s.summary).length, scenes: seg.scenes.length };
  // codex-rules recall
  const audF = new Set((key.audit ?? []).filter((a) => a.rule_applies === false).map((a) => a.id));
  const clean = codex.filter((i) => !i.played_for_laughs && !audF.has(i.id));
  const inside = (U, i) => share(U, i.start_ms, i.end_ms) >= 0.5;
  const cx = { n: codex.length, v8: codex.filter((i) => inside(Uv, i)).length, live: codex.filter((i) => inside(Ul, i)).length, clean_n: clean.length, clean_v8: clean.filter((i) => inside(Uv, i)).length, clean_live: clean.filter((i) => inside(Ul, i)).length };
  // DTDD
  const v8ids = new Set(tags.scenes.flatMap((s) => (s.tags ?? []).filter((t) => t.level === 'act').map((t) => t.id)));
  const liveIds = new Set(built.labels.filter((l) => l.asserted && l.channel !== 'mention').map((l) => l.vocabulary_id));
  const dA = dtdd(key, v8ids); const dB = dtdd(key, liveIds, (id) => ITEMS[id]?.v3 ?? id);
  const cost = { v8: ledger(path.join(V8, 'out', `${slug}.spend.json`)), live: ledger(path.join(V8, 'baseline', 'out', `${slug}.spend.json`)) };
  res.films[slug] = {
    scenes: { v8: tags.scenes.length, v8_flagged: fl.length, live: built.scenes.length }, spans_outside_scene: outside,
    v8: { strict: aS, gap: aG }, live: { strict: bS, gap: bG }, jitter: j, verdict: v,
    i_all: iAll, i_in_flagged: iFl, ii, why, claim, codex_rules: cx, dtdd: { v8: `${dA.agree}/${dA.scored} fp${dA.fp}`, live: `${dB.agree}/${dB.scored} fp${dB.fp}` }, cost,
  };
  acc.i_all_n += iAll.n; acc.i_all_v8 += iAll.v8; acc.i_all_live += iAll.live;
  acc.ii_n += ii.n; acc.ii_v8 += ii.v8; acc.ii_live += ii.live;
  acc.why_n += why.flagged; acc.why_ok += why.with_text; acc.why_ver += why.verified; acc.why_gen += why.generated;
  acc.dt_v8[0] += dA.agree; acc.dt_v8[1] += dA.scored; acc.dt_live[0] += dB.agree; acc.dt_live[1] += dB.scored;
  acc.cx_n += cx.n; acc.cx_v8 += cx.v8; acc.cx_live += cx.live; acc.cxc_n += cx.clean_n; acc.cxc_v8 += cx.clean_v8; acc.cxc_live += cx.clean_live;
  const pid = (id) => `${slug}:${id}`;
  for (const i of human) {
    const o = { ...i, id: pid(i.id), same_moment_as: (i.same_moment_as ?? []).map(pid) };
    for (const f of ['start_ms', 'end_ms', 'gap_start_ms', 'gap_end_ms']) if (Number.isFinite(i[f])) o[f] = i[f] + off;
    P.items.push(o);
  }
  P.v8.push(...v8.map(([a, b]) => [a + off, b + off])); P.live.push(...live.map(([a, b]) => [a + off, b + off]));
});
const pS = score(P.items, P.v8); const pG = score(P.items, P.v8, 'gap'); const lS = score(P.items, P.live); const lG = score(P.items, P.live, 'gap');
const pj = jitter(P.items, P.v8, P.live);
const pv = verdict(pS, pG, lS, lG, pj);
res.pooled = {
  v8: { recall: `${pS.recall}/${pS.of}`, gap_recall: pG.recall, moments: `${pS.mom}/${pS.mom_of}`, prec: `${pS.prec}/${pG.prec}`, skip_min: pS.skip_min, tag: pS.tag },
  live: { recall: `${lS.recall}/${lS.of}`, gap_recall: lG.recall, moments: `${lS.mom}/${lS.mom_of}`, prec: `${lS.prec}/${lG.prec}`, skip_min: lS.skip_min, tag: lS.tag },
  skip_ratio: r3(pS.skip_min / lS.skip_min), jitter: pj, verdict: pv,
  i_all: `v8 ${acc.i_all_v8}/${acc.i_all_n} live ${acc.i_all_live}/${acc.i_all_n}`,
  ii: `v8 ${acc.ii_v8}/${acc.ii_n} live ${acc.ii_live}/${acc.ii_n}`,
  why: `${acc.why_ok}/${acc.why_n} (verified ${acc.why_ver}, generated ${acc.why_gen})`,
  dtdd: `v8 ${acc.dt_v8.join('/')} live ${acc.dt_live.join('/')}`,
  codex: `v8 ${acc.cx_v8}/${acc.cx_n} (clean ${acc.cxc_v8}/${acc.cxc_n}) live ${acc.cx_live}/${acc.cx_n} (clean ${acc.cxc_live}/${acc.cxc_n})`,
};
fs.mkdirSync(path.join(V8, 'verify', 'out'), { recursive: true });
fs.writeFileSync(path.join(V8, 'verify', 'out', 'h2h-recompute.json'), JSON.stringify(res, null, 2));
console.log(JSON.stringify(res, (k, v) => (k === 'missed' ? undefined : v), 1));
