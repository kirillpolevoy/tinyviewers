#!/usr/bin/env node
// INDEPENDENT VERIFICATION of narrow/rescore.mjs (does NOT import it). Offline, no model calls.
// Uses only the frozen pipeline modules (select.js selectRun, moments.js respanScenes, refscore.js,
// parent-checks.js) plus stored round-5 outputs. Writes narrow/verify/out/verify.json.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSrt } from '../../../srt.js';
import { selectRun, loadPolicy } from '../../select.js';
import { respanScenes, clauseFor } from '../../moments.js';
import { loadSplit } from '../../split.js';
import { scoreKey, sensitivity, compareSystems, union, shareInside, inter } from '../../refscore.js';
import { checkWordlessPeaks, WORDLESS_SHARE } from '../../parent-checks.js';
import { ITEMS } from '../../questions.js';
import { freezeStatus } from '../../env.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const V9 = path.resolve(here, '../..');
const TS = path.resolve(V9, '..');
const OUT = path.join(V9, 'out');
const rj = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const r3 = (x) => (x == null ? null : Math.round(x * 1000) / 1000);
const FILMS = ['book-of-life', 'princess-and-the-frog', 'moana'];

// ---------- 1. the Jev set, recomputed mechanically from the round-4 scorecard ----------
const sc = rj(path.join(TS, 'v8', 'scorecard', 'scorecard.json'));
const qualifies = (minFires) => sc.held_out.questions
  .filter((q) => ['presence', 'event', 'film_template'].includes(q.layer))
  .filter((q) => q.at['0.7'].fires >= minFires && (q.at['0.7'].precision_proxy ?? 0) >= 0.75)
  .map((q) => q.question);
const SET4 = qualifies(4);
const SET3 = qualifies(3);
const declared = rj(path.join(V9, 'narrow', 'jev-set.json'));
const setCheck = {
  recomputed_ge4: SET4, declared_ge4: declared.jev_set,
  match_ge4: JSON.stringify([...SET4].sort()) === JSON.stringify([...declared.jev_set].sort()),
  recomputed_ge3: SET3, declared_ge3: declared.sensitivity_variant.jev_set,
  match_ge3: JSON.stringify([...SET3].sort()) === JSON.stringify([...declared.sensitivity_variant.jev_set].sort()),
};

// ---------- 2. routing ----------
const split = loadSplit();
const policy = loadPolicy();
const FLAGGERS = new Set([...policy.flag.strong_events, ...policy.flag.presence.always, ...policy.flag.presence.with_danger, ...policy.flag.presence.with_creature_threat]);
// what Jev actually answered in round 5 (any scene with a key)
const jevAnswered = new Set();
for (const slug of FILMS) for (const s of rj(path.join(OUT, `${slug}.jev.r1.json`)).scenes) if (s.answers) { for (const k of Object.keys(s.answers.e ?? {})) jevAnswered.add(k); for (const k of Object.keys(s.answers.pl ?? {})) jevAnswered.add(k); }

function routing(jevSet) {
  const asked = split.sonnet_asked;
  const toJev = asked.filter((q) => jevSet.includes(q) && jevAnswered.has(q));
  const used = asked.filter((q) => !toJev.includes(q));
  const flaggers = [...FLAGGERS];
  const dropped = flaggers.filter((q) => !asked.includes(q) && !jevSet.includes(q));
  const cfg = structuredClone(policy);
  const keep = (q) => !dropped.includes(q);
  cfg.flag.strong_events = cfg.flag.strong_events.filter(keep);
  for (const t of ['always', 'with_danger', 'with_creature_threat']) cfg.flag.presence[t] = cfg.flag.presence[t].filter(keep);
  cfg.flag.film_specific_types = []; // film:* templates all fail the bar
  return { toJev, used, dropped: dropped.sort(), newly_used_shadow: used.filter((q) => !split.sonnet_used.includes(q)), jevSet_no_jev_answer: jevSet.filter((q) => !jevAnswered.has(q)), cfg };
}

