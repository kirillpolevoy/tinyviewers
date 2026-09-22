// POST /api/add/jobs — admit one run and then do it in the background of this same invocation.
//
// `waitUntil` is what makes that possible: the 202 goes out immediately with the job id, and the
// function stays alive for the pipeline promise instead of being frozen the moment the response is
// flushed. It needs `maxDuration: 300` on this function (see vercel.json), which Fluid compute
// allows on Hobby; the whole run is a few seconds of Jev and two or three minutes of Sonnet.
//
// Outside a Vercel request context — the local server, the tests — `waitUntil` has nothing to hold
// open and throws, so the run is simply started and left to finish on its own. Either way the job
// row is the only channel: the pipeline never talks back through this response.
import { waitUntil } from '@vercel/functions';
import { noStoreHandler, sendJson, clientIp, WRITE_METHODS } from '../../lib/http.js';
import { getDb } from '../../lib/db.js';
import { startJob } from '../../lib/add.js';

export const config = { maxDuration: 300 };

const launch = (start) => {
  const promise = start();
  try {
    waitUntil(promise);
  } catch {
    // Not running on Vercel. The promise is already in flight; `runPipeline` writes its own
    // failures to the job row, so there is nothing to handle here but the unhandled rejection.
    promise.catch(() => {});
  }
};

export default noStoreHandler(
  async (req, res) => {
    const { id } = await startJob(await getDb(), req.jsonBody, { launch, ip: clientIp(req) });
    sendJson(res, 202, { id }, { cacheControl: 'no-store', methods: `${WRITE_METHODS}` });
  },
  { methods: ['POST'], parseBody: true },
);
