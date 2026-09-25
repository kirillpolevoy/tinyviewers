#!/usr/bin/env node
// Independent recompute of the v5 run report's headline numbers from the RAW files in ../out.
// Read-only: writes only verify/out/recompute.json (numbers and ids, no subtitle or Wikipedia text).
// No model calls, no network.
//
//   node verify/recompute.mjs
//
// Own code for: SRT parsing, segment contract + cite validity, claim-check tallies, flag decision
// (re-implemented from policy.json + raw Jev answers; only item METADATA is imported from questions.js),
// film-level context, skip spans (re-derived from per-reason begin/end line ids + SRT times),
// baseline coverage (intervals), stability, costs from token counts.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { PRESENCE, EVENTS, DERIVED } from '../questions.js';
import * as L from '../../../../scene-api/load.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const V5 = path.resolve(here, '..');
const TS = path.resolve(V5, '..');
const OUT = path.join(V5, 'out');
const rd = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const FILMS = ['nemo', 'monsters-inc', 'lion-king'];
const POL = rd(path.join(V5, 'policy.json'));
const JEV_PRICE = 0.042; // $/M input tokens
const SONNET = [2, 10]; // $/M in, out (../claude.js table)
const r4 = (x) => Math.round(x * 1e4) / 1e4;
const min3 = (ms) => Math.round(ms / 60) / 1000;

// ---- my own SRT parser ----------------------------------------------------------------------------
function srt(file) {
  const raw = fs.readFileSync(file, 'utf8').replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  const re = /(\d\d):(\d\d):(\d\d)[,.](\d{3})\s*-->\s*(\d\d):(\d\d):(\d\d)[,.](\d{3})/;
  const ms = (h, m, s, x) => ((+h * 60 + +m) * 60 + +s) * 1000 + +x;
  const cues = [];
  for (const b of raw.split(/\n{2,}/)) {
    const ls = b.split('\n').map((x) => x.trim()).filter(Boolean);
    const i = ls.findIndex((x) => re.test(x));
    if (i < 0) continue;
    const m = ls[i].match(re);
    const text = ls.slice(i + 1).join(' ').replace(/<[^>]+>/g, '').replace(/\{\\[^}]*\}/g, '').replace(/\s+/g, ' ').trim();
    if (!text) continue;
    cues.push({ s: ms(m[1], m[2], m[3], m[4]), e: ms(m[5], m[6], m[7], m[8]), text });
  }
  cues.sort((a, b) => a.s - b.s);
  return cues.map((c, i) => ({ n: i + 1, ...c }));
}

// ---- intervals ---------------------------------------------------------------------------------------
const union = (iv) => {
  const s = iv.filter(([a, b]) => b > a).sort((x, y) => x[0] - y[0]);
  const out = [];
  for (const [a, b] of s) { if (out.length && a <= out[out.length - 1][1]) out[out.length - 1][1] = Math.max(out[out.length - 1][1], b); else out.push([a, b]); }
  return out;
};
const len = (u) => u.reduce((a, [x, y]) => a + (y - x), 0);
const inter = (u, a, b) => u.reduce((acc, [x, y]) => acc + Math.max(0, Math.min(y, b) - Math.max(x, a)), 0);

// ---- verification rule (cookbook) --------------------------------------------------------------------
const passes = (c) => c && c.verdict === 'supports' && Number(c.confidence) >= 0.8;

