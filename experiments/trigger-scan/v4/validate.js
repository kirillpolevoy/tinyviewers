// Pure checks and deterministic repairs for segment.js. No I/O, no model calls.

// ---- coverage ------------------------------------------------------------------------------------

/**
 * Makes model scenes contiguous and covering cues 1..n exactly once, in order.
 * Input: [{start_cue, end_cue, ...}] (1-based ints, any order, possibly gappy/overlapping/invalid).
 * Returns { scenes, repairs } where every repair is { kind, ... } describing exactly what changed.
 *
 * Rules, applied in this order:
 *   1. invalid (non-integer, out of range, start > end) -> dropped
 *   2. sort by start_cue (then by end_cue)
 *   3. a scene wholly inside the covered range of the one before -> dropped (duplicate/nested)
 *   4. overlap -> the later scene's start moves to previous end + 1
 *   5. gap -> the previous scene's end extends to next start - 1 (orphan lines join the scene they follow)
 *   6. first scene starts at 1, last ends at n (extend)
 */
export function repairCoverage(input, n) {
  const repairs = [];
  const valid = [];
  input.forEach((s, i) => {
    const ok = Number.isInteger(s.start_cue) && Number.isInteger(s.end_cue) && s.start_cue >= 1 && s.end_cue <= n && s.start_cue <= s.end_cue;
    if (ok) valid.push({ ...s, _modelIndex: i });
    else repairs.push({ kind: 'dropped_invalid', model_index: i, start_cue: s.start_cue, end_cue: s.end_cue });
  });
  valid.sort((a, b) => a.start_cue - b.start_cue || a.end_cue - b.end_cue);
  valid.forEach((s, i) => {
    if (i > 0 && s._modelIndex < valid[i - 1]._modelIndex) repairs.push({ kind: 'reordered', model_index: s._modelIndex });
  });
  const out = [];
  for (const s of valid) {
    const prev = out[out.length - 1];
    if (prev && s.end_cue <= prev.end_cue) {
      repairs.push({ kind: 'dropped_nested', model_index: s._modelIndex, start_cue: s.start_cue, end_cue: s.end_cue, inside: [prev.start_cue, prev.end_cue] });
      continue;
    }
    if (prev && s.start_cue <= prev.end_cue) {
      repairs.push({ kind: 'overlap_trimmed', model_index: s._modelIndex, from: s.start_cue, to: prev.end_cue + 1, cues: prev.end_cue - s.start_cue + 1 });
      s.start_cue = prev.end_cue + 1;
    } else if (prev && s.start_cue > prev.end_cue + 1) {
      repairs.push({ kind: 'gap_filled', model_index: prev._modelIndex, from: prev.end_cue, to: s.start_cue - 1, cues: s.start_cue - prev.end_cue - 1 });
      prev.end_cue = s.start_cue - 1;
    }
    out.push(s);
  }
  if (!out.length) throw new Error('no valid scenes to repair');
  if (out[0].start_cue !== 1) {
    repairs.push({ kind: 'head_extended', from: out[0].start_cue, to: 1, cues: out[0].start_cue - 1 });
    out[0].start_cue = 1;
  }
  const last = out[out.length - 1];
  if (last.end_cue !== n) {
    repairs.push({ kind: 'tail_extended', from: last.end_cue, to: n, cues: n - last.end_cue });
    last.end_cue = n;
  }
  for (const s of out) delete s._modelIndex;
  return { scenes: out, repairs };
}

export function assertCoverage(scenes, n) {
  if (scenes[0].start_cue !== 1) throw new Error('coverage: first scene does not start at cue 1');
  if (scenes[scenes.length - 1].end_cue !== n) throw new Error(`coverage: last scene does not end at cue ${n}`);
  scenes.forEach((s, i) => {
    if (s.start_cue > s.end_cue) throw new Error(`coverage: ${i} empty`);
    if (i && s.start_cue !== scenes[i - 1].end_cue + 1) throw new Error(`coverage: ${i} not contiguous`);
  });
}

// ---- words -----------------------------------------------------------------------------------------

export const wordCount = (s) => (s.trim() ? s.trim().split(/\s+/).length : 0);

