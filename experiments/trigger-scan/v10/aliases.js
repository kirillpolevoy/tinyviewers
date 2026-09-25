// Cast names and aliases (v6). Pure code, no I/O.
//
// Round 1 (v5) finding (d): aliases were never cited or checked, yet they reached Jev as also_called,
// the film-specific question wording and the per-scene cast matching; and names were split into
// single words, so 'Your Majesty' attached Simba to every scene with the word 'your', and 'the kid'
// / 'the girl' attached Boo to any scene with those words.
//
// v6 rules:
//   1. An alias is a claim like any other: it needs cites (Sonnet's, or for legacy v5 segments the
//      code-found TMDB entry / lines that contain the alias verbatim) and a Jev claim-check verdict.
//      Only verified aliases are shown to Jev or used for matching.
//   2. An alias made only of common words ('the kid', 'Your Majesty', 'the king') is refused before
//      any check: it is a description, not a name, and it would match unrelated lines.
//   3. Matching uses whole names and whole verified aliases (case-insensitive, word bounded). Single
//      tokens are split only from the character's own NAME, never from aliases, and only when the
//      token is not a common word ('Young Simba' -> 'Simba'; 'Mr Ray' -> 'Ray'; never 'Young'). A
//      single token must match with its capitalisation as written or in ALL CAPS ('Boo', 'BOO', not
//      the interjection 'boo').

// Common English words and role nouns that are never a name on their own. Lower case.
export const COMMON_WORDS = new Set(`
a an the and or of to in on at is are was were be been by for with as his her their its he she they it them this that these those
from into out up down after before while who whom which what when where why how then than but not no so one two three over about
through him has have had there here also both only just all own new first last again back off very more most other some such can
will would could should must may might still even well yes yeah hey hi hello bye oh ah uh um okay ok please thanks thank
my your our yours mine me we us you i myself yourself
old young little big small tiny great good bad best dear sweet poor mad happy crazy
mr mrs ms miss mister dr doc sir madam maam lady lord master chief captain general officer boss
king queen prince princess majesty highness royal emperor
man men woman women guy guys boy boys girl girls kid kids kiddo child children baby babies son daughter
dad daddy father pa papa pop mom mommy mum mummy mother ma mama mamma parent parents grandpa grandma granny
uncle aunt auntie brother sister bro sis cousin family friend friends buddy pal mate partner
honey sweetie sweetheart darling love dude
teacher doctor nurse dentist student students class
monster monsters creature creatures beast thing things animal animals
fish shark sharks whale dog dogs cat cats bird birds lion lions cub cubs puppy kitty bug bugs
robot robots
everybody everyone somebody someone anybody anyone nobody
`.split(/\s+/).filter(Boolean));

const ARTICLE = /^(the|a|an)\s+/i;
const words = (s) => String(s).toLowerCase().replace(/[.,'’"“”()!?]/g, ' ').split(/\s+/).filter(Boolean);

/** Why an alias may not be used, or null. `name` is the character's own name. */
export function aliasProblem(alias, name = '') {
  const a = String(alias ?? '').trim();
  if (!a) return 'empty';
  if (a.toLowerCase() === String(name).trim().toLowerCase()) return 'same_as_name';
  const ws = words(a);
  if (!ws.length) return 'empty';
  if (ws.every((w) => COMMON_WORDS.has(w) || w.length < 3)) return ws.length === 1 ? 'single_common_word' : 'only_common_words';
  return null;
}

/**
 * The aliases of a cast row as objects. v6 segments store [{name, cites, check}]; v5 segments store
 * plain strings (never cited). Each: { name, cites, check|null, problem|null }.
 */
export function aliasList(c) {
  return (c?.aliases ?? []).map((a) => {
    const o = typeof a === 'string' ? { name: a, cites: [] } : { name: a.name, cites: a.cites ?? [], ...(a.check ? { check: a.check } : {}) };
    return { ...o, problem: aliasProblem(o.name, c.name) };
  });
}

/**
 * Aliases that may be shown to Jev and used for matching: no problem AND a verified check.
 * `isVerified(check)` is questions.js verified() (passed in to avoid an import cycle).
 */
export function usableAliases(c, isVerified) {
  return aliasList(c).filter((a) => !a.problem && isVerified(a.check)).map((a) => a.name);
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const clean = (n) => String(n).replace(ARTICLE, '').replace(/["“”()]/g, ' ').replace(/\s+/g, ' ').trim();

/**
 * Match patterns for one cast member: whole name and whole usable aliases (case-insensitive), plus
 * proper single tokens of the name (case-sensitive: as written or ALL CAPS).
 */
export function namePatterns(c, aliases = []) {
  const pats = [];
  const seen = new Set();
  const add = (re, label) => { if (!seen.has(label)) { seen.add(label); pats.push({ re, label }); } };
  for (const full of [c.name, ...aliases]) {
    const n = clean(full);
    if (!n) continue;
    // A one-word proper name ('Boo', 'Nemo') matches as written or in ALL CAPS, so the interjection
    // 'boo' does not count; multi-word names and generic one-word names ('Seagulls') ignore case.
    const proper = !/\s/.test(n) && /^[A-Z]/.test(n) && !COMMON_WORDS.has(n.toLowerCase());
    const re = proper
      ? new RegExp(`(^|[^A-Za-z0-9])(${escapeRe(n)}|${escapeRe(n.toUpperCase())})(?![A-Za-z0-9])`)
      : new RegExp(`(^|[^A-Za-z0-9])${escapeRe(n)}(?![A-Za-z0-9])`, 'i');
    add(re, `full:${n.toLowerCase()}`);
  }
  const toks = clean(c.name).split(/[\s/]+/).map((t) => t.replace(/[.,;:!?]+$/, '')).filter((t) => t.length >= 3 && /^[A-Z]/.test(t) && !COMMON_WORDS.has(t.toLowerCase()));
  for (const t of toks) add(new RegExp(`(^|[^A-Za-z0-9])(${escapeRe(t)}|${escapeRe(t.toUpperCase())})(?![A-Za-z0-9])`), `tok:${t}`);
  return pats;
}

/** Does `text` mention the member? Returns the matching pattern label or null. */
export function mentionOf(c, text, aliases = []) {
  for (const p of namePatterns(c, aliases)) if (p.re.test(text)) return p.label;
  return null;
}

/**
 * Code-found cites for an uncited alias (legacy v5 segments): the member's TMDB entry when the TMDB
 * character string contains the alias, and up to `maxLines` subtitle lines that contain the alias
 * verbatim (case-insensitive, word bounded). The claim check then judges whether that evidence
 * shows the alias names THIS character.
 */
export function foundAliasCites(c, alias, { cues = [], T = [], maxLines = 3 } = {}) {
  const re = new RegExp(`(^|[^A-Za-z0-9])${escapeRe(clean(alias))}(?![A-Za-z0-9])`, 'i');
  const out = [];
  if (c.tmdb && /^T\d+$/.test(c.tmdb)) {
    const t = T[Number(c.tmdb.slice(1)) - 1];
    if (t && re.test(t.character)) out.push(c.tmdb);
  }
  for (const q of cues) {
    if (out.filter((x) => x[0] === 'L').length >= maxLines) break;
    if (re.test(q.text)) out.push(`L${q.index}`);
  }
  return out;
}
