'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { Poster } from './Poster';
import { StateCard } from './StateCard';
import { ArrowRight } from './Art';
import { usePolledJob } from './useJob';
import { ADD, SEARCH } from '@/lib/copy';
import {
  addPhase,
  addRefusal,
  failureSentence,
  namesOneFilm,
  parentSteps,
  stepDurationMs,
  type AddStatus,
  type Candidate,
  type Job,
  type Refusal,
} from '@/lib/job';
import styles from './AddMovie.module.css';

/** The job a just-accepted run starts from, until the first poll brings the real one. */
export function pendingJob(id: string, candidate: Candidate): Job {
  return {
    id,
    kind: 'add',
    status: 'queued',
    step: null,
    steps: [],
    film: {
      title: candidate.title,
      year: candidate.year,
      slug: null,
      poster_url: candidate.poster_url,
      imdb_id: candidate.imdb_id,
    },
    cost_usd: null,
    error_code: null,
    error: null,
    recording_ready: false,
    scene_count: null,
    elapsed_ms: null,
    created_at: '',
    updated_at: '',
  };
}

// ------------------------------------------------------------------------------------------------
// 1 · The miss becomes the ask
// ------------------------------------------------------------------------------------------------

type AskProps = {
  /** What the parent typed into the library's search. The title field follows it until edited. */
  query: string;
  /** `undefined` while the status is being read; `null` when it could not be read. */
  status: AddStatus | null | undefined;
  onStarted: (job: Job) => void;
  /** "Check again", after a status read that failed. */
  onRetryStatus?: () => void;
};

type Phase = 'idle' | 'finding' | 'choosing' | 'starting';

/**
 * "Not in the library. Yet." — the passcoded ask, prefilled with the title the parent searched for.
 *
 * The passcode lives in this component's state and nowhere else — not localStorage, not the URL,
 * not a cookie. It goes out in the POST body of the two requests that need it, to this app's own
 * /api/add/* handlers (the CSP allows the browser to talk to this origin only).
 *
 * Every refusal the API can return has one plain sentence (`addRefusal`) and, where one exists, a
 * way onward: "already in the library" points at the film, "already running" at the live run.
 */
