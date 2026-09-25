#!/usr/bin/env node
// Read-only symptom scan over classify.js raw outputs (no API calls).
// node verify/symptoms.js  -> prints JSON to stdout; writes verify/out/symptoms.json (ids + numbers only)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSrt } from '../../srt.js';
import { PRESENCE, EVENTS } from '../questions.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(here, '..', 'out');
const films = ['nemo', 'monsters-inc'];
const r2 = (x) => Math.round(x * 100) / 100;
const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null);
const quant = (a, q) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(q * s.length))]; };
const pearson = (a, b) => {
  const ma = mean(a), mb = mean(b);
  let n = 0, da = 0, db = 0;
  for (let i = 0; i < a.length; i++) { n += (a[i] - ma) * (b[i] - mb); da += (a[i] - ma) ** 2; db += (b[i] - mb) ** 2; }
  return da && db ? n / Math.sqrt(da * db) : null;
};

const report = {};
for (const slug of films) {
  const run = JSON.parse(fs.readFileSync(path.join(outDir, `${slug}.jev.r1.json`), 'utf8'));
  const run2 = JSON.parse(fs.readFileSync(path.join(outDir, `${slug}.jev.r2.json`), 'utf8'));
  const seg = JSON.parse(fs.readFileSync(path.join(outDir, `${slug}.segments.json`), 'utf8'));
  const cues = parseSrt(fs.readFileSync(path.resolve(outDir, run.srt_file.replace(/^\.\.\//, '../../')), 'utf8'));
  const sc = run.scenes.filter((s) => s.answers);
  const N = sc.length;
  const R = {};

  // ---- Scores
  R.scores = {};
  const dims = Object.keys(sc[0].answers.s);
  const normBy = {};
  for (const d of dims) {
    const conf = sc.map((s) => s.answers.s[d].confidence);
    const top = sc[0].answers.s[d].top;
    const modes = {};
    for (const s of sc) modes[s.answers.s[d].mode] = (modes[s.answers.s[d].mode] ?? 0) + 1;
    normBy[d] = sc.map((s) => s.answers.s[d].score / top);
    // bimodal: top-2 levels not adjacent with both >= 0.2
    const bimodal = sc.filter((s) => {
      const p = Object.entries(s.answers.s[d].probabilities).map(([k, v]) => [Number(k), v]).sort((a, b) => b[1] - a[1]);
      return p[1][1] >= 0.2 && Math.abs(p[0][0] - p[1][0]) >= 2;
    }).map((s) => s.id);
    R.scores[d] = {
      conf_mean: r2(mean(conf)), conf_median: r2(quant(conf, 0.5)), conf_lt_0_5: conf.filter((c) => c < 0.5).length, conf_lt_0_7: conf.filter((c) => c < 0.7).length,
      mode_counts: modes, top_level_share: r2((modes[top] ?? 0) / N), mean_norm: r2(mean(normBy[d])), nonadjacent_split_scenes: bimodal,
    };
  }
  R.score_corr = {};
  for (let i = 0; i < dims.length; i++) for (let j = i + 1; j < dims.length; j++) R.score_corr[`${dims[i]}~${dims[j]}`] = r2(pearson(normBy[dims[i]], normBy[dims[j]]));

  // ---- Nouls per channel
  R.noul = {};
  for (const ch of ['pl', 'ps', 'm', 'e', 'mod']) {
    const all = sc.flatMap((s) => Object.values(s.answers[ch]));
    R.noul[ch] = {
      n: all.length, lt_0_1: r2(all.filter((x) => x < 0.1).length / all.length), mid_0_3_0_7: r2(all.filter((x) => x >= 0.3 && x < 0.7).length / all.length),
      mid_0_4_0_6: all.filter((x) => x >= 0.4 && x < 0.6).length, ge_0_7: r2(all.filter((x) => x >= 0.7).length / all.length),
    };
  }
  // per question: act rate, mid-band rate
  const perQ = [];
  for (const ch of ['pl', 'ps', 'm', 'e', 'mod']) {
    for (const id of Object.keys(sc[0].answers[ch])) {
      const v = sc.map((s) => s.answers[ch][id]);
      perQ.push({ q: `${ch}.${id}`, act: v.filter((x) => x >= 0.7).length, mid: v.filter((x) => x >= 0.4 && x < 0.7).length, mean: r2(mean(v)) });
    }
  }
  R.most_fired = perQ.filter((x) => x.act / N >= 0.25).sort((a, b) => b.act - a.act);
  R.most_mid = perQ.filter((x) => x.mid >= Math.max(4, 0.12 * N)).sort((a, b) => b.mid - a.mid);

  // ---- Choice
  const kc = sc.map((s) => s.answers.kind.confidence);
  const picks = {};
  for (const s of sc) picks[s.answers.kind.choice] = (picks[s.answers.kind.choice] ?? 0) + 1;
  R.kind = { conf_mean: r2(mean(kc)), lt_0_9: kc.filter((c) => c < 0.9).length, lt_0_5: kc.filter((c) => c < 0.5).length, picks };
  // Monster presence act vs kind choice
  R.kind.monster_act_scenes = sc.filter((s) => Math.max(s.answers.pl.monster_creature, s.answers.ps.monster_creature) >= 0.7).length;
  R.kind.monster_act_kind = {};
  for (const s of sc.filter((s) => Math.max(s.answers.pl.monster_creature, s.answers.ps.monster_creature) >= 0.7)) {
    const k = `${s.answers.kind.choice}${s.answers.kind.confidence >= 0.9 ? '' : '?'}`;
    R.kind.monster_act_kind[k] = (R.kind.monster_act_kind[k] ?? 0) + 1;
  }

  // ---- lines channel on textBlind items (visual-only nouns that dialogue rarely shows)
  R.pl_textblind_act = PRESENCE.filter((p) => p.textBlind).map((p) => ({ id: p.id, pl_act: sc.filter((s) => s.answers.pl[p.id] >= 0.7).length, ps_act: sc.filter((s) => s.answers.ps[p.id] >= 0.7).length })).filter((x) => x.pl_act || x.ps_act);

  // ---- lines-channel leakage check: pl act but keyword absent from the scene's lines
  const KW = { shark: /shark/i, monster_creature: /monster/i, mask: /mask/i, fire: /fire|flame|burn/i, gun: /gun|shoot|shot/i, ghost_spirit: /ghost|spirit/i };
  R.pl_act_keyword_absent = {};
  for (const [id, re] of Object.entries(KW)) {
    const rows = sc.filter((s) => s.answers.pl[id] >= 0.7).map((s) => {
      const txt = cues.slice(s.start_cue - 1, s.end_cue).map((c) => c.text).join(' ');
      return { id: s.id, kw: re.test(txt), pl: r2(s.answers.pl[id]), ps: r2(s.answers.ps[id]) };
    });
    R.pl_act_keyword_absent[id] = { pl_act: rows.length, keyword_absent: rows.filter((r) => !r.kw).map((r) => `${r.id}(pl ${r.pl}, ps ${r.ps})`) };
  }
  // pl vs ps agreement per item: pearson
  R.pl_ps_corr_mean = r2(mean(PRESENCE.map((p) => pearson(sc.map((s) => s.answers.pl[p.id]), sc.map((s) => s.answers.ps[p.id]))).filter((x) => x !== null)));

  // ---- mention vs presence: mention high where presence lines high (redundant) and mention-only candidates
  R.mention = PRESENCE.filter((p) => p.mention).map((p) => ({ id: p.id, m_act: sc.filter((s) => s.answers.m[p.id] >= 0.7).length, m_act_and_pl_act: sc.filter((s) => s.answers.m[p.id] >= 0.7 && s.answers.pl[p.id] >= 0.7).length })).filter((x) => x.m_act);

  // ---- modifiers
  R.modifiers = Object.fromEntries(Object.keys(sc[0].answers.mod).map((m) => [m, { on: sc.filter((s) => s.answers.mod[m] >= 0.7).length, mid: sc.filter((s) => s.answers.mod[m] >= 0.4 && s.answers.mod[m] < 0.7).length }]));

  // ---- known_from_film vs summary-only presence
  const kff = new Map(seg.scenes.map((s) => [s.id, s.known_from_film]));
  R.ps_only_act = { total: 0, known_from_film: 0 };
  for (const s of sc) for (const p of PRESENCE) if (s.answers.ps[p.id] >= 0.7 && s.answers.pl[p.id] < 0.7) { R.ps_only_act.total++; if (kff.get(s.id)) R.ps_only_act.known_from_film++; }

  // ---- event co-firing: how many events at act per scene
  const perScene = sc.map((s) => Object.values(s.answers.e).filter((x) => x >= 0.7).length);
  R.events_act_per_scene = { mean: r2(mean(perScene)), median: quant(perScene, 0.5), max: Math.max(...perScene), zero: perScene.filter((x) => x === 0).length };

  // ---- event (literal) — scenes where e.terrified >= 0.7 but distress score mode <= 1
  R.terrified_vs_distress = sc.filter((s) => s.answers.e.terrified >= 0.7 && s.answers.s.distress.mode <= 1).map((s) => `${s.id}(terr ${r2(s.answers.e.terrified)}, distress mode ${s.answers.s.distress.mode})`);
  // danger score "nobody in danger" but an event of peril fires
  R.peril_event_with_danger0 = sc.filter((s) => s.answers.s.danger.mode === 0 && ['chased', 'attacked', 'caught_in_hazard', 'falls', 'cannot_breathe'].some((e) => s.answers.e[e] >= 0.7)).map((s) => s.id);

  // ---- r1 vs r2 Score and Choice stability
  const byId2 = new Map(run2.scenes.map((s) => [s.id, s]));
  const sdiff = {}; let kflip = 0;
  for (const s of sc) {
    const t = byId2.get(s.id)?.answers; if (!t) continue;
    for (const d of dims) (sdiff[d] ??= []).push(Math.abs(s.answers.s[d].score - t.s[d].score));
    if (t.kind.choice !== s.answers.kind.choice) kflip++;
  }
  R.r1_r2 = { score_absdiff_max: Object.fromEntries(Object.entries(sdiff).map(([d, v]) => [d, r2(Math.max(...v))])), kind_choice_flips: kflip };

  // tokens: state vs questions
  R.tokens = { per_scene: run.tokens_per_scene, state_est_mean: Math.round(mean(sc.map((s) => s.requests[0].est_state_tokens))), state_est_max: Math.max(...sc.map((s) => s.requests[0].est_state_tokens)), lines_max: Math.max(...sc.map((s) => s.n_lines)), cast_used_mean: r2(mean(sc.map((s) => s.cast_used.length))), cast_total: seg.cast.length };
  report[slug] = R;
}
fs.mkdirSync(path.join(here, 'out'), { recursive: true });
fs.writeFileSync(path.join(here, 'out', 'symptoms.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 1));
