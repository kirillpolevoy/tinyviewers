// A demo run: Jev's stages of the Jev-first pipeline (v10.4), LIVE, on a film whose Sonnet work is stored.
//
// What runs, in run-film.js's order (stages/index.js DEMO_STAGES):
//   split_check      Jev's gate on the stored accepted cut                          (live Jev)
//   claims + fill    Jev's claim check of Sonnet's cited sentences and stored fill   (live Jev)
//   refold           the acceptance rule                                            (code)
//   classify         Jev answers its questions per scene                            (live Jev)
//   sonnetq          Sonnet's STORED answers to its ten concepts (not asked again; refused when incomplete)
//   childcry         Jev: is the one who cries a child?                             (live Jev)
//   resolve          Jev: does the scene end in an arrest / a celebration?          (live Jev)
//   mortal           Jev: a deadly fall? a bomb about to go off?                    (live Jev)
//   select1          the flag policy                                                (code)
//   moments          Jev's exact moments in each flagged scene                      (live Jev)
//   describe         Sonnet's STORED descriptions (not written again)
//   check_describe   Jev checks those descriptions for today's flagged scenes       (live Jev)
//   describe2/titles Sonnet's STORED second attempt / title pass, for the scenes today's checks retry
//   check_describe2/3 Jev checks them                                               (live Jev)
//   mergetext        the text rule A0>C                                             (code)
//   select3          flags + spans + the checked text + why tags                    (code)
// Sonnet is never called: a demo context carries no Anthropic key at all.
//
// Resumable, like an add job (runner.js), because a run is paid work that must survive a slow invocation
// or a crash:
//   * one invocation at a time holds the run's LEASE (a conditional UPDATE of demo_runs); the lease is
//     short and renewed by a heartbeat, so a crashed invocation's run can be taken over within a minute;
//   * every finished stage CHECKPOINTS its output (demo_run_stages) and the progress document as it
//     stood then (demo_runs.checkpoint); a later invocation reads them and never re-runs a finished stage;
//   * an invocation that runs short of time hands off: it releases the lease and asks for the next one
//     with the same authenticated self-call add jobs use (lib/jevfirst.js requestContinuation, path
//     /api/demo/runs/{id}/continue, secret ADD_FILM_PROXY_SECRET), and a poll of GET /api/demo/runs/{id}
//     that finds the run quiet asks again (lib/demo.js);
//   * a stage cut short is re-run from its start; the progress it had drawn is put back to the last
//     checkpoint, so no counter ever counts a check twice;
//   * every write an invocation makes is FENCED by its lease (where lease_owner = me): an invocation whose
//     lease lapsed and was taken over can write nothing -- no progress, no stage output, no checkpoint, no
//     end. A stage's output and the checkpoint naming it are one statement, so they land together or not
//     at all. An invocation ending (finished, failed, handing off) drains its queued writes while its
//     heartbeat still holds the lease, and only then writes its end; it deletes the run's checkpoints
//     only when that owner-conditional end actually changed the row (otherwise they are the new owner's).
//
// Honesty rules the page depends on, enforced here:
//   * every counter is a count of requests that really completed (onResult), every total the real
//     number of requests planned; nothing is animated from a guess, nothing is replayed;
//   * a sentence's live verdict is Jev's support answer, reported as such (supported / unsupported);
//     whether it ends up in the guide is decided later (placement, direction, the A0>C text rule), and
//     the run reconciles its feed and counts with those final decisions when it finishes;
//   * a run that fails says which stage and why; a cut the gate does not pass today is reported;
//   * the film page's guide is never changed by a demo: the run writes only its own rows.
//
// Money: the run's reservation (demoReserveFor) is taken at admission and is ALSO the run's ceiling: each
// stage's wallet is min(its cap, what is left of the reservation). No request goes out until a spending
// mark covering it is durable (demo_runs.mark_usd), so a crashed invocation's in-flight requests are
// carried into the run's spend at that mark -- an upper bound, reported as such (uncertain_usd). The same
// goes for a request that went out and never answered, or a 200 whose body could not be read: charged at
// its reservation (the Jev client's onSpend says which part is an upper bound), and that part is uncertain.
import crypto from 'node:crypto';
import { budget } from './pack/budget.js';
import { withRun, runCtx } from './context.js';
import { DEMO_STAGES } from './stages/index.js';
import { Interrupted, quoteGrams } from './stages/common.js';
import { guideRows, whyTagsOf, reasonCategory, withTitles } from './stages/ingest.js';
import { readArtifacts, readTrack, getJevfirstFilm, DEMO_KINDS, DEMO_OPTIONAL_KINDS } from './store.js';
import { verdictOf, DEFAULT_RULE } from './pack/claims.js';
import { boundaryVerdict } from './pack/gate.js';
import { probOf } from './pack/jev-client.js';
import { POLICY } from './stages/common.js';
import { DEMO_STAGE_CAPS } from './caps.js';
import { PipelineError, errorSummary } from '../pipeline/errors.js';
import { formatTime } from './srt.js';
import { whyDetail } from './why-detail.js';
import { localBudgetMs } from './runner.js';
import { strengthOf } from './strength.js';

