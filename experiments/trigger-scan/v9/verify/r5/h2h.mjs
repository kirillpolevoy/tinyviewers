#!/usr/bin/env node
// Round-5 VERIFIER: independent recompute of the held-out head-to-head (v9 vs live) on book-of-life,
// princess-and-the-frog, moana. Own interval math, recall/moments/precision, jitter (documented LCG
// spec: seed 12345, 300 runs, +-30 s per item start/end, strict window), verdict rule (conservative
// recall + 95% jitter; precision strict & gap & 95%), wordless peaks (>=80%), rules 1/2 vs codex-rules,
// who-flags breakdown, parent-text source counts, uncited check, judge tallies recount, costs.
// Shared with the pipeline only: ../../srt.js parser. No refscore/parent-checks imports. No model calls.
import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
import { parseSrt } from '../../../srt.js';
const V9 = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const TS = path.resolve(V9, '..');
const LIVE = process.env.LIVE_DIR ?? path.join(V9, 'round5', 'live');
const FILMS = (process.argv[2] ?? 'book-of-life,princess-and-the-frog,moana').split(',');
const rj = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const r3 = (x) => (x == null ? null : Math.round(x * 1000) / 1000);
function merge(sp) { const s = sp.filter((x) => Number.isFinite(x[0]) && Number.isFinite(x[1]) && x[1] >= x[0]).map((x) => [x[0], x[1]]).sort((a, b) => a[0] - b[0]); const o = []; for (const x of s) { if (o.length && x[0] <= o.at(-1)[1]) o.at(-1)[1] = Math.max(o.at(-1)[1], x[1]); else o.push(x); } return o; }
const len = (u) => u.reduce((a, [x, y]) => a + y - x, 0);
const ovl = (u, a, b) => u.reduce((t, [x, y]) => t + Math.max(0, Math.min(y, b) - Math.max(x, a)), 0);
const interUU = (u, v) => v.reduce((t, [a, b]) => t + ovl(u, a, b), 0);
const share = (u, a, b) => (b <= a ? (u.some(([x, y]) => a >= x && a <= y) ? 1 : 0) : ovl(u, a, b) / (b - a));
const isMapped = (i) => i.mappable && Number.isFinite(i.start_ms) && Number.isFinite(i.end_ms);
const gapWin = (i) => (Number.isFinite(i.gap_start_ms) && Number.isFinite(i.gap_end_ms) ? [Math.min(i.start_ms, i.gap_start_ms), Math.max(i.end_ms, i.gap_end_ms)] : [i.start_ms, i.end_ms]);
function clusters(items) { const p = new Map(items.map((i) => [i.id, i.id])); const f = (x) => { while (p.get(x) !== x) x = p.get(x); return x; }; for (const i of items) for (const o of i.same_moment_as ?? []) if (p.has(o)) { const a = f(i.id), b = f(o); if (a !== b) p.set(a, b); } const g = new Map(); for (const i of items) { const r = f(i.id); if (!g.has(r)) g.set(r, []); g.get(r).push(i); } return [...g.values()]; }
function score(items, skip, win = 'strict') {
  const U = merge(skip); const span = (i) => (win === 'gap' ? gapWin(i) : [i.start_ms, i.end_ms]);
  const m = items.filter(isMapped); const sh = new Map(m.map((i) => [i.id, share(U, ...span(i))])); const found = (i) => sh.get(i.id) >= 0.5;
  const T = m.filter((i) => i.should_flag === true); const tag = m.filter((i) => i.should_flag === 'tag_only'); const no = m.filter((i) => i.should_flag === false);
  const cl = clusters(items).filter((c) => c.some(isMapped) && c.some((i) => i.should_flag === true));
  const sk = len(U);
  return { recall: T.filter(found).length, of: T.length, mom: cl.filter((c) => c.filter(isMapped).some(found)).length, mom_of: cl.length, prec: sk ? r3(interUU(U, merge(T.map(span))) / sk) : null, skip_min: r3(sk / 60000), tag: [tag.filter(found).length, tag.length], no: [no.filter(found).length, no.length], mapped: m.length, unmappable: items.length - m.length };
}
function lcg(seed) { let x = seed; return () => { x = (x * 1103515245 + 12345) % 2147483648; return x / 2147483648; }; }
function jitter(items, A, B) { const rnd = lcg(12345); const dR = [], dP = []; for (let n = 0; n < 300; n++) { const mv = items.map((i) => { if (!isMapped(i)) return i; const s = i.start_ms + (rnd() * 2 - 1) * 30000; const e = i.end_ms + (rnd() * 2 - 1) * 30000; return { ...i, start_ms: s, end_ms: Math.max(s, e) }; }); const a = score(mv, A), b = score(mv, B); dR.push(a.recall - b.recall); dP.push((a.prec ?? 0) - (b.prec ?? 0)); } const sh = (d, f) => r3(d.filter(f).length / d.length); const q = (d, p) => [...d].sort((x, y) => x - y)[Math.floor(p * (d.length - 1))]; return { rec_gt: sh(dR, (x) => x > 0), rec_lt: sh(dR, (x) => x < 0), rec_p05: q(dR, 0.05), rec_p95: q(dR, 0.95), prec_gt: sh(dP, (x) => x > 0), prec_lt: sh(dP, (x) => x < 0) }; }
function verdict(aS, aG, bS, bG, j) { const cA = Math.min(aS.recall, aG.recall), cB = Math.min(bS.recall, bG.recall); const rec = cA > cB && j.rec_gt >= 0.95 ? 'v9' : cB > cA && j.rec_lt >= 0.95 ? 'live' : 'tie'; const ps = aS.prec - bS.prec, pg = aG.prec - bG.prec; const prec = ps > 0 && pg > 0 && j.prec_gt >= 0.95 ? 'v9' : ps < 0 && pg < 0 && j.prec_lt >= 0.95 ? 'live' : 'tie'; return { cons_v9: cA, cons_live: cB, recall: rec, precision: prec }; }
const ledger = (f) => { const l = rj(f); const s = (k) => l.entries.filter((e) => e.kind === k).reduce((a, e) => a + e.usd, 0); return { sonnet: r3(s('sonnet') * 1000) / 1000, jev: r3(s('jev') * 1000) / 1000, total: r3(l.entries.reduce((a, e) => a + e.usd, 0) * 1000) / 1000 }; };
const tally = (rows, sys, kind) => { const t = { accurate: 0, partly: 0, wrong: 0, generic: 0 }; for (const r of rows.filter((x) => x.sys === sys && x.kind === kind)) t[r.verdict] = (t[r.verdict] ?? 0) + 1; return t; };

