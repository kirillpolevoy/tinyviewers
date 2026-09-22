// verify-excerpts.js — check that an excerpts file stays inside the policy it was granted.
//
//   node verify-excerpts.js nemo
//   node verify-excerpts.js              # every excerpts file in recordings/
//
// Separate from verify-recording.js on purpose: the excerpts file is untracked, optional and local,
// and the recording must verify with or without it. Needs data/<slug>.srt, because checking that a
// quoted line really is that cue's line means reading the cue.
import fs from 'node:fs';
import path from 'node:path';
import { here, loadFilm } from './common.js';
import { EXCERPT_MAX_LINES, EXCERPT_MAX_WORDS } from './jev-v3-core.js';

const cueNum = (id) => Number(id.slice(1));
const wordCount = (s) => s.trim().split(/\s+/).filter(Boolean).length;

export function verifyExcerpts(slug) {
  const rec = JSON.parse(fs.readFileSync(path.join(here, 'recordings', `${slug}.jev.json`), 'utf8'));
  const file = path.join(here, 'recordings', `${slug}.excerpts.json`);
  const ex = JSON.parse(fs.readFileSync(file, 'utf8'));
  const cues = new Map(loadFilm(slug).cues.map((c) => [c.id, c]));
  const beats = new Map(rec.beats.map((b) => [b.id, b]));
  const top = new Map(rec.thresholds.flagged.map((f) => [f.beat_id, f.top]));
  const fails = [];
  const ok = (cond, msg) => {
    if (!cond) fails.push(msg);
  };

  // ---- excerpts exist for flagged beats, and only for flagged beats -------------------------------
  const flaggedIds = rec.beats.filter((b) => b.flagged).map((b) => b.id);
  for (const id of Object.keys(ex)) {
    ok(beats.has(id), `${id}: not a beat in this recording`);
    ok(beats.get(id)?.flagged === true, `${id}: has an excerpt but is not flagged`);
  }
  for (const id of flaggedIds) ok(id in ex, `${id}: flagged but has no excerpt`);
  ok(Object.keys(ex).length === flaggedIds.length, `${Object.keys(ex).length} excerpt beats vs ${flaggedIds.length} flagged beats`);

  // ---- per beat -----------------------------------------------------------------------------------
  let lines = 0;
  let words = 0;
  for (const [id, list] of Object.entries(ex)) {
    const beat = beats.get(id);
    if (!beat) continue;
    const lo = cueNum(beat.start_cue);
    const hi = cueNum(beat.end_cue);
    const beatCues = hi - lo + 1;

    ok(Array.isArray(list), `${id}: excerpt is not a list`);
    ok(list.length <= EXCERPT_MAX_LINES, `${id}: ${list.length} lines, the cap is ${EXCERPT_MAX_LINES}`);
    // Two lines per flagged beat is the rule; a beat with only one cue can only give one.
    ok(list.length === Math.min(EXCERPT_MAX_LINES, beatCues), `${id}: ${list.length} lines for a beat of ${beatCues} cues`);

    const seen = new Set();
    let prev = -1;
    for (const e of list) {
      lines++;
      words += wordCount(e.line);
      ok(typeof e.cue === 'string' && /^C\d{4}$/.test(e.cue), `${id}: ${e.cue} is not a cue id`);
      ok(cueNum(e.cue) >= lo && cueNum(e.cue) <= hi, `${id}: cue ${e.cue} is outside the beat (${beat.start_cue}..${beat.end_cue})`);
      ok(cues.has(e.cue), `${id}: cue ${e.cue} is not in the subtitle file`);
      ok(!seen.has(e.cue), `${id}: cue ${e.cue} quoted twice`);
      seen.add(e.cue);
      ok(cueNum(e.cue) > prev, `${id}: lines are not in film order`);
      prev = cueNum(e.cue);

      ok(wordCount(e.line) <= EXCERPT_MAX_WORDS, `${id}/${e.cue}: ${wordCount(e.line)} words, the cap is ${EXCERPT_MAX_WORDS}`);

      // The quoted line must be that cue's line, whole or truncated with an ellipsis — never anything
      // stitched together or paraphrased.
      const real = cues.get(e.cue)?.text.replace(/\s+/g, ' ').trim() ?? '';
      const truncated = e.line.endsWith('…');
      const body = truncated ? e.line.slice(0, -1) : e.line;
      ok(truncated ? real.startsWith(body) : real === body, `${id}/${e.cue}: quoted line is not this cue's text`);
      ok(truncated === (wordCount(real) > EXCERPT_MAX_WORDS), `${id}/${e.cue}: ellipsis does not match whether the cue was cut`);

      // `why` must point at items the beat was actually flagged on, at the recorded probability.
      const t = top.get(id) ?? [];
      ok(e.why && Array.isArray(e.why.items) && Array.isArray(e.why.words), `${id}/${e.cue}: no why block`);
      for (const item of e.why.items ?? []) {
        const match = t.find((x) => x.id === item.id && x.channel === item.channel);
        ok(!!match, `${id}/${e.cue}: why cites ${item.channel}.${item.id}, which is not in the beat's top three`);
        ok(match && match.p === item.p, `${id}/${e.cue}: why cites ${item.id} at ${item.p}, recorded as ${match?.p}`);
      }
      if (!(e.why.items ?? []).length) ok(e.why.fallback === 'longest_cue', `${id}/${e.cue}: no items and no fallback reason`);
      else ok((e.why.words ?? []).length > 0, `${id}/${e.cue}: cites items but no matched words`);
      // Every highlighted word must be findable in the cue, so a front end can actually highlight it.
      const hay = ` ${real.toLowerCase().replace(/[^a-z!\s]/g, ' ').replace(/\s+/g, ' ')} `;
      for (const w of e.why.words ?? []) {
        const needle = w.toLowerCase().replace(/[^a-z!\s]/g, ' ').replace(/\s+/g, ' ').trim();
        const firstWord = needle.split(' ')[0];
        ok(needle.length === 0 || hay.includes(` ${firstWord}`) || hay.includes(firstWord), `${id}/${e.cue}: highlighted "${w}" does not occur in the line`);
      }
    }
  }

  const filmWords = loadFilm(slug).cues.reduce((s, c) => s + wordCount(c.text), 0);
  return { slug, fails, beats: Object.keys(ex).length, lines, words, filmWords, share: (words / filmWords) * 100 };
}

const slugs = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const all = slugs.length
  ? slugs
  : fs.readdirSync(path.join(here, 'recordings')).filter((f) => f.endsWith('.excerpts.json')).map((f) => f.replace('.excerpts.json', ''));

let bad = 0;
for (const slug of all) {
  const r = verifyExcerpts(slug);
  if (r.fails.length) {
    bad++;
    console.log(`FAIL ${slug}: ${r.fails.length} problems`);
    for (const f of r.fails.slice(0, 20)) console.log(`  - ${f}`);
    if (r.fails.length > 20) console.log(`  ... ${r.fails.length - 20} more`);
  } else {
    console.log(`ok   ${slug}: ${r.beats} flagged beats, ${r.lines} lines, ${r.words} words = ${r.share.toFixed(2)}% of ${r.filmWords} subtitle words`);
  }
}
if (bad) process.exitCode = 1;
