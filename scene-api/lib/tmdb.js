// Turning what somebody typed into a film this pipeline can actually analyse.
//
// Two things have to come out of it or the run cannot start: an IMDb id, because that is the only
// thing OpenSubtitles looks a film up by, and a slug, because that is this database's primary key
// and the URL a parent will end up on. TMDB supplies the first and the title supplies the second.
//
// Nothing here guesses. If TMDB has no IMDb id for a film, the candidate comes back with
// imdb_id: null and the job endpoint refuses it, rather than starting a run that is going to fail
// three seconds later on a subtitle search with nothing to search by.

import { HttpError } from './http.js';
import { TMDB_IMAGE_BASE } from '../load.js';

export const TMDB_BASE = 'https://api.themoviedb.org/3';
export const MAX_CANDIDATES = 3;
export const TMDB_TIMEOUT_MS = 8000;

/** An IMDb id typed on its own, pasted as a URL, or buried in one. */
export const IMDB_IN = /tt\d{6,10}/i;

/**
 * "Monsters, Inc." -> "monsters-inc". Punctuation goes, accents are folded, everything else becomes
 * a hyphen. A title that reduces to nothing at all (a film titled "?" exists) falls back to the
 * IMDb id, which is never empty by the time this is called.
 */
export function slugify(title, fallback = 'film') {
  const slug = String(title ?? '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || String(fallback);
}

async function tmdb(path, { apiKey, fetchImpl = globalThis.fetch, timeoutMs = TMDB_TIMEOUT_MS }) {
  const url = `${TMDB_BASE}${path}${path.includes('?') ? '&' : '?'}api_key=${encodeURIComponent(apiKey)}`;
  const controller = new AbortController();
  const deadline = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, { signal: controller.signal });
    if (!res?.ok) throw new HttpError(502, 'TMDB did not answer that lookup, so there is nothing to choose from. Try again in a moment.', { error_code: 'tmdb_failed' });
    // Still inside the deadline: aborting the controller rejects the body read too.
    return await res.json();
  } catch (err) {
    if (err instanceof HttpError) throw err;
    throw new HttpError(502, 'TMDB could not be reached, so there is nothing to choose from. Try again in a moment.', { error_code: 'tmdb_failed' });
  } finally {
    clearTimeout(deadline);
  }
}

const posterUrl = (p) => (typeof p === 'string' && p.startsWith('/') ? `${TMDB_IMAGE_BASE}${p}` : null);
const yearOf = (date) => (typeof date === 'string' && /^\d{4}/.test(date) ? Number(date.slice(0, 4)) : null);
const overviewOf = (o) => (typeof o === 'string' && o.trim() ? o.trim() : null);

/**
 * The films a query could mean, best first, at most three.
 *
 * @param {object} db  used only to answer `exists` and to keep a new slug off an existing one
 * @param {string} query a title, an IMDb id, or any URL with one in it
 * @returns {Promise<Array<{tmdb_id, imdb_id, title, year, poster_url, overview, slug, exists}>>}
 */
export async function resolveCandidates(db, query, opts) {
  const text = String(query ?? '').trim();
  if (!text) throw new HttpError(400, 'Type a film title, or paste an IMDb link.', { error_code: 'empty_query' });

  const imdbMatch = text.match(IMDB_IN);
  const raw = imdbMatch
    // /find takes the IMDb id directly, so an id or a pasted link involves no title guessing at all.
    ? ((await tmdb(`/find/${imdbMatch[0].toLowerCase()}?external_source=imdb_id`, opts))?.movie_results ?? []).slice(0, MAX_CANDIDATES)
    : ((await tmdb(`/search/movie?query=${encodeURIComponent(text)}&include_adult=false`, opts))?.results ?? []).slice(0, MAX_CANDIDATES);

  const out = [];
  for (const hit of raw) {
    if (!hit?.id) continue;
    // A title search gives no IMDb id, and that is the one field the pipeline cannot do without, so
    // it costs one more request per candidate. /find already carries everything.
    const full = imdbMatch ? hit : await tmdb(`/movie/${hit.id}?append_to_response=external_ids`, opts);
    const imdbId = imdbMatch
      ? (imdbMatch[0].toLowerCase())
      : (full?.external_ids?.imdb_id ?? full?.imdb_id ?? null);
    out.push({
      tmdb_id: hit.id,
      imdb_id: imdbId || null,
      title: full?.title ?? hit.title ?? text,
      year: yearOf(full?.release_date ?? hit.release_date),
      poster_url: posterUrl(full?.poster_path ?? hit.poster_path),
      overview: overviewOf(full?.overview ?? hit.overview),
    });
  }
  return decorate(db, out);
}

/**
 * Fill in `slug` and `exists` for a list of candidates.
 *
 * The year suffix is added only on a collision, so the common case stays the readable slug. A
 * collision with a film that IS this film (same IMDb id) is not disambiguated at all: it keeps the
 * existing slug and comes back `exists: true`, because the honest answer to "add The Lion King" when
 * The Lion King is already loaded is "it is already here", not a second copy under lion-king-1994.
 *
 * Candidates also collide with EACH OTHER: "the gruffalo" returns the 2009 film and the 2004 stage
 * recording, and two rows offering the same slug would mean the second one silently replaced the
 * first. Taken slugs therefore accumulate as the list is walked, not just at the start.
 */
export async function decorate(db, candidates) {
  if (!candidates.length) return [];
  const { rows } = await db.query('select slug, imdb_id from films');
  const bySlug = new Map(rows.map((r) => [r.slug, r]));
  const byImdb = new Map(rows.filter((r) => r.imdb_id).map((r) => [r.imdb_id.toLowerCase(), r]));

  return candidates.map((c) => {
    const already = c.imdb_id ? byImdb.get(c.imdb_id.toLowerCase()) : null;
    if (already) return { ...c, slug: already.slug, exists: true };

    const base = slugify(c.title, c.imdb_id ?? `tmdb-${c.tmdb_id}`);
    // No IMDb id to compare on and the slug is taken: assume it is the same film rather than load a
    // second copy of it under a suffixed slug. It cannot be analysed anyway — OpenSubtitles has
    // nothing to look it up by — so "already here" is the only useful thing to say about it.
    if (!c.imdb_id && bySlug.has(base)) return { ...c, slug: base, exists: true };

    let slug = base;
    if (bySlug.has(slug) && c.year) slug = `${base}-${c.year}`;
    for (let n = 2; bySlug.has(slug); n += 1) slug = `${base}-${n}`;
    bySlug.set(slug, { slug, imdb_id: c.imdb_id });
    return { ...c, slug, exists: false };
  });
}
