// One live analysis, as the scene API reports it. Types and the pure rules the job page needs.
//
// The shape is the scene API's, mirrored rather than reshaped: the live page polls it every 1.5 s
// and renders it, and a translation layer in between would only be a place for the two to drift.
// What is here instead is the part that is this app's decision — which sentence a failure gets, and
// how long a step took — kept pure so both the server render and the client poll use the same one.

import { ADD, DEMO, capLine } from './copy';
import type { RawRecording, RawExcerpts } from './replay';

export type JobStatus = 'queued' | 'running' | 'done' | 'failed';
export type StepStatus = 'pending' | 'running' | 'done' | 'failed';

/** The stages, in the order the API reports them. Ids and labels both come from the API. */
export type JobStep = {
  id: string;
  label: string;
  status: StepStatus;
  started_ms: number | null;
  ended_ms: number | null;
  detail: string | null;
};

/**
 * `add` is the passcoded analysis (a fresh run, or a finish that carries a demo run on); `demo` is
 * a public run of the analysis's first stages (the scene API decides which), that writes nothing
 * but its own job row.
 */
export type JobKind = 'add' | 'demo';

export type Job = {
  id: string;
  /** Absent on a job from an API older than the demo; read it as `add`. */
  kind?: JobKind;
  /** A finish: the demo run it carried on from. */
  continues?: string | null;
  status: JobStatus;
  step: string | null;
  steps: JobStep[];
  film: {
    title: string;
    year: number | null;
    slug: string | null;
    poster_url: string | null;
    imdb_id?: string | null;
    /** A demo run only: whether the film was already in the library when the run was started. */
    in_library?: boolean;
  };
  cost_usd: number | null;
  error_code: string | null;
  error: string | null;
  /**
   * Whether the Jev recording can be asked for yet — true as soon as the jev stage ends, long
   * before the scenes exist. The recording itself is a separate endpoint because it is about a
   * megabyte and this object is fetched every 1.5 s: a flag costs nothing to poll, and the thing
   * it announces is fetched once.
   */
  recording_ready: boolean;
  scene_count: number | null;
  /**
   * A public run only: the steps a finish would still run, labelled by the API. The page lists
   * them rather than knowing where the public part of the analysis ends.
   */
  finish_steps?: { id: string; label: string }[];
  elapsed_ms: number | null;
  created_at: string;
  updated_at: string;
};

/** `GET /api/add/jobs/{id}/recording`, once the job says there is one. */
export type JobRecording = {
  recording: RawRecording;
  excerpts: RawExcerpts | null;
};

/** A candidate from `POST /api/add/resolve`. */
export type Candidate = {
  tmdb_id: number;
  imdb_id: string | null;
  title: string;
  year: number | null;
  poster_url: string | null;
  overview: string | null;
  slug: string | null;
  exists: boolean;
};

export type AddStatus = {
  running: { id: string } | null;
  spent_today_usd: number;
  cap_usd: number;
  passcode_configured: boolean;
  /**
   * What the day's figure has booked for the run in progress, when there is one. Optional because
   * it is the newer of the two shapes: an API that does not send it leaves the spending line saying
   * only what it can stand behind, rather than this app guessing the reserve from a constant of the
   * API's that it has no business copying.
   */
  reserve_usd?: number;
};

/** `GET /api/demo/status`: whether a live demo run can start right now. */
export type DemoStatus = {
  /** The admission arithmetic: today's demo spending plus one run's reserve is within the cap. */
  available: boolean;
  spent_today_usd: number;
  cap_usd: number;
  reserve_usd: number;
  running: number;
  concurrency: number;
  new_films_today: number;
  new_films_per_day: number;
  /** False when the deployment lacks a key one of the public stages needs. */
  configured: boolean;
};

/** A refusal: one plain sentence, and the way onward where there is one. */
export type Refusal = { text: string; link?: { href: string; label: string } };

type Body = Record<string, unknown>;

/** The add form's two POSTs, resolve and jobs. One place, so the two cannot disagree. */
export function addRefusal(status: number, body: Body): Refusal {
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
    return { text: ADD.exists, link: { href: `/film/${body.slug}`, label: ADD.openExisting } };
  }
  if (status === 409 && body.error_code === 'busy' && typeof body.id === 'string') {
    return { text: ADD.busy, link: { href: `/library?job=${body.id}`, label: ADD.runningLink } };
  }
  if (status === 503) return { text: ADD.offBody };
  return { text: ADD.unreachable };
}

/**
 * The demo picker's two POSTs, resolve and runs. The daily cap is the one refusal with a way
 * onward that is not "wait": a film on the shelf has a recorded run, and the API names the film.
 */
