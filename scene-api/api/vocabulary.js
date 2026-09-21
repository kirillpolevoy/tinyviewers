import { handler } from '../lib/http.js';
import { getDb } from '../lib/db.js';
import { vocabulary } from '../lib/endpoints.js';

export default handler(async (req) => vocabulary(await getDb(), req.query ?? {}));
