'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { ArrowRight } from './Art';
import { useDemoRun, useStartRun } from './useDemoRun';
import { ADD, DEMO_LIVE, STRENGTH_TABLE, FILM, ruleSentence } from '@/lib/copy';
import {
  answeredBy,
  bandsAgree,
  checkedTitle,
  claimOutcome,
  compareLine,
  cutDoubted,
  failedLead,
  feedScene,
  filmEndMs,
  finalOutcome,
  flaggedBreakdown,
  flaggedFor,
  flaggedHeading,
  flaggedStrength,
  formatAnswer,
  formatCount,
  formatRunCost,
  formatRunTime,
  growingCount,
  inFilmOrder,
  isRunLive,
  latest,
  pct,
  reasonChips,
  sameness,
  sceneNumber,
  spanLabel,
  stageShare,
  strengthFor,
  tileHeightPx,
  tileKind,
  whyTags,
  type DemoRun,
  type DemoScene,
  type WhyAnswer,
  type WhyTag,
} from '@/lib/demo';
import {
  endsAroundMs,
  formatTime,
  markerHeightPx,
  readyAtMs,
  severityTone,
  strengthWord,
  type AgeBand,
} from '@/lib/scenes';
import styles from './Watch.module.css';

/**
 * What the page knows about the film. The run names its own film (its slug is authoritative); the
 * title and the library facts come from the run, else from the films list looked up by that slug.
 * `inLibrary` is null when nobody could say — which the page never presents as "not in the library".
 */
export type RunFilm = {
  slug: string | null;
  /** The film's page in the library, when it has one. */
  librarySlug: string | null;
  title: string | null;
  year: number | null;
  inLibrary: boolean | null;
  sceneCount: number | null;
};

type Props = { id: string; initialRun: DemoRun; film: RunFilm };

