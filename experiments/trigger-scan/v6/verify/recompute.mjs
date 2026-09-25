#!/usr/bin/env node
// Independent recompute of the v6 run's headline numbers. Read-only on out/ and refs/; writes only
// verify/out/recompute.json. No model calls, no network.
//
//   node verify/recompute.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const V6 = path.resolve(HERE, '..');
const TS = path.resolve(V6, '..');
const OUT = path.join(V6, 'out');
const REFS = path.join(TS, 'refs');
const VOUT = path.join(HERE, 'out');
fs.mkdirSync(VOUT, { recursive: true });

const FILMS = ['nemo', 'monsters-inc', 'lion-king', 'frankenweenie', 'wild-robot'];
const J = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const r3 = (x) => (x == null ? null : Math.round(x * 1000) / 1000);

// ---- interval helpers (own implementation) ----
function merge(sp) {
  const s = sp.filter((x) => x[1] >= x[0]).map((x) => [x[0], x[1]]).sort((a, b) => a[0] - b[0]);
  const o = [];
  for (const [a, b] of s) { const l = o.at(-1); if (l && a <= l[1]) l[1] = Math.max(l[1], b); else o.push([a, b]); }
  return o;
}
const len = (u) => u.reduce((s, [a, b]) => s + b - a, 0);
function ov(u1, u2) { let t = 0; for (const [a, b] of u1) for (const [c, d] of u2) t += Math.max(0, Math.min(b, d) - Math.max(a, c)); return t; }
function shareIn(s, e, u) { if (e <= s) return u.some(([a, b]) => s >= a && s <= b) ? 1 : 0; return ov([[s, e]], u) / (e - s); }

// ---- live DB via the loader (read-only functions only) ----
const L = await import(path.join(TS, '../../scene-api/load.js'));
const T3 = await import(path.join(TS, 'taxonomy-v3.js'));
const ctx = await L.openExperiment(TS);
const v2map = L.buildV2Map(ctx.taxonomy);
const vocabIds = new Set(L.buildVocabulary(ctx.taxonomy).items.map((i) => i.id));
function liveDb(slug) {
  const inputs = L.readFilmInputs(slug, ctx);
  const built = L.buildFilmFrom(inputs, { srt: ctx.srt, v2map, vocabIds });
  return built.scenes.map((s) => {
    const tags = built.labels.filter((l) => l.scene_id === s.id && l.asserted && l.channel !== 'mention').map((l) => l.vocabulary_id);
    return { id: s.id.split(':').pop(), title: s.title, start_ms: s.start_ms, end_ms: s.end_ms, tags };
  });
}

// ---- select replay ----
const SEL = await import(path.join(V6, 'select.js'));
const { parseSrt } = await import(path.join(TS, 'srt.js'));
const { ITEMS } = await import(path.join(V6, 'questions.js'));
const { DTDD_TAGS } = await import(path.join(V6, 'refscore.js'));
const policy = SEL.loadPolicy();

function scoreKey(key, skip) {
  const U = merge(skip);
  const mapped = key.items.filter((i) => i.mappable && Number.isFinite(i.start_ms) && Number.isFinite(i.end_ms));
  const share = new Map(mapped.map((i) => [i.id, shareIn(i.start_ms, i.end_ms, U)]));
  const found = (i) => (share.get(i.id) ?? 0) >= 0.5;
  const flag = mapped.filter((i) => i.should_flag === true);
  const tag = mapped.filter((i) => i.should_flag === 'tag_only');
  // clusters by same_moment_as (BFS over undirected links)
  const adj = new Map(key.items.map((i) => [i.id, new Set()]));
  for (const i of key.items) for (const o of i.same_moment_as ?? []) if (adj.has(o)) { adj.get(i.id).add(o); adj.get(o).add(i.id); }
  const seen = new Set(); const clusters = [];
  for (const i of key.items) {
    if (seen.has(i.id)) continue;
    const q = [i.id]; const c = []; seen.add(i.id);
    while (q.length) { const x = q.pop(); c.push(x); for (const y of adj.get(x)) if (!seen.has(y)) { seen.add(y); q.push(y); } }
    clusters.push(c.map((id) => key.items.find((z) => z.id === id)));
  }
  const fm = clusters.filter((c) => c.some((i) => i.should_flag === true) && c.some((i) => share.has(i.id)));
  const refU = merge(mapped.map((i) => [i.start_ms, i.end_ms]));
  const skipMs = len(U);
  const pol = (k) => { const r = flag.filter((i) => i.policy?.[k]); return `${r.filter(found).length}/${r.length}`; };
  return {
    recall_items: `${flag.filter(found).length}/${flag.length}`, recall_moments: `${fm.filter((c) => c.some((i) => share.has(i.id) && found(i))).length}/${fm.length}`,
    villain: pol('villain_threat'), child: pol('child_terrified'),
    tag_only: `${tag.filter(found).length}/${tag.length}`, skip_min: r3(skipMs / 60000),
    prec_ref: skipMs ? r3(ov(U, refU) / skipMs) : null, refU, U,
    found_per_min: skipMs ? r3(flag.filter(found).length / (skipMs / 60000)) : null,
    missed: flag.filter((i) => !found(i)).map((i) => i.id), unmappable: key.items.length - mapped.length,
  };
}

