#!/usr/bin/env node
// Dev-only: independent audit of parent check (iii) by Codex (codex.js; not Claude, not Jev), sources
// only. Per dev film, one call with three kinds of items:
//   stated     every v8 flagged scene whose WHY is a verified sentence: does the sentence say that the
//              flag reason's event happens? (yes / partly / no)
//   generated  up to 8 v8 flagged scenes whose WHY is a generated 'Heads-up' line (seeded sample): do
//              the scene's subtitle lines and the Wikipedia sentences its summary cites show that this
//              happens in the scene? (yes / partly / no / unclear)
//   unrelated  up to 5 v7 flagged scenes that showed parents only verified sentences Jev found NOT to
//              state any flag reason: does any of them say one of the reasons happens? (yes / no)
// Writes labels/why-audit${process.env.AUDIT_TAG ?? ""}.json (keys, labels, <= 15-word notes). Git-ignored.
//   node dev/audit-why.mjs [--films a,b] [--concurrency 4]
import fs from 'node:fs';
import path from 'node:path';
import { parseSrt, formatTime } from '../../srt.js';
import { V8, TS, DEV_FILMS, outDir, sourcesFile } from '../env.js';
import { runCodex, obj, LABEL_DIR } from '../codex.js';
import { parentPhrase } from '../reasons.js';

const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const FILMS = opt('films', DEV_FILMS.join(',')).split(',');
const CONC = Number(opt('concurrency', '4'));
const rj = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
function lcg(seed) { let x = seed; return () => { x = (x * 1103515245 + 12345) % 2147483648; return x / 2147483648; }; }
const pickN = (arr, n, seed) => { const r = lcg(seed); return arr.map((x) => ({ x, k: r() })).sort((a, b) => a.k - b.k).slice(0, n).map((o) => o.x); };

const INSTR = `You are auditing a parents' guide to a film. Judge ONLY from the text given with each item (subtitle lines: dialogue and sound captions in parentheses; Wikipedia plot sentences). Do NOT use your own knowledge or memory of the film. Do not run any commands or open any files. For each item return its key, a label, and a note of at most 15 words in your own words (never copy subtitle words).

Item kinds:
- STATED: a sentence and an event. Label "yes" if the sentence says the event happens (in any words), "partly" if it says something close but weaker (e.g. danger but not the attack), "no" if it does not.
- GENERATED: a warning line for a scene, plus that scene's subtitle lines and Wikipedia sentences. Label "yes" if these sources show the warned event happening in this scene, "partly" if they show something close but weaker, "no" if they show it does not happen, "unclear" if they neither show nor rule it out.
- UNRELATED: some sentences and a list of events. Label "yes" if any sentence says any listed event happens, "no" otherwise.`;
const schema = obj({ labels: { type: 'array', items: obj({ key: { type: 'string' }, label: { type: 'string', enum: ['yes', 'partly', 'no', 'unclear'] }, note: { type: 'string' } }) } });

