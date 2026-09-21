import { handler, first } from '../../../lib/http.js';
import { getDb } from '../../../lib/db.js';
import { scenes } from '../../../lib/endpoints.js';

export default handler(async (req) => {
  const { slug, ...query } = req.query ?? {};
  return scenes(await getDb(), first(slug), query);
});
