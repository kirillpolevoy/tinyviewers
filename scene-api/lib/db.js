// A one-method database interface so the same query code runs against Neon (via `pg`) in
// production and against an in-process Postgres (@electric-sql/pglite) in the tests.
//
//   db.query(sql, params) -> { rows }
//   db.exec(sql)          -> runs a multi-statement script (schema.sql)
//   db.withTransaction(fn)-> fn receives a db bound to a single connection
//   db.end()

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

export const schemaSql = () => fs.readFileSync(path.join(root, 'schema.sql'), 'utf8');

export function pgAdapter(pool) {
  const wrap = (client) => ({
    query: (sql, params) => client.query(sql, params),
    exec: (sql) => client.query(sql),
  });
  return {
    kind: 'pg',
    ...wrap(pool),
    async withTransaction(fn) {
      const client = await pool.connect();
      try {
        await client.query('begin');
        const out = await fn(wrap(client));
        await client.query('commit');
        return out;
      } catch (err) {
        try { await client.query('rollback'); } catch { /* connection already gone */ }
        throw err;
      } finally {
        client.release();
      }
    },
    end: () => pool.end(),
  };
}

export function pgliteAdapter(pglite) {
  const self = {
    kind: 'pglite',
    query: (sql, params) => pglite.query(sql, params),
    exec: (sql) => pglite.exec(sql),
    // PGlite is a single connection, so begin/commit on it is already transactional.
    async withTransaction(fn) {
      await pglite.exec('begin');
      try {
        const out = await fn({ query: self.query, exec: self.exec });
        await pglite.exec('commit');
        return out;
      } catch (err) {
        try { await pglite.exec('rollback'); } catch { /* ignore */ }
        throw err;
      }
    },
    end: () => pglite.close(),
  };
  return self;
}

// Nothing about a serverless request should wait forever. A cold or unreachable Neon has to fail in
// seconds and return an error the caller can read, rather than hang until the platform kills the
// function. Every value sits below a typical 10 s function limit.
export const POOL_TIMEOUTS = {
  connectionTimeoutMillis: 5000,  // waiting for a socket to a database that may be asleep
  idleTimeoutMillis: 10_000,      // Neon hangs up on idle connections anyway; let go first
  statement_timeout: 8000,        // server side: Postgres cancels the statement
  query_timeout: 8000,            // client side: `pg` gives up even if the server never answers
};

// Lazily built from DATABASE_URL, and replaceable so tests can inject PGlite.
let injected = null;
let lazyPool = null;

export function setDb(db) { injected = db; }

// Neon closes idle connections, and a `pg` Pool emits that as an 'error' event on the pool. With
// no listener, Node treats an unhandled 'error' as a fatal exception and the whole instance dies,
// taking every in-flight request with it. The pool discards the bad client by itself; we only
// have to be listening.
export function guardPool(pool, label = 'pg') {
  pool.on('error', (err) => {
    console.error(`[${label}] idle client error (the pool will replace it): ${err.message}`);
  });
  return pool;
}

export async function getDb() {
  if (injected) return injected;
  if (!lazyPool) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error('DATABASE_URL is not set');
    const { default: pg } = await import('pg');
    lazyPool = pgAdapter(guardPool(new pg.Pool({
      connectionString: url,
      max: 3,
      // Neon's pooled endpoint terminates plain connections; ssl is required there and harmless
      // against a local server that accepts it.
      ssl: /neon\.tech|sslmode=require/.test(url) ? { rejectUnauthorized: false } : undefined,
      ...POOL_TIMEOUTS,
    }), 'api'));
  }
  return lazyPool;
}

export async function applySchema(db) {
  await db.exec(schemaSql());
}
