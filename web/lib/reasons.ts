// Why a scene is on the list, said the way a parent would say it.
//
// The pipeline gives a flagged scene one tag per question that fired: "The Iron Giant in danger",
// "Hogarth Hughes in danger", "Child in danger", "Caught in danger", "Power substation electrocution
// endangers someone", "Dangerous machinery", "Afraid for safety"… Every one is true, and together they
// read like a machine's log: several say the same thing twice. This file folds the overlapping ones
// into a few reasons — "The Giant and Hogarth in danger", "Danger from electricity" — and keeps every
// individual check inside each reason, so nothing is hidden, only grouped.
//
// Pure and shared: the live check's scene view and the film page's open row group the same way.
// A group's name is built from the tags' own words (a character's name shortened only to a form the
// film's own checked text already uses), with one exception: a short, fixed list of physical hazards
// is named by the plain word a parent would use ("electricity", not "power substation electrocution").

/** The least a tag must carry to be grouped: its label, and (from a v10.4 guide) its rule and category. */
export type TagLike = {
  label: string;
  category?: string | null;
  rule?: string | null;
  /** A reason that counts only alongside others: the labels it counted with. */
  with?: string[];
};

export type ReasonGroup<T extends TagLike> = {
  /** What a parent reads: "The Giant and Hogarth in danger", "Danger from electricity". */
  label: string;
  /** The stable category, for a chip or a filter: "Character in danger", or the label itself. */
  category: string;
  /** Every check behind the reason, in the order the pipeline ranked them. */
  items: T[];
};

type FilmKind = 'person' | 'threat' | 'danger';

/** The pipeline's film-specific rules (select.js) and the categories the scene API files them under. */
const RULE_KIND: Record<string, FilmKind> = {
  film_child_in_danger: 'person',
  film_threatens: 'threat',
  film_danger: 'danger',
};
const CATEGORY_KIND: Record<string, FilmKind> = {
  'character in danger': 'person',
  'villain or creature threatens': 'threat',
  'dangerous situation': 'danger',
};
const KIND_CATEGORY: Record<FilmKind, string> = {
  person: 'Character in danger',
  threat: 'Villain or creature threatens',
  danger: 'Dangerous situation',
};

/** "<X> in danger" labels that are the general questions, not a character of the film. */
const GENERAL_SUBJECTS = new Set(['child', 'a child', 'character', 'a character', 'caught', 'family', 'animal', 'someone', 'physical']);

/**
 * The general questions that say again what a film-specific reason already says, and the kind of
 * reason each one folds into. Anything not listed stays a reason of its own ("Weapon used", "Chased").
 */
const JOINS: Record<string, FilmKind[]> = {
  'child in danger': ['person'],
  'character in danger': ['person'],
  'afraid for safety': ['person'],
  'physical danger': ['person'],
  // Caught in a dangerous force or place: the film's named danger when there is exactly one, else
  // the characters in danger.
  'caught in danger': ['danger', 'person'],
  'dangerous machinery': ['danger'],
  'creature threatens': ['threat'],
  'threat to kill or hurt': ['threat'],
};

const COOCCUR = 'strong_event+cooccur';

/**
 * A reason that only ever counts alongside another: the co-occurrence rule's, or — on a guide stored
 * without its rules — "Afraid for safety", which the flag policy never lets count alone.
 */
const SUPPORTING = new Set(['afraid for safety']);
const supporting = (tag: TagLike) => tag.rule === COOCCUR || (!tag.rule && SUPPORTING.has(tag.label.trim().toLowerCase()));

type Film = { kind: FilmKind; name: string };

