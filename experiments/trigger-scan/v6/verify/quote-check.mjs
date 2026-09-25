// longest run of consecutive transcript words in stored model text (segments + moments + claims), per film
import fs from 'node:fs';
const films = ['nemo','monsters-inc','lion-king','frankenweenie','wild-robot'];
const norm = (s) => s.toLowerCase().replace(/<[^>]+>/g,' ').replace(/[^a-z0-9' ]+/g,' ').split(/\s+/).filter(Boolean);
function strings(o, out=[]) { if (typeof o==='string') out.push(o); else if (Array.isArray(o)) o.forEach(x=>strings(x,out)); else if (o && typeof o==='object') Object.values(o).forEach(x=>strings(x,out)); return out; }
for (const f of films) {
  const srt = fs.readFileSync(new URL(`../../data/${f}.srt`, import.meta.url),'utf8').replace(/\r/g,'').split(/\n\n+/).map(b=>b.split('\n').slice(2).join(' ')).join(' ');
  const W = norm(srt); const grams = new Set(); const N=9;
  for (let i=0;i+N<=W.length;i++) grams.add(W.slice(i,i+N).join(' '));
  for (const file of [`${f}.segments.raw.json`,`${f}.segments.json`,`${f}.moments.r1.json`]) {
    let o; try { o = JSON.parse(fs.readFileSync(new URL(`../out/${file}`, import.meta.url),'utf8')); } catch { continue; }
    let hits = 0; const ex = [];
    for (const s of strings(o)) { const w = norm(s); for (let i=0;i+N<=w.length;i++) if (grams.has(w.slice(i,i+N).join(' '))) { hits++; if (ex.length<2) ex.push(s.length); break; } }
    console.log(f, file, '9-gram transcript hits:', hits, ex.length ? `(string lengths ${ex.join(',')})` : '');
  }
}
