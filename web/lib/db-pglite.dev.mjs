// The in-memory development database. Local only, and never part of a production build.
//
// This file is plain JavaScript, loaded by lib/db.ts through an absolute path built at runtime, so
// no bundler ever follows it. That is the point: PGlite's WebAssembly Postgres and the scene-api
// loader (which lives outside this app) must not be traced into the server bundle for a code path
// that only runs on a developer's machine.
//
// It builds the whole scene database in memory from the files in experiments/trigger-scan, so
// `npm run dev` needs no Postgres, no Neon and no network.

import path from 'node:path';
import { pathToFileURL } from 'node:url';

export async function createDevDb() {
  const { PGlite } = await import('@electric-sql/pglite');

  const sceneApi = path.resolve(process.cwd(), '..', 'scene-api');
  const load = await import(pathToFileURL(path.join(sceneApi, 'load.js')).href);
  const dbLib = await import(pathToFileURL(path.join(sceneApi, 'lib', 'db.js')).href);

  const started = Date.now();
  const adapter = dbLib.pgliteAdapter(new PGlite());

  // Development is offline by default: no key is read, no request is made, the UI draws its
  // designed poster placeholder and a film page shows no synopsis. TINY_VIEWERS_DEV_POSTERS=1 opts
  // in to the real TMDB lookup, which fills poster_url and overview together from one request per
  // film. The key is passed straight through and never logged. The `overview` column itself always
  // exists here: the loader applies scene-api/schema.sql before it writes a row.
  const tmdbApiKey =
    process.env.TINY_VIEWERS_DEV_POSTERS === '1' ? (process.env.TMDB_API_KEY ?? null) : null;
  await load.loadAll(adapter, { tmdbApiKey });

  const { rows } = await adapter.query(
    'select (select count(*)::int from films) as films, (select count(*)::int from scenes) as scenes',
  );
  console.log(
    `[db] in-memory database ready in ${Date.now() - started}ms: ${rows[0].films} films, ${rows[0].scenes} scenes`,
  );
  return adapter;
}
