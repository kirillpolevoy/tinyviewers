import { DEMO_LIVE } from '@/lib/copy';
import styles from './Watch.module.css';

/** Before (Sonnet, stored) → Jev's three jobs, live → after (the rules). Also used on a run's page. */
export function HowItFits() {
  return (
    <section className={styles.how} aria-labelledby="how-heading">
      <h2 id="how-heading" className={styles.sectionHeading}>
        {DEMO_LIVE.howHeading}
      </h2>
      <div className={styles.flow}>
      <div className={styles.flowSide}>
        <p className={styles.flowTag}>{DEMO_LIVE.beforeTag}</p>
        <p className={styles.flowBody}>{DEMO_LIVE.before}</p>
      </div>
      <div className={`sticker ${styles.flowLive}`}>
        <h2 id="jobs-heading" className={styles.flowHeading}>
          {DEMO_LIVE.jobsLabel}
          <span className={styles.flowLiveTag}>{DEMO_LIVE.liveTag}</span>
        </h2>
        <ol className={styles.jobList}>
          {DEMO_LIVE.jobs.map((job, i) => (
            <li key={job.title} className={styles.jobItem}>
              <span className={styles.jobNumber} aria-hidden="true">
                {i + 1}
              </span>
              <span className={styles.jobItemText}>
                <span className={styles.jobItemTitle}>{job.title}</span>
                <span className={styles.jobItemBody}>{job.body}</span>
              </span>
            </li>
          ))}
        </ol>
      </div>
      <div className={styles.flowSide}>
        <p className={styles.flowTag}>{DEMO_LIVE.afterTag}</p>
        <p className={styles.flowBody}>{DEMO_LIVE.after}</p>
      </div>
      </div>
    </section>
  );
}
