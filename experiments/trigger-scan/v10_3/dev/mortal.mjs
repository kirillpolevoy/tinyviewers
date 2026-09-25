#!/usr/bin/env node
// v10.3 fix (a) MEASUREMENT: the mortal-danger questions (mortal.js) on the 19 seen films (IN-SAMPLE; the Jev answers
// mortal.js --dev wrote to out103/dev from each film's stored segmentation; no model calls here).
//
// PRE-REGISTERED (written before any mortal answer existed; the tournament's tier-A rule, as dev/rule1.mjs in v10.2):
//   A scene FIRES for question q in state s at threshold t when p >= t (credits scenes are never asked). It is a HIT
//   when it overlaps (> 0 ms) a mapped, human-written key item (refs/<slug>.key.json, source != codex-rules) whose
//   categories include 'peril' (the group of the flag reasons these questions add; falls / nearly_falls /
//   caught_in_hazard are 'peril' too). Window = [min(start, gap_start), max(end, gap_end)].
//   precision = hits / fires. TIER A = precision >= 0.70 on >= 4 fires over the 19 films AND, when it fires on the
//   magic / afterlife films (coco, book-of-life, princess-and-the-frog), precision >= 0.60 there.
//   Thresholds tried: 0.6, 0.7, 0.8; the LOWEST passing one is used. Both states (L, LS) are tried; per question the
//   state with the passing threshold is used (if both pass, the one with more hits; a tie -> L, fewer inputs).
//   A question that never reaches 4 fires cannot show tier A alone. It is kept only as part of the COMBINED concept
//   (max over the kept questions of that reason id) when its own fires at that t are >= 0.70 precise and the
//   combined concept passes the tier-A test. Otherwise it is NOT used.
//   The S006 check (task): report p for incredibles S006 (bomb on Buddy's cape; train blast) and S005 (the jump)
//   for every question / state; if no kept bomb question fires on S006 at its threshold, its wording is not fixed
//   post hoc -- the finding is reported.
// Also reported: every fired scene (for a read of what fires), recall of 'peril' items overlapped, the fires and hits
// on the three round-8 films, and v10's tier-A falls concept on the same films as a reference.
//   node dev/mortal.mjs -> dev/out/mortal.json + a table
import fs from 'node:fs';
import path from 'node:path';
import { withConcepts } from '../select.js';
import { MORTAL_QS, MORTAL_REASONS, STATES } from '../mortal.js';
import { FILMS, loadFilm, mortalFile, rj, V103 } from '../eval/seen-lib.mjs';

