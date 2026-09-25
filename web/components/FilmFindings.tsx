'use client';

import { useMemo, useRef, useState, type MouseEvent } from 'react';
import { AgeToggle, FilterPanel, LevelsDisclosure } from './FilmControls';
import { SceneList } from './SceneList';
import { StateCard } from './StateCard';
import { EMPTY, FILM } from '@/lib/copy';
import {
  filmHref,
  formatTime,
  lastSceneEndMs,
  markerHeightPx,
  markerLeftPct,
  mergedFacets,
  severityFor,
  severityTone,
  strengthBreakdown,
  strengthWord,
  visibleScenes,
  sceneHeading,
} from '@/lib/scenes';
import type { AgeBand, Scene } from '@/lib/scenes';
import styles from './FilmFindings.module.css';

type Props = {
  slug: string;
  title: string;
  scenes: Scene[];
  /** The film's length on the timeline: the track's, or the last scene's end if that is later. */
  durationMs: number;
  initialBand: AgeBand;
  initialTags: string[];
};

/**
 * Everything on the film page that answers a tap: the findings card (the verdict, its strength
 * breakdown, the age toggle and the tappable timeline), the filter and the scene rows.
 *
 * Four pieces of state, and one rule about each:
 *  - `band` recomputes the breakdown, the marker heights and colours and the strength words — never
 *    which scenes are listed.
 *  - `selectedSceneId` (a tapped marker) narrows the list to that one scene and opens it; a second
 *    tap, or "Show all", restores the list.
 *  - `tags` filter the list the moment a chip is pressed, and clear any marker selection.
 *  - `openId` is the one open row.
 *
 * The band and the tags are kept in the URL with replaceState, so a refresh or a shared link keeps
 * them; the server reads the same URL for the first paint.
 */