export const DEMO_BUDGET_MS = 240_000;   // no stage STARTS after this much of an invocation
export const DEMO_HARD_MS = 285_000;     // every in-flight call is aborted here; the stage resumes next time
export const DEMO_LEASE_MS = 60_000;     // renewed by the heartbeat; a crashed invocation's lease lapses in a minute
export const DEMO_HEARTBEAT_MS = 10_000;
export const DEMO_MAX_CRASHES = 3;
/** How many seconds of an invocation a demo stage may need (a code stage: a few). */
const STAGE_EST_S = { refold: 5, sonnetq: 5, select1: 5, select2: 5, describe: 5, describe2: 5, titles: 5, mergetext: 5, select3: 5 };
const estOf = (id) => STAGE_EST_S[id] ?? 60;
/** The feed keeps the newest FEED_PER_KIND items of EACH kind, so 39 'scene answered' items cannot push every checked sentence out of it. */
export const FEED_PER_KIND = 12;
/** Trim the feed to the newest FEED_PER_KIND of each kind, in order. Mutates `p.feed`. */
export function trimFeed(p) {
  const seen = {};
  const keep = new Array(p.feed.length).fill(false);
  for (let i = p.feed.length - 1; i >= 0; i--) {
    const k = p.feed[i].kind;
    seen[k] = (seen[k] ?? 0) + 1;
    keep[i] = seen[k] <= FEED_PER_KIND;
  }
  p.feed = p.feed.filter((_, i) => keep[i]);
}
const round6 = (n) => Math.round(n * 1e6) / 1e6;
const GATE = { ...POLICY.split_gate };
const parsed = (v) => (typeof v === 'string' ? JSON.parse(v) : v);
/** Rows a fenced (`returning id`) statement changed: 0 means the run is not this invocation's any more. */
const changed = (res) => res?.rows?.length ?? 0;

/**
 * The most one demo run of a film may cost: the sum of the Jev stage caps a demo runs under
 * (caps.js DEMO_STAGE_CAPS). The run is held to it (each wallet is min(cap, reservation left)).
 */
export const demoReserveFor = () => round6(Object.values(DEMO_STAGE_CAPS).reduce((a, b) => a + b, 0));

/** Overlap of two intervals as a share of the shorter one. */
const overlapShare = (a0, a1, b0, b1) => {
  const o = Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));
  const shorter = Math.max(1, Math.min(a1 - a0, b1 - b0));
  return o / shorter;
};

/**
 * How far apart two scenes' edges may be and still be "the same scene": each edge (start and end) within
 * min_ms, or within `share` of the longer scene when that is more. Overlap alone is not enough: a 0-1000 s
 * run scene covers all of a 0-100 s guide scene, but it is not that scene.
 */
export const COMPARE_TOLERANCE = { min_ms: 20_000, share: 0.25 };
const edgesAgree = (a0, a1, b0, b1) => {
  const tol = Math.max(COMPARE_TOLERANCE.min_ms, COMPARE_TOLERANCE.share * Math.max(a1 - a0, b1 - b0));
  return Math.abs(a0 - b0) <= tol && Math.abs(a1 - b1) <= tol;
};

/**
 * This run's flagged scenes against the film page's current guide (the library's scenes), by time, ONE
 * TO ONE: a run scene and a guide scene are the same scene when they overlap by at least half of the
 * shorter one AND their edges agree within COMPARE_TOLERANCE, and each scene of either list is matched at
 * most once (the best overlaps first), so one long run scene can never stand for two guide scenes.
 * "The same scenes" is claimable only when both lists have the same number of scenes and every one is
 * matched (only_run = only_guide = 0).
 * null when the film has no guide in the library -- that is "nothing to compare with", not zero.
 */
export function compareWithGuide(runRows, guide) {
  if (!guide) return null;
  const pairs = [];
  runRows.forEach((r, i) => guide.forEach((g, j) => {
    const share = overlapShare(r.start_ms, r.end_ms, g.start_ms, g.end_ms);
    if (share >= 0.5 && edgesAgree(r.start_ms, r.end_ms, g.start_ms, g.end_ms)) pairs.push({ i, j, share });
  }));
  pairs.sort((a, b) => b.share - a.share || a.i - b.i || a.j - b.j);
  const usedRun = new Set();
  const usedGuide = new Set();
  for (const p of pairs) {
    if (usedRun.has(p.i) || usedGuide.has(p.j)) continue;
    usedRun.add(p.i);
    usedGuide.add(p.j);
  }
  const both = usedRun.size;
  return { both, only_run: runRows.length - both, only_guide: guide.length - both, guide_scenes: guide.length, run_scenes: runRows.length };
}

/** The library film a demo film is (by IMDb id, else slug), or null: { id, slug, title, year }. */
export async function libraryFilm(db, film) {
  const imdb = String(film.imdb_id ?? '').toLowerCase();
  const { rows } = await db.query('select id, slug, title, year, (lower(imdb_id) = $1) as by_imdb from films where lower(imdb_id) = $1 or slug = $2', [imdb, film.slug]);
  return rows.find((r) => r.by_imdb) ?? rows[0] ?? null;
}

