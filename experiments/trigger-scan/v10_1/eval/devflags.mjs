#!/usr/bin/env node
// v10.1 DEV FLAG COMPARISON: v10 vs v10.1 on the 14 DEV films (IN-SAMPLE: v10's phrasings were chosen on the 13
// films of rounds 1-5 and the v10.1 fixes on all 14; not a test). Pure code over stored answers, no model calls:
//   13 films  v10/eval/posthoc.mjs's inputs: the phrasing tournament's measured Jev answers + v9's kept Jev
//             answers (v10/assemble/score-lib.mjs loadData 'measured'), v9's stored Sonnet answers, v9's stored
//             moment answers (respanned; a scene v9 never asked about gets the whole scene)
//   good-dinosaur  v10's round-6 as-run answers (v10/out10: jev.r1, sonnetq.r1, moments.r1)
//   v10.1 also reads Jev's child-crying answers (out101/dev/<slug>.childcry.r1.json, childcry.js on the same
//   Sonnet answers).
// Systems: v10 = v10/select.js + v10/policy.json; v10.1 = v10_1/select.js + v10_1/policy.json (credits,
// rule 2 crying, rule 3 comic believed_dead). Scored like v10/eval/posthoc.mjs (refscore.js, human keys in refs/,
// codex-rules items excluded from the main key; rules 1/2 on the clean codex-rules items).
//   node eval/devflags.mjs   -> eval/out/devflags.json + a table
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSrt } from '../../srt.js';
import { scoreKey, sensitivity, compareSystems, union, shareInside } from '../refscore.js';
import * as S10 from '../../v10/select.js';
import * as S101 from '../select.js';
import { respanScenes } from '../moments.js';
import { loadSplit } from '../split.js';
import { loadData, FILMS as FILMS13 } from '../../v10/assemble/score-lib.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const V101 = path.resolve(here, '..');
const TS = path.resolve(V101, '..');
const V10 = path.join(TS, 'v10');
const V9OUT = path.join(TS, 'v9', 'out');
const rj = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const r3 = (x) => (x == null || Number.isNaN(x) ? null : Math.round(x * 1000) / 1000);
const P10 = S10.loadPolicy(path.join(V10, 'policy.json'));
const P101 = S101.loadPolicy(path.join(V101, 'policy.json'));
const SPLIT = loadSplit();
const DATA = loadData({ fix: 'measured' });

const brief = (s) => ({ recall: `${s.recall_items.found}/${s.recall_items.of}`, found: s.recall_items.found, of: s.recall_items.of, precision: s.precision_proxy_ref_only, skip_minutes: s.skip_minutes });
function sys(key, skip) {
  const S = scoreKey(key, skip); const G = scoreKey(key, skip, { window: 'gap' });
  return { conservative_recall: Math.min(S.recall_items.found, G.recall_items.found), of: S.recall_items.of, precision_strict: S.precision_proxy_ref_only, precision_gap: G.precision_proxy_ref_only, skip_minutes: S.skip_minutes, strict: brief(S), gap: brief(G) };
}
function versus(key, a, b) {
  const aS = scoreKey(key, a); const aG = scoreKey(key, a, { window: 'gap' });
  const bS = scoreKey(key, b); const bG = scoreKey(key, b, { window: 'gap' });
  const sens = sensitivity(key, a, b);
  const v = compareSystems({ aStrict: aS, aGap: aG, bStrict: bS, bGap: bG, sens });
  return { recall: v.recall, precision: v.precision, overall: v.overall, jitter: { recall_a_gt_b: sens.recall_diff_a_minus_b.share_a_gt_b, recall_a_lt_b: sens.recall_diff_a_minus_b.share_a_lt_b, precision_a_gt_b: sens.precision_diff_a_minus_b.share_a_gt_b, precision_a_lt_b: sens.precision_diff_a_minus_b.share_a_lt_b } };
}
function rules12(fullKey, skip, slug) {
  const auditFalse = new Set((rj(path.join(TS, 'refs', 'audits.json'))[slug] ?? []).filter((a) => a.rule_applies === false).map((a) => a.id));
  const items = fullKey.items.filter((i) => i.source === 'codex-rules' && i.mappable && Number.isFinite(i.start_ms) && !i.played_for_laughs && !auditFalse.has(i.id));
  const U = union(skip);
  const got = (m) => items.filter((i) => i.marker === m && shareInside(i.start_ms, i.end_ms, U) >= 0.5).length;
  return { villain: [got('villain_threat'), items.filter((i) => i.marker === 'villain_threat').length], child: [got('child_terrified'), items.filter((i) => i.marker === 'child_terrified').length] };
}

