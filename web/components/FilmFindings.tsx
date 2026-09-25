'use client';

import { useMemo, useRef, useState, type MouseEvent } from 'react';
import { AgeToggle, FilterPanel, LevelsDisclosure } from './FilmControls';
import { SceneList } from './SceneList';
import { StateCard } from './StateCard';
import { useWidth } from './useWidth';
import { EMPTY, FILM } from '@/lib/copy';
import { nameContext } from '@/lib/reasons';
import {
  clusterMarkers,
  markWidthPx,
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
 *  - `selectedIds` (a tapped marker) narrows the list to that one scene and opens it — or, for a mark
 *    that stands for several scenes sat close together, to those scenes; a second tap, or "Show all",
 *    restores the list.
 *  - `tags` filter the list the moment a chip is pressed, and clear any marker selection.
 *  - `openId` is the one open row.
 *
 * The band and the tags are kept in the URL with replaceState, so a refresh or a shared link keeps
 * them; the server reads the same URL for the first paint.
 */
export function FilmFindings({ slug, title, scenes, durationMs, initialBand, initialTags }: Props) {
  const [band, setBand] = useState<AgeBand>(initialBand);
  const [tags, setTags] = useState<string[]>(initialTags);
  const [selectedIds, setSelectedIds] = useState<string[] | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const summaryRef = useRef<HTMLElement>(null);
  // Keyed by the first scene of each mark (a mark can stand for several scenes).
  const markerRefs = useRef(new Map<string, HTMLButtonElement>());
  const markersRef = useRef<HTMLDivElement>(null);
  // Scenes that sit closer together than a mark is wide share one mark, with their count on it; how
  // close that is depends on how wide the timeline is drawn, so it is measured (0 on the server, where
  // every scene is its own mark).
  const trackWidth = useWidth(markersRef);

  const facets = useMemo(() => mergedFacets(scenes), [scenes]);
  // The whole film's checked text, so a reason names a character the way the film's text does.
  const context = useMemo(() => nameContext(scenes), [scenes]);
  const breakdown = useMemo(() => strengthBreakdown(scenes, band), [scenes, band]);
  const lastEnd = useMemo(() => lastSceneEndMs(scenes), [scenes]);
  const shown = useMemo(
    () => visibleScenes(scenes, { selectedIds, tags }),
    [scenes, selectedIds, tags],
  );
  const selected = useMemo(
    () => (selectedIds ? scenes.filter((s) => selectedIds.includes(s.id)) : []),
    [scenes, selectedIds],
  );
  const clusters = useMemo(
    () => clusterMarkers(scenes, (s) => markerLeftPct(s.startMs, durationMs), (s) => severityFor(s, band), trackWidth),
    [scenes, durationMs, band, trackWidth],
  );
  const markPx = markWidthPx(trackWidth);
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
    setSelectedIds(null);
    // A row the filter has just hidden cannot stay the open one.
    if (openId && !visibleScenes(scenes, { tags: next }).some((s) => s.id === openId)) {
      setOpenId(null);
    }
    keepUrl({ band, tags: next });
  };

  const tapMarker = (ids: string[]) => {
    if (selectedIds && sameIds(selectedIds, ids)) {
      setSelectedIds(null);
      setOpenId(null);
      return;
    }
    setSelectedIds(ids);
    // One scene opens; several are listed, closed, for the parent to choose from.
    setOpenId(ids.length === 1 ? ids[0] : null);
    // On a phone the list is a screen away from the timeline; bring the scene to the reader.
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    requestAnimationFrame(() =>
      listRef.current?.scrollIntoView({ block: 'nearest', behavior: reduce ? 'auto' : 'smooth' }),
    );
  };

  // Touch screens never get here: under a coarse pointer the timeline is a picture (FilmFindings.module.css)
  // and the rows are the controls. A mouse can still land a few pixels off a 10px mark, so a click
  // anywhere on the timeline's inset picks the mark nearest to it (within half a 44px target);
  // a tap on a mark itself is that mark's own click. The marks stay the buttons that keyboard
  // and screen-reader users reach — this only widens where a pointer can land.
  const tapTimeline = (event: MouseEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest('button')) return;
    const box = markersRef.current?.getBoundingClientRect();
    if (!box || box.width === 0) return;
    const x = event.clientX - box.left;
    let best: { ids: string[]; distance: number } | null = null;
    for (const cluster of clusters) {
      // How far outside the mark's own edges the click landed (0 inside it).
      const from = (cluster.firstPct / 100) * box.width - markPx / 2;
      const to = (cluster.lastPct / 100) * box.width + markPx / 2;
      const distance = Math.max(0, from - x, x - to);
      if (!best || distance < best.distance) best = { ids: cluster.items.map((s) => s.id), distance };
    }
    if (best && best.distance <= 17) {
      tapMarker(best.ids);
      markerRefs.current.get(best.ids[0])?.focus({ preventScroll: true });
    }
  };

  // "Show all" removes itself when pressed, so focus would fall to the page. It goes back to the
  // marker that was selected instead: the control the parent used to get here.
  const showAll = () => {
    const was = selectedIds?.[0];
    setSelectedIds(null);
    setOpenId(null);
    const mark = was ? clusters.find((c) => c.items.some((s) => s.id === was))?.items[0].id : undefined;
    if (mark) requestAnimationFrame(() => markerRefs.current.get(mark)?.focus());
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
                    {/* Every scene at one level: the level alone, not the count a second time. */}
                    {breakdown.length === 1 && entry.value !== null ? (
                      FILM.breakdownAll(entry.word, entry.count)
                    ) : (
                      <>
                        <span className="tabular">{entry.count}</span> {entry.word}
                      </>
                    )}
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
              {clusters.map((cluster) => {
                const ids = cluster.items.map((s) => s.id);
                const first = cluster.items[0];
                const last = cluster.items[cluster.items.length - 1];
                const many = ids.length > 1;
                const value = cluster.value;
                const isSelected = selectedIds !== null && ids.every((id) => selectedIds.includes(id));
                return (
                  <button
                    key={first.id}
                    ref={(node) => {
                      if (node) markerRefs.current.set(first.id, node);
                      else markerRefs.current.delete(first.id);
                    }}
                    type="button"
                    className={`${styles.marker} ${many ? styles.cluster : ''} ${styles[severityTone(value)]} ${
                      isSelected ? styles.markerSelected : selectedIds ? styles.markerDimmed : ''
                    }`}
                    style={
                      many
                        ? {
                            // As wide as the scenes it stands for, from the first one's start to the last's.
                            left: `calc(${cluster.firstPct}% - ${markPx / 2}px)`,
                            width: `calc(${cluster.lastPct - cluster.firstPct}% + ${markPx}px)`,
                            height: `${markerHeightPx(value)}px`,
                          }
                        : // Measured, the width is the one the grouping assumed; before that, the stylesheet's.
                          { left: `${cluster.firstPct}%`, height: `${markerHeightPx(value)}px`, ...(trackWidth ? { width: `${markPx}px` } : {}) }
                    }
                    aria-pressed={isSelected}
                    aria-label={
                      many
                        ? FILM.markerGroupLabel(ids.length, formatTime(first.startMs), formatTime(last.startMs), strengthWord(value))
                        : `${sceneHeading(first)}, ${formatTime(first.startMs)}, ${strengthWord(value)}`
                    }
                    onClick={() => tapMarker(ids)}
                  >
                    {many && (
                      <span className={`tabular ${styles.clusterCount}`} aria-hidden="true">
                        {ids.length}
                      </span>
                    )}
                  </button>
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
              {selected.length > 0 ? (
                <>
                  {selected.length === 1
                    ? FILM.showingScene(formatTime(selected[0].startMs))
                    : FILM.showingScenes(selected.length, formatTime(selected[0].startMs), formatTime(selected[selected.length - 1].startMs))}{' '}
                  {/* With a filter on, the way back is to the matching scenes, not to all of them —
                      and the button says which. */}
                  <button type="button" className={styles.showAll} onClick={showAll}>
                    {tags.length > 0 ? FILM.showMatching : FILM.showAll}
                  </button>
                </>
              ) : (
                <>
                  {/* On a phone or any touch screen the markers are a picture: the rows below are the way in. */}
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
            context={context}
            openId={openId}
            onToggle={(id) => setOpenId((was) => (was === id ? null : id))}
          />
          </>
        )}
      </div>
    </>
  );
}

/** The same scenes, in any order. */
function sameIds(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((id) => b.includes(id));
}