/** "14:03:12" in the reader's own clock: when the last answer arrived. */
function clockTime(ms: number): string {
  return new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

/**
 * About how many questions Jev answered per scene: the mean of the scenes' own counts over the scenes
 * it has answered. Null when the API sends no per-scene counts — never estimated from anything else.
 */
function perSceneAnswers(run: DemoRun): number | null {
  const counts = run.scenes.map((s) => s.questions ?? 0).filter((n) => n > 0);
  return counts.length ? Math.round(counts.reduce((a, n) => a + n, 0) / counts.length) : null;
}

/** A scene's state in words: waiting, answers received, then included in the guide or not. */
function sceneWords(scene: DemoScene, live: boolean): string {
  const raw = tileKind(scene, '5-7');
  const kind = raw === 'asking' && !live ? 'pending' : raw;
  if (kind === 'flagged') return DEMO_LIVE.sceneIncluded(strengthWord(strengthFor(scene, '5-7')).toLowerCase());
  return DEMO_LIVE.sceneState[kind] ?? '';
}

/**
 * One live check: what Jev is doing while it runs; then the scenes to know about, with the check in
 * plain numbers and how it compares with the saved guide; and any scene up close with the reasons that
 * put it in the guide.
 *
 * Everything drawn is the polled run (`useDemoRun`). Blocks fill when a scene's answers land; the
 * counts are the stages' own; the elapsed time and the cost are the API's. Nothing here runs a timer
 * of its own, so a check that stalls looks stalled.
 *
 * The scene up close is `?scene=<id>` on this same page, pushed with the History API so the poll keeps
 * running underneath it; Back returns to the same place in the list.
 */
export function LiveRun({ id, initialRun, film }: Props) {
  const { run, health, retry } = useDemoRun(id, initialRun);
  const { start, starting, refusal } = useStartRun();
  const searchParams = useSearchParams();
  const sceneId = searchParams.get('scene');
  const [band, setBand] = useState<AgeBand>('5-7');
  const headingRef = useRef<HTMLHeadingElement>(null);
  // The polled run names its film too: a title the server could not load arrives with the next poll.
  const title = film.title ?? run.film?.title ?? DEMO_LIVE.thisFilm;
  const live = isRunLive(run.status);
  const finished = run.status === 'done';
  const failed = run.status === 'failed';
  // Where the parent came from when they opened a scene, so Back can return them to it.
  const cameFrom = useRef<string | null>(null);
  const pushedScene = useRef(false);

  // Cuts Jev has ruled on, by the scene each cut starts, gathered from the feed as polls bring it: the
  // feed carries the latest items only, and an uncertain cut must stay marked after it scrolls out.
  const [ruled, setRuled] = useState<Map<string, boolean>>(() => new Map());
  useEffect(() => {
    const cuts = run.feed.filter((item) => item.kind === 'cut');
    if (!cuts.length) return;
    setRuled((prev) => {
      let changed = false;
      const next = new Map(prev);
      for (const item of cuts) {
        const scene = feedScene(item);
        if (!scene) continue;
        const doubted = cutDoubted(item.verdict);
        if (next.get(scene) === true || next.get(scene) === doubted) continue;
        next.set(scene, doubted);
        changed = true;
      }
      return changed ? next : prev;
    });
  }, [run.feed]);

  const openScene = useCallback((scene: string) => {
    cameFrom.current = scene;
    const url = new URL(window.location.href);
    url.searchParams.set('scene', scene);
    window.history.pushState(null, '', url.toString());
    pushedScene.current = true;
    window.scrollTo({ top: 0 });
  }, []);
  // Back goes back to the entry the parent came from (no second copy in the history); a scene opened
  // from a shared link has nowhere to go back to, so it replaces the address instead.
  const closeScene = useCallback(() => {
    if (pushedScene.current) {
      pushedScene.current = false;
      window.history.back();
      return;
    }
    const url = new URL(window.location.href);
    url.searchParams.delete('scene');
    window.history.replaceState(null, '', url.toString());
  }, []);

  // Moving between the list and a scene replaces the whole view: focus the new heading — or, coming
  // back, the scene row the parent opened, scrolled into view.
  const firstRender = useRef(true);
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    if (!sceneId && cameFrom.current) {
      const target = document.querySelector<HTMLElement>(`[data-scene-row="${CSS.escape(cameFrom.current)}"]`);
      cameFrom.current = null;
      if (target) {
        const details = target.closest('details');
        if (details && !details.open) details.open = true;
        target.focus({ preventScroll: true });
        // After the router has finished its own handling of the history step (which can put the page
        // back at the top), not before it.
        const place = () => target.scrollIntoView({ block: 'center' });
        requestAnimationFrame(() => window.setTimeout(place, 60));
        return;
      }
    }
    headingRef.current?.focus();
  }, [sceneId]);

  const interrupted = health.state === 'interrupted';
  const missing = health.state === 'missing';
  const stale = (interrupted || missing) && live;

  const staleNotice = stale && (
    <div className={styles.stale} role="alert">
      {missing ? (
        <p>{ADD.jobMissing}</p>
      ) : (
        <p>
          <b>{ADD.interruptedHeadline}</b> {ADD.jobUnreachableBody}{' '}
          {health.lastOkAt !== null && ADD.lastUpdate(clockTime(health.lastOkAt))}
        </p>
      )}
      {!missing && (
        <button type="button" className="button buttonQuiet" onClick={retry}>
          {ADD.jobUnreachableRetry}
        </button>
      )}
    </div>
  );

  if (sceneId) {
    return (
      <SceneUpClose
        run={run}
        title={title}
        sceneId={sceneId}
        band={band}
        onBand={setBand}
        onBack={closeScene}
        headingRef={headingRef}
        notice={staleNotice}
      />
    );
  }

  // Finished, running it again is the quiet way onward (the saved guide is the main one); failed, it is
  // the main one, and it says it starts a NEW check.
  const runAgain = film.slug ? (
    <button
      type="button"
      className={finished ? styles.quietButton : `button ${styles.headerButton}`}
      onClick={() => start(film.slug!)}
      disabled={starting !== null}
    >
      {starting ? DEMO_LIVE.starting : finished ? DEMO_LIVE.runAgain : DEMO_LIVE.startNew}
      {!starting && !finished && <ArrowRight />}
    </button>
  ) : null;

  const headline = failed
    ? DEMO_LIVE.failedHeadline
    : finished
      ? DEMO_LIVE.doneIn(title)
      : run.status === 'queued'
        ? DEMO_LIVE.queuedHeadline(title)
        : DEMO_LIVE.runningHeadline(title);

  return (
    <>
      <section className={styles.runHead}>
        <div className={styles.runHeadText}>
          <p className="eyebrow">{finished ? DEMO_LIVE.doneEyebrow(title) : DEMO_LIVE.runEyebrow(title, film.year)}</p>
          <h1 className={styles.runHeadline} ref={headingRef} tabIndex={-1}>
            {headline}
          </h1>
          {failed ? (
            // Which of Jev's jobs it could not finish, in the page's words (the API's own sentence
            // names pipeline parts), and that the saved guide is untouched.
            <p className={styles.lead}>{failedLead(run)}</p>
          ) : !finished ? (
            <p className={styles.sub}>{DEMO_LIVE.runSub}</p>
          ) : null}
        </div>
        {failed && runAgain}
      </section>

      {refusal && (
        <p className={styles.refusal} role="alert">
          {refusal.refusal.kind === 'cap' && <b>{DEMO_LIVE.capHeadline} </b>}
          {refusal.refusal.text}
        </p>
      )}

      {staleNotice}

      {/* The finish is announced once; the counters changing every poll would be noise. */}
      <p className="srOnly" role="status">
        {finished ? DEMO_LIVE.srDone(title) : ''}
      </p>

      {finished && <RunDone run={run} film={film} band={band} onBand={setBand} onScene={openScene} runAgain={runAgain} ruled={ruled} />}

      {failed && (
        // The work that did finish is kept, but closed: the stop and the way onward come first.
        <details className={styles.howItWent}>
          <summary className={styles.howItWentSummary}>{DEMO_LIVE.failedDetails}</summary>
          <Board run={run} ruled={ruled} onScene={openScene} />
        </details>
      )}

      {live && <Board run={run} ruled={ruled} onScene={openScene} />}

      {live && (
        <section className={styles.explainers}>
          <div className={styles.card}>
            <h2 className={styles.cardHeading}>{DEMO_LIVE.whyJevTitle}</h2>
            <p className={styles.cardBody}>{DEMO_LIVE.whyJevBody}</p>
          </div>
          <div className={styles.card}>
            <h2 className={styles.cardHeading}>{DEMO_LIVE.sonnetTitle}</h2>
            <p className={styles.cardBody}>{DEMO_LIVE.sonnetBody(film.sceneCount ?? run.scenes.length)}</p>
          </div>
        </section>
      )}
    </>
  );
}

