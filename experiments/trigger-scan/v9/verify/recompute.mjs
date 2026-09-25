#!/usr/bin/env node
// Verifier (round 3): recompute headline numbers from raw outputs + keys with independent code.
// Only the live-DB loader (scene-api/load.js, read-only) and ../srt.js parser are shared with the
// pipeline. No model calls. Prints a table; writes verify/out/recompute.json (numbers only).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSrt } from '../../srt.js';
import * as L from '../../../../scene-api/load.js';

const V8 = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TS = path.resolve(V8, '..');
const OUT = path.join(V8, 'out');
const rj = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const r3 = (x) => (x == null ? null : Math.round(x * 1000) / 1000);
const FILMS = ['nemo', 'monsters-inc', 'lion-king', 'frankenweenie', 'wild-robot', 'iron-giant', 'up'];

// ---- interval helpers (own) ----
function merge(sp) {
  const s = sp.filter((x) => x[1] > x[0]).map((x) => [...x]).sort((a, b) => a[0] - b[0]);
  const o = [];
  for (const x of s) { if (o.length && x[0] <= o.at(-1)[1]) o.at(-1)[1] = Math.max(o.at(-1)[1], x[1]); else o.push(x); }
  return o;
}
const len = (u) => u.reduce((a, [x, y]) => a + y - x, 0);
function overlapU(u, a, b) { let t = 0; for (const [x, y] of u) t += Math.max(0, Math.min(y, b) - Math.max(x, a)); return t; }
function interUU(u, v) { let t = 0; for (const [a, b] of v) t += overlapU(u, a, b); return t; }
const covered = (u, a, b) => (b <= a ? (u.some(([x, y]) => a >= x && a <= y) ? 1 : 0) : overlapU(u, a, b) / (b - a));

const ctx = await L.openExperiment(TS);
const v2map = L.buildV2Map(ctx.taxonomy);
const vocabIds = new Set(L.buildVocabulary(ctx.taxonomy).items.map((i) => i.id));
function liveDb(slug) {
  try { return L.buildFilmFrom(L.readFilmInputs(slug, ctx), { srt: ctx.srt, v2map, vocabIds }).scenes.map((s) => [s.start_ms, s.end_ms]); } catch (e) { return null; }
}

const mapped = (i) => i.mappable && Number.isFinite(i.start_ms) && Number.isFinite(i.end_ms);
const win = (i, w) => (w === 'gap' && Number.isFinite(i.gap_start_ms) && Number.isFinite(i.gap_end_ms) ? [Math.min(i.start_ms, i.gap_start_ms), Math.max(i.end_ms, i.gap_end_ms)] : [i.start_ms, i.end_ms]);
function score(items, skip, w) {
  const U = merge(skip);
  const flag = items.filter((i) => mapped(i) && i.should_flag === true);
  const tag = items.filter((i) => mapped(i) && i.should_flag === 'tag_only');
  const found = flag.filter((i) => covered(U, ...win(i, w)) >= 0.5);
  const refU = merge(flag.map((i) => win(i, w)));
  return { found: found.length, of: flag.length, found_ids: found.map((i) => i.id), prec: len(U) ? r3(interUU(U, refU) / len(U)) : null, tag_in: tag.filter((i) => covered(U, ...win(i, w)) >= 0.5).length, tag_of: tag.length, min: r3(len(U) / 60000) };
}
// own LCG jitter (same published algorithm: seed 12345, 300 runs, +-30 s independent start/end)
function jitter(items, A, B) {
  let x = 12345; const rnd = () => { x = (x * 1103515245 + 12345) % 2147483648; return x / 2147483648; };
  let lt = 0, gt = 0; const n = 300;
  for (let k = 0; k < n; k++) {
    const it2 = items.map((i) => { if (!mapped(i)) return i; const s = i.start_ms + (rnd() * 2 - 1) * 30000; const e = i.end_ms + (rnd() * 2 - 1) * 30000; return { ...i, start_ms: s, end_ms: Math.max(s, e) }; });
    const d = score(it2, A, 'strict').found - score(it2, B, 'strict').found;
    if (d < 0) lt++; if (d > 0) gt++;
  }
  return { a_lt_b: r3(lt / n), a_gt_b: r3(gt / n) };
}

// ---- gate helpers (own) ----
function codeCheck(scenes, N, filmEndMs, cues) {
  let cites = 0, out = 0, sent = 0;
  for (const s of scenes) for (const x of s.sentences ?? []) {
    sent++;
    const ls = (x.cites ?? []).map((c) => String(c).trim().toUpperCase()).filter((c) => /^L\d+$/.test(c)).map((c) => +c.slice(1));
    cites += ls.length; out += ls.filter((n) => n < s.start_cue || n > s.end_cue).length;
  }
  const maxCue = Math.max(...scenes.flatMap((s) => [s.start_cue, s.end_cue]));
  const valid = scenes.filter((s) => s.start_cue >= 1 && s.end_cue <= N && s.end_cue >= s.start_cue);
  const mins = valid.map((s) => (cues[s.end_cue - 1].endMs - cues[s.start_cue - 1].startMs) / 60000);
  return { model_scenes: scenes.length, valid_scenes: valid.length, cites, cited_outside: out, cited_outside_share: r3(out / cites), overshoot: Math.max(0, maxCue - N), max_valid_scene_min: r3(Math.max(...mins)), scenes_per_10_valid: r3(valid.length / (filmEndMs / 60000) * 10), sentences: sent };
}
function aucOf(bs, ps) { let s = 0; for (const b of bs) for (const p of ps) s += b > p ? 1 : b === p ? 0.5 : 0; return r3(s / (bs.length * ps.length)); }

