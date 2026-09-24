import { DEFAULT_BAND, formatTime, markerLeftPct, markerShape, severityFor, strengthWord } from '@/lib/scenes';
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

/**
 * The legend above the library rows: which age band the marks are drawn for, and what each colour
 * and height means, in the strength words the film page uses. Only the levels the rows on screen
 * actually draw are listed — "Low" and "Not checked" appear when a film has them, and "Not checked"
 * is never folded into the lowest level.
 */
export function StripLegend({ band, scenes }: { band: string; scenes: Scene[] }) {
  const levels = [
    { value: 0, tone: 'mint', height: 6 },
    { value: 1, tone: 'butter', height: 8 },
    { value: 2, tone: 'blush', height: 13 },
    { value: 3, tone: 'coral', height: 20 },
    { value: null, tone: 'grey', height: 6 },
  ] as const;
  const present = new Set(scenes.map((s) => severityFor(s, DEFAULT_BAND)));
  return (
    <div className={styles.legendWrap}>
      <span className={styles.legendBand}>{band}</span>
      <ul className={styles.legend}>
        {levels
          .filter((level) => present.has(level.value))
          .map((level) => (
            <li key={String(level.value)} className={styles.legendItem}>
              <span
                className={`${styles.legendSwatch} ${styles[level.tone]}`}
                style={{ height: `${level.height}px` }}
                aria-hidden="true"
              />
              {strengthWord(level.value)}
            </li>
          ))}
      </ul>
    </div>
  );
}