// ------------------------------------------------------------------------------------------------
// The board: Jev's work, as the polls report it
// ------------------------------------------------------------------------------------------------

function Board({ run, ruled, onScene }: { run: DemoRun; ruled: Map<string, boolean>; onScene: (id: string) => void }) {
  const scenes = useMemo(() => inFilmOrder(run.scenes), [run.scenes]);
  const end = filmEndMs(scenes);
  const live = isRunLive(run.status);
  const finished = run.status === 'done';
  const { split_check: split, classify, claims, moments } = run.stages;
  const splitDone = split.total > 0 && split.done >= split.total;
  const claimFeed = latest(run.feed, 'claim', 4);
  const perScene = perSceneAnswers(run);
  const answered = scenes.filter((s) => s.state === 'answered');
  const uncertain = scenes.slice(1).filter((s) => (s.cut ? cutDoubted(s.cut) : ruled.get(s.id)) === true).length;

  return (
    <section className={styles.board} aria-label={DEMO_LIVE.boardLabel}>
      {/* The measured time and cost, compact: the scenes are the news. */}
      <p className={`tabular ${styles.boardStats}`}>
        <span>
          {DEMO_LIVE.elapsed} <b>{formatRunTime(run.elapsed_ms)}</b>
        </span>
        <span>
          {DEMO_LIVE.cost} <b>{formatRunCost(run)}</b>
        </span>
      </p>

      {/* 1 · the scenes and their questions */}
      <div className={styles.job}>
        <div className={styles.jobText}>
          <h2 className={styles.jobTitle}>{DEMO_LIVE.job2}</h2>
          <p className={`tabular ${styles.jobCount}`}>
            {DEMO_LIVE.scenesAnswered}{' '}
            <b>
              {answered.length} / {scenes.length || '—'}
            </b>
          </p>
          <p className={styles.jobBody}>
            {DEMO_LIVE.job2Body} {perScene !== null && DEMO_LIVE.perScene(perScene)}
          </p>
        </div>
        <div className={styles.jobVisual}>
          {/* A picture, not a control: the scenes are opened from the list under it. */}
          <div className={styles.tiles} aria-hidden="true">
            <span className={styles.tilesBase} />
            {scenes.length === 0 && <p className={styles.boardEmpty}>{DEMO_LIVE.noScenesYet}</p>}
            <div className={styles.tilesInner}>
              {scenes.map((scene) => {
                const raw = tileKind(scene, '5-7');
                const kind = raw === 'asking' && !live ? 'pending' : raw;
                const strength = strengthFor(scene, '5-7');
                return (
                  <span
                    key={scene.id}
                    className={styles.tile}
                    style={{ left: `${pct(scene.start_ms, end)}%`, width: `max(3px, calc(${pct(scene.end_ms - scene.start_ms, end)}% - 2px))` }}
                  >
                    <span
                      className={`${styles.tileBar} ${styles[`tile_${kind}`]} ${kind === 'flagged' ? styles[severityTone(strength)] : ''}`}
                      style={{ height: `${tileHeightPx(kind, strength)}px` }}
                    />
                  </span>
                );
              })}
            </div>
          </div>
          <ul className={styles.tileLegend} aria-hidden="true">
            <li><span className={`${styles.legendMark} ${styles.tile_pending}`} />{DEMO_LIVE.sceneState.pending}</li>
            <li><span className={`${styles.legendMark} ${styles.tile_answered}`} />{DEMO_LIVE.sceneState.answered}</li>
            <li><span className={`${styles.legendMark} ${styles.tile_asking}`} />{DEMO_LIVE.legendAsking}</li>
            <li><span className={`${styles.legendMark} ${styles.legendIncluded}`} />{DEMO_LIVE.legendIncluded}</li>
          </ul>
          <details className={styles.sceneDrawer}>
            <summary className={styles.sceneDrawerSummary}>
              {DEMO_LIVE.viewScenes} <span className="tabular">({answered.length})</span>
            </summary>
            {answered.length === 0 ? (
              <p className={styles.boardEmpty}>{DEMO_LIVE.viewScenesNone}</p>
            ) : (
              <ol className={styles.sceneRows}>
                {answered.map((scene) => {
                  const n = sceneNumber(scenes, scene.id)?.n ?? 0;
                  return (
                    <li key={scene.id}>
                      <button type="button" className={styles.sceneRow} data-scene-row={scene.id} onClick={() => onScene(scene.id)}>
                        <span className="tabular">{DEMO_LIVE.sceneRow(n, formatTime(scene.start_ms))}</span>
                        <span className={styles.sceneRowState}>{sceneWords(scene, live)}</span>
                      </button>
                    </li>
                  );
                })}
              </ol>
            )}
          </details>
        </div>
      </div>

      {/* 2 · the scene changes */}
      <div className={styles.job}>
        <div className={styles.jobText}>
          <h2 className={styles.jobTitle}>{DEMO_LIVE.job1}</h2>
          <p className={styles.jobBody}>
            {DEMO_LIVE.job1Body} {DEMO_LIVE.doubtful(uncertain, splitDone)}
          </p>
        </div>
        <div className={styles.jobVisual}>
          <div className={styles.cutStrip} aria-hidden="true">
            <div className={styles.inner}>
              {scenes.slice(1).map((scene) => {
                const verdict = scene.cut ? cutDoubted(scene.cut) : ruled.get(scene.id);
                const tone = verdict === true ? styles.cutUncertain : verdict === false || splitDone ? styles.cutOk : '';
                return <span key={scene.id} className={`${styles.cut} ${tone}`} style={{ left: `${pct(scene.start_ms, end)}%` }} />;
              })}
            </div>
          </div>
          <p className={styles.cutLegend}>
            <span className={`${styles.legendMark} ${styles.cutUncertainMark}`} aria-hidden="true" /> {DEMO_LIVE.uncertainMark}
          </p>
          {finished && run.result?.split_check && <p className={styles.boardNote}>{DEMO_LIVE.cutKept}</p>}
        </div>
      </div>

      {/* 3 · the descriptions */}
      <div className={styles.job}>
        <div className={styles.jobText}>
          <h2 className={styles.jobTitle}>{DEMO_LIVE.job3}</h2>
          <p className={styles.jobBody}>{DEMO_LIVE.job3Body}</p>
          <p className={`tabular ${styles.jobCount}`}>{growingCount(claims, finished, DEMO_LIVE.sentencesSoFar)}</p>
        </div>
        <div className={styles.jobVisual}>
          <ul className={styles.claims}>
            {claimFeed.length === 0 && <li className={styles.boardEmpty}>{DEMO_LIVE.noClaimsYet}</li>}
            {claimFeed.map((item, i) => {
              const outcome = claimOutcome(item.verdict);
              const fin = finalOutcome(item);
              return (
                <li key={`${item.at_ms}-${i}-${item.text}`} className={styles.claim}>
                  <span className={styles.pills}>
                    <span className={`${styles.pill} ${outcome === 'kept' ? styles.pillKept : outcome === 'left' ? styles.pillDropped : styles.pillUnchecked}`}>
                      {outcome === 'kept' ? DEMO_LIVE.kept : outcome === 'left' ? DEMO_LIVE.droppedWord : DEMO_LIVE.uncheckedWord}
                    </span>
                    {fin && <span className={`${styles.pill} ${styles.pillFinal}`}>{fin === 'kept' ? DEMO_LIVE.finalKept : DEMO_LIVE.finalLeft}</span>}
                  </span>
                  <span>{item.text}</span>
                </li>
              );
            })}
          </ul>
        </div>
      </div>

      <details className={styles.moreDetails}>
        <summary className={styles.moreDetailsSummary}>{DEMO_LIVE.moreDetails}</summary>
        <dl className={styles.detailList}>
          <div>
            <dt>{DEMO_LIVE.answers}</dt>
            <dd className="tabular">{classify.answers > 0 ? formatCount(classify.answers) : '—'}</dd>
          </div>
          <div>
            <dt>{DEMO_LIVE.sentencesChecked}</dt>
            <dd className="tabular">{growingCount(claims, finished, (n) => formatCount(n))}</dd>
          </div>
          <div>
            <dt>{DEMO_LIVE.job1}</dt>
            <dd className="tabular">{growingCount(split, finished, (n) => formatCount(n))}</dd>
          </div>
          <div>
            <dt>{DEMO_LIVE.skipMeter}</dt>
            <dd className="tabular">{growingCount(moments, finished, (n) => formatCount(n))}</dd>
          </div>
        </dl>
        <Meter share={stageShare(moments)} label={DEMO_LIVE.skipMeter} />
      </details>
    </section>
  );
}