// ---------- 3. spans ----------
function spansFor(mode, tags, saved, cues, items, cfg) {
  if (mode === 'respan') return respanScenes({ tags, saved, cues, items, cfg });
  // 'stored_or_whole': the report's primary rule. 'asked_only': clauses of still-flagging reasons that were asked.
  const out = {};
  const respan = respanScenes({ tags, saved, cues, items, cfg });
  for (const s of tags.scenes.filter((x) => x.flagged)) {
    const old = saved.scenes?.[s.id];
    const clauses = [...new Set(s.flag_reasons.slice(0, cfg.moments.max_reasons).map((r) => clauseFor(r, items)))];
    const askedClauses = new Set((old?.answers ?? old?.per_reason ?? []).map((a) => a.clause));
    const allAsked = old && clauses.every((c) => askedClauses.has(c));
    if (mode === 'stored_or_whole') out[s.id] = allAsked ? { method: 'stored', spans: old.spans } : respan[s.id].method === 'whole_scene' ? respan[s.id] : { method: 'whole_scene', spans: [{ start_ms: s.whole_span?.start_ms ?? s.start_ms, end_ms: s.whole_span?.end_ms ?? s.end_ms }] };
    else if (mode === 'asked_only') {
      if (!old || !old.answers) { out[s.id] = respan[s.id]; continue; }
      const kept = s.flag_reasons.filter((r) => askedClauses.has(clauseFor(r, items)));
      if (!kept.length) { out[s.id] = respan[s.id]; continue; }
      const t2 = { scenes: [{ ...s, flag_reasons: kept }] };
      out[s.id] = respanScenes({ tags: t2, saved, cues, items, cfg })[s.id];
    }
  }
  return out;
}

// ---------- 4. run a system over the three films ----------
function runSystem(name, used, cfg, spanMode) {
  const films = [];
  for (const slug of FILMS) {
    const run = rj(path.join(OUT, `${slug}.jev.r1.json`));
    const sonnet = rj(path.join(OUT, `${slug}.sonnetq.r1.json`));
    const moments = rj(path.join(OUT, `${slug}.moments.r1.json`));
    const cues = parseSrt(fs.readFileSync(path.join(TS, 'data', `${slug}.srt`), 'utf8'));
    const tags = selectRun(run, cfg, { moments, cues, sonnet, used });
    const sp = spanMode === 'frozen' ? null : spansFor(spanMode, tags, moments, cues, run.film_items ?? [], cfg);
    const flagged = tags.scenes.filter((s) => s.flagged).map((s) => ({ ...s, skipSpans: sp ? sp[s.id].spans : s.skip.spans, skipMethod: sp ? sp[s.id].method : s.skip.method }));
    films.push({ slug, tags, flagged });
  }
  return { name, films };
}

// ---------- 5. scoring ----------
const humanKey = (slug) => { const k = rj(path.join(TS, 'refs', `${slug}.key.json`)); return { ...k, items: k.items.filter((i) => i.source !== 'codex-rules') }; };
const liveSkipOf = (slug) => rj(path.join(V9, 'round5', 'live', `${slug}.built.json`)).scenes.map((s) => [s.start_ms, s.end_ms]);
const skipOf = (f) => f.flagged.flatMap((s) => s.skipSpans.map((x) => [x.start_ms, x.end_ms]));
const isSF = (i) => i.mappable && Number.isFinite(i.start_ms) && i.should_flag === true;
const gapWin = (i) => [Math.min(i.start_ms, i.gap_start_ms ?? i.start_ms), Math.max(i.end_ms, i.gap_end_ms ?? i.end_ms)];

function allWordless(key, skip) {
  const U = union(skip);
  const rows = key.items.filter((i) => isSF(i) && i.wordless);
  return { n: rows.length, covered: rows.filter((i) => shareInside(i.start_ms, i.end_ms, U) >= WORDLESS_SHARE).length };
}