export function AddAsk({ query, status, onStarted, onRetryStatus }: AskProps) {
  const [title, setTitle] = useState(query.trim());
  const [edited, setEdited] = useState(false);
  const [passcode, setPasscode] = useState('');
  const [phase, setPhase] = useState<Phase>('idle');
  const [candidates, setCandidates] = useState<Candidate[] | null>(null);
  const [refusal, setRefusal] = useState<Refusal | null>(null);

  // Until the parent types into this field, it is the search field's echo.
  useEffect(() => {
    if (!edited) setTitle(query.trim());
  }, [query, edited]);

  // "Which one?" answers the title it was asked about — and so does a lookup still on its way back.
  // Once the title changes, both are about a film the parent may no longer mean: the matches go,
  // and a pending lookup is marked stale so its answer is dropped when it lands (an IMDb link would
  // otherwise start the old film by itself). `generation` is that mark; unmounting bumps it too.
  const askedFor = useRef<string | null>(null);
  const generation = useRef(0);
  useEffect(() => {
    if (askedFor.current !== null && title.trim() !== askedFor.current) {
      askedFor.current = null;
      generation.current += 1;
      setCandidates(null);
      setPhase((was) => (was === 'choosing' || was === 'finding' ? 'idle' : was));
    }
  }, [title]);
  useEffect(
    () => () => {
      generation.current += 1;
    },
    [],
  );

  const post = async (path: string, payload: unknown) => {
    const response = await fetch(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    return { ok: response.ok || response.status === 202, status: response.status, body };
  };

  const choose = async (candidate: Candidate) => {
    setRefusal(null);
    setPhase('starting');
    try {
      // Only the identity goes up: the API looks the film up again itself, so a caller can never
      // name, title or illustrate a film — the tmdb_id is a hint for picking among TMDB's matches.
      const { status: code, body } = await post('/api/add/jobs', {
        imdb_id: candidate.imdb_id,
        tmdb_id: candidate.tmdb_id,
        passcode,
      });
      if (code === 202 && typeof body.id === 'string') {
        onStarted(pendingJob(body.id, candidate));
        return;
      }
      setRefusal(addRefusal(code, body));
      setPhase(candidates ? 'choosing' : 'idle');
    } catch {
      setRefusal({ text: ADD.unreachable });
      setPhase(candidates ? 'choosing' : 'idle');
    }
  };

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (phase === 'finding' || phase === 'starting') return;
    setRefusal(null);
    setCandidates(null);
    setPhase('finding');
    const asked = title.trim();
    askedFor.current = asked;
    const mine = ++generation.current;
    try {
      const { ok, status: code, body } = await post('/api/add/resolve', { query: asked, passcode });
      // The title changed (or the card went away) while this was out: it answers a question
      // nobody is asking any more.
      if (mine !== generation.current) return;
      if (!ok) {
        setRefusal(addRefusal(code, body));
        setPhase('idle');
        return;
      }
      const found = (Array.isArray(body.candidates) ? (body.candidates as Candidate[]) : []).slice(0, 3);
      // A run costs money and holds the only slot, so it starts on the parent's say-so. A title is
      // a search, and one fuzzy match from it is still a guess: show it and let them press "Check
      // this one". Only an IMDb link or id names exactly one film, so only that starts straight away.
      if (found.length === 1 && !found[0].exists && found[0].imdb_id && namesOneFilm(asked)) {
        await choose(found[0]);
        return;
      }
      setCandidates(found);
      setPhase('choosing');
    } catch {
      if (mine !== generation.current) return;
      setRefusal({ text: ADD.unreachable });
      setPhase('idle');
    }
  };

  // Three states, not two. "No passcode is configured" is something the API told us; a status read
  // that failed told us nothing at all. Same missing form either way, different sentence under it.
  if (status === null || (status && !status.passcode_configured)) {
    const unknown = status === null;
    return (
      <StateCard as="h2" headline={SEARCH.noMatchHeadline} body={SEARCH.noMatchBody} className={styles.state}>
        <p className={styles.stateNote}>
          <b>{unknown ? ADD.unknownHeadline : ADD.offHeadline}.</b> {unknown ? ADD.unknownBody : ADD.offBody}
        </p>
        {/* A failed read is not an answer, so it can be asked again. "Switched off" is an answer. */}
        {unknown && onRetryStatus && (
          <button type="button" className="button buttonQuiet" onClick={onRetryStatus}>
            {ADD.unknownRetry}
          </button>
        )}
      </StateCard>
    );
  }

  // Still asking whether adding is open: no form yet, because if the answer is "no" a form the
  // parent had started filling would vanish from under them.
  if (status === undefined) {
    return (
      <section className={`sticker ${styles.card}`} aria-labelledby="add-heading" aria-busy="true">
        <h2 id="add-heading" className={styles.headline}>
          {ADD.askHeadline}
        </h2>
        <p className={styles.body}>{ADD.askBody}</p>
        <p className={styles.checking} role="status">
          {ADD.checkingAdd}
        </p>
      </section>
    );
  }

  const busy = phase === 'finding' || phase === 'starting';

  return (
    <section className={`sticker ${styles.card}`} aria-labelledby="add-heading">
      <h2 id="add-heading" className={styles.headline}>
        {ADD.askHeadline}
      </h2>
      <p className={styles.body}>{ADD.askBody}</p>

      {/* The inputs have no `name`, on purpose. Submitted before the page's JavaScript has loaded,
          this form falls back to the browser's own submit — and a named passcode would then ride
          in the address bar, the history and the Referer. Unnamed, the fallback sends nothing. */}
      <form className={styles.form} onSubmit={onSubmit}>
        <label className={styles.field}>
          <span className="eyebrow">{ADD.filmLabel}</span>
          <input
            className={styles.input}
            type="text"
            value={title}
            onChange={(event) => {
              setEdited(true);
              setTitle(event.target.value);
            }}
            autoComplete="off"
            required
          />
        </label>
        <label className={styles.field}>
          <span className="eyebrow">{ADD.passcodeLabel}</span>
          <input
            className={`${styles.input} ${styles.passcode}`}
            type="password"
            value={passcode}
            onChange={(event) => setPasscode(event.target.value)}
            autoComplete="off"
            required
          />
          <span className={styles.help}>{ADD.passcodeHelp}</span>
        </label>
        <div className={styles.submitRow}>
          {/* Never a bare spinner: the button says which of the two waits this is. */}
          <button type="submit" className={`button ${styles.submit}`} disabled={busy}>
            {phase === 'finding' ? ADD.finding : phase === 'starting' ? ADD.starting : namesOneFilm(title) ? ADD.submitExact : ADD.submit}
            {!busy && <ArrowRight />}
          </button>
        </div>
      </form>

      {/* Assertive, not polite: a refusal is the answer to the button the parent just pressed. */}
      {refusal && (
        <p className={styles.refusal} role="alert">
          {refusal.text}{' '}
          {refusal.link && (
            <Link href={refusal.link.href} className={styles.refusalLink}>
              {refusal.link.label}
            </Link>
          )}
        </p>
      )}

      {candidates && candidates.length === 0 && (
        <p className={styles.refusal} role="status">
          {ADD.noCandidates}
        </p>
      )}

      {candidates && candidates.length > 0 && (
        <div className={styles.candidates}>
          <h3 className={`eyebrow ${styles.candidatesHeading}`}>{ADD.candidatesHeading}</h3>
          <ul className={styles.candidateList}>
            {candidates.map((candidate) => (
              <li key={candidate.tmdb_id} className={styles.candidate}>
                <Poster
                  url={candidate.poster_url}
                  title={candidate.title}
                  width={48}
                  height={68}
                  placeholder={''}
                  className={styles.candidatePoster}
                />
                <div className={styles.candidateText}>
                  <p className={styles.candidateTitle}>
                    {candidate.title}
                    {candidate.year && <span className={styles.candidateYear}>{candidate.year}</span>}
                  </p>
                  {candidate.overview && (
                    <p className={styles.candidateOverview}>{firstSentence(candidate.overview)}</p>
                  )}
                </div>
                {candidate.exists && candidate.slug ? (
                  <Link href={`/film/${candidate.slug}`} className={styles.candidateExisting}>
                    {ADD.openExisting}
                  </Link>
                ) : !candidate.imdb_id ? (
                  // Subtitles are found by IMDb id, so without one the run could only be refused —
                  // and the refusal would read as the parent's mistake. Say so here instead.
                  <p className={styles.candidateNote}>{ADD.noImdb}</p>
                ) : (
                  <button
                    type="button"
                    className={`button buttonQuiet ${styles.candidateAction}`}
                    onClick={() => choose(candidate)}
                    disabled={busy}
                  >
                    {phase === 'starting' ? ADD.starting : ADD.choose}
                    <ArrowRight />
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {status?.running && (
        <p className={styles.runningNow}>
          {ADD.runningNow} —{' '}
          <Link href={`/library?job=${status.running.id}`} className={styles.refusalLink}>
            {ADD.runningLink}
          </Link>
        </p>
      )}
    </section>
  );
}

/** "14:03:12" in the parent's own clock: when the last answer arrived. */
function clockTime(ms: number): string {
  return new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

/** The first sentence of a synopsis, or the whole thing when it is one. */
function firstSentence(text: string): string {
  const end = text.search(/[.!?](\s|$)/);
  return end === -1 ? text : text.slice(0, end + 1);
}

// ------------------------------------------------------------------------------------------------
// 2 · Watch it being read — live
// ------------------------------------------------------------------------------------------------

type LiveProps = {
  initialJob: Job;
  /** The run finished and the film is in the library. */
  onDone: (film: { slug: string; title: string; rebuilt?: boolean }) => void;
  /** "Try another movie", after a run that did not finish. */
  onReset: () => void;
  /** "Browse the library meanwhile": clear the search and go to the list, keeping this card. */
  onBrowse: () => void;
  /** The parent just pressed the button that started this run: move focus to the card. */
  focusOnMount?: boolean;
};

/**
 * One add run, as the parent sees it: what the run is, the steps it is taking, how long it has been
 * going.
 *
 * Everything here is the real job, polled (`usePolledJob`): each step's label, state and detail are
 * the API's own, and the elapsed time is the API's measurement on the last poll, not a clock of this
 * page's. Before the first poll brings the steps there is no list, only "Waiting to start" — nothing
 * is drawn that the run has not reported.
 */
export function AddLive({ initialJob, onDone, onReset, onBrowse, focusOnMount = false }: LiveProps) {
  const { job, health, retry } = usePolledJob(initialJob);
  const headingRef = useRef<HTMLHeadingElement>(null);
  // The ask the parent was typing into has just been replaced by this card, so focus would fall to
  // the page. Put it on the card's heading instead, which also reads the news out.
  useEffect(() => {
    if (focusOnMount) headingRef.current?.focus();
  }, [focusOnMount]);

  const slug = job.film.slug;
  const title = job.film.title;
  useEffect(() => {
    if (job.status === 'done' && slug) onDone({ slug, title, ...(job.kind === 'rebuild' ? { rebuilt: true } : {}) });
  }, [job.status, slug, title, onDone, job.kind]);

  if (job.status === 'failed' || (job.status === 'done' && !slug)) {
    const failed = job.status === 'failed';
    return (
      <section className={`sticker ${styles.card} ${styles.live}`} aria-labelledby="add-live-heading">
        <h2 id="add-live-heading" className={styles.headline}>
          {failed ? ADD.jobFailed : ADD.jobDone}
        </h2>
        {failed && (
          <p className={styles.body} role="alert">
            {failureSentence(job.error_code, job.error)}
          </p>
        )}
        <div className={styles.submitRow}>
          <button type="button" className="button" onClick={onReset}>
            {ADD.tryAnother}
            <ArrowRight />
          </button>
        </div>
      </section>
    );
  }

  // Only the steps whose work reaches the film page, in the page's words (`parentSteps`).
  const steps = parentSteps(job.steps);
  const running = steps.find((step) => step.status === 'running');
  const done = steps.filter((step) => step.status === 'done');
  const details = done.filter((step) => step.detail);
  // A finish carries on a public run whose subtitles were fetched on the Watch page.
  const finishing = Boolean(job.continues);
  // A rebuild replaces a guide the film already has, which stays readable until then.
  const rebuild = job.kind === 'rebuild';
  // Queued is not reading: until the API reports a step, the card says it is waiting, nothing more.
  // The Jev-first pipeline has one slow stretch (Sonnet reading the film) and quick ones after it,
  // and the lead says which of the two the run is in.
  const phase = addPhase(job);
  const waiting = phase === 'waiting';
  const interrupted = health.state === 'interrupted';
  const missing = health.state === 'missing';
  const headline = rebuild
    ? waiting
      ? ADD.rebuildQueuedHeadline(title)
      : ADD.rebuildHeadline(title)
    : waiting
      ? ADD.queuedHeadline(title)
      : finishing
        ? ADD.finishingHeadline(title)
        : ADD.readingHeadline(title);
  const body = rebuild
    ? ADD.rebuildBody
    : waiting
      ? ADD.queuedBody(title)
      : finishing
        ? ADD.finishingBody
        : phase === 'sonnet-reading'
          ? ADD.sonnetReadingBody(title)
          : phase === 'checking'
            ? ADD.checkingBody(title)
            : ADD.readingBody(title);

  const elapsed = (
    <p className={`tabular ${styles.progress}`}>
      {job.status === 'queued' || job.elapsed_ms === null
        ? ADD.queued
        : interrupted || missing
          ? ADD.elapsedAtLastUpdate(job.elapsed_ms)
          : ADD.elapsedLine(job.elapsed_ms)}
    </p>
  );
  const who = (id: string) =>
    (ADD.stepWho[id] ?? []).length > 0 && (
      <span className={styles.stepWhoLine}>
        {(ADD.stepWho[id] ?? []).map((name) => (
          <span key={name} className={`${styles.stepWho} ${name === 'Jev' ? styles.whoJev : styles.whoSonnet}`}>
            {name}
          </span>
        ))}
      </span>
    );
  const stepRow = (step: (typeof steps)[number]) => {
    // A finished row says how long it took, as the API measured it; the running row says it is the
    // slow part when it is. No clock of this page's own ticks anywhere on the card.
    const took = step.status === 'done' ? stepDurationMs(step) : null;
    return (
      <li key={step.id} className={`${styles.step} ${styles[`step_${step.status}`] ?? ''}`}>
        <span className={styles.stepMark} aria-hidden="true" />
        <span className={styles.stepText}>
          <span className={styles.stepLabel}>{step.label}</span>
          {who(step.id)}
        </span>
        <span className={`tabular ${styles.stepState}`}>
          {ADD.stepState[step.status] ?? step.status}
          {took !== null && <span className={styles.stepTook}>{ADD.stepTook(took)}</span>}
        </span>
      </li>
    );
  };

  return (
    <section className={`sticker ${styles.card} ${styles.live}`} aria-labelledby="add-live-heading">
      <h2 id="add-live-heading" className={styles.headline} ref={headingRef} tabIndex={-1}>
        {headline}
      </h2>
      <p className={styles.body}>{body}</p>
      <div className={`${styles.inset} ${styles.liveGrid}`}>
        {/* What is happening now: first on a phone, beside the step list on a wider screen. */}
        <div className={styles.nowPanel}>
          <p className={styles.nowEyebrow}>{ADD.nowHeading}</p>
          <p className={styles.nowLabel}>{running ? running.label : ADD.queued}</p>
          {running && who(running.id)}
          {running && ADD.stepPace[running.id] && <p className={styles.stepPace}>{ADD.stepPace[running.id]}</p>}
          {elapsed}
          {steps.some((step) => ADD.stepWho[step.id]) && <p className={styles.whoNote}>{ADD.whoNote}</p>}
        </div>
        {steps.length > 0 && (
          <div className={styles.stepsPanel}>
            {/* Wider screens: every step, compact. */}
            <ol className={`${styles.stepList} ${styles.stepsWide}`} aria-label={ADD.stepsHeading}>
              {steps.map(stepRow)}
            </ol>
            {/* Phones: the steps still to come, with the finished ones folded away. */}
            <div className={styles.stepsPhone}>
              {done.length > 0 && (
                <details className={styles.fold}>
                  <summary className={styles.foldSummary}>{ADD.completedSteps(done.length)}</summary>
                  <ol className={styles.stepList}>{done.map(stepRow)}</ol>
                </details>
              )}
              <ol className={styles.stepList} aria-label={ADD.stepsHeading}>
                {steps.filter((step) => step.status !== 'done').map(stepRow)}
              </ol>
            </div>
            {details.length > 0 && (
              <details className={styles.fold}>
                <summary className={styles.foldSummary}>{ADD.stepMore}</summary>
                <ul className={styles.detailList}>
                  {details.map((step) => (
                    <li key={step.id}>
                      <b>{step.label}.</b> {step.detail}
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        )}
      </div>
      {/* The last answer is not current any more: say so, say when it was, and offer to ask again.
          Asking again only polls — it never starts the run a second time. */}
      {(interrupted || missing) && (
        <div className={styles.stale} role="alert">
          {missing ? (
            <p>{ADD.jobMissing}</p>
          ) : (
            <p>
              <b>{ADD.interruptedHeadline}</b> {ADD.interruptedBody}{' '}
              {health.lastOkAt !== null && ADD.lastUpdate(clockTime(health.lastOkAt))}
            </p>
          )}
          {missing ? (
            <button type="button" className="button buttonQuiet" onClick={onReset}>
              {ADD.tryAnother}
            </button>
          ) : (
            <button type="button" className="button buttonQuiet" onClick={retry}>
              {ADD.retryNow}
            </button>
          )}
        </div>
      )}
      {/* The step changes are what a screen reader needs; the elapsed time ticking over would be noise. */}
      <p className="srOnly" role="status">
        {running ? ADD.stepLine(running.label) : job.status === 'queued' ? ADD.queued : ''}
      </p>
      <a
        href="#library-list"
        className={styles.meanwhile}
        onClick={(event) => {
          // A plain click stays on the page; a modified one does what the browser would.
          if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
          event.preventDefault();
          onBrowse();
        }}
      >
        {ADD.meanwhile}
      </a>
    </section>
  );
}
