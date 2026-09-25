#!/usr/bin/env node
// v10.3 fix (e) RE-CHECK: the fixed 8-word quotation rule (validate.js quoteRuns: hyphenated words split, both
// spellings checked) over EVERY stored model-written string of the 19 seen films' v10.2 outputs (v10_2/out102: the
// round-8 films as run, out102/seen = the 16 films' v10.2 text run) and v10.3's outputs (out103, when present).
// Files read: <slug>.{describe,describe2,why,tags,fill,segments,claims}.*.json. Reports paths and run lengths, never
// the text. Also reports what v10.2's rule (hyphenated word = one word) found, to show the difference.
//   node eval/quote-recheck.mjs [dirs...] -> eval/out/quote-recheck.json
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSrt } from '../../srt.js';
import { transcriptGrams, quoteRuns } from '../validate.js';
import * as OLD from '../../v10_2/validate.js';
import { DEV_FILMS } from '../env.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const V = path.resolve(here, '..'); const TS = path.resolve(V, '..');
const KINDS = ['describe', 'describe2', 'describe3', 'why', 'why2', 'why3', 'whyfinal', 'tags', 'fill', 'segments', 'claims'];
const dirs = process.argv.slice(2).length ? process.argv.slice(2).map((d) => path.resolve(d)) : [path.join(TS, 'v10_2', 'out102'), path.join(TS, 'v10_2', 'out102', 'seen'), path.join(V, 'out103'), path.join(V, 'out103', 'seen'), path.join(V, 'out103', 'pipecheck')];
const grams = {}; const oldGrams = {};
const gramsFor = (slug) => {
  if (!grams[slug]) { const t = parseSrt(fs.readFileSync(path.join(TS, 'data', `${slug}.srt`), 'utf8')).map((c) => c.text); grams[slug] = transcriptGrams(t, 9); oldGrams[slug] = OLD.transcriptGrams(t, 9); }
  return grams[slug];
};
// keys whose strings are subtitle text or ids, not model-written text
const SKIP = new Set(['lines', 'evidence', 'cites', 'title_cites', 'evidence_ids', 'id', 'key', 'state']);
function walk(o, p, out) {
  if (typeof o === 'string') { if (o.split(/\s+/).length >= 9) out.push([p, o]); }
  else if (Array.isArray(o)) o.forEach((x, i) => walk(x, `${p}[${i}]`, out));
  else if (o && typeof o === 'object') for (const [k, v] of Object.entries(o)) if (!SKIP.has(k)) walk(v, `${p}.${k}`, out);
  return out;
}
const res = { generated_at: new Date().toISOString(), rule: 'validate.js v10.3 quoteRuns (> 8 shared words; hyphens split; split + joined spellings)', dirs: [], violations: [], old_rule_violations: [] };
for (const d of dirs) {
  if (!fs.existsSync(d)) continue;
  let files = 0; let strings = 0;
  for (const f of fs.readdirSync(d)) {
    const m = /^([a-z0-9-]+)\.([a-z0-9]+)\./.exec(f);
    if (!m || !DEV_FILMS.includes(m[1]) || !KINDS.includes(m[2]) || !f.endsWith('.json')) continue;
    const slug = m[1]; files++;
    const g = gramsFor(slug);
    for (const [p, s] of walk(JSON.parse(fs.readFileSync(path.join(d, f), 'utf8')), '', [])) {
      strings++;
      const runs = quoteRuns(s, g);
      if (runs.length) res.violations.push({ file: path.relative(TS, path.join(d, f)), path: p, run_words: Math.max(...runs.map((r) => r[2])) });
      if (OLD.enforceQuoteRule(s, oldGrams[slug]).violations.length) res.old_rule_violations.push({ file: path.relative(TS, path.join(d, f)), path: p });
    }
  }
  res.dirs.push({ dir: path.relative(TS, d), files, strings });
}
fs.mkdirSync(path.join(here, 'out'), { recursive: true });
fs.writeFileSync(path.join(here, 'out', 'quote-recheck.json'), JSON.stringify(res, null, 2));
console.log(JSON.stringify(res.dirs));
console.log(`violations (v10.3 rule): ${res.violations.length}; (v10.2 rule): ${res.old_rule_violations.length}`);
for (const v of res.violations) console.log(`  ${v.file}${v.path} run ${v.run_words}`);
