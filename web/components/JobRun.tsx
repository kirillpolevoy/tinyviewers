'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Poster } from './Poster';
import { RunReplay } from './RunReplay';
import { WatchShell } from './WatchShell';
import { ArrowRight } from './Art';
import { buildReplayPayload, formatCents, formatSeconds, withLines, type ReplayPayload } from '@/lib/replay';
import { failureSentence, isLive, stepDurationMs, type Job, type JobRecording } from '@/lib/job';
import { ADD, WATCH } from '@/lib/copy';
import styles from './JobRun.module.css';

/** Often enough that the six steps feel live, seldom enough to be nothing to the API. */
const POLL_MS = 1500;

/**
 * How long a fetch that is not the poll waits before asking again, one entry per retry.
 *
 * Both of the fetches below used to ride the poll, which meant they inherited its one fatal
 * property: it stops. A recording that failed to load at the moment the run reached `done` was
 * never asked for again, and the reader was left on a finished job with no replay under it. These
 * back off on their own clock and give up on their own terms.
 */
const RETRY_MS = [1000, 2000, 4000, 8000];

/**
 * Run `ask` until it says it got what it came for, or until the retries run out. Returns the
 * cleanup an effect wants: after it, nothing is in flight and nothing is scheduled.
 */
function retrying(ask: () => Promise<boolean>): () => void {
  let cancelled = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let attempt = 0;

  const go = async () => {
    const got = await ask().catch(() => false);
    if (got || cancelled || attempt >= RETRY_MS.length) return;
    timer = setTimeout(go, RETRY_MS[attempt]);
    attempt += 1;
  };
  void go();

  return () => {
    cancelled = true;
    clearTimeout(timer);
  };
}

type Props = {
  /** The job as the server saw it. The first paint is already right, with or without JavaScript. */
  initialJob: Job;
  /** The recording, when the server found one — a reload mid-run lands straight on the replay. */
  initialRecording: JobRecording | null;
};

/**
 * One analysis, live.
 *
 * The page polls until the job stops moving and then stops polling — there is no socket, because
 * six steps over about a minute do not need one, and a poll that ends by itself cannot leak a
 * connection when the tab is left open overnight. The poll is deliberately cheap: the job is a few
 * hundred bytes of status, and the megabyte of recording is a second endpoint asked for once.
 *
 * That recording becomes available partway through, as soon as Jev is finished and long before the
 * scenes exist. The moment it lands it is turned into a replay payload **once** and kept:
 * rebuilding it on a later poll would hand `RunReplay` a new object mid-animation, and the run that
 * is playing is the one thing on this page that must not be interrupted.
 *
 * It owns the page shell, headline and all, rather than sitting inside one: the headline is part of
 * what the poll changes, and a server-rendered h1 would still read "Analysing" over a run the
 * reader has just watched finish.
 */
