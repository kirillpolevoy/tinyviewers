// Pure configuration for the database connection: no driver, no connection, no `server-only`,
// so the rules below can be tested directly rather than inferred from a running pool.

/**
 * Nothing about a serverless request should be allowed to wait forever. A cold or unreachable Neon
 * must fail in seconds and show the error card, not hang until the platform kills the function with
 * no page at all. Every number is below a typical 10 s function limit.
 */
export const POOL_TIMEOUTS = {
  /** Waiting for a socket to a database that may be asleep or gone. */
  connectionTimeoutMillis: 5000,
  /** Neon hangs up on idle connections anyway; let go first. */
  idleTimeoutMillis: 10_000,
  /** Server side: Postgres itself cancels the statement. */
  statement_timeout: 8000,
  /** Client side: `pg` gives up even if the server never answers. */
  query_timeout: 8000,
} as const;

/**
 * The worst case one request can spend waiting on the database: a cold connection that takes the
 * full connection timeout, followed by a query that takes the full query timeout. They compose,
 * they do not overlap, so this is 13 s — and the platform's function timeout must be longer than
 * this, or the function is killed before the app can show its error card. Stated as a number so
 * the test asserts the real figure rather than a comfortable-sounding one.
 */
export const WORST_CASE_WAIT_MS =
  POOL_TIMEOUTS.connectionTimeoutMillis + POOL_TIMEOUTS.query_timeout;

/**
 * Whether to use the in-memory development database.
 *
 * Two conditions, deliberately: the opt-in variable AND a non-production build. A stray
 * TINY_VIEWERS_DB in a deployment's environment must never be able to swap the real database for an
 * empty in-memory one — that would serve a silently empty site instead of an error.
 */
export function wantsPglite(env: NodeJS.ProcessEnv = process.env): boolean {
  return (
    env.NODE_ENV !== 'production' && (env.TINY_VIEWERS_DB ?? '').toLowerCase() === 'pglite'
  );
}

/**
 * Neon serves two endpoints: the direct one and the pooled one (`-pooler` in the host). A
 * serverless deployment opens a connection per instance and must use the pooled endpoint, or it
 * exhausts the direct endpoint's connection limit under load. Warn rather than refuse: a wrong
 * endpoint still works, it just falls over later, and refusing to boot would be worse.
 */
export function shouldWarnAboutPooling(url: string | undefined, isProduction: boolean): boolean {
  if (!url || !isProduction) return false;
  // The URL parser, rather than a hand-rolled regex: a password containing '@' or '/' is exactly
  // the case a regex gets wrong, and getting it wrong here means warning about the wrong host.
  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    return false;
  }
  return /(^|\.)neon\.tech$/i.test(host) && !/-pooler\./i.test(host);
}

/**
 * TLS for the connection.
 *
 * Certificates are always verified. Neon's certificates chain to a public root, so the system
 * trust store validates them with nothing extra configured; `sslmode=require` in the URL is fine
 * and does not change this. `rejectUnauthorized: false` would accept any certificate at all,
 * including one presented by whatever answered instead of Neon, which turns TLS into decoration —
 * so no branch here returns it, and a test holds that line.
 */
export function poolSsl(url: string): { rejectUnauthorized: true } | undefined {
  const needsTls = /neon\.tech|sslmode=require/.test(url);
  return needsTls ? { rejectUnauthorized: true } : undefined;
}
