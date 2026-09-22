import { noStoreHandler, first } from '../../../lib/http.js';
import { getDb } from '../../../lib/db.js';
import { jobStatus } from '../../../lib/add.js';

// Public, and no-store: this answer is different every second while a run is going.
export default noStoreHandler(
  async (req) => jobStatus(await getDb(), first(req.query?.id)),
  { methods: ['GET', 'HEAD'] },
);
