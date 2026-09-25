// "Watch it work": a live Jev run on a film whose Sonnet artifacts are already stored.
//
// The shapes are the scene API's (`/api/demo/*`), mirrored rather than reshaped, and the rules here
// are the pure part of the page — what a tile looks like, which sentence a refusal gets, what the
// comparison with the current guide says — so they can be tested without a browser.
//
// Every number the page shows comes from the API's answer: the counters are the stages' own
// done/total, the tiles turn when a scene's state says it was answered, and the elapsed time and the
// cost are the API's measurements. Nothing here counts on its own clock.

import { DEMO_LIVE, FILM } from './copy';
import { formatTime, type AgeBand } from './scenes';

/** `GET /api/demo/films`: a film whose Sonnet artifacts are stored, so Jev can run on it live. */
export type DemoFilm = {
  slug: string;
  title: string;
  year: number | null;
  poster: string | null;
  scene_count: number;
  cut_count: number;
  sentence_count: number;
  /** Whether the film's page in the library has a guide to compare this run with. */
  in_library: boolean;
  /** The film's slug in the library, when it is there (it can differ from `slug`). */
  library_slug?: string | null;
};

/**
 * `GET /api/demo/status`: whether a live run can start right now, and when not, why: `daily_cap` (the
 * day's budget), `busy` (every slot in use: temporary), `not_configured` (switched off here).
 */
export type DemoStatus = {
  spent_today_usd: number;
  cap_usd: number;
  available: boolean;
  reason?: 'daily_cap' | 'busy' | 'not_configured' | string;
  busy?: boolean;
  reserve_usd?: number;
};

export type DemoRunStatus = 'queued' | 'running' | 'done' | 'failed';
export type SceneState = 'pending' | 'asking' | 'answered';

export type DemoScene = {
  id: string;
  start_ms: number;
  end_ms: number;
  state: SceneState;
  /** null until the rules have run over the run's answers (the API's select stage). */
  flagged: boolean | null;
  strength_5_7: number | null;
  strength_8_10: number | null;
  /** Jev's verdict on the cut before this scene ('confirmed' | 'uncertain' | 'merge_candidate'), once in. */
  cut?: string | null;
  /** How many questions Jev has answered about this scene so far (absent from an older API). */
  questions?: number;
};

export type FeedItem = {
  kind: 'cut' | 'claim' | 'scene' | 'probe';
  text: string;
  /**
   * For a sentence: Jev's answer on whether its cited lines support it (`supported`, `unsupported`,
   * `contradicted`) — provisional; `final` says whether the guide kept it, once the run has decided.
   */
  verdict: string | null;
  /** A checked sentence's final fate, set when the run finishes: kept in the guide, or left out. */
  final?: 'kept' | 'left_out' | null;
  /** What a checked sentence was: a scene summary sentence, or a parent-facing title or description. */
  source?: 'summary' | 'title' | 'description';
  /**
   * When the item landed, in ms from the run's start (the scene API's meaning). It is NOT a place in
   * the film: the board places an item by its scene.
   */
  at_ms: number | null;
  /** The scene the item is about — for a cut, the scene the cut starts. */
  scene?: string | null;
};

/**
 * The scene a feed item is about: its `scene` field, or the scene id its text names ("Cut before
 * S012 at …", "S012 answered") when the API sends only the text. Null when neither says.
 */
export function feedScene(item: FeedItem): string | null {
  if (item.scene) return item.scene;
  return /\b(S\d{2,4})\b/.exec(item.text)?.[1] ?? null;
}

export type Reason = { label: string; by: 'jev' | 'sonnet'; p: number | null; category?: string | null };

/** One question behind a reason, with the answer it got (a combined reason lists each of its questions). */
export type WhyAnswer = {
  question: string;
  p: number | null;
  /** This answer decided the reason's score (the others were combined with it and scored lower). */
  decides?: boolean;
  /** `condition`: an answer the others count only when it passes `at`. */
  role?: 'condition';
  at?: number;
};