/** A plain bar for a stage's done/total — the share the API reported. */
function Meter({ share, label }: { share: number; label: string }) {
  return (
    <div className={styles.meterRow}>
      <span className={styles.meter} role="img" aria-label={label}>
        <span className={styles.meterFill} style={{ width: `${share * 100}%` }} />
      </span>
    </div>
  );
}

// ------------------------------------------------------------------------------------------------
// Finished: the scenes to know about, the check in numbers, and the saved guide
// ------------------------------------------------------------------------------------------------

function BandToggle({ band, onBand }: { band: AgeBand; onBand: (band: AgeBand) => void }) {
  return (
    <div className={styles.bandControl}>
      <span className={styles.bandLabel} id="band-label">
        {DEMO_LIVE.bandGroup}
      </span>
      <div role="group" aria-labelledby="band-label" className={styles.bandGroup}>
        {(['5-7', '8-10'] as const).map((value) => (
          <button
            key={value}
            type="button"
            className={`${styles.bandOption} ${band === value ? styles.bandOn : ''}`}
            aria-pressed={band === value}
            onClick={() => onBand(value)}
          >
            {DEMO_LIVE.band[value]}
          </button>
        ))}
      </div>
    </div>
  );
}

function LevelsNote({ band }: { band: AgeBand }) {
  return (
    <details className={styles.levels}>
      <summary className={styles.levelsSummary}>{FILM.scaleDisclosure}</summary>
      <ul className={styles.levelsList}>
        {STRENGTH_TABLE.map((row) => (
          <li key={row.word}>
            <b>{row.word}</b> {band === '8-10' ? row.band810 : row.band57}
          </li>
        ))}
      </ul>
    </details>
  );
}

