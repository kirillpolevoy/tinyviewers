// Paths, keys and the held-out gate shared by every v9 script (copied from v8; V8 below is THIS
// directory, the name kept so the copied scripts need no edits; V9 is the same path).
//
// Keys come from the two .env.local files, parsed here in Node (values can contain '&' and other
// shell metacharacters, so they are never shell-sourced). Nothing in this module prints a value.
//
// OUTPUT DIRECTORY: every script reads and writes under outDir() = $V9_OUT (relative to v9/) or
// v9/out. Git-ignored.
//
// HELD-OUT GATE (v8): the seven films opened by rounds 1-3 are DEV films (round 3 opened iron-giant
// and up). EVERY other slug is held out -- the round-4 head-to-head films the key builder picks, whose
// slugs the pipeline builder does not know in advance -- and may be processed only with
// --final-held-out-run AND only while out/freeze.json exists and every file it lists still has its
// recorded sha256 (node freeze.js writes it). So nothing in questions / policy / select / segment /
// split check / claim check / fill / reasons / moments can change after a held-out film has run
// without the gate refusing.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

export const V8 = path.dirname(fileURLToPath(import.meta.url));
export const V9 = V8;
export const TS = path.resolve(V8, '..'); // experiments/trigger-scan
export const ROOT = path.resolve(V8, '../../..'); // repo root

// v10: the thirteen films opened by rounds 1-5 are all DEV films (round 5 opened book-of-life,
// princess-and-the-frog and moana; v10's phrasings were chosen on all thirteen). Every other slug is held out.
// v10.1: round 6 opened good-dinosaur (its v10 outputs were read to design v10.1), so it is a DEV film too.
// frozen and zootopia stay HELD OUT for classification (only their segmentation outcome is known).
// v10.2: round 7 opened frozen and zootopia (their v10.1 outputs were read to design v10.2), so all 16 films of
// rounds 1-7 are DEV films. Every other slug (the next round's fresh films) is held out.
// v10.3: round 8 opened incredibles, big-hero-6 and brave (their v10.2 outputs were read to design v10.3), so all 19
// films of rounds 1-8 are DEV films. Every other slug (round 9's fresh films) is held out.
export const DEV_FILMS = ['nemo', 'monsters-inc', 'lion-king', 'frankenweenie', 'wild-robot', 'iron-giant', 'up', 'tangled', 'coco', 'how-to-train-your-dragon', 'book-of-life', 'princess-and-the-frog', 'moana', 'good-dinosaur', 'frozen', 'zootopia', 'incredibles', 'big-hero-6', 'brave'];
/** Held out = anything that is not a dev film (a Set-like object so `HELD_OUT.has(slug)` still works). */
export const isHeldOut = (slug) => !DEV_FILMS.includes(slug);
export const HELD_OUT = { has: isHeldOut, [Symbol.iterator]: function* () {} };

/**
 * A film's sources file: $V9_SOURCES/<slug>.json (relative to this directory), else v10_1/sources/<slug>.json
 * when it exists, else v10/sources/<slug>.json (v10.1 changed nothing in sources.js; the pinned v10 sources are
 * read, never written).
 */
export const sourcesFile = (slug) => {
  if (process.env.V9_SOURCES) return path.join(path.resolve(V8, process.env.V9_SOURCES), `${slug}.json`);
  const own = path.join(V8, 'sources', `${slug}.json`);
  return fs.existsSync(own) ? own : path.join(TS, 'v10', 'sources', `${slug}.json`);
};

/**
 * The output directory (created on demand). v10: $V10_OUT (relative to v10/) or v10/out10. (v10/out is a
 * byte-identical copy of v9/out, kept untouched as the v9 baseline; v10 never writes there.)
 */
export function outDir() {
  // v10.2: $V102_OUT (relative to v10_2/) or v10_2/out102. Earlier versions' outputs (v10/out, v10/out10,
  // v10_1/out101, v10_1/round7) are read-only inputs.
  // v10.3: $V103_OUT (relative to v10_3/) or v10_3/out103. v10.2's out102 is a read-only input.
  const d = process.env.V103_OUT ? path.resolve(V8, process.env.V103_OUT) : path.join(V8, 'out103');
  fs.mkdirSync(d, { recursive: true });
  return d;
}

export function readEnvFile(file) {
  const out = {};
  if (!fs.existsSync(file)) return out;
  for (const raw of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = raw.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    out[m[1]] = v;
  }
  return out;
}

/** The named key from the environment or the .env.local files. Throws (naming only the key) if absent. */
export function key(name) {
  if (process.env[name]) return process.env[name];
  for (const f of [path.join(ROOT, '.env.local'), path.join(ROOT, 'scene-api/.env.local')]) {
    const v = readEnvFile(f)[name];
    if (v) return v;
  }
  throw new Error(`${name} not found in the environment or .env.local`);
}

