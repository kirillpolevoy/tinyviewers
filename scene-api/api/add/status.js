import { noStoreHandler } from '../../lib/http.js';
import { getDb } from '../../lib/db.js';
import { addStatus } from '../../lib/add.js';

// Public and passcode-free on purpose: the web has to know whether to draw the form, whether
// another run is already going, and what is left of today's budget, before anyone types anything.
// Nothing here is a secret — `passcode_configured` says whether one is set, never what it is.
export default noStoreHandler(
  async () => addStatus(await getDb()),
  { methods: ['GET', 'HEAD'] },
);
