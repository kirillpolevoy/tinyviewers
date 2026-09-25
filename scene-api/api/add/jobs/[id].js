import { waitUntil } from '@vercel/functions';
import { noStoreHandler, first } from '../../../lib/http.js';
import { getDb } from '../../../lib/db.js';
import { jobStatus } from '../../../lib/add.js';

// Public, and no-store: this answer is different every second while a run is going.
// A Jev-first job that has gone quiet (its continuation never landed, or its invocation died) is
// asked for again from here; the request for that continuation is kept alive with waitUntil.
const kick = (fire) => {
  const p = fire();
  try { waitUntil(p); } catch { p.catch(() => {}); }
};

export default noStoreHandler(
  async (req) => jobStatus(await getDb(), first(req.query?.id), { kick }),
  { methods: ['GET', 'HEAD'] },
);
