// Runs a Jev-first add job across as many function invocations as it takes.
//
// One call of advanceJob is one invocation's share of the work:
//
//   1. take the job's LEASE (one conditional UPDATE; if another invocation holds a live lease, do
//      nothing and return -- two invocations can never work on one job);
//   2. read what earlier invocations checkpointed (job_stages) and the film's subtitle track;
//   3. run stages in order while the invocation's time budget allows: a stage starts only if its
//      estimate still fits, and every call it makes is aborted at the hard limit (HARD_MS) so nothing
//      outlives the function; each finished stage writes its output to job_stages before the next
//      starts;
//   4. when the budget is spent, release the lease and ask for a continuation (an authenticated
//      self-call to POST /api/add/jobs/{id}/continue, lib/jevfirst.js) -- and if that call never lands,
//      the next poll of GET /api/add/jobs/{id} asks again once the job has gone quiet.
//
// Resumable after a crash: a stage whose invocation died is re-run from its start by the next one
// (its earlier attempt's committed money is carried, so the stage cap still holds). Idempotent: a
// finished stage is never re-run, a duplicate continuation finds the lease taken or the stage done.
//
// Money: the job row reads max(reserve, committed) while live, and the committed total once at done
// or failed -- committed = what every stage attempt was billed plus what crashed attempts may have
// been billed (their persisted high-water marks). Never less than the truth.
import crypto from 'node:crypto';
import { budget } from './pack/budget.js';
import { withRun, runCtx } from './context.js';
import { ADD_STAGES, JEVFIRST_STEPS } from './stages/index.js';
import { Interrupted } from './stages/common.js';
import { loadStages, beginStage, finishStage, writeStageMoney, readTrack, stagesCost } from './store.js';
import { PipelineError, errorSummary } from '../pipeline/errors.js';

export const LEASE_MS = 310_000;      // longer than the platform's 300 s: a live invocation never loses it
export const BUDGET_MS = 240_000;     // no stage STARTS after this much of an invocation
export const HARD_MS = 285_000;       // every in-flight call is aborted here; the stage resumes next time
export const HEARTBEAT_MS = 15_000;
export const MAX_CRASHES = 3;         // lease takeovers without a clean hand-off before the job fails

/** The most one Jev-first add can cost: every wallet's cap (stages/*.js), summed. See JEVFIRST_RESERVE_USD. */
export { JEVFIRST_RESERVE_USD } from './caps.js';

const round6 = (n) => Math.round(n * 1e6) / 1e6;

/**
 * Local testing only: JEVFIRST_LOCAL_BUDGET_MS shortens the per-invocation budget so a job on a laptop
 * hands off (and exercises the continuation) every few stages. Ignored on Vercel.
 */
export function localBudgetMs(env = process.env) {
  if (env.VERCEL) return null;
  const n = Number(env.JEVFIRST_LOCAL_BUDGET_MS);
  return env.JEVFIRST_LOCAL_BUDGET_MS && Number.isFinite(n) && n > 0 ? n : null;
}

// ------------------------------------------------------------------------------------------------
// The lease
// ------------------------------------------------------------------------------------------------

/**
 * Take the job's lease, or return null. The only statement that can make an invocation the job's
 * worker. A previous owner that never released is a crash, and counts.
 */
export async function acquireLease(db, jobId, owner, leaseMs = LEASE_MS) {
  const { rows } = await db.query(
    `update jobs set lease_owner = $2, lease_until = now() + ($3::bigint * interval '1 millisecond'),
            invocations = invocations + 1,
            crash_count = crash_count + (case when lease_owner is not null then 1 else 0 end),
            status = case when status = 'queued' then 'running' else status end,
            progress_at = now(), updated_at = now()
      where id = $1 and pipeline = 'jevfirst' and status in ('queued', 'running')
        and (lease_until is null or lease_until < now())
      returning *`,
    [jobId, owner, leaseMs],
  );
  return rows[0] ?? null;
}