async function libraryGuide(db, film) {
  const lib = await libraryFilm(db, film);
  if (!lib) return null;
  const { rows } = await db.query('select id, start_ms, end_ms from scenes where film_id = $1 order by start_ms', [lib.id]);
  return rows.map((r) => ({ id: r.id, start_ms: Number(r.start_ms), end_ms: Number(r.end_ms) }));
}

/** The live progress document the page polls, and how each completed request moves it. */
export function newProgress() {
  return {
    stage: null,
    stages: {
      // done/total count the CUTS Jev checks (one boundary question each); doubtful the cuts it thinks are
      // not real (merge candidates). The alignment and inside-scene probes it also runs are in
      // requests_done/requests_total.
      split_check: { done: 0, total: 0, doubtful: 0, requests_done: 0, requests_total: 0 },
      // done/total count the SENTENCES Jev checks against their cited lines (Sonnet's cited scene
      // sentences, titles and descriptions: claim and describe_support requests, one sentence each).
      // supported / unsupported / contradicted are Jev's ANSWERS, provisional: a sentence's place in the
      // guide is decided later (placement, direction, the text rule) and reported in `final` when the run
      // ends. The other checks behind them (placement, direction, neighbour, fill) are in requests_*.
      claims: { done: 0, total: 0, supported: 0, unsupported: 0, contradicted: 0, requests_done: 0, requests_total: 0, final: null },
      classify: { done: 0, total: 0, answers: 0 },
      moments: { done: 0, total: 0 },
    },
    scenes: [],
    feed: [],
    feed_total: 0,
    credits: null,
  };
}

const BUCKET = {
  align: 'split_check', boundary: 'split_check', probe: 'split_check',
  claim: 'claims', placement: 'claims', fill_support: 'claims', fill_own: 'claims', fill_neighbour: 'claims',
  describe_support: 'claims', describe_placement: 'claims', describe_direction: 'claims', describe_reason: 'claims', describe_states: 'claims',
  describe_wsupport: 'claims', describe_neighbour: 'claims', describe_rplace: 'claims',
  classify: 'classify', childcry: 'classify', resolve: 'classify', resolve_r1: 'classify', mortal: 'classify', moments: 'moments',
};
/** Which request kinds a stage's done/total count (see newProgress); every other kind is a request only. */
export const COUNTED_KINDS = { split_check: new Set(['boundary']), claims: new Set(['claim', 'describe_support']) };
/** How many of a stage's planned requests its done/total count, from the `kinds` a stage reports. */
export const countedTotal = (stage, total, kinds) => (COUNTED_KINDS[stage] ? Object.entries(kinds ?? {}).reduce((a, [k, n]) => a + (COUNTED_KINDS[stage].has(k) ? n : 0), 0) : total);
/** How many questions one completed request answered, for the classify counter. */
const questionsOf = (meta, result) => meta.questions ?? (result?.json?.answers ? Object.keys(result.json.answers).length : 0);

/** Jev's support answer as the feed words it: supported / unsupported / contradicted. */
const supportWord = (status) => (status === 'verified' ? 'supported' : status === 'contradicted' ? 'contradicted' : 'unsupported');

/**
 * Apply one completed request to the progress document. Pure (returns nothing; mutates `p`).
 * A feed item's `at_ms` is WHERE IN THE FILM it is (a cut's time, its scene's start); `t_ms` is when in
 * the run it landed.
 */
