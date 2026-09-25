// One live analysis, as the scene API reports it. Types and the pure rules the job page needs.
//
// The shape is the scene API's, mirrored rather than reshaped: the live page polls it every 1.5 s
// and renders it, and a translation layer in between would only be a place for the two to drift.
// What is here instead is the part that is this app's decision — which sentence a failure gets, and
// how long a step took — kept pure so both the server render and the client poll use the same one.

import { ADD, capLine } from './copy';

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
export type JobKind = 'add' | 'demo' | 'rebuild';

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
  /** The live pipeline's Jev recording is stored; nothing in this app reads it any more. */
  recording_ready?: boolean;
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
 * Two pipelines report here. The live one (subtitles, jev, scenes, presence, excerpts, ingest) runs
 * Jev's beat screening and the evidence lines for the old Watch page only, so those two are not
 * listed. The Jev-first one (`ADD_PIPELINE=jevfirst`) is all guide: every stage it reports builds
 * the scene guide, and each is listed — with Sonnet's describing and Jev's check of it shown as the
 * one row a parent reads them as ("Sonnet describes, Jev checks"; see `mergeSteps`).
 *
 * An id this app does not know is left out: a new stage is shown once someone has decided it
 * belongs in front of a parent. While an unlisted stage runs, the list simply shows the next listed
 * step as not started yet, which is true.
 */
export function parentSteps(steps: JobStep[]): JobStep[] {
  const out: JobStep[] = [];
  for (const step of steps) {
    const row = ADD.stepRows[step.id];
    if (!Object.prototype.hasOwnProperty.call(ADD.stepRows, step.id) || !row) continue;
    const labelled = { ...step, id: row, label: ADD.stepLabels[row] };
    const existing = out.find((s) => s.id === row);
    if (existing) out[out.indexOf(existing)] = mergeSteps(existing, labelled);
    else out.push(labelled);
  }
  return out;
}

/**
 * Two API stages shown as one row. The row is done when both are, failed when either failed, and
 * running from the moment the first starts until the second ends — between the two it is still
 * the parent's one step, half finished, not "done" and not "not yet".
 */
export function mergeSteps(first: JobStep, second: JobStep): JobStep {
  const statuses = [first.status, second.status];
  const status: StepStatus = statuses.includes('failed')
    ? 'failed'
    : statuses.every((s) => s === 'done')
      ? 'done'
      : statuses.every((s) => s === 'pending')
        ? 'pending'
        : 'running';
  return {
    ...first,
    status,
    started_ms: first.started_ms ?? second.started_ms,
    ended_ms: status === 'done' ? second.ended_ms ?? first.ended_ms : null,
    detail: second.detail ?? first.detail,
  };
}

/**
 * Where a run is, in the words the card's lead is written for. `sonnet-reading` is the one slow
 * stretch of the Jev-first pipeline (Sonnet reading the whole film takes minutes); `checking` is
 * everything after it, which takes seconds a stage. The live pipeline is always `reading`.
 */
export type AddPhase = 'waiting' | 'sonnet-reading' | 'checking' | 'reading';

export function addPhase(job: Pick<Job, 'status' | 'steps'>): AddPhase {
  if (job.status === 'queued' || job.steps.every((step) => step.status === 'pending')) return 'waiting';
  const segment = job.steps.find((step) => step.id === 'segment');
  if (!segment) return 'reading';
  return segment.status === 'done' ? 'checking' : 'sonnet-reading';
}

/** An IMDb link or a bare IMDb id: the one kind of input that names a single film for certain. */
export function namesOneFilm(text: string): boolean {
  return /^(https?:\/\/)?([\w-]+\.)?imdb\.com\/(\S*\/)?title\/tt\d{5,}\/?\S*$|^tt\d{5,}$/i.test(text.trim());
}