function run(S, cfg, { slug, rows, items, cues, sonnet, saved, childcry }) {
  const tags = S.selectRun({ film: { slug }, run: 'devflags', film_items: items, scenes: rows }, cfg, { cues, sonnet, used: SPLIT.sonnet_used, ...(childcry ? { childcry } : {}) });
  const sp = respanScenes({ tags, saved, cues, items, cfg: P10 });
  const flagged = tags.scenes.filter((s) => s.flagged);
  const skip = flagged.flatMap((s) => (sp[s.id]?.spans ?? []).map((x) => [x.start_ms, x.end_ms]));
  return { tags, flagged, skip };
}

const FILMS = [...FILMS13, 'good-dinosaur'];
const films = []; const pool = { items: [], v10: [], v101: [] };
FILMS.forEach((slug, k) => {
  const off = k * 1e8;
  const fullKey = rj(path.join(TS, 'refs', `${slug}.key.json`));
  const key = { ...fullKey, items: fullKey.items.filter((i) => i.source !== 'codex-rules') };
  const cues = parseSrt(fs.readFileSync(path.join(TS, 'data', `${slug}.srt`), 'utf8'));
  let rows; let items; let sonnet; let saved;
  if (slug === 'good-dinosaur') {
    const run10 = rj(path.join(V10, 'out10', `${slug}.jev.r1.json`));
    rows = run10.scenes; items = run10.film_items ?? [];
    sonnet = rj(path.join(V10, 'out10', `${slug}.sonnetq.r1.json`));
    saved = rj(path.join(V10, 'out10', `${slug}.moments.r1.json`));
  } else {
    const run9 = rj(path.join(V9OUT, `${slug}.jev.r1.json`));
    items = run9.film_items ?? [];
    sonnet = rj(path.join(V9OUT, `${slug}.sonnetq.r1.json`));
    saved = rj(path.join(V9OUT, `${slug}.moments.r1.json`));
    const flatBy = new Map(DATA[slug].scenes.map((s) => [s.id, s]));
    const keep = (a) => ({ m: a.m, mod: a.mod, s: a.s, kind: a.kind, fpl: a.fpl, fps: a.fps });
    rows = run9.scenes.map((r) => (r.answers ? { ...r, answers: { q: flatBy.get(r.id).a, ...keep(r.answers) } } : { ...r, answers: null }));
  }
  const ccF = path.join(V101, 'out101', 'dev', `${slug}.childcry.r1.json`);
  const childcry = fs.existsSync(ccF) ? rj(ccF) : null;
  if (!childcry) throw new Error(`${slug}: no ${path.relative(V101, ccF)} (run childcry.js --in ...)`);
  const a = run(S10, P10, { slug, rows, items, cues, sonnet, saved });
  const b = run(S101, P101, { slug, rows, items, cues, sonnet, saved, childcry });
  const fa = new Map(a.flagged.map((s) => [s.id, s])); const fb = new Map(b.flagged.map((s) => [s.id, s]));
  const reasonsOf = (s) => s.flag_reasons.map((r) => r.id).join('+');
  const row = {
    slug, scenes: a.tags.scenes.length,
    flagged: { v10: a.flagged.length, v10_1: b.flagged.length },
    credits: b.tags.credits ? { start_cue: b.tags.credits.start_cue, end_cue: b.tags.credits.end_cue, how: b.tags.credits.how } : null,
    credits_scenes: b.tags.summary.credits_scenes,
    newly_flagged: b.flagged.filter((s) => !fa.has(s.id)).map((s) => `${s.id}:${reasonsOf(s)}`),
    no_longer_flagged: a.flagged.filter((s) => !fb.has(s.id)).map((s) => { const t = b.tags.scenes.find((x) => x.id === s.id); return `${s.id}:${reasonsOf(s)} -> ${t.credits ? 'credits' : `cancelled ${JSON.stringify(t.cancelled.map((c) => `${c.id}(${c.by})`))}`}`; }),
    reasons_changed: b.flagged.filter((s) => fa.has(s.id) && reasonsOf(s) !== reasonsOf(fa.get(s.id))).map((s) => `${s.id}: ${reasonsOf(fa.get(s.id))} -> ${reasonsOf(s)}`),
    crying_flags: b.flagged.filter((s) => s.flag_reasons.some((r) => r.id === 'crying')).map((s) => `${s.id}(${s.flag_reasons.find((r) => r.id === 'crying').child})`),
    systems: { v10: sys(key, a.skip), v10_1: sys(key, b.skip) },
    rules_1_2: { v10: rules12(fullKey, a.skip, slug), v10_1: rules12(fullKey, b.skip, slug) },
    v10_1_vs_v10: versus(key, b.skip, a.skip),
  };
  films.push(row);
  const sh = ([x, y]) => [x + off, y + off];
  const pid = (id) => `${slug}:${id}`;
  pool.items.push(...key.items.map((it) => { const o = { ...it, id: pid(it.id), same_moment_as: (it.same_moment_as ?? []).map(pid) }; for (const fl of ['start_ms', 'end_ms', 'gap_start_ms', 'gap_end_ms']) if (Number.isFinite(it[fl])) o[fl] = it[fl] + off; return o; }));
  pool.v10.push(...a.skip.map(sh)); pool.v101.push(...b.skip.map(sh));
});
const pk = { items: pool.items, film_level: [] };
const sum = (f) => films.reduce((x, r) => x + f(r), 0);
const out = {
  generated_at: new Date().toISOString(),
  label: 'DEV-ONLY, IN-SAMPLE (14 seen films): v10 vs v10.1 select on the same stored answers. Not a test.',
  pooled: { v10: sys(pk, pool.v10), v10_1: sys(pk, pool.v101), v10_1_vs_v10: versus(pk, pool.v101, pool.v10) },
  totals: {
    flagged: { v10: sum((f) => f.flagged.v10), v10_1: sum((f) => f.flagged.v10_1) },
    newly_flagged: sum((f) => f.newly_flagged.length), no_longer_flagged: sum((f) => f.no_longer_flagged.length),
    rules_1_2: Object.fromEntries(['v10', 'v10_1'].map((s) => [s, { villain: `${sum((f) => f.rules_1_2[s].villain[0])}/${sum((f) => f.rules_1_2[s].villain[1])}`, child: `${sum((f) => f.rules_1_2[s].child[0])}/${sum((f) => f.rules_1_2[s].child[1])}` }])),
  },
  per_film: films,
};
fs.mkdirSync(path.join(here, 'out'), { recursive: true });
fs.writeFileSync(path.join(here, 'out', 'devflags.json'), JSON.stringify(out, null, 2));
const p = (x) => (x == null ? '-' : x.toFixed(3));
const line = (n, s) => `${n.padEnd(6)} cons.recall ${String(s.conservative_recall).padStart(3)}/${s.of}  prec strict ${p(s.precision_strict)} gap ${p(s.precision_gap)}  skip ${s.skip_minutes.toFixed(1)} min`;
console.log(out.label);
for (const f of films) {
  console.log(`\n${f.slug}: flagged ${f.flagged.v10} -> ${f.flagged.v10_1} of ${f.scenes}; credits ${f.credits ? `L${f.credits.start_cue}-${f.credits.end_cue} scenes ${f.credits_scenes.join(',') || '-'}` : '-'}`);
  console.log(`  ${line('v10', f.systems.v10)}\n  ${line('v10.1', f.systems.v10_1)}`);
  if (f.newly_flagged.length) console.log(`  + ${f.newly_flagged.join('  ')}`);
  if (f.no_longer_flagged.length) console.log(`  - ${f.no_longer_flagged.join('  ')}`);
  if (f.reasons_changed.length) console.log(`  ~ ${f.reasons_changed.join('  ')}`);
  console.log(`  rules 1/2: v10 villain ${f.rules_1_2.v10.villain.join('/')} child ${f.rules_1_2.v10.child.join('/')} | v10.1 villain ${f.rules_1_2.v10_1.villain.join('/')} child ${f.rules_1_2.v10_1.child.join('/')}`);
}
console.log(`\nPOOLED 14 dev films\n  ${line('v10', out.pooled.v10)}\n  ${line('v10.1', out.pooled.v10_1)}`);
const v = out.pooled.v10_1_vs_v10; console.log(`  v10.1 vs v10: recall ${v.recall}, precision ${v.precision}, overall ${v.overall} ${JSON.stringify(v.jitter)}`);
console.log(`totals ${JSON.stringify(out.totals)}`);
