import { noStoreHandler, clientIp } from '../../lib/http.js';
import { getDb } from '../../lib/db.js';
import { resolve } from '../../lib/add.js';

export default noStoreHandler(
  async (req) => resolve(await getDb(), req.jsonBody, { ip: clientIp(req) }),
  { methods: ['POST'], parseBody: true },
);
