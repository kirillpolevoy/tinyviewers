// The scene-api brings its own database up to date: on the first database use of an instance it applies
// the Jev-first schema section (lib/schema-jevfirst.js: additive, idempotent) unless schema_marks already
// records this version. So a deploy needs no manual migration.
//
//   * once per instance: the promise is memoised; a failure is logged and retried after RETRY_MS, and never
//     stops the read endpoints (the base tables are untouched by this file);
//   * one instance at a time: the DDL runs in a transaction under a transaction-scoped advisory lock, and
//     re-checks the mark after taking it, so two cold starts never race on CREATE TABLE;
//   * cheap when there is nothing to do: one SELECT of schema_marks.
import { JEVFIRST_SCHEMA_SQL, JEVFIRST_SCHEMA_VERSION } from './schema-jevfirst.js';

export const SCHEMA_LOCK = 7210044;
export const RETRY_MS = 60_000;

// Never lets a missing table raise: inside a transaction an error would abort it.
async function marked(db) {
  const { rows: t } = await db.query("select to_regclass('public.schema_marks') is not null as present");
  if (!t[0]?.present) return false;
  const { rows } = await db.query('select 1 from schema_marks where id = $1', [JEVFIRST_SCHEMA_VERSION]);
  return rows.length > 0;
}

/** Apply the Jev-first section if this database has not had this version. Returns 'present' | 'applied'. */
export async function ensureSchema(db) {
  if (await marked(db).catch(() => false)) return 'present';
  return db.withTransaction(async (tx) => {
    await tx.query('select pg_advisory_xact_lock($1)', [SCHEMA_LOCK]);
    if (await marked(tx)) return 'present';
    await tx.exec(JEVFIRST_SCHEMA_SQL);
    await tx.query('insert into schema_marks (id) values ($1) on conflict (id) do nothing', [JEVFIRST_SCHEMA_VERSION]);
    return 'applied';
  });
}

const state = new WeakMap(); // db -> { promise, failedAt }

/** ensureSchema once per instance (per db object). Never throws. */
export function ensureSchemaOnce(db, { log = console } = {}) {
  const s = state.get(db);
  if (s?.promise) return s.promise;
  if (s?.failedAt && Date.now() - s.failedAt < RETRY_MS) return Promise.resolve('skipped');
  const promise = ensureSchema(db).catch((err) => {
    log.error?.(`[schema] could not apply the Jev-first schema (${err?.code ?? err?.name ?? 'error'}); will retry`);
    state.set(db, { promise: null, failedAt: Date.now() });
    return 'failed';
  });
  state.set(db, { promise, failedAt: null });
  return promise;
}
