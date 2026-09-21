#!/usr/bin/env node
// Local runner. It does the two things Vercel does for us in production — match the request path
// to a file under api/ and put the path and query parameters on req.query — and then calls the
// exact same handler module. Nothing in api/ or lib/ knows this file exists.
//
//   DATABASE_URL=postgres://... node server.js            # port 8787
//   PORT=3000 DATABASE_URL=... node server.js
//   node server.js --pglite                               # no Postgres needed: builds the whole
//                                                         # database in memory from
//                                                         # experiments/trigger-scan and serves it
import http from 'node:http';
import { pathToFileURL } from 'node:url';

const ROUTES = [
  { method: 'GET', pattern: /^\/api\/films\/([^/]+)\/scenes\/?$/, module: './api/films/[slug]/scenes.js', params: ['slug'] },
  { method: 'GET', pattern: /^\/api\/films\/([^/]+)\/?$/, module: './api/films/[slug].js', params: ['slug'] },
  { method: 'GET', pattern: /^\/api\/films\/?$/, module: './api/films.js', params: [] },
  { method: 'GET', pattern: /^\/api\/vocabulary\/?$/, module: './api/vocabulary.js', params: [] },
  { method: 'GET', pattern: /^\/api\/openapi(?:\.json)?\/?$/, module: './api/openapi.js', params: [] },
  { method: 'GET', pattern: /^\/$/, module: './api/openapi.js', params: [] },
];

const cache = new Map();
async function load(spec) {
  if (!cache.has(spec)) cache.set(spec, (await import(spec)).default);
  return cache.get(spec);
}

export async function route(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const hit = ROUTES.find((r) => r.pattern.test(url.pathname));
  if (!hit) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Content-Type', 'application/json');
    res.statusCode = 404;
    res.end(`${JSON.stringify({ error: 'not_found', message: `No route for ${url.pathname}.`, routes: ['/api/films', '/api/films/{slug}', '/api/films/{slug}/scenes', '/api/vocabulary', '/api/openapi.json'] }, null, 2)}\n`);
    return;
  }
  const match = url.pathname.match(hit.pattern);
  // Repeated parameters must survive as an array, the way Vercel hands them over: the handlers
  // decide whether repetition is allowed. Object.fromEntries(searchParams) silently kept one.
  const query = {};
  for (const key of new Set(url.searchParams.keys())) {
    const values = url.searchParams.getAll(key);
    query[key] = values.length > 1 ? values : values[0];
  }
  hit.params.forEach((name, i) => { query[name] = decodeURIComponent(match[i + 1]); });
  req.query = query;
  const fn = await load(hit.module);
  await fn(req, res);
}

export function createServer() {
  return http.createServer((req, res) => {
    route(req, res).catch((err) => {
      console.error(err);
      res.statusCode = 500;
      res.end(JSON.stringify({ error: 'internal_error' }));
    });
  });
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const port = Number(process.env.PORT ?? 8787);
  if (process.argv.includes('--pglite')) {
    // Development convenience: the same schema and the same SQL, against Postgres 16 compiled to
    // WebAssembly, held in memory. Nothing is installed and nothing is written to disk.
    const [{ PGlite }, { pgliteAdapter, setDb }, { loadAll }] = await Promise.all([
      import('@electric-sql/pglite'), import('./lib/db.js'), import('./load.js'),
    ]);
    const db = pgliteAdapter(new PGlite());
    const started = Date.now();
    const { reports } = await loadAll(db, {});
    setDb(db);
    console.log(`in-memory database built in ${Date.now() - started}ms: ${reports.length} films, ${reports.reduce((n, r) => n + r.counts.scenes, 0)} scenes`);
  }
  createServer().listen(port, () => {
    console.log(`scene-api on http://localhost:${port}`);
    console.log('  /api/films?q=nemo');
    console.log('  /api/films/nemo');
    console.log('  /api/films/nemo/scenes?presence=shark&age=6');
    console.log('  /api/vocabulary');
    console.log('  /api/openapi.json');
    if (!process.env.DATABASE_URL && !process.argv.includes('--pglite')) {
      console.log('\nDATABASE_URL is not set — every data route will return 500. Add --pglite to serve an in-memory copy instead.');
    }
  });
}