/**
 * One reason a scene is on the list, as the pipeline's `why_tags` carry it (v10.4 select.js): the
 * plain label, which model's answer raised it, that answer, and the rule that let it count. The
 * question and Jev's line are optional — an API that does not send them gets a page without them,
 * never an invented question.
 */
export type WhyTag = {
  label: string;
  /**
   * A film-specific reason's stable category ("Character in danger" for "Hogarth in danger"): the chip
   * says the category, the scene view says both. Null or absent when the label is already general.
   */
  category?: string | null;
  by: ('jev' | 'sonnet')[];
  /** Jev's answer, 0–1. For Sonnet the API's number stands for a yes and is not shown as a score. */
  p: number | null;
  /** The policy rule's code (select.js), e.g. `strong_event`; worded by `ruleSentence`. */
  rule: string | null;
  /** The question as it was asked. */
  question?: string | null;
  /** Jev's line: an answer at or above it counts as a yes. */
  act?: number | null;
  /** A reason that counts only alongside others: the labels it counted with. */
  with?: string[];
  /** Every question combined into this reason, each with its own answer (absent from an older API). */
  answers?: WhyAnswer[];
  /** How they were combined: `any` (the highest counts), `all` (every one must), `gate`, `one`. */
  how?: string | null;
};

export type Why = { line: string; tags: WhyTag[] };

/** A flagged scene's strength, as a number (older API) or per band (`{ '5_7', '8_10' }`). */
export type FlaggedStrength = number | null | { '5_7'?: number | null; '8_10'?: number | null };

export type FlaggedScene = {
  scene_id: string;
  start_ms: number;
  end_ms: number;
  title: string | null;
  description: string | null;
  reasons: Reason[];
  strength: FlaggedStrength;
  /** Every flagged scene says why (v10.4). Absent from an older API: `whyTags` falls back to `reasons`. */
  why?: Why | null;
};

/**
 * The run's guide against the film page's current one. `guide_scenes` is how many the page lists;
 * absent from an older API, when it is read as both + only_guide.
 */
export type Compare = { both: number; only_run: number; only_guide: number; guide_scenes?: number; run_scenes?: number };

/** The sentence checks' final outcome, when the run has finished (see `newProgress` in the scene API). */
export type ClaimsFinal = {
  summary: { checked: number; kept: number; left_out: number };
  descriptions: { scenes: number; with_text: number; with_title: number };
};

export type StageCount = { done: number; total: number };

export type DemoRun = {
  id?: string;
  status: DemoRunStatus;
  started_at: string | null;
  elapsed_ms: number | null;
  cost_usd: number | null;
  stages: {
    split_check: StageCount & { doubtful: number };
    classify: StageCount & { answers: number };
    claims: StageCount & { supported: number; unsupported: number; contradicted: number; final: ClaimsFinal | null };
    moments: StageCount;
  };
  scenes: DemoScene[];
  feed: FeedItem[];
  result?: {
    flagged: FlaggedScene[];
    compare: Compare | null;
    /** Whether the film was in the library when the run ended (`compare` is null exactly when not). */
    in_library?: boolean;
    split_check?: { pass: boolean; failed?: string[] } | null;
  } | null;
  /** The part of `cost_usd`'s spend that is an upper bound (a crashed attempt's mark), never a bill. */
  cost_uncertain_usd?: number | null;
  /** The run's film, by the run itself (authoritative). */
  slug?: string | null;
  /** The stage the run is in — for a failed run, the stage it failed in (DEMO_STAGES ids). */
  stage?: string | null;
  /** Not in the contract's list, but read when present: a failed run's reason, and the film. */
  error_code?: string | null;
  /** A failed run's reason, one sentence written by the API for this page. */
  error?: string | null;
  film?: { slug: string; title: string; year: number | null; in_library?: boolean; library_slug?: string | null } | null;
};

const count = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0);

