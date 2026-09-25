// Fetch ONE English subtitle track for a held-out film that is new to the library, using the
// production fetcher (scene-api/pipeline/subtitles.js, imported read-only: SDH first, then any
// English track; it would download candidates in order until one parses to >= 300 cues).
// Round 4 cap: at most ONE download per film. The fetchImpl wrapper below answers any second
// /download request with a local 499 (never sent), so the fetcher skips it and gives up instead.
//
//   node refs/fetch-srt.js up
//
// Writes data/<slug>.srt (git-ignored) and adds the track's provenance to refs/<slug>.film.json.
// The API key is read from .env.local by a small parser here; it is never printed.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchSubtitles } from '../../../scene-api/pipeline/subtitles.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, '../../..');
const slug = process.argv[2];
if (!slug) throw new Error('usage: node refs/fetch-srt.js <slug>');
const filmPath = path.join(here, `${slug}.film.json`);
const film = JSON.parse(fs.readFileSync(filmPath, 'utf8'));
const out = path.resolve(here, '..', 'data', `${slug}.srt`);
if (fs.existsSync(out)) throw new Error(`${out} already exists; not downloading again (daily quota)`);

function envValue(name) {
  for (const p of ['.env.local', 'scene-api/.env.local']) {
    let text = '';
    try { text = fs.readFileSync(path.join(ROOT, p), 'utf8'); } catch { continue; }
    for (const line of text.split('\n')) {
      const m = line.match(/^\s*(?:export\s+)?([A-Za-z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && m[1] === name) return m[2].replace(/^(['"])(.*)\1$/, '$2');
    }
  }
  return null;
}

// Record what the fetcher asked for (URL paths and statuses only; no headers, no bodies).
const calls = [];
let downloads = 0;
const fetchImpl = async (url, opts) => {
  const u = new URL(url);
  if (u.pathname.endsWith('/download') && (opts?.method ?? 'GET') === 'POST') {
    downloads += 1;
    if (downloads > 1) {
      calls.push({ host: u.host, path: u.pathname, method: 'POST', status: 499, note: 'not sent: one-download-per-film cap' });
      return new Response(null, { status: 499 });
    }
  }
  const res = await fetch(url, opts);
  const call = { host: u.host, path: u.host === 'api.opensubtitles.com' ? `${u.pathname}${u.search}` : '(file link)', method: opts?.method ?? 'GET', status: res.status };
  // Round 6: log the download allowance the API reports on every /download answer (never the link).
  if (u.pathname.endsWith('/download')) {
    const b = await res.clone().json().catch(() => null);
    if (b) Object.assign(call, { remaining: b.remaining ?? null, requests: b.requests ?? null, reset_time_utc: b.reset_time_utc ?? b.reset_time ?? null, message: b.message ?? null });
  }
  calls.push(call);
  return res;
};

// Round 6: every attempt (success or refusal) is appended to data/subtitle-downloads.log, so a
// refusal (406/429 -> subtitle_quota) is on record and the caller stops.
const LOG = path.resolve(here, '..', 'data', 'subtitle-downloads.log');
const logLine = (entry) => fs.appendFileSync(LOG, `${JSON.stringify({ at: new Date().toISOString(), slug, imdb_id: film.imdb_id, ...entry })}\n`);
let r;
try {
  r = await fetchSubtitles({ imdbId: film.imdb_id, apiKey: envValue('OPENSUBTITLES_API_KEY'), fetchImpl });
} catch (e) {
  logLine({ ok: false, code: e.code ?? null, error: String(e.message ?? e), requests: calls });
  console.error(`${slug}: REFUSED/FAILED ${e.code ?? ''} ${e.message}; requests: ${JSON.stringify(calls)}`);
  process.exit(2);
}
const dl = calls.find((c) => c.path === '/api/v1/download' && c.status === 200);
logLine({ ok: true, release: r.release, file_id: r.file_id, hearing_impaired: r.hearing_impaired, cues: r.cues.length, remaining: dl?.remaining ?? null, reset_time_utc: dl?.reset_time_utc ?? null });
fs.writeFileSync(out, r.srtText);
const soundCues = (r.srtText.match(/[\[(][^\])\n]{2,40}[\])]/g) ?? []).length;
film.subtitles = {
  file: `data/${slug}.srt`, fetched_at: new Date().toISOString(), via: 'scene-api/pipeline/subtitles.js fetchSubtitles (imported, unmodified)',
  release: r.release, file_id: r.file_id, hearing_impaired: r.hearing_impaired, cues: r.cues.length, sound_cues: soundCues,
  candidates: r.candidates, downloads_used: Math.min(downloads, 1), download_attempts_including_capped: r.tried,
  last_cue: r.cues.at(-1) ? Math.round(r.cues.at(-1).endMs / 1000) : null,
  requests: calls,
};
fs.writeFileSync(filmPath, `${JSON.stringify(film, null, 2)}\n`);
console.log(`${slug}: ${r.cues.length} cues, ${soundCues} sound cues, SDH ${r.hearing_impaired}, release ${r.release}, downloads ${r.tried}/${r.candidates} candidates, remaining ${dl?.remaining ?? 'not reported'} (reset ${dl?.reset_time_utc ?? '?'})`);
