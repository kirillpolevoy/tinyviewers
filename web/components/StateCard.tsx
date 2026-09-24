import type { ReactNode } from 'react';
import styles from './StateCard.module.css';

type Props = {
  headline: ReactNode;
  body?: ReactNode;
  /** The way onward, when there is one: a button or a link. */
  children?: ReactNode;
  /** The heading level this card sits at on its page. */
  as?: 'h1' | 'h2' | 'h3';
  className?: string;
};

/**
 * The calm "state" sheet: a headline, one plain sentence, and the way onward. The film page, the
 * library and the add flow all say their kinds of nothing with it, and keep them apart — "No
 * matches", "No scenes found" and "Not in the library. Yet." are different news.
 */
export function StateCard({ headline, body, children, as: Heading = 'h2', className = '' }: Props) {
  return (
    <div className={`${styles.card} ${className}`}>
      <Heading className={styles.headline}>{headline}</Heading>
      {body && <p className={styles.body}>{body}</p>}
      {children && <div className={styles.actions}>{children}</div>}
    </div>
  );
}
