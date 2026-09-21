// Workstream 3 scorer.
//
//   node score-matched.js            matched-input labelling test (runs-v3/matched-<slug>.json)
//   node score-matched.js --scenes   hard, hard-to-game facts about the three scene-finding arms
//
// The matched test scores PER UNIT. The units are fixed and identical for every model (the reference
// scenes and calm controls from gold/<slug>.json), so a plain per-unit set comparison is valid and the
// run-based false-positive counter from tune-labels.js (broken, see CODEX-REVIEW.md finding 1) is not
// used anywhere in this file.
//
// visual_only reference labels are MASKED in the "text-visible only" columns: they count as neither a
// hit, a miss, nor a false label, because a text-only model cannot be asked to find them and should not
// be punished for finding them.
import fs from 'node:fs';
import path from 'node:path';
import { ATTRIBUTES, GROUPS } from './taxonomy-v2.js';
import { here, loadFilm } from './common.js';

const SLUGS = ['lion-king', 'iron-giant', 'monsters-inc', 'frankenweenie', 'wild-robot'];
const GRID = [0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 0.95, 1.01]; // 1.01 = label switched off
const MIN_TRAIN_POSITIVES = 3;
const groupOf = Object.fromEntries(ATTRIBUTES.map((a) => [a.id, a.group]));
const ATTR_IDS = ATTRIBUTES.map((a) => a.id);
const GROUP_IDS = Object.keys(GROUPS).filter((g) => ATTRIBUTES.some((a) => a.group === g)); // 12 scorable

const pct = (x) => (x == null ? '   -' : `${(x * 100).toFixed(0)}%`.padStart(4));
const uniq = (xs) => [...new Set(xs)];

// ---------------------------------------------------------------------------------------------------
// part 1: matched-input labelling
// ---------------------------------------------------------------------------------------------------
function loadMatched(slug) {
  const run = JSON.parse(fs.readFileSync(path.join(here, 'runs-v3', `matched-${slug}.json`), 'utf8'));
  const gold = JSON.parse(fs.readFileSync(path.join(here, 'gold', `${slug}.json`), 'utf8'));
  const byId = new Map(gold.map((g) => [g.id, g]));
  const sonnetById = new Map(run.sonnet.results.map((r) => [r.unit, r]));
  const units = run.units.map((u) => {
    const g = byId.get(u.id);
    const vis = g.visual_only ?? [];
    return {
      id: u.id,
      control: u.control,
      gold: { attr: g.attributes, group: uniq(g.attributes.map((a) => groupOf[a])) },
      // text-visible subset, and the masked (unscorable) labels
      goldText: { attr: g.attributes.filter((a) => !vis.includes(a)), group: uniq(g.attributes.filter((a) => !vis.includes(a)).map((a) => groupOf[a])) },
      sonnet: sonnetById.get(u.id).attributes,
      jevContext: run.jev_context.probabilities[u.id],
      jevBare: run.jev_bare.probabilities[u.id],
    };
  });
  for (const u of units) {
    u.maskedAttr = u.gold.attr.filter((a) => !u.goldText.attr.includes(a));
    u.maskedGroup = u.gold.group.filter((g) => !u.goldText.group.includes(g));
  }
  return { slug, run, units, refs: units.filter((u) => !u.control), controls: units.filter((u) => u.control) };
}

const predOf = {
  sonnet: (u, grain) => (grain === 'attr' ? u.sonnet : uniq(u.sonnet.map((a) => groupOf[a]))),
  jev: (u, grain, probs, thr) => {
    const p = probs(u);
    const at = (id) => (typeof thr === 'number' ? thr : thr[id] ?? 1.01);
    if (grain === 'attr') return ATTR_IDS.filter((id) => p[id] >= at(id));
    return GROUP_IDS.filter((g) => Math.max(...ATTRIBUTES.filter((a) => a.group === g).map((a) => p[a.id])) >= at(g));
  },
};

const zero = (ids) => Object.fromEntries(ids.map((id) => [id, { tp: 0, fn: 0, fp: 0 }]));
const addCounts = (into, c, ids) => { for (const id of ids) for (const k of ['tp', 'fn', 'fp']) into[id][k] += c[id][k]; return into; };

