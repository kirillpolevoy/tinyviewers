import { formatTime, markerLeftPct, markerShape, severityFor } from '@/lib/scenes';
import type { AgeBand, Scene } from '@/lib/scenes';
import styles from './Strip.module.css';

type Marker = {
  startMs: number;
  severity57: number | null;
  severity810: number | null;
  /** False when a filter is on and this scene is not one of the matches. */
  matches?: boolean;
};

type Props = {
  markers: Marker[];
  durationMs: number;
  band: AgeBand;
  /** 'card' is the small strip on a library card; 'timeline' is the film page's full-width strip. */
  variant?: 'card' | 'timeline';
  /**
   * Screen-reader sentence for the standalone strip. Ignored when `decorative` is set.
   */
  summary?: string;
  /**
   * The strip is inside a link whose accessible name is already the film, its year and its counts.
   * A role="img" with a sentence on it would be appended to that name, turning a two-word link into
   * a forty-word one. The picture adds nothing the text has not said, so it is hidden.
   */
  decorative?: boolean;
};

const asScene = (m: Marker) =>
  ({ severity57: m.severity57, severity810: m.severity810 }) as unknown as Scene;

export function Strip({
  markers,
  durationMs,
  band,
  variant = 'card',
  summary,
  decorative = false,
}: Props) {
  return (
    <div className={variant === 'timeline' ? styles.timelineWrap : styles.cardWrap}>
      <div
        className={styles.track}
        {...(decorative
          ? { 'aria-hidden': true as const }
          : { role: 'img' as const, 'aria-label': summary })}
      >
        {variant === 'timeline' &&
          [10, 20, 30, 40, 50, 60, 70, 80, 90].map((pct) => (
            <span key={pct} className={styles.gridline} style={{ left: `${pct}%` }} />
          ))}
        {markers.map((m, i) => {
          const value = severityFor(asScene(m), band);
          const { heightPct, tone } = markerShape(value);
          return (
            <span
              key={`${m.startMs}-${i}`}
              className={`${styles.marker} ${styles[tone]} ${m.matches === false ? styles.muted : ''}`}
              style={{
                left: `${markerLeftPct(m.startMs, durationMs)}%`,
                height: `${heightPct}%`,
              }}
            />
          );
        })}
      </div>
      {variant === 'timeline' && (
        <div className={styles.scale} aria-hidden="true">
          <span>{formatTime(0)}</span>
          <span>{formatTime(durationMs / 2)}</span>
          <span>{formatTime(durationMs)}</span>
        </div>
      )}
    </div>
  );
}

/** The legend under the library heading: what a marker's height means. */
export function StripLegend() {
  return (
    <ul className={styles.legend}>
      {[
        { tone: 'butter', height: 8, label: '1' },
        { tone: 'blush', height: 13, label: '2' },
        { tone: 'coral', height: 20, label: '3' },
      ].map((item) => (
        <li key={item.label} className={styles.legendItem}>
          <span
            className={`${styles.legendSwatch} ${styles[item.tone]}`}
            style={{ height: `${item.height}px` }}
            aria-hidden="true"
          />
          {item.label}
        </li>
      ))}
    </ul>
  );
}
