import type { ReactNode } from 'react';
import { SiteHeader } from '@/components/SiteHeader';
import styles from './WatchShell.module.css';

type Props = {
  /** The page's one h1. */
  headline: ReactNode;
  /** A line under the rule: what this particular page is. */
  lead?: ReactNode;
  /** Which navigation entry to mark as the page you are on. */
  current?: '/watch';
  children: ReactNode;
};

/**
 * The frame the "Watch it work" pages and the add pages sit in: dark surface, wordmark, headline,
 * coral rule.
 *
 * It is a shell and not a layout so each page keeps its own metadata and its own data fetching —
 * and so the rule, which is the one decorative stroke this register allows itself, is drawn once.
 */
export function WatchShell({ headline, lead, current = '/watch', children }: Props) {
  return (
    <div className={`page darkPage ${styles.page}`}>
      <SiteHeader current={current} tone="dark" />

      <main className={`frame ${styles.main}`}>
        <div className={styles.head}>
          <h1 className={styles.headline}>{headline}</h1>
          <svg
            className={styles.rule}
            viewBox="0 0 460 14"
            preserveAspectRatio="none"
            fill="none"
            aria-hidden="true"
            focusable="false"
          >
            <path
              d="M4 9c76-7 152 5 228-1 76-6 152 3 224-3"
              stroke="var(--coral)"
              strokeWidth="5"
              strokeLinecap="round"
            />
          </svg>
          {lead && <p className={styles.lead}>{lead}</p>}
        </div>
        {children}
      </main>
    </div>
  );
}
