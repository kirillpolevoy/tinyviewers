// Fetching one English subtitle track from OpenSubtitles, the way
// experiments/trigger-scan/fetch-subtitles.js does it: the REST API, authenticated with the
// `Api-Key` header. A Bearer token is NOT accepted on these endpoints — the key goes in that header
// or the request 401s, which is the one thing about this API that is easy to get wrong.
//
// Two searches, in order:
//   1. hearing_impaired=only, ordered by download_count. An SDH track carries sound captions —
//      (ROARS), (SCREAMS), (EXPLOSION) — and those captions are the only proxy this whole analysis
//      has for a fright that nobody says a word about. It is worth a second request to try for one.
//   2. any English track, if there is no SDH one.
//
// Then download candidates in order until one parses to at least MIN_CUES cues. A file with fewer
// than that is not a subtitle track for a feature film: it is a forced-narrative track, a song-only
// track, or a stub, and analysing it would produce a confident scene list for 20 lines of dialogue.
//
// Every request here has a deadline and the file has a size bound — see REQUEST_TIMEOUT_MS below.
// The script this was copied from ran on a laptop where a hung request was a person pressing
// Ctrl-C; here it is 300 s of function time and a job stuck on step one.
import { parseSrt } from './srt.js';
import { fail, PipelineError } from './errors.js';

export const API_BASE = 'https://api.opensubtitles.com/api/v1';
export const USER_AGENT = 'tinyviewers v0.1';
export const MIN_CUES = 300;
export const MAX_CANDIDATES = 4;

// This stage runs inside a function the platform kills at 300 s, and it is followed by three
// minutes of Sonnet. A third-party API that never answers must not be allowed to eat that budget,
// and a download link that turns out to point at a DVD image must not be read into memory. The
// file allowance is generous on purpose: the largest real SDH track in `data/` is under 200 KB, so
// 5 MB is "this is not a subtitle file" rather than a limit anything legitimate can reach.
export const REQUEST_TIMEOUT_MS = 15_000; // the search and the download call: JSON, one round trip
export const FILE_TIMEOUT_MS = 30_000;    // the file itself, off a CDN we do not control
export const MAX_FILE_BYTES = 5 * 1024 * 1024;

/** fetch with a deadline. The abort rejects the body read too, so a slow trickle is covered. */
async function fetchWithin(fetchImpl, url, opts, timeoutMs, onBody) {
  const controller = new AbortController();
  const deadline = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, { ...opts, signal: controller.signal });
    return await onBody(res);
  } finally {
    clearTimeout(deadline);
  }
}

/**
 * The response body as text, refusing anything over `maxBytes`.
 *
 * `content-length` is checked first because it is free, and then the stream is read with a running
 * total anyway: a server that omits the header, or lies in it, would otherwise decide how much
 * memory this function uses.
 */
async function textUpTo(res, maxBytes) {
  const declared = Number(res.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) return null;
  const reader = res.body?.getReader?.();
  if (!reader) {
    const text = await res.text();
    return Buffer.byteLength(text) > maxBytes ? null : text;
  }
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) { await reader.cancel().catch(() => {}); return null; }
    chunks.push(value);
  }
  return Buffer.concat(chunks.map((c) => Buffer.from(c))).toString('utf8');
}

// OpenSubtitles answers an exhausted download allowance with 406, and a rate limit with 429. Both
// mean "come back tomorrow", not "this film has no subtitles", and the difference matters to the
// person waiting: one is our fault for the day, the other is about the film.
const QUOTA_STATUSES = new Set([406, 429]);
const QUOTA_MESSAGE = 'OpenSubtitles download limit reached for today';

const headersFor = (apiKey) => ({
  'Api-Key': apiKey,
  'User-Agent': USER_AGENT,
  'Content-Type': 'application/json',
});

// The search endpoint takes the bare number, not the tt-prefixed id.
export const imdbNumber = (imdbId) => String(imdbId ?? '').replace(/^tt/i, '').replace(/^0+/, '');

async function search(url, headers, fetchImpl) {
  try {
    return await fetchWithin(fetchImpl, url, { headers }, REQUEST_TIMEOUT_MS, async (res) => {
      if (QUOTA_STATUSES.has(res.status)) throw fail('subtitle_quota', QUOTA_MESSAGE);
      if (!res.ok) throw fail('subtitle_search_failed', `OpenSubtitles search failed (${res.status}).`);
      const body = await res.json().catch(() => null);
      return Array.isArray(body?.data) ? body.data : [];
    });
  } catch (err) {
    // A timeout is not a different kind of problem to the caller than a 503 was: OpenSubtitles did
    // not answer, and there is nothing to choose from.
    if (err instanceof PipelineError) throw err;
    throw fail('subtitle_search_failed', `OpenSubtitles did not answer the subtitle search within ${REQUEST_TIMEOUT_MS / 1000}s.`);
  }
}

