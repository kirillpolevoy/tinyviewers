// GET /api/add/jobs/{id}/recording — the replay for one live (or finished) run.
//
// Split off GET /api/add/jobs/{id} because the two have opposite shapes. The job body is a few
// hundred bytes that change every second and the page polls it every 1.5 s; the recording is
// 0.7-1.3 MB that never changes once the jev stage has ended. Sending both together meant a
// megabyte a second down the wire for three minutes, of something the client already had. The job
// now carries `recording_ready`, and the page fetches this once when it flips.
import { cors, sendJson, first, HttpError, ALLOWED_METHODS } from '../../../../lib/http.js';
import { getDb } from '../../../../lib/db.js';
import { jobRecording } from '../../../../lib/add.js';

// `compact`: the same reasoning as api/films/[slug]/recording.js. Indentation adds a third of a
// megabyte to something no human reads, against a 4.5 MB platform response limit.
export default async function handler(req, res) {
  if (req.method === 'OPTIONS') { cors(res); res.statusCode = 204; res.end(); return; }
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    sendJson(res, 405, { error: 'method_not_allowed', message: `Use ${ALLOWED_METHODS} on this endpoint.` });
    return;
  }
  try {
    const { body, live } = await jobRecording(await getDb(), first(req.query?.id));
    // A running job's recording is still gaining excerpts, so it must not be cached. A finished
    // job's never changes again, so it is cached like every other GET in this API.
    sendJson(res, 200, body, { cacheControl: live ? 'no-store' : 'public, max-age=300', compact: true });
  } catch (err) {
    if (err instanceof HttpError) {
      sendJson(res, err.status, {
        error: err.status === 404 ? 'not_found' : 'bad_request',
        message: err.message,
        ...err.extra,
      }, { cacheControl: 'no-store' });
      return;
    }
    console.error(err);
    sendJson(res, 500, { error: 'internal_error', message: 'Something went wrong on our side.' }, { cacheControl: 'no-store' });
  }
}
