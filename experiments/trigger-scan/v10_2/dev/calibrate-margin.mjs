#!/usr/bin/env node
// v10.1 MARGIN CALIBRATION for parent-facing titles and sentences (no model calls). Joins every Codex-labelled
// v9 / v10 title and description on the 14 dev films (v10/out/eval/descriptions.json, v10/round5/out and
// v10/round6/out descriptions.json; blind judge, sources only) with the Jev claim-check probabilities those
// texts got in check-describe.js (v10/out/<slug>.why.r1.json, v10/out10/good-dinosaur.why.r1.json).
//   title     a shown Sonnet title (title_source sonnet_verified): its own label
//   sentence  a 'described' text that is ONE verified sentence: the text's label is the sentence's label; a
//             multi-sentence 'described' text labelled accurate: every sentence is accurate
// Then a grid of (min_supports, max_contradicts): how many labelled-WRONG texts still pass, how many
// accurate / partly ones are lost. Chosen rule: the lowest min_supports (and loosest max_contradicts) at which
// no more wrong texts pass than at any stricter setting, reported with its losses (in-sample: these labels
// were seen when the rule was chosen).
//   node dev/calibrate-margin.mjs   -> dev/out/margin.json + a table
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const TS = path.resolve(here, '..', '..');
const V10 = path.join(TS, 'v10');
const rj = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));

const sets = [
  { file: path.join(V10, 'out', 'eval', 'descriptions.json'), sys: 'v9', whyDir: path.join(V10, 'out') },
  { file: path.join(V10, 'round5', 'out', 'descriptions.json'), sys: 'v9', whyDir: path.join(V10, 'out') },
  { file: path.join(V10, 'round6', 'out', 'descriptions.json'), sys: 'v10', whyDir: path.join(V10, 'out10') },
];
const rows = [];
for (const set of sets) {
  for (const film of rj(set.file).per_film) {
    const whyF = path.join(set.whyDir, `${film.slug}.why.r1.json`);
    if (!fs.existsSync(whyF)) continue;
    const why = rj(whyF);
    for (const r of film.rows.filter((x) => x.sys === set.sys && x.verdict)) {
      const sc = why.scenes[r.scene];
      if (!sc) continue;
      if (r.kind === 'title') {
        if (sc.why.title_source !== 'sonnet_verified') continue;
        const t = sc.checked.find((c) => c.key.endsWith('title'));
        rows.push({ slug: film.slug, scene: r.scene, kind: 'title', verdict: r.verdict, p_sup: t.p_supports, p_con: t.p_contradicts, key: t.key });
      } else if (r.kind === 'text' && sc.why.source === 'described') {
        const ok = sc.checked.filter((c) => !c.key.endsWith('title') && c.final === 'verified');
        if (ok.length === 1) rows.push({ slug: film.slug, scene: r.scene, kind: 'sentence', verdict: r.verdict, p_sup: ok[0].p_supports, p_con: ok[0].p_contradicts, key: ok[0].key });
        else if (r.verdict === 'accurate') for (const c of ok) rows.push({ slug: film.slug, scene: r.scene, kind: 'sentence', verdict: 'accurate', p_sup: c.p_supports, p_con: c.p_contradicts, key: c.key, from_multi: true });
      }
    }
  }
}
const grid = [];
for (const S of [0.7, 0.75, 0.8, 0.85, 0.9, 0.95]) {
  for (const C of [0.15, 0.1, 0.05]) {
    const pass = rows.filter((r) => r.p_sup >= S && r.p_con < C);
    const tally = (arr) => ({ accurate: arr.filter((r) => r.verdict === 'accurate').length, partly: arr.filter((r) => r.verdict === 'partly').length, wrong: arr.filter((r) => r.verdict === 'wrong').length, generic: arr.filter((r) => r.verdict === 'generic').length });
    grid.push({ min_supports: S, max_contradicts: C, pass: tally(pass), titles: tally(pass.filter((r) => r.kind === 'title')), sentences: tally(pass.filter((r) => r.kind === 'sentence')) });
  }
}
const base = grid.find((g) => g.min_supports === 0.7 && g.max_contradicts === 0.15);
const wrongAll = rows.filter((r) => r.verdict === 'wrong');
fs.mkdirSync(path.join(here, 'out'), { recursive: true });
fs.writeFileSync(path.join(here, 'out', 'margin.json'), JSON.stringify({ generated_at: new Date().toISOString(), note: 'in-sample: Codex labels on the 14 dev films; p = Jev claim-check probabilities stored by check-describe.js', n: rows.length, by_kind: { titles: rows.filter((r) => r.kind === 'title').length, sentences: rows.filter((r) => r.kind === 'sentence').length }, wrong: wrongAll.map(({ slug, scene, kind, p_sup, p_con }) => ({ slug, scene, kind, p_sup, p_con })), grid, rows }, null, 2));
console.log(`labelled texts ${rows.length} (titles ${rows.filter((r) => r.kind === 'title').length}, sentences ${rows.filter((r) => r.kind === 'sentence').length}); wrong ${wrongAll.length}: ${wrongAll.map((r) => `${r.slug}/${r.scene}/${r.kind} ${r.p_sup}/${r.p_con}`).join(', ')}`);
for (const g of grid) console.log(`sup>=${g.min_supports.toFixed(2)} con<${g.max_contradicts.toFixed(2)}  pass acc ${g.pass.accurate} partly ${g.pass.partly} wrong ${g.pass.wrong} generic ${g.pass.generic}  | lost vs 0.70/0.15: acc ${base.pass.accurate - g.pass.accurate} partly ${base.pass.partly - g.pass.partly} wrong ${base.pass.wrong - g.pass.wrong}`);
