// Uses Jev as a cheap checker of generated scene descriptions (TypeSafe's citation-check pattern):
// does the description say anything the subtitle lines do not support? Low scores go to a human.
//   node check-descriptions.js scenes.nemo.json [more files...]
import fs from 'node:fs';
import path from 'node:path';
import { here, loadTrack, pool, postJson } from './common.js';

const { cues } = loadTrack('sdh');
const headers = { Authorization: `Bearer ${process.env.TYPESAFE_API_KEY}` };
let tokens = 0;

for (const file of process.argv.slice(2)) {
  const { scenes } = JSON.parse(fs.readFileSync(path.join(here, file), 'utf8'));
  const rows = await pool(scenes, 8, async (s) => {
    const lines = cues.filter((c) => c.startMs >= s.start_ms && c.endMs <= s.end_ms).map((c) => c.text);
    const { json } = await postJson('https://api.typesafe.ai/v1/systemone', headers, {
      model: 'jev-1.13.0',
      state: { lines, summary: `${s.title}. ${s.description}` },
      questions: {
        supported: { type: 'noul', instructions: 'Is everything that `summary` says happens consistent with `lines`?', criteria: { true: 'Every event and character in the summary fits the lines.', false: 'The summary names a character, animal, or event that the lines contradict or do not contain.' } },
        invented: { type: 'noul', instructions: 'Does `summary` name an animal or character that is never mentioned or heard in `lines`?' },
      },
    });
    tokens += json.usage.input_tokens;
    return { id: s.id, start: s.start, title: s.title, supported: json.answers.supported.noul, invented: json.answers.invented.noul };
  });
  console.log(`\n${file}: ${rows.length} descriptions, lowest "supported" first`);
  for (const r of rows.sort((a, b) => a.supported - b.supported).slice(0, 10)) console.log(`  ${r.id} ${r.start} supported ${r.supported.toFixed(2)} invented ${r.invented.toFixed(2)} | ${r.title}`);
}
console.log(`\n${tokens} input tokens, $${((tokens / 1e6) * 0.042).toFixed(4)}`);