/**
 * The run as this page draws it, whatever the API left out. Before a run's first write the API sends
 * `stages: null` and no scenes; a stage it has not planned yet is 0 of 0 — drawn as a dash, never as
 * a finished zero. Nothing is invented: every number kept is the API's.
 */
export function normalizeRun(raw: unknown): DemoRun {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const st = (r.stages && typeof r.stages === 'object' ? r.stages : {}) as Record<string, Record<string, unknown> | undefined>;
  const stage = (k: string) => ({ done: count(st[k]?.done), total: count(st[k]?.total) });
  const status = (['queued', 'running', 'done', 'failed'] as const).find((x) => x === r.status) ?? 'queued';
  return {
    ...(r as Partial<DemoRun>),
    status,
    started_at: typeof r.started_at === 'string' ? r.started_at : null,
    elapsed_ms: typeof r.elapsed_ms === 'number' ? r.elapsed_ms : null,
    cost_usd: typeof r.cost_usd === 'number' ? r.cost_usd : null,
    stages: {
      split_check: { ...stage('split_check'), doubtful: count(st.split_check?.doubtful) },
      classify: { ...stage('classify'), answers: count(st.classify?.answers) },
      claims: {
        ...stage('claims'),
        supported: count(st.claims?.supported),
        unsupported: count(st.claims?.unsupported),
        contradicted: count(st.claims?.contradicted),
        final: (st.claims?.final as ClaimsFinal | null | undefined) ?? null,
      },
      moments: stage('moments'),
    },
    scenes: Array.isArray(r.scenes) ? (r.scenes as DemoScene[]) : [],
    feed: Array.isArray(r.feed) ? (r.feed as FeedItem[]) : [],
  };
}

/**
 * Why a flagged scene is on the list: the pipeline's tags when the API sends them, else its reasons
 * read as tags (one per label, first seen first) — so an older API still shows every reason.
 */
export function whyTags(f: Pick<FlaggedScene, 'why' | 'reasons'>): WhyTag[] {
  if (f.why?.tags?.length) return f.why.tags;
  const out: WhyTag[] = [];
  for (const r of f.reasons ?? []) {
    const hit = out.find((t) => t.label.toLowerCase() === r.label.toLowerCase());
    if (hit) {
      if (!hit.by.includes(r.by)) hit.by.push(r.by);
      continue;
    }
    out.push({ label: r.label, by: [r.by], p: r.p, rule: null });
  }
  return out;
}

/** "Creature threatens · Child in danger": the tags as one line. */
export function whyLine(f: Pick<FlaggedScene, 'why' | 'reasons'>): string {
  return f.why?.line || whyTags(f).map((t) => t.label).join(' · ');
}

/** Which of the two models answered for a scene, from its tags. */
export function answeredBy(f: Pick<FlaggedScene, 'why' | 'reasons'>): { jev: boolean; sonnet: boolean } {
  const by = new Set(whyTags(f).flatMap((t) => t.by));
  return { jev: by.has('jev'), sonnet: by.has('sonnet') };
}

/** Does Jev's answer clear its line? Only said when both numbers are known. */
export function passesLine(tag: Pick<WhyTag, 'p' | 'act'>): boolean | null {
  if (tag.p === null || tag.p === undefined || tag.act === null || tag.act === undefined) return null;
  return tag.p >= tag.act;
}

/** "0.88" — an answer as Jev gave it. */
export function formatAnswer(p: number | null | undefined): string {
  return p === null || p === undefined || Number.isNaN(p) ? '—' : p.toFixed(2);
}

/**
 * Same as the film page's guide? `same` when the two lists match scene for scene (the API matches one
 * to one, so the counts are equal too); `none` ONLY when the film is confirmed not in the library;
 * `unknown` when we cannot say (the film's details did not load, or no comparison came back) — never
 * "not in the library" on a guess.
 *
 * `inLibrary`: true / false when known (the run's own answer first, then the films list), null when not.
 */