export function JobRun({ initialJob, initialRecording }: Props) {
  const [job, setJob] = useState(initialJob);
  const [payload, setPayload] = useState<ReplayPayload | null>(() =>
    initialRecording ? buildReplayPayload(initialRecording.recording, initialRecording.excerpts) : null,
  );

  useEffect(() => {
    if (!isLive(job.status)) return;
    let stopped = false;
    const timer = setInterval(async () => {
      try {
        const response = await fetch(`/api/add/jobs/${job.id}`, { cache: 'no-store' });
        if (!response.ok) return;
        const next = (await response.json()) as Job;
        if (!stopped) setJob(next);
      } catch {
        // A poll that fails changes nothing on screen: the last known state is still the last
        // known state, and the next tick asks again.
      }
    }, POLL_MS);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [job.id, job.status]);

  // The recording, on its own clock.
  //
  // It is about a megabyte, it does not change once the jev stage has ended, and it is asked for
  // the first time the job admits to having one. What it no longer does is ride the poll: a 404 is
  // a normal answer here (the flag and the write race by a moment) and so is a network blip, and
  // both used to be retried only on the next poll — which, on a job that has just reached `done`,
  // never comes. `payload` in the dependencies is what ends it: the effect re-runs when the
  // recording lands and returns immediately, so exactly one of these loops is ever alive.
  //
  // Nothing is said on screen while it retries. The reader is watching six steps that are still
  // moving, and "could not load the recording" over a run that is a second from producing one
  // would be a lie.
  useEffect(() => {
    if (!job.recording_ready || payload) return;
    return retrying(async () => {
      const response = await fetch(`/api/add/jobs/${job.id}/recording`, { cache: 'no-store' });
      if (!response.ok) return false;
      const body = (await response.json()) as JobRecording;
      setPayload(buildReplayPayload(body.recording, body.excerpts));
      return true;
    });
  }, [job.recording_ready, job.id, payload]);

  // And the lines, once there is a film to read them off.
  //
  // The recording above arrives the moment Jev's pass ends, which is minutes before the excerpts
  // are written — so every beat in it has an empty `lines`, and the job's own copy of them is
  // nulled out when the run reaches `done`. By then the film is in this app's database with both,
  // so the page asks once and merges the lines into the payload it has been holding. Merged, not
  // swapped: the replay may well be playing, and handing `RunReplay` a new object mid-run is the
  // one thing this page must not do.
  const merged = useRef(false);

  useEffect(() => {
    const slug = job.film.slug;
    if (job.status !== 'done' || !slug || merged.current) return;
    return retrying(async () => {
      const response = await fetch(`/api/films/${slug}/recording`, { cache: 'no-store' });
      if (!response.ok) return false;
      const body = (await response.json()) as { payload: ReplayPayload | null };
      merged.current = true;
      // No recording row for this film is an answer, not a failure: there is nothing to wait for.
      if (body.payload) {
        setPayload((current) => (current ? withLines(current, body.payload!) : body.payload));
      }
      return true;
    });
  }, [job.status, job.film.slug]);

  const failed = job.status === 'failed';
  const headline =
    job.status === 'queued'
      ? ADD.jobQueued
      : job.status === 'done'
        ? ADD.jobDone
        : failed
          ? ADD.jobFailed
          : ADD.jobHeading;

  return (
    <WatchShell headline={headline} lead={WATCH.intro}>
      <div className={styles.job}>
        <div className={styles.film}>
        <Poster
          url={job.film.poster_url}
          title={job.film.title}
          width={92}
          height={130}
          className={styles.poster}
        />
        <div className={styles.filmText}>
          <p className={styles.filmTitle}>
            {job.film.title}
            {job.film.year && <span className={styles.filmYear}>{job.film.year}</span>}
          </p>
          <p className={styles.filmState}>
            {job.status === 'queued'
              ? ADD.queued
              : job.status === 'running'
                ? `${ADD.jobHeading}…`
                : job.status === 'done'
                  ? ADD.scenesFound(job.scene_count ?? 0)
                  : ADD.failedHeadline}
          </p>
          {/* A live job's `cost_usd` is the reserve the budget booked for it, not what it has
              spent — a queued run that has made no model call at all already carries $1.70, and
              the figure goes *down* when the run reconciles. So while it is live the line names it
              as money set aside, and only a finished run is shown as a bill. */}
          <p className={`tabular ${styles.filmFacts}`}>
            {job.elapsed_ms !== null && <>{formatSeconds(job.elapsed_ms)} · </>}
            {isLive(job.status)
              ? ADD.costReserved(job.cost_usd ?? 0)
              : `${formatCents(job.cost_usd ?? 0)} ${ADD.costTotal}`}
          </p>
        </div>
      </div>

      {failed && (
        <p className={styles.failure} role="alert">
          {failureSentence(job.error_code, job.error)}
        </p>
      )}

      <section className={styles.steps} aria-label={ADD.stepsHeading}>
        <h2 className={styles.stepsHeading}>{ADD.stepsHeading}</h2>
        <ol className={styles.stepList}>
          {job.steps.map((step) => {
            const duration = stepDurationMs(step);
            return (
              <li key={step.id} className={`${styles.step} ${styles[`step_${step.status}`]}`}>
                <span className={styles.stepDot} aria-hidden="true" />
                <span className={styles.stepLabel}>{step.label}</span>
                {step.detail && <span className={styles.stepDetail}>{step.detail}</span>}
                <span className={`tabular ${styles.stepTime}`}>
                  {duration === null ? '' : formatSeconds(duration)}
                </span>
                <span className="srOnly">{step.status}</span>
              </li>
            );
          })}
        </ol>
      </section>

      {payload && <RunReplay payload={payload} />}

      {job.status === 'done' && job.film.slug && (
        <div className={styles.actions}>
          <Link href={`/film/${job.film.slug}`} className={`button ${styles.button}`}>
            {ADD.openFilm}
            <ArrowRight />
          </Link>
          <Link href={`/watch/${job.film.slug}`} className={styles.quietLink}>
            {WATCH.play}
          </Link>
        </div>
      )}

      {failed && (
        <div className={styles.actions}>
          <Link href="/watch" className={`button ${styles.button}`}>
            {WATCH.backToRuns}
            <ArrowRight />
          </Link>
        </div>
        )}
      </div>
    </WatchShell>
  );
}
