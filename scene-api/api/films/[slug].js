import { handler, first } from '../../lib/http.js';
import { getDb } from '../../lib/db.js';
import { film } from '../../lib/endpoints.js';
import { maybeSweepBlobs } from '../../lib/jobs.js';

export default handler(async (req) => {
  const { slug, ...query } = req.query ?? {};
  const db = await getDb();
  await maybeSweepBlobs(db);
  return film(db, first(slug), query);
});
