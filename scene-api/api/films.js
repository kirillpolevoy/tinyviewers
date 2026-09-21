import { handler } from '../lib/http.js';
import { getDb } from '../lib/db.js';
import { films } from '../lib/endpoints.js';

export default handler(async (req) => films(await getDb(), req.query ?? {}));
