// v10.3 SEEN-FILM DATA (dev only; never read by the pipeline): v10.2's loader extended to the 19 seen films -- the
// three round-8 films (incredibles, big-hero-6, brave) as v10.2 ran them (v10_2/out102: segments, raw Jev answers,
// sonnetq, childcry, resolve, moments, describe / why; live = v10_2/round8/live). v10.2's text follows.
// v10.2 SEEN-FILM DATA (dev only; never read by the pipeline). Loads, for the 16 seen films, the STORED answers
// every system is re-selected from (no model calls):
//   13 films of rounds 1-5  v10/eval/posthoc.mjs's inputs: the phrasing tournament's measured Jev answers + v9's
//                           kept Jev answers (v10/assemble/score-lib.mjs loadData 'measured'), v9's Sonnet answers
//                           (v10/out = v9/out), v9's moment answers; v10.1's child-crying answers (v10_1/out101/dev)
//   good-dinosaur           v10.1 as run (v10_1/round7/gd-out)
//   frozen, zootopia        v10.1 as run (v10_1/out101)
// plus segments, film items, describe / why files of that run, the SRT cues, the human key (refs/) and the live
// pipeline's scene spans (v10/round6/live, v9/round5/live, v8/baseline/out, else scene-api/load.js read-only).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSrt } from '../../srt.js';
import * as L from '../../../../scene-api/load.js';
import { loadData, FILMS as FILMS13 } from '../../v10/assemble/score-lib.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
export const V103 = path.resolve(here, '..');
export const TS = path.resolve(V103, '..');
export const V102 = path.join(TS, 'v10_2');
export const OUT102 = path.join(V102, 'out102');
export const R8 = ['incredibles', 'big-hero-6', 'brave'];
export const V101 = path.join(TS, 'v10_1');
export const V10 = path.join(TS, 'v10');
export const FILMS = [...FILMS13, 'good-dinosaur', 'frozen', 'zootopia', ...R8];
export const rj = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));

/** The directory holding a film's v10.1 run files (segments, jev, sonnetq, moments, describe, why). */
export function runDir(slug) {
  if (R8.includes(slug)) return OUT102;
  if (slug === 'good-dinosaur') return path.join(V101, 'round7', 'gd-out');
  if (slug === 'frozen' || slug === 'zootopia') return path.join(V101, 'out101');
  return path.join(V10, 'out'); // = v9/out (segments, jev with film_items, sonnetq, moments, describe)
}
/** v10.1 check-describe why file of the stored run (dev films: out101/dev, re-checked on v10/out). */
export function whyFile101(slug) {
  if (FILMS13.includes(slug)) return path.join(V101, 'out101', 'dev', `${slug}.why.r1.json`);
  return path.join(runDir(slug), `${slug}.why.r1.json`);
}
export function childcryFile101(slug) {
  if (FILMS13.includes(slug)) return path.join(V101, 'out101', 'dev', `${slug}.childcry.r1.json`);
  return path.join(runDir(slug), `${slug}.childcry.r1.json`);
}

let DATA = null;
let LIVE = null;
export async function openLive() {
  if (LIVE) return LIVE;
  const ctx = await L.openExperiment(TS);
  LIVE = { ctx, v2map: L.buildV2Map(ctx.taxonomy), vocabIds: new Set(L.buildVocabulary(ctx.taxonomy).items.map((i) => i.id)) };
  return LIVE;
}
/** Live scenes { src, scenes: [{ id, start_ms, end_ms, title, description }] }. */
export async function liveFor(slug) {
  const files = [path.join(V102, 'round8', 'live', `${slug}.built.json`), path.join(V10, 'round6', 'live', `${slug}.built.json`), path.join(TS, 'v9', 'round5', 'live', `${slug}.built.json`), path.join(TS, 'v8', 'baseline', 'out', `${slug}.built.json`)];
  for (const f of files) if (fs.existsSync(f)) return { src: path.relative(TS, f), scenes: rj(f).scenes.map((s) => ({ id: s.id.split(':').pop(), start_ms: s.start_ms, end_ms: s.end_ms, title: s.title, description: s.description })) };
  const lv = await openLive();
  try {
    const b = L.buildFilmFrom(L.readFilmInputs(slug, lv.ctx), { srt: lv.ctx.srt, v2map: lv.v2map, vocabIds: lv.vocabIds });
    return { src: 'scene-api/load.js (read-only)', scenes: b.scenes.map((s) => ({ id: s.id.split(':').pop(), start_ms: s.start_ms, end_ms: s.end_ms, title: s.title, description: s.description })) };
  } catch (err) { return { src: null, error: err.message, scenes: null }; }
}