async function releaseLease(db, jobId, owner, fields = {}) {
  const sets = ['lease_owner = null', 'lease_until = null', 'updated_at = now()'];
  const params = [jobId, owner];
  for (const [k, v] of Object.entries(fields)) { params.push(k === 'steps' ? JSON.stringify(v) : v); sets.push(`${k} = $${params.length}${k === 'steps' ? '::jsonb' : ''}`); }
  await db.query(`update jobs set ${sets.join(', ')} where id = $1 and lease_owner = $2`, params);
}

// ------------------------------------------------------------------------------------------------
// Steps as the page reads them
// ------------------------------------------------------------------------------------------------

/**
 * The parent-readable steps from the stage rows: a step is 'running' while one of its stages runs (or
 * is the next to run), 'done' once any of its stages finished and none is running, 'failed' when its
 * stage failed. Times are offsets from the job's creation.
 */
export function stepsView(stageRows, { current = null, failed = null, createdAt, stages = ADD_STAGES } = {}) {
  const t0 = new Date(createdAt).getTime();
  const at = (ts) => (ts ? Math.max(0, new Date(ts).getTime() - t0) : null);
  return JEVFIRST_STEPS.map((step) => {
    const mine = stages.filter((s) => s.step === step.id);
    const rows = mine.map((s) => stageRows.get(s.id)).filter(Boolean);
    const ran = rows.filter((r) => r.status === 'done' || r.status === 'running');
    const details = mine.map((s) => stageRows.get(s.id)).filter((r) => r?.status === 'done' && r.detail).map((r) => r.detail);
    let status = 'pending';
    if (failed && mine.some((s) => s.id === failed)) status = 'failed';
    else if (current && mine.some((s) => s.id === current)) status = 'running';
    else if (rows.some((r) => r.status === 'done')) status = 'done';
    else if (rows.length && rows.every((r) => r.status === 'skipped')) status = 'pending';
    const started = ran.map((r) => at(r.started_at)).filter((x) => x !== null);
    const ended = rows.filter((r) => r.status === 'done').map((r) => at(r.ended_at)).filter((x) => x !== null);
    return {
      id: step.id, label: step.label, status,
      started_ms: started.length ? Math.min(...started) : null,
      ended_ms: status === 'done' && ended.length ? Math.max(...ended) : null,
      detail: details.length ? details.join('. ') : null,
    };
  });
}

// ------------------------------------------------------------------------------------------------
// One invocation
// ------------------------------------------------------------------------------------------------

/**
 * @param {object} db
 * @param {string} jobId
 * @param {object} [opts]
 * @param {(jobId: string) => Promise<any>} [opts.continueJob] how to ask for the next invocation
 * @param {object} [opts.keys] { typesafe, claude, tmdb, opensubtitles } -- defaults to the environment
 * @param {typeof fetch} [opts.fetchImpl]
 * @param {number} [opts.budgetMs] [opts.hardMs] [opts.leaseMs] the time rules (tests shorten them)
 * @param {(ms: number) => Promise<void>} [opts.sleep]
 * @param {(stageId: string) => void} [opts.onStageStart] tests: crash an invocation at a chosen stage
 * @returns {Promise<{ acquired: boolean, status?: string, ran?: string[], handedOff?: boolean, error_code?: string }>}
 */
