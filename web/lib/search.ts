// Name matching, as pure functions over the film list, so every rule is testable without a
// database and without a collation.
//
// Matching used to be half SQL and half JavaScript. It is all here now, for three reasons: the SQL
// half could not fold accents portably (Postgres needs the `unaccent` extension, which Neon may or
// may not have enabled), a `LIKE '%%'` on an empty normalised query matched every film, and a
// reverse-substring test matched "The Lion King 2019" to the 1994 film and then redirected to it.
// The library is small and already fetched for other reasons, so matching it in one place costs
// nothing and can be held to one set of rules.

export type Matchable = { title: string; year: number | null };

/** A year in a film title is part of the name; a year a person types is a filter. 1888 is cinema. */
const YEAR = /\b(1[89]\d{2}|20\d{2})\b/;

/**
 * Fold a title or a query down to bare letters and digits: lower case, accents removed, everything
 * else dropped. Unicode-aware, so it behaves the same for any alphabet.
 *
 * NFD splits an accented letter into letter + combining mark and \p{M} then removes the mark, so
 * "Amélie" and "Amelie" both become "amelie". Both sides of every comparison go through this one
 * function — that is the whole point of it existing.
 */
export function normalise(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .replace(/[^\p{L}\p{N}]+/gu, '');
}

/** The four-digit year a person typed, if they typed one. */
export function extractYear(query: string): number | null {
  const hit = YEAR.exec(query);
  return hit ? Number(hit[1]) : null;
}

/**
 * The words of a query, folded, with a year removed: the year is handled as a filter, not as a word
 * to find inside the title. Words that fold to nothing (punctuation, an emoji) disappear here.
 */
export function queryWords(query: string): string[] {
  return query
    .replace(YEAR, ' ')
    .split(/\s+/)
    .map(normalise)
    .filter(Boolean);
}

/** Every word of the query appears somewhere in the title, in any order, accents optional. */
export function matchesByWords(title: string, query: string): boolean {
  const words = queryWords(query);
  if (!words.length) return false;
  const folded = normalise(title);
  return words.every((word) => folded.includes(word));
}

/** An exact title once both sides are folded: case, punctuation and accents all ignored. */
export function isExactTitle(title: string, query: string): boolean {
  const q = normalise(query.replace(YEAR, ' '));
  return q.length > 0 && normalise(title) === q;
}

export type MatchResult<T> = {
  films: T[];
  /**
   * The one film to open without asking. Null unless exactly one film matches the whole title:
   * two films with the same name must always be offered as a choice, never guessed between.
   */
  exact: T | null;
};

/**
 * Match a query against the library.
 *
 * The rules, in order:
 *  1. A query that folds to nothing — "???", "🦈", spaces — matches nothing. Matching everything
 *     would answer a question the parent did not ask.
 *  2. A four-digit year is a hard filter. "The Lion King 2019" must not open the 1994 film; if no
 *     film has that year, there is no match, and the "not on our shelf" state is the truth.
 *  3. Every remaining word must appear in the title. All of the words, in any order.
 *  4. A film whose whole title matches is preferred — but only if it is the only one.
 */
export function matchFilms<T extends Matchable>(films: T[], query: string): MatchResult<T> {
  const trimmed = query.trim();
  const words = queryWords(trimmed);
  const year = extractYear(trimmed);

  // A year on its own is a real question ("what do you have from 1994?"); anything else that folds
  // to nothing is not.
  if (!words.length && year === null) return { films: [], exact: null };

  const byYear = year === null ? films : films.filter((f) => f.year === year);
  const matched = words.length
    ? byYear.filter((film) => {
        const folded = normalise(film.title);
        return words.every((word) => folded.includes(word));
      })
    : byYear;

  const exactMatches = matched.filter((film) => isExactTitle(film.title, trimmed));
  return { films: matched, exact: exactMatches.length === 1 ? exactMatches[0] : null };
}

/**
 * The one film a query may open without asking, or null.
 *
 * Two callers depend on this being the same rule in both places: the library page redirects to a
 * film on load when the query names one (which is what Home's form relies on), and the shelf's own
 * submit handler pushes to the same film when JavaScript is running. If they disagreed, pressing
 * Enter would go somewhere different depending on whether the page had hydrated.
 *
 * An empty query opens nothing: a parent who has typed nothing has asked for the whole shelf.
 */
export function soleMatch<T extends Matchable>(films: T[], query: string): T | null {
  if (!query.trim()) return null;
  const { films: matched, exact } = matchFilms(films, query);
  return exact ?? (matched.length === 1 ? matched[0] : null);
}