export function demoRefusal(status: number, body: Body): Refusal {
  if (status === 400) return { text: DEMO.badRequest };
  if (status === 413) return { text: ADD.tooLong };
  if (status === 409 && body.error_code === 'busy') return { text: DEMO.busy };
  if (status === 429) {
    switch (body.error_code) {
      case 'too_many_runs':
        return { text: DEMO.tooManyRuns };
      case 'too_many_new_films':
        return { text: DEMO.tooManyNewFilms };
      case 'new_film_limit':
        return { text: DEMO.newFilmLimit };
      case 'too_many_lookups':
        return { text: DEMO.tooManyLookups };
      default:
        return typeof body.slug === 'string' && body.slug
          ? { text: DEMO.capHeadline, link: { href: `/watch/${body.slug}`, label: DEMO.watchRecording } }
          : { text: `${DEMO.capHeadline} ${capLine(Number(body.spent_usd ?? 0), Number(body.cap_usd ?? 0))}` };
    }
  }
  return { text: DEMO.unreachable };
}

/** Finishing a demo run: the add refusals, plus the three that are about the run being finished. */
export function finishRefusal(status: number, body: Body): Refusal {
  if (status === 409 && body.error_code === 'not_done') return { text: DEMO.finishNotDone };
  if (status === 409 && body.error_code === 'no_subtitles') return { text: DEMO.finishNoSubtitles };
  if (status === 400 || status === 404) return { text: DEMO.finishNotDone };
  return addRefusal(status, body);
}

/**
 * Is this string shaped like a job id?
 *
 * It arrives from a URL — pasted, shared, or typed by a stranger — and it is about to become part
 * of a path this app forwards to the scene API. Every route that takes one asks this first, and
 * they all ask the same question: one rule, in one place, so a new endpoint cannot be the lenient
 * one. The same shape the scene API accepts (base64url, 16-64 characters), so an id it would
 * refuse never reaches it and shows as "no such run" rather than "can't reach the service".
 */
export function isJobId(id: string): boolean {
  return /^[A-Za-z0-9_-]{16,64}$/.test(id);
}

/** Still worth polling? Everything else has stopped moving. */
export function isLive(status: JobStatus): boolean {
  return status === 'queued' || status === 'running';
}

/**
 * How long a step took, or how long it has been running.
 *
 * A step that has not started has no duration — not zero. The difference matters on a list where
 * four of six steps are still pending: "0.0 s" beside them would read as four instant successes.
 */
export function stepDurationMs(step: JobStep, nowMs: number | null = null): number | null {
  if (step.started_ms === null) return null;
  if (step.ended_ms !== null) return step.ended_ms - step.started_ms;
  if (nowMs === null) return null;
  return Math.max(0, nowMs - step.started_ms);
}

/**
 * The sentence a failure gets.
 *
 * Three codes have a real explanation, because they are the three that actually happen and each one
 * suggests a different next move. Anything else falls through to the generic line plus whatever the
 * API said, which is a message written for this app and not a stack trace — if that is missing too,
 * the generic sentence stands alone rather than trailing "undefined".
 */
export function failureSentence(errorCode: string | null, error: string | null): string {
  switch (errorCode) {
    case 'no_subtitles':
      return ADD.failNoSubtitles;
    case 'no_scenes':
      return ADD.failNoScenes;
    case 'subtitle_quota':
      return ADD.failSubtitleQuota;
    case 'timed_out':
      return ADD.failTimedOut;
    default:
      return error ? `${ADD.failGeneric} ${error}` : ADD.failGeneric;
  }
}

/**
 * The steps a parent is shown on the add card: only those whose output reaches the film page, in the
 * API's order, labelled in the page's words.
 *
 * The API runs more than these — Jev's beat screening and the evidence lines feed the Watch page's
 * replay, not the scene guide — and a progress list that showcased them would be describing work the
 * parent's guide is not made of. They still run; while one does, the list simply shows the next
 * listed step as not started yet, which is true. An id this app does not know is left out too: a
 * new stage is shown once someone has decided it belongs in front of a parent.
 */
export function parentSteps(steps: JobStep[]): JobStep[] {
  return steps
    .filter((step) => Object.prototype.hasOwnProperty.call(ADD.stepLabels, step.id))
    .map((step) => ({ ...step, label: ADD.stepLabels[step.id] }));
}

/** An IMDb link or a bare IMDb id: the one kind of input that names a single film for certain. */
export function namesOneFilm(text: string): boolean {
  return /^(https?:\/\/)?([\w-]+\.)?imdb\.com\/(\S*\/)?title\/tt\d{5,}\/?\S*$|^tt\d{5,}$/i.test(text.trim());
}
