// The one place this app talks to a database. Server only.
//
// Two paths, the same SQL:
//   * DATABASE_URL — the Neon Postgres the scene API uses, through `pg`. The pool is created
//     lazily, once per server process, and always with an 'error' listener: Neon closes idle
//     connections, and an unhandled 'error' on a pg Pool is a fatal exception that would take every
//     in-flight request down with it.
//   * TINY_VIEWERS_DB=pglite — Postgres 16 compiled to WebAssembly, held in memory and filled from
//     experiments/trigger-scan by the scene-api loader. Local development only: see wantsPglite.
//
// Every query in lib/queries.ts is parameterised; nothing is interpolated into SQL.

import 'server-only';
import { POOL_TIMEOUTS, poolSsl, shouldWarnAboutPooling, wantsPglite } from './db-config';

export { POOL_TIMEOUTS, poolSsl, shouldWarnAboutPooling, wantsPglite };

export type Row = Record<string, unknown>;

export type Db = {
  query: <T = Row>(sql: string, params?: unknown[]) => Promise<{ rows: T[] }>;
};

// Next's dev server re-evaluates modules on edit. Without a global the pool (or the whole in-memory
// database) would be rebuilt on every hot reload.
const globalForDb = globalThis as typeof globalThis & {
  __tinyViewersDb?: Promise<Db>;
  __tinyViewersPoolWarned?: boolean;
};

async function createPgDb(): Promise<Db> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      'No database configured: set DATABASE_URL, or TINY_VIEWERS_DB=pglite for the in-memory copy (npm run dev).',
    );
  }
  if (!globalForDb.__tinyViewersPoolWarned) {
    globalForDb.__tinyViewersPoolWarned = true;
    if (shouldWarnAboutPooling(url, process.env.NODE_ENV === 'production')) {
      // The host is named, never the credentials.
      console.warn(
        '[db] DATABASE_URL points at a direct Neon endpoint. In production use the pooled one (the host with "-pooler"), or connections will run out under load. See web/README.md.',
      );
    }
  }

  const { default: pg } = await import('pg');
  const pool = new pg.Pool({
    connectionString: url,
    max: 3,
    // Verified TLS, or none at all for a plain local server. See poolSsl.
    ssl: poolSsl(url),
    ...POOL_TIMEOUTS,
  });
  // The pool replaces a broken client by itself. All we have to do is be listening. The message
  // never includes the connection string.
  pool.on('error', (err: Error) => {
    console.error(`[db] idle client error (the pool will replace it): ${err.message}`);
  });
  return { query: (sql, params) => pool.query(sql, params) as never };
}

/**
 * The development database, loaded from a plain .mjs module by absolute path at runtime.
 *
 * It is imported this way on purpose. A static specifier — even inside an `if` — is followed by the
 * bundler, which would pull PGlite's WebAssembly and the scene-api loader into the production
 * server bundle for code that can never run there. A path built at runtime cannot be traced, so the
 * production build contains no reference to any of it.
 */
async function createPgliteDb(): Promise<Db> {
  const path = await import('node:path');
  const { pathToFileURL } = await import('node:url');
  const devModule = path.join(process.cwd(), 'lib', 'db-pglite.dev.mjs');
  const mod = (await import(
    /* webpackIgnore: true */ /* turbopackIgnore: true */ pathToFileURL(devModule).href
  )) as { createDevDb: () => Promise<Db> };
  return mod.createDevDb();
}

/**
 * TINY_VIEWERS_QUERY_LOG=1 prints one line per statement. It exists to keep the page-level query
 * budget honest (Home ≤ 4, a film page ≤ 3); it is never on in production.
 */
function withQueryLog(db: Db): Db {
  if (process.env.TINY_VIEWERS_QUERY_LOG !== '1') return db;
  let n = 0;
  return {
    query: (sql, params) => {
      n += 1;
      console.log(`[q${n}] ${sql.replace(/\s+/g, ' ').trim().slice(0, 64)}`);
      return db.query(sql, params);
    },
  };
}

export function getDb(): Promise<Db> {
  if (!globalForDb.__tinyViewersDb) {
    globalForDb.__tinyViewersDb = (wantsPglite() ? createPgliteDb() : createPgDb())
      .then(withQueryLog)
      .catch((err) => {
        // A failed connection must not be cached: the next request should try again.
        globalForDb.__tinyViewersDb = undefined;
        throw err;
      });
  }
  return globalForDb.__tinyViewersDb;
}
