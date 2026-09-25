// Verifier helper: dump claims with their evidence text for manual audit. Output only under verify/out (git-ignored).
import fs from 'node:fs';
import path from 'node:path';
import { parseSrt } from '../../srt.js';
const V5 = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const TS = path.resolve(V5, '..');
const STOP = new Set('a an the and or of to in on at is are was were be by for with as his her their its he she they it them this that from into out up down after before while who which what when then than but not no so one two over about through him has have had there here also where both only just all own new first again back off very more most other some such can will would could should must may still even well'.split(' '));
const words = (s) => (s.toLowerCase().match(/[a-z']+/g) ?? []).map((w) => w.replace(/'s$/, '')).filter((w) => w.length > 2 && !STOP.has(w));
const stem = (w) => w.replace(/(ing|ed|es|s|ly)$/, '');
for (const slug of ['nemo', 'monsters-inc', 'lion-king']) {
  const seg = JSON.parse(fs.readFileSync(path.join(V5, 'out', `${slug}.segments.json`)));
  const claims = JSON.parse(fs.readFileSync(path.join(V5, 'out', `${slug}.claims.json`))).claims;
  const src = JSON.parse(fs.readFileSync(path.join(V5, 'sources', `${slug}.json`)));
  const cues = parseSrt(fs.readFileSync(path.join(TS, 'data', `${slug}.srt`), 'utf8'));
  const W = src.wikipedia.sentences ?? src.wikipedia.plot_sentences;
  const T = src.tmdb.cast;
  const ev = (id) => { const n = +id.slice(1); return id[0] === 'L' ? cues[n - 1].text : id[0] === 'W' ? W[n - 1].text : `TMDB ${T[n - 1].character}`; };
  const out = [];
  for (const c of claims) {
    const evText = c.evidence_ids.map((id) => `${id}: ${ev(id)}`);
    const evWords = new Set(evText.join(' ').toLowerCase().match(/[a-z']+/g)?.map((w) => stem(w.replace(/'s$/, ''))) ?? []);
    const missing = [...new Set(words(c.claim).filter((w) => !evWords.has(stem(w))))];
    out.push({ key: c.key, type: c.target.type, claim: c.claim, verdict: c.verdict, conf: c.confidence, p: c.probabilities, status: c.status, missing, evidence: evText });
  }
  fs.writeFileSync(path.join(V5, 'verify', 'out', `${slug}.audit.json`), JSON.stringify(out, null, 1));
  console.log(slug, out.length, 'claims; W', W?.length, 'T', T.length, 'cues', cues.length);
}
