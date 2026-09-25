// Pure text helpers for sources.js: cutting the Plot section out of a TextExtracts plain-text
// article and splitting it into numbered sentences. No I/O.

// Headings the Plot section goes by on English Wikipedia film articles, best first.
export const PLOT_HEADINGS = ['Plot', 'Plot summary', 'Synopsis', 'Story'];

/**
 * TextExtracts (explaintext, exsectionformat=wiki) marks headings as "== Plot ==", "=== Sub ===".
 * Returns the text of the first level-2 section whose heading is one of PLOT_HEADINGS, including any
 * of its subsections, or null. Never falls back to another section.
 */
export function plotSection(extract) {
  const lines = extract.replace(/\r\n?/g, '\n').split('\n');
  const h2 = (l) => l.match(/^==\s*([^=].*?)\s*==\s*$/);
  for (const want of PLOT_HEADINGS) {
    const start = lines.findIndex((l) => h2(l)?.[1].toLowerCase() === want.toLowerCase());
    if (start < 0) continue;
    let end = lines.length;
    for (let i = start + 1; i < lines.length; i++) if (h2(lines[i])) { end = i; break; }
    const body = lines.slice(start + 1, end)
      .filter((l) => !/^={3,}.*={3,}\s*$/.test(l)) // subsection headings carry no plot facts
      .join('\n').trim();
    if (body) return { heading: lines[start].replace(/=/g, '').trim(), text: body };
  }
  return null;
}

// Tokens ending in a period that do not end a sentence.
const ABBREV = new Set(['mr', 'mrs', 'ms', 'dr', 'st', 'jr', 'sr', 'inc', 'co', 'ltd', 'vs', 'etc', 'mt', 'prof', 'capt', 'lt', 'sgt', 'no', 'u.s', 'u.k', 'e.g', 'i.e']);

/**
 * Split prose into sentences. A sentence ends at . ! or ? (optionally followed by a closing quote or
 * bracket) when the next token starts with an upper-case letter, a digit or an opening quote, and the
 * word before the period is not a known abbreviation or a single initial.
 */
export function splitSentences(text) {
  const out = [];
  for (const para of text.split(/\n+/).map((p) => p.trim()).filter(Boolean)) {
    const toks = para.split(/\s+/);
    let cur = [];
    toks.forEach((tok, i) => {
      cur.push(tok);
      const next = toks[i + 1];
      if (!next) return;
      const m = tok.match(/^(.*?)([.!?])["'”’)\]]*$/);
      if (!m) return;
      const word = m[1].replace(/^["'“‘(\[]+/, '').toLowerCase();
      if (m[2] === '.' && (ABBREV.has(word) || /^[a-z]$/i.test(word))) return;
      if (!/^["'“‘(\[]?[A-Z0-9]/.test(next)) return;
      out.push(cur.join(' '));
      cur = [];
    });
    if (cur.length) out.push(cur.join(' '));
  }
  return out;
}

export const numberSentences = (sentences) => sentences.map((text, i) => ({ id: `W${i + 1}`, text }));
