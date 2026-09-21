import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { parseSrt, buildWindows, formatTime } from './srt.js';

export const here = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(here, '../../.env.local'), quiet: true });

export const glossary = JSON.parse(fs.readFileSync(path.join(here, 'glossary.json'), 'utf8'));

// track: 'sdh' (primary, has sound captions) or 'db' (what the app stores today)
export function loadTrack(track) {
  const cues = parseSrt(fs.readFileSync(path.join(here, 'data', `nemo.${track}.srt`), 'utf8'));
  return { cues, windows: buildWindows(cues) };
}

// Any film whose subtitles were dumped to data/<slug>.srt (see films.json).
export function loadFilm(slug) {
  const cues = parseSrt(fs.readFileSync(path.join(here, 'data', `${slug}.srt`), 'utf8'));
  return { cues, windows: buildWindows(cues) };
}

export const cueLine = (c) => `${c.id} [${formatTime(c.startMs)}] ${c.text}`;

// Last few lines of the previous window, so a window is not read completely cold.
export const previousLines = (windows, i, n = 8) => (i === 0 ? [] : windows[i - 1].cues.slice(-n).map(cueLine));

export function parseArgs(argv = process.argv.slice(2)) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith('--')) continue;
    const key = argv[i].slice(2);
    const next = argv[i + 1];
    args[key] = next && !next.startsWith('--') ? argv[++i] : true;
  }
  return args;
}

export async function pool(items, concurrency, worker) {
  const results = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        results[i] = await worker(items[i], i);
      }
    }),
  );
  return results;
}

// POST JSON with backoff on rate-limit / overload responses.
export async function postJson(url, headers, body, { retries = 5 } = {}) {
  for (let attempt = 0; ; attempt++) {
    const started = Date.now();
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
    if (res.ok) return { json: await res.json(), latencyMs: Date.now() - started };
    const text = await res.text();
    if (![429, 500, 502, 503, 529].includes(res.status) || attempt >= retries) {
      throw new Error(`${url} -> ${res.status}: ${text.slice(0, 500)}`);
    }
    const retryAfter = Number(res.headers.get('retry-after'));
    await new Promise((r) => setTimeout(r, retryAfter > 0 ? retryAfter * 1000 : 2000 * 2 ** attempt));
  }
}

export function saveRun(run, dir = 'runs') {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const file = path.join(here, dir, `${stamp}-${run.arm.replace(/[^\w+.-]/g, '_')}-${run.track}${run.label ? `-${run.label}` : ''}.json`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(run, null, 2));
  return file;
}