// Per-unit set comparison. `textOnly` masks the reference's visual_only labels out entirely.
function countUnits(units, predict, grain, { textOnly = false } = {}) {
  const ids = grain === 'attr' ? ATTR_IDS : GROUP_IDS;
  const counts = zero(ids);
  for (const u of units) {
    const goldSet = new Set(textOnly ? u.goldText[grain] : u.gold[grain]);
    const masked = new Set(textOnly ? (grain === 'attr' ? u.maskedAttr : u.maskedGroup) : []);
    const pred = new Set(predict(u, grain));
    for (const id of ids) {
      if (masked.has(id)) continue;
      const g = goldSet.has(id);
      const p = pred.has(id);
      if (g && p) counts[id].tp++;
      else if (g) counts[id].fn++;
      else if (p) counts[id].fp++;
    }
  }
  return counts;
}

function micro(counts, ids) {
  const t = ids.reduce((s, id) => ({ tp: s.tp + counts[id].tp, fn: s.fn + counts[id].fn, fp: s.fp + counts[id].fp }), { tp: 0, fn: 0, fp: 0 });
  const precision = t.tp + t.fp ? t.tp / (t.tp + t.fp) : null;
  const recall = t.tp + t.fn ? t.tp / (t.tp + t.fn) : null;
  return { ...t, precision, recall, f1: precision && recall ? (2 * precision * recall) / (precision + recall) : 0 };
}
// macro over labels that have at least one reference positive in the scored set
function macro(counts, ids) {
  const scored = ids.filter((id) => counts[id].tp + counts[id].fn > 0);
  if (!scored.length) return { f1: null, n: 0 };
  const f1s = scored.map((id) => micro(counts, [id]).f1);
  return { f1: f1s.reduce((a, b) => a + b, 0) / scored.length, n: scored.length };
}

// leave-one-film-out per-label thresholds for a Jev arm
function tunedThresholds(trainFilms, probs, grain) {
  const ids = grain === 'attr' ? ATTR_IDS : GROUP_IDS;
  const refs = trainFilms.flatMap((f) => f.refs);
  const table = GRID.map((t) => countUnits(refs, (u, g) => predOf.jev(u, g, probs, t), grain));
  const globalIdx = table.map((c, i) => [micro(c, ids).f1, i]).sort((a, b) => b[0] - a[0])[0][1];
  const thr = {};
  for (const id of ids) {
    const positives = table[0][id].tp + table[0][id].fn;
    if (positives < MIN_TRAIN_POSITIVES) { thr[id] = GRID[globalIdx]; continue; }
    thr[id] = GRID[table.map((c, i) => [micro(c, [id]).f1, i]).sort((a, b) => b[0] - a[0] || b[1] - a[1])[0][1]];
  }
  return { thr, global: GRID[globalIdx] };
}

