// Independent recompute of tag agreement (v4 method) + v4 known-miss mapping + a few cause counts.
import fs from 'node:fs';
import path from 'node:path';
import * as L from '../../../../scene-api/load.js';
import * as T3 from '../../taxonomy-v3.js';
const V5 = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const TS = path.resolve(V5, '..');
const rd = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const ctx = await L.openExperiment(TS);
const v2map = L.buildV2Map(ctx.taxonomy); const vocabIds = new Set(L.buildVocabulary(ctx.taxonomy).items.map((i) => i.id));
const ov = (a0, a1, b0, b1) => Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));
const union = (iv) => { const s = iv.filter(([a, b]) => b > a).sort((x, y) => x[0] - y[0]); const o = []; for (const [a, b] of s) { if (o.length && a <= o.at(-1)[1]) o.at(-1)[1] = Math.max(o.at(-1)[1], b); else o.push([a, b]); } return o; };
const inter = (u, a, b) => u.reduce((acc, [x, y]) => acc + ov(x, y, a, b), 0);
const g3 = (id) => T3.BY_ID[id]?.group ?? null;
const out = {};
for (const slug of ['nemo', 'monsters-inc', 'lion-king']) {
  const built = L.buildFilmFrom(L.readFilmInputs(slug, ctx), { srt: ctx.srt, v2map, vocabIds });
  const base = built.scenes.map((s) => { const items = new Set(built.labels.filter((l) => l.scene_id === s.id && l.asserted && l.channel !== 'mention').map((l) => l.vocabulary_id)); return { id: s.id.split(':').pop(), s: s.start_ms, e: s.end_ms, items, groups: new Set([...items].map(g3).filter(Boolean)) }; });
  const tags = rd(path.join(V5, 'out', `${slug}.tags.r1.json`));
  const sc = tags.scenes.map((s, i) => ({ ...s, ext: tags.scenes[i + 1]?.start_ms ?? s.end_ms }));
  const fl = sc.filter((s) => s.flagged);
  const ext = union(fl.map((s) => [s.start_ms, s.ext]));
  const skip = union(fl.flatMap((s) => s.skip.spans.map((x) => [x.start_ms, x.end_ms])));
  const concern = (s) => s.tags.filter((t) => t.level === 'act' && !(t.film_specific && t.type === 'presence'));
  const agg = { item: [0, 0, 0], group: [0, 0, 0], groupV3: [0, 0, 0] };
  const add = (k, b, v) => { let tp = 0; for (const x of v) if (b.has(x)) tp++; agg[k][0] += tp; agg[k][1] += v.size - tp; agg[k][2] += b.size - tp; };
  let covered = 0;
  for (const b of base) {
    const d = Math.max(1, b.e - b.s);
    if (inter(ext, b.s, b.e) / d < 0.5) continue;
    covered++;
    const mat = fl.filter((v) => { const o = ov(v.start_ms, v.ext, b.s, b.e); return o > 0 && o >= Math.min(10000, 0.5 * Math.min(v.ext - v.start_ms, b.e - b.s)); });
    const ct = mat.flatMap(concern);
    add('item', b.items, new Set(ct.map((t) => t.v3).filter(Boolean)));
    add('group', b.groups, new Set(ct.map((t) => t.group)));
    add('groupV3', b.groups, new Set(ct.map((t) => g3(t.v3)).filter(Boolean)));
  }
  const prf = ([tp, fp, fn]) => { const p = tp / (tp + fp); const r = tp / (tp + fn); return { tp, fp, fn, P: +p.toFixed(3), R: +r.toFixed(3), F1: +((2 * p * r) / (p + r)).toFixed(3) }; };
  const R = { covered, item: prf(agg.item), group_as_reported: prf(agg.group), group_via_v3_of_each_tag: prf(agg.groupV3) };
  // v4 known misses
  const v4seg = fs.existsSync(path.join(TS, 'v4', 'out', `${slug}.segments.json`)) ? rd(path.join(TS, 'v4', 'out', `${slug}.segments.json`)) : null;
  const KM = { nemo: ['S036', 'S040'], 'monsters-inc': ['S031', 'S032', 'S037', 'S043', 'S044', 'S045', 'S049'] }[slug] ?? [];
  R.v4_known = KM.map((id) => { const s = v4seg.scenes.find((x) => x.id === id); const d = s.end_ms - s.start_ms; return `${id}: flag ${(inter(ext, s.start_ms, s.end_ms) / d).toFixed(2)} skip ${(inter(skip, s.start_ms, s.end_ms) / d).toFixed(2)} -> ${sc.filter((v) => ov(v.start_ms, v.ext, s.start_ms, s.end_ms) > 0).map((v) => v.id + (v.flagged ? '*' : '')).join('+')}`; });
  // dangerous_machine tag sources + kind vetoes
  R.dangerous_machine_sources = fl.filter((s) => s.flag_reasons.some((r) => r.id === 'dangerous_machine')).map((s) => `${s.id}:${s.flag_reasons.find((r) => r.id === 'dangerous_machine').source}`);
  R.kind_vetoes = sc.reduce((a, s) => a + (s.vetoed?.length ?? 0), 0);
  R.cancelled_all_levels = sc.reduce((a, s) => a + (s.cancelled?.length ?? 0), 0);
  R.cancelled_act = sc.reduce((a, s) => a + (s.cancelled ?? []).filter((c) => c.level === 'act').length, 0);
  R.cancelled_by = sc.flatMap((s) => (s.cancelled ?? []).filter((c) => c.level === 'act').flatMap((c) => c.by)).reduce((m, k) => ({ ...m, [k]: (m[k] ?? 0) + 1 }), {});
  out[slug] = R;
}
console.log(JSON.stringify(out, null, 1));
