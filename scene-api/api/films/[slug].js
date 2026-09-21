import { handler, first } from '../../lib/http.js';
import { getDb } from '../../lib/db.js';
import { film } from '../../lib/endpoints.js';

export default handler(async (req) => {
  const { slug, ...query } = req.query ?? {};
  return film(await getDb(), first(slug), query);
});
