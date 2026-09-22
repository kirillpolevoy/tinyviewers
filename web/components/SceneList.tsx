import { Chevron } from './Art';
import { StrengthMark } from './StrengthMark';
import { FILM } from '@/lib/copy';
import {
  endsAroundMs,
  formatTime,
  readyAtMs,
  severityFor,
  strengthLabel,
} from '@/lib/scenes';
import type { AgeBand, Scene } from '@/lib/scenes';
import styles from './SceneList.module.css';

/**
 * Every scene of one film, in time order, with rows that expand in place.
 *
 * Native <details>/<summary>, and therefore a server component: the times a parent came for — "Be
 * ready at", "Scene ends around", the sentence, both age ratings — are in the HTML the server
 * sends and open with no JavaScript at all. The browser gives the summary its button role and its
 * expanded state for free, which is also more robust than re-implementing them.
 *
 * `name` makes the rows an exclusive accordion: opening one closes the last. That is the
 * progressive-enhancement layer — where a browser does not support it, every row simply opens
 * independently, which is no worse.
 */
export function SceneList({ scenes, band }: { scenes: Scene[]; band: AgeBand }) {
  return (
    <ol className={styles.list}>
      {scenes.map((scene) => {
        const value = severityFor(scene, band);
        return (
          <li key={scene.id} className={styles.row}>
            <details className={styles.details} name="scene">
              <summary className={styles.summary}>
                <span className={`tabular ${styles.range}`}>
                  {formatTime(scene.startMs)}–{formatTime(scene.endMs)}
                </span>
                <span className={styles.middle}>
                  <span className={styles.title}>{scene.title}</span>
                  {scene.tags.length > 0 && (
                    <span className={styles.tags}>
                      {scene.tags.map((tag) => tag.label).join(' · ')}
                    </span>
                  )}
                </span>
                <span className={styles.strength}>
                  <StrengthMark value={value} />
                </span>
                <span className={styles.chevron}>
                  <Chevron />
                  <span className="srOnly">{FILM.showDetails}</span>
                </span>
              </summary>

              <div className={styles.panelInner}>
                <div className={styles.panelText}>
                  {scene.description && <p className={styles.description}>{scene.description}</p>}
                </div>
                <div className={styles.panelFacts}>
                  <dl className={styles.times}>
                    <div className={styles.timeRow}>
                      <dt>{FILM.beReadyAt}</dt>
                      <dd className={`tabular ${styles.timeValue}`}>
                        {formatTime(readyAtMs(scene.startMs))}
                      </dd>
                    </div>
                    <div className={styles.timeRow}>
                      <dt>{FILM.sceneEndsAround}</dt>
                      <dd className={`tabular ${styles.timeValue}`}>
                        {formatTime(endsAroundMs(scene.endMs))}
                      </dd>
                    </div>
                  </dl>
                  <hr className={styles.rule} />
                  <ul className={styles.bands}>
                    <li>
                      <b>Ages 5–7:</b> {strengthLabel(scene.severity57) ?? 'Not checked'}
                    </li>
                    <li>
                      <b>Ages 8–10:</b> {strengthLabel(scene.severity810) ?? 'Not checked'}
                    </li>
                  </ul>
                </div>
              </div>
            </details>
          </li>
        );
      })}
    </ol>
  );
}

// TODO(phase 4): "Was this right? · Yes · Something is off" belongs here, once there is somewhere
// to send it. It was removed rather than left in place: controls that accept a parent's answer and
// drop it on the floor are worse than no controls, because they look like they worked. Wire them
// back up against the feedback endpoint (POST /api/scenes/{id}/feedback) when it exists, together
// with the copy in lib/copy.ts (FILM.feedbackPrompt and friends).
