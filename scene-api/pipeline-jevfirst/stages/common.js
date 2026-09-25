// Shared by every stage: the policy, the Sonnet call under a wallet, the quotation rule over stored
// strings, and the two ways a stage can stop (a named failure, or an interruption the runner resumes).
import { createRequire } from 'node:module';
import { runCtx } from '../context.js';
import { callClaude, costUsd } from '../pack/sonnet.js';
import { transcriptGrams, quoteRuns, quoteWords } from '../pack/validate.js';
import { PipelineError } from '../../pipeline/errors.js';

const require = createRequire(import.meta.url);
// A static require of the JSON, so Vercel's file tracer bundles it (a readFileSync of a computed path
// is not guaranteed to be traced). pack/ modules that read split.json / policy.json themselves are
// covered by the includeFiles entry in vercel.json.
// TODO(v10.2-sync): the stages read these policy keys: split_gate (+ retry.overlap_cues), credits,
// claim_accept, sentence_accept, fill, text_safety, reasons, overrides['e.crying'], act. A v10.2
// policy that renames or adds one the stages must read is the place to look first.
export const POLICY = require('../pack/policy.json');
export const SPLIT = require('../pack/split.json');

export const SONNET_MODEL = 'claude-sonnet-5';
export const JEV_MODEL = 'jev-1.13.0';
/** How many planned requests of each kind (meta.kind): what the demo's progress counts by. */
export const kindsOf = (jobs) => jobs.reduce((a, j) => { const k = j.meta?.kind ?? 'other'; a[k] = (a[k] ?? 0) + 1; return a; }, {});
export const r3 = (x) => Math.round(x * 1000) / 1000;
export const r6 = (x) => Math.round(x * 1e6) / 1e6;

/** A stage stopped because the invocation ran out of time or lost its lease: the runner re-runs it. */
export class Interrupted extends Error {
  constructor(message = 'interrupted') { super(message); this.name = 'Interrupted'; }
}
export const fail = (code, message) => new PipelineError(code, message);

/** Throw Interrupted when the run context's signal has fired (checked after every awaited batch). */
export function checkInterrupted() {
  if (runCtx().signal?.aborted) throw new Interrupted();
}

/**
 * One Sonnet call under a wallet ({ budget, run }), with the experiment's accounting: reserve the
 * worst case first (refuse when it would pass the cap), persist the spending mark before the call is
 * sent, settle the reservation against the real bill -- a rejected call costs 0, a call that never
 * answered costs its whole reservation (an upper bound), anything else what its usage says -- and bank
 * that amount the moment it is known.
 * `reserved: true` when the caller already took the reservation (sonnetq's wait-for-headroom loop).
 * Returns { r, cost }; throws the ClaudeCallError with `cost` and `cost_is_upper_bound` attached.
 */
export async function sonnetCall(w, { system, user, schema, maxTokens, effort, worst, model = SONNET_MODEL, label = 'call', reserved = false }) {
  if (!reserved && !w.budget.reserve(worst)) throw Object.assign(new Error(`refused: worst case $${worst.toFixed(4)} for ${label} breaks the cap`), { refused: true, cost: 0 });
  return w.run(async () => {
    const ctx = runCtx();
    let cost = 0;
    let upper = false;
    try {
      await ctx.beforeDispatch(worst);
    } catch {
      w.budget.settle(worst, 0);
      throw Object.assign(new Error('the spending mark could not be written'), { refused: true, cost: 0 });
    }
    try {
      const r = await callClaude({ model, system, user, schema, maxTokens, effort });
      cost = costUsd(model, r.usage);
      return { r, cost };
    } catch (err) {
      const u = err.usage;
      if (err.rejected) cost = 0;
      else if (u && Object.keys(u).length) cost = costUsd(model, u);
      else { cost = worst; upper = true; }
      throw Object.assign(err, { cost, cost_is_upper_bound: upper });
    } finally {
      w.budget.settle(worst, cost);
      if (cost > 0) ctx.onSpend(cost, { service: 'anthropic', uncertain_usd: upper ? cost : 0 });
    }
  });
}

/**
 * The 8-word quotation rule, made to hold. validate.js's enforceQuoteRule (the frozen pack's) finds runs
 * by NORMALISED words -- a hyphenated token counts as several -- but repairs by keeping five whitespace
 * TOKENS, so "one-two three-four five-six seven-eight nine-ten" keeps all ten copied words. This version
 * cuts each run at the detector's own word boundaries (whole tokens, at most `keep` words), re-checks
 * the result, and when a run still survives (a single token longer than the limit, say) rejects the
 * text instead of returning it: { text: string|null, violations, rejected }. Pure.
 */
export function enforceQuoteRuleStrict(text, grams, { maxRun = 8, keep = 5, rounds = 3 } = {}) {
  let t = String(text ?? '');
  const violations = [];
  for (let round = 0; round < rounds; round++) {
    const runs = quoteRuns(t, grams, { maxRun });
    if (!runs.length) return { text: t, violations, rejected: false };
    violations.push(...runs.map(([, , len]) => ({ words: len })));
    const tokens = t.split(/\s+/).filter(Boolean);
    const perTok = new Map();
    for (const w of quoteWords(t).words) perTok.set(w.tok, (perTok.get(w.tok) ?? 0) + 1);
    const out = [...tokens];
    for (const [a, b] of [...runs].reverse()) {
      const kept = [];
      let words = 0;
      for (let i = a; i <= b; i++) {
        const n = perTok.get(i) ?? 0;
        if (words + n > keep) break;
        kept.push(tokens[i]);
        words += n;
      }
      out.splice(a, b - a + 1, ...kept, '…');
    }
    t = out.join(' ').replace(/\s+…/g, '…');
  }
  return quoteRuns(t, grams, { maxRun }).length ? { text: null, violations, rejected: true } : { text: t, violations, rejected: false };
}

/** The text when it holds no run of more than `maxRun` transcript words, else null (never repaired). Pure. */
export const quoteSafe = (text, grams, { maxRun = 8 } = {}) => (text && !quoteRuns(text, grams, { maxRun }).length ? text : null);

/** The 9-grams of a film's transcript, as the quotation rule reads them. */
export const quoteGrams = (cues) => transcriptGrams(cues.map((c) => c.text), 9);

/** The 8-word quotation rule (9-grams of the transcript, strict repair) over every string of a value. */
export function quoteRuler(cues) {
  const g9 = quoteGrams(cues);
  const rule = (v) => (typeof v === 'string' ? (enforceQuoteRuleStrict(v, g9).text ?? '…') : Array.isArray(v) ? v.map(rule) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, rule(x)])) : v);
  return rule;
}
