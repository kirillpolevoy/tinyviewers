#!/usr/bin/env node
// Dev-only: INDEPENDENT LABELS for calibrating the unified sentence acceptance rule (accept.js).
// A stratified, seeded sample of summary sentences from the seven dev films, by what the two Jev
// checks said (claim check verified? split check supported?), is labelled by Codex (codex.js; not
// Claude, not Jev) from the SAME sources the pipeline may use: the scene's subtitle lines, the
// Wikipedia sentences and TMDB entries the sentence cites. Labels:
//   backed    every fact is stated by, or follows directly from, those sources
//   minor     one small unbacked detail (an adjective, a feeling, a colour); the event is right
//   name_only the event, action and outcome are backed; only WHICH named character does it is not
//             stated (subtitle lines rarely name speakers) -- round-4 label pass 2, after pass 1
//             counted these as 'unbacked' (about half of pass 1's unbacked notes)
//   unbacked  what happens, to whom, or the outcome is not in the sources
//   wrong     the sources contradict it, or it describes another scene's event
// Writes labels/sentence-sample.json and labels/sentence-labels.json (key, label, a <= 15-word note;
// the note must not quote the lines). Git-ignored (labels/).
//   node dev/label-sentences.mjs [--dry] [--films a,b] [--concurrency 3]
import fs from 'node:fs';
import path from 'node:path';
import { formatTime } from '../../srt.js';
import { V8, DEV_FILMS } from '../env.js';
import { loadAcceptInputs } from './accept-inputs.mjs';
import { runCodex, obj, LABEL_DIR } from '../codex.js';

const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const FILMS = opt('films', DEV_FILMS.join(',')).split(',');
const CONC = Number(opt('concurrency', '3'));
const PER = { both: 6, split_only: 18, claim_only: 99, neither: 3 };

function lcg(seed) { let x = seed; return () => { x = (x * 1103515245 + 12345) % 2147483648; return x / 2147483648; }; }
const shuffle = (a, rnd) => { const b = [...a]; for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; } return b; };
const P = (p, k) => Number(p?.[k]) || 0;

const sample = [];
const byFilm = {};
for (const slug of FILMS) {
  const { seg, SRC, cues, alignment } = loadAcceptInputs(slug);
  const rows = [];
  for (const s of seg.scenes) {
    const al = alignment.get(s.id);
    s.sentences.forEach((x, i) => {
      const a = al[i];
      if (!a || !x.check?.probabilities) return;
      const cs = P(x.check.probabilities, 'supports'); const cc = P(x.check.probabilities, 'contradicts');
      const claimOk = cs >= 0.7 && cc < 0.15;
      const splitOk = a.p_supports >= 0.5;
      const cat = claimOk && splitOk ? 'both' : claimOk ? 'claim_only' : splitOk ? 'split_only' : 'neither';
      rows.push({ key: `${slug}:${s.id}.s${i + 1}`, slug, scene: s.id, i, text: x.text, cites: x.cites, cat, claim: { verdict: x.check.verdict, p_supports: cs, p_contradicts: cc }, split: { p_supports: a.p_supports, p_contradicts: a.p_contradicts } });
    });
  }
  const rnd = lcg(20260924 + slug.length);
  const picked = [];
  for (const cat of Object.keys(PER)) {
    let pool = rows.filter((r) => r.cat === cat);
    if (cat === 'split_only') {
      // stratify by the claim check's p(supports): < 0.3, 0.3-0.5, 0.5-0.7
      const bins = [[0, 0.3], [0.3, 0.5], [0.5, 0.7]].map(([lo, hi]) => shuffle(pool.filter((r) => r.claim.p_supports >= lo && r.claim.p_supports < hi), rnd));
      const out = []; let k = 0;
      while (out.length < PER[cat] && bins.some((b) => b.length)) { const b = bins[k++ % 3]; if (b.length) out.push(b.shift()); }
      pool = out;
    } else pool = shuffle(pool, rnd).slice(0, PER[cat]);
    picked.push(...pool);
  }
  sample.push(...picked);
  byFilm[slug] = { seg, SRC, cues, picked };
}
const counts = sample.reduce((m, r) => ({ ...m, [r.cat]: (m[r.cat] ?? 0) + 1 }), {});
console.log(`sample: ${sample.length} sentences ${JSON.stringify(counts)}`);
fs.mkdirSync(LABEL_DIR, { recursive: true });
fs.writeFileSync(path.join(LABEL_DIR, 'sentence-sample.json'), JSON.stringify({ generated_at: new Date().toISOString(), per_film: PER, counts, sample }, null, 1));
if (argv.includes('--dry')) process.exit(0);

