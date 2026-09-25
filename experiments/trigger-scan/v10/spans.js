// Scene bounds and skip spans over WORDLESS action (v6). Pure code, no I/O.
//
// Round 1 finding (h): subtitle lines only mark where people talk. A segment ended at its last line,
// so the time between scenes belonged to no scene (Lion King 14.8 min), and moment spans started at
// their first line (+5 s pad), after the wordless action the line reacts to (the lioness stalking
// Pumbaa, Simba over the cliff edge, the stampede start).
//
// v6 rules (policy.json "wordless"):
//   SCENES   each scene runs from its first line to the NEXT scene's first line (the first scene from
//            0); the last scene ends at its last line. line_start_ms / line_end_ms keep the dialogue
//            bounds. (Adopted in v5.1; kept.)
//   LEAD-IN  when the first line of a skip span REACTS to action (a sound caption, a cry of alarm, a
//            short exclamation) and at least lead_in.min_gap_ms of silence precedes it, the span's
//            begin extends back over that silence, at most lead_in.max_ms (60 s), never past the end
//            of the previous subtitle line (so it never covers earlier dialogue). This may cross the
//            scene's start into the previous scene's trailing gap: the silence before a reaction
//            belongs to the event reacted to. Otherwise the begin pads back pad_back_ms (15 s),
//            clamped to the scene start.
//   TRAIL    a span that ends at the scene's last line runs on over the silence after it, to the
//            scene end but at most trail_max_ms (60 s) past the line; otherwise pad_ms (5 s).
//   WHOLE    a whole-scene skip (fallback) gets the same lead-in rule at its first line.
//   SONG     a span that begins or ends inside a SONG (a run of lyric lines, marked # or ♪, with at
//            most song.max_gap_lines spoken lines between lyric lines and at least song.min_lyric_lines
//            lyric lines) covers the whole song: a song is one moment (user policy example: "a
//            villain's song about killing"; Lion King 'Be Prepared', where the finder chose the two
//            spoken lines 'we're going to kill him... and Simba, too' in a three-minute song).

/** True when a cue has no spoken words: only sound captions / speaker tags / music marks. */
export function isCaptionOnly(text) {
  const spoken = String(text)
    .replace(/\([^)]*\)|\[[^\]]*\]/g, ' ')
    .replace(/^[\s-]*[A-Z][A-Z .'’]+:\s*/g, ' ')
    .replace(/[-–—:♪#*]/g, ' ');
  return !/[A-Za-z0-9]/.test(spoken);
}

// Sound captions of a physical reaction or of impact/action (not music, not ambient hums).
const ACTION_CAPTION = /[([][^)\]]*\b(scream|screams|screaming|shriek|shrieks|shrieking|gasp|gasps|gasping|yell|yells|yelling|shout|shouts|shouting|cry|cries|crying|sob|sobs|sobbing|whimper|whimpers|whimpering|roar|roars|roaring|growl|growls|growling|snarl|snarls|hiss|hisses|grunt|grunts|groan|groans|pant|pants|panting|yelp|yelps|howl|howls|crash|crashes|crashing|thud|thuds|splash|splashes|bang|bangs|explosion|explodes|rumbl\w*|thunder\w*|screech\w*|squeal\w*|struggl\w*|chomp\w*|snap\w*|bite|bites|strain\w*)\b[^)\]]*[)\]]/i;
// Spoken alarm: interjections and imperatives people shout at danger.
const ALARM = /\b(a+h+|a+a+h*|o+h+ no|no+!|help|look out|watch out|run|get out|go go|hurry|stop|whoa|yikes|ow+|ouch|argh|aagh|duck|jump|hold on|let (me|him|her|go)|get (away|off|back)|somebody|mom+y?|dad+y?)\b/i;

/**
 * Does a cue read as a REACTION to action happening now? Heuristic, deliberately narrow:
 *   - a sound caption naming a physical reaction or an impact ('(SCREAMS)', '(GROWLING)', '(CRASH)');
 *   - spoken alarm ('Help!', 'Look out!', 'Run!', 'No!', 'Aah!');
 *   - a short exclamation (<= 4 words ending in '!').
 */
