import { handler, first } from '../../../lib/http.js';
import { getDb } from '../../../lib/db.js';
import { recording } from '../../../lib/endpoints.js';
import { maybeSweepBlobs } from '../../../lib/jobs.js';

// `compact`: a whole recording is 1-2 MB and nobody reads it by eye. Indentation would add a third
// of a megabyte to every replay for no one's benefit, against a 4.5 MB platform response limit.
export default handler(async (req) => {
  const { slug, ...query } = req.query ?? {};
  const db = await getDb();
  await maybeSweepBlobs(db);
  return recording(db, first(slug), query);
}, { compact: true });