function score(A, B = null) {
  const per = [];
  const pool = { a: [], b: [], items: [] };
  FILMS.forEach((slug, k) => {
    const off = k * 1e8;
    const key = humanKey(slug);
    const fa = A.films.find((f) => f.slug === slug);
    const aSkip = skipOf(fa);
    const bSkip = B ? skipOf(B.films.find((f) => f.slug === slug)) : liveSkipOf(slug);
    const liveSkip = liveSkipOf(slug);
    const aS = scoreKey(key, aSkip, { liveDb: liveSkip }), aG = scoreKey(key, aSkip, { liveDb: liveSkip, window: 'gap' });
    const bS = scoreKey(key, bSkip, { liveDb: liveSkip }), bG = scoreKey(key, bSkip, { liveDb: liveSkip, window: 'gap' });
    const v = compareSystems({ aStrict: aS, aGap: aG, bStrict: bS, bGap: bG, sens: sensitivity(key, aSkip, bSkip) });
    // per-scene provenance / hold
    const sfItems = key.items.filter(isSF);
    const prov = { jev_only: { n: 0, hold: 0, found: 0, ms: 0 }, sonnet_only: { n: 0, hold: 0, found: 0, ms: 0 }, both: { n: 0, hold: 0, found: 0, ms: 0 } };
    const sceneRows = fa.flagged.map((s) => {
      const bys = new Set(s.flag_reasons.map((r) => r.by));
      const cls = bys.size === 2 ? 'both' : bys.has('jev') ? 'jev_only' : 'sonnet_only';
      const U = union(s.skipSpans.map((x) => [x.start_ms, x.end_ms]));
      const hold = sfItems.filter((i) => inter([gapWin(i)], U) > 0).map((i) => i.id);
      const found = sfItems.filter((i) => shareInside(...gapWin(i), U) >= 0.5).map((i) => i.id);
      prov[cls].n++; if (hold.length) prov[cls].hold++; prov[cls].found += found.length; prov[cls].ms += U.reduce((t, [a, b]) => t + b - a, 0);
      return { id: s.id, cls, reasons: s.flag_reasons.map((r) => `${r.id}${r.by === 'sonnet' ? '{S}' : ''}`), method: s.skipMethod, skip_min: r3(U.reduce((t, [a, b]) => t + b - a, 0) / 60000), hold };
    });
    for (const c of Object.values(prov)) c.min = r3(c.ms / 60000);
    per.push({ slug, flagged: fa.flagged.length, a: { strict: aS, gap: aG }, b: { strict: bS, gap: bG }, verdict: v, prov, sceneRows,
      wordless: { a: allWordless(key, aSkip), b: allWordless(key, bSkip), a_in_flagged: checkWordlessPeaks(key, fa.flagged.map((s) => ({ ...s })), aSkip) },
      missedA: aS.missed.map((m) => m.id) });
    const sh = ([a, b]) => [a + off, b + off];
    pool.a.push(...aSkip.map(sh)); pool.b.push(...bSkip.map(sh));
    for (const it of key.items) { const o = { ...it, id: `${slug}:${it.id}`, same_moment_as: (it.same_moment_as ?? []).map((x) => `${slug}:${x}`) }; for (const f of ['start_ms', 'end_ms', 'gap_start_ms', 'gap_end_ms']) if (Number.isFinite(it[f])) o[f] = it[f] + off; pool.items.push(o); }
  });
  const pk = { items: pool.items, film_level: [] };
  const PA = scoreKey(pk, pool.a), PAg = scoreKey(pk, pool.a, { window: 'gap' });
  const PB = scoreKey(pk, pool.b), PBg = scoreKey(pk, pool.b, { window: 'gap' });
  const sens = sensitivity(pk, pool.a, pool.b);
  const verdict = compareSystems({ aStrict: PA, aGap: PAg, bStrict: PB, bGap: PBg, sens });
  return { per, pooled: { PA, PAg, PB, PBg, verdict, sens } };
}

const brief = (S, G) => ({ recall_strict: S.recall_items.found, recall_gap: G.recall_items.found, cons: Math.min(S.recall_items.found, G.recall_items.found), of: S.recall_items.of, precision: `${S.precision_proxy_ref_only}/${G.precision_proxy_ref_only}`, skip: S.skip_minutes, comic: `${S.tag_only.flagged}/${S.tag_only.items}` });

