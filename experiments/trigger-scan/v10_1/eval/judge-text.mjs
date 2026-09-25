#!/usr/bin/env node
// v10.1 PARENT-TEXT JUDGE (evaluation only; never read by the pipeline). The same blind Codex judge and prompt as
// v10/eval/judge-descriptions.mjs (Codex CLI gpt-6-astra, high, read-only, ephemeral; ChatGPT plan, no per-token
// charge), on the 14 dev films' flagged scenes, judging in ONE blind call per film:
//   before  the parent text v10's rules built (v9 check-describe: v10/out/<slug>.why.r1.json, 13 films;
//           v10/out10/good-dinosaur.why.r1.json)
//   after   the parent text v10.1's rules built from the SAME descriptions and flags
//           (out101/dev/<slug>.why.r1.json: check-describe.js --in ... --reuse-why ...)
// Items are the title and the description of each scene; identical (scene, kind, text) items are judged once and
// the label is shared. A 'Flagged scene' placeholder title and a missing description are not judged (counted as
// 'none'). Labels: accurate / partly / wrong / generic. In-sample (the rules were designed on these films).
//   node eval/judge-text.mjs [--films a,b] [--parallel 3]   -> eval/out/judge-text.json
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSrt, formatTime } from '../../srt.js';
import { runCodex, obj } from '../codex.js';
import { transcriptGrams, enforceQuoteRule } from '../validate.js';
import { DEV_FILMS, sourcesFile } from '../env.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const V101 = path.resolve(here, '..');
const TS = path.resolve(V101, '..');
const rj = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const FILMS = opt('films', DEV_FILMS.join(',')).split(',');
const PAR = Number(opt('parallel', '3'));
const TAG = opt('tag', 'v101-text'); // Codex cache name prefix (labels/codex/<tag>-<slug>.*); a new tag = a fresh judgement
const MAX_LINES = 140;
const VERDICTS = ['accurate', 'partly', 'wrong', 'generic'];
const PLACEHOLDER = 'Flagged scene';
const hms = (ms) => formatTime(ms).slice(0, 8);
function rng(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; }; }
const seedOf = (str) => [...str].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);
const dirOf = (slug) => path.join(TS, slug === 'good-dinosaur' ? 'v10/out10' : 'v10/out');

function build(slug) {
  const before = rj(path.join(dirOf(slug), `${slug}.why.r1.json`));
  const after = rj(path.join(V101, 'out101', 'dev', `${slug}.why.r1.json`));
  const seg = rj(path.join(dirOf(slug), `${slug}.segments.json`));
  const src = rj(sourcesFile(slug));
  const cues = parseSrt(fs.readFileSync(path.join(TS, 'data', `${slug}.srt`), 'utf8'));
  const segBy = new Map(seg.scenes.map((s) => [s.id, s]));
  const uniq = new Map(); // `${scene}|${kind}|${text}` -> item
  const uses = []; // { sys, scene, kind, key|null, source }
  for (const [sys, W] of [['before', before], ['after', after]]) {
    for (const [id, s] of Object.entries(W.scenes)) {
      for (const [kind, text] of [['text', s.why.text], ['title', s.why.title]]) {
        if (!text || (kind === 'title' && text === PLACEHOLDER)) { uses.push({ sys, scene: id, kind, key: null, source: s.why.source }); continue; }
        const k = `${id}|${kind}|${text}`;
        if (!uniq.has(k)) uniq.set(k, { scene: id, kind, text });
        uses.push({ sys, scene: id, kind, key: k, source: s.why.source, title_source: s.why.title_source });
      }
    }
  }
  const r = rng(seedOf(`v101:${slug}`));
  const order = [...uniq.values()].map((it) => [r(), it]).sort((a, b) => a[0] - b[0]).map((x) => x[1]);
  order.forEach((it, k) => { it.id = `N${String(k + 1).padStart(3, '0')}`; });
  const scenes = [...new Set(order.map((it) => it.scene))].sort();
  const blocks = scenes.map((id) => {
    const sc = segBy.get(id);
    let lines = cues.slice(sc.start_cue - 1, sc.end_cue);
    if (lines.length > MAX_LINES) lines = [...lines.slice(0, MAX_LINES / 2), ...lines.slice(-MAX_LINES / 2)];
    const notes = order.filter((it) => it.scene === id).map((it) => `${it.id}: ${it.text}`);
    return [`### Scene ${id} (${hms(sc.start_ms)}-${hms(sc.end_ms)})`, 'Subtitle lines:', ...lines.map((c) => `  [${hms(c.startMs)}] ${String(c.text).replace(/\n/g, ' / ')}`), 'Notes to judge:', ...notes.map((n) => `  ${n}`)].join('\n');
  });
  // identical to v10/eval/judge-descriptions.mjs's prompt
  const prompt = `You are checking short notes written for parents in a scene guide for the children's film "${src.film.title}" (${src.film.year}). Each note belongs to one scene and should tell a parent what happens in that scene that might upset a young child. Some notes are titles, some are one or two sentences.

Judge every note ONLY against the scene's subtitle lines (dialogue and sound captions; speakers are rarely named) and the film's Wikipedia plot summary below. Do not use your own memory of the film. Label each note:
- accurate: every statement is backed by the lines or the plot, and it says what happens in this scene that a parent would want to know about;
- partly: mostly right, but one detail is unsupported or wrong, or it misses the scene's main concern while saying true things;
- wrong: it states something the lines or plot contradict, or something that does not happen in this scene;
- generic: true or not, it says nothing specific about this scene (only a category or a mood, e.g. "a character is in danger").
Give a short note (at most 20 words) on why; never copy more than 8 words in a row from the lines or the plot. Return one entry for every note id.

## Wikipedia plot summary
${src.wikipedia.sentences.map((w) => w.text).join(' ')}

## Scenes
${blocks.join('\n\n')}`;
  return { order, uses, prompt, cues };
}

