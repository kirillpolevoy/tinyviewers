// v10.3 fix (c): the SPAN BRIDGE across scene boundaries. Pure code, no model calls, no I/O.
//
// Round 8: moments that run over a scene boundary were cut at it. Big Hero 6's car plunging into the bay (~50:00)
// starts at the end of flagged S023, whose skip stops at the boundary, and lies mostly in the next scene; in Brave
// the Mor'du fight runs from flagged S061 into flagged S062, whose skip (its 'captured' moment) starts 33 s later, so
// the key moments between the two skips were missed. The moment finder cannot see past its own scene's lines.
// Rules (policy.json spans_bridge), applied after moments.js / respanScenes, per film, in time order:
//   GAP FILL  two ADJACENT FLAGGED scenes: when the first one's skip reaches its end (last span end >= scene end -
//             touch_ms) or the second one's skip reaches its start (first span start <= scene start + touch_ms), and
//             the gap between the two skips is <= gap_max_ms, the gap is skipped too (both sides are flagged-reason
//             moments; what lies between them is the same action crossing the boundary).
//   RUN-ON    a flagged scene whose skip reaches its end, followed by an UNFLAGGED scene: the skip runs on into the
//             next scene by at most run_ms (never past that scene's end); the same backwards into an unflagged
//             previous scene when the skip reaches the scene's start (at most run_ms, never before that scene's
//             start). `run_methods` limits RUN-ON to skips of those methods ('moments' = the finder's own lines
//             reach the boundary; 'whole_scene' fallbacks reach both boundaries by construction).
// Every added piece is recorded (bridge: [{ kind, start_ms, end_ms }]) and belongs to the scene it extends.
import { isCaptionOnly, reactsToAction } from './spans.js';

export const BRIDGE_VERSION = 'bridge-v10.3.0';
const calm = (c) => !isCaptionOnly(c.text) && !reactsToAction(c.text);

const union = (spans) => {
  const s = spans.map((x) => ({ ...x })).sort((a, b) => a.start_ms - b.start_ms);
  const out = [];
  for (const x of s) { const last = out.at(-1); if (last && x.start_ms <= last.end_ms) last.end_ms = Math.max(last.end_ms, x.end_ms); else out.push(x); }
  return out;
};

/**
 * scenes: every scene of the film in time order [{ id, start_ms, end_ms, flagged, skip: { method, spans } }]
 * (skip only on flagged scenes). cfg = policy.spans_bridge. Returns { [id]: { spans, added: [...], ms } } for every
 * flagged scene (spans unchanged when no rule applies). Pure.
 */
export function bridgeSpans(scenes, cfg, cues = null) {
  const out = {};
  for (const s of scenes) if (s.flagged) out[s.id] = { spans: (s.skip?.spans ?? []).map((x) => ({ start_ms: x.start_ms, end_ms: x.end_ms, ...(x.lead_in ? { lead_in: true } : {}) })), added: [] };
  if (!cfg?.enabled) { for (const v of Object.values(out)) v.ms = v.spans.reduce((a, x) => a + x.end_ms - x.start_ms, 0); return out; }
  const touch = cfg.touch_ms ?? 3000;
  const methods = cfg.run_methods ?? ['moments'];
  const lastEnd = (s) => Math.max(...(s.skip?.spans ?? []).map((x) => x.end_ms));
  const firstStart = (s) => Math.min(...(s.skip?.spans ?? []).map((x) => x.start_ms));
  const reachesEnd = (s) => (s.skip?.spans ?? []).length > 0 && lastEnd(s) >= s.end_ms - touch;
  const reachesStart = (s) => (s.skip?.spans ?? []).length > 0 && firstStart(s) <= s.start_ms + touch;
  const add = (id, kind, a, b) => { if (b > a) { out[id].spans.push({ start_ms: a, end_ms: b, bridge: kind }); out[id].added.push({ kind, start_ms: a, end_ms: b }); } };
  for (let i = 0; i < scenes.length; i++) {
    const s = scenes[i]; if (!s.flagged || !(s.skip?.spans ?? []).length) continue;
    const next = scenes[i + 1]; const prev = scenes[i - 1];
    if (next?.flagged && (next.skip?.spans ?? []).length && cfg.gap_max_ms > 0) {
      const a = lastEnd(s); const b = firstStart(next);
      if (b > a && b - a <= cfg.gap_max_ms && (reachesEnd(s) || reachesStart(next))) add(s.id, 'gap_fill', a, b);
    }
    const can = methods.includes(s.skip?.method === 'whole_scene_wordless' ? 'whole_scene' : String(s.skip?.method ?? '').replace('moments_unshown', 'moments'));
    if (can && cfg.run_ms > 0) {
      const speech = cfg.stop_at_speech && cues;
      if (next && !next.flagged && reachesEnd(s)) {
        let b = Math.min(lastEnd(s) + cfg.run_ms, next.end_ms);
        if (speech) { const c = cues.find((q) => q.startMs >= lastEnd(s) && q.startMs < b && calm(q)); if (c) b = c.startMs; }
        add(s.id, 'run_on', lastEnd(s), b);
      }
      if (prev && !prev.flagged && reachesStart(s)) {
        let a = Math.max(firstStart(s) - cfg.run_ms, prev.start_ms);
        if (speech) { const c = [...cues].reverse().find((q) => q.endMs <= firstStart(s) && q.endMs > a && calm(q)); if (c) a = c.endMs; }
        add(s.id, 'run_back', a, firstStart(s));
      }
    }
  }
  for (const v of Object.values(out)) { v.spans = union(v.spans).map(({ bridge, ...x }) => x); v.ms = v.spans.reduce((a, x) => a + x.end_ms - x.start_ms, 0); }
  return out;
}
