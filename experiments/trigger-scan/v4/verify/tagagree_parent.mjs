// Independent recompute of tag agreement on covered baseline scenes (v3 item and 13-group level).
// Baseline mapping reimplemented from the loader's documented rules (v2 attr -> v3 event via the
// taxonomy `v2` arrays; TEMPORARY map loved_one_dies/pet_animal_dies -> dies; presence from
// sonnet-presence `present`). No compare.js code.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as T from '../../taxonomy-v3.js';

const V4 = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TS = path.resolve(V4, '..');
const J = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const TEMP = { loved_one_dies: 'dies', pet_animal_dies: 'dies' };
const v2map = new Map();
for (const it of [...T.PRESENCE, ...T.EVENTS]) for (const v of it.v2 ?? []) (v2map.get(v) ?? v2map.set(v, []).get(v)).push(it);
const grp = (id) => id === "PARENT" ? "creatures_figures" : T.BY_ID[id]?.group;

const BASE = {
  nemo: ['scenes.nemo.grounded.json', 'runs-v3/sonnet-presence-nemo.json'],
  'monsters-inc': ['runs-v3/sonnet-alone-monsters-inc.json', 'runs-v3/sonnet-presence-monsters-inc.json'],
};
const ov = (a, b, c, d) => Math.max(0, Math.min(b, d) - Math.max(a, c));
const union = (iv) => { const s = [...iv].sort((x, y) => x[0] - y[0]); const r = []; for (const [a, b] of s) if (r.length && a <= r.at(-1)[1]) r.at(-1)[1] = Math.max(r.at(-1)[1], b); else r.push([a, b]); return r; };
const inside = (a, b, u) => u.reduce((t, [x, y]) => t + ov(a, b, x, y), 0);

for (const slug of Object.keys(BASE)) {
  const bs = J(path.join(TS, BASE[slug][0])).scenes;
  const bp = J(path.join(TS, BASE[slug][1])).scenes;
  const tags = J(path.join(V4, 'out', `${slug}.tags.r1.json`)).scenes;
  const seg = J(path.join(V4, 'out', `${slug}.segments.json`)).scenes;
  const flagged = tags.filter((s) => s.flagged);
  const idx = new Map(seg.map((s, i) => [s.id, i]));
  const fUext = union(flagged.map((s) => [s.start_ms, seg[idx.get(s.id) + 1]?.start_ms ?? s.end_ms]));
  for (const withMention of [false, true]) {
    const acc = { item: { tp: 0, fp: 0, fn: 0, jac: [] }, group: { tp: 0, fp: 0, fn: 0, jac: [] } };
    let covered = 0;
    bs.forEach((b, i) => {
      if (inside(b.start_ms, b.end_ms, fUext) / (b.end_ms - b.start_ms) < 0.5) return;
      covered++;
      const base = new Set();
      for (const a of b.attributes ?? []) {
        if (TEMP[a.id]) { base.add(TEMP[a.id]); continue; }
        const ev = (v2map.get(a.id) ?? []).filter((t) => t.layer === 'event');
        for (const e of ev) base.add(e.id);
      }
      const p = bp[i];
      for (const x of p?.present ?? []) base.add(x.id);
      if (withMention) for (const x of p?.talked_about_only ?? []) base.add(x);
      const v4 = new Set();
      for (const s of flagged) {
        const need = Math.min(10000, Math.min(s.end_ms - s.start_ms, b.end_ms - b.start_ms) / 2);
        if (ov(s.start_ms, s.end_ms, b.start_ms, b.end_ms) < need) continue;
        for (const t of s.tags) if (t.level === "act") v4.add(t.v3 ?? "PARENT");
      }
      for (const [k, A, B] of [['item', v4, base], ['group', new Set([...v4].map(grp)), new Set([...base].map(grp))]]) {
        let tp = 0; for (const x of A) if (B.has(x)) tp++;
        acc[k].tp += tp; acc[k].fp += A.size - tp; acc[k].fn += B.size - tp;
        const u = new Set([...A, ...B]).size; acc[k].jac.push(u ? tp / u : 1);
      }
    });
    const f = (a) => { const P = a.tp / (a.tp + a.fp), R = a.tp / (a.tp + a.fn); return { tp: a.tp, fp: a.fp, fn: a.fn, P: +P.toFixed(3), R: +R.toFixed(3), F1: +((2 * P * R) / (P + R)).toFixed(3), meanJ: +(a.jac.reduce((x, y) => x + y, 0) / a.jac.length).toFixed(3) }; };
    console.log(slug, withMention ? 'incl. baseline mentions' : 'presence+events only', 'covered', covered, JSON.stringify({ item: f(acc.item), group: f(acc.group) }));
  }
}