// ---------- 6. per-question table (scorecard method, gap window, scene spans, any key item in group) ----------
function questionTable(sys, qs) {
  const rows = {};
  for (const q of qs) rows[q] = { fires: 0, right: 0, caught: new Set(), groupItems: 0, flagRows: 0, flagHold: 0, per: {} };
  for (const f of sys.films) {
    const key = humanKey(f.slug);
    const items = key.items.filter((i) => i.mappable && Number.isFinite(i.start_ms) && i.human_written !== false);
    const sfItems = key.items.filter(isSF);
    for (const q of qs) {
      const g = ITEMS[q]?.group;
      const gi = items.filter((i) => (i.categories ?? []).includes(g));
      rows[q].groupItems += gi.length;
      let fires = 0, right = 0;
      for (const s of f.tags.scenes) {
        const t = (s.tags ?? []).find((x) => x.id === q && x.level === 'act');
        if (!t) continue;
        fires++;
        const hit = gi.filter((i) => inter([gapWin(i)], [[s.start_ms, s.end_ms]]) > 0);
        if (hit.length) right++;
        hit.forEach((i) => rows[q].caught.add(`${f.slug}:${i.id}`));
      }
      for (const s of f.flagged) if (s.flag_reasons.some((r) => r.id === q)) { rows[q].flagRows++; const U = union(s.skipSpans.map((x) => [x.start_ms, x.end_ms])); if (sfItems.some((i) => inter([gapWin(i)], U) > 0)) rows[q].flagHold++; }
      rows[q].fires += fires; rows[q].right += right; rows[q].per[f.slug] = `${right}/${fires}`;
      rows[q].by = f.tags.scenes.flatMap((s) => s.tags ?? []).find((x) => x.id === q)?.by ?? rows[q].by;
    }
  }
  return Object.fromEntries(Object.entries(rows).map(([q, r]) => [q, { by: r.by, fires: r.fires, right: r.right, precision: r.fires ? r3(r.right / r.fires) : null, catches: `${r.caught.size}/${r.groupItems}`, flags_hold: `${r.flagRows}/${r.flagHold}`, per: r.per }]));
}

// ---------- run ----------
const log = [];
const P = (...a) => { const s = a.join(' '); log.push(s); console.log(s); };

P('JEV SET CHECK', JSON.stringify(setCheck));

const v9Frozen = runSystem('v9', split.sonnet_used, policy, 'frozen');
// reproduction vs the frozen tags files
for (const f of v9Frozen.films) {
  const frozen = rj(path.join(OUT, `${f.slug}.tags.r1.json`));
  const a = f.flagged.map((s) => `${s.id}:${s.flag_reasons.map((r) => r.id).join(',')}:${s.skipSpans.map((x) => `${x.start_ms}-${x.end_ms}`).join('|')}`).join(';');
  const b = frozen.scenes.filter((s) => s.flagged).map((s) => `${s.id}:${s.flag_reasons.map((r) => r.id).join(',')}:${s.skip.spans.map((x) => `${x.start_ms}-${x.end_ms}`).join('|')}`).join(';');
  P(`repro ${f.slug}: flags+reasons+spans identical to frozen tags = ${a === b}; flagged ${f.flagged.length}`);
}
// respan rule applied to v9 itself should reproduce stored spans
const v9Respan = runSystem('v9-respan', split.sonnet_used, policy, 'respan');
for (const f of v9Respan.films) { const g = v9Frozen.films.find((x) => x.slug === f.slug); const diff = f.flagged.filter((s, i) => JSON.stringify(s.skipSpans.map((x) => [x.start_ms, x.end_ms])) !== JSON.stringify(g.flagged[i].skipSpans.map((x) => [x.start_ms, x.end_ms]))).map((s) => s.id); P(`respan(v9) ${f.slug}: scenes whose respanned spans differ from stored: ${diff.join(',') || 'none'}`); }

const R4 = routing(SET4);
const R3 = routing(SET3);
P('ROUTING ge4: toJev', R4.toJev.join(','), '| sonnet used', R4.used.length, '| newly used shadow', R4.newly_used_shadow.length, R4.newly_used_shadow.join(','), '| set w/o jev answer', R4.jevSet_no_jev_answer.join(','), '| dropped', R4.dropped.length, R4.dropped.join(','));

const systems = {};
for (const mode of ['stored_or_whole', 'respan', 'asked_only']) systems[`narrow_${mode}`] = runSystem(`narrow_${mode}`, R4.used, R4.cfg, mode);
systems.narrow3_stored_or_whole = runSystem('narrow3', R3.used, R3.cfg, 'stored_or_whole');
systems.narrow3_respan = runSystem('narrow3r', R3.used, R3.cfg, 'respan');

