// The library is the search. One rule set decides three things — which cards the shelf shows while
// a parent types, whether the server redirects `?q=` straight to a film, and where the Enter key
// goes once the page has hydrated — so they are tested together here, as the page composes them.
//
// `matchFilms` is the filter; `soleMatch` is the "open it without asking" rule. Both are pure, so
// this needs no database and no rendering.

import test from 'node:test';
import assert from 'node:assert/strict';
import { matchFilms, soleMatch } from '../lib/search';
import { libraryCount } from '../lib/copy';

const film = (title: string, year: number | null) => ({ title, year, slug: title.toLowerCase() });

const LIBRARY = [
  film('Finding Nemo', 2003),
  film('The Lion King', 1994),
  film('The Iron Giant', 1999),
  film('Monsters, Inc.', 2001),
  film('Frankenweenie', 2012),
  film('The Wild Robot', 2024),
];

/** Exactly what LibraryShelf renders: every film until a query narrows it. */
const shelf = (query: string) => (query.trim() ? matchFilms(LIBRARY, query).films : LIBRARY);

test('an empty query shows the whole shelf, and opens nothing', () => {
  for (const nothing of ['', '   ']) {
    assert.equal(shelf(nothing).length, LIBRARY.length, `"${nothing}" must leave the shelf whole`);
    assert.equal(soleMatch(LIBRARY, nothing), null, 'an empty field is not a request for one film');
  }
});

test('typing narrows the shelf letter by letter, with the same rules the server used', () => {
  // The sequence a parent types. The shelf is the filter's output at every step.
  assert.deepEqual(shelf('t').map((f) => f.title), [
    'The Lion King',
    'The Iron Giant',
    'Monsters, Inc.',
    'The Wild Robot',
  ]);
  assert.deepEqual(shelf('the ').map((f) => f.title), ['The Lion King', 'The Iron Giant', 'The Wild Robot']);
  // Every word has to appear somewhere in the title, so "the l" still leaves The Wild Robot
  // standing — the "l" is in "Wild". One letter more settles it.
  assert.deepEqual(shelf('the l').map((f) => f.title), ['The Lion King', 'The Wild Robot']);
  assert.deepEqual(shelf('the li').map((f) => f.title), ['The Lion King']);
  assert.deepEqual(shelf('nemo').map((f) => f.title), ['Finding Nemo']);

  // Punctuation and case are folded on both sides, so a parent never has to type a comma.
  assert.deepEqual(shelf('monsters inc').map((f) => f.title), ['Monsters, Inc.']);
});

test('a query that means nothing empties the shelf rather than filling it', () => {
  // Matching everything would answer a question nobody asked, and the "not on our shelf" panel
  // with its "Add this movie" button is the honest answer.
  for (const nonsense of ['???', '🦈', 'finding dory']) {
    assert.deepEqual(shelf(nonsense), [], `"${nonsense}" must match no film`);
    assert.equal(soleMatch(LIBRARY, nonsense), null);
  }
});

test('one match, or an exact title, is opened without asking — and nothing else is', () => {
  // The rule Home's form depends on: "Finding Nemo" typed on Home must land on the film page.
  assert.equal(soleMatch(LIBRARY, 'Finding Nemo')?.slug, 'finding nemo');
  // A fragment that leaves one film standing counts too: one card is not a choice.
  assert.equal(soleMatch(LIBRARY, 'nemo')?.slug, 'finding nemo');
  assert.equal(soleMatch(LIBRARY, 'the li')?.slug, 'the lion king');
  // Several matches are a shelf to look at, never a guess.
  assert.equal(soleMatch(LIBRARY, 'the'), null);
  assert.equal(shelf('the').length, 3);
  // A year in the query is a filter: the 2019 remake is not the 1994 film we hold.
  assert.equal(soleMatch(LIBRARY, 'The Lion King 2019'), null);
  assert.equal(soleMatch(LIBRARY, 'The Lion King 1994')?.slug, 'the lion king');
});

test('two films with the same title are never opened, however exactly they are named', () => {
  const twins = [film('The Jungle Book', 1967), { ...film('The Jungle Book', 2016), slug: 'jungle-2016' }];
  assert.equal(soleMatch(twins, 'The Jungle Book'), null, 'an ambiguous exact title must not auto-open');
  assert.equal(matchFilms(twins, 'The Jungle Book').films.length, 2, 'both are offered as a choice');
  assert.equal(soleMatch(twins, 'The Jungle Book 2016')?.slug, 'jungle-2016');
});

test('the count the shelf announces says what happened, in whole films', () => {
  assert.equal(libraryCount(6, 6), '6 films');
  assert.equal(libraryCount(2, 6), '2 films match');
  assert.equal(libraryCount(1, 6), '1 film matches');
  assert.equal(libraryCount(1, 1), '1 film');
  assert.equal(libraryCount(0, 6), 'No film matches');
});
