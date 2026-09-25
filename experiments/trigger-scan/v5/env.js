// Keys come from the two .env.local files, parsed here in Node (values can contain '&' and other
// shell metacharacters, so they are never shell-sourced). Nothing in this module prints a value.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const V5 = path.dirname(fileURLToPath(import.meta.url));
export const TS = path.resolve(V5, '..'); // experiments/trigger-scan
export const ROOT = path.resolve(V5, '../../..'); // repo root

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