export type Sameness =
  | { kind: 'none' }
  | { kind: 'unknown' }
  | { kind: 'same'; scenes: number }
  | { kind: 'differs'; both: number; onlyRun: number; onlyGuide: number; guide: number };

export function sameness(compare: Compare | null | undefined, inLibrary: boolean | null): Sameness {
  if (compare) {
    const guide = compare.guide_scenes ?? compare.both + compare.only_guide;
    if (compare.only_run === 0 && compare.only_guide === 0 && (compare.run_scenes === undefined || compare.run_scenes === guide)) {
      return { kind: 'same', scenes: compare.both };
    }
    return { kind: 'differs', both: compare.both, onlyRun: compare.only_run, onlyGuide: compare.only_guide, guide };
  }
  if (inLibrary === false) return { kind: 'none' };
  return { kind: 'unknown' };
}

/** Is the run's film in the library? The run's own answer, then the films list, else unknown (null). */
export function runInLibrary(run: Pick<DemoRun, 'result' | 'film'>, listed: DemoFilm | null | undefined): boolean | null {
  if (typeof run.result?.in_library === 'boolean') return run.result.in_library;
  if (typeof run.film?.in_library === 'boolean') return run.film.in_library;
  if (listed) return listed.in_library;
  return null;
}

/** Still worth polling? */
export function isRunLive(status: DemoRunStatus): boolean {
  return status === 'queued' || status === 'running';
}

/** The scenes in film order. The API sends them that way; a board drawn from them must not depend on it. */
export function inFilmOrder(scenes: DemoScene[]): DemoScene[] {
  return [...scenes].sort((a, b) => a.start_ms - b.start_ms);
}

/** Where the board's time axis ends: the end of the last scene. */
export function filmEndMs(scenes: DemoScene[]): number {
  return scenes.reduce((max, scene) => Math.max(max, scene.end_ms), 0);
}

/** A position along the board, as a percentage, clamped. A zero-length film puts everything at 0. */
export function pct(ms: number, endMs: number): number {
  if (!endMs || endMs <= 0) return 0;
  return Math.min(100, Math.max(0, (ms / endMs) * 100));
}

/** Sonnet's cuts: the start of every scene but the first, in film order. */
export function cutPositions(scenes: DemoScene[]): number[] {
  return inFilmOrder(scenes)
    .slice(1)
    .map((scene) => scene.start_ms);
}

export function strengthFor(scene: Pick<DemoScene, 'strength_5_7' | 'strength_8_10'>, band: AgeBand): number | null {
  const value = band === '8-10' ? scene.strength_8_10 : scene.strength_5_7;
  return value === null || value === undefined ? null : Math.min(3, Math.max(0, value));
}

/**
 * What one scene's tile shows. Only what the run has said: a scene not yet asked is `pending`, one
 * whose questions are out is `asking`, an answered one is `answered` until the rules have run over it
 * and then `clear` or `flagged`. A flagged scene
 * without a strength for this band is `unrated` — "Not checked", never drawn as a zero.
 */
export type TileKind = 'pending' | 'asking' | 'answered' | 'clear' | 'flagged' | 'unrated';

export function tileKind(scene: DemoScene, band: AgeBand): TileKind {
  if (scene.state !== 'answered') return scene.state;
  // Answered, but the rules have not run yet: neither on the list nor off it.
  if (scene.flagged === null || scene.flagged === undefined) return 'answered';
  if (!scene.flagged) return 'clear';
  return strengthFor(scene, band) === null ? 'unrated' : 'flagged';
}

/** The tile's height in px on the 86 px board: taller where stronger. */
export function tileHeightPx(kind: TileKind, strength: number | null): number {
  if (kind !== 'flagged') return 18;
  return [26, 36, 58, 86][strength ?? 0];
}

/** "3 / 50": a stage's progress, or a dash before the API has said how many there are. */
export function countLabel(stage: StageCount | undefined): string {
  if (!stage || !stage.total) return '—';
  return `${Math.min(stage.done, stage.total)} / ${stage.total}`;
}

