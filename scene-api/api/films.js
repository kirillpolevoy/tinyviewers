import { handler } from '../lib/http.js';
import { getDb } from '../lib/db.js';
import { films } from '../lib/endpoints.js';
import { maybeSweepBlobs } from '../lib/jobs.js';

// The parent-facing routes carry the blob sweep too; see maybeSweepBlobs. It is throttled to once
// per instance per ten minutes, and it is one DELETE against an indexed timestamp — awaited rather
// than fired off, because a serverless function can be frozen the moment its response is flushed
// and an unawaited sweep would be exactly the sweep that never happens.
export default handler(async (req) => {
  const db = await getDb();
  await maybeSweepBlobs(db);
  return films(db, req.query ?? {});
});