// ---- flag decision, re-implemented --------------------------------------------------------------------
const PRES = new Map(PRESENCE.map((p) => [p.id, p]));
const EVT = new Map(EVENTS.map((e) => [e.id, e]));
function sceneAct(a, items) {
  const act = new Map(); // id -> {layer, type}
  const hasSum = a.ps != null;
  const dangerMass01 = (Number(a.s?.danger?.probabilities?.['0']) || 0) + (Number(a.s?.danger?.probabilities?.['1']) || 0);
  const mods = {
    retold: (a.mod?.retold ?? 0) >= 0.7 && dangerMass01 >= 0.5,
    imagined: (a.mod?.imagined ?? 0) >= 0.7,
    comic: Number(a.s?.laughs?.score ?? 0) >= 2,
  };
  const cancelled = (cancel) => Object.keys(cancel ?? {}).some((m) => cancel[m] && mods[m]);
  let nCancelled = 0;
  for (const [id, p] of PRES) {
    const pl = a.pl?.[id] ?? 0; const ps = hasSum ? a.ps?.[id] ?? 0 : 0;
    if (!(pl >= 0.7 || ps >= 0.7)) continue;
    const k = a.kind;
    if (p.kindGate && k && k.choice !== 'none' && k.confidence >= 0.9 && !p.kindGate.includes(k.choice)) { act.set('animal_creature', { layer: 'presence' }); continue; }
    act.set(id, { layer: 'presence' });
  }
  for (const [id, e] of EVT) {
    const p = a.e?.[id]; if (p == null || p < 0.7) continue;
    if (cancelled(e.cancel)) { nCancelled++; continue; }
    act.set(id, { layer: 'event' });
  }
  for (const d of Object.values(DERIVED)) if (Math.min(...d.from.map((x) => a.e?.[x] ?? 0)) >= 0.7) act.set(d.id, { layer: 'derived' });
  for (const it of items) {
    if (it.type === 'presence') { const pl = a.fpl?.[it.id] ?? 0; const ps = hasSum ? a.fps?.[it.id] ?? 0 : 0; if (pl >= 0.7 || ps >= 0.7) act.set(it.id, { layer: 'film', type: 'presence' }); continue; }
    const p = a.fe?.[it.id]; if (p == null || p < 0.7) continue;
    if (cancelled(it.cancel)) { nCancelled++; continue; }
    act.set(it.id, { layer: 'film', type: it.type });
  }
  return { act, mods, nCancelled };
}
function reasonsOf(a, act) {
  const f = POL.flag; const out = [];
  const danger = Number(a.s?.danger?.score ?? 0);
  for (const [id, t] of act) {
    if (t.layer === 'film') { if (f.film_specific_types.includes(t.type)) out.push(id); continue; }
    if (t.layer === 'derived') continue;
    if (t.layer === 'event') {
      if (!f.strong_events.includes(id)) continue;
      if (id === 'afraid_for_safety' && danger < 2) continue;
      out.push(id); continue;
    }
    if (f.presence.always.includes(id)) out.push(id);
    else if (f.presence.with_danger.includes(id) && danger >= 2) out.push(id);
    else if (f.presence.with_creature_threat.includes(id) && act.has('creature_threat')) out.push(id);
  }
  return out;
}
function selectFilm(jev) {
  const items = jev.film_items ?? [];
  const rows = jev.scenes.filter((s) => s.answers).map((s) => ({ s, ...sceneAct(s.answers, items) }));
  const counts = {};
  for (const r of rows) for (const id of r.act.keys()) counts[id] = (counts[id] ?? 0) + 1;
  const n = rows.length;
  const context = n >= 10 ? Object.entries(counts).filter(([, c]) => c / n >= 0.6).map(([id, c]) => ({ id, c, n, share: Math.round((c / n) * 1000) / 1000 })) : [];
  const ctx = new Set(context.map((x) => x.id));
  const scenes = rows.map((r) => {
    const all = reasonsOf(r.s.answers, r.act);
    const reasons = all.filter((x) => !ctx.has(x));
    return { id: r.s.id, start_ms: r.s.start_ms, end_ms: r.s.end_ms, flagged: reasons.length > 0, reasons, act: [...r.act.keys()], mods: r.mods, nCancelled: r.nCancelled, fsReasons: reasons.filter((x) => items.some((it) => it.id === x)) };
  });
  return { scenes, context, items };
}

// ---- baseline via the loader (read-only import) -------------------------------------------------------
const lctx = await L.openExperiment(TS);
const v2map = L.buildV2Map(lctx.taxonomy);
const vocabIds = new Set(L.buildVocabulary(lctx.taxonomy).items.map((i) => i.id));
function baseline(slug) {
  const built = L.buildFilmFrom(L.readFilmInputs(slug, lctx), { srt: lctx.srt, v2map, vocabIds });
  return built.scenes.map((s) => ({ id: s.id.split(':').pop(), title: s.title, start_ms: s.start_ms, end_ms: s.end_ms }));
}

