'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  beatLeftPct,
  filmLengthMs,
  finishedState,
  formatCents,
  formatProbability,
  formatSeconds,
  formatTokens,
  labelOf,
  replayStateAt,
  scoreRows,
  triggersFlag,
  windowOf,
  type ReplayBeat,
  type ReplayPayload,
} from '@/lib/replay';
import { engineLine, finishLine, WATCH } from '@/lib/copy';
import { formatTime } from '@/lib/scenes';
import styles from './RunReplay.module.css';

type Props = {
  payload: ReplayPayload;
  /** The scene list, rendered on the server. Held back until the run finishes; see below. */
  children?: ReactNode;
};

/**
 * A recorded Jev run, replayed at the speed it happened.
 *
 * Three rules hold this component together, and all three are about not lying:
 *
 * 1. **The clock is read, never stepped.** Every frame asks `performance.now()` how far in we are
 *    and `replayStateAt` what had landed by then. There is no interval, no easing and no speed
 *    control, because the one claim this page makes is that the run was this fast. A dropped frame
 *    or a backgrounded tab costs a frame, not a number.
 * 2. **The finished run is the initial state.** The server renders this component with the replay
 *    already over, so the page's summary, its counters and the scene list under it are in the HTML
 *    with no JavaScript at all. The animation starts in an effect: it is the enhancement, and the
 *    facts are not waiting on it. This is also why `prefers-reduced-motion` needs no special path —
 *    it simply never starts.
 * 3. **Nothing is shown that has not landed.** Counters sum the requests whose response is in;
 *    beats light up when the request carrying them arrives, which is not film order and is not
 *    tidied into it.
 */
