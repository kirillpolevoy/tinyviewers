'use client';

import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Poster } from './Poster';
import { ArrowRight } from './Art';
import { ADD, capLine } from '@/lib/copy';
import type { Candidate } from '@/lib/job';
import styles from './AddFilm.module.css';

type Props = {
  /** `?film=` from the library's "Add this movie", so the parent does not type the title twice. */
  initialQuery: string;
};

/** A refusal: one plain sentence, and the way onward where there is one. */
type Refusal = { text: string; link?: { href: string; label: string } };

type Phase = 'idle' | 'finding' | 'choosing' | 'starting';

/**
 * The passcoded add flow: a title in, a running job out.
 *
 * The passcode lives in this component's state and nowhere else — not localStorage, not the URL,
 * not a cookie. It goes out in the POST body of the two requests that need it and is gone the
 * moment the page is left. That is also why both requests go to this app's own /api/add/* handlers
 * rather than to the scene API: the CSP allows the browser to talk to this origin only, and the
 * passcode never crosses a boundary this app cannot see.
 *
 * Every refusal the API can return has a sentence here and, where one exists, a link: "already on
 * the shelf" points at the film, "already running" points at the run. A dead end with a code in it
 * would be the API's answer, not an answer.
 */
export function AddFilm({ initialQuery }: Props) {
  const router = useRouter();
  const [query, setQuery] = useState(initialQuery);
  const [passcode, setPasscode] = useState('');
  const [phase, setPhase] = useState<Phase>('idle');
  const [candidates, setCandidates] = useState<Candidate[] | null>(null);
  const [refusal, setRefusal] = useState<Refusal | null>(null);

  /** One place that turns a status and a body into a sentence, so the two calls cannot disagree. */
  const refusalFor = (status: number, body: Record<string, unknown>): Refusal => {
    if (status === 401) return { text: ADD.wrongPasscode };
    if (status === 400) return { text: ADD.badRequest };
    if (status === 413) return { text: ADD.tooLong };
    // Two refusals share 429, and only the code tells them apart. Read as budget, a throttled
    // passcode came back as "$0.00 of $0.00 spent today" — a sentence that is both wrong and
    // impossible, and that sends the reader away until tomorrow over a ten-minute wait.
    if (status === 429) {
      if (body.error_code === 'too_many_attempts') return { text: ADD.tooManyAttempts };
      return { text: capLine(Number(body.spent_usd ?? 0), Number(body.cap_usd ?? 0)) };
    }
    if (status === 409 && body.error_code === 'exists' && typeof body.slug === 'string') {
      return {
        text: ADD.exists,
        link: { href: `/film/${body.slug}`, label: ADD.openExisting },
      };
    }
    if (status === 409 && body.error_code === 'busy' && typeof body.id === 'string') {
      return {
        text: ADD.busy,
        link: { href: `/watch/job/${body.id}`, label: ADD.runningLink },
      };
    }
    if (status === 503) return { text: ADD.offBody };
    return { text: ADD.unreachable };
  };

  const post = async (path: string, payload: unknown) => {
    const response = await fetch(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    return { ok: response.ok || response.status === 202, status: response.status, body };
  };

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (phase === 'finding' || phase === 'starting') return;
    setRefusal(null);
    setCandidates(null);
    setPhase('finding');
    try {
      const { ok, status, body } = await post('/api/add/resolve', { query: query.trim(), passcode });
      if (!ok) {
        setRefusal(refusalFor(status, body));
        setPhase('idle');
        return;
      }
      const found = Array.isArray(body.candidates) ? (body.candidates as Candidate[]) : [];
      setCandidates(found.slice(0, 3));
      setPhase('choosing');
    } catch {
      setRefusal({ text: ADD.unreachable });
      setPhase('idle');
    }
  };

  const choose = async (candidate: Candidate) => {
    if (phase === 'starting') return;
    setRefusal(null);
    setPhase('starting');
    try {
      // Only the identity goes up: the API looks the film up again itself, so a caller can never
      // name, title or illustrate a film — the tmdb_id is a hint for picking among TMDB's matches.
      const { status, body } = await post('/api/add/jobs', {
        imdb_id: candidate.imdb_id,
        tmdb_id: candidate.tmdb_id,
        passcode,
      });
      if (status === 202 && typeof body.id === 'string') {
        router.push(`/watch/job/${body.id}`);
        return;
      }
      setRefusal(refusalFor(status, body));
      setPhase('choosing');
    } catch {
      setRefusal({ text: ADD.unreachable });
      setPhase('choosing');
    }
  };

  const busy = phase === 'finding' || phase === 'starting';

  return (
    <div className={styles.add}>
      <form className={styles.form} onSubmit={onSubmit}>
        <div className={styles.field}>
          <label className={`eyebrow ${styles.label}`} htmlFor="add-film">
            {ADD.filmLabel}
          </label>
          <input
            id="add-film"
            className={styles.input}
            type="text"
            name="film"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={ADD.filmPlaceholder}
            autoComplete="off"
            required
          />
        </div>
        <div className={styles.field}>
          <label className={`eyebrow ${styles.label}`} htmlFor="add-passcode">
            {ADD.passcodeLabel}
          </label>
          <input
            id="add-passcode"
            className={`${styles.input} ${styles.passcode}`}
            type="password"
            name="passcode"
            value={passcode}
            onChange={(event) => setPasscode(event.target.value)}
            autoComplete="off"
            required
          />
        </div>
        {/* Never a bare spinner: the button says which of the two waits this is. */}
        <button type="submit" className={`button ${styles.submit}`} disabled={busy}>
          {phase === 'finding' ? ADD.finding : phase === 'starting' ? ADD.starting : ADD.submit}
        </button>
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
        <section className={styles.candidates} aria-label={ADD.candidatesHeading}>
          <h3 className={styles.candidatesHeading}>{ADD.candidatesHeading}</h3>
          <ul className={styles.candidateList}>
            {candidates.map((candidate) => (
              <li key={candidate.tmdb_id} className={styles.candidate}>
                <Poster
                  url={candidate.poster_url}
                  title={candidate.title}
                  width={64}
                  height={90}
                  className={styles.candidatePoster}
                />
                <div className={styles.candidateText}>
                  <p className={styles.candidateTitle}>
                    {candidate.title}
                    {candidate.year && <span className={styles.candidateYear}>{candidate.year}</span>}
                  </p>
                  {/* One sentence of the synopsis: enough to tell two films of the same name apart,
                      and not so much that choosing turns into reading. */}
                  {candidate.overview && (
                    <p className={styles.candidateOverview}>{firstSentence(candidate.overview)}</p>
                  )}
                </div>
                {candidate.exists && candidate.slug ? (
                  <Link href={`/film/${candidate.slug}`} className={styles.candidateExisting}>
                    {ADD.openExisting}
                  </Link>
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
        </section>
      )}
    </div>
  );
}

/** The first sentence of a synopsis, or the whole thing when it is one. */
function firstSentence(text: string): string {
  const end = text.search(/[.!?](\s|$)/);
  return end === -1 ? text : text.slice(0, end + 1);
}