const schema = obj({ notes: { type: 'array', items: obj({ id: { type: 'string' }, verdict: { type: 'string', enum: VERDICTS }, why: { type: 'string' } }) } });
const tally = (arr) => Object.fromEntries([...VERDICTS, 'none', 'missing'].map((v) => [v, arr.filter((x) => (x.verdict ?? 'missing') === v).length]));

async function judge(slug) {
  const { order, uses, prompt, cues } = build(slug);
  const res = await runCodex(`${TAG}-${slug}`, prompt, schema);
  const grams = transcriptGrams(cues.map((c) => c.text), 9);
  const by = new Map((res.answer.notes ?? []).map((n) => [n.id, n]));
  const lab = new Map(order.map((it) => { const n = by.get(it.id); return [`${it.scene}|${it.kind}|${it.text}`, { verdict: n?.verdict ?? null, why: n ? enforceQuoteRule(n.why ?? '', grams).text : null, id: it.id }]; }));
  const rows = uses.map((u) => ({ ...u, text: u.key ? u.key.split('|').slice(2).join('|') : null, verdict: u.key ? lab.get(u.key)?.verdict ?? null : 'none', why: u.key ? lab.get(u.key)?.why ?? null : null }));
  const out = { slug, cached: !!res.cached, judged_items: order.length };
  for (const sys of ['before', 'after']) for (const kind of ['text', 'title']) out[`${sys}_${kind}`] = tally(rows.filter((x) => x.sys === sys && x.kind === kind));
  out.rows = rows;
  return out;
}

const results = [];
let next = 0;
await Promise.all(Array.from({ length: Math.min(PAR, FILMS.length) }, async () => {
  while (next < FILMS.length) {
    const slug = FILMS[next++];
    try { const r = await judge(slug); results.push(r); console.log(`${slug}: before text ${JSON.stringify(r.before_text)} after text ${JSON.stringify(r.after_text)} | before title ${JSON.stringify(r.before_title)} after title ${JSON.stringify(r.after_title)}${r.cached ? ' (cached)' : ''}`); }
    catch (err) { console.error(`${slug}: ${err.message.slice(0, 300)}`); results.push({ slug, error: err.message.slice(0, 300) }); }
  }
}));
const ok = results.filter((r) => !r.error);
const pool = (k) => Object.fromEntries([...VERDICTS, 'none', 'missing'].map((v) => [v, ok.reduce((a, r) => a + r[k][v], 0)]));
const bySource = {};
for (const r of ok) for (const x of r.rows.filter((y) => y.kind === 'text')) { const k = `${x.sys}:${x.source}`; bySource[k] ??= Object.fromEntries([...VERDICTS, 'none', 'missing'].map((v) => [v, 0])); bySource[k][x.verdict ?? 'missing']++; }
const out = { generated_at: new Date().toISOString(), judge: 'codex exec gpt-6-astra high read-only ephemeral (v10_1/eval/judge-text.mjs)', label: 'in-sample: the 14 dev films; before = v10 text rules, after = v10.1 text rules, same descriptions and flags', films: ok.map((r) => r.slug), errors: results.filter((r) => r.error), pooled: { before_text: pool('before_text'), after_text: pool('after_text'), before_title: pool('before_title'), after_title: pool('after_title') }, text_by_source: bySource, per_film: results };
fs.mkdirSync(path.join(here, 'out'), { recursive: true });
fs.writeFileSync(path.join(here, 'out', `judge-text${TAG === 'v101-text' ? '' : `.${TAG}`}.json`), JSON.stringify({ tag: TAG, ...out }, null, 2));
console.log(`POOLED text  before ${JSON.stringify(out.pooled.before_text)}\n             after  ${JSON.stringify(out.pooled.after_text)}\n       title before ${JSON.stringify(out.pooled.before_title)}\n             after  ${JSON.stringify(out.pooled.after_title)}\n  by source ${JSON.stringify(bySource)}`);