export function applyResult(p, meta, result, { atMs, cues = null }) {
  const bucket = BUCKET[meta.kind];
  if (!bucket) return;
  const st = p.stages[bucket];
  // A request that came back without an answer (an error, a refusal) is not a check that was done: it
  // is counted as failed, so a counter never shows a cut or a sentence as checked when Jev never answered.
  if (!result?.ok) { st.failed = (st.failed ?? 0) + 1; return; }
  if (COUNTED_KINDS[bucket]) {
    st.requests_done = (st.requests_done ?? 0) + 1;
    if (COUNTED_KINDS[bucket].has(meta.kind)) st.done++;
  } else st.done++;
  const sceneOf = meta.scene ?? meta.job?.claims?.[0]?.target?.scene ?? null;
  const sceneStart = (id) => p.scenes.find((x) => x.id === id)?.start_ms ?? null;
  const feed = (entry) => { p.feed.push({ scene: sceneOf, at_ms: sceneOf ? sceneStart(sceneOf) : null, ...entry, t_ms: atMs }); p.feed_total++; trimFeed(p); };
  const answers = result.json?.answers ?? {};
  if (meta.kind === 'boundary') {
    const pb = probOf(answers.boundary);
    const verdict = pb !== null ? boundaryVerdict(pb, GATE) : 'no_answer';
    // A doubted cut is one Jev thinks is not a real change of scene (merge_candidate).
    // 'uncertain' is neither, and the gate does not hold it against the cut.
    if (verdict === 'merge_candidate') st.doubtful++;
    // Kept on the scene too, so a page opened (or reloaded) after the feed has moved on still draws every cut.
    const cutScene = p.scenes.find((x) => x.id === meta.scene);
    if (cutScene) cutScene.cut = verdict;
    const cue = cues?.[meta.at - 1];
    feed({ kind: 'cut', text: `Cut before ${meta.scene}${cue ? ` at ${formatTime(cue.startMs).slice(0, 8)}` : ''}`, verdict, ...(cue ? { at_ms: cue.startMs } : {}) });
  } else if (meta.kind === 'probe') {
    const pp = probOf(answers.boundary);
    // Another cut inside a scene is not a doubt about the cut before it: its own feed kind, its own count.
    if (pp !== null && pp >= GATE.split_at) { st.inside = (st.inside ?? 0) + 1; feed({ kind: 'probe', text: `Jev sees another cut inside ${meta.scene}`, verdict: 'split_candidate' }); }
  } else if (meta.kind === 'claim' || meta.kind === 'describe_support') {
    const v = verdictOf(answers.r0, meta.rule ?? DEFAULT_RULE);
    const word = supportWord(v.status);
    st[word] = (st[word] ?? 0) + 1;
    // Fed only when it belongs to a scene: the page shows a sentence against that scene's lines. The
    // verdict is Jev's answer; `final` (kept / left out of the guide) is filled in when the run ends.
    if (sceneOf) feed({ kind: 'claim', text: meta.text, verdict: word, source: meta.kind === 'claim' ? 'summary' : meta.title ? 'title' : 'description', final: null });
  } else if (meta.kind === 'resolve' || meta.kind === 'resolve_r1' || meta.kind === 'mortal' || meta.kind === 'childcry') {
    const n = questionsOf(meta, result);
    st.answers += n;
    const s = p.scenes.find((x) => x.id === meta.scene);
    if (s) s.questions = (s.questions ?? 0) + n;
  } else if (meta.kind === 'classify') {
    st.answers += meta.questions ?? 0;
    const s = p.scenes.find((x) => x.id === meta.scene);
    if (s) s.questions = (s.questions ?? 0) + (meta.questions ?? 0);
    if (s) {
      s.requests_done = (s.requests_done ?? 0) + 1;
      if (s.requests_done >= (s.requests ?? 1)) { s.state = 'answered'; feed({ kind: 'scene', text: `${s.id} answered`, verdict: 'answered' }); }
    }
  }
}

const norm = (t) => String(t ?? '').toLowerCase().replace(/\s+/g, ' ').trim();

/**
 * A summary sentence is in the scene summary only when it passed EVERY acceptance step refold applies
 * (pack/accept.js applyUnified): the unified rule and placement (check.status 'verified') AND the
 * judgement-word exclusion -- and, as the final word, only if it is actually in the summary refold built.
 */
const inSummary = (scene, x) => x.check?.status === 'verified' && !x.judgement_words?.length
  && (typeof scene.summary !== 'string' || norm(scene.summary).includes(norm(x.text)));

/**
 * The final decisions on the sentences Jev checked, once the run has made them, and the feed items
 * marked with theirs (mutates `p`):
 *   summary      Sonnet's cited scene sentences: kept in the scene summary Jev reads (the acceptance
 *                rule, placement and the judgement-word exclusion, refold) or left out
 *   descriptions the parent-facing titles and descriptions of the flagged scenes: shown in the guide
 *                (the A0>C text rule, then the quotation gate) or left out
 * Being left out is not a finding that a sentence is false: it could not be supported well enough.
 */
export function reconcileClaims(p, { refold, rows }) {
  const kept = new Map(); // scene -> Set of kept summary sentences
  let summaryChecked = 0;
  let summaryKept = 0;
  for (const s of refold?.scenes ?? []) {
    const set = new Set();
    for (const x of s.sentences ?? []) {
      if (!x.check) continue;
      summaryChecked++;
      if (inSummary(s, x)) { summaryKept++; set.add(norm(x.text)); }
    }
    kept.set(s.id, set);
  }
  const shown = new Map(rows.map((g) => [g.scene_id, { title: norm(g.title === 'Flagged scene' ? '' : g.title), text: norm(g.description) }]));
  for (const item of p.feed) {
    if (item.kind !== 'claim') continue;
    if (item.source === 'summary') item.final = kept.get(item.scene)?.has(norm(item.text)) ? 'kept' : 'left_out';
    else {
      const s = shown.get(item.scene);
      const t = norm(item.text);
      item.final = s && t && (item.source === 'title' ? s.title === t : s.text.includes(t)) ? 'kept' : 'left_out';
    }
  }
  const descriptions = rows.reduce((a, g) => ({ scenes: a.scenes + 1, with_text: a.with_text + (g.description ? 1 : 0), with_title: a.with_title + (g.title && g.title !== 'Flagged scene' ? 1 : 0) }), { scenes: 0, with_text: 0, with_title: 0 });
  p.stages.claims.final = { summary: { checked: summaryChecked, kept: summaryKept, left_out: summaryChecked - summaryKept }, descriptions };
}

// ------------------------------------------------------------------------------------------------
// One invocation of a demo run
// ------------------------------------------------------------------------------------------------

