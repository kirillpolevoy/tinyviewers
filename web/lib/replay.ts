// The recorded Jev run, reduced to what a browser needs to replay it. Pure: no React, no database.
//
// A recording is a megabyte of raw probabilities — 103 answers for each of 247 beats, plus a
// `timeline` that is a running total per response. All of it is true and almost none of it can be
// shown. This file makes the compact payload the page actually renders, and the rule it follows is
// the one the whole page stands on: **every number on screen comes out of the recording**. Nothing
// here smooths a timing, fills a gap, or derives a figure the run did not produce.
//
// What is dropped, and why:
//   * `timeline[]` entirely. It is one snapshot per response, and every field in it is recoverable
//     from `requests[]` — which we keep in full — by asking "what has landed by t?". Keeping both
//     would be two sources for one truth, and the smaller one would be the one that drifts.
//   * All but the top few answers per beat. 25,441 numbers is the analysis; six bars is the part a
//     person can read. The four severity scores stay because they are what the scenes are built on.
//   * `answers[].probabilities` under each score: a distribution over levels 0–3 that only the
//     verifier reads.
//   * Every word that is a constant rather than a measurement. An answer carries its channel, its
//     id and its probability, and the page looks the label up in lib/taxonomy-labels.ts; the four
//     scores are two numbers each in a fixed order. Repeating 1,482 label strings and 988 score
//     names per film would have added 80 KB of text the bundle already has. Nemo's payload is
//     ~152 KB with this shape and ~267 KB without it.
//
// What is kept in full: every request, with its real `sent_ms` and `received_ms`. Those are the
// point of the page. See `replayStateAt` — the clock is read, never stepped.

import { labelFor, SCORE_LABELS, SCORE_ORDER, type Channel } from './taxonomy-labels';

// --- the recording, as it is on disk and in the `recordings` table -----------------------------
//
// Typed loosely on purpose: this is JSON from another project, so the fields we read are declared
// and the rest is left alone rather than mirrored into a type that would have to be maintained.

export type RawScore = { score: number; confidence: number; probabilities?: Record<string, number> };

export type RawRecording = {
  meta: {
    film: string;
    model: string;
    model_reported: string;
    taxonomy: string;
    started_at: string;
    concurrency: number;
    cues: number;
    windows: number;
    beats: number;
    questions_per_beat: number;
    total_answers: number;
    requests: number;
    wall_ms: number;
    input_tokens: number;
    output_tokens: number;
    cost_usd: number;
    price_per_mtok: number;
    retries: number;
  };
  thresholds?: { flag_threshold?: number; flag_rule?: string };
  requests: {
    id: string;
    kind: string;
    window_id: string | null;
    part: number;
    parts: number;
    sent_ms: number;
    received_ms: number;
    status: number;
    retries: number;
    input_tokens: number;
    output_tokens: number;
    questions: number;
    beats: string[];
  }[];
  beats: {
    id: string;
    window_id: string;
    start_ms: number;
    end_ms: number;
    n_cues: number;
    flagged: boolean;
    loud_caption: number;
    request_id: string;
    answers: {
      presence?: Record<string, number>;
      mention?: Record<string, number>;
      event?: Record<string, number>;
      score?: Record<string, RawScore>;
    };
  }[];
};

/** `<slug>.excerpts.json`: flagged beat id → the lines chosen for it, in film order. */
export type RawExcerpts = Record<
  string,
  { cue: string; line: string; score: number; why?: { words?: string[]; fallback?: string } }[]
>;

// --- the payload the client gets ---------------------------------------------------------------

export type ReplayMeta = {
  film: string;
  model: string;
  /** What the API said it used. Shown beside `model` only when the two differ. */
  modelReported: string;
  taxonomy: string;
  startedAt: string;
  concurrency: number;
  cues: number;
  windows: number;
  beats: number;
  flaggedBeats: number;
  questionsPerBeat: number;
  totalAnswers: number;
  requests: number;
  retries: number;
  wallMs: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  pricePerMtok: number;
  /** The probability at or above which a presence or event answer flags a beat. */
  flagThreshold: number;
};

