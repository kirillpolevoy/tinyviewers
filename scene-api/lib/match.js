// Turning a parent's words into vocabulary ids.
//
// A parent types "monsters", "Sharks", "needles", "scary creature". The database holds ids like
// `monster_creature` and labels like "Monster or strange creature". This maps one to the other
// without an embedding model: normalise, singularise, then match on the id, on the label, or on
// the aliases stored beside each item at load time.

// Words a parent uses for a whole family, not for one taxonomy item.
//
// "Which scenes have monsters?" does not mean the item `monster_creature`, which by definition
// excludes every ordinary animal — under it, Finding Nemo has no monsters at all, which is a true
// statement about our taxonomy and a useless answer to a parent. These terms resolve to the GROUP,
// and the response says so. The narrow item stays reachable by its id.
export const BROAD_TERMS = {
  monster: 'creatures_figures',
  creature: 'creatures_figures',
  'scary creature': 'creatures_figures',
  'scary monster': 'creatures_figures',
  'frightening creature': 'creatures_figures',
  beast: 'creatures_figures',
};

export const BROAD_NOTE = {
  creatures_figures: 'any frightening creature or figure; ask for a specific one, e.g. shark or ghost, to narrow',
};

const IRREGULAR = new Map([
  ['knives', 'knife'], ['wolves', 'wolf'], ['children', 'child'], ['people', 'person'],
  ['mice', 'mouse'], ['teeth', 'tooth'], ['feet', 'foot'], ['men', 'man'], ['women', 'woman'],
  ['thieves', 'thief'], ['lives', 'life'], ['leaves', 'leaf'],
]);

export function singular(word) {
  if (IRREGULAR.has(word)) return IRREGULAR.get(word);
  if (word.length > 4 && /(ches|shes|sses|xes|zes)$/.test(word)) return word.slice(0, -2);
  if (word.length > 3 && /ies$/.test(word)) return `${word.slice(0, -3)}y`;
  if (word.length > 3 && /[^s]s$/.test(word)) return word.slice(0, -1);
  return word;
}

const STOP = new Set(['a', 'an', 'the', 'or', 'and', 'of', 'other', 'someone', 'something', 'who', 'is', 'in', 'on', 'to']);

export function tokens(text) {
  return String(text)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean)
    .map(singular)
    .filter((w) => !STOP.has(w));
}

export const normalise = (text) => tokens(text).join(' ');

// Every string that should resolve to this vocabulary item.
function keysFor(item) {
  const out = new Set();
  const add = (s) => { const n = normalise(s); if (n) out.add(n); };
  add(item.id);
  add(item.label);
  for (const alias of item.aliases ?? []) add(alias);
  // "Monster or strange creature" -> "monster", "strange creature"
  for (const part of String(item.label).split(/\s*(?:,| or |\/)\s*/i)) add(part);
  return out;
}

/**
 * @param {string} term            what the caller typed
 * @param {Array}  vocabulary      rows from the vocabulary table
 * @param {object} opts.layer      restrict to 'presence' | 'event' (optional)
 * @returns {{term, ids: string[], how: 'exact'|'label'|'partial'|'none'}}
 */
export function matchTerm(term, vocabulary, { layer = null } = {}) {
  const pool = layer ? vocabulary.filter((v) => v.layer === layer) : vocabulary;
  const want = normalise(term);
  if (!want) return { term, ids: [], how: 'none' };
  const wantTokens = want.split(' ');

  // An everyday word can name more than one thing — "shot" is an injection AND a gunshot. Collect
  // EVERY item the word is an id, a label or an alias of, and return all of them. Stopping at the
  // first kind of match is how presence=shot came to mean "injection only".
  const byId = pool.filter((v) => normalise(v.id) === want);
  const byKey = pool.filter((v) => keysFor(v).has(want)); // keysFor includes the id, so byKey >= byId
  if (byKey.length) {
    const ids = byKey.map((v) => v.id);
    const how = byKey.length > 1
      ? 'several_items'
      : (byId.length ? 'exact' : 'label');
    const out = { term, ids, how };
    if (byKey.length > 1) {
      out.note = `"${term}" can mean more than one thing here, so all of them were used: ${ids.join(', ')}. Ask for one id to narrow.`;
    }
    return out;
  }

  // Every word the caller used appears in one of the item's keys ("monster" in "monster creature").
  const partial = pool.filter((v) => {
    const all = new Set([...keysFor(v)].flatMap((k) => k.split(' ')));
    return wantTokens.every((t) => all.has(t));
  });
  if (partial.length) {
    const ids = partial.map((v) => v.id);
    return {
      term,
      ids,
      how: partial.length > 1 ? 'several_items' : 'partial',
      ...(partial.length > 1 ? { note: `"${term}" matched ${ids.length} items loosely, and all of them were used: ${ids.join(', ')}.` } : {}),
    };
  }

  return { term, ids: [], how: 'none' };
}

