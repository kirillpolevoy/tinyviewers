#!/usr/bin/env node
// Round-6 VERIFIER: independent recompute of the held-out head-to-head (v10 vs live) on frozen, zootopia,
// good-dinosaur. Own interval math, recall / moments / precision (strict + gap), jitter (seed 12345, 300 runs,
// +-30 s per mapped item start/end, strict window), verdict rule (conservative recall + 95% jitter; precision
// strict & gap agree + 95%), wordless peaks (>= 80% inside skip), rules 1/2 vs codex-rules items, who-flags,
// parent-text sources + uncited check, judge tally recount, per-film ledgers and phase spend.
// Two pooled views: AS RUN (v10 skip empty where it produced no guide) and GOOD DINOSAUR ONLY.
// Shared with the pipeline only: ../../srt.js (parser) and fill.js wordlessScenes (region definition, check ii).
// No refscore / parent-checks imports. No model calls.
import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
import { parseSrt } from '../../../srt.js';
import { wordlessScenes } from '../../fill.js';
import { loadPolicy } from '../../select.js';
const V10 = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const TS = path.resolve(V10, '..');
const LIVE = path.join(V10, 'round6', 'live'); const OUT10 = path.join(V10, 'out10');
const FILMS = ['frozen', 'zootopia', 'good-dinosaur'];
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
  return { recall: T.filter(found).length, of: T.length, mom: cl.filter((c) => c.filter(isMapped).some(found)).length, mom_of: cl.length, prec: sk ? r3(interUU(U, merge(T.map(span))) / sk) : null, skip_min: r3(sk / 60000), tag: [tag.filter(found).length, tag.length], no: [no.filter(found).length, no.length], mapped: m.length, unmappable: items.length - m.length, missed: T.filter((i) => !found(i)).map((i) => i.id) };
}
function lcg(seed) { let x = seed; return () => { x = (x * 1103515245 + 12345) % 2147483648; return x / 2147483648; }; }
function jitter(items, A, B) { const rnd = lcg(12345); const dR = [], dP = []; for (let n = 0; n < 300; n++) { const mv = items.map((i) => { if (!isMapped(i)) return i; const s = i.start_ms + (rnd() * 2 - 1) * 30000; const e = i.end_ms + (rnd() * 2 - 1) * 30000; return { ...i, start_ms: s, end_ms: Math.max(s, e) }; }); const a = score(mv, A), b = score(mv, B); dR.push(a.recall - b.recall); dP.push((a.prec ?? 0) - (b.prec ?? 0)); } const sh = (d, f) => r3(d.filter(f).length / d.length); return { rec_gt: sh(dR, (x) => x > 0), rec_lt: sh(dR, (x) => x < 0), prec_gt: sh(dP, (x) => x > 0), prec_lt: sh(dP, (x) => x < 0) }; }
function verdict(aS, aG, bS, bG, j) { const cA = Math.min(aS.recall, aG.recall), cB = Math.min(bS.recall, bG.recall); const rec = cA > cB && j.rec_gt >= 0.95 ? 'v10' : cB > cA && j.rec_lt >= 0.95 ? 'live' : 'tie'; const ps = (aS.prec ?? 0) - bS.prec, pg = (aG.prec ?? 0) - bG.prec; const prec = ps > 0 && pg > 0 && j.prec_gt >= 0.95 ? 'v10' : ps < 0 && pg < 0 && j.prec_lt >= 0.95 ? 'live' : 'tie'; return { cons_v10: cA, cons_live: cB, recall: rec, precision: prec }; }
const led = (f) => { if (!fs.existsSync(f)) return null; const l = rj(f); const s = (k) => l.entries.filter((e) => e.kind === k).reduce((a, e) => a + e.usd, 0); return { sonnet: +s('sonnet').toFixed(6), jev: +s('jev').toFixed(6), total: +l.entries.reduce((a, e) => a + e.usd, 0).toFixed(6) }; };
const tally = (rows, sys, kind) => { const t = { accurate: 0, partly: 0, wrong: 0, generic: 0 }; for (const r of rows.filter((x) => x.sys === sys && x.kind === kind)) t[r.verdict] = (t[r.verdict] ?? 0) + 1; return t; };
const desc = rj(path.join(V10, 'round6', 'out', 'descriptions.json'));
const res = { films: {} };
const P = { items: [], v10: [], live: [], gdItems: [], gdV10: [], gdLive: [] };
FILMS.forEach((slug, k) => {
  const off = k * 1e8;
  const key = rj(path.join(TS, 'refs', `${slug}.key.json`));
  const human = key.items.filter((i) => i.source !== 'codex-rules');
  const codex = key.items.filter((i) => i.source === 'codex-rules' && isMapped(i));
  const built = rj(path.join(LIVE, `${slug}.built.json`));
  const live = built.scenes.map((s) => [s.start_ms, s.end_ms]);
  const tf = path.join(OUT10, `${slug}.tags.r1.json`); const ran = fs.existsSync(tf);
  const tags = ran ? rj(tf) : null; const fl = ran ? tags.scenes.filter((s) => s.flagged) : [];
  const v10 = fl.flatMap((s) => (s.skip?.spans ?? []).map((x) => [x.start_ms, x.end_ms]));
  const aS = score(human, v10), aG = score(human, v10, 'gap'), bS = score(human, live), bG = score(human, live, 'gap');
  const j = jitter(human, v10, live); const v = verdict(aS, aG, bS, bG, j);
  const Uv = merge(v10), Ul = merge(live);
  const wl = human.filter((i) => isMapped(i) && i.should_flag === true && i.wordless);
  const cov = (U, i) => share(U, i.start_ms, i.end_ms) >= 0.8;
  const wlr = { n: wl.length, v10: wl.filter((i) => cov(Uv, i)).length, live: wl.filter((i) => cov(Ul, i)).length };
  const audF = new Set((key.audit ?? rj(path.join(TS, 'refs', 'audits.json'))[slug] ?? []).filter((a) => a.rule_applies === false).map((a) => a.id));
  const inside = (U, i) => share(U, i.start_ms, i.end_ms) >= 0.5;
  const rr = (pool) => ({ n: pool.length, v10: pool.filter((i) => inside(Uv, i)).length, live: pool.filter((i) => inside(Ul, i)).length });
  const clean = codex.filter((i) => !i.played_for_laughs && !audF.has(i.id));
  const rules = { villain_threat: rr(codex.filter((i) => i.marker === 'villain_threat')), child_terrified: rr(codex.filter((i) => i.marker === 'child_terrified')), clean: rr(clean), all: rr(codex), played_for_laughs: codex.filter((i) => i.played_for_laughs).length, audit_false: [...audF] };
  const f = { v10_ran: ran, scenes: { v10: tags?.scenes.length ?? 0, v10_flagged: fl.length, live: built.scenes.length }, human_items: human.length, v10: { strict: aS, gap: aG }, live: { strict: bS, gap: bG }, jitter: j, verdict: v, wordless: wlr, rules };
  // DTDD-free; key policy counts for context
  f.key_policy = { villain_threat_flag_items: human.filter((i) => isMapped(i) && i.should_flag === true && i.policy?.villain_threat).length };
  if (ran) {
    const seg = rj(path.join(OUT10, `${slug}.segments.json`));
    const cues = parseSrt(fs.readFileSync(path.join(TS, 'data', `${slug}.srt`), 'utf8'));
    const regions = wordlessScenes(seg, cues, loadPolicy());
    const T = human.filter((i) => isMapped(i) && i.should_flag === true);
    const inReg = T.filter((i) => regions.some((r) => share([[r.start_ms, r.end_ms]], i.start_ms, i.end_ms) >= 0.5));
    f.wordless_scenes = { regions: regions.length, n: inReg.length, v10: inReg.filter((i) => inside(Uv, i)).length, live: inReg.filter((i) => inside(Ul, i)).length };
    // wordless peaks in flagged scenes (parent-checks (i) definition, own code)
    const pk = (scenesList, U) => { let n = 0, c = 0; for (const i of wl) { const sc = scenesList.find((s) => share([[s.start_ms, s.end_ms]], i.start_ms, i.end_ms) >= 0.5); if (!sc) continue; n++; if (cov(U, i)) c++; } return `${c}/${n}`; };
    f.wordless_in_flagged = { v10: pk(fl, Uv), live: pk(built.scenes, Ul) };
    // who flags
    const who = { jev: [0, 0, 0, 0], sonnet: [0, 0, 0, 0], both: [0, 0, 0, 0] }; const reasonTally = {}; const misses = []; let nReasons = 0, nJev = 0;
    for (const s of fl) {
      const U = merge((s.skip?.spans ?? []).map((x) => [x.start_ms, x.end_ms]));
      const hit = T.some((i) => share(U, i.start_ms, i.end_ms) >= 0.5);
      const bys = new Set(s.flag_reasons.map((r) => r.by)); const w = bys.size === 1 ? [...bys][0] : 'both';
      who[w][0]++; who[w][3] += len(U) / 60000; if (hit) who[w][1]++; else { who[w][2] += len(U) / 60000; misses.push(`${s.id}:${s.flag_reasons.map((r) => `${r.id}/${r.by}`).join(',')}`); }
      for (const r of s.flag_reasons) { nReasons++; if (r.by === 'jev') nJev++; const kk = `${r.id}/${r.by}`; reasonTally[kk] ??= [0, 0]; reasonTally[kk][hit ? 0 : 1]++; }
    }
    f.who = Object.fromEntries(Object.entries(who).map(([kk, x]) => [kk, { scenes: x[0], hit: x[1], miss_min: r3(x[2]), skip_min: r3(x[3]) }]));
    f.reasons = { total: nReasons, jev: nJev, share: r3(nJev / nReasons) }; f.misses = misses; f.child_frightened = reasonTally['child_frightened/jev'];
    f.sonnet_reason_ids = [...new Set(fl.flatMap((s) => s.flag_reasons.filter((r) => r.by === 'sonnet').map((r) => r.id)))];
    // rule-only flagged scenes (all flag reasons are rule 1/2 reasons)
    const R1 = (id) => ['threatens_harm', 'plots_harm'].includes(id) || /_threatens$/.test(id); const R2 = (id) => id === 'child_frightened';
    const ro = fl.filter((s) => s.flag_reasons.length && s.flag_reasons.every((r) => R1(r.id) || R2(r.id)));
    f.rule_only = { n: ro.length, with_rule_item_in_scene: ro.filter((s) => codex.some((i) => share([[s.start_ms, s.end_ms]], i.start_ms, i.end_ms) >= 0.5 && (s.flag_reasons.every((r) => R1(r.id)) ? i.marker === 'villain_threat' : s.flag_reasons.every((r) => R2(r.id)) ? i.marker === 'child_terrified' : true))).length };
    // parent text sources + uncited check (own logic)
    const why = rj(path.join(OUT10, `${slug}.why.r1.json`)); const dsc = rj(path.join(OUT10, `${slug}.describe.r1.json`));
    const src = { described: 0, 'described+reason': 0, plain_reason: 0, other: 0 }; let shownSent = 0, shownTitles = 0; const uncited = [];
    for (const s of fl) {
      src[s.why?.source] !== undefined ? src[s.why.source]++ : src.other++;
      const run = why.scenes?.[s.id]; const ev = dsc.scenes?.[s.id]?.evidence_ids ?? {}; const evIds = new Set([...(ev.lines ?? []), ...(ev.w ?? []), ...(ev.t ?? [])]);
      const chk = new Map((run?.checked ?? []).map((c) => [c.key, c]));
      for (const kk of s.why?.sentences ?? []) { shownSent++; const c = chk.get(kk); if (!c || c.final !== 'verified' || !(c.cites ?? []).length || !c.cites.every((x) => evIds.has(x)) || !s.why.text.includes(c.text)) uncited.push(`${s.id}:${kk}`); }
      let rest = s.why?.text ?? ''; for (const kk of s.why?.sentences ?? []) { const c = chk.get(kk); if (c) rest = rest.replace(c.text, ''); }
      rest = rest.replace(/Flagged because [^.]+\./, '').trim(); if (rest) uncited.push(`${s.id}:extra`);
      if (s.why?.title_source === 'sonnet_verified') { shownTitles++; const c = chk.get(`${s.id}.title`); if (!c || c.final !== 'verified' || c.text !== s.why.title || !(c.cites ?? []).every((x) => evIds.has(x))) uncited.push(`${s.id}:title`); }
    }
    f.parent = { sources: src, shown_sentences: shownSent, shown_sonnet_titles: shownTitles, uncited };
    const sc = seg.split_check ?? {}; f.split_gate = { pass: sc.pass, attempt: sc.attempt, aligned: sc.jev?.metrics?.aligned_share, auc: sc.jev?.metrics?.boundary_auc };
    const df = desc.per_film.find((x) => x.slug === slug);
    const recount = { v10_text: tally(df.rows, 'v10', 'text'), live_text: tally(df.rows, 'live', 'text'), v10_title: tally(df.rows, 'v10', 'title'), live_title: tally(df.rows, 'live', 'title') };
    const strip = (t) => { const { missing, ...r } = t; return r; };
    f.judge = { recount, matches_file: JSON.stringify(recount) === JSON.stringify({ v10_text: strip(df.v10_text), live_text: strip(df.live_text), v10_title: strip(df.v10_title), live_title: strip(df.live_title) }), v10_text_rows: df.rows.filter((x) => x.sys === 'v10' && x.kind === 'text').length, live_text_rows: df.rows.filter((x) => x.sys === 'live' && x.kind === 'text').length, v10_scenes_judged_match_flagged: JSON.stringify(df.rows.filter((x) => x.sys === 'v10' && x.kind === 'text').map((x) => x.scene).sort()) === JSON.stringify(fl.map((s) => s.id).sort()) };
    const byType = {}; for (const r of df.rows.filter((x) => x.sys === 'v10' && x.kind === 'text')) { byType[r.source] ??= {}; byType[r.source][r.verdict] = (byType[r.source][r.verdict] ?? 0) + 1; } f.judge.v10_text_by_source = byType;
    // judged texts equal the texts shown to parents?
    f.judge.v10_text_equals_shown = df.rows.filter((x) => x.sys === 'v10' && x.kind === 'text').every((x) => fl.find((s) => s.id === x.scene)?.why?.text === x.text);
    f.judge.live_text_equals_built = df.rows.filter((x) => x.sys === 'live' && x.kind === 'text').every((x) => built.scenes.find((s) => s.id.split(':').pop() === x.scene)?.description === x.text);
    P.gdItems.push(...human); P.gdV10.push(...v10); P.gdLive.push(...live);
  } else {
    const errF = path.join(OUT10, `${slug}.segments.error.json`);
    f.segments_json_exists = fs.existsSync(path.join(OUT10, `${slug}.segments.json`));
  }
  f.cost = { v10_now: led(path.join(OUT10, `${slug}.spend.json`)), v10_frozen_config: led(path.join(V10, 'round6', 'out', 'frozen-config', `${slug}.spend.json`)), live: led(path.join(LIVE, `${slug}.spend.json`)) };
  res.films[slug] = f;
  const pid = (id) => `${slug}:${id}`;
  for (const i of human) { const o = { ...i, id: pid(i.id), same_moment_as: (i.same_moment_as ?? []).map(pid) }; for (const ff of ['start_ms', 'end_ms', 'gap_start_ms', 'gap_end_ms']) if (Number.isFinite(i[ff])) o[ff] = i[ff] + off; P.items.push(o); }
  P.v10.push(...v10.map(([a, b]) => [a + off, b + off])); P.live.push(...live.map(([a, b]) => [a + off, b + off]));
});
const pooled = (items, A, B) => { const pS = score(items, A), pG = score(items, A, 'gap'), lS = score(items, B), lG = score(items, B, 'gap'); const pj = jitter(items, A, B); return { v10: { strict: { ...pS, missed: undefined }, gap: { ...pG, missed: undefined } }, live: { strict: { ...lS, missed: undefined }, gap: { ...lG, missed: undefined } }, skip_ratio: pS.skip_min ? r3(pS.skip_min / lS.skip_min) : null, jitter: pj, verdict: verdict(pS, pG, lS, lG, pj) }; };
res.pooled_as_run = pooled(P.items, P.v10, P.live);
const wsum = (k) => Object.values(res.films).reduce((a, f) => a + f.wordless[k], 0);
res.pooled_as_run.wordless = { n: wsum('n'), v10: wsum('v10'), live: wsum('live') };
const rsum = (g, k) => Object.values(res.films).reduce((a, f) => a + f.rules[g][k], 0);
res.pooled_as_run.rules_live = { villain: `${rsum('villain_threat', 'live')}/${rsum('villain_threat', 'n')}`, child: `${rsum('child_terrified', 'live')}/${rsum('child_terrified', 'n')}` };
// phase spend: all v10 ledgers (current, after rescue) + live ledgers
const sp = { v10_sonnet: 0, v10_jev: 0, live: 0 };
for (const s of FILMS) { const a = res.films[s].cost.v10_now; const l = res.films[s].cost.live; sp.v10_sonnet += a.sonnet; sp.v10_jev += a.jev; sp.live += l.total; }
res.spend = { ...Object.fromEntries(Object.entries(sp).map(([k, x]) => [k, +x.toFixed(6)])), v10_total: +(sp.v10_sonnet + sp.v10_jev).toFixed(6), sonnet_total: +(sp.v10_sonnet + sp.live).toFixed(6), total: +(sp.v10_sonnet + sp.v10_jev + sp.live).toFixed(6),
  rescue_supplementary: +FILMS.filter((s) => res.films[s].cost.v10_frozen_config).reduce((a, s) => a + res.films[s].cost.v10_now.total - res.films[s].cost.v10_frozen_config.total, 0).toFixed(6) };