const results = { setCheck, routing: { ge4: { ...R4, cfg: undefined }, ge3: { ...R3, cfg: undefined } } };
const v9VsLive = score(v9Frozen);
P(`\nv9 frozen vs live: v9 ${JSON.stringify(brief(v9VsLive.pooled.PA, v9VsLive.pooled.PAg))} live ${JSON.stringify(brief(v9VsLive.pooled.PB, v9VsLive.pooled.PBg))} verdict R ${v9VsLive.pooled.verdict.recall} P ${v9VsLive.pooled.verdict.precision}`);
results.v9_vs_live = { pooled: { v9: brief(v9VsLive.pooled.PA, v9VsLive.pooled.PAg), live: brief(v9VsLive.pooled.PB, v9VsLive.pooled.PBg), verdict: v9VsLive.pooled.verdict, sens: v9VsLive.pooled.sens }, per: v9VsLive.per.map((p) => ({ slug: p.slug, v9: brief(p.a.strict, p.a.gap), live: brief(p.b.strict, p.b.gap), prov: p.prov, wordless: p.wordless, flagged: p.flagged, sceneRows: p.sceneRows })) };

for (const [name, sys] of Object.entries(systems)) {
  const vl = score(sys); const vv = score(sys, v9Frozen);
  const fl = sys.films.reduce((a, f) => a + f.flagged.length, 0);
  const newly = sys.films.flatMap((f) => f.flagged.filter((s) => !v9Frozen.films.find((g) => g.slug === f.slug).flagged.some((x) => x.id === s.id)).map((s) => `${f.slug}:${s.id}`));
  const methods = sys.films.flatMap((f) => f.flagged.map((s) => s.skipMethod)).reduce((o, m) => ((o[m] = (o[m] ?? 0) + 1), o), {});
  const wl = vl.per.reduce((a, p) => [a[0] + p.wordless.a.covered, a[1] + p.wordless.a.n], [0, 0]);
  P(`\n${name}: flagged ${fl}, newly flagged ${newly.length} ${newly.join(',')}; methods ${JSON.stringify(methods)}`);
  P(`  pooled ${JSON.stringify(brief(vl.pooled.PA, vl.pooled.PAg))} wordless ${wl.join('/')}`);
  P(`  vs live: R ${vl.pooled.verdict.recall} (lt ${vl.pooled.sens.recall_diff_a_minus_b.share_a_lt_b}, p05..p95 ${vl.pooled.sens.recall_diff_a_minus_b.p05}..${vl.pooled.sens.recall_diff_a_minus_b.p95}) P ${vl.pooled.verdict.precision} (gt ${vl.pooled.sens.precision_diff_a_minus_b.share_a_gt_b} lt ${vl.pooled.sens.precision_diff_a_minus_b.share_a_lt_b}) overall ${vl.pooled.verdict.overall}`);
  P(`  vs v9:   R ${vv.pooled.verdict.recall} (lt ${vv.pooled.sens.recall_diff_a_minus_b.share_a_lt_b}, p05..p95 ${vv.pooled.sens.recall_diff_a_minus_b.p05}..${vv.pooled.sens.recall_diff_a_minus_b.p95}) P ${vv.pooled.verdict.precision} (gt ${vv.pooled.sens.precision_diff_a_minus_b.share_a_gt_b}, p05..p95 ${vv.pooled.sens.precision_diff_a_minus_b.p05}..${vv.pooled.sens.precision_diff_a_minus_b.p95}) overall ${vv.pooled.verdict.overall}`);
  const provP = vl.per.reduce((o, p) => { for (const [k, c] of Object.entries(p.prov)) { o[k] ??= { n: 0, hold: 0, found: 0, ms: 0 }; o[k].n += c.n; o[k].hold += c.hold; o[k].found += c.found; o[k].ms += c.ms; } return o; }, {});
  for (const c of Object.values(provP)) c.min = r3(c.ms / 60000);
  P(`  provenance ${JSON.stringify(provP)}`);
  for (const p of vl.per) {
    const v9p = v9VsLive.per.find((x) => x.slug === p.slug);
    const lost = v9p.a.strict.missed.map((m) => m.id); const nowMissed = p.missedA.filter((id) => !lost.includes(id));
    P(`  ${p.slug}: flagged ${p.flagged} ${JSON.stringify(brief(p.a.strict, p.a.gap))} wordless ${p.wordless.a.covered}/${p.wordless.a.n}; vs live R ${p.verdict.recall} P ${p.verdict.precision} overall ${p.verdict.overall}; newly missed (strict) ${nowMissed.join(',')}; prov ${JSON.stringify(Object.fromEntries(Object.entries(p.prov).map(([k, c]) => [k, `${c.n}/${c.hold}h/${c.found}f/${c.min}m`])))}`);
    const dropped = v9p.sceneRows.filter((r) => !p.sceneRows.some((x) => x.id === r.id));
    P(`    dropped scenes: ${dropped.map((r) => `${r.id}[${r.reasons.join('+')}]${r.hold.length ? `(held ${r.hold.join(',')})` : ''}`).join('; ')}`);
  }
  results[name] = { flagged: fl, newly, methods, pooled: brief(vl.pooled.PA, vl.pooled.PAg), wordless: wl, vs_live: { verdict: vl.pooled.verdict, sens: vl.pooled.sens }, vs_v9: { verdict: vv.pooled.verdict, sens: vv.pooled.sens }, provenance: provP,
    per: vl.per.map((p) => ({ slug: p.slug, flagged: p.flagged, ...brief(p.a.strict, p.a.gap), live: brief(p.b.strict, p.b.gap), verdict_vs_live: p.verdict, wordless: p.wordless, prov: p.prov, sceneRows: p.sceneRows, missed_strict: p.missedA })) };
}