function dtdd(key, idSet) {
  const topics = key.film_level.filter((x) => x.source === 'doesthedogdie' && (x.answer === 'yes' || x.answer === 'no'));
  const res = { all: { n: 0, agree: 0, tp: 0, tn: 0, fp: 0, fn: 0 }, voted: { n: 0, agree: 0 }, rows: [] };
  for (const t of topics) {
    const m = DTDD_TAGS.find(([re]) => re.test(t.text ?? ''));
    if (!m) continue;
    const sys = m[1].some((id) => idSet(id));
    const truth = t.answer === 'yes';
    const a = res.all; a.n++; if (sys === truth) a.agree++;
    if (truth && sys) a.tp++; else if (!truth && !sys) a.tn++; else if (!truth && sys) a.fp++; else a.fn++;
    const votes = (t.votes?.yes ?? 0) + (t.votes?.no ?? 0);
    if (votes > 0) { res.voted.n++; if (sys === truth) res.voted.agree++; }
    res.rows.push({ id: t.id, text: t.text, answer: t.answer, votes, sys: sys ? 'yes' : 'no', ids: m[1] });
  }
  return res;
}

const report = { films: {}, totals: {} };
let tot = { sonnet_ledger: 0, jev_ledger: 0, sonnet_tokens: 0, jev_tokens: 0 };
for (const slug of FILMS) {
  const f = {};
  const cues = parseSrt(fs.readFileSync(path.join(TS, 'data', `${slug}.srt`), 'utf8'));
  const tags = { r1: J(path.join(OUT, `${slug}.tags.r1.json`)), r2: J(path.join(OUT, `${slug}.tags.r2.json`)) };
  const jev = { r1: J(path.join(OUT, `${slug}.jev.r1.json`)), r2: J(path.join(OUT, `${slug}.jev.r2.json`)) };
  const mom = J(path.join(OUT, `${slug}.moments.r1.json`));

  // 1. replay select (r1 with moments, r2 without)
  const rep = {};
  for (const run of ['r1', 'r2']) {
    const m = run === 'r1' ? mom : (fs.existsSync(path.join(OUT, `${slug}.moments.r2.json`)) ? J(path.join(OUT, `${slug}.moments.r2.json`)) : null);
    const out = SEL.selectRun(jev[run], policy, { moments: m, cues });
    const a = tags[run].scenes; const b = out.scenes;
    const diffs = [];
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      const x = a[i]; const y = b[i];
      if (!x || !y || x.id !== y.id) { diffs.push(`scene index ${i}`); continue; }
      if (x.flagged !== y.flagged) diffs.push(`${x.id} flagged ${x.flagged}->${y.flagged}`);
      if (JSON.stringify(x.flag_reasons) !== JSON.stringify(y.flag_reasons)) diffs.push(`${x.id} reasons`);
      if (JSON.stringify(x.skip) !== JSON.stringify(y.skip)) diffs.push(`${x.id} skip`);
      if (JSON.stringify(x.tags) !== JSON.stringify(y.tags)) diffs.push(`${x.id} tags`);
    }
    rep[run] = diffs.length ? diffs.slice(0, 10) : 'identical';
  }
  f.select_replay = rep;

  // 2. flags and minutes
  const flagged = tags.r1.scenes.filter((s) => s.flagged);
  const skip = flagged.flatMap((s) => (s.skip?.spans ?? []).map((x) => [x.start_ms, x.end_ms]));
  const flaggedSpans = flagged.map((s) => [s.start_ms, s.end_ms]);
  f.scenes = tags.r1.scenes.length; f.flagged = flagged.length; f.flagged_r2 = tags.r2.scenes.filter((s) => s.flagged).length;
  f.skip_min = r3(len(merge(skip)) / 60000); f.flagged_scene_min = r3(len(merge(flaggedSpans)) / 60000);
  f.film_min = r3(cues.at(-1).endMs / 60000);
  f.whole_scene_fallbacks = Object.values(mom.scenes).filter((m) => m.method !== 'moments').length;
  // skip spans must lie inside [prev scene start, next scene end] sanity
  f.skip_spans_outside_film = skip.filter(([a, b]) => a < 0 || b > cues.at(-1).endMs + 60000).length;

  // 3. reference key
  const key = J(path.join(REFS, `${slug}.key.json`));
  const db = liveDb(slug);
  const dbSpans = db.map((b) => [b.start_ms, b.end_ms]);
  const v = scoreKey(key, skip); const vs = scoreKey(key, flaggedSpans); const d = scoreKey(key, dbSpans);
  const withDb = merge([...v.refU, ...merge(dbSpans)]);
  f.ref = {
    v6_skip: { recall: v.recall_items, moments: v.recall_moments, villain: v.villain, child: v.child, tag_only: v.tag_only, prec_ref: v.prec_ref, prec_ref_or_db: r3(ov(v.U, withDb) / len(v.U)), found_per_min: v.found_per_min, skip_min: v.skip_min, missed: v.missed },
    v6_flagged_scenes: { recall: vs.recall_items, moments: vs.recall_moments },
    live_db: { recall: d.recall_items, moments: d.recall_moments, villain: d.villain, child: d.child, tag_only: d.tag_only, prec_ref: d.prec_ref, found_per_min: d.found_per_min, skip_min: d.skip_min },
    unmappable: v.unmappable,
  };

  // 4. DTDD
  const act = new Set(tags.r1.scenes.flatMap((s) => (s.tags ?? []).filter((t) => t.level === 'act').map((t) => t.id)));
  const dbIds = new Set(db.flatMap((b) => b.tags));
  const dv = dtdd(key, (id) => act.has(id));
  const dd = dtdd(key, (id) => dbIds.has(ITEMS[id]?.v3 ?? id));
  // how many mapped v6 ids have no v3 equivalent (live DB then can never say yes)
  const noV3 = [...new Set(DTDD_TAGS.flatMap(([, ids]) => ids))].filter((id) => !ITEMS[id]?.v3);
  f.dtdd = { v6: `${dv.all.agree}/${dv.all.n} (tp${dv.all.tp} tn${dv.all.tn} fp${dv.all.fp} fn${dv.all.fn})`, v6_voted_only: `${dv.voted.agree}/${dv.voted.n}`, live_db: `${dd.all.agree}/${dd.all.n} (tp${dd.all.tp} tn${dd.all.tn} fp${dd.all.fp} fn${dd.all.fn})`, live_db_voted_only: `${dd.voted.agree}/${dd.voted.n}`, dtdd_ids_without_v3: noV3, zero_vote_scored: dv.rows.filter((r) => r.votes === 0).length };

  // 5. baseline coverage
  const U = merge(skip); const FU = merge(flaggedSpans);
  const cov = (u) => db.filter((b) => ov(u, [[b.start_ms, b.end_ms]]) / Math.max(1, b.end_ms - b.start_ms) >= 0.5).length;
  f.baseline = { scenes: db.length, covered_by_skip: `${cov(U)}/${db.length}`, covered_by_flagged: `${cov(FU)}/${db.length}`, minutes: r3(len(merge(dbSpans)) / 60000),
    v6_flags_outside: flagged.filter((s) => !db.some((b) => Math.min(s.line_end_ms ?? s.end_ms, b.end_ms) - Math.max(s.line_start_ms ?? s.start_ms, b.start_ms) > 0)).map((s) => s.id) };

  // 6. stability
  const b2 = new Map(tags.r2.scenes.map((s) => [s.id, s]));
  const flips = tags.r1.scenes.filter((s) => b2.has(s.id) && s.flagged !== b2.get(s.id).flagged).map((s) => s.id);
  let tf = 0; let tu = 0;
  for (const s of tags.r1.scenes) {
    const o = b2.get(s.id); if (!o) continue;
    const A = new Set(s.tags.filter((t) => t.level === 'act').map((t) => t.id)); const B = new Set(o.tags.filter((t) => t.level === 'act').map((t) => t.id));
    const u = new Set([...A, ...B]); tu += u.size; for (const x of u) if (A.has(x) !== B.has(x)) tf++;
  }
  f.stability = { flips, act_tag_flips: `${tf}/${tu}` };
  // r1 vs r2 answers identical?
  let same = 0; let n = 0;
  for (let i = 0; i < jev.r1.scenes.length; i++) { n++; if (JSON.stringify(jev.r1.scenes[i].answers) === JSON.stringify(jev.r2.scenes[i]?.answers)) same++; }
  f.stability.identical_answer_scenes = `${same}/${n}`;

  // 7. costs from tokens
  const seg = J(path.join(OUT, `${slug}.segments.json`));
  const claims = J(path.join(OUT, `${slug}.claims.json`));
  const P = 0.042e-6;
  const su = seg.usage;
  const sonnet = ((su.input_tokens ?? 0) * 2 + (su.output_tokens ?? 0) * 10) / 1e6;
  const ccTok = claims.requests.filter((r) => r.ok !== false).reduce((s, r) => s + (r.input_tokens ?? 0), 0);
  const ccBilledAboveReserve = claims.requests.filter((r) => (r.input_tokens ?? 0) * P > (r.reserve_usd ?? Infinity) + 1e-12).length;
  const clTok = (run) => jev[run].scenes.flatMap((s) => s.requests ?? []).reduce((s, r) => s + (r.input_tokens ?? 0), 0);
  const clAbove = (run) => jev[run].scenes.flatMap((s) => s.requests ?? []).filter((r) => (r.input_tokens ?? 0) * P > (r.reserve_usd ?? Infinity) + 1e-12).length;
  const momReq = Object.values(mom.scenes).map((m) => m.request).filter(Boolean);
  const moTok = momReq.reduce((s, r) => s + (r.input_tokens ?? 0), 0);
  const moAbove = momReq.filter((r) => (r.input_tokens ?? 0) * P > (r.reserve_usd ?? Infinity) + 1e-12).length;
  const ledger = J(path.join(OUT, `${slug}.spend.json`));
  const led = (k) => ledger.entries.filter((e) => e.kind === k).reduce((s, e) => s + e.usd, 0);
  f.cost = {
    sonnet_from_tokens: r3x(sonnet), sonnet_reported: seg.cost_usd, sonnet_in: su.input_tokens, sonnet_out: su.output_tokens, sonnet_reserved: seg.reserved_usd,
    claim_tokens: ccTok, claim_usd_from_tokens: r3x(ccTok * P), claim_requests: claims.requests.length, claim_above_reserve: ccBilledAboveReserve,
    classify_r1_from_tokens: r3x(clTok('r1') * P), classify_r1_reported: jev.r1.cost_usd, classify_r1_above_reserve: clAbove('r1'),
    classify_r2_from_tokens: r3x(clTok('r2') * P), classify_r2_reported: jev.r2.cost_usd, classify_r2_above_reserve: clAbove('r2'),
    moments_from_tokens: r3x(moTok * P), moments_reported: mom.cost_usd, moments_usage_tokens: mom.usage?.input_tokens, moments_req_tokens: moTok, moments_above_reserve: moAbove,
    ledger_sonnet: r3x(led('sonnet')), ledger_jev: r3x(led('jev')),
  };
  f.cost.jev_from_tokens = r3x(ccTok * P + clTok('r1') * P + clTok('r2') * P + moTok * P);
  f.cost.total_from_tokens = r3x(sonnet + f.cost.jev_from_tokens);
  tot.sonnet_ledger += led('sonnet'); tot.jev_ledger += led('jev'); tot.sonnet_tokens += sonnet; tot.jev_tokens += f.cost.jev_from_tokens;

  // 8. verified share
  const sent = seg.scenes.flatMap((s) => s.sentences ?? []);
  const summ = seg.scenes.filter((s) => s.summary);
  f.verified = { sentences: `${sent.filter((x) => x.check?.status === 'verified').length}/${sent.length}`, scenes: `${summ.length}/${seg.scenes.length}`,
    minutes: `${r3(summ.reduce((a, s) => a + s.end_ms - s.start_ms, 0) / 60000)}/${r3(seg.scenes.reduce((a, s) => a + s.end_ms - s.start_ms, 0) / 60000)}`,
    summary_has_unverified_sentence: seg.scenes.filter((s) => s.summary && (s.sentences ?? []).some((x) => x.check?.status !== 'verified' && s.summary.includes(x.text))).map((s) => s.id) };
  report.films[slug] = f;
}
function r3x(x) { return Math.round(x * 1e6) / 1e6; }
report.totals = Object.fromEntries(Object.entries(tot).map(([k, v]) => [k, r3x(v)]));
report.totals.ledger_total = r3x(tot.sonnet_ledger + tot.jev_ledger);
report.totals.tokens_total = r3x(tot.sonnet_tokens + tot.jev_tokens);
fs.writeFileSync(path.join(VOUT, 'recompute.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 1));
