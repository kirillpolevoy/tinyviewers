#!/usr/bin/env node
// ROUND 8 DIAGNOSTIC ONLY (not a variant under test, no model calls, frozen files untouched): what the tier-A gate cost on
// the fresh films. Adds back every scene the gate turned into tags only (gated_reasons non-empty, not flagged), with its
// WHOLE scene as the skip (moments were never asked for it), and rescores recall / precision / skip vs live with the same
// refscore.js functions. Writes round8/out/diag-ungated.json.
import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
import { scoreKey, sensitivity, compareSystems } from '../refscore.js';
const here = path.dirname(fileURLToPath(import.meta.url)); const V = path.resolve(here, '..'); const TS = path.resolve(V, '..');
const rj = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const FILMS = ['incredibles', 'big-hero-6', 'brave'];
const pool = { a: [], b: [], items: [] }; const per = {};
FILMS.forEach((slug, k) => {
  const off = k * 1e8; const full = rj(path.join(TS, 'refs', `${slug}.key.json`)); const key = { ...full, items: full.items.filter((i) => i.source !== 'codex-rules') };
  const tags = rj(path.join(V, 'out102', `${slug}.tags.r1.json`)); const live = rj(path.join(here, 'live', `${slug}.built.json`)).scenes.map((s) => [s.start_ms, s.end_ms]);
  const flagged = tags.scenes.filter((s) => s.flagged).flatMap((s) => (s.skip?.spans ?? []).map((x) => [x.start_ms, x.end_ms]));
  const gatedOnly = tags.scenes.filter((s) => !s.flagged && (s.gated_reasons ?? []).length);
  const a = [...flagged, ...gatedOnly.map((s) => [s.start_ms, s.end_ms])];
  const S = scoreKey(key, a, { liveDb: live }); const G = scoreKey(key, a, { liveDb: live, window: 'gap' }); const bS = scoreKey(key, live); const bG = scoreKey(key, live, { window: 'gap' });
  per[slug] = { gated_only_scenes: gatedOnly.map((s) => `${s.id}:${s.gated_reasons.map((r) => r.id).join('+')}`), recall: `${Math.min(S.recall_items.found, G.recall_items.found)}/${S.recall_items.of}`, live_recall: `${Math.min(bS.recall_items.found, bG.recall_items.found)}/${bS.recall_items.of}`, precision: `${S.precision_proxy_ref_only}/${G.precision_proxy_ref_only}`, skip: S.skip_minutes, live_skip: bS.skip_minutes };
  const sh = ([x, y]) => [x + off, y + off]; pool.a.push(...a.map(sh)); pool.b.push(...live.map(sh));
  for (const it of key.items) { const o = { ...it, id: `${slug}:${it.id}`, same_moment_as: (it.same_moment_as ?? []).map((x) => `${slug}:${x}`) }; for (const f of ['start_ms', 'end_ms', 'gap_start_ms', 'gap_end_ms']) if (Number.isFinite(it[f])) o[f] = it[f] + off; pool.items.push(o); }
});
const pk = { items: pool.items, film_level: [] };
const A = scoreKey(pk, pool.a, { liveDb: pool.b }); const Ag = scoreKey(pk, pool.a, { liveDb: pool.b, window: 'gap' }); const B = scoreKey(pk, pool.b); const Bg = scoreKey(pk, pool.b, { window: 'gap' });
const sens = sensitivity(pk, pool.a, pool.b); const v = compareSystems({ aStrict: A, aGap: Ag, bStrict: B, bGap: Bg, sens });
const out = { label: 'DIAGNOSTIC: v10.2 flags + gated-only scenes (whole scene); not a tested variant', per_film: per, pooled: { recall: `${v.conservative_recall.a} vs live ${v.conservative_recall.b}/${v.conservative_recall.of}`, recall_verdict: v.recall, precision: `${A.precision_proxy_ref_only}/${Ag.precision_proxy_ref_only} vs ${B.precision_proxy_ref_only}/${Bg.precision_proxy_ref_only}`, precision_verdict: v.precision, skip: `${A.skip_minutes} vs ${B.skip_minutes}` } };
fs.writeFileSync(path.join(here, 'out', 'diag-ungated.json'), JSON.stringify(out, null, 2)); console.log(JSON.stringify(out, null, 1));
