// The experiment's modules in pack/ import '../srt.js'. This is that path, pointing at the copy the
// live pipeline already has (pipeline/srt.js, byte-identical to experiments/trigger-scan/srt.js below
// its two-line header), so there is one SRT parser in the deployment, not two.
export * from '../pipeline/srt.js';