export function FilmFindings({ slug, title, scenes, durationMs, initialBand, initialTags }: Props) {
  const [band, setBand] = useState<AgeBand>(initialBand);
  const [tags, setTags] = useState<string[]>(initialTags);
  const [selectedSceneId, setSelectedSceneId] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const summaryRef = useRef<HTMLElement>(null);
  const markerRefs = useRef(new Map<string, HTMLButtonElement>());
  const markersRef = useRef<HTMLDivElement>(null);

  const facets = useMemo(() => mergedFacets(scenes), [scenes]);
  const breakdown = useMemo(() => strengthBreakdown(scenes, band), [scenes, band]);
  const lastEnd = useMemo(() => lastSceneEndMs(scenes), [scenes]);
  const shown = useMemo(
    () => visibleScenes(scenes, { selectedSceneId, tags }),
    [scenes, selectedSceneId, tags],
  );
  const selected = selectedSceneId ? (scenes.find((s) => s.id === selectedSceneId) ?? null) : null;
  // Every scene rated the same for both bands: said, so the age switch changing nothing does not look broken.
  const bandsSame = useMemo(
    () => scenes.length > 0 && scenes.every((s) => severityFor(s, '5-7') === severityFor(s, '8-10')),
    [scenes],
  );

  const keepUrl = (next: { band: AgeBand; tags: string[] }) => {
    window.history.replaceState(null, '', filmHref(slug, { band: next.band, selected: next.tags }));
  };

  const changeBand = (next: AgeBand) => {
    setBand(next);
    keepUrl({ band: next, tags });
  };

  const changeTags = (next: string[]) => {
    setTags(next);
    setSelectedSceneId(null);
    // A row the filter has just hidden cannot stay the open one.
    if (openId && !visibleScenes(scenes, { selectedSceneId: null, tags: next }).some((s) => s.id === openId)) {
      setOpenId(null);
    }
    keepUrl({ band, tags: next });
  };

  const tapMarker = (id: string) => {
    if (selectedSceneId === id) {
      setSelectedSceneId(null);
      setOpenId(null);
      return;
    }
    setSelectedSceneId(id);
    setOpenId(id);
    // On a phone the list is a screen away from the timeline; bring the scene to the reader.
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    requestAnimationFrame(() =>
      listRef.current?.scrollIntoView({ block: 'nearest', behavior: reduce ? 'auto' : 'smooth' }),
    );
  };

  // A finger is wider than a 16px marker, and markers late in a film sit a few pixels apart. So a tap
  // anywhere on the timeline's inset picks the marker nearest to it (within half a 44px target);
  // a tap on a marker itself is that marker's own click. The markers stay the buttons that keyboard
  // and screen-reader users reach — this only widens where a pointer can land.
  const tapTimeline = (event: MouseEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest('button')) return;
    const box = markersRef.current?.getBoundingClientRect();
    if (!box || box.width === 0) return;
    const x = event.clientX - box.left;
    let best: { id: string; distance: number } | null = null;
    for (const scene of scenes) {
      const distance = Math.abs((markerLeftPct(scene.startMs, durationMs) / 100) * box.width - x);
      if (!best || distance < best.distance) best = { id: scene.id, distance };
    }
    if (best && best.distance <= 22) {
      tapMarker(best.id);
      markerRefs.current.get(best.id)?.focus({ preventScroll: true });
    }
  };

  // "Show all" removes itself when pressed, so focus would fall to the page. It goes back to the
  // marker that was selected instead: the control the parent used to get here.
  const showAll = () => {
    const was = selectedSceneId;
    setSelectedSceneId(null);
    setOpenId(null);
    if (was) requestAnimationFrame(() => markerRefs.current.get(was)?.focus());
  };

  // Both "Clear filters" buttons disappear once nothing is selected. Focus goes to the filter's
  // summary, which is still there and says what just changed ("Filter scenes", no "· 2 on").
  const clearTags = () => {
    changeTags([]);
    requestAnimationFrame(() => summaryRef.current?.focus());
  };

  const verdictWords = scenes.length === 1 ? FILM.verdictWordsOne : FILM.verdictWords;

  return (
    <>
      <section className={styles.card} aria-labelledby="verdict">
        <div className={styles.top}>
          <div className={styles.verdict}>
            <h2 id="verdict" className={styles.verdictLine}>
              <span className={`tabular ${styles.count}`}>{scenes.length}</span>
              <span className={styles.words}>{verdictWords}</span>
            </h2>
            {breakdown.length > 0 && (
              <ul className={styles.breakdown}>
                {breakdown.map((entry) => (
                  <li key={entry.word} className={styles.breakdownItem}>
                    <span className={`${styles.swatch} ${styles[entry.tone]}`} aria-hidden="true" />
                    <span className="tabular">{entry.count}</span> {entry.word}
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className={styles.bandBox}>
            <AgeToggle slug={slug} band={band} selected={tags} onChange={changeBand} />
            {bandsSame && <p className={styles.bandsSame}>{FILM.bandsSame}</p>}
            <LevelsDisclosure />
          </div>
        </div>

        {scenes.length > 0 && (
          <div className={styles.timeline} onClick={tapTimeline}>
            <div className={styles.baseline} aria-hidden="true" />
            <div
              ref={markersRef}
              className={styles.markers}
              role="group"
              aria-label={`Where the ${scenes.length} scenes sit across ${title}. Tap one to see it.`}
            >
              {scenes.map((scene) => {
                const value = severityFor(scene, band);
                const isSelected = scene.id === selectedSceneId;
                return (
                  <button
                    key={scene.id}
                    ref={(node) => {
                      if (node) markerRefs.current.set(scene.id, node);
                      else markerRefs.current.delete(scene.id);
                    }}
                    type="button"
                    className={`${styles.marker} ${styles[severityTone(value)]} ${
                      isSelected ? styles.markerSelected : selectedSceneId ? styles.markerDimmed : ''
                    }`}
                    style={{
                      left: `${markerLeftPct(scene.startMs, durationMs)}%`,
                      height: `${markerHeightPx(value)}px`,
                    }}
                    aria-pressed={isSelected}
                    aria-label={`${sceneHeading(scene)}, ${formatTime(scene.startMs)}, ${strengthWord(value)}`}
                    onClick={() => tapMarker(scene.id)}
                  />
                );
              })}
            </div>
            <span className={`tabular ${styles.tick} ${styles.tickStart}`} aria-hidden="true">
              {formatTime(0)}
            </span>
            <span className={`tabular ${styles.tick} ${styles.tickMid}`} aria-hidden="true">
              {formatTime(durationMs / 2)}
            </span>
            <span className={`tabular ${styles.tick} ${styles.tickEnd}`} aria-hidden="true">
              {formatTime(durationMs)}
            </span>
          </div>
        )}

        <div className={styles.bottom}>
          {scenes.length > 0 && (
            <p className={styles.hint} aria-live="polite">
              {selected ? (
                <>
                  {FILM.showingScene(formatTime(selected.startMs))}{' '}
                  {/* With a filter on, the way back is to the matching scenes, not to all of them —
                      and the button says which. */}
                  <button type="button" className={styles.showAll} onClick={showAll}>
                    {tags.length > 0 ? FILM.showMatching : FILM.showAll}
                  </button>
                </>
              ) : (
                <>
                  {/* On a phone the markers are a picture: the rows below are the way in. */}
                  <span className={styles.hintWide}>{FILM.timelineHint}</span>
                  <span className={styles.hintPhone}>{FILM.timelineHintPhone}</span>
                </>
              )}
              <span> · {FILM.allClear(formatTime(lastEnd))}</span>
            </p>
          )}
        </div>
      </section>

      {scenes.length > 0 && (
        <FilterPanel
          slug={slug}
          band={band}
          facets={facets}
          selected={tags}
          onToggle={(id) => changeTags(tags.includes(id) ? tags.filter((t) => t !== id) : [...tags, id])}
          onClear={clearTags}
          summaryRef={summaryRef}
          // What the list below actually shows: with a marker selected that is the one scene.
          shown={shown.length}
          total={scenes.length}
          onViewMatching={() => {
            const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
            listRef.current?.scrollIntoView({ block: 'start', behavior: reduce ? 'auto' : 'smooth' });
            listRef.current?.querySelector<HTMLElement>('summary')?.focus({ preventScroll: true });
          }}
        />
      )}

      <div ref={listRef} className={styles.list}>
        {scenes.length === 0 ? (
          <StateCard as="h2" headline={EMPTY.noScenesHeadline} body={EMPTY.noScenesBody} />
        ) : shown.length === 0 ? (
          // Only a shared or hand-edited URL can ask for a label this film does not have; the chips
          // never offer one. The honest answer is "No matches", not the whole list.
          <StateCard as="h2" headline={EMPTY.noMatchesHeadline} body={EMPTY.noMatchesBody}>
            <button type="button" className="button buttonQuiet" onClick={clearTags}>
              {FILM.clearFilters}
            </button>
          </StateCard>
        ) : (
          <>
          <p className={styles.rowsHint}>{FILM.rowsHint}</p>
          <SceneList
            scenes={shown}
            band={band}
            openId={openId}
            onToggle={(id) => setOpenId((was) => (was === id ? null : id))}
          />
          </>
        )}
      </div>
    </>
  );
}
