#!/usr/bin/env node
// Local development with zero external services.
//
//   npm run dev            # in-memory database + next dev
//   PORT=4000 npm run dev
//
// The database is @electric-sql/pglite — real Postgres 16 compiled to WebAssembly — filled by the
// scene-api loader from the files in experiments/trigger-scan. It lives inside the Next server
// process (see lib/db.ts), so this script's job is to check that everything it needs is present,
// build the database once to prove it and report the counts, then hand over to `next dev` with
// TINY_VIEWERS_DB=pglite set.
//
// Nothing here reads an .env file, contacts Neon, or looks up a poster. To preview real posters
// locally instead of the placeholder:
//
//   TINY_VIEWERS_DEV_POSTERS=1 TMDB_API_KEY=... npm run dev

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(here, '..');
const sceneApi = path.resolve(webRoot, '..', 'scene-api');

function fail(message) {
  console.error(`\n${message}\n`);
  process.exit(1);
}

for (const needed of [
  path.join(sceneApi, 'load.js'),
  path.join(sceneApi, 'lib', 'db.js'),
  path.join(sceneApi, 'schema.sql'),
  path.resolve(webRoot, '..', 'experiments', 'trigger-scan', 'films.json'),
]) {
  if (!fs.existsSync(needed)) fail(`Cannot start: ${needed} is missing.`);
}

const [{ PGlite }, dbLib, loader] = await Promise.all([
  import('@electric-sql/pglite'),
  import(pathToFileURL(path.join(sceneApi, 'lib', 'db.js')).href),
  import(pathToFileURL(path.join(sceneApi, 'load.js')).href),
]);

process.stdout.write('building the in-memory database from experiments/trigger-scan … ');
const started = Date.now();
const db = dbLib.pgliteAdapter(new PGlite());
// tmdbApiKey: null — no key is read and no request is made in development; the UI draws its
// designed poster placeholder.
await loader.loadAll(db, { tmdbApiKey: null });
const { rows } = await db.query(
  `select (select count(*)::int from films) as films,
          (select count(*)::int from scenes) as scenes,
          (select count(*)::int from vocabulary where short_label is not null) as tags`,
);
console.log(
  `${Date.now() - started}ms: ${rows[0].films} films, ${rows[0].scenes} scenes, ${rows[0].tags} plain-word tags`,
);
await db.end();

const port = process.env.PORT ?? '3000';
console.log(`starting next dev on http://localhost:${port}\n`);

const child = spawn('npx', ['next', 'dev', '--port', String(port)], {
  cwd: webRoot,
  stdio: 'inherit',
  env: { ...process.env, TINY_VIEWERS_DB: 'pglite' },
});

const stop = (signal) => () => child.kill(signal);
process.on('SIGINT', stop('SIGINT'));
process.on('SIGTERM', stop('SIGTERM'));
child.on('exit', (code) => process.exit(code ?? 0));
