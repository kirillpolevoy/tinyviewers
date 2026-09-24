import { notFound, redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { DemoRun } from '@/components/DemoRun';
import { JobUnreachable } from '@/components/JobUnreachable';
import { readJob, readRecording } from '@/lib/job-lookup';
import { WATCH } from '@/lib/copy';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Live run — Tiny Viewers',
  description: WATCH.intro,
};

type Props = { params: Promise<{ id: string }> };

/**
 * One live public run. A reload halfway through still shows the replay, because by then the job says
 * its recording is ready and the server fetches it once.
 */
export default async function WatchRunPage({ params }: Props) {
  const { id } = await params;
  const lookup = await readJob(id);
  if (lookup.kind === 'missing') notFound();
  if (lookup.kind === 'unreachable') {
    return <JobUnreachable retryHref={`/watch/run/${id}`} back={{ href: '/watch', label: WATCH.backToRuns }} />;
  }
  const { job } = lookup;
  // An add run or a finish is progress, not a screening run; it has its own page.
  if (job.kind !== 'demo') redirect(`/library?job=${id}`);
  const recording = job.recording_ready ? await readRecording(id) : null;
  return <DemoRun initialJob={job} initialRecording={recording} />;
}