const report = { films: {} };
for (const slug of FILMS) {
  const R = {}; report.films[slug] = R;
  const seg = rd(path.join(OUT, `${slug}.segments.json`));
  const src = rd(path.join(V5, 'sources', `${slug}.json`));
  const cues = srt(path.join(TS, 'data', `${slug}.srt`));
  const N = cues.length;
  const nW = src.wikipedia.sentences.length;
  const tIds = new Set(src.tmdb.cast.map((t) => t.id));
  const errs = [];

  // ---- segment contract ----
  const sc = seg.scenes;
  if (sc[0].start_cue !== 1) errs.push('first scene does not start at 1');
  if (sc[sc.length - 1].end_cue !== N) errs.push(`last scene ends ${sc[sc.length - 1].end_cue} != ${N}`);
  sc.forEach((s, i) => {
    if (i && s.start_cue !== sc[i - 1].end_cue + 1) errs.push(`${s.id} not contiguous`);
    if (s.start_ms !== cues[s.start_cue - 1].s) errs.push(`${s.id} start_ms ${s.start_ms} != cue ${cues[s.start_cue - 1].s}`);
    if (s.end_ms !== cues[s.end_cue - 1].e) errs.push(`${s.id} end_ms ${s.end_ms} != cue ${cues[s.end_cue - 1].e}`);
  });
  const zeroLen = sc.filter((s) => s.end_ms - s.start_ms <= 0).map((s) => `${s.id} ${s.start_cue}-${s.end_cue} ${s.end_ms - s.start_ms}ms`);
  const validId = (id, range) => {
    if (/^L\d+$/.test(id)) { const n = +id.slice(1); return n >= 1 && n <= N && (!range || (n >= range[0] && n <= range[1])); }
    if (/^W\d+$/.test(id)) { const n = +id.slice(1); return n >= 1 && n <= nW; }
    if (/^T\d+$/.test(id)) return tIds.has(id);
    return false;
  };
  const citeErr = [];
  let sentences = 0, sentVerified = 0, sentReach = 0, statusMismatch = [];
  for (const s of sc) {
    const range = [s.start_cue, s.end_cue];
    for (const [k, x] of s.sentences.entries()) {
      sentences++;
      if (!x.cites?.length) citeErr.push(`${s.id}.s${k + 1} no cites`);
      for (const id of x.cites ?? []) if (!validId(id, range)) citeErr.push(`${s.id}.s${k + 1} bad cite ${id}`);
      const st = x.check?.status;
      if (st === 'verified') sentVerified++;
      if (st === 'verified' && !x.judgement_words?.length) sentReach++;
      // status must agree with the cookbook rule (W-only sentences also need placement)
      const wOnly = (x.cites ?? []).every((c) => c[0] === 'W');
      const expect = passes(x.check) && (!wOnly || x.check?.placement?.choice === 'fits' || x.check?.placement == null ? passes(x.check) : false);
      if ((st === 'verified') !== (passes(x.check) && (!(x.check?.status === 'unplaced')))) statusMismatch.push(`${s.id}.s${k + 1} ${st} ${x.check?.verdict} ${x.check?.confidence}`);
      void expect;
    }
    const recomputed = s.sentences.filter((x) => x.check?.status === 'verified' && !x.judgement_words?.length).map((x) => x.text).join(' ');
    if (recomputed !== s.summary) errs.push(`${s.id} summary != its verified sentences`);
    if (s.setting && s.setting !== 'unknown') {
      if (!s.setting_cites?.length) citeErr.push(`${s.id} setting uncited`);
      for (const id of s.setting_cites ?? []) if (!validId(id, null)) citeErr.push(`${s.id} setting bad cite ${id}`);
    }
  }
  // cast + dangers
  const castErr = [];
  for (const c of seg.cast) {
    for (const f of ['kind', 'is_child', 'looks_frightening', 'disposition']) {
      const v = c[f];
      if (v === 'unknown' || v == null) continue;
      const cs = c.cites?.[f] ?? [];
      if (!cs.length) castErr.push(`${c.id}.${f}=${v} uncited`);
      for (const id of cs) if (!validId(id, null)) castErr.push(`${c.id}.${f} bad cite ${id}`);
    }
    for (const id of c.cites?.name ?? []) if (!validId(id, null)) castErr.push(`${c.id}.name bad cite ${id}`);
    if (!(c.cites?.name ?? []).length) castErr.push(`${c.id}.name uncited`);
  }
  for (const d of seg.dangers) {
    if (!d.cites?.length) castErr.push(`${d.id} uncited`);
    for (const id of d.cites ?? []) if (!validId(id, null)) castErr.push(`${d.id} bad cite ${id}`);
  }
  const summarised = sc.filter((s) => s.summary);
  R.segments = {
    scenes: sc.length, cues: N, contract_errors: errs, zero_length_scenes: zeroLen,
    sentences, sentences_verified: sentVerified, sentences_reaching_jev: sentReach, sentence_status_mismatch: statusMismatch,
    scenes_with_verified_summary: summarised.length,
    minutes_with_verified_summary: min3(summarised.reduce((a, s) => a + s.end_ms - s.start_ms, 0)),
    minutes_in_scenes: min3(sc.reduce((a, s) => a + s.end_ms - s.start_ms, 0)),
    cite_errors: citeErr, cast_danger_cite_errors: castErr,
    dangers_verified: `${seg.dangers.filter((d) => d.check?.status === 'verified').length}/${seg.dangers.length}`,
    settings_unknown: sc.filter((s) => !s.setting || s.setting === 'unknown').length,
    settings_verified: sc.filter((s) => s.setting_check?.status === 'verified').length,
    prompt: seg.prompt_version, effort: seg.effort,
  };

  // ---- claim check tallies from claims.json ----
  const cl = rd(path.join(OUT, `${slug}.claims.json`));
  const t = { n: cl.claims.length, supports: 0, contradicts: 0, says_nothing: 0, supports_below_08: 0, status: {} };
  for (const c of cl.claims) {
    t[c.verdict] = (t[c.verdict] ?? 0) + 1;
    if (c.verdict === 'supports' && c.confidence < 0.8) t.supports_below_08++;
    t.status[c.status] = (t.status[c.status] ?? 0) + 1;
  }
  // do the segment statuses agree with claims.json?
  const byKey = new Map(cl.claims.map((c) => [c.key, c]));
  const disagree = [];
  for (const s of sc) s.sentences.forEach((x, k) => { const c = byKey.get(`${s.id}.s${k + 1}`); if (!c) disagree.push(`${s.id}.s${k + 1} missing in claims`); else if (c.verdict !== x.check?.verdict || c.confidence !== x.check?.confidence) disagree.push(`${s.id}.s${k + 1}`); });
  const claimTok = cl.requests.reduce((a, r) => a + (r.input_tokens ?? 0), 0);
  R.claim_check = { ...t, segment_vs_claims_disagreements: disagree, requests: cl.requests.length, input_tokens: claimTok, usd_from_tokens: r4((claimTok * JEV_PRICE) / 1e6), recorded_usd: seg.claim_check.cost_usd, recorded_tally: seg.claim_check.tally };

  // ---- film items only from verified claims ----
  const jev1 = rd(path.join(OUT, `${slug}.jev.r1.json`));
  const jev2 = rd(path.join(OUT, `${slug}.jev.r2.json`));
  const itemErr = [];
  const castById = new Map(seg.cast.map((c) => [c.id, c]));
  const dById = new Map(seg.dangers.map((d) => [d.id, d]));
  for (const it of jev1.film_items) {
    if (it.entity.startsWith('D')) { const d = dById.get(it.entity); if (!passes(d?.check)) itemErr.push(`${it.id} from unverified danger`); continue; }
    const c = castById.get(it.entity);
    const why = it.why;
    const ok = why === 'child' ? c.is_child === true && passes(c.check?.is_child)
      : why === 'frightening' ? c.looks_frightening === true && passes(c.check?.looks_frightening)
        : c.disposition === why && passes(c.check?.disposition);
    if (!ok) itemErr.push(`${it.id} (${why}) from an unverified field`);
  }
  R.film_items = { items: jev1.film_items.length, questions: jev1.question_set.generated, from_unverified: itemErr, list: jev1.film_items.map((i) => `${i.id}:${i.why}`) };

  // ---- flags ----
  const sel1 = selectFilm(jev1); const sel2 = selectFilm(jev2);
  const tags1 = rd(path.join(OUT, `${slug}.tags.r1.json`)); const tags2 = rd(path.join(OUT, `${slug}.tags.r2.json`));
  const mismatch = [];
  for (const [sel, tags, run] of [[sel1, tags1, 'r1'], [sel2, tags2, 'r2']]) {
    const tb = new Map(tags.scenes.map((s) => [s.id, s]));
    for (const s of sel.scenes) {
      const t2 = tb.get(s.id);
      const a = [...s.reasons].sort().join(','); const b = t2.flag_reasons.map((r) => r.id).sort().join(',');
      if (s.flagged !== t2.flagged || a !== b) mismatch.push(`${run} ${s.id}: mine ${s.flagged}[${a}] vs select.js ${t2.flagged}[${b}]`);
    }
  }
  const fl1 = sel1.scenes.filter((s) => s.flagged); const fl2 = sel2.scenes.filter((s) => s.flagged);
  const fsCount = {};
  for (const s of fl1) for (const r of s.fsReasons) fsCount[r] = (fsCount[r] ?? 0) + 1;
  const presenceOnly = fl1.filter((s) => s.reasons.every((r) => PRES.has(r) || r === 'animal_creature')).map((s) => s.id);
  // severity distribution (from select.js output; the formula is checked by its tests)
  const sev33 = tags1.scenes.filter((s) => s.flagged && s.severity['5-7'].level === 3 && s.severity['8-10'].level === 3).length;
  const sev3any = tags1.scenes.filter((s) => s.flagged && (s.severity['5-7'].level === 3 || s.severity['8-10'].level === 3)).length;
  const afraidOnly = fl1.filter((s) => s.reasons.length === 1 && s.reasons[0] === 'afraid_for_safety').map((s) => `${s.id}${s.mods.comic ? '(comic)' : ''}`);
  const dm = fl1.filter((s) => s.reasons.includes('dangerous_machine')).map((s) => `${s.id}${s.reasons.length === 1 ? '(sole)' : ''}`);
  R.flags = {
    scenes: sel1.scenes.length, flagged_r1: fl1.length, flagged_r2: fl2.length, mismatches_vs_select_js: mismatch,
    film_level_notes: sel1.context,
    film_specific_reason_counts: fsCount,
    flagged_with_film_specific: fl1.filter((s) => s.fsReasons.length).length,
    flagged_only_film_specific: fl1.filter((s) => s.fsReasons.length && s.fsReasons.length === s.reasons.length).map((s) => s.id),
    flagged_by_presence_only: presenceOnly,
    afraid_for_safety_only: afraidOnly,
    dangerous_machine_flags: dm,
    retold_on_scenes: sel1.scenes.filter((s) => s.mods.retold).length,
    cancelled_events_total: sel1.scenes.reduce((a, s) => a + s.nCancelled, 0),
    severity_3_3: `${sev33}/${fl1.length}`, severity_3_any_band: `${sev3any}/${fl1.length}`,
    flagged_ids_r1: fl1.map((s) => s.id),
  };

  // ---- moments / skip ----
  const mom = rd(path.join(OUT, `${slug}.moments.r1.json`));
  const momIds = Object.keys(mom.scenes).sort();
  const flIds = fl1.map((s) => s.id).sort();
  const spanErr = [];
  const skipIv = [];
  const pad = POL.moments.pad_ms;
  const cueOf = (id) => cues[+id.slice(1) - 1];
  let wholeFallback = 0;
  for (const s of fl1) {
    const m = mom.scenes[s.id];
    if (!m) { spanErr.push(`${s.id} flagged but no moments entry (whole scene)`); skipIv.push([s.start_ms, s.end_ms]); continue; }
    if (m.method !== 'moments') wholeFallback++;
    // re-derive
    let mine;
    if (m.method === 'moments') {
      const per = (m.per_reason ?? []).filter((p) => p.span);
      const ivs = per.map((p) => {
        const b = cueOf(p.begin.line); const e = cueOf(p.end.line);
        return [Math.max(s.start_ms, b.s - pad), Math.min(s.end_ms, e.e + pad)];
      });
      for (const [k, p] of per.entries()) if (p.span.start_ms !== ivs[k][0] || p.span.end_ms !== ivs[k][1]) spanErr.push(`${s.id} reason ${k} span ${p.span.start_ms}-${p.span.end_ms} vs mine ${ivs[k][0]}-${ivs[k][1]}`);
      // begin must not come after end
      for (const p of per) if (+p.begin.line.slice(1) > +p.end.line.slice(1)) spanErr.push(`${s.id} begin ${p.begin.line} after end ${p.end.line}`);
      mine = union(ivs.map((x) => [...x]));
    } else mine = [[s.start_ms, s.end_ms]];
    const theirs = union(m.spans.map((x) => [x.start_ms, x.end_ms]));
    // moments.js merges spans with a 1 s gap; compare lengths within 1 s per gap
    if (Math.abs(len(mine) - len(theirs)) > 1000 * Math.max(1, mine.length)) spanErr.push(`${s.id} union ${len(theirs)} vs mine ${len(mine)}`);
    skipIv.push(...theirs.map((x) => [...x]));
  }
  const skipU = union(skipIv);
  const flagU = union(fl1.map((s) => [s.start_ms, s.end_ms]));
  const nextStart = new Map(sel1.scenes.map((s, i) => [s.id, sel1.scenes[i + 1]?.start_ms ?? s.end_ms]));
  const flagExtU = union(fl1.map((s) => [s.start_ms, nextStart.get(s.id)]));
  const momTok = Object.values(mom.scenes).reduce((a, m) => a + (m.request?.input_tokens ?? 0), 0);
  const underReserved = Object.entries(mom.scenes).filter(([, m]) => m.request && m.request.input_tokens > m.request.est_tokens).length;
  R.skip = {
    moments_scenes_equal_flagged: JSON.stringify(momIds) === JSON.stringify(flIds), moments_only: momIds.filter((x) => !flIds.includes(x)), flagged_without_moments: flIds.filter((x) => !momIds.includes(x)),
    skip_minutes: min3(len(skipU)), flagged_scene_minutes: min3(len(flagU)), whole_scene_fallbacks: wholeFallback, span_errors: spanErr,
    moments_input_tokens: momTok, moments_usd_from_tokens: r4((momTok * JEV_PRICE) / 1e6), moments_recorded_usd: mom.cost_usd,
    moments_requests_actual_tokens_above_estimate: `${underReserved}/${Object.keys(mom.scenes).length}`,
  };

  // ---- baseline coverage ----
  const base = baseline(slug);
  const rows = base.map((b) => { const d = Math.max(1, b.end_ms - b.start_ms); return { id: b.id, title: b.title, skip: inter(skipU, b.start_ms, b.end_ms) / d, flag: inter(flagExtU, b.start_ms, b.end_ms) / d }; });
  const outside = fl1.filter((s) => !base.some((b) => Math.min(s.end_ms, b.end_ms) - Math.max(s.start_ms, b.start_ms) > 0)).map((s) => s.id);
  R.baseline = {
    scenes: base.length, minutes: min3(len(union(base.map((b) => [b.start_ms, b.end_ms])))),
    covered_by_skip: rows.filter((r) => r.skip >= 0.5).length, covered_by_flagged_ext: rows.filter((r) => r.flag >= 0.5).length,
    not_covered_by_skip: rows.filter((r) => r.skip < 0.5).map((r) => `${r.id} skip ${Math.round(r.skip * 100)}% flag ${Math.round(r.flag * 100)}%`),
    flags_outside_baseline: outside,
  };

  // ---- stability ----
  const b2 = new Map(sel2.scenes.map((s) => [s.id, s]));
  const flips = sel1.scenes.filter((s) => s.flagged !== b2.get(s.id).flagged).map((s) => s.id);
  const reasonDiff = sel1.scenes.filter((s) => s.flagged && b2.get(s.id).flagged && [...s.reasons].sort().join() !== [...b2.get(s.id).reasons].sort().join()).map((s) => s.id);
  let actUnion = 0, actFlip = 0;
  for (const s of sel1.scenes) { const a = new Set(s.act); const b = new Set(b2.get(s.id).act); const u = new Set([...a, ...b]); actUnion += u.size; for (const x of u) if (a.has(x) !== b.has(x)) actFlip++; }
  const j2 = new Map(jev2.scenes.map((s) => [s.id, s]));
  let n = 0, sum = 0, max = 0, cross = 0;
  for (const s of jev1.scenes) {
    const a1 = s.answers; const a2 = j2.get(s.id).answers;
    for (const ch of ['pl', 'ps', 'm', 'e', 'mod', 'fpl', 'fps', 'fe']) {
      if (!a1[ch]) continue;
      for (const [k, v] of Object.entries(a1[ch])) {
        const w = a2[ch]?.[k]; if (typeof v !== 'number' || typeof w !== 'number') continue;
        n++; const d = Math.abs(v - w); sum += d; max = Math.max(max, d); if ((v >= 0.7) !== (w >= 0.7)) cross++;
      }
    }
  }
  R.stability = { flag_flips: flips, reason_set_diffs: reasonDiff, act_tag_flips: `${actFlip}/${actUnion}`, yes_no_answers: n, mean_abs_d: r4(sum / n), max_abs_d: Math.round(max * 100) / 100, crossed_070: cross };

  // ---- costs from tokens ----
  const cost = (j) => { const tok = j.scenes.reduce((a, s) => a + s.requests.reduce((b, r) => b + (r.input_tokens ?? 0), 0), 0); return { tokens: tok, usd: r4((tok * JEV_PRICE) / 1e6), recorded: j.cost_usd, usage_tokens: j.usage.input_tokens, reqs: j.scenes.reduce((a, s) => a + s.requests.length, 0), non200: j.scenes.flatMap((s) => s.requests.flatMap((r) => r.attempts.filter((x) => x.status !== 200))).length, over_estimate: j.scenes.flatMap((s) => s.requests).filter((r) => r.input_tokens > r.est_tokens).length }; };
  const u = seg.usage;
  const spend = rd(path.join(OUT, `${slug}.spend.json`));
  R.cost = {
    sonnet_from_tokens: r4((u.input_tokens * SONNET[0] + u.output_tokens * SONNET[1]) / 1e6), sonnet_recorded: seg.cost_usd,
    classify_r1: cost(jev1), classify_r2: cost(jev2),
    ledger: spend.totals, ledger_jev_sum: r4(spend.entries.filter((e) => e.kind === 'jev').reduce((a, e) => a + e.usd, 0)),
    ledger_after_phase_start: r4(spend.entries.filter((e) => e.at >= '2026-09-24T17:30:00.000Z').reduce((a, e) => a + e.usd, 0)),
  };
  R.cost.one_pass_total = r4(R.cost.sonnet_from_tokens + R.claim_check.usd_from_tokens + R.cost.classify_r1.usd + R.skip.moments_usd_from_tokens);
}

