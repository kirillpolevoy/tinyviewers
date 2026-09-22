'use client';

import Link from 'next/link';
import { SiteHeader } from '@/components/SiteHeader';
import { Bubbles } from '@/components/Art';
import { TROUBLE } from '@/lib/copy';
import styles from './trouble.module.css';

/**
 * Anything a page throws lands here: a database outage, a missing DATABASE_URL, a query that timed
 * out. The parent gets the site, one sentence and a way onward — never Next's bare 500 page.
 *
 * `error.message` is never rendered. A server error's message can carry a connection string, a
 * query or a host name, and none of that belongs on a page. The digest is the pointer into the
 * server log, so support can match a report to a trace without exposing anything.
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="page">
      <SiteHeader />
      <main className={`frame ${styles.main}`}>
        <div className={styles.card}>
          <Bubbles className={styles.art} />
          <h1 className={styles.headline}>{TROUBLE.headline}</h1>
          <p className={styles.body}>{TROUBLE.body}</p>
          <div className={styles.actions}>
            <button type="button" className="button" onClick={() => reset()}>
              {TROUBLE.retry}
            </button>
            <Link href="/library" className="button buttonQuiet">
              {TROUBLE.library}
            </Link>
          </div>
          {error.digest && <p className={styles.digest}>Reference: {error.digest}</p>}
        </div>
      </main>
    </div>
  );
}