/**
 * One English subtitle file for a film, as text.
 *
 * @param {object} opts
 * @param {string} opts.imdbId  'tt0266543' or '266543'
 * @param {string} opts.apiKey  OPENSUBTITLES_API_KEY
 * @returns {Promise<{ srtText: string, cues: Array, release: string|null, file_id: number,
 *                     hearing_impaired: boolean, candidates: number, tried: number }>}
 * @throws {PipelineError} `no_subtitles` when nothing comes back or nothing parses; `subtitle_quota`
 *   when the allowance for the day is gone; `subtitle_search_failed` / `subtitle_download_failed`
 *   for anything else the API says.
 */
export async function fetchSubtitles({ imdbId, apiKey, fetchImpl = globalThis.fetch } = {}) {
  const id = imdbNumber(imdbId);
  if (!id) throw fail('no_subtitles', 'This film has no IMDb id, so there is nothing to look subtitles up by.');
  if (!apiKey) throw fail('no_subtitle_key', 'OPENSUBTITLES_API_KEY is not set on this deployment.');
  const headers = headersFor(apiKey);

  const sdh = await search(`${API_BASE}/subtitles?imdb_id=${id}&languages=en&hearing_impaired=only&order_by=download_count`, headers, fetchImpl);
  const plain = sdh.length
    ? []
    : await search(`${API_BASE}/subtitles?imdb_id=${id}&languages=en&order_by=download_count`, headers, fetchImpl);
  const candidates = sdh.length ? sdh : plain;
  if (!candidates.length) {
    throw fail('no_subtitles', 'OpenSubtitles has no English subtitles for this film, so there is nothing to analyse.');
  }

  let tried = 0;
  let best = null; // the longest thing we did manage to parse, for the error message
  for (const sub of candidates.slice(0, MAX_CANDIDATES)) {
    const fileId = sub.attributes?.files?.[0]?.file_id;
    if (!fileId) continue;
    tried += 1;

    // A candidate that times out, comes back too big, or 500s is skipped rather than fatal: there
    // are up to four of them and the next one is usually fine. Only the quota is fatal, because it
    // is about the day rather than about this file.
    let body = null;
    try {
      body = await fetchWithin(fetchImpl, `${API_BASE}/download`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ file_id: fileId, sub_format: 'srt' }),
      }, REQUEST_TIMEOUT_MS, async (dl) => {
        if (QUOTA_STATUSES.has(dl.status)) throw fail('subtitle_quota', QUOTA_MESSAGE);
        if (!dl.ok) return null;
        return dl.json().catch(() => null);
      });
    } catch (err) {
      if (err instanceof PipelineError) throw err;
      continue; // aborted or the socket died
    }
    // The API also reports the allowance in the body of an otherwise-OK response.
    if (body?.remaining !== undefined && body?.link === undefined) throw fail('subtitle_quota', QUOTA_MESSAGE);
    if (!body?.link) continue;

    let srtText = null;
    try {
      srtText = await fetchWithin(fetchImpl, body.link, {}, FILE_TIMEOUT_MS, async (fileRes) => (
        fileRes.ok ? textUpTo(fileRes, MAX_FILE_BYTES) : null
      ));
    } catch {
      continue;
    }
    if (srtText === null) continue; // not ok, over MAX_FILE_BYTES, or aborted mid-download
    const cues = parseSrt(srtText);
    if (cues.length > (best?.cues.length ?? 0)) best = { cues, release: sub.attributes?.release ?? null };
    if (cues.length >= MIN_CUES) {
      return {
        srtText,
        cues,
        release: sub.attributes?.release ?? null,
        file_id: fileId,
        hearing_impaired: sdh.length > 0,
        candidates: candidates.length,
        tried,
      };
    }
  }

  throw fail(
    'no_subtitles',
    best
      ? `The best English subtitle file for this film parsed to only ${best.cues.length} lines, below the ${MIN_CUES} a feature needs. It is probably a forced or song-only track.`
      : 'None of the English subtitle files for this film could be downloaded or parsed.',
  );
}