fs.writeFileSync(path.join(V10, 'verify', 'r6', 'out', 'h2h.json'), JSON.stringify(res, null, 2));
const brief = (s) => `rec ${s.recall}/${s.of} mom ${s.mom}/${s.mom_of} prec ${s.prec} skip ${s.skip_min} tag ${s.tag.join('/')} false ${s.no.join('/')}`;
for (const [slug, f] of Object.entries(res.films)) {
  console.log(`\n== ${slug} ran ${f.v10_ran} scenes ${JSON.stringify(f.scenes)} human ${f.human_items} unmappable ${f.live.strict.unmappable}`);
  for (const n of ['strict', 'gap']) console.log(`  v10 ${n}: ${brief(f.v10[n])}\n  live ${n}: ${brief(f.live[n])}`);
  console.log(`  jitter ${JSON.stringify(f.jitter)} verdict ${JSON.stringify(f.verdict)}`);
  console.log(`  wordless ${JSON.stringify(f.wordless)} rules ${JSON.stringify(f.rules)}`);
  if (f.v10_ran) { console.log(`  wl-scenes ${JSON.stringify(f.wordless_scenes)} wl-in-flagged ${JSON.stringify(f.wordless_in_flagged)}`); console.log(`  who ${JSON.stringify(f.who)} reasons ${JSON.stringify(f.reasons)} sonnet ids ${f.sonnet_reason_ids} cf ${f.child_frightened}\n  misses ${f.misses.join(' | ')}\n  rule-only ${JSON.stringify(f.rule_only)}`); console.log(`  parent ${JSON.stringify(f.parent)} gate ${JSON.stringify(f.split_gate)}`); console.log(`  judge ${JSON.stringify(f.judge)}`); }
  console.log(`  cost ${JSON.stringify(f.cost)}`);
}
for (const [n, p] of [['AS RUN', res.pooled_as_run]]) console.log(`\n== POOLED ${n}\n  v10 strict ${brief(p.v10.strict)}\n  v10 gap ${brief(p.v10.gap)}\n  live strict ${brief(p.live.strict)}\n  live gap ${brief(p.live.gap)}\n  ratio ${p.skip_ratio} jitter ${JSON.stringify(p.jitter)} verdict ${JSON.stringify(p.verdict)} wordless ${JSON.stringify(p.wordless)} rules_live ${JSON.stringify(p.rules_live)}`);
console.log(`\n== SPEND ${JSON.stringify(res.spend)}`);