export function RunReplay({ payload, children }: Props) {
  const { meta } = payload;
  const done = useMemo(() => finishedState(payload), [payload]);

  const [tMs, setTMs] = useState(meta.wallMs);
  const [playing, setPlaying] = useState(false);
  /** Which run this is. Bumped by `play`, so pressing Replay mid-run starts a new one; see below. */
  const [runId, setRunId] = useState(0);
  const [picked, setPicked] = useState<string | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const stripRef = useRef<HTMLDivElement>(null);

  // When each beat becomes known, and the flagged ones in the order they arrive — which is the
  // order the board lights up in, not film order.
  const { resolveMs, flaggedByArrival } = useMemo(() => {
    const received = new Map(payload.requests.map((r) => [r.id, r.receivedMs]));
    const resolve = new Map(payload.beats.map((b) => [b.id, received.get(b.requestId) ?? 0]));
    const arrival = payload.beats
      .filter((b) => b.flagged)
      .sort((a, b) => (resolve.get(a.id) ?? 0) - (resolve.get(b.id) ?? 0));
    return { resolveMs: resolve, flaggedByArrival: arrival };
  }, [payload]);

  const filmMs = useMemo(() => filmLengthMs(payload), [payload]);
  const state = useMemo(() => replayStateAt(payload, tMs), [payload, tMs]);

  const play = useCallback(() => {
    setPicked(null);
    setHovered(null);
    setTMs(0);
    setPlaying(true);
    // `playing` is already true when Replay is pressed during a run, and a state set to the value
    // it already holds changes nothing — the frame loop below would keep its old origin and the
    // press would do nothing at all. The counter is what actually says "again".
    setRunId((n) => n + 1);
  }, []);

  // Start once, on the client, and only where motion is welcome. A reader who has asked for less
  // of it keeps the finished state the server already sent.
  useEffect(() => {
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    play();
  }, [play]);

  useEffect(() => {
    if (!playing) return;
    // The origin is captured once, so every frame measures from the same instant. Re-deriving it
    // per frame is how a replay silently slows down under load.
    const origin = performance.now();
    let frame = 0;
    const tick = () => {
      const elapsed = performance.now() - origin;
      if (elapsed >= meta.wallMs) {
        setTMs(meta.wallMs);
        setPlaying(false);
        return;
      }
      setTMs(elapsed);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing, runId, meta.wallMs]);

  // Which beat the detail panel is about. Hovering wins over a click, a click wins over the
  // automatic follow, and the follow is the newest flagged beat to have landed — so the panel is
  // never empty once the first flag is in, including on the server's finished render, where it
  // shows the last flagged beat of the film rather than an invitation to press something.
  const following = useMemo(() => {
    if (picked) return null;
    let last: ReplayBeat | null = null;
    for (const beat of flaggedByArrival) {
      if ((resolveMs.get(beat.id) ?? 0) > state.tMs) break;
      last = beat;
    }
    return last?.id ?? null;
  }, [picked, playing, flaggedByArrival, resolveMs, state.tMs]);

  const shownId = hovered ?? picked ?? following;
  const shown = useMemo(
    () => (shownId ? (payload.beats.find((b) => b.id === shownId) ?? null) : null),
    [payload.beats, shownId],
  );
  const shownKnown = shown ? state.landed.has(shown.requestId) : false;

  // Roving tab stop: one square is reachable by Tab and the arrow keys move between the lit ones,
  // rather than putting a hundred-odd buttons in the page's tab order.
  //
  // "Lit" is the operative word, and it used to be a lie: the list was every beat the run *would*
  // flag, so at t=0 a keyboard reader could Tab into 106 enabled buttons and ArrowRight onto a beat
  // whose request had not come back — which blanked the detail panel and told them, in the middle
  // of a replay whose whole claim is that nothing is shown before it landed, something the run did
  // not know yet. It is derived from `state.landed` instead, so the board a keyboard walks and the
  // board an eye watches fill in are the same board.
  const flaggedIds = useMemo(
    () => payload.beats.filter((b) => b.flagged && state.landed.has(b.requestId)).map((b) => b.id),
    [payload.beats, state.landed],
  );
  const tabStop = picked && flaggedIds.includes(picked) ? picked : flaggedIds[0];

  const moveFocus = (from: string, delta: number) => {
    const at = flaggedIds.indexOf(from);
    const next = flaggedIds[Math.min(flaggedIds.length - 1, Math.max(0, at + delta))];
    if (!next) return;
    setPicked(next);
    stripRef.current?.querySelector<HTMLButtonElement>(`[data-beat="${next}"]`)?.focus();
  };

  const sent = payload.requests.filter((r) => r.sentMs <= state.tMs);

  return (
    <section className={styles.run} aria-label="The recorded run">
      <div className={styles.runHead}>
        <div className={styles.runHeadText}>
          <h2 className={styles.runHeadline}>
            {state.finished ? WATCH.finishedHeadline : WATCH.runningHeadline}
          </h2>
          <p className={styles.engines}>{engineLine(meta)}</p>
        </div>
        <button type="button" className={`button ${styles.replay}`} onClick={play}>
          {playing ? WATCH.replaying : WATCH.replay}
        </button>
      </div>

      <dl className={styles.counters}>
        <Counter label={WATCH.elapsed} value={formatSeconds(state.tMs)} />
        <Counter label={WATCH.inFlight} value={String(state.inFlight)} />
        <Counter label={WATCH.done} value={`${state.requestsDone}/${meta.requests}`} />
        <Counter label={WATCH.beatsKnown} value={`${state.beatsKnown}/${meta.beats}`} />
        <Counter label={WATCH.beatsFlagged} value={String(state.beatsFlagged)} />
        <Counter label={WATCH.tokensIn} value={formatTokens(state.inputTokens)} />
        <Counter label={WATCH.tokensOut} value={formatTokens(state.outputTokens)} />
        <Counter label={WATCH.cost} value={formatCents(state.costUsd)} highlight />
      </dl>

      <div className={styles.board}>
        <div className={styles.strip}>
          <h3 className={styles.panelHeading}>{WATCH.beatStripHeading}</h3>
          <p className={styles.panelNote}>{WATCH.beatStripNote}</p>
          <div
            className={styles.squares}
            ref={stripRef}
            role="group"
            aria-label="Beats in film order"
            onMouseLeave={() => setHovered(null)}
          >
            {payload.beats.map((beat) => {
              const known = state.landed.has(beat.requestId);
              const classes = [
                styles.square,
                known ? styles.squareKnown : '',
                known && beat.flagged ? styles.squareFlagged : '',
                shownId === beat.id ? styles.squareShown : '',
              ].join(' ');
              if (!beat.flagged) {
                return <span key={beat.id} className={classes} aria-hidden="true" />;
              }
              // A flagged beat whose request has not landed is still a square — the board must not
              // reflow as answers arrive — but it is not a control yet. `disabled` takes it out of
              // the tab order, out of the accessibility tree's pressable things, and out of reach
              // of a click, all with one attribute and no aria to keep in step.
              return (
                <button
                  key={beat.id}
                  type="button"
                  data-beat={beat.id}
                  className={classes}
                  disabled={!known}
                  tabIndex={beat.id === tabStop ? 0 : -1}
                  aria-pressed={picked === beat.id}
                  aria-label={`Beat ${beat.id} at ${formatTime(beat.startMs)}`}
                  onMouseEnter={() => setHovered(beat.id)}
                  onFocus={() => setPicked(beat.id)}
                  onClick={() => setPicked(beat.id)}
                  onKeyDown={(event) => {
                    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
                      event.preventDefault();
                      moveFocus(beat.id, 1);
                    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
                      event.preventDefault();
                      moveFocus(beat.id, -1);
                    }
                  }}
                />
              );
            })}
          </div>
        </div>

        <div className={styles.detail}>
          {shown && shownKnown ? (
            <BeatDetail beat={shown} filmMs={filmMs} threshold={meta.flagThreshold} />
          ) : (
            <p className={styles.detailPrompt}>{WATCH.beatPrompt}</p>
          )}
        </div>
      </div>

      <div className={styles.log}>
        <h3 className={styles.panelHeading}>{WATCH.requestLogHeading}</h3>
        <p className={styles.panelNote}>{WATCH.requestLogNote}</p>
        <ol className={styles.logList}>
          {/* Newest first: the live edge of the run is the part worth watching, and it should not
              move down the page as the log grows. */}
          {sent
            .slice()
            .reverse()
            .map((request) => {
              const landed = state.landed.has(request.id);
              return (
                <li
                  key={request.id}
                  className={`${styles.logRow} ${landed ? styles.logRowDone : styles.logRowOpen}`}
                >
                  <span className={`tabular ${styles.logId}`}>{request.id}</span>
                  <span className={styles.logWhat}>
                    {request.windowId ?? 'sound captions'}
                    {request.parts > 1 && ` · part ${request.part + 1} of ${request.parts}`}
                  </span>
                  <span className={`tabular ${styles.logQuestions}`}>{request.questions} q</span>
                  <span className={`tabular ${styles.logTime}`}>
                    {landed
                      ? `${formatSeconds(request.receivedMs - request.sentMs)}${request.retries ? ` · ${request.retries} retries` : ''}`
                      : '…'}
                  </span>
                </li>
              );
            })}
        </ol>
      </div>

      {/* The scene list is in the server's HTML and stays there; while the run is playing it is
          hidden, because Sonnet has not been given the answers yet at that point in the story.
          `hidden` rather than unmounting, so a reader without JavaScript never loses it. */}
      <div hidden={!state.finished}>
        <p className={`tabular ${styles.finish}`}>
          {finishLine(
            formatSeconds(meta.wallMs),
            meta.requests,
            meta.beats,
            formatCents(meta.costUsd),
          )}
        </p>
        {children}
      </div>
    </section>
  );
}