const INSTRUCTIONS = `You are checking short scene descriptions written for a parents' guide to a film. Each description must be backed by the film's SOURCES given here and nothing else: the scene's subtitle lines (dialogue and sound captions in parentheses or brackets; the speaker is usually not named), and the Wikipedia plot sentences (W...) and TMDB cast entries (T...) the description cites.

Judge each description ONLY against the sources shown with it. Do NOT use your own knowledge or memory of the film, even if you know it well: a fact that is true in the film but not stated or directly implied by these sources counts as not backed. Do not run any commands or open any files; everything you need is below.

Labels:
- backed: every fact in the description (who is there, what happens, to whom, any detail) is stated by the sources or follows directly from them. The film's cast list below may be used to tell who a character is when the lines make it clear (for example a character is addressed by name).
- minor: the event is right, but one small detail is not in the sources (an adjective, a feeling, a colour, a size).
- name_only: what happens, to whom and the outcome are backed, and the only unbacked part is WHICH named character does or says it (the lines do not name the speaker, and nothing contradicts the name).
- unbacked: what happens, the action, or the outcome is not in the sources (beyond the speaker's name).
- wrong: the sources contradict it (a different outcome, a different action), or it describes an event that the lines show happening elsewhere / not in this scene.

For each description return its key, the label, and a note of at most 15 words saying why, in your own words. Never copy words from the subtitle lines into the note.`;

const schema = obj({ labels: { type: 'array', items: obj({ key: { type: 'string' }, label: { type: 'string', enum: ['backed', 'minor', 'name_only', 'unbacked', 'wrong'] }, note: { type: 'string' } }) } });

function promptFor(slug) {
  const { seg, SRC, cues, picked } = byFilm[slug];
  const scenes = [...new Set(picked.map((r) => r.scene))].sort();
  const castNames = SRC.tmdb.cast.map((t) => t.character).filter(Boolean).slice(0, 40).join('; ');
  const parts = [`${INSTRUCTIONS}\n\nFILM: ${seg.film.title}${seg.film.year ? ` (${seg.film.year})` : ''}\nCAST LIST (TMDB): ${castNames}\n`];
  for (const id of scenes) {
    const s = seg.scenes.find((x) => x.id === id);
    const lines = cues.slice(s.start_cue - 1, s.end_cue).map((c) => `L${c.index} [${formatTime(c.startMs).slice(0, 8)}] ${c.text.replace(/\n/g, ' / ')}`);
    parts.push(`\n=== SCENE ${id} ===\nSubtitle lines:\n${lines.join('\n')}`);
    for (const r of picked.filter((x) => x.scene === id)) {
      const W = r.cites.filter((c) => c[0] === 'W').map((c) => `${c}: ${SRC.wikipedia.sentences[Number(c.slice(1)) - 1]?.text}`);
      const T = r.cites.filter((c) => c[0] === 'T').map((c) => `${c}: character "${SRC.tmdb.cast[Number(c.slice(1)) - 1]?.character}"`);
      parts.push(`\nDESCRIPTION key=${r.key}\n  text: ${r.text}\n  cited Wikipedia: ${W.length ? `\n    ${W.join('\n    ')}` : 'none'}\n  cited TMDB: ${T.length ? T.join('; ') : 'none'}`);
    }
  }
  parts.push(`\nReturn one label for every DESCRIPTION key above (${picked.length} keys).`);
  return parts.join('\n');
}

const labels = {};
const queue = [...FILMS];
await Promise.all(Array.from({ length: CONC }, async () => {
  while (queue.length) {
    const slug = queue.shift();
    const { answer, cached } = await runCodex(`sentences2-${slug}`, promptFor(slug), schema);
    const want = new Set(byFilm[slug].picked.map((r) => r.key));
    for (const l of answer.labels) if (want.has(l.key)) labels[l.key] = { label: l.label, note: l.note };
    console.log(`${slug}: ${answer.labels.filter((l) => want.has(l.key)).length}/${want.size} labelled${cached ? ' (cached answer)' : ''}`);
  }
}));
fs.writeFileSync(path.join(LABEL_DIR, 'sentence-labels.json'), JSON.stringify({ generated_at: new Date().toISOString(), labeller: 'codex gpt-6-astra (codex.js), sources-only, label pass 2 (name_only split out)', labels }, null, 1));
console.log(`labels: ${Object.keys(labels).length}/${sample.length} -> ${path.relative(V8, path.join(LABEL_DIR, 'sentence-labels.json'))}`);
