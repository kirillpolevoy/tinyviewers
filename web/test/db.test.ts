import test from 'node:test';
import assert from 'node:assert/strict';

// These rules live in lib/db-config.ts precisely so they can be tested without a driver, a
// connection or the 'server-only' guard that lib/db.ts carries.
import {
  POOL_TIMEOUTS,
  WORST_CASE_WAIT_MS,
  poolSsl,
  shouldWarnAboutPooling,
  wantsPglite,
} from '../lib/db-config';

test('the in-memory database can never be selected in production', () => {
  // Development: the opt-in does what it says.
  assert.equal(wantsPglite({ NODE_ENV: 'development', TINY_VIEWERS_DB: 'pglite' } as never), true);
  assert.equal(wantsPglite({ NODE_ENV: 'test', TINY_VIEWERS_DB: 'PGlite' } as never), true);
  assert.equal(wantsPglite({ NODE_ENV: 'development' } as never), false);

  // Production: a stray variable must not be able to swap the real database for an empty one.
  // Serving a silently empty site is worse than serving an error.
  assert.equal(wantsPglite({ NODE_ENV: 'production', TINY_VIEWERS_DB: 'pglite' } as never), false);
  assert.equal(wantsPglite({ NODE_ENV: 'production', TINY_VIEWERS_DB: 'PGLITE' } as never), false);
});

test('a direct Neon endpoint is warned about in production only', () => {
  const direct = 'postgres://user:pw@ep-cool-name-123456.us-east-1.aws.neon.tech/db?sslmode=require';
  const pooled = 'postgres://user:pw@ep-cool-name-123456-pooler.us-east-1.aws.neon.tech/db?sslmode=require';

  assert.equal(shouldWarnAboutPooling(direct, true), true);
  assert.equal(shouldWarnAboutPooling(pooled, true), false);

  // Locally, either endpoint is fine and the warning would just be noise.
  assert.equal(shouldWarnAboutPooling(direct, false), false);

  // Not Neon, or not set at all: nothing to say.
  assert.equal(shouldWarnAboutPooling('postgres://localhost:5432/tiny', true), false);
  assert.equal(shouldWarnAboutPooling(undefined, true), false);
});

test('every pool timeout is set, and the worst case is the sum, not the largest', () => {
  // A request that hangs until the platform kills it shows the parent nothing at all; one that
  // fails inside the budget shows the error card.
  assert.equal(POOL_TIMEOUTS.connectionTimeoutMillis, 5000);
  assert.equal(POOL_TIMEOUTS.idleTimeoutMillis, 10_000);
  assert.equal(POOL_TIMEOUTS.statement_timeout, 8000);
  assert.equal(POOL_TIMEOUTS.query_timeout, 8000);

  // Connecting and querying happen one after the other, so they add up. Claiming "each is under
  // ten seconds, therefore a request is" would be false: a cold connection plus a slow query is
  // thirteen. The figure is exported so the deployment's function timeout can be set above it.
  assert.equal(
    WORST_CASE_WAIT_MS,
    POOL_TIMEOUTS.connectionTimeoutMillis + POOL_TIMEOUTS.query_timeout,
  );
  assert.equal(WORST_CASE_WAIT_MS, 13_000);

  for (const [name, ms] of Object.entries(POOL_TIMEOUTS)) {
    assert.ok(ms > 0, `${name} must be set`);
  }
});

test('certificates are always verified: no branch disables TLS checking', () => {
  const urls = [
    'postgres://u:p@ep-x-123456-pooler.us-east-1.aws.neon.tech/db?sslmode=require',
    'postgres://u:p@ep-x-123456.us-east-1.aws.neon.tech/db',
    'postgres://u:p@db.example.com/db?sslmode=require',
    'postgres://u:p@localhost:5432/tiny',
  ];
  for (const url of urls) {
    const ssl = poolSsl(url);
    // Either verified TLS, or no TLS config at all for a plain local server — never a pool that
    // accepts whatever certificate it is handed.
    assert.ok(ssl === undefined || ssl.rejectUnauthorized === true, url);
    assert.notEqual(JSON.stringify(ssl ?? {}), '{"rejectUnauthorized":false}');
  }
  assert.deepEqual(poolSsl(urls[0]), { rejectUnauthorized: true });
  assert.equal(poolSsl(urls[3]), undefined);
});
