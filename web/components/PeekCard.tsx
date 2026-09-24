import { DEFAULT_BAND, formatTime, severityFor, strengthLabel } from '@/lib/scenes';
import type { Scene } from '@/lib/scenes';
import { EMPTY, HOME, sceneCountLabel } from '@/lib/copy';
import styles from './PeekCard.module.css';

type Props = {
  title: string;
  sceneCount: number;
  /** Three real rows from the film's scene list. */
  scenes: Scene[];
};

/**
 * Home's proof: the answer a parent gets, as a tilted sticker. Every row is a real row from the
 * database, so Home can never promise a scene the film page does not show.
 */
export function PeekCard({ title, sceneCount, scenes }: Props) {
  return (
    <div className={styles.peek}>
      <div className={styles.head}>
        <span className={styles.title}>{title}</span>
        <span className={styles.count}>
          {sceneCountLabel(sceneCount)} · {HOME.peekBand}
        </span>
      </div>
      {scenes.map((scene) => (
        <div key={scene.id} className={styles.row}>
          <div className={styles.top}>
            <span className={`tabular ${styles.range}`}>
              {formatTime(scene.startMs)}–{formatTime(scene.endMs)}
            </span>
            <span className={styles.strength}>
              {strengthLabel(severityFor(scene, DEFAULT_BAND)) ?? EMPTY.notCheckedHeadline}
            </span>
          </div>
          <span className={styles.scene}>{scene.title}</span>
          {scene.tags.length > 0 && (
            <span className={styles.tags}>{scene.tags.map((tag) => tag.label).join(' · ')}</span>
          )}
        </div>
      ))}
    </div>
  );
}
