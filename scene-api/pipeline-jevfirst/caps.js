// The Jev-first pipeline's spending ceilings, in one dependency-free module (lib/jobs.js reads the
// reserve on every admission, and must not load the whole pipeline to do it). Each number is the cap
// v10.4's run-film.js gives the stage; each stage module enforces its own with reserve-before-dispatch,
// and test/jevfirst.test.js asserts these equal the stage modules' constants.
//
//   segment         Sonnet  $1.05 per film: attempt 1 <= $0.45, attempt 2 (two halves) <= $0.60, set aside first
//   split check     Jev     $0.03 (both gates together)
//   claims          Jev     $0.05
//   fill            Sonnet  $0.15, Jev $0.02
//   classify        Jev     $0.25
//   sonnetq         Sonnet  $0.30
//   childcry        Jev     $0.01
//   resolve         Jev     $0.01   (v10.2 resolution guard)
//   mortal          Jev     $0.04   (v10.3 mortal-danger questions)
//   moments         Jev     $0.02
//   describe        Sonnet  $0.15
//   check_describe  Jev     $0.08
//   describe2       Sonnet  $0.12   (v10.3 second describe attempt)
//   check_describe2 Jev     $0.06
//   titles          Sonnet  $0.04   (v10.3 title pass)
//   check_describe3 Jev     $0.03
//                           -----
//                           $2.41   the most one add (or rebuild) may cost; the admission reserves all of it
// A v10.3 film really cost about $0.55-0.70 in rounds 8-9 (most of it Sonnet's segmentation).
export const JEVFIRST_CAPS = {
  segment: 1.05, split: 0.03, claims: 0.05, fill_sonnet: 0.15, fill_jev: 0.02, classify: 0.25,
  sonnetq: 0.3, childcry: 0.01, resolve: 0.01, mortal: 0.04, moments: 0.02, describe: 0.15, check_describe: 0.08,
  describe2: 0.12, check_describe2: 0.06, titles: 0.04, check_describe3: 0.03,
};
export const JEVFIRST_RESERVE_USD = Math.round(Object.values(JEVFIRST_CAPS).reduce((a, b) => a + b, 0) * 100) / 100;
/** Jev-only stages a demo run may call, for the demo's per-run reservation ceiling. */
export const DEMO_STAGE_CAPS = {
  split: 0.03, claims: 0.05, fill_jev: 0.02, classify: 0.25, childcry: 0.01, resolve: 0.01, mortal: 0.04,
  moments: 0.02, check_describe: 0.08, check_describe2: 0.06, check_describe3: 0.03,
};