/** Everything one seen film's systems are re-selected from. */
export function loadFilm(slug) {
  const dir = runDir(slug);
  const fullKey = rj(path.join(TS, 'refs', `${slug}.key.json`));
  const key = { ...fullKey, items: fullKey.items.filter((i) => i.source !== 'codex-rules') };
  const cues = parseSrt(fs.readFileSync(path.join(TS, 'data', `${slug}.srt`), 'utf8'));
  const seg = rj(path.join(dir, `${slug}.segments.json`));
  const run = rj(path.join(dir, `${slug}.jev.r1.json`));
  const sonnet = rj(path.join(dir, `${slug}.sonnetq.r1.json`));
  const saved = rj(path.join(dir, `${slug}.moments.r1.json`));
  const childcry = rj(childcryFile101(slug));
  const items = run.film_items ?? [];
  let rows;
  if (FILMS13.includes(slug)) {
    DATA ??= loadData({ fix: 'measured' });
    const flatBy = new Map(DATA[slug].scenes.map((s) => [s.id, s]));
    const keep = (a) => ({ m: a.m, mod: a.mod, s: a.s, kind: a.kind, fpl: a.fpl, fps: a.fps });
    rows = run.scenes.map((r) => (r.answers ? { ...r, answers: { q: flatBy.get(r.id).a, ...keep(r.answers) } } : { ...r, answers: null }));
  } else rows = run.scenes;
  return { slug, dir, fullKey, key, cues, seg, run, rows, items, sonnet, saved, childcry };
}

// ---- systems and scoring ---------------------------------------------------------------------------------
import { scoreKey, sensitivity, compareSystems, union, shareInside } from '../refscore.js';
import { respanScenes } from '../moments.js';
import { bridgeSpans } from '../bridge.js';
import { WORDLESS_SHARE } from '../parent-checks.js';
export { union, shareInside };

/** v10.2 dev resolve answers (resolve.js --guard --r1 on the stored run), out102/dev/<slug>.resolve.r1.json. */
export const resolveFile = (slug) => (R8.includes(slug) ? path.join(OUT102, `${slug}.resolve.r1.json`) : path.join(OUT102, 'dev', `${slug}.resolve.r1.json`));
/** v10.3 dev mortal-danger answers (mortal.js --dev on the stored segmentation), out103/dev/<slug>.mortal.r1.json. */
export const mortalFile = (slug) => path.join(V103, 'out103', 'dev', `${slug}.mortal.r1.json`);
/** v10.2's flags and text of a seen film: out102/seen (16 films, the v10.2 text run) or out102 (round 8 as run). */
export const v102Dir = (slug) => (R8.includes(slug) ? OUT102 : path.join(OUT102, 'seen'));

/**
 * One system over one film: S = a select.js module, cfg = its policy, gate = optional offline reason filter
 * (v10.1 + the pre-registered tier-A gate). Skip spans = moments.js respanScenes over the stored moment answers
 * (a reason the stored run never asked -> the whole scene).
 */
export function runSystem(f, S, cfg, { used, gate = null, resolve = null, split = null, mortal = null, saved = null } = {}) {
  const tags = S.selectRun({ film: { slug: f.slug }, run: 'seen', film_items: f.items, scenes: f.rows }, cfg, { cues: f.cues, sonnet: f.sonnet, used, childcry: f.childcry, ...(resolve ? { resolve } : {}), ...(split ? { split } : {}), ...(mortal ? { mortal } : {}) });
  if (gate) for (const s of tags.scenes.filter((x) => x.flagged)) {
    const keep = s.flag_reasons.filter((r) => gate(r));
    s.gated_offline = s.flag_reasons.filter((r) => !gate(r)).map((r) => r.id);
    s.flag_reasons = keep; if (!keep.length) s.flagged = false;
  }
  // v10.3: `saved` = moment answers to re-span from (default: the stored run's); the span bridge when the policy has it
  const sp = respanScenes({ tags, saved: saved ?? f.saved, cues: f.cues, items: f.items, cfg });
  const flagged = tags.scenes.filter((s) => s.flagged);
  for (const s of flagged) s.skip = { method: sp[s.id]?.method, spans: sp[s.id]?.spans ?? [], ms: sp[s.id]?.skip_ms ?? 0, why: sp[s.id]?.why ?? null };
  if (cfg.spans_bridge?.enabled) {
    const br = bridgeSpans(tags.scenes, cfg.spans_bridge, f.cues);
    for (const s of flagged) s.skip = { ...s.skip, spans: br[s.id].spans, ms: br[s.id].ms, bridge: br[s.id].added };
  }
  const skip = flagged.flatMap((s) => s.skip.spans.map((x) => [x.start_ms, x.end_ms]));
  return { tags, flagged, skip };
}

