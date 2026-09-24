'use client';

import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { WatchShell } from './WatchShell';
import { JobSteps } from './JobSteps';
import { RunReplay } from './RunReplay';
import { ArrowRight } from './Art';
import { usePolledJob, useJobReplay } from './useJob';
import { useStartDemo } from './useStartDemo';
import { finishRefusal, type Job, type JobRecording, type Refusal } from '@/lib/job';
import { ADD, DEMO } from '@/lib/copy';
import styles from './Job.module.css';
import addStyles from './AddFilm.module.css';

type Props = {
  initialJob: Job;
  /** The recording, when the server found one — a reload lands straight on the replay. */
  initialRecording: JobRecording | null;
};

/**
 * One live run of the public part of the analysis: its steps while they happen, and — when one of
 * them produced a recording — that run played back at the speed it ran, the moment it lands. Which
 * steps those are is the API's decision; this page renders whatever the job reports.
 *
 * A run of a film on the shelf ends on that film's scene list, which it did not touch. A run of any
 * other film ends on an offer: finish the analysis and put it on the shelf. That carries this very
 * run on, through the steps the job says are still to go, rather than starting another.
 */
export function DemoRun({ initialJob, initialRecording }: Props) {
  const { job, health, retry } = usePolledJob(initialJob);
  const inLibrary = job.film.in_library === true;
  const payload = useJobReplay(job, initialRecording, inLibrary ? job.film.slug : null);
  const again = useStartDemo();

  const headline =
    job.status === 'queued'
      ? DEMO.runQueued
      : job.status === 'running'
        ? DEMO.runRunning
        : job.status === 'done'
          ? DEMO.runDone
          : DEMO.runFailed;

  const running = job.steps.find((s) => s.status === 'running');
  const state =
    job.status === 'queued'
      ? DEMO.stateQueued
      : job.status === 'running'
        ? running
          ? DEMO.stateRunning(running.label)
          : DEMO.stateStarting
        : job.status === 'done'
          ? DEMO.stateDone
          : ADD.failedHeadline;

  const target = inLibrary && job.film.slug
    ? { slug: job.film.slug }
    : job.film.imdb_id
      ? { imdb_id: job.film.imdb_id }
      : null;

  return (
    <WatchShell
      headline={headline}
      lead={job.status === 'done' ? (inLibrary ? DEMO.unchanged : DEMO.notSaved) : undefined}
    >
      <div className={styles.job}>
        <JobSteps job={job} state={state} />

        {/* Polls stopped answering, or the run is gone: what is above is the last answer, not now. */}
        {(health.state === 'interrupted' || health.state === 'missing') && (
          <div className={styles.failure} role="alert">
            {health.state === 'missing' ? (
              <p>{ADD.jobMissing}</p>
            ) : (
              <p>
                <b>{ADD.interruptedHeadline}</b> {ADD.interruptedBody}
              </p>
            )}
            {health.state === 'interrupted' && (
              <button type="button" className={`button buttonQuiet ${styles.button}`} onClick={retry}>
                {ADD.retryNow}
              </button>
            )}
          </div>
        )}

        {payload && <RunReplay payload={payload} />}

        {job.status === 'done' && !inLibrary && <FinishOffer jobId={job.id} stillToGo={job.finish_steps ?? []} />}

        {again.refusal && (
          <p className={addStyles.refusal} role="alert">
            {again.refusal.text}{' '}
            {again.refusal.link && (
              <Link href={again.refusal.link.href} className={addStyles.refusalLink}>
                {again.refusal.link.label}
              </Link>
            )}
          </p>
        )}

        {(job.status === 'done' || job.status === 'failed') && (
          <div className={styles.actions}>
            {job.status === 'done' && inLibrary && job.film.slug && (
              <Link href={`/film/${job.film.slug}`} className={`button ${styles.button}`}>
                {DEMO.toFilm}
                <ArrowRight />
              </Link>
            )}
            {target && (
              <button
                type="button"
                className={`button buttonQuiet ${styles.button}`}
                onClick={() => again.start(target, 'again')}
                disabled={again.starting !== null}
              >
                {again.starting ? DEMO.starting : DEMO.runAgain}
              </button>
            )}
            <Link href="/watch" className={styles.quietLink}>
              {DEMO.another}
            </Link>
          </div>
        )}
      </div>
    </WatchShell>
  );
}

/**
 * "Finish the analysis and add it to the library" — the passcoded half, offered only under a
 * finished run of a film that is not on the shelf. The passcode lives in this component's state
 * and nowhere else, exactly as on /add.
 */
function FinishOffer({ jobId, stillToGo }: { jobId: string; stillToGo: { id: string; label: string }[] }) {
  const router = useRouter();
  const [passcode, setPasscode] = useState('');
  const [sending, setSending] = useState(false);
  const [refusal, setRefusal] = useState<Refusal | null>(null);

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (sending) return;
    setRefusal(null);
    setSending(true);
    try {
      const response = await fetch('/api/add/finish', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ job_id: jobId, passcode }),
      });
      const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
      if (response.status === 202 && typeof body.id === 'string') {
        router.push(`/library?job=${body.id}`);
        return;
      }
      setRefusal(finishRefusal(response.status, body));
    } catch {
      setRefusal({ text: ADD.unreachable });
    }
    setSending(false);
  };

  return (
    <section className={styles.panel} aria-labelledby="finish-heading">
      <h2 id="finish-heading" className={styles.panelHeading}>
        {DEMO.finishHeading}
      </h2>
      <p className={styles.panelBody}>{DEMO.finishBody}</p>
      {stillToGo.length > 0 && (
        <p className={styles.panelBody}>
          {DEMO.finishStillToGo} {stillToGo.map((s) => s.label.toLowerCase()).join(', ')}.
        </p>
      )}
      {/* POST, and the passcode input has no `name`: submitted before hydration (or with scripts
          off) the browser's own submit then carries nothing — never the passcode in a URL, the
          history or a server log. With JavaScript the handler above sends it in a JSON body. */}
      <form className={addStyles.form} onSubmit={onSubmit} method="post">
        <div className={addStyles.field}>
          <label className={`eyebrow ${addStyles.label}`} htmlFor="finish-passcode">
            {ADD.passcodeLabel}
          </label>
          <input
            id="finish-passcode"
            className={`${addStyles.input} ${addStyles.passcode}`}
            type="password"
            value={passcode}
            onChange={(event) => setPasscode(event.target.value)}
            autoComplete="off"
            required
          />
        </div>
        <button type="submit" className={`button ${addStyles.submit}`} disabled={sending}>
          {sending ? DEMO.finishing : DEMO.finishButton}
        </button>
      </form>
      {refusal && (
        <p className={addStyles.refusal} role="alert">
          {refusal.text}{' '}
          {refusal.link && (
            <Link href={refusal.link.href} className={addStyles.refusalLink}>
              {refusal.link.label}
            </Link>
          )}
        </p>
      )}
    </section>
  );
}
