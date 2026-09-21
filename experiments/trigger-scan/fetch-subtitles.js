// Read-only. Dumps the stored Finding Nemo SRT from Supabase and tries to find an SDH
// (hearing-impaired) track on OpenSubtitles, since sound cues are the only text proxy for
// loud sounds / flashing lights. Writes to data/ (git-ignored).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { parseSrt } from './srt.js';

const here = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(here, '../../.env.local'), quiet: true });

const MOVIE_TITLE = 'Finding Nemo';
const IMDB_ID = 266543; // tt0266543
const dataDir = path.join(here, 'data');
fs.mkdirSync(dataDir, { recursive: true });

const soundCueCount = (text) => (text.match(/[\[(][^\])\n]{2,40}[\])]/g) ?? []).length;

async function dumpDbTrack() {
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  const { data: movie, error } = await sb.from('movies').select('id,title').eq('title', MOVIE_TITLE).single();
  if (error) throw new Error(`movie lookup failed: ${error.message}`);
  const { data: subs, error: subErr } = await sb
    .from('subtitles')
    .select('id,subtitle_text,source,created_at')
    .eq('movie_id', movie.id)
    .eq('language', 'en');
  if (subErr || !subs?.length) throw new Error(`no subtitles for ${MOVIE_TITLE}: ${subErr?.message ?? 'empty'}`);
  const text = subs[0].subtitle_text;
  fs.writeFileSync(path.join(dataDir, 'nemo.db.srt'), text);
  const cues = parseSrt(text);
  console.log(`db track: ${cues.length} cues, ${soundCueCount(text)} sound cues, row ${subs[0].id}`);
  return { row: subs[0].id, cues: cues.length, soundCues: soundCueCount(text) };
}

async function fetchSdhTrack() {
  const headers = {
    'Api-Key': process.env.OPENSUBTITLES_API_KEY,
    'User-Agent': 'tinyviewers v0.1',
    'Content-Type': 'application/json',
  };
  const url = `https://api.opensubtitles.com/api/v1/subtitles?imdb_id=${IMDB_ID}&languages=en&hearing_impaired=only&order_by=download_count`;
  const res = await fetch(url, { headers });
  if (!res.ok) {
    console.log(`sdh search failed: ${res.status} ${await res.text()}`);
    return null;
  }
  const { data } = await res.json();
  console.log(`sdh search: ${data.length} candidates`);
  for (const sub of data.slice(0, 3)) {
    const fileId = sub.attributes.files?.[0]?.file_id;
    if (!fileId) continue;
    const dl = await fetch('https://api.opensubtitles.com/api/v1/download', {
      method: 'POST',
      headers,
      body: JSON.stringify({ file_id: fileId, sub_format: 'srt' }),
    });
    if (!dl.ok) {
      console.log(`download ${fileId} failed: ${dl.status} ${await dl.text()}`);
      continue;
    }
    const { link } = await dl.json();
    const text = await (await fetch(link)).text();
    const cues = parseSrt(text);
    const sounds = soundCueCount(text);
    console.log(`candidate ${fileId} (${sub.attributes.release}): ${cues.length} cues, ${sounds} sound cues`);
    if (cues.length > 500 && sounds > 20) {
      fs.writeFileSync(path.join(dataDir, 'nemo.sdh.srt'), text);
      return { fileId, release: sub.attributes.release, cues: cues.length, soundCues: sounds };
    }
  }
  return null;
}

const db = await dumpDbTrack();
const sdh = await fetchSdhTrack();
fs.writeFileSync(path.join(dataDir, 'tracks.json'), JSON.stringify({ db, sdh }, null, 2));
console.log(sdh ? `sdh track saved: ${JSON.stringify(sdh)}` : 'no usable SDH track found');