/**
 * Cut to at most maxWords. Prefers ending at the last sentence end that keeps >= half the words;
 * otherwise hard-cuts and ends with an ellipsis.
 */
export function clampWords(text, maxWords) {
  const words = text.trim().split(/\s+/);
  if (words.length <= maxWords) return { text: text.trim(), trimmed: false };
  const head = words.slice(0, maxWords);
  for (let i = head.length - 1; i >= Math.ceil(maxWords / 2) - 1; i--) {
    if (/[.!?]["')\]]?$/.test(head[i])) return { text: head.slice(0, i + 1).join(' '), trimmed: true };
  }
  return { text: `${head.join(' ').replace(/[,;:.\-–—]+$/, '')}…`, trimmed: true };
}

// ---- quotation rule --------------------------------------------------------------------------------

// Lowercase, straighten apostrophes, keep letters/digits/apostrophes. Sound-caption brackets and
// music marks fall away, so "(GASPS)" and "gasps" compare equal.
export const normWord = (w) => w.toLowerCase().replace(/[‘’`]/g, "'").replace(/[^a-z0-9']/g, '').replace(/^'+|'+$/g, '');

/** All k-grams of the transcript's word stream (across cue boundaries, since a quote can span cues). */
export function transcriptGrams(cueTexts, k) {
  const words = cueTexts.flatMap((t) => t.split(/\s+/)).map(normWord).filter(Boolean);
  const grams = new Set();
  for (let i = 0; i + k <= words.length; i++) grams.add(words.slice(i, i + k).join(' '));
  return grams;
}

/**
 * Finds runs of more than `maxRun` consecutive words shared with the transcript and shortens each
 * to its first `keep` words plus an ellipsis. Returns { text, violations: [{ words }] }; the
 * violation records only the run LENGTH, never the words.
 */
export function enforceQuoteRule(text, grams, { maxRun = 8, keep = 5 } = {}) {
  const k = maxRun + 1;
  const tokens = text.split(/\s+/).filter(Boolean);
  const idx = []; // positions in `tokens` of words that normalise to something
  tokens.forEach((t, i) => { if (normWord(t)) idx.push(i); });
  const norm = idx.map((i) => normWord(tokens[i]));
  const hit = new Array(norm.length).fill(false);
  for (let i = 0; i + k <= norm.length; i++) {
    if (grams.has(norm.slice(i, i + k).join(' '))) for (let j = i; j < i + k; j++) hit[j] = true;
  }
  const runs = [];
  for (let i = 0; i < hit.length; i++) {
    if (!hit[i]) continue;
    let j = i;
    while (j + 1 < hit.length && hit[j + 1]) j++;
    runs.push([idx[i], idx[j], j - i + 1]);
    i = j;
  }
  if (!runs.length) return { text, violations: [] };
  const out = [...tokens];
  for (const [a, b] of runs.reverse()) out.splice(a, b - a + 1, ...tokens.slice(a, a + keep), '…');
  return { text: out.join(' ').replace(/\s+…/g, '…'), violations: runs.map(([, , len]) => ({ words: len })) };
}

// ---- neutrality ------------------------------------------------------------------------------------

// Judgement words the contract bans from summaries. Flagged, never rewritten (a rewrite would need a model).
export const JUDGEMENT_WORDS = [
  // A character's own reaction ("Marlin panics") is an event and is allowed; these words rate the scene.
  'scary', 'frightening', 'terrifying', 'horrifying', 'creepy', 'spooky',
  'sad', 'sadly', 'heartbreaking', 'heartbroken', 'tragic', 'tragically', 'upsetting', 'disturbing', 'traumatic', 'tense', 'tension',
  'intense', 'cute', 'funny', 'hilarious', 'touching', 'heartwarming', 'emotional', 'dramatic', 'thrilling', 'harrowing', 'menacing', 'sinister',
];
const JUDGEMENT_RE = new RegExp(`\\b(${JUDGEMENT_WORDS.join('|')})\\b`, 'gi');
export const judgementWords = (text) => [...new Set((text.match(JUDGEMENT_RE) ?? []).map((w) => w.toLowerCase()))];