/** The share of a stage that is done, 0–1. Nothing known is 0, not 1. */
export function stageShare(stage: StageCount | undefined): number {
  if (!stage || !stage.total) return 0;
  return Math.min(1, Math.max(0, stage.done / stage.total));
}

/** The newest `n` items of one kind, newest first. The API appends in the order they landed. */
export function latest(feed: FeedItem[], kind: FeedItem['kind'], n: number): FeedItem[] {
  return feed.filter((item) => item.kind === kind).slice(-n).reverse();
}

/** Was this claim kept? The API's verdict words, read generously; anything unknown is not "kept". */
export function claimKept(verdict: string | null): boolean {
  return verdict !== null && /^(supported|kept|ok|verified|accepted)$/i.test(verdict);
}

/**
 * A checked sentence's outcome: Jev's answer (supported by its cited lines, or not), or not checked at all
 * (no verdict, or Jev gave no answer) — which is not the same news as "not supported". Jev's answer is
 * provisional; `finalOutcome` says what the guide did with the sentence once the run has decided.
 */
export function claimOutcome(verdict: string | null): 'kept' | 'left' | 'unchecked' {
  if (verdict === null || /^(no_answer|unchecked|error|failed|skipped)$/i.test(verdict)) return 'unchecked';
  return claimKept(verdict) ? 'kept' : 'left';
}

/** What the guide did with a checked sentence, once the run has finished; null before then. */
export function finalOutcome(item: Pick<FeedItem, 'final'>): 'kept' | 'left_out' | null {
  return item.final === 'kept' || item.final === 'left_out' ? item.final : null;
}

/**
 * The chips a list row shows: each reason by its stable category (a film-specific reason's category,
 * else its own label), repeats merged, at most `max` of them, and how many more there are.
 */
export function reasonChips(f: Pick<FlaggedScene, 'why' | 'reasons'>, max = 3): { chips: string[]; more: number } {
  const all: string[] = [];
  for (const t of whyTags(f)) {
    const label = (t.category ?? t.label).trim();
    if (label && !all.some((x) => x.toLowerCase() === label.toLowerCase())) all.push(label);
  }
  return { chips: all.slice(0, max), more: Math.max(0, all.length - max) };
}

/**
 * What a flagged scene is called: its checked title; else where it starts ("Scene starting at 0:10:53").
 * Its reasons are shown beside it, never stitched into a title that would read like a summary.
 */
export function flaggedHeading(f: Pick<FlaggedScene, 'title' | 'start_ms'>): string {
  return checkedTitle(f) ?? FILM.untitledScene(formatTime(f.start_ms));
}

/** A flagged scene's own title, when one passed its checks; null for none (or the pipeline's placeholder). */
export function checkedTitle(f: Pick<FlaggedScene, 'title'>): string | null {
  const title = f.title?.trim();
  return title && title !== 'Flagged scene' ? title : null;
}

/**
 * The comparison with the saved guide, in one line for beside the count: "The saved guide lists the same
 * 11 scenes." / "Compared with the saved guide: 1 extra scene, none missing."
 */
export function compareLine(same: Sameness, runScenes: number): string {
  switch (same.kind) {
    case 'same':
      return DEMO_LIVE.sameYes(same.scenes);
    case 'differs':
      return same.onlyRun === 0 && same.onlyGuide === 0
        ? DEMO_LIVE.sameCounts(runScenes, same.guide)
        : DEMO_LIVE.sameDiffers(same.onlyRun, same.onlyGuide);
    case 'none':
      return DEMO_LIVE.sameNone;
    default:
      return DEMO_LIVE.sameUnknown;
  }
}

/** Failures that were Jev's to finish (the API's error codes); anything else is said generally. */
const JEV_FAILURES: Record<string, string> = {
  split_check_failed: 'checking the scene breaks',
  jev_answers_failed: 'answering its questions about the scenes',
  jev_check_failed: 'checking the scene descriptions',
};

