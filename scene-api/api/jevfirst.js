// ONE function for every Jev-first route, so the deployment stays within the Hobby plan's function count
// (main has 11; this makes 12). vercel.json rewrites each public path here with `route` (and `id`) in the
// query; server.js does the same locally. Every route keeps its own method, body and cache rules.
//
//   GET  /api/demo/films               -> route=demo-films
//   GET  /api/demo/status              -> route=demo-status
//   POST /api/demo/runs {slug}         -> route=demo-runs          202 { id }; the run continues in waitUntil
//   GET  /api/demo/runs/{id}           -> route=demo-run&id=      (a stalled run is resumed by this poll)
//   POST /api/demo/runs/{id}/continue  -> route=demo-continue&id= INTERNAL (x-continue-secret)
//   POST /api/add/jobs/{id}/continue   -> route=continue&id=       INTERNAL (x-continue-secret)
//   POST /api/admin/rebuild            -> route=admin-rebuild      passcode; 202 { id, slug }
//   POST /api/admin/backups            -> route=admin-backups      passcode
//   POST /api/admin/restore            -> route=admin-restore      passcode
//   POST /api/admin/reapply            -> route=admin-reapply      passcode
import { waitUntil } from '@vercel/functions';
import { noStoreHandler, sendJson, clientIp, first, WRITE_METHODS, notFound } from '../lib/http.js';
import { getDb } from '../lib/db.js';
import { demoFilms, demoStatus, startDemoRun, demoRun, continueDemoRun } from '../lib/demo.js';
import { continueJob } from '../lib/add.js';
import { startRebuild, backups, restore, reapply } from '../lib/admin.js';

export const config = { maxDuration: 300 };

/** Keep a background promise alive past the response on Vercel; elsewhere just let it run. */
const keepAlive = (promise) => {
  try { waitUntil(promise); } catch { promise.catch(() => {}); }
};
const launch = (start) => keepAlive(start());

const ROUTES = {
  'demo-films': noStoreHandler(async () => demoFilms(await getDb()), { methods: ['GET', 'HEAD'] }),
  'demo-status': noStoreHandler(async () => demoStatus(await getDb()), { methods: ['GET', 'HEAD'] }),
  'demo-run': noStoreHandler(async (req) => demoRun(await getDb(), first(req.query?.id), Date.now(), { keepAlive }), { methods: ['GET', 'HEAD'] }),
  'demo-continue': noStoreHandler(async (req, res) => {
    const secret = req.headers?.['x-continue-secret'];
    const { done } = await continueDemoRun(await getDb(), first(req.query?.id), Array.isArray(secret) ? secret[0] : secret);
    keepAlive(done);
    sendJson(res, 202, { accepted: true }, { cacheControl: 'no-store', methods: WRITE_METHODS });
  }, { methods: ['POST'] }),
  'demo-runs': noStoreHandler(async (req, res) => {
    const { id } = await startDemoRun(await getDb(), req.jsonBody, { ip: clientIp(req), launch });
    sendJson(res, 202, { id }, { cacheControl: 'no-store', methods: WRITE_METHODS });
  }, { methods: ['POST'], parseBody: true }),
  continue: noStoreHandler(async (req, res) => {
    const secret = req.headers?.['x-continue-secret'];
    const { done } = continueJob(await getDb(), first(req.query?.id), Array.isArray(secret) ? secret[0] : secret);
    keepAlive(done);
    sendJson(res, 202, { accepted: true }, { cacheControl: 'no-store', methods: WRITE_METHODS });
  }, { methods: ['POST'] }),
  'admin-rebuild': noStoreHandler(async (req, res) => {
    const { id, slug } = await startRebuild(await getDb(), req.jsonBody, { ip: clientIp(req), launch });
    sendJson(res, 202, { id, slug, poll: `/api/add/jobs/${id}` }, { cacheControl: 'no-store', methods: WRITE_METHODS });
  }, { methods: ['POST'], parseBody: true }),
  'admin-backups': noStoreHandler(async (req) => backups(await getDb(), req.jsonBody, { ip: clientIp(req) }), { methods: ['POST'], parseBody: true }),
  'admin-restore': noStoreHandler(async (req) => restore(await getDb(), req.jsonBody, { ip: clientIp(req) }), { methods: ['POST'], parseBody: true }),
  'admin-reapply': noStoreHandler(async (req) => reapply(await getDb(), req.jsonBody, { ip: clientIp(req) }), { methods: ['POST'], parseBody: true }),
};

const unknown = noStoreHandler(async () => { throw notFound('No such route.'); }, { methods: ['GET', 'HEAD', 'POST'] });

export default async function jevfirst(req, res) {
  const route = first(req.query?.route);
  return (ROUTES[route] ?? unknown)(req, res);
}
