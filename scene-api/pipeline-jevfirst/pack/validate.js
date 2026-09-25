// Pure checks and deterministic repairs for segment.js (copied from v4/validate.js; only change: judgementWords
// ignores "touching" used for physical contact). No I/O, no model calls.

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

// v10.3 (round-8 bug): a hyphen or dash joins two words in one spelling and not in another ("high-speed" in a
// description, "high speed" in a cue). v10.2 normalised "high-speed" to ONE word "highspeed", so a 9-word copy
// counted as 8 and passed. Now every whitespace token is split at hyphens, dashes and slashes into its words
// (HYPHENS), runs are counted in those words, and the check is made under BOTH spellings: split ("high speed") and
// joined ("highspeed"), each against the transcript read the same way. A run found under either is a violation.
export const HYPHENS = /[-‐‑‒–—―/]+/;

/** Words of a text as [{ w, tok }] (w = normalised word, tok = index of its whitespace token), split or joined. */
export function quoteWords(text, { joined = false } = {}) {
  const tokens = String(text ?? '').split(/\s+/).filter(Boolean);
  const out = [];
  tokens.forEach((t, tok) => {
    const parts = joined ? [t] : t.split(HYPHENS);
    for (const p of parts) { const w = normWord(p); if (w) out.push({ w, tok }); }
  });
  return { tokens, words: out };
}

/**
 * All k-grams of the transcript's word stream (across cue boundaries, since a quote can span cues), hyphenated
 * words split (v10.3). The returned Set also carries `.joined` (the same grams with hyphenated words kept whole)
 * and `.k`, so enforceQuoteRule can check both spellings.
 */
export function transcriptGrams(cueTexts, k) {
  const make = (joined) => {
    const words = cueTexts.flatMap((t) => quoteWords(t, { joined }).words.map((x) => x.w));
    const grams = new Set();
    for (let i = 0; i + k <= words.length; i++) grams.add(words.slice(i, i + k).join(' '));
    return grams;
  };
  const grams = make(false);
  grams.joined = make(true);
  grams.k = k;
  return grams;
}

/** Runs of > maxRun consecutive words of `text` shared with the transcript: [[firstTok, lastTok, words]]. Pure. */
export function quoteRuns(text, grams, { maxRun = 8 } = {}) {
  const k = maxRun + 1;
  const ranges = [];
  for (const [joined, set] of [[false, grams], [true, grams?.joined]]) {
    if (!set) continue;
    const { words } = quoteWords(text, { joined });
    const hit = new Array(words.length).fill(false);
    for (let i = 0; i + k <= words.length; i++) {
      if (set.has(words.slice(i, i + k).map((x) => x.w).join(' '))) for (let j = i; j < i + k; j++) hit[j] = true;
    }
    for (let i = 0; i < hit.length; i++) {
      if (!hit[i]) continue;
      let j = i;
      while (j + 1 < hit.length && hit[j + 1]) j++;
      ranges.push([words[i].tok, words[j].tok]);
      i = j;
    }
  }
  if (!ranges.length) return [];
  // merge overlapping token ranges from the two spellings; a run's length = its words in the split spelling
  ranges.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const merged = [];
  for (const r of ranges) { const last = merged.at(-1); if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]); else merged.push([...r]); }
  const split = quoteWords(text).words;
  return merged.map(([a, b]) => [a, b, split.filter((x) => x.tok >= a && x.tok <= b).length]);
}

/** Longest run of consecutive words shared with the transcript (0 when none exceeds maxRun). Pure. */
export const longestQuoteRun = (text, grams, opts = {}) => Math.max(0, ...quoteRuns(text, grams, opts).map((r) => r[2]));

/**
 * Finds runs of more than `maxRun` consecutive words shared with the transcript and shortens each
 * to its first `keep` whitespace tokens plus an ellipsis. Returns { text, violations: [{ words }] }; the
 * violation records only the run LENGTH, never the words.
 */
export function enforceQuoteRule(text, grams, { maxRun = 8, keep = 5 } = {}) {
  const runs = quoteRuns(text, grams, { maxRun });
  if (!runs.length) return { text, violations: [] };
  const tokens = String(text ?? '').split(/\s+/).filter(Boolean);
  const out = [...tokens];
  for (const [a, b] of [...runs].reverse()) out.splice(a, b - a + 1, ...tokens.slice(a, a + keep), '…');
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
// v5 change: "touching" followed by an object ("a child touching a monster") is physical contact, not a rating.
const TOUCH_CONTACT_RE = /\btouching\s+(a|an|the|her|him|his|its|it|them|their|someone|something|anyone|each)\b/gi;
export const judgementWords = (text) => [...new Set((text.replace(TOUCH_CONTACT_RE, '').match(JUDGEMENT_RE) ?? []).map((w) => w.toLowerCase()))];
