#!/usr/bin/env node
// ROUND 9 QUOTE CHECK (v10.3, fresh films kung-fu-panda, onward, croods). Round 8's quote.mjs, with the CORRECTED
// tokenizer: v10.3 validate.js quoteRuns (hyphenated / dashed / slashed words split into their parts, and the check
// made under both the split and the joined spelling). Rule: no stored model-written string may share more than 8
// consecutive words with the film's transcript.
// Scanned: out103/<fresh slug>.* (every v10.3 pipeline output), round9/out (judge notes etc.), labels/codex/r9-*.answer.json;
// round9/live (live pipeline outputs) reported separately. Every string of >= 9 words is scanned (round 8's scope);
// strings under keys that hold subtitle text or ids (lines, evidence, cites, ...) are reported apart as 'source_keys'
// so a stored subtitle line is not mistaken for a model quote. Also reports round 8's old tokenizer (hyphenated word =
// one word) for comparison. Reports JSON paths and run lengths, never the text. No model calls.
import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
import { parseSrt } from '../../srt.js';
import { transcriptGrams, quoteRuns } from '../validate.js';
import * as OLD from '../../v10_2/validate.js';
import { FILMS } from './spend.mjs';
const here = path.dirname(fileURLToPath(import.meta.url)); const V = path.resolve(here, '..'); const TS = path.resolve(V, '..');
const SOURCE_KEYS = new Set(['lines', 'evidence', 'cites', 'title_cites', 'evidence_ids', 'id', 'key', 'state']);
const cueTexts = Object.fromEntries(FILMS.map((s) => [s, parseSrt(fs.readFileSync(path.join(TS, 'data', `${s}.srt`), 'utf8')).map((c) => c.text)]));
const grams = Object.fromEntries(FILMS.map((s) => [s, transcriptGrams(cueTexts[s], 9)]));
const oldGrams = Object.fromEntries(FILMS.map((s) => [s, OLD.transcriptGrams(cueTexts[s], 9)]));
function walk(o, p, out, src = false) {
  if (typeof o === 'string') { if (o.split(/\s+/).length >= 9) out.push([p, o, src]); }
  else if (Array.isArray(o)) o.forEach((x, i) => walk(x, `${p}[${i}]`, out, src));
  else if (o && typeof o === 'object') for (const [k, v] of Object.entries(o)) walk(v, `${p}.${k}`, out, src || SOURCE_KEYS.has(k));
  return out;
}
function scan(files) {
  const res = { files: files.length, strings: 0, model_text_hits: [], source_key_hits: [], old_rule_hits: [] };
  for (const f of files) {
    const rel = path.relative(V, f); const slug = FILMS.find((s) => path.basename(f).includes(s)) ?? null;
    let j; try { j = JSON.parse(fs.readFileSync(f, 'utf8')); } catch { continue; }
    const strs = walk(j, '', []); res.strings += strs.length;
    for (const [p, s, src] of strs) {
      const films = slug ? [slug] : FILMS;
      const runs = films.flatMap((fs_) => quoteRuns(s, grams[fs_]));
      if (runs.length) (src ? res.source_key_hits : res.model_text_hits).push({ path: `${rel}${p}`, run_words: Math.max(...runs.map((r) => r[2])) });
      if (!src && films.some((fs_) => OLD.enforceQuoteRule(s, oldGrams[fs_]).violations.length)) res.old_rule_hits.push(`${rel}${p}`);
    }
  }
  return res;
}
const list = (dir, pred = () => true, acc = []) => { if (!fs.existsSync(dir)) return acc; for (const x of fs.readdirSync(dir)) { const p = path.join(dir, x); if (fs.statSync(p).isDirectory()) { if (x !== 'logs') list(p, pred, acc); } else if (/\.json$/.test(x) && pred(x)) acc.push(p); } return acc; };
const v103 = scan([...list(path.join(V, 'out103'), (x) => FILMS.some((s) => x.startsWith(`${s}.`))).filter((f) => path.dirname(f) === path.join(V, 'out103')), ...list(path.join(here, 'out'), (x) => !/^quote/.test(x)), ...list(path.join(V, 'labels', 'codex'), (x) => x.startsWith('r9-') && x.endsWith('.answer.json'))]);
const live = scan(list(path.join(here, 'live')));
const res = { generated_at: new Date().toISOString(), rule: 'v10.3 validate.js quoteRuns: > 8 consecutive shared words, hyphens split, split + joined spellings', v103_and_eval: v103, live_pipeline_outputs: live };
fs.writeFileSync(path.join(here, 'out', 'quote.json'), JSON.stringify(res, null, 2));
const brief = (r) => ({ files: r.files, strings: r.strings, model_text_hits: r.model_text_hits.length, source_key_hits: r.source_key_hits.length, old_rule_hits: r.old_rule_hits.length, sample: r.model_text_hits.slice(0, 30) });
console.log(JSON.stringify({ v103_and_eval: brief(v103), live: brief(live) }, null, 1));
