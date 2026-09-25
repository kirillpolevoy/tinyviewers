// Independent recompute of the v4 run report's headline numbers from the raw files in ../out.
// Does NOT import compare.js or select.js. Uses questions.js only for item metadata (ids, v3,
// group, kindGate, cancel flags) and thresholds.json for the policy numbers. Own SRT parser.
// No network. Prints numbers only (no subtitle text).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PRESENCE, EVENTS } from '../questions.js';

const V4 = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TS = path.resolve(V4, '..');
const J = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const cfg = J(path.join(V4, 'thresholds.json'));

// ---------- own SRT parser --------------------------------------------------------------------
function parse(raw) {
  const out = [];
  const re = /(\d\d):(\d\d):(\d\d)[,.](\d{3})\s*-->\s*(\d\d):(\d\d):(\d\d)[,.](\d{3})/;
  for (const blk of raw.replace(/^﻿/, '').replace(/\r\n?/g, '\n').split(/\n\s*\n/)) {
    const ls = blk.split('\n').map((s) => s.trim()).filter(Boolean);
    const i = ls.findIndex((l) => re.test(l));
    if (i < 0) continue;
    const m = ls[i].match(re);
    const text = ls.slice(i + 1).join(' ').replace(/<[^>]+>/g, '').replace(/\{\\[^}]*\}/g, '').replace(/\s+/g, ' ').trim();
    if (!text) continue;
    const ms = (h, mi, s, x) => ((+h * 60 + +mi) * 60 + +s) * 1000 + +x;
    out.push({ s: ms(m[1], m[2], m[3], m[4]), e: ms(m[5], m[6], m[7], m[8]), text });
  }
  out.sort((a, b) => a.s - b.s);
  return out; // cue n = out[n-1]
}

// ---------- interval helpers ------------------------------------------------------------------
const union = (iv) => {
  const s = iv.filter(([a, b]) => b > a).sort((x, y) => x[0] - y[0]);
  const r = [];
  for (const [a, b] of s) if (r.length && a <= r[r.length - 1][1]) r[r.length - 1][1] = Math.max(r[r.length - 1][1], b); else r.push([a, b]);
  return r;
};
const len = (u) => u.reduce((t, [a, b]) => t + b - a, 0);
const inside = (a, b, u) => u.reduce((t, [x, y]) => t + Math.max(0, Math.min(b, y) - Math.max(a, x)), 0);
const ov = (a, b, c, d) => Math.max(0, Math.min(b, d) - Math.max(a, c));

// ---------- own flag rule (reimplemented from the policy text in thresholds.json) --------------
const care = new Set(cfg.parents_care_presence);
function myFlag(ans) {
  const reasons = [];
  const modOn = (m) => (ans.mod?.[m] ?? 0) >= cfg.modifier_act;
  const kind = ans.kind;
  let parentAct = false;
  for (const it of PRESENCE) {
    const p = Math.max(ans.pl?.[it.id] ?? 0, ans.ps?.[it.id] ?? 0);
    if (p < cfg.act) continue;
    if (it.kindGate && kind) {
      const sure = kind.confidence >= cfg.kind_confidence;
      const match = it.kindGate.includes(kind.choice);
      if (sure && match) { if (care.has(it.id)) reasons.push(it.id); continue; }
      if (sure && kind.choice === 'none') continue;
      parentAct = true; continue; // mismatch or unsure -> parent tag at act, specific not at act
    }
    if (care.has(it.id)) reasons.push(it.id);
  }
  if (parentAct && care.has(cfg.parent_tag.id)) reasons.push(cfg.parent_tag.id);
  for (const it of EVENTS) {
    const p = ans.e?.[it.id];
    if (p === undefined || p < cfg.act) continue;
    if (Object.keys(it.cancel ?? {}).some((m) => it.cancel[m] && modOn(m))) continue;
    reasons.push(it.id);
  }
  return reasons;
}