/**
 * A failed run in one sentence: which of Jev's jobs it could not finish ("Jev could not finish checking
 * the scene breaks."), from the stage it stopped in, else its error code; and that the saved guide is
 * untouched. A failure that was not Jev's (ours, a timeout, an unknown code) is said generally.
 */
export function failedLead(run: Pick<DemoRun, 'stage' | 'error_code'>): string {
  const code = run.error_code ?? '';
  if (!(code in JEV_FAILURES)) return DEMO_LIVE.failedBody;
  const what = (run.stage && DEMO_LIVE.failedStage[run.stage]) || JEV_FAILURES[code];
  return DEMO_LIVE.failedJev(what);
}

/** Do the two age bands rate every flagged scene the same? (The page says so, rather than look broken.) */
export function bandsAgree(run: DemoRun): boolean {
  const flagged = run.result?.flagged ?? [];
  return flagged.length > 0 && flagged.every((f) => flaggedStrength(run, f, '5-7') === flaggedStrength(run, f, '8-10'));
}

/** Did Jev doubt this cut (think it may not be a real change of scene)? */
export function cutDoubted(verdict: string | null): boolean {
  return verdict !== null && /doubt|merge|not_a_cut|reject/i.test(verdict);
}

/**
 * A stage's count while it may still grow: "191 sentences checked" (no fraction, which could look like
 * it was finished and then went backwards); "208 / 208" only once the run has finished.
 */
export function growingCount(stage: StageCount | undefined, finished: boolean, noun: (n: number) => string): string {
  if (!stage || (!stage.total && !stage.done)) return '—';
  if (finished && stage.total) return `${Math.min(stage.done, stage.total)} / ${stage.total}`;
  return noun(stage.done);
}

/** A scene's position in film order, 1-based, and how many there are. */
export function sceneNumber(scenes: DemoScene[], id: string): { n: number; of: number } | null {
  const ordered = inFilmOrder(scenes);
  const index = ordered.findIndex((scene) => scene.id === id);
  return index === -1 ? null : { n: index + 1, of: ordered.length };
}

/** The flagged-scene record for a scene, once the run's result names it. */
export function flaggedFor(run: DemoRun, id: string): FlaggedScene | null {
  return run.result?.flagged.find((f) => f.scene_id === id) ?? null;
}

/** "0:33:17–0:36:06". */
export function spanLabel(startMs: number, endMs: number): string {
  return `${formatTime(startMs)}–${formatTime(endMs)}`;
}

/**
 * The run's flagged scenes, strongest-first counts for one band — "8 very strong · 5 strong · 2 mild"
 * — with "not checked" as its own entry, never folded into a level.
 */
export function flaggedBreakdown(
  run: DemoRun,
  band: AgeBand,
): { value: number | null; count: number }[] {
  const flagged = run.result?.flagged ?? [];
  const byId = new Map(run.scenes.map((scene) => [scene.id, scene]));
  const values = flagged.map((f) => {
    const scene = byId.get(f.scene_id);
    return scene ? strengthFor(scene, band) : resultStrength(f.strength, band);
  });
  const out: { value: number | null; count: number }[] = [];
  for (const value of [3, 2, 1, 0]) {
    const count = values.filter((v) => v === value).length;
    if (count) out.push({ value, count });
  }
  const unknown = values.filter((v) => v === null || v === undefined).length;
  if (unknown) out.push({ value: null, count: unknown });
  return out;
}

/** The strength of a flagged scene for a band: the scene's own value, or the result's when the scene is gone. */
export function flaggedStrength(run: DemoRun, flagged: FlaggedScene, band: AgeBand): number | null {
  const scene = run.scenes.find((s) => s.id === flagged.scene_id);
  return scene ? strengthFor(scene, band) : resultStrength(flagged.strength, band);
}

/** The result's own strength for a band, whichever shape the API sent. */
export function resultStrength(strength: FlaggedStrength, band: AgeBand): number | null {
  if (strength === null || strength === undefined) return null;
  if (typeof strength === 'number') return strength;
  const v = band === '8-10' ? strength['8_10'] : strength['5_7'];
  return v === null || v === undefined ? null : v;
}

