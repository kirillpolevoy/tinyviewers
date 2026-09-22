import { EMPTY } from '@/lib/copy';
import { strengthDots, strengthLabel } from '@/lib/scenes';
import styles from './StrengthMark.module.css';

/**
 * One mark per scene: three circles and the words. A scene the subtitles could not judge shows
 * "Not checked", never a zero — the two mean different things and the design keeps them apart.
 */
export function StrengthMark({ value }: { value: number | null }) {
  const label = strengthLabel(value);
  if (label === null) {
    return (
      <span className={styles.wrap}>
        <span className={styles.notChecked}>{EMPTY.notCheckedHeadline}</span>
      </span>
    );
  }
  const filled = strengthDots(value);
  return (
    <span className={styles.wrap}>
      <span className={styles.dots} aria-hidden="true">
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className={`${styles.dot} ${i < filled ? styles[`level${value}`] : styles.empty}`}
          />
        ))}
      </span>
      <span className={styles.label}>{label}</span>
    </span>
  );
}
