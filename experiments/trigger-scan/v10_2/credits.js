// v10.1 END-CREDITS SPAN. Pure code over the parsed SRT (no model, no segmentation input), so the same span
// is found by the split gate (gate.js codeMetrics), by classify / sonnetq (credits scenes are not asked) and
// by select.js (credits scenes get no flags).
//
// Round-6 finding: Frozen and Zootopia got NO guide because the split gate's max_scene_minutes (10) rejected
// the model's last "scene", which was the end credits: captioned credit songs running 10.6-10.9 minutes. A
// credits roll is not a scene a parent skips, and it is not evidence of a broken split.
//
// RULE (set on the 14 dev films' SRTs only; test/v101-credits.test.js):
//   1. Only the TAIL of the film is searched: cues starting at or after max(tail_share x film end,
//      film end - tail_max_ms).
//   2. Each tail cue is labelled
//        credit   a subtitle credit or copyright line ("Subtitles by", "Copyright", a URL, "Hope you enjoyed")
//        music    a lyric marker (♪ ♫, a leading / trailing # or *) or a caption about music or singing
//        lyric    an unmarked line that reads like a lyric: no speaker label, no dialogue dash, and no
//                 sentence-final punctuation (. ? ! … " ) -- or the exact same words (>= 2) as another tail
//                 line (a chorus)
//        caption  another sound caption "( ... )" / "[ ... ]" (neutral)
//        speech   everything else
//      credit / music / lyric count 1 as song-like, caption counts caption_weight, speech 0.
//   3. Candidate blocks, each trimmed to start and end on a song-like cue:
//      (A) a cue is IN A SONG when the window of `window` cues around it has song-like share >= min_share;
//          maximal runs of in-song cues (a sung credits song, marked or not);
//      (B) maximal runs with NO spoken cue that hold >= min_run_song_cues song-like cues (a credits roll that
//          is captioned only now and then, e.g. "(song playing)" every minute or two, or Wild Robot's "* *").
//   4. The CREDITS block is the last block that lasts >= min_block_ms, holds >= min_block_cues cues (a (B)
//      run with no spoken cue may hold fewer), and is
//      followed by at most post_max_cues cues spanning at most post_max_ms (a post-credits gag may follow).
//      No such block -> no credits span (a film whose credits carry no subtitles needs none).
//      The block is then extended over directly adjacent song-like cues (the window can leave a song's first
//      or last line outside it); never forward across a silence > extend_max_gap_ms (a post-credits gag that
//      opens with a sung line, e.g. Moana's, stays film).
//   5. When the block contains a subtitle credit line, the credits start at the first one (the subtitler
//      marks where the film ends; Coco's closing song before it is part of the film).
//   6. No qualifying block: subtitle credit / copyright lines after the last spoken line of the tail are the
//      credits (How to Train Your Dragon: one copyright cue shown for 8.7 minutes).
// The span is [start_cue, end_cue] (1-based, inclusive); cues after end_cue are the post-credits tail and stay
// ordinary film.
//
// What it is used for (policy.json credits):
//   * gate.js: max_scene_minutes is measured on each scene's NON-credits part (a scene wholly inside the
//     credits has length 0); nothing else in the gate changes (the Jev alignment, boundaries and probes still
//     see every scene).
//   * a scene with >= scene_share of its cues inside the span is a CREDITS SCENE: classify.js and sonnetq.js
//     do not ask about it, select.js gives it no tags and no flags (reported as credits).

export const CREDITS_VERSION = 'credits-v10.1.0';

export const DEFAULT_CREDITS_CFG = {
  tail_share: 0.75,
  tail_max_ms: 25 * 60_000,
  window: 8,
  min_share: 0.75,
  caption_weight: 0.5,
  min_block_ms: 90_000,
  min_block_cues: 8,
  min_run_song_cues: 3,
  extend_max_gap_ms: 60_000,
  post_max_cues: 40,
  post_max_ms: 4 * 60_000,
  scene_share: 0.5,
};