function scoreMatched() {
  const films = SLUGS.map(loadMatched);
  const probsCtx = (u) => u.jevContext;
  const probsBare = (u) => u.jevBare;

  // arms: name -> per-film predictor (held-out-safe for the tuned ones)
  const arms = {};
  arms.Sonnet = { pred: () => (u, grain) => predOf.sonnet(u, grain) };
  arms['Jev+ctx @0.5'] = { pred: () => (u, grain) => predOf.jev(u, grain, probsCtx, 0.5) };
  arms['Jev+ctx @0.7'] = { pred: () => (u, grain) => predOf.jev(u, grain, probsCtx, 0.7) };
  arms['Jev+ctx tuned'] = { tuned: probsCtx };
  arms['Jev bare @0.5'] = { pred: () => (u, grain) => predOf.jev(u, grain, probsBare, 0.5) };
  arms['Jev bare @0.7'] = { pred: () => (u, grain) => predOf.jev(u, grain, probsBare, 0.7) };
  arms['Jev bare tuned'] = { tuned: probsBare };

  const results = {}; // arm -> grain -> {overall, text} pooled counts, plus perFilm and controls
  for (const [name, arm] of Object.entries(arms)) {
    results[name] = {};
    for (const grain of ['attr', 'group']) {
      const ids = grain === 'attr' ? ATTR_IDS : GROUP_IDS;
      const pooled = zero(ids);
      const pooledText = zero(ids);
      const perFilm = {};
      let controlLabels = 0;
      let controlsWithAny = 0;
      let controlUnits = 0;
      const thrUsed = {};
      for (const held of films) {
        let predict;
        if (arm.tuned) {
          const { thr, global } = tunedThresholds(films.filter((f) => f !== held), arm.tuned, grain);
          thrUsed[held.slug] = { thr, global };
          predict = (u, g) => predOf.jev(u, g, arm.tuned, thr);
        } else predict = arm.pred();
        const c = countUnits(held.refs, predict, grain);
        const ct = countUnits(held.refs, predict, grain, { textOnly: true });
        addCounts(pooled, c, ids);
        addCounts(pooledText, ct, ids);
        perFilm[held.slug] = { overall: micro(c, ids), macro: macro(c, ids), text: micro(ct, ids) };
        for (const u of held.controls) {
          controlUnits++;
          const n = predict(u, grain).length;
          controlLabels += n;
          if (n) controlsWithAny++;
        }
      }
      results[name][grain] = { pooled, pooledText, perFilm, controlLabels, controlsWithAny, controlUnits, thrUsed, ids };
    }
  }

  // ---- print ------------------------------------------------------------------------------------------
  const nRef = films.reduce((s, f) => s + f.refs.length, 0);
  const nCtl = films.reduce((s, f) => s + f.controls.length, 0);
  const nLab = films.reduce((s, f) => s + f.refs.reduce((t, u) => t + u.gold.attr.length, 0), 0);
  const nLabText = films.reduce((s, f) => s + f.refs.reduce((t, u) => t + u.goldText.attr.length, 0), 0);
  console.log(`MATCHED-INPUT LABELLING TEST — identical units for every model`);
  console.log(`${films.length} films, ${nRef} reference units, ${nCtl} calm controls, ${nLab} reference attribute labels (${nLabText} text-visible)\n`);

  for (const grain of ['attr', 'group']) {
    const ids = grain === 'attr' ? ATTR_IDS : GROUP_IDS;
    console.log(`=== ${grain === 'attr' ? '53 ATTRIBUTES' : '12 GROUPS'} — pooled over all five films ===`);
    console.log(`${'arm'.padEnd(16)} ${'micro P'.padStart(8)} ${'micro R'.padStart(8)} ${'micro F1'.padStart(8)} ${'macro F1'.padStart(8)}   ${'text-only P/R/F1'.padStart(18)}   tp/fn/fp    false labels on ${nCtl} controls`);
    for (const name of Object.keys(arms)) {
      const r = results[name][grain];
      const m = micro(r.pooled, ids);
      const ma = macro(r.pooled, ids);
      const t = micro(r.pooledText, ids);
      console.log(`${name.padEnd(16)} ${pct(m.precision).padStart(8)} ${pct(m.recall).padStart(8)} ${pct(m.f1).padStart(8)} ${pct(ma.f1).padStart(8)}   ${`${pct(t.precision)} ${pct(t.recall)} ${pct(t.f1)}`.padStart(18)}   ${`${m.tp}/${m.fn}/${m.fp}`.padStart(12)}    ${String(r.controlLabels).padStart(4)} labels on ${r.controlsWithAny}/${r.controlUnits} controls`);
    }
    console.log('');
    console.log(`--- per film, micro F1 (${grain}) ---`);
    console.log(`${'arm'.padEnd(16)} ${SLUGS.map((s) => s.slice(0, 9).padStart(10)).join('')}`);
    for (const name of Object.keys(arms)) {
      const r = results[name][grain];
      console.log(`${name.padEnd(16)} ${SLUGS.map((s) => pct(r.perFilm[s].overall.f1).padStart(10)).join('')}`);
    }
    console.log('');
  }

  // group-by-group, for the three headline arms at the attribute grain rolled up into groups
  console.log('=== BY GROUP (12 groups, group grain, pooled, leave-one-film-out thresholds for Jev) ===');
  const headline = ['Sonnet', 'Jev+ctx tuned', 'Jev bare tuned'];
  console.log(`${'group'.padEnd(26)} ${headline.map((h) => `${h} P/R/F1`.padStart(22)).join('')}`);
  for (const g of GROUP_IDS) {
    const cells = headline.map((name) => {
      const r = micro(results[name].group.pooled, [g]);
      return `${pct(r.precision)} ${pct(r.recall)} ${pct(r.f1)} (${r.tp}/${r.fn}/${r.fp})`.padStart(22);
    });
    console.log(`${GROUPS[g].padEnd(26)} ${cells.join('')}`);
  }
  console.log('');

  // per-attribute detail for Jev with context, tuned: where it works and where it does not
  console.log('=== PER ATTRIBUTE, Jev+ctx tuned vs Sonnet (attributes with >= 3 reference examples) ===');
  console.log(`${'attribute'.padEnd(22)} ${'n'.padStart(3)}   ${'Jev+ctx P/R/F1'.padStart(20)}   ${'Sonnet P/R/F1'.padStart(20)}`);
  const rows = ATTR_IDS.map((id) => {
    const j = micro(results['Jev+ctx tuned'].attr.pooled, [id]);
    const s = micro(results.Sonnet.attr.pooled, [id]);
    return { id, n: j.tp + j.fn, j, s };
  }).filter((r) => r.n >= 3).sort((a, b) => b.j.f1 - a.j.f1);
  for (const r of rows) {
    console.log(`${r.id.padEnd(22)} ${String(r.n).padStart(3)}   ${`${pct(r.j.precision)} ${pct(r.j.recall)} ${pct(r.j.f1)}`.padStart(20)}   ${`${pct(r.s.precision)} ${pct(r.s.recall)} ${pct(r.s.f1)}`.padStart(20)}`);
  }
  const off = ATTR_IDS.filter((id) => results['Jev+ctx tuned'].attr.pooled[id].tp + results['Jev+ctx tuned'].attr.pooled[id].fn === 0);
  console.log(`\n(${off.length} of 53 attributes have no reference example anywhere in these five films and are not scorable.)`);

  const cost = films.reduce((s, f) => s + f.run.cost_usd, 0);
  console.log(`\nmatched runs cost $${cost.toFixed(3)} (sonnet $${films.reduce((s, f) => s + f.run.sonnet.cost_usd, 0).toFixed(3)}, jev $${films.reduce((s, f) => s + f.run.jev_context.cost_usd + f.run.jev_bare.cost_usd, 0).toFixed(4)})`);
}

