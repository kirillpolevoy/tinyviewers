// Reading one job for a server render, for /library?job=.
//
// `forwardToSceneApi` rather than fetching this app's own /api/add/jobs route: the handler is a
// thin forwarder, and a server component calling its own HTTP endpoint would be a round trip
// through the network stack to run the same function.

import { forwardToSceneApi } from './scene-api';
import { isJobId, type Job } from './job';

/**
 * What the scene API had to say about this id: the job, "no such job", or "could not ask".
 *
 * The third is not the second. A 404 is news about the job; a 502 or a 504 is news about us, and
 * only one of the two is worth a reload — a reload during an outage must not tell the reader their
 * run never existed.
 */
export type JobLookup = { kind: 'job'; job: Job } | { kind: 'missing' } | { kind: 'unreachable' };

export async function readJob(id: string): Promise<JobLookup> {
  if (!isJobId(id)) return { kind: 'missing' };
  try {
    const response = await forwardToSceneApi(`/api/add/jobs/${id}`);
    if (response.ok) return { kind: 'job', job: (await response.json()) as Job };
    // The forwarder's own refusals are 502 `unreachable` and 504 `timed_out`; 404 is the API
    // itself saying there is no such job. Anything else came out of a service that is not well.
    return response.status === 404 ? { kind: 'missing' } : { kind: 'unreachable' };
  } catch {
    return { kind: 'unreachable' };
  }
}