const CREDIT = /\b(subtitles?|subtitled|captions?|captioning|captioned|synced|sync(?:ed)? (?:and|&) corrected|corrected|translated|transcribed|ripped|encoded)\s+by\b|\bcopyright\b|©|\bwww\.|\bhttps?:|\.(?:com|org|net)\b|opensubtitles|\bhope you(?:'ve)? (?:liked|enjoyed)\b|\bdownloaded from\b/i;
const MUSIC_MARK = /[♪♫]|^#|#$|^\*|\*$/;
const MUSIC_CAPTION = /[([][^)\]]*\b(music|musical|song|songs|singing|sings|sing|sung|vocali[sz]ing|humming|hums|instrumental|lyrics|melody|chorus)\b[^)\]]*[)\]]/i;
const CAPTION_ONLY = /^\s*(?:[([][^)\]]*[)\]]\s*)+$/;
const SPEAKER = /^(?:-\s*)?[A-Z][A-Z0-9 .'-]{1,30}:/;
const DASH = /^\s*-\s*\S/;
const FINAL_PUNCT = /[.?!…"”')\]]\s*$|--\s*$/;

const norm = (t) => t.toLowerCase().replace(/[^a-z0-9' ]+/g, ' ').replace(/\s+/g, ' ').trim();

/** Label one cue text: 'credit' | 'music' | 'lyric' | 'caption' | 'speech'. `repeated` = its words occur again in the tail. */
export function cueKind(text, repeated = false) {
  const t = String(text ?? '').trim();
  if (CREDIT.test(t)) return 'credit';
  if (MUSIC_MARK.test(t) || MUSIC_CAPTION.test(t)) return 'music';
  if (CAPTION_ONLY.test(t)) return 'caption';
  if (SPEAKER.test(t) || DASH.test(t)) return 'speech';
  if (!FINAL_PUNCT.test(t) || repeated) return 'lyric';
  return 'speech';
}

const SONG_LIKE = new Set(['credit', 'music', 'lyric']);

/**
 * The end-credits span of a film, or null. `cues` = parseSrt output (1-based .index, startMs, endMs, text).
 * Returns { version, start_cue, end_cue, start_ms, end_ms, minutes, cues, post_cues, how, kinds }.
 */
export function creditsSpan(cues, cfg = {}) {
  const c = { ...DEFAULT_CREDITS_CFG, ...cfg };
  if (!cues?.length) return null;
  const filmEnd = cues[cues.length - 1].endMs;
  const tailFrom = Math.max(c.tail_share * filmEnd, filmEnd - c.tail_max_ms);
  const tail = cues.filter((q) => q.startMs >= tailFrom);
  if (tail.length < c.min_block_cues) return null;
  const counts = new Map();
  for (const q of tail) { const n = norm(q.text); if (n.split(' ').length >= 2) counts.set(n, (counts.get(n) ?? 0) + 1); }
  const kinds = tail.map((q) => cueKind(q.text, (counts.get(norm(q.text)) ?? 0) >= 2));
  const w = kinds.map((k) => (SONG_LIKE.has(k) ? 1 : k === 'caption' ? c.caption_weight : 0));
  const lo = Math.floor((c.window - 1) / 2);
  const hi = c.window - 1 - lo;
  const inSong = tail.map((_, i) => {
    const a = Math.max(0, i - lo); const b = Math.min(tail.length - 1, i + hi);
    let s = 0; for (let k = a; k <= b; k++) s += w[k];
    return s / (b - a + 1) >= c.min_share;
  });
  // blocks of in-song cues, trimmed to song-like edges
  const blocks = [];
  for (let i = 0; i < tail.length;) {
    if (!inSong[i]) { i++; continue; }
    let j = i; while (j + 1 < tail.length && inSong[j + 1]) j++;
    let a = i; let b = j;
    while (a <= b && !SONG_LIKE.has(kinds[a])) a++;
    while (b >= a && !SONG_LIKE.has(kinds[b])) b--;
    if (a <= b) blocks.push([a, b, 'song_block']);
    i = j + 1;
  }
  // (B) runs with no spoken line at all that hold >= min_run_song_cues song-like cues: a credits roll captioned
  //     only now and then ("(song playing)" every minute or two, Wild Robot's "* *" markers)
  for (let i = 0; i < tail.length;) {
    if (kinds[i] === 'speech') { i++; continue; }
    let j = i; while (j + 1 < tail.length && kinds[j + 1] !== 'speech') j++;
    let a = i; let b = j;
    while (a <= b && !SONG_LIKE.has(kinds[a])) a++;
    while (b >= a && !SONG_LIKE.has(kinds[b])) b--;
    if (a <= b && kinds.slice(a, b + 1).filter((k) => SONG_LIKE.has(k)).length >= c.min_run_song_cues) blocks.push([a, b, 'music_run']);
    i = j + 1;
  }
  blocks.sort((x, y) => x[1] - y[1] || y[0] - x[0]);
  for (let k = blocks.length - 1; k >= 0; k--) {
    const [a, b, type] = blocks[k];
    const dur = tail[b].endMs - tail[a].startMs;
    const post = tail.length - 1 - b;
    const postMs = post ? tail[tail.length - 1].endMs - tail[b + 1].startMs : 0;
    if (post > c.post_max_cues || postMs > c.post_max_ms) break; // too much film after it: not the credits (and no earlier block can be)
    if (dur < c.min_block_ms || (b - a + 1 < c.min_block_cues && kinds.slice(a, b + 1).includes('speech'))) continue;
    // the window rule can leave the song's first / last line outside the block: extend over adjacent song-like cues
    let a0 = a; while (a0 > 0 && SONG_LIKE.has(kinds[a0 - 1])) a0--;
    let b0 = b; while (b0 + 1 < tail.length && SONG_LIKE.has(kinds[b0 + 1]) && tail[b0 + 1].startMs - tail[b0].endMs <= c.extend_max_gap_ms) b0++;
    return spanOf(a0, b0, type);
  }
  // 6. no song block: trailing subtitle credit / copyright lines with nothing spoken after them (a credits
  //    roll whose only subtitles are the subtitler's own lines, e.g. one copyright cue shown for minutes)
  const lastSpeech = kinds.lastIndexOf('speech');
  const firstCredit = kinds.findIndex((k, i) => k === 'credit' && i > lastSpeech);
  if (firstCredit >= 0) return spanOf(firstCredit, tail.length - 1, 'trailing_credit_lines');
  return null;

  function spanOf(a, b, how) {
    const post = tail.length - 1 - b;
    const creditAt = kinds.slice(a, b + 1).indexOf('credit');
    const s = creditAt >= 0 ? a + creditAt : a;
    const tally = {}; for (const kd of kinds.slice(s, b + 1)) tally[kd] = (tally[kd] ?? 0) + 1;
    return {
      version: CREDITS_VERSION,
      start_cue: tail[s].index,
      end_cue: tail[b].index,
      start_ms: tail[s].startMs,
      end_ms: tail[b].endMs,
      minutes: Math.round(((tail[b].endMs - tail[s].startMs) / 60000) * 1000) / 1000,
      cues: b - s + 1,
      post_cues: post,
      how: creditAt >= 0 && how !== 'trailing_credit_lines' ? `${how}_from_subtitle_credit_line` : how,
      kinds: tally,
    };
  }
}

/** Cues of scene [start_cue, end_cue] inside the span. */
export const creditCues = (scene, span) => (span ? Math.max(0, Math.min(scene.end_cue, span.end_cue) - Math.max(scene.start_cue, span.start_cue) + 1) : 0);

/** A credits scene: >= scene_share of its cues inside the credits span. */
export function isCreditsScene(scene, span, cfg = {}) {
  if (!span) return false;
  const share = cfg.scene_share ?? DEFAULT_CREDITS_CFG.scene_share;
  const n = scene.end_cue - scene.start_cue + 1;
  return n > 0 && creditCues(scene, span) / n >= share;
}

/**
 * Minutes of a scene OUTSIDE the credits span (dialogue bounds of the cues that are not credits). A scene
 * that straddles the span start keeps its part before it (and any post-credits cues after it are measured
 * from their own first cue); a scene wholly inside the span has 0.
 */
export function nonCreditMinutes(scene, cues, span) {
  const parts = [];
  if (!span || scene.end_cue < span.start_cue || scene.start_cue > span.end_cue) parts.push([scene.start_cue, scene.end_cue]);
  else {
    if (scene.start_cue < span.start_cue) parts.push([scene.start_cue, span.start_cue - 1]);
    if (scene.end_cue > span.end_cue) parts.push([span.end_cue + 1, scene.end_cue]);
  }
  return parts.reduce((m, [a, b]) => Math.max(m, (cues[b - 1].endMs - cues[a - 1].startMs) / 60000), 0);
}

/** Ids of the credits scenes of a segmentation (scenes: [{id, start_cue, end_cue}]), given the parsed SRT. */
export function creditsSceneIds(scenes, cues, cfg = {}) {
  const span = creditsSpan(cues, cfg);
  return { span, ids: new Set(scenes.filter((s) => isCreditsScene(s, span, cfg)).map((s) => s.id)) };
}
