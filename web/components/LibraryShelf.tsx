'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Poster } from './Poster';
import { Strip, StripLegend } from './Strip';
import { SearchForm } from './SearchForm';
import { StateCard } from './StateCard';
import { AddAsk, AddLive } from './AddMovie';
import { ADD, FILM, LIBRARY, SEARCH, libraryCount, sceneCountLabel } from '@/lib/copy';
import { matchFilms, soleMatch } from '@/lib/search';
import { DEFAULT_BAND, strengthBreakdown, type Scene } from '@/lib/scenes';
import {
  addedFilm,
  arrivalStep,
  libraryHref,
  showsAsCard,
  withJustAdded,
  type AddedFilm,
} from '@/lib/add-flow';
import type { FilmSummary } from '@/lib/queries';
import type { AddStatus, Job } from '@/lib/job';
import styles from './LibraryShelf.module.css';

type Props = {
  /** Every film, already fetched by the page. The library never asks the server for a narrower list. */
  films: FilmSummary[];
  /** `?q=` as the server read it, so the first paint already shows the right films. */
  query: string;
  /** `?job=`: an add run to show live — one just started, or one a parent came back to. */
  initialJob: Job | null;
  /** `?job=` named a run the analysis service could not be asked about. */
  unreachableJobId: string | null;
};

/** Where the "Just added" chips are remembered: this tab, this session. A convenience, not a record. */
const JUST_ADDED_KEY = 'tv:just-added';

