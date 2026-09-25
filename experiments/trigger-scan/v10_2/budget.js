// Hard dollar cap, reserved BEFORE each call and settled after it. Same pattern as
// scene-api/pipeline/budget.js (copied, not imported, so v4 never depends on scene-api's working tree).
//
// At any instant `spent + reserved` is an upper bound on what the script can still owe, so refusing
// when `spent + reserved + next > cap` holds however many calls are in flight.

export function budget(capUsd) {
  let spent = 0;
  let reserved = 0;
  return {
    cap: capUsd,
    get spent() { return spent; },
    get reserved() { return reserved; },
    /** Take headroom for one call. false = this call would break the cap; the caller must not dispatch it. */
    reserve(usd) {
      if (spent + reserved + usd > capUsd) return false;
      reserved += usd;
      return true;
    },
    /** The call is over, however it ended: release its reservation and bank what it really cost. */
    settle(reservedUsd, actualUsd = 0) {
      reserved = Math.max(0, reserved - reservedUsd);
      spent += actualUsd;
    },
  };
}

/**
 * v10.1 PER-ATTEMPT CAPS inside one per-film cap (segment.js). Round 6: attempt 1 (whole film) reserved the
 * whole $0.45 film cap, so the halves retry (attempt 2) had no budget left and never ran. Now attempt 2's cap
 * is set aside FIRST: attempt 1 may use at most min(a1, film left - attempt 2's cap), so attempt 1 can never
 * starve the retry; attempt 2 then gets min(a2, film left - what attempt 1 actually spent) (>= its reserved
 * share). Every call still reserves its own worst case inside its attempt's cap (budget above), so the per-film
 * cap holds: attempt-1 cap + attempt-2 cap <= film left.
 *   cap    per-film cap across reruns (ledger)   prior  already spent on this film
 *   a1     attempt-1 cap                          a2     attempt-2 cap (both halves together)
 */
export function attemptCaps({ cap, prior = 0, a1, a2 }) {
  const left = Math.max(0, cap - prior);
  const a2Cap = Math.min(a2, left);
  const a1Cap = Math.max(0, Math.min(a1, left - a2Cap));
  return { film_left: left, a1_cap: a1Cap, a2_cap: a2Cap, a2_after: (a1Spent) => Math.min(a2, Math.max(0, left - a1Spent)) };
}