export async function advanceJob(db, jobId, opts = {}) {
  const {
    continueJob = async () => {}, keys = {}, fetchImpl, sleep,
    budgetMs = localBudgetMs() ?? BUDGET_MS, hardMs = HARD_MS, leaseMs = LEASE_MS, heartbeatMs = HEARTBEAT_MS,
    onStageStart = null, stages: stageList = ADD_STAGES, owner = crypto.randomBytes(9).toString('base64url'),
  } = opts;
  const t0 = Date.now();
  const elapsed = () => Date.now() - t0;
  const job = await acquireLease(db, jobId, owner, leaseMs);
  if (!job) return { acquired: false };

  const reserve = Number(job.reserve_usd ?? 0);
  const ran = [];
  const stageRows = await loadStages(db, jobId);
  let current = null;
  let liveCost = 0; // committed by the stage attempt that is running now (not yet in stageRows)
  const committed = () => stagesCost(stageRows) + liveCost;
  const writeJob = (fields = {}) => {
    const sets = ['updated_at = now()', 'progress_at = now()'];
    const params = [jobId, owner];
    for (const [k, v] of Object.entries(fields)) { params.push(k === 'steps' || k === 'film' ? JSON.stringify(v) : v); sets.push(`${k} = $${params.length}${k === 'steps' || k === 'film' ? '::jsonb' : ''}`); }
    return db.query(`update jobs set ${sets.join(', ')} where id = $1 and lease_owner = $2`, params);
  };
  const viewSteps = (extra = {}) => stepsView(stageRows, { createdAt: job.created_at, stages: stageList, current, ...extra });

  if (job.crash_count > MAX_CRASHES) {
    await finishJob(db, job, owner, { status: 'failed', error_code: 'timed_out', error: 'This run stopped part-way through too many times and did not finish.', cost: committed(), steps: viewSteps() });
    return { acquired: true, status: 'failed', error_code: 'timed_out' };
  }

  // The invocation's clock and lease. `abort` is what every model call listens to.
  const abort = new AbortController();
  const hardTimer = setTimeout(() => abort.abort(new Interrupted('time')), Math.max(0, hardMs));
  const beat = setInterval(() => {
    db.query('update jobs set progress_at = now(), updated_at = now() where id = $1 and lease_owner = $2', [jobId, owner])
      .then((res) => { if (!(res?.rowCount ?? res?.affectedRows ?? 1)) abort.abort(new Interrupted('lease')); })
      .catch(() => {});
  }, heartbeatMs);
  const stop = () => { clearTimeout(hardTimer); clearInterval(beat); };

  const baseCtx = {
    fetchImpl: fetchImpl ?? ((...a) => globalThis.fetch(...a)),
    keys: {
      typesafe: keys.typesafe ?? process.env.TYPESAFE_API_KEY,
      claude: keys.claude ?? process.env.CLAUDE_API_KEY,
      tmdb: keys.tmdb ?? process.env.TMDB_API_KEY,
      opensubtitles: keys.opensubtitles ?? process.env.OPENSUBTITLES_API_KEY,
    },
    signal: abort.signal,
    ...(sleep ? { sleep } : {}),
  };

  try {
    return await withRun(baseCtx, async () => {
      let track = null;
      let cues = null;
      const needTrack = () => {
        if (cues) return;
        if (!track) throw new PipelineError('internal', 'The subtitle track for this run is missing.');
        cues = track.cues;
      };
      if (stageRows.get('subtitles')?.status === 'done') track = await readTrack(db, job.film.imdb_id);

      for (const def of stageList) {
        const row = stageRows.get(def.id);
        if (row?.status === 'done' || row?.status === 'skipped') continue;
        const outputs = (id) => { const r = stageRows.get(id); return r?.status === 'done' ? r.output : null; };
        const S0 = { out: (id) => outputs(id), has: (id) => stageRows.get(id)?.status === 'done' };
        if (def.when && !def.when(S0)) {
          await db.query("insert into job_stages (job_id, stage, status, ended_at) values ($1, $2, 'skipped', now()) on conflict (job_id, stage) do update set status = 'skipped', ended_at = now()", [jobId, def.id]);
          stageRows.set(def.id, { stage: def.id, status: 'skipped', output: null, spent: {}, mark: {}, carried: row?.carried ?? {} });
          continue;
        }
        // Time: start only if the stage's estimate still fits this invocation; a `fresh` stage only at the top of one.
        const left = hardMs - elapsed();
        const tooLate = elapsed() > budgetMs || left < def.est * 1000 || (def.fresh && ran.length > 0);
        if (tooLate && ran.length > 0) {
          current = def.id;
          await releaseLease(db, jobId, owner, { step: def.step, steps: viewSteps() });
          stop();
          await continueJob(jobId).catch(() => {});
          return { acquired: true, status: 'running', ran, handedOff: true };
        }

        // ---- run one stage ----
        current = def.id;
        onStageStart?.(def.id);
        const { carried } = await beginStage(db, jobId, def.id);
        const fresh = await loadStages(db, jobId);
        stageRows.set(def.id, fresh.get(def.id));
        await writeJob({ status: 'running', step: def.step, steps: viewSteps(), cost_usd: round6(Math.max(reserve, committed())) });

        // Money for this attempt, per wallet, persisted as it moves.
        const spent = {};
        const mark = {};
        const durable = {};     // per wallet: the mark known to be in job_stages
        const pendingMark = {}; // per wallet: the mark write in flight, if any
        let flushing = Promise.resolve();
        let flushTimer = null;
        const persist = () => {
          flushing = flushing.then(async () => {
            liveCost = Object.values(spent).reduce((a, v) => a + v, 0);
            await writeStageMoney(db, jobId, def.id, { spent, mark });
            await db.query('update jobs set cost_usd = $3, updated_at = now() where id = $1 and lease_owner = $2', [jobId, owner, round6(Math.max(reserve, committed()))]);
          }).catch(() => {});
          return flushing;
        };
        const schedule = () => { if (!flushTimer) flushTimer = setTimeout(() => { flushTimer = null; persist(); }, 250); };
        let detail = null;
        const S = {
          mode: 'add', db, job, film: job.film,
          get cues() { needTrack(); return cues; },
          get srt() { needTrack(); return { release: track.release, sha256: track.sha256, srtText: track.srtText }; },
          out: (id) => outputs(id),
          has: (id) => stageRows.get(id)?.status === 'done',
          stored: () => null,
          detail: (text) => { detail = text; },
          ledger: () => ledgerOf(stageRows),
          committed: (id) => { const r = stageRows.get(id); return r ? [r.carried ?? {}, r.spent ?? {}].reduce((a, o) => a + Object.values(o).reduce((x, v) => x + (Number(v) || 0), 0), 0) : 0; },
          wallet: (name, cap) => {
            const b = budget(Math.max(0, cap - (Number(carried[name]) || 0)));
            return {
              budget: b, cap,
              run: (fn) => withRun({ ...runCtx(),
                // No call goes out until a mark covering it is DURABLE: a caller whose exposure is covered
                // only by a mark still being written waits for that write (and re-checks) instead of
                // going ahead on the in-memory value.
                beforeDispatch: async () => {
                  const exposure = b.spent + b.reserved;
                  const EPS = 1e-9; // float sums of reservations can pass the cap by 1e-16
                  for (;;) {
                    if (exposure <= (durable[name] ?? 0) + EPS) return;
                    if (runCtx().signal?.aborted) throw new Error('stopping');
                    if (pendingMark[name]) { await pendingMark[name]; continue; }
                    const target = Math.max(exposure, Math.min(b.cap, exposure + b.cap * 0.1));
                    mark[name] = Math.max(mark[name] ?? 0, target);
                    pendingMark[name] = (async () => {
                      await persist();
                      // a write that failed must stop the call: flushing swallows, so check it landed
                      const { rows } = await db.query('select mark from job_stages where job_id = $1 and stage = $2', [jobId, def.id]);
                      const m = typeof rows[0]?.mark === 'string' ? JSON.parse(rows[0].mark) : rows[0]?.mark;
                      if (!(Number(m?.[name]) >= target - EPS)) throw new Error('mark not persisted');
                      durable[name] = Math.max(durable[name] ?? 0, Number(m[name]));
                    })().finally(() => { pendingMark[name] = null; });
                    await pendingMark[name];
                  }
                },
                onSpend: (usd) => { spent[name] = (spent[name] ?? 0) + usd; schedule(); },
              }, fn),
            };
          },
        };

        let output;
        try {
          if (def.id !== 'subtitles' && !track) track = await readTrack(db, job.film.imdb_id);
          output = await def.run(S);
          if (def.id === 'subtitles') track = await readTrack(db, job.film.imdb_id);
        } catch (err) {
          if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
          await persist();
          if (err instanceof Interrupted || abort.signal.aborted) {
            // Left 'running': the next invocation re-runs this stage with this attempt's money carried.
            await releaseLease(db, jobId, owner, { step: def.step, steps: viewSteps() });
            stop();
            if (abort.signal.reason?.message === 'lease') return { acquired: true, status: 'running', ran, lostLease: true };
            await continueJob(jobId).catch(() => {});
            return { acquired: true, status: 'running', ran, handedOff: true, interrupted: def.id };
          }
          const known = err instanceof PipelineError;
          if (!known) console.error(`[jevfirst ${jobId}] ${def.id}`, errorSummary(err));
          await finishStage(db, jobId, def.id, { output: null, spent, status: 'running', detail: known ? err.message : null }).catch(() => {});
          stageRows.set(def.id, { ...stageRows.get(def.id), spent, status: 'running' });
          liveCost = 0;
          stop();
          await finishJob(db, job, owner, {
            status: 'failed', error_code: known ? err.code : 'internal',
            error: known ? err.message : 'Something went wrong on our side part-way through this run.',
            cost: committed(), steps: viewSteps({ current: null, failed: def.id }), step: def.step,
          });
          return { acquired: true, status: 'failed', error_code: known ? err.code : 'internal', ran };
        }
        if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
        await flushing;
        await finishStage(db, jobId, def.id, { output, spent, detail });
        stageRows.set(def.id, { ...stageRows.get(def.id), status: 'done', output, spent, mark: spent, detail, ended_at: new Date().toISOString() });
        liveCost = 0;
        current = null;
        ran.push(def.id);
        const extra = def.id === 'select3' ? { scene_count: output.scenes.filter((s) => s.flagged).length } : {};
        await writeJob({ steps: viewSteps(), cost_usd: round6(Math.max(reserve, committed())), ...extra });
      }

      // Every stage is done: the film is in.
      stop();
      const ingest = stageRows.get('ingest')?.output;
      await finishJob(db, job, owner, { status: 'done', cost: committed(), steps: viewSteps(), film: ingest ? { ...job.film, slug: ingest.slug } : job.film, scene_count: ingest?.scenes ?? null });
      return { acquired: true, status: 'done', ran };
    });
  } finally {
    stop();
  }
}

