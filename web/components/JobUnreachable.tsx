import Link from 'next/link';
import { WatchShell } from './WatchShell';
import { ArrowRight } from './Art';
import { ADD } from '@/lib/copy';
import styles from './JobUnreachable.module.css';

type Props = {
  /** This same page, to ask again. */
  retryHref: string;
  back: { href: string; label: string };
  current?: '/watch';
};

/**
 * The one state a job page renders without a job: the analysis service is not answering, so there
 * is nothing to show and no reason to claim the run does not exist.
 */
export function JobUnreachable({ retryHref, back, current }: Props) {
  return (
    <WatchShell headline={ADD.jobUnreachableHeadline} lead={ADD.jobUnreachableBody} current={current}>
      <div className={styles.actions}>
        {/* A bare anchor, not a Link: retrying has to be a fresh request to this same URL, and a
            client-side navigation to the route you are already on is the one thing the router is
            entitled to treat as a no-op. */}
        <a href={retryHref} className={`button ${styles.button}`}>
          {ADD.jobUnreachableRetry}
          <ArrowRight />
        </a>
        <Link href={back.href} className={styles.quietLink}>
          {back.label}
        </Link>
      </div>
    </WatchShell>
  );
}
