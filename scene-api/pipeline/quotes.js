// "Does this sentence quote the film?" — the rule test/load.test.js applies to the six loaded
// films, lifted out so a film added live is held to it before its rows are written.
//
// The six historical films were checked once, after the fact, by a test that reads what is in the
// database and compares it with the subtitle files on disk. A live film has no subtitle file on
// disk and nobody runs a test against it, so the same rule has to run inside the pipeline — between
// the model answering and the row being written — or the only thing standing between a copyrighted
// track and a permanent row is that Sonnet usually paraphrases.
//
// Eight consecutive words in common is a quotation, not a coincidence. The comparison is over words
// only (case, punctuation and line breaks dropped), because "Run! It's right behind us." and
// "run it is right behind us" are the same quotation.

export const QUOTE_RUN = 8;

const words = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9' ]+/g, ' ').split(/\s+/).filter(Boolean);

function shingles(list, n) {
  const out = new Set();
  for (let i = 0; i + n <= list.length; i++) out.add(list.slice(i, i + n).join(' '));
  return out;
}

/**
 * Every run of `n` words that occurs inside one cue of this track. Built once per film: it is a few
 * tens of thousands of strings and every scene's text is checked against it.
 */
export function transcriptShingles(cues, n = QUOTE_RUN) {
  const out = new Set();
  for (const c of cues) for (const s of shingles(words(c.text), n)) out.add(s);
  return out;
}

/** The first run of words `text` shares with the track, or null if it shares none. */
export function quotedRun(text, fromFilm, n = QUOTE_RUN) {
  for (const s of shingles(words(text), n)) if (fromFilm.has(s)) return s;
  return null;
}

export const quotesTranscript = (text, fromFilm, n = QUOTE_RUN) => quotedRun(text, fromFilm, n) !== null;