const res = {};
for (const slug of FILMS) {
  const r = { slug };
  const tags = rj(path.join(OUT, `${slug}.tags.r1.json`));
  const fl = tags.scenes.filter((s) => s.flagged);
  const skip = fl.flatMap((s) => (s.skip?.spans ?? []).map((x) => [x.start_ms, x.end_ms]));
  const flagScenes = fl.map((s) => [s.start_ms, s.end_ms]);
  r.scenes = tags.scenes.length; r.flagged = fl.length; r.skip_min = r3(len(merge(skip)) / 60000); r.flagged_scene_min = r3(len(merge(flagScenes)) / 60000);
  const t2 = path.join(OUT, `${slug}.tags.r2.json`);
  if (fs.existsSync(t2)) { const b = rj(t2).scenes; const f2 = new Set(b.filter((s) => s.flagged).map((s) => s.id)); const f1 = new Set(fl.map((s) => s.id)); r.r2_flagged = f2.size; r.flips = [...new Set([...f1, ...f2])].filter((id) => f1.has(id) !== f2.has(id)); }
  const db = liveDb(slug);
  r.live_min = db ? r3(len(merge(db)) / 60000) : null;
  r.skip_vs_live_pct = db ? r3((r.skip_min / r.live_min - 1) * 100) : null;
  const key = rj(path.join(TS, 'refs', `${slug}.key.json`));
  const human = key.items.filter((i) => i.human_written !== false && i.source !== 'codex-rules');
  const hcopy = path.join(OUT, 'eval', 'refs-human', `${slug}.key.json`);
  if (fs.existsSync(hcopy)) { const hc = rj(hcopy).items.map((i) => i.id).sort().join(','); r.refs_human_copy_matches = hc === human.map((i) => i.id).sort().join(','); }
  const vS = score(human, skip, 'strict'), vG = score(human, skip, 'gap');
  const vScn = score(human, flagScenes, 'strict');
  r.v7 = { strict: `${vS.found}/${vS.of}`, gap: `${vG.found}/${vG.of}`, conservative: Math.min(vS.found, vG.found), prec_strict: vS.prec, prec_gap: vG.prec, tag_in_skip: `${vS.tag_in}/${vS.tag_of}`, flagged_scenes_strict: `${vScn.found}/${vScn.of}` };
  if (db) {
    const dS = score(human, db, 'strict'), dG = score(human, db, 'gap');
    r.live = { strict: `${dS.found}/${dS.of}`, gap: `${dG.found}/${dG.of}`, conservative: Math.min(dS.found, dG.found), prec_strict: dS.prec, prec_gap: dG.prec, tag_in_skip: `${dS.tag_in}/${dS.tag_of}` };
    r.jitter = jitter(human, skip, db);
  }
  // gate: code metrics on the accepted raw attempt, AUC from folded per-scene verdicts
  const cues = parseSrt(fs.readFileSync(path.join(TS, 'data', `${slug}.srt`), 'utf8'));
  const raw = rj(path.join(OUT, `${slug}.segments.raw.json`));
  const rawScenes = raw.attempts ? raw.attempts.find((a) => a.accepted)?.scenes ?? raw.data?.scenes : raw.data.scenes;
  if (rawScenes) r.gate_code = codeCheck(rawScenes, cues.length, cues.at(-1).endMs, cues);
  const seg = rj(path.join(OUT, `${slug}.segments.json`));
  const bps = seg.scenes.map((s) => s.split_check?.boundary_before?.p).filter(Number.isFinite);
  const pps = seg.scenes.flatMap((s) => (s.split_check?.probes ?? []).map((p) => p.p)).filter(Number.isFinite);
  let sup = 0, asked = 0, unal = 0, sc = 0;
  for (const s of seg.scenes) { const a = s.split_check?.alignment; if (!a || !a.of) continue; sc++; sup += a.supported; asked += a.of; if (a.supported / a.of < 0.5) unal++; }
  r.gate_jev = { boundaries: bps.length, probes: pps.length, auc: bps.length && pps.length ? aucOf(bps, pps) : null, aligned_share: asked ? r3(sup / asked) : null, unaligned_lt_half: `${unal}/${sc}`, stored: seg.split_check ? { pass: seg.split_check.pass, auc: seg.split_check.jev?.metrics?.boundary_auc, aligned: seg.split_check.jev?.metrics?.aligned_share, cost: seg.split_check.jev?.run?.cost_usd, wall_ms: seg.split_check.jev?.run?.wall_ms, requests: seg.split_check.jev?.run?.requests, latency: seg.split_check.jev?.run?.latency_ms } : null };
  // spend
  const sp = path.join(OUT, `${slug}.spend.json`);
  if (fs.existsSync(sp)) r.spend = rj(sp);
  res[slug] = r;
}
fs.mkdirSync(path.join(V8, 'verify', 'out'), { recursive: true });
fs.writeFileSync(path.join(V8, 'verify', 'out', 'recompute.json'), JSON.stringify(res, null, 2));
for (const r of Object.values(res)) {
  const { spend, ...rest } = r;
  console.log(JSON.stringify(rest));
  console.log('  spend:', JSON.stringify(spend).slice(0, 600));
}
