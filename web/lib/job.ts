// One live analysis, as the scene API reports it. Types and the pure rules the job page needs.
//
// The shape is the scene API's, mirrored rather than reshaped: the live page polls it every 1.5 s
// and renders it, and a translation layer in between would only be a place for the two to drift.
// What is here instead is the part that is this app's decision — which sentence a failure gets, and
// how long a step took — kept pure so both the server render and the client poll use the same one.

import { ADD } from './copy';
import type { RawRecording, RawExcerpts } from './replay';

export type JobStatus = 'queued' | 'running' | 'done' | 'failed';
export type StepStatus = 'pending' | 'running' | 'done' | 'failed';

/** The six stages, in the order the API reports them. The labels come from the API, not from here. */
export type JobStep = {
  id: 'subtitles' | 'jev' | 'scenes' | 'presence' | 'excerpts' | 'ingest';
  label: string;
  status: StepStatus;
  started_ms: number | null;
  ended_ms: number | null;
  detail: string | null;
};

export type Job = {
  id: string;
  status: JobStatus;
  step: string | null;
  steps: JobStep[];
  film: { title: string; year: number | null; slug: string | null; poster_url: string | null };
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

/**
 * Is this string shaped like a job id?
 *
 * It arrives from a URL — pasted, shared, or typed by a stranger — and it is about to become part
 * of a path this app forwards to the scene API. Every route that takes one asks this first, and
 * they all ask the same question: one rule, in one place, so a new endpoint cannot be the lenient
 * one. Word characters and hyphens only, so no `..`, no slash, no query string.
 */
export function isJobId(id: string): boolean {
  return /^[\w-]{1,64}$/.test(id);
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
    case 'subtitle_quota':
      return ADD.failSubtitleQuota;
    case 'timed_out':
      return ADD.failTimedOut;
    default:
      return error ? `${ADD.failGeneric} ${error}` : ADD.failGeneric;
  }
}