const desc = rj(path.join(V9, 'round5', 'out', 'descriptions.json'));
const res = { films: {}, pooled: {} };
const P = { items: [], v9: [], live: [] }; const acc = {};
const add = (k, v) => { acc[k] = (acc[k] ?? 0) + v; };
FILMS.forEach((slug, k) => {
  const off = k * 1e8;
  const key = rj(path.join(TS, 'refs', `${slug}.key.json`));
  const human = key.items.filter((i) => i.source !== 'codex-rules');
  const codex = key.items.filter((i) => i.source === 'codex-rules' && isMapped(i));
  const tags = rj(path.join(V9, 'out', `${slug}.tags.r1.json`));
  const seg = rj(path.join(V9, 'out', `${slug}.segments.json`));
  const built = rj(path.join(LIVE, `${slug}.built.json`));
  const fl = tags.scenes.filter((s) => s.flagged);
  const v9 = fl.flatMap((s) => (s.skip?.spans ?? []).map((x) => [x.start_ms, x.end_ms]));
  const live = built.scenes.map((s) => [s.start_ms, s.end_ms]);
  const outside = fl.filter((s) => (s.skip?.spans ?? []).some((x) => x.start_ms < s.start_ms || x.end_ms > s.end_ms)).map((s) => s.id);
  const aS = score(human, v9), aG = score(human, v9, 'gap'), bS = score(human, live), bG = score(human, live, 'gap');
  const j = jitter(human, v9, live); const v = verdict(aS, aG, bS, bG, j);
  const Uv = merge(v9), Ul = merge(live);
  const wl = human.filter((i) => isMapped(i) && i.should_flag === true && i.wordless);
  const cov = (U, i) => share(U, i.start_ms, i.end_ms) >= 0.8;
  const wlr = { n: wl.length, v9: wl.filter((i) => cov(Uv, i)).length, live: wl.filter((i) => cov(Ul, i)).length, v9_only: wl.filter((i) => cov(Uv, i) && !cov(Ul, i)).map((i) => i.id), live_only: wl.filter((i) => !cov(Uv, i) && cov(Ul, i)).map((i) => i.id) };
  // rules 1/2: codex-rules items >= 50% inside skip
  const audF = new Set((key.audit ?? []).filter((a) => a.rule_applies === false).map((a) => a.id));
  const inside = (U, i) => share(U, i.start_ms, i.end_ms) >= 0.5;
  const rr = (pool) => ({ n: pool.length, v9: pool.filter((i) => inside(Uv, i)).length, live: pool.filter((i) => inside(Ul, i)).length });
  const clean = codex.filter((i) => !i.played_for_laughs && !audF.has(i.id));
  const rules = { villain_threat: rr(codex.filter((i) => i.marker === 'villain_threat')), child_terrified: rr(codex.filter((i) => i.marker === 'child_terrified')), clean: rr(clean), all: rr(codex) };
  // who flags: scene skip holds >= 50% of a mapped should_flag human item
  const T = human.filter((i) => isMapped(i) && i.should_flag === true);
  const who = { jev: [0, 0, 0], sonnet: [0, 0, 0], both: [0, 0, 0] };
  const reasonTally = {};
  for (const s of fl) {
    const U = merge((s.skip?.spans ?? []).map((x) => [x.start_ms, x.end_ms]));
    const hit = T.some((i) => share(U, i.start_ms, i.end_ms) >= 0.5);
    const bys = new Set(s.flag_reasons.map((r) => r.by)); const w = bys.size === 1 ? [...bys][0] : 'both';
    who[w][0]++; if (hit) who[w][1]++; else who[w][2] += len(U) / 60000;
    for (const r of s.flag_reasons) { const kk = `${r.id}/${r.by}`; reasonTally[kk] ??= [0, 0]; reasonTally[kk][hit ? 0 : 1]++; }
  }
  // parent text sources + uncited check (own logic: every shown sentence id is verified in why.r1 and cites only ids in the scene's evidence)
  const why = rj(path.join(V9, 'out', `${slug}.why.r1.json`)); const dsc = rj(path.join(V9, 'out', `${slug}.describe.r1.json`));
  const src = { described: 0, 'described+reason': 0, plain_reason: 0, other: 0 }; let shownSent = 0, shownTitles = 0; const uncited = [];
  for (const s of fl) {
    src[s.why?.source] !== undefined ? src[s.why.source]++ : src.other++;
    const run = why.scenes?.[s.id]; const ev = dsc.scenes?.[s.id]?.evidence_ids ?? {}; const evIds = new Set([...(ev.lines ?? []), ...(ev.w ?? []), ...(ev.t ?? [])]);
    const chk = new Map((run?.checked ?? []).map((c) => [c.key, c]));
    for (const kk of s.why?.sentences ?? []) { shownSent++; const c = chk.get(kk); if (!c || c.final !== 'verified' || !(c.cites ?? []).length || !c.cites.every((x) => evIds.has(x)) || !s.why.text.includes(c.text)) uncited.push(`${s.id}:${kk}`); }
    // any shown text not accounted for by verified sentences or the 'Flagged because' line
    let rest = s.why?.text ?? ''; for (const kk of s.why?.sentences ?? []) { const c = chk.get(kk); if (c) rest = rest.replace(c.text, ''); }
    rest = rest.replace(/Flagged because [^.]+\./, '').trim(); if (rest) uncited.push(`${s.id}:extra:${rest.slice(0, 40)}`);
    if (s.why?.title_source === 'sonnet_verified') { shownTitles++; const c = chk.get(`${s.id}.title`); if (!c || c.final !== 'verified' || c.text !== s.why.title || !(c.cites ?? []).every((x) => evIds.has(x))) uncited.push(`${s.id}:title`); }
  }
  // sentence claim check on Sonnet describe sentences
  const allChecked = Object.values(why.scenes ?? {}).flatMap((x) => x.checked ?? []);
  const descSent = allChecked.filter((c) => !/\.title$/.test(c.key));
  const segSent = seg.scenes.flatMap((s) => s.sentences ?? []);
  const sc = seg.split_check ?? {};
  const df = desc.per_film.find((x) => x.slug === slug) ?? { rows: [], v9_text: {}, live_text: {}, v9_title: {}, live_title: {} };
  const recount = { v9_text: tally(df.rows, 'v9', 'text'), live_text: tally(df.rows, 'live', 'text'), v9_title: tally(df.rows, 'v9', 'title'), live_title: tally(df.rows, 'live', 'title') };
  const v9byType = {}; for (const r of df.rows.filter((x) => x.sys === 'v9' && x.kind === 'text')) { v9byType[r.source] ??= {}; v9byType[r.source][r.verdict] = (v9byType[r.source][r.verdict] ?? 0) + 1; }
  const cost = { v9: ledger(path.join(V9, 'out', `${slug}.spend.json`)), live: ledger(path.join(LIVE, `${slug}.spend.json`)) };
  res.films[slug] = {
    scenes: { v9: tags.scenes.length, v9_flagged: fl.length, live: built.scenes.length }, spans_outside_scene: outside,
    v9: { strict: aS, gap: aG }, live: { strict: bS, gap: bG }, jitter: j, verdict: v, wordless: wlr, rules, who, reasonTally,
    parent_sources: src, shown_sentences: shownSent, shown_sonnet_titles: shownTitles, uncited,
    describe_sentences_verified: `${descSent.filter((c) => c.final === 'verified').length}/${descSent.length}`,
    summary_claims_verified: `${segSent.filter((x) => x.check?.status === 'verified').length}/${segSent.length}`,
    split_gate: { pass: sc.pass, attempt: sc.attempt, aligned: sc.jev?.metrics?.aligned_share, auc: sc.jev?.metrics?.boundary_auc },
    judge_recount: recount, judge_matches_file: JSON.stringify(recount) === JSON.stringify({ v9_text: strip(df.v9_text), live_text: strip(df.live_text), v9_title: strip(df.v9_title), live_title: strip(df.live_title) }), v9_text_by_type: v9byType, cost,
  };
  for (const [kk, x] of Object.entries({ wl_n: wlr.n, wl_v9: wlr.v9, wl_live: wlr.live, vt_n: rules.villain_threat.n, vt_v9: rules.villain_threat.v9, vt_live: rules.villain_threat.live, ct_n: rules.child_terrified.n, ct_v9: rules.child_terrified.v9, ct_live: rules.child_terrified.live, cl_n: rules.clean.n, cl_v9: rules.clean.v9, cl_live: rules.clean.live, uncited: uncited.length, shown: shownSent, titles: shownTitles, cost_v9: cost.v9.total, cost_v9_s: cost.v9.sonnet, cost_v9_j: cost.v9.jev, cost_live: cost.live.total })) add(kk, x);
  for (const w of ['jev', 'sonnet', 'both']) { add(`who_${w}_n`, who[w][0]); add(`who_${w}_hit`, who[w][1]); add(`who_${w}_missmin`, who[w][2]); }
  for (const [kk, t] of Object.entries(recount)) for (const [vv, n] of Object.entries(t)) add(`${kk}_${vv}`, n);
  for (const [kk, n] of Object.entries(src)) add(`src_${kk}`, n);
  const pid = (id) => `${slug}:${id}`;
  for (const i of human) { const o = { ...i, id: pid(i.id), same_moment_as: (i.same_moment_as ?? []).map(pid) }; for (const f of ['start_ms', 'end_ms', 'gap_start_ms', 'gap_end_ms']) if (Number.isFinite(i[f])) o[f] = i[f] + off; P.items.push(o); }
  P.v9.push(...v9.map(([a, b]) => [a + off, b + off])); P.live.push(...live.map(([a, b]) => [a + off, b + off]));
});
function strip(t) { const { missing, ...r } = t; return r; }
const pS = score(P.items, P.v9), pG = score(P.items, P.v9, 'gap'), lS = score(P.items, P.live), lG = score(P.items, P.live, 'gap');
const pj = jitter(P.items, P.v9, P.live); const pv = verdict(pS, pG, lS, lG, pj);
res.pooled = { v9: { strict: pS, gap: pG }, live: { strict: lS, gap: lG }, skip_ratio: r3(pS.skip_min / lS.skip_min), jitter: pj, verdict: pv, acc: Object.fromEntries(Object.entries(acc).map(([k, x]) => [k, r3(x)])) };
fs.mkdirSync(path.join(V9, 'verify', 'r5', 'out'), { recursive: true });
fs.writeFileSync(path.join(V9, 'verify', 'r5', 'out', process.env.OUT_NAME ?? 'h2h.json'), JSON.stringify(res, null, 2));
const brief = (s) => `rec ${s.recall}/${s.of} mom ${s.mom}/${s.mom_of} prec ${s.prec} skip ${s.skip_min} tag ${s.tag.join('/')} false ${s.no.join('/')}`;
for (const [slug, f] of Object.entries(res.films)) {
  console.log(`\n== ${slug} scenes v9 ${f.scenes.v9} (flagged ${f.scenes.v9_flagged}) live ${f.scenes.live}; outside ${f.spans_outside_scene.length}; unmappable ${f.v9.strict.unmappable}`);
  for (const n of ['strict', 'gap']) console.log(`  v9 ${n}: ${brief(f.v9[n])}\n  live ${n}: ${brief(f.live[n])}`);
  console.log(`  jitter ${JSON.stringify(f.jitter)} verdict ${JSON.stringify(f.verdict)}`);
  console.log(`  wordless ${JSON.stringify(f.wordless)}  rules ${JSON.stringify(f.rules)}`);
  console.log(`  who ${JSON.stringify(f.who)} src ${JSON.stringify(f.parent_sources)} shown ${f.shown_sentences} titles ${f.shown_sonnet_titles} uncited ${JSON.stringify(f.uncited)}`);
  console.log(`  describe verified ${f.describe_sentences_verified}; summary claims ${f.summary_claims_verified}; gate ${JSON.stringify(f.split_gate)}`);
  console.log(`  judge ${JSON.stringify(f.judge_recount)} matches file ${f.judge_matches_file}; v9 by type ${JSON.stringify(f.v9_text_by_type)}`);
  console.log(`  cost ${JSON.stringify(f.cost)}`);
}
const p = res.pooled;
console.log(`\n== POOLED\n  v9 strict ${brief(p.v9.strict)}\n  v9 gap ${brief(p.v9.gap)}\n  live strict ${brief(p.live.strict)}\n  live gap ${brief(p.live.gap)}\n  ratio ${p.skip_ratio} jitter ${JSON.stringify(p.jitter)} verdict ${JSON.stringify(p.verdict)}\n  acc ${JSON.stringify(p.acc)}`);
