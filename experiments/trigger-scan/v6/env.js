// Paths, keys and the held-out gate shared by every v6 script.
//
// Keys come from the two .env.local files, parsed here in Node (values can contain '&' and other
// shell metacharacters, so they are never shell-sourced). Nothing in this module prints a value.
//
// OUTPUT DIRECTORY: every script reads and writes under outDir() = $V6_OUT (relative to v6/) or
// v6/out. The builder's dev-film test runs used V6_OUT=out-dev so the Run phase starts from an empty
// out/ with its own per-film spend ledgers. Both are git-ignored.
//
// HELD-OUT GATE: frankenweenie and wild-robot may be processed only with --final-held-out-run AND
// only while out/freeze.json exists and every file it lists still has its recorded sha256
// (node freeze.js writes it). So nothing in questions/policy/select/claims/segmentation can change
// after a held-out film has been run without the gate refusing.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

export const V6 = path.dirname(fileURLToPath(import.meta.url));
export const TS = path.resolve(V6, '..'); // experiments/trigger-scan
export const ROOT = path.resolve(V6, '../../..'); // repo root

export const DEV_FILMS = ['nemo', 'monsters-inc', 'lion-king'];
export const HELD_OUT = new Set(['frankenweenie', 'wild-robot']);

/** A film's sources file: $V6_SOURCES/<slug>.json (relative to v6/) or v6/sources/<slug>.json. */
export const sourcesFile = (slug) => path.join(process.env.V6_SOURCES ? path.resolve(V6, process.env.V6_SOURCES) : path.join(V6, 'sources'), `${slug}.json`);

/** The output directory (created on demand). */
export function outDir() {
  const d = process.env.V6_OUT ? path.resolve(V6, process.env.V6_OUT) : path.join(V6, 'out');
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
// Every file whose content decides what a model is asked or how its answers become flags and spans.
export const FROZEN_FILES = [
  'questions.js', 'policy.json', 'select.js', 'check-claims.js', 'segment.js',
  'claims.js', 'cite.js', 'validate.js', 'classify.js', 'moments.js', 'aliases.js', 'spans.js',
  'sources.js', 'text.js', 'jev-client.js', 'jev.js', 'env.js',
];
export const FREEZE_FILE = () => path.join(V6, 'out', 'freeze.json');
export const sha256File = (f) => crypto.createHash('sha256').update(fs.readFileSync(path.join(V6, f))).digest('hex');

/** { ok, frozen_at, changed: [files] } for out/freeze.json, or { ok:false, missing:true }. */
export function freezeStatus() {
  const f = FREEZE_FILE();
  if (!fs.existsSync(f)) return { ok: false, missing: true, changed: [] };
  const fr = JSON.parse(fs.readFileSync(f, 'utf8'));
  const changed = Object.entries(fr.files).filter(([name, h]) => !fs.existsSync(path.join(V6, name)) || sha256File(name) !== h).map(([name]) => name);
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
    console.error(`${slug} is held out and ${st.missing ? 'out/freeze.json does not exist (run node freeze.js first)' : `these frozen files changed since ${st.frozen_at}: ${st.changed.join(', ')}`}. Refusing.`);
    process.exit(2);
  }
}
