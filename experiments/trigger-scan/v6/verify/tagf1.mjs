// Tag agreement (item v3 / group) on live-DB scenes >= 50% covered by flagged v6 scenes. Read-only.
import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
const HERE = path.dirname(fileURLToPath(import.meta.url)); const V6 = path.resolve(HERE, '..'); const TS = path.resolve(V6, '..');
const L = await import(path.join(TS, '../../scene-api/load.js')); const T3 = await import(path.join(TS, 'taxonomy-v3.js'));
const ctx = await L.openExperiment(TS); const v2map = L.buildV2Map(ctx.taxonomy); const vocabIds = new Set(L.buildVocabulary(ctx.taxonomy).items.map((i) => i.id));
const g3 = (id) => T3.BY_ID[id]?.group ?? null;
const ovl = (a0, a1, b0, b1) => Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));
for (const slug of ['nemo', 'monsters-inc', 'lion-king', 'frankenweenie', 'wild-robot']) {
  const built = L.buildFilmFrom(L.readFilmInputs(slug, ctx), { srt: ctx.srt, v2map, vocabIds });
  const db = built.scenes.map((s) => { const t = built.labels.filter((l) => l.scene_id === s.id && l.asserted && l.channel !== 'mention').map((l) => l.vocabulary_id); return { s: s.start_ms, e: s.end_ms, items: new Set(t), groups: new Set(t.map(g3).filter(Boolean)) }; });
  const tags = JSON.parse(fs.readFileSync(path.join(V6, 'out', `${slug}.tags.r1.json`), 'utf8'));
  const fl = tags.scenes.filter((s) => s.flagged).map((s) => { const c = s.tags.filter((t) => t.level === 'act' && !(t.film_specific && t.type === 'presence')); return { s: s.start_ms, e: s.end_ms, items: new Set(c.map((t) => t.v3).filter(Boolean)), groups: new Set(c.map((t) => t.group)) }; });
  const agg = { item: [0, 0, 0], group: [0, 0, 0] };
  for (const b of db) {
    let cov = 0; for (const v of fl) cov += ovl(v.s, v.e, b.s, b.e); // flagged scenes don't overlap each other
    if (cov / Math.max(1, b.e - b.s) < 0.5) continue;
    const mat = fl.filter((v) => ovl(v.s, v.e, b.s, b.e) >= Math.min(10000, 0.5 * Math.min(v.e - v.s, b.e - b.s)));
    for (const k of ['item', 'group']) {
      const vs = new Set(mat.flatMap((v) => [...(k === 'item' ? v.items : v.groups)])); const bs = k === 'item' ? b.items : b.groups;
      let tp = 0; for (const x of vs) if (bs.has(x)) tp++; agg[k][0] += tp; agg[k][1] += vs.size - tp; agg[k][2] += bs.size - tp;
    }
  }
  const f1 = ([tp, fp, fn]) => (2 * tp / (2 * tp + fp + fn)).toFixed(3);
  console.log(slug, 'item F1', f1(agg.item), 'group F1', f1(agg.group));
}