const brief = (s) => ({ recall: `${s.recall_items.found}/${s.recall_items.of}`, found: s.recall_items.found, of: s.recall_items.of, precision: s.precision_proxy_ref_only, skip_minutes: s.skip_minutes, tag_only_flagged: s.tag_only.flagged, tag_only_items: s.tag_only.items });
export function sys(key, skip) {
  const S = scoreKey(key, skip); const G = scoreKey(key, skip, { window: 'gap' });
  return { conservative_recall: Math.min(S.recall_items.found, G.recall_items.found), of: S.recall_items.of, precision_strict: S.precision_proxy_ref_only, precision_gap: G.precision_proxy_ref_only, skip_minutes: S.skip_minutes, tag_only_skipped: `${S.tag_only.flagged}/${S.tag_only.items}`, strict: brief(S), gap: brief(G) };
}
export function versus(key, a, b) {
  const aS = scoreKey(key, a); const aG = scoreKey(key, a, { window: 'gap' });
  const bS = scoreKey(key, b); const bG = scoreKey(key, b, { window: 'gap' });
  const sens = sensitivity(key, a, b);
  const v = compareSystems({ aStrict: aS, aGap: aG, bStrict: bS, bGap: bG, sens });
  return { recall: v.recall, precision: v.precision, overall: v.overall, jitter: { recall_a_gt_b: sens.recall_diff_a_minus_b.share_a_gt_b, recall_a_lt_b: sens.recall_diff_a_minus_b.share_a_lt_b, precision_a_gt_b: sens.precision_diff_a_minus_b.share_a_gt_b, precision_a_lt_b: sens.precision_diff_a_minus_b.share_a_lt_b } };
}
export function rules12(fullKey, skip, slug) {
  const auditFalse = new Set((fullKey.audit ?? rj(path.join(TS, 'refs', 'audits.json'))[slug] ?? []).filter((a) => a.rule_applies === false).map((a) => a.id));
  const items = fullKey.items.filter((i) => i.source === 'codex-rules' && i.mappable && Number.isFinite(i.start_ms) && !i.played_for_laughs && !auditFalse.has(i.id));
  const U = union(skip);
  const got = (m) => items.filter((i) => i.marker === m && shareInside(i.start_ms, i.end_ms, U) >= 0.5).length;
  return { villain: [got('villain_threat'), items.filter((i) => i.marker === 'villain_threat').length], child: [got('child_terrified'), items.filter((i) => i.marker === 'child_terrified').length] };
}
export function allWordless(key, skip) {
  const U = union(skip);
  const rows = key.items.filter((i) => i.mappable && Number.isFinite(i.start_ms) && i.should_flag === true && i.wordless);
  return { n: rows.length, covered: rows.filter((i) => shareInside(i.start_ms, i.end_ms, U) >= WORDLESS_SHARE).length };
}
/** Does a flagged scene's skip hold >= 50% of a mapped should_flag human item? (round-7 who-flags hit rule) */
export function sceneHit(key, s) {
  const U = union((s.skip?.spans ?? []).map((x) => [x.start_ms, x.end_ms]));
  const inside = key.items.filter((i) => i.mappable && Number.isFinite(i.start_ms) && shareInside(i.start_ms, i.end_ms, U) >= 0.5);
  return { hit: inside.some((i) => i.should_flag === true), tag_only: inside.some((i) => i.should_flag === 'tag_only') };
}
/** Films laid end to end (film k offset by k x 1e8 ms, ids prefixed): one key and one skip list per system. */
export function pool(films, systems) {
  const items = []; const skips = Object.fromEntries(systems.map((s) => [s, []]));
  films.forEach((F, k) => {
    const off = k * 1e8; const pid = (id) => `${F.slug}:${id}`;
    items.push(...F.key.items.map((it) => { const o = { ...it, id: pid(it.id), same_moment_as: (it.same_moment_as ?? []).map(pid) }; for (const fl of ['start_ms', 'end_ms', 'gap_start_ms', 'gap_end_ms']) if (Number.isFinite(it[fl])) o[fl] = it[fl] + off; return o; }));
    for (const s of systems) skips[s].push(...(F.skip[s] ?? []).map(([a, b]) => [a + off, b + off]));
  });
  return { key: { items, film_level: [] }, skips };
}
