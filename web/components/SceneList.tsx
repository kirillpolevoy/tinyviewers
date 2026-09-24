'use client';

import { useState, type MouseEvent } from 'react';
import { FILM } from '@/lib/copy';
import {
  endsAroundMs,
  formatTime,
  readyAtMs,
  severityFor,
  severityTone,
  strengthWord,
} from '@/lib/scenes';
import type { AgeBand, Scene } from '@/lib/scenes';
import styles from './SceneList.module.css';

type Props = {
  scenes: Scene[];
  band: AgeBand;
  /** Controlled: which row is open. Leave out and the list keeps its own state. */
  openId?: string | null;
  onToggle?: (id: string) => void;
};

/**
 * Scenes in time order, strength first: how strong, what it is, when. One row open at a time; the
 * open row says when to be ready, what happens, and what is in it.
 *
 * Each row is a native <details>, so without JavaScript every row still opens and the times a
 * parent came for are in the HTML the server sent. With JavaScript the list takes over the toggling
 * — the summary's click is handled here — so exactly one row is open and a tapped timeline marker
 * can open its row from outside.
 */
export function SceneList({ scenes, band, openId, onToggle }: Props) {
  const [ownOpen, setOwnOpen] = useState<string | null>(null);
  const controlled = openId !== undefined;
  const current = controlled ? openId : ownOpen;

  const toggle = (id: string) => (event: MouseEvent<HTMLElement>) => {
    event.preventDefault();
    if (controlled) onToggle?.(id);
    else setOwnOpen((was) => (was === id ? null : id));
  };

  return (
    <ol className={styles.list}>
      {scenes.map((scene) => {
        const value = severityFor(scene, band);
        const open = current === scene.id;
        return (
          <li key={scene.id} className={`${styles.row} ${open ? styles.open : ''}`}>
            <details className={styles.details} open={open}>
              <summary className={styles.summary} onClick={toggle(scene.id)}>
                <span className={styles.strength}>
                  <span className={`${styles.swatch} ${styles[severityTone(value)]}`} aria-hidden="true" />
                  {strengthWord(value)}
                </span>
                <span className={styles.title}>{scene.title}</span>
                <span className={`tabular ${styles.range}`}>
                  {formatTime(scene.startMs)}–{formatTime(scene.endMs)}
                </span>
              </summary>

              <div className={styles.panel}>
                <p className={`tabular ${styles.ready}`}>
                  {FILM.readyLine(
                    formatTime(readyAtMs(scene.startMs)),
                    formatTime(endsAroundMs(scene.endMs)),
                  )}
                </p>
                {scene.description && <p className={styles.description}>{scene.description}</p>}
                {scene.tags.length > 0 && (
                  <ul className={styles.tags}>
                    {scene.tags.map((tag) => (
                      <li key={tag.id} className={styles.tag}>
                        {tag.label}
                      </li>
                    ))}
                  </ul>
                )}
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