function readJustAdded(): string[] {
  try {
    const raw = window.sessionStorage.getItem(JUST_ADDED_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(parsed) ? parsed.filter((s): s is string => typeof s === 'string') : [];
  } catch {
    return [];
  }
}

function rememberJustAdded(slug: string): string[] {
  const next = withJustAdded(readJustAdded(), slug);
  try {
    window.sessionStorage.setItem(JUST_ADDED_KEY, JSON.stringify(next));
  } catch {
    // Private windows and blocked storage: the chip lasts as long as the page instead.
  }
  return next;
}

/**
 * The library: comparison rows, filtered as a parent types; under them, closed until asked for, the
 * way to add a film ("Can't find your film?"); and — when a search misses — the ask itself, in place.
 * The films always come first: an access-code form is never the first thing on the page.
 *
 * The whole library is on the page already, so narrowing it is a filter over an array: nothing to
 * wait for, nothing to debounce. The matching is `lib/search.ts` — the same pure rules the server
 * used to decide whether `?q=` names one film — so what the parent sees while typing and what
 * pressing Enter does can never disagree. The URL is kept in step with `history.replaceState`.
 *
 * The add flow has three moments and they all happen here: the miss becomes the ask; the ask
 * becomes a live card driven by the real run; the run's film lands as a row with a "Just added"
 * chip that lasts the session.
 */
export function LibraryShelf({
  films,
  query: initialQuery,
  initialJob,
  unreachableJobId,
}: Props) {
  const router = useRouter();
  const [query, setQuery] = useState(initialQuery);
  // A run that had already finished when the page was opened is not shown as a card: its film is
  // simply in the library, chipped — or about to be, which the arrival effect below sees to.
  const [liveJob, setLiveJob] = useState<Job | null>(showsAsCard(initialJob) ? initialJob : null);
  const [justAdded, setJustAdded] = useState<string[]>([]);
  // The search that led to the run. It is answered by the live card; a different miss is not.
  const [runQuery, setRunQuery] = useState<string | null>(null);
  const [status, setStatus] = useState<AddStatus | null | undefined>(undefined);
  const [statusAttempt, setStatusAttempt] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const liveRef = useRef<HTMLDivElement>(null);
  const askRef = useRef<HTMLDivElement>(null);
  // "Add a film" pressed under the list: the ask opens there, in place of the question.
  const [addAsked, setAddAsked] = useState(false);

  // The film a finished run added, until the refreshed list has it in it; and whether the list was
  // refreshed as often as it will be without the film turning up (then the notice carries a link).
  const [arriving, setArriving] = useState<string | null>(null);
  const [added, setAdded] = useState<AddedFilm | null>(null);
  const [gaveUp, setGaveUp] = useState(false);
  // Where focus goes when the row lands: only if it was inside the card that just went away.
  const focusOnArrival = useRef<string | null>(null);

  // One way to finish, whether the run ended while the page watched it or before the page loaded.
  const complete = useCallback((film: AddedFilm) => {
    setJustAdded(rememberJustAdded(film.slug));
    setAdded(film);
    setGaveUp(false);
    setArriving(film.slug);
    window.history.replaceState(null, '', '/library');
  }, []);

  // The run the URL named: finished ones land as rows, live ones become the card. This runs again
  // when a link brings another ?job= to this same mounted list; a refresh that drops ?job= (null)
  // leaves whatever is on screen alone.
  useEffect(() => {
    const film = addedFilm(initialJob);
    if (film) complete(film);
    else setJustAdded(readJustAdded());
    if (initialJob && showsAsCard(initialJob)) {
      setLiveJob((current) => (current?.id === initialJob.id ? current : initialJob));
    }
  }, [initialJob, complete]);

  const matched = useMemo(
    () => (query.trim() ? matchFilms(films, query).films : films),
    [films, query],
  );
  // Just-added films lead the list, newest first; the rest keep the library's order.
  const shown = useMemo(() => {
    const rank = (slug: string) => {
      const i = justAdded.indexOf(slug);
      return i === -1 ? Number.POSITIVE_INFINITY : i;
    };
    return [...matched].sort((a, b) => rank(a.slug) - rank(b.slug));
  }, [matched, justAdded]);

  const missed = query.trim() !== '' && shown.length === 0;
  // The legend names only the levels the rows on screen actually draw.
  const legendScenes = useMemo(() => shown.flatMap((film) => film.markers.map(asScene)), [shown]);
  // Open when a search misses (the ask is the answer to it), when the parent asked for it under the
  // list, or when there is no film at all to list above it.
  const askOpen = liveJob === null && (missed || addAsked || films.length === 0);
  // A new search that misses while a run is on screen: the ask is taken (one run at a time), but the
  // miss still gets its own empty state rather than a bare count line. The search that started the
  // run is not a new miss — the live card is its answer.
  const missedWhileRunning = liveJob !== null && missed && query.trim() !== runQuery;

  // Whether anything can be added right now: read when the ask is needed, and kept once the API has
  // answered. A read that failed is not an answer — it is asked again when the ask reopens, or when
  // the parent presses "Check again" — and a read the page no longer needs is abandoned.
  const statusKnown = status !== null && status !== undefined;
  useEffect(() => {
    if (!askOpen || statusKnown) return;
    const controller = new AbortController();
    setStatus(undefined);
    fetch('/api/add/status', { cache: 'no-store', signal: controller.signal })
      .then((response) => (response.ok ? (response.json() as Promise<AddStatus>) : null))
      .then((body) => setStatus(body))
      .catch(() => {
        if (!controller.signal.aborted) setStatus(null);
      });
    return () => controller.abort();
  }, [askOpen, statusKnown, statusAttempt]);

  const onChange = (value: string) => {
    setQuery(value);
    // replaceState, not push: a filter is not a place you navigate back through letter by letter.
    // A live run keeps its place in the URL, so a reload still finds it.
    window.history.replaceState(null, '', libraryHref(value, liveJob?.id ?? null));
  };

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    // Enter either opens the one film named, or does nothing: reloading the page to show the films
    // already on screen would be a step backwards.
    event.preventDefault();
    const one = soleMatch(films, query);
    if (one) router.push(`/film/${one.slug}`);
  };

  // A run the parent just started (as opposed to one a reload found) takes focus: the ask they were
  // typing into is gone, and the card that replaced it is what they need to hear about.
  const [startedHere, setStartedHere] = useState<string | null>(null);

  const onStarted = (job: Job) => {
    setStartedHere(job.id);
    // The ask has done its job: after this run it is the question under the list again.
    setAddAsked(false);
    setRunQuery(query.trim());
    setLiveJob(job);
    window.history.replaceState(null, '', libraryHref('', job.id));
  };

  const onDone = useCallback(
    (film: AddedFilm) => {
      // The card is about to go. If focus was in it (its heading, "Browse meanwhile"), it follows
      // the film to its new row; if the parent was reading elsewhere, it stays where it is.
      const active = typeof document === 'undefined' ? null : document.activeElement;
      focusOnArrival.current = active && liveRef.current?.contains(active) ? film.slug : null;
      setLiveJob(null);
      setQuery('');
      complete(film);
    },
    [complete],
  );

  // The new film is a row in the database now; fetch the list again so it lands in it.
  //
  // Not in the same tick as the replaceState above. Next patches history.replaceState to dispatch a
  // router "restore", and a restore arriving alongside a refresh discards the refresh: the request
  // goes out, the answer (with the new film in it) comes back, and the list on screen never changes.
  // Refreshing from an effect, after the commit, keeps the two apart — and if the list still lacks
  // the film a second later, it asks once more rather than leaving the parent without their row.
  const refreshes = useRef(0);
  useEffect(() => {
    if (!arriving) return;
    const next = arrivalStep(arriving, films, refreshes.current);
    if (next.kind !== 'refresh') {
      refreshes.current = 0;
      setArriving(null);
      // Still missing after every refresh: the notice keeps a link to the film's page, which is
      // read fresh, rather than leaving the parent with a finished run and nothing to open.
      if (next.kind === 'gave-up') setGaveUp(true);
      return;
    }
    refreshes.current += 1;
    // A fresh list re-runs this effect, which cancels the retry; only a refresh that changed
    // nothing lets it fire.
    const retry = window.setTimeout(() => router.refresh(), next.delayMs);
    return () => window.clearTimeout(retry);
  }, [arriving, films, router]);

  // The row has landed: if focus was in the card that went away, put it on the row.
  useEffect(() => {
    const slug = focusOnArrival.current;
    if (!slug || !films.some((film) => film.slug === slug)) return;
    focusOnArrival.current = null;
    listRef.current?.querySelector<HTMLAnchorElement>(`a[data-slug="${CSS.escape(slug)}"]`)?.focus();
  }, [films]);

  // The question under the list becomes the ask: focus goes to its heading while the page asks whether
  // adding is open, then to the title field once the form is there — unless the parent has moved on.
  const focusAsk = useRef(false);
  const openAsk = () => {
    focusAsk.current = true;
    setAddAsked(true);
  };
  useEffect(() => {
    if (!focusAsk.current || !askOpen) return;
    const box = askRef.current;
    const input = box?.querySelector<HTMLElement>('input') ?? null;
    const heading = box?.querySelector<HTMLElement>('h2') ?? null;
    const active = document.activeElement;
    const free = !active || active === document.body || active === heading || !document.contains(active);
    if (input) {
      if (free) input.focus();
      focusAsk.current = false;
    } else if (heading) {
      heading.setAttribute('tabindex', '-1');
      if (free) heading.focus();
      // No form is coming (switched off, or the service is not answering): the heading was the place.
      if (status !== undefined) focusAsk.current = false;
    }
  }, [askOpen, status]);

  const onBrowse = () => {
    onChange('');
    listRef.current?.scrollIntoView({ block: 'start' });
  };

  return (
    <>
      <div className={styles.head}>
        <div className={styles.headText}>
          <h1 className={styles.title}>{LIBRARY.title}</h1>
          <p className={styles.intro}>{LIBRARY.intro}</p>
        </div>
        <div className={styles.search}>
          <SearchForm
            id="library-search"
            label={SEARCH.fieldLabel}
            placeholder={SEARCH.placeholder}
            value={query}
            onChange={onChange}
            onSubmit={onSubmit}
            count={libraryCount(shown.length, films.length)}
          />
        </div>
      </div>

      {unreachableJobId && (
        <StateCard as="h2" headline={ADD.jobUnreachableHeadline} body={ADD.jobUnreachableBody} className={styles.notice}>
          {/* A bare anchor, not a Link: retrying has to be a fresh request to this same URL. */}
          <a href={`/library?job=${encodeURIComponent(unreachableJobId)}`} className="button buttonQuiet">
            {ADD.jobUnreachableRetry}
          </a>
        </StateCard>
      )}

      {/* Outside the card, so it survives the card: the news that the run finished, read out
          politely, and shown with a link only if the film is slow to reach the list. */}
      <p className={added ? styles.added : 'srOnly'} role="status">
        {added && (
          <>
            {added.rebuilt ? ADD.rebuildDone(added.title) : LIBRARY.added(added.title)}{' '}
            <Link href={`/film/${added.slug}`} className={styles.addedLink}>
              {ADD.openGuide}
            </Link>
          </>
        )}
      </p>

      {liveJob && (
        <div ref={liveRef}>
          <AddLive
            key={liveJob.id}
            initialJob={liveJob}
            onDone={onDone}
            onReset={() => {
              setLiveJob(null);
              window.history.replaceState(null, '', '/library');
            }}
            onBrowse={onBrowse}
            focusOnMount={startedHere === liveJob.id}
          />
        </div>
      )}

      <div ref={listRef} id="library-list" className={styles.listWrap}>
        {missedWhileRunning && (
          <StateCard as="h2" headline={SEARCH.noMatchHeadline} body={SEARCH.noMatchBody} />
        )}
        {shown.length > 0 && (
          <>
            <div className={styles.legend}>
              <StripLegend band={LIBRARY.legendBand} scenes={legendScenes} />
            </div>
            <ul className={styles.rows}>
              {shown.map((film) => (
                <li key={film.slug}>
                  <FilmRow film={film} justAdded={justAdded.includes(film.slug)} rebuilt={added?.rebuilt === true && added.slug === film.slug} />
                </li>
              ))}
            </ul>
          </>
        )}
      </div>

      {/* After the films, never before them. */}
      {askOpen ? (
        <div ref={askRef}>
          <AddAsk
            query={query}
            from={missed ? 'miss' : 'asked'}
            status={status}
            onStarted={onStarted}
            onRetryStatus={() => setStatusAttempt((n) => n + 1)}
          />
        </div>
      ) : (
        liveJob === null && (
          <section className={styles.addQuestion} aria-labelledby="add-question">
            <h2 id="add-question" className={styles.addQuestionHeading}>
              {LIBRARY.addHeadline}
            </h2>
            <button type="button" className="button buttonQuiet" onClick={openAsk}>
              {LIBRARY.addAction}
            </button>
          </section>
        )
      )}
    </>
  );
}

