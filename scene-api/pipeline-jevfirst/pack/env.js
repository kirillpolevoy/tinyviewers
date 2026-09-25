// OURS, not a copy (scripts/sync-jevfirst-pack.mjs never overwrites it). Stands in for
// experiments/trigger-scan/v10_1/env.js, whose job was paths, .env.local parsing and the held-out
// gate -- none of which exists in a serverless function. Every name the experiment's env.js exports is
// exported here, so the copied modules link; the file-system ones throw if a copied CLI path ever
// reaches them, because in this deployment nothing reads or writes the experiment's out/ directory.
import { runCtx } from '../context.js';

const noFiles = (what) => () => { throw new Error(`pipeline-jevfirst: ${what} is a file-system path of the experiment and does not exist here`); };

export const V8 = null;
export const V9 = null;
export const TS = null;
export const ROOT = null;
export const DEV_FILMS = [];
export const isHeldOut = () => false;
export const HELD_OUT = { has: () => false, [Symbol.iterator]: function* () {} };
export const FROZEN_FILES = [];
export const sourcesFile = noFiles('sourcesFile');
export const outDir = noFiles('outDir');
export const readEnvFile = () => ({});
export const filmMeta = noFiles('filmMeta');
export const FREEZE_FILE = noFiles('FREEZE_FILE');
export const sha256File = noFiles('sha256File');
export const freezeStatus = () => ({ ok: true, changed: [] });
/** The held-out gate is an experiment-design rule (which films the builders may look at); it has no meaning for a live run. */
export const heldOutGate = () => {};

const KEY_NAMES = { TYPESAFE_API_KEY: 'typesafe', CLAUDE_API_KEY: 'claude', TMDB_API_KEY: 'tmdb' };

/** A key from the run context (tests inject), else the environment. The error names the key, never a value. */
export function key(name) {
  const v = runCtx().keys?.[KEY_NAMES[name]] ?? process.env[name];
  if (v) return v;
  throw new Error(`${name} is not configured`);
}
