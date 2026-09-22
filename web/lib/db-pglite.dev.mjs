// The in-memory development database. Local only, and never part of a production build.
//
// This file is plain JavaScript, loaded by lib/db.ts through an absolute path built at runtime, so
// no bundler ever follows it. That is the point: PGlite's WebAssembly Postgres and the scene-api
// loader (which lives outside this app) must not be traced into the server bundle for a code path
// that only runs on a developer's machine.
//
// It builds the whole scene database in memory from the files in experiments/trigger-scan, so
// `npm run dev` needs no Postgres, no Neon and no network.

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * The recorded Jev runs, for /watch.
 *
 * This is a stopgap and is written to disappear quietly. The scene-api loader owns the `recordings`
 * table in Neon and is learning to fill it here too; until it does, the "Watch it work" pages would
 * have nothing to play locally. So: if the table is already there with rows in it, this does
 * nothing at all — the loader won. Otherwise it creates the table to the same shape and reads the
 * files the loader will read.
 *
 * `<slug>.excerpts.json` is git-ignored, so a checkout may well have the recording and not the
 * lines. That is the normal case, not an error: the payload is built without excerpts.
 */
async function loadRecordings(db, triggerScan) {
  await db.query(`
    create table if not exists recordings (
      film_id     text primary key references films (id) on delete cascade,
      recording   jsonb not null,
      excerpts    jsonb,
      recorded_at timestamptz,
      created_at  timestamptz not null default now()
    )`);

  const { rows: existing } = await db.query('select count(*)::int as n from recordings');
  if (existing[0].n > 0) return existing[0].n;

  const dir = path.join(triggerScan, 'recordings');
  if (!fs.existsSync(dir)) return 0;

  const { rows: films } = await db.query('select id from films order by id');
  let loaded = 0;
  for (const { id } of films) {
    const recordingPath = path.join(dir, `${id}.jev.json`);
    if (!fs.existsSync(recordingPath)) continue;
    const excerptsPath = path.join(dir, `${id}.excerpts.json`);
    const excerpts = fs.existsSync(excerptsPath) ? fs.readFileSync(excerptsPath, 'utf8') : null;
    const recording = fs.readFileSync(recordingPath, 'utf8');
    await db.query(
      `insert into recordings (film_id, recording, excerpts, recorded_at)
            values ($1, $2::jsonb, $3::jsonb, $4)
       on conflict (film_id) do nothing`,
      [id, recording, excerpts, JSON.parse(recording).meta?.started_at ?? null],
    );
    loaded += 1;
  }
  return loaded;
}

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
  const recordings = await loadRecordings(
    adapter,
    path.resolve(process.cwd(), '..', 'experiments', 'trigger-scan'),
  );

  const { rows } = await adapter.query(
    'select (select count(*)::int from films) as films, (select count(*)::int from scenes) as scenes',
  );
  console.log(
    `[db] in-memory database ready in ${Date.now() - started}ms: ${rows[0].films} films, ${rows[0].scenes} scenes, ${recordings} recordings`,
  );
  return adapter;
}