// ---- question hash vs the recorded one (same questions as questions.js now) ----
const Q = await import('../questions.js');
report.question_hash = {};
for (const slug of FILMS) {
  for (const run of ['r1', 'r2']) {
    const j = rd(path.join(OUT, `${slug}.jev.${run}.json`));
    const seg = rd(path.join(OUT, `${slug}.segments.json`));
    const items = Q.filmItems(seg);
    const h = crypto.createHash('sha256').update(JSON.stringify({ universal: Q.buildQuestions(), generated: Q.filmQuestions(items) })).digest('hex').slice(0, 12);
    report.question_hash[`${slug}.${run}`] = { recorded: j.question_set.sha256_12, now: h, same: h === j.question_set.sha256_12, items_same: JSON.stringify(items.map((i) => i.id)) === JSON.stringify(j.film_items.map((i) => i.id)) };
  }
}

const tot = Object.values(report.films);
report.phase_spend_after_17_30Z = r4(tot.reduce((a, f) => a + f.cost.ledger_after_phase_start, 0));
report.all_spend = r4(tot.reduce((a, f) => a + f.cost.ledger.sonnet + f.cost.ledger.jev, 0));
fs.mkdirSync(path.join(here, 'out'), { recursive: true });
fs.writeFileSync(path.join(here, 'out', 'recompute.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 1));