const MAGIC = ['coco', 'book-of-life', 'princess-and-the-frog'];
const R8 = ['incredibles', 'big-hero-6', 'brave'];
const GROUP = 'peril';
const TS = [0.6, 0.7, 0.8];
const r3 = (x) => (x == null ? null : Math.round(x * 1000) / 1000);
const overlaps = (s, w) => Math.min(s.end_ms, w[1]) - Math.max(s.start_ms, w[0]) > 0;
function keyItems(fullKey) {
  return fullKey.items.filter((i) => i.source !== 'codex-rules' && i.human_written !== false && i.mappable && Number.isFinite(i.start_ms) && Number.isFinite(i.end_ms))
    .map((i) => ({ id: i.id, cats: i.categories ?? [], w: [Number.isFinite(i.gap_start_ms) ? Math.min(i.start_ms, i.gap_start_ms) : i.start_ms, Number.isFinite(i.gap_end_ms) ? Math.max(i.end_ms, i.gap_end_ms) : i.end_ms] }))
    .filter((i) => i.cats.includes(GROUP));
}
const films = FILMS.map((slug) => {
  const f = loadFilm(slug);
  const m = rj(mortalFile(slug));
  const scenes = f.seg.scenes.map((s) => {
    const row = f.rows.find((r) => r.id === s.id);
    const c = row?.answers ? withConcepts(row.answers, f.items).c ?? {} : {};
    return { id: s.id, start_ms: s.start_ms, end_ms: s.end_ms, m: m.scenes?.[s.id] ?? null, falls: c.falls ?? null };
  });
  return { slug, scenes, items: keyItems(f.fullKey) };
});
function evalQ(get, t, list) {
  let fires = 0; let hits = 0; let items = 0; const caught = new Set(); const fired = [];
  for (const F of list) {
    items += F.items.length;
    for (const s of F.scenes) {
      const p = get(s); if (p == null || p < t) continue;
      fires++;
      const ov = F.items.filter((i) => overlaps(s, i.w));
      if (ov.length) hits++;
      ov.forEach((i) => caught.add(`${F.slug}:${i.id}`));
      fired.push(`${F.slug}:${s.id}@${r3(p)}${ov.length ? '' : ' (miss)'}`);
    }
  }
  return { t, fires, hits, precision: fires ? r3(hits / fires) : null, recall: `${caught.size}/${items}`, fired };
}
const test = (get) => TS.map((t) => {
  const all = evalQ(get, t, films);
  const magic = evalQ(get, t, films.filter((F) => MAGIC.includes(F.slug)));
  const r8 = evalQ(get, t, films.filter((F) => R8.includes(F.slug)));
  return { t, all, magic: { fires: magic.fires, hits: magic.hits, precision: magic.precision }, round8: { fires: r8.fires, hits: r8.hits }, tier_a: all.fires >= 4 && all.precision >= 0.7 && (magic.fires === 0 || magic.precision >= 0.6) };
});
const rows = [];
for (const q of Object.keys(MORTAL_QS)) for (const st of STATES) {
  const get = (s) => s.m?.[`${q}@${st}`] ?? null;
  rows.push({ q, state: st, reason: MORTAL_REASONS[q].id, grid: test(get), pick: null });
}
for (const r of rows) r.pick = r.grid.find((g) => g.tier_a) ?? null;
// per question: the passing state (more hits; tie -> L)
const perQ = {};
for (const q of Object.keys(MORTAL_QS)) {
  const pass = rows.filter((r) => r.q === q && r.pick).sort((a, b) => b.pick.all.hits - a.pick.all.hits || (a.state === 'L' ? -1 : 1));
  perQ[q] = pass[0] ? { state: pass[0].state, t: pass[0].pick.t, alone: true } : null;
}
// combined concept per reason id: questions that could not reach 4 fires alone may join a passing combination
const combos = {};
for (const rid of [...new Set(Object.values(MORTAL_REASONS).map((r) => r.id))]) {
  const qs = Object.keys(MORTAL_QS).filter((q) => MORTAL_REASONS[q].id === rid);
  const passing = qs.filter((q) => perQ[q]);
  const small = [];
  for (const q of qs.filter((x) => !perQ[x])) {
    // lowest t and state where its own fires are >= 0.70 precise and < 4 (a question with >= 4 fires had its chance)
    let best = null;
    for (const st of STATES) for (const g of rows.find((r) => r.q === q && r.state === st).grid) {
      if (g.all.fires > 0 && g.all.fires < 4 && g.all.precision >= 0.7 && (g.magic.fires === 0 || g.magic.precision >= 0.6)) { if (!best || g.t < best.t || (g.t === best.t && g.all.hits > best.hits)) best = { q, state: st, t: g.t, hits: g.all.hits }; }
    }
    if (best) small.push(best);
  }
  const members = [...passing.map((q) => ({ q, ...perQ[q] })), ...small];
  if (!small.length || !members.length) { combos[rid] = { members: passing.map((q) => ({ q, ...perQ[q] })), combined_test: null }; continue; }
  const get = (s) => (s.m ? Math.max(...members.map((x) => ((s.m[`${x.q}@${x.state}`] ?? 0) >= x.t ? 1 : 0))) : null);
  const g = evalQ(get, 1, films); const mg = evalQ(get, 1, films.filter((F) => MAGIC.includes(F.slug)));
  const pass = g.fires >= 4 && g.precision >= 0.7 && (mg.fires === 0 || mg.precision >= 0.6);
  combos[rid] = { members: pass ? members : passing.map((q) => ({ q, ...perQ[q] })), tried: members, combined_test: { fires: g.fires, hits: g.hits, precision: g.precision, magic: `${mg.hits}/${mg.fires}`, pass, fired: g.fired } };
}
const kept = Object.values(combos).flatMap((c) => c.members.map((m) => ({ q: m.q, state: m.state, t: m.t })));
const incred = films.find((F) => F.slug === 'incredibles');
const s005 = incred?.scenes.find((s) => s.id === 'S005')?.m ?? null; const s006 = incred?.scenes.find((s) => s.id === 'S006')?.m ?? null;
const fallsRef = test((s) => s.falls);
const out = { generated_at: new Date().toISOString(), label: 'DEV-ONLY, IN-SAMPLE (19 seen films): mortal-danger questions vs the pre-registered tier-A rule', group: GROUP, magic: MAGIC, rows, per_question: perQ, combined: combos, decision: { kept, enabled: kept.length > 0 }, incredibles_S005: s005, incredibles_S006: s006, reference_v10_falls: fallsRef.map((g) => ({ t: g.t, fires: g.all.fires, hits: g.all.hits, precision: g.all.precision, tier_a: g.tier_a })) };
fs.mkdirSync(path.join(V103, 'dev', 'out'), { recursive: true });
fs.writeFileSync(path.join(V103, 'dev', 'out', 'mortal.json'), JSON.stringify(out, null, 2));
console.log(out.label);
for (const r of rows) console.log(`${r.q.padEnd(21)} @${r.state.padEnd(2)} ${r.grid.map((g) => `t${g.t}: ${g.all.hits}/${g.all.fires} (${g.all.precision}) magic ${g.magic.hits}/${g.magic.fires} r8 ${g.round8.hits}/${g.round8.fires}${g.tier_a ? ' A' : ''}`).join(' | ')}`);
console.log(`reference v10 falls: ${JSON.stringify(out.reference_v10_falls)}`);
console.log(`combined: ${JSON.stringify(Object.fromEntries(Object.entries(combos).map(([k, v]) => [k, { members: v.members, test: v.combined_test && { ...v.combined_test, fired: undefined } }])))}`);
console.log(`incredibles S005 ${JSON.stringify(s005)}\nincredibles S006 ${JSON.stringify(s006)}`);
console.log(`DECISION kept: ${JSON.stringify(kept)}`);
for (const r of rows) if (r.pick) console.log(`  fired ${r.q}@${r.state} t${r.pick.t}: ${r.pick.all.fired.join(', ')}`);