export function reactsToAction(text) {
  const t = String(text ?? '');
  if (ACTION_CAPTION.test(t)) return true;
  const spoken = t.replace(/\([^)]*\)|\[[^\]]*\]/g, ' ').replace(/^[\s-]*[A-Z][A-Z .'’]+:\s*/g, ' ').trim();
  if (!spoken) return false;
  if (ALARM.test(spoken) && /!/.test(spoken)) return true;
  const w = spoken.replace(/[♪#*-]/g, ' ').trim().split(/\s+/).filter(Boolean);
  return w.length > 0 && w.length <= 4 && /!\s*["')\]]*$/.test(spoken);
}

export const isLyric = (text) => /[#♪]/.test(String(text ?? ''));

/**
 * Song blocks of a scene as [firstIdx, lastIdx] into `texts` (the scene's cue texts in order): lyric
 * lines joined across at most maxGap non-lyric lines, kept when they hold >= minLyrics lyric lines.
 */
export function songBlocks(texts, { min_lyric_lines: minLyrics = 6, max_gap_lines: maxGap = 8 } = {}) {
  const blocks = [];
  let cur = null;
  texts.forEach((t, i) => {
    if (!isLyric(t)) return;
    if (cur && i - cur.last - 1 <= maxGap) { cur.last = i; cur.n++; } else { if (cur) blocks.push(cur); cur = { first: i, last: i, n: 1 }; }
  });
  if (cur) blocks.push(cur);
  return blocks.filter((b) => b.n >= minLyrics).map((b) => [b.first, b.last]);
}

/** Widen line indices [bi, ei] to whole songs they begin or end in (policy wordless.song). */
export function widenOverSongs(bi, ei, texts, cfg) {
  const song = cfg.wordless?.song;
  if (!song) return [bi, ei];
  for (const [a, b] of songBlocks(texts, song)) {
    if (bi >= a && bi <= b) bi = a;
    if (ei >= a && ei <= b) ei = b;
  }
  return [bi, ei];
}

/**
 * Where a span that begins at cue `first` may start. `prev` = the cue right before it in the FILM
 * (null for the first cue). `floor` = the lowest start allowed without a lead-in (the scene start).
 * Returns { start_ms, lead_in: bool }.
 */
export function beginMs(first, prev, floor, cfg) {
  const w = cfg.wordless ?? {};
  const lead = w.lead_in;
  const gapFrom = prev ? prev.endMs : 0;
  if (lead && first.startMs - gapFrom >= lead.min_gap_ms && reactsToAction(first.text)) {
    return { start_ms: Math.min(floor, Math.max(gapFrom, first.startMs - lead.max_ms)), lead_in: true };
  }
  return { start_ms: Math.max(floor, first.startMs - (w.pad_back_ms ?? cfg.moments?.pad_ms ?? 5000)), lead_in: false };
}

/**
 * A skip span over lines [bi..ei] of a scene. lineIds/cuesById describe the scene's lines;
 * cueByIndex maps a global cue index to its cue (to find the line before the scene's first line).
 * scene = { start_ms, end_ms }. Returns { start_ms, end_ms, lead_in }.
 */
export function spanFromLines(bi, ei, lineIds, cuesById, scene, cfg, cueByIndex = null) {
  const w = cfg.wordless ?? {};
  [bi, ei] = widenOverSongs(bi, ei, lineIds.map((id) => cuesById.get(id).text), cfg);
  const first = cuesById.get(lineIds[bi]);
  const last = cuesById.get(lineIds[ei]);
  const prev = bi > 0 ? cuesById.get(lineIds[bi - 1]) : cueByIndex?.get(first.index - 1) ?? null;
  // floor without a lead-in: the scene start for the scene's first line, else the scene start too
  // (a plain pad never crosses into the previous scene)
  const floor = bi === 0 ? scene.start_ms : Math.max(scene.start_ms, first.startMs - (w.pad_back_ms ?? 15000));
  let b = beginMs(first, prev, bi === 0 ? scene.start_ms : floor, cfg);
  // v7 candidate (policy wordless.first_line_back_ms): a moment that begins at the scene's FIRST line
  // may be reacting to what happened just before the cut; pad back into the previous scene.
  if (bi === 0 && !b.lead_in && w.first_line_back_ms) b = { start_ms: Math.min(b.start_ms, Math.max(0, first.startMs - w.first_line_back_ms)), lead_in: false, cross_back: true };
  const pad = cfg.moments?.pad_ms ?? 5000;
  let stop = ei === lineIds.length - 1
    ? Math.min(scene.end_ms, Math.max(last.endMs + pad, last.endMs + (w.trail_max_ms ?? Infinity)))
    : Math.min(scene.end_ms, last.endMs + pad);
  let start = Math.min(b.start_ms, first.startMs);
  // v8 fix (a): extend each edge over an adjacent wordless peak (policy wordless.extend)
  let wordless = null;
  if (w.extend) {
    const sceneCues = lineIds.map((id) => cuesById.get(id));
    const e = wordlessEdge('end', sceneCues, ei, w.extend, { sceneEndMs: scene.end_ms, padMs: pad });
    const s = wordlessEdge('begin', sceneCues, bi, w.extend, { prevCue: cueByIndex?.get(sceneCues[0].index - 1) ?? (bi === 0 ? prev : null) });
    if (e && e.end_ms > stop) { stop = e.end_ms; wordless = { ...wordless, end_to: `L${e.to_index}` }; }
    if (s && s.start_ms < start) { start = s.start_ms; wordless = { ...wordless, begin_from: `L${s.from_index}` }; }
  }
  return { start_ms: start, end_ms: Math.max(stop, last.endMs), lead_in: b.lead_in, ...(wordless ? { wordless } : {}) };
}

// ---- v8 fix (a): WORDLESS PEAKS -----------------------------------------------------------------------
// Round 3: spans anchor on lines, so the scariest SILENT seconds next to a flagged moment fell outside
// the skip (Iron Giant: the deer is shot in a 33 s silence between two lines, 8 s before the line Jev
// picks as the moment's begin; Up: the storm peaks over ~70 s of captions and yells after the line
// where the child says he is scared). The lead-in rule only looked at the ONE gap right before the
// begin line.
//
// EXTEND (policy wordless.extend): each edge of a moment span may walk OUTWARD over the adjacent
// stretch of the scene, cue by cue, up to max_ms from the edge line, and stops at the FARTHEST
// candidate where the stretch between the edge and the candidate
//   - is mostly silence: no cue on screen for >= min_silence_share of it,
//   - holds a real wordless peak: one silence >= big_gap_ms,
//   - and something in it reacts to action (spans.js reactsToAction, or a caption-only cue), counting
//     the edge line itself (a begin line that cries out after a silence reacts to that silence).
// End side: the candidate is a later cue, the span ends at its end (+ pad_ms, clamped to the scene).
// Begin side: the candidate is the silence before an earlier cue, the span begins at the end of the
// cue before that silence (for the scene's first cue: the previous cue in the film, as the lead-in
// rule does; never over earlier dialogue). Pure code over the cue timing; no model calls.

/** Is a cue action-reactive for the extension (a reaction or a caption-only sound)? */
const actionCue = (c) => reactsToAction(c.text) || isCaptionOnly(c.text);

/**
 * How far one edge of a span may extend over an adjacent wordless peak.
 *   side 'end':   edge cue = cues[i]; candidates = cues[i+1..]; returns { end_ms, to_index, stretch_ms } | null
 *   side 'begin': edge cue = cues[i]; candidates = the silences before cues[i-1], cues[i-2], ... and, for
 *                 the scene's first cue, before it (prevCue = the previous cue in the film, or null);
 *                 returns { start_ms, from_index, stretch_ms } | null
 * cues = the scene's cues in order ({startMs, endMs, text, index}); ext = policy wordless.extend.
 */
export function wordlessEdge(side, cues, i, ext, { prevCue = null, sceneEndMs = Infinity, padMs = 5000 } = {}) {
  if (!ext) return null;
  const { max_ms: maxMs = 75000, min_silence_share: minSilence = 0.6, big_gap_ms: bigGap = 10000 } = ext;
  const edge = cues[i];
  let best = null;
  if (side === 'end') {
    let cueTime = 0; let maxGap = 0; let reactive = false; let prevEnd = edge.endMs;
    for (let j = i + 1; j < cues.length; j++) {
      const c = cues[j];
      if (c.endMs - edge.endMs > maxMs) break;
      maxGap = Math.max(maxGap, c.startMs - prevEnd);
      cueTime += c.endMs - c.startMs;
      prevEnd = c.endMs;
      reactive = reactive || actionCue(c);
      const stretch = c.endMs - edge.endMs;
      if (stretch > 0 && 1 - cueTime / stretch >= minSilence && maxGap >= bigGap && reactive) best = { end_ms: Math.min(sceneEndMs, c.endMs + padMs), to_index: c.index, stretch_ms: stretch };
    }
    return best;
  }
  // begin: walk back; the candidate at cue j covers the silence BEFORE cue j
  let cueTime = 0; let maxGap = 0; let reactive = actionCue(edge);
  for (let j = i; j >= 0; j--) {
    const c = cues[j];
    const before = j > 0 ? cues[j - 1] : prevCue;
    const silenceStart = before ? before.endMs : 0;
    if (edge.startMs - silenceStart > maxMs) break;
    if (j < i) { cueTime += c.endMs - c.startMs; reactive = reactive || actionCue(c); }
    maxGap = Math.max(maxGap, c.startMs - silenceStart);
    const stretch = edge.startMs - silenceStart;
    if (stretch > 0 && 1 - cueTime / stretch >= minSilence && maxGap >= bigGap && reactive) best = { start_ms: silenceStart, from_index: c.index, stretch_ms: stretch };
    if (!before) break;
  }
  return best;
}

/** Whole-scene skip span with the lead-in rule at the scene's first line. `cues` = the scene's cues. */
export function wholeSceneSpan(scene, cues, cfg, cueByIndex = null) {
  if (!cues?.length) return { start_ms: scene.start_ms, end_ms: scene.end_ms, lead_in: false };
  const first = cues[0];
  const prev = cueByIndex?.get(first.index - 1) ?? null;
  const b = beginMs(first, prev, scene.start_ms, cfg);
  return { start_ms: Math.min(b.start_ms, scene.start_ms), end_ms: scene.end_ms, lead_in: b.lead_in };
}

/** Merge overlapping or touching spans (gap <= gapMs). Extra fields of the first span are kept. */
export function unionSpans(spans, gapMs = 1000) {
  const s = spans.filter(Boolean).map((x) => ({ start_ms: x.start_ms, end_ms: x.end_ms, ...(x.lead_in ? { lead_in: true } : {}), ...(x.wordless ? { wordless: true } : {}) })).sort((a, b) => a.start_ms - b.start_ms);
  const out = [];
  for (const x of s) {
    const last = out[out.length - 1];
    if (last && x.start_ms <= last.end_ms + gapMs) { last.end_ms = Math.max(last.end_ms, x.end_ms); if (x.lead_in) last.lead_in = true; if (x.wordless) last.wordless = true; } else out.push(x);
  }
  return out;
}

/**
 * Scene time bounds: each scene runs to the next scene's start and the first starts at 0 (policy
 * scene_bounds). line_start_ms / line_end_ms keep the dialogue bounds.
 */
export function sceneBounds(rows, cfg) {
  const sb = cfg.scene_bounds ?? {};
  return rows.map((row, i) => {
    const next = rows[i + 1];
    const start = i === 0 && sb.first_from_zero ? 0 : row.start_ms;
    const end = next && sb.extend_to_next_start ? Math.max(row.end_ms, next.start_ms) : row.end_ms;
    return { start_ms: start, end_ms: end, line_start_ms: row.start_ms, line_end_ms: row.end_ms };
  });
}
