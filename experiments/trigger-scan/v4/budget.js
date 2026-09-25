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
