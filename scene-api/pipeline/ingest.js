// The last stage: the same mapping code the loader runs, over values that never touched a file.
//
// `buildFilmFrom` in load.js is the single piece of code that turns an analysis into rows. It is
// deliberately the only one: a film added live has to be indistinguishable in the database from a
// film loaded from the experiment's outputs, or `/api/films/{slug}/scenes` is answering a slightly
// different question depending on where the row came from, and nothing in the response says which.
//
// What is NOT shared with the loader is how the rows land. The loader replaces: it deletes the film
// and writes it again, because re-running it over the experiment outputs is meant to do exactly
// that. A live run may only INSERT. Its slug was decided before admission, another run can have
// committed a film onto that slug in the minutes since, and "replace" would then mean deleting a
// stranger's film — cascading through its tracks, scenes, labels and recording — because two
// different films happen to share a title.

import { slugify } from '../lib/tmdb.js';
import { invalidateVocabularyCache } from '../lib/data.js';
import {
  buildFilmFrom, buildVocabulary, buildV2Map, ensureVocabulary, writeFilmRows, writeRecordingRows,
} from '../load.js';
import { fail } from './errors.js';
import * as srt from './srt.js';
import * as taxonomy from './taxonomy-v3.js';

/** The taxonomy-shaped half of the loader's context, from this package's own copy of taxonomy v3. */
export function ingestContext() {
  const { items } = buildVocabulary(taxonomy);
  return { srt, v2map: buildV2Map(taxonomy), vocabIds: new Set(items.map((i) => i.id)) };
}

/**
 * The slug this film may actually have, decided inside the transaction that writes it.
 *
 * Three answers, in order:
 *   - the same IMDb id is already in the database: this IS that film, and the run fails `exists`.
 *     Nothing is deleted and nothing is written; the honest answer is "it is already here".
 *   - the slug is free: use it.
 *   - the slug is taken by a DIFFERENT film: suffix it, the way `decorate` in lib/tmdb.js does at
 *     resolve time. Two films really can be called the same thing, and the second one is not a
 *     reason to remove the first.
 */
async function claimSlug(tx, film) {
  const { rows } = await tx.query('select id, slug, imdb_id from films');
  const imdbId = film.imdb_id ? String(film.imdb_id).toLowerCase() : null;
  const same = imdbId ? rows.find((r) => r.imdb_id && r.imdb_id.toLowerCase() === imdbId) : null;
  if (same) {
    throw fail('exists', `${film.title} is already in the database — it was added while this run was going.`);
  }

  // Re-derived from the title rather than trusted from the job row: the slug on the row was chosen
  // before admission, against a database that has changed since.
  const base = slugify(film.title, imdbId ?? film.slug ?? 'film');
  const taken = new Set(rows.flatMap((r) => [r.id, r.slug]));
  if (!taken.has(base)) return base;
  let slug = film.year ? `${base}-${film.year}` : base;
  for (let n = 2; taken.has(slug); n += 1) slug = `${base}-${n}`;
  return slug;
}

/**
 * Write one live-analysed film into the normal tables, plus its recording.
 *
 * Everything below happens in ONE transaction: the vocabulary rows the labels point at, the film,
 * its track, anchors, runs, scenes and labels, and the recording. The recording used to be a
 * separate statement after the film had already committed, so a failure there left a film with
 * scenes and no replay — and the job then failed, and restarting it was refused as `exists`,
 * because the half-written film was sitting on the slug. There is nothing to retry into now: a run
 * either put the whole film in or put nothing in.
 *
 * On PGlite (the tests, and `server.js --pglite`) `withTransaction` is the one connection, so this
 * cannot overlap another writer. That is fine here — a job is single-threaded and there is one live
 * job at a time — and on `pg` it is a real transaction on its own client.
 *
 * @param {object} db
 * @param {object} inputs
 * @param {{slug, title, year, imdb_id, poster_url, overview}} inputs.film the resolved TMDB record
 * @param {string} inputs.srtText
 * @param {string|null} inputs.releaseLabel what OpenSubtitles called the release
 * @param {object} inputs.sceneRun    from pipeline/scenes.js
 * @param {object|null} inputs.presenceRun from pipeline/presence.js
 * @param {object|null} inputs.jevRun from pipeline/record.js
 * @param {object} inputs.recording   from pipeline/record.js
 * @param {object|null} inputs.excerpts from pipeline/excerpts.js
 * @returns {Promise<{ report: object, scenes: number, slug: string }>}
 */
export async function ingestFilm(db, {
  film, srtText, releaseLabel = null, sceneRun, presenceRun = null, jevRun = null,
  recording = null, excerpts = null,
}) {
  const ctx = ingestContext();

  let out;
  try {
    out = await db.withTransaction(async (tx) => {
      const slug = await claimSlug(tx, film);
      const built = buildFilmFrom({
        slug,
        meta: { title: film.title, year: film.year ?? null, imdb_id: film.imdb_id ?? null },
        srtText,
        releaseLabel,
        sceneRun,
        // The pipeline modules are copies of these scripts, so the provenance rows name the copy
        // that actually ran rather than the experiment script that did not.
        sceneScript: 'pipeline/scenes.js',
        sceneSourceFile: null,
        r2Scenes: null, // one run only: confirmed_by_second_run stays null, which the API already means
        presenceRun,
        presenceScript: 'pipeline/presence.js',
        presenceSourceFile: null,
        jevRun,
        jevScript: 'pipeline/record.js',
        jevSourceFile: null,
      }, ctx);

      // TMDB's poster and synopsis were fetched once at resolve time; there is no reason to ask again.
      built.film.poster_url = film.poster_url ?? null;
      built.film.overview = film.overview ?? null;
      if (slug !== film.slug) built.report.notes.push(`slug ${film.slug} was taken by another film by the time this run finished; written as ${slug}`);

      // Missing rows only, and never an update: this is the one place a live run touches something
      // every film on the site shares. See ensureVocabulary in load.js.
      await ensureVocabulary(tx, taxonomy);
      await writeFilmRows(tx, built, { replace: false });
      if (recording) await writeRecordingRows(tx, built.film.id, { recording, excerpts });
      return { report: built.report, scenes: built.scenes.length, slug };
    });
  } catch (err) {
    // Somebody else committed this slug between `claimSlug` and the insert. The transaction has
    // rolled back, so their film is untouched; this run simply has nowhere to go.
    if (err?.code === '23505') {
      throw fail('exists', `${film.title} is already in the database — it was added while this run was going.`);
    }
    throw err;
  }

  // The vocabulary cache in lib/data.js is keyed on the db object, not on the transaction.
  invalidateVocabularyCache(db);
  return out;
}
