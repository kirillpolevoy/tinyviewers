// Step 3b (rounds 3 and 4, held-out films only): a Codex pass over the SUBTITLES that lists the moments
// policy rules 1 and 2 are about, because the human-written advisories barely cover them:
//   villain_threat  - a villain or antagonist explicitly threatens to kill or hurt someone, or orders it
//   child_terrified - a child character (child, cub, young animal) is terrified, screaming in fear, or crying
// These items are MODEL-WRITTEN, not human-written. map.js appends them to the key's items with
// source 'codex-rules' and human_written false, so a scorer can keep them apart from the advisory items.
//
//   node refs/rules.js [slug...]          -> codex/<slug>.rules.answer.json (git-ignored)
//
// Evaluation only: never feed to Sonnet, Jev, the question set or the policy.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSrt, formatTime } from '../srt.js';
import { runCodex, obj } from './codex.js';

const here = path.dirname(fileURLToPath(import.meta.url));
export const RULE_SLUGS = ['iron-giant', 'up', 'tangled', 'coco', 'how-to-train-your-dragon', 'book-of-life', 'princess-and-the-frog', 'moana',
  'frozen', 'zootopia', 'good-dinosaur', 'incredibles', 'big-hero-6', 'brave', 'kung-fu-panda', 'onward', 'croods'];

export const RULES_SCHEMA = obj({
  moments: {
    type: 'array',
    items: obj({
      marker: { type: 'string', enum: ['villain_threat', 'child_terrified'] },
      cue_start: { type: 'integer' },
      cue_end: { type: 'integer' },
      confidence: { type: 'number' },
      who: { type: 'string' },
      text: { type: 'string' },
      played_for_laughs: { type: 'boolean' },
      note: { type: 'string' },
    }),
  },
});

function rulesPrompt(title, year, cues) {
  return `You are building part of an evaluation answer key for a parents' scene guide to the film "${title}" (${year}), working ONLY from its subtitle track below.
Do not run any shell commands and do not open any files: everything you need is in this prompt.

List EVERY moment in the subtitles that meets either of these two rules:
- villain_threat: a villain or antagonist (a person, creature or animal acting as an antagonist) explicitly threatens to kill or hurt someone, or orders someone to be killed, hurt or attacked. The threat must be in the cues (spoken, or a caption that plainly shows it). Warnings from friends, idle boasts with no target, and protagonists' threats against a villain do not count.
- child_terrified: a child character (a child, a cub, a young animal, a toddler) is terrified, screaming in fear, or crying. The cues must show it (screams, sobs, crying captions, panicked lines from the child, or others reacting to the child's fear or tears). A child who is merely startled for a second, or laughing, does not count.

For each moment return:
- marker: villain_threat or child_terrified. A moment that meets both rules is returned twice, once per marker.
- cue_start, cue_end: the cue numbers (the first number on each subtitle line) of the first and last cue of the moment itself. Keep it tight: the threat or the fear/crying, not the whole sequence. One item per distinct moment; consecutive cues of the same moment form one item.
- confidence: 0 to 1 that the rule truly applies here. 0.9 or more when the cues state it plainly; 0.6 to 0.9 when the cues strongly imply it. Do not return moments below 0.5.
- who: who threatens whom, or which child, in at most 8 words.
- text: YOUR OWN description of the moment, at most 25 words, present tense. Do not quote the subtitles.
- played_for_laughs: true when the threat or the fear is played as comedy.
- note: at most 20 words in your own words on what in the cues supports it. Do not quote the subtitles.

Never guess: every moment must be supported by the cue text. You may use your understanding of the story only to interpret the cues (for example, to know who the antagonist is).

SUBTITLE CUES (cue number, start time h:mm:ss, text):
${cues.map((c) => `${c.index} ${formatTime(c.startMs)} ${c.text}`).join('\n')}
`;
}

async function rulesFilm(slug) {
  const raw = JSON.parse(fs.readFileSync(path.join(here, 'raw', `${slug}.json`), 'utf8'));
  const cues = parseSrt(fs.readFileSync(path.resolve(here, '..', 'data', `${slug}.srt`), 'utf8'));
  const { answer } = await runCodex(`${slug}.rules`, rulesPrompt(raw.title, raw.year, cues), RULES_SCHEMA);
  const n = answer.moments.length;
  console.log(`${slug}: ${n} rule moments (${answer.moments.filter((m) => m.marker === 'villain_threat').length} villain_threat, ${answer.moments.filter((m) => m.marker === 'child_terrified').length} child_terrified)`);
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const args = process.argv.slice(2);
  await Promise.all((args.length ? args : RULE_SLUGS).map((s) => rulesFilm(s).catch((e) => console.error(s, e.message))));
}