export type ReplayRequest = {
  id: string;
  kind: string;
  windowId: string | null;
  part: number;
  parts: number;
  sentMs: number;
  receivedMs: number;
  status: number;
  retries: number;
  inputTokens: number;
  outputTokens: number;
  questions: number;
  beats: string[];
};

/** One answer Jev gave. The words come from `labelOf`; only the three facts travel. */
export type ReplayAnswer = { channel: Channel; id: string; p: number };
/** `[score, confidence]`, one pair per entry of SCORE_ORDER, always all four and always in order. */
export type ReplayScorePair = [score: number, confidence: number];
/** One subtitle line, with the words that earned it its place. Flagged beats only. */
export type ReplayLine = { line: string; words: string[] };

export type ReplayBeat = {
  id: string;
  startMs: number;
  endMs: number;
  nCues: number;
  flagged: boolean;
  /** How loudly the sound captions in this beat read, 0–1. Part of why a beat looks the way it does. */
  loudCaption: number;
  /** The request whose arrival makes this beat known. The one to replay on. */
  requestId: string;
  top: ReplayAnswer[];
  scores: ReplayScorePair[];
  lines: ReplayLine[];
};

export type ReplayPayload = { meta: ReplayMeta; requests: ReplayRequest[]; beats: ReplayBeat[] };

/** How many answers a beat shows. Six bars is about as many as a person reads at a glance. */
export const TOP_ANSWERS = 6;

/** The flag rule, when a recording does not carry its own. Matches thresholds.flag_rule. */
export const DEFAULT_FLAG_THRESHOLD = 0.7;

const CHANNEL_RANK: Record<Channel, number> = { presence: 0, event: 1, mention: 2 };

/**
 * The highest few answers for one beat, across the three answer channels.
 *
 * A zero is not a top answer, so answers at zero are dropped rather than padding the list out to
 * six — a beat where Jev said no to everything shows fewer bars, which is the truth about it.
 * Ties break on channel then id so two runs of this function on the same beat agree.
 */
function topAnswers(answers: RawRecording['beats'][number]['answers']): ReplayAnswer[] {
  const all: ReplayAnswer[] = [];
  for (const channel of ['presence', 'event', 'mention'] as const) {
    for (const [id, p] of Object.entries(answers[channel] ?? {})) {
      if (!(p > 0)) continue;
      all.push({ channel, id, p });
    }
  }
  all.sort(
    (a, b) => b.p - a.p || CHANNEL_RANK[a.channel] - CHANNEL_RANK[b.channel] || a.id.localeCompare(b.id),
  );
  return all.slice(0, TOP_ANSWERS);
}

/**
 * The four severity scores as `[score, confidence]` pairs in SCORE_ORDER, so the bars never
 * reshuffle between beats and the names are written once, in the taxonomy table, instead of 988
 * times in the payload. A score the recording is missing becomes `[0, 0]` rather than a hole, so
 * the array is always four long and `scoreRows` can zip it against the order without checking.
 */
function scorePairs(answers: RawRecording['beats'][number]['answers']): ReplayScorePair[] {
  const raw = answers.score ?? {};
  return SCORE_ORDER.map((id) => {
    const hit = raw[id];
    return [hit?.score ?? 0, hit?.confidence ?? 0] as ReplayScorePair;
  });
}

/** The words for one answer: the label table, reached through the channel it was asked on. */
export function labelOf(answer: ReplayAnswer): string {
  return labelFor(answer.channel, answer.id);
}

/** A beat's scores as the page shows them: the taxonomy's name, then the two numbers. */
export function scoreRows(
  beat: Pick<ReplayBeat, 'scores'>,
): { id: string; label: string; score: number; confidence: number }[] {
  return SCORE_ORDER.map((id, i) => {
    const [score, confidence] = beat.scores[i] ?? [0, 0];
    return { id, label: SCORE_LABELS[id] ?? id, score, confidence };
  });
}

/**
 * Everything the client needs and nothing more.
 *
 * `excerpts` is optional by design: the excerpt files are not in git, so a deployment may well have
 * a recording and no lines for it. Every beat then has an empty `lines` and the page loses one
 * detail rather than failing.
 */