function RunDone({
  run,
  film,
  band,
  onBand,
  onScene,
  runAgain,
  ruled,
}: {
  run: DemoRun;
  film: RunFilm;
  band: AgeBand;
  onBand: (band: AgeBand) => void;
  onScene: (id: string) => void;
  runAgain: React.ReactNode;
  ruled: Map<string, boolean>;
}) {
  const flagged = useMemo(() => [...(run.result?.flagged ?? [])].sort((a, b) => a.start_ms - b.start_ms), [run.result]);
  const end = Math.max(filmEndMs(run.scenes), ...flagged.map((f) => f.end_ms), 0);
  const breakdown = flaggedBreakdown(run, band);
  // The run's own answer (as it ended) beats what the page was rendered with.
  const inLibrary = typeof run.result?.in_library === 'boolean' ? run.result.in_library : film.inLibrary;
  const librarySlug = run.film?.library_slug ?? film.librarySlug;
  const same = sameness(run.result?.compare, inLibrary);
  const total = run.scenes.length;
  const final = run.stages.claims.final;
  // One compact line beside the count; what it means, and the ways onward, come after the scenes.
  const comparison = run.result ? <p className={styles.compareLine}>{compareLine(same, flagged.length)}</p> : null;
  const compareNote =
    same.kind === 'same'
      ? DEMO_LIVE.sameMatchNote
      : same.kind === 'differs'
        ? `${DEMO_LIVE.differsBody} ${DEMO_LIVE.sameMatchNote}`
        : same.kind === 'none'
          ? DEMO_LIVE.notInLibraryBody
          : run.result
            ? DEMO_LIVE.sameUnknownBody
            : null;

  return (
    <>
      {/* The check in numbers: small, measured, and said to be Jev's part only. */}
      <p className={`tabular ${styles.doneStats}`}>
        <span>
          {DEMO_LIVE.numTime} <b>{formatRunTime(run.elapsed_ms)}</b>
        </span>
        <span>
          {DEMO_LIVE.numCost} <b>{formatRunCost(run)}</b>
        </span>
        <span className={styles.doneStatsNote}>{DEMO_LIVE.numbersNote}</span>
      </p>

      <section className={styles.sheet} aria-labelledby="done-count">
        {!run.result ? (
          <p className={styles.cardBody}>{DEMO_LIVE.noResultBody}</p>
        ) : flagged.length === 0 ? (
          <div className={styles.doneCount}>
            <h2 id="done-count" className={styles.cardHeading}>
              {DEMO_LIVE.noFlaggedHeadline}
            </h2>
            <p className={styles.cardBody}>{DEMO_LIVE.noFlaggedBody}</p>
            {comparison}
          </div>
        ) : (
          <>
            <div className={styles.doneTop}>
              <div className={styles.doneCount}>
                <h2 id="done-count" className={styles.countLine}>
                  <span className={`tabular ${styles.countNumber}`}>{flagged.length}</span>{' '}
                  <span className={styles.countWords}>
                    {DEMO_LIVE.flaggedWords(flagged.length)}
                    <span className={styles.countOf}> ({DEMO_LIVE.numScenesValue(flagged.length, total)})</span>
                  </span>
                </h2>
                <ul className={styles.breakdown}>
                  {breakdown.map((entry) => (
                    <li key={String(entry.value)} className={styles.breakdownItem}>
                      <span className={`${styles.swatch} ${styles[severityTone(entry.value)]}`} aria-hidden="true" />
                      {entry.count} {strengthWord(entry.value).toLowerCase()}
                    </li>
                  ))}
                </ul>
                {comparison}
              </div>
              <div className={styles.bandBox}>
                <BandToggle band={band} onBand={onBand} />
                {bandsAgree(run) && <p className={styles.cardNote}>{DEMO_LIVE.bandsSame}</p>}
                <LevelsNote band={band} />
              </div>
            </div>

            {/* A picture of where the scenes sit: the list below is how a scene is opened. */}
            <div className={styles.timeline} aria-hidden="true">
              <span className={styles.timelineBase} />
              <div className={styles.timelineInner}>
                {flagged.map((f) => {
                  const strength = flaggedStrength(run, f, band);
                  return (
                    <span key={f.scene_id} className={styles.marker} style={{ left: `${pct(f.start_ms, end)}%` }}>
                      <span className={`${styles.markerBar} ${styles[severityTone(strength)]}`} style={{ height: `${markerHeightPx(strength)}px` }} />
                    </span>
                  );
                })}
              </div>
            </div>
            <div className={`tabular ${styles.timelineTimes}`} aria-hidden="true">
              <span>{formatTime(0)}</span>
              <span>{formatTime(end / 2)}</span>
              <span>{formatTime(end)}</span>
            </div>
            <p className={styles.cardNote}>{DEMO_LIVE.sourcesNote}</p>
          </>
        )}
      </section>

      {flagged.length > 0 && (
        <section className={styles.flagList} aria-labelledby="flag-list-heading">
          <div className={styles.listHead}>
            <h2 id="flag-list-heading" className={styles.sectionHeading}>
              {DEMO_LIVE.listHeading}
            </h2>
            <p className={styles.cardNote}>{DEMO_LIVE.listNote}</p>
          </div>
          <ol className={styles.flagRows}>
            {flagged.map((f) => {
              const strength = flaggedStrength(run, f, band);
              const by = answeredBy(f);
              const { chips, more } = reasonChips(f, 3);
              return (
                <li key={f.scene_id}>
                  <button type="button" className={styles.flagRow} data-scene-row={f.scene_id} onClick={() => onScene(f.scene_id)}>
                    <span className={styles.flagMain}>
                      <span className={styles.flagTitleLine}>
                        <span className={styles.flagTitle}>{flaggedHeading(f)}</span>
                        {/* An untitled scene is already named by its start time. */}
                        {checkedTitle(f) && <span className={`tabular ${styles.flagTime}`}>{formatTime(f.start_ms)}</span>}
                      </span>
                      <span className={styles.flagStrength}>
                        <span className={`${styles.swatch} ${styles[severityTone(strength)]}`} aria-hidden="true" />
                        {strengthWord(strength)} · {DEMO_LIVE.band[band].toLowerCase()}
                      </span>
                      <span className={styles.whyChips}>
                        {chips.map((label) => (
                          <span key={label} className={styles.whyChip}>
                            {label}
                          </span>
                        ))}
                        {more > 0 && <span className={styles.whyMore}>{DEMO_LIVE.moreReasons(more)}</span>}
                      </span>
                    </span>
                    <span className={styles.who}>
                      {by.jev && <span className={`${styles.whoChip} ${styles.whoJev}`}>Jev</span>}
                      {by.sonnet && <span className={`${styles.whoChip} ${styles.whoSonnet}`}>Sonnet</span>}
                    </span>
                    <span className={styles.chevron} aria-hidden="true">
                      ›
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>
        </section>
      )}

      {/* After the scenes: what the comparison means, then the ways onward. */}
      <section className={styles.onward} aria-label={DEMO_LIVE.onwardLabel}>
        {compareNote && <p className={styles.cardNote}>{compareNote}</p>}
        <div className={styles.compareActions}>
          {librarySlug && inLibrary !== false && (
            <Link href={`/film/${librarySlug}`} className="button">
              {DEMO_LIVE.openGuide}
              <ArrowRight />
            </Link>
          )}
          {same.kind === 'unknown' && run.result && (
            // A fresh server render: the page asks the API for the film again.
            <button type="button" className={styles.quietButton} onClick={() => window.location.reload()}>
              {DEMO_LIVE.sameUnknownRetry}
            </button>
          )}
          {runAgain}
          <Link href="/watch" className={styles.quietLink}>
            {DEMO_LIVE.another}
          </Link>
        </div>
      </section>

      <details className={styles.howItWent}>
        <summary className={styles.howItWentSummary}>{DEMO_LIVE.howItWent}</summary>
        {final && (
          <div className={styles.card}>
            <h3 className={styles.cardHeading}>{DEMO_LIVE.checksHeading}</h3>
            <p className={styles.cardBody}>{DEMO_LIVE.checksSummary(final.summary.kept, final.summary.checked)}</p>
            <p className={styles.cardBody}>{DEMO_LIVE.checksDescriptions(final.descriptions.with_text, final.descriptions.scenes)}</p>
            <p className={styles.cardNote}>{DEMO_LIVE.checksNote}</p>
          </div>
        )}
        <Board run={run} ruled={ruled} onScene={onScene} />
      </details>
    </>
  );
}

// ------------------------------------------------------------------------------------------------
// One scene up close: why it is included, what happens, where to skip
// ------------------------------------------------------------------------------------------------

function ScoreBar({ p, act }: { p: number | null; act: number | null | undefined }) {
  return (
    <span className={styles.answerBar} aria-hidden="true">
      <span className={styles.answerFill} style={{ width: `${Math.round((p ?? 0) * 100)}%` }} />
      {act !== null && act !== undefined && <span className={styles.answerLine} style={{ left: `${Math.round(act * 100)}%` }} />}
    </span>
  );
}

function ReasonItem({ tag, index, asked }: { tag: WhyTag; index: number; asked: number | null }) {
  const jev = tag.by.includes('jev');
  const sonnet = tag.by.includes('sonnet');
  const answers: WhyAnswer[] = tag.answers?.length ? tag.answers : tag.question ? [{ question: tag.question, p: tag.p, decides: true }] : [];
  const combined = answers.length > 1;
  const how = tag.how === 'all' ? DEMO_LIVE.combinedAll : tag.how === 'gate' ? DEMO_LIVE.combinedGate : DEMO_LIVE.combinedAny;
  return (
    <li className={styles.reason}>
      {/* The film's own words for the reason ("The Iron Giant in danger"); its general category is
          for the filters and the checking details, not repeated here. */}
      <p className={styles.reasonLabel}>
        <span>{tag.label}</span>
        <span className={styles.who}>
          {jev && <span className={`${styles.whoChip} ${styles.whoJev}`}>Jev</span>}
          {sonnet && <span className={`${styles.whoChip} ${styles.whoSonnet}`}>Sonnet</span>}
        </span>
      </p>
      <details className={styles.reasonHow}>
        <summary className={styles.reasonHowSummary} id={`how-${index}`}>
          {DEMO_LIVE.howChecked}
        </summary>
        {jev && asked ? <p className={styles.reasonLineNote}>{DEMO_LIVE.questionCount(asked, answers.length)}</p> : null}
        {tag.category && (
          <p className={styles.reasonRule}>
            <span className={styles.reasonKey}>{DEMO_LIVE.categoryKey}</span>
            {tag.category}
          </p>
        )}
        {sonnet && !jev ? (
          <>
            {tag.question && (
              <p className={styles.reasonQuestion}>
                <span className={styles.reasonKey}>{DEMO_LIVE.asked}</span>
                <q>{tag.question}</q>
              </p>
            )}
            <p className={styles.reasonAnswerText}>
              <span className={styles.reasonKey}>{DEMO_LIVE.sonnetAnswered}</span>
              {DEMO_LIVE.sonnetYes}
            </p>
          </>
        ) : answers.length === 0 ? (
          <p className={styles.reasonAnswerText}>
            <span className={styles.reasonKey}>{DEMO_LIVE.jevAnswered}</span>
            {DEMO_LIVE.notChecked}
          </p>
        ) : (
          <>
            {combined && <p className={styles.reasonLineNote}>{how}</p>}
            <ul className={styles.answerList}>
              {answers.map((a, i) => (
                <li key={`${i}-${a.question}`} className={`${styles.answerItem} ${a.decides ? styles.answerDecides : ''}`}>
                  <q className={styles.answerQuestion}>{a.question}</q>
                  <span className={styles.reasonAnswer}>
                    <span className={styles.reasonKey}>{DEMO_LIVE.answerScore}</span>
                    <ScoreBar p={a.p} act={a.role === 'condition' ? a.at : tag.act} />
                    <span className={`tabular ${styles.answerP}`}>{a.p === null ? DEMO_LIVE.notChecked : formatAnswer(a.p)}</span>
                    {combined && a.decides && <span className={styles.decidedTag}>{DEMO_LIVE.decided}</span>}
                    {a.role === 'condition' && <span className={styles.reasonLineNote}>{DEMO_LIVE.condition}</span>}
                  </span>
                </li>
              ))}
            </ul>
            {tag.act !== null && tag.act !== undefined && <p className={styles.reasonLineNote}>{DEMO_LIVE.cutoff(formatAnswer(tag.act))}</p>}
          </>
        )}
        <p className={styles.reasonRule}>
          <span className={styles.reasonKey}>{DEMO_LIVE.theRule}</span>
          {ruleSentence(tag.rule, tag.with)}
        </p>
      </details>
    </li>
  );
}

function SceneUpClose({
  run,
  title,
  sceneId,
  band,
  onBand,
  onBack,
  headingRef,
  notice,
}: {
  run: DemoRun;
  title: string;
  sceneId: string;
  band: AgeBand;
  onBand: (band: AgeBand) => void;
  onBack: () => void;
  headingRef: React.RefObject<HTMLHeadingElement | null>;
  notice: React.ReactNode;
}) {
  const scene = run.scenes.find((s) => s.id === sceneId) ?? null;
  const number = sceneNumber(run.scenes, sceneId);
  const flagged = flaggedFor(run, sceneId);
  const live = isRunLive(run.status);
  // Kept in view while the parent reads: the way back to where they were.
  const back = (
    <div className={styles.backBar}>
      <button type="button" className={styles.backLink} onClick={onBack}>
        ← {live ? DEMO_LIVE.backToLive : DEMO_LIVE.backToList}
      </button>
    </div>
  );

  if (!scene || !number) {
    return (
      <>
        {back}
        <h1 className={styles.runHeadline} ref={headingRef} tabIndex={-1}>
          {DEMO_LIVE.missingScene}
        </h1>
      </>
    );
  }

  const start = flagged?.start_ms ?? scene.start_ms;
  const end = flagged?.end_ms ?? scene.end_ms;
  const strength = flagged ? flaggedStrength(run, flagged, band) : strengthFor(scene, band);
  const tags = flagged ? whyTags(flagged) : [];
  const heading = flagged ? flaggedHeading(flagged) : spanLabel(start, end);
  const status =
    scene.state !== 'answered'
      ? DEMO_LIVE.notAnswered
      : (scene.flagged === null || scene.flagged === undefined) && !flagged
        ? live
          ? DEMO_LIVE.waitAnswered
          : DEMO_LIVE.stoppedBeforeRules
        : !scene.flagged && !flagged
          ? DEMO_LIVE.notFlagged
          : !flagged
            ? DEMO_LIVE.waitForRules
            : null;

  return (
    <>
      {back}
      {notice}
      <section className={styles.runHead}>
        <div className={styles.runHeadText}>
          <p className="eyebrow">
            {DEMO_LIVE.sceneEyebrow(title, number.n, number.of)} · <span className="tabular">{spanLabel(start, end)}</span>
          </p>
          <h1 className={styles.runHeadline} ref={headingRef} tabIndex={-1}>
            {heading}
          </h1>
        </div>
        {(flagged || scene.flagged) && (
          <div className={styles.sceneStrength}>
            <span className={styles.strengthBadge}>
              <span className={`${styles.swatch} ${styles[severityTone(strength)]}`} aria-hidden="true" />
              {DEMO_LIVE.strengthFor(strengthWord(strength), DEMO_LIVE.band[band])}
            </span>
            <BandToggle band={band} onBand={onBand} />
          </div>
        )}
      </section>

      {status && (
        <div className={styles.card}>
          <p className={styles.cardBody}>{status}</p>
        </div>
      )}

      {flagged && (
        // Where to skip first — it is what a parent came for — then what happens, then why it is listed.
        // On a wide screen the reasons sit in the second column, after the skip times in reading order.
        <section className={styles.sceneGrid}>
          <div className={styles.sceneColumn}>
            <div className={styles.card}>
              <h2 className={styles.cardHeading}>{DEMO_LIVE.skipTitle}</h2>
              <p className={`tabular ${styles.readyLine}`}>{FILM.readyLine(formatTime(readyAtMs(start)), formatTime(endsAroundMs(end)))}</p>
              <p className={styles.cardNote}>{DEMO_LIVE.skipNote}</p>
            </div>
            <div className={styles.card}>
              <h2 className={styles.cardHeading}>{DEMO_LIVE.whatTitle}</h2>
              {flagged.description ? (
                <>
                  <p className={styles.cardBody}>{flagged.description}</p>
                  <p className={styles.cardNote}>{DEMO_LIVE.whatNote}</p>
                </>
              ) : (
                <p className={styles.cardNote}>{DEMO_LIVE.noWords}</p>
              )}
            </div>
          </div>
          <div className={`${styles.card} ${styles.whyCard}`}>
            <h2 className={styles.cardHeading}>{DEMO_LIVE.whyTitle}</h2>
            <p className={styles.cardNote}>{DEMO_LIVE.whyLead}</p>
            <ol className={styles.reasons}>
              {tags.map((t, i) => (
                <ReasonItem key={`${t.label}-${i}`} tag={t} index={i} asked={scene.questions ?? null} />
              ))}
            </ol>
            <p className={styles.cardNote}>{DEMO_LIVE.scoreNote}</p>
            <p className={styles.cardNote}>{DEMO_LIVE.whyNote}</p>
          </div>
        </section>
      )}
    </>
  );
}
