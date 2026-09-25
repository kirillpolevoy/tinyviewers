#!/usr/bin/env node
// VERIFIER quote check (own code, round 9). A violation = a stored string that repeats >= 9 consecutive words of the
// film's SRT (the rule allows at most 8). Two tokenisations, both applied to string AND transcript:
//   A: hyphens (and every non-alphanumeric) split words  ("well-known" = 2 words)
//   B: hyphens removed, words joined                    ("well-known" = "wellknown")
// Scans every JSON/JSONL under out103 (fresh + seen + dev), round9/out, round9/live, eval/out, and the r9/v103 Codex
// label files. Per hit it stores the file, JSON path, leaf key and run length -- never the text itself.
// Positive controls: the known v10.2 Incredibles S002 violation (hyphen case) and a planted 12-word quote.
import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
import { parseSrt } from '../../srt.js';
const here = path.dirname(fileURLToPath(import.meta.url)); const V = path.resolve(here, '..'); const TS = path.resolve(V, '..');
const films = JSON.parse(fs.readFileSync(path.join(TS, 'films.json'), 'utf8'));
const ALL = ['nemo', 'monsters-inc', 'lion-king', 'frankenweenie', 'wild-robot', 'iron-giant', 'up', 'tangled', 'coco', 'how-to-train-your-dragon', 'book-of-life', 'princess-and-the-frog', 'moana', 'good-dinosaur', 'frozen', 'zootopia', 'incredibles', 'big-hero-6', 'brave', 'kung-fu-panda', 'onward', 'croods'];
const norm = (s) => s.toLowerCase().replace(/<[^>]+>/g, ' ').replace(/\{[^}]*\}/g, ' ').replace(/[’‘`]/g, "'");
const tokA = (s) => norm(s).replace(/[^a-z0-9'\s]/g, ' ').replace(/'/g, '').split(/\s+/).filter(Boolean);
const tokB = (s) => norm(s).replace(/[-‐‑]/g, '').replace(/[^a-z0-9'\s]/g, ' ').replace(/'/g, '').split(/\s+/).filter(Boolean);
const N = 9;
const cache = {};
function gramsFor(slug) {
  if (cache[slug]) return cache[slug];
  const p = path.join(TS, films[slug]?.track ?? `data/${slug}.srt`);
  const txt = parseSrt(fs.readFileSync(p, 'utf8')).map((c) => c.text).join(' ');
  const g = {};
  for (const [k, tok] of [['A', tokA], ['B', tokB]]) { const w = tok(txt); const s = new Set(); for (let i = 0; i + N <= w.length; i++) s.add(w.slice(i, i + N).join(' ')); g[k] = s; g[`${k}w`] = w; }
  return (cache[slug] = g);
}
// longest run: extend from any 9-gram hit (upper bound by checking longer n-grams against the joined transcript)
function longest(str, g, k) {
  const w = (k === 'A' ? tokA : tokB)(str); let best = 0;
  for (let i = 0; i + N <= w.length; i++) {
    if (!g[k].has(w.slice(i, i + N).join(' '))) continue;
    const tw = ` ${g[`${k}w`].join(' ')} `; let n = N;
    while (i + n + 1 <= w.length && tw.includes(` ${w.slice(i, i + n + 1).join(' ')} `)) n++;
    best = Math.max(best, n);
  }
  return best;
}
function walk(o, p, out) { if (typeof o === 'string') out.push([p, o]); else if (Array.isArray(o)) o.forEach((x, i) => walk(x, `${p}[${i}]`, out)); else if (o && typeof o === 'object') for (const [k, v] of Object.entries(o)) walk(v, `${p}.${k}`, out); return out; }
const list = (dir, pred = () => true, acc = []) => { if (!fs.existsSync(dir)) return acc; for (const x of fs.readdirSync(dir)) { const p = path.join(dir, x); if (fs.statSync(p).isDirectory()) list(p, pred, acc); else if (/\.(json|jsonl)$/.test(x) && pred(p)) acc.push(p); } return acc; };
const slugOf = (f) => ALL.filter((s) => path.basename(f).includes(s)).sort((a, b) => b.length - a.length)[0] ?? null;
function scan(files, onlySlugged = false) {
  const r = { files: 0, strings: 0, hits: [] };
  for (const f of files) {
    const slug = slugOf(f); if (onlySlugged && !slug) continue;
    let objs = []; const raw = fs.readFileSync(f, 'utf8');
    try { objs = f.endsWith('.jsonl') ? raw.trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [JSON.parse(raw)]; } catch { continue; }
    r.files++;
    const strs = objs.flatMap((o, i) => walk(o, `#${i}`, [])).filter(([, s]) => s.split(/\s+/).length >= N);
    r.strings += strs.length;
    const slugs = slug ? [slug] : ALL;
    for (const [p, s] of strs) for (const sl of slugs) { const g = gramsFor(sl); const a = longest(s, g, 'A'), b = longest(s, g, 'B'); if (a || b) r.hits.push({ file: path.relative(V, f), path: p, leaf: p.split('.').pop().replace(/\[\d+\]/g, '[]'), film: sl, runA: a, runB: b }); }
  }
  r.by_leaf = r.hits.reduce((o, h) => ((o[h.leaf] = (o[h.leaf] ?? 0) + 1), o), {});
  return r;
}
const res = {};
// positive controls
const v102S002 = JSON.parse(fs.readFileSync(path.join(TS, 'v10_2', 'out102', 'incredibles.tags.r1.json'), 'utf8')).scenes.find((s) => s.id === 'S002');
const g = gramsFor('incredibles');
res.control_v102_incredibles_S002 = { runA_hyphen_split: longest(v102S002.why?.text ?? '', g, 'A'), runB_hyphen_joined: longest(v102S002.why?.text ?? '', g, 'B') };
const cues = parseSrt(fs.readFileSync(path.join(TS, 'data', 'onward.srt'), 'utf8')); const wordsOn = tokA(cues.map((c) => c.text).join(' '));
const planted = `Intro words here ${wordsOn.slice(500, 512).join(' ')} and more.`;
res.control_planted_12 = longest(planted, gramsFor('onward'), 'A');
res.v103_fresh = scan(list(path.join(V, 'out103'), (p) => ['kung-fu-panda', 'onward', 'croods'].some((s) => path.basename(p).startsWith(`${s}.`)) && !p.includes(`${path.sep}seen${path.sep}`)));
res.v103_seen_dev = scan(list(path.join(V, 'out103'), (p) => p.includes(`${path.sep}seen${path.sep}`) || p.includes(`${path.sep}dev${path.sep}`) || p.includes(`${path.sep}pipecheck${path.sep}`)));
res.round9_eval = scan(list(path.join(V, 'round9', 'out'), (p) => !p.endsWith('quote.json')));
res.round9_live = scan(list(path.join(V, 'round9', 'live')));
res.eval_out = scan(list(path.join(V, 'eval', 'out')));
fs.writeFileSync(path.join(here, 'out', 'quote.json'), JSON.stringify(res, null, 2));
for (const [k, r] of Object.entries(res)) console.log(k, r.files == null ? JSON.stringify(r) : `files ${r.files} strings>=9w ${r.strings} hits ${r.hits.length} by_leaf ${JSON.stringify(r.by_leaf)}`);
