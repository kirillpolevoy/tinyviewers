// OURS, not a copy. Stands in for experiments/trigger-scan/v10_1/ledger.js, which kept a per-film
// spend file so a per-film cap held across reruns. Here that job is done by the database: every
// priced call is banked into job_stages / demo_runs as it lands (context.js onSpend), and a stage
// re-run after a crash starts from the spending high-water mark its earlier attempt persisted (see
// pipeline-jevfirst/store.js). The copied modules only call these from their CLI blocks.
export const readLedger = () => ({ entries: [] });
export const spentSoFar = () => 0;
export const record = () => {};
