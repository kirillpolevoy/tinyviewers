// A stage's spending ceiling, enforced before a call is dispatched rather than after it is billed.
//
// The caps used to be checked against completed spending, which is not a cap when calls run five at
// a time: five workers each read "$0.96 spent, under the $1.00 cap", each dispatched, and the stage
// finished at $1.176. The reserve in lib/jobs.js is built out of these numbers and is quoted to the
// person as the most a run can cost, so a cap that a normal run overshoots by 18% makes the daily
// budget a guess.
//
// The fix is the ordinary one: reserve the worst case, dispatch, then settle the reservation
// against what the call really cost. At any instant `spent + reserved` is an upper bound on what
// this stage can still end up owing, so refusing when `spent + reserved + next > cap` is a ceiling
// that holds however many calls are in flight.

export function budget(capUsd) {
  let spent = 0;
  let reserved = 0;
  return {
    cap: capUsd,
    get spent() { return spent; },
    get reserved() { return reserved; },
    /**
     * Take headroom for one call. Returns false when this call would put the stage over its cap,
     * and the caller must then not dispatch it — there is no "just this once".
     */
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