/** films.json entry plus the IMDb id the loader uses (films.json, then the loader scene source's .movie). */
export function filmMeta(slug) {
  const films = JSON.parse(fs.readFileSync(path.join(TS, 'films.json'), 'utf8'));
  const meta = films[slug];
  if (!meta) throw new Error(`${slug} is not in films.json`);
  // mirrors sceneSourceFor() in scene-api/load.js (read-only use)
  const src = slug === 'nemo' ? path.join(TS, 'scenes.nemo.grounded.json') : path.join(TS, 'runs-v3', `sonnet-alone-${slug}.json`);
  const movie = fs.existsSync(src) ? JSON.parse(fs.readFileSync(src, 'utf8')).movie ?? {} : {};
  const film = { slug, title: meta.title ?? movie.title ?? slug, year: meta.year ?? movie.year ?? null, imdb_id: meta.imdb_id ?? movie.imdb_id ?? null };
  if (!film.imdb_id) throw new Error(`${slug}: no IMDb id in films.json or the loader scene source`);
  return film;
}

// ---- freeze ----------------------------------------------------------------------------------------
// Every file whose content decides what a model is asked, how its answers become flags, spans or a
// split verdict, or which films may run. v7 added the split gate (gate.js, check-split.js), the
// segmentation prompt module (segment-prompt.js) and the Sonnet client (sonnet.js), and the
// shared SRT parser and quotation rule inputs (../srt.js).
// v8 adds the unified acceptance rule (accept.js, refold.js), the wordless fill (fill.js), the
// re-classification of changed scenes (reclassify.js), the why for flagged scenes (reasons.js) and the
// stage runner (run-film.js).
// v9 adds the question split (split.json, split.js), Sonnet's question layer and pass
// (sonnet-questions.js, sonnetq.js), the answer merge (merge.js), the parent text (describe.js,
// check-describe.js) and keeps everything v8 froze.
export const FROZEN_FILES = [
  'questions.js', 'policy.json', 'select.js', 'check-claims.js', 'segment.js', 'segment-prompt.js',
  'gate.js', 'check-split.js', 'claims.js', 'cite.js', 'validate.js', 'classify.js', 'moments.js',
  'aliases.js', 'spans.js', 'sources.js', 'text.js', 'jev-client.js', 'jev.js', 'sonnet.js', 'budget.js',
  'ledger.js', 'env.js', '../srt.js', '../claude.js', '../common.js',
  'accept.js', 'refold.js', 'fill.js', 'reclassify.js', 'reasons.js', 'run-film.js',
  'split.json', 'split.js', 'sonnet-questions.js', 'sonnetq.js', 'merge.js', 'describe.js', 'check-describe.js',
  // v10: the Jev set (generated by assemble/build.mjs), the combine rules and the question lint
  'jev-set.js', 'combine.js', 'lint.js',
  // v10.1: end-credits detection (split gate + no flags on credits), the parent-text safety layer and the
  // child-crying follow-up (rule 2)
  'credits.js', 'textsafe.js', 'childcry.js',
  // v10.2: the resolution guard (fix 3) and the rule-1 question stage (resolve.js)
  'resolve.js',
  // v10.3: the mortal-danger questions (mortal.js), the second describe attempt (describe2.js), the reason /
  // title rules they feed (reasons.js, textsafe.js are already frozen), the span bridge (bridge.js)
  'mortal.js', 'describe2.js', 'bridge.js',
];
export const FREEZE_FILE = () => path.join(outDir(), 'freeze.json');
export const sha256File = (f) => crypto.createHash('sha256').update(fs.readFileSync(path.join(V8, f))).digest('hex');

/** { ok, frozen_at, changed: [files] } for out/freeze.json, or { ok:false, missing:true }. */
export function freezeStatus() {
  const f = FREEZE_FILE();
  if (!fs.existsSync(f)) return { ok: false, missing: true, changed: [] };
  const fr = JSON.parse(fs.readFileSync(f, 'utf8'));
  const changed = Object.entries(fr.files).filter(([name, h]) => !fs.existsSync(path.join(V8, name)) || sha256File(name) !== h).map(([name]) => name);
  return { ok: changed.length === 0, frozen_at: fr.frozen_at, changed };
}

/** Exit(2) unless a held-out slug is allowed: --final-held-out-run and an intact freeze. */
export function heldOutGate(slug, argv = process.argv) {
  if (!HELD_OUT.has(slug)) return;
  if (!argv.includes('--final-held-out-run')) {
    console.error(`${slug} is held out (pass --final-held-out-run only for the frozen final run).`);
    process.exit(2);
  }
  const st = freezeStatus();
  if (!st.ok) {
    console.error(`${slug} is held out and ${st.missing ? 'out103/freeze.json does not exist (run node freeze.js first)' : `these frozen files changed since ${st.frozen_at}: ${st.changed.join(', ')}`}. Refusing.`);
    process.exit(2);
  }
}