// v9 provenance
{
  const provP = v9VsLive.per.reduce((o, p) => { for (const [k, c] of Object.entries(p.prov)) { o[k] ??= { n: 0, hold: 0, found: 0, ms: 0 }; o[k].n += c.n; o[k].hold += c.hold; o[k].found += c.found; o[k].ms += c.ms; } return o; }, {});
  for (const c of Object.values(provP)) c.min = r3(c.ms / 60000);
  P(`\nv9 provenance ${JSON.stringify(provP)}`);
  for (const p of v9VsLive.per) P(`  ${p.slug} v9 ${JSON.stringify(brief(p.a.strict, p.a.gap))} live ${JSON.stringify(brief(p.b.strict, p.b.gap))} wordless v9 ${p.wordless.a.covered}/${p.wordless.a.n} live ${p.wordless.b.covered}/${p.wordless.b.n} prov ${JSON.stringify(Object.fromEntries(Object.entries(p.prov).map(([k, c]) => [k, `${c.n}/${c.hold}h/${c.min}m`])))}`);
  results.v9_provenance = provP;
}

// per-question tables
const qt = questionTable(systems.narrow_stored_or_whole, [...SET4, 'caught_in_hazard', 'dies']);
P('\nQUESTION TABLE (narrow, Jev set):'); for (const [q, r] of Object.entries(qt)) P(`  ${q.padEnd(18)} by ${r.by} fires ${r.fires} right ${r.right} prec ${r.precision} catches ${r.catches} flags/hold ${r.flags_hold} ${JSON.stringify(r.per)}`);
const qtV9 = questionTable(v9Frozen, ['afraid_for_safety', 'dark_magic', 'believed_dead', 'blade_weapon', 'fire', 'explosion']);
P('QUESTION TABLE (v9 frozen, for comparison):'); for (const [q, r] of Object.entries(qtV9)) P(`  ${q.padEnd(18)} by ${r.by} fires ${r.fires} right ${r.right} prec ${r.precision} flags/hold ${r.flags_hold}`);
// v9 reasons outside the set: scenes with reason, held, alone
for (const q of ['afraid_for_safety', 'dark_magic', 'believed_dead']) {
  let n = 0, h = 0, alone = 0, aloneH = 0;
  for (const p of v9VsLive.per) for (const r of p.sceneRows) if (r.reasons.includes(q)) { n++; if (r.hold.length) h++; if (r.reasons.length === 1) { alone++; if (r.hold.length) aloneH++; } }
  P(`  v9 reason ${q}: hold ${h}/${n}, alone ${aloneH}/${alone}`);
}
results.question_table = qt; results.question_table_v9 = qtV9;
results.freeze = freezeStatus();
P(`\nfreezeStatus ${JSON.stringify(results.freeze).slice(0, 300)}`);
fs.mkdirSync(path.join(here, 'out'), { recursive: true });
fs.writeFileSync(path.join(here, 'out', 'verify.json'), JSON.stringify(results, null, 1));
fs.writeFileSync(path.join(here, 'out', 'verify.log'), log.join('\n'));
