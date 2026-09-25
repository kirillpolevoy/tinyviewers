#!/usr/bin/env node
// Rebuilds every Jev request body offline (classify.planScene is pure) and checks:
//   - lines requests: state is exactly { film:{title}, scene:{lines} } and lines == SRT cues of the scene
//   - rebuilt body size == the est_tokens recorded per request (so the rebuild is what was sent)
//   - context requests: summary == verified sentences only; cast fields only verified values;
//     setting only when verified; dangers only verified
//   - no baseline (live DB) scene title/description 5-gram in any state's model-written text, the
//     Sonnet raw output, or the segment prompt's fixed text
// Writes verify/out/states.json (ids and counts only). No network.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSrt } from '../../srt.js';
import { planScene } from '../classify.js';
import { filmItems, verifiedSentences } from '../questions.js';
import * as L from '../../../../scene-api/load.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const V5 = path.resolve(here, '..');
const TS = path.resolve(V5, '..');
const rd = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const passes = (c) => c && c.verdict === 'supports' && Number(c.confidence) >= 0.8;
const lctx = await L.openExperiment(TS);
const v2map = L.buildV2Map(lctx.taxonomy);
const vocabIds = new Set(L.buildVocabulary(lctx.taxonomy).items.map((i) => i.id));
const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9' ]+/g, ' ').replace(/\s+/g, ' ').trim();
const grams = (s, n) => { const w = norm(s).split(' ').filter(Boolean); const g = new Set(); for (let i = 0; i + n <= w.length; i++) g.add(w.slice(i, i + n).join(' ')); return g; };
const segSrc = fs.readFileSync(path.join(V5, 'segment.js'), 'utf8');
const systemText = segSrc.slice(segSrc.indexOf('const SYSTEM = `'), segSrc.indexOf('const USER = `'));

const out = {};
for (const slug of ['nemo', 'monsters-inc', 'lion-king']) {
  const seg = rd(path.join(V5, 'out', `${slug}.segments.json`));
  const jev = rd(path.join(V5, 'out', `${slug}.jev.r1.json`));
  const cues = parseSrt(fs.readFileSync(path.join(TS, 'data', `${slug}.srt`), 'utf8'));
  const items = filmItems(seg);
  const jById = new Map(jev.scenes.map((s) => [s.id, s]));
  const R = { lines_state_bad: [], lines_text_bad: [], est_mismatch: [], summary_bad: [], cast_bad: [], setting_bad: [], danger_bad: [], context_keys: new Set(), lines_keys: new Set() };
  const modelText = []; // model-written text that reached Jev
  for (const scene of seg.scenes) {
    const sc = cues.slice(scene.start_cue - 1, scene.end_cue);
    const plan = planScene({ seg, scene, cues: sc, items });
    const [lr, cr] = plan.reqs;
    const ls = lr.body.state;
    R.lines_keys.add(JSON.stringify({ top: Object.keys(ls), film: Object.keys(ls.film), scene: Object.keys(ls.scene) }));
    if (Object.keys(ls).join() !== 'film,scene' || Object.keys(ls.film).join() !== 'title' || Object.keys(ls.scene).join() !== 'lines') R.lines_state_bad.push(scene.id);
    const want = sc.map((c) => `L${c.index}| ${c.text}`);
    if (JSON.stringify(ls.scene.lines) !== JSON.stringify(want)) R.lines_text_bad.push(scene.id);
    const rec = jById.get(scene.id).requests;
    for (const [k, r] of [lr, cr].entries()) if (rec[k].est_tokens !== r.est) R.est_mismatch.push(`${scene.id}/${rec[k].part} rec ${rec[k].est_tokens} rebuilt ${r.est}`);
    const cs = cr.body.state;
    R.context_keys.add(JSON.stringify({ top: Object.keys(cs), scene: Object.keys(cs.scene) }));
    const vs = scene.sentences.filter((x) => passes(x.check) && x.check.status === 'verified' && !x.judgement_words?.length).map((x) => x.text).join(' ');
    if (cs.scene.summary !== vs) R.summary_bad.push(scene.id);
    if (cs.scene.setting !== 'unknown' && !(passes(scene.setting_check) && scene.setting_check.status === 'verified')) R.setting_bad.push(scene.id);
    for (const row of cs.cast) {
      const c = seg.cast.find((x) => x.name === row.name);
      for (const f of ['kind', 'is_child', 'looks_frightening', 'disposition']) if (row[f] !== 'unknown' && !passes(c.check?.[f])) R.cast_bad.push(`${scene.id} ${c.id}.${f}`);
      if (row.note && !passes(c.check?.disposition)) R.cast_bad.push(`${scene.id} ${c.id}.note`);
      if (!passes(c.check?.name)) R.cast_bad.push(`${scene.id} ${c.id}.name unverified but sent`);
    }
    for (const d of cs.dangers ?? []) { const dd = seg.dangers.find((x) => x.name === d.name); if (!passes(dd.check)) R.danger_bad.push(`${scene.id} ${dd.id}`); }
    modelText.push(cs.scene.summary, cs.scene.setting, ...cs.cast.map((c) => `${c.note ?? ''}`), ...(cs.dangers ?? []).map((d) => `${d.name} ${d.note ?? ''}`));
  }
  R.lines_keys = [...R.lines_keys]; R.context_keys = [...R.context_keys];
  // unverified cast names that reached Jev: count distinct
  R.cast_bad = [...new Set(R.cast_bad.map((x) => x.replace(/^S\d+ /, '')))];
  // baseline leakage: 5-grams of baseline titles+descriptions vs model-written text that reached Jev, the raw Sonnet output, and the segment prompt's fixed text
  const built = L.buildFilmFrom(L.readFilmInputs(slug, lctx), { srt: lctx.srt, v2map, vocabIds });
  const baseGrams = new Set(); const titles = [];
  for (const s of built.scenes) { for (const g of grams(`${s.description ?? ''}`, 5)) baseGrams.add(g); titles.push(norm(s.title)); }
  const raw = fs.readFileSync(path.join(V5, 'out', `${slug}.segments.raw.json`), 'utf8');
  const hits = (text) => [...grams(text, 5)].filter((g) => baseGrams.has(g));
  const titleHits = (text) => { const t = norm(text); return titles.filter((x) => x.split(' ').length >= 3 && t.includes(x)); };
  const jevText = modelText.join(' | ');
  R.baseline_5gram_in_jev_model_text = hits(jevText).length;
  R.baseline_title_in_jev_model_text = titleHits(jevText);
  let rawText = raw; try { rawText = JSON.stringify(JSON.parse(raw)); } catch {}
  R.baseline_5gram_in_sonnet_raw = hits(rawText).length;
  R.baseline_5gram_examples = hits(rawText).slice(0, 5);
  R.baseline_title_in_sonnet_raw = titleHits(rawText);
  R.baseline_5gram_in_system_prompt = hits(systemText).length;
  R.baseline_title_in_system_prompt = titleHits(systemText);
  out[slug] = R;
}
fs.mkdirSync(path.join(here, 'out'), { recursive: true });
fs.writeFileSync(path.join(here, 'out', 'states.json'), JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 1));
