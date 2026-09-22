import test from 'node:test';
import assert from 'node:assert/strict';
import { extractYear, isExactTitle, matchFilms, matchesByWords, normalise, queryWords } from '../lib/search';

const film = (title: string, year: number | null) => ({ title, year });

const LIBRARY = [
  film('Finding Nemo', 2003),
  film('The Lion King', 1994),
  film('The Iron Giant', 1999),
  film('Monsters, Inc.', 2001),
  film('Frankenweenie', 2012),
  film('The Wild Robot', 2024),
];

test('folding a title drops case, punctuation, spacing and accents', () => {
  assert.equal(normalise('Monsters, Inc.'), 'monstersinc');
  assert.equal(normalise('WALL·E'), 'walle');
  assert.equal(normalise('Amélie'), 'amelie');
  assert.equal(normalise('AMÉLIE'), 'amelie');
  assert.equal(normalise('El Niño'), 'elnino');
  // The case the ASCII character class got wrong: it deleted the accented letter itself, so
  // "Amélie" folded to "amlie" and no spelling of it could ever match.
  assert.notEqual(normalise('Amélie'), 'amlie');
  assert.equal(normalise('???'), '');
  assert.equal(normalise('🦈'), '');
});

test('a query that means nothing matches nothing, rather than everything', () => {
  // The bug: these folded to an empty string and became LIKE '%%', which matched every film and
  // then, being a single result on some queries, redirected into one.
  for (const nonsense of ['???', '🦈', '...', '   ', '!!!', '“”']) {
    const { films, exact } = matchFilms(LIBRARY, nonsense);
    assert.deepEqual(films, [], `"${nonsense}" must match no film`);
    assert.equal(exact, null);
  }
});

test('a year in the query is a filter, and a wrong year is no match', () => {
  assert.equal(extractYear('The Lion King 2019'), 2019);
  assert.equal(extractYear('The Lion King'), null);
  assert.equal(extractYear('2001: A Space Odyssey'), 2001);

  // The remake is not the film we have. Matching it to the 1994 one and then redirecting there
  // was the failure: the parent would have been shown a scene guide for a different film.
  const remake = matchFilms(LIBRARY, 'The Lion King 2019');
  assert.deepEqual(remake.films, []);
  assert.equal(remake.exact, null);

  // The right year still finds it, and the year is not required.
  assert.deepEqual(matchFilms(LIBRARY, 'The Lion King 1994').films.map((f) => f.title), ['The Lion King']);
  assert.deepEqual(matchFilms(LIBRARY, 'The Lion King').films.map((f) => f.title), ['The Lion King']);
  assert.equal(matchFilms(LIBRARY, 'The Lion King 1994').exact?.title, 'The Lion King');
});

test('every word of the query has to appear in the title', () => {
  assert.ok(matchesByWords('Finding Nemo', 'nemo finding'));
  assert.ok(matchesByWords('Monsters, Inc.', 'monsters inc'));
  assert.ok(!matchesByWords('Finding Nemo', 'finding dory'));
  assert.deepEqual(queryWords('The Lion King 1994'), ['the', 'lion', 'king']);

  // "the" is in three titles; a substring test in either direction is not enough on its own.
  const the = matchFilms(LIBRARY, 'the');
  assert.deepEqual(the.films.map((f) => f.title), ['The Lion King', 'The Iron Giant', 'The Wild Robot']);
  assert.equal(the.exact, null, 'three matches must be offered as a choice');
});

test('accents are optional in both directions', () => {
  const accented = [film('Amélie', 2001), film('Amelie Goes to Town', 1938)];

  // "Amelie" finds both, and opens the one whose whole title it is.
  const plain = matchFilms(accented, 'Amelie');
  assert.deepEqual(plain.films.map((f) => f.title), ['Amélie', 'Amelie Goes to Town']);
  assert.equal(plain.exact?.title, 'Amélie');

  // And the accented spelling behaves identically.
  const withAccent = matchFilms(accented, 'Amélie');
  assert.deepEqual(withAccent.films.map((f) => f.title), ['Amélie', 'Amelie Goes to Town']);
  assert.equal(withAccent.exact?.title, 'Amélie');

  assert.ok(isExactTitle('Amélie', 'amelie'));
  assert.ok(isExactTitle('Amelie', 'Amélie'));
});

test('two films with the same name are never guessed between', () => {
  // Remakes share titles. Opening one of them without asking would show a parent the wrong
  // film's scenes — the one failure this whole page exists to avoid.
  const twins = [film('The Jungle Book', 1967), film('The Jungle Book', 2016)];
  const both = matchFilms(twins, 'The Jungle Book');
  assert.equal(both.films.length, 2);
  assert.equal(both.exact, null, 'an ambiguous exact title must not auto-open');

  // With a year, it is no longer ambiguous.
  const one = matchFilms(twins, 'The Jungle Book 2016');
  assert.equal(one.films.length, 1);
  assert.equal(one.exact?.year, 2016);
});

test('an exact title is exact after folding, not before', () => {
  assert.equal(matchFilms(LIBRARY, 'monsters inc').exact?.title, 'Monsters, Inc.');
  assert.equal(matchFilms(LIBRARY, '  the lion king  ').exact?.title, 'The Lion King');
  assert.equal(matchFilms(LIBRARY, 'nemo').exact, null, 'a fragment is not an exact title');
  assert.deepEqual(matchFilms(LIBRARY, 'nemo').films.map((f) => f.title), ['Finding Nemo']);
});