/** A refusal to start a run: one plain sentence, and a way onward where there is one. */
export type RunRefusal = { kind: 'cap' | 'busy' | 'too_many' | 'not_ready' | 'unreachable' | 'bad'; text: string };

/**
 * `POST /api/demo/runs`, refused. The cap and the per-visitor limit share a 429, so only the code
 * tells them apart — read as budget, a throttled visitor would be told to come back tomorrow.
 */
export function runRefusal(status: number, body: Record<string, unknown>): RunRefusal {
  if (status === 429 && body.error_code === 'too_many_runs') return { kind: 'too_many', text: DEMO_LIVE.tooManyRuns };
  if (status === 429) return { kind: 'cap', text: DEMO_LIVE.capBody };
  if (status === 503 && body.error_code === 'not_configured') return { kind: 'unreachable', text: DEMO_LIVE.offBody };
  if (status === 409 && body.error_code === 'busy') return { kind: 'busy', text: DEMO_LIVE.busy };
  if (status === 404 || body.error_code === 'not_ready' || body.error_code === 'not_found') {
    return { kind: 'not_ready', text: DEMO_LIVE.notReadyBody };
  }
  if (status === 400 || status === 413) return { kind: 'bad', text: DEMO_LIVE.notReadyBody };
  return { kind: 'unreachable', text: DEMO_LIVE.downBody };
}

/**
 * What the page says it can do, from the two reads it makes before drawing the picker. Each reason the
 * API gives for "not now" is its own news: the day's budget is used up (`cap`), every slot is in use
 * for a minute (`busy`: try again), live checks are switched off here (`off`).
 */
export type PickState = 'live' | 'cap' | 'busy' | 'off' | 'down' | 'empty';

export function pickState(films: DemoFilm[] | null, status: DemoStatus | null): PickState {
  if (films === null || status === null) return 'down';
  if (films.length === 0) return 'empty';
  if (status.available) return 'live';
  // An explicit reason is the news; `busy` only speaks when the API gives no other reason (a run's
  // slots can be full on a day whose budget is also spent, and that is not "try again in a minute").
  if (status.reason === 'daily_cap') return 'cap';
  if (status.reason === 'not_configured') return 'off';
  if (status.reason === 'busy' || status.busy) return 'busy';
  return 'cap';
}

/** "9.8 s" from the API's measurement; one decimal under a minute, whole seconds after. */
export function formatRunTime(ms: number | null): string {
  if (ms === null || ms < 0) return '—';
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
  const total = Math.round(ms / 1000);
  return `${Math.floor(total / 60)} min ${String(total % 60).padStart(2, '0')} s`;
}

/**
 * A run's cost as measured, and — when a crashed attempt left some of it as an upper bound — "up to"
 * the larger figure: "2.1¢", or "2.1¢ (up to 2.5¢)". Never the uncertain part shown as a bill.
 */
export function formatRunCost(run: Pick<DemoRun, 'cost_usd' | 'cost_uncertain_usd'>): string {
  const base = formatCost(run.cost_usd);
  const extra = run.cost_uncertain_usd;
  if (run.cost_usd === null || !extra || extra <= 0) return base;
  return `${base} (up to ${formatCost(run.cost_usd + extra)})`;
}

/** Cents under a dollar, dollars over: "2.1¢", "$1.20". Nothing known is a dash, not zero. */
export function formatCost(usd: number | null): string {
  if (usd === null || usd === undefined || Number.isNaN(usd)) return '—';
  if (usd < 1) return `${(usd * 100).toFixed(1)}¢`;
  return `$${usd.toFixed(2)}`;
}

/** Thousands with a separator, fixed locale so the server and the browser draw the same string. */
export function formatCount(n: number): string {
  return Math.max(0, Math.round(n)).toLocaleString('en-US');
}