// ---------------------------------------------------------------------------------------------------
// part 2 (--scenes): simple, hard-to-game facts about the scene-finding arms
// ---------------------------------------------------------------------------------------------------
const mergeRanges = (rs) => {
  const s = [...rs].sort((a, b) => a[0] - b[0]);
  const out = [];
  for (const r of s) {
    const last = out[out.length - 1];
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
    else out.push([...r]);
  }
  return out;
};
const totalMs = (rs) => rs.reduce((s, r) => s + (r[1] - r[0]), 0);
const overlapMs = (a, rs) => rs.reduce((s, r) => s + Math.max(0, Math.min(a[1], r[1]) - Math.max(a[0], r[0])), 0);
const intersect = (as, bs) => as.reduce((s, a) => s + overlapMs(a, bs), 0);

function scoreScenes() {
  const rows = [];
  for (const slug of SLUGS) {
    const cueById = new Map(loadFilm(slug).cues.map((c) => [c.id, c]));
    const gold = JSON.parse(fs.readFileSync(path.join(here, 'gold', `${slug}.json`), 'utf8')).map((g) => ({ ...g, startMs: cueById.get(g.start_cue).startMs, endMs: cueById.get(g.end_cue).endMs }));
    const refs = gold.filter((g) => !g.control);
    const controls = gold.filter((g) => g.control);
    const load = (file) => {
      const p = path.join(here, file);
      if (!fs.existsSync(p)) return null;
      const j = JSON.parse(fs.readFileSync(p, 'utf8'));
      return j.scenes.map((s) => [s.start_ms, s.end_ms]);
    };
    const arms = {
      'Sonnet alone r1': load(`runs-v3/sonnet-alone-${slug}.json`),
      'Sonnet alone r2': load(`runs-v3/sonnet-alone-${slug}-r2.json`),
      'Sonnet + Jev checklist': load(`runs-v3/sonnet-checklist-${slug}.json`),
      'Jev -> Sonnet per stretch': load(`scenes/${slug}.json`),
    };
    for (const [arm, ranges] of Object.entries(arms)) {
      if (!ranges) continue;
      const merged = mergeRanges(ranges);
      rows.push({
        slug, arm,
        scenes: ranges.length,
        minutes: totalMs(merged) / 60000,
        covered: refs.filter((g) => overlapMs([g.startMs, g.endMs], merged) >= 0.5 * (g.endMs - g.startMs)).length,
        refs: refs.length,
        ctlHit: controls.filter((g) => overlapMs([g.startMs, g.endMs], merged) > 5000).length,
        ctls: controls.length,
      });
    }
    const a = load(`runs-v3/sonnet-alone-${slug}.json`);
    const b = load(`runs-v3/sonnet-alone-${slug}-r2.json`);
    if (a && b) {
      const ma = mergeRanges(a);
      const mb = mergeRanges(b);
      const inter = intersect(ma, mb);
      rows.push({ slug, arm: 'IoU(alone r1, alone r2)', iou: inter / (totalMs(ma) + totalMs(mb) - inter) });
    }
  }

  console.log('SCENE-FINDING ARMS — simple facts only (a separate stream is rebuilding the full scorer)\n');
  console.log(`${'film'.padEnd(15)} ${'arm'.padEnd(26)} ${'scenes'.padStart(7)} ${'flag min'.padStart(9)} ${'ref >=50% covered'.padStart(18)} ${'controls >5s'.padStart(13)}`);
  for (const r of rows) {
    if (r.iou != null) { console.log(`${r.slug.padEnd(15)} ${r.arm.padEnd(26)} ${pct(r.iou).padStart(7)}`); continue; }
    console.log(`${r.slug.padEnd(15)} ${r.arm.padEnd(26)} ${String(r.scenes).padStart(7)} ${r.minutes.toFixed(1).padStart(9)} ${`${r.covered}/${r.refs}`.padStart(18)} ${`${r.ctlHit}/${r.ctls}`.padStart(13)}`);
  }

  console.log('\nPOOLED');
  console.log(`${'arm'.padEnd(26)} ${'scenes'.padStart(7)} ${'flag min'.padStart(9)} ${'ref >=50% covered'.padStart(18)} ${'controls >5s'.padStart(13)} ${'cost $'.padStart(8)}`);
  const armNames = ['Sonnet alone r1', 'Sonnet alone r2', 'Sonnet + Jev checklist', 'Jev -> Sonnet per stretch'];
  for (const arm of armNames) {
    const rs = rows.filter((r) => r.arm === arm);
    if (!rs.length) continue;
    const cost = SLUGS.reduce((s, slug) => {
      const file = arm === 'Sonnet alone r1' ? `runs-v3/sonnet-alone-${slug}.json` : arm === 'Sonnet alone r2' ? `runs-v3/sonnet-alone-${slug}-r2.json` : arm === 'Sonnet + Jev checklist' ? `runs-v3/sonnet-checklist-${slug}.json` : `scenes/${slug}.json`;
      const p = path.join(here, file);
      if (!fs.existsSync(p)) return s;
      const j = JSON.parse(fs.readFileSync(p, 'utf8'));
      return s + (j.cost_usd ?? ((j.analysis_run?.cost_usd?.labeller ?? 0) + (j.analysis_run?.cost_usd?.detector ?? 0)));
    }, 0);
    console.log(`${arm.padEnd(26)} ${String(rs.reduce((s, r) => s + r.scenes, 0)).padStart(7)} ${rs.reduce((s, r) => s + r.minutes, 0).toFixed(1).padStart(9)} ${`${rs.reduce((s, r) => s + r.covered, 0)}/${rs.reduce((s, r) => s + r.refs, 0)}`.padStart(18)} ${`${rs.reduce((s, r) => s + r.ctlHit, 0)}/${rs.reduce((s, r) => s + r.ctls, 0)}`.padStart(13)} ${cost.toFixed(2).padStart(8)}`);
  }
  const ious = rows.filter((r) => r.iou != null);
  console.log(`\nrun-to-run agreement of the two Sonnet-alone runs, intersection-over-union of flagged time: ${ious.map((r) => `${r.slug} ${pct(r.iou).trim()}`).join(', ')} | mean ${pct(ious.reduce((s, r) => s + r.iou, 0) / ious.length).trim()}`);
}

if (process.argv.includes('--scenes')) scoreScenes();
else scoreMatched();
