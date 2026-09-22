// A whole scene database, in process, with no external Postgres.
//
// @electric-sql/pglite is real Postgres 16 compiled to WebAssembly, so the same schema.sql and the
// same parameterised SQL the deployed API runs are exercised here.

import { PGlite } from '@electric-sql/pglite';
import { pgliteAdapter, setDb } from '../lib/db.js';
import { loadAll } from '../load.js';

export async function freshDb() {
  return pgliteAdapter(new PGlite());
}

let loaded = null;

// One loaded database per test process.
export async function loadedDb() {
  if (!loaded) {
    loaded = await freshDb();
    // tmdbApiKey: null explicitly. Without it the loader reads TMDB_API_KEY from the environment,
    // so a developer with a key in their shell would have the whole suite making network calls —
    // slow, flaky, and a different database from the one CI tests. A test that wants posters mocks
    // the fetch and passes its own key.
    await loadAll(loaded, { tmdbApiKey: null });
    setDb(loaded); // so the handlers under api/ use it too
  }
  return loaded;
}

export const ms = (hms) => {
  const [h, m, s] = hms.split(':').map(Number);
  return ((h * 60 + m) * 60 + s) * 1000;
};