function Counter({ label, value, highlight = false }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className={`${styles.counter} ${highlight ? styles.counterLoud : ''}`}>
      <dt className={styles.counterLabel}>{label}</dt>
      <dd className={`tabular ${styles.counterValue}`}>{value}</dd>
    </div>
  );
}

/**
 * One beat, opened up: where it sits in the film, the handful of answers Jev was surest about, the
 * four scores, and the lines it read. A bar is marked when it is one of the answers that could have
 * flagged the beat — at or above the threshold, and on a channel the flag rule reads — so the rule
 * that decided the beat is visible rather than asserted. See `triggersFlag`.
 */
function BeatDetail({
  beat,
  filmMs,
  threshold,
}: {
  beat: ReplayBeat;
  filmMs: number;
  threshold: number;
}) {
  return (
    <div className={styles.beat}>
      <p className={styles.beatWhere}>
        <span className={`tabular ${styles.beatTime}`}>
          {formatTime(beat.startMs)}–{formatTime(beat.endMs)}
        </span>
        <span className={styles.beatId}>
          {windowOf(beat.id)} · beat {beat.id} · {beat.nCues} lines ·{' '}
          {Math.round(beatLeftPct(beat.startMs, filmMs))}% in
        </span>
      </p>

      <h4 className={styles.beatHeading}>{WATCH.beatAnswersHeading}</h4>
      <ul className={styles.bars}>
        {beat.top.map((answer) => (
          <li key={`${answer.channel}:${answer.id}`} className={styles.bar}>
            <span className={styles.barLabel}>{labelOf(answer)}</span>
            <span className={styles.barTrack}>
              <span
                className={`${styles.barFill} ${triggersFlag(answer, threshold) ? styles.barFillHot : ''}`}
                style={{ width: `${Math.round(answer.p * 100)}%` }}
              />
            </span>
            <span className={`tabular ${styles.barValue}`}>{formatProbability(answer.p)}</span>
          </li>
        ))}
      </ul>

      <h4 className={styles.beatHeading}>{WATCH.beatScoresHeading}</h4>
      <ul className={styles.scores}>
        {scoreRows(beat).map((row) => (
          <li key={row.id} className={styles.score}>
            <span className={styles.scoreLabel}>{row.label}</span>
            <span className={`tabular ${styles.scoreValue}`}>
              {row.score.toFixed(2)}
              <span className={styles.scoreConfidence}>
                {' '}
                · {formatProbability(row.confidence)} {WATCH.confidence}
              </span>
            </span>
          </li>
        ))}
      </ul>

      {beat.lines.length > 0 && (
        <>
          <h4 className={styles.beatHeading}>{WATCH.beatLinesHeading}</h4>
          <ul className={styles.lines}>
            {beat.lines.map((line) => (
              <li key={line.line} className={styles.line}>
                “{line.line}”
                {line.words.length > 0 && (
                  <span className={styles.lineWhy}> — {line.words.join(', ')}</span>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
