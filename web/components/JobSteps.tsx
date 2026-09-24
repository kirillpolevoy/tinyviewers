import type { ReactNode } from 'react';
import { Poster } from './Poster';
import { formatCents, formatSeconds } from '@/lib/replay';
import { failureSentence, isLive, stepDurationMs, type Job } from '@/lib/job';
import { ADD } from '@/lib/copy';
import styles from './Job.module.css';

type Props = {
  job: Job;
  /** One line under the title saying what the job is doing, in the page's own words. */
  state: ReactNode;
};

/**
 * One job's film, money, failure and steps — the part the add progress page and the live demo run
 * page have in common. Presentation only: the page that owns it polls.
 */
export function JobSteps({ job, state }: Props) {
  const failed = job.status === 'failed';
  return (
    <>
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
          {/* Polite, and only the state: the step changes and the finish are read out; the seconds
              and cents on the line below are not, because they change on every poll. */}
          <p className={styles.filmState} role="status">
            {state}
          </p>
          {/* A live job's `cost_usd` is the reserve the budget booked for it, not what it has
              spent, and the figure goes *down* when the run reconciles. So while it is live the
              line names it as money set aside, and only a finished run is shown as a bill. */}
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
                {/* The state in words, beside the dot: colour is never the only way to tell a
                    finished step from a running or failed one. */}
                <span className={`tabular ${styles.stepTime}`}>
                  <span className={styles.stepState}>{ADD.stepState[step.status] ?? step.status}</span>
                  {duration === null ? '' : ` · ${formatSeconds(duration)}`}
                </span>
              </li>
            );
          })}
        </ol>
      </section>
    </>
  );
}