/** A library marker, in the shape the strength rules take. */
function asScene(m: FilmSummary['markers'][number]): Scene {
  return { id: '', startMs: m.startMs, endMs: m.startMs, title: '', description: null, severity57: m.severity57, severity810: m.severity810, tags: [] };
}

/** One film as a comparison row: poster, title and year, where its scenes sit, how many. */
function FilmRow({ film, justAdded, rebuilt }: { film: FilmSummary; justAdded: boolean; rebuilt: boolean }) {
  // The strip is a picture; the strengths it draws are also said in words, after the count, so a
  // screen reader hears "18 scenes: 3 very strong, 8 strong…" rather than a bare number.
  const breakdown = strengthBreakdown(film.markers.map(asScene), DEFAULT_BAND).map(
    (entry) => `${entry.count} ${entry.word}`,
  );
  return (
    <Link href={`/film/${film.slug}`} className={styles.row} data-slug={film.slug}>
      <Poster
        url={film.posterUrl}
        title={film.title}
        decorative
        width={56}
        height={78}
        placeholder={FILM.posterPlaceholderShort}
        className={styles.poster}
      />
      <span className={styles.name}>
        <span className={styles.filmTitle}>{film.title}</span>
        {film.year && <span className={styles.year}>{film.year}</span>}
        {justAdded && <span className={styles.chip}>{rebuilt ? ADD.guideUpdated : LIBRARY.justAdded}</span>}
      </span>
      <span className={styles.strip}>
        {/* Decorative: the count beside it says this in words, and the row is one link whose
            name must stay short. */}
        <Strip markers={film.markers} durationMs={film.durationMs} band={DEFAULT_BAND} decorative />
      </span>
      <span className={styles.meta}>
        <span className={`tabular ${styles.count}`}>
          {sceneCountLabel(film.sceneCount)}
          <span className="srOnly">
            {LIBRARY.rowBreakdown(breakdown)} ({LIBRARY.legendBand.toLowerCase()})
          </span>
        </span>
        <span className={styles.action}>{LIBRARY.rowAction}</span>
      </span>
    </Link>
  );
}