// act tags + groups as I compute them (for stability)
const GROUP = Object.fromEntries([...PRESENCE, ...EVENTS].map((i) => [i.id, i.group]));
GROUP[cfg.parent_tag.id] = cfg.parent_tag.group;

// ---------- text utilities for leakage / quote checks ------------------------------------------
const words = (s) => (s.toLowerCase().match(/[a-z0-9']+/g) ?? []);
const grams = (ws, n) => { const g = new Set(); for (let i = 0; i + n <= ws.length; i++) g.add(ws.slice(i, i + n).join(' ')); return g; };
function longestSharedRun(textWs, gramSets, maxN = 20) {
  let best = 0;
  for (let n = 1; n <= maxN; n++) {
    const G = gramSets(n);
    let hit = false;
    for (let i = 0; i + n <= textWs.length; i++) if (G.has(textWs.slice(i, i + n).join(' '))) { hit = true; break; }
    if (hit) best = n; else break;
  }
  return best;
}

const BASE = {
  nemo: { scenes: path.join(TS, 'scenes.nemo.grounded.json'), presence: path.join(TS, 'runs-v3', 'sonnet-presence-nemo.json') },
  'monsters-inc': { scenes: path.join(TS, 'runs-v3', 'sonnet-alone-monsters-inc.json'), presence: path.join(TS, 'runs-v3', 'sonnet-presence-monsters-inc.json') },
};

const report = {};
let phaseJev = 0;
for (const slug of ['nemo', 'monsters-inc']) {
  const R = (report[slug] = { mismatches_internal: [] });
  const bad = (m) => R.mismatches_internal.push(m);
  const cues = parse(fs.readFileSync(path.join(TS, 'data', `${slug}.srt`), 'utf8'));
  const seg = J(path.join(V4, 'out', `${slug}.segments.json`));
  const sc = seg.scenes;
  R.srt_cues = cues.length;
  R.seg_srt_cues_field = seg.srt.cues;
  R.scenes_total = sc.length;
  R.cast = seg.cast.length;
  R.known_from_film = sc.filter((s) => s.known_from_film).length;

  // contiguity / coverage
  const gaps = [];
  if (sc[0].start_cue !== 1) gaps.push(`first starts at ${sc[0].start_cue}`);
  if (sc[sc.length - 1].end_cue !== cues.length) gaps.push(`last ends at ${sc[sc.length - 1].end_cue} of ${cues.length}`);
  for (let i = 1; i < sc.length; i++) if (sc[i].start_cue !== sc[i - 1].end_cue + 1) gaps.push(`${sc[i - 1].id}->${sc[i].id}`);
  for (const s of sc) {
    if (s.end_cue < s.start_cue) gaps.push(`${s.id} inverted`);
    if (s.start_ms !== cues[s.start_cue - 1].s || s.end_ms !== cues[s.end_cue - 1].e) gaps.push(`${s.id} ms != cue times`);
  }
  R.contiguity_problems = gaps;
  const ids = sc.map((s) => s.id);
  R.ids_sequential = ids.every((id, i) => id === `S${String(i + 1).padStart(3, '0')}`);

  // Sonnet cost from usage
  const u = seg.usage;
  const sonnetCost = (u.input_tokens * 2 + (u.cache_creation_input_tokens ?? 0) * 2.5 + (u.cache_read_input_tokens ?? 0) * 0.2 + u.output_tokens * 10) / 1e6;
  R.segment_cost_recomputed = +sonnetCost.toFixed(6);
  R.segment_cost_file = seg.cost_usd;
  R.segment_reserved = seg.reserved_usd;
  R.segment_worst_case_actual_input = +((u.input_tokens * 2 + seg.max_tokens * 10) / 1e6).toFixed(4);
  R.segment_wall_s = seg.wall_ms / 1000;

  // summaries: words, quote rule vs transcript
  const tWs = cues.flatMap((c) => words(c.text));
  const cache = {};
  const tG = (n) => (cache[n] ??= grams(tWs, n));
  const runs = sc.map((s) => ({ id: s.id, run: longestSharedRun(words(s.summary), tG), w: words(s.summary).length }));
  R.summary_max_shared_run_with_transcript = Math.max(...runs.map((r) => r.run));
  R.summaries_over_8_shared = runs.filter((r) => r.run > 8).map((r) => `${r.id}:${r.run}`);
  R.summary_max_words = Math.max(...runs.map((r) => r.w));

  // ----- Jev runs
  const jev = {}, tags = {};
  for (const run of ['r1', 'r2']) {
    const j = (jev[run] = J(path.join(V4, 'out', `${slug}.jev.${run}.json`)));
    const t = (tags[run] = J(path.join(V4, 'out', `${slug}.tags.${run}.json`)));
    const reqs = j.scenes.flatMap((s) => s.requests);
    const inTok = reqs.reduce((a, r) => a + r.input_tokens, 0);
    const outTok = reqs.reduce((a, r) => a + r.output_tokens, 0);
    const perReqCost = reqs.reduce((a, r) => a + r.cost_usd, 0);
    const cost = (inTok * 0.042) / 1e6;
    phaseJev += cost;
    R[`jev_${run}`] = {
      model: j.model, complete: j.complete, scenes: j.scenes.length, answered: j.scenes.filter((s) => s.answers).length,
      requests: reqs.length, non200: reqs.flatMap((r) => r.attempts).filter((a) => a.status !== 200).length, retries: j.retries,
      input_tokens_sum: inTok, header_input_tokens: j.usage.input_tokens, output_tokens_sum: outTok,
      cost_recomputed: +cost.toFixed(8), cost_header: j.cost_usd, cost_sum_of_requests: +perReqCost.toFixed(8), wall_s: j.wall_ms / 1000,
      max_tokens_request: Math.max(...reqs.map((r) => r.input_tokens)),
    };
    // scene ranges equal segments
    j.scenes.forEach((s, i) => {
      const g = sc[i];
      if (!g || s.id !== g.id || s.start_cue !== g.start_cue || s.end_cue !== g.end_cue || s.start_ms !== g.start_ms || s.end_ms !== g.end_ms) bad(`${run} ${s.id} range differs from segments`);
      const castNames = new Set(seg.cast.map((c) => c.name));
      for (const n of s.cast_used) if (!castNames.has(n)) bad(`${run} ${s.id} cast_used '${n}' not in segments cast`);
    });
    // my flag vs tags file
    const mine = new Map(j.scenes.map((s) => [s.id, s.answers ? myFlag(s.answers) : []]));
    const theirs = new Map(t.scenes.map((s) => [s.id, s]));
    R[`flagged_${run}_tagsfile`] = t.scenes.filter((s) => s.flagged).length;
    R[`flagged_${run}_mine`] = [...mine.values()].filter((r) => r.length).length;
    for (const [id, r] of mine) {
      const th = theirs.get(id);
      const a = [...r].sort().join(','), b = [...(th.flag_reasons ?? [])].sort().join(',');
      if (a !== b) bad(`${run} ${id} flag reasons differ: mine [${a}] vs tags [${b}]`);
    }
    R[`presence_only_flags_${run}`] = t.scenes.filter((s) => s.flagged && s.tags.filter((x) => x.level === 'act' && s.flag_reasons.includes(x.id)).every((x) => x.layer === 'presence')).length;
    // reason counts
    const rc = {};
    for (const s of t.scenes) for (const r of s.flag_reasons ?? []) rc[r] = (rc[r] ?? 0) + 1;
    R[`flag_reason_counts_${run}_top`] = Object.entries(rc).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k, v]) => `${k} ${v}`);
  }

  // ----- stability
  const f1 = new Map(tags.r1.scenes.map((s) => [s.id, s])), f2 = new Map(tags.r2.scenes.map((s) => [s.id, s]));
  const flips = [...f1.keys()].filter((id) => f1.get(id).flagged !== f2.get(id).flagged);
  const actSet = (m) => new Set([...m.values()].flatMap((s) => s.tags.filter((t) => t.level === 'act').map((t) => `${s.id}|${t.id}`)));
  const grpSet = (m) => new Set([...m.values()].flatMap((s) => s.tags.filter((t) => t.level === 'act').map((t) => `${s.id}|${t.group}`)));
  const symd = (A, B) => { let d = 0; for (const x of A) if (!B.has(x)) d++; for (const x of B) if (!A.has(x)) d++; return { d, u: new Set([...A, ...B]).size }; };
  const at = symd(actSet(f1), actSet(f2)), gr = symd(grpSet(f1), grpSet(f2));
  // flagged-scene-only variant (in case the report counted only flagged scenes)
  const actSetF = (m) => new Set([...m.values()].filter((s) => s.flagged).flatMap((s) => s.tags.filter((t) => t.level === 'act').map((t) => `${s.id}|${t.id}`)));
  const atF = symd(actSetF(f1), actSetF(f2));
  let n = 0, sum = 0, mx = 0, cross = 0;
  const j1 = new Map(jev.r1.scenes.map((s) => [s.id, s.answers])), j2 = new Map(jev.r2.scenes.map((s) => [s.id, s.answers]));
  for (const [id, a1] of j1) {
    const a2 = j2.get(id);
    for (const k of ['pl', 'ps', 'm', 'e', 'mod']) for (const q of Object.keys(a1[k] ?? {})) {
      const x = a1[k][q], y = a2[k]?.[q];
      if (typeof x !== 'number' || typeof y !== 'number') continue;
      n++; const d = Math.abs(x - y); sum += d; mx = Math.max(mx, d);
      if ((x >= 0.7) !== (y >= 0.7)) cross++;
    }
  }
  R.stability = { flag_flips: flips, act_tag_flips: at.d, act_tag_union: at.u, act_tag_flips_flagged_only: `${atF.d}/${atF.u}`, group_flips: gr.d, group_union: gr.u, noul_n: n, noul_mean: +(sum / n).toFixed(4), noul_max: +mx.toFixed(3), crossings_070: cross };

  // ----- baseline
  const bs = J(BASE[slug].scenes);
  const bp = J(BASE[slug].presence);
  const cueNum = (c) => (typeof c === 'string' ? parseInt(c.replace(/^C/, ''), 10) : c);
  const baseline = bs.scenes.map((b, i) => ({ id: b.id ?? `S${String(i + 1).padStart(2, '0')}`, title: b.title, s: b.start_ms, e: b.end_ms, sc: cueNum(b.start_cue), ec: cueNum(b.end_cue) }));
  R.baseline_scenes = baseline.length;
  R.baseline_presence_scenes = bp.scenes.length;
  R.baseline_cue_time_mismatch = baseline.filter((b) => cues[b.sc - 1]?.s !== b.s || cues[b.ec - 1]?.e !== b.e).map((b) => `${b.id} start ${b.s} vs cue ${cues[b.sc - 1]?.s}; end ${b.e} vs cue ${cues[b.ec - 1]?.e}`);
  // presence file scene ids/ranges align with scene file
  R.baseline_presence_alignment_problems = bp.scenes.filter((p, i) => p.start_ms !== baseline[i]?.s || p.end_ms !== baseline[i]?.e).map((p) => p.id);
  const bU = union(baseline.map((b) => [b.s, b.e]));
  R.flagged_minutes_baseline = +(len(bU) / 60000).toFixed(3);

  const flagged = tags.r1.scenes.filter((s) => s.flagged);
  const fU = union(flagged.map((s) => [s.start_ms, s.end_ms]));
  const sIdx = new Map(sc.map((s, i) => [s.id, i]));
  const fUext = union(flagged.map((s) => { const nx = sc[sIdx.get(s.id) + 1]; return [s.start_ms, nx ? nx.start_ms : s.end_ms]; }));
  R.scenes_flagged_v4 = flagged.length;
  R.flagged_minutes_v4 = +(len(fU) / 60000).toFixed(3);
  R.flagged_minutes_v4_extended = +(len(fUext) / 60000).toFixed(3);
  R.film_minutes_first_to_last_cue = +((cues[cues.length - 1].e - cues[0].s) / 60000).toFixed(3);
  R.film_minutes_0_to_last_cue = +(cues[cues.length - 1].e / 60000).toFixed(3);
  const cov = baseline.map((b) => ({ id: b.id, strict: inside(b.s, b.e, fU) / (b.e - b.s), ext: inside(b.s, b.e, fUext) / (b.e - b.s) }));
  R.baseline_covered_strict = cov.filter((c) => c.strict >= 0.5).length;
  R.baseline_covered_extended = cov.filter((c) => c.ext >= 0.5).length;
  R.baseline_not_covered_strict = cov.filter((c) => c.strict < 0.5).map((c) => `${c.id}(${c.strict.toFixed(2)})`);
  R.baseline_not_covered_ext = cov.filter((c) => c.ext < 0.5).map((c) => `${c.id}(${c.ext.toFixed(2)})`);
  R.v4_flags_zero_overlap = flagged.filter((s) => baseline.every((b) => ov(s.start_ms, s.end_ms, b.s, b.e) === 0)).length;
  R.v4_flags_mostly_outside = flagged.filter((s) => inside(s.start_ms, s.end_ms, bU) / (s.end_ms - s.start_ms) < 0.5).length;
  // not-flagged v4 scenes
  R.v4_not_flagged = sc.filter((s) => !tags.r1.scenes.find((t) => t.id === s.id).flagged).map((s) => s.id);

  // ----- leakage: baseline titles / descriptions vs segmentation text + reconstructed Jev state
  const bText = bs.scenes.flatMap((b) => [b.title, b.description].filter(Boolean));
  const bWs = bText.map(words);
  const bG = {}; const bGram = (n) => (bG[n] ??= new Set(bWs.flatMap((w) => [...grams(w, n)])));
  const segTexts = [...sc.flatMap((s) => [s.summary, s.setting]), ...seg.cast.flatMap((c) => [c.name, c.note])];
  // shared runs with baseline that are NOT also in the transcript (true leakage signal)
  const leakRuns = [];
  for (const s of sc) {
    const ws = words(s.summary);
    for (let n = 5; n <= ws.length; n++) {
      let any = false;
      for (let i = 0; i + n <= ws.length; i++) {
        const g = ws.slice(i, i + n).join(' ');
        if (bGram(n).has(g) && !tG(n).has(g)) { any = true; if (n === 5) leakRuns.push(`${s.id}: "${g}"`); }
      }
      if (!any) break;
    }
  }
  R.leak_5gram_summary_vs_baseline_not_in_transcript = leakRuns;
  const titlesExact = bs.scenes.map((b) => b.title.toLowerCase());
  const segBlob = segTexts.join(' \n ').toLowerCase();
  R.leak_exact_baseline_title_in_segments = titlesExact.filter((t) => segBlob.includes(t));
  // Jev raw files: do they carry any baseline title/description or baseline file names?
  for (const run of ['r1', 'r2']) {
    const blob = fs.readFileSync(path.join(V4, 'out', `${slug}.jev.${run}.json`), 'utf8').toLowerCase();
    R[`leak_in_jev_${run}`] = [...titlesExact.filter((t) => blob.includes(t)), ...['grounded', 'sonnet-alone', 'sonnet-presence', 'gold'].filter((k) => blob.includes(k))];
  }
  R.tags_r1_has_summary_field = tags.r1.scenes.some((s) => 'summary' in s);
}

// ----- disagreements file
const d = J(path.join(V4, 'review', 'disagreements.json'));
const kinds = {};
for (const it of d.items) kinds[it.kind] = (kinds[it.kind] ?? 0) + 1;
report.disagreements = { items: d.items.length, kinds, total_found: d.total_found, kept: d.kept, dropped_len: d.dropped?.length };
report.phase_jev_cost_recomputed = +phaseJev.toFixed(6);
console.log(JSON.stringify(report, null, 1));
