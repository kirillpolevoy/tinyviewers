// The experiment's pack/questions.js imports '../taxonomy-v3.js'. This is that path, pointing at the
// copy the live pipeline and the loader already use (pipeline/taxonomy-v3.js, byte-identical to
// experiments/trigger-scan/taxonomy-v3.js below its header, asserted by test/unit.test.js), so a
// Jev-first film and a live film are labelled with the same vocabulary rows.
export * from '../pipeline/taxonomy-v3.js';