/** Take the run's lease, or return null. A takeover of a lease never released is a crash, and counts. */
export async function acquireDemoLease(db, runId, owner, leaseMs = DEMO_LEASE_MS) {
  // A crashed invocation may have had requests in flight: its spend is carried at its durable mark (an
  // upper bound), and the part of that above what it had banked is recorded as uncertain.
  const { rows } = await db.query(
    `update demo_runs set lease_owner = $2, lease_until = now() + ($3::bigint * interval '1 millisecond'),
            invocations = invocations + 1,
            crash_count = crash_count + (case when lease_owner is not null then 1 else 0 end),
            uncertain_usd = uncertain_usd + (case when lease_owner is not null then greatest(mark_usd - spent_usd, 0) else 0 end),
            spent_usd = case when lease_owner is not null then greatest(mark_usd, spent_usd) else spent_usd end,
            status = case when status = 'queued' then 'running' else status end,
            started_at = coalesce(started_at, now()),
            progress_at = now(), updated_at = now()
      where id = $1 and status in ('queued', 'running')
        and (lease_until is null or lease_until < now())
        -- a run the v10.4.2 code started (it never counted invocations): nothing to resume, and its own
        -- invocation may still be alive -- the sweep ends it (lib/schema-jevfirst.js, v10.4.4)
        and not (status = 'running' and invocations = 0)
      returning *`,
    [runId, owner, leaseMs],
  );
  return rows[0] ?? null;
}

/**
 * Run as much of one demo run as this invocation may, writing its row as it goes. Never throws at the
 * caller: the row is the only channel.
 * @returns {Promise<{ acquired: boolean, status?: string, ran?: string[], handedOff?: boolean, lostLease?: boolean, error_code?: string, cost_usd?: number }>}
 */
