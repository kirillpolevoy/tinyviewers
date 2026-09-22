import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { JobRun } from '@/components/JobRun';
import { WatchShell } from '@/components/WatchShell';
import { ArrowRight } from '@/components/Art';
import { forwardToSceneApi } from '@/lib/scene-api';
import { ADD, WATCH } from '@/lib/copy';
import { isJobId, type Job, type JobRecording } from '@/lib/job';
import styles from './job.module.css';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Analysing — Tiny Viewers',
  description: WATCH.intro,
};

type Props = { params: Promise<{ id: string }> };

/**
 * What the scene API had to say about this id: the job, "no such job", or "could not ask".
 *
 * The third one used to be the second one. A `null` for both meant that a reload during an API
 * outage put the reader on "this page missed its cue" — a page whose whole message is that the
 * thing they are watching never existed, over a run that is very probably still going. A 404 is
 * news about the job; a 502 or a 504 is news about us, and only one of the two is worth a reload.
 */
type Lookup = { kind: 'job'; job: Job } | { kind: 'missing' } | { kind: 'unreachable' };

async function readJob(id: string): Promise<Lookup> {
  if (!isJobId(id)) return { kind: 'missing' };
  try {
    const response = await forwardToSceneApi(`/api/add/jobs/${id}`);
    if (response.ok) return { kind: 'job', job: (await response.json()) as Job };
    // The forwarder's own refusals are 502 `unreachable` and 504 `timed_out`; 404 is the API
    // itself saying there is no such job. Anything else came out of a service that is not well,
    // which is the same news as not reaching it.
    return response.status === 404 ? { kind: 'missing' } : { kind: 'unreachable' };
  } catch {
    return { kind: 'unreachable' };
  }
}

/**
 * The recording, and only once the job says there is one.
 *
 * Two requests rather than one, on purpose: this is the megabyte, and a page that asked for it on
 * every render would pay for it five times during a run that has not produced it yet. A reload
 * halfway through still shows the replay, because by then the flag is set.
 */
async function readRecording(id: string): Promise<JobRecording | null> {
  try {
    const response = await forwardToSceneApi(`/api/add/jobs/${id}/recording`);
    if (!response.ok) return null;
    return (await response.json()) as JobRecording;
  } catch {
    return null;
  }
}

export default async function JobPage({ params }: Props) {
  const { id } = await params;
  const lookup = await readJob(id);
  if (lookup.kind === 'missing') notFound();

  if (lookup.kind === 'unreachable') {
    return (
      <WatchShell headline={ADD.jobUnreachableHeadline} lead={ADD.jobUnreachableBody}>
        <div className={styles.actions}>
          {/* A bare anchor, not a Link: retrying has to be a fresh request to this same URL, and a
              client-side navigation to the route you are already on is the one thing the router is
              entitled to treat as a no-op. */}
          <a href={`/watch/job/${id}`} className={`button ${styles.button}`}>
            {ADD.jobUnreachableRetry}
            <ArrowRight />
          </a>
          <Link href="/watch" className={styles.quietLink}>
            {WATCH.backToRuns}
          </Link>
        </div>
      </WatchShell>
    );
  }

  const { job } = lookup;
  const recording = job.recording_ready ? await readRecording(id) : null;

  return <JobRun initialJob={job} initialRecording={recording} />;
}
