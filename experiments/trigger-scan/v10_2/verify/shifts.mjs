#!/usr/bin/env node
// VERIFIER: whole-key shift sensitivity (own code) and how many should_flag key items share an exact edge with a live
// scene boundary vs a v10.2 skip-span boundary. Explains why pooled recall is 86 vs 93 at 0 s but v10.2 leads under
// every shift and in 90% of jitter runs. No model calls. Writes verify/out/shifts.json.
import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url)); const V = path.resolve(here, '..'); const TS = path.resolve(V, '..');
const rj = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
function merge(sp) { const s = sp.map((x) => [...x]).sort((a, b) => a[0] - b[0]); const o = []; for (const [a, b] of s) { if (o.length && a <= o[o.length - 1][1]) o[o.length - 1][1] = Math.max(o[o.length - 1][1], b); else o.push([a, b]); } return o; }
function ov(s, e, u) { if (e <= s) return u.some(([a, b]) => s >= a && s <= b) ? 1 : 0; let t = 0; for (const [a, b] of u) t += Math.max(0, Math.min(b, e) - Math.max(a, s)); return t / (e - s); }
const out = {}; const tot = {};
for (const slug of ['incredibles', 'big-hero-6', 'brave']) {
  const key = rj(path.join(TS, 'refs', `${slug}.key.json`)); const items = key.items.filter((i) => i.source !== 'codex-rules' && i.mappable && Number.isFinite(i.start_ms) && Number.isFinite(i.end_ms) && i.should_flag === true);
  const tags = rj(path.join(V, 'out102', `${slug}.tags.r1.json`)); const built = rj(path.join(V, 'round8', 'live', `${slug}.built.json`));
  const A = merge(tags.scenes.filter((s) => s.flagged).flatMap((s) => s.skip.spans.map((x) => [x.start_ms, x.end_ms]))); const B = merge(built.scenes.map((s) => [s.start_ms, s.end_ms]));
  const row = {};
  for (const d of [-30, -15, -5, -2, 0, 2, 5, 15, 30]) { const sh = items.map((i) => [i.start_ms + d * 1000, i.end_ms + d * 1000]); row[`${d}s`] = `${sh.filter(([s, e]) => ov(s, e, A) >= 0.5).length} vs ${sh.filter(([s, e]) => ov(s, e, B) >= 0.5).length}`; tot[`${d}s`] ??= [0, 0]; tot[`${d}s`][0] += sh.filter(([s, e]) => ov(s, e, A) >= 0.5).length; tot[`${d}s`][1] += sh.filter(([s, e]) => ov(s, e, B) >= 0.5).length; }
  const edgesB = new Set(built.scenes.flatMap((s) => [s.start_ms, s.end_ms])); const edgesA = new Set(tags.scenes.filter((s) => s.flagged).flatMap((s) => s.skip.spans.flatMap((x) => [x.start_ms, x.end_ms])));
  const near = (t, E, tol) => [...E].some((x) => Math.abs(x - t) <= tol);
  const zeroLen = items.filter((i) => i.end_ms <= i.start_ms).length;
  const liveFoundNotV = items.filter((i) => ov(i.start_ms, i.end_ms, B) >= 0.5 && ov(i.start_ms, i.end_ms, A) < 0.5);
  out[slug] = { should_flag: items.length, shifts_v102_vs_live: row, zero_length_items: zeroLen, items_with_edge_on_live_boundary: items.filter((i) => near(i.start_ms, edgesB, 0) || near(i.end_ms, edgesB, 0)).length, items_with_edge_on_v102_boundary: items.filter((i) => near(i.start_ms, edgesA, 0) || near(i.end_ms, edgesA, 0)).length,
    live_only_found: liveFoundNotV.map((i) => ({ id: i.id, dur_s: Math.round((i.end_ms - i.start_ms) / 1000), share_live: Math.round(ov(i.start_ms, i.end_ms, B) * 100) / 100, share_v: Math.round(ov(i.start_ms, i.end_ms, A) * 100) / 100, live_share_at_minus15: Math.round(ov(i.start_ms - 15000, i.end_ms - 15000, B) * 100) / 100, live_share_at_plus15: Math.round(ov(i.start_ms + 15000, i.end_ms + 15000, B) * 100) / 100 })) };
}
out.pooled_shifts = Object.fromEntries(Object.entries(tot).map(([k, [a, b]]) => [k, `${a} vs ${b}`]));
fs.writeFileSync(path.join(here, 'out', 'shifts.json'), JSON.stringify(out, null, 2)); console.log(JSON.stringify(out, null, 1));
