#!/usr/bin/env node
// VERIFIER quote check (own code): longest run of consecutive transcript words repeated in any stored string, under two
// tokenisations -- A: hyphens split words (round-7 counter), B: hyphenated words kept whole (validate.js style).
// Scans out102/<fresh>.*, round8/out, labels/codex/r8-*, round8/live and verify/out. Reports paths + run lengths, never text.
import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
import { parseSrt } from '../../srt.js';
const here = path.dirname(fileURLToPath(import.meta.url)); const V = path.resolve(here, '..'); const TS = path.resolve(V, '..');
const FILMS = ['incredibles', 'big-hero-6', 'brave'];
const tokA = (s) => s.toLowerCase().replace(/<[^>]+>/g, ' ').replace(/[’‘]/g, "'").replace(/[^a-z0-9'\s]/g, ' ').replace(/'/g, '').split(/\s+/).filter(Boolean);
const tokB = (s) => s.toLowerCase().replace(/<[^>]+>/g, ' ').replace(/[’‘]/g, "'").replace(/-/g, '').replace(/[^a-z0-9'\s]/g, ' ').replace(/'/g, '').split(/\s+/).filter(Boolean);
const N = 9;
const grams = { A: {}, B: {} };
for (const s of FILMS) { const txt = parseSrt(fs.readFileSync(path.join(TS, 'data', `${s}.srt`), 'utf8')).map((c) => c.text).join(' '); for (const [k, tok] of [['A', tokA], ['B', tokB]]) { const w = tok(txt); const g = new Set(); for (let i = 0; i + N <= w.length; i++) g.add(w.slice(i, i + N).join(' ')); grams[k][s] = g; } }
const hit = (str, g, tok) => { const w = tok(str); for (let i = 0; i + N <= w.length; i++) if (g.has(w.slice(i, i + N).join(' '))) return true; return false; };
function walk(o, p, out) { if (typeof o === 'string') out.push([p, o]); else if (Array.isArray(o)) o.forEach((x, i) => walk(x, `${p}[${i}]`, out)); else if (o && typeof o === 'object') for (const [k, v] of Object.entries(o)) walk(v, `${p}.${k}`, out); return out; }
const list = (dir, pred = () => true, acc = []) => { if (!fs.existsSync(dir)) return acc; for (const x of fs.readdirSync(dir)) { const p = path.join(dir, x); if (fs.statSync(p).isDirectory()) list(p, pred, acc); else if (/\.(json|jsonl)$/.test(x) && pred(x)) acc.push(p); } return acc; };
function scan(files) {
  const r = { files: files.length, strings: 0, hitsA: [], hitsB: [] };
  for (const f of files) {
    const slug = FILMS.find((s) => path.basename(f).includes(s)); let objs = [];
    const raw = fs.readFileSync(f, 'utf8');
    try { objs = f.endsWith('.jsonl') ? raw.trim().split('\n').map((l) => JSON.parse(l)) : [JSON.parse(raw)]; } catch { continue; }
    const strs = objs.flatMap((o, i) => walk(o, `#${i}`, []));
    r.strings += strs.length;
    for (const [p, s] of strs) { for (const k of ['A', 'B']) { const gs = slug ? [grams[k][slug]] : Object.values(grams[k]); if (gs.some((g) => hit(s, g, k === 'A' ? tokA : tokB))) r[`hits${k}`].push(`${path.relative(V, f)}${p}`); } }
  }
  return r;
}
const res = {
  v102_pipeline: scan(list(path.join(V, 'out102'), (x) => FILMS.some((s) => x.startsWith(`${s}.`)))),
  round8_eval: scan([...list(path.join(V, 'round8', 'out'), (x) => x !== 'quote.json'), ...list(path.join(V, 'labels', 'codex'), (x) => x.startsWith('r8-') && x.endsWith('.answer.json'))]),
  live: scan(list(path.join(V, 'round8', 'live'))),
  verify_out: scan(list(path.join(here, 'out'), (x) => x !== 'quote.json')),
};
fs.writeFileSync(path.join(here, 'out', 'quote.json'), JSON.stringify(res, null, 2));
for (const [k, r] of Object.entries(res)) console.log(k, `files ${r.files} strings ${r.strings} hits(hyphen-split) ${r.hitsA.length} hits(hyphen-joined) ${r.hitsB.length}`, JSON.stringify(r.hitsA.slice(0, 12)));