export async function runDemo(db, runId, opts = {}) {
  const {
    keys = {}, fetchImpl, sleep, continueRun = async () => {},
    // JEVFIRST_LOCAL_BUDGET_MS (local only, ignored on Vercel) shortens it so a laptop run hands off too
    budgetMs = localBudgetMs() ?? DEMO_BUDGET_MS, hardMs = DEMO_HARD_MS, leaseMs = DEMO_LEASE_MS, heartbeatMs = DEMO_HEARTBEAT_MS,
    flushMs = 250, onStageStart = null, owner = crypto.randomBytes(9).toString('base64url'),
  } = opts;
  const t0 = Date.now();
  const elapsed = () => Date.now() - t0;
  const run = await acquireDemoLease(db, runId, owner, leaseMs);
  if (!run) return { acquired: false, status: 'not_acquired' };
  const reserve = Number(run.reserve_usd);
  let spent = Number(run.spent_usd ?? 0);
  // the part of `spent` that is an upper bound, not a measured bill: crashed attempts' marks (carried in by
  // acquireDemoLease) plus this invocation's unanswered requests and unreadable 200s
  let uncertain = Number(run.uncertain_usd ?? 0);
  const checkpoint = parsed(run.checkpoint) ?? null;
  const done = new Set(checkpoint?.done ?? []);
  const runStartedAt = run.started_at ? new Date(run.started_at).getTime() : t0;
  const atMs = () => Date.now() - runStartedAt;
  let progress = checkpoint?.progress ? structuredClone(checkpoint.progress) : null;
  // The progress as of the last checkpoint: what a stage cut short is put back to.
  let progressAtCheckpoint = checkpoint?.progress ?? null;
  const ran = [];
  let finished = false;
  let flushing = Promise.resolve();
  let timer = null;
  let markDurable = Number(run.mark_usd ?? 0);
  let markPending = null;
  const wallets = new Set();

  const whereMine = 'where id = $1 and lease_owner = $2';
  const flush = () => {
    if (!progress || finished) return flushing;
    progress.spent_usd = round6(spent);
    const doc = JSON.stringify(progress);
    flushing = flushing.then(() => (finished ? null : db.query(
      `update demo_runs set progress = $3::jsonb, spent_usd = $4, cost_usd = greatest($5::numeric, cost_usd), uncertain_usd = $6, progress_at = now(), updated_at = now() ${whereMine}`,
      [runId, owner, doc, round6(spent), round6(Math.max(reserve, spent)), round6(uncertain)],
    ))).catch(() => {});
    return flushing;
  };
  const schedule = () => { if (!timer) timer = setTimeout(() => { timer = null; flush(); }, flushMs); };

  const abort = new AbortController();
  const hard = setTimeout(() => abort.abort(new Interrupted('time')), Math.max(0, hardMs));
  let lastBeat = Date.now();
  const beat = setInterval(() => {
    db.query(`update demo_runs set lease_until = now() + ($3::bigint * interval '1 millisecond'), progress_at = now(), updated_at = now() ${whereMine} returning id`, [runId, owner, leaseMs])
      .then((res) => { if (!changed(res)) abort.abort(new Interrupted('lease')); else lastBeat = Date.now(); })
      .catch(() => {});
    // Heartbeats that keep failing mean the lease may lapse and another invocation take the run: stop
    // before that can happen, never run alongside it.
    if (Date.now() - lastBeat > leaseMs - 2 * heartbeatMs) abort.abort(new Interrupted('lease'));
  }, heartbeatMs);
  const stop = () => { clearTimeout(hard); clearInterval(beat); if (timer) { clearTimeout(timer); timer = null; } };
  /** Stop scheduling progress writes and wait for the queued ones -- WHILE the heartbeat still holds the lease. */
  const drain = async () => {
    if (timer) { clearTimeout(timer); timer = null; }
    await flushing;
    finished = true;
  };
  const lost = () => ({ acquired: true, status: 'running', lostLease: true, ran });
  /**
   * Reservations still open as this invocation writes its end or hands off: a request that took one and
   * never settled it may have been billed, so it is charged at that reservation, all of it uncertain. The
   * run's record never falls below what it may owe -- whatever path a stage left by.
   */
  const chargeOpen = () => {
    for (const b of wallets) {
      const open = b.reserved;
      if (!(open > 1e-12)) continue;
      b.settle(open, open);
      spent += open;
      uncertain += open;
    }
  };

  /** Hand the run on: progress back to the last checkpoint, lease released, the next invocation asked for. */
  const handOff = async (why) => {
    // A lost lease: the run is someone else's now, and every write of ours would be fenced off anyway.
    if (why === 'lease') { stop(); finished = true; return lost(); }
    chargeOpen();
    let released = 0;
    try {
      await drain();
      released = changed(await db.query(
        `update demo_runs set lease_owner = null, lease_until = null, progress = coalesce($3::jsonb, progress), spent_usd = $4,
                mark_usd = greatest(mark_usd, $4), cost_usd = greatest($5::numeric, cost_usd), uncertain_usd = $6, progress_at = now(), updated_at = now() ${whereMine}
          returning id`,
        [runId, owner, progressAtCheckpoint ? JSON.stringify({ ...progressAtCheckpoint, spent_usd: round6(spent) }) : null, round6(spent), round6(Math.max(reserve, spent)), round6(uncertain)],
      ).catch(() => null));
    } finally { stop(); }
    // Not released: another invocation holds the run (it took the lapsed lease); it needs no continuation.
    if (!released) return lost();
    await continueRun(runId).catch(() => {});
    return { acquired: true, status: 'running', handedOff: true, ran };
  };

  /**
   * End the run: queued writes drained under the lease, then ONE owner-conditional update. The run's
   * checkpoints are deleted only when that update changed the row -- if it did not, the run was taken over
   * and they belong to the invocation that holds it now. Returns whether the run was ours to end.
   */
  const finish = async (fields) => {
    let ended = 0;
    chargeOpen();
    try {
      await drain();
      if (progress) progress.spent_usd = round6(spent);
      // cost_usd: the run's final figure for the daily cap -- what it was billed, crashed attempts carried
      // at their marks. The reservation it held while live is released here.
      ended = changed(await db.query(
        `update demo_runs set status = $3, slot = null, progress = coalesce($4::jsonb, progress), result = $5::jsonb, cost_usd = $6, spent_usd = $6,
                mark_usd = greatest(mark_usd, $6), uncertain_usd = $9, error_code = $7, error = $8, lease_owner = null, lease_until = null,
                ended_at = now(), updated_at = now() ${whereMine}
          returning id`,
        [runId, owner, fields.status, progress ? JSON.stringify(progress) : null, fields.result ? JSON.stringify(fields.result) : null, round6(spent), fields.error_code ?? null, fields.error ?? null, round6(uncertain)],
      ));
    } finally { stop(); }
    if (!ended) return false;
    await db.query('delete from demo_run_stages where run_id = $1', [runId]).catch(() => {});
    return true;
  };

  try {
    if (run.crash_count > DEMO_MAX_CRASHES) {
      if (!(await finish({ status: 'failed', error_code: 'timed_out', error: 'This live run stopped part-way through too many times and did not finish.' }))) return lost();
      return { acquired: true, status: 'failed', error_code: 'timed_out', cost_usd: round6(spent) };
    }
    const film = await getJevfirstFilm(db, run.slug);
    const docs = film ? await readArtifacts(db, run.slug, DEMO_KINDS.concat(DEMO_OPTIONAL_KINDS)) : {};
    const track = film ? await readTrack(db, film.imdb_id) : null;
    if (!film || !track || DEMO_KINDS.some((k) => !docs[k])) throw new PipelineError('not_available', 'This film is not ready for a live run.');
    const cues = track.cues;
    const outputs = new Map([['sources', docs.sources]]);
    if (done.size) {
      const { rows: st } = await db.query('select stage, output from demo_run_stages where run_id = $1', [runId]);
      for (const r of st) if (done.has(r.stage)) outputs.set(r.stage, parsed(r.output));
      // A checkpoint whose output is gone cannot be resumed from honestly: that stage runs again.
      for (const id of [...done]) if (!outputs.has(id)) done.delete(id);
    }
    if (!progress) {
      progress = newProgress();
      const precheck = docs.segments_precheck;
      progress.scenes = precheck.scenes.filter((s) => !s.credits).map((s) => ({ id: s.id, start_ms: s.start_ms, end_ms: s.end_ms, state: 'pending', flagged: null, strength_5_7: null, strength_8_10: null }));
      const creditScenes = precheck.scenes.filter((s) => s.credits);
      if (creditScenes.length) progress.credits = { start_ms: creditScenes[0].start_ms, end_ms: creditScenes.at(-1).end_ms, scenes: creditScenes.length };
      progressAtCheckpoint = structuredClone(progress);
    } else {
      // Resuming: the page is put back to the last checkpoint at once (a stage cut short redraws from zero).
      progress.stage = null;
      await flush();
    }

    // No request goes out until a mark covering the run's exposure (spent + every in-flight reservation)
    // is durable -- the rule runner.js keeps for add jobs. The mark never passes the reservation, which
    // the wallets themselves can never pass.
    const beforeDispatch = async () => {
      const EPS = 1e-9;
      for (;;) {
        const exposure = spent + [...wallets].reduce((a, b) => a + b.reserved, 0);
        if (exposure <= markDurable + EPS) return;
        if (runCtx().signal?.aborted) throw new Error('stopping');
        if (markPending) { await markPending; continue; }
        const target = round6(Math.max(exposure, Math.min(reserve, exposure + reserve * 0.1))) + 1e-6;
        markPending = (async () => {
          await db.query(`update demo_runs set mark_usd = greatest(mark_usd, $3), updated_at = now() ${whereMine}`, [runId, owner, target]);
          const { rows: m } = await db.query('select mark_usd from demo_runs where id = $1 and lease_owner = $2', [runId, owner]);
          const got = Number(m[0]?.mark_usd);
          if (!(got >= target - 1e-6)) throw new Error('mark not persisted');
          markDurable = Math.max(markDurable, got);
        })().finally(() => { markPending = null; });
        await markPending;
      }
    };

    const baseCtx = {
      fetchImpl: fetchImpl ?? ((...a) => globalThis.fetch(...a)),
      // No Anthropic key: a demo run cannot call Sonnet even by mistake.
      keys: { typesafe: keys.typesafe ?? process.env.TYPESAFE_API_KEY, claude: null, tmdb: null },
      signal: abort.signal,
      ...(sleep ? { sleep } : {}),
      beforeDispatch,
      onSpend: (usd, info) => { spent += usd; uncertain += Math.min(usd, Math.max(0, Number(info?.uncertain_usd) || 0)); schedule(); },
      onDispatch: (meta) => {
        if (meta.kind !== 'classify') return;
        const s = progress.scenes.find((x) => x.id === meta.scene);
        if (s && s.state === 'pending') { s.state = 'asking'; schedule(); }
      },
      onResult: (meta, result) => { applyResult(progress, meta, result, { atMs: atMs(), cues }); schedule(); },
    };

    const outcome = await withRun(baseCtx, async () => {
      for (const def of DEMO_STAGES) {
        if (done.has(def.id)) continue;
        // Time: a stage starts only if its estimate still fits this invocation (the first always does).
        if (ran.length > 0 && (elapsed() > budgetMs || hardMs - elapsed() < estOf(def.id) * 1000)) return 'handoff';
        onStageStart?.(def.id);
        progress.stage = def.id;
        await flush();
        wallets.clear();
        const S = {
          mode: 'demo', db, film: { slug: film.slug, title: film.title, year: film.year, imdb_id: film.imdb_id }, cues,
          srt: { release: track.release, sha256: track.sha256 },
          out: (id) => outputs.get(id) ?? null,
          has: (id) => outputs.has(id),
          stored: (kind) => docs[kind] ?? null,
          committed: () => 0,
          detail: () => {},
          ledger: () => [],
          progress: ({ stage, total, scenes, kinds }) => {
            const st = progress.stages[stage === 'split_check' ? 'split_check' : stage];
            if (st) {
              if (COUNTED_KINDS[stage]) st.requests_total = (st.requests_total ?? 0) + total;
              st.total += countedTotal(stage, total, kinds);
            }
            if (scenes) for (const x of scenes) { const s = progress.scenes.find((y) => y.id === x.id); if (s) s.requests = x.requests; }
            schedule();
          },
          wallet: (name, cap) => {
            // min(stage cap, what is left of this run's reservation)
            const b = budget(Math.max(0, Math.min(cap, reserve - spent)));
            wallets.add(b);
            return { budget: b, cap, run: (fn) => withRun({ ...runCtx() }, fn) };
          },
        };
        const out = await def.run(S);
        if (abort.signal.aborted) throw new Interrupted(abort.signal.reason?.message ?? 'time');
        outputs.set(def.id, out);
        if (def.id === 'select1' || def.id === 'select3') {
          for (const sc of out.scenes) {
            const s = progress.scenes.find((x) => x.id === sc.id);
            if (!s) continue;
            s.flagged = !!sc.flagged;
            s.strength_5_7 = strengthOf(sc)['5-7'];
            s.strength_8_10 = strengthOf(sc)['8-10'];
            // v10.4: every flagged scene says why -- its flag reasons as plain tags, with who answered
            s.why = sc.flagged ? whyTagsOf(sc) : null;
            if (def.id === 'select3' && sc.flagged) {
              progress.feed.push({ kind: 'scene', scene: sc.id, text: `${sc.id} · ${sc.why_tags?.line ?? ''} → on the list`, verdict: 'flagged', at_ms: sc.start_ms, t_ms: atMs() });
              progress.feed_total++;
            }
          }
          trimFeed(progress);
        }
        // ---- checkpoint: the stage's output and the finished list (with the progress as it stands) in ONE
        // statement, fenced by the lease: the update locks the run's row and changes it only while this
        // invocation owns it, and the output is written only when it did -- so an invocation whose lease was
        // taken over can never replace the new owner's outputs or checkpoint.
        await flush();
        await flushing;
        const snapshot = structuredClone(progress);
        const res = await db.query(
          `with mine as (
             update demo_runs set checkpoint = $3::jsonb, spent_usd = $4, uncertain_usd = $7, progress_at = now(), updated_at = now() ${whereMine}
             returning id
           )
           insert into demo_run_stages (run_id, stage, output)
           select id, $5, $6::jsonb from mine
           on conflict (run_id, stage) do update set output = excluded.output, at = now()
           returning run_id`,
          [runId, owner, JSON.stringify({ done: [...done, def.id], progress: snapshot }), round6(spent), def.id, JSON.stringify(out ?? null), round6(uncertain)],
        );
        if (!changed(res)) throw new Interrupted('lease');
        done.add(def.id);
        progressAtCheckpoint = snapshot;
        ran.push(def.id);
      }
      return 'done';
    });
    if (outcome === 'handoff') return await handOff('time');

    const tags = outputs.get('select3');
    const grams = quoteGrams(cues);
    const rowsOut = withTitles(guideRows(tags, { grams }), outputs.get('refold')?.segments?.scenes ?? docs.segments?.scenes ?? null, grams);
    const guide = await libraryGuide(db, film);
    const gate = outputs.get('segment_build').gate;
    const stored = docs.tags ? guideRows(docs.tags) : null;
    const classify = outputs.get('classify');
    const rawOf = (id) => classify?.scenes?.find((x) => x.id === id)?.answers ?? null;
    reconcileClaims(progress, { refold: outputs.get('refold')?.segments, rows: rowsOut });
    const result = {
      flagged: rowsOut.map((g) => ({
        // no title passed its checks: null (the page heads the scene with its reasons), never the placeholder
        scene_id: g.scene_id, start_ms: g.start_ms, end_ms: g.end_ms, title: g.title === 'Flagged scene' ? null : g.title, description: g.description,
        // why it is on the list: the flag reasons as plain tags, each with who answered (jev / sonnet) and,
        // for a film-specific reason, its stable category
        reasons: g.why.map((t) => ({ label: t.label, category: t.category ?? reasonCategory(t.rule), by: t.by[0] ?? 'jev', by_all: t.by, p: t.p })),
        why_line: g.why_line,
        // the same reasons with the questions each model was asked, each with its own answer, and the rule
        why: whyDetail(tags.scenes.find((x) => x.id === g.scene_id) ?? {}, tags.film_items ?? [], rawOf(g.scene_id)),
        text_rule: g.text_rule, title_rule: g.title_rule,
        strength: g.severity_5_7,
        strength_by_band: { '5_7': g.severity_5_7, '8_10': g.severity_8_10 },
      })),
      compare: compareWithGuide(rowsOut, guide),
      // whether the film is in the library as this run ended: `compare` is null exactly when it is not
      in_library: guide !== null,
      // the same film's last full run (its stored selection), when there is one: a second comparison
      compare_stored_run: stored ? compareWithGuide(rowsOut, stored.map((x) => ({ id: x.scene_id, start_ms: x.start_ms, end_ms: x.end_ms }))) : null,
      split_check: gate,
      scenes: tags.summary.scenes,
      text: { strict: tags.summary.why?.text_strict ?? null, loose: tags.summary.why?.text_loose ?? null, none: tags.summary.why?.no_verified_text ?? null },
      sonnet_replayed: { sonnetq_run_at: docs.sonnetq.run_at ?? null, describe_run_at: docs.describe.run_at ?? null, describe2_scenes: Object.keys(outputs.get('describe2')?.scenes ?? {}).length, titles_scenes: Object.keys(outputs.get('titles')?.scenes ?? {}).length,
        // scenes today's checks would have sent to Sonnet again but the stored run never did: they show attempt 1's text only
        not_stored: [...(outputs.get('describe2')?.not_stored ?? []), ...(outputs.get('titles')?.not_stored ?? [])].length },
    };
    progress.stage = null;
    if (!(await finish({ status: 'done', result }))) return lost();
    return { acquired: true, status: 'done', ran, cost_usd: round6(spent) };
  } catch (err) {
    const interrupted = err instanceof Interrupted || abort.signal.aborted;
    if (interrupted) return await handOff(abort.signal.reason?.message === 'lease' || err?.message === 'lease' ? 'lease' : 'time');
    const known = err instanceof PipelineError;
    if (!known) console.error(`[demo ${runId}]`, errorSummary(err));
    const ended = await finish({
      status: 'failed',
      error_code: known ? err.code : 'internal',
      error: known ? err.message : 'Something went wrong on our side part-way through this run.',
    }).catch(() => false);
    if (!ended) return lost();
    return { acquired: true, status: 'failed', error_code: known ? err.code : 'internal', cost_usd: round6(spent) };
  } finally {
    stop();
  }
}