/** A film-specific reason's kind and the character or danger it names; null for a general question. */
export function filmReason(tag: TagLike): Film | null {
  const label = tag.label.trim();
  const byRule = (tag.rule && RULE_KIND[tag.rule]) || null;
  const byCategory = (tag.category && CATEGORY_KIND[tag.category.trim().toLowerCase()]) || null;
  const said = byRule ?? byCategory;
  let m = /^(.+?)\s+endangers someone$/i.exec(label);
  if (m && (said ?? 'danger') === 'danger') return { kind: 'danger', name: m[1] };
  m = /^(.+?)\s+threatens someone$/i.exec(label);
  if (m && (said ?? 'threat') === 'threat') return { kind: 'threat', name: m[1] };
  m = /^(.+?)\s+in danger$/i.exec(label);
  if (m && (said === 'person' || (!said && /^\p{Lu}/u.test(m[1]) && !GENERAL_SUBJECTS.has(m[1].toLowerCase())))) {
    return { kind: 'person', name: m[1] };
  }
  // A rule or category that says film-specific, on a label in words this file does not know: the
  // label is the name, as it stands.
  return said ? { kind: said, name: label } : null;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Does the film's text use this word as a word of its own, capitalised as given? */
function usesWord(word: string, context: string): boolean {
  return new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRe(word)}(?![\\p{L}\\p{N}])`, 'u').test(context);
}

/** Does the film's text write this word capitalised inside a sentence (a proper noun, not a sentence start)? */
function properInText(word: string, context: string): boolean {
  return new RegExp(`[\\p{Ll},;:]\\s+${escapeRe(word)}(?![\\p{L}\\p{N}])`, 'u').test(context);
}

const HONORIFIC = /^(mr|mrs|ms|miss|mx|dr|doctor|captain|capt|king|queen|prince|princess|lord|lady|sir|dame|uncle|aunt|auntie|grandma|grandpa|granny|professor|prof|officer|agent|general|chief|mayor|mother|father|mama|papa|sister|brother|saint|st)\.?$/i;

/**
 * A character's name as the film's checked text says it: "Hogarth Hughes" → "Hogarth", "The Iron
 * Giant" → "The Giant", "Kent Mansley" → "Mansley" (whichever of the name's own words the text uses).
 * The full name when the text uses none of them, or when the name starts with a title ("Mr. Ray").
 */
export function shortName(name: string, context: string): string {
  const full = name.trim().replace(/\s+/g, ' ');
  const nick = /["“”]([^"“”]+)["“”]/.exec(full)?.[1]?.trim();
  if (nick && usesWord(nick, context)) return nick;
  const words = full.split(' ');
  if (words.length < 2 || HONORIFIC.test(words[0])) return full;
  const article = /^the$/i.test(words[0]);
  const rest = article ? words.slice(1) : words;
  if (rest.length < 2) return full;
  // Only a use of the word on its own counts: "Tai" inside "Tai Lung" does not make "Tai" his name.
  const alone = context.replace(new RegExp(escapeRe(article ? rest.join(' ') : full), 'gi'), ' ');
  // A "The …" name is called by its last word ("the Giant"); a person by their first name, else their surname.
  const candidates = article ? [rest[rest.length - 1]] : [rest[0], rest[rest.length - 1], ...rest.slice(1, -1)];
  for (const raw of candidates) {
    const word = raw.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
    if (word.length < 2 || !/^\p{Lu}/u.test(word)) continue;
    if (usesWord(word, alone)) return article ? `The ${word}` : word;
  }
  return full;
}

/** "The Giant", "Hogarth" → "The Giant and Hogarth"; the article is lower case after the first. */
function joinNames(names: string[]): string {
  const shown = names.length > 3 ? names.slice(0, 2) : names;
  const said = shown.map((n, i) => (i > 0 ? n.replace(/^The /, 'the ') : n));
  if (names.length > 3) return `${said.join(', ')} and ${names.length - 2} others`;
  if (said.length <= 1) return said[0] ?? '';
  return `${said.slice(0, -1).join(', ')} and ${said[said.length - 1]}`;
}

/**
 * Physical hazards a parent names by what does the harm, not by the event the pipeline's danger names:
 * "Power substation electrocution" is danger from electricity. The only words `groupReasons` uses that
 * the tags do not: a fixed list, each a plain noun, matched only on unambiguous words.
 */
const PLAIN_HAZARDS: [RegExp, string][] = [
  [/\belectrocut\w*|\belectri(?:city|cal)\b|\belectric (?:shocks?|fences?|currents?|wires?|cables?)\b|\bsubstation|\bpower[- ]?lines?\b|\bhigh[- ]voltage\b/i, 'electricity'],
];

/** The plain word for a danger from PLAIN_HAZARDS ("electricity"), or null when it is not one of them. */
export function plainHazard(name: string): string | null {
  return PLAIN_HAZARDS.find(([re]) => re.test(name))?.[1] ?? null;
}

/**
 * A film's danger after "Danger from": a plain hazard by its plain word ("Power substation
 * electrocution" → "electricity"); anything else in its own words, lower-cased ("Tar flow" → "tar
 * flow"). A proper noun keeps its capital (the film's text writes it capitalised mid-sentence, or it
 * is a possessive such as "Scar's hyenas", an acronym, or a name of several capitalised words such as
 * "Tai Lung's escape").
 */
export function dangerPhrase(name: string, context: string): string {
  const plain = plainHazard(name);
  if (plain) return plain;
  const words = name.trim().replace(/\s+/g, ' ').split(' ');
  const first = words[0] ?? '';
  if (/^(the|a|an)$/i.test(first)) return [first.toLowerCase(), ...words.slice(1)].join(' ');
  const named = /['’]/.test(first) || (first.length > 1 && first === first.toUpperCase()) || /^\p{Lu}/u.test(words[1] ?? '');
  if (named || properInText(first, context)) return words.join(' ');
  return [first.charAt(0).toLowerCase() + first.slice(1), ...words.slice(1)].join(' ');
}

/**
 * General questions that ask the same thing at different strengths: the strongest one present names
 * the reason and the others fold into it ("Deadly fall" over "Falling" over "Nearly falls").
 */
const FAMILIES: string[][] = [['deadly fall', 'falling', 'nearly falls']];

/** With no character of the film named, the general "a child / a character is in danger" question anchors the group. */
const PERSON_ANCHORS = ['child in danger', 'character in danger'];

/**
 * The reasons a scene is on the list, grouped: every film-specific character in danger is one reason
 * ("The Giant and Hogarth in danger"); each named danger ("Danger from …") and each named villain
 * ("Scar threatens someone") is one; a general question that only says one of those again folds into
 * it (JOINS; with no character named, "Child in danger" is the group they fold into), and a reason that
 * counts only alongside another (the co-occurrence rule) goes with the reason it counted with. Everything
 * else is a reason of its own. Groups keep the pipeline's order (strongest first), by where their first
 * check stood.
 *
 * `context` is the film's checked text (its scenes' titles and descriptions), used only to shorten a
 * character's name to a form the film's text already uses.
 */
export function groupReasons<T extends TagLike>(tags: T[], context = ''): ReasonGroup<T>[] {
  type Slot = { key: string; first: number; items: { tag: T; at: number }[]; kind: FilmKind | null; film: Film | null; name: string | null };
  const slots = new Map<string, Slot>();
  const slotOf = new Map<number, string>();
  const lower = (t: TagLike) => t.label.trim().toLowerCase();
  const open = (key: string, kind: FilmKind | null, film: Film | null, name: string | null) => {
    if (!slots.has(key)) slots.set(key, { key, first: Infinity, items: [], kind, film, name });
    return key;
  };
  const put = (key: string, at: number) => {
    const slot = slots.get(key)!;
    slot.first = Math.min(slot.first, at);
    slot.items.push({ tag: tags[at], at });
    slotOf.set(at, key);
  };

  // 1. The film-specific reasons: all characters in danger together; each danger and villain alone.
  const general: number[] = [];
  tags.forEach((tag, at) => {
    const film = filmReason(tag);
    if (!film) return general.push(at);
    // Two named dangers with one plain word ("Power lines", "Substation electrocution") are one reason.
    const name = (film.kind === 'danger' && plainHazard(film.name)) || film.name.toLowerCase();
    put(open(film.kind === 'person' ? 'person' : `${film.kind}:${name}`, film.kind, film, null), at);
  });
  const ofKind = (kind: FilmKind) => [...slots.values()].filter((s) => s.kind === kind);

  // 2. The general anchors: "Child in danger" when no character is named; the strongest of a family.
  if (!ofKind('person').length) {
    const at = general.find((i) => PERSON_ANCHORS.includes(lower(tags[i])));
    if (at !== undefined) open('person', 'person', null, tags[at].label.trim());
  }
  const familyOf = new Map<string, string>();
  for (const family of FAMILIES) {
    const present = family.filter((label) => general.some((i) => lower(tags[i]) === label));
    if (present.length < 2) continue;
    const anchor = general.find((i) => lower(tags[i]) === present[0])!;
    const key = open(`family:${present[0]}`, null, null, tags[anchor].label.trim());
    for (const label of present) familyOf.set(label, key);
  }

  // 3. General questions that repeat a reason fold into it; the rest stand alone. A co-occurring
  //    reason waits until every reason it could go with has a place.
  const later: number[] = [];
  for (const at of general) {
    const tag = tags[at];
    if (supporting(tag)) {
      later.push(at);
      continue;
    }
    put(familyOf.get(lower(tag)) ?? (PERSON_ANCHORS.includes(lower(tag)) && slots.get('person')?.film === null ? 'person' : null) ?? joinTarget(tag, ofKind) ?? open(`label:${lower(tag)}`, null, null, null), at);
  }
  for (const at of later) {
    const tag = tags[at];
    const withKey = (tag.with ?? [])
      .map((label) => tags.findIndex((t) => lower(t) === label.trim().toLowerCase()))
      .map((i) => (i >= 0 ? slotOf.get(i) : undefined))
      .find((k): k is string => Boolean(k));
    // With no partner named (a guide stores the rule, not the partners), the reason it supports is
    // the scene's leading one.
    const leading = [...slots.values()].filter((x) => x.items.length > 0).sort((a, b) => a.first - b.first)[0]?.key;
    put(withKey ?? joinTarget(tag, ofKind) ?? leading ?? open(`label:${lower(tag)}`, null, null, null), at);
  }

  // 4. Name each group.
  const names = (slot: Slot) => {
    const seen: string[] = [];
    for (const { tag } of slot.items) {
      const film = filmReason(tag);
      if (film?.kind !== 'person') continue;
      const short = shortName(film.name, context);
      if (!seen.some((n) => n.toLowerCase() === short.toLowerCase())) seen.push(short);
    }
    return seen;
  };
  return [...slots.values()]
    .filter((slot) => slot.items.length > 0)
    .sort((a, b) => a.first - b.first)
    .map((slot) => {
      const items = slot.items.sort((a, b) => a.at - b.at).map((x) => x.tag);
      const film = slot.film;
      if (!film) {
        const label = slot.name ?? items[0].label.trim();
        // A general anchor ("Child in danger") is its own category, as it always was.
        const category = slot.name ? label : (items[0].category ?? items[0].label).trim();
        return { label, category, items };
      }
      const label =
        film.kind === 'person'
          ? `${joinNames(names(slot))} in danger`
          : film.kind === 'danger'
            ? `Danger from ${dangerPhrase(film.name, context)}`
            : `${shortName(film.name, context)} threatens someone`;
      return { label, category: KIND_CATEGORY[film.kind], items };
    });
}

/** Where a general question folds: the one reason of a kind it repeats, if there is exactly one. */
function joinTarget<T extends TagLike>(tag: T, ofKind: (kind: FilmKind) => { key: string }[]): string | null {
  for (const kind of JOINS[tag.label.trim().toLowerCase()] ?? []) {
    const found = ofKind(kind);
    // All characters share one group; a danger or a villain only when it is the only one named.
    if (found.length === 1) return found[0].key;
  }
  return null;
}

/** The film's checked text, for `shortName`: its scenes' titles and descriptions, one per line. */
export function nameContext(scenes: { title?: string | null; description?: string | null }[]): string {
  return scenes
    .flatMap((s) => [s.title, s.description])
    .filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
    .join('\n');
}