export function buildReplayPayload(
  recording: RawRecording,
  excerpts: RawExcerpts | null = null,
): ReplayPayload {
  const m = recording.meta;
  const beats = recording.beats.map((beat) => {
    // Lines exist only for flagged beats; the excerpt policy says so and the guard makes it true
    // here as well, so an excerpt file built under a different rule cannot quietly widen it.
    const lines = beat.flagged ? (excerpts?.[beat.id] ?? []) : [];
    return {
      id: beat.id,
      // `window_id` is not carried: a beat id is `W012.3`, so the window is its prefix. A derived
      // field in the payload is a second place for the same fact to be wrong.
      startMs: beat.start_ms,
      endMs: beat.end_ms,
      nCues: beat.n_cues,
      flagged: beat.flagged,
      loudCaption: beat.loud_caption,
      requestId: beat.request_id,
      top: topAnswers(beat.answers),
      scores: scorePairs(beat.answers),
      lines: lines.map((l) => ({ line: l.line, words: l.why?.words ?? [] })),
    } satisfies ReplayBeat;
  });

  return {
    meta: {
      film: m.film,
      model: m.model,
      modelReported: m.model_reported,
      taxonomy: m.taxonomy,
      startedAt: m.started_at,
      concurrency: m.concurrency,
      cues: m.cues,
      windows: m.windows,
      beats: m.beats,
      flaggedBeats: beats.filter((b) => b.flagged).length,
      questionsPerBeat: m.questions_per_beat,
      totalAnswers: m.total_answers,
      requests: m.requests,
      retries: m.retries,
      wallMs: m.wall_ms,
      inputTokens: m.input_tokens,
      outputTokens: m.output_tokens,
      costUsd: m.cost_usd,
      pricePerMtok: m.price_per_mtok,
      flagThreshold: recording.thresholds?.flag_threshold ?? DEFAULT_FLAG_THRESHOLD,
    },
    requests: recording.requests.map((r) => ({
      id: r.id,
      kind: r.kind,
      windowId: r.window_id,
      part: r.part,
      parts: r.parts,
      sentMs: r.sent_ms,
      receivedMs: r.received_ms,
      status: r.status,
      retries: r.retries,
      inputTokens: r.input_tokens,
      outputTokens: r.output_tokens,
      questions: r.questions,
      beats: r.beats,
    })),
    beats,
  };
}

/**
 * The same run with its evidence lines filled in from a later read of it.
 *
 * The live job page fetches its recording the moment Jev is finished, which is minutes before the
 * excerpts are written — so the payload it has been replaying all along has empty `lines` and would
 * keep them forever. When the film lands in the database its row has both, and this copies the
 * lines across rather than swapping the payload: the object the replay is animating must not be
 * replaced mid-run, and everything else in the two payloads is the same recording anyway.
 *
 * Returns the payload it was given, by reference, when there is nothing to add — so a component
 * holding it in state re-renders only when something actually arrived.
 */
export function withLines(payload: ReplayPayload, source: ReplayPayload): ReplayPayload {
  const lines = new Map(source.beats.filter((b) => b.lines.length > 0).map((b) => [b.id, b.lines]));
  if (lines.size === 0) return payload;

  let added = false;
  const beats = payload.beats.map((beat) => {
    const found = beat.lines.length === 0 ? lines.get(beat.id) : undefined;
    if (!found) return beat;
    added = true;
    return { ...beat, lines: found };
  });
  return added ? { ...payload, beats } : payload;
}

/**
 * Does this answer show as one of the reasons the beat is flagged?
 *
 * Only presence and event answers can flag a beat — the flag rule never looks at the mention
 * channel, because a character saying the word "shark" is not a shark being on screen. An 85%
 * mention wearing the trigger colour claims a rule that did not fire.
 */
export function triggersFlag(answer: ReplayAnswer, threshold: number): boolean {
  return answer.channel !== 'mention' && answer.p >= threshold;
}

// --- the clock -------------------------------------------------------------------------------