// A broad word, or null. Checked before item matching so "monsters" never lands on the narrow item.
export const broadGroupFor = (term) => BROAD_TERMS[normalise(term)] ?? null;

/**
 * Resolves a list of terms. Broad words become groups; everything else becomes item ids.
 * Throws nothing — the caller decides what to do with the misses.
 */
export function matchTerms(terms, vocabulary, opts) {
  const matched = [];
  const unmatched = [];
  const ids = new Set();
  const groups = new Set();
  for (const term of terms) {
    const group = broadGroupFor(term);
    if (group) {
      groups.add(group);
      matched.push({
        you_asked: term,
        broadened_to_group: group,
        how: 'broadened_to_group',
        note: `"${term}" -> group ${group} (${BROAD_NOTE[group] ?? 'a whole family of items'})`,
      });
      continue;
    }
    const m = matchTerm(term, vocabulary, opts);
    if (m.ids.length) {
      matched.push({ you_asked: term, matched: m.ids, how: m.how, ...(m.note ? { note: m.note } : {}) });
      m.ids.forEach((id) => ids.add(id));
    } else unmatched.push(term);
  }
  return { ids: [...ids], groups: [...groups], matched, unmatched };
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Resolves one group term. An id match, an exact label match, or a WHOLE-WORD match that is
 * unique. A bare substring is not enough: `group=e` used to be a substring of "copyable" and
 * silently filtered the whole film down to one group.
 * @returns {{id}|{error, candidates?}}
 */
export function matchGroup(term, groups) {
  const want = String(term).trim().toLowerCase();
  if (!want) return { error: 'empty' };

  const byId = groups.find((g) => g.id.toLowerCase() === want);
  if (byId) return { id: byId.id };
  const byLabel = groups.find((g) => g.label.toLowerCase() === want);
  if (byLabel) return { id: byLabel.id };

  const word = new RegExp(`\\b${escapeRe(want)}\\b`, 'i');
  const hits = groups.filter((g) => word.test(g.label) || word.test(g.id.replace(/_/g, ' ')));
  if (hits.length === 1) return { id: hits[0].id };
  if (hits.length > 1) return { error: 'ambiguous', candidates: hits.map((g) => g.id) };
  return { error: 'none' };
}

// The ids people reach for most, used when a term shares no word at all with the vocabulary.
const COMMON = ['monster_creature', 'large_predator', 'shark', 'darkness', 'gun', 'chased', 'dies', 'child_taken'];

// Five nearest labels, for a helpful 400.
export function suggest(term, vocabulary, n = 5) {
  const want = new Set(normalise(term).split(' '));
  const scored = vocabulary
    .map((v) => {
      const all = new Set([...keysFor(v)].flatMap((k) => k.split(' ')));
      let hits = 0;
      for (const w of want) if (all.has(w)) hits += 1;
      return { id: v.id, label: v.label, hits };
    })
    .sort((a, b) => b.hits - a.hits || a.id.localeCompare(b.id));

  // No word in common with anything: alphabetical neighbours would be noise, so offer the ids
  // parents actually ask for, from whatever layer was being searched.
  if (!scored.length || scored[0].hits === 0) {
    const pool = new Map(vocabulary.map((v) => [v.id, v]));
    const picks = COMMON.filter((id) => pool.has(id)).slice(0, n).map((id) => pool.get(id));
    const rest = picks.length ? picks : vocabulary.slice(0, n);
    return rest.map((v) => `${v.id} (${v.label})`);
  }
  return scored.slice(0, n).map((v) => `${v.id} (${v.label})`);
}