/** The per-stage spend as ledger rows (carried + spent, per wallet): what the ingest writes. */
export function ledgerOf(stageRows) {
  const out = [];
  for (const [stage, r] of stageRows) {
    const all = {};
    for (const src of [r.carried ?? {}, r.spent ?? {}]) for (const [k, v] of Object.entries(src)) all[k] = (all[k] ?? 0) + (Number(v) || 0);
    for (const [wallet, usd] of Object.entries(all)) if (usd > 0) out.push({ stage, model: wallet === 'sonnet' ? 'sonnet' : 'jev', usd: round6(usd), note: r.attempt > 1 ? `${r.attempt} attempts; crashed attempts counted at their high-water mark` : null });
  }
  return out;
}

async function finishJob(db, job, owner, { status, error_code = null, error = null, cost, steps, film = null, scene_count = null, step = null }) {
  await db.query(
    `update jobs set status = $3, step = $4, steps = $5::jsonb, cost_usd = $6, error_code = $7, error = $8,
            film = coalesce($9::jsonb, film), scene_count = coalesce($10, scene_count),
            lease_owner = null, lease_until = null, updated_at = now(), progress_at = now()
      where id = $1 and lease_owner = $2`,
    [job.id, owner, status, status === 'done' ? null : step, JSON.stringify(steps), round6(cost), error_code, error, film ? JSON.stringify(film) : null, scene_count],
  );
}