export type ReplayState = {
  /** Where the replay is on the recording's own clock, clamped to the run. */
  tMs: number;
  /** Request ids whose response has landed by now. */
  landed: Set<string>;
  inFlight: number;
  requestsDone: number;
  beatsKnown: number;
  beatsFlagged: number;
  inputTokens: number;
  outputTokens: number;
  /** Input tokens that have landed, priced at the recording's own rate. */
  costUsd: number;
  finished: boolean;
};

/**
 * The whole run as of `tMs`, recomputed from the requests rather than accumulated frame by frame.
 *
 * Deriving instead of accumulating is what makes a backgrounded tab, a dropped frame or a Replay
 * press harmless: there is no running total to fall behind, so the counters can only ever say what
 * has actually landed by now. It is also why `timeline[]` is not in the payload — it would be a
 * second, accumulated answer to the same question.
 *
 * Cost is input tokens × the recording's own `price_per_mtok`, which is exactly how `meta.cost_usd`
 * is computed, so the counter arrives at the published total rather than near it.
 */
export function replayStateAt(payload: ReplayPayload, atMs: number): ReplayState {
  const tMs = Math.min(Math.max(0, atMs), payload.meta.wallMs);
  const landed = new Set<string>();
  let inFlight = 0;
  let inputTokens = 0;
  let outputTokens = 0;

  for (const request of payload.requests) {
    if (request.receivedMs <= tMs) {
      landed.add(request.id);
      inputTokens += request.inputTokens;
      outputTokens += request.outputTokens;
    } else if (request.sentMs <= tMs) {
      inFlight += 1;
    }
  }

  let beatsKnown = 0;
  let beatsFlagged = 0;
  for (const beat of payload.beats) {
    if (!landed.has(beat.requestId)) continue;
    beatsKnown += 1;
    if (beat.flagged) beatsFlagged += 1;
  }

  return {
    tMs,
    landed,
    inFlight,
    requestsDone: landed.size,
    beatsKnown,
    beatsFlagged,
    inputTokens,
    outputTokens,
    costUsd: (inputTokens * payload.meta.pricePerMtok) / 1_000_000,
    finished: landed.size === payload.requests.length,
  };
}

/** The finished run: what the page renders with no JavaScript, and what it settles on. */
export function finishedState(payload: ReplayPayload): ReplayState {
  return replayStateAt(payload, payload.meta.wallMs);
}

// --- numbers as words --------------------------------------------------------------------------

/** "5.2 s". Under a second keeps a second decimal, because 0.5 s and 0.45 s are different news. */
export function formatSeconds(ms: number): string {
  const s = ms / 1000;
  return `${s < 1 ? s.toFixed(2) : s.toFixed(1)} s`;
}

/** "8¢". A run costs pennies; dollars with four leading zeros say nothing a person can hold. */
export function formatCents(usd: number): string {
  const cents = usd * 100;
  // Nothing spent is "0¢", not "0.00¢": the decimals exist to separate small amounts from each
  // other, and there is nothing to separate zero from.
  if (cents <= 0) return '0¢';
  if (cents >= 1) return `${Math.round(cents)}¢`;
  if (cents >= 0.1) return `${cents.toFixed(1)}¢`;
  return `${cents.toFixed(2)}¢`;
}

/** "2.0M", "577k", "412". Token counts are read, not audited; the exact figure is in the meta. */
export function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}k`;
  return String(n);
}

/** A probability as a whole percentage, the way the bars are labelled. */
export function formatProbability(p: number): string {
  return `${Math.round(p * 100)}%`;
}

/** The window a beat belongs to: `W012.3` → `W012`. An id without a dot is its own window. */
export function windowOf(beatId: string): string {
  const dot = beatId.indexOf('.');
  return dot === -1 ? beatId : beatId.slice(0, dot);
}

/** Where a beat sits along the film, as a percentage. A zero-length film puts everything at 0. */
export function beatLeftPct(startMs: number, filmMs: number): number {
  if (!filmMs || filmMs <= 0) return 0;
  return Math.min(100, Math.max(0, (startMs / filmMs) * 100));
}

/** The film's length as the recording knows it: the end of the last beat. */
export function filmLengthMs(payload: ReplayPayload): number {
  return payload.beats.reduce((max, b) => Math.max(max, b.endMs), 0);
}
