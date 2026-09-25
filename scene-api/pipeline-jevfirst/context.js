// The run context the copied experiment modules cannot be handed as arguments.
//
// pack/ holds the experiment's modules verbatim. They call `runJobs(jobs, { key, budget, ... })` and
// `callClaude({ model, system, user, ... })` with no way to pass a fetch implementation, an
// AbortSignal, a progress hook or the job's money ledger. Rather than edit them (which would make the
// v10.2 swap an edit instead of a copy), the five modules they import those calls from are ours
// (pack/jev-client.js, pack/sonnet.js, ...) and read what they need from here: an AsyncLocalStorage
// store that the stage runner enters around each stage. Anything called inside `withRun(ctx, fn)` --
// however deep in the copied code -- sees `ctx`.
//
// What a context carries:
//   fetchImpl      the fetch every model and source call goes through (tests pass a stub)
//   keys           { typesafe, claude, tmdb } -- never logged, never put in an error
//   signal         aborted when the invocation's time budget runs out or its lease is lost
//   onSpend(usd, { service }) called once per priced response the moment it lands (before it is
//                  parsed), and with the reservation for a call that went out and never answered
//   beforeDispatch(reserveUsd) awaited before every call is sent; the runner persists a spending
//                  high-water mark there so a crash cannot hide money that was in flight
//   onResult(meta, result)    called per completed Jev request (the demo's live progress)
//   sleep          injectable backoff (tests do not wait out retries)
import { AsyncLocalStorage } from 'node:async_hooks';

const store = new AsyncLocalStorage();

const DEFAULTS = {
  fetchImpl: (...args) => globalThis.fetch(...args),
  keys: {},
  signal: null,
  onSpend: () => {},
  beforeDispatch: async () => {},
  onResult: () => {},
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
};

export const withRun = (ctx, fn) => store.run({ ...DEFAULTS, ...ctx }, fn);

/** The current run's context, or the defaults (process env keys, global fetch) outside any run. */
export function runCtx() {
  const ctx = store.getStore();
  if (ctx) return ctx;
  return {
    ...DEFAULTS,
    keys: { typesafe: process.env.TYPESAFE_API_KEY, claude: process.env.CLAUDE_API_KEY, tmdb: process.env.TMDB_API_KEY },
  };
}