const items = {};
function promptFor(slug) {
  const OUT = outDir();
  const tags = rj(path.join(OUT, `${slug}.tags.r1.json`));
  const seg = rj(path.join(OUT, `${slug}.segments.json`));
  const rea = rj(path.join(OUT, `${slug}.reasons.r1.json`));
  const items8 = rj(path.join(OUT, `${slug}.jev.r1.json`)).film_items ?? [];
  const before = rj(path.join(OUT, 'before', `${slug}.reasons.r1.json`));
  const tags7 = rj(path.join(V8, '..', 'v7', 'out', `${slug}.tags.r1.json`));
  const items7 = rj(path.join(V8, '..', 'v7', 'out', `${slug}.jev.r1.json`)).film_items ?? [];
  const SRC = rj(sourcesFile(slug));
  const cues = parseSrt(fs.readFileSync(path.join(TS, 'data', `${slug}.srt`), 'utf8'));
  const list = [];
  const parts = [`${INSTR}\n\nFILM: ${seg.film.title}\n`];
  for (const [id, r] of Object.entries(rea.scenes)) {
    if (r.why?.source !== 'verified_sentence') continue;
    const reason = tags.scenes.find((s) => s.id === id).flag_reasons.find((x) => x.id === r.why.states);
    const key = `${slug}:v8:${id}:stated`;
    list.push({ key, kind: 'stated' });
    parts.push(`\n--- STATED key=${key}\n  sentence: ${r.why.text}\n  event: ${parentPhrase(reason, items8)}`);
  }
  const gen = pickN(Object.entries(rea.scenes).filter(([, r]) => r.why?.source === 'generated'), 8, 99 + slug.length);
  for (const [id, r] of gen) {
    const s = seg.scenes.find((x) => x.id === id);
    const W = [...new Set(s.sentences.flatMap((x) => x.cites.filter((c) => c[0] === 'W')))].map((c) => `${c}: ${SRC.wikipedia.sentences[Number(c.slice(1)) - 1]?.text}`);
    const key = `${slug}:v8:${id}:generated`;
    list.push({ key, kind: 'generated' });
    parts.push(`\n--- GENERATED key=${key}\n  warning: ${r.why.text}\n  subtitle lines:\n${cues.slice(s.start_cue - 1, s.end_cue).map((c) => `    L${c.index} [${formatTime(c.startMs).slice(0, 8)}] ${c.text.replace(/\n/g, ' / ')}`).join('\n')}\n  Wikipedia sentences: ${W.length ? `\n    ${W.join('\n    ')}` : 'none'}`);
  }
  const unrel = pickN(Object.entries(before.scenes).filter(([, r]) => r.why?.source !== 'verified_sentence' && r.sentences), 5, 7 + slug.length);
  const seg7 = rj(path.join(V8, '..', 'v7', 'out', `${slug}.segments.json`));
  for (const [id, r] of unrel) {
    const sc = seg7.scenes.find((x) => x.id === id);
    const sentences = sc.sentences.filter((x) => x.check?.status === 'verified' && !x.judgement_words?.length).map((x) => x.text);
    const reasons = tags7.scenes.find((s) => s.id === id).flag_reasons.map((x) => parentPhrase(x, items7));
    const key = `${slug}:v7:${id}:unrelated`;
    list.push({ key, kind: 'unrelated' });
    parts.push(`\n--- UNRELATED key=${key}\n  sentences:\n    ${sentences.join('\n    ')}\n  events: ${[...new Set(reasons)].join('; ')}`);
  }
  items[slug] = list;
  parts.push(`\nReturn one label for every key above (${list.length} keys).`);
  return parts.join('\n');
}

const labels = {};
const queue = [...FILMS];
await Promise.all(Array.from({ length: CONC }, async () => {
  while (queue.length) {
    const slug = queue.shift();
    const prompt = promptFor(slug);
    const { answer, cached } = await runCodex(`why${process.env.AUDIT_TAG ?? ""}-${slug}`, prompt, schema);
    const want = new Map(items[slug].map((x) => [x.key, x.kind]));
    for (const l of answer.labels) if (want.has(l.key)) labels[l.key] = { kind: want.get(l.key), label: l.label, note: l.note };
    console.log(`${slug}: ${answer.labels.filter((l) => want.has(l.key)).length}/${want.size}${cached ? ' (cached)' : ''}`);
  }
}));
const tally = {};
for (const l of Object.values(labels)) { tally[l.kind] ??= {}; tally[l.kind][l.label] = (tally[l.kind][l.label] ?? 0) + 1; }
fs.writeFileSync(path.join(LABEL_DIR, `why-audit${process.env.AUDIT_TAG ?? ''}.json`), JSON.stringify({ generated_at: new Date().toISOString(), labeller: 'codex gpt-6-astra, sources-only', tally, labels }, null, 1));
console.log(JSON.stringify(tally));
